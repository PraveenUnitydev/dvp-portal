import { useEffect, useState } from "react";
import { createProgram, fetchAdminPrograms, updateProgram } from "./api.js";

// Admin: the list of vehicle programs. Add one, rename one, or archive one (hides it everywhere but keeps all its
// data, and it can be restored). The code can't change: it is part of every DVP number.
export default function ProgramsView({ onCreated, onManage }) {
  const [all, setAll] = useState([]);
  const [status, setStatus] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [made, setMade] = useState(null);

  const [editCode, setEditCode] = useState(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [rowError, setRowError] = useState("");

  const load = () => fetchAdminPrograms()
    .then((list) => { setAll(list); setStatus("ready"); })
    .catch((err) => { setLoadError(err.message); setStatus("error"); });
  useEffect(() => { load(); }, []);

  const active = all.filter((p) => p.active);
  const archived = all.filter((p) => !p.active);
  const shown = showArchived ? all : active;

  const valid = /^[A-Z0-9]{2,12}$/.test(code);
  const clash = all.some((p) => p.code === code);
  const reset = () => { setCode(""); setName(""); setDescription(""); setCopyFrom(""); setError(""); };
  const changed = () => { load(); onCreated(); };

  const add = async (e) => {
    e.preventDefault();
    if (!valid) { setError("The program code must be 2-12 letters or digits, for example S302."); return; }
    if (clash) { setError(`Program ${code} already exists${all.find((p) => p.code === code && !p.active) ? " (archived)" : ""}.`); return; }
    setBusy(true); setError("");
    try {
      const created = await createProgram({ code, name: name.trim(), description: description.trim(), copyFrom });
      setMade(created); setFlash(""); setAdding(false); reset(); changed();
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const startEdit = (p) => { setEditCode(p.code); setEditName(p.name === p.code ? "" : p.name); setEditDesc(p.description); setRowError(""); };
  const saveEdit = async (p) => {
    setRowError("");
    try {
      await updateProgram(p.code, { name: editName.trim(), description: editDesc.trim() });
      setEditCode(null); setMade(null); setFlash(`Saved ${p.code}.`); changed();
    } catch (err) { setRowError(err.message); }
  };
  const setActive = async (p, value) => {
    if (!value && !window.confirm(`Archive ${p.code}? It disappears from the program list for everyone. Its DVPs, status and remarks are kept, and you can restore it.`)) return;
    setRowError("");
    try {
      await updateProgram(p.code, { active: value });
      setMade(null); setFlash(value ? `Restored ${p.code}.` : `Archived ${p.code}.`); changed();
    } catch (err) { setRowError(err.message); }
  };

  if (status === "loading") return <p className="notice" role="status">Loading programs…</p>;
  if (status === "error") return <p className="notice notice-error" role="alert">{loadError}</p>;

  return (
    <>
      <div className="toolbar">
        <p className="summary"><strong>{active.length}</strong> vehicle program{active.length === 1 ? "" : "s"}{archived.length ? `, ${archived.length} archived` : ""}.</p>
        {!adding && <button type="button" className="btn btn-primary" onClick={() => { setMade(null); setFlash(""); setAdding(true); }}>Add program</button>}
      </div>

      {made && (
        <p className="flash" role="status">
          Added program {made.code}{made.dvpCount ? ` with ${made.dvpCount} DVPs switched on` : ""}.{" "}
          <button type="button" className="link-btn" onClick={() => onManage(made.code)}>{made.dvpCount ? "Review its DVPs" : "Choose its DVPs"}</button>
        </p>
      )}
      {!made && <p className="flash" role="status">{flash}</p>}
      {rowError && <p className="notice notice-error" role="alert">{rowError}</p>}

      {adding && (
        <form className="card" onSubmit={add} noValidate>
          <h2>New program</h2>
          <div className="form-grid">
            <label className="field"><span>Program code *</span>
              <input value={code} maxLength={12} autoFocus placeholder="e.g. S302"
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
              <small className="hint">2-12 letters or digits. It appears in every DVP number, e.g. {code || "S302"}-UDVP-101-01. It can't be changed later.</small>
            </label>
            <label className="field"><span>Name</span>
              <input value={name} maxLength={60} placeholder="Optional. Defaults to the code" onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field wide"><span>Description</span>
              <input value={description} maxLength={300} placeholder="Optional" onChange={(e) => setDescription(e.target.value)} />
            </label>
            <label className="field"><span>Start with the DVPs of</span>
              <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                <option value="">None (choose them afterwards)</option>
                {active.map((p) => <option key={p.code} value={p.code}>{p.code} ({p.dvpCount} DVPs)</option>)}
              </select>
              <small className="hint">Copies which DVPs apply. Status, colour and remarks are not copied.</small>
            </label>
          </div>
          <small className="hint">Text can't start with =, + , - or @ (spreadsheets read these as formulas).</small>
          {error && <p className="notice notice-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !code}>{busy ? "Adding…" : "Add program"}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => { setAdding(false); reset(); }}>Cancel</button>
          </div>
        </form>
      )}

      {archived.length > 0 && (
        <label className="check-list"><span><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived programs ({archived.length})</span></label>
      )}

      <div className="table-wrap">
        <table className="programs-table">
          <thead>
            <tr><th scope="col">Program</th><th scope="col">Name</th><th scope="col">Description</th><th scope="col">DVPs</th><th scope="col">Done</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr>
          </thead>
          <tbody>
            {shown.map((p) => (editCode === p.code ? (
              <tr key={p.code} className="row row-edit">
                <td className="col-num"><strong>{p.code}</strong></td>
                <td><input aria-label={`Name of ${p.code}`} value={editName} maxLength={60} placeholder={p.code} onChange={(e) => setEditName(e.target.value)} /></td>
                <td><input aria-label={`Description of ${p.code}`} value={editDesc} maxLength={300} onChange={(e) => setEditDesc(e.target.value)} /></td>
                <td>{p.dvpCount}</td><td>{p.doneCount} of {p.dvpCount}</td>
                <td><div className="cell-actions">
                  <button type="button" className="link-btn" onClick={() => saveEdit(p)}>Save</button>
                  <button type="button" className="link-btn" onClick={() => { setEditCode(null); setRowError(""); }}>Cancel</button>
                </div></td>
              </tr>
            ) : (
              <tr key={p.code} className={`row ${p.active ? "" : "archived-row"}`}>
                <td className="col-num"><strong>{p.code}</strong>{!p.active && <small className="muted"> archived</small>}</td>
                <td>{p.name && p.name !== p.code ? p.name : <span className="muted">—</span>}</td>
                <td>{p.description || <span className="muted">—</span>}</td>
                <td>{p.dvpCount}</td>
                <td>{p.doneCount} of {p.dvpCount}</td>
                <td><div className="cell-actions">
                  {p.active ? (
                    <>
                      <button type="button" className="link-btn" onClick={() => onManage(p.code)}>Choose DVPs</button>
                      <button type="button" className="link-btn" onClick={() => startEdit(p)}>Edit</button>
                      <button type="button" className="link-btn" onClick={() => setActive(p, false)}>Archive</button>
                    </>
                  ) : (
                    <button type="button" className="link-btn" onClick={() => setActive(p, true)}>Restore</button>
                  )}
                </div></td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </>
  );
}
