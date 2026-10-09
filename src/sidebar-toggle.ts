/** Starts with more reading space on phones, portrait tablets, and small windows. */
export function initializeSidebarVisibility(
  setSidebarOpen: (open: boolean) => void,
  setOutlineOpen: (open: boolean) => void,
  viewport: Pick<Window, "matchMedia"> = window,
): void {
  const open = !viewport.matchMedia("(max-width: 1100px)").matches;
  setSidebarOpen(open);
  setOutlineOpen(open);
}

/** Wires the header toggle and returns a setter for revealing the sidebar. */
export function attachSidebarToggle(
  shell: HTMLElement,
  sidebar: HTMLElement,
  toggle: HTMLButtonElement,
): (open: boolean) => void {
  /** Updates visibility and announces the next action to assistive technology. */
  function setOpen(open: boolean): void {
    if (!open && sidebar.contains(document.activeElement)) {
      toggle.focus();
    }
    sidebar.hidden = !open;
    shell.classList.toggle("sidebar-closed", !open);
    toggle.setAttribute("aria-expanded", String(open));
    const label = open ? "Close sidebar" : "Open sidebar";
    toggle.title = label;
    toggle.setAttribute("aria-label", label);
  }

  toggle.addEventListener("click", () => setOpen(Boolean(sidebar.hidden)));
  setOpen(!sidebar.hidden);
  return setOpen;
}
