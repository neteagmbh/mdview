/** Lazily loads the PDF parser, viewer components, and viewer styles together. */
export function loadPdfjs() {
  return import("./pdfjs-bundle");
}
