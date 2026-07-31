export const ZOOM_LEVELS = [75, 90, 100, 110, 125, 150] as const;

/** Converts a percentage zoom level into a CSS scale factor. */
export function zoomFactor(level: number): number {
  return level / 100;
}

/** Moves one step through the supported document zoom levels. */
export function stepZoom(current: number, direction: -1 | 1): number {
  const index = ZOOM_LEVELS.indexOf(current as (typeof ZOOM_LEVELS)[number]);
  const currentIndex = index === -1 ? ZOOM_LEVELS.indexOf(100) : index;
  const nextIndex = Math.min(
    ZOOM_LEVELS.length - 1,
    Math.max(0, currentIndex + direction),
  );
  return ZOOM_LEVELS[nextIndex];
}

/** Formats a numeric zoom level for display in the toolbar. */
export function zoomLabel(level: number): string {
  return `${level}%`;
}
