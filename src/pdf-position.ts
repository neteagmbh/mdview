/** Portable reading position tied to an original PDF path, never its transient handle. */
export interface PdfPosition {
  /** One-based page number, clamped when the source is replaced. */
  page: number;
  /** Relative vertical and horizontal offsets within the rotated page. */
  offset: number;
  left: number;
  /** Explicit display scale or viewport-relative fit policy. */
  scale: number;
  mode: "page-width" | "page-fit" | "custom";
  /** Clockwise quarter-turn rotation. */
  rotation: number;
}

/** Rejects malformed persisted values and clamps valid positions to safe display ranges. */
export function normalizePdfPosition(value: unknown, pages = Number.MAX_SAFE_INTEGER): PdfPosition | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Partial<PdfPosition>;
  if (![p.page, p.offset, p.left, p.scale, p.rotation].every(n => typeof n === "number" && Number.isFinite(n))
    || !Number.isInteger(p.page) || p.page! < 1 || ![0, 90, 180, 270].includes(p.rotation!)
    || !["page-width", "page-fit", "custom"].includes(p.mode!)) return null;
  return { page: Math.max(1, Math.min(pages, p.page!)), offset: Math.max(0, Math.min(1, p.offset!)),
    left: Math.max(0, Math.min(1, p.left!)), scale: Math.max(0.25, Math.min(5, p.scale!)), mode: p.mode!, rotation: p.rotation! };
}

/** Keeps the most recently read twenty source paths without persisting document content. */
export function rememberPdfPosition(positions: Record<string, PdfPosition> | undefined, path: string,
  position: PdfPosition): Record<string, PdfPosition> {
  return Object.fromEntries([...Object.entries(positions ?? {}).filter(([key]) => key !== path), [path, position]].slice(-20));
}
