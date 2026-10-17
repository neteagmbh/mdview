/** The scoped standard-library polyfill is loaded only with the PDF runtime. */
declare module "core-js/actual/iterator/join";

/** Legacy builds expose the same typed API as their modern counterparts. */
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export * from "pdfjs-dist";
}

/** Viewer components are imported independently from the parser bundle. */
declare module "pdfjs-dist/legacy/web/pdf_viewer.mjs" {
  export * from "pdfjs-dist/types/web/pdf_viewer.component";
}
