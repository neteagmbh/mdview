import { invoke } from "@tauri-apps/api/core";
import { ownPdf, type DocumentTransport, type PdfResource, type PreparedPdf } from "./documents";
import type { DocumentTreeNode } from "./recent-tree";
import type { IncomingContent } from "./incoming-documents";
import type { PdfPosition } from "./pdf-position";

/** Common native result for picker, tree, drop, restore, relative links, and reloads. */
export type OpenedContent =
  | { kind: "markdown"; path: string; content: string; recentFolders: DocumentTreeNode[] }
  | { kind: "pdf"; document: PreparedPdf; recentFolders: DocumentTreeNode[] };

/** Strictly parses a relative PDF page destination without interpreting arbitrary PDF actions. */
export function pdfPage(fragment: string | null): number | null {
  const match = fragment?.match(/^page=([1-9]\d*)$/i);
  const page = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(page) ? page : null;
}

/** Shell callbacks keep routing and native ownership separate from renderer implementations. */
export interface DocumentOpeningHandlers {
  /** Renders only while the supplied request remains current. */
  display: (document: OpenedContent, fragment: string | null, isCurrent: () => boolean,
    resource: PdfResource | null, position?: PdfPosition | null) => Promise<void>;
  /** Cancels the active renderer before its resource lease is released. */
  reset?: () => Promise<void>;
  /** Updates the folder browser without closing the active document. */
  folder: (path: string, folders: DocumentTreeNode[]) => void;
  /** Displays failures from the latest request only. */
  error: (error: unknown, preserveSource?: boolean) => void;
}

/** Serializes entry-point ownership and disposes stale PDF results and superseded active leases. */
export function createDocumentOpening(handlers: DocumentOpeningHandlers, transport: DocumentTransport = invoke) {
  let generation = 0;
  let displayGeneration = 0;
  let pending: string | null = null;
  let active: PdfResource | null = null;

  /** Invalidates pending native work; an early cancellation race is also covered after response delivery. */
  function cancel(): void {
    generation++;
    if (pending) void transport("cancel_pdf_preparation", { requestId: pending }).catch(() => undefined);
    pending = null;
  }

  /** Releases the active lease when leaving filesystem content or closing the application. */
  async function clear(): Promise<() => boolean> {
    cancel();
    displayGeneration++;
    const current = generation;
    const previous = active;
    active = null;
    try { await handlers.reset?.(); }
    finally { await previous?.release(); }
    return () => current === generation;
  }

  /** Uses the same result contract for explicit/native opening and source-only reloads. */
  async function open(command: string, args: Record<string, unknown>, fragment: string | null,
    position?: PdfPosition | null): Promise<boolean> {
    cancel();
    const current = generation;
    const requestId = crypto.randomUUID();
    pending = requestId;
    let next: PdfResource | null = null;
    let ownsDisplay = () => false;
    /** Guards both delayed IPC results and asynchronous Markdown rendering. */
    const isCurrent = () => current === generation;
    try {
      if (command !== "open_incoming_document") {
        displayGeneration++;
        if (handlers.reset) await handlers.reset();
      }
      if (!isCurrent()) return false;
      const result = await transport<OpenedContent | IncomingContent<OpenedContent>>(command, { ...args, requestId });
      const document = result.kind === "document" ? result.document
        : result.kind === "folder" ? null : result;
      if (document?.kind === "pdf") next = ownPdf(document.document, transport);
      if (!isCurrent()) { await next?.release(); return false; }
      if (result.kind === "folder") { handlers.folder(result.path, result.folders); return true; }
      if (!document) throw new Error("Invalid document response.");
      if (command === "open_incoming_document") {
        displayGeneration++;
        if (handlers.reset) await handlers.reset();
      }
      if (!isCurrent()) { await next?.release(); return false; }
      const previous = active;
      active = next;
      const displayTicket = displayGeneration;
      ownsDisplay = () => displayTicket === displayGeneration;
      try {
        if (position) await handlers.display(document, fragment, ownsDisplay, next, position);
        else await handlers.display(document, fragment, ownsDisplay, next);
      }
      finally { await previous?.release(); }
      return ownsDisplay();
    } catch (error) {
      await next?.release().catch(() => undefined);
      if (isCurrent() || ownsDisplay()) {
        const previous = active;
        active = null;
        await previous?.release().catch(() => undefined);
        if (command === "reload_document_file") handlers.error(error, true);
        else handlers.error(error);
      }
      return false;
    } finally {
      if (pending === requestId) pending = null;
    }
  }
  return {
    /** Opens through the same native classifier and authorization checks for every filesystem path. */
    file: (path: string, fragment: string | null = null, sourcePath?: string, position?: PdfPosition | null) =>
      open("open_document_file", { path, sourcePath: sourcePath ?? null }, fragment, position),
    /** Re-prepares content without modifying folder ordering or watcher roots. */
    reload: (path: string, fragment: string | null = null) => open("reload_document_file", { path }, fragment),
    /** Dispatches OS URLs while retaining startup precedence in the existing incoming queue. */
    incoming: (url: string) => open("open_incoming_document", { url }, null),
    clear,
  };
}
