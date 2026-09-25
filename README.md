# ResistorReader

Read a resistor's printed value from a photo — entirely on-device.

Built by **Harry Smith** with [Tether's QVAC SDK](https://github.com/tetherto/qvac).

---

## What it does

ResistorReader takes a photo of a resistor's **printed value** (e.g. `4K7`, `100K`, `470R`, `2M2`) and returns the resistance in ohms, with rich derived context. All OCR runs on your machine — no cloud, no API keys, no telemetry.

- Reads printed labels on packaging, reels, datasheets, and product photos
- Runs OCR on-device via `@qvac/sdk` (`loadModel` + `ocr`)
- Parses 17 notation formats deterministically (regex, no LLM)
- Returns value, identification, derived color bands, E-series position, and application context
- Appends every reading to a local `readings.csv` ledger
- Ships a dark, drag-and-drop browser UI

---

## Privacy

Everything runs locally. The only network request the app ever makes is the one-time model download on first run (~100 MB). After that, it works fully offline.

| Property | Guarantee |
|---|---|
| Cloud inference | None — all OCR runs in-process via `@qvac/sdk` |
| API keys | None required |
| Telemetry / analytics | None sent anywhere |
| Uploaded images | Written to `.tmp/`, deleted immediately after processing |
| Network after first run | Zero |
| Model storage | `~/.qvac/models/`, ~100 MB |

Verify it yourself: open DevTools → Network tab, process an image, and confirm no requests leave `localhost`.

---

## Scope: what it can and can't read

### Can read

- Printed values on **labels, packaging, reels, and datasheets**
- All common notation formats:

| Format | Example | Meaning |
|---|---|---|
| Suffix | `100K` | 100 kΩ |
| Suffix (lowercase) | `4k7` | 4.7 kΩ |
| Decimal + suffix | `4.7K` | 4.7 kΩ |
| R-notation (mid-letter) | `4K7` | 4.7 kΩ |
| R-notation (M) | `2M2` | 2.2 MΩ |
| R-notation (leading) | `R47` | 0.47 Ω |
| Sub-ohm | `0R1` | 0.1 Ω |
| Ohm marker | `100R`, `100Ω` | 100 Ω |
| Plain number | `4700` | 4.7 kΩ |
| Plain number (large) | `4700000` | 4.7 MΩ |
| Tolerance suffix (ignored) | `4K7J` | 4.7 kΩ |

### Cannot read

- Color bands on through-hole resistor bodies (planned for v2)
- SMD 3- or 4-digit codes like `104` or `1003` (planned for v2)
- Handwritten values
- Rotated text (planned for v2)
- Multi-resistor scenes — crop to one label

**Important:** through-hole resistors almost never have printed values on their body — they have color bands. For those, photograph the **label, bag, or datasheet**, not the resistor itself.

---

## Requirements

- **Node.js** ≥ 22.17 (uses modern ESM and `fs/promises`)
- ~250 MB free disk space for models and node_modules
- A working internet connection for the first run only (model download)
- Windows, macOS, or Linux

---

## Install

```bash
git clone https://github.com/smithharry9185-ops/resistor-reader.git
cd resistor-reader
npm install
```

`npm install` pulls the single runtime dependency: **`@qvac/sdk@0.19.1`**.

There is no build step. The client is served as-is from `public/`.

---

## Run

### Web UI

```bash
node server.js
```

Then open **http://127.0.0.1:3000** in your browser.

The **first run** downloads two model files into `~/.qvac/models/`:

- `latin_g2.gguf` (~15 MB) — EasyOCR Latin recognizer
- `craft_mlt_25k.gguf` (~83 MB) — CRAFT text detector (loaded internally by the SDK)

After the download, everything is offline.

### CLI

```bash
node app.js path/to/resistor.png
```

Example output:

```
Loading OCR model on-device...
OCR complete.
Raw text: "1OOK"

════════════════════════════════════════════════════════════
  100 kΩ   (100000 Ω)
════════════════════════════════════════════════════════════

VALUE
  Formatted:   100 kΩ
  Ohms:        100000
  kΩ:          100
  MΩ:          0.1
  Scientific:  1 × 10⁵ Ω

IDENTIFICATION
  Kind:        standard
  Notation:    suffix
  Multiplier:  K (×1 000)

COLOR BANDS (derived — not read from the image)
  4-band:      brown – black – yellow – gold
  5-band:      brown – black – black – orange – brown

E-SERIES
  Series:      E24
  Preferred:   yes
  Neighbors:   91 kΩ, 110 kΩ

CONTEXT
  Category:    high value
  Common use:  High-impedance dividers, bleeder resistors, feedback networks
  Power:       0.125 W, 0.25 W, 0.5 W
  Applications:
    • Feedback networks in op-amps
    • Bleeder resistors
    • High-impedance voltage dividers

Appended to readings.csv (1 row total, +1)
```

Exit codes:

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | OCR or parse failure |
| 2 | Bad usage / missing file |
| 3 | Unexpected error |

---

## API

The local server exposes three endpoints on `http://127.0.0.1:3000`.

### POST /api/process

Multipart form-data. Field name: `image`. Accepts PNG, JPG, or WEBP up to 25 MB.

Success response (200):

```json
{
  "ok": true,
  "input": "100K",
  "ohms": 100000,
  "formatted": "100 kΩ",
  "rawOcr": "1OOK",
  "elapsed": "35.2",
  "details": {
    "value": {
      "ohms": 100000,
      "kiloOhms": 100,
      "megaOhms": 0.1,
      "formatted": "100 kΩ",
      "scientific": "1 × 10⁵ Ω"
    },
    "identification": {
      "valueKind": "standard",
      "notation": "suffix",
      "multiplierApplied": "K (×1 000)"
    },
    "colorBands": {
      "derived": true,
      "note": "Computed from the numeric value; NOT read from the image.",
      "fourBand": ["brown", "black", "yellow", "gold"],
      "fiveBand": ["brown", "black", "black", "orange", "brown"]
    },
    "eSeries": {
      "series": "E24",
      "isPreferred": true,
      "position": 10,
      "nearest": [
        { "ohms": 91000, "formatted": "91 kΩ" },
        { "ohms": 110000, "formatted": "110 kΩ" }
      ]
    },
    "context": {
      "category": "high value",
      "commonUse": "High-impedance dividers, bleeder resistors, feedback networks",
      "powerRatings": ["0.125 W", "0.25 W", "0.5 W"],
      "typicalApplications": [
        "Feedback networks in op-amps",
        "Bleeder resistors",
        "High-impedance voltage dividers"
      ]
    }
  }
}
```

Error responses:

| Status | Body | When |
|---|---|---|
| 400 | `{"error": "No image field in request."}` | Missing `image` field |
| 413 | `{"error": "Upload too large (max 25 MB)"}` | File > 25 MB |
| 422 | `{"error": "No text found. Is the label sharp and legible?"}` | OCR returned no text |
| 422 | `{"error": "OCR read '...' but couldn't parse it as a resistor value."}` | Text found but unparseable |
| 500 | `{"error": "..."}` | Unexpected |

Identical uploads (same SHA-256) within 10 seconds return the cached result with `"deduplicated": true` — OCR is not re-run.

### GET /api/readings

Returns all rows of `readings.csv` as JSON:

```json
{
  "rows": [
    {
      "timestamp": "2026-09-25T09:59:29Z",
      "input": "100K",
      "ohms": "100000",
      "formatted": "100 kΩ"
    }
  ]
}
```

### POST /api/clear

Resets `readings.csv` to just its header row.

```json
{ "ok": true }
```

---

## How it works

```
photo → QVAC OCR → sanitize (O→0, l→1) → regex parser → describe()
        ↓                                        ↓
      raw text                               100000 Ω
                                                  ↓
                                         "100 kΩ" + enriched details
                                                  ↓
                                            readings.csv
```

### QVAC SDK call

The SDK is used in exactly one place: `lib/ocr.js`.

```js
import {
  loadModel,
  unloadModel,
  ocr,
  OCR_LATIN,
  MODEL_TYPES,
} from "@qvac/sdk";

export async function extractText(imagePath) {
  const modelId = await loadModel({
    modelSrc: OCR_LATIN.src,
    modelType: MODEL_TYPES.ggmlOcr,
  });

  try {
    const { blocks } = ocr({ modelId, image: imagePath });
    const detected = await blocks;
    return detected
      .map((b) => (b && typeof b.text === "string" ? b.text.trim() : ""))
      .filter(Boolean)
      .join("\n");
  } finally {
    await unloadModel({ modelId }).catch(() => {});
  }
}
```

Functions used: **`loadModel`, `ocr`, `unloadModel`**.

### Modules

| Module | Responsibility |
|---|---|
| `lib/ocr.js` | The only file that touches `@qvac/sdk`. Loads the model, runs OCR, unloads. |
| `lib/parse.js` | Deterministic regex grammar. 17 notations, OCR sanitization, tolerance-letter stripping. |
| `lib/describe.js` | Derives color bands, E-series neighbors, and application context from the numeric value. |
| `lib/read.js` | Orchestration: OCR → sanitize → parse each line → first success wins. |
| `lib/ledger.js` | Appends rows to `readings.csv` (RFC 4180, UTF-8). |
| `server.js` | Hand-rolled HTTP server (built-in `http` module). Serves `public/`, exposes the three API routes, dedupes uploads by SHA-256. |
| `app.js` | CLI entry point. |

### Why no LLM in the main path

The resistor value grammar is small and fixed. A regex parser is faster, deterministic, and requires no second model download. An LLM would add cost, latency, and nondeterminism without solving the actual problem.

---

## Project layout

```
resistor-reader/
├── app.js                    CLI entry point
├── server.js                 HTTP server (built-in http, no framework)
├── package.json              Single dependency: @qvac/sdk
├── public/
│   ├── index.html            Web client markup
│   ├── styles.css            Dark instrument-panel theme
│   └── app.js                Client logic (vanilla JS, no build)
├── lib/
│   ├── ocr.js                QVAC OCR wrapper
│   ├── parse.js              Resistor value parser
│   ├── describe.js           Derived enrichment (bands, E-series, context)
│   ├── read.js               OCR + parse orchestration
│   └── ledger.js             CSV append + row count
├── scripts/
│   ├── test-parse.js         Parser tests (35 cases)
│   └── test-describe.js      Enrichment tests (25 cases)
├── samples/                  Test images (gitignored)
├── readings.csv              Local ledger (gitignored)
├── LICENSE                   MIT
└── README.md
```

---

## Tests

```bash
npm test
```

Runs both suites:

- `scripts/test-parse.js` — 35 tests covering all 17 grammar formats, OCR noise (`4O7` → 407, `1OOK` → 100K), tolerance stripping, rejections, and formatting edge cases.
- `scripts/test-describe.js` — 25 tests covering color-band decomposition (4-band and 5-band for `100 kΩ`), E-series recognition, and context categorization.

Expected result:

```
ResistorReader — parser tests
...
35 passed, 0 failed.
ResistorReader — describe() tests
...
25 passed, 0 failed.
```

---

## Notes

### Reading readings.csv in Excel on Windows

PowerShell's `Get-Content` defaults to Windows-1252 and will display `kΩ` as `kÎ©`. The file itself is correct UTF-8. To read it properly:

```powershell
Get-Content readings.csv -Encoding UTF8
```

Or open it in VS Code or Notepad — both default to UTF-8.

### Derived vs. observed

The `colorBands` field is computed from the numeric value, not read from the photo. It is labeled `"derived": true` in the API payload for that reason. Treat it as a hint about what bands a resistor of that value would have — not a reading of the physical part.

### First-run timing

The first `node app.js` or `node server.js` invocation downloads ~100 MB of model files. Expect 30–90 seconds on a typical connection. Subsequent runs are near-instant for model loading, with OCR taking ~25–35 seconds per image on CPU-only hardware (dominated by CRAFT detection).

### Windows absolute paths

The QVAC SDK's file reader works reliably with relative paths. The CLI passes the path exactly as typed. If you need an absolute path, run from a shell where the current working directory contains the file.

---

## License

MIT © 2026 Harry Smith — see [LICENSE](./LICENSE).

Built with [@qvac/sdk](https://www.npmjs.com/package/@qvac/sdk) by [Tether](https://github.com/tetherto/qvac). If the SDK was useful to you, consider starring the repo.
