import type { EventBus, PDFFindController } from "pdfjs-dist/types/web/pdf_viewer.component";

/** Counts and a PDF text position supplied by the upstream find controller. */
export interface FileFindState {
  /** One-based selected match, total matches discovered, and extraction progress. */
  current: number;
  total: number;
  pending: boolean;
  /** One-based page and zero-based text offset for the selected PDF hit. */
  page?: number;
  textOffset?: number;
}
/** A current-file adapter lets the shared search UI avoid Markdown DOM operations on PDFs. */
export interface FileFindAdapter {
  /** Starts a new query and subscribes to asynchronous count/selection updates. */
  search(query: string, changed: (state: FileFindState) => void): void;
  /** Advances or reverses selection, including off-screen pages and wrapping. */
  move(previous: boolean): void;
  /** Removes highlights and cancels the current search session. */
  clear(): void;
}

/** Adapts the pinned PDF.js controller without duplicating its extraction or match navigation. */
export function createPdfSearch(bus: EventBus, find: PDFFindController, signal: AbortSignal): FileFindAdapter {
  let query = "";
  let changed: ((state: FileFindState) => void) | undefined;
  let pending = false;
  /** Reports original PDF text positions rather than Markdown source-line coordinates. */
  function update(event: { state?: number; rawQuery?: string; matchesCount: { current: number; total: number } }): void {
    if (signal.aborted || !query || (event.rawQuery != null && event.rawQuery !== query)) return;
    if (event.state !== undefined) pending = event.state === 3;
    const selected = find.selected;
    changed?.({ ...event.matchesCount, pending,
      page: selected && selected.pageIdx >= 0 ? selected.pageIdx + 1 : undefined,
      textOffset: selected ? find.pageMatches?.[selected.pageIdx]?.[selected.matchIdx] : undefined });
  }
  bus.on("updatefindmatchescount", update, { signal });
  bus.on("updatefindcontrolstate", update, { signal });
  /** Sends supported find options, retaining the user's query entirely in memory. */
  function dispatch(type: string, previous = false): void {
    if (signal.aborted) return;
    bus.dispatch("find", { source: find, type, query, caseSensitive: false, entireWord: false,
      highlightAll: true, findPrevious: previous, matchDiacritics: false });
  }
  /** Stops highlights and prevents late callbacks from reaching a replaced search session. */
  function clear(): void {
    query = "";
    changed = undefined;
    bus.dispatch("findbarclose", { source: find });
  }
  signal.addEventListener("abort", clear, { once: true });
  return {
    search(value, callback) {
      clear();
      query = value.trim(); changed = callback; pending = true;
      callback({ current: 0, total: 0, pending: Boolean(query) });
      if (query) dispatch("");
    },
    move(previous) { if (query) dispatch("again", previous); },
    clear,
  };
}
