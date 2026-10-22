/** A safe, flattened bookmark item; destinations stay opaque to the shell. */
export interface PdfBookmark {
  /** User-visible title and nesting depth. */
  title: string;
  depth: number;
  /** Runs through the restricted PDF link service. */
  open: () => void;
}
/** Upstream outline item fields used by the read-only bookmark adapter. */
export interface OutlineItem {
  title: string;
  dest?: string | unknown[] | null;
  url?: string | null;
  items: OutlineItem[];
}
/** Flattens nested bookmarks with bounded depth/count and preserves internal and safe external links. */
export function pdfBookmarks(items: OutlineItem[] | null, navigate: (dest: string | unknown[]) => void,
  external: (url: string) => void): PdfBookmark[] {
  const result: PdfBookmark[] = [];
  /** Bounds traversal of untrusted outline trees without inserting document-provided HTML. */
  function visit(entries: OutlineItem[], depth: number): void {
    if (depth > 32) return;
    for (const item of entries) {
      if (result.length >= 2000) return;
      result.push({ title: item.title || "Untitled bookmark", depth,
        open: () => { if (item.dest) navigate(item.dest); else if (item.url) external(item.url); } });
      visit(item.items ?? [], depth + 1);
    }
  }
  visit(items ?? [], 0);
  return result;
}

/** Renders bookmarks into the existing outline sidebar using text nodes and keyboard-accessible buttons. */
export function renderPdfBookmarks(nav: HTMLElement, status: HTMLElement, bookmarks: PdfBookmark[]): void {
  nav.replaceChildren();
  status.textContent = "No bookmarks";
  status.hidden = bookmarks.length > 0;
  for (const bookmark of bookmarks) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "outline-link";
    button.textContent = bookmark.title; button.title = bookmark.title;
    button.style.setProperty("--outline-indent", `${Math.min(bookmark.depth, 8) * 0.7}rem`);
    button.addEventListener("click", bookmark.open);
    nav.append(button);
  }
}
