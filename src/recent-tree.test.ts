// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  createRecentTreeNode,
  type MarkdownTreeNode,
  updateRecentTreeActivePath,
} from "./recent-tree";

describe("createRecentTreeNode", () => {
  /** Verifies that only recent-folder roots expose removal controls. */
  it("adds a remove control only to a top-level recent folder", () => {
    const node: MarkdownTreeNode = {
      name: "docs",
      path: "/docs",
      isDirectory: true,
      children: [
        {
          name: "guides",
          path: "/docs/guides",
          isDirectory: true,
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
      },
      true,
    );

    expect(root.querySelectorAll(".remove-folder-button")).toHaveLength(1);
    expect(root.querySelector(".tree-folder .remove-folder-button")).toBeNull();
    root.querySelector<HTMLButtonElement>(".remove-folder-button")?.click();
    expect(removeFolder).toHaveBeenCalledWith("/docs", expect.any(HTMLButtonElement));
  });

  /** Verifies active-file accessibility state and click routing. */
  it("routes file clicks and marks the active file", () => {
    const openFile = vi.fn();
    const file = createRecentTreeNode(
      { name: "README.md", path: "/docs/README.md", isDirectory: false, children: [] },
      {
        activePath: "/docs/README.md",
        folderOpenState: new Map(),
        openFile,
        removeFolder: vi.fn(),
      },
    ) as HTMLButtonElement;

    expect(file.getAttribute("aria-current")).toBe("page");
    file.click();
    expect(openFile).toHaveBeenCalledWith("/docs/README.md");
  });

  /** Verifies root and nested folder state survives rebuilding the tree. */
  it("restores folder open state during the session", () => {
    const node: MarkdownTreeNode = {
      name: "docs",
      path: "/docs",
      isDirectory: true,
      children: [
        {
          name: "guides",
          path: "/docs/guides",
          isDirectory: true,
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
