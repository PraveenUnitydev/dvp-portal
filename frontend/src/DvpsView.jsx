import { useEffect, useMemo, useRef, useState } from "react";
import { fetchProgramDvps, updateProgramDvp } from "./api.js";
import { COLORS, Clamp, ColorTag, ImageViewer, Thumbnails, useZones } from "./shared.jsx";

const MAX_REMARKS = 2000;

export default function DvpsView({ programCode, user }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [zone, setZone] = useState("All");
  const [area, setArea] = useState("All");
  const [colorFilter, setColorFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [viewer, setViewer] = useState(null);
  const [editing, setEditing] = useState(null); // dvp code
  const [flash, setFlash] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchProgramDvps(programCode)
      .then((res) => { if (!cancelled) { setData(res); setStatus("ready"); } })
      .catch((err) => { if (!cancelled) { setError(err.message); setStatus("error"); } });
    return () => { cancelled = true; };
  }, [programCode]);

  const dvps = data?.dvps || [];
  const zones = useZones(dvps);
  const areas = useMemo(() => [...new Set(dvps.map((d) => d.ergonomicsArea).filter(Boolean))].sort(), [dvps]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dvps.filter((d) =>
      (zone === "All" || d.zone.name === zone) &&
      (area === "All" || d.ergonomicsArea === area) &&
      (colorFilter === "All" || (colorFilter === "None" ? !d.color : d.color === colorFilter)) &&
      (!q || [d.dvpNumber, d.evaluationParameter, d.component, d.fullName, d.remarks].some((v) => (v || "").toLowerCase().includes(q))));
  }, [dvps, zone, area, colorFilter, query]);

  const filtersActive = zone !== "All" || area !== "All" || colorFilter !== "All" || query.trim() !== "";
  const editingDvp = dvps.find((d) => d.code === editing) || null;
  const canEdit = user.role === "ADMIN" || user.role === "USER";

  const onSaved = (updated) => {
    setData((prev) => ({ ...prev, dvps: prev.dvps.map((d) => (d.code === updated.code ? updated : d)) }));
    setEditing(null);
    setFlash(`Saved ${updated.dvpNumber}.`);
    setTimeout(() => setFlash(""), 4000);
  };

  if (status === "loading") return <p className="notice" role="status">Loading DVPs for {programCode}…</p>;
  if (status === "error") return <p className="notice notice-error" role="alert">{error}</p>;
  if (dvps.length === 0) {
    return (
      <p className="notice">
        No DVPs are assigned to {programCode} yet.
        {user.role === "ADMIN" ? " Choose them under Manage program DVPs." : " An admin needs to choose which DVPs apply to this program."}
      </p>
    );
  }

  const done = dvps.filter((d) => d.completedStatus === "Done").length;

  return (
    <>
      <p className="summary"><strong>{dvps.length}</strong> DVPs apply to {programCode}. <strong>{done}</strong> are done.</p>
      <div className="flash" role="status" aria-live="polite">{flash}</div>

      <div className="filters">
        <label><span>Zone</span>
          <select value={zone} onChange={(e) => setZone(e.target.value)}>
            <option>All</option>{zones.map((z) => <option key={z}>{z}</option>)}
          </select>
        </label>
        <label><span>Ergonomic area</span>
          <select value={area} onChange={(e) => setArea(e.target.value)}>
            <option>All</option>{areas.map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
        <label><span>Colour</span>
          <select value={colorFilter} onChange={(e) => setColorFilter(e.target.value)}>
            <option>All</option>{COLORS.map((c) => <option key={c}>{c}</option>)}<option value="None">No colour</option>
          </select>
        </label>
        <label className="search"><span>Search</span>
          <input type="search" value={query} placeholder="DVP number, component, evaluation or remarks" onChange={(e) => setQuery(e.target.value)} />
        </label>
        {filtersActive && (
          <button type="button" className="link-btn" onClick={() => { setZone("All"); setArea("All"); setColorFilter("All"); setQuery(""); }}>Clear filters</button>
        )}
        <span className="count" aria-live="polite">Showing {visible.length} of {dvps.length}</span>
      </div>

      {visible.length === 0 ? (
        <p className="notice">No DVPs match these filters. Clear the filters to see all {dvps.length}.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col" className="col-num">DVP no.</th>
                <th scope="col" className="col-component">Component</th>
                <th scope="col" className="col-eval">Evaluation</th>
                <th scope="col" className="col-zone">Zone</th>
                <th scope="col" className="col-area">Ergonomic area</th>
                <th scope="col" className="col-cas">CAS</th>
                <th scope="col" className="col-text">Acceptance criteria</th>
                <th scope="col" className="col-text">Procedure</th>
                <th scope="col" className="col-images">Image reference</th>
                <th scope="col" className="col-status">Status</th>
                <th scope="col" className="col-remarks">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((d) => (
                <tr key={d.code} className="row">
                  <td className={`col-num ${d.color ? `stripe-${d.color.toLowerCase()}` : ""}`}>
                    <button type="button" className="row-toggle" onClick={() => setEditing(d.code)}
                      title={canEdit ? "Open details and update status" : "Open details"}>
                      {d.dvpNumber}
                    </button>
                  </td>
                  <td className="col-component">{d.component || <span className="muted">—</span>}</td>
                  <td className="col-eval">{d.evaluationParameter}</td>
                  <td className="col-zone">{d.zone.name}</td>
                  <td className="col-area">{d.ergonomicsArea}</td>
                  <td className="col-cas">{d.cas}</td>
                  <td className="col-text"><Clamp text={d.acceptanceCriteria} empty="Not defined yet" /></td>
                  <td className="col-text"><Clamp text={d.procedure} empty="Not defined yet" /></td>
                  <td className="col-images"><Thumbnails dvp={d} onOpen={(i) => setViewer({ dvp: d, index: i })} /></td>
                  <td className="col-status">
                    <div className={d.completedStatus === "Done" ? "status status-done" : "status"}>{d.completedStatus}</div>
                    <div className="status-color"><ColorTag color={d.color} /></div>
                  </td>
                  <td className="col-remarks"><Clamp text={d.remarks} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingDvp && (
        <EditPanel dvp={editingDvp} programCode={programCode} canEdit={canEdit}
          onClose={() => setEditing(null)} onSaved={onSaved}
          onOpenImage={(i) => setViewer({ dvp: editingDvp, index: i })} imageOpen={Boolean(viewer)} />
      )}
      {viewer && <ImageViewer {...viewer} onClose={() => setViewer(null)} />}
    </>
  );
}

function EditPanel({ dvp, programCode, canEdit, onClose, onSaved, onOpenImage, imageOpen }) {
  const [completedStatus, setCompletedStatus] = useState(dvp.completedStatus);
  const [color, setColor] = useState(dvp.color);
  const [remarks, setRemarks] = useState(dvp.remarks);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const headingRef = useRef(null);

  const dirty = completedStatus !== dvp.completedStatus || color !== dvp.color || remarks.trim() !== (dvp.remarks || "");

  const close = () => { if (!dirty || window.confirm("Discard your unsaved changes?")) onClose(); };

  useEffect(() => {
    const opener = document.activeElement;
    headingRef.current?.focus();
    return () => opener?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !imageOpen) close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const save = async (e) => {
    e.preventDefault();
    const changes = {};
    if (completedStatus !== dvp.completedStatus) changes.completedStatus = completedStatus;
    if (color !== dvp.color) changes.color = color;
    if (remarks.trim() !== (dvp.remarks || "")) changes.remarks = remarks.trim();
    setSaving(true); setError("");
    try {
      onSaved(await updateProgramDvp(programCode, dvp.code, changes));
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const updated = dvp.updatedAt
    ? `Last updated by ${dvp.updatedBy || "unknown"} on ${new Date(dvp.updatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.`
    : "";

  return (
    <div className="drawer-backdrop" onClick={close}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <h2 id="drawer-title" ref={headingRef} tabIndex={-1}>{dvp.dvpNumber}</h2>
            <p>{dvp.component} — {dvp.evaluationParameter}</p>
          </div>
          <button type="button" className="btn" onClick={close}>Close</button>
        </div>

        <div className="drawer-body">
          {canEdit && (
            <form className="edit-form" onSubmit={save}>
              <h3>Update for {programCode}</h3>
              <label className="field"><span>Status</span>
                <select value={completedStatus} onChange={(e) => setCompletedStatus(e.target.value)}>
                  <option>Not done</option><option>Done</option>
                </select>
              </label>
              <fieldset className="field color-choice">
                <legend>Colour</legend>
                {[...COLORS, null].map((c) => (
                  <label key={c || "none"} className={`swatch ${c ? `swatch-${c.toLowerCase()}` : "swatch-none"}`}>
                    <input type="radio" name="color" checked={color === c} onChange={() => setColor(c)} />
                    <span>{c || "No colour"}</span>
                  </label>
                ))}
              </fieldset>
              <label className="field"><span>Remarks</span>
                <textarea rows={4} maxLength={MAX_REMARKS} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                <small className="hint">{remarks.length} / {MAX_REMARKS}</small>
              </label>
              {error && <p className="notice notice-error" role="alert">{error}</p>}
              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={!dirty || saving}>{saving ? "Saving…" : "Save changes"}</button>
                {updated && <small className="hint">{updated}</small>}
              </div>
            </form>
          )}

          <dl className="details">
            <dt>Zone</dt><dd>{dvp.zone.name}</dd>
            <dt>Ergonomic area</dt><dd>{dvp.ergonomicsArea || "—"}</dd>
            <dt>CAS</dt><dd>{dvp.cas || "—"}</dd>
            <dt>Acceptance criteria</dt><dd className="pre">{dvp.acceptanceCriteria || "Not defined yet"}</dd>
            <dt>Procedure</dt><dd className="pre">{dvp.procedure || "Not defined yet"}</dd>
            <dt>Image reference</dt>
            <dd>
              {dvp.referenceImages.length === 0 ? "No image" : (
                <div className="drawer-thumbs">
                  {dvp.referenceImages.map((src, i) => (
                    <button key={src} type="button" className="thumb thumb-lg" onClick={() => onOpenImage(i)} aria-label={`Open image ${i + 1}`}>
                      <img src={src} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </dd>
          </dl>
        </div>
      </aside>
    </div>
  );
}
