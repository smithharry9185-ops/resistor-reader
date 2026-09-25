/**
 * CSV ledger for ResistorReader.
 *
 * Responsibilities (PRD §7.4, §9.4):
 *   - appendReading(csvPath, record)  -> append one row
 *   - readAll(csvPath)                -> all rows as objects
 *   - clearLedger(csvPath)            -> reset to header-only
 *   - rowCount(csvPath)               -> number of data rows
 *
 * Pure Node fs/promises. No SDK, no model, no network. Fully unit-testable.
 *
 * Deduplication (FR-18) is handled by the caller (read.js), which
 * knows the image hash. This module does not dedupe.
 */

import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const HEADER = "timestamp,input,ohms,formatted\n";

/**
 * Ensure the ledger file exists with a header row.
 * Idempotent — safe to call before every append.
 */
async function ensureLedger(csvPath) {
  await mkdir(dirname(csvPath), { recursive: true });
  try {
    await readFile(csvPath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      await writeFile(csvPath, HEADER, "utf8");
    } else {
      throw err;
    }
  }
}

/**
 * Escape a CSV field per RFC 4180.
 * We wrap in quotes if the value contains a comma, quote, CR, or LF.
 */
function csvField(value) {
  const s = String(value ?? "");
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Append one reading.
 *
 * @param {string} csvPath
 * @param {{ timestamp: string, input: string, ohms: number, formatted: string }} record
 * @returns {Promise<{ rowCount: number }>} the new total data-row count
 */
export async function appendReading(csvPath, record) {
  await ensureLedger(csvPath);
  const row = [
    csvField(record.timestamp),
    csvField(record.input),
    csvField(record.ohms),
    csvField(record.formatted),
  ].join(",");
  await appendFile(csvPath, row + "\n", "utf8");
  const count = await rowCount(csvPath);
  return { rowCount: count };
}

/**
 * Read all data rows (excludes header).
 *
 * @param {string} csvPath
 * @returns {Promise<Array<{ timestamp, input, ohms, formatted }>>}
 */
export async function readAll(csvPath) {
  let text;
  try {
    text = await readFile(csvPath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length <= 1) return [];
  const data = lines.slice(1);
  return data.map(parseCsvRow);
}

/**
 * Minimal CSV row parser. Handles quoted fields with embedded commas
 * and escaped quotes. Good enough for our own output; symmetric with
 * csvField above.
 */
function parseCsvRow(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        fields.push(cur);
        cur = "";
      } else cur += ch;
    }
  }
  fields.push(cur);
  const [timestamp = "", input = "", ohms = "", formatted = ""] = fields;
  return { timestamp, input, ohms, formatted };
}

/**
 * Count data rows (excludes header).
 */
export async function rowCount(csvPath) {
  const rows = await readAll(csvPath);
  return rows.length;
}

/**
 * Reset the ledger to just its header row (FR-19).
 */
export async function clearLedger(csvPath) {
  await mkdir(dirname(csvPath), { recursive: true });
  await writeFile(csvPath, HEADER, "utf8");
}