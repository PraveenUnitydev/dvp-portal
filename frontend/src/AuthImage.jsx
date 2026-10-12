import { useEffect, useRef, useState } from "react";
import { fetchProtectedImage } from "./api.js";

// An image that is only served to signed-in people (LOP and observation pictures). The browser can't attach the
// sign-in to a plain <img>, so the picture is fetched with it and shown from a local blob. It is fetched only once it
// comes near the screen, so a long DVP table doesn't download every picture up front.
export default function AuthImage({ src, alt = "", className }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
  const holder = useRef(null);

  useEffect(() => {
    if (near || !holder.current) return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: "400px" });
    io.observe(holder.current);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near) return;
    let live = true;
    setUrl(null); setFailed(false);
    fetchProtectedImage(src).then((u) => { if (live) setUrl(u); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [src, near]);
  if (failed) return <span className="muted">Picture unavailable</span>;
  if (!url) return <span ref={holder} className="img-loading" aria-hidden="true" />;
  return <img className={className} src={url} alt={alt} />;
}
