// How DVP catalog codes are built, so the "Add DVP" form can suggest a correct one.
//
// A code looks like UDVP-101-01:
//   U / V   Usability or Visibility
//   101     the series: the zone number followed by two digits (zone 1 -> 101..107, zone 4 -> 401..404,
//           zone 10 -> 1001)
//   01      the running number inside that series
//
// Pure functions only (no React), so they can be tested on their own.

const CODE = /^([UV])DVP-(\d{3,4})-(\d{2})$/;

export const typeLetter = (type) => (type === "Visibility" ? "V" : "U");
export const parseCode = (code) => {
  const m = CODE.exec(code || "");
  return m ? { letter: m[1], series: m[2], seq: Number(m[3]) } : null;
};

export const buildCode = (type, series, seq) => `${typeLetter(type)}DVP-${series}-${String(seq).padStart(2, "0")}`;

// A series belongs to a zone when it is the zone number followed by exactly two digits
export const seriesFitsZone = (series, zoneOrder) =>
  new RegExp(`^${Number(zoneOrder)}\\d{2}$`).test(String(series));

export function zonesOf(dvps) {
  const seen = new Map();
  dvps.forEach((d) => seen.set(d.zone.order, d.zone.name));
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([order, name]) => ({ order, name }));
}

export const nextZoneOrder = (dvps) => dvps.reduce((max, d) => Math.max(max, d.zone.order), 0) + 1;

// The series already in use in a zone, in numeric order
export function seriesInZone(dvps, zoneOrder) {
  const found = new Set();
  dvps.forEach((d) => { if (d.zone.order === Number(zoneOrder)) { const p = parseCode(d.code); if (p) found.add(p.series); } });
  return [...found].sort((a, b) => Number(a) - Number(b));
}

// A sensible series to start with: the zone's latest one, or <zone>01 for a zone with none yet
export function defaultSeries(dvps, zoneOrder) {
  const existing = seriesInZone(dvps, zoneOrder);
  return existing.length ? existing[existing.length - 1] : `${Number(zoneOrder)}01`;
}

// The next unused series in a zone (for starting a new group of tests)
export function nextFreeSeries(dvps, zoneOrder) {
  const existing = seriesInZone(dvps, zoneOrder);
  return existing.length ? String(Number(existing[existing.length - 1]) + 1) : `${Number(zoneOrder)}01`;
}

// The next running number in a series, for this type. null if the series is full (99).
export function nextSequence(dvps, type, series) {
  const letter = typeLetter(type);
  let max = 0;
  dvps.forEach((d) => { const p = parseCode(d.code); if (p && p.letter === letter && p.series === String(series)) max = Math.max(max, p.seq); });
  return max >= 99 ? null : max + 1;
}

export const codeExists = (dvps, code) => dvps.some((d) => d.code === code);
