// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PdfResource } from "./documents";
import { isPdfPrinting, PDF_PRINT_LIMITS, preparePdfPrintPages, printPdf, printPreparedPdf } from "./pdf-print";

vi.mock("./print", () => ({ waitForPrintLayout: vi.fn(async () => undefined) }));

/** Original page requests and allocations are observed independently of a virtualized viewer. */
function fixture(count = 61) {
  const root = document.createElement("div"); document.body.append(root);
  const canvases: HTMLCanvasElement[] = [];
  const render = vi.fn(({ canvas }: { canvas: HTMLCanvasElement }) => {
    canvases.push(canvas); return { promise: Promise.resolve(), cancel: vi.fn() };
  });
  const cleanup = vi.fn();
  const getPage = vi.fn(async (number: number) => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: (number % 2 ? 612 : 792) * scale,
      height: (number % 2 ? 792 : 612) * scale }), render, cleanup,
  }));
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(new Blob(["png"])));
  Object.defineProperty(HTMLImageElement.prototype, "decode", { configurable: true, value: async () => undefined });
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: vi.fn() }, close: { configurable: true, value: vi.fn() },
  });
  const create = vi.fn(() => `blob:print-${Math.random()}`); const revoke = vi.fn();
  vi.stubGlobal("URL", class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  return { root, canvases, render, cleanup, getPage, revoke,
    pdf: { numPages: count, getPage } as unknown as PDFDocumentProxy };
}

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  delete (HTMLImageElement.prototype as unknown as { decode?: unknown }).decode;
  delete (HTMLDialogElement.prototype as unknown as { showModal?: unknown }).showModal;
  delete (HTMLDialogElement.prototype as unknown as { close?: unknown }).close; });

describe("complete PDF print preparation", () => {
  it("bounds oversized page canvases while retaining original print dimensions", async () => {
    const h = fixture(1);
    h.getPage.mockResolvedValue({ getViewport: ({ scale }: { scale: number }) => ({ width: 10800 * scale, height: 14400 * scale }),
      render: h.render, cleanup: h.cleanup });
    h.render.mockImplementation(({ canvas }) => {
      expect(canvas.width * canvas.height).toBeLessThanOrEqual(PDF_PRINT_LIMITS.canvasPixels);
      expect(Math.max(canvas.width, canvas.height)).toBeLessThanOrEqual(PDF_PRINT_LIMITS.canvasDimension);
      return { promise: Promise.resolve(), cancel: vi.fn() };
    });
    const cleanup = await preparePdfPrintPages(h.pdf, h.root, new AbortController().signal);
    expect((h.root.querySelector('.pdf-print-page') as HTMLElement).style.width).toBe("10800pt");
    cleanup();
  });

  it("cancels print preparation before loading completes and releases the independent lease", async () => {
    fixture(1);
    const release = vi.fn(async () => undefined);
    const retained = { metadata: { handle: "cancel-print", name: "source.pdf" }, release } as unknown as PdfResource;
    const resource = { retain: async () => retained } as unknown as PdfResource;
    let resume!: (value: any) => void;
    const job = printPdf(resource, undefined, { nativeOriginal: async () => false, nativePages: vi.fn(),
      runtime: vi.fn(() => new Promise(resolve => { resume = resolve; })) as any });
    await vi.waitFor(() => expect(document.querySelector('.pdf-print-progress button')).not.toBeNull());
    (document.querySelector('.pdf-print-progress button') as HTMLButtonElement).click();
    resume({}); await job;
    expect(release).toHaveBeenCalledOnce(); expect(isPdfPrinting()).toBe(false);
    expect(document.querySelector('.pdf-print-progress')).toBeNull();
  });

  it("opens the desktop dialog only after every original page is ready and releases its worker afterward", async () => {
    const h = fixture(3);
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: { configurable: true, value: vi.fn() }, close: { configurable: true, value: vi.fn() },
    });
    const release = vi.fn(async () => undefined);
    const retained = { metadata: { handle: "desktop-print", name: "source.pdf" },
      read: async () => new Uint8Array([37, 80, 68, 70]), release } as unknown as PdfResource;
    const resource = { retain: async () => retained } as unknown as PdfResource;
    const pdf = { ...h.pdf, getPermissions: async () => null };
    const task = { promise: Promise.resolve(pdf), destroy: vi.fn(async () => undefined) };
    const worker = { worker: {}, destroy: vi.fn() };
    const bundle = { createPdfWorker: async () => worker, pdfjs: { getDocument: () => task }, documentOptions: {} };
    const nativePages = vi.fn(async () => {
      expect(document.querySelectorAll("#pdf-print-root .pdf-print-page")).toHaveLength(3);
      expect(release).not.toHaveBeenCalled();
      queueMicrotask(() => window.dispatchEvent(new Event("afterprint")));
      return true;
    });
    await printPdf(resource, undefined, { nativeOriginal: async () => false, nativePages,
      runtime: vi.fn(async () => bundle) as any });
    expect(nativePages).toHaveBeenCalledOnce(); expect(task.destroy).toHaveBeenCalledOnce();
    expect(worker.destroy).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
    expect(document.querySelector("#pdf-print-root")).toBeNull(); expect(document.body.dataset.pdfPrinting).toBeUndefined();
  });
  it("prepares all 61 mixed-size pages at print intent without viewer state or page decorations", async () => {
    const h = fixture();
    const cleanup = await preparePdfPrintPages(h.pdf, h.root, new AbortController().signal);
    expect(h.getPage.mock.calls.map(call => call[0])).toEqual(Array.from({ length: 61 }, (_, i) => i + 1));
    expect(h.root.querySelectorAll(".pdf-print-page")).toHaveLength(61);
    expect(h.root.querySelectorAll("img")).toHaveLength(61);
    expect((h.root.children[1] as HTMLElement).style.width).toBe("612pt");
    expect((h.root.children[2] as HTMLElement).style.width).toBe("792pt");
    expect(h.root.querySelector("style")!.textContent).toContain("@bottom-right{content:none}");
    expect(h.render).toHaveBeenCalledWith(expect.objectContaining({ intent: "print" }));
    expect(h.canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
    expect(h.cleanup).toHaveBeenCalledTimes(61);
    cleanup(); cleanup();
    expect(h.revoke).toHaveBeenCalledTimes(61);
    expect(h.root.children).toHaveLength(0);
  });

  it("releases previous pages and blobs when any later page fails", async () => {
    const h = fixture(3);
    h.render.mockImplementationOnce(() => ({ promise: Promise.resolve(), cancel: vi.fn() }))
      .mockImplementationOnce(() => ({ promise: Promise.reject(new Error("bad page")), cancel: vi.fn() }));
    await expect(preparePdfPrintPages(h.pdf, h.root, new AbortController().signal)).rejects.toThrow("bad page");
    expect(h.getPage).toHaveBeenCalledTimes(2);
    expect(h.revoke).toHaveBeenCalledOnce(); expect(h.root.children).toHaveLength(0);
  });

  it("cancels in-flight rendering and prints no partial document", async () => {
    const h = fixture(3); const abort = new AbortController();
    let cancel!: () => void;
    h.render.mockImplementation(() => ({ promise: new Promise<void>((_, reject) => {
      cancel = () => reject(new Error("cancelled")); queueMicrotask(() => abort.abort());
    }), cancel: vi.fn(() => cancel()) }));
    await expect(preparePdfPrintPages(h.pdf, h.root, abort.signal)).rejects.toThrow("cancelled");
    expect(h.getPage).toHaveBeenCalledOnce(); expect(h.root.children).toHaveLength(0);
    expect(h.canvases.every(canvas => canvas.width === 0)).toBe(true);
  });

  it("rejects excess compressed output before a print dialog can open", async () => {
    const h = fixture(1);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback({ size: PDF_PRINT_LIMITS.encodedBytes + 1 } as Blob));
    await expect(preparePdfPrintPages(h.pdf, h.root, new AbortController().signal)).rejects.toThrow("No partial document");
    expect(h.root.children).toHaveLength(0);
  });

  it("keeps native dialog resources until afterprint and cleans listeners on failure", async () => {
    let closed = false;
    const job = printPreparedPdf(async () => true, window).then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    window.dispatchEvent(new Event("afterprint")); await job; expect(closed).toBe(true);
    await expect(printPreparedPdf(async () => { throw new Error("printer unavailable"); }, window)).rejects.toThrow("printer unavailable");
    await expect(printPreparedPdf(async () => false, window)).rejects.toThrow("unavailable");
  });

  it("retains the original through native completion, rejects duplicates, and permits repeated printing", async () => {
    const release = vi.fn(async () => undefined);
    const retained = { metadata: { handle: "print-lease" }, release } as unknown as PdfResource;
    const resource = { retain: vi.fn(async () => retained) } as unknown as PdfResource;
    let finish!: (value: boolean) => void;
    const dependencies = { nativeOriginal: vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; })),
      nativePages: vi.fn(), runtime: vi.fn() };
    const job = printPdf(resource, "secret", dependencies);
    await vi.waitFor(() => expect(dependencies.nativeOriginal).toHaveBeenCalledWith(retained, "secret"));
    expect(isPdfPrinting()).toBe(true); expect(release).not.toHaveBeenCalled();
    await expect(printPdf(resource, undefined, dependencies)).rejects.toThrow("already open");
    finish(true); await job;
    expect(release).toHaveBeenCalledOnce(); expect(isPdfPrinting()).toBe(false);
    dependencies.nativeOriginal.mockResolvedValue(true);
    await printPdf(resource, undefined, dependencies);
    expect(release).toHaveBeenCalledTimes(2); expect(dependencies.runtime).not.toHaveBeenCalled();
    expect(dependencies.nativePages).not.toHaveBeenCalled();
  });

  it("surfaces native failures without falling back to printing visible canvases", async () => {
    const retained = { metadata: { handle: "print-lease" }, release: vi.fn(async () => undefined) } as unknown as PdfResource;
    const resource = { retain: async () => retained } as unknown as PdfResource;
    const dependencies = { nativeOriginal: vi.fn(async () => { throw new Error("printing forbidden"); }),
      nativePages: vi.fn(), runtime: vi.fn() };
    await expect(printPdf(resource, undefined, dependencies)).rejects.toThrow("printing forbidden");
    expect(retained.release).toHaveBeenCalledOnce(); expect(dependencies.runtime).not.toHaveBeenCalled();
    expect(isPdfPrinting()).toBe(false);
  });
});
