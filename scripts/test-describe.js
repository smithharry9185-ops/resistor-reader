/**
 * Tests for lib/describe.js — validates the derived enrichment fields
 * for a few well-known resistor values.
 *
 * Run: node scripts/test-describe.js
 */

import { describe } from "../lib/describe.js";

let passed = 0;
let failed = 0;

function check(cond, msg) {
  if (cond) passed++;
  else { failed++; console.error("  ✗ " + msg); }
}

function eq(actual, expected, label) {
  check(actual === expected, `${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

console.log("ResistorReader — describe() tests\n");

// 100 kΩ
{
  const d = describe(100_000);
  eq(d.value.ohms, 100_000, "100k .value.ohms");
  eq(d.value.kiloOhms, 100, "100k .value.kiloOhms");
  eq(d.value.formatted, "100 kΩ", "100k .value.formatted");
  eq(d.identification.notation, "suffix", "100k .notation");
  eq(d.colorBands.fourBand.join(","), "brown,black,yellow,gold", "100k 4-band");
  eq(d.colorBands.fiveBand.join(","), "brown,black,black,orange,brown", "100k 5-band");
  eq(d.eSeries.series, "E24", "100k in E24");
  eq(d.eSeries.isPreferred, true, "100k is preferred");
  eq(d.context.category, "high value", "100k category");
}

// 4.7 kΩ
{
  const d = describe(4_700);
  eq(d.value.formatted, "4.7 kΩ", "4k7 .value.formatted");
  eq(d.colorBands.fourBand.join(","), "yellow,violet,red,gold", "4k7 4-band");
  eq(d.eSeries.series, "E24", "4k7 in E24");
}

// 470 Ω
{
  const d = describe(470);
  eq(d.value.formatted, "470 Ω", "470 .value.formatted");
  eq(d.colorBands.fourBand.join(","), "yellow,violet,brown,gold", "470 4-band");
  eq(d.context.category, "low-value", "470 category");
}

// 10 MΩ
{
  const d = describe(10_000_000);
  eq(d.value.formatted, "10 MΩ", "10M .value.formatted");
  eq(d.eSeries.series, "E24", "10M in E24");
  eq(d.context.category, "very high value", "10M category");
}

// 0.47 Ω
{
  const d = describe(0.47);
  eq(d.value.formatted, "0.47 Ω", "R47 .value.formatted");
  eq(d.identification.valueKind, "sub-ohm", "R47 sub-ohm");
  eq(d.context.category, "current sense / shunt", "R47 category");
}

// 2.2 MΩ
{
  const d = describe(2_200_000);
  eq(d.value.formatted, "2.2 MΩ", "2M2 .value.formatted");
  eq(d.eSeries.isPreferred, true, "2M2 is preferred (22 in E24)");
}

// Scientific notation sanity
{
  const d = describe(100_000);
  check(typeof d.value.scientific === "string" && d.value.scientific.length > 0, "scientific non-empty");
  check(d.value.scientific.includes("10"), "scientific contains 10");
}

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);