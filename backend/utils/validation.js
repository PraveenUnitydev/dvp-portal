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

// VR report files: accepted by their content, never by name. `head` is the start of the file, `tail` its last part
// (where a zip keeps its list of files). Office files are zips: which one it is shows in the names inside. Macro
// files (.pptm, .docm, .xlsm carry vbaProject.bin) are refused even when renamed.
const DOC_KINDS = {
  pdf:  { ext: "pdf",  mime: "application/pdf", label: "PDF" },
  pptx: { ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", label: "PowerPoint" },
  docx: { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Word" },
  xlsx: { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "Excel" },
};
function sniffDocument(head, tail) {
  if (!Buffer.isBuffer(head) || head.length < 8) return { error: "The file is empty or too small." };
  if (head.toString("latin1", 0, 5) === "%PDF-") return { kind: DOC_KINDS.pdf };
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    const names = Buffer.isBuffer(tail) ? tail.toString("latin1") : "";
    if (/vbaProject\.bin/.test(names)) return { error: "Files with macros can't be uploaded. Save it as a normal .pptx, .docx or .xlsx." };
    if (names.includes("ppt/presentation.xml")) return { kind: DOC_KINDS.pptx };
    if (names.includes("word/document.xml")) return { kind: DOC_KINDS.docx };
    if (names.includes("xl/workbook.xml")) return { kind: DOC_KINDS.xlsx };
  }
  if (head.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    return { error: "Old Office files (.ppt, .doc, .xls) aren't accepted. Save it as .pptx, .docx or .xlsx, or as a PDF." };
  }
  return { error: "Only PDF, PowerPoint (.pptx), Word (.docx) and Excel (.xlsx) files can be uploaded." };
}

module.exports = { cleanText, cleanFields, sniffImage, sniffDocument, DOC_KINDS, FORMULA_START, CONTROL_CHARS };
