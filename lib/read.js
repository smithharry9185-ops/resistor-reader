/**
 * Orchestrates OCR -> parse -> describe for one image.
 *
 * Returns a result object rather than throwing, so callers (CLI,
 * HTTP server) can render the right error message (FR-9, FR-10).
 *
 * Reasons:
 *   "no_text"   -> OCR ran successfully but found no text blocks
 *   "no_parse"  -> OCR returned text but the parser rejected every line
 *   "ocr_error" -> the OCR engine itself threw (bad path, SDK error)
 */

import { extractText } from "./ocr.js";
import { parseResistance, formatOhms, sanitize } from "./parse.js";
import { describe } from "./describe.js";

export async function readImage(imagePath) {
  const startedAt = Date.now();

  let rawOcr = "";
  try {
    rawOcr = await extractText(imagePath);
  } catch (err) {
    console.error("[read.js] extractText threw:", err);
    return {
      ok: false,
      reason: "ocr_error",
      error: err?.message ?? String(err),
      rawOcr: "",
      elapsed: elapsedSince(startedAt),
    };
  }

  if (!rawOcr || rawOcr.trim().length === 0) {
    return {
      ok: false,
      reason: "no_text",
      rawOcr: "",
      elapsed: elapsedSince(startedAt),
    };
  }

  const lines = rawOcr.split(/\r?\n/);
  for (const line of lines) {
    const cleaned = sanitize(line);
    if (!cleaned) continue;
    const parsed = parseResistance(cleaned);
    if (parsed) {
      const formatted = formatOhms(parsed.ohms);
      const details = describe(parsed.ohms);
      return {
        ok: true,
        input: parsed.input,
        ohms: parsed.ohms,
        formatted,
        rawOcr,
        elapsed: elapsedSince(startedAt),
        details,
      };
    }
  }

  return {
    ok: false,
    reason: "no_parse",
    rawOcr,
    elapsed: elapsedSince(startedAt),
  };
}

function elapsedSince(startedAt) {
  return Number(((Date.now() - startedAt) / 1000).toFixed(1));
}