// @vitest-environment jsdom
import { expect, it } from "vitest";
import html from "../index.html?raw";
import { readFileSync } from "node:fs";

// Vitest stubs CSS imports, including ?raw; read actual rules for regression coverage.
const styles = readFileSync("src/styles.css", "utf8");

/** PDF.js's generic sidebar rules must not constrain the application's grid item. */
it("isolates the resizable file tree from PDF.js sidebar styles", () => {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const sidebar = document.importNode(parsed.querySelector("#sidebar")!, true);
  const style = document.createElement("style");
  // Model the conflicting vendor rules after app CSS to cover either load order.
  style.textContent = `${styles}\n.sidebar { width: 239px; min-width: 180px; max-width: 632px; position: relative; }`;
  document.head.append(style);
  document.body.append(sidebar);
  try {
    expect(sidebar.classList.contains("app-sidebar")).toBe(true);
    const computed = getComputedStyle(sidebar);
    expect(computed.position).not.toBe("relative");
    expect(computed.width).not.toBe("239px");
    expect(computed.maxWidth).not.toBe("632px");
  } finally {
    sidebar.remove();
    style.remove();
  }
});

/** Wide-layout bookmark columns must use app-owned widths, not PDF.js's inherited 2px stroke. */
it.each([".app-shell", ".app-shell.sidebar-closed"])(
  "isolates the bookmark column width from PDF.js in %s", (selector) => {
    // Check the initial screen rule; jsdom does not compute responsive grid geometry.
    const start = styles.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    const rule = styles.slice(start).split("}")[0];
    expect(rule).toContain("var(--mdview-outline-width, 240px)");
    expect(styles).not.toMatch(/var\(--(?:outline|sidebar)-width\b/);
  },
);
