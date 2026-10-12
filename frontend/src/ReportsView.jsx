import { useEffect, useMemo, useRef, useState } from "react";
import { downloadVrReport, fetchAllVrReports, fetchProgramDvps, fetchReport, fetchVrReports } from "./api.js";
import { loadReportImage } from "./report/images.js";
import { ColorTag } from "./shared.jsx";
import AuthImage from "./AuthImage.jsx";
import VrReportsPanel from "./VrReportsPanel.jsx";

const SCOPES = [
  ["overall", "All programs"],
  ["program", "One program"],
  ["dvp", "One DVP"],
];
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "");

// Reports: one DVP, one program, or every program. Two kinds of download:
//  - VR report: the lab's own report file for the program, uploaded by an admin (listed below the choice)
//  - Generate PowerPoint: a .pptx built now in the browser from the portal's DVPs and LOP concerns (pictures included)
// "View summary" shows the generated report's content on the page.
export default function ReportsView({ programs, programCode, user }) {
  const [scope, setScope] = useState("program");
  const [program, setProgram] = useState(programCode || programs[0]?.code || "");
  const [dvpList, setDvpList] = useState([]);
  const [dvpCode, setDvpCode] = useState("");
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState("");          // what is happening now ("" = idle)
  const [error, setError] = useState("");
  const pendingDvp = useRef("");                 // a DVP picked from a program summary, chosen once the list is loaded
  const autoView = useRef(false);                // show the summary as soon as the choice is complete
  const [vr, setVr] = useState(null);            // VR reports for the choice: { key, data }
  const [vrTick, setVrTick] = useState(0);       // bumped after an upload or delete
  const isAdmin = user?.role === "ADMIN";

  useEffect(() => { if (!program && programs[0]) setProgram(programs[0].code); }, [programs]);

  // The DVP list for the "One DVP" choice
  useEffect(() => {
    if (scope !== "dvp" || !program) return;
    let live = true;
    setDvpList([]); setDvpCode("");
    fetchProgramDvps(program).then((r) => {
      if (!live) return;
      setDvpList(r.dvps || []);
      const want = pendingDvp.current;
      pendingDvp.current = "";
      if (want && (r.dvps || []).some((d) => d.code === want)) setDvpCode(want);
    }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [scope, program]);

  // The VR reports for the choice: one program's (program / DVP), or every program's (overall)
  const vrKey = scope === "overall" ? "*" : program;
  useEffect(() => {
    if (!vrKey) return;
    let live = true;
    (vrKey === "*" ? fetchAllVrReports() : fetchVrReports(vrKey))
      .then((data) => { if (live) setVr({ key: vrKey, data }); })
      .catch((e) => { if (live) { setVr({ key: vrKey, data: vrKey === "*" ? { programs: [] } : { reports: [] } }); setError(e.message); } });
    return () => { live = false; };
  }, [vrKey, vrTick]);
  const vrData = vr?.key === vrKey ? vr.data : null;
  const latestVr = scope !== "overall" ? vrData?.reports?.[0] : null;

  // A summary on screen belongs to the choice it was made for
  useEffect(() => { setReport(null); setError(""); }, [scope, program, dvpCode]);

  const ready = scope === "overall" || (scope === "program" && program) || (scope === "dvp" && program && dvpCode);
  useEffect(() => { if (autoView.current && ready) { autoView.current = false; viewSummary(); } }, [scope, program, dvpCode, ready]);

  const load = async () => {
    const r = await fetchReport(scope, program, dvpCode);
    setReport(r);
    return r;
  };

  const viewSummary = async () => {
    setError(""); setBusy("Loading the summary…");
    try { await load(); } catch (e) { setError(e.message); }
    setBusy("");
  };

  const downloadVr = async () => {
    if (!latestVr) return;
    setError(""); setBusy("Starting the download…");
    try { await downloadVrReport(latestVr.id); } catch (e) { setError(e.message); }
    setBusy("");
  };

  const generate = async () => {
    setError(""); setBusy("Collecting the data…");
    try {
      const r = report || (await load());
      setBusy("Preparing the slides…");
      const [{ default: PptxGenJS }, { buildDeck, deckFileName }] = await Promise.all([import("pptxgenjs"), import("./report/deck.js")]);
      const pres = await buildDeck(PptxGenJS, r, { loadImage: loadReportImage, onProgress: setBusy });
      setBusy("Saving the file…");
      await pres.writeFile({ fileName: deckFileName(r) });
    } catch (e) {
      setError(`The report could not be made: ${e.message}`);
    }
    setBusy("");
  };

  return (
    <>
      <section className="report-pick" aria-label="Choose a report">
        <div className="segmented" role="radiogroup" aria-label="Report for">
          {SCOPES.map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={scope === value} onClick={() => setScope(value)}>{label}</button>
          ))}
        </div>
        {scope !== "overall" && (
          <label className="field"><span>Program</span>
            <select value={program} onChange={(e) => setProgram(e.target.value)}>
              {programs.length === 0 && <option value="">No programs</option>}
              {programs.map((p) => <option key={p.code} value={p.code}>{p.code}{p.name && p.name !== p.code ? ` · ${p.name}` : ""}</option>)}
            </select>
          </label>
        )}
        {scope === "dvp" && (
          <label className="field field-wide"><span>DVP</span>
            <select value={dvpCode} onChange={(e) => setDvpCode(e.target.value)} disabled={dvpList.length === 0}>
              <option value="">{dvpList.length ? "Choose a DVP" : "Loading DVPs…"}</option>
              {dvpList.map((d) => <option key={d.code} value={d.code}>{d.dvpNumber} · {d.component || d.evaluationParameter}{d.lopCount ? ` · LOP ${d.lopCount}` : ""}</option>)}
            </select>
          </label>
        )}
        <div className="report-actions">
          <button type="button" className="btn" disabled={!ready || Boolean(busy)} onClick={viewSummary}>View summary</button>
          {scope !== "overall" && (
            <button type="button" className="btn" disabled={!latestVr || Boolean(busy)} onClick={downloadVr}
              title={latestVr ? `${latestVr.title} (${latestVr.kind})` : vrData ? `No VR report has been uploaded for ${program} yet` : "Loading…"}>
              Download VR report
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={!ready || Boolean(busy)} onClick={generate}>Generate PowerPoint</button>
        </div>
        <p className="hint report-legend">
          {scope === "overall"
            ? <><strong>VR reports</strong> of each program are listed below. </>
            : <><strong>Download VR report</strong> gives the newest report uploaded for {program || "the program"}{vrData && !latestVr ? " (none yet)" : ""}. </>}
          <strong>Generate PowerPoint</strong> makes a deck now from the portal's DVP colours and LOP concerns.
        </p>
      </section>
      <p className="report-status" role="status" aria-live="polite">{busy}</p>
      {error && <p className="notice notice-error" role="alert">{error}</p>}

      {report?.scope === "overall" && <OverallSummary report={report} onProgram={(code) => { autoView.current = true; setScope("program"); setProgram(code); }} />}
      {report?.scope === "program" && <ProgramSummary report={report} onDvp={(code) => { autoView.current = true; pendingDvp.current = code; setScope("dvp"); }} />}
      {report?.scope === "dvp" && <DvpSummary report={report} />}
      {vrKey && (
        <VrReportsPanel scope={scope} program={program} data={vrData} isAdmin={isAdmin}
          onChanged={() => setVrTick((n) => n + 1)} onError={setError} />
      )}
    </>
  );
}

function Stats({ items }) {
  return (
    <div className="stat-row">
      {items.map(([label, value, tone]) => (
        <div key={label} className={`stat ${tone ? `stat-${tone}` : ""}`}><strong>{value}</strong><span>{label}</span></div>
      ))}
    </div>
  );
}

const colourStats = (c) => [["Red", c.red, "red"], ["Blue", c.blue, "blue"], ["Green", c.green, "green"], ["Open", c.open, "open"]];

function Stamp({ report }) {
  return <p className="hint report-stamp">Made {when(report.generatedAt)} for {report.generatedBy}.</p>;
}

function OverallSummary({ report, onProgram }) {
  const { totals, programs } = report;
  return (
    <section className="card report-card" aria-label="Summary for all programs">
      <h2>All programs</h2>
      <Stamp report={report} />
      <Stats items={[["Programs", totals.programs], ["DVPs", totals.dvps], ["Assessed", totals.assessed], ["LOP concerns", totals.lop, totals.lop ? "red" : ""], ...colourStats(totals)]} />
      <div className="table-wrap table-plain">
        <table>
          <thead><tr><th>Program</th><th>DVPs</th><th>Assessed</th><th>Red</th><th>Blue</th><th>Green</th><th>Open</th><th>LOP concerns</th><th>Latest LOP concern</th></tr></thead>
          <tbody>
            {programs.map((p) => {
              const latest = p.lopDvps.flatMap((d) => d.lop.map((e) => ({ ...e, dvpNumber: d.dvpNumber }))).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
              return (
                <tr key={p.code} className="row">
                  <td><button type="button" className="link-btn" onClick={() => onProgram(p.code)} title="Open this program's summary"><strong>{p.code}</strong></button>{p.name && p.name !== p.code ? <span className="muted"> {p.name}</span> : null}</td>
                  <td>{p.counts.dvps}</td><td>{p.counts.assessed}</td>
                  <td className="t-red">{p.counts.red}</td><td className="t-blue">{p.counts.blue}</td><td className="t-green">{p.counts.green}</td><td>{p.counts.open}</td>
                  <td><strong>{p.counts.lop}</strong></td>
                  <td>{latest ? <><span className="muted">{when(latest.createdAt)} · {latest.dvpNumber}</span><div className="cell-text clamped">{latest.details}</div></> : <span className="muted">None</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProgramSummary({ report, onDvp }) {
  const { program, counts, zones, dvps } = report;
  const lopDvps = useMemo(() => dvps.filter((d) => d.lopCount > 0), [dvps]);
  return (
    <section className="card report-card" aria-label={`Summary for ${program.code}`}>
      <h2>{program.code}{program.name && program.name !== program.code ? ` · ${program.name}` : ""}</h2>
      <Stamp report={report} />
      <Stats items={[["DVPs", counts.dvps], ["Assessed", counts.assessed], ["LOP concerns", counts.lop, counts.lop ? "red" : ""], ...colourStats(counts)]} />

      <h3>By zone</h3>
      <div className="zone-bars">
        {zones.map((z) => (
          <div key={z.name} className="zone-row">
            <span className="zone-name">{z.name}</span>
            <div className="zone-bar" aria-label={`${z.name}: ${z.red} red, ${z.blue} blue, ${z.green} green, ${z.open} open`}>
              {[["red", z.red], ["blue", z.blue], ["green", z.green], ["open", z.open]].map(([k, n]) => n > 0 && (
                <span key={k} className={`seg seg-${k}`} style={{ flexGrow: n }} title={`${k}: ${n}`}>{n}</span>
              ))}
            </div>
            <span className="zone-lop">{z.lop ? `LOP ${z.lop}` : ""}</span>
          </div>
        ))}
      </div>

      <h3>LOP concerns ({counts.lop})</h3>
      {lopDvps.length === 0 ? <p className="muted">No LOP concerns have been raised for this program.</p> : (
        <div className="table-wrap table-plain">
          <table>
            <thead><tr><th>DVP no.</th><th>Component</th><th>Evaluation</th><th>Colour</th><th>LOP</th><th>Latest concern</th></tr></thead>
            <tbody>
              {lopDvps.map((d) => (
                <tr key={d.code} className="row">
                  <td><button type="button" className="link-btn" onClick={() => onDvp(d.code)} title="Open this DVP's summary">{d.dvpNumber}</button></td>
                  <td>{d.component}</td><td>{d.evaluationParameter}</td><td><ColorTag color={d.color} /></td><td><strong>{d.lopCount}</strong></td>
                  <td><span className="muted">{when(d.lop[0]?.createdAt)} · {d.lop[0]?.raisedBy?.name}</span><div className="cell-text clamped">{d.lop[0]?.details}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DvpSummary({ report }) {
  const d = report.dvp;
  return (
    <section className="card report-card" aria-label={`Summary for ${d.dvpNumber}`}>
      <h2>{d.dvpNumber} <ColorTag color={d.color} /></h2>
      <p className="report-sub">{d.component} — {d.evaluationParameter}</p>
      <Stamp report={report} />
      <dl className="details">
        <dt>Zone</dt><dd>{d.zone?.name}</dd>
        <dt>Ergonomic area</dt><dd>{d.ergonomicsArea || "—"}</dd>
        <dt>CAS</dt><dd>{d.cas || "—"}</dd>
        <dt>Remarks</dt><dd className="pre">{d.remarks || "—"}</dd>
        <dt>Acceptance criteria</dt><dd className="pre">{d.acceptanceCriteria || "Not defined yet"}</dd>
      </dl>
      <h3>LOP history ({d.lop.length})</h3>
      {d.lop.length === 0 ? <p className="muted">No LOP concerns have been raised for this DVP.</p> : (
        <ol className="lop-list">
          {d.lop.map((e) => (
            <li key={e.id} className="lop-entry">
              <div className="lop-head"><strong>#{e.seq}</strong><time dateTime={e.createdAt}>{when(e.createdAt)}</time></div>
              <p className="lop-by">Raised by <strong>{e.raisedBy?.name || e.raisedBy?.username}</strong> · CAS/CAD details: {e.modelDetails || "—"}</p>
              <p className="pre">{e.details}</p>
              {e.images.length > 0 && (
                <div className="drawer-thumbs">
                  {e.images.map((src) => <span key={src} className="thumb thumb-lg"><AuthImage src={src} /></span>)}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
