import { useEffect, useRef, useState } from "react";
import { addObservations, removeObservation } from "./api.js";
import { sniffImageFile } from "./imageType.js";
import { shortDate } from "./shared.jsx";
import AuthImage from "./AuthImage.jsx";
import { permissions, useSettings } from "./settings.js";

const MAX_PER_UPLOAD = 6;          // per request, as on the server; more are sent in several requests
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

// Observation images of one DVP in one program: supporting pictures from the assessment. Choosing files uploads them
// straight away. A picture can be removed by whoever added it, or by an admin.
export default function ObservationImages({ programCode, dvp, user, onChanged, onOpen, onBusy }) {
  const settings = useSettings();
  const can = permissions(user, settings);
  const MAX_PER_DVP = settings.observationMaxPerDvp;
  const MAX_IMAGE_MB = settings.observationMaxMb;
  const images = dvp.observationImages || [];
  const [busy, setBusy] = useState("");          // "" | "upload" | file name being removed
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef(null);
  const room = MAX_PER_DVP - images.length;

  useEffect(() => { onBusy?.(busy === "upload"); }, [busy]);
  useEffect(() => () => onBusy?.(false), []);

  const upload = async (list) => {
    setError(""); setFlash("");
    const picked = Array.from(list || []);
    if (picked.length === 0) return;
    const problems = [];
    const ok = [];
    for (const f of picked) {
      if (!IMAGE_TYPES.includes(f.type) || !(await sniffImageFile(f))) problems.push(`"${f.name}" is not a PNG, JPEG or WebP image.`);
      else if (f.size > MAX_IMAGE_MB * 1024 * 1024) problems.push(`"${f.name}" is over ${MAX_IMAGE_MB} MB.`);
      else ok.push(f);
    }
    if (ok.length > room) problems.push(room <= 0 ? `This DVP already has the most images allowed (${MAX_PER_DVP}).` : `Only ${room} more image${room === 1 ? "" : "s"} can be added (at most ${MAX_PER_DVP}).`);
    const send = ok.slice(0, Math.max(0, room));
    if (input.current) input.current.value = "";
    if (send.length === 0) { setError(problems.join(" ")); return; }

    setBusy("upload");
    let added = 0;
    try {
      // The server takes up to MAX_PER_UPLOAD at a time
      for (let i = 0; i < send.length; i += MAX_PER_UPLOAD) {
        const form = new FormData();
        send.slice(i, i + MAX_PER_UPLOAD).forEach((f) => form.append("images", f, f.name));
        onChanged(await addObservations(programCode, dvp.code, form));
        added += Math.min(MAX_PER_UPLOAD, send.length - i);
      }
    } catch (err) { problems.unshift(err.message); }
    setBusy("");
    if (added) setFlash(`Added ${added} image${added === 1 ? "" : "s"}.`);
    setError(problems.join(" "));
  };

  const remove = async (o) => {
    if (!window.confirm("Remove this observation image? It is removed for everyone.")) return;
    setError(""); setFlash(""); setBusy(o.file);
    try { onChanged(await removeObservation(programCode, dvp.code, o.file)); setFlash("Image removed."); } catch (err) { setError(err.message); }
    setBusy("");
  };
  const mayRemove = (o) => can.admin || (can.removeOwnObservations && o.uploadedBy.username && o.uploadedBy.username === user?.username);

  return (
    <div className="obs">
      {images.length === 0 ? <p className="muted obs-none">No observation images yet.</p> : (
        <ul className="obs-grid">
          {images.map((o, i) => (
            <li key={o.file} className="obs-item">
              <button type="button" className="thumb thumb-lg" onClick={() => onOpen(i)} aria-label={`Open observation image ${i + 1} of ${images.length}`}>
                <AuthImage src={o.url} />
              </button>
              <span className="obs-meta" title={shortDate(o.uploadedAt)}>{o.uploadedBy.name || "—"}</span>
              {mayRemove(o) && (
                <button type="button" className="link-btn obs-remove" disabled={Boolean(busy)} onClick={() => remove(o)}
                  aria-label={`Remove observation image ${i + 1}`}>{busy === o.file ? "Removing…" : "Remove"}</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {can.addObservations && (
        <div className={`obs-drop ${dragging ? "obs-drop-on" : ""}`}
          onDragOver={(e) => { if (room > 0 && !busy) { e.preventDefault(); setDragging(true); } }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); if (room > 0 && !busy) upload(e.dataTransfer.files); }}>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => upload(e.target.files)} />
          <button type="button" className="btn" disabled={Boolean(busy) || room <= 0} onClick={() => input.current?.click()}>
            {busy === "upload" ? "Uploading…" : "Add observation images"}
          </button>
          <small className="hint">
            {room <= 0 ? `The most allowed (${MAX_PER_DVP}) have been added.${images.some(mayRemove) ? " Remove one to add another." : ""}`
              : `PNG, JPEG or WebP, up to ${MAX_IMAGE_MB} MB each. You can also drop them here. ${images.length} of ${MAX_PER_DVP} used.`}
          </small>
        </div>
      )}
      <p className="flash obs-flash" role="status">{flash}</p>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
    </div>
  );
}
