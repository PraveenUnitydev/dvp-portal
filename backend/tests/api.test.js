/**
 * End-to-end API test for the admin features (programs, base catalog, adding DVPs).
 *   npm run test:api
 *
 * Needs a MongoDB reachable at TEST_MONGO_URI (default mongodb://127.0.0.1:27017/dvpPortalTest).
 * It uses a THROWAWAY database: it is dropped before and after, and your real data is never touched.
 * It seeds the real 135-DVP catalog, starts the server on port 7199, runs the checks, and cleans up.
 */
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const mongoose = require("mongoose");

const MONGO_URI = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017/dvpPortalTest";
const PORT = 7199, PORT_LIMITED = 7198;
const BASE = `http://127.0.0.1:${PORT}`;
const UPLOADS = fs.mkdtempSync(path.join(os.tmpdir(), "dvp-uploads-"));
const ENV = { ...process.env, MONGO_URI, PORT: String(PORT), JWT_SECRET: crypto.randomBytes(32).toString("hex"), UPLOAD_DIR: UPLOADS, ADMIN_WRITE_LIMIT: "1000" };
const cwd = path.join(__dirname, "..");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? `   [${detail}]` : ""}`); };
const section = (t) => console.log(`\n=== ${t} ===`);

async function call(method, url, { token, json, form, port = PORT } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers, body });
  const buf = Buffer.from(await res.arrayBuffer());
  let data = null; try { data = JSON.parse(buf.toString("utf8")); } catch { /* not JSON */ }
  return { status: res.status, body: data, raw: buf, headers: res.headers };
}
const login = async (u, p) => (await call("POST", "/api/auth/login", { json: { username: u, password: p } })).body.token;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x40, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(64, 3)]);
function formOf(fields, files = []) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [].concat(v)) f.append(k, x);
  for (const [buf, name, type] of files) f.append("images", new Blob([buf], { type }), name);
  return f;
}
const dvp = (over = {}) => ({ type: "Usability", code: "UDVP-401-90", zoneOrder: 4, component: "Seat", evaluationParameter: "Recline reach", ...over });
const uploaded = () => (fs.existsSync(path.join(UPLOADS, "dvp-images")) ? fs.readdirSync(path.join(UPLOADS, "dvp-images")) : []);

let server;
async function startServer(env, port) {
  const proc = spawn("node", ["server.js"], { cwd, env: { ...env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; proc.stdout.on("data", (d) => (log += d)); proc.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { const r = await call("GET", "/api/health", { port }); if (r.body?.database === "connected") return { proc, log: () => log }; } catch { /* not up yet */ }
  }
  throw new Error("server did not start:\n" + log);
}

(async () => {
  await mongoose.connect(MONGO_URI); await mongoose.connection.dropDatabase();
  execFileSync("node", ["scripts/seed.js"], { cwd, env: ENV, stdio: "ignore" });
  for (const [u, role, name] of [["admin", "ADMIN", "Portal Admin"], ["maya", "USER", "Maya User"]])
    execFileSync("node", ["scripts/create-user.js", u, role, name], { cwd, env: { ...ENV, PORTAL_PASSWORD: "Test-Password-123" }, stdio: "ignore" });
  server = await startServer(ENV, PORT);
  const admin = await login("admin", "Test-Password-123"), maya = await login("maya", "Test-Password-123");

  section("Who may do what");
  check("Catalog list: no sign-in -> 401", (await call("GET", "/api/admin/dvps")).status === 401);
  check("Catalog list: a plain user -> 403", (await call("GET", "/api/admin/dvps", { token: maya })).status === 403);
  check("Add DVP: no sign-in -> 401; user -> 403", (await call("POST", "/api/admin/dvps", { json: dvp() })).status === 401 && (await call("POST", "/api/admin/dvps", { token: maya, json: dvp() })).status === 403);
  check("Add program: user -> 403", (await call("POST", "/api/admin/programs", { token: maya, json: { code: "ZZ1" } })).status === 403);
  check("Nothing was created by the refused requests", (await call("GET", "/api/admin/dvps", { token: admin })).body.dvps.length === 135);

  section("DVP numbers no longer carry a VRC prefix");
  const u171 = (await call("GET", "/api/programs/U171/dvps", { token: maya })).body.dvps;
  check("U171 still lists all 135 DVPs", u171.length === 135);
  check("Numbers read <program>-<code>, e.g. U171-UDVP-101-01", u171.some((d) => d.dvpNumber === "U171-UDVP-101-01") && u171.every((d) => d.dvpNumber === `U171-${d.code}`));
  check("No number or field anywhere contains 'VRC'", !JSON.stringify(u171).includes("VRC"));

  section("Base reference catalog (admin, no program, plain codes)");
  const cat = (await call("GET", "/api/admin/dvps", { token: admin })).body.dvps;
  check("All 135 base DVPs, shown by catalog code only", cat.length === 135 && cat.every((d) => /^[UV]DVP-\d{3,4}-\d{2}$/.test(d.code)) && cat.every((d) => d.dvpNumber === d.code));
  check("Sorted by zone then code", cat[0].code === "UDVP-101-01" && cat.every((d, i) => i === 0 || cat[i - 1].zone.order <= d.zone.order));
  check("Each row says how many programs use it (U171 uses all)", cat.every((d) => d.programCount === 1));
  check("Image links point at /dvp-images", cat.find((d) => d.code === "UDVP-102-02").referenceImages[0] === "/dvp-images/UDVP-102-02-1.webp");

  section("Adding a program");
  let r = await call("POST", "/api/admin/programs", { token: admin, json: { code: "t100", name: "Test program", description: "A test" } });
  check("Created; code upper-cased; starts with no DVPs", r.status === 201 && r.body.code === "T100" && r.body.dvpCount === 0 && r.body.name === "Test program");
  check("It shows up in the program list for everyone", (await call("GET", "/api/programs", { token: maya })).body.some((p) => p.code === "T100" && p.description === "A test"));
  check("Name defaults to the code", (await call("POST", "/api/admin/programs", { token: admin, json: { code: "N200" } })).body.name === "N200");
  check("Duplicate (even different case) -> 409", (await call("POST", "/api/admin/programs", { token: admin, json: { code: "T100" } })).status === 409 && (await call("POST", "/api/admin/programs", { token: admin, json: { code: "u171" } })).status === 409);
  for (const bad of ["", "A", "TOOLONGCODE123", "S-302", "S 302", "<b>"])
    if ((await call("POST", "/api/admin/programs", { token: admin, json: { code: bad } })).status !== 400) check(`Invalid code ${JSON.stringify(bad)} refused`, false);
  check("Invalid codes (empty, 1 char, too long, symbols, spaces) all refused", true);
  check("Spreadsheet-formula name refused", (await call("POST", "/api/admin/programs", { token: admin, json: { code: "F100", name: "=HYPERLINK(1)" } })).status === 400);
  check("Over-long description refused", (await call("POST", "/api/admin/programs", { token: admin, json: { code: "F101", description: "x".repeat(301) } })).status === 400);
  check("Control character refused", (await call("POST", "/api/admin/programs", { token: admin, json: { code: "F102", name: "a\u0000b" } })).status === 400);
  check("Refused requests created nothing", !(await call("GET", "/api/programs", { token: maya })).body.some((p) => p.code.startsWith("F1")));
  r = await call("POST", "/api/admin/programs", { token: admin, json: { code: "C300", copyFrom: "u171" } });
  check("Copy from U171: same 135 DVPs switched on", r.status === 201 && r.body.dvpCount === 135);
  await call("PATCH", "/api/programs/U171/dvps/UDVP-101-01", { token: admin, json: { completedStatus: "Done", color: "Green", remarks: "checked" } });
  const fresh = (await call("GET", "/api/programs/C300/dvps", { token: maya })).body.dvps;
  check("...but status, colour and remarks start fresh (not copied)", fresh.length === 135 && fresh.every((d) => d.completedStatus === "Not done" && !d.color && !d.remarks));
  check("...and the source program is untouched", (await call("GET", "/api/programs/U171/dvps", { token: maya })).body.dvps.find((d) => d.code === "UDVP-101-01").remarks === "checked");
  check("Copy from an unknown program refused, nothing created", (await call("POST", "/api/admin/programs", { token: admin, json: { code: "C301", copyFrom: "NOPE" } })).status === 400 && !(await call("GET", "/api/programs", { token: maya })).body.some((p) => p.code === "C301"));

  section("Adding a DVP (no images)");
  r = await call("POST", "/api/admin/dvps", { token: admin, json: dvp({ code: "udvp-401-90", zoneName: "IGNORED NAME" }) });
  check("Created; code upper-cased", r.status === 201 && r.body.code === "UDVP-401-90");
  check("Existing zone keeps its own name (a different name is ignored)", r.body.zone.order === 4 && r.body.zone.name === "Seats");
  check("Full name defaults to 'component evaluation'; no procedure -> not available", r.body.fullName === "Seat Recline reach" && r.body.procedureAvailable === false && r.body.vrCapability === "No");
  check("Appears in the base catalog (136), used by 0 programs", (await call("GET", "/api/admin/dvps", { token: admin })).body.dvps.find((d) => d.code === "UDVP-401-90")?.programCount === 0);
  check("...but in NO program's list until it is switched on", !(await call("GET", "/api/programs/U171/dvps", { token: maya })).body.dvps.some((d) => d.code === "UDVP-401-90"));
  r = await call("POST", "/api/admin/dvps", { token: admin, json: dvp({ code: "VDVP-402-91", type: "Visibility", procedure: "1. Do the thing", requirement: "Req", acceptanceCriteria: "AC", vrCapability: "Partial", ergonomicsArea: "Visibility", cas: "Interior", fullName: "My own full name" }) });
  check("All fields stored; procedure present -> available", r.status === 201 && r.body.procedureAvailable === true && r.body.vrCapability === "Partial" && r.body.fullName === "My own full name" && r.body.cas === "Interior" && r.body.createdBy === "Portal Admin");
  r = await call("POST", "/api/admin/dvps", { token: admin, json: dvp({ code: "UDVP-401-92", programs: ["S302", "t100"] }) });
  check("Applied to chosen programs at creation", r.status === 201 && r.body.programCount === 2);
  const s302 = (await call("GET", "/api/programs/S302/dvps", { token: maya })).body.dvps;
  check("It then appears there with the new number format (S302-UDVP-401-92)", s302.length === 1 && s302[0].dvpNumber === "S302-UDVP-401-92" && s302[0].completedStatus === "Not done");
  check("...and not in a program that wasn't chosen", !(await call("GET", "/api/programs/U171/dvps", { token: maya })).body.dvps.some((d) => d.code === "UDVP-401-92"));
  check("Duplicate code -> 409 (any case)", (await call("POST", "/api/admin/dvps", { token: admin, json: dvp({ code: "UDVP-401-92" }) })).status === 409 && (await call("POST", "/api/admin/dvps", { token: admin, json: dvp({ code: "udvp-101-01" }) })).status === 409);
  check("Unknown program -> 400, and the DVP is NOT created", (await call("POST", "/api/admin/dvps", { token: admin, json: dvp({ code: "UDVP-401-93", programs: ["NOPE"] }) })).status === 400 && !(await call("GET", "/api/admin/dvps", { token: admin })).body.dvps.some((d) => d.code === "UDVP-401-93"));

  section("Refusing bad DVP input");
  const refuse = async (name, over, status = 400) => { const x = await call("POST", "/api/admin/dvps", { token: admin, json: dvp({ code: "UDVP-499-01", ...over }) }); check(name, x.status === status, `got ${x.status}: ${x.body?.message}`); };
  await refuse("Type missing", { type: "" }); await refuse("Type invalid", { type: "Other" });
  await refuse("Usability type with a VDVP code", { code: "VDVP-401-01" }); await refuse("Visibility type with a UDVP code", { type: "Visibility", code: "UDVP-401-01" });
  await refuse("Malformed code", { code: "UDVP-1-1" }); await refuse("Code with extra text", { code: "UDVP-401-01; drop" });
  await refuse("Component missing", { component: "" }); await refuse("Evaluation missing", { evaluationParameter: "  " });
  await refuse("Evaluation over 120 characters", { evaluationParameter: "x".repeat(121) });
  await refuse("Procedure over 8000 characters", { procedure: "x".repeat(8001) });
  await refuse("VR capability invalid", { vrCapability: "Maybe" });
  for (const field of ["component", "evaluationParameter", "fullName", "ergonomicsArea", "cas", "requirement", "acceptanceCriteria", "procedure"])
    for (const lead of ["=1+1", "+cmd", "-cmd", "@SUM", "＝full", "  =padded"]) {
      const x = await call("POST", "/api/admin/dvps", { token: admin, json: dvp({ code: "UDVP-499-02", [field]: lead }) });
      if (x.status !== 400) check(`${field} starting with ${JSON.stringify(lead)} refused`, false, `got ${x.status}`);
    }
  check("Formula-looking text refused in all 8 text fields (= + - @, full-width, after spaces)", true);
  await refuse("Control character in the procedure", { procedure: "a\u0000b" });
  check("A leading digit / bullet-free text is fine", (await call("POST", "/api/admin/dvps", { token: admin, json: dvp({ code: "UDVP-401-94", procedure: "1. Sit. 2. Reach - then measure" }) })).status === 201);
  check("None of the refused requests created anything", !(await call("GET", "/api/admin/dvps", { token: admin })).body.dvps.some((d) => d.code === "UDVP-499-01" || d.code === "UDVP-499-02"));

  section("Zones");
  r = await call("POST", "/api/admin/dvps", { token: admin, json: dvp({ code: "UDVP-1101-01", zoneOrder: 11, zoneName: "Windows" }) });
  check("A new zone number with a name creates the zone", r.status === 201 && r.body.zone.name === "Windows" && r.body.zone.order === 11);
  check("Reusing that number later keeps the name 'Windows'", (await call("POST", "/api/admin/dvps", { token: admin, json: dvp({ code: "UDVP-1101-02", zoneOrder: 11, zoneName: "Glass" }) })).body.zone.name === "Windows");
  check("A new number with an already-used name refused", (await call("POST", "/api/admin/dvps", { token: admin, json: dvp({ code: "UDVP-1201-01", zoneOrder: 12, zoneName: "windows" }) })).status === 400);
  check("A new zone number without a name refused", (await call("POST", "/api/admin/dvps", { token: admin, json: dvp({ code: "UDVP-1201-01", zoneOrder: 12 }) })).status === 400);
  for (const z of [0, 100, "abc", "", 1.5, -1]) if ((await call("POST", "/api/admin/dvps", { token: admin, json: dvp({ code: "UDVP-1201-01", zoneOrder: z, zoneName: "Q" }) })).status !== 400) check(`Zone ${JSON.stringify(z)} refused`, false);
  check("Zone numbers outside 1-99 or not whole refused", true);

  section("Images");
  r = await call("POST", "/api/admin/dvps", { token: admin, form: formOf(dvp({ code: "UDVP-498-01", programs: ["T100"] }), [[PNG, "a.png", "image/png"], [JPG, "b.jpg", "image/jpeg"], [WEBP, "c.webp", "image/webp"]]) });
  check("PNG + JPEG + WebP accepted, named after the code", r.status === 201 && JSON.stringify(r.body.referenceImages) === JSON.stringify(["/dvp-images/UDVP-498-01-1.png", "/dvp-images/UDVP-498-01-2.jpg", "/dvp-images/UDVP-498-01-3.webp"]), JSON.stringify(r.body));
  const img = await call("GET", "/dvp-images/UDVP-498-01-1.png");
  check("The uploaded image is served byte-for-byte as the right type, with nosniff", img.status === 200 && img.raw.equals(PNG) && img.headers.get("content-type") === "image/png" && img.headers.get("x-content-type-options") === "nosniff");
  check("Sheet images are still served", (await call("GET", "/dvp-images/UDVP-102-02-1.webp")).status === 200);
  check("A missing image is a 404", (await call("GET", "/dvp-images/nope.png")).status === 404);
  const trav = await call("GET", "/dvp-images/..%2f..%2fserver.js");
  check("Path traversal can't read other files", trav.status !== 200 || !trav.raw.toString().includes("express"), `status ${trav.status}`);
  check("The images show on the program page too", (await call("GET", "/api/programs/T100/dvps", { token: maya })).body.dvps.find((d) => d.code === "UDVP-498-01")?.referenceImages.length === 3);
  const before = uploaded().length;
  r = await call("POST", "/api/admin/dvps", { token: admin, form: formOf(dvp({ code: "UDVP-498-02" }), [[Buffer.from("this is just text, not an image, padded out to be long enough"), "fake.png", "image/png"]]) });
  check("A text file renamed .png refused", r.status === 400 && /not a PNG, JPEG or WebP/.test(r.body.message));
  r = await call("POST", "/api/admin/dvps", { token: admin, form: formOf(dvp({ code: "UDVP-498-02" }), [[Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>' + " ".repeat(40)), "x.png", "image/png"]]) });
  check("An SVG (can carry script) refused", r.status === 400);
  r = await call("POST", "/api/admin/dvps", { token: admin, form: formOf(dvp({ code: "UDVP-498-02" }), [[PNG, "ok.png", "image/png"], [Buffer.from("not an image at all, just words, long enough to pass length"), "bad.png", "image/png"]]) });
  check("One good + one bad image: whole request refused", r.status === 400);
  check("...and the good one was NOT left on disk", uploaded().length === before && !uploaded().some((f) => f.startsWith("UDVP-498-02")));
  check("...and the DVP was not created", !(await call("GET", "/api/admin/dvps", { token: admin })).body.dvps.some((d) => d.code === "UDVP-498-02"));
  r = await call("POST", "/api/admin/dvps", { token: admin, form: formOf(dvp({ code: "UDVP-498-03" }), Array.from({ length: 7 }, (_, i) => [PNG, `i${i}.png`, "image/png"])) });
  check("7 images refused (limit is 6)", r.status === 400 && /at most 6/.test(r.body.message));
  r = await call("POST", "/api/admin/dvps", { token: admin, form: formOf(dvp({ code: "UDVP-498-03" }), [[Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024, 7)]), "big.png", "image/png"]]) });
  check("An image over 3 MB refused", r.status === 400 && /3 MB/.test(r.body.message));
  check("Neither of those left files or a DVP behind", uploaded().length === before && !(await call("GET", "/api/admin/dvps", { token: admin })).body.dvps.some((d) => d.code === "UDVP-498-03"));
  r = await call("POST", "/api/admin/dvps", { token: admin, form: formOf(dvp({ code: "UDVP-498-04", component: "=bad" }), [[PNG, "ok.png", "image/png"]]) });
  check("Bad text + good image: refused, image not written", r.status === 400 && !uploaded().some((f) => f.startsWith("UDVP-498-04")));

  section("Two admins add the same code at the same moment");
  const racers = await Promise.all([0, 1].map((i) => call("POST", "/api/admin/dvps", { token: admin, form: formOf(dvp({ code: "UDVP-497-01", component: `Racer ${i}` }), [[i ? JPG : PNG, i ? "r.jpg" : "r.png", i ? "image/jpeg" : "image/png"]]) })));
  const winner = racers.find((x) => x.status === 201), loser = racers.find((x) => x.status === 409);
  check("Exactly one wins (201) and one is told it exists (409)", Boolean(winner) && Boolean(loser), racers.map((x) => x.status).join(","));
  const winnerFile = winner?.body.referenceImages[0];
  const got = winnerFile ? await call("GET", winnerFile) : { status: 0 };
  check("The winner's image is intact (the loser did not delete or overwrite it)", got.status === 200 && got.raw.equals(winner.body.referenceImages[0].endsWith(".png") ? PNG : JPG));
  check("Only the winner's file exists for that code", uploaded().filter((f) => f.startsWith("UDVP-497-01")).length === 1);

  section("A re-seed never removes what admins added");
  const countBefore = (await call("GET", "/api/admin/dvps", { token: admin })).body.dvps.length;
  const progsBefore = (await call("GET", "/api/programs", { token: maya })).body.length;
  execFileSync("node", ["scripts/seed.js"], { cwd, env: ENV, stdio: "ignore" });
  const after = (await call("GET", "/api/admin/dvps", { token: admin })).body.dvps;
  check("Added DVPs are all still there", after.length === countBefore && after.some((d) => d.code === "UDVP-498-01") && after.some((d) => d.code === "UDVP-1101-01"));
  check("Added programs are all still there, with their DVP switches", (await call("GET", "/api/programs", { token: maya })).body.length === progsBefore && (await call("GET", "/api/programs/S302/dvps", { token: maya })).body.dvps.length === 1);
  check("Status entered before the re-seed is kept", (await call("GET", "/api/programs/U171/dvps", { token: maya })).body.dvps.find((d) => d.code === "UDVP-101-01").remarks === "checked");

  section("Rate limiting of admin changes");
  const limited = await startServer({ ...ENV, ADMIN_WRITE_LIMIT: "3" }, PORT_LIMITED);
  const statuses = []; for (let i = 0; i < 5; i++) statuses.push((await call("POST", "/api/admin/programs", { token: admin, json: { code: `L${i}0` }, port: PORT_LIMITED })).status);
  check("After the allowed number of changes, further ones get 429", statuses.slice(0, 3).every((s) => s === 201) && statuses.slice(3).every((s) => s === 429), statuses.join(","));
  limited.proc.kill();

  console.log(`\nPassed ${pass} | Failed ${fail}`);
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error("TEST ERROR", e); process.exitCode = 2; })
  .finally(async () => {
    try { server?.proc.kill(); await mongoose.connection.dropDatabase(); await mongoose.disconnect(); } catch { /* ignore */ }
    fs.rmSync(UPLOADS, { recursive: true, force: true });
  });
