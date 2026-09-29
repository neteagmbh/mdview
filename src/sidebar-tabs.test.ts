// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { createSidebarTabs, type SidebarTabEntry } from "./sidebar-tabs";

/** Builds a tab button plus panel pair, optionally starting hidden. */
function entry(tabHidden = false, panelHidden = false): SidebarTabEntry {
  const tab = document.createElement("button");
  tab.hidden = tabHidden;
  const panel = document.createElement("section");
  panel.hidden = panelHidden;
  return { tab, panel };
}

describe("createSidebarTabs", () => {
  /** Verifies the initial tab is selected and its panel visible. */
  it("selects the initial tab and shows only its panel", () => {
    const folders = entry();
    const search = entry(true, true);
    createSidebarTabs({ folders, search }, "folders");

    expect(folders.tab.getAttribute("aria-selected")).toBe("true");
    expect(folders.panel.hidden).toBe(false);
    expect(search.tab.getAttribute("aria-selected")).toBe("false");
    expect(search.panel.hidden).toBe(true);
  });

  /** Verifies clicking a tab switches the visible panel. */
  it("switches panels when a tab is clicked", () => {
    const folders = entry();
    const search = entry();
    const controller = createSidebarTabs({ folders, search }, "folders");

    search.tab.click();

    expect(controller.selected()).toBe("search");
    expect(folders.panel.hidden).toBe(true);
    expect(search.panel.hidden).toBe(false);
  });

  /** Verifies reveal unhides a previously hidden tab and selects it. */
  it("reveals a hidden tab and selects it", () => {
    const folders = entry();
    const search = entry(true, true);
    const controller = createSidebarTabs({ folders, search }, "folders");

    controller.reveal("search");

    expect(search.tab.hidden).toBe(false);
    expect(controller.selected()).toBe("search");
    expect(search.panel.hidden).toBe(false);
    expect(folders.panel.hidden).toBe(true);
  });

  /** Verifies conceal hides the tab and falls back to the first visible tab. */
  it("conceals a selected tab and falls back to a visible one", () => {
    const folders = entry();
    const search = entry();
    const controller = createSidebarTabs({ folders, search }, "search");

    controller.conceal("search");

    expect(search.tab.hidden).toBe(true);
    expect(controller.selected()).toBe("folders");
    expect(folders.panel.hidden).toBe(false);
    expect(search.panel.hidden).toBe(true);
  });

  /** Verifies concealing an unselected tab keeps the current selection. */
  it("keeps the selection when concealing an unselected tab", () => {
    const folders = entry();
    const search = entry();
    const controller = createSidebarTabs({ folders, search }, "folders");

    controller.conceal("search");

    expect(controller.selected()).toBe("folders");
    expect(folders.panel.hidden).toBe(false);
  });
});
