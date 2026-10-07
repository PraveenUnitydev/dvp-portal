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

  section("Editing a DVP");
  const rowOf = async (code) => (await call("GET", "/api/admin/dvps", { token: admin })).body.dvps.find((d) => d.code === code);
  const patchForm = (fields, files = []) => formOf(fields, files);
  await call("POST", "/api/admin/dvps", { token: admin, json: dvp({ code: "UDVP-496-01", component: "Original comp", evaluationParameter: "Original eval", procedure: "" }) });
  let e1 = await rowOf("UDVP-496-01");
  check("A new DVP carries an updatedAt the edit form will send back", Boolean(e1.updatedAt) && e1.editedBy === "");
  const edit = (code, fields, o = {}) => call("PATCH", `/api/admin/dvps/${code}`, { token: admin, json: { expectedUpdatedAt: e1.updatedAt, component: "C", evaluationParameter: "E", ...fields }, ...o });
  check("Edit: no sign-in -> 401, plain user -> 403", (await call("PATCH", "/api/admin/dvps/UDVP-496-01", { json: {} })).status === 401 && (await call("PATCH", "/api/admin/dvps/UDVP-496-01", { token: maya, json: {} })).status === 403);
  check("Unknown DVP -> 404; malformed code -> 400", (await edit("UDVP-496-77", {})).status === 404 && (await edit("NOPE", {})).status === 400);
  check("Without expectedUpdatedAt -> 400 (reload and try again)", (await call("PATCH", "/api/admin/dvps/UDVP-496-01", { token: admin, json: { component: "C", evaluationParameter: "E" } })).status === 400);
  r = await edit("UDVP-496-01", { component: "New comp", evaluationParameter: "New eval", procedure: "1. Step", vrCapability: "Yes", type: "Visibility", code: "UDVP-496-99", ergonomicsArea: "Usability", cas: "Interior" });
  check("Valid edit saved; text, VR capability, procedure-available all updated", r.status === 200 && r.body.component === "New comp" && r.body.procedureAvailable === true && r.body.vrCapability === "Yes" && r.body.fullName === "New comp New eval");
  check("The code and type can NOT be changed by an edit (sent values ignored)", r.body.code === "UDVP-496-01" && r.body.type === "Usability");
  check("Who edited it, and when, is recorded", r.body.editedBy === "Portal Admin" && Boolean(r.body.editedAt));
  const stale = await edit("UDVP-496-01", { component: "Stale save" });
  check("A save based on an OLD copy -> 409, and nothing changes", stale.status === 409 && (await rowOf("UDVP-496-01")).component === "New comp");
  // One round proves little for a race (the outcome can be down to timing), so repeat it: every round must have exactly one winner
  let raceRounds = [];
  for (let round = 0; round < 8; round++) {
    e1 = await rowOf("UDVP-496-01");
    const dup = await Promise.all([1, 2].map((i) => edit("UDVP-496-01", { component: `Racer ${round}-${i}` })));
    raceRounds.push(dup.map((x) => x.status).sort().join(","));
  }
  check("Two admins saving the same copy at once, 8 times over: every time exactly one wins and one is told to reload", raceRounds.every((r) => r === "200,409"), raceRounds.join(" | "));
  e1 = await rowOf("UDVP-496-01");
  check("Missing required text refused", (await edit("UDVP-496-01", { component: "" })).status === 400 && (await edit("UDVP-496-01", { evaluationParameter: " " })).status === 400);
  check("Formula-looking / over-long / control-character text refused", (await edit("UDVP-496-01", { component: "=cmd" })).status === 400 && (await edit("UDVP-496-01", { procedure: "@x" })).status === 400 && (await edit("UDVP-496-01", { procedure: "x".repeat(8001) })).status === 400 && (await edit("UDVP-496-01", { cas: "a\u0000" })).status === 400);
  check("VR capability invalid refused", (await edit("UDVP-496-01", { vrCapability: "Maybe" })).status === 400);
  check("Refused edits changed nothing", (await rowOf("UDVP-496-01")).component === e1.component);
  r = await edit("UDVP-496-01", { zoneOrder: 5, zoneName: "ignored" });
  check("Moving to an existing zone takes that zone's real name", r.status === 200 && r.body.zone.order === 5 && r.body.zone.name === "Roof & pillars");
  e1 = await rowOf("UDVP-496-01");
  check("Moving to a new zone needs a free name", (await edit("UDVP-496-01", { zoneOrder: 13 })).status === 400 && (await edit("UDVP-496-01", { zoneOrder: 13, zoneName: "seats" })).status === 400);
  r = await edit("UDVP-496-01", { zoneOrder: 13, zoneName: "Doors" }); e1 = await rowOf("UDVP-496-01");
  check("...a new zone with an unused name works", r.status === 200 && r.body.zone.name === "Doors");

  section("Editing images");
  r = await call("PATCH", "/api/admin/dvps/UDVP-496-01", { token: admin, form: patchForm({ expectedUpdatedAt: e1.updatedAt, component: "C", evaluationParameter: "E" }, [[PNG, "a.png", "image/png"], [JPG, "b.jpg", "image/jpeg"]]) });
  check("Two images added: named -1 and -2", r.status === 200 && JSON.stringify(r.body.referenceImages) === JSON.stringify(["/dvp-images/UDVP-496-01-1.png", "/dvp-images/UDVP-496-01-2.jpg"]), JSON.stringify(r.body.referenceImages));
  check("...and they are served", (await call("GET", "/dvp-images/UDVP-496-01-2.jpg")).raw.equals(JPG));
  e1 = await rowOf("UDVP-496-01");
  r = await call("PATCH", "/api/admin/dvps/UDVP-496-01", { token: admin, form: patchForm({ expectedUpdatedAt: e1.updatedAt, component: "C", evaluationParameter: "E", removeImages: "UDVP-496-01-1.png" }, [[WEBP, "c.webp", "image/webp"]]) });
  check("One removed and one added in the same save; the new one never reuses a removed number", r.status === 200 && JSON.stringify(r.body.referenceImages) === JSON.stringify(["/dvp-images/UDVP-496-01-2.jpg", "/dvp-images/UDVP-496-01-3.webp"]), JSON.stringify(r.body.referenceImages));
  check("The removed image's file is deleted from disk", !uploaded().includes("UDVP-496-01-1.png") && (await call("GET", "/dvp-images/UDVP-496-01-1.png")).status === 404);
  e1 = await rowOf("UDVP-496-01"); const filesNow = uploaded().length;
  r = await call("PATCH", "/api/admin/dvps/UDVP-496-01", { token: admin, form: patchForm({ expectedUpdatedAt: e1.updatedAt, component: "C", evaluationParameter: "E", removeImages: "nonexistent.png" }) });
  check("Removing an image the DVP doesn't have is refused", r.status === 400);
  r = await call("PATCH", "/api/admin/dvps/UDVP-496-01", { token: admin, form: patchForm({ expectedUpdatedAt: e1.updatedAt, component: "C", evaluationParameter: "E" }, Array.from({ length: 5 }, (_, i) => [PNG, `n${i}.png`, "image/png"])) });
  check("More than 6 images in total refused, with the real total in the message", r.status === 400 && /at most 6 images \(it would have 7\)/.test(r.body.message), r.body.message);
  r = await call("PATCH", "/api/admin/dvps/UDVP-496-01", { token: admin, form: patchForm({ expectedUpdatedAt: e1.updatedAt, component: "C", evaluationParameter: "E" }, [[PNG, "ok.png", "image/png"], [Buffer.from("not an image, long enough to get past the length check"), "bad.png", "image/png"]]) });
  check("A good image + a fake one: refused, and the good one is NOT left on disk", r.status === 400 && uploaded().length === filesNow);
  r = await call("PATCH", "/api/admin/dvps/UDVP-496-01", { token: admin, form: patchForm({ expectedUpdatedAt: e1.updatedAt, component: "=bad", evaluationParameter: "E" }, [[PNG, "ok.png", "image/png"]]) });
  check("Bad text + a good image: refused, image not written", r.status === 400 && uploaded().length === filesNow);
  r = await call("PATCH", "/api/admin/dvps/UDVP-102-02", { token: admin, form: patchForm({ expectedUpdatedAt: (await rowOf("UDVP-102-02")).updatedAt, component: "Edited steering", evaluationParameter: "Contour Comfort", removeImages: "UDVP-102-02-1.webp" }) });
  check("A master-sheet image can be taken off a DVP...", r.status === 200 && r.body.referenceImages.length === 0 && r.body.component === "Edited steering");
  check("...but the sheet's own image FILE is never deleted", (await call("GET", "/dvp-images/UDVP-102-02-1.webp")).status === 200);

  section("A re-seed keeps portal edits but still refreshes the rest");
  await mongoose.connection.collection("dvps").updateOne({ code: "UDVP-101-02" }, { $set: { component: "TAMPERED" } });
  execFileSync("node", ["scripts/seed.js"], { cwd, env: ENV, stdio: "ignore" });
  const rs102 = await rowOf("UDVP-102-02"), rs101 = await rowOf("UDVP-101-02"), rs496 = await rowOf("UDVP-496-01");
  check("The edited sheet DVP keeps the admin's text and removed image", rs102.component === "Edited steering" && rs102.referenceImages.length === 0);
  check("An UNEDITED sheet DVP is still refreshed from the sheet", rs101.component === "Control Pedals", rs101.component);
  check("A DVP added in the portal is untouched", rs496.code === "UDVP-496-01" && rs496.referenceImages.length === 2);

  section("Deleting a DVP");
  await call("POST", "/api/admin/dvps", { token: admin, form: formOf(dvp({ code: "UDVP-495-01" }), [[PNG, "a.png", "image/png"]]) });
  check("Delete: no sign-in -> 401, plain user -> 403", (await call("DELETE", "/api/admin/dvps/UDVP-495-01")).status === 401 && (await call("DELETE", "/api/admin/dvps/UDVP-495-01", { token: maya })).status === 403);
  check("A sheet DVP used by U171 can't be deleted, and the message names the program", await (async () => { const x = await call("DELETE", "/api/admin/dvps/UDVP-101-01", { token: admin }); return x.status === 409 && /U171/.test(x.body.message); })());
  check("...and it is still there", Boolean(await rowOf("UDVP-101-01")));
  await call("POST", "/api/admin/dvps", { token: admin, json: dvp({ code: "UDVP-495-02", programs: ["T100"] }) });
  await call("PUT", "/api/admin/programs/T100/applicability", { token: admin, json: { codes: [] } });
  check("One a program switched OFF still can't be deleted (its history would be lost)", (await call("DELETE", "/api/admin/dvps/UDVP-495-02", { token: admin })).status === 409);
  check("An unused DVP can be deleted", (await call("DELETE", "/api/admin/dvps/UDVP-495-01", { token: admin })).status === 200 && !(await rowOf("UDVP-495-01")));
  check("...its uploaded image is removed from disk", !uploaded().some((f) => f.startsWith("UDVP-495-01")));
  check("Deleting it again -> 404; malformed -> 400", (await call("DELETE", "/api/admin/dvps/UDVP-495-01", { token: admin })).status === 404 && (await call("DELETE", "/api/admin/dvps/xx", { token: admin })).status === 400);

  section("Programs: edit and archive");
  check("Admin program list includes everything with an active flag; a user may not read it", (await call("GET", "/api/admin/programs", { token: admin })).body.every((p) => typeof p.active === "boolean") && (await call("GET", "/api/admin/programs", { token: maya })).status === 403);
  r = await call("PATCH", "/api/admin/programs/T100", { token: admin, json: { name: "Renamed", description: "New text" } });
  check("Name and description can be changed; the code stays", r.status === 200 && r.body.name === "Renamed" && r.body.description === "New text" && r.body.code === "T100");
  check("Plain user / no sign-in refused; unknown program 404", (await call("PATCH", "/api/admin/programs/T100", { token: maya, json: { name: "x" } })).status === 403 && (await call("PATCH", "/api/admin/programs/T100", { json: { name: "x" } })).status === 401 && (await call("PATCH", "/api/admin/programs/NOPE", { token: admin, json: { name: "x" } })).status === 404);
  check("Formula name, over-long description, empty request, non-boolean active: all refused", (await call("PATCH", "/api/admin/programs/T100", { token: admin, json: { name: "=cmd" } })).status === 400 && (await call("PATCH", "/api/admin/programs/T100", { token: admin, json: { description: "x".repeat(301) } })).status === 400 && (await call("PATCH", "/api/admin/programs/T100", { token: admin, json: {} })).status === 400 && (await call("PATCH", "/api/admin/programs/T100", { token: admin, json: { active: "no" } })).status === 400);
  check("An empty name falls back to the code", (await call("PATCH", "/api/admin/programs/T100", { token: admin, json: { name: "" } })).body.name === "T100");
  await call("PATCH", "/api/programs/C300/dvps/UDVP-101-02", { token: admin, json: { completedStatus: "Done", remarks: "before archive" } });
  r = await call("PATCH", "/api/admin/programs/C300", { token: admin, json: { active: false } });
  check("Archiving works and its DVP count is kept", r.status === 200 && r.body.active === false && r.body.dvpCount === 135);
  check("An archived program disappears from the lists everyone uses", !(await call("GET", "/api/programs", { token: maya })).body.some((p) => p.code === "C300") && (await call("GET", "/api/programs/C300/dvps", { token: maya })).status === 404);
  check("...but the admin list still shows it, marked archived", (await call("GET", "/api/admin/programs", { token: admin })).body.find((p) => p.code === "C300")?.active === false);
  check("Its code can't be reused while archived", (await call("POST", "/api/admin/programs", { token: admin, json: { code: "C300" } })).status === 409);
  r = await call("PATCH", "/api/admin/programs/C300", { token: admin, json: { active: true } });
  const back = (await call("GET", "/api/programs/C300/dvps", { token: maya })).body.dvps.find((d) => d.code === "UDVP-101-02");
  check("Restoring brings it back with all its status and remarks intact", r.body.active === true && back.completedStatus === "Done" && back.remarks === "before archive");

  { // LOP tests live in their own scope so their helper names can't clash with the rest of this file
  section("LOP concerns");
  const LopEntry = require("../models/LopEntry");
  const lopDir = path.join(UPLOADS, "lop-images");
  const lopFiles = () => (fs.existsSync(lopDir) ? fs.readdirSync(lopDir) : []);
  const lopUrl = (program, code) => `/api/programs/${program}/dvps/${code}/lop`;
  const colour = (program, code, color) => call("PATCH", `/api/programs/${program}/dvps/${code}`, { token: maya, json: { color } });
  const raise = (fields, files = [], who = maya, program = "U171", code = "UDVP-101-02") => call("POST", lopUrl(program, code), { token: who, form: formOf(fields, files) });
  const good = { details: "Seat rail interferes with the pedal box at full recline.", casVersion: "CAS v2.4", cadVersion: "CAD model A12" };
  const history = async (program = "U171", code = "UDVP-101-02") => (await call("GET", lopUrl(program, code), { token: maya })).body;

  await colour("U171", "UDVP-101-02", "Red"); await colour("U171", "UDVP-102-01", "Green");
  check("Without signing in: reading and raising are both 401", (await call("GET", lopUrl("U171", "UDVP-101-02"))).status === 401 && (await call("POST", lopUrl("U171", "UDVP-101-02"), { form: formOf(good) })).status === 401);
  check("A DVP that isn't in the program, an unknown program and a malformed number are refused", (await call("GET", lopUrl("N200", "UDVP-101-02"), { token: maya })).status === 404 && (await call("GET", lopUrl("NOPE", "UDVP-101-02"), { token: maya })).status === 404 && (await call("GET", lopUrl("U171", "xx"), { token: maya })).status === 400);
  let h = await history();
  check("A Red DVP: LOP is enabled and the history is empty", h.enabled === true && h.color === "Red" && h.count === 0 && h.dvpNumber === "U171-UDVP-101-02");
  h = await history("U171", "UDVP-102-01");
  check("A Green DVP: LOP is not enabled", h.enabled === false && h.color === "Green");
  r = await raise(good, [], maya, "U171", "UDVP-102-01");
  check("Raising on a DVP that is not Red -> 409 that says why", r.status === 409 && /only be added while U171-UDVP-102-01 is marked Red/.test(r.body.message) && /marked Green/.test(r.body.message), r.body.message);

  r = await raise({ ...good, raisedBy: JSON.stringify({ name: "Somebody Else", role: "ADMIN" }), seq: "99", username: "forged" });
  check("A plain user can raise one; it is #1", r.status === 201 && r.body.seq === 1 && r.body.details === good.details && r.body.casVersion === "CAS v2.4" && r.body.cadVersion === "CAD model A12");
  check("Who raised it comes from the sign-in (name, username, role), not from what was sent", r.body.raisedBy.name === "Maya User" && r.body.raisedBy.username === "maya" && r.body.raisedBy.role === "USER", JSON.stringify(r.body.raisedBy));
  check("It carries its date and time", Boolean(r.body.createdAt) && Math.abs(Date.now() - new Date(r.body.createdAt).getTime()) < 60000);
  const first = r.body;

  section("LOP: refusing bad input");
  const lopBefore = (await history()).count;
  const refused = async (name, fields, files = []) => { const x = await raise(fields, files); check(name, x.status === 400, `got ${x.status}: ${x.body?.message}`); };
  await refused("Details missing", { ...good, details: "" }); await refused("Details only spaces", { ...good, details: "   " });
  await refused("Details over 4000 characters", { ...good, details: "x".repeat(4001) });
  await refused("Details starting with a formula character", { ...good, details: "=HYPERLINK(1)" });
  await refused("Details with a control character", { ...good, details: "a\u0000b" });
  await refused("Neither CAS nor CAD version", { details: "x", casVersion: "", cadVersion: "" });
  await refused("A version over 120 characters", { ...good, cadVersion: "v".repeat(121) });
  await refused("A version starting with a formula character", { ...good, casVersion: "@SUM(A1)" });
  check("Only a CAS version, or only a CAD version, is enough", (await raise({ details: "Only CAS given", casVersion: "CAS v1" })).status === 201 && (await raise({ details: "Only CAD given", cadVersion: "CAD B3" })).status === 201);
  check("Refused entries were not saved (only the 3 good ones exist)", (await history()).count === lopBefore + 2);

  section("LOP: images");
  r = await raise({ ...good, details: "With three pictures" }, [[PNG, "a.png", "image/png"], [JPG, "b.jpg", "image/jpeg"], [WEBP, "c.webp", "image/webp"]]);
  check("PNG + JPEG + WebP accepted", r.status === 201 && r.body.images.length === 3 && r.body.images.every((u) => /^\/api\/lop-images\/[a-f0-9]{24}-[123]\.(png|jpg|webp)$/.test(u)), JSON.stringify(r.body.images));
  const pic = r.body.images[0];
  check("A picture needs sign-in (401 without)", (await call("GET", pic)).status === 401);
  const got = await call("GET", pic, { token: maya }), got2 = await call("GET", r.body.images[1], { token: admin });
  check("Signed-in people get the exact bytes, as the right type, privately cached, nosniff", got.status === 200 && got.raw.equals(PNG) && got.headers.get("content-type") === "image/png" && got.headers.get("x-content-type-options") === "nosniff" && /private/.test(got.headers.get("cache-control")) && got2.raw.equals(JPG));
  check("A made-up or malformed picture name is a 404", (await call("GET", "/api/lop-images/ffffffffffffffffffffffff-1.png", { token: maya })).status === 404 && (await call("GET", "/api/lop-images/x.png", { token: maya })).status === 404 && (await call("GET", "/api/lop-images/..%2f..%2fserver.js", { token: maya })).status === 404);
  r = await raise({ ...good, details: "With the most pictures allowed" }, Array.from({ length: 4 }, (_, i) => [PNG, `m${i}.png`, "image/png"]));
  check("Four pictures (the limit) are accepted", r.status === 201 && r.body.images.length === 4 && lopFiles().length === 7, `${r.status} files=${lopFiles().length}`);
  const filesBefore = lopFiles().length, countBefore = (await history()).count;
  r = await raise(good, [[Buffer.from("this is only text, long enough to pass the length check, not a picture"), "fake.png", "image/png"]]);
  check("A text file renamed .png refused", r.status === 400 && /not a PNG, JPEG or WebP/.test(r.body.message));
  check("An SVG refused", (await raise(good, [[Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>' + " ".repeat(40)), "x.png", "image/png"]])).status === 400);
  r = await raise(good, [[PNG, "ok.png", "image/png"], [Buffer.from("not a picture at all, long enough to pass the length check"), "bad.png", "image/png"]]);
  check("One good + one fake: refused, and nothing was saved", r.status === 400 && lopFiles().length === filesBefore && (await history()).count === countBefore);
  r = await raise(good, Array.from({ length: 5 }, (_, i) => [PNG, `n${i}.png`, "image/png"]));
  check("5 pictures refused (limit is 4)", r.status === 400 && /at most 4/.test(r.body.message));
  r = await raise(good, [[Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024, 7)]), "big.png", "image/png"]]);
  check("A picture over 3 MB refused", r.status === 400 && /3 MB/.test(r.body.message) && lopFiles().length === filesBefore);

  section("LOP: history is added to, never replaced");
  h = await history();
  check("Newest first, numbered #5 down to #1, all still there", h.entries.map((e) => e.seq).join() === "5,4,3,2,1", h.entries.map((e) => e.seq).join());
  const firstNow = h.entries.find((e) => e.seq === 1);
  check("The first entry is exactly as it was written, after four more were added", JSON.stringify(firstNow) === JSON.stringify(first));
  r = await raise({ details: "Raised by the admin", cadVersion: "CAD model A13" }, [], admin);
  check("Another person's entry is recorded under their own name", r.status === 201 && r.body.seq === 6 && r.body.raisedBy.name === "Portal Admin" && r.body.raisedBy.role === "ADMIN");
  check("There is no way to edit or delete an entry through the API", (await call("PUT", lopUrl("U171", "UDVP-101-02") + "/" + first.id, { token: admin, json: { details: "x" } })).status === 404 && (await call("PATCH", lopUrl("U171", "UDVP-101-02") + "/" + first.id, { token: admin, json: { details: "x" } })).status === 404 && (await call("DELETE", lopUrl("U171", "UDVP-101-02") + "/" + first.id, { token: admin })).status === 404 && (await call("DELETE", lopUrl("U171", "UDVP-101-02"), { token: admin })).status === 404);
  await LopEntry.updateOne({ _id: first.id }, { $set: { details: "TAMPERED", "raisedBy.name": "Nobody" } });
  const afterTamper = (await history()).entries.find((e) => e.seq === 1);
  check("Even a direct update through the data layer can't change a saved entry", afterTamper.details === good.details && afterTamper.raisedBy.name === "Maya User", JSON.stringify(afterTamper));
  const rows = (await call("GET", "/api/programs/U171/dvps", { token: maya })).body.dvps;
  check("The program list says how many concerns each DVP has (6 here, 0 elsewhere)", rows.find((d) => d.code === "UDVP-101-02").lopCount === 6 && rows.filter((d) => d.code !== "UDVP-101-02").every((d) => d.lopCount === 0));
  check("Another program doesn't see them (same DVP in C300: none, not enabled)", await (async () => { const x = await history("C300", "UDVP-101-02"); return x.count === 0 && x.enabled === false; })());

  section("LOP: the DVP's colour changes");
  await colour("U171", "UDVP-101-02", "Green");
  h = await history();
  check("Marked Green: no new entries allowed, but all 6 stay readable", h.enabled === false && h.count === 6 && (await raise(good)).status === 409);
  await colour("U171", "UDVP-101-02", "Red");
  r = await raise({ details: "Raised again after being Red a second time", cadVersion: "CAD model A14" });
  check("Red again: the history carries on (#7), nothing was lost in between", r.status === 201 && r.body.seq === 7 && (await history()).count === 7);

  section("LOP: several people at the same moment");
  await colour("U171", "UDVP-102-02", "Red");
  const crowd = await Promise.all(Array.from({ length: 6 }, (_, i) => raise({ details: `Concurrent entry ${i}`, cadVersion: `CAD ${i}` }, [], i % 2 ? admin : maya, "U171", "UDVP-102-02")));
  check("Six people adding together: all saved", crowd.every((x) => x.status === 201), crowd.map((x) => x.status).join(","));
  check("...each with its own number 1 to 6, none repeated or skipped", crowd.map((x) => x.body.seq).sort((a, b) => a - b).join() === "1,2,3,4,5,6", crowd.map((x) => x.body.seq).join());

  }

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
