import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";

/** Documents whose public page-loading API already has the compatibility adapter. */
const preparedDocuments = new WeakSet<object>();

/** Adapts public PDF text streams where Safari lacks ReadableStream async iteration. */
export function preparePdfDocument<T extends Pick<PDFDocumentProxy, "getPage">>(
  document: T,
  supportsAsyncIteration = typeof (ReadableStream.prototype as unknown as {
    [Symbol.asyncIterator]?: unknown;
  })[Symbol.asyncIterator] === "function",
): T {
  if (supportsAsyncIteration || preparedDocuments.has(document)) return document;
  preparedDocuments.add(document);
  const getPage = document.getPage.bind(document);
  const preparedPages = new WeakSet<object>();
  document.getPage = async (...arguments_) => {
    const page = await getPage(...arguments_);
    if (preparedPages.has(page)) return page;
    preparedPages.add(page);
    const original = page.getTextContent;
    page.getTextContent = async function (...parameters) {
      if (this.isPureXfa) return original.apply(this, parameters);
      const reader = this.streamTextContent(...parameters).getReader();
      const text: Awaited<ReturnType<typeof original>> = { items: [], styles: Object.create(null), lang: null };
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) return text;
          text.lang ??= value.lang;
          Object.assign(text.styles, value.styles);
          text.items.push(...value.items);
        }
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
      } finally {
        reader.releaseLock();
      }
    };
    return page;
  };
  return document;
}
