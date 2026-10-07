import { useEffect, useRef, useState } from "react";
import { fetchMe, fetchPrograms, getToken, setToken, setSessionEndedHandler } from "./api.js";
import Login from "./Login.jsx";
import DvpsView from "./DvpsView.jsx";
import AdminView from "./AdminView.jsx";
import CatalogView from "./CatalogView.jsx";
import ProgramsView from "./ProgramsView.jsx";

const ADMIN_VIEWS = ["manage", "catalog", "programs"];

function readParam(name) { return new URLSearchParams(window.location.search).get(name) || ""; }
function writeParams(params) {
  const url = new URL(window.location.href);
  Object.entries(params).forEach(([k, v]) => (v ? url.searchParams.set(k, v) : url.searchParams.delete(k)));
  window.history.replaceState({}, "", url);
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(Boolean(getToken()));
  const [notice, setNotice] = useState("");
  const [programs, setPrograms] = useState([]);
  const [programCode, setProgramCode] = useState(() => readParam("program"));
  const [view, setView] = useState(() => (ADMIN_VIEWS.includes(readParam("view")) ? readParam("view") : "dvps"));
  const unsavedRef = useRef(false); // set by the admin view while it has unsaved changes

  useEffect(() => {
    setSessionEndedHandler((message) => { setUser(null); setNotice(message); });
    if (!getToken()) return;
    fetchMe().then(({ user }) => setUser(user)).catch(() => {}).finally(() => setChecking(false));
  }, []);

  const loadPrograms = () => fetchPrograms().then(setPrograms).catch(() => {});
  useEffect(() => { if (user) loadPrograms(); }, [user]);

  // A plain user can't open the admin view, even from a bookmarked link
  const activeView = ADMIN_VIEWS.includes(view) && user?.role === "ADMIN" ? view : "dvps";
  const usesProgram = activeView === "dvps" || activeView === "manage";   // the catalog and programs screens don't depend on one
  useEffect(() => { if (user) writeParams({ program: usesProgram ? programCode : "", view: activeView === "dvps" ? "" : activeView }); }, [user, programCode, activeView, usesProgram]);

  const confirmLeave = () => !unsavedRef.current || window.confirm("You have unsaved DVP selection changes. Leave without saving?");
  const changeProgram = (code) => { if (confirmLeave()) setProgramCode(code); };
  const changeView = (v) => { if (v !== activeView && confirmLeave()) { setView(v); if (v === "dvps") loadPrograms(); } };
  const signOut = () => { if (!confirmLeave()) return; setToken(null); setUser(null); setNotice("You have signed out."); };

  if (checking) return <div className="page"><p className="notice" role="status">Loading…</p></div>;
  if (!user) return <Login notice={notice} onSignedIn={(u) => { setNotice(""); setUser(u); }} />;

  return (
    <div className="page">
      <header className="masthead">
        <div className="brand">
          <h1>DVP Portal</h1>
          <p>Design verification plans for the Mahindra VR Lab</p>
        </div>
        <div className="masthead-right">
          <div className="account">
            <span>{user.name} <span className="role">({user.role === "ADMIN" ? "Admin" : "User"})</span></span>
            <button type="button" className="link-btn" onClick={signOut}>Sign out</button>
          </div>
          {usesProgram && (
            <label className="program-picker">
              <span>Program</span>
              <select value={programCode} onChange={(e) => changeProgram(e.target.value)}>
                <option value="">Select a program</option>
                {programs.map((p) => <option key={p.code} value={p.code}>{p.code}</option>)}
              </select>
            </label>
          )}
        </div>
      </header>

      {user.role === "ADMIN" && (
        <nav className="tabs" aria-label="Sections">
          <button type="button" aria-current={activeView === "dvps" ? "page" : undefined} onClick={() => changeView("dvps")}>DVPs</button>
          <button type="button" aria-current={activeView === "manage" ? "page" : undefined} onClick={() => changeView("manage")}>Manage program DVPs</button>
          <button type="button" aria-current={activeView === "catalog" ? "page" : undefined} onClick={() => changeView("catalog")}>DVP catalog</button>
          <button type="button" aria-current={activeView === "programs" ? "page" : undefined} onClick={() => changeView("programs")}>Programs</button>
        </nav>
      )}

      <main>
        {activeView === "catalog" ? (
          <CatalogView programs={programs} />
        ) : activeView === "programs" ? (
          <ProgramsView programs={programs} onCreated={loadPrograms}
            onManage={(code) => { setProgramCode(code); changeView("manage"); }} />
        ) : !programCode ? (
          <p className="notice">
            {activeView === "manage" ? "Choose a program to choose which DVPs apply to it." : "Choose a program to see the DVPs that apply to it."}
          </p>
        ) : activeView === "manage" ? (
          <AdminView key={programCode} programCode={programCode} programs={programs}
            onSaved={loadPrograms} onDirtyChange={(d) => { unsavedRef.current = d; }} />
        ) : (
          <DvpsView key={programCode} programCode={programCode} user={user} />
        )}
      </main>
    </div>
  );
}
