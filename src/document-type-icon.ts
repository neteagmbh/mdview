/** Creates a shared, theme-aware document glyph for tree rows and the current filename. */
export function createDocumentTypeIcon(kind: "markdown" | "pdf"): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(ns, "svg");
  icon.classList.add("document-type-icon");
  icon.dataset.kind = kind;
  icon.setAttribute("viewBox", "0 0 28 30");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  const page = document.createElementNS(ns, "path");
  page.setAttribute("d", "M5 1.5h11l7 7V27a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 3 27V3A1.5 1.5 0 0 1 5 1.5ZM16 1.5V9h7");
  const label = document.createElementNS(ns, "text");
  label.setAttribute("x", "13");
  label.setAttribute("y", "22");
  label.setAttribute("text-anchor", "middle");
  label.textContent = kind === "pdf" ? "PDF" : "MD";
  icon.append(page, label);
  return icon;
}
