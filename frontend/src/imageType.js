// What kind of image a file really is, judged by its first bytes - not its name or the type the
// browser reports (the browser guesses that from the file extension, so a text file renamed .png
// would pass). The server makes the same check; doing it here too tells the admin immediately.
// SVG is deliberately not accepted: it can carry script.
export function sniffImageType(bytes) {
  if (!bytes || bytes.length < 12) return null;
  const at = (i) => bytes[i];
  const ascii = (from, to) => String.fromCharCode(...Array.from(bytes).slice(from, to));
  if (at(0) === 0x89 && ascii(1, 4) === "PNG" && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) return "png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  return null;
}

export async function sniffImageFile(file) {
  return sniffImageType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
}
