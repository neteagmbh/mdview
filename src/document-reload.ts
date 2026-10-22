/** Coalesces save bursts and retries briefly while an editor atomically replaces the source. */
export function createDocumentReload(currentPath: () => string | null, reload: (path: string) => Promise<boolean>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let queued = false;
  let requested: string | null = null;
  let retries = 0;
  /** Runs at most one reload at a time, dropping work when the user changes documents. */
  async function run(): Promise<void> {
    timer = undefined;
    const path = requested;
    if (!path || path !== currentPath()) return;
    if (running) { queued = true; return; }
    running = true;
    let success = false;
    try { success = await reload(path); }
    catch { success = false; }
    finally {
      running = false;
      if (requested === currentPath() && (queued || (path === currentPath() && !success && retries++ < 2))) {
        queued = false;
        timer = setTimeout(() => { void run(); }, 250);
      } else queued = false;
    }
  }
  return {
    /** Debounces watcher/manual requests without cancelling an active renderer repeatedly. */
    request() {
      requested = currentPath(); retries = 0;
      clearTimeout(timer);
      if (running) queued = true;
      else timer = setTimeout(() => { void run(); }, 150);
    },
  };
}
