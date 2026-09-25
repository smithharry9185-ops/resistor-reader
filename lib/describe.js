/**
 * Enrich a parsed resistance value with derived, human-useful facts.
 *
 * Everything here is DERIVED from the numeric value — none of it is
 * read from the image. That distinction matters: if a user uploads a
 * label that says "100K", we know the value; we do NOT know the
 * physical resistor's color bands, power rating, or tolerance.
 *
 * The colorBands field is explicitly labeled "derived" in the payload
 * so the client can render it as a hint, not a measurement.
 */

/**
 * E24 series (5% tolerance) — the most common preferred values.
 * Values are the significand (10 .. 91), repeated across decades.
 */
const E24 = [
  10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51,
  56, 62, 68, 75, 82, 91,
];

/** E12 series (10%) — a subset of E24. */
const E12 = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82];

/**
 * Standard color codes for resistor bands.
 * Index 0 = black, 1 = brown, ... 9 = white.
 */
const COLOR_NAMES = [
  "black", "brown", "red", "orange", "yellow",
  "green", "blue", "violet", "gray", "white",
];

/**
 * Build the full descriptive payload for a resistance value.
 *
 * @param {number} ohms
 * @returns {object}
 */
export function describe(ohms) {
  return {
    value: describeValue(ohms),
    identification: describeIdentification(ohms),
    colorBands: describeColorBands(ohms),
    eSeries: describeESeries(ohms),
    context: describeContext(ohms),
  };
}

/* ---------- value ---------- */

function describeValue(ohms) {
  return {
    ohms,
    kiloOhms: trim(ohms / 1e3),
    megaOhms: trim(ohms / 1e6),
    formatted: formatForValue(ohms),
    scientific: toScientific(ohms),
  };
}

function formatForValue(ohms) {
  if (ohms >= 1e9) return trim(ohms / 1e9) + " GΩ";
  if (ohms >= 1e6) return trim(ohms / 1e6) + " MΩ";
  if (ohms >= 1e3) return trim(ohms / 1e3) + " kΩ";
  return trim(ohms) + " Ω";
}

function toScientific(ohms) {
  if (ohms === 0) return "0 Ω";
  const exp = Math.floor(Math.log10(ohms));
  const mantissa = ohms / Math.pow(10, exp);
  const expStr = String(exp)
    .replace(/-/g, "⁻")
    .replace(/0/g, "⁰").replace(/1/g, "¹").replace(/2/g, "²")
    .replace(/3/g, "³").replace(/4/g, "⁴").replace(/5/g, "⁵")
    .replace(/6/g, "⁶").replace(/7/g, "⁷").replace(/8/g, "⁸")
    .replace(/9/g, "⁹");
  return `${trim(mantissa)} × 10${expStr} Ω`;
}

/* ---------- identification ---------- */

function describeIdentification(ohms) {
  // We can't see the resistor, so we describe what the value implies.
  let notation = "plain number";
  let multiplier = "none";
  if (ohms >= 1e9) { notation = "suffix"; multiplier = "G (×1 000 000 000)"; }
  else if (ohms >= 1e6) { notation = "suffix"; multiplier = "M (×1 000 000)"; }
  else if (ohms >= 1e3) { notation = "suffix"; multiplier = "K (×1 000)"; }
  else if (ohms < 1) { notation = "R-notation"; multiplier = "R acts as decimal point"; }
  else { notation = "plain"; multiplier = "none"; }

  return {
    valueKind: ohms < 1 ? "sub-ohm" : ohms >= 1e6 ? "high value" : "standard",
    notation,
    multiplierApplied: multiplier,
  };
}

/* ---------- color bands (derived, not observed) ---------- */

function describeColorBands(ohms) {
  // Decompose ohms into significand + exponent for band computation.
  // Two decompositions are needed:
  //   4-band: 2 significant digits  AB × 10^C
  //   5-band: 3 significant digits  ABC × 10^D
  //
  // Example: 100 kΩ = 100000 Ω
  //   4-band: 10  × 10^4  -> brown, black, yellow, gold
  //   5-band: 100 × 10^3  -> brown, black, black, orange, brown
  if (!isFinite(ohms) || ohms <= 0) return null;

  // --- 4-band decomposition (2 sig figs) ---
  // Normalize so significand sits in 10..99.
  const exp4 = Math.floor(Math.log10(ohms)) - 1;
  let sig4 = Math.round(ohms / Math.pow(10, exp4));
  let e4 = exp4;
  if (sig4 >= 100) { sig4 = Math.round(sig4 / 10); e4 += 1; }
  if (sig4 < 10)   { sig4 = Math.round(sig4 * 10); e4 -= 1; }

  const d1 = Math.floor(sig4 / 10);
  const d2 = sig4 % 10;
  if (d1 < 0 || d1 > 9 || d2 < 0 || d2 > 9) return null;
  if (e4 < 0 || e4 > 9) return null;

  // --- 5-band decomposition (3 sig figs) ---
  // Normalize so significand sits in 100..999.
  const exp5 = Math.floor(Math.log10(ohms)) - 2;
  let sig5 = Math.round(ohms / Math.pow(10, exp5));
  let e5 = exp5;
  if (sig5 >= 1000) { sig5 = Math.round(sig5 / 10); e5 += 1; }
  if (sig5 < 100)   { sig5 = Math.round(sig5 * 10); e5 -= 1; }

  const t1 = Math.floor(sig5 / 100);
  const t2 = Math.floor((sig5 % 100) / 10);
  const t3 = sig5 % 10;
  if (t1 < 0 || t1 > 9 || t2 < 0 || t2 > 9 || t3 < 0 || t3 > 9) return null;
  if (e5 < 0 || e5 > 9) return null;

  return {
    derived: true,
    note: "Computed from the numeric value; NOT read from the image.",
    fourBand: [
      COLOR_NAMES[d1],
      COLOR_NAMES[d2],
      COLOR_NAMES[e4],
      "gold",  // ±5%
    ],
    fiveBand: [
      COLOR_NAMES[t1],
      COLOR_NAMES[t2],
      COLOR_NAMES[t3],
      COLOR_NAMES[e5],
      "brown",  // ±1%
    ],
  };
}

/* ---------- E-series ---------- */

function describeESeries(ohms) {
  const { exponent, significand } = decompose(ohms);
  const candidates = [
    { name: "E24", values: E24 },
    { name: "E12", values: E12 },
  ];

  let match = null;
  for (const { name, values } of candidates) {
    if (values.includes(significand)) {
      match = { series: name, position: significand, isPreferred: true };
      break;
    }
  }

  const isPreferred = !!match;
  const series = match?.series ?? nearestESeries(significand);
  const nearest = nearestValues(significand, exponent);

  return {
    series,
    isPreferred,
    position: significand,
    nearest,
  };
}

function nearestESeries(sig) {
  // Find which series this sig would belong to if it were exact.
  for (const s of E24) if (s === sig) return "E24";
  for (const s of E12) if (s === sig) return "E12";
  return "custom (not in E24 or E12)";
}

function nearestValues(sig, exponent) {
  // E24 wraps every decade: after 91 comes 10 (of the next decade).
  // We find the strictly-lower and strictly-higher neighbors,
  // wrapping to adjacent decades when sig is at either end.
  //
  // Example: sig=10, exponent=4 (100 kΩ)
  //   below = 91 of the PREVIOUS decade  -> 91 × 10^3 = 91 kΩ
  //   above = 11 of the SAME decade      -> 11 × 10^4 = 110 kΩ
  const sorted = [...E24].sort((a, b) => a - b);

  let below = [...sorted].reverse().find((v) => v < sig);
  let belowScale = Math.pow(10, exponent);

  let above = sorted.find((v) => v > sig);
  let aboveScale = Math.pow(10, exponent);

  // Wrap: sig is at or below the smallest E24 value → below lives
  // in the previous decade, scaled down by 10.
  if (below === undefined) {
    below = sorted[sorted.length - 1];  // 91
    belowScale = Math.pow(10, exponent - 1);
  }

  // Wrap: sig is at or above the largest E24 value → above lives
  // in the next decade, scaled up by 10.
  if (above === undefined) {
    above = sorted[0];  // 10
    aboveScale = Math.pow(10, exponent + 1);
  }

  return [
    { ohms: below * belowScale, formatted: formatForValue(below * belowScale) },
    { ohms: above * aboveScale, formatted: formatForValue(above * aboveScale) },
  ];
}

function decompose(ohms) {
  const exponent = Math.floor(Math.log10(ohms)) - 1;
  const significand = Math.round(ohms / Math.pow(10, exponent));
  return { exponent, significand };
}

/* ---------- context ---------- */

function describeContext(ohms) {
  if (ohms < 10) {
    return {
      category: "current sense / shunt",
      commonUse: "Current sensing, precision low-value circuits",
      powerRatings: ["0.5 W", "1 W", "2 W", "5 W"],
      typicalApplications: ["Current shunt", "Precision dividers"],
    };
  }
  if (ohms < 1e3) {
    return {
      category: "low-value",
      commonUse: "LED current limiting, low-side switching",
      powerRatings: ["0.125 W", "0.25 W", "0.5 W"],
      typicalApplications: ["LED current limiting", "Base resistor for transistors"],
    };
  }
  if (ohms < 1e5) {
    return {
      category: "general purpose",
      commonUse: "Pull-ups, dividers, current limiting",
      powerRatings: ["0.125 W", "0.25 W", "0.5 W", "1 W"],
      typicalApplications: [
        "Logic-level pull-ups",
        "Voltage dividers",
        "LED current limiting",
        "Base resistor for transistors",
      ],
    };
  }
  if (ohms < 1e7) {
    return {
      category: "high value",
      commonUse: "High-impedance dividers, bleeder resistors, feedback networks",
      powerRatings: ["0.125 W", "0.25 W", "0.5 W"],
      typicalApplications: [
        "Feedback networks in op-amps",
        "Bleeder resistors",
        "High-impedance voltage dividers",
      ],
    };
  }
  return {
    category: "very high value",
    commonUse: "Very high impedance circuits, ESD bleed paths",
    powerRatings: ["0.125 W", "0.25 W"],
    typicalApplications: ["ESD bleed", "Very high impedance networks"],
  };
}

/* ---------- helpers ---------- */

function trim(n) {
  return parseFloat(n.toFixed(4));
}