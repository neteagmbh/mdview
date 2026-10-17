import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
export { preparePdfDocument } from "./pdfjs-compatibility";

/** Same-origin resources copied from the exact installed PDF.js release. */
export const resourceBase = new URL(`${import.meta.env.BASE_URL}pdfjs/${pdfjs.version}/`, location.href).href;

pdfjs.GlobalWorkerOptions.workerSrc = `${resourceBase}pdf.worker.min.mjs`;

/** Loads viewer components after the parser has initialized its shared exports. */
export async function viewerComponents() {
  const components = await import("pdfjs-dist/legacy/web/pdf_viewer.mjs");
  // Install after both legacy bundles have initialized their iterator compatibility state.
  await import("core-js/actual/iterator/join");
  return components;
}

/** Offline document options shared by the compatibility probe and future PDF loader. */
export const documentOptions = {
  cMapUrl: `${resourceBase}cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${resourceBase}standard_fonts/`,
  wasmUrl: `${resourceBase}wasm/`,
  iccUrl: `${resourceBase}iccs/`,
  // Custom Tauri protocols are not HTTP URLs; fetch resources through the display factories.
  useWorkerFetch: false,
  useSystemFonts: false,
  enableXfa: false,
};

/** Starts an explicit module worker so failure cannot silently use a fake worker. */
export async function createPdfWorker() {
  const port = new Worker(pdfjs.GlobalWorkerOptions.workerSrc, { type: "module", name: "mdview-pdfjs" });
  let worker: InstanceType<typeof pdfjs.PDFWorker> | undefined;
  /** Releases both PDF.js state and the externally owned browser worker. */
  const destroy = () => { worker?.destroy(); port.terminate(); };
  try {
    worker = pdfjs.PDFWorker.create({ port });
    await worker.promise;
    return { worker, port, destroy };
  } catch (error) {
    destroy();
    throw error;
  }
}

export { pdfjs };
