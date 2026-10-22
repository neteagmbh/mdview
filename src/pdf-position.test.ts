import { describe, expect, it } from "vitest";
import { normalizePdfPosition, rememberPdfPosition, type PdfPosition } from "./pdf-position";
import { normalizeViewState, EMPTY_VIEW_STATE } from "./view-state";

/** Typical rotated source position used across persistence and history tests. */
const position: PdfPosition = { page: 12, offset: 0.3, left: 0.2, scale: 1.5, mode: "custom", rotation: 90 };
describe("PDF position persistence", () => {
  /** Invalid JSON fields cannot reach PDF.js scale/rotation setters. */
  it("rejects malformed coordinates and clamps a shorter replacement", () => {
    for (const value of [null, {}, { ...position, scale: NaN }, { ...position, page: 1.5 },
      { ...position, rotation: 45 }, { ...position, mode: "bad" }]) expect(normalizePdfPosition(value)).toBeNull();
    expect(normalizePdfPosition({ ...position, scale: 100, offset: -3, left: 2 }, 3))
      .toEqual({ ...position, page: 3, scale: 5, offset: 0, left: 1 });
  });
  /** Older Markdown sessions retain their existing persisted shape. */
  it("normalizes saved paths without discarding valid legacy state", () => {
    expect(normalizeViewState(EMPTY_VIEW_STATE)).toEqual(EMPTY_VIEW_STATE);
    expect(normalizeViewState({ ...EMPTY_VIEW_STATE, pdfPositions: { "/original.pdf": position, bad: {} as PdfPosition } }))
      .toEqual({ ...EMPTY_VIEW_STATE, pdfPositions: { "/original.pdf": position } });
  });
  /** Repeated reading does not grow native state without a bound. */
  it("keeps twenty most recently read source positions", () => {
    let positions = {};
    for (let index = 0; index < 30; index++) positions = rememberPdfPosition(positions, `/source${index}.pdf`, position);
    positions = rememberPdfPosition(positions, "/source10.pdf", { ...position, page: 2 });
    expect(Object.keys(positions)).toHaveLength(20);
    expect(Object.keys(positions).at(-1)).toBe("/source10.pdf");
    expect(Object.keys(positions)).not.toContain("/source0.pdf");
  });
});
