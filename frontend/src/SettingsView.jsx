import { useEffect, useMemo, useState } from "react";
import { fetchSettings, saveSettings } from "./api.js";

const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "");
const show = (s, v) => (s.type === "boolean" ? (v ? "On" : "Off") : `${v} ${s.unit || ""}`.trim());

// Admin: the portal's rules and limits. The page is built from the list the server sends, so a setting added on the
// server appears here without a change to this page. Every value is checked again by the server when saved.
export default function SettingsView({ onSaved }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});           // key -> value as edited (numbers kept as text while typing)
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState("");

  const take = (r) => { setData(r); setDraft(Object.fromEntries(r.settings.map((s) => [s.key, s.type === "number" ? String(s.value) : s.value]))); };
  useEffect(() => {
    fetchSettings().then((r) => { take(r); setStatus("ready"); }).catch((e) => { setError(e.message); setStatus("error"); });
  }, []);

  const groups = useMemo(() => {
    const m = new Map();
    (data?.settings || []).forEach((s) => { if (!m.has(s.group)) m.set(s.group, []); m.get(s.group).push(s); });
    return [...m.entries()];
  }, [data]);

  const problemOf = (s) => {
    if (s.type !== "number") return "";
    const raw = String(draft[s.key] ?? "").trim();
    const n = Number(raw);
    return raw === "" || !Number.isInteger(n) || n < s.min || n > s.max ? `A whole number from ${s.min} to ${s.max}.` : "";
  };
  const valueOf = (s) => (s.type === "number" ? Number(draft[s.key]) : draft[s.key]);
  const changed = (data?.settings || []).filter((s) => !problemOf(s) && valueOf(s) !== s.value);
  const problems = (data?.settings || []).filter((s) => problemOf(s));

  const save = async (e) => {
    e.preventDefault();
    if (problems.length) { setError("Fix the highlighted values first."); return; }
    if (!changed.length) return;
    setBusy(true); setError(""); setFlash("");
    try {
      const r = await saveSettings(Object.fromEntries(changed.map((s) => [s.key, valueOf(s)])));
      take(r); onSaved(r.values);
      setFlash(`Saved ${changed.length} change${changed.length === 1 ? "" : "s"}. They apply straight away.`);
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  if (status === "loading") return <p className="notice" role="status">Loading settings…</p>;
  if (status === "error") return <p className="notice notice-error" role="alert">{error}</p>;

  return (
    <form className="settings" onSubmit={save} noValidate>
      <div className="toolbar">
        <p className="summary">
          Rules and limits for the whole portal. Admins can always do everything; the switches decide what users can do.
          {data.updatedBy && <span className="muted"> Last changed by {data.updatedBy} on {when(data.updatedAt)}.</span>}
        </p>
      </div>
      <p className="flash" role="status">{flash}</p>

      {groups.map(([group, list]) => (
        <section key={group} className="card settings-card" aria-labelledby={`g-${group}`}>
          <h2 id={`g-${group}`}>{group}</h2>
          {list.map((s) => {
            const problem = problemOf(s);
            const isDefault = !problem && valueOf(s) === s.default;
            const dirty = !problem && valueOf(s) !== s.value;
            return (
              <div key={s.key} className={`setting ${dirty ? "setting-dirty" : ""}`}>
                {s.type === "boolean" ? (
                  <label className="setting-main switch-row">
                    <input type="checkbox" role="switch" checked={Boolean(draft[s.key])} disabled={busy}
                      onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.checked }))} />
                    <span className="switch" aria-hidden="true" />
                    <span className="setting-label">{s.label}</span>
                  </label>
                ) : (
                  <label className="setting-main">
                    <span className="setting-label">{s.label}</span>
                    <span className="num-field">
                      <input type="number" inputMode="numeric" min={s.min} max={s.max} step={1} value={draft[s.key]} disabled={busy}
                        aria-invalid={Boolean(problem)} onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))} />
                      <span className="muted">{s.unit}</span>
                    </span>
                  </label>
                )}
                <div className="setting-help">
                  {problem ? <span className="t-red">{problem}</span> : s.help && <span>{s.help}</span>}
                  <span className="muted">
                    {isDefault ? "Default" : `Default: ${show(s, s.default)}`}
                    {s.type === "number" && ` · ${s.min}–${s.max}`}
                  </span>
                  {!isDefault && (
                    <button type="button" className="link-btn" disabled={busy}
                      onClick={() => setDraft((d) => ({ ...d, [s.key]: s.type === "number" ? String(s.default) : s.default }))}>Use default</button>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      ))}

      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <div className="settings-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !changed.length || problems.length > 0}>
          {busy ? "Saving…" : changed.length ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}` : "No changes"}
        </button>
        {changed.length > 0 && <button type="button" className="btn" disabled={busy} onClick={() => take(data)}>Undo changes</button>}
      </div>
    </form>
  );
}
