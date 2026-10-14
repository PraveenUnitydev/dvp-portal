import { useRef, useState } from "react";
import { deleteVrReport, downloadVrReport, uploadVrReport } from "./api.js";
import { useSettings } from "./settings.js";

const when = (iso) => (iso ? new Date(iso).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "");
export const fileSize = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const ACCEPT = ".pdf,.pptx,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// The VR reports uploaded for one program (scope "program" / "dvp"), or the newest one of every program ("overall").
// Admins upload and delete here.
export default function VrReportsPanel({ scope, program, data, isAdmin, onChanged, onError }) {
  const [busyId, setBusyId] = useState("");
  const download = async (r) => {
    setBusyId(r.id); onError("");
    try { await downloadVrReport(r.id); } catch (e) { onError(e.message); }
    setBusyId("");
  };
  const remove = async (r) => {
    if (!window.confirm(`Delete the VR report "${r.title}"? The file is removed for everyone.`)) return;
    setBusyId(r.id); onError("");
    try { await deleteVrReport(r.id); onChanged(); } catch (e) { onError(e.message); }
    setBusyId("");
  };

  if (!data) return <section className="card vr-card"><h2>VR reports</h2><p className="muted">Loading…</p></section>;

  if (scope === "overall") {
    const withReports = data.programs.filter((p) => p.reports.length);
    return (
      <section className="card vr-card" aria-label="VR reports for all programs">
        <h2>VR reports</h2>
        <p className="hint vr-lead">The newest VR report of each program. Choose <strong>One program</strong> to see its earlier reports{isAdmin ? " or upload one" : ""}.</p>
        {withReports.length === 0 ? <p className="muted vr-empty">No VR reports have been uploaded yet.</p> : (
          <ul className="vr-list">
            {data.programs.map((p) => {
              const r = p.reports[0];
              return (
                <li key={p.code} className="vr-item">
                  <span className="vr-program">{p.code}</span>
                  {r ? <ReportLine r={r} more={p.reports.length - 1} /> : <span className="muted vr-main">No VR report yet</span>}
                  {r && <div className="vr-actions"><button type="button" className="btn" disabled={busyId === r.id} onClick={() => download(r)}>Download</button></div>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  }

  return (
    <section className="card vr-card" aria-label={`VR reports for ${program}`}>
      <h2>VR reports · {program}</h2>
      {data.reports.length === 0 ? (
        <p className="muted vr-empty">No VR report has been uploaded for {program} yet.{isAdmin ? " Upload one below." : " An admin can upload it."}</p>
      ) : (
        <ul className="vr-list">
          {data.reports.map((r, i) => (
            <li key={r.id} className="vr-item">
              <span className={`vr-tag ${i === 0 ? "vr-tag-latest" : ""}`}>{i === 0 ? "Latest" : r.kind}</span>
              <ReportLine r={r} />
              <div className="vr-actions">
                <button type="button" className="btn" disabled={busyId === r.id} onClick={() => download(r)}>Download</button>
                {isAdmin && <button type="button" className="link-btn" disabled={busyId === r.id} onClick={() => remove(r)}>Delete</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {isAdmin && <UploadForm key={program} program={program} onUploaded={onChanged} />}
    </section>
  );
}

function ReportLine({ r, more = 0 }) {
  return (
    <div className="vr-main">
      <strong className="vr-title">{r.title}</strong>
      <span className="hint">
        {r.kind} · {fileSize(r.size)} · {when(r.createdAt)}{r.uploadedBy.name ? ` · ${r.uploadedBy.name}` : ""}
        {more > 0 ? ` · ${more} earlier` : ""}
      </span>
      {r.notes && <span className="vr-notes">{r.notes}</span>}
    </div>
  );
}

function UploadForm({ program, onUploaded }) {
  const maxMb = useSettings().vrReportMaxMb;
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [progress, setProgress] = useState(null);     // 0..1 while uploading
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const input = useRef(null);
  const reset = () => { setFile(null); setTitle(""); setNotes(""); setError(""); if (input.current) input.current.value = ""; };

  const submit = async (e) => {
    e.preventDefault();
    if (!file) { setError("Choose the report file."); return; }
    if (file.size > maxMb * 1024 * 1024) { setError(`The file is ${fileSize(file.size)}; the most allowed is ${maxMb} MB (see Settings).`); return; }
    setError(""); setDone(""); setProgress(0);
    const form = new FormData();
    form.append("title", title.trim());
    form.append("notes", notes.trim());
    form.append("file", file);
    try {
      const r = await uploadVrReport(program, form, setProgress);
      setDone(`Uploaded "${r.title}".`); reset(); setOpen(false); onUploaded();
    } catch (err) { setError(err.message); }
    setProgress(null);
  };

  if (!open) {
    return (
      <div className="vr-upload-bar">
        <button type="button" className="btn" onClick={() => { setDone(""); setOpen(true); }}>Upload VR report</button>
        <p className="flash" role="status">{done}</p>
      </div>
    );
  }
  const uploading = progress !== null;
  return (
    <form className="vr-upload" onSubmit={submit} noValidate>
      <h3>Upload a VR report for {program}</h3>
      <div className="form-grid">
        <label className="field wide"><span>File *</span>
          <input ref={input} type="file" accept={ACCEPT} disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0] || null; setFile(f); if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, "").slice(0, 120)); }} />
          <small className="hint">PDF, PowerPoint (.pptx), Word (.docx) or Excel (.xlsx), up to {maxMb} MB.{file ? ` This one: ${fileSize(file.size)}.` : ""}</small>
        </label>
        <label className="field"><span>Title</span>
          <input value={title} maxLength={120} disabled={uploading} placeholder="e.g. Round 2 VR assessment" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field"><span>Notes</span>
          <input value={notes} maxLength={500} disabled={uploading} placeholder="Optional" onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {uploading && (
        <div className="vr-progress" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
          <em>{progress < 1 ? `Uploading… ${Math.round(progress * 100)}%` : "Checking the file…"}</em>
        </div>
      )}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={uploading || !file}>{uploading ? "Uploading…" : "Upload"}</button>
        <button type="button" className="btn" disabled={uploading} onClick={() => { reset(); setOpen(false); }}>Cancel</button>
      </div>
    </form>
  );
}
