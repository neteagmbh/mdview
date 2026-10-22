import { expect, it } from "vitest";
import { createFolderSearchScope, folderSearchRoot } from "./folder-search-scope";
import type { DocumentTreeNode } from "./recent-tree";

/** Builds native-style root metadata without coupling scope resolution to its children. */
function root(path: string): DocumentTreeNode {
  return { path, name: path, isDirectory: true, isNew: false, pinned: false, children: [] };
}

/** Nested PDF selection and LRU promotion must not narrow folder search to one subdirectory. */
it("preserves covering roots across mixed-file selection and recent-folder promotion", () => {
  const scope = createFolderSearchScope();
  scope.refresh([root("/notes"), root("/other")]);
  scope.file("/notes/nested/reference.PDF");
  expect(scope.root).toBe("/notes");
  scope.refresh([root("/other"), root("/notes")]);
  expect(scope.root).toBe("/notes");
  scope.file("/notes/README.md");
  expect(scope.root).toBe("/notes");
  scope.folder("/other");
  expect(scope.root).toBe("/other");
  scope.refresh([root("/notes")]);
  expect(scope.root).toBeNull();
});

/** Native Windows separators/case and similarly prefixed folders require component-aware comparisons. */
it("resolves overlapping roots, native path boundaries, and standalone source parents", () => {
  expect(folderSearchRoot([root("/notes"), root("/notes/sub")], "/notes/sub/a.pdf")).toBe("/notes/sub");
  expect(folderSearchRoot([root("/notes")], "/notes-other/sub/a.pdf")).toBe("/notes-other/sub");
  expect(folderSearchRoot([root("C:\\Notes")], "c:\\notes\\nested\\a.PDF")).toBe("C:\\Notes");
  expect(folderSearchRoot([], "C:\\a.pdf")).toBe("C:\\");
  expect(folderSearchRoot([], "/a.pdf")).toBe("/");
  expect(folderSearchRoot([], "readme.md")).toBeNull();
});
