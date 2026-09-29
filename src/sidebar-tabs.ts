/**
 * Tabbed panels for the left sidebar.
 *
 * Each named entry pairs a tab button with the panel it controls. A tab can be
 * hidden entirely (e.g. the search tab only exists while a search session is
 * active) and revealed on demand.
 */

/** A tab button paired with the panel it controls. */
export interface SidebarTabEntry {
  tab: HTMLButtonElement;
  panel: HTMLElement;
}

/** Imperative handle for switching, revealing, and concealing sidebar tabs. */
export interface SidebarTabsController {
  /** Shows the named panel and marks its tab as selected. */
  select(name: string): void;
  /** Unhides the named tab and selects it. */
  reveal(name: string): void;
  /** Hides the named tab, falling back to the first visible tab when it was selected. */
  conceal(name: string): void;
  /** Returns the name of the currently selected tab. */
  selected(): string;
}

/** Wires tab buttons to their panels and returns a controller for external tab changes. */
export function createSidebarTabs(
  entries: Record<string, SidebarTabEntry>,
  initial: string,
): SidebarTabsController {
  let current = initial;

  function select(name: string): void {
    if (!(name in entries)) {
      return;
    }
    current = name;
    Object.entries(entries).forEach(([key, entry]) => {
      const isSelected = key === name;
      entry.tab.setAttribute("aria-selected", String(isSelected));
      entry.panel.hidden = !isSelected;
    });
  }

  function reveal(name: string): void {
    const entry = entries[name];
    if (!entry) {
      return;
    }
    entry.tab.hidden = false;
    select(name);
  }

  function conceal(name: string): void {
    const entry = entries[name];
    if (!entry) {
      return;
    }
    entry.tab.hidden = true;
    if (current === name) {
      const fallback = Object.entries(entries).find(([, candidate]) => !candidate.tab.hidden);
      if (fallback) {
        select(fallback[0]);
      }
    }
  }

  Object.entries(entries).forEach(([name, entry]) => {
    entry.tab.addEventListener("click", () => select(name));
  });
  select(initial);

  return { select, reveal, conceal, selected: () => current };
}
