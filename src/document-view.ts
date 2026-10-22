/** Shell capabilities advertised by the active document renderer. */
export interface RendererCapabilities {
  /** Whether the existing Markdown print path can print this renderer. */
  print: boolean;
  /** Whether the current-file search adapter is available. */
  find: boolean;
  /** Whether the current outline adapter is available. */
  outline: boolean;
}

/** One renderer owns its asynchronous work until disposal finishes. */
export interface DocumentRenderer {
  /** Native source/rendering discriminator. */
  kind: "markdown" | "pdf";
  /** Supported actions, independent of the source filename. */
  capabilities: RendererCapabilities;
  /** Resolves after usable content appears; failures propagate to the opening controller. */
  ready: Promise<void>;
  /** Applies a relative zoom step or resets the scale. */
  zoom: (direction: -1 | 0 | 1) => void;
  /** Cancels tasks and frees workers, listeners, canvases, and native ownership dependencies. */
  destroy: () => Promise<void>;
}

/** Serializes renderer disposal and prevents superseded factories from installing late content. */
export function createDocumentView() {
  let generation = 0;
  let active: { renderer: DocumentRenderer; abort: AbortController } | null = null;
  let cleanup = Promise.resolve();
  /** Aborts synchronously so password dialogs and pending work stop before the next IPC request. */
  function clear(): Promise<void> {
    generation++;
    const previous = active;
    active = null;
    previous?.abort.abort();
    cleanup = cleanup.catch(() => undefined).then(() => previous?.renderer.destroy());
    return cleanup;
  }
  return {
    /** Exposes only the renderer that still owns the active view. */
    get current() { return active?.renderer ?? null; },
    clear,
    /** Mounts a renderer after the previous renderer has finished releasing its resources. */
    async show(factory: (signal: AbortSignal) => DocumentRenderer): Promise<void> {
      const released = clear();
      const ticket = generation;
      await released;
      if (ticket !== generation) throw new DOMException("Document opening cancelled.", "AbortError");
      const abort = new AbortController();
      const renderer = factory(abort.signal);
      active = { renderer, abort };
      try {
        await renderer.ready;
        abort.signal.throwIfAborted();
      } catch (error) {
        if (active?.renderer === renderer) await clear();
        throw error;
      }
    },
  };
}
