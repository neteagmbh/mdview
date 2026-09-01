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
  /** Verifies live diagrams use their light PNG for printing and are restored afterwards. */
  it("prepares and restores document colors and Mermaid diagrams", () => {
    const root = document.createElement("article");
    root.style.color = "white";
    root.style.backgroundColor = "black";
    root.innerHTML =
      '<div class="mermaid-diagram" data-clipboard-png="data:image/png;base64,fake">' +
      "<svg><text>diagram</text></svg></div>";

    const restore = prepareLightModePrint(root);

    expect(root.style.color).toBe("rgb(32, 33, 36)");
    expect(root.querySelector("svg")).toBeNull();
    expect(root.querySelector("img")?.src).toBe("data:image/png;base64,fake");

    restore();
    expect(root.style.color).toBe("white");
    expect(root.style.backgroundColor).toBe("black");
    expect(root.querySelector(".mermaid-diagram svg")?.textContent).toBe("diagram");
  });
});

describe("buildLightModeClipboardHtml", () => {
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
