import { Fragment, useEffect, useMemo, useState } from "react";
import { fetchPrograms, fetchProgramDvps } from "./api.js";

const COMPLETION_FILTERS = ["All", "Done", "Not done"];

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
  const [completion, setCompletion] = useState("All");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());

  useEffect(() => {
    fetchPrograms()
      .then((list) => {
        setPrograms(list);
        // Only one program: select it, nothing to choose between
        if (!readProgramFromUrl() && list.length === 1) setProgramCode(list[0].code);
      })
      .catch((err) => { setStatus("error"); setError(err.message); });
  }, []);

  useEffect(() => {
    writeProgramToUrl(programCode);
    if (!programCode) { setData(null); setStatus("idle"); return; }
    let cancelled = false;
    setStatus("loading");
    setZone("All"); setCompletion("All"); setQuery(""); setExpanded(new Set());
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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return dvps.filter((d) =>
      (zone === "All" || d.zone.name === zone) &&
      (completion === "All" || d.completedStatus === completion) &&
      (!q || [d.dvpNumber, d.evaluationParameter, d.component, d.fullName]
        .some((v) => v.toLowerCase().includes(q))));
  }, [dvps, zone, completion, query]);

  const grouped = useMemo(() => {
    const groups = [];
    visible.forEach((d) => {
      const last = groups[groups.length - 1];
      if (last && last.zone === d.zone.name) last.items.push(d);
      else groups.push({ zone: d.zone.name, order: d.zone.order, items: [d] });
    });
    return groups;
  }, [visible]);

  const done = dvps.filter((d) => d.completedStatus === "Done");
  const green = done.filter((d) => d.result === "Green").length;
  const red = done.filter((d) => d.result === "Red").length;
  const filtersActive = zone !== "All" || completion !== "All" || query.trim() !== "";

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
        {status === "idle" && (
          <p className="notice">Choose a program to see the DVPs that apply to it.</p>
        )}
        {status === "loading" && <p className="notice" role="status">Loading DVPs for {programCode}…</p>}
        {status === "error" && (
          <p className="notice notice-error" role="alert">{error} Check that the server is running, then reload the page.</p>
        )}

        {status === "ready" && (
          <>
            <p className="summary">
              <strong>{dvps.length}</strong> DVPs apply to {data.program.code}.{" "}
              {done.length === 0
                ? "None are done yet."
                : <><strong>{done.length}</strong> are done: <span className="res res-green">{green} green</span>, <span className="res res-red">{red} red</span>.</>}
            </p>

            <div className="filters">
              <label>
                <span>Zone</span>
                <select value={zone} onChange={(e) => setZone(e.target.value)}>
                  <option>All</option>
                  {zones.map((z) => <option key={z}>{z}</option>)}
                </select>
              </label>
              <label>
                <span>Completed</span>
                <select value={completion} onChange={(e) => setCompletion(e.target.value)}>
                  {COMPLETION_FILTERS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label className="search">
                <span>Search</span>
                <input type="search" value={query} placeholder="DVP number, parameter or component"
                  onChange={(e) => setQuery(e.target.value)} />
              </label>
              {filtersActive && (
                <button type="button" className="link-btn"
                  onClick={() => { setZone("All"); setCompletion("All"); setQuery(""); }}>
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
                      <th scope="col" className="col-num">DVP number</th>
                      <th scope="col" className="col-param">Evaluation parameter</th>
                      <th scope="col" className="col-status">Completed</th>
                      <th scope="col">Remarks</th>
                      <th scope="col">Acceptance criteria</th>
                      <th scope="col">Procedure</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.map((g) => (
                      <Fragment key={g.zone}>
                        <tr className="zone-band">
                          <th colSpan={6} scope="colgroup">
                            <span className="zone-no">Zone {g.order}</span> {g.zone}
                            <span className="zone-count">{g.items.length} DVP{g.items.length === 1 ? "" : "s"}</span>
                          </th>
                        </tr>
                        {g.items.map((d) => {
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
                              <td className="col-param">
                                <div className="param">{d.evaluationParameter}</div>
                                <div className="component">{d.component}</div>
                              </td>
                              <td className="col-status"><Completion dvp={d} /></td>
                              <td><Clamp text={d.remarks} open={open} /></td>
                              <td><Clamp text={d.acceptanceCriteria} open={open} empty="Not defined yet" /></td>
                              <td><Clamp text={d.procedure} open={open} empty="Not defined yet" /></td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Completion({ dvp }) {
  if (dvp.completedStatus === "Done") {
    const cls = dvp.result === "Green" ? "res-green" : dvp.result === "Red" ? "res-red" : "";
    return (
      <div>
        <span className="status status-done">Done</span>
        {dvp.result !== "Pending" && <div className={`res ${cls}`}>{dvp.result}</div>}
      </div>
    );
  }
  return (
    <div>
      <span className="status">Not done</span>
      {dvp.reason && <div className="reason">{dvp.reason}</div>}
    </div>
  );
}

function Clamp({ text, open, empty = "—" }) {
  if (!text) return <span className="muted">{empty}</span>;
  return <div className={open ? "cell-text" : "cell-text clamped"}>{text}</div>;
}
