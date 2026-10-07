// Shared input rules for anything an admin types in.
//
// Same policy as VRSP: text that starts with = + - @ is refused, because a spreadsheet
// would read it as a formula if the data is ever exported (full-width look-alikes
// included). Control characters are refused too. Returns { value } or { error }.

const FORMULA_START = /^[=+\-@＝＋－＠]/;
// everything below space except tab / line feed / carriage return, plus DEL
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function cleanText(input, { label, max, required = false }) {
  const raw = input === undefined || input === null ? "" : String(input);
  const value = raw.replace(/\r\n/g, "\n").trim();
  if (!value) return required ? { error: `${label} is required.` } : { value: "" };
  if (value.length > max) return { error: `${label} can be at most ${max} characters.` };
  if (CONTROL_CHARS.test(value)) return { error: `${label} contains characters that aren't allowed.` };
  if (FORMULA_START.test(value)) {
    return { error: `${label} can't start with =, +, - or @ (spreadsheets treat these as formulas).` };
  }
  return { value };
}

// Run several cleanText checks; returns { values } or { error } for the first problem
function cleanFields(source, rules) {
  const values = {};
  for (const [field, rule] of Object.entries(rules)) {
    const r = cleanText(source[field], rule);
    if (r.error) return { error: r.error };
    values[field] = r.value;
  }
  return { values };
}

// Images are accepted only if their first bytes say PNG, JPEG or WebP - the file
// name and the browser-reported type are ignored. (No SVG: it can carry script.)
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 32) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", mime: "image/png" };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { ext: "webp", mime: "image/webp" };
  return null;
}

module.exports = { cleanText, cleanFields, sniffImage, FORMULA_START, CONTROL_CHARS };
