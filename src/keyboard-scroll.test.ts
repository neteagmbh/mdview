// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  handleDocumentScrollKey,
  keyboardScrollOffset,
} from "./keyboard-scroll";

describe("keyboardScrollOffset", () => {
  /** Verifies fixed arrow-key movement in all scrollable directions. */
  it("maps arrow keys to short scroll steps", () => {
    expect(keyboardScrollOffset("ArrowUp", 800, 600)).toEqual({ left: 0, top: -48 });
    expect(keyboardScrollOffset("ArrowDown", 800, 600)).toEqual({ left: 0, top: 48 });
    expect(keyboardScrollOffset("ArrowLeft", 800, 600)).toEqual({ left: -48, top: 0 });
    expect(keyboardScrollOffset("ArrowRight", 800, 600)).toEqual({ left: 48, top: 0 });
  });

  /** Verifies page keys retain a small visual overlap between viewports. */
  it("maps page keys to ninety percent of the viewport height", () => {
    expect(keyboardScrollOffset("PageUp", 800, 600)).toEqual({ left: 0, top: -540 });
    expect(keyboardScrollOffset("PageDown", 800, 600)).toEqual({ left: 0, top: 540 });
    expect(keyboardScrollOffset("Enter", 800, 600)).toBeNull();
  });
});

describe("handleDocumentScrollKey", () => {
  /** Verifies an eligible key scrolls the document and suppresses native handling. */
  it("scrolls the document viewport", () => {
    const scrollTarget = document.createElement("main");
    const scrollBy = vi.fn();
    Object.defineProperties(scrollTarget, {
      clientHeight: { value: 600 },
      clientWidth: { value: 800 },
      scrollBy: { value: scrollBy },
    });
    const event = new KeyboardEvent("keydown", {
      cancelable: true,
      key: "PageDown",
    });

    expect(handleDocumentScrollKey(event, scrollTarget)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(scrollBy).toHaveBeenCalledWith({
      behavior: "auto",
      left: 0,
      top: 540,
    });
  });

  /** Verifies text editing and keyboard shortcuts keep their native key behavior. */
  it("ignores editing controls and modified keys", () => {
    const scrollTarget = document.createElement("main");
    scrollTarget.scrollBy = vi.fn();
    const input = document.createElement("input");
    let handled = true;
    input.addEventListener("keydown", (event) => {
      handled = handleDocumentScrollKey(event, scrollTarget);
    });

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(handled).toBe(false);
    expect(scrollTarget.scrollBy).not.toHaveBeenCalled();

    const shortcut = new KeyboardEvent("keydown", {
      ctrlKey: true,
      key: "ArrowDown",
    });
    expect(handleDocumentScrollKey(shortcut, scrollTarget)).toBe(false);
  });
});
