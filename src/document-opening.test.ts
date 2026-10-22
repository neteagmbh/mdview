import { describe, expect, it, vi } from "vitest";
import { createDocumentOpening, pdfPage, type OpenedContent } from "./document-opening";
import type { DocumentTransport } from "./documents";

/** Valid native PDF metadata never contains source text or private snapshot paths. */
const pdf: OpenedContent = { kind: "pdf", recentFolders: [], document: {
  kind: "pdf", handle: "pdf-1", path: "/Notes/source.PDF", name: "source.PDF", size: 9,
} };
/** Native Markdown response keeps its UTF-8 body separate from PDF resources. */
const markdown: OpenedContent = { kind: "markdown", path: "/Notes/readme.md", content: "# Hello", recentFolders: [] };

/** Creates a real ownership controller with controllable native responses. */
function harness() {
  const display = vi.fn(async () => undefined);
  const folder = vi.fn();
  const error = vi.fn();
  const transport = vi.fn(async (_command: string, _args: Record<string, unknown>): Promise<unknown> => undefined);
  return { display, folder, error, transport,
    opening: createDocumentOpening({ display, folder, error }, transport as DocumentTransport) };
}

describe("shared document opening", () => {
  /** Exact Back coordinates bypass the latest saved position, even when revisiting the same source. */
  it("passes a captured reading destination to the renderer without sending it over IPC", async () => {
    const h = harness();
    const position = { page: 4, offset: 0.3, left: 0, scale: 1.5, mode: "custom" as const, rotation: 90 };
    h.transport.mockResolvedValueOnce(pdf);
    await h.opening.file(pdf.document.path, null, undefined, position);
    expect(h.display).toHaveBeenCalledWith(pdf, null, expect.any(Function), expect.any(Object), position);
    expect(h.transport).toHaveBeenCalledWith("open_document_file", { path: pdf.document.path, sourcePath: null, requestId: expect.any(String) });
    await h.opening.clear();
  });
  /** A temporary atomic replacement gap keeps the source identity available for a queued retry. */
  it("preserves the source on reload failure and accepts its later replacement", async () => {
    const h = harness();
    h.transport.mockImplementation(async command => {
      if (command === "reload_document_file") throw new Error("source temporarily missing");
      return command === "open_document_file" ? pdf : undefined;
    });
    await h.opening.file(pdf.document.path);
    expect(await h.opening.reload(pdf.document.path)).toBe(false);
    expect(h.error).toHaveBeenCalledWith(expect.objectContaining({ message: "source temporarily missing" }), true);
    h.transport.mockImplementation(async command => command === "reload_document_file"
      ? { ...pdf, document: { ...pdf.document, handle: "replacement" } } : undefined);
    expect(await h.opening.reload(pdf.document.path)).toBe(true);
    expect(h.display).toHaveBeenLastCalledWith(expect.objectContaining({ document: expect.objectContaining({ path: pdf.document.path }) }),
      null, expect.any(Function), expect.objectContaining({ metadata: expect.objectContaining({ handle: "replacement" }) }));
    await h.opening.clear();
  });
  /** Picker/tree/drop/restore/link paths share one command; reload changes only its native policy. */
  it("dispatches file, reload, and OS handoff through the same discriminated contract", async () => {
    const h = harness();
    h.transport.mockResolvedValueOnce(pdf);
    expect(await h.opening.file(pdf.document.path, "page=3")).toBe(true);
    expect(h.transport).toHaveBeenCalledWith("open_document_file", expect.objectContaining({ path: pdf.document.path, requestId: expect.any(String) }));
    expect(h.display).toHaveBeenCalledWith(pdf, "page=3", expect.any(Function), expect.objectContaining({ metadata: pdf.document }));
    h.transport.mockResolvedValueOnce({ ...pdf, document: { ...pdf.document, handle: "pdf-2" } });
    expect(await h.opening.reload(pdf.document.path)).toBe(true);
    expect(h.transport).toHaveBeenCalledWith("reload_document_file", expect.any(Object));
    expect(h.transport).toHaveBeenCalledWith("release_pdf_document", { handle: "pdf-1" });
    h.transport.mockResolvedValueOnce({ kind: "document", document: markdown });
    expect(await h.opening.incoming("file:///Notes/readme.md")).toBe(true);
    expect(h.display).toHaveBeenLastCalledWith(markdown, null, expect.any(Function), null);
    expect(h.transport).toHaveBeenCalledWith("release_pdf_document", { handle: "pdf-2" });
  });

  /** A folder handoff leaves the active file lease intact and updates only the folder browser. */
  it("keeps PDF ownership when an incoming folder opens", async () => {
    const h = harness();
    h.transport.mockResolvedValueOnce(pdf);
    await h.opening.file(pdf.document.path);
    h.transport.mockResolvedValueOnce({ kind: "folder", path: "/Notes", folders: [] });
    await h.opening.incoming("file:///Notes");
    expect(h.folder).toHaveBeenCalledWith("/Notes", []);
    expect(h.transport.mock.calls.filter(([command]) => command === "release_pdf_document")).toHaveLength(0);
    await h.opening.clear();
    expect(h.transport).toHaveBeenCalledWith("release_pdf_document", { handle: "pdf-1" });
  });

  /** Superseded successful PDF results release their handles instead of replacing a newer document. */
  it("disposes stale PDF results and ignores stale failures", async () => {
    const h = harness();
    let complete!: (result: OpenedContent) => void;
    h.transport.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const old = h.opening.file("/Notes/old.pdf");
    h.transport.mockImplementation(async command => command === "open_document_file" ? markdown : undefined);
    await h.opening.file(markdown.path);
    complete(pdf);
    expect(await old).toBe(false);
    expect(h.display).toHaveBeenCalledTimes(1);
    expect(h.error).not.toHaveBeenCalled();
    expect(h.transport).toHaveBeenCalledWith("cancel_pdf_preparation", expect.any(Object));
    expect(h.transport).toHaveBeenCalledWith("release_pdf_document", { handle: "pdf-1" });
  });

  /** Renderer failures release both old and newly prepared snapshots. */
  it("cleans up failed display and reports only the active error", async () => {
    const h = harness();
    h.transport.mockResolvedValueOnce(pdf);
    h.display.mockRejectedValueOnce(new Error("display failed"));
    expect(await h.opening.file(pdf.document.path)).toBe(false);
    expect(h.error).toHaveBeenCalledWith(expect.objectContaining({ message: "display failed" }));
    expect(h.transport).toHaveBeenCalledWith("release_pdf_document", { handle: "pdf-1" });
  });

  /** Exiting to an embedded document invalidates an unfinished file preparation. */
  it("releases a native result delivered after clearing the document", async () => {
    const h = harness();
    let complete!: (result: OpenedContent) => void;
    h.transport.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const opening = h.opening.file("/Notes/source.pdf");
    await h.opening.clear();
    complete(pdf);
    expect(await opening).toBe(false);
    expect(h.display).not.toHaveBeenCalled();
    expect(h.transport).toHaveBeenCalledWith("release_pdf_document", { handle: "pdf-1" });
  });

  /** Only positive finite page numbers are passed on as PDF page destinations. */
  it("validates PDF page fragments", () => {
    expect(pdfPage("page=12")).toBe(12);
    for (const fragment of [null, "heading", "page=0", "page=-2", "page=1.5", "page=Infinity", "page=999999999999999999", "page=2&zoom=100"]) {
      expect(pdfPage(fragment)).toBeNull();
    }
  });

  /** Embedded-document rendering cannot commit after another filesystem request supersedes it. */
  it("invalidates the embedded-document guard when a new request starts", async () => {
    const h = harness();
    const isCurrent = await h.opening.clear();
    expect(isCurrent()).toBe(true);
    h.transport.mockResolvedValueOnce(markdown);
    await h.opening.file(markdown.path);
    expect(isCurrent()).toBe(false);
  });

  /** Folder handoffs must not invalidate a PDF renderer that is still waiting for its first paint. */
  it("keeps the display lifetime current during a folder handoff", async () => {
    const h = harness();
    let finish!: () => void;
    let started!: () => void;
    let current!: () => boolean;
    const rendering = new Promise<void>(resolve => { started = resolve; });
    const opening = createDocumentOpening({
      display: async (_document, _fragment, isCurrent) => {
        current = isCurrent; started(); await new Promise<void>(resolve => { finish = resolve; });
      }, folder: h.folder, error: h.error,
    }, h.transport as DocumentTransport);
    h.transport.mockResolvedValueOnce(pdf);
    const showing = opening.file(pdf.document.path);
    await rendering;
    h.transport.mockResolvedValueOnce({ kind: "folder", path: "/Notes", folders: [] });
    await opening.incoming("file:///Notes");
    expect(current()).toBe(true);
    finish();
    expect(await showing).toBe(true);
    await opening.clear();
  });

  /** Renderer teardown precedes native lease release on clear, including an asynchronous destructor. */
  it("stops rendering before releasing the native snapshot", async () => {
    const h = harness();
    const events: string[] = [];
    const opening = createDocumentOpening({ display: h.display, folder: h.folder, error: h.error,
      reset: async () => { events.push("renderer stopped"); } }, async <T>(command: string, args: Record<string, unknown>) => {
      if (command === "release_pdf_document") events.push("snapshot released");
      return h.transport(command, args) as Promise<T>;
    });
    h.transport.mockResolvedValueOnce(pdf);
    await opening.file(pdf.document.path);
    events.length = 0;
    await opening.clear();
    expect(events).toEqual(["renderer stopped", "snapshot released"]);
  });
});
