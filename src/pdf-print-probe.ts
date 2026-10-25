import { preparePdfPrintPages } from "./pdf-print";
import { createPdfjsFixture } from "./pdfjs-fixture";
import { loadPdfjs } from "./pdfjs-runtime";
import { waitForPrintLayout } from "./print";
import "./styles.css";

/** Original long fixture exercises the production print helper without any on-screen viewer cache. */
async function run(): Promise<void> {
  const bundle = await loadPdfjs();
  const worker = await bundle.createPdfWorker();
  const task = bundle.pdfjs.getDocument({ ...bundle.documentOptions, data: createPdfjsFixture(61, { mixedSizes: true }), worker: worker.worker });
  const root = document.createElement("div"); root.id = "pdf-print-root"; document.body.append(root);
  let cleanup: (() => void) | undefined;
  const report: Record<string, unknown> = { status: "running" };
  try {
    const pdf = await task.promise;
    cleanup = await preparePdfPrintPages(pdf, root, new AbortController().signal);
    await waitForPrintLayout(root);
    const pages = [...root.querySelectorAll<HTMLElement>(".pdf-print-page")];
    if (pages.length !== 61 || !pages.every(page => page.querySelector("img")!.naturalWidth > 0)) throw new Error("Some original print pages are missing.");
    report.printPages = pages.length;
    report.pageSizes = [...new Set(pages.map(page => `${page.style.width} x ${page.style.height}`))];
    cleanup(); cleanup = undefined;
    if (root.childElementCount) throw new Error("Print resources were not cleaned up.");
    report.status = "passed";
    report.cleanup = true;
  } catch (error) { report.status = "failed"; report.error = String(error); }
  finally {
    cleanup?.(); root.remove(); await task.destroy(); worker.destroy();
    document.querySelector("#report")!.textContent = JSON.stringify(report, null, 2);
    const host = window as unknown as { webkit?: { messageHandlers?: { pdfProbe?: { postMessage: (value: unknown) => void } } } };
    host.webkit?.messageHandlers?.pdfProbe?.postMessage(report);
  }
}
void run();
