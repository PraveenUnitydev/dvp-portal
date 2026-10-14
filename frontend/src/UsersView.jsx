import { useEffect, useMemo, useState } from "react";
import { fetchUsers, updateUser } from "./api.js";

const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "");

// Admin: who can use the portal. People appear here the first time they sign in with Microsoft; approve them, set
// their role, or turn their access off. A change applies on the person's next click.
export default function UsersView({ me }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");          // id being saved
  const [flash, setFlash] = useState("");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");

  const load = () => fetchUsers().then((r) => setUsers(r.users)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const change = async (u, changes, done) => {
    setBusy(u.id); setError(""); setFlash("");
    try {
      const saved = await updateUser(u.id, changes);
      setUsers((list) => list.map((x) => (x.id === saved.id ? saved : x)));
      setFlash(done(saved));
    } catch (e) { setError(e.message); }
    setBusy("");
  };

  const counts = useMemo(() => {
    const list = users || [];
    return { all: list.length, pending: list.filter((u) => u.pending).length, admins: list.filter((u) => u.role === "ADMIN" && u.active).length, off: list.filter((u) => !u.active && !u.pending).length };
  }, [users]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (users || []).filter((u) =>
      (filter === "all" || (filter === "pending" && u.pending) || (filter === "admins" && u.role === "ADMIN" && u.active) || (filter === "off" && !u.active && !u.pending)) &&
      (!q || [u.name, u.email, u.username, u.department, u.jobTitle].some((v) => (v || "").toLowerCase().includes(q))));
  }, [users, filter, query]);

  if (!users && !error) return <p className="notice" role="status">Loading users…</p>;
  if (!users) return <p className="notice notice-error" role="alert">{error}</p>;

  const isMe = (u) => u.username === me.username;
  return (
    <>
      <div className="toolbar">
        <p className="summary">
          People appear here the first time they sign in with Microsoft. Admins can do everything; users can work on DVPs
          as the Settings allow.
        </p>
      </div>
      <div className="filters users-filters">
        <div className="segmented" role="radiogroup" aria-label="Show">
          {[["all", "Everyone"], ["pending", "Waiting"], ["admins", "Admins"], ["off", "Access off"]].map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={filter === k} onClick={() => setFilter(k)}>
              {label} <span className="seg-count">{counts[k]}</span>
            </button>
          ))}
        </div>
        <label className="search"><span>Search</span>
          <input type="search" value={query} placeholder="Name, email or department" onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <p className="flash" role="status">{flash}</p>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {counts.pending > 0 && filter === "all" && (
        <p className="notice notice-pending">{counts.pending} {counts.pending === 1 ? "person is" : "people are"} waiting for access.</p>
      )}

      {shown.length === 0 ? <p className="notice">No one matches.</p> : (
        <div className="table-wrap table-plain">
          <table className="users-table">
            <thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Role</th><th>Access</th><th>Last sign-in</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id} className={`row ${u.pending ? "row-waiting" : !u.active ? "archived-row" : ""}`}>
                  <td><strong>{u.name}</strong>{isMe(u) && <span className="muted"> (you)</span>}{u.jobTitle && <div className="muted small">{u.jobTitle}</div>}</td>
                  <td>{u.email || <span className="muted">{u.username} · portal account</span>}</td>
                  <td>{u.department || <span className="muted">—</span>}</td>
                  <td>
                    <select aria-label={`Role of ${u.name}`} value={u.role} disabled={Boolean(busy) || isMe(u) || u.pending}
                      onChange={(e) => change(u, { role: e.target.value }, (s) => `${s.name} is now ${s.role === "ADMIN" ? "an admin" : "a user"}.`)}>
                      <option value="USER">User</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                  </td>
                  <td>{u.pending ? <span className="access access-pending">Waiting</span> : u.active ? <span className="access access-on">On</span> : <span className="access access-off">Off</span>}</td>
                  <td>{u.lastLoginAt ? when(u.lastLoginAt) : <span className="muted">Never</span>}</td>
                  <td><div className="cell-actions">
                    {u.pending ? (
                      <>
                        <button type="button" className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => change(u, { active: true }, (s) => `${s.name} can now use the portal as ${s.role === "ADMIN" ? "an admin" : "a user"}.`)}>Approve</button>
                        <button type="button" className="link-btn" disabled={Boolean(busy)} onClick={() => change(u, { active: false }, (s) => `${s.name} was not given access.`)}>Decline</button>
                      </>
                    ) : isMe(u) ? null : u.active ? (
                      <button type="button" className="link-btn" disabled={Boolean(busy)}
                        onClick={() => window.confirm(`Turn off access for ${u.name}? They are signed out at their next click.`) && change(u, { active: false }, (s) => `Access turned off for ${s.name}.`)}>Turn off access</button>
                    ) : (
                      <button type="button" className="link-btn" disabled={Boolean(busy)} onClick={() => change(u, { active: true }, (s) => `Access turned on for ${s.name}.`)}>Turn on access</button>
                    )}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
