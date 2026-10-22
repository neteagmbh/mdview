// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { allowedPdfUrl, createPdfViewer, PDF_CANVAS_LIMITS, restrictPdfLinks, type PdfViewerOptions } from "./pdf-viewer";
import type { loadPdfjs } from "./pdfjs-runtime";
import type { PdfResource } from "./documents";
import type { PDFLinkService } from "pdfjs-dist/types/web/pdf_viewer.component";

/** Implements event/abort semantics so tests exercise readiness rather than mirroring rendering code. */
class Bus {
  /** Listeners are removed when the renderer's lifetime ends. */
  listeners = new Map<string, Set<(event: any) => void>>();
  /** Registers an observer with the same signal contract as upstream EventBus. */
  on(name: string, callback: (event: any) => void, options?: { signal?: AbortSignal }) {
    const callbacks = this.listeners.get(name) ?? new Set();
    callbacks.add(callback);
    this.listeners.set(name, callbacks);
    options?.signal?.addEventListener("abort", () => callbacks.delete(callback));
  }
  /** Delivers an upstream page or renderer event. */
  dispatch(name: string, event: any = {}) { for (const callback of this.listeners.get(name) ?? []) callback(event); }
}

/** Isolates native bytes, explicit worker ownership, and upstream component lifetimes. */
function harness() {
  const container = document.createElement("div");
  container.tabIndex = 0;
  const mount = document.createElement("div");
  container.append(mount);
  document.body.append(container);
  const abort = new AbortController();
  const changed = vi.fn();
  const failed = vi.fn();
  const password = vi.fn(async (): Promise<string | null> => "test-password");
  const pdf = { numPages: 3, getPage: vi.fn(async () => ({})), getOutline: vi.fn(async () => null) };
  const pageDiv = document.createElement("div");
  Object.defineProperties(pageDiv, { offsetTop: { value: 500 }, offsetLeft: { value: 20 },
    clientHeight: { value: 1000 }, clientWidth: { value: 800 } });
  const pageView = { div: pageDiv, pdfPage: null, setPdfPage: vi.fn() };
  const task = { promise: Promise.resolve(pdf), destroy: vi.fn(async () => undefined),
    onPassword: null as null | ((update: (password: string) => void, reason: number) => void) };
  const worker = { port: new EventTarget(), worker: {}, destroy: vi.fn() };
  const getDocument = vi.fn((_options: Record<string, unknown>) => task);
  const createPdfWorker = vi.fn(async () => worker);
  let viewerOptions: any;
  let canvas!: HTMLCanvasElement;
  /** Schedules a real event sequence without requiring canvas APIs in jsdom. */
  class Viewer {
    /** Public API state used by navigation and shared toolbar actions. */
    pdfDocument: typeof pdf | null = null;
    currentPageNumber = 1;
    currentScale = 1;
    pagesRotation = 0;
    pagesCount = 3;
    pagesPromise = Promise.resolve();
    /** Captures maintained rendering limits and feature flags. */
    constructor(options: any) { viewerOptions = options; }
    /** Applying upstream scale values rerenders rather than applying Markdown CSS transforms. */
    set currentScaleValue(value: string) { this.currentScale = value === "page-width" ? 1.2 : value === "page-fit" ? 0.7 : Number(value); }
    /** Emits initial page and first-paint events, then models synchronous teardown. */
    setDocument(value: typeof pdf | null) {
      this.pdfDocument = value;
      if (!value) { mount.replaceChildren(); return; }
      canvas = document.createElement("canvas");
      canvas.width = 400; canvas.height = 600;
      mount.append(canvas);
      queueMicrotask(() => { viewerOptions.eventBus.dispatch("pagesinit"); viewerOptions.eventBus.dispatch("pagerendered"); });
    }
    /** Models the upstream bounded page-view cache exposed for diagnostics. */
    getCachedPageViews() { return new Set([1]); }
    /** Supplies real measurable geometry for restoration tests. */
    getPageView() { return pageView; }
    /** Flushes public scroll/viewport state before a transform. */
    update() {}
  }
  /** Stubbed navigation component preserves the security override surface. */
  class Links {
    setViewer() {}
    setDocument() {}
    executeNamedAction() {}
  }
  /** Search behavior is tested against real PDF.js separately in the native probe. */
  class Find { selected = { pageIdx: -1, matchIdx: -1 }; }
  const bundle = { pdfjs: { getDocument, AnnotationMode: { ENABLE: 1 }, AnnotationEditorType: { DISABLE: -1 },
    PasswordResponses: { INCORRECT_PASSWORD: 2 } },
    viewerComponents: async () => ({ EventBus: Bus, PDFLinkService: Links, PDFViewer: Viewer, PDFFindController: Find }),
    createPdfWorker, preparePdfDocument: (value: typeof pdf) => value, documentOptions: { useWorkerFetch: false }, resourceBase: "/pdfjs/6.4.299/" };
  const resource = { read: vi.fn(async () => new Uint8Array([37, 255, 254])) } as unknown as PdfResource;
  const options: PdfViewerOptions = { container, viewer: mount, resource, signal: abort.signal,
    changed, failed, password, openExternal: vi.fn(), page: 2 };
  return { options, abort, changed, failed, password, task, worker, createPdfWorker, getDocument, pdf, container,
    runtime: vi.fn(async () => bundle) as unknown as typeof loadPdfjs,
    get viewerOptions() { return viewerOptions; }, get canvas() { return canvas; } };
}

describe("PDF renderer lifecycle", () => {
  /** A replaced source can shrink while still restoring zoom, orientation, and relative coordinates. */
  it("restores a clamped saved position against actual target-page geometry", async () => {
    const h = harness();
    h.options.page = null;
    h.options.position = { page: 40, offset: 0.35, left: 0.25, scale: 1.5, mode: "custom", rotation: 90 };
    h.options.positionChanged = vi.fn();
    const renderer = createPdfViewer(h.options, h.runtime);
    await renderer.ready;
    expect(document.activeElement).toBe(h.container);
    expect(h.changed).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3, scale: 1.5, rotation: 90 }));
    expect(h.container.scrollTop).toBe(850);
    expect(h.container.scrollLeft).toBe(220);
    expect(renderer.position()).toEqual({ ...h.options.position, page: 3 });
    expect(h.options.positionChanged).toHaveBeenCalledWith({ ...h.options.position, page: 3 });
    await renderer.destroy();
  });

  /** Explicit link destinations take priority over the previous session's position. */
  it("uses an explicit destination instead of a saved page", async () => {
    const h = harness();
    h.options.position = { page: 3, offset: 0.5, left: 0, scale: 2, mode: "custom", rotation: 90 };
    const renderer = createPdfViewer(h.options, h.runtime);
    await renderer.ready;
    expect(h.changed).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, mode: "page-width", rotation: 0 }));
    await renderer.destroy();
  });
  /** Real worker ownership, read-only appearance modes, capped canvases, and source destinations are explicit. */
  it("loads on demand, navigates, scales, rotates, and frees canvas/worker resources", async () => {
    const h = harness();
    const renderer = createPdfViewer(h.options, h.runtime);
    await renderer.ready;
    expect(h.getDocument.mock.calls[0][0]).toMatchObject({ enableXfa: false, worker: h.worker.worker });
    expect(h.viewerOptions).toMatchObject({ ...PDF_CANVAS_LIMITS, annotationMode: 1, annotationEditorMode: -1,
      enableDetailCanvas: true, enableAutoLinking: false });
    expect(h.viewerOptions.abortSignal).toBeInstanceOf(AbortSignal);
    expect(h.changed).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pages: 3 }));
    renderer.goToPage(3);
    renderer.goToPage(99);
    expect(h.changed).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));
    renderer.zoom(1);
    expect(h.changed).toHaveBeenLastCalledWith(expect.objectContaining({ scale: 1.5, mode: "custom" }));
    renderer.fit("page-fit");
    expect(h.changed).toHaveBeenLastCalledWith(expect.objectContaining({ scale: 0.7, mode: "page-fit" }));
    renderer.rotate(-1);
    expect(h.changed).toHaveBeenLastCalledWith(expect.objectContaining({ rotation: 270 }));
    expect(renderer.diagnostics()).toMatchObject({ canvases: 1, canvasPixels: 240000, workerAlive: true });
    await renderer.destroy();
    await renderer.destroy();
    expect(h.canvas.width).toBe(0);
    expect(h.canvas.height).toBe(0);
    expect(h.worker.destroy).toHaveBeenCalledOnce();
    expect(h.task.destroy).toHaveBeenCalledOnce();
    expect(renderer.diagnostics()).toMatchObject({ canvases: 0, workerAlive: false });
  });

  /** A late-created worker is terminated even if disposal finished before worker readiness. */
  it("releases a worker delivered after cancellation", async () => {
    const h = harness();
    let complete!: (value: typeof h.worker) => void;
    let requested!: () => void;
    const started = new Promise<void>(resolve => { requested = resolve; });
    h.createPdfWorker.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; requested(); }));
    const renderer = createPdfViewer(h.options, h.runtime);
    const result = renderer.ready.catch(error => error);
    await started;
    h.abort.abort();
    await renderer.destroy();
    complete(h.worker);
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(h.worker.destroy).toHaveBeenCalledOnce();
    expect(h.getDocument).not.toHaveBeenCalled();
  });

  /** Broken pages and byte transport failures cannot leave an idle PDF worker behind. */
  it("cleans up a failing first page", async () => {
    const h = harness();
    h.pdf.getPage.mockRejectedValueOnce(new Error("invalid page"));
    const renderer = createPdfViewer(h.options, h.runtime);
    await expect(renderer.ready).rejects.toThrow("invalid page");
    expect(h.worker.destroy).toHaveBeenCalledOnce();
    expect(h.task.destroy).toHaveBeenCalledOnce();
  });

  /** Native module-worker load errors reject readiness even when PDF.js never answers its initial request. */
  it("fails visibly and disposes a worker script failure", async () => {
    const h = harness();
    let requested!: () => void;
    const started = new Promise<void>(resolve => { requested = resolve; });
    h.task.promise = new Promise(() => undefined);
    h.getDocument.mockImplementation(() => { requested(); return h.task; });
    const renderer = createPdfViewer(h.options, h.runtime);
    const result = renderer.ready.catch(error => error);
    await started;
    h.worker.port.dispatchEvent(new Event("error"));
    expect(await result).toMatchObject({ message: "Could not load the PDF worker." });
    expect(h.worker.destroy).toHaveBeenCalledOnce();
    expect(h.task.destroy).toHaveBeenCalledOnce();
  });

  /** Password retry reasons reach the prompt and only the submitted transient value reaches PDF.js. */
  it("supports password retry and cancellation", async () => {
    const h = harness();
    let reject!: (error: Error) => void;
    h.task.promise = new Promise((_resolve, failure) => { reject = failure; });
    h.task.destroy.mockImplementation(async () => { reject(new Error("worker closed")); });
    let requested!: () => void;
    const opened = new Promise<void>(resolve => { requested = resolve; });
    h.getDocument.mockImplementation(() => { requested(); return h.task; });
    const renderer = createPdfViewer(h.options, h.runtime);
    const result = renderer.ready.catch(error => error);
    await opened;
    const update = vi.fn();
    h.task.onPassword!(update, 2);
    await Promise.resolve();
    expect(h.password).toHaveBeenCalledWith(true, expect.any(AbortSignal));
    expect(update).toHaveBeenCalledWith("test-password");
    h.password.mockResolvedValueOnce(null);
    h.task.onPassword!(update, 2);
    expect(await result).toMatchObject({ name: "AbortError" });
    expect(h.worker.destroy).toHaveBeenCalledOnce();
  });
});

describe("read-only PDF actions", () => {
  /** Only web destinations may leave the application; PDF scripting/file actions never do. */
  it("blocks unsafe URLs and named actions while allowing page navigation", () => {
    for (const url of ["javascript:alert(1)", "file:///tmp/private.pdf", "data:text/html,test", "https://user:secret@example.com", "relative.pdf", "mailto:user@example.com"]) {
      expect(allowedPdfUrl(url)).toBeNull();
    }
    const abort = new AbortController();
    const executeNamedAction = vi.fn();
    const links = { executeNamedAction } as unknown as PDFLinkService;
    const external = vi.fn();
    restrictPdfLinks(links, external, abort.signal);
    links.executeNamedAction("Print"); links.executeNamedAction("SaveAs"); links.executeNamedAction("NextPage");
    expect(executeNamedAction).toHaveBeenCalledExactlyOnceWith("NextPage");
    const anchor = document.createElement("a");
    links.addLinkAttributes(anchor, "https://example.com/pdf");
    anchor.click();
    expect(external).toHaveBeenCalledExactlyOnceWith("https://example.com/pdf");
    const unsafe = document.createElement("a");
    links.addLinkAttributes(unsafe, "file:///tmp/private.pdf");
    expect(unsafe.hasAttribute("href")).toBe(false);
    expect(unsafe.getAttribute("aria-disabled")).toBe("true");
    abort.abort();
  });
});
