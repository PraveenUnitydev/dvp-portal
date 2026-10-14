import { getToken } from "../api.js";
import { withBase } from "../base.js";

// Pictures for the PowerPoint report, made ready in the browser. PowerPoint can't show WebP (the reference images
// are WebP), so every picture is redrawn as a JPEG, and large ones are scaled down to keep the file small.
// LOP pictures are only served to signed-in people, so they are fetched with the sign-in.
const MAX_SIDE = 1600;

export async function loadReportImage(url) {
  const headers = url.startsWith("/api/") ? { Authorization: `Bearer ${getToken()}` } : {};
  const res = await fetch(withBase(url), { headers });
  if (!res.ok) return null;
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF";                 // transparent parts of a PNG/WebP would turn black in a JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return { data: dataUrl.replace(/^data:/, ""), w, h };
  } finally {
    bitmap.close?.();
  }
}
