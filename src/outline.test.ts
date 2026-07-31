// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { buildHeadingOutline, scrollHeadingIntoView } from "./outline";

describe("buildHeadingOutline", () => {
  /** Verifies slug normalization, duplicate IDs, levels, and empty headings. */
  it("creates unique anchors and preserves heading levels", () => {
    const root = document.createElement("article");
    root.innerHTML = `
      <h1>Überblick</h1>
      <h2>Install &amp; Run</h2>
      <h2>Install &amp; Run</h2>
      <h3></h3>
    `;

    const outline = buildHeadingOutline(root);

    expect(outline.map(({ id, level, text }) => ({ id, level, text }))).toEqual([
      { id: "uberblick", level: 1, text: "Überblick" },
      { id: "install-run", level: 2, text: "Install & Run" },
      { id: "install-run-2", level: 2, text: "Install & Run" },
      { id: "untitled-section", level: 3, text: "Untitled section" },
    ]);
    expect(outline.map(({ element }) => element.id)).toEqual([
      "uberblick",
      "install-run",
      "install-run-2",
      "untitled-section",
    ]);
  });
});

describe("scrollHeadingIntoView", () => {
  /** Verifies smooth top alignment for outline navigation. */
  it("aligns the chosen heading with the top of the viewport", () => {
    const heading = document.createElement("h2");
    heading.scrollIntoView = vi.fn();

    scrollHeadingIntoView(heading);

    expect(heading.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });
});
