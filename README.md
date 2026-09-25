# ResistorReader

Read a resistor's printed value from a photo — entirely on-device.

Built by **Harry Smith** with [Tether's QVAC SDK](https://github.com/tetherto/qvac).

## What it does

Point ResistorReader at a photo of a resistor's printed value (`4K7`, `100K`, `470R`, `2M2`) and it returns the resistance in ohms, plus derived color bands, E-series position, and application context. All OCR runs on your machine — no cloud, no API keys, no telemetry.

## Install

```bash
git clone https://github.com/smithharry9185-ops/resistor-reader.git
cd resistor-reader
npm install
```

Uses **`@qvac/sdk@0.19.1`** — the only runtime dependency.

## Run

### Web UI

```bash
node server.js
```

Open **http://127.0.0.1:3000**.

First run downloads ~100 MB of models into `~/.qvac/models/`. After that it works fully offline.

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

IDENTIFICATION
  Kind:        standard
  Notation:    suffix
  Multiplier:  K (×1 000)

COLOR BANDS (derived)
  4-band:      brown – black – yellow – gold
  5-band:      brown – black – black – orange – brown

E-SERIES
  Series:      E24
  Preferred:   yes
  Neighbors:   91 kΩ, 110 kΩ

CONTEXT
  Category:    high value
  Applications: Feedback networks, bleeder resistors, voltage dividers

Appended to readings.csv (1 row total, +1)
```

## QVAC functions used

`loadModel` · `ocr` · `unloadModel`

The SDK is called in exactly one place — `lib/ocr.js`:

```js
import { loadModel, unloadModel, ocr, OCR_LATIN, MODEL_TYPES } from "@qvac/sdk";

export async function extractText(imagePath) {
  const modelId = await loadModel({
    modelSrc: OCR_LATIN.src,
    modelType: MODEL_TYPES.ggmlOcr,
  });
  try {
    const { blocks } = ocr({ modelId, image: imagePath });
    const detected = await blocks;
    return detected.map((b) => b.text?.trim()).filter(Boolean).join("\n");
  } finally {
    await unloadModel({ modelId }).catch(() => {});
  }
}
```

## What it can read

- Printed values on labels, packaging, reels, datasheets
- Formats: `100`, `100K`, `100R`, `100Ω`, `1M`, `1G`, `4K7`, `4.7K`, `2M2`, `0R1`, `R47`, `4700`, `4700000`
- Tolerance suffixes (`J`, `F`) are stripped and ignored

## What it can't read

- Color bands on through-hole resistors (v2)
- SMD 3- or 4-digit codes like `104` (v2)
- Handwritten or rotated text
- Multiple resistors in one image

Through-hole resistors have **color bands, not printed values**. For those, photograph the label, bag, or datasheet — not the resistor itself.

## Privacy

- No cloud inference, no API keys, no telemetry
- Uploaded images are written to `.tmp/` and deleted after processing
- Zero network requests after the first-run model download

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/process` | Multipart image → JSON result |
| GET | `/api/readings` | All rows of `readings.csv` |
| POST | `/api/clear` | Reset the ledger |

## Tests

```bash
npm test
```

- `scripts/test-parse.js` — 35 parser tests
- `scripts/test-describe.js` — 25 enrichment tests

## Project layout

```
resistor-reader/
├── app.js            CLI entry point
├── server.js         HTTP server (built-in http)
├── public/           Browser UI (vanilla HTML/CSS/JS)
├── lib/
│   ├── ocr.js        QVAC OCR wrapper
│   ├── parse.js      Value parser
│   ├── describe.js   Derived enrichment
│   ├── read.js       OCR + parse orchestration
│   └── ledger.js     CSV append
├── scripts/          Test suites
├── LICENSE           MIT
└── README.md
```

## License

MIT © 2026 Harry Smith.
