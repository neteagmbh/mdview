import type { MarkdownTreeNode } from "./recent-tree";

/** Bridges OS file and folder requests to the viewer before session restoration. */
export interface IncomingDocumentHandlers {
  listen: (notify: () => void) => Promise<unknown>;
  take: () => Promise<string[]>;
  initializeLayout: () => Promise<void>;
  restoreDocument: () => Promise<void>;
  open: (url: string) => Promise<void>;
  reportAdditional: (count: number) => void;
  reportError: (error: unknown) => void;
}

/** Serializes startup/runtime requests and gives newly received files priority over restoration. */
export async function initializeIncomingDocuments(handlers: IncomingDocumentHandlers): Promise<void> {
  let ready = false;
  let dirty = true;
  let pending: Promise<boolean> | null = null;

  /** Consumes queued batches until no notification arrived during an asynchronous read. */
  function drain(): Promise<boolean> {
    if (pending) {
      return pending;
    }
    pending = (async () => {
      let received = false;
      while (dirty) {
        dirty = false;
        const urls = await handlers.take();
        if (urls.length > 0) {
          received = true;
          try {
            await handlers.open(urls[0]);
          } catch (error) {
            handlers.reportError(error);
          }
          if (urls.length > 1) {
            handlers.reportAdditional(urls.length - 1);
          }
        }
      }
      return received;
    })().finally(() => { pending = null; });
    return pending;
  }

  await handlers.listen(() => {
    dirty = true;
    if (ready) {
      void drain().catch(handlers.reportError);
    }
  });
  await handlers.initializeLayout();
  if (!await drain()) {
    await handlers.restoreDocument();
  }
  ready = true;
  if (dirty) {
    await drain();
  }
}
/** A native handoff resolved into document content or a folder's Markdown tree. */
export type IncomingContent<Document> =
  | { kind: "document"; document: Document }
  | { kind: "folder"; path: string; folders: MarkdownTreeNode[] };

/** Routes an incoming folder to the browser and a Markdown file to the document view. */
export async function displayIncomingContent<Document>(
  content: IncomingContent<Document>,
  displayDocument: (document: Document) => Promise<void>,
  displayFolder: (path: string, folders: MarkdownTreeNode[]) => void,
): Promise<void> {
  if (content.kind === "folder") {
    displayFolder(content.path, content.folders);
  } else {
    await displayDocument(content.document);
  }
}
