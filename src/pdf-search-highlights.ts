import type { EventBus, PDFViewer, PDFFindController } from "pdfjs-dist/types/web/pdf_viewer.component";

/** Original UTF-16 match boundaries supplied by the pinned PDF.js highlighter. */
interface TextMatch {
  begin: { divIdx: number; offset: number };
  end: { divIdx: number; offset: number };
}

/** Narrow integration with PDF.js 6.4.299; its lifecycle and match mapping remain upstream-owned. */
interface PageHighlighter {
  enabled: boolean;
  pageIdx: number;
  // Upstream's generated declaration incorrectly narrows this runtime getter to null.
  findController: Omit<PDFFindController, "state"> & { state: { highlightAll: boolean } | null };
  textDivs: Node[] | null;
  _convertMatches: (offsets: number[], lengths: number[]) => TextMatch[];
  _updateMatches: (reset?: boolean) => void;
}

/** Resolves a PDF text-item offset without replacing text nodes or changing the user's selection. */
function textPoint(root: Node, offset: number): [Node, number] {
  if (root.nodeType === Node.TEXT_NODE) return [root, offset];
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const length = node.textContent!.length;
    if (offset <= length) return [node, offset];
    offset -= length;
  }
  return [root, root.childNodes.length];
}

/** Paints find hits using selection geometry instead of inline backgrounds with different font boxes.
 * PDF.js still owns extraction, normalization, match conversion, navigation, and page caching.
 * Recheck this internal highlighter seam when upgrading the pinned PDF.js dependency.
 */
export function installPdfSearchHighlights(bus: EventBus, viewer: PDFViewer, signal: AbortSignal): void {
  const cleanups: (() => void)[] = [];
  bus.on("pagesinit", () => {
    for (let index = 0; index < viewer.pagesCount; index++) {
      const page = viewer.getPageView(index) as { div: HTMLDivElement; _textHighlighter: PageHighlighter };
      const highlighter = page._textHighlighter;
      const original = highlighter._updateMatches;
      let overlay: HTMLDivElement | undefined;
      /** Hiding, evicting, clearing, or disposing a page must leave no stale rectangles. */
      const clear = () => { overlay?.remove(); overlay = undefined; };
      /** Upstream enable/disable and find events call this painter after assigning the text mapping. */
      highlighter._updateMatches = (reset = false) => {
        clear();
        const { findController: find, textDivs, pageIdx } = highlighter;
        if (signal.aborted || reset || !highlighter.enabled || !find.highlightMatches || !textDivs?.length) return;
        const { selected, state } = find;
        if (!selected || !state) return;
        const selectedPage = selected.pageIdx === pageIdx;
        if (!state.highlightAll && !selectedPage) return;
        const matches = highlighter._convertMatches(find.pageMatches?.[pageIdx] ?? [], find.pageMatchesLength?.[pageIdx] ?? []);
        if (!matches.length || !page.div.isConnected) return;
        const document = page.div.ownerDocument;
        overlay = document.createElement("div");
        overlay.className = "pdf-search-highlights";
        overlay.setAttribute("aria-hidden", "true");
        (page.div.querySelector(".canvasWrapper") ?? page.div).append(overlay);
        // Match DrawLayer's selection transform: source coordinates belong to the text
        // layer, while the overlay is painted in the canvas wrapper's coordinate space.
        // Their sizes can differ (e.g. global border-box sizing plus PDF page borders).
        const bounds = page.div.querySelector(".textLayer")?.getBoundingClientRect();
        if (!bounds?.width || !bounds.height) { clear(); return; }
        let selectedElement: HTMLDivElement | undefined;
        for (let matchIndex = 0; matchIndex < matches.length; matchIndex++) {
          const isSelected = selectedPage && matchIndex === selected.matchIdx;
          if (!state.highlightAll && !isSelected) continue;
          const { begin, end } = matches[matchIndex];
          const range = document.createRange();
          range.setStart(...textPoint(textDivs[begin.divIdx], begin.offset));
          range.setEnd(...textPoint(textDivs[end.divIdx], end.offset));
          const seen = new Set<string>();
          for (const rect of range.getClientRects()) {
            if (rect.width <= 0 || rect.height <= 0) continue;
            const key = `${rect.x},${rect.y},${rect.width},${rect.height}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const box = document.createElement("div");
            box.className = `pdf-search-highlight${isSelected ? " is-selected" : ""}`;
            box.dataset.matchIndex = String(matchIndex);
            // Viewport CSS pixels already include zoom, rotation, and device scaling.
            box.style.left = `${100 * (rect.x - bounds.x) / bounds.width}%`;
            box.style.top = `${100 * (rect.y - bounds.y) / bounds.height}%`;
            box.style.width = `${100 * rect.width / bounds.width}%`;
            box.style.height = `${100 * rect.height / bounds.height}%`;
            overlay.append(box);
            if (isSelected) selectedElement ??= box;
          }
        }
        if (selectedElement) find.scrollMatchIntoView({ element: selectedElement, pageIndex: pageIdx, matchIndex: selected.matchIdx });
      };
      cleanups.push(() => { clear(); highlighter._updateMatches = original; });
    }
  }, { signal });
  // A reused text layer can change geometry without rebuilding its text mapping.
  bus.on("textlayerrendered", (event: { pageNumber: number; error?: unknown }) => {
    if (!event.error) {
      const page = viewer.getPageView(event.pageNumber - 1) as unknown as { _textHighlighter: PageHighlighter };
      page._textHighlighter._updateMatches();
    }
  }, { signal });
  signal.addEventListener("abort", () => { for (const cleanup of cleanups) cleanup(); cleanups.length = 0; }, { once: true });
}
