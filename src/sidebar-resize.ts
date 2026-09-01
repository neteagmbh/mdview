/** Minimum and maximum width (in pixels) a resizable sidebar may be dragged to. */
export interface SidebarResizeBounds {
  min: number;
  max: number;
}

/** Direction a handle grows its target's width in as the pointer moves right. */
export type ResizeDirection = "grow-right" | "grow-left";

/** Clamps a proposed sidebar width to its configured minimum and maximum. */
export function clampSidebarWidth(width: number, bounds: SidebarResizeBounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, width));
}

/** Computes a clamped sidebar width from a pointer drag distance and its growth direction. */
export function computeResizedWidth(
  startWidth: number,
  startClientX: number,
  currentClientX: number,
  direction: ResizeDirection,
  bounds: SidebarResizeBounds,
): number {
  const delta = currentClientX - startClientX;
  const rawWidth = direction === "grow-right" ? startWidth + delta : startWidth - delta;
  return clampSidebarWidth(rawWidth, bounds);
}

/** Configuration for wiring a single draggable resize handle to a CSS custom property. */
export interface SidebarResizeOptions {
  handle: HTMLElement;
  target: HTMLElement;
  cssVariable: string;
  bounds: SidebarResizeBounds;
  direction: ResizeDirection;
  getCurrentWidth: () => number;
  onResizeEnd?: (width: number) => void;
}

/** Wires pointer-drag resizing on a handle, writing the resulting width to a CSS custom property. */
export function attachSidebarResize(options: SidebarResizeOptions): void {
  const { handle, target, cssVariable, bounds, direction, getCurrentWidth, onResizeEnd } = options;
  let startClientX = 0;
  let startWidth = 0;
  let currentWidth = 0;

  function handlePointerMove(event: PointerEvent): void {
    const width = computeResizedWidth(startWidth, startClientX, event.clientX, direction, bounds);
    currentWidth = width;
    target.style.setProperty(cssVariable, `${width}px`);
  }

  function handlePointerUp(event: PointerEvent): void {
    if (typeof handle.releasePointerCapture === "function" && event.pointerId !== undefined) {
      handle.releasePointerCapture(event.pointerId);
    }
    handle.removeEventListener("pointermove", handlePointerMove);
    handle.removeEventListener("pointerup", handlePointerUp);
    handle.classList.remove("resizing");
    onResizeEnd?.(currentWidth);
  }

  handle.addEventListener("pointerdown", (event) => {
    startClientX = event.clientX;
    startWidth = getCurrentWidth();
    currentWidth = startWidth;
    handle.classList.add("resizing");
    if (typeof handle.setPointerCapture === "function" && event.pointerId !== undefined) {
      handle.setPointerCapture(event.pointerId);
    }
    handle.addEventListener("pointermove", handlePointerMove);
    handle.addEventListener("pointerup", handlePointerUp);
  });
}
