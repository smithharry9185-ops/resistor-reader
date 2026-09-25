/**
 * Parser unit test — PRD §9.2 (17 formats) + §13 M0 success criterion.
 *
 * Run: npm test    (or: node scripts/test-parse.js)
 * Exits 0 on all-pass, 1 on any failure.
 */

import { parseLine, formatOhms } from "../lib/parse.js";

// The 17 canonical formats from PRD §9.2.
const CASES = [
  { input: "100",       ohms: 100,       label: "100 Ω" },
  { input: "100R",      ohms: 100,       label: "100 Ω" },
  { input: "100Ω",      ohms: 100,       label: "100 Ω" },
  { input: "1K",        ohms: 1_000,     label: "1 kΩ" },
  { input: "1k",        ohms: 1_000,     label: "1 kΩ" },
  { input: "1M",        ohms: 1_000_000, label: "1 MΩ" },
  { input: "1G",        ohms: 1e9,       label: "1 GΩ" },
  { input: "4K7",       ohms: 4_700,     label: "4.7 kΩ" },
  { input: "4.7K",      ohms: 4_700,     label: "4.7 kΩ" },
  { input: "4.7k",      ohms: 4_700,     label: "4.7 kΩ" },
  { input: "2M2",       ohms: 2_200_000, label: "2.2 MΩ" },
  { input: "0R1",       ohms: 0.1,       label: "0.1 Ω" },
  { input: "R47",       ohms: 0.47,      label: "0.47 Ω" },
  { input: "2.2M",      ohms: 2_200_000, label: "2.2 MΩ" },
  { input: "10K",       ohms: 10_000,    label: "10 kΩ" },
  { input: "4700",      ohms: 4_700,     label: "4.7 kΩ" },
  { input: "4700000",   ohms: 4_700_000, label: "4.7 MΩ" },
];

// Extra cases: OCR sanitization (§9.3) + tolerance stripping (§16).
const EXTRA = [
  // OCR sanitization — O->0 between digits, l->1 between digits
  { input: "4O7",   ohms: 407,   label: "407 Ω" },
  { input: "4l7",   ohms: 417,   label: "417 Ω" },
  // Whitespace inside a label is stripped before parsing
  { input: "4 K 7", ohms: 4_700, label: "4.7 kΩ" },
  // Tolerance letter stripped — J and F only (not K/M/G)
  { input: "4K7J",  ohms: 4_700, label: "4.7 kΩ" },
  { input: "100RF", ohms: 100,   label: "100 Ω" },
  { input: "2M2F",  ohms: 2_200_000, label: "2.2 MΩ" },
];

// Inputs that must be rejected (return null).
const REJECT = ["", "hello", "K", "R", "4..7K", "Ω", "ABCD"];

let passed = 0;
let failed = 0;

function check(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error("  ✗ " + message);
  }
}

function runCases(title, cases) {
  console.log(title);
  for (const c of cases) {
    const got = parseLine(c.input);
    if (!got) {
      failed++;
      console.error(`  ✗ ${c.input} -> null (expected ${c.ohms})`);
      continue;
    }
    check(
      got.ohms === c.ohms && got.formatted === c.label,
      `${c.input} -> ${got.ohms} / "${got.formatted}" (expected ${c.ohms} / "${c.label}")`
    );
  }
}

console.log("ResistorReader — parser tests\n");

runCases("Parsing §9.2 formats:", CASES);
console.log("");
runCases("OCR noise + tolerance:", EXTRA);

console.log("\nRejections (must return null):");
for (const r of REJECT) {
  const got = parseLine(r);
  check(got === null, `${JSON.stringify(r)} -> ${JSON.stringify(got)} (expected null)`);
}

console.log("\nformatOhms edge cases:");
check(formatOhms(4_700) === "4.7 kΩ", "4700 -> 4.7 kΩ");
check(formatOhms(4_000) === "4 kΩ",   "4000 -> 4 kΩ (trailing .00 stripped)");
check(formatOhms(470) === "470 Ω",    "470 -> 470 Ω");
check(formatOhms(0.1) === "0.1 Ω",    "0.1 -> 0.1 Ω");
check(formatOhms(1e9) === "1 GΩ",     "1e9 -> 1 GΩ");

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);