import type { RendererCapabilities } from "./document-view";
import { createDocumentTypeIcon } from "./document-type-icon";

/** Shell elements whose labels and enabled state depend on the current renderer. */
export interface DocumentShellControls {
  /** Shared print, outline, and zoom controls. */
  print: HTMLButtonElement;
  outline: HTMLButtonElement;
  zoom: HTMLButtonElement[];
  /** Current-file search and PDF/Markdown outline labels. */
  fileScope: HTMLOptionElement;
  outlineTitle: HTMLElement;
  outlineNav: HTMLElement;
  /** Shared document icon immediately before the current filename. */
  fileIcon: HTMLElement;
}

/** Applies explicit capabilities to usable content and explains unavailable PDF printing. */
export function updateDocumentShell(controls: DocumentShellControls, kind: "markdown" | "pdf" | null,
  capabilities: RendererCapabilities): void {
  controls.fileIcon.replaceChildren(...(kind ? [createDocumentTypeIcon(kind)] : []));
  controls.fileIcon.hidden = kind === null;
  controls.print.disabled = !capabilities.print;
  controls.print.title = kind === "pdf" ? "PDF printing is not available yet"
    : capabilities.print ? "Print or save as PDF (⌘/Ctrl+P)" : "Open a document to print";
  controls.print.setAttribute("aria-label", kind === "pdf" ? "PDF printing is not available yet" : "Print or save as PDF");
  controls.fileScope.disabled = !capabilities.find;
  controls.fileScope.textContent = kind === "pdf" ? "This PDF" : kind === "markdown" ? "This Markdown file" : "This file";
  controls.outline.disabled = !capabilities.outline;
  const outline = kind === "pdf" ? "PDF bookmarks" : "document outline";
  controls.outline.title = `${controls.outline.getAttribute("aria-expanded") === "true" ? "Close" : "Open"} ${outline}`;
  controls.outline.setAttribute("aria-label", controls.outline.title);
  controls.outlineTitle.textContent = kind === "pdf" ? "Bookmarks" : "On this page";
  controls.outlineNav.setAttribute("aria-label", kind === "pdf" ? "PDF bookmarks" : "Document headings");
  if (kind === null) for (const button of controls.zoom) button.disabled = true;
}
