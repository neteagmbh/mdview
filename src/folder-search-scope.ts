import type { DocumentTreeNode } from "./recent-tree";

/** Normalizes native separators and Windows case for component-aware root comparisons. */
function comparable(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//") ? normalized.toLowerCase() : normalized;
}

/** Resolves the covering recent-folder root, keeping nested PDF and Markdown selection consistent. */
export function folderSearchRoot(folders: DocumentTreeNode[], path: string): string | null {
  const target = comparable(path);
  const candidates = folders.filter(folder => {
    const root = comparable(folder.path);
    return target === root || target.startsWith(`${root}/`);
  });
  candidates.sort((a, b) => b.path.length - a.path.length);
  if (candidates[0]) return candidates[0].path;
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index < 0 ? null : index === 0 || (index === 2 && /^[a-z]:/i.test(path))
    ? path.slice(0, index + 1) : path.slice(0, index);
}

/** Tracks explicit folder selection separately from the displayed document and LRU ordering. */
export function createFolderSearchScope() {
  let folders: DocumentTreeNode[] = [];
  let selected: { path: string; directory: boolean } | null = null;
  return {
    /** Refreshing or promoting roots never replaces an explicitly chosen source. */
    refresh(value: DocumentTreeNode[]) {
      folders = value;
      if (selected?.directory && !folders.some(folder => comparable(folder.path) === comparable(selected!.path))) selected = null;
    },
    /** Opening either document type selects its covering root rather than its nested parent. */
    file(path: string) { selected = { path, directory: false }; },
    /** A native folder handoff/picker can change search scope without closing the active PDF. */
    folder(path: string) { selected = { path, directory: true }; },
    /** Current directory backend scope; folder/all-folder searches remain Markdown-only. */
    get root(): string | null {
      return selected ? selected.directory ? selected.path : folderSearchRoot(folders, selected.path) : null;
    },
  };
}
