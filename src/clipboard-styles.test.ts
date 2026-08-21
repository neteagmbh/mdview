// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { buildLightModeClipboardHtml } from "./clipboard-styles";

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

  /** Verifies a collapsed or empty selection produces no clipboard override. */
  it("returns null when nothing is selected", () => {
    const selection = window.getSelection()!;
    selection.removeAllRanges();

    expect(buildLightModeClipboardHtml(selection)).toBeNull();
  });
});
