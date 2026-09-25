#!/usr/bin/env node
/**
 * ResistorReader — CLI entry point.
 *
 * Usage:
 *   node app.js <image-path>
 */

import { stat } from "node:fs/promises";
import { readImage } from "./lib/read.js";
import { appendReading } from "./lib/ledger.js";

const CSV_PATH = "readings.csv";

async function main() {
  const arg = process.argv[2];
  if (!arg || arg === "-h" || arg === "--help") {
    console.error("Usage: node app.js <image-path>");
    process.exit(arg ? 0 : 2);
  }

  const imagePath = arg;

  try {
    await stat(imagePath);
  } catch {
    console.error(`✗ Not a readable file: ${imagePath}`);
    process.exit(2);
  }

  console.log("Loading OCR model on-device...");
  const result = await readImage(imagePath);

  if (!result.ok) {
    if (result.reason === "no_text") {
      console.error("✗ No text found. Is the label sharp and legible?");
    } else if (result.reason === "ocr_error") {
      console.error(`✗ OCR engine error: ${result.error}`);
    } else {
      console.error(
        `✗ OCR read ${JSON.stringify(result.rawOcr)} but couldn't parse it as a resistor value.`
      );
    }
    process.exit(1);
  }

  console.log("OCR complete.");
  console.log(`Raw text: ${JSON.stringify(result.rawOcr)}`);
  console.log();
  console.log("═".repeat(60));
  console.log(`  ${result.formatted}   (${result.ohms} Ω)`);
  console.log("═".repeat(60));
  console.log();

  const d = result.details;

  console.log("VALUE");
  console.log(`  Formatted:   ${d.value.formatted}`);
  console.log(`  Ohms:        ${d.value.ohms}`);
  console.log(`  kΩ:          ${d.value.kiloOhms}`);
  console.log(`  MΩ:          ${d.value.megaOhms}`);
  console.log(`  Scientific:  ${d.value.scientific}`);
  console.log();

  console.log("IDENTIFICATION");
  console.log(`  Kind:        ${d.identification.valueKind}`);
  console.log(`  Notation:    ${d.identification.notation}`);
  console.log(`  Multiplier:  ${d.identification.multiplierApplied}`);
  console.log();

  if (d.colorBands) {
    console.log("COLOR BANDS (derived — not read from the image)");
    console.log(`  4-band:      ${d.colorBands.fourBand.join(" – ")}`);
    console.log(`  5-band:      ${d.colorBands.fiveBand.join(" – ")}`);
    console.log();
  }

  console.log("E-SERIES");
  console.log(`  Series:      ${d.eSeries.series}`);
  console.log(`  Preferred:   ${d.eSeries.isPreferred ? "yes" : "no"}`);
  if (d.eSeries.nearest && d.eSeries.nearest.length) {
    console.log(`  Neighbors:   ${d.eSeries.nearest.map((n) => n.formatted).join(", ")}`);
  }
  console.log();

  console.log("CONTEXT");
  console.log(`  Category:    ${d.context.category}`);
  console.log(`  Common use:  ${d.context.commonUse}`);
  console.log(`  Power:       ${d.context.powerRatings.join(", ")}`);
  console.log(`  Applications:`);
  for (const a of d.context.typicalApplications) console.log(`    • ${a}`);
  console.log();

  const { rowCount: total } = await appendReading(CSV_PATH, {
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    input: result.input,
    ohms: result.ohms,
    formatted: result.formatted,
  });

  console.log(`Appended to readings.csv (${total} row total, +1)`);
}

main().catch((err) => {
  console.error("✗ Unexpected error:", err);
  process.exit(3);
});