import { expect, it, vi } from "vitest";
import { createPdfSearch } from "./pdf-search";
import type { EventBus, PDFFindController } from "pdfjs-dist/types/web/pdf_viewer.component";

/** Exercises PDF.js events, count progress, and page/text identity without Markdown DOM matches. */
it("dispatches query/next/previous and reports PDF text positions", () => {
  const listeners = new Map<string, (event: any) => void>();
  const bus = { on: (name: string, fn: (event: any) => void) => listeners.set(name, fn), dispatch: vi.fn() };
  const controller = { selected: { pageIdx: 39, matchIdx: 1 }, pageMatches: Array.from({ length: 40 }, () => [12, 24]) };
  const signal = new AbortController();
  const search = createPdfSearch(bus as unknown as EventBus, controller as unknown as PDFFindController, signal.signal);
  const changed = vi.fn();
  search.search(" needle ", changed);
  expect(bus.dispatch).toHaveBeenLastCalledWith("find", expect.objectContaining({ query: "needle", type: "", highlightAll: true }));
  listeners.get("updatefindcontrolstate")!({ state: 0, rawQuery: "needle", matchesCount: { current: 80, total: 120 } });
  expect(changed).toHaveBeenLastCalledWith({ current: 80, total: 120, pending: false, page: 40, textOffset: 24 });
  search.move(false); search.move(true);
  expect(bus.dispatch).toHaveBeenLastCalledWith("find", expect.objectContaining({ type: "again", findPrevious: true }));
  const calls = changed.mock.calls.length;
  listeners.get("updatefindcontrolstate")!({ state: 0, rawQuery: "old", matchesCount: { current: 1, total: 1 } });
  expect(changed).toHaveBeenCalledTimes(calls);
  signal.abort();
  listeners.get("updatefindmatchescount")!({ matchesCount: { current: 1, total: 1 } });
  expect(changed).toHaveBeenCalledTimes(calls);
});

/** Empty/image-only pages complete normally with zero hits; empty queries clear the session. */
it("handles no-text documents and prevents late updates after clearing", () => {
  const listeners = new Map<string, (event: any) => void>();
  const bus = { on: (name: string, fn: (event: any) => void) => listeners.set(name, fn), dispatch: vi.fn() };
  const search = createPdfSearch(bus as unknown as EventBus, { selected: { pageIdx: -1, matchIdx: -1 } } as PDFFindController, new AbortController().signal);
  const changed = vi.fn();
  search.search("needle", changed);
  listeners.get("updatefindcontrolstate")!({ state: 1, matchesCount: { current: 0, total: 0 } });
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ current: 0, total: 0, pending: false }));
  search.search("", changed);
  expect(changed).toHaveBeenLastCalledWith({ current: 0, total: 0, pending: false });
  const calls = changed.mock.calls.length;
  search.clear();
  listeners.get("updatefindmatchescount")!({ matchesCount: { current: 2, total: 4 } });
  expect(changed).toHaveBeenCalledTimes(calls);
});
