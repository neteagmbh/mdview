// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/** Creates actual PDF layout rules without Vitest's stubbed CSS imports. */
function fixture() {
  const style = document.createElement("style");
  style.textContent = readFileSync("src/pdf-viewer.css", "utf8");
  const region = document.createElement("section");
  region.id = "pdf-region";
  region.innerHTML = '<div id="pdf-controls">Page 1 of 60</div><div id="pdf-container"></div>';
  document.head.append(style);
  document.body.append(region);
  return { region, container: region.querySelector<HTMLElement>("#pdf-container")!,
    cleanup: () => { region.remove(); style.remove(); } };
}

/** Keeps the variable-height toolbar out of the page scroller's height budget. */
it("allocates a toolbar row and only the remaining row to the absolute PDF.js container", () => {
  const { region, container, cleanup } = fixture();
  try {
    expect(getComputedStyle(region).display).toBe("grid");
    expect(getComputedStyle(region).gridTemplateRows).toBe("auto minmax(0, 1fr)");
    const computed = getComputedStyle(container);
    expect(computed.position).toBe("absolute");
    expect(computed.gridRow).toBe("2 / 3");
    expect(computed.inset).toBe("0px");
    expect(computed.overflow).toBe("auto");
  } finally { cleanup(); }
});

/** A grid display declaration must not reveal the PDF region when Markdown is active. */
it("keeps an inactive PDF region hidden", () => {
  const { region, cleanup } = fixture();
  try {
    region.hidden = true;
    expect(getComputedStyle(region).display).toBe("none");
  } finally { cleanup(); }
});

/** All shell panes share the dynamic viewport budget, with an older-engine fallback. */
it("sizes the shell and panes from one dynamic viewport height", () => {
  const styles = readFileSync("src/styles.css", "utf8");
  expect(styles).toContain("--mdview-viewport-height: 100vh");
  expect(styles).toContain("@supports (height: 100dvh)");
  expect(styles).toContain("--mdview-viewport-height: 100dvh");
  expect(styles.match(/calc\(var\(--mdview-viewport-height\) - var\(--toolbar-height\)\)/g)).toHaveLength(4);
  expect(readFileSync("src/pdf-viewer.css", "utf8")).not.toContain("--pdf-controls-height");
});
