// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  attachSidebarResize,
  clampSidebarWidth,
  computeResizedWidth,
} from "./sidebar-resize";

describe("clampSidebarWidth", () => {
  /** Verifies widths within bounds pass through unchanged. */
  it("returns the width unchanged when within bounds", () => {
    expect(clampSidebarWidth(300, { min: 180, max: 480 })).toBe(300);
  });

  /** Verifies widths outside the bounds are clamped to the nearest limit. */
  it("clamps widths outside the configured bounds", () => {
    expect(clampSidebarWidth(50, { min: 180, max: 480 })).toBe(180);
    expect(clampSidebarWidth(900, { min: 180, max: 480 })).toBe(480);
  });
});

describe("computeResizedWidth", () => {
  /** Verifies a rightward-growing handle adds the drag distance to the starting width. */
  it("grows the width when dragging right for a grow-right handle", () => {
    const width = computeResizedWidth(260, 100, 150, "grow-right", { min: 180, max: 480 });
    expect(width).toBe(310);
  });

  /** Verifies a leftward-growing handle adds the inverse drag distance to the starting width. */
  it("grows the width when dragging left for a grow-left handle", () => {
    const width = computeResizedWidth(240, 500, 450, "grow-left", { min: 180, max: 420 });
    expect(width).toBe(290);
  });

  /** Verifies the result is clamped even when the raw drag distance would exceed the bounds. */
  it("clamps the result to the configured bounds", () => {
    const width = computeResizedWidth(260, 100, 1000, "grow-right", { min: 180, max: 480 });
    expect(width).toBe(480);
  });
});

describe("attachSidebarResize", () => {
  /** Verifies a full pointer drag updates the target's CSS custom property, clamped to bounds. */
  it("updates the CSS custom property while dragging and stops on pointer up", () => {
    const target = document.createElement("div");
    const handle = document.createElement("div");
    const onResizeEnd = vi.fn();
    document.body.append(target, handle);

    attachSidebarResize({
      handle,
      target,
      cssVariable: "--sidebar-width",
      bounds: { min: 180, max: 480 },
      direction: "grow-right",
      getCurrentWidth: () => 260,
      onResizeEnd,
    });

    handle.dispatchEvent(new MouseEvent("pointerdown", { clientX: 100 }));
    handle.dispatchEvent(new MouseEvent("pointermove", { clientX: 160 }));
    expect(target.style.getPropertyValue("--sidebar-width")).toBe("320px");

    handle.dispatchEvent(new MouseEvent("pointerup", { clientX: 160 }));
    expect(onResizeEnd).toHaveBeenCalledOnce();
    expect(onResizeEnd).toHaveBeenCalledWith(320);
    handle.dispatchEvent(new MouseEvent("pointermove", { clientX: 400 }));
    expect(target.style.getPropertyValue("--sidebar-width")).toBe("320px");
  });
});
