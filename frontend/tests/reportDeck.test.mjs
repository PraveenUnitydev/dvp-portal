// Builds the three PowerPoint reports from the backend test's mock reports (run `npm run test:report` in backend
// first) and checks them. Writes the decks to tests/out/ so they can be opened and looked at.
//   node --test tests/reportDeck.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildDeck, deckFileName, cut } from "../src/report/deck.js";

const require = createRequire(import.meta.url);
const PptxGenJS = require("pptxgenjs");
const here = path.dirname(new URL(import.meta.url).pathname);
const fixtures = path.join(here, "..", "..", "backend", "tests", "out");
const out = path.join(here, "out");
fs.mkdirSync(out, { recursive: true });
const haveSamples = fs.existsSync(path.join(fixtures, "report-program.json"));
const deckTest = (name, fn) => test(name, { skip: haveSamples ? false : "run `npm run test:report` in backend first" }, fn);
const load = (n) => JSON.parse(fs.readFileSync(path.join(fixtures, `report-${n}.json`), "utf8"));

// Pictures: reference images from the repo (webp -> jpeg, as the browser does); LOP pictures are generated
let sharp = null;
try { sharp = require("sharp"); } catch { /* pictures left out */ }
const imgDir = path.join(here, "..", "..", "backend", "public", "dvp-images");
async function loadImage(url) {
  if (!sharp) return null;
  let buf;
  if (url.startsWith("/dvp-images/")) {
    const f = path.join(imgDir, decodeURIComponent(url.slice("/dvp-images/".length)));
    if (!fs.existsSync(f)) return null;
    buf = await sharp(f).jpeg({ quality: 80 }).toBuffer();
  } else {
    buf = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 120, g: 140, b: 160 } } }).jpeg().toBuffer();
  }
  const meta = await sharp(buf).metadata();
  return { data: `image/jpeg;base64,${buf.toString("base64")}`, w: meta.width, h: meta.height };
}

async function make(name) {
  const report = load(name);
  const pres = await buildDeck(PptxGenJS, report, { loadImage });
  const file = path.join(out, `${name}.pptx`);
  await pres.writeFile({ fileName: file });
  return { report, pres, file };
}

test("cut keeps whole words and marks the cut", () => {
  assert.equal(cut("short", 10), "short");
  assert.equal(cut("one two three four five", 12), "one two…");
  assert.equal(cut(null, 5), "");
});

test("file names", () => {
  assert.match(deckFileName({ scope: "overall", generatedAt: "2026-10-12T05:00:00Z" }), /^DVP report all programs 2026-10-12\.pptx$/);
  assert.match(deckFileName({ scope: "program", program: { code: "U171" }, generatedAt: "2026-10-12T05:00:00Z" }), /U171/);
});

deckTest("DVP report: cover, details, procedure, one slide per LOP entry", async () => {
  const { report, pres, file } = await make("dvp");
  assert.equal(pres.slides.length, 3 + report.dvp.lop.length);
  assert.ok(fs.statSync(file).size > 10000);
});

deckTest("program report: summary, LOP table + each LOP DVP and entry, all DVPs", async () => {
  const { report, pres } = await make("program");
  const lopDvps = report.dvps.filter((d) => d.lopCount > 0);
  const entries = lopDvps.reduce((n, d) => n + d.lop.length, 0);
  const allPages = Math.ceil(report.dvps.length / 10);
  assert.equal(pres.slides.length, 2 + 1 + lopDvps.length + entries + allPages);
});

deckTest("overall report: summary, programs table, one section per program", async () => {
  const { report, pres } = await make("overall");
  assert.equal(pres.slides.length, 2 + 1 + report.programs.length);
});

deckTest("no pictures available: report still made", async () => {
  const pres = await buildDeck(PptxGenJS, load("program"), { loadImage: async () => { throw new Error("offline"); } });
  assert.ok(pres.slides.length > 3);
});
