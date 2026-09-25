/**
 * Resistor value parser.
 *
 * Pure JS, no model, no I/O. Deterministic. This is the reliability
 * core of ResistorReader — the PRD deliberately keeps an LLM out of
 * the main path (§6.2) because the value grammar is fixed.
 *
 * Handles (PRD §9.2):
 *   100, 100R, 100Ω, 1K, 1k, 1M, 1G,
 *   4K7, 4.7K, 4.7k, 2M2, 0R1, R47, 2.2M, 10K, 4700, 4700000
 *
 * Also strips and ignores a trailing tolerance letter (J or F),
 * per v1 scope decision — e.g. "4K7J" -> 4700.
 *
 * IMPORTANT: K, M, G are NOT treated as tolerance letters, because
 * they are also multiplier suffixes. "1K" is 1000 ohms, not "1 with
 * tolerance K". Only J and F are unambiguous tolerance codes.
 */

// Multipliers for suffix letters. Uppercased before lookup.
const SUFFIX_MULTIPLIERS = {
  R: 1,
  "Ω": 1,
  K: 1e3,
  M: 1e6,
  G: 1e9,
};

// Tolerance letters that may trail a value on a real label.
// Deliberately excludes K, M, G (they are multipliers, not tolerances).
const TOLERANCE_LETTERS = /[JF]$/;

/**
 * Sanitize one line of raw OCR text before parsing (PRD §9.3).
 * Applied per line so multi-line labels don't merge.
 *
 * @param {string} line
 * @returns {string} cleaned, uppercased, whitespace-free
 */
export function sanitize(line) {
  return String(line)
    // In resistor notation, "O" is never a valid letter — the only
    // suffix letters are R, K, M, G, Ω. OCR frequently misreads "0"
    // as "O" (e.g. "1OOK" for "100K"), so replace unconditionally.
    .replace(/O/g, "0")
    // l or I between digits is almost always a 1 (4l7 -> 417)
    .replace(/(\d)[Il](\d)/g, "$11$2")
    // Ohm symbol variants -> canonical
    .replace(/[ΩΩ]/g, "Ω")
    // Drop all whitespace (labels are often split across boxes)
    .replace(/\s+/g, "")
    .toUpperCase()
    .trim();
}

/**
 * Parse a sanitized resistor value string into ohms.
 *
 * @param {string} raw - one line (will be sanitized internally)
 * @returns {{ ohms: number, input: string } | null}
 */
export function parseResistance(raw) {
  let text = sanitize(raw);
  if (!text) return null;

  // Keep the sanitized string for the ledger / error messages.
  const input = text;

  // Strip a trailing tolerance letter (J or F) — v1 ignores tolerance.
  // Only strip if what remains still parses as a value on its own.
  if (TOLERANCE_LETTERS.test(text) && text.length > 1) {
    const withoutTolerance = text.slice(0, -1);
    if (decode(withoutTolerance) !== null) {
      text = withoutTolerance;
    }
  }

  const ohms = decode(text);
  if (ohms === null) return null;
  return { ohms, input };
}

/**
 * Core decoder. Returns ohms or null.
 * Kept separate so the tolerance-strip guard can use it as the
 * single source of truth for "is this a valid value?".
 */
function decode(text) {
  // Pattern A: letter-in-the-middle R-notation (4K7, 2M2, 0R1, R47)
  const rNotation = text.match(/^(\d*)([RΩKMG])(\d*)$/);
  if (rNotation) {
    const [, whole, letter, frac] = rNotation;
    if (whole === "" && frac === "") return null;
    const value = Number((whole || "0") + "." + (frac || "0"));
    return value * SUFFIX_MULTIPLIERS[letter];
  }

  // Pattern B: decimal + suffix (4.7K, 2.2M)
  const decimalSuffix = text.match(/^(\d+(?:\.\d+)?)([RΩKMG])$/);
  if (decimalSuffix) {
    const [, num, letter] = decimalSuffix;
    return Number(num) * SUFFIX_MULTIPLIERS[letter];
  }

  // Pattern C: plain number (100, 4700, 4700000)
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    return Number(text);
  }

  return null;
}

/**
 * Format ohms as a human-readable string (PRD §9.5).
 */
export function formatOhms(ohms) {
  if (ohms >= 1e9) return trimNum(ohms / 1e9) + " GΩ";
  if (ohms >= 1e6) return trimNum(ohms / 1e6) + " MΩ";
  if (ohms >= 1e3) return trimNum(ohms / 1e3) + " kΩ";
  return trimNum(ohms) + " Ω";
}

function trimNum(n) {
  return String(parseFloat(n.toFixed(4)));
}

/**
 * Convenience: raw OCR line -> full result record.
 * Returns null if unparseable (caller turns that into a 422).
 */
export function parseLine(rawLine) {
  const parsed = parseResistance(rawLine);
  if (!parsed) return null;
  return {
    input: parsed.input,
    ohms: parsed.ohms,
    formatted: formatOhms(parsed.ohms),
  };
}