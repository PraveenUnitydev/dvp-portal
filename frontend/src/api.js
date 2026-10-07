const TOKEN_KEY = "dvpPortalToken";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

// Called when the server says the session is no longer valid
let onSessionEnded = () => {};
export const setSessionEndedHandler = (fn) => { onSessionEnded = fn; };

// `json` for ordinary calls, `form` (a FormData) for uploads - the browser sets the multipart header itself
async function send(method, path, { json, form } = {}) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(json !== undefined && { "Content-Type": "application/json" }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: form ?? (json !== undefined ? JSON.stringify(json) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token && path !== "/auth/login") {
    setToken(null);
    onSessionEnded(data.message || "Your session has ended. Sign in again.");
  }
  if (!res.ok) throw new Error(data.message || `Request failed (${res.status}).`);
  return data;
}
const request = (method, path, body) => send(method, path, { json: body });

export const login = (username, password) => request("POST", "/auth/login", { username, password });
export const fetchMe = () => request("GET", "/auth/me");
export const fetchPrograms = () => request("GET", "/programs");
export const fetchProgramDvps = (code) => request("GET", `/programs/${encodeURIComponent(code)}/dvps`);
export const updateProgramDvp = (code, dvpCode, changes) =>
  request("PATCH", `/programs/${encodeURIComponent(code)}/dvps/${encodeURIComponent(dvpCode)}`, changes);
export const fetchCatalog = (code) => request("GET", `/admin/programs/${encodeURIComponent(code)}/catalog`);
export const saveApplicability = (code, codes) =>
  request("PUT", `/admin/programs/${encodeURIComponent(code)}/applicability`, { codes });

// Admin: the base reference catalog, and adding to it
export const fetchCatalogDvps = () => request("GET", "/admin/dvps");
export const createDvp = (formData) => send("POST", "/admin/dvps", { form: formData });
export const createProgram = (fields) => request("POST", "/admin/programs", fields);
