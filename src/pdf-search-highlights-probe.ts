import { createPdfViewer, type PdfRenderer } from "./pdf-viewer";
import type { PdfResource } from "./documents";
import type { FileFindState } from "./pdf-search";
import "./styles.css";
import "./pdf-viewer.css";
import "./pdf-viewer-probe.css";

/** Opt-in regression page; the original book is never included in the normal application build. */
const fixture = new URL("../testdata/10.1515_9783111059228.pdf", import.meta.url);
const container = document.querySelector<HTMLDivElement>("#pdf-container")!;
const pages = document.querySelector<HTMLDivElement>("#probe-pages")!;
const display = document.querySelector<HTMLPreElement>("#report")!;
const report: Record<string, unknown> = { status: "running", cases: [] };
const lifetime = new AbortController();
/** Visual modes retain the actual page for native screenshot comparison before teardown. */
const parameters = new URLSearchParams(location.search);
const visualMode = parameters.get("visual");
let renderer: PdfRenderer | undefined;
let match: FileFindState = { current: 0, total: 0, pending: true };

/** Waits for the real worker and page lifecycle without accepting stale previous-page geometry. */
async function until(check: () => boolean, description: string): Promise<void> {
  const deadline = performance.now() + 15000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${description}`);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }
}

/** Reconstructs a selected original UTF-16 match independently from the overlay painter. */
function selectedRange(layer: Element, offset: number, length: number): Range {
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let node: Node | null;
  let start = 0;
  let found = false;
  while ((node = walker.nextNode())) {
    const end = start + node.textContent!.length;
    if (!found && offset < end) { range.setStart(node, offset - start); found = true; }
    if (found && offset + length <= end) { range.setEnd(node, offset + length - start); return range; }
    start = end;
  }
  throw new Error("Selected match was not mapped into the page's text nodes.");
}

/** Compares painted search rectangles with the exact Range used for manual text selection. */
function checkGeometry(page: number, zoom: number, rotation: number): void {
  const div = pages.querySelector<HTMLElement>(`[data-page-number="${page}"]`)!;
  const layer = div.querySelector(".textLayer")!;
  const range = selectedRange(layer, match.textOffset!, "Koordinaten".length);
  if (range.toString().toLowerCase() !== "koordinaten") throw new Error(`Wrong original substring: ${range.toString()}`);
  const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
  const expected = [...new Map(rects.map(rect => [`${rect.x},${rect.y},${rect.width},${rect.height}`, rect])).values()];
  const boxes = [...div.querySelectorAll<HTMLElement>(".pdf-search-highlight.is-selected")];
  if (!expected.length || boxes.length !== expected.length) throw new Error("Search/selection rectangle count differs.");
  const error = Math.max(...boxes.flatMap((box, index) => {
    const actual = box.getBoundingClientRect();
    const target = expected[index];
    // Native DrawLayer normalizes against the text layer, then clips its canvas-plane overlay.
    const source = layer.getBoundingClientRect();
    const canvas = div.querySelector('.canvasWrapper')!.getBoundingClientRect();
    return [Math.abs(actual.x - (canvas.x + (target.x - source.x) * canvas.width / source.width)),
      Math.abs(actual.y - (canvas.y + (target.y - source.y) * canvas.height / source.height)),
      Math.abs(actual.width - target.width * canvas.width / source.width),
      Math.abs(actual.height - target.height * canvas.height / source.height)];
  }));
  if (error > 0.25) throw new Error(`Search/selection geometry differs by ${error}px.`);
  if (layer.querySelector(".highlight")) throw new Error("Search inserted inline highlight spans.");
  (report.cases as unknown[]).push({ page, zoom, rotation, maximumErrorCssPx: error, rectangles: boxes.length });
}

/** Exercises the production renderer on both reported pages at three scales and four rotations. */
async function run(): Promise<void> {
  const bytes = new Uint8Array(await (await fetch(fixture)).arrayBuffer());
  renderer = createPdfViewer({ container, viewer: pages, resource: { read: async () => bytes } as PdfResource,
    signal: lifetime.signal, page: 269, changed: state => { report.state = state; },
    failed: error => { report.renderError = String(error); }, password: async () => null, openExternal: () => undefined });
  await renderer.ready;
  if (visualMode) {
    const targetPage = parameters.get("page") === "297" ? 297 : 269;
    renderer.goToPage(targetPage);
    renderer.zoom(0);
    renderer.find.search("Koordinaten", next => { match = next; });
    await until(() => match.page === targetPage && match.total === 231
      && Boolean(pages.querySelector(`[data-page-number="${targetPage}"] .pdf-search-highlight.is-selected`)), "visual comparison hit");
    const page = pages.querySelector(`[data-page-number="${targetPage}"]`)!;
    report.geometry = { textLayer: page.querySelector('.textLayer')!.getBoundingClientRect().toJSON(),
      canvasWrapper: page.querySelector('.canvasWrapper')!.getBoundingClientRect().toJSON(),
      overlay: page.querySelector('.pdf-search-highlights')!.getBoundingClientRect().toJSON() };
    if (visualMode === "selection") {
      const layer = page.querySelector('.textLayer')!;
      const range = selectedRange(layer, match.textOffset!, "Koordinaten".length);
      renderer.find.clear();
      await until(() => !pages.querySelector(".pdf-search-highlights"), "clear visual search");
      getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
      await until(() => Boolean(pages.querySelector('.canvasWrapper .selection')), "native selection overlay");
      report.selection = getSelection()!.toString();
    }
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    report.status = "passed";
    return;
  }
  for (const page of [269, 297]) {
    renderer.goToPage(page);
    for (const zoom of [1, 1.25, 1.5625]) {
      renderer.zoom(0);
      if (zoom > 1) renderer.zoom(1);
      if (zoom > 1.25) renderer.zoom(1);
      for (const rotation of [0, 90, 180, 270]) {
        report.pendingCase = { page, zoom, rotation };
        if (rotation) renderer.rotate(1);
        renderer.find.clear();
        match = { current: 0, total: 0, pending: true };
        renderer.goToPage(page);
        renderer.find.search("Koordinaten", next => { match = next; });
        await until(() => match.page === page && match.total === 231
          && Boolean(pages.querySelector(`[data-page-number="${page}"] .pdf-search-highlight.is-selected`)), "selected page highlight");
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        checkGeometry(page, zoom, rotation);
        renderer.find.clear();
        await until(() => !pages.querySelector(".pdf-search-highlights"), "search cleanup");
      }
      renderer.rotate(1);
    }
  }
  if (report.renderError) throw new Error(String(report.renderError));
  report.status = "passed";
}

/** Publishes native/browser-readable evidence after releasing all workers and page overlays. */
void run().catch(error => {
  report.status = "failed"; report.error = String(error); report.match = match;
  report.overlays = [...pages.querySelectorAll('.pdf-search-highlights')].map(node => ({
    page: node.closest('.page')?.getAttribute('data-page-number'), boxes: node.childElementCount,
    selected: node.querySelectorAll('.is-selected').length }));
}).finally(async () => {
  if (!visualMode) { await renderer?.destroy(); lifetime.abort(); }
  display.textContent = JSON.stringify(report, null, 2);
  const host = window as unknown as { webkit?: { messageHandlers?: { pdfProbe?: { postMessage: (value: unknown) => void } } } };
  host.webkit?.messageHandlers?.pdfProbe?.postMessage(report);
});
