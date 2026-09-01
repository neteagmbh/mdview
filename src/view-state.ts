import { clampSidebarWidth } from "./sidebar-resize";

/** Minimum persisted inner window width accepted during restoration. */
export const MIN_WINDOW_WIDTH = 420;
/** Minimum persisted inner window height accepted during restoration. */
export const MIN_WINDOW_HEIGHT = 320;
/** Supported width range for the recent-folders sidebar. */
export const SIDEBAR_WIDTH_BOUNDS = { min: 200, max: 480 } as const;
/** Supported width range for the document-outline sidebar. */
export const OUTLINE_WIDTH_BOUNDS = { min: 200, max: 420 } as const;

/** Physical size and position of the main application window. */
export interface WindowGeometry {
  width: number;
  height: number;
  x: number;
  y: number;
}

/** Application view state persisted by the native backend. */
export interface ViewState {
  window: WindowGeometry | null;
  sidebarWidth: number | null;
  outlineWidth: number | null;
  activeDocument: string | null;
}

/** Empty state used before native persistence has loaded. */
export const EMPTY_VIEW_STATE: ViewState = {
  window: null,
  sidebarWidth: null,
  outlineWidth: null,
  activeDocument: null,
};

/** Returns whether a value is a finite number. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Sanitizes persisted state before applying it to live window and layout APIs. */
export function normalizeViewState(state: ViewState): ViewState {
  const geometry = state.window;
  const windowGeometry =
    geometry &&
    isFiniteNumber(geometry.width) &&
    isFiniteNumber(geometry.height) &&
    isFiniteNumber(geometry.x) &&
    isFiniteNumber(geometry.y) &&
    geometry.width >= MIN_WINDOW_WIDTH &&
    geometry.height >= MIN_WINDOW_HEIGHT
      ? geometry
      : null;

  return {
    window: windowGeometry,
    sidebarWidth: isFiniteNumber(state.sidebarWidth)
      ? clampSidebarWidth(state.sidebarWidth, SIDEBAR_WIDTH_BOUNDS)
      : null,
    outlineWidth: isFiniteNumber(state.outlineWidth)
      ? clampSidebarWidth(state.outlineWidth, OUTLINE_WIDTH_BOUNDS)
      : null,
    activeDocument:
      typeof state.activeDocument === "string" && state.activeDocument.trim()
        ? state.activeDocument
        : null,
  };
}