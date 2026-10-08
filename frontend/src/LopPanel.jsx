import { useEffect, useMemo, useRef, useState } from "react";
import { addLop, fetchLop } from "./api.js";
import { sniffImageFile } from "./imageType.js";
import AuthImage from "./AuthImage.jsx";

const MAX_IMAGES = 4;
const MAX_IMAGE_MB = 3;
const MAX_DETAILS = 4000;
const MAX_MODEL = 300;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

const when = (iso) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
const roleText = (role) => (role === "ADMIN" ? "Admin" : role === "USER" ? "User" : role || "");
const sizeText = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

// The LOP tab for one DVP in one program: raise a concern or add an update, and read the full history.
// Entries are only ever added. An update never replaces an earlier one, so the history shows who raised what,
// when, and against which CAS / CAD model.
export default function LopPanel({ programCode, dvp, onChanged, onDirty }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [details, setDetails] = useState("");
  const [modelDetails, setModelDetails] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [flash, setFlash] = useState("");
  const [viewer, setViewer] = useState(null);

  const load = () => fetchLop(programCode, dvp.code)
    .then((res) => { setData(res); setStatus("ready"); if (onChanged) onChanged(dvp.code, res.count, res.entries[0]?.createdAt || null); })
    .catch((err) => { setError(err.message); setStatus("error"); });
  useEffect(() => { load(); }, [programCode, dvp.code]);

  const dirty = details.trim() !== "" || modelDetails.trim() !== "" || files.length > 0;
  useEffect(() => { if (onDirty) onDirty(dirty); }, [dirty]);
  useEffect(() => () => { if (onDirty) onDirty(false); }, []);

  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const addFiles = async (list) => {
    const problems = [];
    const accepted = [...files];
    for (const file of Array.from(list)) {
      if (!IMAGE_TYPES.includes(file.type) || !(await sniffImageFile(file))) problems.push(`"${file.name}" is not a PNG, JPEG or WebP image.`);
      else if (file.size > MAX_IMAGE_MB * 1024 * 1024) problems.push(`"${file.name}" is over ${MAX_IMAGE_MB} MB.`);
      else if (accepted.length >= MAX_IMAGES) problems.push(`You can add at most ${MAX_IMAGES} pictures.`);
      else accepted.push(file);
    }
    setFiles(accepted);
    setFormError(problems.length ? [...new Set(problems)].join(" ") : "");
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!details.trim()) { setFormError("Describe the concern."); return; }
    if (!modelDetails.trim()) { setFormError("Enter the CAS/CAD details this concern was found on."); return; }
    const fd = new FormData();
    fd.append("details", details.trim()); fd.append("modelDetails", modelDetails.trim());
    files.forEach((f) => fd.append("images", f, f.name));
    setBusy(true); setFormError("");
    try {
      const entry = await addLop(programCode, dvp.code, fd);
      setDetails(""); setModelDetails(""); setFiles([]);
      setFlash(`Added LOP #${entry.seq}.`);
      await load();
    } catch (err) {
      setFormError(err.message);
      if (err.status === 409) load();       // the DVP is no longer Red: refresh so the form disappears
    }
    setBusy(false);
  };

  if (status === "loading") return <p className="notice" role="status">Loading LOP concerns…</p>;
  if (status === "error") return <p className="notice notice-error" role="alert">{error}</p>;

  const entries = data.entries;
  const first = entries.length === 0;
  return (
    <div className="lop">
      <p className="flash" role="status">{flash}</p>

      {data.enabled ? (
        <form className="edit-form" onSubmit={submit} noValidate>
          <h3>{first ? "Raise a LOP concern" : "Add a LOP update"}</h3>
          {!first && <p className="hint">This is added to the history below. Earlier entries are never changed or replaced.</p>}
          <label className="field"><span>Concern details *</span>
            <textarea rows={5} maxLength={MAX_DETAILS} value={details} onChange={(e) => setDetails(e.target.value)} />
            <small className="hint">{details.length} / {MAX_DETAILS}</small>
          </label>
          <label className="field"><span>CAS/CAD details *</span>
            <input value={modelDetails} maxLength={MAX_MODEL} onChange={(e) => setModelDetails(e.target.value)} placeholder="e.g. CAS v2.4, CAD model A12" />
            <small className="hint">The CAS or CAD model and version this concern was found on. Text can't start with =, + , - or @ (spreadsheets read these as formulas).</small>
          </label>
          <label className="field"><span>Pictures of the concern (up to {MAX_IMAGES}; PNG, JPEG or WebP, {MAX_IMAGE_MB} MB each)</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={files.length >= MAX_IMAGES}
              onChange={(e) => { const chosen = Array.from(e.target.files); e.target.value = ""; addFiles(chosen); }} />
          </label>
          {files.length > 0 && (
            <ul className="file-list">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`}>
                  <img src={previews[i]} alt="" />
                  <span>{f.name}<small> · {sizeText(f.size)}</small></span>
                  <button type="button" className="link-btn" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Remove</button>
                </li>
              ))}
            </ul>
          )}
          {formError && <p className="notice notice-error" role="alert">{formError}</p>}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Adding…" : first ? "Raise LOP concern" : "Add update"}</button>
          </div>
        </form>
      ) : (
        <p className="notice">
          LOP concerns can only be raised while {data.dvpNumber} is marked Red{data.color ? ` (it is marked ${data.color} now)` : " (it has no colour yet)"}.
          {entries.length > 0 ? " The history below stays available." : ""}
        </p>
      )}

      <h3 className="lop-title">History {entries.length > 0 && <span className="muted">({entries.length} {entries.length === 1 ? "entry" : "entries"}, newest first)</span>}</h3>
      {entries.length === 0 ? <p className="muted">No LOP concerns have been raised for this DVP in this program.</p> : (
        <ol className="lop-list">
          {entries.map((e, i) => {
            const prev = entries[i + 1];
            const changed = (field) => prev && (prev[field] || "") !== (e[field] || "");
            return (
              <li key={e.id} className="lop-entry">
                <div className="lop-head">
                  <strong>#{e.seq}</strong>
                  {i === 0 && <span className="badge">Latest</span>}
                  <time dateTime={e.createdAt}>{when(e.createdAt)}</time>
                </div>
                <p className="lop-by">Raised by <strong>{e.raisedBy.name || e.raisedBy.username}</strong>{e.raisedBy.role ? ` (${roleText(e.raisedBy.role)})` : ""}</p>
                <dl className="lop-versions lop-model">
                  <div><dt>CAS/CAD details</dt><dd className="pre">{e.modelDetails || <span className="muted">Not given</span>}{changed("modelDetails") && <small className="changed">changed from {prev.modelDetails || "not given"}</small>}</dd></div>
                </dl>
                <p className="pre">{e.details}</p>
                {e.images.length > 0 && (
                  <div className="drawer-thumbs">
                    {e.images.map((src, j) => (
                      <button key={src} type="button" className="thumb thumb-lg" aria-label={`Open picture ${j + 1} of LOP #${e.seq}`}
                        onClick={() => setViewer({ images: e.images, index: j, title: `LOP #${e.seq} · ${data.dvpNumber}` })}>
                        <AuthImage src={src} alt="" />
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {viewer && <LopViewer {...viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}

function LopViewer({ images, index: start, title, onClose }) {
  const [index, setIndex] = useState(start);
  const closeRef = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      else if (e.key === "ArrowRight") setIndex((i) => (i + 1) % images.length);
      else if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + images.length) % images.length);
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); opener?.focus?.(); };
  }, [onClose, images.length]);
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={`Pictures for ${title}`} onClick={onClose}>
      <div className="viewer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-head">
          <div><strong>{title}</strong></div>
          <button type="button" ref={closeRef} className="btn" onClick={onClose}>Close</button>
        </div>
        <AuthImage className="viewer-img" src={images[index]} alt={`Picture ${index + 1} of ${images.length}`} />
        {images.length > 1 && (
          <div className="viewer-nav">
            <button type="button" className="btn" onClick={() => setIndex((i) => (i - 1 + images.length) % images.length)}>Previous</button>
            <span>Picture {index + 1} of {images.length}</span>
            <button type="button" className="btn" onClick={() => setIndex((i) => (i + 1) % images.length)}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
}
