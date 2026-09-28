import { useCallback, useEffect, useRef, useState } from "react";

export const COLORS = ["Red", "Blue", "Green"];

export function Clamp({ text, empty = "—" }) {
  if (!text) return <span className="muted">{empty}</span>;
  return <div className="cell-text clamped">{text}</div>;
}

export function ColorTag({ color }) {
  if (!color) return <span className="muted">No colour</span>;
  return <span className={`color-tag color-${color.toLowerCase()}`}>{color}</span>;
}

export function Thumbnails({ dvp, onOpen }) {
  const images = dvp.referenceImages || [];
  if (images.length === 0) return <span className="muted">No image</span>;
  // Two thumbnails at most, so rows stay compact; the rest open in the viewer
  const shown = images.slice(0, 2);
  const more = images.length - shown.length;
  return (
    <div className="thumbs">
      {shown.map((src, i) => (
        <button key={src} type="button" className="thumb" onClick={() => onOpen(i)}
          aria-label={`Open image ${i + 1} of ${images.length} for ${dvp.dvpNumber}`}>
          <img src={src} alt="" loading="lazy" decoding="async" />
        </button>
      ))}
      {more > 0 && (
        <button type="button" className="thumb-more" onClick={() => onOpen(2)}
          aria-label={`Open ${more} more image${more === 1 ? "" : "s"} for ${dvp.dvpNumber}`}>
          +{more}
        </button>
      )}
    </div>
  );
}

export function ImageViewer({ dvp, index: startIndex, onClose }) {
  const images = dvp.referenceImages;
  const [index, setIndex] = useState(startIndex);
  const closeRef = useRef(null);
  const step = useCallback((delta) => setIndex((i) => (i + delta + images.length) % images.length), [images.length]);

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
    <div className="viewer" role="dialog" aria-modal="true" aria-label={`Reference images for ${dvp.dvpNumber}`} onClick={onClose}>
      <div className="viewer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-head">
          <div><strong>{dvp.dvpNumber}</strong><span className="viewer-title">{dvp.component} — {dvp.evaluationParameter}</span></div>
          <button type="button" ref={closeRef} className="btn" onClick={onClose}>Close</button>
        </div>
        <img className="viewer-img" src={images[index]} alt={`Reference image ${index + 1} for ${dvp.dvpNumber}`} />
        {images.length > 1 && (
          <div className="viewer-nav">
            <button type="button" className="btn" onClick={() => step(-1)}>Previous</button>
            <span>Image {index + 1} of {images.length}</span>
            <button type="button" className="btn" onClick={() => step(1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function useZones(list) {
  const seen = new Map();
  list.forEach((d) => seen.set(d.zone.name, d.zone.order));
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
}
