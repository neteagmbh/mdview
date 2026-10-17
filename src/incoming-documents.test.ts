import { describe, expect, it, vi } from "vitest";
import {
  displayIncomingContent,
  initializeIncomingDocuments,
  type IncomingDocumentHandlers,
} from "./incoming-documents";
import type { MarkdownTreeNode } from "./recent-tree";

/** Builds an OS handoff fixture with explicit runtime notification control. */
function fixture(batches: string[][]) {
  let notify: () => void = () => undefined;
  const handlers: IncomingDocumentHandlers = {
    listen: vi.fn(async (listener) => { notify = listener; }),
    take: vi.fn(async () => batches.shift() ?? []),
    initializeLayout: vi.fn(async () => undefined),
    restoreDocument: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    reportAdditional: vi.fn(),
    reportError: vi.fn(),
  };
  return { handlers, notify: () => notify() };
}

describe("initializeIncomingDocuments", () => {
  /** Gives an OS folder request priority over restoring a previous document. */
  it("consumes a startup folder request without restoring the previous document", async () => {
    const { handlers } = fixture([["file:///Markdown%20Notes/"]]);
    await initializeIncomingDocuments(handlers);
    expect(handlers.open).toHaveBeenCalledExactlyOnceWith("file:///Markdown%20Notes/");
    expect(handlers.restoreDocument).not.toHaveBeenCalled();
  });

  /** Ensures incoming launch files take priority over the last session's document. */
  it("subscribes before consuming startup files and skips restoration", async () => {
    const { handlers } = fixture([["file:///requested.md"]]);
    await initializeIncomingDocuments(handlers);
    expect(handlers.open).toHaveBeenCalledExactlyOnceWith("file:///requested.md");
    expect(handlers.restoreDocument).not.toHaveBeenCalled();
    expect(vi.mocked(handlers.listen).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(handlers.take).mock.invocationCallOrder[0]);
  });

  /** Keeps normal session restoration when the app launches without a requested file. */
  it("restores the last document on ordinary startup", async () => {
    const { handlers } = fixture([]);
    await initializeIncomingDocuments(handlers);
    expect(handlers.restoreDocument).toHaveBeenCalledOnce();
    expect(handlers.open).not.toHaveBeenCalled();
  });

  /** Catches requests arriving while asynchronous session restoration is still running. */
  it("opens a file delivered during restoration after restoring", async () => {
    const batches: string[][] = [[]];
    const { handlers, notify } = fixture(batches);
    handlers.restoreDocument = vi.fn(async () => {
      batches.push(["file:///late.md"]);
      notify();
    });
    await initializeIncomingDocuments(handlers);
    expect(handlers.open).toHaveBeenCalledExactlyOnceWith("file:///late.md");
  });

  /** Serializes warm requests arriving during an existing document's asynchronous load. */
  it("drains notifications arriving during a warm open", async () => {
    const batches: string[][] = [];
    const { handlers, notify } = fixture(batches);
    await initializeIncomingDocuments(handlers);
    handlers.open = vi.fn(async (url) => {
      if (url === "file:///first.md") {
        batches.push(["file:///second.md"]);
        notify();
      }
    });
    batches.push(["file:///first.md"]);
    notify();
    await vi.waitFor(() => expect(handlers.open).toHaveBeenCalledTimes(2));
    expect(vi.mocked(handlers.open).mock.calls).toEqual([
      ["file:///first.md"], ["file:///second.md"],
    ]);
  });

  /** Reports extra delivered files without silently replacing the first document. */
  it("opens the first file and reports additional attachments", async () => {
    const { handlers } = fixture([["file:///one.md", "file:///two.md"]]);
    await initializeIncomingDocuments(handlers);
    expect(handlers.open).toHaveBeenCalledExactlyOnceWith("file:///one.md");
    expect(handlers.reportAdditional).toHaveBeenCalledExactlyOnceWith(1);
  });

  /** Keeps incoming read errors visible instead of replacing them with the restored document. */
  it("reports failed incoming reads and still handles later requests", async () => {
    const batches = [["file:///missing.md"]];
    const { handlers, notify } = fixture(batches);
    const error = new Error("File unavailable");
    handlers.open = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    await initializeIncomingDocuments(handlers);
    expect(handlers.reportError).toHaveBeenCalledExactlyOnceWith(error);
    expect(handlers.restoreDocument).not.toHaveBeenCalled();
    batches.push(["file:///available.md"]);
    notify();
    await vi.waitFor(() => expect(handlers.open).toHaveBeenCalledTimes(2));
  });
});

describe("displayIncomingContent", () => {
  /** Preserves the selected folder path and its Markdown tree without opening it as a file. */
  it("routes a folder to the folder browser", async () => {
    const folders: MarkdownTreeNode[] = [{
      name: "Notes", path: "/Notes", isDirectory: true, isNew: false, pinned: false,
      children: [{
        name: "readme.md", path: "/Notes/readme.md", isDirectory: false,
        isNew: false, pinned: false, children: [],
      }],
    }];
    const displayDocument = vi.fn(async () => undefined);
    const displayFolder = vi.fn();
    await displayIncomingContent({ kind: "folder", path: "/Notes", folders }, displayDocument, displayFolder);
    expect(displayFolder).toHaveBeenCalledExactlyOnceWith("/Notes", folders);
    expect(displayDocument).not.toHaveBeenCalled();
  });

  /** Keeps existing incoming Markdown files on the document rendering path. */
  it("routes a document to the viewer", async () => {
    const document = { path: "/Notes/readme.md", content: "# Notes" };
    const displayDocument = vi.fn(async () => undefined);
    const displayFolder = vi.fn();
    await displayIncomingContent({ kind: "document", document }, displayDocument, displayFolder);
    expect(displayDocument).toHaveBeenCalledExactlyOnceWith(document);
    expect(displayFolder).not.toHaveBeenCalled();
  });
});
