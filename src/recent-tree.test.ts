// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  createRecentTreeNode,
  type MarkdownTreeNode,
  sortPinnedFirst,
  updateRecentTreeActivePath,
} from "./recent-tree";

describe("createRecentTreeNode", () => {
  /** Verifies that only recent-folder roots expose removal controls. */
  it("adds a remove control only to a top-level recent folder", () => {
    const node: MarkdownTreeNode = {
      name: "docs",
      path: "/docs",
      isDirectory: true,
      isNew: false,
      pinned: false,
      children: [
        {
          name: "guides",
          path: "/docs/guides",
          isDirectory: true,
          isNew: false,
          pinned: false,
          children: [],
        },
      ],
    };
    const removeFolder = vi.fn();
    const root = createRecentTreeNode(
      node,
      {
        activePath: null,
        folderOpenState: new Map(),
        openFile: vi.fn(),
        removeFolder,
        pinFolder: vi.fn(),
      },
      true,
    );

    expect(root.querySelectorAll(".remove-folder-button")).toHaveLength(1);
    expect(root.querySelector(".tree-folder .remove-folder-button")).toBeNull();
    root.querySelector<HTMLButtonElement>(".remove-folder-button")?.click();
    expect(removeFolder).toHaveBeenCalledWith("/docs", expect.any(HTMLButtonElement));
  });

  /** Verifies the pin control reflects and toggles the folder's pin state. */
  it("toggles the pin state of a recent-folder root", () => {
    const node: MarkdownTreeNode = {
      name: "docs",
      path: "/docs",
      isDirectory: true,
      isNew: false,
      pinned: false,
      children: [],
    };
    const pinFolder = vi.fn();
    const root = createRecentTreeNode(
      node,
      {
        activePath: null,
        folderOpenState: new Map(),
        openFile: vi.fn(),
        removeFolder: vi.fn(),
        pinFolder,
      },
      true,
    );

    const pinButton = root.querySelector<HTMLButtonElement>(".pin-folder-button")!;
    expect(pinButton.getAttribute("aria-pressed")).toBe("false");
    pinButton.click();
    expect(pinFolder).toHaveBeenCalledWith("/docs", true, pinButton);
  });

  /** Verifies active-file accessibility state, click routing, and the new-document badge. */
  it("routes file clicks, marks the active file, and shows a new-document badge", () => {
    const openFile = vi.fn();
    const file = createRecentTreeNode(
      {
        name: "README.md",
        path: "/docs/README.md",
        isDirectory: false,
        isNew: true,
        pinned: false,
        children: [],
      },
      {
        activePath: "/docs/README.md",
        folderOpenState: new Map(),
        openFile,
        removeFolder: vi.fn(),
        pinFolder: vi.fn(),
      },
    ) as HTMLButtonElement;

    expect(file.getAttribute("aria-current")).toBe("page");
    expect(file.querySelector(".tree-file-new-badge")).not.toBeNull();
    file.click();
    expect(openFile).toHaveBeenCalledWith("/docs/README.md");
  });

  /** Verifies root and nested folder state survives rebuilding the tree. */
  it("restores folder open state during the session", () => {
    const node: MarkdownTreeNode = {
      name: "docs",
      path: "/docs",
      isDirectory: true,
      isNew: false,
      pinned: false,
      children: [
        {
          name: "guides",
          path: "/docs/guides",
          isDirectory: true,
          isNew: false,
          pinned: false,
          children: [],
        },
      ],
    };
    const folderOpenState = new Map<string, boolean>();
    const actions = {
      activePath: null,
      folderOpenState,
      openFile: vi.fn(),
      removeFolder: vi.fn(),
      pinFolder: vi.fn(),
    };

    const firstRoot = createRecentTreeNode(node, actions, true);
    firstRoot.querySelector<HTMLButtonElement>(".tree-root-toggle")?.click();
    const firstNested = firstRoot.querySelector<HTMLDetailsElement>(".tree-folder")!;
    firstNested.open = true;
    firstNested.dispatchEvent(new Event("toggle"));

    const rebuiltRoot = createRecentTreeNode(node, actions, true);
    expect(rebuiltRoot.querySelector(".tree-root-children")?.hasAttribute("hidden")).toBe(true);
    expect(rebuiltRoot.querySelector(".tree-root-toggle")?.getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(rebuiltRoot.querySelector<HTMLDetailsElement>(".tree-folder")?.open).toBe(true);
  });

  /** Verifies active markers can change without rebuilding the LRU tree. */
  it("updates the active file marker in place", () => {
    const root = document.createElement("nav");
    root.innerHTML = `
      <button class="tree-file" data-path="/docs/one.md" aria-current="page"></button>
      <button class="tree-file" data-path="/docs/two.md" aria-current="false"></button>
    `;

    updateRecentTreeActivePath(root, null);

    expect(root.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
    expect(root.children).toHaveLength(2);
  });
});

describe("sortPinnedFirst", () => {
  /** Verifies pinned folders move to the front while preserving relative order otherwise. */
  it("orders pinned folders before unpinned ones without reordering within each group", () => {
    const folder = (name: string, pinned: boolean): MarkdownTreeNode => ({
      name,
      path: `/${name}`,
      isDirectory: true,
      isNew: false,
      pinned,
      children: [],
    });
    const folders = [folder("a", false), folder("b", true), folder("c", false), folder("d", true)];

    expect(sortPinnedFirst(folders).map((entry) => entry.name)).toEqual(["b", "d", "a", "c"]);
    expect(folders.map((entry) => entry.name)).toEqual(["a", "b", "c", "d"]);
  });
});
