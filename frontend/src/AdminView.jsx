import { useEffect, useMemo, useState } from "react";
import { fetchCatalog, saveApplicability } from "./api.js";
import { useZones } from "./shared.jsx";

export default function AdminView({ programCode, programs, onSaved, onDirtyChange }) {
  const [catalog, setCatalog] = useState([]);
  const [saved, setSaved] = useState(() => new Set());     // what's in the database
  const [selected, setSelected] = useState(() => new Set()); // what's on screen
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [zone, setZone] = useState("All");
  const [show, setShow] = useState("All");
  const [query, setQuery] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchCatalog(programCode)
      .then((res) => {
        if (cancelled) return;
        const on = new Set(res.dvps.filter((d) => d.applicable).map((d) => d.code));
        setCatalog(res.dvps); setSaved(on); setSelected(new Set(on)); setStatus("ready");
      })
      .catch((err) => { if (!cancelled) { setError(err.message); setStatus("error"); } });
    return () => { cancelled = true; };
  }, [programCode]);

  const added = [...selected].filter((c) => !saved.has(c));
  const removed = [...saved].filter((c) => !selected.has(c));
  const dirty = added.length + removed.length > 0;

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const zones = useZones(catalog);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((d) =>
      (zone === "All" || d.zone.name === zone) &&
      (show === "All" || (show === "On" ? selected.has(d.code) : !selected.has(d.code))) &&
      (!q || [d.code, d.component, d.evaluationParameter].some((v) => (v || "").toLowerCase().includes(q))));
  }, [catalog, zone, show, query, selected]);

  const toggle = (code) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(code) ? next.delete(code) : next.add(code);
    return next;
  });
  const setVisible = (on) => setSelected((prev) => {
    const next = new Set(prev);
    visible.forEach((d) => (on ? next.add(d.code) : next.delete(d.code)));
    return next;
  });
  const allVisibleOn = visible.length > 0 && visible.every((d) => selected.has(d.code));

  const copy = async () => {
    if (!copyFrom) return;
    setBusy(true); setMessage(""); setError("");
    try {
      const res = await fetchCatalog(copyFrom);
      const on = res.dvps.filter((d) => d.applicable).map((d) => d.code);
      setSelected(new Set(on));
      setMessage(`Copied ${on.length} DVPs from ${copyFrom}. Review, then save to apply them to ${programCode}.`);
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const save = async () => {
    setBusy(true); setMessage(""); setError("");
    try {
      await saveApplicability(programCode, [...selected]);
      setSaved(new Set(selected));
      setMessage(`Saved. ${selected.size} DVPs now apply to ${programCode}.`);
      onSaved();
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  if (status === "loading") return <p className="notice" role="status">Loading the DVP catalog…</p>;
  if (status === "error") return <p className="notice notice-error" role="alert">{error}</p>;

  return (
    <>
      <p className="summary">
        Choose which DVPs apply to <strong>{programCode}</strong>. <strong>{selected.size}</strong> of {catalog.length} selected.
      </p>
      <p className="hint admin-hint">
        Switching a DVP off hides it from {programCode}. Its status, colour and remarks are kept and come back if you switch it on again.
      </p>

      <div className="savebar" aria-live="polite">
        <span>
          {dirty
            ? <>Unsaved changes: <strong>{added.length}</strong> to add, <strong>{removed.length}</strong> to remove.</>
            : "No unsaved changes."}
        </span>
        <div className="savebar-actions">
          <button type="button" className="btn" disabled={!dirty || busy} onClick={() => { setSelected(new Set(saved)); setMessage(""); }}>Discard changes</button>
          <button type="button" className="btn btn-primary" disabled={!dirty || busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
      {message && <p className="notice" role="status">{message}</p>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}

      <div className="filters">
        <label><span>Zone</span>
          <select value={zone} onChange={(e) => setZone(e.target.value)}>
            <option>All</option>{zones.map((z) => <option key={z}>{z}</option>)}
          </select>
        </label>
        <label><span>Show</span>
          <select value={show} onChange={(e) => setShow(e.target.value)}>
            <option value="All">All DVPs</option><option value="On">Switched on</option><option value="Off">Switched off</option>
          </select>
        </label>
        <label className="search"><span>Search</span>
          <input type="search" value={query} placeholder="DVP code, component or evaluation" onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label><span>Copy selection from</span>
          <span className="inline-group">
            <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
              <option value="">Choose program</option>
              {programs.filter((p) => p.code !== programCode).map((p) => <option key={p.code} value={p.code}>{p.code} ({p.dvpCount})</option>)}
            </select>
            <button type="button" className="btn" disabled={!copyFrom || busy} onClick={copy}>Copy</button>
          </span>
        </label>
      </div>

      <div className="table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col" className="col-switch">
                <label className="switch" title={allVisibleOn ? "Switch off all shown" : "Switch on all shown"}>
                  <input type="checkbox" checked={allVisibleOn} onChange={() => setVisible(!allVisibleOn)}
                    aria-label={`${allVisibleOn ? "Switch off" : "Switch on"} all ${visible.length} DVPs shown`} />
                  <span aria-hidden="true" />
                </label>
              </th>
              <th scope="col">DVP code</th>
              <th scope="col">Component</th>
              <th scope="col">Evaluation</th>
              <th scope="col">Zone</th>
              <th scope="col">Ergonomic area</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((d) => {
              const on = selected.has(d.code);
              const changed = on !== saved.has(d.code);
              return (
                <tr key={d.code} className={`row ${on ? "" : "row-off"} ${changed ? "row-changed" : ""}`} onClick={() => toggle(d.code)}>
                  <td className="col-switch" onClick={(e) => e.stopPropagation()}>
                    <label className="switch">
                      <input type="checkbox" checked={on} onChange={() => toggle(d.code)}
                        aria-label={`${d.code} ${d.component} ${d.evaluationParameter}: ${on ? "on" : "off"}`} />
                      <span aria-hidden="true" />
                    </label>
                  </td>
                  <td className="code">{d.code}{changed && <span className="changed-mark"> {on ? "added" : "removed"}</span>}</td>
                  <td>{d.component}</td>
                  <td>{d.evaluationParameter}</td>
                  <td>{d.zone.name}</td>
                  <td>{d.ergonomicsArea}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {visible.length === 0 && <p className="notice">No DVPs match these filters.</p>}
    </>
  );
}
