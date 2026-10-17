import { describe, expect, it, vi } from "vitest";
import { preparePdfDocument } from "./pdfjs-compatibility";
import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";

/** Provides the public document/page stream surface used by the PDF.js viewer. */
function pageApi(stream: ReadableStream, pureXfa = false) {
  const original = vi.fn(async () => ({ xfa: true }));
  const page = { isPureXfa: pureXfa, getTextContent: original,
    streamTextContent: () => stream } as unknown as PDFPageProxy;
  const document = { getPage: async (_number: number) => page };
  return { document, page, original };
}

describe("Safari PDF text-stream compatibility", () => {
  /** Extraction merges every chunk, retains metadata, and releases the lock. */
  it("extracts chunks through getReader", async () => {
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue({ items: [{ str: "first" }], styles: { font1: { ascent: 1 } }, lang: "en" });
      controller.enqueue({ items: [{ str: "second" }], styles: { font2: { ascent: 2 } }, lang: null });
      controller.close();
    } });
    const { document } = pageApi(stream);
    const pdf = preparePdfDocument(document, false);
    await expect((await pdf.getPage(1)).getTextContent()).resolves.toEqual({
      items: [{ str: "first" }, { str: "second" }],
      styles: { font1: { ascent: 1 }, font2: { ascent: 2 } }, lang: "en",
    });
    expect(stream.locked).toBe(false);
  });

  /** Reader failures remain visible and must not leave the stream locked. */
  it("preserves failures and releases the lock", async () => {
    const failure = new Error("provider stopped");
    const stream = new ReadableStream({ start(controller) { controller.error(failure); } });
    const { document } = pageApi(stream);
    const pdf = preparePdfDocument(document, false);
    await expect((await pdf.getPage(1)).getTextContent()).rejects.toBe(failure);
    expect(stream.locked).toBe(false);
  });

  /** Supporting browsers keep upstream document and page methods intact. */
  it("leaves supported runtimes unchanged", () => {
    const { document, page, original } = pageApi(new ReadableStream());
    const getPage = document.getPage;
    expect(preparePdfDocument(document, true)).toBe(document);
    expect(document.getPage).toBe(getPage);
    expect(page.getTextContent).toBe(original);
  });

  /** XFA's upstream branch does not require stream async iteration. */
  it("retains upstream extraction for pure XFA documents", async () => {
    const { document, original } = pageApi(new ReadableStream(), true);
    const pdf = preparePdfDocument(document, false);
    await expect((await pdf.getPage(1)).getTextContent()).resolves.toEqual({ xfa: true });
    expect(original).toHaveBeenCalledOnce();
  });

  /** Repeated setup and cached page access must not stack wrappers. */
  it("prepares documents and pages once", async () => {
    const { document } = pageApi(new ReadableStream());
    const pdf = preparePdfDocument(document, false);
    const getPage = pdf.getPage;
    const getText = (await pdf.getPage(1)).getTextContent;
    preparePdfDocument(document, false);
    expect(pdf.getPage).toBe(getPage);
    expect((await pdf.getPage(1)).getTextContent).toBe(getText);
  });
});
