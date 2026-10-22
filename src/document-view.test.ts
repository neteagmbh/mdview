import { describe, expect, it, vi } from "vitest";
import { createDocumentView, type DocumentRenderer } from "./document-view";

/** Minimal renderer models readiness and explicit disposal independently of either document type. */
function renderer(kind: "pdf" | "markdown", ready = Promise.resolve()): DocumentRenderer {
  return { kind, ready, capabilities: { print: kind === "markdown", find: kind === "markdown", outline: kind === "markdown" },
    zoom: vi.fn(), destroy: vi.fn(async () => undefined) };
}

describe("active document renderer", () => {
  /** Switching types tears down the previous renderer before installing the next one. */
  it("dispatches capabilities and disposes the old renderer", async () => {
    const view = createDocumentView();
    const pdf = renderer("pdf");
    const markdown = renderer("markdown");
    await view.show(() => pdf);
    expect(view.current?.capabilities.print).toBe(false);
    await view.show(() => markdown);
    expect(pdf.destroy).toHaveBeenCalledOnce();
    expect(view.current?.kind).toBe("markdown");
    expect(view.current?.capabilities.find).toBe(true);
    await view.clear();
    expect(markdown.destroy).toHaveBeenCalledOnce();
    expect(view.current).toBeNull();
  });

  /** An old native/worker promise resolving later cannot reinstall a cancelled renderer. */
  it("aborts pending readiness and ignores its late completion", async () => {
    const view = createDocumentView();
    let complete!: () => void;
    const old = renderer("pdf", new Promise(resolve => { complete = resolve; }));
    let signal!: AbortSignal;
    let started!: () => void;
    const installed = new Promise<void>(resolve => { started = resolve; });
    const showing = view.show(lifetime => { signal = lifetime; started(); return old; });
    await installed;
    await view.clear();
    expect(signal.aborted).toBe(true);
    complete();
    await expect(showing).rejects.toMatchObject({ name: "AbortError" });
    expect(old.destroy).toHaveBeenCalledOnce();
    expect(view.current).toBeNull();
  });

  /** A failed PDF load has no active worker/view after its ready promise rejects. */
  it("disposes readiness failures", async () => {
    const view = createDocumentView();
    const failed = renderer("pdf", Promise.reject(new Error("damaged PDF")));
    await expect(view.show(() => failed)).rejects.toThrow("damaged PDF");
    expect(failed.destroy).toHaveBeenCalledOnce();
    expect(view.current).toBeNull();
  });

  /** Delayed cleanup serializes competing opens, preventing simultaneous renderer allocation. */
  it("does not install a superseded factory while disposal is pending", async () => {
    const view = createDocumentView();
    let cleaned!: () => void;
    let started!: () => void;
    const cleaning = new Promise<void>(resolve => { started = resolve; });
    const first = renderer("pdf");
    first.destroy = vi.fn(() => new Promise<void>(resolve => { cleaned = resolve; started(); }));
    await view.show(() => first);
    const staleFactory = vi.fn(() => renderer("pdf"));
    const stale = view.show(staleFactory);
    const staleResult = stale.catch(error => error);
    const latest = view.show(() => renderer("markdown"));
    await cleaning;
    cleaned();
    expect(await staleResult).toMatchObject({ name: "AbortError" });
    await latest;
    expect(staleFactory).not.toHaveBeenCalled();
    expect(view.current?.kind).toBe("markdown");
  });
});
