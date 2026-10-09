// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { openPrintDialog, printWithNativeMargins, waitForPrintLayout } from "./print";
import { prepareLightModePrint } from "./clipboard-styles";

describe("printWithNativeMargins", () => {
  /** Native pagination must inherit AppKit margins until the print sheet closes. */
  it("keeps the override during native printing and restores it after printing", async () => {
    const original = document.head.innerHTML;
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(printWithNativeMargins(async () => {
        expect(document.head.lastElementChild?.textContent).toContain("@page { margin: auto; }");
        return true;
      })).resolves.toBe(true);
      expect(document.head.innerHTML).not.toBe(original);
      window.dispatchEvent(new Event("afterprint"));
      expect(document.head.innerHTML).toBe(original);
    }
  });

  /** Browser fallback must retain the stylesheet's page margins. */
  it("restores margins before the unsupported-platform fallback", async () => {
    const original = document.head.innerHTML;
    const browserPrint = vi.fn(() => expect(document.head.innerHTML).toBe(original));
    await expect(openPrintDialog(
      () => printWithNativeMargins(async () => {
        return false;
      }),
      browserPrint,
    )).resolves.toBe("browser");
    expect(browserPrint).toHaveBeenCalledOnce();
  });

  /** Native failures release temporary print styles without invoking an unsupported fallback. */
  it("restores margins when the native dialog fails", async () => {
    const original = document.head.innerHTML;
    const failure = new Error("Native printing failed");
    await expect(printWithNativeMargins(async () => {
      throw failure;
    })).rejects.toBe(failure);
    expect(document.head.innerHTML).toBe(original);
  });
});

describe("waitForPrintLayout", () => {
  /** Native printing must wait for replacement diagram images and a completed layout. */
  it("waits for prepared Mermaid PNGs and two animation frames before printing", async () => {
    const root = document.createElement("article");
    root.innerHTML =
      '<div class="mermaid-diagram" data-clipboard-png="data:image/png;base64,test">' +
      '<svg></svg></div>';
    const restore = prepareLightModePrint(root);
    const image = root.querySelector("img")!;
    let finishDecode!: () => void;
    image.decode = vi.fn(() => new Promise<void>((resolve) => {
      finishDecode = resolve;
    }));
    const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
    const frames: FrameRequestCallback[] = [];
    const animationFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const nativePrint = vi.fn(async () => true);
    try {
      const printing = openPrintDialog(nativePrint, vi.fn(), undefined, () => waitForPrintLayout(root));
      await vi.waitFor(() => expect(image.decode).toHaveBeenCalledOnce());
      expect(nativePrint).not.toHaveBeenCalled();
      finishDecode();
      await vi.waitFor(() => expect(frames).toHaveLength(1));
      frames.shift()!(0);
      expect(nativePrint).not.toHaveBeenCalled();
      frames.shift()!(0);
      await expect(printing).resolves.toBe("native");
      expect(nativePrint).toHaveBeenCalledOnce();
    } finally {
      restore();
      animationFrame.mockRestore();
      if (originalFonts) {
        Object.defineProperty(document, "fonts", originalFonts);
      } else {
        Reflect.deleteProperty(document, "fonts");
      }
    }
  });
});

describe("openPrintDialog", () => {
  /** A supported native backend handles printing without the browser fallback. */
  it("uses native printing when available", async () => {
    const browserPrint = vi.fn();

    const result = await openPrintDialog(async () => true, browserPrint);

    expect(result).toBe("native");
    expect(browserPrint).not.toHaveBeenCalled();
  });

  /** Unsupported platforms retain the browser print implementation. */
  it("falls back to browser printing when native printing is unavailable", async () => {
    const browserPrint = vi.fn();

    const result = await openPrintDialog(async () => false, browserPrint);

    expect(result).toBe("browser");
    expect(browserPrint).toHaveBeenCalledOnce();
  });

  /** Native failures must remain visible instead of calling window.print() on iOS. */
  it("reports native errors without invoking browser printing", async () => {
    const failure = new Error("native print failed");
    const browserPrint = vi.fn();
    const onNativeError = vi.fn();

    await expect(openPrintDialog(
      async () => Promise.reject(failure),
      browserPrint,
      onNativeError,
    )).rejects.toBe(failure);

    expect(onNativeError).toHaveBeenCalledWith(failure);
    expect(browserPrint).not.toHaveBeenCalled();
  });

  it("waits for the document before opening either print dialog", async () => {
    let finishRendering!: () => void;
    const ready = new Promise<void>((resolve) => {
      finishRendering = resolve;
    });
    const nativePrint = vi.fn(async () => false);
    const browserPrint = vi.fn();

    const printing = openPrintDialog(nativePrint, browserPrint, undefined, () => ready);
    expect(nativePrint).not.toHaveBeenCalled();
    expect(browserPrint).not.toHaveBeenCalled();

    finishRendering();
    await expect(printing).resolves.toBe("browser");
    expect(nativePrint).toHaveBeenCalledOnce();
    expect(browserPrint).toHaveBeenCalledOnce();
  });
});
