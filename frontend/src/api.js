async function get(path) {
  const res = await fetch(`/api${path}`, { headers: { Accept: "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `Request failed (${res.status}).`);
  return body;
}

export const fetchPrograms = () => get("/programs");
export const fetchProgramDvps = (code) => get(`/programs/${encodeURIComponent(code)}/dvps`);
