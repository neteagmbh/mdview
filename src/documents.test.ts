import { describe, expect, it, vi } from "vitest";
import { preparePdfResource, type DocumentTransport, type PreparedPdf } from "./documents";

/** Stable original-source metadata containing an opaque native lease. */
const metadata: PreparedPdf = { kind: "pdf", path: "/Notes/Über # %.PDF", name: "Über # %.PDF", size: 3, handle: "viewer" };

/** Transport fixture validates the exact metadata/binary command boundary. */
function harness() {
  const call = vi.fn(async (command: string, _args: Record<string, unknown>): Promise<unknown> => {
    if (command === "prepare_pdf_document") return metadata;
    if (command === "read_pdf_bytes") return new Uint8Array([37, 255, 254]).buffer;
    if (command === "retain_pdf_document") return { ...metadata, handle: "print" };
  });
  return { call, transport: call as DocumentTransport };
}

describe("native PDF resources", () => {
  /** Binary transport preserves non-UTF-8 bytes, and release does not reopen or reserialize the source. */
  it("reads binary bytes and releases one viewer lease idempotently", async () => {
    const { call, transport } = harness();
    const resource = await preparePdfResource(metadata.path, undefined, transport);
    expect(resource.metadata).toEqual(metadata);
    expect(await resource.read()).toEqual(new Uint8Array([37, 255, 254]));
    expect(call).toHaveBeenCalledWith("read_pdf_bytes", { handle: "viewer" });
    await resource.release();
    await resource.release();
    expect(call.mock.calls.filter(([command]) => command === "release_pdf_document")).toHaveLength(1);
    await expect(resource.read()).rejects.toThrow("closed");
    await expect(resource.retain()).rejects.toThrow("closed");
  });

  /** Print ownership remains independent of closing the original viewer. */
  it("retains and independently disposes print leases", async () => {
    const { call, transport } = harness();
    const viewer = await preparePdfResource(metadata.path, undefined, transport);
    const print = await viewer.retain();
    await viewer.release();
    expect(await print.read()).toEqual(new Uint8Array([37, 255, 254]));
    await print.release();
    expect(call).toHaveBeenCalledWith("release_pdf_document", { handle: "print" });
  });

  /** Wrong response types and native read failures release the resource before propagating errors. */
  it("releases failed or malformed binary reads", async () => {
    for (const result of [[37, 255, 254], new ArrayBuffer(2), new Error("provider offline")]) {
      const { call, transport } = harness();
      const resource = await preparePdfResource(metadata.path, undefined, transport);
      if (result instanceof Error) call.mockRejectedValueOnce(result);
      else call.mockResolvedValueOnce(result);
      await expect(resource.read()).rejects.toThrow();
      expect(call).toHaveBeenCalledWith("release_pdf_document", { handle: "viewer" });
    }
  });

  /** An already-aborted request performs no native preparation or snapshot allocation. */
  it("does not start aborted preparations", async () => {
    const { call, transport } = harness();
    const abort = new AbortController();
    abort.abort();
    await expect(preparePdfResource(metadata.path, abort.signal, transport)).rejects.toMatchObject({ name: "AbortError" });
    expect(call).not.toHaveBeenCalled();
  });

  /** A late result is released even when cancellation was delivered before native registration. */
  it("cancels pending copies and releases a racing successful result", async () => {
    const { call, transport } = harness();
    let complete!: (value: PreparedPdf) => void;
    call.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const abort = new AbortController();
    const pending = preparePdfResource(metadata.path, abort.signal, transport);
    abort.abort();
    expect(call).toHaveBeenCalledWith("cancel_pdf_preparation", expect.objectContaining({ requestId: expect.any(String) }));
    complete(metadata);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(call).toHaveBeenCalledWith("release_pdf_document", { handle: "viewer" });
  });

  /** Native errors remain intact and remove the listener so later aborts issue no stale cancellation. */
  it("preserves preparation failures and detaches cancellation listeners", async () => {
    const { call, transport } = harness();
    call.mockRejectedValueOnce(new Error("unauthorized"));
    const abort = new AbortController();
    await expect(preparePdfResource(metadata.path, abort.signal, transport)).rejects.toThrow("unauthorized");
    abort.abort();
    expect(call).toHaveBeenCalledTimes(1);
  });

  /** Cleanup can be retried after an IPC transport failure without permitting new reads. */
  it("retries failed release operations", async () => {
    const { call, transport } = harness();
    const resource = await preparePdfResource(metadata.path, undefined, transport);
    call.mockRejectedValueOnce(new Error("IPC unavailable"));
    await expect(resource.release()).rejects.toThrow("IPC unavailable");
    await resource.release();
    expect(call.mock.calls.filter(([command]) => command === "release_pdf_document")).toHaveLength(2);
  });

  /** A print retain that finishes after viewer disposal cannot leak the newly allocated lease. */
  it("cleans up a print lease returned after the viewer closed", async () => {
    const { call, transport } = harness();
    const resource = await preparePdfResource(metadata.path, undefined, transport);
    let complete!: (value: PreparedPdf) => void;
    call.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const retaining = resource.retain();
    await resource.release();
    complete({ ...metadata, handle: "late-print" });
    await expect(retaining).rejects.toThrow("closed");
    expect(call).toHaveBeenCalledWith("release_pdf_document", { handle: "late-print" });
  });

  /** Native cancellation errors map to the caller's abort reason without leaking a published resource. */
  it("preserves abort semantics when native copying rejects", async () => {
    const { call, transport } = harness();
    let fail!: (error: Error) => void;
    call.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const abort = new AbortController();
    const pending = preparePdfResource(metadata.path, abort.signal, transport);
    abort.abort();
    fail(new Error("Native copy cancelled"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
