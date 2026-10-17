import { expect, it, vi } from "vitest";

/** Reproduces Safari 18's missing Iterator.join before importing the scoped compatibility module. */
it("supplies the iterator join operation required by PDF.js find normalization", async () => {
  const prototype = Object.getPrototypeOf(Object.getPrototypeOf(new Map().keys()));
  const original = Object.getOwnPropertyDescriptor(prototype, "join");
  try {
    Reflect.deleteProperty(prototype, "join");
    expect((new Map().keys() as unknown as { join?: unknown }).join).toBeUndefined();
    vi.resetModules();
    await import("core-js/actual/iterator/join");
    const keys = new Map([["a", 1], ["é", 2]]).keys() as unknown as { join: (separator: string) => string };
    expect(keys.join("|")).toBe("a|é");
    expect(Object.getOwnPropertyDescriptor(prototype, "join")?.enumerable).toBe(false);
  } finally {
    if (original) Object.defineProperty(prototype, "join", original);
    else Reflect.deleteProperty(prototype, "join");
  }
});
