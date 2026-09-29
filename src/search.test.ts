// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  clearFileSearchHighlights,
  createSearchController,
  formatMatchCount,
  highlightFileMatches,
  renderFileMatchList,
  renderSearchResults,
  SEARCH_HIT_CLASS,
  SEARCH_HIT_CURRENT_CLASS,
  setCurrentMatch,
  stepMatchIndex,
  type FileSearchResult,
} from "./search";

/** Builds a content root populated with HTML for highlighting tests. */
function contentRoot(html: string): HTMLElement {
  const root = document.createElement("article");
  root.innerHTML = html;
  return root;
}

describe("highlightFileMatches", () => {
  /** Verifies case-insensitive matches across separate text nodes are wrapped. */
  it("wraps every case-insensitive occurrence in a mark", () => {
    const root = contentRoot("<p>Alpha beta alpha</p><p>Gamma ALPHA</p>");

    const marks = highlightFileMatches(root, "alpha");

    expect(marks).toHaveLength(3);
    expect(marks.every((mark) => mark.classList.contains(SEARCH_HIT_CLASS))).toBe(true);
    expect(root.querySelectorAll(`mark.${SEARCH_HIT_CLASS}`)).toHaveLength(3);
    expect(marks.map((mark) => mark.textContent)).toEqual(["Alpha", "alpha", "ALPHA"]);
  });

  /** Verifies a blank query clears highlights and reports no matches. */
  it("returns no matches for a blank query", () => {
    const root = contentRoot("<p>Alpha</p>");

    highlightFileMatches(root, "alpha");
    const marks = highlightFileMatches(root, "   ");

    expect(marks).toHaveLength(0);
    expect(root.querySelectorAll(`mark.${SEARCH_HIT_CLASS}`)).toHaveLength(0);
  });

  /** Verifies re-highlighting replaces the previous matches instead of nesting them. */
  it("replaces previous highlights on each run", () => {
    const root = contentRoot("<p>one two one</p>");

    highlightFileMatches(root, "one");
    const marks = highlightFileMatches(root, "two");

    expect(marks).toHaveLength(1);
    expect(root.querySelectorAll(`mark.${SEARCH_HIT_CLASS}`)).toHaveLength(1);
    expect(root.textContent).toBe("one two one");
  });
});

describe("clearFileSearchHighlights", () => {
  /** Verifies clearing restores the original text content. */
  it("restores the original text nodes", () => {
    const root = contentRoot("<p>Alpha beta alpha</p>");
    highlightFileMatches(root, "alpha");

    clearFileSearchHighlights(root);

    expect(root.querySelectorAll(`mark.${SEARCH_HIT_CLASS}`)).toHaveLength(0);
    expect(root.querySelector("p")?.childNodes).toHaveLength(1);
    expect(root.textContent).toBe("Alpha beta alpha");
  });
});

describe("stepMatchIndex", () => {
  /** Verifies wrapping in both directions and the empty-set sentinel. */
  it("wraps around the ends and returns -1 when empty", () => {
    expect(stepMatchIndex(0, 1, 3)).toBe(1);
    expect(stepMatchIndex(2, 1, 3)).toBe(0);
    expect(stepMatchIndex(0, -1, 3)).toBe(2);
    expect(stepMatchIndex(-1, 1, 0)).toBe(-1);
  });
});

describe("setCurrentMatch", () => {
  /** Verifies only the selected match carries the current marker. */
  it("marks a single current match", () => {
    const root = contentRoot("<p>hit hit hit</p>");
    const marks = highlightFileMatches(root, "hit");

    const current = setCurrentMatch(marks, 1);

    expect(current).toBe(marks[1]);
    expect(marks[1].classList.contains(SEARCH_HIT_CURRENT_CLASS)).toBe(true);
    expect(marks[0].classList.contains(SEARCH_HIT_CURRENT_CLASS)).toBe(false);

    setCurrentMatch(marks, 0);
    expect(marks[1].classList.contains(SEARCH_HIT_CURRENT_CLASS)).toBe(false);
    expect(marks[0].classList.contains(SEARCH_HIT_CURRENT_CLASS)).toBe(true);
  });

  /** Verifies an out-of-range index clears the marker and returns null. */
  it("returns null for an out-of-range index", () => {
    const root = contentRoot("<p>hit</p>");
    const marks = highlightFileMatches(root, "hit");

    expect(setCurrentMatch(marks, -1)).toBeNull();
    expect(marks[0].classList.contains(SEARCH_HIT_CURRENT_CLASS)).toBe(false);
  });
});

describe("formatMatchCount", () => {
  /** Verifies the human-readable counter and empty state. */
  it("formats the counter as one-based", () => {
    expect(formatMatchCount(0, 3)).toBe("1 of 3");
    expect(formatMatchCount(2, 3)).toBe("3 of 3");
    expect(formatMatchCount(-1, 0)).toBe("No results");
  });
});

describe("renderSearchResults", () => {
  /** Verifies grouped result rendering and selection callbacks. */
  it("renders grouped results and reports selections", () => {
    const container = document.createElement("div");
    const results: FileSearchResult[] = [
      {
        name: "notes.md",
        path: "/docs/notes.md",
        matches: [
          { line: 3, column: 1, lineText: "  first hit" },
          { line: 9, column: 5, lineText: "second hit" },
        ],
      },
    ];
    const onSelect = vi.fn();

    renderSearchResults(container, results, onSelect);

    expect(container.querySelectorAll(".search-result-file")).toHaveLength(1);
    const lines = container.querySelectorAll<HTMLButtonElement>(".search-result-line");
    expect(lines).toHaveLength(2);
    expect(lines[0].querySelector(".search-result-snippet")?.textContent).toBe("first hit");

    lines[1].click();
    expect(onSelect).toHaveBeenCalledWith(results[0], results[0].matches[1]);
  });

  /** Verifies the empty state message when no files match. */
  it("shows an empty state when there are no results", () => {
    const container = document.createElement("div");

    renderSearchResults(container, [], vi.fn());

    expect(container.querySelector(".search-results-empty")?.textContent).toBe(
      "No matches found.",
    );
  });
});

describe("renderFileMatchList", () => {
  /** Verifies in-file matches are listed with block snippets and one-based numbers. */
  it("renders numbered snippets and reports selections", () => {
    const root = contentRoot("<p>Alpha beta</p><li>gamma alpha</li>");
    const marks = highlightFileMatches(root, "alpha");
    const container = document.createElement("div");
    const onSelect = vi.fn();

    renderFileMatchList(container, marks, onSelect);

    const lines = container.querySelectorAll<HTMLButtonElement>(".search-result-line");
    expect(lines).toHaveLength(2);
    expect(lines[0].querySelector(".search-result-location")?.textContent).toBe("1");
    expect(lines[0].querySelector(".search-result-snippet")?.textContent).toBe("Alpha beta");
    expect(lines[1].querySelector(".search-result-snippet")?.textContent).toBe("gamma alpha");

    lines[1].click();
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  /** Verifies the empty state message when the document has no matches. */
  it("shows an empty state when there are no matches", () => {
    const container = document.createElement("div");

    renderFileMatchList(container, [], vi.fn());

    expect(container.querySelector(".search-results-empty")?.textContent).toBe(
      "No matches found.",
    );
  });
});

describe("createSearchController", () => {
  /** Builds a full search-bar DOM harness wired to an in-memory content root. */
  function harness(
    html: string,
    overrides: {
      searchFiles?: (query: string, scope: string) => Promise<FileSearchResult[]>;
      openResult?: (path: string) => Promise<void>;
    } = {},
  ) {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    const bar = document.createElement("div");
    const input = document.createElement("input");
    const scopeSelect = document.createElement("select");
    ["file", "directory", "all"].forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      scopeSelect.append(option);
    });
    scopeSelect.value = "file";
    const countLabel = document.createElement("span");
    const previousButton = document.createElement("button");
    const nextButton = document.createElement("button");
    const closeButton = document.createElement("button");
    const results = document.createElement("div");
    const content = contentRoot(html);
    const controller = createSearchController({
      bar,
      input,
      scopeSelect,
      countLabel,
      previousButton,
      nextButton,
      closeButton,
      results,
      getContentRoot: () => content,
      searchFiles: overrides.searchFiles ?? vi.fn().mockResolvedValue([]),
      openResult: overrides.openResult ?? vi.fn().mockResolvedValue(undefined),
    });
    return { bar, input, scopeSelect, countLabel, results, content, controller };
  }

  /** Verifies the file scope now lists its matches alongside the highlights. */
  it("shows the match list for an in-file search", () => {
    const { input, countLabel, results, content } = harness("<p>hit one</p><p>hit two</p>");

    input.value = "hit";
    input.dispatchEvent(new Event("input"));

    expect(results.hidden).toBe(false);
    const lines = results.querySelectorAll<HTMLButtonElement>(".search-result-line");
    expect(lines).toHaveLength(2);
    expect(countLabel.textContent).toBe("1 of 2");

    lines[1].click();
    expect(countLabel.textContent).toBe("2 of 2");
    const marks = content.querySelectorAll(`mark.${SEARCH_HIT_CLASS}`);
    expect(marks[1].classList.contains(SEARCH_HIT_CURRENT_CLASS)).toBe(true);
  });

  /** Verifies a newly rendered document is re-highlighted while the search is open. */
  it("re-highlights a replaced document via refreshHighlights", () => {
    const { input, countLabel, results, content, controller } = harness("<p>hit one</p>");

    input.value = "hit";
    input.dispatchEvent(new Event("input"));
    expect(content.querySelectorAll(`mark.${SEARCH_HIT_CLASS}`)).toHaveLength(1);

    content.innerHTML = "<p>hit alpha</p><p>hit beta</p>";
    controller.refreshHighlights();

    expect(content.querySelectorAll(`mark.${SEARCH_HIT_CLASS}`)).toHaveLength(2);
    expect(results.querySelectorAll(".search-result-line")).toHaveLength(2);
    expect(countLabel.textContent).toBe("1 of 2");
  });

  /** Verifies refreshHighlights is inert while the search bar is hidden. */
  it("does nothing when the search bar is hidden", () => {
    const { bar, input, content, controller } = harness("<p>hit</p>");

    input.value = "hit";
    bar.hidden = true;
    controller.refreshHighlights();

    expect(content.querySelectorAll(`mark.${SEARCH_HIT_CLASS}`)).toHaveLength(0);
  });

  /** Verifies clicking a directory result opens the file and reveals the clicked match. */
  it("scrolls to the clicked match of a directory result", async () => {
    const fileResult: FileSearchResult = {
      name: "notes.md",
      path: "/docs/notes.md",
      matches: [
        { line: 1, column: 1, lineText: "hit alpha" },
        { line: 2, column: 1, lineText: "hit beta" },
      ],
    };
    const openResult = vi.fn().mockResolvedValue(undefined);
    const { input, scopeSelect, countLabel, results, content } = harness(
      "<p>hit alpha</p><p>hit beta</p>",
      { searchFiles: vi.fn().mockResolvedValue([fileResult]), openResult },
    );

    scopeSelect.value = "all";
    input.value = "hit";
    input.dispatchEvent(new Event("input"));
    await vi.waitFor(() => {
      expect(results.querySelectorAll(".search-result-line")).toHaveLength(2);
    });

    results.querySelectorAll<HTMLButtonElement>(".search-result-line")[1].click();
    await vi.waitFor(() => {
      expect(countLabel.textContent).toBe("2 of 2");
    });

    expect(openResult).toHaveBeenCalledWith("/docs/notes.md");
    const marks = content.querySelectorAll(`mark.${SEARCH_HIT_CLASS}`);
    expect(marks).toHaveLength(2);
    expect(marks[1].classList.contains(SEARCH_HIT_CURRENT_CLASS)).toBe(true);
    expect(marks[1].scrollIntoView).toHaveBeenCalled();
  });
});
