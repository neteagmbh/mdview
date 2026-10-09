// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  applyLightModeExportColors,
  buildLightModeClipboardHtml,
  prepareLightModePrint,
} from "./clipboard-styles";

describe("applyLightModeExportColors", () => {
  /** Verifies print colors are light and prior inline colors are restored afterwards. */
  it("applies and restores export colors", () => {
    const element = document.createElement("article");
    element.style.color = "rgb(240, 240, 240)";
    element.style.backgroundColor = "rgb(20, 20, 20)";

    const restore = applyLightModeExportColors(element);

    expect(element.style.color).toBe("rgb(32, 33, 36)");
    expect(element.style.backgroundColor).toBe("rgb(255, 255, 255)");

    restore();
    expect(element.style.color).toBe("rgb(240, 240, 240)");
    expect(element.style.backgroundColor).toBe("rgb(20, 20, 20)");
  });
});

describe("prepareLightModePrint", () => {
  /** Print preparation keeps dark screen colors and the original interactive SVG intact. */
  it("adds light print images without changing screen colors or Mermaid diagrams", () => {
    const root = document.createElement("article");
    root.style.color = "white";
    root.style.backgroundColor = "black";
    root.innerHTML =
      '<div class="mermaid-diagram" data-clipboard-png="data:image/png;base64,fake">' +
      "<svg><text>diagram</text></svg></div>";

    const originalSvg = root.querySelector("svg");
    const originalStyle = root.getAttribute("style");
    const restore = prepareLightModePrint(root);

    expect(root.getAttribute("style")).toBe(originalStyle);
    expect(root.querySelector("svg")).toBe(originalSvg);
    expect(root.querySelector("img")?.src).toBe("data:image/png;base64,fake");
    expect(root.querySelector("img")?.className).toBe("mermaid-print-image");
    expect(root.querySelector("img")?.getAttribute("aria-hidden")).toBe("true");
    expect(originalSvg?.previousElementSibling).toBe(root.querySelector("img"));

    restore();
    expect(root.style.color).toBe("white");
    expect(root.style.backgroundColor).toBe("black");
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("svg")).toBe(originalSvg);
    expect(root.querySelector(".mermaid-diagram svg")?.textContent).toBe("diagram");
  });

  /** Closing one print dialog must leave the next attempt with a single export image. */
  it("supports repeated preparation and cleanup without duplicating images", () => {
    const root = document.createElement("article");
    root.innerHTML =
      '<div class="mermaid-diagram" data-clipboard-png="data:image/png;base64,fake">' +
      "<svg></svg></div>";
    const original = root.innerHTML;

    for (let attempt = 0; attempt < 2; attempt++) {
      const restore = prepareLightModePrint(root);
      expect(root.querySelectorAll(".mermaid-print-image")).toHaveLength(1);
      restore();
      restore();
      expect(root.innerHTML).toBe(original);
    }
  });
});

describe("buildLightModeClipboardHtml", () => {
  /** Hidden print assets must not duplicate Mermaid diagrams in the clipboard payload. */
  it("excludes temporary print images from copied content", () => {
    const container = document.createElement("article");
    container.innerHTML =
      '<div class="mermaid-diagram" data-clipboard-png="data:image/png;base64,fake">' +
      "<svg></svg></div>";
    document.body.append(container);
    const restore = prepareLightModePrint(container);
    const range = document.createRange();
    range.selectNodeContents(container);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const html = buildLightModeClipboardHtml(selection)!;

    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).not.toContain("mermaid-print-image");
    expect(container.querySelector(".mermaid-print-image")).not.toBeNull();
    restore();
  });

  /** Verifies copied content carries explicit light-mode colors instead of the app theme. */
  it("wraps the selected content in explicit light-mode colors", () => {
    const container = document.createElement("article");
    container.innerHTML = "<p>Hello <strong>world</strong></p>";
    document.body.append(container);

    const range = document.createRange();
    range.selectNodeContents(container);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const html = buildLightModeClipboardHtml(selection);

    expect(html).toContain("color");
    expect(html).toContain("background-color");
    expect(html).toContain("<strong>world</strong>");
  });

  /** Verifies a copied Mermaid diagram is embedded as its pre-rendered PNG instead of raw SVG. */
  it("replaces a copied Mermaid diagram with its cached PNG image", () => {
    const container = document.createElement("article");
    container.innerHTML =
      '<p>Before</p><div class="mermaid-diagram" data-clipboard-png="data:image/png;base64,fake">' +
      "<svg><text>diagram</text></svg></div>";
    document.body.append(container);

    const range = document.createRange();
    range.selectNodeContents(container);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const html = buildLightModeClipboardHtml(selection);

    expect(html).not.toContain("<svg");
    expect(html).toContain('<img src="data:image/png;base64,fake" alt="Mermaid diagram">');
  });

  /** Verifies a collapsed or empty selection produces no clipboard override. */
  it("returns null when nothing is selected", () => {
    const selection = window.getSelection()!;
    selection.removeAllRanges();

    expect(buildLightModeClipboardHtml(selection)).toBeNull();
  });
});
