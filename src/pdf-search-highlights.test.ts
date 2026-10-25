// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventBus, PDFViewer } from "pdfjs-dist/types/web/pdf_viewer.component";
import { installPdfSearchHighlights } from "./pdf-search-highlights";

/** Models page/find events with the same abort lifetime as the upstream bus. */
class Bus {
  /** Registered listeners belong to a single renderer lifetime. */
  listeners = new Map<string, Set<(event: any) => void>>();
  /** Removes the listener when document disposal aborts its signal. */
  on(name: string, callback: (event: any) => void, options: { signal: AbortSignal }) {
    const callbacks = this.listeners.get(name) ?? new Set();
    callbacks.add(callback);
    this.listeners.set(name, callbacks);
    options.signal.addEventListener("abort", () => callbacks.delete(callback));
  }
  /** Delivers the page-render and find updates used by the adapter. */
  dispatch(name: string, event: any = {}) { for (const callback of this.listeners.get(name) ?? []) callback(event); }
}

/** Isolates browser-measured geometry from matching, which remains a PDF.js responsibility. */
function harness() {
  const abort = new AbortController();
  const bus = new Bus();
  const page = document.createElement("div");
  const layer = document.createElement("div");
  layer.className = "textLayer";
  layer.innerHTML = "<span>prefix Koordinaten suffix</span><span>Ko-</span><span>ordinaten</span><span>𝑥ä</span>";
  page.append(layer);
  document.body.append(page);
  const nodes = [...layer.children];
  const find = { highlightMatches: true, state: { highlightAll: true }, selected: { pageIdx: 0, matchIdx: 0 },
    pageMatches: [[7]], pageMatchesLength: [[11]], scrollMatchIntoView: vi.fn() };
  const original = vi.fn();
  const highlighter = { enabled: true, pageIdx: 0, findController: find, textDivs: nodes as Node[],
    _convertMatches: vi.fn(() => [{ begin: { divIdx: 0, offset: 7 }, end: { divIdx: 0, offset: 18 } }]),
    _updateMatches: original as (reset?: boolean) => void };
  const viewer = { pagesCount: 1, getPageView: () => ({ div: page, _textHighlighter: highlighter }) };
  let bounds = new DOMRect(100, 200, 600, 800);
  let textBounds: DOMRect | undefined;
  let rects = [new DOMRect(160, 280, 120, 20)];
  const ranges: Range[] = [];
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("textLayer") ? textBounds ?? bounds : bounds;
  });
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true,
    value: function (this: Range) { ranges.push(this.cloneRange()); return rects; } });
  installPdfSearchHighlights(bus as unknown as EventBus, viewer as unknown as PDFViewer, abort.signal);
  bus.dispatch("pagesinit");
  return { abort, bus, page, layer, nodes, find, highlighter, original, ranges,
    boxes: () => [...page.querySelectorAll<HTMLElement>(".pdf-search-highlight")],
    geometry: (nextBounds: DOMRect, nextRects: DOMRect[], nextTextBounds?: DOMRect) => {
      bounds = nextBounds; rects = nextRects; textBounds = nextTextBounds;
    } };
}

afterEach(() => {
  getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
  vi.restoreAllMocks();
});

describe("PDF search selection geometry", () => {
  it("maps text-layer coordinates into the canvas plane when page borders make their sizes differ", () => {
    const h = harness();
    h.geometry(new DOMRect(100, 200, 600, 800), [new DOMRect(152.8, 272.8, 123.6, 20.45)],
      new DOMRect(91, 191, 618, 818));
    h.highlighter._updateMatches();
    const box = h.boxes()[0];
    expect(parseFloat(box.style.left)).toBeCloseTo(10);
    expect(parseFloat(box.style.top)).toBeCloseTo(10);
    expect(parseFloat(box.style.width)).toBeCloseTo(20);
    expect(parseFloat(box.style.height)).toBeCloseTo(2.5);
    h.abort.abort();
  });
  it("paints exact Range rectangles without modifying text nodes or an existing selection", () => {
    const h = harness();
    const text = h.nodes[0].firstChild;
    const selectionRange = document.createRange();
    selectionRange.selectNodeContents(h.nodes[3]);
    getSelection()!.addRange(selectionRange);
    h.highlighter._updateMatches();
    expect(h.ranges[0].toString()).toBe("Koordinaten");
    expect(h.nodes[0].firstChild).toBe(text);
    expect(h.layer.querySelector(".highlight")).toBeNull();
    expect(getSelection()!.toString()).toBe("𝑥ä");
    expect(h.boxes()).toHaveLength(1);
    expect(h.boxes()[0].style.cssText).toBe("left: 10%; top: 10%; width: 20%; height: 2.5%;");
    expect(h.boxes()[0].classList.contains("is-selected")).toBe(true);
    expect(h.find.scrollMatchIntoView).toHaveBeenCalledWith({ element: h.boxes()[0], pageIndex: 0, matchIndex: 0 });
    expect(h.original).not.toHaveBeenCalled();
    h.abort.abort();
  });

  it("uses upstream offsets for split-line hits and retains distinct rectangles", () => {
    const h = harness();
    h.find.pageMatches = [[25]];
    h.find.pageMatchesLength = [[12]];
    h.highlighter._convertMatches.mockReturnValue([{ begin: { divIdx: 1, offset: 0 }, end: { divIdx: 2, offset: 9 } }]);
    h.geometry(new DOMRect(100, 200, 600, 800), [new DOMRect(500, 280, 20, 20),
      new DOMRect(160, 310, 100, 20), new DOMRect(160, 310, 100, 20), new DOMRect(160, 330, 0, 20)]);
    h.highlighter._updateMatches();
    expect(h.highlighter._convertMatches).toHaveBeenCalledWith([25], [12]);
    expect(h.ranges[0].toString()).toBe("Ko-ordinaten");
    expect(h.boxes()).toHaveLength(2);
    h.abort.abort();
  });

  it("resolves UTF-16 offsets in nested or direct text nodes without stripping combining marks", () => {
    const h = harness();
    h.nodes[3].innerHTML = "<span>𝑥</span>ä";
    h.highlighter._convertMatches.mockReturnValue([{ begin: { divIdx: 3, offset: 2 }, end: { divIdx: 3, offset: 4 } }]);
    h.highlighter._updateMatches();
    expect(h.ranges[0].toString()).toBe("ä");
    h.highlighter.textDivs = [h.nodes[3].lastChild!];
    h.highlighter._convertMatches.mockReturnValue([{ begin: { divIdx: 0, offset: 0 }, end: { divIdx: 0, offset: 2 } }]);
    h.highlighter._updateMatches();
    expect(h.ranges[1].toString()).toBe("ä");
    h.abort.abort();
  });

  it("refreshes zoom/rotation geometry and clears when pages hide or search closes", () => {
    const h = harness();
    h.highlighter._updateMatches();
    const first = h.boxes()[0];
    h.highlighter.enabled = false;
    h.highlighter._updateMatches(true);
    expect(h.boxes()).toHaveLength(0);
    h.highlighter.enabled = true;
    h.geometry(new DOMRect(50, 75, 1200, 900), [new DOMRect(170, 165, 240, 45)]);
    h.bus.dispatch("textlayerrendered", { pageNumber: 1 });
    expect(h.boxes()).toHaveLength(1);
    expect(h.boxes()[0]).not.toBe(first);
    expect(h.boxes()[0].style.cssText).toBe("left: 10%; top: 10%; width: 20%; height: 5%;");
    h.find.highlightMatches = false;
    h.highlighter._updateMatches();
    expect(h.page.querySelector(".pdf-search-highlights")).toBeNull();
    h.abort.abort();
  });

  it("updates selected styling and honors selected-only highlighting on other pages", () => {
    const h = harness();
    h.highlighter._convertMatches.mockReturnValue([
      { begin: { divIdx: 0, offset: 7 }, end: { divIdx: 0, offset: 18 } },
      { begin: { divIdx: 2, offset: 0 }, end: { divIdx: 2, offset: 9 } },
    ]);
    h.highlighter._updateMatches();
    expect(h.boxes().map(box => box.classList.contains("is-selected"))).toEqual([true, false]);
    h.find.selected.matchIdx = 1;
    h.highlighter._updateMatches();
    expect(h.boxes().map(box => box.classList.contains("is-selected"))).toEqual([false, true]);
    h.find.state.highlightAll = false;
    h.highlighter._updateMatches();
    expect(h.boxes()).toHaveLength(1);
    expect(h.boxes()[0].dataset.matchIndex).toBe("1");
    h.find.selected.pageIdx = 2;
    h.highlighter._updateMatches();
    expect(h.boxes()).toHaveLength(0);
    h.abort.abort();
  });

  it("clears evicted/empty pages and removes event hooks and overlays on disposal", () => {
    const h = harness();
    h.highlighter._updateMatches();
    h.highlighter._convertMatches.mockReturnValue([]);
    h.highlighter._updateMatches();
    expect(h.boxes()).toHaveLength(0);
    h.highlighter._convertMatches.mockReturnValue([{ begin: { divIdx: 0, offset: 7 }, end: { divIdx: 0, offset: 18 } }]);
    h.page.remove();
    h.highlighter._updateMatches();
    expect(h.boxes()).toHaveLength(0);
    document.body.append(h.page);
    h.highlighter._updateMatches();
    expect(h.boxes()).toHaveLength(1);
    h.abort.abort();
    expect(h.boxes()).toHaveLength(0);
    expect(h.highlighter._updateMatches).toBe(h.original);
    h.bus.dispatch("textlayerrendered", { pageNumber: 1 });
    expect(h.original).not.toHaveBeenCalled();
  });
});
