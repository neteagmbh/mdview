// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { attachSidebarToggle, initializeSidebarVisibility } from "./sidebar-toggle";

/** Creates a sidebar with retained width and content, plus its header button. */
function fixture() {
  document.body.innerHTML = `<button id="toggle"></button>
    <div id="shell" style="--sidebar-width: 310px">
      <aside id="sidebar"><button aria-selected="true">Folders</button></aside>
    </div>`;
  const shell = document.querySelector<HTMLElement>("#shell")!;
  const sidebar = document.querySelector<HTMLElement>("#sidebar")!;
  const toggle = document.querySelector<HTMLButtonElement>("#toggle")!;
  const setOpen = attachSidebarToggle(shell, sidebar, toggle);
  return { shell, sidebar, toggle, setOpen };
}

afterEach(() => document.body.replaceChildren());

describe("sidebar toggle", () => {
  it.each([true, false])("initializes both sidebars for a narrow viewport: %s", (narrow) => {
    const { sidebar, toggle, setOpen } = fixture();
    const setOutlineOpen = vi.fn();
    const matchMedia = vi.fn(() => ({ matches: narrow }) as MediaQueryList);

    initializeSidebarVisibility(setOpen, setOutlineOpen, { matchMedia });

    expect(matchMedia).toHaveBeenCalledWith("(max-width: 1100px)");
    expect(sidebar.hidden).toBe(narrow);
    expect(toggle.getAttribute("aria-expanded")).toBe(String(!narrow));
    expect(setOutlineOpen).toHaveBeenCalledWith(!narrow);
    if (narrow) {
      toggle.click();
      expect(sidebar.hidden).toBe(false);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
    }
  });

  it("collapses and restores the sidebar while retaining its width and content", () => {
    const { shell, sidebar, toggle } = fixture();
    const child = sidebar.firstElementChild;
    shell.classList.add("outline-closed");

    toggle.click();
    expect(sidebar.hidden).toBe(true);
    expect(shell.classList.contains("sidebar-closed")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Open sidebar");
    expect(toggle.title).toBe("Open sidebar");

    toggle.click();
    expect(sidebar.hidden).toBe(false);
    expect(shell.classList.contains("sidebar-closed")).toBe(false);
    expect(shell.classList.contains("outline-closed")).toBe(true);
    expect(shell.style.getPropertyValue("--sidebar-width")).toBe("310px");
    expect(sidebar.firstElementChild).toBe(child);
    expect(child?.getAttribute("aria-selected")).toBe("true");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Close sidebar");
  });

  it("reveals a sidebar hidden until found when the toggle is clicked", () => {
    const { shell, sidebar, toggle } = fixture();
    sidebar.hidden = "until-found";

    toggle.click();

    expect(sidebar.hidden).toBe(false);
    expect(shell.classList.contains("sidebar-closed")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Close sidebar");
  });

  it("moves focus out of a collapsing sidebar and can reveal it for search", () => {
    const { sidebar, toggle, setOpen } = fixture();
    sidebar.querySelector("button")!.focus();
    setOpen(false);
    expect(document.activeElement).toBe(toggle);
    expect(sidebar.hidden).toBe(true);

    setOpen(true);
    expect(sidebar.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
});
