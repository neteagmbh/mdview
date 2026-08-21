/**
 * Explicit light-mode text and background colors applied to copied content.
 *
 * Word/Outlook paste onto a white page, so copied content must never carry the
 * app's current (possibly dark) theme colors — the browser inlines computed
 * styles onto the default copy payload, which is what causes the mismatch.
 */
const CLIPBOARD_TEXT_COLOR = "#202124";
const CLIPBOARD_BACKGROUND_COLOR = "#ffffff";

/** Serializes the current selection into clipboard HTML with theme-independent colors. */
export function buildLightModeClipboardHtml(selection: Selection): string | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const container = document.createElement("div");
  container.style.color = CLIPBOARD_TEXT_COLOR;
  container.style.backgroundColor = CLIPBOARD_BACKGROUND_COLOR;

  for (let index = 0; index < selection.rangeCount; index += 1) {
    container.append(selection.getRangeAt(index).cloneContents());
  }

  return container.outerHTML;
}
