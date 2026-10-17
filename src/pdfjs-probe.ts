import { loadPdfjs } from "./pdfjs-runtime";
import { createPdfjsFixture } from "./pdfjs-fixture";
import { waitForPrintLayout } from "./print";
import "./pdfjs-probe.css";

/** Compatibility observations rendered locally and optionally returned to a native test harness. */
const report: Record<string, unknown> = { status: "running", version: "", realWorker: false,
  findMatches: 0, decodedJpxImages: 0, elapsedMs: 0, lastError: "", userAgent: navigator.userAgent };
const display = document.querySelector<HTMLPreElement>("#report")!;
const warnings: string[] = [];
report.warnings = warnings;
for (const method of ["log", "warn", "error"] as const) {
  const original = console[method].bind(console);
  console[method] = (...values: unknown[]) => {
    const message = values.map(String).join(" ");
    const error = values.find((value) => value instanceof Error) as Error | undefined;
    if (error) report.lastError = error.stack ?? String(error);
    if (warnings.length < 12 && /warning|error/i.test(message)) warnings.push(message);
    original(...values);
  };
}

/** Publishes diagnostics without network requests or persistent application changes. */
function publish(): void {
  display.textContent = JSON.stringify(report, null, 2);
  const host = window as unknown as {
    webkit?: { messageHandlers?: { pdfProbe?: { postMessage: (value: unknown) => void } } };
  };
  host.webkit?.messageHandlers?.pdfProbe?.postMessage(report);
}

/** Exercises the real worker and upstream viewer against an original multipage fixture. */
async function run(): Promise<void> {
  const started = performance.now();
  const { pdfjs, viewerComponents, createPdfWorker, resourceBase, documentOptions, preparePdfDocument } = await loadPdfjs();
  const components = await viewerComponents();
  const workerHandle = await createPdfWorker();
  report.version = pdfjs.version;
  report.realWorker = workerHandle.port instanceof Worker;
  const data = createPdfjsFixture();
  report.inputBytes = data.byteLength;
  const task = pdfjs.getDocument({ ...documentOptions, data, worker: workerHandle.worker });
  window.addEventListener("pagehide", () => { void task.destroy(); workerHandle.destroy(); }, { once: true });
  const pdf = preparePdfDocument(await task.promise);
  report.pages = pdf.numPages;
  const bus = new components.EventBus();
  const links = new components.PDFLinkService({ eventBus: bus });
  const find = new components.PDFFindController({ eventBus: bus, linkService: links });
  const container = document.querySelector<HTMLDivElement>("#viewer-container")!;
  const viewer = new components.PDFViewer({
    container, eventBus: bus, linkService: links, findController: find,
    annotationMode: pdfjs.AnnotationMode.ENABLE,
    annotationEditorMode: pdfjs.AnnotationEditorType.DISABLE,
    imageResourcesPath: `${resourceBase}images/`,
  });
  links.setViewer(viewer);
  links.setDocument(pdf);
  const textRendered = new Promise<void>((resolve) => bus.on("textlayerrendered", () => resolve(), { once: true }));
  viewer.setDocument(pdf);
  await textRendered;
  report.textLayer = Boolean(container.querySelector(".textLayer span")?.textContent);
  const span = container.querySelector(".textLayer span")!;
  const range = document.createRange();
  range.selectNodeContents(span);
  getSelection()?.removeAllRanges();
  getSelection()?.addRange(range);
  report.selection = Boolean(getSelection()?.toString().includes("PDF.js probe"));
  getSelection()?.removeAllRanges();
  const page = await pdf.getPage(1);
  report.links = (await page.getAnnotations()).filter((annotation) => annotation.url).length;
  const found = new Promise<void>((resolve) => bus.on("updatefindmatchescount", (event: { matchesCount: { total: number } }) => {
    report.findMatches = event.matchesCount.total;
    if (event.matchesCount.total === 36) resolve();
  }));
  bus.dispatch("find", { type: "", query: "probe", caseSensitive: false, entireWord: false,
    highlightAll: true, findPrevious: false, matchDiacritics: false });
  await found;
  const assets = ["cmaps/Adobe-Japan1-UCS2.bcmap", "standard_fonts/FoxitSerif.pfb",
    "iccs/CGATS001Compat-v2-micro.icc", "wasm/openjpeg.wasm"];
  for (const asset of assets) {
    const response = await fetch(resourceBase + asset);
    if (!response.ok) throw new Error(`Offline asset failed: ${asset}: ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (asset.endsWith(".wasm")) {
      try {
        await WebAssembly.compile(bytes);
        report.wasmDecoder = "supported";
      } catch (error) {
        // Rendering the JPX fixture below must independently prove the shipped JS fallback.
        report.wasmDecoder = `JavaScript fallback required: ${String(error)}`;
      }
    }
  }
  report.offlineAssets = assets.length;
  const printRoot = document.querySelector<HTMLDivElement>("#print-root")!;
  let canvasBytes = 0;
  let decodedImages = 0;
  for (let number = 1; number <= pdf.numPages; number++) {
    const printPage = await pdf.getPage(number);
    const viewport = printPage.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvasBytes = Math.max(canvasBytes, canvas.width * canvas.height * 4);
    await printPage.render({ canvas, viewport, intent: "print" }).promise;
    const pixel = canvas.getContext("2d")!.getImageData(690, 993, 1, 1).data;
    report.jpxSample = Array.from(pixel);
    if (pixel[0] > 180 && pixel[1] < 120 && pixel[2] < 120) decodedImages++;
    const sheet = document.createElement("div");
    sheet.className = "probe-print-page";
    const image = document.createElement("img");
    image.alt = `PDF print page ${number}`;
    image.src = canvas.toDataURL("image/png");
    sheet.append(image);
    printRoot.append(sheet);
    canvas.width = canvas.height = 0;
  }
  await waitForPrintLayout(printRoot);
  report.printPages = printRoot.children.length;
  report.decodedJpxImages = decodedImages;
  report.peakPrintCanvasBytes = canvasBytes;
  report.elapsedMs = Math.round(performance.now() - started);
  const passed = report.realWorker && report.pages === 3 && report.textLayer && report.selection
    && report.links === 1 && report.findMatches === 36 && report.printPages === 3 && decodedImages === 3;
  if (!passed) throw new Error("One or more compatibility assertions failed.");
  const button = document.querySelector<HTMLButtonElement>("#print")!;
  button.disabled = false;
  button.addEventListener("click", () => window.print());
  report.status = "passed";
}

/** Gives blocked workers and failed asset loads a finite, visible failure result. */
const deadline = window.setTimeout(() => {
  report.status = "failed";
  report.error = "Probe exceeded 45 seconds.";
  publish();
}, 45000);
void run().catch((error: unknown) => {
  report.status = "failed";
  report.error = String(error);
}).finally(() => { clearTimeout(deadline); publish(); });
