/**
 * Explicit light-mode text and background colors applied to copied content.
 *
 * Word/Outlook paste onto a white page, so copied content must never carry the
 * app's current (possibly dark) theme colors — the browser inlines computed
 * styles onto the default copy payload, which is what causes the mismatch.
 */
const CLIPBOARD_TEXT_COLOR = "#202124";
const CLIPBOARD_BACKGROUND_COLOR = "#ffffff";

/** Applies light export colors and returns a function that restores the previous inline colors. */
export function applyLightModeExportColors(element: HTMLElement): () => void {
  const previousColor = element.style.color;
  const previousBackgroundColor = element.style.backgroundColor;
  element.style.color = CLIPBOARD_TEXT_COLOR;
  element.style.backgroundColor = CLIPBOARD_BACKGROUND_COLOR;

  return () => {
    element.style.color = previousColor;
    element.style.backgroundColor = previousBackgroundColor;
  };
}

/**
 * Replaces cloned Mermaid diagrams with their pre-rendered PNG (see `diagrams.ts`).
 *
 * Word/Outlook do not reliably render inline SVG on paste, so without this the diagram
 * collapses to the bare text content of its SVG nodes.
 */
function replaceMermaidDiagramsWithImages(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>(".mermaid-diagram").forEach((diagram) => {
    const pngDataUrl = diagram.dataset.clipboardPng;
    const svg = diagram.querySelector("svg");
    if (!pngDataUrl || !svg) {
      return;
    }
    const image = document.createElement("img");
    image.src = pngDataUrl;
    image.alt = "Mermaid diagram";
    svg.replaceWith(image);
  });
}

/** Prepares a live document for light-mode printing and returns a complete restore function. */
export function prepareLightModePrint(root: HTMLElement): () => void {
  const restoreColors = applyLightModeExportColors(root);
  const replacements: Array<{ image: HTMLImageElement; svg: SVGSVGElement }> = [];

  root.querySelectorAll<HTMLElement>(".mermaid-diagram").forEach((diagram) => {
    const pngDataUrl = diagram.dataset.clipboardPng;
    const svg = diagram.querySelector<SVGSVGElement>("svg");
    if (!pngDataUrl || !svg) {
      return;
    }
    const image = document.createElement("img");
    image.src = pngDataUrl;
    image.alt = "Mermaid diagram";
    svg.replaceWith(image);
    replacements.push({ image, svg });
  });

  return () => {
    replacements.forEach(({ image, svg }) => image.replaceWith(svg));
    restoreColors();
  };
}

/** Serializes the current selection into clipboard HTML with theme-independent colors. */
export function buildLightModeClipboardHtml(selection: Selection): string | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const container = document.createElement("div");
  applyLightModeExportColors(container);

  for (let index = 0; index < selection.rangeCount; index += 1) {
    container.append(selection.getRangeAt(index).cloneContents());
  }

  replaceMermaidDiagramsWithImages(container);

  return container.outerHTML;
}

