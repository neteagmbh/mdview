import { invoke } from "@tauri-apps/api/core";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfResource } from "./documents";
import { loadPdfjs } from "./pdfjs-runtime";
import { waitForPrintLayout } from "./print";
import "./pdf-print.css";

/** Raster print resolution, independent of viewer zoom and device pixel ratio. */
export const PDF_PRINT_DPI = 150;
/** Bounds single-canvas allocation and retained compressed raster data. */
export const PDF_PRINT_LIMITS = { canvasPixels: 16_777_216, canvasDimension: 8192, encodedBytes: 128 * 1024 * 1024 };
let printing = false;
/** Prevents concurrent jobs and Markdown asset preparation during PDF printing. */
export function isPdfPrinting(): boolean { return printing; }
/** Encodes without retaining a base64 copy of each image. */
function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob)
    : reject(new Error("Could not prepare the PDF print image.")), "image/png"));
}
/** Prepares every page sequentially at print intent, independently of the viewer cache. */
export async function preparePdfPrintPages(pdf: Pick<PDFDocumentProxy, "numPages" | "getPage">,
  root: HTMLElement, signal: AbortSignal, progress: (page: number, total: number) => void = () => undefined,
): Promise<() => void> {
  const urls: string[] = [];
  const style = root.ownerDocument.createElement("style");
  root.append(style);
  let encodedBytes = 0;
  /** Removes all blobs and nodes on success, cancellation, or failure. */
  const cleanup = () => { urls.forEach(url => URL.revokeObjectURL(url)); urls.length = 0; root.replaceChildren(); };
  try {
    for (let number = 1; number <= pdf.numPages; number++) {
      signal.throwIfAborted(); progress(number, pdf.numPages);
      const page = await pdf.getPage(number);
      signal.throwIfAborted();
      const points = page.getViewport({ scale: 1 });
      if (![points.width, points.height].every(size => Number.isFinite(size) && size > 0)) throw new Error("Invalid PDF print page size.");
      const scale = Math.min(PDF_PRINT_DPI / 72,
        Math.sqrt(PDF_PRINT_LIMITS.canvasPixels / (points.width * points.height)),
        PDF_PRINT_LIMITS.canvasDimension / Math.max(points.width, points.height));
      const viewport = page.getViewport({ scale });
      const canvas = root.ownerDocument.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width)); canvas.height = Math.max(1, Math.floor(viewport.height));
      const render = page.render({ canvas, viewport, intent: "print" });
      const cancel = () => render.cancel();
      signal.addEventListener("abort", cancel, { once: true });
      try {
        await render.promise; signal.throwIfAborted();
        const blob = await encode(canvas); signal.throwIfAborted();
        encodedBytes += blob.size;
        if (encodedBytes > PDF_PRINT_LIMITS.encodedBytes) throw new Error("This PDF exceeds the print preparation memory limit. No partial document was printed.");
        const url = URL.createObjectURL(blob); urls.push(url);
        const sheet = root.ownerDocument.createElement("div"); sheet.className = "pdf-print-page";
        sheet.style.page = `mdview-pdf-${number}`;
        sheet.style.width = `${points.width}pt`; sheet.style.height = `${points.height}pt`;
        style.append(`@page mdview-pdf-${number}{size:${points.width}pt ${points.height}pt;margin:0;`
          + "@top-left{content:none}@top-right{content:none}@bottom-left{content:none}@bottom-right{content:none}}");
        const image = root.ownerDocument.createElement("img"); image.alt = `PDF page ${number}`; image.src = url;
        sheet.append(image); root.append(sheet); await image.decode();
      } finally {
        signal.removeEventListener("abort", cancel); canvas.width = canvas.height = 0; page.cleanup();
      }
    }
    signal.throwIfAborted(); return cleanup;
  } catch (error) { cleanup(); throw error; }
}
/** Keeps print DOM and leases alive until the print dialog actually closes. */
export async function printPreparedPdf(native: () => Promise<boolean>, view: Window): Promise<void> {
  let finished!: () => void;
  const completion = new Promise<void>(resolve => { finished = resolve; });
  view.addEventListener("afterprint", finished, { once: true }); view.addEventListener("pagehide", finished, { once: true });
  try {
    if (!await native()) throw new Error("Complete-document PDF printing is unavailable on this platform.");
    await completion;
  } finally { view.removeEventListener("afterprint", finished); view.removeEventListener("pagehide", finished); }
}
/** Injectable native/runtime dependencies for ownership and dispatch tests. */
export interface PdfPrintDependencies {
  nativeOriginal: (resource: PdfResource, password?: string) => Promise<boolean>;
  nativePages: () => Promise<boolean>;
  runtime: typeof loadPdfjs;
}
/** Prints retained original bytes on Apple, or every prepared page through desktop system dialogs. */
export async function printPdf(resource: PdfResource, password?: string,
  dependencies: PdfPrintDependencies = {
    nativeOriginal: (source, password) => invoke("print_pdf_document", { handle: source.metadata.handle, password: password ?? null }),
    nativePages: () => invoke("print_pdf_pages"), runtime: loadPdfjs,
  }): Promise<void> {
  if (printing) throw new Error("A print job is already open.");
  printing = true;
  let source: PdfResource | undefined;
  let task: ReturnType<Awaited<ReturnType<typeof loadPdfjs>>["pdfjs"]["getDocument"]> | undefined;
  let worker: Awaited<ReturnType<Awaited<ReturnType<typeof loadPdfjs>>["createPdfWorker"]>> | undefined;
  let cleanup: (() => void) | undefined;
  let root: HTMLElement | undefined;
  let dialog: HTMLDialogElement | undefined;
  const abort = new AbortController();
  try {
    source = await resource.retain();
    if (await dependencies.nativeOriginal(source, password)) return;
    dialog = document.createElement("dialog"); dialog.className = "pdf-print-progress";
    const status = document.createElement("p"); status.setAttribute("role", "status");
    status.textContent = `Preparing ${source.metadata.name} for printing…`;
    const cancel = document.createElement("button"); cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => abort.abort());
    dialog.addEventListener("cancel", event => { event.preventDefault(); abort.abort(); });
    dialog.append(status, cancel); document.body.append(dialog); dialog.showModal();
    const bundle = await dependencies.runtime(); abort.signal.throwIfAborted();
    const data = await source.read(); abort.signal.throwIfAborted();
    worker = await bundle.createPdfWorker();
    task = bundle.pdfjs.getDocument({ ...bundle.documentOptions, data, password, worker: worker.worker });
    const cancelLoading = () => { void task?.destroy(); };
    abort.signal.addEventListener("abort", cancelLoading, { once: true });
    const pdf = await task.promise;
    abort.signal.removeEventListener("abort", cancelLoading);
    const permissions = await pdf.getPermissions();
    if (permissions && !permissions.has(bundle.pdfjs.PermissionFlag.PRINT)) throw new Error("Printing is disabled by this PDF's permissions.");
    root = document.createElement("div"); root.id = "pdf-print-root"; document.body.append(root);
    cleanup = await preparePdfPrintPages(pdf, root, abort.signal,
      (page, total) => { status.textContent = `Preparing page ${page} of ${total}…`; });
    await waitForPrintLayout(root); abort.signal.throwIfAborted(); dialog.close();
    document.body.dataset.pdfPrinting = "true";
    await printPreparedPdf(dependencies.nativePages, window);
  } catch (error) { if (!abort.signal.aborted) throw error; }
  finally {
    cleanup?.(); root?.remove(); dialog?.remove(); delete document.body.dataset.pdfPrinting;
    try { await task?.destroy(); }
    finally { worker?.destroy(); try { await source?.release(); } finally { printing = false; } }
  }
}
