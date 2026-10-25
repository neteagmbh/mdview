// @vitest-environment jsdom
import { expect, it } from "vitest";
import html from "../index.html?raw";
import styles from "./styles.css?raw";

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
