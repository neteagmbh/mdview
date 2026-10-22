import type { PdfPosition } from "./pdf-position";

/** A source destination keeps PDF reading coordinates independent from link fragments. */
export interface DocumentDestination {
  /** Original source path and optional Markdown/PDF link fragment. */
  path: string;
  fragment: string | null;
  /** Exact PDF destination captured before leaving the source. */
  position?: PdfPosition | null;
}

/** Owns Back history across renderer types, retaining only successfully followed links. */
export function createDocumentNavigation(current: () => DocumentDestination | null,
  open: (destination: DocumentDestination, sourcePath?: string) => Promise<boolean>) {
  const history: DocumentDestination[] = [];
  /** Keeps source history bounded while retaining the most recent successful visits. */
  function remember(previous: DocumentDestination | null): void {
    if (previous) history.push(previous);
    if (history.length > 100) history.shift();
  }
  return {
    /** Indicates whether a prior successfully visited source can be restored. */
    get hasBack() { return history.length > 0; },
    /** Records explicit picker/tree/drop navigation without granting relative-link access. */
    async visit(path: string, fragment: string | null): Promise<boolean> {
      const previous = current();
      const success = await open({ path, fragment });
      if (success && previous && (previous.path !== path || previous.fragment !== fragment)) remember(previous);
      return success;
    },
    /** Follows a relative link while retaining the exact source reading destination. */
    async follow(path: string, fragment: string | null): Promise<void> {
      const previous = current();
      if (await open({ path, fragment }, previous?.path)) remember(previous);
    },
    /** Restores page-relative PDF coordinates or the previous Markdown anchor. */
    async back(): Promise<void> {
      const previous = history.pop();
      if (previous) await open(previous);
    },
  };
}
