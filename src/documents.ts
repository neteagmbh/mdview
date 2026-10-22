import { invoke } from "@tauri-apps/api/core";

/** Backend discriminator; filesystem classification remains authoritative in Rust. */
export type DocumentKind = "markdown" | "pdf";

/** Prepared binary document metadata; source identity excludes private snapshot paths. */
export interface PreparedPdf {
  /** Renderer discriminator. */
  kind: Extract<DocumentKind, "pdf">;
  /** Session-only lease, never persisted as document identity. */
  handle: string;
  /** Resolved original source path. */
  path: string;
  /** User-facing source filename. */
  name: string;
  /** Validated snapshot length. */
  size: number;
}

/** Injectable transport for binary IPC and lifecycle regression tests. */
export type DocumentTransport = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

/** Owns one independently releasable viewer or print lease over immutable native bytes. */
export interface PdfResource {
  /** Source metadata and this resource's lease. */
  readonly metadata: PreparedPdf;
  /** Loads bytes through binary IPC; a failed read releases this lease. */
  read: () => Promise<Uint8Array>;
  /** Creates an independent lease so printing can outlive the viewer. */
  retain: () => Promise<PdfResource>;
  /** Closes this lease idempotently; in-flight backend operations retain their own ownership. */
  release: () => Promise<void>;
}

/** Wraps an opaque native lease without retaining a copy of its PDF byte buffer. */
export function ownPdf(metadata: PreparedPdf, transport: DocumentTransport = invoke): PdfResource {
  let closed = false;
  let releasing: Promise<void> | undefined;
  /** Rejects accidental use after disposal before issuing any IPC. */
  function requireOpen(): void {
    if (closed) throw new Error("PDF handle is closed.");
  }
  /** Releases once; a transport error permits retrying cleanup. */
  function release(): Promise<void> {
    closed = true;
    releasing ??= transport<void>("release_pdf_document", { handle: metadata.handle })
      .catch(error => { releasing = undefined; throw error; });
    return releasing;
  }
  return {
    metadata,
    async read() {
      requireOpen();
      try {
        const buffer = await transport<ArrayBuffer>("read_pdf_bytes", { handle: metadata.handle });
        if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== metadata.size) {
          throw new Error("Invalid binary PDF response.");
        }
        requireOpen();
        return new Uint8Array(buffer);
      } catch (error) {
        await release().catch(() => undefined);
        throw error;
      }
    },
    async retain() {
      requireOpen();
      const retained = await transport<PreparedPdf>("retain_pdf_document", { handle: metadata.handle });
      const resource = ownPdf(retained, transport);
      if (closed) {
        await resource.release();
        throw new Error("PDF handle is closed.");
      }
      return resource;
    },
    release,
  };
}

/** Prepares a native snapshot; aborted or stale results are released even if cancellation races startup. */
export async function preparePdfResource(path: string, signal?: AbortSignal,
  transport: DocumentTransport = invoke): Promise<PdfResource> {
  signal?.throwIfAborted();
  const requestId = crypto.randomUUID();
  /** Requests bounded-copy cancellation; post-result cleanup also handles an early IPC race. */
  const cancel = () => { void transport("cancel_pdf_preparation", { requestId }).catch(() => undefined); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const metadata = await transport<PreparedPdf>("prepare_pdf_document", { path, requestId });
    const resource = ownPdf(metadata, transport);
    if (signal?.aborted) {
      await resource.release();
      signal.throwIfAborted();
    }
    return resource;
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
