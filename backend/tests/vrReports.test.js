/**
 * VR report upload / download test with mock data - no MongoDB needed.
 *   npm run test:vr-reports
 *
 * The real routes run in a real Express server with in-memory models (see mockDb.js) and a throwaway uploads folder.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const http = require("http");

const UPLOADS = fs.mkdtempSync(path.join(os.tmpdir(), "dvp-vr-"));
process.env.UPLOAD_DIR = UPLOADS;
process.env.VR_REPORT_MAX_MB = "1";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");

const express = require("express");
const jwt = require("jsonwebtoken");
const { VrReport, admin, maya, Program } = require("./mockDb");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? `   [${detail}]` : ""}`); };

const app = express();
app.use(express.json());
app.use("/api/programs", require("../routes/programs"));
app.use("/api", require("../routes/vrReports"));
const tokenOf = (u) => jwt.sign({ id: String(u._id) }, process.env.JWT_SECRET);
const ADMIN = tokenOf(admin), USER = tokenOf(maya);

// ── test files ────────────────────────────────────────────────────────────
// A stored (uncompressed) zip with the given entry names: enough for the type check, which reads the names
function zipOf(names) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const n of names) {
    const name = Buffer.from(n), data = Buffer.from(`<x>${n}</x>`);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, data); centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const PPTX = zipOf(["[Content_Types].xml", "ppt/presentation.xml", "ppt/slides/slide1.xml"]);
const DOCX = zipOf(["[Content_Types].xml", "word/document.xml"]);
const XLSX = zipOf(["[Content_Types].xml", "xl/workbook.xml"]);
const PPTM = zipOf(["[Content_Types].xml", "ppt/presentation.xml", "ppt/vbaProject.bin"]);
const ZIP = zipOf(["readme.txt"]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), crypto.randomBytes(2000), Buffer.from("\n%%EOF")]);
const OLE = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(600)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const BIG = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(1.5 * 1024 * 1024, 65)]);

const dir = (sub) => path.join(UPLOADS, "vr-reports", sub);
const stored = () => (fs.existsSync(dir("")) ? fs.readdirSync(dir("")).filter((n) => !n.startsWith(".")) : []);
const incoming = () => (fs.existsSync(dir(".incoming")) ? fs.readdirSync(dir(".incoming")) : []);

(async () => {
  const server = app.listen(0);
  const port = server.address().port;
  // Plain node:http without keep-alive, so nothing is left open at the end (see report.test.js)
  const call = (method, p, { token, file, fields = {}, field = "file" } = {}) => new Promise((resolve, reject) => {
    let body = null;
    const headers = { Connection: "close", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    if (file || Object.keys(fields).length) {
      const b = `----t${crypto.randomBytes(8).toString("hex")}`, parts = [];
      for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
      if (file) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${field}"; filename="${file[1]}"\r\nContent-Type: application/octet-stream\r\n\r\n`), file[0], Buffer.from("\r\n"));
      parts.push(Buffer.from(`--${b}--\r\n`));
      body = Buffer.concat(parts);
      Object.assign(headers, { "Content-Type": `multipart/form-data; boundary=${b}`, "Content-Length": body.length });
    }
    const req = http.request({ host: "127.0.0.1", port, path: p, method, agent: false, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { const raw = Buffer.concat(chunks); let json = null; try { json = JSON.parse(raw.toString("utf8")); } catch { /* a file */ } resolve({ status: res.statusCode, body: json, raw, headers: res.headers }); });
    });
    req.on("error", (e) => (e.code === "ECONNRESET" || e.code === "EPIPE" ? resolve({ status: 0, reset: true }) : reject(e)));
    if (body) req.end(body); else req.end();
  });
  const up = (file, fields, program = "U171", token = ADMIN, field) => call("POST", `/api/programs/${program}/vr-reports`, { token, file, fields, field });

  try {
    check("list: empty to start", (await call("GET", "/api/programs/U171/vr-reports", { token: USER })).body.reports.length === 0);
    check("list: needs sign-in", (await call("GET", "/api/programs/U171/vr-reports")).status === 401);
    check("upload: no sign-in 401, plain user 403", (await up([PDF, "a.pdf"], {}, "U171", null)).status === 401 && (await up([PDF, "a.pdf"], {}, "U171", USER)).status === 403);

    const p1 = await up([PPTX, "U171 VR assessment.pptx"], { title: "Round 1 - VR assessment", notes: "Seating buck review" });
    check("upload: PowerPoint with a title", p1.status === 201 && p1.body.kind === "PowerPoint" && p1.body.ext === "pptx" && p1.body.title === "Round 1 - VR assessment" && p1.body.uploadedBy.name === "Portal Admin", JSON.stringify(p1.body));
    check("upload: stored as <id>.pptx, nothing left in the holding folder", stored().includes(`${p1.body.id}.pptx`) && incoming().length === 0);

    // A UTF-8 name, as browsers send it (the en dash), and no title: the title comes from the name
    const p2 = await up([PDF, "U171 VR report – Round 2.pdf"]);
    check("upload: PDF; title from the file name (UTF-8 kept)", p2.status === 201 && p2.body.ext === "pdf" && p2.body.title === "U171 VR report – Round 2" && p2.body.fileName === "U171 VR report – Round 2.pdf", JSON.stringify(p2.body));
    // The extension comes from the content, not the name
    const p3 = await up([DOCX, "notes.pdf"]);
    check("upload: Word named .pdf is stored and offered as .docx", p3.status === 201 && p3.body.ext === "docx" && p3.body.fileName === "notes.docx");
    check("upload: Excel", (await up([XLSX, "scores.xlsx"])).body?.ext === "xlsx");
    check("upload: title from a name starting with '=' is cleaned", (await up([PDF, "=cmd report.pdf"], {}, "S302")).body?.title === "cmd report");

    const before = stored().length;
    const refused = [
      ["PNG renamed .pdf", await up([PNG, "x.pdf"])],
      ["plain zip", await up([ZIP, "x.pptx"])],
      ["macro PowerPoint renamed .pptx", await up([PPTM, "x.pptx"])],
      ["old .ppt", await up([OLE, "x.ppt"])],
      ["no file", await up(null, { title: "Nothing" })],
      ["title starting with =", await up([PDF, "x.pdf"], { title: "=HYPERLINK()" })],
      ["wrong field name", await up([PDF, "x.pdf"], {}, "U171", ADMIN, "images")],
    ];
    for (const [name, r] of refused) check(`refused: ${name} (400)`, r.status === 400 && r.body?.message, `${r.status} ${JSON.stringify(r.body)}`);
    check("refused: macro message explains", refused[2][1].body.message.includes("macros"));
    const big = await up([BIG, "big.pdf"]);
    check("refused: larger than the limit (413)", big.status === 413 || big.reset, `${big.status}`);
    await new Promise((r) => setTimeout(r, 200));
    check("refused uploads leave no files behind", stored().length === before && incoming().length === 0, `${stored().length}/${before} ${incoming()}`);
    check("upload: unknown program 404, archived program 404", (await up([PDF, "a.pdf"], {}, "ZZ99")).status === 404 && (await up([PDF, "a.pdf"], {}, "X100")).status === 404);

    const list = (await call("GET", "/api/programs/u171/vr-reports", { token: USER })).body;
    check("list: newest first", list.reports.length === 4 && list.reports[0].ext === "xlsx" && list.reports[3].id === p1.body.id, list.reports.map((r) => r.ext).join());
    const all = (await call("GET", "/api/vr-reports", { token: USER })).body;
    check("all programs: active only, each with its reports", all.programs.length === 2 && all.programs.find((p) => p.code === "U171").reports.length === 4 && all.programs.find((p) => p.code === "S302").reports.length === 1 && !all.programs.some((p) => p.code === "X100"));

    // Download: link first (signed-in), then the file with the link alone
    const link = await call("GET", `/api/vr-reports/${p2.body.id}/link`, { token: USER });
    check("link: for any signed-in user", link.status === 200 && link.body.url.startsWith(`/api/vr-reports/${p2.body.id}/file?t=`) && link.body.fileName.endsWith(".pdf"));
    const got = await call("GET", link.body.url);
    check("download: same bytes, PDF type, attachment with the name", got.status === 200 && got.raw.equals(PDF) && got.headers["content-type"].startsWith("application/pdf") && /^attachment;/.test(got.headers["content-disposition"]) && got.headers["content-disposition"].includes("UTF-8''U171%20VR%20report%20%E2%80%93%20Round%202.pdf"), got.headers["content-disposition"]);
    const pptx = await call("GET", `/api/vr-reports/${p1.body.id}/file`, { token: USER });
    check("download with the sign-in header; PowerPoint type", pptx.status === 200 && pptx.raw.equals(PPTX) && pptx.headers["content-type"].includes("presentationml"));
    const t = new URLSearchParams(link.body.url.split("?")[1]).get("t");
    check("download: no link and no sign-in 401", (await call("GET", `/api/vr-reports/${p2.body.id}/file`)).status === 401);
    check("download: a link only opens its own report", (await call("GET", `/api/vr-reports/${p1.body.id}/file?t=${t}`)).status === 403);
    check("download: a link is not a sign-in token", (await call("GET", "/api/programs/U171/vr-reports", { token: t })).status === 401);
    check("download: a session token is not a link", (await call("GET", `/api/vr-reports/${p2.body.id}/file?t=${USER}`)).status === 403);
    const key = crypto.createHmac("sha256", process.env.JWT_SECRET).update("vr-report-download").digest();
    const expired = jwt.sign({ rid: p2.body.id, exp: Math.floor(Date.now() / 1000) - 5 }, key, { audience: "vr-report" });
    check("download: an expired link 403 with a clear message", (await call("GET", `/api/vr-reports/${p2.body.id}/file?t=${expired}`)).body?.message.includes("expired"));
    check("link: bad id 404", (await call("GET", "/api/vr-reports/nope/link", { token: USER })).status === 404 && (await call("GET", `/api/vr-reports/${"0".repeat(24)}/link`, { token: USER })).status === 404);

    // A file missing from disk (restored database, lost uploads folder) is reported, not a crash
    fs.renameSync(path.join(dir(""), `${p3.body.id}.docx`), path.join(dir(""), "moved"));
    check("link: file missing on disk 404", (await call("GET", `/api/vr-reports/${p3.body.id}/link`, { token: USER })).status === 404);
    fs.renameSync(path.join(dir(""), "moved"), path.join(dir(""), `${p3.body.id}.docx`));

    // Archived program: its reports are hidden
    const s302 = Program.rows.find((p) => p.code === "S302");
    const s302Report = all.programs.find((p) => p.code === "S302").reports[0];
    s302.active = false;
    check("archived program: its report can't be downloaded", (await call("GET", `/api/vr-reports/${s302Report.id}/link`, { token: USER })).status === 404);
    s302.active = true;

    check("delete: plain user 403", (await call("DELETE", `/api/vr-reports/${p1.body.id}`, { token: USER })).status === 403);
    const del = await call("DELETE", `/api/vr-reports/${p1.body.id}`, { token: ADMIN });
    await new Promise((r) => setTimeout(r, 100));
    check("delete: admin; record and file gone", del.status === 200 && !VrReport.rows.some((r) => String(r._id) === p1.body.id) && !stored().includes(`${p1.body.id}.pptx`));
    check("delete: then the link is 404, and a second delete 404", (await call("GET", `/api/vr-reports/${p1.body.id}/link`, { token: USER })).status === 404 && (await call("DELETE", `/api/vr-reports/${p1.body.id}`, { token: ADMIN })).status === 404);

    const { uploadName } = require("../routes/vrReports").helpers;
    check("file names: path and control characters removed", uploadName("..\\..\\a/b:c*?.pdf") === "....abc.pdf" && uploadName("x\u0000y.pdf") === "xy.pdf");
  } catch (e) {
    fail++; console.log("FAIL exception", e);
  } finally {
    console.log(`\nPassed ${pass} | Failed ${fail}`);
    process.exitCode = fail ? 1 : 0;
    fs.rmSync(UPLOADS, { recursive: true, force: true });
    server.closeAllConnections?.();
    server.close();
  }
})();
