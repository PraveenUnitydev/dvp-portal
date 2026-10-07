import { useEffect, useMemo, useRef, useState } from "react";
import { createDvp } from "./api.js";
import { sniffImageFile } from "./imageType.js";
import {
  buildCode, codeExists, defaultSeries, nextFreeSeries, nextSequence, nextZoneOrder, seriesFitsZone, seriesInZone, zonesOf,
} from "./catalogCode.js";

const MAX_IMAGES = 6;
const MAX_IMAGE_MB = 3;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const LIMITS = {
  component: 80, evaluationParameter: 120, fullName: 160, ergonomicsArea: 60, cas: 60,
  requirement: 3000, acceptanceCriteria: 4000, procedure: 8000,
};

const sizeText = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
const digits = (value, max) => value.replace(/\D/g, "").slice(0, max);

// Adds a DVP to the base catalog. Every rule is checked again on the server; the checks here only
// save a round trip and say what is wrong next to the field.
export default function AddDvpForm({ dvps, programs, onClose, onCreated }) {
  const zones = useMemo(() => zonesOf(dvps), [dvps]);
  const firstZone = zones[0]?.order ?? 1;

  const [type, setType] = useState("Usability");
  const noZones = zones.length === 0;                                  // an empty catalog starts with a new zone
  const [zoneKey, setZoneKey] = useState(noZones ? "new" : String(firstZone)); // a zone number, or "new"
  const [newZoneOrder, setNewZoneOrder] = useState(String(nextZoneOrder(dvps)));
  const [newZoneName, setNewZoneName] = useState("");
  const [seriesKey, setSeriesKey] = useState(() => defaultSeries(dvps, firstZone)); // an existing series, or "new"
  const [newSeries, setNewSeries] = useState(noZones ? `${nextZoneOrder(dvps)}01` : "");
  const [seqOverride, setSeqOverride] = useState(null);                // null = use the suggested number

  const [f, setF] = useState({
    component: "", evaluationParameter: "", fullName: "", ergonomicsArea: "", cas: "",
    vrCapability: "No", requirement: "", acceptanceCriteria: "", procedure: "",
  });
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const headingRef = useRef(null);

  const set = (field) => (e) => setF((prev) => ({ ...prev, [field]: e.target.value }));

  // ── the code ────────────────────────────────────────────────────────
  const isNewZone = zoneKey === "new";
  const zoneOrder = isNewZone ? Number(newZoneOrder) : Number(zoneKey);
  const zoneOrderOk = Number.isInteger(zoneOrder) && zoneOrder >= 1 && zoneOrder <= 99;
  const existingSeries = isNewZone ? [] : seriesInZone(dvps, zoneOrder);
  const isNewSeries = isNewZone || seriesKey === "new";
  const series = isNewSeries ? newSeries : seriesKey;
  const seriesOk = /^\d{3,4}$/.test(series);
  const suggested = seriesOk ? nextSequence(dvps, type, series) : null;
  const seqText = seqOverride !== null ? seqOverride : suggested === null ? "" : String(suggested).padStart(2, "0");
  const seqNumber = Number(seqText);
  const seqOk = /^\d{1,2}$/.test(seqText) && seqNumber >= 1;
  const code = seriesOk && seqOk ? buildCode(type, series, seqNumber) : "";
  const exists = code !== "" && codeExists(dvps, code);
  const seriesMismatch = seriesOk && zoneOrderOk && !seriesFitsZone(series, zoneOrder);

  const changeType = (value) => { setType(value); setSeqOverride(null); };
  const changeZone = (key) => {
    setZoneKey(key); setSeqOverride(null);
    if (key === "new") { const order = nextZoneOrder(dvps); setNewZoneOrder(String(order)); setNewSeries(`${order}01`); }
    else setSeriesKey(defaultSeries(dvps, Number(key)));
  };
  const changeNewZoneOrder = (value) => {
    const v = digits(value, 2);
    setNewZoneOrder(v); setSeqOverride(null);
    if (v) setNewSeries(`${Number(v)}01`);
  };
  const changeSeries = (key) => {
    setSeriesKey(key); setSeqOverride(null);
    if (key === "new") setNewSeries(isNewZone ? `${zoneOrder}01` : nextFreeSeries(dvps, zoneOrder));
  };

  // ── images ──────────────────────────────────────────────────────────
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  const addFiles = async (list) => {
    const problems = [];
    const accepted = [...files];
    for (const file of Array.from(list)) {
      // The browser's type comes from the file extension, so look at the file's real first bytes too
      if (!IMAGE_TYPES.includes(file.type) || !(await sniffImageFile(file))) problems.push(`"${file.name}" is not a PNG, JPEG or WebP image.`);
      else if (file.size > MAX_IMAGE_MB * 1024 * 1024) problems.push(`"${file.name}" is over ${MAX_IMAGE_MB} MB.`);
      else if (accepted.length >= MAX_IMAGES) problems.push(`You can add at most ${MAX_IMAGES} images.`);
      else accepted.push(file);
    }
    setFiles(accepted);
    setError(problems.length ? [...new Set(problems)].join(" ") : "");
  };

  // ── closing ─────────────────────────────────────────────────────────
  const dirty = Object.entries(f).some(([k, v]) => (k === "vrCapability" ? v !== "No" : v.trim() !== "")) ||
    files.length > 0 || selected.size > 0 || newZoneName.trim() !== "" || seqOverride !== null;
  const close = () => { if (busy) return; if (!dirty || window.confirm("Discard this new DVP?")) onClose(); };

  useEffect(() => {
    const opener = document.activeElement;
    headingRef.current?.focus();
    return () => opener?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // ── saving ──────────────────────────────────────────────────────────
  const problem = () => {
    if (!zoneOrderOk) return "Enter a zone number between 1 and 99.";
    if (isNewZone && newZoneName.trim().length < 2) return "Give the new zone a name.";
    if (!seriesOk) return "The series must be 3 or 4 digits, for example 101.";
    if (!seqOk) return "Enter the running number, 1 to 99.";
    if (suggested === null && seqOverride === null) return `Series ${series} is full. Choose another series.`;
    if (exists) return `${code} already exists. Change the running number or the series.`;
    if (!f.component.trim()) return "Enter the component.";
    if (!f.evaluationParameter.trim()) return "Enter the evaluation.";
    return "";
  };

  const save = async (e) => {
    e.preventDefault();
    const issue = problem();
    if (issue) { setError(issue); return; }
    const fd = new FormData();
    fd.append("type", type); fd.append("code", code); fd.append("zoneOrder", String(zoneOrder));
    if (isNewZone) fd.append("zoneName", newZoneName.trim());
    Object.entries(f).forEach(([k, v]) => fd.append(k, v));
    selected.forEach((p) => fd.append("programs", p));
    files.forEach((file) => fd.append("images", file, file.name));
    setBusy(true); setError("");
    try {
      onCreated(await createDvp(fd));
    } catch (err) {
      setError(err.message); setBusy(false);
    }
  };

  const toggleProgram = (p) => setSelected((prev) => { const next = new Set(prev); next.has(p) ? next.delete(p) : next.add(p); return next; });
  const counter = (field) => <small className="hint">{f[field].length} / {LIMITS[field]}</small>;

  return (
    <div className="drawer-backdrop" onClick={close}>
      <aside className="drawer drawer-wide" role="dialog" aria-modal="true" aria-labelledby="add-dvp-title" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <h2 id="add-dvp-title" ref={headingRef} tabIndex={-1}>Add a DVP</h2>
            <p>Adds it to the base catalog. Switch it on for programs below, or later under Manage program DVPs.</p>
          </div>
          <button type="button" className="btn" onClick={close} disabled={busy}>Close</button>
        </div>

        <form className="drawer-body" onSubmit={save} noValidate>
          <fieldset className="form-section">
            <legend>DVP code</legend>
            <div className="form-grid">
              <label className="field"><span>Type</span>
                <select value={type} onChange={(e) => changeType(e.target.value)}>
                  <option>Usability</option><option>Visibility</option>
                </select>
              </label>
              <label className="field"><span>Zone</span>
                <select value={zoneKey} onChange={(e) => changeZone(e.target.value)}>
                  {zones.map((z) => <option key={z.order} value={z.order}>{z.order} · {z.name}</option>)}
                  <option value="new">New zone…</option>
                </select>
              </label>
              {isNewZone && (
                <>
                  <label className="field"><span>New zone number</span>
                    <input inputMode="numeric" value={newZoneOrder} onChange={(e) => changeNewZoneOrder(e.target.value)} />
                  </label>
                  <label className="field"><span>New zone name</span>
                    <input value={newZoneName} maxLength={40} onChange={(e) => setNewZoneName(e.target.value)} />
                  </label>
                </>
              )}
              <label className="field"><span>Series</span>
                {isNewZone ? (
                  <input inputMode="numeric" value={newSeries} onChange={(e) => { setNewSeries(digits(e.target.value, 4)); setSeqOverride(null); }} />
                ) : (
                  <select value={seriesKey} onChange={(e) => changeSeries(e.target.value)}>
                    {existingSeries.map((s) => <option key={s} value={s}>{s}</option>)}
                    <option value="new">New series…</option>
                  </select>
                )}
              </label>
              {!isNewZone && seriesKey === "new" && (
                <label className="field"><span>New series number</span>
                  <input inputMode="numeric" value={newSeries} onChange={(e) => { setNewSeries(digits(e.target.value, 4)); setSeqOverride(null); }} />
                </label>
              )}
              <label className="field"><span>Running number</span>
                <input inputMode="numeric" value={seqText} onChange={(e) => setSeqOverride(digits(e.target.value, 2))} />
              </label>
            </div>
            <p className={`code-preview ${exists ? "code-bad" : ""}`} aria-live="polite">
              <span>Code</span> <strong>{code || "—"}</strong>
              <small>{exists ? "This code is already used." : "It can't be changed after the DVP is created."}</small>
            </p>
            {seriesMismatch && (
              <p className="hint note">Codes in zone {zoneOrder} normally start with {zoneOrder} (for example {zoneOrder}01). Check the series.</p>
            )}
          </fieldset>

          <fieldset className="form-section">
            <legend>Details</legend>
            <div className="form-grid">
              <label className="field"><span>Component *</span>
                <input value={f.component} maxLength={LIMITS.component} onChange={set("component")} />
              </label>
              <label className="field"><span>Evaluation *</span>
                <input value={f.evaluationParameter} maxLength={LIMITS.evaluationParameter} onChange={set("evaluationParameter")} />
              </label>
              <label className="field"><span>Full name</span>
                <input value={f.fullName} maxLength={LIMITS.fullName} onChange={set("fullName")} placeholder="Defaults to component + evaluation" />
              </label>
              <label className="field"><span>VR capability</span>
                <select value={f.vrCapability} onChange={set("vrCapability")}>
                  <option>No</option><option>Partial</option><option>Yes</option>
                </select>
              </label>
              <label className="field"><span>Ergonomic area</span>
                <input list="area-options" value={f.ergonomicsArea} maxLength={LIMITS.ergonomicsArea} onChange={set("ergonomicsArea")} />
                <datalist id="area-options">{[...new Set(dvps.map((d) => d.ergonomicsArea).filter(Boolean))].sort().map((a) => <option key={a} value={a} />)}</datalist>
              </label>
              <label className="field"><span>CAS</span>
                <input list="cas-options" value={f.cas} maxLength={LIMITS.cas} onChange={set("cas")} />
                <datalist id="cas-options">{[...new Set(dvps.map((d) => d.cas).filter(Boolean))].sort().map((a) => <option key={a} value={a} />)}</datalist>
              </label>
            </div>
            <label className="field"><span>Requirement</span>
              <textarea rows={2} maxLength={LIMITS.requirement} value={f.requirement} onChange={set("requirement")} />{counter("requirement")}
            </label>
            <label className="field"><span>Acceptance criteria</span>
              <textarea rows={4} maxLength={LIMITS.acceptanceCriteria} value={f.acceptanceCriteria} onChange={set("acceptanceCriteria")} />{counter("acceptanceCriteria")}
            </label>
            <label className="field"><span>Procedure</span>
              <textarea rows={5} maxLength={LIMITS.procedure} value={f.procedure} onChange={set("procedure")} />{counter("procedure")}
            </label>
            <small className="hint">Text can't start with =, + , - or @ (spreadsheets read these as formulas).</small>
          </fieldset>

          <fieldset className="form-section">
            <legend>Reference images</legend>
            <label className="field">
              <span>Add up to {MAX_IMAGES} images (PNG, JPEG or WebP, {MAX_IMAGE_MB} MB each)</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={files.length >= MAX_IMAGES}
                onChange={(e) => { const chosen = Array.from(e.target.files); e.target.value = ""; addFiles(chosen); }} />
            </label>
            {files.length > 0 && (
              <ul className="file-list">
                {files.map((file, i) => (
                  <li key={`${file.name}-${i}`}>
                    <img src={previews[i]} alt="" />
                    <span>{file.name}<small> · {sizeText(file.size)}</small></span>
                    <button type="button" className="link-btn" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          <fieldset className="form-section">
            <legend>Switch on for programs (optional)</legend>
            {programs.length === 0 ? <p className="hint">There are no programs yet.</p> : (
              <div className="check-list">
                {programs.map((p) => (
                  <label key={p.code}><input type="checkbox" checked={selected.has(p.code)} onChange={() => toggleProgram(p.code)} /> {p.code}{p.name && p.name !== p.code ? ` · ${p.name}` : ""}</label>
                ))}
              </div>
            )}
          </fieldset>

          {error && <p className="notice notice-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Adding…" : `Add ${code || "DVP"}`}</button>
            <button type="button" className="btn" onClick={close} disabled={busy}>Cancel</button>
          </div>
        </form>
      </aside>
    </div>
  );
}
