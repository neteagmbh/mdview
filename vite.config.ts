import { defineConfig } from "vite";
import { pdfjsAssets } from "./scripts/pdfjs-assets.mjs";
import tauriConfig from "./src-tauri/tauri.conf.json";

const host = process.env.TAURI_DEV_HOST;
const pdfProbe = process.env.MDVIEW_PDF_PROBE === "1";

export default defineConfig({
  plugins: [pdfjsAssets()],
  clearScreen: false,
  server: {
    host: host || false,
    port: 1420,
    strictPort: true,
    hmr: pdfProbe ? false : host ? { protocol: "ws", host, port: 1421 } : undefined,
    headers: pdfProbe ? { "Content-Security-Policy": tauriConfig.app.security.csp } : undefined,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // Mermaid and its diagram renderers are lazy chunks; keep warnings focused on larger regressions.
    chunkSizeWarningLimit: 750,
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
    rollupOptions: {
      input: pdfProbe
        ? { main: "index.html", pdfProbe: "dev/pdfjs-probe.html", pdfViewerProbe: "dev/pdf-viewer-probe.html" }
        : "index.html",
    },
  },
});
