// Settings an admin can change on the Settings page, with their defaults and allowed ranges. Everything that reads a
// setting goes through get(), so a change applies at once, with no restart.
const Setting = require("../models/Setting");

const envNumber = (name, fallback) => (Number(process.env[name]) > 0 ? Number(process.env[name]) : fallback);

// type, default, and for numbers min / max / unit. `group` and the texts are what the Settings page shows.
const DEFS = {
  ssoNewUsersGetAccess: {
    group: "Sign-in", type: "boolean", default: false,
    label: "People signing in with Microsoft for the first time get User access straight away",
    help: "Off: they wait until an admin approves them on the Users tab. Emails in ADMIN_EMAILS are always admins.",
  },
  usersCanEditDvps: {
    group: "Who can do what", type: "boolean", default: true,
    label: "Users can change a DVP's colour and remarks",
    help: "Off: only admins can. Users can still see everything.",
  },
  usersCanRaiseLop: {
    group: "Who can do what", type: "boolean", default: true,
    label: "Users can raise LOP concerns",
    help: "Off: only admins can add LOP entries. Everyone can still read the history.",
  },
  usersCanAddObservations: {
    group: "Who can do what", type: "boolean", default: true,
    label: "Users can add observation images",
  },
  usersCanRemoveOwnObservations: {
    group: "Who can do what", type: "boolean", default: true,
    label: "Users can remove observation images they added",
    help: "Admins can always remove any observation image.",
  },
  observationMaxPerDvp: {
    group: "Observation images", type: "number", default: envNumber("OBSERVATION_MAX_IMAGES", 12), min: 1, max: 50, unit: "images",
    label: "Most observation images per DVP (in each program)",
    help: "Lowering it doesn't remove images already added; it only stops new ones above the limit.",
  },
  observationMaxMb: {
    group: "Observation images", type: "number", default: 5, min: 1, max: 20, unit: "MB",
    label: "Largest observation image",
  },
  lopMaxImages: {
    group: "LOP concerns", type: "number", default: 4, min: 0, max: 10, unit: "pictures",
    label: "Most pictures per LOP entry", help: "0 turns pictures off for new entries.",
  },
  lopMaxMb: {
    group: "LOP concerns", type: "number", default: 3, min: 1, max: 20, unit: "MB",
    label: "Largest LOP picture",
  },
  vrReportMaxMb: {
    group: "VR reports", type: "number", default: envNumber("VR_REPORT_MAX_MB", 200), min: 1, max: 2000, unit: "MB",
    label: "Largest VR report file",
    help: "The web server in front of the portal (Nginx client_max_body_size) must allow at least this much.",
  },
  reportObservationsPerDvp: {
    group: "Reports", type: "number", default: 6, min: 0, max: 24, unit: "images",
    label: "Observation images per DVP in the program PowerPoint",
    help: "Keeps a program deck a sensible size. The single-DVP report always has all of them. 0 leaves them out.",
  },
};

const defaults = () => Object.fromEntries(Object.entries(DEFS).map(([k, d]) => [k, d.default]));

/** One value checked against its definition: { value } or { error }. */
function check(key, raw) {
  const d = DEFS[key];
  if (!d) return { error: `Unknown setting "${key}".` };
  if (d.type === "boolean") {
    if (typeof raw !== "boolean") return { error: `"${d.label}" must be on or off.` };
    return { value: raw };
  }
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < d.min || n > d.max) return { error: `"${d.label}" must be a whole number from ${d.min} to ${d.max}.` };
  return { value: n };
}

// Stored values pass the same check before use: a value from an older version that is no longer valid is ignored
function merge(stored) {
  const out = defaults();
  for (const [k, v] of Object.entries(stored || {})) {
    const r = DEFS[k] ? check(k, v) : null;
    if (r && !r.error) out[k] = r.value;
  }
  return out;
}

// Read often (on every upload), changed rarely: kept for a few seconds, and dropped as soon as an admin saves
const CACHE_MS = 5000;
let cache = null;

async function load() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.doc;
  const row = await Setting.findOne({ key: "app" }).lean();
  const doc = { values: merge(row?.values), updatedBy: row?.updatedBy || "", updatedAt: row?.updatedAt || null };
  cache = { at: Date.now(), doc };
  return doc;
}

/** The current settings (defaults where nothing is stored). */
async function get() { return (await load()).values; }

/** Save some settings. `changes` is { key: value }; every one is checked before anything is written. */
async function save(changes, user) {
  if (!changes || typeof changes !== "object" || Array.isArray(changes) || Object.keys(changes).length === 0) return { error: "Nothing to save." };
  const checked = {};
  for (const [k, v] of Object.entries(changes)) {
    const r = check(k, v);
    if (r.error) return { error: r.error };
    checked[k] = r.value;
  }
  const row = await Setting.findOne({ key: "app" }).lean();
  // Only values that differ from the default are stored, so a later change of a default reaches untouched settings
  const values = { ...(row?.values || {}), ...checked };
  const base = defaults();
  for (const k of Object.keys(values)) if (!DEFS[k] || values[k] === base[k]) delete values[k];
  await Setting.findOneAndUpdate({ key: "app" }, { $set: { values, updatedBy: user?.name || "" } }, { upsert: true, new: true, runValidators: true });
  cache = null;
  return { doc: await load() };
}

/** For the Settings page: every setting with its definition, current value and default. */
function describe(doc) {
  return {
    settings: Object.entries(DEFS).map(([key, d]) => ({ key, ...d, value: doc.values[key] })),
    values: doc.values,
    updatedBy: doc.updatedBy,
    updatedAt: doc.updatedAt,
  };
}

const resetCache = () => { cache = null; };

module.exports = { DEFS, defaults, check, merge, get, save, describe, load, resetCache };
