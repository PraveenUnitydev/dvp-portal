/**
 * Microsoft sign-in through VRSP, and the Users admin - with mock data and a stand-in VRSP. No MongoDB needed.
 *   npm run test:sso
 */
const crypto = require("crypto");
const http = require("http");

const SECRET = crypto.randomBytes(36).toString("base64url");
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.SSO_VRSP_URL = "https://vrc.example.com/";
process.env.SSO_APP_NAME = "dvp";
process.env.SSO_APP_SECRET = SECRET;
process.env.ADMIN_EMAILS = "Boss@Mahindra.com; second@mahindra.com";

const express = require("express");
const jwt = require("jsonwebtoken");
const { User, Setting } = require("./mockDb");
const sso = require("../utils/sso");
const settingsUtil = require("../utils/settings");

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? `   [${detail}]` : ""}`); };

// ── stand-in VRSP: hands out identities for one-time codes, like VRSP's /api/auth/app-exchange ──
const codes = new Map();
let vrspCalls = 0;
const vrsp = express();
vrsp.use(express.json());
vrsp.post("/api/auth/app-exchange", (req, res) => {
  vrspCalls++;
  if (req.get("X-SSO-App") !== "dvp" || req.get("X-SSO-Secret") !== SECRET) return res.status(401).json({ message: "Unknown app or wrong secret." });
  const id = codes.get(req.body.code);
  codes.delete(req.body.code);
  if (!id) return res.status(400).json({ message: "The sign-in code has expired or was already used. Sign in again." });
  res.json({ identity: id });
});
const codeFor = (identity) => { const c = crypto.randomBytes(32).toString("hex"); codes.set(c, identity); return c; };

const app = express();
app.use(express.json());
app.use("/api/auth", require("../routes/auth"));
app.use("/api/admin", require("../routes/admin"));
app.use("/api", require("../routes/settings"));
app.use("/api", require("../routes/users"));
app.use("/api/programs", require("../routes/programs"));

(async () => {
  const vrspServer = vrsp.listen(0);
  process.env.SSO_VRSP_INTERNAL_URL = `http://127.0.0.1:${vrspServer.address().port}`;
  const server = app.listen(0);
  const port = server.address().port;
  const call = (method, path, { token, json } = {}) => new Promise((resolve, reject) => {
    const body = json === undefined ? null : Buffer.from(JSON.stringify(json));
    const req = http.request({ host: "127.0.0.1", port, path, method, agent: false,
      headers: { Connection: "close", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json", "Content-Length": body.length } : {}) } }, (res) => {
      let data = ""; res.setEncoding("utf8"); res.on("data", (c) => (data += c));
      res.on("end", () => { let j = null; try { j = JSON.parse(data); } catch { /* not JSON */ } resolve({ status: res.statusCode, location: res.headers.location || "", body: j }); });
    });
    req.on("error", reject); req.end(body || undefined);
  });
  const signIn = (identity) => call("POST", "/api/auth/sso-exchange", { json: { code: codeFor(identity) } });
  const person = (email, name, extra = {}) => ({ email, emails: [email], name, jobTitle: "Engineer", department: "VR Lab", ...extra });
  const userBy = (email) => User.rows.find((u) => (u.emails || []).includes(email));

  try {
    // ── set-up ─────────────────────────────────────────────────────
    check("config: on when URL and a 32+ character secret are set; start URL to VRSP with ?app=",
      sso.config().enabled && sso.config().startUrl === "https://vrc.example.com/api/auth/sso?app=dvp");
    check("config: off without a secret (or a short one)", !sso.config({ SSO_VRSP_URL: "https://x" }).enabled && !sso.config({ SSO_VRSP_URL: "https://x", SSO_APP_SECRET: "short" }).enabled);
    check("sso-config tells the login page", (await call("GET", "/api/auth/sso-config")).body.enabled === true);
    const start = await call("GET", "/api/auth/sso-start");
    check("sso-start sends the browser to VRSP's Microsoft sign-in", start.status === 302 && start.location === "https://vrc.example.com/api/auth/sso?app=dvp");

    // ── refusals ───────────────────────────────────────────────────
    check("exchange: a malformed code is refused without calling VRSP", (await call("POST", "/api/auth/sso-exchange", { json: { code: "abc" } })).status === 400 && vrspCalls === 0);
    check("exchange: a code VRSP doesn't know -> 400", (await call("POST", "/api/auth/sso-exchange", { json: { code: "a".repeat(64) } })).status === 400);
    process.env.SSO_APP_SECRET = "w".repeat(40);
    const wrong = await signIn(person("x@mahindra.com", "X"));
    process.env.SSO_APP_SECRET = SECRET;
    check("exchange: wrong secret -> 502 'not set up correctly' (not the person's fault)", wrong.status === 502 && wrong.body.message.includes("not set up correctly"));
    const realUrl = process.env.SSO_VRSP_INTERNAL_URL;
    process.env.SSO_VRSP_INTERNAL_URL = "http://127.0.0.1:1";
    const down = await call("POST", "/api/auth/sso-exchange", { json: { code: "b".repeat(64) } });
    process.env.SSO_VRSP_INTERNAL_URL = realUrl;
    check("exchange: VRSP unreachable -> 502 'try again'", down.status === 502 && down.body.message.includes("could not be reached"));

    // ── first admins ───────────────────────────────────────────────
    const boss = await signIn(person("boss@mahindra.com", "Big Boss"));
    check("ADMIN_EMAILS: first sign-in is an admin straight away", boss.status === 200 && boss.body.user.role === "ADMIN" && boss.body.user.source === "sso" && typeof boss.body.token === "string");
    const BOSS = boss.body.token;
    check("the token works for the portal", (await call("GET", "/api/auth/me", { token: BOSS })).body.user.email === "boss@mahindra.com");
    check("a Microsoft account has no password: local sign-in refused", (await call("POST", "/api/auth/login", { json: { username: "boss@mahindra.com", password: "anything-at-all" } })).status === 401);

    // ── someone new: waits for approval ────────────────────────────
    const asha1 = await signIn(person("25011111@mahindra.com", "Asha R", { emails: ["25011111@mahindra.com", "asha.r@mahindra.com"] }));
    check("new person (setting off): waits for approval (403 pending), account created", asha1.status === 403 && asha1.body.pending === true && userBy("asha.r@mahindra.com")?.pending === true);
    const asha2 = await signIn(person("25011111@mahindra.com", "Asha R"));
    check("signing in again while waiting: still waiting, no second account", asha2.body.pending === true && User.rows.filter((u) => (u.emails || []).includes("25011111@mahindra.com")).length === 1);
    const list = await call("GET", "/api/admin/users", { token: BOSS });
    check("Users list: waiting people first; no password fields", list.status === 200 && list.body.users[0].email === "25011111@mahindra.com" && list.body.users[0].pending && !("passwordHash" in list.body.users[0]));
    const ashaId = list.body.users[0].id;
    const approve = await call("PATCH", `/api/admin/users/${ashaId}`, { token: BOSS, json: { active: true } });
    check("approve: active and no longer waiting", approve.status === 200 && approve.body.active && !approve.body.pending);
    const asha3 = await signIn(person("asha.r@mahindra.com", "Asha R"));
    check("approved: signs in as User (found by her other email)", asha3.status === 200 && asha3.body.user.role === "USER");
    const ASHA = asha3.body.token;
    check("a User can't open the Users list", (await call("GET", "/api/admin/users", { token: ASHA })).status === 403);

    // ── turning access off ────────────────────────────────────────
    await call("PATCH", `/api/admin/users/${ashaId}`, { token: BOSS, json: { active: false } });
    check("access off: her current session stops at once", (await call("GET", "/api/programs", { token: ASHA })).status === 401);
    const off = await signIn(person("asha.r@mahindra.com", "Asha R"));
    check("access off: signing in says so", off.status === 403 && off.body.message.includes("turned off") && !off.body.pending);

    // ── setting: first-time sign-ins get in ───────────────────────
    await call("PUT", "/api/admin/settings", { token: BOSS, json: { values: { ssoNewUsersGetAccess: true } } });
    const ravi = await signIn(person("ravi@mahindra.com", "Ravi"));
    check("setting on: a new person gets User access straight away", ravi.status === 200 && ravi.body.user.role === "USER");
    await call("PUT", "/api/admin/settings", { token: BOSS, json: { values: { ssoNewUsersGetAccess: false } } });

    // ── roles and the admin safety rules ───────────────────────────
    const bossId = User.rows.find((u) => u.username === "boss@mahindra.com")._id.toString();
    check("an admin can't remove their own admin role or access", (await call("PATCH", `/api/admin/users/${bossId}`, { token: BOSS, json: { role: "USER" } })).status === 400 && (await call("PATCH", `/api/admin/users/${bossId}`, { token: BOSS, json: { active: false } })).status === 400);
    const raviId = User.rows.find((u) => u.username === "ravi@mahindra.com")._id.toString();
    const promote = await call("PATCH", `/api/admin/users/${raviId}`, { token: BOSS, json: { role: "ADMIN" } });
    check("make someone an admin", promote.status === 200 && promote.body.role === "ADMIN");
    const RAVI = (await signIn(person("ravi@mahindra.com", "Ravi"))).body.token;
    check("the new admin can demote the first (another admin remains)", (await call("PATCH", `/api/admin/users/${bossId}`, { token: RAVI, json: { role: "USER" } })).status === 200);
    const back = await signIn(person("boss@mahindra.com", "Big Boss"));
    check("ADMIN_EMAILS: signing in restores admin (the way back in)", back.body.user.role === "ADMIN");
    check("bad values 400, unknown/bad id 404",
      (await call("PATCH", `/api/admin/users/${raviId}`, { token: BOSS, json: { role: "OWNER" } })).status === 400 &&
      (await call("PATCH", `/api/admin/users/${raviId}`, { token: BOSS, json: { active: "yes" } })).status === 400 &&
      (await call("PATCH", `/api/admin/users/${raviId}`, { token: BOSS, json: {} })).status === 400 &&
      (await call("PATCH", "/api/admin/users/nope", { token: BOSS, json: { role: "USER" } })).status === 404 &&
      (await call("PATCH", `/api/admin/users/${"0".repeat(24)}`, { token: BOSS, json: { role: "USER" } })).status === 404);

    // the local admin from the mock data still signs in with a token issued the old way
    const localAdmin = User.rows.find((u) => u.username === "admin");
    check("existing local accounts keep working", (await call("GET", "/api/auth/me", { token: jwt.sign({ id: String(localAdmin._id) }, process.env.JWT_SECRET) })).status === 200);
    check("the setting is listed on the Settings page", (await call("GET", "/api/settings", { token: BOSS })).body.settings.some((s) => s.key === "ssoNewUsersGetAccess" && s.group === "Sign-in"));
    void Setting; void settingsUtil;
  } catch (e) {
    fail++; console.log("FAIL exception", e);
  } finally {
    console.log(`\nPassed ${pass} | Failed ${fail}`);
    process.exitCode = fail ? 1 : 0;
    server.closeAllConnections?.(); server.close();
    vrspServer.closeAllConnections?.(); vrspServer.close();
  }
})();
