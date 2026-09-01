import { describe, expect, it } from "vitest";
import { EMPTY_VIEW_STATE, normalizeViewState, type ViewState } from "./view-state";

describe("normalizeViewState", () => {
  /** Valid persisted state passes through unchanged. */
  it("preserves valid window, sidebar, and document values", () => {
    const state: ViewState = {
      window: { width: 1280, height: 800, x: -120, y: 60 },
      sidebarWidth: 300,
      outlineWidth: 260,
      activeDocument: "/docs/README.md",
    };

    expect(normalizeViewState(state)).toEqual(state);
  });

  /** Sidebar values are clamped to the same bounds used by pointer resizing. */
  it("clamps persisted sidebar widths", () => {
    const state: ViewState = {
      ...EMPTY_VIEW_STATE,
      sidebarWidth: 900,
      outlineWidth: 100,
    };

    expect(normalizeViewState(state)).toEqual({
      ...EMPTY_VIEW_STATE,
      sidebarWidth: 480,
      outlineWidth: 200,
    });
  });

  /** Unsafe geometry and blank document paths are discarded before restoration. */
  it("rejects undersized geometry and blank document paths", () => {
    const state: ViewState = {
      ...EMPTY_VIEW_STATE,
      window: { width: 200, height: 100, x: 10, y: 20 },
      activeDocument: "   ",
    };

    expect(normalizeViewState(state)).toEqual(EMPTY_VIEW_STATE);
  });
});