import { useEffect, useState } from "react";
import { fetchSsoConfig, login, setToken, ssoStartUrl } from "./api.js";

// Sign-in. With Microsoft sign-in set up (through VRSP), that is the way in; a portal account (username + password)
// stays available underneath as a fallback.
export default function Login({ onSignedIn, notice, noticeKind }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sso, setSso] = useState(null);          // null while asking the server, then true / false
  const [going, setGoing] = useState(false);

  useEffect(() => { fetchSsoConfig().then((r) => setSso(Boolean(r.enabled))).catch(() => setSso(false)); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { token, user } = await login(username, password);
      setToken(token);
      onSignedIn(user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const localForm = (
    <form onSubmit={submit} className="login-local">
      <label className="field">
        <span>Username</span>
        <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus={sso === false} />
      </label>
      <label className="field">
        <span>Password</span>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <button type="submit" className={`btn btn-block ${sso ? "" : "btn-primary"}`} disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>DVP Portal</h1>
        <p className="login-sub">Design verification plans for the Mahindra VR Lab</p>
        {notice && !error && (
          <p className={`notice ${noticeKind === "error" ? "notice-error" : noticeKind === "pending" ? "notice-pending" : ""}`} role={noticeKind === "error" ? "alert" : "status"}>{notice}</p>
        )}
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        {sso === null ? <p className="muted" role="status">Loading…</p> : sso ? (
          <>
            <a className={`btn btn-primary btn-block btn-ms ${going ? "is-busy" : ""}`} href={ssoStartUrl()} onClick={() => setGoing(true)} aria-busy={going}>
              <span className="ms-mark" aria-hidden="true"><i /><i /><i /><i /></span>
              {going ? "Opening Microsoft sign-in…" : "Sign in with Microsoft"}
            </a>
            <p className="hint login-hint">Use your Mahindra account, the same as the VR Service Portal.</p>
            <details className="login-alt">
              <summary>Sign in with a portal account instead</summary>
              {localForm}
            </details>
          </>
        ) : localForm}
      </div>
    </div>
  );
}
