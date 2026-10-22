import { loadPdfjs } from "./pdfjs-runtime";
import type { PdfResource } from "./documents";
import type { DocumentRenderer } from "./document-view";
import type { PDFViewer, PDFLinkService } from "pdfjs-dist/types/web/pdf_viewer.component";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";
import { createPdfSearch, type FileFindAdapter } from "./pdf-search";
import { pdfBookmarks, type PdfBookmark } from "./pdf-outline";
import { normalizePdfPosition, type PdfPosition } from "./pdf-position";

/** Limits each base/detail canvas; PDF.js retains a viewport-sized page cache and renders serially. */
export const PDF_CANVAS_LIMITS = { maxCanvasPixels: 2_097_152, maxCanvasDim: 4096 };
/** A supported page fit or an explicit scale selected through the shared zoom controls. */
export type PdfScaleMode = "page-width" | "page-fit" | "custom";
/** Viewer state used by shell controls without exposing PDF.js internals. */
export interface PdfViewerState {
  /** One-based currently visible page and total document pages. */
  page: number;
  pages: number;
  /** Actual scale as a multiplier of PDF's normal display scale. */
  scale: number;
  /** Current fit policy or explicit zoom. */
  mode: PdfScaleMode;
  /** Clockwise document rotation in degrees. */
  rotation: number;
}
/** PDF renderer extends common capabilities with page navigation and real page rerendering. */
export interface PdfRenderer extends DocumentRenderer {
  /** Renderer-owned upstream search session, available after readiness. */
  find: FileFindAdapter;
  /** Captures page-relative coordinates for Back, reload, and persistence. */
  position: () => PdfPosition | null;
  /** Navigates to a validated page. */
  goToPage: (page: number) => void;
  /** Applies fit-width, fit-page, or a normal 100% scale. */
  fit: (mode: "page-width" | "page-fit" | "actual") => void;
  /** Rotates all pages in quarter turns. */
  rotate: (direction: -1 | 1) => void;
  /** Captures canvas allocation and worker state for focused lifecycle validation. */
  diagnostics: () => { canvasPixels: number; canvases: number; cachedPages: number; workerAlive: boolean };
}
/** Dependencies keep the native lease, PDF controls, and password UI outside PDF.js. */
export interface PdfViewerOptions {
  /** Dedicated scrolling container and its PDF.js page mount. */
  container: HTMLDivElement;
  viewer: HTMLDivElement;
  /** Original native snapshot lease, owned by the document-opening controller. */
  resource: PdfResource;
  /** Parent renderer lifetime; switching documents must abort every stage of initialization. */
  signal: AbortSignal;
  /** Optional relative-link destination. */
  page?: number | null;
  /** Previously persisted source position, ignored when an explicit page destination is supplied. */
  position?: PdfPosition | null;
  /** Receives page-relative updates after initialization is complete. */
  positionChanged?: (position: PdfPosition) => void;
  /** Receives embedded bookmarks; empty outlines remain a valid viewing state. */
  outline?: (bookmarks: PdfBookmark[]) => void;
  /** Updates the native shell's page, zoom, and rotation controls. */
  changed: (state: PdfViewerState) => void;
  /** Surfaces rendering errors that occur after initial readiness. */
  failed: (error: unknown) => void;
  /** Routes allowed links to the existing system-browser handler. */
  openExternal: (url: string) => void;
  /** Returns a transient password or cancellation; passwords never enter persistence. */
  password: (incorrect: boolean, signal: AbortSignal) => Promise<string | null>;
}

/** Restricts PDF URI actions to explicit web navigation through the system browser. */
export function allowedPdfUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Removes non-navigation PDF actions while retaining internal destinations and read-only appearances. */
export function restrictPdfLinks(links: PDFLinkService, openExternal: (url: string) => void,
  signal: AbortSignal): void {
  const namedAction = links.executeNamedAction.bind(links);
  links.executeNamedAction = action => {
    if (!signal.aborted && ["NextPage", "PrevPage", "FirstPage", "LastPage"].includes(action)) namedAction(action);
  };
  links.executeSetOCGState = async () => undefined;
  links.getAttachmentContent = async () => { throw new Error("PDF attachments are not supported."); };
  links.addLinkAttributes = (anchor, value) => {
    const url = allowedPdfUrl(value);
    if (!url) { anchor.removeAttribute("href"); anchor.setAttribute("aria-disabled", "true"); return; }
    anchor.href = url;
    anchor.rel = "noopener noreferrer";
    anchor.addEventListener("click", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!signal.aborted) openExternal(url);
    }, { capture: true, signal });
  };
}

/** Starts a lazy real-worker renderer immediately enough for disposal to cancel pending initialization. */
export function createPdfViewer(options: PdfViewerOptions,
  runtime: typeof loadPdfjs = loadPdfjs): PdfRenderer {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  let viewer: PDFViewer | undefined;
  let links: PDFLinkService | undefined;
  let task: PDFDocumentLoadingTask | undefined;
  let worker: Awaited<ReturnType<Awaited<ReturnType<typeof loadPdfjs>>["createPdfWorker"]>> | undefined;
  let disposed: Promise<void> | undefined;
  let loaded = false;
  let restoring = true;
  let find: FileFindAdapter | undefined;
  let mode: PdfScaleMode = "page-width";
  let rejectFailure!: (error: unknown) => void;
  const failure = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
  // It may reject between initialization awaits; every owned wait still observes the same failure.
  void failure.catch(() => undefined);
  signal.addEventListener("abort", () => rejectFailure(new DOMException("PDF opening cancelled.", "AbortError")), { once: true });
  /** Prevents stale initialization steps from allocating or committing more resources. */
  const check = () => signal.throwIfAborted();
  /** Measures offsets against the actual rotated page rather than whole-document scroll height. */
  function position(): PdfPosition | null {
    if (!viewer?.pdfDocument || signal.aborted) return null;
    const page = viewer.getPageView(viewer.currentPageNumber - 1)?.div;
    if (!page) return null;
    return normalizePdfPosition({ page: viewer.currentPageNumber, scale: viewer.currentScale, mode,
      rotation: viewer.pagesRotation,
      offset: (options.container.scrollTop - page.offsetTop) / Math.max(1, page.clientHeight),
      left: (options.container.scrollLeft - page.offsetLeft) / Math.max(1, page.clientWidth) });
  }
  /** Shares actual PDF.js scale/page state; callbacks never run after disposal. */
  function changed(): void {
    if (!viewer?.pdfDocument || signal.aborted) return;
    options.changed({ page: viewer.currentPageNumber, pages: viewer.pagesCount,
      scale: viewer.currentScale, mode, rotation: viewer.pagesRotation });
  }
  /** Flushes pending scroll geometry before transforms so an immediate zoom cannot jump to a stale page. */
  function transform(action: (active: PDFViewer) => void): void {
    if (!viewer?.pdfDocument || signal.aborted) return;
    const page = viewer.currentPageNumber;
    viewer.update();
    action(viewer);
    viewer.update();
    if (viewer.currentPageNumber !== page) {
      viewer.currentPageNumber = page;
      viewer.update();
    }
    changed();
  }
  /** Idempotently stops canvas work and observers before terminating the native worker. */
  function destroy(): Promise<void> {
    lifetime.abort();
    options.signal.removeEventListener("abort", abort);
    disposed ??= (async () => {
      find?.clear();
      for (const canvas of options.viewer.querySelectorAll("canvas")) canvas.width = canvas.height = 0;
      viewer?.setDocument(null);
      links?.setDocument(null);
      try { await task?.destroy(); }
      finally {
        worker?.destroy();
        worker = undefined;
        for (const canvas of options.viewer.querySelectorAll("canvas")) canvas.width = canvas.height = 0;
        options.viewer.replaceChildren();
        viewer = undefined;
        links = undefined;
      }
    })();
    return disposed;
  }
  /** Parent cancellation closes a password prompt and releases work without awaiting another request. */
  const abort = () => { void destroy().catch(() => undefined); };
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) lifetime.abort();

  /** Loads bytes and upstream components only for an active PDF document. */
  async function initialize(): Promise<void> {
    try {
      check();
      const bundle = await runtime();
      check();
      const components = await bundle.viewerComponents();
      check();
      const data = await options.resource.read();
      check();
      const started = await bundle.createPdfWorker();
      if (signal.aborted) { started.destroy(); check(); }
      worker = started;
      /** Native module-worker errors must fail visibly instead of leaving a permanent loading state. */
      const workerFailed = () => {
        const error = new Error("Could not load the PDF worker.");
        rejectFailure(error);
        if (loaded && !signal.aborted) options.failed(error);
      };
      worker.port.addEventListener("error", workerFailed, { signal });
      worker.port.addEventListener("messageerror", workerFailed, { signal });
      task = bundle.pdfjs.getDocument({ ...bundle.documentOptions, data, worker: worker.worker, enableXfa: false });
      task.onPassword = (updatePassword: (password: string) => void, reason: number) => {
        void options.password(reason === bundle.pdfjs.PasswordResponses.INCORRECT_PASSWORD, signal)
          .then(password => {
            if (signal.aborted) return;
            if (password === null) { lifetime.abort(); void destroy().catch(() => undefined); }
            else updatePassword(password);
          }).catch(error => { options.failed(error); void destroy().catch(() => undefined); });
      };
      const pdf = bundle.preparePdfDocument(await Promise.race([task.promise, failure]));
      check();
      await pdf.getPage(1);
      check();
      const bus = new components.EventBus();
      links = new components.PDFLinkService({ eventBus: bus, ignoreDestinationZoom: true });
      restrictPdfLinks(links, options.openExternal, signal);
      const controller = new components.PDFFindController({ eventBus: bus, linkService: links, delay: 100 });
      find = createPdfSearch(bus, controller, signal);
      // The shipped constructor supports abortSignal; its generated declaration currently omits it.
      const viewerOptions = { container: options.container, viewer: options.viewer, eventBus: bus,
        linkService: links, findController: controller, ...PDF_CANVAS_LIMITS, enableDetailCanvas: true, enablePermissions: true,
        annotationMode: bundle.pdfjs.AnnotationMode.ENABLE,
        annotationEditorMode: bundle.pdfjs.AnnotationEditorType.DISABLE,
        enableAutoLinking: false, imageResourcesPath: `${bundle.resourceBase}images/`,
        minDurationToUpdateCanvas: 0, abortSignal: signal };
      viewer = new components.PDFViewer(viewerOptions);
      links.setViewer(viewer);
      links.setDocument(pdf);
      const initial = options.page ? null : normalizePdfPosition(options.position, pdf.numPages);
      let restored!: () => void;
      let restoreFailed!: (error: unknown) => void;
      const restoration = new Promise<void>((resolve, reject) => { restored = resolve; restoreFailed = reject; });
      // Observe early rejection while the viewer is still preparing its first paint.
      void restoration.catch(() => undefined);
      const initialized = new Promise<void>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("PDF opening cancelled.", "AbortError")), { once: true });
        bus.on("pagesinit", () => {
          if (!viewer || signal.aborted) return;
          void (async () => {
            const target = initial?.page ?? Math.min(pdf.numPages, Math.max(1, options.page ?? 1));
            const page = await pdf.getPage(target);
            check();
            const pageView = viewer!.getPageView(target - 1);
            if (!pageView.pdfPage) pageView.setPdfPage(page);
            viewer!.pagesRotation = initial?.rotation ?? 0;
            mode = initial?.mode ?? "page-width";
            viewer!.currentScaleValue = mode === "custom" ? String(initial!.scale) : mode;
            viewer!.currentPageNumber = target;
            viewer!.update();
            if (initial) {
              const div = pageView.div;
              options.container.scrollTop = div.offsetTop + initial.offset * div.clientHeight;
              options.container.scrollLeft = div.offsetLeft + initial.left * div.clientWidth;
              viewer!.update();
            }
            changed(); restored();
          })().catch(restoreFailed);
        }, { signal });
        bus.on("pagerendered", (event: { error?: unknown }) => {
          if (event.error) {
            if (loaded) options.failed(event.error);
            else reject(event.error);
          } else { loaded = true; changed(); resolve(); }
        }, { signal });
      });
      for (const event of ["pagechanging", "scalechanging", "rotationchanging"]) bus.on(event, changed, { signal });
      bus.on("updateviewarea", () => {
        if (!restoring && !signal.aborted) {
          const current = position();
          if (current) options.positionChanged?.(current);
        }
      }, { signal });
      viewer.setDocument(pdf);
      void viewer.pagesPromise.catch((error: unknown) => rejectFailure(error));
      // First-page failures must not leave an indefinitely loading application shell.
      await Promise.race([Promise.all([initialized, restoration]), failure]);
      check();
      // PDF.js fills mixed-size page geometry after first paint; reapply the destination once it settles.
      await Promise.race([viewer.pagesPromise, failure]);
      check();
      const target = initial?.page ?? Math.min(pdf.numPages, Math.max(1, options.page ?? 1));
      viewer.currentPageNumber = target;
      viewer.update();
      if (initial) {
        const div = viewer.getPageView(target - 1).div;
        options.container.scrollTop = div.offsetTop + initial.offset * div.clientHeight;
        options.container.scrollLeft = div.offsetLeft + initial.left * div.clientWidth;
        viewer.update();
      }
      changed();
      restoring = false;
      const current = position();
      if (current) options.positionChanged?.(current);
      // Outline failures are nonfatal metadata failures; page viewing remains available.
      void pdf.getOutline().then(items => {
        if (signal.aborted) return;
        options.outline?.(pdfBookmarks(items, dest => { if (!signal.aborted) void links?.goToDestination(dest); },
          url => { const safe = allowedPdfUrl(url); if (safe && !signal.aborted) options.openExternal(safe); }));
      }).catch(() => { if (!signal.aborted) options.outline?.([]); });
      options.container.focus();
    } catch (error) {
      const cancelled = signal.aborted;
      await destroy();
      if (cancelled) throw new DOMException("PDF opening cancelled.", "AbortError");
      throw error;
    }
  }
  const ready = initialize();
  return {
    kind: "pdf", capabilities: { print: false, find: true, outline: true }, ready, destroy, position,
    find: { search: (query, changed) => find?.search(query, changed), move: previous => find?.move(previous), clear: () => find?.clear() },
    goToPage(page) {
      if (viewer && Number.isInteger(page) && page >= 1 && page <= viewer.pagesCount) {
        viewer.currentPageNumber = page;
        viewer.update();
      }
      changed();
    },
    zoom(direction) {
      mode = "custom";
      transform(active => {
        active.currentScale = direction === 0 ? 1 : Math.max(0.25, Math.min(5, active.currentScale * (direction > 0 ? 1.25 : 0.8)));
      });
    },
    fit(selected) {
      mode = selected === "actual" ? "custom" : selected;
      transform(active => { active.currentScaleValue = selected === "actual" ? "1" : selected; });
    },
    rotate(direction) {
      transform(active => { active.pagesRotation = (active.pagesRotation + direction * 90 + 360) % 360; });
    },
    diagnostics() {
      const canvases = [...options.viewer.querySelectorAll("canvas")];
      return { canvasPixels: canvases.reduce((total, canvas) => total + canvas.width * canvas.height, 0),
        canvases: canvases.length, cachedPages: viewer?.getCachedPageViews().size ?? 0, workerAlive: Boolean(worker) };
    },
  };
}
