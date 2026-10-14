// Where the portal is served from: "/" when run on its own, "/dvp/" on vrc.mahindra.com (set at build time with
// `vite build --base=/dvp/`, see npm run build:vrc). The server always speaks in root paths (/api/..., /dvp-images/...);
// withBase() puts the portal's folder in front for the browser.
export const BASE = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL) || "/";

export const withBase = (u) =>
  typeof u === "string" && u.startsWith("/") && !u.startsWith("//") && BASE !== "/" && !u.startsWith(BASE) ? BASE + u.slice(1) : u;
