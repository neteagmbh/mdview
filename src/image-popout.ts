/** Minimum zoom percentage allowed in the popout. */
export const MIN_ZOOM = 25;
/** Maximum zoom percentage allowed in the popout. */
export const MAX_ZOOM = 400;
/** Zoom step (percentage points) applied per icon-button click. */
export const ICON_ZOOM_STEP = 25;
/** Zoom step (percentage points) applied per Ctrl+wheel tick, for smoother control. */
export const WHEEL_ZOOM_STEP = 5;
/** Zoom percentage representing the image at its actual size as rendered in the document. */
export const DOCUMENT_SIZE_ZOOM = 100;

/** Clamps a zoom percentage to the popout's supported range. */
export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Adjusts a zoom percentage by a step in the given direction, clamped to the supported range. */
export function adjustZoom(current: number, direction: -1 | 1, step: number): number {
  return clampZoom(current + direction * step);
}

/** Derives the zoom step direction implied by a Ctrl/pinch wheel gesture's vertical delta. */
export function zoomDirectionFromWheelDelta(deltaY: number): -1 | 1 {
  return deltaY < 0 ? 1 : -1;
}

/** Formats a popout zoom percentage for display. */
export function imagePopoutZoomLabel(zoom: number): string {
  return `${Math.round(zoom)}%`;
}

/** A width/height pair, in CSS pixels. */
export interface Size {
  width: number;
  height: number;
}

/**
 * Computes the zoom percentage — relative to the document-rendered size — that fits `documentSize`
 * within `available` without exceeding it, clamped to the popout's supported range.
 */
export function fitZoom(documentSize: Size, available: Size): number {
  if (documentSize.width <= 0 || documentSize.height <= 0) {
    return DOCUMENT_SIZE_ZOOM;
  }
  const ratio = Math.min(
    available.width / documentSize.width,
    available.height / documentSize.height,
  );
  return clampZoom(ratio * 100);
}

/** DOM elements that make up the image/diagram popout. */
export interface ImagePopoutElements {
  overlay: HTMLElement;
  content: HTMLElement;
  zoomInButton: HTMLButtonElement;
  zoomOutButton: HTMLButtonElement;
  zoomResetButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  /** Measures an element's rendered box; defaults to `getBoundingClientRect`. Overridable for tests. */
  measure?: (element: Element) => Size;
}

/** Opens and closes the popout, independent of how it was invoked. */
export interface ImagePopoutController {
  open: (source: HTMLImageElement | SVGSVGElement) => void;
  close: () => void;
}

/**
 * Wires the popout overlay: cloning and displaying images or Mermaid diagrams, zoom controls,
 * Ctrl+wheel zoom, native wheel scrolling, and dismissal via Escape, backdrop click, or close button.
 *
 * Zoom is always relative to the image's actual rendered size in the document (100% = that size,
 * already reflecting the document's own zoom level), so 150% is always larger than 100%. Opening
 * a preview picks whatever zoom percentage fits the available popout space.
 */
export function createImagePopoutController(
  elements: ImagePopoutElements,
): ImagePopoutController {
  const { overlay, content, zoomInButton, zoomOutButton, zoomResetButton, closeButton } =
    elements;
  const measure = elements.measure ?? ((element: Element) => element.getBoundingClientRect());
  let zoom: number = DOCUMENT_SIZE_ZOOM;
  let documentWidth = 0;
  let documentHeight = 0;
  let activeElement: HTMLElement | SVGSVGElement | null = null;

  function applyZoom(): void {
    if (activeElement && documentWidth > 0 && documentHeight > 0) {
      activeElement.style.setProperty("max-width", "none");
      activeElement.style.setProperty("max-height", "none");
      activeElement.style.setProperty("width", `${(documentWidth * zoom) / 100}px`);
      activeElement.style.setProperty("height", `${(documentHeight * zoom) / 100}px`);
    }
    zoomResetButton.textContent = imagePopoutZoomLabel(zoom);
    zoomOutButton.disabled = zoom <= MIN_ZOOM;
    zoomInButton.disabled = zoom >= MAX_ZOOM;
  }

  function setZoom(next: number): void {
    zoom = clampZoom(next);
    applyZoom();
  }

  function open(source: HTMLImageElement | SVGSVGElement): void {
    const documentSize = measure(source);
    documentWidth = documentSize.width;
    documentHeight = documentSize.height;

    const clone = source.cloneNode(true) as HTMLElement | SVGSVGElement;
    activeElement = clone;
    content.replaceChildren(clone);
    overlay.hidden = false;

    zoom = fitZoom(documentSize, measure(content));
    applyZoom();
    if (typeof overlay.scrollTo === "function") {
      overlay.scrollTo({ top: 0, left: 0 });
    }
    closeButton.focus();
  }

  function close(): void {
    overlay.hidden = true;
    content.replaceChildren();
    activeElement = null;
    documentWidth = 0;
    documentHeight = 0;
  }

  zoomInButton.addEventListener("click", () => setZoom(adjustZoom(zoom, 1, ICON_ZOOM_STEP)));
  zoomOutButton.addEventListener("click", () => setZoom(adjustZoom(zoom, -1, ICON_ZOOM_STEP)));
  zoomResetButton.addEventListener("click", () => setZoom(DOCUMENT_SIZE_ZOOM));
  closeButton.addEventListener("click", () => close());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  overlay.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey) {
        return;
      }
      event.preventDefault();
      setZoom(adjustZoom(zoom, zoomDirectionFromWheelDelta(event.deltaY), WHEEL_ZOOM_STEP));
    },
    { passive: false },
  );
  document.addEventListener("keydown", (event) => {
    if (!overlay.hidden && event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });

  return { open, close };
}

