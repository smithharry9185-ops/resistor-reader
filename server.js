/**
 * ResistorReader — HTTP server.
 *
 * Built-in http module only. Exactly one dependency in the project:
 * @qvac/sdk (used by lib/ocr.js). This file has zero external imports.
 *
 * Routes (PRD §10):
 *   GET  /                  -> public/index.html
 *   GET  /styles.css, /app.js, etc. -> static files from public/
 *   POST /api/process       -> multipart image -> readImage -> JSON
 *   GET  /api/readings      -> all CSV rows as JSON
 *   POST /api/clear         -> reset CSV to header-only
 *
 * Constraints:
 *   NFR-3  max upload 25 MB
 *   FR-8   write to .tmp/, delete after processing
 *   FR-18  dedupe by image hash for 10 seconds
 *   NFR-7  uploaded images never persist
 *   NFR-10 never crash on a bad image
 */

import { createServer } from "node:http";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { extname, join, resolve, sep } from "node:path";
import { readImage } from "./lib/read.js";
import { readAll, clearLedger, appendReading } from "./lib/ledger.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = "127.0.0.1";
const MAX_UPLOAD = 25 * 1024 * 1024;  // 25 MB, NFR-3
const TMP_DIR = ".tmp";
const CSV_PATH = "readings.csv";
const PUBLIC_DIR = resolve("public");

// ----- dedup store (FR-18) -----
// Maps sha256(image bytes) -> { expiresAt, result }
const recent = new Map();
const DEDUP_WINDOW_MS = 10_000;

function gcRecent() {
  const now = Date.now();
  for (const [k, v] of recent) if (v.expiresAt < now) recent.delete(k);
}

// ----- static file serving -----

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
};

async function serveStatic(req, res, urlPath) {
  // Default to index.html
  let rel = urlPath === "/" ? "/index.html" : urlPath;

  // Prevent path traversal: reject any "..".
  if (rel.includes("..")) return send(res, 400, { error: "Bad path" });

  const abs = resolve(join(PUBLIC_DIR, rel));

  // Also ensure the resolved path is still inside PUBLIC_DIR.
  if (!abs.startsWith(PUBLIC_DIR + sep) && abs !== PUBLIC_DIR) {
    return send(res, 400, { error: "Bad path" });
  }

  try {
    const buf = await readFile(abs);
    const type = MIME[extname(abs).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Content-Length": buf.length });
    res.end(buf);
  } catch (err) {
    if (err.code === "ENOENT") return send(res, 404, { error: "Not found" });
    throw err;
  }
}

// ----- multipart parser -----

/**
 * Parse a multipart/form-data body and return the first file's bytes
 * and filename. Minimal — enough for a single <input type="file">.
 *
 * @param {Buffer} body
 * @param {string} contentType - full Content-Type header including boundary
 * @returns {{ bytes: Buffer, filename: string, fieldName: string } | null}
 */
function parseMultipart(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) return null;
  const boundary = (m[1] ?? m[2]).trim();

  const boundaryBytes = Buffer.from("--" + boundary);
  const parts = splitBuffer(body, boundaryBytes);

  // Each part starts with \r\n and ends with \r\n. Skip the preamble
  // (before the first boundary) and the epilogue (after the last --).
  for (const part of parts) {
    if (part.length === 0) continue;

    // Find end of headers (\r\n\r\n)
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const headerText = part.slice(0, headerEnd).toString("utf8");
    const bodyBytes = part.slice(headerEnd + 4);

    // Trim trailing CRLF that belongs to the multipart framing.
    let cleanBody = bodyBytes;
    if (
      cleanBody.length >= 2 &&
      cleanBody[cleanBody.length - 2] === 0x0d &&
      cleanBody[cleanBody.length - 1] === 0x0a
    ) {
      cleanBody = cleanBody.slice(0, -2);
    }

    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    const fileMatch = /filename="([^"]*)"/i.exec(headerText);
    if (fileMatch) {
      return {
        bytes: cleanBody,
        filename: fileMatch[1],
        fieldName: nameMatch ? nameMatch[1] : "file",
      };
    }
  }
  return null;
}

/**
 * Split a Buffer on a delimiter Buffer. Returns the segments between
 * delimiters (not including the delimiters themselves).
 */
function splitBuffer(buf, delim) {
  const out = [];
  let start = 0;
  while (true) {
    const idx = buf.indexOf(delim, start);
    if (idx === -1) {
      out.push(buf.slice(start));
      break;
    }
    out.push(buf.slice(start, idx));
    start = idx + delim.length;
  }
  return out;
}

// ----- request body reader -----

function readBody(req, limit) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(Object.assign(new Error("Upload too large"), { code: "TOO_LARGE" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolvePromise(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ----- response helpers -----

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

// ----- routes -----

async function handleProcess(req, res) {
  const ct = req.headers["content-type"] ?? "";
  if (!ct.startsWith("multipart/form-data")) {
    return send(res, 400, { error: "Expected multipart/form-data" });
  }

  let body;
  try {
    body = await readBody(req, MAX_UPLOAD);
  } catch (err) {
    if (err.code === "TOO_LARGE") {
      return send(res, 413, { error: "Upload too large (max 25 MB)" });
    }
    throw err;
  }

  const parsed = parseMultipart(body, ct);
  if (!parsed) return send(res, 400, { error: "No image field in request." });

  const { bytes, filename } = parsed;
  if (!bytes || bytes.length === 0) {
    return send(res, 400, { error: "No image field in request." });
  }

  // Dedup by content hash (FR-18).
  const hash = createHash("sha256").update(bytes).digest("hex");
  gcRecent();
  const cached = recent.get(hash);
  if (cached && cached.expiresAt > Date.now()) {
    return send(res, 200, { ...cached.result, deduplicated: true });
  }

  // Write to .tmp/, process, delete (FR-8, NFR-7).
  await mkdir(TMP_DIR, { recursive: true });
  const ext = extname(filename || "").toLowerCase() || ".png";
  const tmpPath = join(TMP_DIR, `${randomUUID()}${ext}`);

  try {
    await writeFile(tmpPath, bytes);
    const started = Date.now();
    const result = await readImage(tmpPath);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);

    if (!result.ok) {
      if (result.reason === "no_text") {
        return send(res, 422, {
          error: "No text found. Is the label sharp and legible?",
        });
      }
      if (result.reason === "ocr_error") {
        return send(res, 500, { error: `OCR engine error: ${result.error}` });
      }
      return send(res, 422, {
        error: `OCR read ${JSON.stringify(result.rawOcr)} but couldn't parse it as a resistor value.`,
      });
    }

    const payload = {
      ok: true,
      input: result.input,
      ohms: result.ohms,
      formatted: result.formatted,
      rawOcr: result.rawOcr,
      elapsed,
      details: result.details,
    };

    // Append to ledger (best-effort — a ledger failure shouldn't fail
    // the whole request; the user still gets their answer).
    try {
      await appendReading(CSV_PATH, {
        timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        input: result.input,
        ohms: result.ohms,
        formatted: result.formatted,
      });
    } catch (err) {
      console.error("[server] ledger append failed:", err);
    }

    recent.set(hash, { expiresAt: Date.now() + DEDUP_WINDOW_MS, result: payload });
    return send(res, 200, payload);
  } finally {
    unlink(tmpPath).catch(() => {});
  }
}

async function handleReadings(req, res) {
  try {
    const rows = await readAll(CSV_PATH);
    return send(res, 200, { rows });
  } catch (err) {
    console.error("[server] readings failed:", err);
    return send(res, 500, { error: "Could not read ledger." });
  }
}

async function handleClear(req, res) {
  try {
    await clearLedger(CSV_PATH);
    recent.clear();
    return send(res, 200, { ok: true });
  } catch (err) {
    console.error("[server] clear failed:", err);
    return send(res, 500, { error: "Could not clear ledger." });
  }
}

// ----- main request handler -----

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  try {
    if (req.method === "POST" && pathname === "/api/process")
      return await handleProcess(req, res);
    if (req.method === "GET" && pathname === "/api/readings")
      return await handleReadings(req, res);
    if (req.method === "POST" && pathname === "/api/clear")
      return await handleClear(req, res);
    if (req.method === "GET") return await serveStatic(req, res, pathname);
    return send(res, 405, { error: "Method not allowed" });
  } catch (err) {
    console.error("[server] unhandled:", err);
    if (!res.headersSent) return send(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`ResistorReader listening on http://${HOST}:${PORT}`);
  console.log(`Public dir: ${PUBLIC_DIR}`);
  console.log(`Ledger:     ${resolve(CSV_PATH)}`);
});