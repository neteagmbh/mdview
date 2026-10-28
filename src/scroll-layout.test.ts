// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it } from "vitest";

/** Actual shell styles keep these checks independent of Vitest's CSS import stubs. */
const styles = readFileSync("src/styles.css", "utf8");
/** PDF scrolling has a separate container and stylesheet. */
const pdfStyles = readFileSync("src/pdf-viewer.css", "utf8");

/** Mounts the real stylesheet cascade and independently scrollable shell panes. */
beforeEach(() => {
  document.head.innerHTML = "";
  const style = document.createElement("style");
  style.textContent = styles + pdfStyles;
  document.head.append(style);
  document.body.innerHTML = `
    <aside class="app-sidebar"></aside>
    <main class="content"></main>
    <aside class="outline-sidebar"></aside>
    <div id="pdf-container"></div>`;
});

/** Releases the shared DOM so other layout tests cannot inherit these rules. */
afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

/** Wheel gestures over chrome or exhausted panes must not move or bounce the root. */
it("locks the root viewport against scrolling and rubber banding", () => {
  for (const root of [document.documentElement, document.body]) {
    const computed = getComputedStyle(root);
    expect(computed.overflow).toBe("hidden");
    expect(computed.getPropertyValue("overscroll-behavior")).toBe("none");
  }
});

/** Content stays natively scrollable without handing boundary gestures to the root. */
it.each([".content", ".app-sidebar", ".outline-sidebar", "#pdf-container"])(
  "contains scrolling within %s", (selector) => {
    const computed = getComputedStyle(document.querySelector(selector)!);
    expect(computed.overflow).toBe("auto");
    expect(computed.getPropertyValue("overscroll-behavior")).toBe("none");
  },
);

/** Printing must release the viewport lock so documents can span multiple pages. */
it("restores unrestricted root layout for printing", () => {
  // jsdom does not emulate print media; apply the real print declarations last.
  const printStyle = document.createElement("style");
  printStyle.textContent = Array.from(document.styleSheets[0].cssRules)
    .filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule && rule.conditionText === "print")
    .flatMap((rule) => Array.from(rule.cssRules))
    .filter((rule) => rule instanceof CSSStyleRule)
    .map((rule) => rule.cssText)
    .join("\n");
  document.head.append(printStyle);
  for (const root of [document.documentElement, document.body]) {
    const computed = getComputedStyle(root);
    expect(computed.overflow).toBe("visible");
    expect(computed.height).toBe("auto");
    expect(computed.minHeight).toBe("0px");
  }
});
