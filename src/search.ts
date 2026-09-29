/**
 * In-document and cross-folder Markdown search.
 *
 * The in-file search operates directly on the rendered `#markdown` DOM, wrapping matches in
 * `<mark>` elements so they can be highlighted and navigated. Directory/all-folder searches are
 * delegated to the native backend, which reads files on demand without caching (see the NT-8
 * plan) so results always reflect the current on-disk content.
 */

/** CSS class applied to every in-file search match. */
export const SEARCH_HIT_CLASS = "search-hit";
/** CSS class applied to the currently focused in-file search match. */
export const SEARCH_HIT_CURRENT_CLASS = "search-hit-current";

/** Search scope selected in the search bar. */
export type SearchScope = "file" | "directory" | "all";

/** A single matched line within a Markdown file, returned by the backend. */
export interface DirectorySearchMatch {
  line: number;
  column: number;
  lineText: string;
}

/** All matches found in a single Markdown file by the backend search. */
export interface FileSearchResult {
  name: string;
  path: string;
  matches: DirectorySearchMatch[];
}

/** Removes all in-file search highlights, restoring the original text nodes. */
export function clearFileSearchHighlights(root: HTMLElement): void {
  const marks = root.querySelectorAll<HTMLElement>(`mark.${SEARCH_HIT_CLASS}`);
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) {
      return;
    }
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    parent.removeChild(mark);
    parent.normalize();
  });
}

/** Highlights every case-insensitive occurrence of `query` and returns the match elements. */
export function highlightFileMatches(root: HTMLElement, query: string): HTMLElement[] {
  clearFileSearchHighlights(root);
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    textNodes.push(node as Text);
  }

  const marks: HTMLElement[] = [];
  for (const textNode of textNodes) {
    const text = textNode.nodeValue ?? "";
    const lower = text.toLowerCase();
    if (!lower.includes(needle)) {
      continue;
    }

    const fragment = document.createDocumentFragment();
    let index = 0;
    let matchIndex = lower.indexOf(needle, index);
    while (matchIndex !== -1) {
      if (matchIndex > index) {
        fragment.append(document.createTextNode(text.slice(index, matchIndex)));
      }
      const mark = document.createElement("mark");
      mark.className = SEARCH_HIT_CLASS;
      mark.textContent = text.slice(matchIndex, matchIndex + needle.length);
      fragment.append(mark);
      marks.push(mark);
      index = matchIndex + needle.length;
      matchIndex = lower.indexOf(needle, index);
    }
    if (index < text.length) {
      fragment.append(document.createTextNode(text.slice(index)));
    }
    textNode.parentNode?.replaceChild(fragment, textNode);
  }

  return marks;
}

/** Wraps a match index into range, returning -1 when there are no matches. */
export function stepMatchIndex(current: number, delta: number, count: number): number {
  if (count === 0) {
    return -1;
  }
  return (((current + delta) % count) + count) % count;
}

/** Marks a single match as current and returns it, clearing the previous current marker. */
export function setCurrentMatch(
  matches: HTMLElement[],
  index: number,
): HTMLElement | null {
  matches.forEach((match) => match.classList.remove(SEARCH_HIT_CURRENT_CLASS));
  if (index < 0 || index >= matches.length) {
    return null;
  }
  const current = matches[index];
  current.classList.add(SEARCH_HIT_CURRENT_CLASS);
  return current;
}

/** Formats the "current of total" counter shown next to the search input. */
export function formatMatchCount(current: number, total: number): string {
  if (total === 0) {
    return "No results";
  }
  return `${current + 1} of ${total}`;
}

/** Renders backend search results into a list, invoking `onSelect` when a match is chosen. */
export function renderSearchResults(
  container: HTMLElement,
  results: FileSearchResult[],
  onSelect: (result: FileSearchResult, match: DirectorySearchMatch) => void,
): void {
  container.replaceChildren();

  if (results.length === 0) {
    const empty = document.createElement("p");
    empty.className = "search-results-empty";
    empty.textContent = "No matches found.";
    container.append(empty);
    return;
  }

  results.forEach((result) => {
    const group = document.createElement("div");
    group.className = "search-result-group";

    const heading = document.createElement("p");
    heading.className = "search-result-file";
    heading.textContent = result.name;
    heading.title = result.path;
    group.append(heading);

    result.matches.forEach((match) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "search-result-line";
      item.title = result.path;

      const location = document.createElement("span");
      location.className = "search-result-location";
      location.textContent = `L${match.line}`;

      const snippet = document.createElement("span");
      snippet.className = "search-result-snippet";
      snippet.textContent = match.lineText.trim();

      item.append(location, snippet);
      item.addEventListener("click", () => onSelect(result, match));
      group.append(item);
    });

    container.append(group);
  });
}

/** Block-level elements used to derive a one-line snippet around an in-file match. */
const SNIPPET_BLOCK_SELECTOR =
  "p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, pre, blockquote";

/** Returns the surrounding block text of an in-file match, collapsed to one line. */
function matchSnippet(mark: HTMLElement): string {
  const block = mark.closest<HTMLElement>(SNIPPET_BLOCK_SELECTOR) ?? mark.parentElement;
  return (block?.textContent ?? mark.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Renders in-file match snippets into the results list, selecting a match on click. */
export function renderFileMatchList(
  container: HTMLElement,
  matches: HTMLElement[],
  onSelect: (index: number) => void,
): void {
  container.replaceChildren();

  if (matches.length === 0) {
    const empty = document.createElement("p");
    empty.className = "search-results-empty";
    empty.textContent = "No matches found.";
    container.append(empty);
    return;
  }

  const group = document.createElement("div");
  group.className = "search-result-group";
  matches.forEach((mark, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "search-result-line";

    const location = document.createElement("span");
    location.className = "search-result-location";
    location.textContent = String(index + 1);

    const snippet = document.createElement("span");
    snippet.className = "search-result-snippet";
    snippet.textContent = matchSnippet(mark);

    item.append(location, snippet);
    item.addEventListener("click", () => onSelect(index));
    group.append(item);
  });
  container.append(group);
}

/** DOM elements and callbacks required to drive the search bar. */
export interface SearchControllerOptions {
  bar: HTMLElement;
  input: HTMLInputElement;
  scopeSelect: HTMLSelectElement;
  countLabel: HTMLElement;
  previousButton: HTMLButtonElement;
  nextButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  results: HTMLElement;
  getContentRoot: () => HTMLElement;
  searchFiles: (query: string, scope: SearchScope) => Promise<FileSearchResult[]>;
  openResult: (path: string) => Promise<void>;
  /** Invoked whenever the search session opens or closes, e.g. to reveal a sidebar tab. */
  onOpenChange?: (open: boolean) => void;
}

/** Imperative handle for opening and closing the search bar from outside the module. */
export interface SearchController {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  /** Re-applies the active query to the current document, e.g. after rendering a new one. */
  refreshHighlights(): void;
}

/** Wires the search bar UI to in-file highlighting and backend directory search. */
export function createSearchController(options: SearchControllerOptions): SearchController {
  const {
    bar,
    input,
    scopeSelect,
    countLabel,
    previousButton,
    nextButton,
    closeButton,
    results,
    getContentRoot,
    searchFiles,
    openResult,
    onOpenChange,
  } = options;

  let matches: HTMLElement[] = [];
  let currentIndex = -1;

  /** Returns the scope currently selected in the dropdown. */
  function currentScope(): SearchScope {
    return scopeSelect.value as SearchScope;
  }

  /** Reflects the number of in-file matches in the counter and navigation buttons. */
  function updateFileNavigation(): void {
    countLabel.textContent = formatMatchCount(currentIndex, matches.length);
    const disabled = matches.length === 0;
    previousButton.disabled = disabled;
    nextButton.disabled = disabled;
  }

  /** Scrolls the current match into view. */
  function revealCurrent(): void {
    const current = setCurrentMatch(matches, currentIndex);
    current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /** Renders the in-file match list, wiring each entry to select and reveal its match. */
  function renderCurrentFileMatches(): void {
    renderFileMatchList(results, matches, (index) => {
      currentIndex = index;
      updateFileNavigation();
      revealCurrent();
    });
    results.hidden = false;
  }

  /** Re-highlights the active document, lists the matches, and focuses the first one. */
  function runFileSearch(): void {
    matches = highlightFileMatches(getContentRoot(), input.value);
    currentIndex = matches.length > 0 ? 0 : -1;
    renderCurrentFileMatches();
    updateFileNavigation();
    if (currentIndex >= 0) {
      revealCurrent();
    }
  }

  /** Advances the in-file selection by `delta`, wrapping around the ends. */
  function moveSelection(delta: number): void {
    if (matches.length === 0) {
      return;
    }
    currentIndex = stepMatchIndex(currentIndex, delta, matches.length);
    updateFileNavigation();
    revealCurrent();
  }

  /**
   * Re-applies in-file highlighting to the currently shown document while a
   * search is active, keeping the match list in sync for the file scope.
   */
  function refreshHighlights(): void {
    if (bar.hidden || !input.value.trim()) {
      return;
    }
    matches = highlightFileMatches(getContentRoot(), input.value);
    currentIndex = matches.length > 0 ? 0 : -1;
    if (currentScope() === "file") {
      renderCurrentFileMatches();
    }
    updateFileNavigation();
  }

  /** Runs a backend search and renders its results. */
  async function runDirectorySearch(): Promise<void> {
    clearFileSearchHighlights(getContentRoot());
    matches = [];
    currentIndex = -1;
    updateFileNavigation();

    const found = await searchFiles(input.value, currentScope());
    renderSearchResults(results, found, (result, match) => {
      const matchIndex = Math.max(0, result.matches.indexOf(match));
      void openResult(result.path).then(() => {
        refreshHighlights();
        if (matches.length > 0) {
          currentIndex = Math.min(matchIndex, matches.length - 1);
          updateFileNavigation();
          revealCurrent();
        }
      });
    });
    results.hidden = false;
  }

  /** Dispatches the search according to the active scope. */
  function runSearch(): void {
    if (!input.value.trim()) {
      clearFileSearchHighlights(getContentRoot());
      matches = [];
      currentIndex = -1;
      results.hidden = true;
      results.replaceChildren();
      updateFileNavigation();
      return;
    }
    if (currentScope() === "file") {
      runFileSearch();
    } else {
      void runDirectorySearch();
    }
  }

  function open(): void {
    bar.hidden = false;
    onOpenChange?.(true);
    input.focus();
    input.select();
  }

  function close(): void {
    bar.hidden = true;
    results.hidden = true;
    results.replaceChildren();
    clearFileSearchHighlights(getContentRoot());
    matches = [];
    currentIndex = -1;
    updateFileNavigation();
    onOpenChange?.(false);
  }

  function toggle(): void {
    if (bar.hidden) {
      open();
    } else {
      close();
    }
  }

  input.addEventListener("input", runSearch);
  scopeSelect.addEventListener("change", runSearch);
  previousButton.addEventListener("click", () => moveSelection(-1));
  nextButton.addEventListener("click", () => moveSelection(1));
  closeButton.addEventListener("click", close);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (currentScope() === "file" && matches.length > 0) {
        moveSelection(event.shiftKey ? -1 : 1);
      } else {
        runSearch();
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });

  updateFileNavigation();

  return { open, close, toggle, isOpen: () => !bar.hidden, refreshHighlights };
}
