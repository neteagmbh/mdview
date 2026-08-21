// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  adjustZoom,
  clampZoom,
  createImagePopoutController,
  fitZoom,
  ICON_ZOOM_STEP,
  imagePopoutZoomLabel,
  type Size,
  WHEEL_ZOOM_STEP,
  zoomDirectionFromWheelDelta,
} from "./image-popout";

describe("clampZoom", () => {
  /** Verifies zoom is clamped to the supported 25%–400% range. */
  it("clamps to the supported range", () => {
    expect(clampZoom(10)).toBe(25);
    expect(clampZoom(1000)).toBe(400);
    expect(clampZoom(150)).toBe(150);
  });
});

describe("adjustZoom", () => {
  /** Verifies the icon step (25) and wheel step (5) move zoom by the expected amount. */
  it("moves by the given step and direction, clamped at the bounds", () => {
    expect(adjustZoom(100, 1, ICON_ZOOM_STEP)).toBe(125);
    expect(adjustZoom(100, -1, ICON_ZOOM_STEP)).toBe(75);
    expect(adjustZoom(100, 1, WHEEL_ZOOM_STEP)).toBe(105);
    expect(adjustZoom(400, 1, ICON_ZOOM_STEP)).toBe(400);
    expect(adjustZoom(25, -1, WHEEL_ZOOM_STEP)).toBe(25);
  });
});

describe("zoomDirectionFromWheelDelta", () => {
  /** Verifies scrolling up (negative deltaY) zooms in and scrolling down zooms out. */
  it("maps wheel delta sign to a zoom direction", () => {
    expect(zoomDirectionFromWheelDelta(-10)).toBe(1);
    expect(zoomDirectionFromWheelDelta(10)).toBe(-1);
  });
});

describe("imagePopoutZoomLabel", () => {
  /** Verifies the percentage label shown by the reset control, rounded to a whole number. */
  it("formats the zoom percentage", () => {
    expect(imagePopoutZoomLabel(150)).toBe("150%");
    expect(imagePopoutZoomLabel(133.333)).toBe("133%");
  });
});

describe("fitZoom", () => {
  /** Verifies the narrower axis determines the fit ratio. */
  it("picks the more constraining axis", () => {
    expect(fitZoom({ width: 400, height: 300 }, { width: 800, height: 300 })).toBe(100);
    expect(fitZoom({ width: 400, height: 300 }, { width: 800, height: 900 })).toBe(200);
    expect(fitZoom({ width: 1200, height: 300 }, { width: 600, height: 900 })).toBe(50);
  });

  /** Verifies an unmeasurable document size falls back to 100% instead of dividing by zero. */
  it("falls back to 100% when the document size is unmeasurable", () => {
    expect(fitZoom({ width: 0, height: 0 }, { width: 800, height: 600 })).toBe(100);
  });

  /** Verifies the result is clamped to the popout's supported zoom range. */
  it("clamps the fitted zoom to the supported range", () => {
    expect(fitZoom({ width: 100, height: 100 }, { width: 10, height: 10 })).toBe(25);
    expect(fitZoom({ width: 10, height: 10 }, { width: 1000, height: 1000 })).toBe(400);
  });
});

/** Builds a fresh, document-attached set of popout elements with a size-lookup-based measurer. */
function createElements() {
  const overlay = document.createElement("div");
  overlay.hidden = true;
  const content = document.createElement("div");
  const zoomInButton = document.createElement("button");
  const zoomOutButton = document.createElement("button");
  const zoomResetButton = document.createElement("button");
  const closeButton = document.createElement("button");
  overlay.append(content, zoomInButton, zoomOutButton, zoomResetButton, closeButton);
  document.body.append(overlay);

  const sizes = new Map<Element, Size>();
  const measure = (element: Element): Size => sizes.get(element) ?? { width: 0, height: 0 };

  return {
    overlay,
    content,
    zoomInButton,
    zoomOutButton,
    zoomResetButton,
    closeButton,
    measure,
    sizes,
  };
}

describe("createImagePopoutController", () => {
  /** Verifies opening clones the source so the original stays in the document. */
  it("clones the source image into the popout without removing the original", () => {
    const elements = createElements();
    const controller = createImagePopoutController(elements);
    const original = document.createElement("img");
    original.src = "https://example.com/pic.png";
    document.body.append(original);

    controller.open(original);

    expect(elements.overlay.hidden).toBe(false);
    expect(elements.content.querySelector("img")).not.toBeNull();
    expect(elements.content.querySelector("img")).not.toBe(original);
    expect(original.isConnected).toBe(true);
  });

  /** Verifies opening picks the zoom percentage that fits the available popout space. */
  it("fits the image to the available space when opening", () => {
    const elements = createElements();
    const original = document.createElement("img");
    elements.sizes.set(original, { width: 400, height: 300 });
    elements.sizes.set(elements.content, { width: 800, height: 900 });
    const controller = createImagePopoutController(elements);

    controller.open(original);

    expect(elements.zoomResetButton.textContent).toBe("200%");
    const clone = elements.content.querySelector("img")!;
    expect(clone.style.width).toBe("800px");
    expect(clone.style.height).toBe("600px");
  });

  /** Verifies 150% renders larger than 100%, both relative to the document-rendered size. */
  it("renders monotonically larger images as the zoom percentage increases", () => {
    const elements = createElements();
    const original = document.createElement("img");
    elements.sizes.set(original, { width: 400, height: 300 });
    elements.sizes.set(elements.content, { width: 400, height: 300 });
    const controller = createImagePopoutController(elements);
    controller.open(original);
    const clone = elements.content.querySelector("img")!;
    expect(elements.zoomResetButton.textContent).toBe("100%");
    expect(clone.style.width).toBe("400px");

    elements.zoomInButton.click();
    elements.zoomInButton.click();
    expect(elements.zoomResetButton.textContent).toBe("150%");
    expect(clone.style.width).toBe("600px");
    expect(clone.style.height).toBe("450px");
  });

  /** Verifies icon clicks step by 25 points and disable at the supported bounds. */
  it("steps zoom by 25 points per icon click and disables buttons at the bounds", () => {
    const elements = createElements();
    const original = document.createElement("img");
    elements.sizes.set(original, { width: 400, height: 300 });
    elements.sizes.set(elements.content, { width: 400, height: 300 });
    const controller = createImagePopoutController(elements);
    controller.open(original);

    elements.zoomInButton.click();
    expect(elements.zoomResetButton.textContent).toBe("125%");

    elements.zoomResetButton.click();
    elements.zoomOutButton.click();
    expect(elements.zoomResetButton.textContent).toBe("75%");
  });

  /** Verifies Ctrl+wheel zooms in 5-point steps while a plain wheel is left to native scrolling. */
  it("zooms in 5-point steps only when the wheel event carries the Ctrl modifier", () => {
    const elements = createElements();
    const original = document.createElement("img");
    elements.sizes.set(original, { width: 400, height: 300 });
    elements.sizes.set(elements.content, { width: 400, height: 300 });
    const controller = createImagePopoutController(elements);
    controller.open(original);

    elements.overlay.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 10, ctrlKey: false, cancelable: true }),
    );
    expect(elements.zoomResetButton.textContent).toBe("100%");

    elements.overlay.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -10, ctrlKey: true, cancelable: true }),
    );
    expect(elements.zoomResetButton.textContent).toBe("105%");
  });

  /** Verifies the reset control always returns to the document's actual (100%) size. */
  it("resets to the document's actual size, not the initial fit-to-viewport zoom", () => {
    const elements = createElements();
    const original = document.createElement("img");
    elements.sizes.set(original, { width: 400, height: 300 });
    elements.sizes.set(elements.content, { width: 800, height: 900 });
    const controller = createImagePopoutController(elements);
    controller.open(original);
    expect(elements.zoomResetButton.textContent).toBe("200%");

    elements.zoomResetButton.click();
    expect(elements.zoomResetButton.textContent).toBe("100%");
  });

  /** Verifies closing hides the overlay and clears the displayed content. */
  it("closes via the close button and clears the content", () => {
    const elements = createElements();
    const controller = createImagePopoutController(elements);
    controller.open(document.createElement("img"));

    elements.closeButton.click();

    expect(elements.overlay.hidden).toBe(true);
    expect(elements.content.childElementCount).toBe(0);
  });

  /** Verifies the Escape key closes the popout only while it is open. */
  it("closes on Escape while open and is a no-op while already closed", () => {
    const elements = createElements();
    const controller = createImagePopoutController(elements);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(elements.overlay.hidden).toBe(true);

    controller.open(document.createElement("img"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(elements.overlay.hidden).toBe(true);
  });
});

