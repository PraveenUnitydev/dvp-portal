import { useState } from "react";
import { createProgram } from "./api.js";

// Admin: the list of vehicle programs, and adding a new one
export default function ProgramsView({ programs, onCreated, onManage }) {
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [made, setMade] = useState(null);       // the program just created

  const valid = /^[A-Z0-9]{2,12}$/.test(code);
  const clash = programs.some((p) => p.code === code);
  const reset = () => { setCode(""); setName(""); setDescription(""); setCopyFrom(""); setError(""); };

  const save = async (e) => {
    e.preventDefault();
    if (!valid) { setError("The program code must be 2-12 letters or digits, for example S302."); return; }
    if (clash) { setError(`Program ${code} already exists.`); return; }
    setBusy(true); setError("");
    try {
      const created = await createProgram({ code, name: name.trim(), description: description.trim(), copyFrom });
      setMade(created); setAdding(false); reset();
      onCreated();
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  return (
    <>
      <div className="toolbar">
        <p className="summary"><strong>{programs.length}</strong> vehicle program{programs.length === 1 ? "" : "s"}.</p>
        {!adding && <button type="button" className="btn btn-primary" onClick={() => { setMade(null); setAdding(true); }}>Add program</button>}
      </div>

      {made && (
        <p className="flash" role="status">
          Added program {made.code}{made.dvpCount ? ` with ${made.dvpCount} DVPs switched on` : ""}.{" "}
          <button type="button" className="link-btn" onClick={() => onManage(made.code)}>{made.dvpCount ? "Review its DVPs" : "Choose its DVPs"}</button>
        </p>
      )}

      {adding && (
        <form className="card" onSubmit={save} noValidate>
          <h2>New program</h2>
          <div className="form-grid">
            <label className="field"><span>Program code *</span>
              <input value={code} maxLength={12} autoFocus placeholder="e.g. S302"
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
              <small className="hint">2-12 letters or digits. It appears in every DVP number, e.g. {code || "S302"}-UDVP-101-01.</small>
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
                {programs.map((p) => <option key={p.code} value={p.code}>{p.code} ({p.dvpCount} DVPs)</option>)}
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

      <div className="table-wrap">
        <table className="programs-table">
          <thead>
            <tr><th scope="col">Program</th><th scope="col">Name</th><th scope="col">Description</th><th scope="col">DVPs</th><th scope="col">Done</th><th scope="col"><span className="visually-hidden">Actions</span></th></tr>
          </thead>
          <tbody>
            {programs.map((p) => (
              <tr key={p.code} className="row">
                <td className="col-num"><strong>{p.code}</strong></td>
                <td>{p.name && p.name !== p.code ? p.name : <span className="muted">—</span>}</td>
                <td>{p.description || <span className="muted">—</span>}</td>
                <td>{p.dvpCount}</td>
                <td>{p.doneCount} of {p.dvpCount}</td>
                <td><button type="button" className="link-btn" onClick={() => onManage(p.code)}>Choose DVPs</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
