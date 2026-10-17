// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), terminate: vi.fn(), destroy: vi.fn() }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  version: "6.4.299", GlobalWorkerOptions: { workerSrc: "" }, PDFWorker: { create: mocks.create },
}));

describe("lazy PDF runtime", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.create.mockReset();
    mocks.terminate.mockClear();
    mocks.destroy.mockClear();
    vi.stubGlobal("Worker", class {
      terminate = mocks.terminate;
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  /** Importing the lightweight loader must not start a worker during Markdown startup. */
  it("loads only on demand and owns cleanup of its explicit browser worker", async () => {
    const runtime = await import("./pdfjs-runtime");
    expect(mocks.create).not.toHaveBeenCalled();
    const bundle = await runtime.loadPdfjs();
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.create.mockReturnValue({ promise: Promise.resolve(), destroy: mocks.destroy });
    const handle = await bundle.createPdfWorker();
    expect(mocks.create).toHaveBeenCalledWith({ port: handle.port });
    expect(bundle.documentOptions.useWorkerFetch).toBe(false);
    expect(new URL(bundle.documentOptions.wasmUrl).origin).toBe(location.origin);
    handle.destroy();
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(mocks.terminate).toHaveBeenCalledOnce();
  });

  /** A failed PDF.js initializer must not leak the already-created native worker. */
  it("terminates the browser worker if PDF.js initialization throws", async () => {
    const { createPdfWorker } = await import("./pdfjs-bundle");
    mocks.create.mockImplementation(() => { throw new Error("initialization failed"); });
    await expect(createPdfWorker()).rejects.toThrow("initialization failed");
    expect(mocks.terminate).toHaveBeenCalledOnce();
  });

  /** Worker readiness rejection must release both layers and preserve its error. */
  it("destroys both worker layers when readiness rejects", async () => {
    const { createPdfWorker } = await import("./pdfjs-bundle");
    mocks.create.mockReturnValue({ promise: Promise.reject(new Error("worker refused")), destroy: mocks.destroy });
    await expect(createPdfWorker()).rejects.toThrow("worker refused");
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(mocks.terminate).toHaveBeenCalledOnce();
  });
});
