import { useCallback, useEffect, useRef, useState } from "react";
import AuthImage from "./AuthImage.jsx";

export const COLORS = ["Red", "Blue", "Green"];

export function Clamp({ text, empty = "—" }) {
  if (!text) return <span className="muted">{empty}</span>;
  return <div className="cell-text clamped">{text}</div>;
}

export function ColorTag({ color }) {
  if (!color) return <span className="color-tag color-open">Open</span>;
  return <span className={`color-tag color-${color.toLowerCase()}`}>{color}</span>;
}

// The images of a DVP: its reference images, or (kind "observation") the observation images added in this program,
// which are only served to signed-in people and so are shown through AuthImage
export const imagesOf = (dvp, kind) => (kind === "observation" ? (dvp.observationImages || []).map((o) => o.url) : dvp.referenceImages || []);
const Pic = ({ src, signedIn, alt = "" }) => (signedIn ? <AuthImage src={src} alt={alt} /> : <img src={src} alt={alt} loading="lazy" decoding="async" />);

export function Thumbnails({ dvp, onOpen, kind = "reference", empty = "No image" }) {
  const images = imagesOf(dvp, kind);
  const signedIn = kind === "observation";
  const what = kind === "observation" ? "observation image" : "image";
  if (images.length === 0) return <span className="muted">{empty}</span>;
  // Two thumbnails at most, so rows stay compact; the rest open in the viewer
  const shown = images.slice(0, 2);
  const more = images.length - shown.length;
  return (
    <div className="thumbs">
      {shown.map((src, i) => (
        <button key={src} type="button" className="thumb" onClick={() => onOpen(i)}
          aria-label={`Open ${what} ${i + 1} of ${images.length} for ${dvp.dvpNumber}`}>
          <Pic src={src} signedIn={signedIn} />
        </button>
      ))}
      {more > 0 && (
        <button type="button" className="thumb-more" onClick={() => onOpen(2)}
          aria-label={`Open ${more} more ${what}${more === 1 ? "" : "s"} for ${dvp.dvpNumber}`}>
          +{more}
        </button>
      )}
    </div>
  );
}

export function ImageViewer({ dvp, index: startIndex, kind = "reference", onClose }) {
  const images = imagesOf(dvp, kind);
  const observation = kind === "observation";
  const what = observation ? "Observation image" : "Reference image";
  const [wanted, setIndex] = useState(startIndex);
  const index = Math.max(0, Math.min(wanted, images.length - 1));      // the list can shrink while open (an image removed)
  const closeRef = useRef(null);
  const step = useCallback((delta) => setIndex((i) => (Math.min(i, images.length - 1) + delta + images.length) % images.length), [images.length]);

  useEffect(() => {
    const opener = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); opener?.focus?.(); };
  }, [onClose, step]);

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={`${what}s for ${dvp.dvpNumber}`} onClick={onClose}>
      <div className="viewer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-head">
          <div><strong>{dvp.dvpNumber}</strong><span className="viewer-title">{dvp.component} — {dvp.evaluationParameter}</span></div>
          <button type="button" ref={closeRef} className="btn" onClick={onClose}>Close</button>
        </div>
        {images.length === 0 ? <p className="notice viewer-empty">This image has been removed.</p>
          : observation ? <AuthImage key={images[index]} className="viewer-img" src={images[index]} alt={`${what} ${index + 1} for ${dvp.dvpNumber}`} />
          : <img className="viewer-img" src={images[index]} alt={`${what} ${index + 1} for ${dvp.dvpNumber}`} />}
        {observation && images.length > 0 && <ObservationMeta o={dvp.observationImages[index]} />}
        {images.length > 1 && (
          <div className="viewer-nav">
            <button type="button" className="btn" onClick={() => step(-1)}>Previous</button>
            <span>{what} {index + 1} of {images.length}</span>
            <button type="button" className="btn" onClick={() => step(1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
}

export const shortDate = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "");
function ObservationMeta({ o }) {
  if (!o) return null;
  return <p className="viewer-meta">Added by {o.uploadedBy.name || "unknown"}{o.uploadedAt ? ` on ${shortDate(o.uploadedAt)}` : ""}</p>;
}

export function useZones(list) {
  const seen = new Map();
  list.forEach((d) => seen.set(d.zone.name, d.zone.order));
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
}
