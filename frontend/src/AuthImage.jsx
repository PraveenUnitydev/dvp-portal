import { useEffect, useState } from "react";
import { fetchProtectedImage } from "./api.js";

// An image that is only served to signed-in people (LOP pictures). The browser can't attach the sign-in to a plain
// <img>, so the picture is fetched with it and shown from a local blob.
export default function AuthImage({ src, alt = "", className }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setUrl(null); setFailed(false);
    fetchProtectedImage(src).then((u) => { if (live) setUrl(u); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [src]);
  if (failed) return <span className="muted">Picture unavailable</span>;
  if (!url) return <span className="img-loading" aria-hidden="true" />;
  return <img className={className} src={url} alt={alt} />;
}
