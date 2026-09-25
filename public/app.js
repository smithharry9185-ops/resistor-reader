/**
 * ResistorReader — browser client
 * Author: Harry Smith
 *
 * Vanilla JS. No framework. No build. No external requests (NFR-5).
 * Talks only to the local server at the same origin.
 *
 *   pick/drop → preview → POST /api/process → render result
 *   → refresh history from GET /api/readings
 */

const $ = (id) => document.getElementById(id);

/* ── elements ─────────────────────────────────────────────── */
const dropzone      = $("dropzone");
const fileInput     = $("file-input");
const fileBadge     = $("file-badge");
const previewWrap   = $("preview-wrap");
const previewImg    = $("preview");
const previewName   = $("preview-name");
const removeBtn     = $("remove-btn");
const runBtn        = $("run-btn");

const statusDot     = $("status-dot");
const statusText    = $("status-text");
const logEl         = $("log");
const clearLogBtn   = $("clear-log-btn");

const resultEmpty   = $("result-empty");
const resultBody    = $("result-body");
const resultValue   = $("result-value");
const resultSub     = $("result-sub");
const resultOhms    = $("result-ohms");
const resultOcr     = $("result-ocr");
const resultElapsed = $("result-elapsed");
const resultDetails = $("result-details");
const copyBtn       = $("copy-btn");

const historyEmpty  = $("history-empty");
const historyWrap   = $("history-wrap");
const historyBody   = $("history-body");
const clearBtn      = $("clear-btn");

const toastEl       = $("toast");

/* ── state ────────────────────────────────────────────────── */
let selectedFile = null;
let lastValue = "";

/* ── toast ────────────────────────────────────────────────── */
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("visible"), 2000);
}

/* ── status + log ─────────────────────────────────────────── */
function setStatus(state, text) {
  statusDot.className = "status-dot " + state;
  statusText.textContent = text;
}
function log(line) {
  const t = new Date().toLocaleTimeString([], { hour12: false });
  logEl.textContent += `[${t}] ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

/* ── file selection ───────────────────────────────────────── */
function isImage(file) {
  return file && /^image\/(png|jpeg|webp)$/.test(file.type);
}

async function selectFile(file) {
  if (!isImage(file)) {
    log(`Rejected: not PNG/JPG/WEBP (got ${file?.type || "unknown"})`);
    setStatus("err", "Unsupported file");
    toast("Unsupported file type");
    return;
  }
  selectedFile = file;
  previewImg.src = URL.createObjectURL(file);
  previewName.textContent = `${file.name} · ${humanSize(file.size)}`;
  fileBadge.textContent = humanSize(file.size);
  fileBadge.hidden = false;
  previewWrap.hidden = false;
  runBtn.disabled = false;

  log(`Selected "${file.name}" (${humanSize(file.size)})`);
  setStatus("idle", "Ready");
}

function clearFile() {
  if (previewImg.src) URL.revokeObjectURL(previewImg.src);
  previewImg.removeAttribute("src");
  selectedFile = null;
  fileInput.value = "";
  previewWrap.hidden = true;
  fileBadge.hidden = true;
  runBtn.disabled = true;
  setStatus("idle", "Idle");
  log("Selection cleared");
}

/* ── process ──────────────────────────────────────────────── */
async function runRead() {
  if (!selectedFile) return;

  runBtn.disabled = true;
  runBtn.classList.add("is-busy");
  runBtn.querySelector(".btn-label").textContent = "Reading…";
  setStatus("busy", "Processing");
  log("Uploading to local OCR…");
  const t0 = performance.now();

  try {
    const blob = await maybeDownscale(selectedFile);

    const fd = new FormData();
    fd.append("image", blob, selectedFile.name);

    const res = await fetch("/api/process", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      const msg = data.error || `HTTP ${res.status}`;
      log(`Error: ${msg}`);
if (data.rawOcr !== undefined) log(`Raw OCR: ${JSON.stringify(data.rawOcr)}`);
      setStatus("err", "Failed");
      toast("Read failed");
      return;
    }

    const total = ((performance.now() - t0) / 1000).toFixed(1);
    log(`Success: ${data.formatted} · server ${data.elapsed}s · total ${total}s`);
    if (data.deduplicated) log("(deduplicated — returned cached result)");
    setStatus("ok", "Complete");
    toast(data.formatted);

    renderResult(data);
    await refreshHistory();
  } catch (err) {
    console.error(err);
    log(`Network error: ${err.message ?? err}`);
    setStatus("err", "Network error");
    toast("Network error");
  } finally {
    runBtn.disabled = false;
    runBtn.classList.remove("is-busy");
    runBtn.querySelector(".btn-label").textContent = "Read value";
  }
}

/* ── result rendering ─────────────────────────────────────── */
function renderResult(data) {
  resultEmpty.hidden = true;
  resultBody.hidden = false;

  lastValue = data.formatted;
  resultValue.textContent = data.formatted;
  resultSub.textContent = `${data.input} → ${data.ohms} Ω`;
  resultOhms.textContent = data.ohms;
  resultOcr.textContent = data.rawOcr || "—";
  resultElapsed.textContent = `${data.elapsed}s`;

  resultDetails.innerHTML = "";
  const d = data.details;
  if (!d) return;

  resultDetails.appendChild(blockValue(d.value));
  resultDetails.appendChild(blockIdentification(d.identification));
  if (d.colorBands) resultDetails.appendChild(blockColorBands(d.colorBands));
  resultDetails.appendChild(blockESeries(d.eSeries));
  resultDetails.appendChild(blockContext(d.context));

  resultBody.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function blockValue(v) {
  return detailBlock("Value", [
    ["Ohms",       v.ohms],
    ["kΩ",         v.kiloOhms],
    ["MΩ",         v.megaOhms],
    ["Scientific", v.scientific],
  ]);
}
function blockIdentification(i) {
  return detailBlock("Identification", [
    ["Kind",       i.valueKind],
    ["Notation",   i.notation],
    ["Multiplier", i.multiplierApplied],
  ]);
}
function blockESeries(e) {
  const rows = [
    ["Series",    e.series],
    ["Preferred", e.isPreferred ? "yes" : "no"],
  ];
  if (e.nearest && e.nearest.length) {
    rows.push(["Neighbors", e.nearest.map(n => n.formatted).join(", ")]);
  }
  return detailBlock("E-series", rows);
}

function blockColorBands(cb) {
  const block = document.createElement("div");
  block.className = "detail-block";
  const h = document.createElement("h3");
  h.textContent = "Color bands · derived";
  block.appendChild(h);

  for (const [label, bands] of [["4-band", cb.fourBand], ["5-band", cb.fiveBand]]) {
    const group = document.createElement("div");
    group.style.marginBottom = "10px";

    const lbl = document.createElement("div");
    lbl.style.cssText = "font-size:10.5px;color:var(--text-faint);letter-spacing:.08em;text-transform:uppercase;margin-bottom:5px;font-family:var(--font-mono)";
    lbl.textContent = label;
    group.appendChild(lbl);

    const wrap = document.createElement("div");
    wrap.className = "color-bands";
    for (const name of bands) {
      const chip = document.createElement("span");
      chip.className = "band";
      const sw = document.createElement("span");
      sw.className = "band-swatch " + name;
      chip.appendChild(sw);
      chip.appendChild(document.createTextNode(name));
      wrap.appendChild(chip);
    }
    group.appendChild(wrap);
    block.appendChild(group);
  }

  const note = document.createElement("div");
  note.style.cssText = "font-size:11px;color:var(--text-faint);margin-top:4px";
  note.textContent = cb.note;
  block.appendChild(note);

  return block;
}

function blockContext(c) {
  const block = document.createElement("div");
  block.className = "detail-block";
  const h = document.createElement("h3");
  h.textContent = "Context";
  block.appendChild(h);

  const dl = document.createElement("dl");
  addRow(dl, "Category",   c.category);
  addRow(dl, "Common use", c.commonUse);
  addRow(dl, "Power",      c.powerRatings.join(", "));
  block.appendChild(dl);

  const list = document.createElement("ul");
  list.style.cssText = "margin:10px 0 0;padding-left:16px;font-size:12.5px;color:var(--text-dim)";
  for (const a of c.typicalApplications) {
    const li = document.createElement("li");
    li.textContent = a;
    list.appendChild(li);
  }
  block.appendChild(list);

  return block;
}

function detailBlock(title, rows) {
  const block = document.createElement("div");
  block.className = "detail-block";
  const h = document.createElement("h3");
  h.textContent = title;
  block.appendChild(h);
  const dl = document.createElement("dl");
  for (const [k, v] of rows) addRow(dl, k, v);
  block.appendChild(dl);
  return block;
}

function addRow(dl, k, v) {
  const dt = document.createElement("dt"); dt.textContent = k;
  const dd = document.createElement("dd"); dd.textContent = String(v);
  dl.appendChild(dt); dl.appendChild(dd);
}

/* ── history ──────────────────────────────────────────────── */
async function refreshHistory() {
  try {
    const res = await fetch("/api/readings");
    const data = await res.json();
    const rows = data.rows ?? [];

    if (rows.length === 0) {
      historyEmpty.hidden = false;
      historyWrap.hidden = true;
      return;
    }

    historyEmpty.hidden = true;
    historyWrap.hidden = false;
    historyBody.innerHTML = "";
    for (const r of rows.slice().reverse()) {
      const tr = document.createElement("tr");
      tr.appendChild(cell(fmtTime(r.timestamp)));
      tr.appendChild(cell(r.input));
      tr.appendChild(cell(r.ohms, "num-cell"));
      tr.appendChild(cell(r.formatted));
      historyBody.appendChild(tr);
    }
  } catch (err) {
    console.error("history fetch failed:", err);
  }
}

function cell(text, cls) {
  const td = document.createElement("td");
  if (cls) td.className = cls;
  td.textContent = text;
  return td;
}

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return iso;
  }
}

/* ── helpers ──────────────────────────────────────────────── */
function humanSize(b) {
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
  return (b / 1024 / 1024).toFixed(2) + " MB";
}

/**
 * Downscale huge uploads client-side. Speeds OCR on slow hardware and
 * shrinks payload size; no quality loss for label reading.
 */
async function maybeDownscale(file) {
  const MAX = 1600;
  if (file.size < 400 * 1024) return file;   // small enough
  try {
    const bmp = await createImageBitmap(file);
    if (bmp.width <= MAX && bmp.height <= MAX) return file;

    const scale = MAX / Math.max(bmp.width, bmp.height);
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);

    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    log(`Downscaled ${bmp.width}×${bmp.height} → ${w}×${h}`);
    return blob ?? file;
  } catch (err) {
    console.warn("downscale failed:", err);
    return file;
  }
}

/* ── wiring ───────────────────────────────────────────────── */
dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) selectFile(f);
});

for (const ev of ["dragenter", "dragover"]) {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
}
for (const ev of ["dragleave", "drop"]) {
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  });
}
dropzone.addEventListener("drop", (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f) selectFile(f);
});

removeBtn.addEventListener("click", clearFile);
runBtn.addEventListener("click", runRead);

copyBtn.addEventListener("click", async () => {
  if (!lastValue) return;
  try {
    await navigator.clipboard.writeText(lastValue);
    toast("Copied: " + lastValue);
  } catch {
    toast("Copy failed");
  }
});

clearLogBtn.addEventListener("click", () => { logEl.textContent = ""; });

clearBtn.addEventListener("click", async () => {
  if (!confirm("Clear all readings from readings.csv?")) return;
  try {
    await fetch("/api/clear", { method: "POST" });
    log("Ledger cleared");
    setStatus("idle", "Idle");
    toast("History cleared");
    await refreshHistory();
  } catch (err) {
    log(`Clear failed: ${err.message ?? err}`);
  }
});

/* ── boot ─────────────────────────────────────────────────── */
log("ResistorReader ready.");
setStatus("idle", "Idle");
refreshHistory();