// Builds the PowerPoint reports: one DVP, one program, or all programs. Plain functions, no React or browser APIs,
// so the same code runs in the browser (download) and in Node (tests/report-deck.test.mjs).
//
//   const pres = await buildDeck(PptxGenJS, report, { loadImage, onProgress });
//   await pres.writeFile({ fileName: deckFileName(report) });
//
// `report` is what GET /api/reports/... returns. `loadImage(url)` returns { data: "image/jpeg;base64,...", w, h }
// or null (pictures that can't be loaded are left out; the report is still made).

const W = 13.333, H = 7.5;                     // LAYOUT_WIDE
const M = 0.55;                                // page margin
const FONT = "Calibri";
const INK = "1B2733", SOFT = "566475", FAINT = "8693A2", RULE = "DFE4EA", PAPER = "F1F3F6", WHITE = "FFFFFF";
const TONE = { Red: "B3261E", Blue: "1D5FBF", Green: "2E7D4F", Open: "8693A2" };
const TONE_BG = { Red: "FBEAE9", Blue: "E7EFFB", Green: "E6F3EB", Open: "EEF1F4" };

// ── text helpers ─────────────────────────────────────────────────────────
const clean = (s) => String(s ?? "").replace(/\r/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
/** Shorten to a length that fits its box (whole words, with an ellipsis). */
export function cut(s, max) {
  const t = clean(s).replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const part = t.slice(0, max - 1);
  const sp = part.lastIndexOf(" ");
  return `${(sp > max * 0.5 ? part.slice(0, sp) : part).replace(/[\s,.;:-]+$/, "")}…`;
}
/** Keep line breaks (procedures are numbered lists), but limit lines and characters. */
function cutLines(s, maxLines, maxChars) {
  const lines = clean(s).split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  let used = 0;
  for (const l of lines) {
    if (out.length >= maxLines || used >= maxChars) { out.push("…"); break; }
    const piece = cut(l, maxChars - used);
    out.push(piece); used += piece.length;
  }
  return out.join("\n");
}
const colourOf = (c) => (c === "Red" || c === "Blue" || c === "Green" ? c : "Open");
const dateText = (iso) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");
const dateTimeText = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function deckFileName(report) {
  const day = new Date(report.generatedAt || Date.now()).toISOString().slice(0, 10);
  if (report.scope === "dvp") return `DVP report ${report.dvp.dvpNumber} ${day}.pptx`;
  if (report.scope === "program") return `DVP report ${report.program.code} ${day}.pptx`;
  return `DVP report all programs ${day}.pptx`;
}

// ── deck frame ───────────────────────────────────────────────────────────
function newDeck(PptxGenJS, title) {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";
  pres.title = title;
  pres.subject = "DVP report";
  pres.company = "Mahindra VR Lab";
  pres.author = "DVP Portal";
  pres.theme = { headFontFace: FONT, bodyFontFace: FONT };
  pres.defineSlideMaster({
    title: "CONTENT",
    background: { color: WHITE },
    objects: [
      { text: { text: "DVP Portal  ·  Mahindra VR Lab", options: { x: M, y: H - 0.42, w: 6, h: 0.3, fontFace: FONT, fontSize: 10, color: FAINT, margin: 0 } } },
    ],
    slideNumber: { x: W - M - 0.6, y: H - 0.42, w: 0.6, h: 0.3, fontFace: FONT, fontSize: 10, color: FAINT, align: "right" },
  });
  pres.defineSlideMaster({ title: "COVER", background: { color: INK } });
  return pres;
}

function heading(slide, title, kicker) {
  if (kicker) slide.addText(kicker, { x: M, y: 0.34, w: W - 2 * M, h: 0.3, fontFace: FONT, fontSize: 12, color: SOFT, bold: true, margin: 0, isTextBox: true, charSpacing: 1 });
  slide.addText(title, { x: M, y: kicker ? 0.62 : 0.42, w: W - 2 * M, h: 0.62, fontFace: FONT, fontSize: 28, bold: true, color: INK, margin: 0, isTextBox: true, fit: "shrink" });
}

function cover(pres, title, subtitle, report) {
  const s = pres.addSlide({ masterName: "COVER" });
  s.addText("DVP REPORT", { x: 0.9, y: 2.0, w: 8, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: "AFC0D3", charSpacing: 3, margin: 0, isTextBox: true });
  s.addText(title, { x: 0.9, y: 2.45, w: 11.5, h: 1.2, fontFace: FONT, fontSize: 44, bold: true, color: WHITE, margin: 0, isTextBox: true, fit: "shrink" });
  if (subtitle) s.addText(cut(subtitle, 150), { x: 0.9, y: 3.7, w: 11.5, h: 0.8, fontFace: FONT, fontSize: 20, color: "D5DEE8", margin: 0, isTextBox: true, valign: "top" });
  s.addText(`Generated ${dateTimeText(report.generatedAt)}${report.generatedBy ? `  ·  ${report.generatedBy}` : ""}`,
    { x: 0.9, y: 6.3, w: 11.5, h: 0.35, fontFace: FONT, fontSize: 13, color: "AFC0D3", margin: 0, isTextBox: true });
  s.addText("Mahindra VR Lab  ·  DVP Portal", { x: 0.9, y: 6.65, w: 11.5, h: 0.35, fontFace: FONT, fontSize: 13, color: "8FA3B8", margin: 0, isTextBox: true });
  return s;
}

/** A row of stat cards: [{ label, value, tone? }]. */
function statCards(slide, items, x, y, w, h) {
  const gap = 0.22;
  const cw = (w - gap * (items.length - 1)) / items.length;
  items.forEach((it, i) => {
    const cx = x + i * (cw + gap);
    const tone = it.tone ? TONE[it.tone] : INK;
    slide.addShape("roundRect", { x: cx, y, w: cw, h, fill: { color: it.tone ? TONE_BG[it.tone] : PAPER }, line: { color: it.tone ? TONE_BG[it.tone] : PAPER }, rectRadius: 0.08 });
    slide.addText(String(it.value), { x: cx + 0.2, y: y + 0.12, w: cw - 0.4, h: h * 0.55, fontFace: FONT, fontSize: h > 1.2 ? 40 : 30, bold: true, color: tone, margin: 0, isTextBox: true, valign: "bottom" });
    slide.addText(it.label, { x: cx + 0.2, y: y + h * 0.62, w: cw - 0.4, h: h * 0.3, fontFace: FONT, fontSize: 13, color: SOFT, margin: 0, isTextBox: true, valign: "top" });
  });
}

function colourCards(slide, counts, x, y, w, h) {
  statCards(slide, [
    { label: "Red", value: counts.red, tone: "Red" },
    { label: "Blue", value: counts.blue, tone: "Blue" },
    { label: "Green", value: counts.green, tone: "Green" },
    { label: "Open", value: counts.open, tone: "Open" },
  ], x, y, w, h);
}

/** Stacked bar of Red / Blue / Green / Open per category (zones, or programs). */
function colourChart(pres, slide, labels, rows, title, box) {
  const series = [["Red", "red"], ["Blue", "blue"], ["Green", "green"], ["Open", "open"]]
    .map(([name, key]) => ({ name, labels, values: rows.map((r) => r[key] || 0) }));
  slide.addChart(pres.charts.BAR, series, {
    ...box, barDir: "bar", barGrouping: "stacked", barGapWidthPct: 60,
    chartColors: [TONE.Red, TONE.Blue, TONE.Green, "C3CCD6"],
    showTitle: true, title, titleFontFace: FONT, titleFontSize: 14, titleColor: INK,
    showLegend: true, legendPos: "b", legendFontFace: FONT, legendFontSize: 11, legendColor: SOFT,
    catAxisLabelFontFace: FONT, catAxisLabelFontSize: 11, catAxisLabelColor: SOFT, catAxisOrientation: "maxMin",
    valAxisLabelFontFace: FONT, valAxisLabelFontSize: 10, valAxisLabelColor: FAINT,
    valGridLine: { color: RULE, size: 0.75 }, catGridLine: { style: "none" },
    showValue: false,
  });
}

/** A simple table, split over as many slides as needed. `cols`: [{ label, w, get(row), max }]. */
function pagedTable(pres, rows, cols, { title, kicker, perPage = 9, empty, onSlide }) {
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  for (let p = 0; p < pages; p++) {
    const s = pres.addSlide({ masterName: "CONTENT" });
    heading(s, pages > 1 ? `${title} (${p + 1} of ${pages})` : title, kicker);
    const slice = rows.slice(p * perPage, (p + 1) * perPage);
    if (slice.length === 0) {
      s.addText(empty || "Nothing to show.", { x: M, y: 1.6, w: W - 2 * M, h: 0.5, fontFace: FONT, fontSize: 16, color: SOFT, margin: 0, isTextBox: true });
      continue;
    }
    const head = cols.map((c) => ({ text: c.label, options: { bold: true, color: SOFT, fill: { color: PAPER }, fontSize: 12 } }));
    const body = slice.map((r) => cols.map((c) => {
      const v = c.get(r);
      if (v && typeof v === "object" && v.text !== undefined) return { text: cut(v.text, c.max || 80), options: { ...v.options, fontSize: 12 } };
      return { text: cut(v, c.max || 80), options: { fontSize: 12, color: INK } };
    }));
    s.addTable([head, ...body], {
      x: M, y: 1.45, w: W - 2 * M, colW: cols.map((c) => c.w), fontFace: FONT, valign: "middle",
      border: { type: "solid", color: RULE, pt: 0.75 }, rowH: 0.48, margin: [0.04, 0.08, 0.04, 0.08],
    });
    if (onSlide) onSlide(s, p);
  }
}

const colourCell = (c) => ({ text: colourOf(c), options: { bold: true, color: TONE[colourOf(c)] } });

/** Place a picture inside a box without stretching it. */
function picture(slide, img, box) {
  if (!img || !img.data) return false;
  const ratio = img.w && img.h ? img.w / img.h : 4 / 3;
  let w = box.w, h = w / ratio;
  if (h > box.h) { h = box.h; w = h * ratio; }
  slide.addImage({ data: img.data, x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h });
  return true;
}

async function loadAll(urls, loadImage, progress) {
  const out = new Map();
  let done = 0;
  for (const u of urls) {
    if (out.has(u)) continue;
    let img = null;
    try { img = loadImage ? await loadImage(u) : null; } catch { img = null; }
    out.set(u, img);
    done++;
    if (progress) progress(`Loading pictures ${done} of ${urls.length}…`);
  }
  return out;
}

// ── a DVP and its LOP history (used by the DVP and program reports) ─────────
function dvpDetailSlide(pres, dvp, pics, kicker) {
  const s = pres.addSlide({ masterName: "CONTENT" });
  heading(s, `${dvp.dvpNumber}  ·  ${cut(dvp.component || dvp.evaluationParameter, 60)}`, kicker);
  const colour = colourOf(dvp.color);
  // colour badge
  s.addShape("roundRect", { x: W - M - 1.6, y: 0.66, w: 1.6, h: 0.48, fill: { color: TONE_BG[colour] }, line: { color: TONE[colour], width: 1 }, rectRadius: 0.1 });
  s.addText(colour.toUpperCase(), { x: W - M - 1.6, y: 0.66, w: 1.6, h: 0.48, fontFace: FONT, fontSize: 14, bold: true, color: TONE[colour], align: "center", valign: "middle", margin: 0, isTextBox: true });

  const left = M, lw = 6.1;
  const facts = [
    ["Evaluation", dvp.evaluationParameter], ["Zone", dvp.zone?.name], ["Ergonomic area", dvp.ergonomicsArea],
    ["CAS", dvp.cas], ["LOP concerns", dvp.lopCount ? String(dvp.lopCount) : "None raised"],
    ["Remarks", dvp.remarks || "—"],
  ];
  const runs = [];
  facts.forEach(([k, v], i) => {
    runs.push({ text: `${k}  `, options: { bold: true, color: SOFT, fontSize: 13 } });
    runs.push({ text: cut(v || "—", k === "Remarks" ? 260 : 90), options: { color: INK, fontSize: 13, breakLine: i < facts.length - 1 } });
  });
  s.addText(runs, { x: left, y: 1.45, w: lw, h: 2.7, fontFace: FONT, valign: "top", margin: 0, paraSpaceAfter: 6, isTextBox: true });
  s.addText([
    { text: "Acceptance criteria", options: { bold: true, color: SOFT, fontSize: 13, breakLine: true } },
    { text: cutLines(dvp.acceptanceCriteria || "Not defined yet", 6, 420), options: { color: INK, fontSize: 12 } },
  ], { x: left, y: 4.25, w: lw, h: 2.6, fontFace: FONT, valign: "top", margin: 0, isTextBox: true });

  // reference pictures on the right (up to 2)
  const refs = (dvp.referenceImages || []).map((u) => pics.get(u)).filter(Boolean).slice(0, 2);
  const rx = M + lw + 0.4, rw = W - rx - M;
  if (refs.length === 0) {
    s.addShape("rect", { x: rx, y: 1.45, w: rw, h: 5.3, fill: { color: PAPER }, line: { color: PAPER } });
    s.addText("No reference image", { x: rx, y: 1.45, w: rw, h: 5.3, fontFace: FONT, fontSize: 14, color: FAINT, align: "center", valign: "middle", margin: 0, isTextBox: true });
  } else {
    const each = (5.3 - 0.2 * (refs.length - 1)) / refs.length;
    refs.forEach((img, i) => picture(s, img, { x: rx, y: 1.45 + i * (each + 0.2), w: rw, h: each }));
  }
  return s;
}

/** Observation images of a DVP: up to 6 per slide, each captioned with who added it and when. */
function observationSlides(pres, dvp, pics, kicker, limit = 12) {
  const all = (dvp.observationImages || []).slice(0, limit);
  for (let start = 0; start < all.length; start += 6) {
    const page = all.slice(start, start + 6);
    const s = pres.addSlide({ masterName: "CONTENT" });
    const pages = Math.ceil(all.length / 6);
    heading(s, `Observation images  ·  ${dvp.dvpNumber}${pages > 1 ? `  (${start / 6 + 1} of ${pages})` : ""}`, kicker);
    const cols = page.length <= 2 ? page.length : 3, rows = Math.ceil(page.length / cols), gap = 0.25, capH = 0.3;
    const cw = (W - 2 * M - gap * (cols - 1)) / cols, ch = (5.35 - gap * (rows - 1)) / rows - capH;
    page.forEach((o, i) => {
      const x = M + (i % cols) * (cw + gap), y = 1.45 + Math.floor(i / cols) * (ch + capH + gap);
      if (!picture(s, pics.get(o.url), { x, y, w: cw, h: ch })) {
        s.addShape("rect", { x, y, w: cw, h: ch, fill: { color: PAPER }, line: { color: PAPER } });
        s.addText("Picture could not be loaded", { x, y, w: cw, h: ch, fontFace: FONT, fontSize: 12, color: FAINT, align: "center", valign: "middle", margin: 0, isTextBox: true });
      }
      s.addText(`${o.uploadedBy?.name || ""}${o.uploadedAt ? `  ·  ${dateTimeText(o.uploadedAt)}` : ""}`, { x, y: y + ch, w: cw, h: capH, fontFace: FONT, fontSize: 11, color: SOFT, align: "center", valign: "middle", margin: 0, isTextBox: true });
    });
  }
  if ((dvp.observationImages || []).length > all.length) {
    // (only in the program report, which keeps the file small; the DVP report has them all)
    const s = pres.addSlide({ masterName: "CONTENT" });
    heading(s, `Observation images  ·  ${dvp.dvpNumber}`, kicker);
    s.addText(`${plural(dvp.observationImages.length - all.length, "more image")} in the portal. The DVP report has all of them.`, { x: M, y: 1.45, w: W - 2 * M, h: 0.5, fontFace: FONT, fontSize: 14, color: SOFT, margin: 0, isTextBox: true });
  }
}

function lopEntrySlide(pres, dvp, entry, pics, kicker) {
  const s = pres.addSlide({ masterName: "CONTENT" });
  heading(s, `LOP concern #${entry.seq}  ·  ${dvp.dvpNumber}`, kicker);
  const by = [entry.raisedBy?.name, entry.raisedBy?.role === "ADMIN" ? "Admin" : entry.raisedBy?.role === "USER" ? "User" : ""].filter(Boolean).join(", ");
  const imgs = (entry.images || []).map((u) => pics.get(u)).filter(Boolean).slice(0, 4);
  const textW = imgs.length ? 5.9 : W - 2 * M;
  s.addText([
    { text: `Raised ${dateTimeText(entry.createdAt)}${by ? ` by ${by}` : ""}`, options: { color: SOFT, fontSize: 13, breakLine: true } },
    { text: "CAS/CAD details", options: { bold: true, color: SOFT, fontSize: 13, breakLine: true } },
    { text: cut(entry.modelDetails || "—", 200), options: { color: INK, fontSize: 14, breakLine: true } },
    { text: "Concern", options: { bold: true, color: SOFT, fontSize: 13, breakLine: true } },
    { text: cutLines(entry.details, 14, imgs.length ? 900 : 1500), options: { color: INK, fontSize: 14 } },
  ], { x: M, y: 1.45, w: textW, h: 5.4, fontFace: FONT, valign: "top", margin: 0, paraSpaceAfter: 6, isTextBox: true });
  if (imgs.length) {
    const gx = M + textW + 0.4, gw = W - gx - M, gap = 0.2;
    const cols = imgs.length === 1 ? 1 : 2, rows = Math.ceil(imgs.length / cols);
    const cw = (gw - gap * (cols - 1)) / cols, ch = (5.3 - gap * (rows - 1)) / rows;
    imgs.forEach((img, i) => picture(s, img, { x: gx + (i % cols) * (cw + gap), y: 1.45 + Math.floor(i / cols) * (ch + gap), w: cw, h: ch }));
  }
  if ((entry.images || []).length > imgs.length) {
    s.addText(`${plural(entry.images.length - imgs.length, "picture")} could not be loaded.`, { x: M, y: H - 0.85, w: 6, h: 0.3, fontFace: FONT, fontSize: 11, color: FAINT, margin: 0, isTextBox: true });
  }
  return s;
}

// ── the three reports ────────────────────────────────────────────────────
async function dvpDeck(PptxGenJS, report, loadImage, progress) {
  const d = report.dvp;
  const pres = newDeck(PptxGenJS, `DVP report ${d.dvpNumber}`);
  const urls = [...(d.referenceImages || []).slice(0, 2), ...(d.observationImages || []).map((o) => o.url), ...d.lop.flatMap((e) => (e.images || []).slice(0, 4))];
  const pics = await loadAll(urls, loadImage, progress);
  cover(pres, d.dvpNumber, `${d.component || ""}${d.component && d.evaluationParameter ? " — " : ""}${d.evaluationParameter || ""}  ·  ${report.program.code}`, report);
  dvpDetailSlide(pres, d, pics, `PROGRAM ${report.program.code}`);
  observationSlides(pres, d, pics, `PROGRAM ${report.program.code}`);
  if (clean(d.procedure)) {
    const s = pres.addSlide({ masterName: "CONTENT" });
    heading(s, "Procedure", d.dvpNumber);
    s.addText(cutLines(d.procedure, 16, 1600), { x: M, y: 1.45, w: W - 2 * M, h: 5.4, fontFace: FONT, fontSize: 14, color: INK, valign: "top", margin: 0, paraSpaceAfter: 4, isTextBox: true });
  }
  if (d.lop.length) {
    // oldest first, so the history reads in order
    [...d.lop].sort((a, b) => a.seq - b.seq).forEach((e) => lopEntrySlide(pres, d, e, pics, "LOP HISTORY"));
  }
  return pres;
}

async function programDeck(PptxGenJS, report, loadImage, progress, obsPerDvp = 6) {
  const { program, counts, zones, dvps } = report;
  const pres = newDeck(PptxGenJS, `DVP report ${program.code}`);
  const lopDvps = dvps.filter((d) => d.lopCount > 0);
  const OBS_PER_DVP = obsPerDvp;  // an admin setting: keeps a program deck a sensible size; the DVP report has every image
  const obsDvps = OBS_PER_DVP > 0 ? dvps.filter((d) => (d.observationImages || []).length > 0) : [];
  const urls = [
    ...obsDvps.flatMap((d) => d.observationImages.slice(0, OBS_PER_DVP).map((o) => o.url)),
    ...lopDvps.flatMap((d) => (d.referenceImages || []).slice(0, 2)),
    ...lopDvps.flatMap((d) => d.lop.flatMap((e) => (e.images || []).slice(0, 4))),
  ];
  const pics = await loadAll(urls, loadImage, progress);

  cover(pres, `${program.code}${program.name && program.name !== program.code ? ` · ${program.name}` : ""}`, program.description || `${plural(counts.dvps, "DVP")} · ${plural(counts.lop, "LOP concern")}`, report);

  // Summary
  const s = pres.addSlide({ masterName: "CONTENT" });
  heading(s, "Summary", `PROGRAM ${program.code}`);
  statCards(s, [
    { label: "DVPs", value: counts.dvps },
    { label: `Assessed (${counts.dvps ? Math.round((counts.assessed / counts.dvps) * 100) : 0}%)`, value: counts.assessed },
    { label: "LOP concerns", value: counts.lop, tone: counts.lop ? "Red" : undefined },
  ], M, 1.45, 5.6, 1.35);
  colourCards(s, counts, M, 3.05, 5.6, 1.25);
  s.addText(counts.lop
    ? `${plural(lopDvps.length, "DVP")} ${lopDvps.length === 1 ? "has" : "have"} LOP concerns. Each is shown on the following slides with its history.`
    : "No LOP concerns have been raised for this program.",
  { x: M, y: 4.55, w: 5.6, h: 1.0, fontFace: FONT, fontSize: 14, color: SOFT, margin: 0, valign: "top", isTextBox: true });
  if (zones.length) colourChart(pres, s, zones.map((z) => cut(z.name, 28)), zones, "DVPs by zone", { x: 6.55, y: 1.35, w: W - 6.55 - M, h: 5.5 });

  // DVPs with LOP concerns: overview table, then each one
  if (lopDvps.length) {
    pagedTable(pres, lopDvps, [
      { label: "DVP no.", w: 2.3, get: (d) => d.dvpNumber, max: 30 },
      { label: "Component", w: 2.0, get: (d) => d.component, max: 28 },
      { label: "Evaluation", w: 2.6, get: (d) => d.evaluationParameter, max: 40 },
      { label: "Colour", w: 0.9, get: (d) => colourCell(d.color) },
      { label: "LOP", w: 0.6, get: (d) => String(d.lopCount) },
      { label: "Latest concern", w: W - 2 * M - 8.4, get: (d) => d.lop[0] ? `${dateText(d.lop[0].createdAt)}: ${d.lop[0].details}` : "", max: 80 },
    ], { title: "DVPs with LOP concerns", kicker: `PROGRAM ${program.code}`, perPage: 9 });
    for (const d of lopDvps) {
      dvpDetailSlide(pres, d, pics, `PROGRAM ${program.code}  ·  LOP CONCERNS`);
      if (OBS_PER_DVP > 0) observationSlides(pres, d, pics, `PROGRAM ${program.code}  ·  LOP CONCERNS`, OBS_PER_DVP);
      [...d.lop].sort((a, b) => a.seq - b.seq).forEach((e) => lopEntrySlide(pres, d, e, pics, `PROGRAM ${program.code}  ·  LOP HISTORY`));
    }
  }

  // Observation images of the other DVPs (those with LOP concerns already have theirs above)
  for (const d of obsDvps.filter((x) => !(x.lopCount > 0))) observationSlides(pres, d, pics, `PROGRAM ${program.code}  ·  OBSERVATIONS`, OBS_PER_DVP);

  // Every DVP, for reference
  pagedTable(pres, dvps, [
    { label: "DVP no.", w: 2.3, get: (d) => d.dvpNumber, max: 30 },
    { label: "Component", w: 2.0, get: (d) => d.component, max: 28 },
    { label: "Evaluation", w: 2.8, get: (d) => d.evaluationParameter, max: 42 },
    { label: "Zone", w: 1.6, get: (d) => d.zone?.name, max: 22 },
    { label: "Colour", w: 0.9, get: (d) => colourCell(d.color) },
    { label: "Remarks", w: W - 2 * M - 9.6, get: (d) => d.remarks || "", max: 60 },
  ], { title: "All DVPs", kicker: `PROGRAM ${program.code}`, perPage: 10, empty: "No DVPs are assigned to this program." });
  return pres;
}

async function overallDeck(PptxGenJS, report, loadImage, progress) {
  const { programs, totals } = report;
  const pres = newDeck(PptxGenJS, "DVP report - all programs");
  if (progress) progress("Building the slides…");
  cover(pres, "All programs", `${plural(totals.programs, "program")} · ${plural(totals.dvps, "DVP")} · ${plural(totals.lop, "LOP concern")}`, report);

  const s = pres.addSlide({ masterName: "CONTENT" });
  heading(s, "Summary", "ALL PROGRAMS");
  statCards(s, [
    { label: "Programs", value: totals.programs },
    { label: "DVPs", value: totals.dvps },
    { label: "LOP concerns", value: totals.lop, tone: totals.lop ? "Red" : undefined },
  ], M, 1.45, 5.6, 1.35);
  colourCards(s, totals, M, 3.05, 5.6, 1.25);
  if (programs.length) colourChart(pres, s, programs.map((p) => p.code), programs.map((p) => p.counts), "DVPs by program", { x: 6.55, y: 1.35, w: W - 6.55 - M, h: 5.5 });

  pagedTable(pres, programs, [
    { label: "Program", w: 1.6, get: (p) => ({ text: p.code, options: { bold: true, color: INK } }), max: 14 },
    { label: "Name", w: 3.0, get: (p) => (p.name && p.name !== p.code ? p.name : "—"), max: 40 },
    { label: "DVPs", w: 1.0, get: (p) => String(p.counts.dvps) },
    { label: "Assessed", w: 1.3, get: (p) => String(p.counts.assessed) },
    { label: "Red", w: 0.95, get: (p) => ({ text: String(p.counts.red), options: { color: TONE.Red, bold: true } }) },
    { label: "Blue", w: 0.95, get: (p) => ({ text: String(p.counts.blue), options: { color: TONE.Blue, bold: true } }) },
    { label: "Green", w: 0.95, get: (p) => ({ text: String(p.counts.green), options: { color: TONE.Green, bold: true } }) },
    { label: "Open", w: 0.95, get: (p) => String(p.counts.open) },
    { label: "LOP concerns", w: W - 2 * M - 10.7, get: (p) => ({ text: String(p.counts.lop), options: { bold: true, color: p.counts.lop ? TONE.Red : INK } }) },
  ], { title: "Programs at a glance", kicker: "ALL PROGRAMS", perPage: 10, empty: "No active programs." });

  // One section per program: its LOP concerns
  for (const p of programs) {
    pagedTable(pres, p.lopDvps, [
      { label: "DVP no.", w: 2.3, get: (d) => d.dvpNumber, max: 30 },
      { label: "Component", w: 2.0, get: (d) => d.component, max: 28 },
      { label: "Evaluation", w: 2.6, get: (d) => d.evaluationParameter, max: 40 },
      { label: "Colour", w: 0.9, get: (d) => colourCell(d.color) },
      { label: "LOP", w: 0.6, get: (d) => String(d.lopCount) },
      { label: "Latest concern", w: W - 2 * M - 8.4, get: (d) => d.lop?.[0] ? `${dateText(d.lop[0].createdAt)}: ${d.lop[0].details}` : "", max: 80 },
    ], {
      title: `${p.code}: LOP concerns`, kicker: `${p.counts.dvps} DVPS  ·  RED ${p.counts.red}  ·  BLUE ${p.counts.blue}  ·  GREEN ${p.counts.green}  ·  OPEN ${p.counts.open}`,
      perPage: 9, empty: `No LOP concerns have been raised for ${p.code}.`,
    });
  }
  return pres;
}

export async function buildDeck(PptxGenJS, report, { loadImage, onProgress, observationsPerDvp = 6 } = {}) {
  if (!report || !report.scope) throw new Error("No report data.");
  if (report.scope === "dvp") return dvpDeck(PptxGenJS, report, loadImage, onProgress);
  if (report.scope === "program") return programDeck(PptxGenJS, report, loadImage, onProgress, observationsPerDvp);
  return overallDeck(PptxGenJS, report, loadImage, onProgress);
}
