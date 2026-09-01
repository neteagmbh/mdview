import { describe, expect, it, vi } from "vitest";
import { openPrintDialog } from "./print";

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

  /** Native command failures are reported before the browser fallback runs. */
  it("reports native errors and falls back", async () => {
    const failure = new Error("native print failed");
    const browserPrint = vi.fn();
    const onNativeError = vi.fn();

    const result = await openPrintDialog(
      async () => Promise.reject(failure),
      browserPrint,
      onNativeError,
    );

    expect(result).toBe("browser");
    expect(onNativeError).toHaveBeenCalledWith(failure);
    expect(browserPrint).toHaveBeenCalledOnce();
  });
});