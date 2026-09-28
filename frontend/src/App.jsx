import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchPrograms, fetchProgramDvps } from "./api.js";

function readProgramFromUrl() {
  return new URLSearchParams(window.location.search).get("program") || "";
}

function writeProgramToUrl(code) {
  const url = new URL(window.location.href);
  if (code) url.searchParams.set("program", code); else url.searchParams.delete("program");
  window.history.replaceState({}, "", url);
}

export default function App() {
  const [programs, setPrograms] = useState([]);
  const [programCode, setProgramCode] = useState(readProgramFromUrl);
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error
  const [error, setError] = useState("");

  const [zone, setZone] = useState("All");
  const [area, setArea] = useState("All");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());
  const [viewer, setViewer] = useState(null); // { dvp, index }

  useEffect(() => {
    fetchPrograms()
      .then((list) => {
        setPrograms(list);
        if (!readProgramFromUrl() && list.length === 1) setProgramCode(list[0].code);
      })
      .catch((err) => { setStatus("error"); setError(err.message); });
  }, []);

  useEffect(() => {
    writeProgramToUrl(programCode);
    if (!programCode) { setData(null); setStatus("idle"); return; }
    let cancelled = false;
    setStatus("loading");
    setZone("All"); setArea("All"); setQuery(""); setExpanded(new Set()); setViewer(null);
    fetchProgramDvps(programCode)
      .then((res) => { if (!cancelled) { setData(res); setStatus("ready"); } })
      .catch((err) => { if (!cancelled) { setStatus("error"); setError(err.message); } });
    return () => { cancelled = true; };
  }, [programCode]);

  const dvps = data?.dvps || [];

  const zones = useMemo(() => {
    const seen = new Map();
    dvps.forEach((d) => seen.set(d.zone.name, d.zone.order));
    return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
  }, [dvps]);
  const areas = useMemo(() => [...new Set(dvps.map((d) => d.ergonomicsArea).filter(Boolean))].sort(), [dvps]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dvps.filter((d) =>
      (zone === "All" || d.zone.name === zone) &&
      (area === "All" || d.ergonomicsArea === area) &&
      (!q || [d.dvpNumber, d.evaluationParameter, d.component, d.fullName]
        .some((v) => (v || "").toLowerCase().includes(q))));
  }, [dvps, zone, area, query]);

  const filtersActive = zone !== "All" || area !== "All" || query.trim() !== "";

  const toggle = (num) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(num) ? next.delete(num) : next.add(num);
    return next;
  });

  return (
    <div className="page">
      <header className="masthead">
        <div className="brand">
          <h1>DVP Portal</h1>
          <p>Design verification plans for the Mahindra VR Lab</p>
        </div>
        <label className="program-picker">
          <span>Program</span>
          <select value={programCode} onChange={(e) => setProgramCode(e.target.value)}>
            <option value="">Select a program</option>
            {programs.map((p) => (
              <option key={p.code} value={p.code}>{p.name && p.name !== p.code ? `${p.code} — ${p.name}` : p.code}</option>
            ))}
          </select>
        </label>
      </header>

      <main>
        {status === "idle" && <p className="notice">Choose a program to see the DVPs that apply to it.</p>}
        {status === "loading" && <p className="notice" role="status">Loading DVPs for {programCode}…</p>}
        {status === "error" && (
          <p className="notice notice-error" role="alert">{error} Check that the server is running, then reload the page.</p>
        )}

        {status === "ready" && (
          <>
            <p className="summary"><strong>{dvps.length}</strong> DVPs apply to {data.program.code}.</p>

            <div className="filters">
              <label>
                <span>Zone</span>
                <select value={zone} onChange={(e) => setZone(e.target.value)}>
                  <option>All</option>
                  {zones.map((z) => <option key={z}>{z}</option>)}
                </select>
              </label>
              <label>
                <span>Ergonomic area</span>
                <select value={area} onChange={(e) => setArea(e.target.value)}>
                  <option>All</option>
                  {areas.map((a) => <option key={a}>{a}</option>)}
                </select>
              </label>
              <label className="search">
                <span>Search</span>
                <input type="search" value={query} placeholder="DVP number, component or evaluation"
                  onChange={(e) => setQuery(e.target.value)} />
              </label>
              {filtersActive && (
                <button type="button" className="link-btn"
                  onClick={() => { setZone("All"); setArea("All"); setQuery(""); }}>
                  Clear filters
                </button>
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
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((d) => {
                      const open = expanded.has(d.dvpNumber);
                      return (
                        <tr key={d.dvpNumber} className={open ? "row open" : "row"}>
                          <td className="col-num">
                            <button type="button" className="row-toggle" aria-expanded={open}
                              onClick={() => toggle(d.dvpNumber)}
                              title={open ? "Show less" : "Show full text"}>
                              {d.dvpNumber}
                            </button>
                          </td>
                          <td className="col-component">{d.component || <span className="muted">—</span>}</td>
                          <td className="col-eval">{d.evaluationParameter}</td>
                          <td className="col-zone">{d.zone.name}</td>
                          <td className="col-area">{d.ergonomicsArea}</td>
                          <td className="col-cas">{d.cas}</td>
                          <td className="col-text"><Clamp text={d.acceptanceCriteria} open={open} empty="Not defined yet" /></td>
                          <td className="col-text"><Clamp text={d.procedure} open={open} empty="Not defined yet" /></td>
                          <td className="col-images">
                            <Thumbnails dvp={d} onOpen={(index) => setViewer({ dvp: d, index })} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>

      {viewer && <ImageViewer {...viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}

function Clamp({ text, open, empty = "—" }) {
  if (!text) return <span className="muted">{empty}</span>;
  return <div className={open ? "cell-text" : "cell-text clamped"}>{text}</div>;
}

function Thumbnails({ dvp, onOpen }) {
  const images = dvp.referenceImages || [];
  if (images.length === 0) return <span className="muted">No image</span>;
  // Two thumbnails at most, so rows stay compact; the rest open in the viewer
  const shown = images.slice(0, 2);
  const more = images.length - shown.length;
  return (
    <div className="thumbs">
      {shown.map((src, i) => (
        <button key={src} type="button" className="thumb" onClick={() => onOpen(i)}
          aria-label={`Open image ${i + 1} of ${images.length} for ${dvp.dvpNumber}`}>
          <img src={src} alt="" loading="lazy" decoding="async" />
        </button>
      ))}
      {more > 0 && (
        <button type="button" className="thumb-more" onClick={() => onOpen(2)}
          aria-label={`Open ${more} more image${more === 1 ? "" : "s"} for ${dvp.dvpNumber}`}>
          +{more}
        </button>
      )}
    </div>
  );
}

function ImageViewer({ dvp, index: startIndex, onClose }) {
  const images = dvp.referenceImages;
  const [index, setIndex] = useState(startIndex);
  const closeRef = useRef(null);
  const step = useCallback((delta) => setIndex((i) => (i + delta + images.length) % images.length), [images.length]);

  useEffect(() => {
    const opener = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      opener?.focus?.();   // return focus to the thumbnail that opened it
    };
  }, [onClose, step]);

  return (
    <div className="viewer" role="dialog" aria-modal="true"
      aria-label={`Reference images for ${dvp.dvpNumber}`} onClick={onClose}>
      <div className="viewer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-head">
          <div>
            <strong>{dvp.dvpNumber}</strong>
            <span className="viewer-title">{dvp.component} — {dvp.evaluationParameter}</span>
          </div>
          <button type="button" ref={closeRef} className="viewer-close" onClick={onClose}>Close</button>
        </div>
        <img className="viewer-img" src={images[index]} alt={`Reference image ${index + 1} for ${dvp.dvpNumber}`} />
        {images.length > 1 && (
          <div className="viewer-nav">
            <button type="button" onClick={() => step(-1)}>Previous</button>
            <span>Image {index + 1} of {images.length}</span>
            <button type="button" onClick={() => step(1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
}
