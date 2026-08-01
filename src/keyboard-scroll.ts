const ARROW_SCROLL_STEP = 48;
const PAGE_SCROLL_FACTOR = 0.9;

/** Pixel offset produced by a supported document-scrolling key. */
export interface KeyboardScrollOffset {
  left: number;
  top: number;
}

/** Maps keyboard navigation keys to document-relative scroll offsets. */
export function keyboardScrollOffset(
  key: string,
  viewportWidth: number,
  viewportHeight: number,
): KeyboardScrollOffset | null {
  switch (key) {
    case "ArrowUp":
      return { left: 0, top: -ARROW_SCROLL_STEP };
    case "ArrowDown":
      return { left: 0, top: ARROW_SCROLL_STEP };
    case "ArrowLeft":
      return { left: -ARROW_SCROLL_STEP, top: 0 };
    case "ArrowRight":
      return { left: ARROW_SCROLL_STEP, top: 0 };
    case "PageUp":
      return { left: 0, top: -viewportHeight * PAGE_SCROLL_FACTOR };
    case "PageDown":
      return { left: 0, top: viewportHeight * PAGE_SCROLL_FACTOR };
    default:
      return null;
  }
}

/** Reports whether a key event belongs to a text-editing control. */
function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])") !== null;
}

/** Scrolls the document viewport for an eligible keyboard navigation event. */
export function handleDocumentScrollKey(
  event: KeyboardEvent,
  scrollTarget: HTMLElement,
): boolean {
  if (
    event.defaultPrevented ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    isEditingTarget(event.target)
  ) {
    return false;
  }

  const offset = keyboardScrollOffset(
    event.key,
    scrollTarget.clientWidth,
    scrollTarget.clientHeight,
  );
  if (!offset) {
    return false;
  }

  event.preventDefault();
  scrollTarget.scrollBy({ ...offset, behavior: "auto" });
  return true;
}
