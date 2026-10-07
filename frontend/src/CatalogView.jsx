import { useEffect, useMemo, useRef, useState } from "react";
import { deleteDvp, fetchCatalogDvps } from "./api.js";
import { Clamp, ImageViewer, Thumbnails, useZones } from "./shared.jsx";
import AddDvpForm from "./AddDvpForm.jsx";

// The base reference catalog, as the admin sees it: every DVP once, by its plain catalog code
// (UDVP-101-01), with no program in front of it. Program views show <program>-<code>.
export default function CatalogView({ programs }) {
  const [dvps, setDvps] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [zone, setZone] = useState("All");
  const [type, setType] = useState("All");
  const [vr, setVr] = useState("All");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState(null);   // a catalog code (the open detail drawer)
  const [viewer, setViewer] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);   // a catalog code
  const [detailError, setDetailError] = useState("");
  const [flash, setFlash] = useState("");

  const load = () => fetchCatalogDvps()
    .then((res) => { setDvps(res.dvps); setStatus("ready"); })
    .catch((err) => { setError(err.message); setStatus("error"); });
  useEffect(() => { load(); }, []);

  const zones = useZones(dvps);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dvps.filter((d) =>
      (zone === "All" || d.zone.name === zone) && (type === "All" || d.type === type) && (vr === "All" || d.vrCapability === vr) &&
      (!q || [d.code, d.component, d.evaluationParameter, d.fullName, d.cas, d.ergonomicsArea].some((v) => (v || "").toLowerCase().includes(q))));
  }, [dvps, zone, type, vr, query]);

  const created = (row) => {
    setAdding(false);
    setFlash(`Added ${row.code}${row.programCount ? ` and switched it on for ${row.programCount} program${row.programCount === 1 ? "" : "s"}` : ""}.`);
    setDetail(null);
    load();
  };

  const saved = (row) => { setEditing(null); setDetail(null); setFlash(`Saved ${row.code}.`); load(); };
  const remove = async (d) => {
    if (!window.confirm(`Delete ${d.code}? This can't be undone.`)) return;
    try { await deleteDvp(d.code); setDetail(null); setFlash(`Deleted ${d.code}.`); load(); }
    catch (err) { setDetailError(err.message); }
  };

  if (status === "loading") return <p className="notice" role="status">Loading the DVP catalog…</p>;
  if (status === "error") return <p className="notice notice-error" role="alert">{error}</p>;

  const usability = dvps.filter((d) => d.type === "Usability").length;
  const detailDvp = dvps.find((d) => d.code === detail);

  return (
    <>
      <div className="toolbar">
        <p className="summary">
          <strong>{dvps.length}</strong> base reference DVPs ({usability} Usability, {dvps.length - usability} Visibility).
          Shown here by catalog code only. Each program numbers them <code>&lt;program&gt;-&lt;code&gt;</code>.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => { setFlash(""); setAdding(true); }}>Add DVP</button>
      </div>
      <p className="flash" role="status">{flash}</p>

      <div className="filters">
        <label><span>Zone</span>
          <select value={zone} onChange={(e) => setZone(e.target.value)}><option>All</option>{zones.map((z) => <option key={z}>{z}</option>)}</select>
        </label>
        <label><span>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)}><option>All</option><option>Usability</option><option>Visibility</option></select>
        </label>
        <label><span>VR capability</span>
          <select value={vr} onChange={(e) => setVr(e.target.value)}><option>All</option><option>Yes</option><option>Partial</option><option>No</option></select>
        </label>
        <label className="search"><span>Search</span>
          <input type="search" value={query} placeholder="DVP code, component or evaluation" onChange={(e) => setQuery(e.target.value)} />
        </label>
        <span className="count" aria-live="polite">{visible.length === dvps.length ? `${dvps.length} DVPs` : `${visible.length} of ${dvps.length} DVPs`}</span>
      </div>

      {visible.length === 0 ? (
        <p className="notice">No DVPs match these filters.</p>
      ) : (
        <div className="table-wrap">
          <table className="catalog-table">
            <thead>
              <tr>
                <th scope="col">DVP code</th><th scope="col">Type</th><th scope="col">Component</th><th scope="col">Evaluation</th>
                <th scope="col">Zone</th><th scope="col">Ergonomic area</th><th scope="col">CAS</th><th scope="col">VR</th>
                <th scope="col">Image reference</th><th scope="col">Used in</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((d) => (
                <tr key={d.code} className="row">
                  <td className="col-num">
                    <button type="button" className="row-toggle" onClick={() => { setDetailError(""); setDetail(d.code); }} title="Open details">{d.code}</button>
                  </td>
                  <td>{d.type}</td>
                  <td>{d.component || <span className="muted">—</span>}</td>
                  <td>{d.evaluationParameter}</td>
                  <td>{d.zone.name}</td>
                  <td>{d.ergonomicsArea}</td>
                  <td>{d.cas}</td>
                  <td>{d.vrCapability}</td>
                  <td><Thumbnails dvp={d} onOpen={(i) => setViewer({ dvp: d, index: i })} /></td>
                  <td>{d.programCount === 0 ? <span className="muted">No program</span> : `${d.programCount} program${d.programCount === 1 ? "" : "s"}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detailDvp && !editing && (
        <CatalogDetail dvp={detailDvp} onClose={() => setDetail(null)} onOpenImage={(i) => setViewer({ dvp: detailDvp, index: i })}
          imageOpen={Boolean(viewer)} onEdit={() => { setFlash(""); setEditing(detailDvp.code); }} onDelete={() => remove(detailDvp)} error={detailError} />
      )}
      {editing && dvps.find((d) => d.code === editing) && (
        <AddDvpForm dvps={dvps} programs={programs} dvp={dvps.find((d) => d.code === editing)} onClose={() => setEditing(null)} onSaved={saved} onStale={load} />
      )}
      {adding && <AddDvpForm dvps={dvps} programs={programs} onClose={() => setAdding(false)} onCreated={created} />}
      {viewer && <ImageViewer {...viewer} onClose={() => setViewer(null)} />}
    </>
  );
}

function CatalogDetail({ dvp, onClose, onOpenImage, imageOpen, onEdit, onDelete, error }) {
  const headingRef = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    headingRef.current?.focus();
    return () => opener?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !imageOpen) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  const added = dvp.createdBy
    ? `Added by ${dvp.createdBy}${dvp.createdAt ? ` on ${new Date(dvp.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}` : ""}.`
    : "From the master sheet.";
  const edited = dvp.editedBy ? ` Edited by ${dvp.editedBy}${dvp.editedAt ? ` on ${new Date(dvp.editedAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}` : ""}.` : "";

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="catalog-detail-title" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <h2 id="catalog-detail-title" ref={headingRef} tabIndex={-1}>{dvp.code}</h2>
            <p>{dvp.component} — {dvp.evaluationParameter}</p>
          </div>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
        <div className="drawer-body">
          <div className="form-actions">
            <button type="button" className="btn btn-primary" onClick={onEdit}>Edit</button>
            <button type="button" className="btn" onClick={onDelete} disabled={dvp.programCount > 0}
              title={dvp.programCount > 0 ? "Programs use this DVP. Switch it off there instead." : "Delete this DVP"}>Delete</button>
            {dvp.programCount > 0 && <small className="hint">Used by {dvp.programCount} program{dvp.programCount === 1 ? "" : "s"}, so it can't be deleted. Switch it off there instead.</small>}
          </div>
          {error && <p className="notice notice-error" role="alert">{error}</p>}
          <dl className="details">
            <dt>Type</dt><dd>{dvp.type}</dd>
            <dt>Full name</dt><dd>{dvp.fullName || "—"}</dd>
            <dt>Zone</dt><dd>{dvp.zone.order} · {dvp.zone.name}</dd>
            <dt>Ergonomic area</dt><dd>{dvp.ergonomicsArea || "—"}</dd>
            <dt>CAS</dt><dd>{dvp.cas || "—"}</dd>
            <dt>VR capability</dt><dd>{dvp.vrCapability}</dd>
            <dt>Requirement</dt><dd className="pre">{dvp.requirement || "Not defined yet"}</dd>
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
            <dt>Used in</dt><dd>{dvp.programCount === 0 ? "No program yet. Switch it on under Manage program DVPs." : `${dvp.programCount} program${dvp.programCount === 1 ? "" : "s"}`}</dd>
            <dt>Origin</dt><dd>{added}{edited}</dd>
          </dl>
        </div>
      </aside>
    </div>
  );
}
