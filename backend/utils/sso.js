// Microsoft sign-in through VRSP (see VRSP backend/utils/ssoApps.js). The browser is sent to VRSP, which signs the
// person in with Microsoft and sends them back to <this portal>/login?sso_code=...; this server then collects the
// person's identity from VRSP, server to server, with the shared secret.
//
// backend/.env:
//   SSO_VRSP_URL=https://vrc.mahindra.com            VRSP as the browser sees it
//   SSO_VRSP_INTERNAL_URL=http://127.0.0.1:7000      VRSP as this server reaches it (default: SSO_VRSP_URL)
//   SSO_APP_NAME=dvp                                 the name this portal has in VRSP's SSO_APPS
//   SSO_APP_SECRET=...                               the same value as VRSP's SSO_APP_DVP_SECRET
//   ADMIN_EMAILS=a@mahindra.com,b@mahindra.com       always admins (and never wait for approval)

const clean = (u) => String(u || "").trim().replace(/\/+$/, "");

function config(env = process.env) {
  const vrspUrl = clean(env.SSO_VRSP_URL);
  const internalUrl = clean(env.SSO_VRSP_INTERNAL_URL) || vrspUrl;
  const app = String(env.SSO_APP_NAME || "dvp").trim().toLowerCase();
  const secret = String(env.SSO_APP_SECRET || "");
  const enabled = Boolean(vrspUrl && internalUrl && app && secret.length >= 32);
  return { enabled, vrspUrl, internalUrl, app, secret, startUrl: enabled ? `${vrspUrl}/api/auth/sso?app=${encodeURIComponent(app)}` : "" };
}

const adminEmails = (env = process.env) =>
  new Set(String(env.ADMIN_EMAILS || "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean));

/** Collect the identity for a one-time code from VRSP: { identity } or { error, status }. */
async function collect(code, { fetchImpl = fetch, env = process.env } = {}) {
  const c = config(env);
  if (!c.enabled) return { status: 503, error: "Microsoft sign-in is not set up on this server." };
  if (!/^[a-f0-9]{64}$/.test(String(code || ""))) return { status: 400, error: "The sign-in link is not valid. Sign in again." };
  let res;
  try {
    res = await fetchImpl(`${c.internalUrl}/api/auth/app-exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-SSO-App": c.app, "X-SSO-Secret": c.secret },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    console.error("SSO: VRSP could not be reached:", err.message);
    return { status: 502, error: "The sign-in service could not be reached. Try again in a moment." };
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    console.error("SSO: VRSP refused this portal's name or secret - check SSO_APP_NAME / SSO_APP_SECRET against VRSP's SSO_APPS settings");
    return { status: 502, error: "Microsoft sign-in is not set up correctly on the server. Ask an admin." };
  }
  if (!res.ok || !data.identity) return { status: 400, error: data.message || "The sign-in has expired. Sign in again." };
  const id = data.identity;
  const emails = [...new Set([id.email, ...(id.emails || [])].map((e) => String(e || "").trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+$/.test(e)))];
  if (!emails.length) return { status: 400, error: "Your Microsoft account has no email address." };
  return { identity: { email: emails[0], emails, name: String(id.name || emails[0]).slice(0, 120), jobTitle: String(id.jobTitle || "").slice(0, 120), department: String(id.department || "").slice(0, 120) } };
}

module.exports = { config, adminEmails, collect };
