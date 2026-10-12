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
  if (!res.ok) {
    const error = new Error(data.message || `Request failed (${res.status}).`);
    error.status = res.status;       // lets a screen react to a conflict (409) differently from other errors
    throw error;
  }
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
export const updateDvp = (code, formData) => send("PATCH", `/admin/dvps/${encodeURIComponent(code)}`, { form: formData });
export const deleteDvp = (code) => request("DELETE", `/admin/dvps/${encodeURIComponent(code)}`);
// LOP concerns: an append-only history per DVP per program
export const fetchLop = (program, code) => request("GET", `/programs/${encodeURIComponent(program)}/dvps/${encodeURIComponent(code)}/lop`);
export const addLop = (program, code, formData) => send("POST", `/programs/${encodeURIComponent(program)}/dvps/${encodeURIComponent(code)}/lop`, { form: formData });

// LOP pictures are served only to signed-in people, and a plain <img> can't send the sign-in: fetch them with it
// and show them from a local blob. Cached per sign-in so a picture is fetched once.
const pictureCache = new Map();
export function fetchProtectedImage(url) {
  const key = `${getToken()}|${url}`;
  if (!pictureCache.has(key)) {
    pictureCache.set(key, fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then(async (res) => { if (!res.ok) throw new Error("The picture could not be loaded."); return URL.createObjectURL(await res.blob()); })
      .catch((err) => { pictureCache.delete(key); throw err; }));
  }
  return pictureCache.get(key);
}
// Reports: "overall", "program" (code) or "dvp" (code + DVP code)
export const fetchReport = (scope, program, dvpCode) => request("GET",
  scope === "overall" ? "/reports/overall"
    : scope === "program" ? `/reports/programs/${encodeURIComponent(program)}`
      : `/reports/programs/${encodeURIComponent(program)}/dvps/${encodeURIComponent(dvpCode)}`);
export const fetchAdminPrograms = () => request("GET", "/admin/programs");
export const updateProgram = (code, fields) => request("PATCH", `/admin/programs/${encodeURIComponent(code)}`, fields);

// VR reports: the lab's own report files, uploaded by an admin for each program
export const fetchVrReports = (program) => request("GET", `/programs/${encodeURIComponent(program)}/vr-reports`);
export const fetchAllVrReports = () => request("GET", "/vr-reports");
export const deleteVrReport = (id) => request("DELETE", `/vr-reports/${encodeURIComponent(id)}`);

// Reports can be large, so the upload reports its progress (fetch can't) and the download is left to the browser's
// own download manager: the page asks for a one-minute link (with the sign-in), then opens it.
export function uploadVrReport(program, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/programs/${encodeURIComponent(program)}/vr-reports`);
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON (a proxy error page) */ }
      if (xhr.status === 401 && token) { setToken(null); onSessionEnded(data.message || "Your session has ended. Sign in again."); }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      reject(new Error(data.message || (xhr.status === 413 ? "The file is too large for the server." : `Upload failed (${xhr.status}).`)));
    };
    xhr.onerror = () => reject(new Error("The upload was interrupted. Check the connection and try again."));
    xhr.send(formData);
  });
}
export async function downloadVrReport(id) {
  const { url, fileName } = await request("GET", `/vr-reports/${encodeURIComponent(id)}/link`);
  const a = document.createElement("a");
  a.href = url; a.download = fileName; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
}
