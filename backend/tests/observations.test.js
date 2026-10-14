/**
 * Observation images test with mock data - no MongoDB needed.
 *   npm run test:observations
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const http = require("http");

const UPLOADS = fs.mkdtempSync(path.join(os.tmpdir(), "dvp-obs-"));
process.env.UPLOAD_DIR = UPLOADS;
process.env.OBSERVATION_MAX_IMAGES = "5";
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");

const express = require("express");
const jwt = require("jsonwebtoken");
const { admin, maya, User, ProgramDvp, Dvp, S302, same } = require("./mockDb");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? `   [${detail}]` : ""}`); };

const ravi = { _id: { toString: () => "f".repeat(24) }, username: "ravi", name: "Ravi User", role: "USER", active: true };
User.rows.push(ravi);
const app = express();
app.use(express.json());
app.use("/api/programs", require("../routes/programs"));
app.use("/api", require("../routes/observations"));
app.use("/api/reports", require("../routes/reports"));
const tokenOf = (u) => jwt.sign({ id: String(u._id) }, process.env.JWT_SECRET);
const ADMIN = tokenOf(admin), MAYA = tokenOf(maya), RAVI = tokenOf(ravi);

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(200)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(200)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x40, 0, 0, 0]), Buffer.from("WEBP"), crypto.randomBytes(200)]);
const TXT = Buffer.from("not an image at all, just some text that is long enough to sniff");
const BIG = Buffer.concat([PNG, Buffer.alloc(5.2 * 1024 * 1024)]);
const dir = path.join(UPLOADS, "observation-images");
const onDisk = () => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

(async () => {
  const server = app.listen(0);
  const port = server.address().port;
  const call = (method, p, { token, files, field = "images" } = {}) => new Promise((resolve, reject) => {
    let body = null;
    const headers = { Connection: "close", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    if (files) {
      const b = `----t${crypto.randomBytes(8).toString("hex")}`, parts = [];
      for (const [buf, name] of files) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${field}"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), buf, Buffer.from("\r\n"));
      parts.push(Buffer.from(`--${b}--\r\n`));
      body = Buffer.concat(parts);
      Object.assign(headers, { "Content-Type": `multipart/form-data; boundary=${b}`, "Content-Length": body.length });
    }
    const req = http.request({ host: "127.0.0.1", port, path: p, method, agent: false, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { const raw = Buffer.concat(chunks); let json = null; try { json = JSON.parse(raw.toString("utf8")); } catch { /* image */ } resolve({ status: res.statusCode, body: json, raw, headers: res.headers }); });
    });
    req.on("error", (e) => (e.code === "ECONNRESET" || e.code === "EPIPE" ? resolve({ status: 0, reset: true }) : reject(e)));
    if (body) req.end(body); else req.end();
  });

  const code = Dvp.rows[1].code;                       // in both U171 and S302
  const base = `/api/programs/U171/dvps/${code}/observations`;
  const row = () => ProgramDvp.rows.find((r) => same(r.dvp, Dvp.rows[1]._id) && r.program.toString() !== S302._id.toString());
  try {
    const list = await call("GET", "/api/programs/U171/dvps", { token: MAYA });
    check("DVP list: every row has observationImages; this DVP has none yet", list.body.dvps.every((d) => Array.isArray(d.observationImages)) && list.body.dvps.find((d) => d.code === code).observationImages.length === 0);
    check("add: needs sign-in", (await call("POST", base, { files: [[PNG, "a.png"]] })).status === 401);

    const a1 = await call("POST", base, { token: MAYA, files: [[PNG, "front.png"], [JPG, "side.jpg"]] });
    check("add: a user adds two images; the updated row comes back", a1.status === 201 && a1.body.code === code && a1.body.observationImages.length === 2 && a1.body.observationImages[0].uploadedBy.name === "Maya User" && a1.body.observationImages[1].url.endsWith(".jpg"), JSON.stringify(a1.body));
    check("add: the files are stored by content type", onDisk().length === 2 && onDisk().some((n) => n.endsWith(".png")) && onDisk().some((n) => n.endsWith(".jpg")));
    check("add: who changed it is recorded", row().updatedBy === "Maya User");
    check("add: other programs unaffected", (await call("GET", "/api/programs/S302/dvps", { token: MAYA })).body.dvps.find((d) => d.code === code).observationImages.length === 0);

    const a2 = await call("POST", base, { token: RAVI, files: [[WEBP, "top.webp"]] });
    check("add: another user adds one (oldest first)", a2.status === 201 && a2.body.observationImages.length === 3 && a2.body.observationImages[2].uploadedBy.name === "Ravi User");

    const img = await call("GET", a1.body.observationImages[0].url, { token: MAYA });
    check("serve: signed in gets the image with its type", img.status === 200 && img.raw.equals(PNG) && img.headers["content-type"] === "image/png" && img.headers["x-content-type-options"] === "nosniff");
    check("serve: not signed in 401; bad name 404", (await call("GET", a1.body.observationImages[0].url)).status === 401 && (await call("GET", "/api/observation-images/..%2Fx.png", { token: MAYA })).status === 404);

    const before = onDisk().length;
    const refused = [
      ["not an image", await call("POST", base, { token: MAYA, files: [[PNG, "ok.png"], [TXT, "fake.png"]] }), 400],
      ["no images", await call("POST", base, { token: MAYA, files: [] }), 400],
      ["wrong field", await call("POST", base, { token: MAYA, files: [[PNG, "a.png"]], field: "file" }), 400],
      ["over 5 MB", await call("POST", base, { token: MAYA, files: [[BIG, "big.png"]] }), 400],
      ["more than 6 at once", await call("POST", base, { token: ADMIN, files: Array(7).fill([PNG, "a.png"]) }), 400],
      ["over the limit (3 + 3 > 5)", await call("POST", base, { token: MAYA, files: [[PNG, "a.png"], [PNG, "b.png"], [PNG, "c.png"]] }), 409],
      ["unknown DVP", await call("POST", "/api/programs/U171/dvps/UDVP-999-99/observations", { token: MAYA, files: [[PNG, "a.png"]] }), 404],
      ["bad DVP number", await call("POST", "/api/programs/U171/dvps/xx/observations", { token: MAYA, files: [[PNG, "a.png"]] }), 400],
      ["archived program", await call("POST", `/api/programs/X100/dvps/${code}/observations`, { token: MAYA, files: [[PNG, "a.png"]] }), 404],
    ];
    for (const [name, r, want] of refused) check(`refused: ${name} (${want})`, (r.status === want || (r.reset && want === 400)) && (r.reset || r.body?.message), `${r.status} ${JSON.stringify(r.body)}`);
    check("refused: limit message says how many more", refused[5][1].body.message.includes("add 2 more"));
    check("refused uploads leave no files and no records", onDisk().length === before && row().observations.length === 3);

    // Two people at once: the database check refuses the one that would go over, and its files are removed
    const race = await Promise.all([call("POST", base, { token: MAYA, files: [[PNG, "r1.png"], [PNG, "r2.png"]] }), call("POST", base, { token: RAVI, files: [[PNG, "r3.png"], [PNG, "r4.png"]] })]);
    const okN = race.filter((r) => r.status === 201).length;
    check("at once: never more than the limit; the loser's files are removed", okN === 1 && row().observations.length === 5 && onDisk().length === 5, `${race.map((r) => r.status)} ${row().observations.length} ${onDisk().length}`);

    const first = row().observations[0].file;
    const rDel = (f, token) => call("DELETE", `${base}/${f}`, { token });
    check("remove: someone else's image as a user 403 (names the uploader)", (await rDel(first, RAVI)).body?.message.includes("Maya User"));
    const own = await rDel(first, MAYA);
    check("remove: own image; file gone", own.status === 200 && own.body.observationImages.length === 4 && !onDisk().includes(first));
    const ravis = row().observations.find((o) => o.uploadedBy.name === "Ravi User").file;
    check("remove: an admin can remove anyone's", (await rDel(ravis, ADMIN)).status === 200 && row().observations.length === 3 && !onDisk().includes(ravis));
    check("remove: already removed 404, bad name 404", (await rDel(first, MAYA)).status === 404 && (await rDel("x.png", MAYA)).status === 404);

    const rep = await call("GET", `/api/reports/programs/U171/dvps/${code}`, { token: MAYA });
    check("reports carry the observation images", rep.status === 200 && rep.body.dvp.observationImages.length === 3);
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
