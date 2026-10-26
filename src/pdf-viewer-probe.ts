import { createDocumentView } from "./document-view";
import { createPdfViewer, PDF_CANVAS_LIMITS, type PdfRenderer, type PdfViewerState } from "./pdf-viewer";
import { createPdfjsFixture } from "./pdfjs-fixture";
import type { PdfResource } from "./documents";
import type { PdfPosition } from "./pdf-position";
import type { FileFindState } from "./pdf-search";
import type { PdfBookmark } from "./pdf-outline";
import "./pdf-viewer.css";
import "./pdf-viewer-probe.css";

/** Original long fixture tests viewport scheduling without importing or displaying user documents. */
const bytes = createPdfjsFixture(60, { bookmarks: true, mixedSizes: true });
const container = document.querySelector<HTMLDivElement>("#pdf-container")!;
const pages = document.querySelector<HTMLDivElement>("#probe-pages")!;
const display = document.querySelector<HTMLPreElement>("#report")!;
const view = createDocumentView();
const report: Record<string, unknown> = { status: "running", pages: 60, cycles: 0, errors: [] };
let state: PdfViewerState;
let renderer: PdfRenderer;
const errors: string[] = [];
report.errors = errors;
window.addEventListener("error", event => errors.push(event.message));
window.addEventListener("unhandledrejection", event => errors.push(String(event.reason)));

/** Waits for asynchronous page/text drawing with a finite deadline in the real web engine. */
async function until(check: () => boolean, description: string): Promise<void> {
  const deadline = performance.now() + 10000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${description}`);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
}

/** Fresh byte views model native IPC ownership because PDF.js transfers the buffer to its worker. */
const resource = { read: async () => bytes.slice() } as PdfResource;

/** Runs the production renderer through repeated navigation and disposal in native WebKit. */
async function run(): Promise<void> {
  const started = performance.now();
  let saved: PdfPosition | null = null;
  for (let cycle = 0; cycle < 6; cycle++) {
    let bookmarks: PdfBookmark[] | undefined;
    const expected = saved;
    await view.show(signal => renderer = createPdfViewer({
      container, viewer: pages, resource, signal, position: expected,
      outline: items => { bookmarks = items; },
      changed: next => { state = next; }, failed: error => errors.push(String(error)),
      password: async () => { throw new Error("Original fixture must not request a password."); },
      openExternal: url => { report.externalLink = url; },
    }));
    if (state.pages !== 60) throw new Error("The long fixture page count is incorrect.");
    if (document.activeElement !== container) throw new Error("PDF pages did not receive keyboard focus.");
    if (expected) {
      const restored = renderer.position();
      if (!restored || restored.page !== expected.page || restored.rotation !== expected.rotation
        || Math.abs(restored.offset - expected.offset) > 0.02 || Math.abs(restored.scale - expected.scale) > 0.02) {
        throw new Error(`Reading position did not restore: ${JSON.stringify({ expected, restored })}`);
      }
      report.positionRestored = true;
    }
    await until(() => Boolean(pages.querySelector(".textLayer span")?.textContent), "selectable text");
    if (cycle === 0) {
      const controls = document.querySelector<HTMLElement>("#pdf-controls")!;
      for (const minHeight of ["120px", ""]) {
        controls.style.minHeight = minHeight;
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const viewport = container.getBoundingClientRect();
        if (Math.abs(viewport.top - controls.getBoundingClientRect().bottom) > 1
          || Math.abs(viewport.bottom - innerHeight) > 1
          || document.documentElement.scrollHeight > innerHeight + 1) {
          throw new Error("PDF toolbar and page scroller exceed the viewport height budget.");
        }
      }
      report.viewportHeightBudget = true;
    }
    const span = pages.querySelector(".textLayer span")!;
    const range = document.createRange();
    range.selectNodeContents(span);
    getSelection()?.removeAllRanges(); getSelection()?.addRange(range);
    report.selection = Boolean(getSelection()?.toString().includes("PDF.js probe"));
    getSelection()?.removeAllRanges();
    if (cycle === 0) {
      const pageStyle = getComputedStyle(pages.querySelector(".page")!);
      const controlsStyle = getComputedStyle(document.querySelector("#pdf-controls")!);
      const dark = matchMedia("(prefers-color-scheme: dark)").matches;
      if (pageStyle.backgroundColor !== "rgb(255, 255, 255)" || pageStyle.filter !== "none") {
        throw new Error("The PDF page colors were altered by the shell theme.");
      }
      if (controlsStyle.backgroundColor !== (dark ? "rgb(38, 43, 51)" : "rgb(244, 246, 250)")) {
        throw new Error("PDF controls did not follow the shell theme.");
      }
      report.theme = dark ? "dark" : "light";
      report.originalPageColors = true;
      report.keyboardFocus = true;
      const canvas = pages.querySelector("canvas")!;
      const pixel = canvas.getContext("2d")!.getImageData(Math.floor(canvas.width * 460 / 612), Math.floor(canvas.height * 662 / 792), 1, 1).data;
      report.jpxSample = [...pixel];
      if (!(pixel[0] > 180 && pixel[1] < 120 && pixel[2] < 120)) throw new Error("JPX image pixels were not decoded.");
      const link = pages.querySelector<HTMLAnchorElement>('.annotationLayer a[href^="https:"]');
      if (link) link.click();
      await until(() => Boolean(bookmarks), "embedded bookmarks");
      if (bookmarks!.length !== 2 || bookmarks![1].depth !== 1) throw new Error("Nested bookmarks were lost.");
      bookmarks![0].open();
      await until(() => state.page === 60, "bookmark destination");
      report.bookmarks = bookmarks!.length;
      let match: FileFindState = { current: 0, total: 0, pending: true };
      renderer.find.search("page 55:", next => { match = next; });
      await until(() => match.total === 12 && match.page === 55, "off-screen PDF find");
      renderer.find.move(false);
      await until(() => match.current === 2, "next PDF match");
      renderer.find.move(true);
      await until(() => match.current === 1, "previous PDF match");
      await until(() => Boolean(pages.querySelector('.pdf-search-highlight.is-selected')), "Range-based search highlight");
      if (pages.querySelector('.textLayer .highlight')) throw new Error("Search mutated the selectable text layer.");
      report.rangeSearchHighlights = true;
      report.findMatches = match.total;
      renderer.find.search("absent-text-unique", next => { match = next; });
      await until(() => !match.pending && match.total === 0, "no PDF matches");
      renderer.find.clear();
      await until(() => !pages.querySelector('.pdf-search-highlight'), "cleared search overlays");
    }
    renderer.goToPage(40);
    await until(() => Boolean(pages.querySelector('[data-page-number="40"] canvas')), "distant-page render");
    if (state.rotation === 90) renderer.rotate(-1);
    renderer.fit("page-fit"); renderer.zoom(1); renderer.rotate(1);
    await until(() => state.page === 40 && state.rotation === 90, "rotation and navigation state");
    await until(() => [...pages.querySelectorAll<HTMLCanvasElement>('[data-page-number="40"] canvas')]
      .some(canvas => canvas.width > canvas.height && canvas.height > 0), "rotated page rerender");
    const stats = renderer.diagnostics();
    report.maximumCanvases = Math.max(Number(report.maximumCanvases ?? 0), stats.canvases);
    report.maximumCanvasPixels = Math.max(Number(report.maximumCanvasPixels ?? 0), stats.canvasPixels);
    report.maximumCachedPages = Math.max(Number(report.maximumCachedPages ?? 0), stats.cachedPages);
    for (const canvas of pages.querySelectorAll("canvas")) {
      if (canvas.width * canvas.height > PDF_CANVAS_LIMITS.maxCanvasPixels + PDF_CANVAS_LIMITS.maxCanvasDim) throw new Error("Per-canvas pixel limit exceeded.");
    }
    renderer.zoom(0); renderer.zoom(1); renderer.zoom(1);
    renderer.goToPage(40);
    const currentPage = pages.querySelector<HTMLElement>('[data-page-number="40"]')!;
    container.scrollTop = currentPage.offsetTop + currentPage.clientHeight * 0.2;
    await until(() => Math.abs((renderer.position()?.offset ?? 0) - 0.2) < 0.02, "relative reading offset");
    saved = renderer.position();
    await view.clear();
    if (renderer.diagnostics().workerAlive || renderer.diagnostics().canvases || pages.children.length) {
      throw new Error("A disposed renderer retained a worker or page canvases.");
    }
    report.cycles = cycle + 1;
  }
  let emptyFind: FileFindState = { current: 0, total: 0, pending: true };
  let emptyOutline: PdfBookmark[] | undefined;
  await view.show(signal => renderer = createPdfViewer({ container, viewer: pages,
    resource: { read: async () => createPdfjsFixture(2, { text: false }) } as PdfResource,
    signal, position: saved, changed: next => { state = next; }, failed: error => errors.push(String(error)),
    outline: items => { emptyOutline = items; }, password: async () => null, openExternal: () => undefined }));
  if (state.page !== 2) throw new Error("Shorter replacement did not clamp the saved page.");
  renderer.find.search("anything", next => { emptyFind = next; });
  await until(() => !emptyFind.pending && emptyFind.total === 0 && Boolean(emptyOutline), "image-only PDF find/outline");
  if (emptyOutline!.length) throw new Error("Image-only fixture unexpectedly had bookmarks.");
  report.noTextFind = true;
  report.shorterReplacement = true;
  await view.clear();
  if (!report.selection || errors.length) throw new Error("Text selection or asynchronous rendering failed.");
  report.elapsedMs = Math.round(performance.now() - started);
  report.status = "passed";
}

/** Delivers observations to the same isolated native host as the existing compatibility probe. */
function publish(): void {
  display.textContent = JSON.stringify(report, null, 2);
  const host = window as unknown as { webkit?: { messageHandlers?: { pdfProbe?: { postMessage: (value: unknown) => void } } } };
  host.webkit?.messageHandlers?.pdfProbe?.postMessage(report);
}
void run().catch(async error => {
  report.status = "failed"; report.error = String(error);
  report.state = state;
  report.viewport = { top: container.scrollTop, height: container.clientHeight, scrollHeight: container.scrollHeight };
  report.renderedPages = [...pages.querySelectorAll("canvas")].map(canvas => canvas.closest(".page")?.getAttribute("data-page-number"));
  await view.clear();
}).finally(publish);
