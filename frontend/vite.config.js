import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: `npm run dev` proxies /api to the backend on 7100.
// Prod: `npm run build` then copy dist/ to backend/build (see README).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://localhost:7100" } },
});
