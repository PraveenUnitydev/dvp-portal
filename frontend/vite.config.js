import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: `npm run dev` proxies /api and /dvp-images to the backend on 7100.
// Prod: `npm run build` then copy dist/ to backend/build (see README).
export default defineConfig({
  plugins: [react()],
  // The reference images are served by the backend too (/dvp-images), so they must be forwarded as well.
  server: { port: 5173, proxy: { "/api": "http://localhost:7100", "/dvp-images": "http://localhost:7100" } },
});
