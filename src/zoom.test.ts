import { describe, expect, it } from "vitest";
import { stepZoom, zoomFactor, zoomLabel } from "./zoom";

describe("zoomFactor", () => {
  /** Verifies percentages become factors that enlarge or shrink the complete document. */
  it("converts zoom percentages to CSS scale factors", () => {
    expect(zoomFactor(125)).toBe(1.25);
    expect(zoomFactor(75)).toBe(0.75);
  });
});

describe("stepZoom", () => {
  /** Verifies normal zoom steps and clamping at both supported limits. */
  it("moves through fixed levels and clamps at both limits", () => {
    expect(stepZoom(100, 1)).toBe(110);
    expect(stepZoom(100, -1)).toBe(90);
    expect(stepZoom(150, 1)).toBe(150);
    expect(stepZoom(75, -1)).toBe(75);
  });

  /** Verifies that an unsupported level resumes from the default zoom. */
  it("recovers an unknown level from the 100% default", () => {
    expect(stepZoom(101, 1)).toBe(110);
  });
});

describe("zoomLabel", () => {
  /** Verifies the percentage label shown by the reset control. */
  it("formats the toolbar percentage", () => {
    expect(zoomLabel(125)).toBe("125%");
  });
});
