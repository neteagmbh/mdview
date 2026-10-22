// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { pdfBookmarks, renderPdfBookmarks } from "./pdf-outline";

/** Nested destinations use the existing restricted navigation callbacks and plain text labels. */
it("renders nested PDF bookmarks safely and navigates their destinations", () => {
  const navigate = vi.fn(), external = vi.fn();
  const bookmarks = pdfBookmarks([{ title: "<img onerror=bad>", dest: "chapter", items: [
    { title: "Nested", dest: [2, { name: "Fit" }], items: [] },
    { title: "Web", url: "https://example.com/", items: [] },
  ] }], navigate, external);
  const nav = document.createElement("nav"), status = document.createElement("p");
  renderPdfBookmarks(nav, status, bookmarks);
  expect(nav.querySelector("img")).toBeNull();
  expect(bookmarks.map(b => b.depth)).toEqual([0, 1, 1]);
  const buttons = nav.querySelectorAll("button");
  buttons[0].click(); buttons[1].click(); buttons[2].click();
  expect(navigate).toHaveBeenCalledWith("chapter");
  expect(navigate).toHaveBeenCalledWith([2, { name: "Fit" }]);
  expect(external).toHaveBeenCalledWith("https://example.com/");
  expect(status.hidden).toBe(true);
});

/** PDFs without embedded bookmarks remain valid documents. */
it("shows No bookmarks for an empty outline", () => {
  const nav = document.createElement("nav"), status = document.createElement("p");
  renderPdfBookmarks(nav, status, pdfBookmarks(null, vi.fn(), vi.fn()));
  expect(status.textContent).toBe("No bookmarks");
  expect(status.hidden).toBe(false);
});
