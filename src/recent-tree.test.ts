// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import styles from "./styles.css?raw";
import {
  createRecentTreeNode,
  type MarkdownTreeNode,
  sortPinnedFirst,
  updateRecentTreeActivePath,
} from "./recent-tree";

describe("createRecentTreeNode", () => {
  /** The shared status stylesheet must not override the hidden state once a folder has loaded. */
  it("hides stale loading/empty status text beside a populated mixed tree", () => {
    const style = document.createElement("style");
    style.textContent = styles;
    const status = document.createElement("p");
    status.className = "tree-status";
    status.textContent = "Open a folder to browse its Markdown and PDF files.";
    document.head.append(style); document.body.append(status);
    status.hidden = true;
    expect(getComputedStyle(status).display).toBe("none");
    status.hidden = false;
    expect(getComputedStyle(status).display).toBe("block");
    status.remove(); style.remove();
  });
  /** Mixed types retain independent identity, New markers, active state, and collapsed branches on refresh. */
  it("labels PDF and Markdown files while preserving mixed-tree interaction state", () => {
    const child = (name: string): MarkdownTreeNode => ({ name, path: `/docs/nested/${name}`,
      isDirectory: false, isNew: true, pinned: false, children: [] });
    const node: MarkdownTreeNode = { name: "docs", path: "/docs", isDirectory: true, isNew: false,
      pinned: true, children: [{ name: "nested", path: "/docs/nested", isDirectory: true,
        isNew: false, pinned: false, children: [child("Notes.markdown"), child("Reference.PDF")] }] };
    const actions = { activePath: "/docs/nested/Reference.PDF", folderOpenState: new Map([["/docs/nested", true]]),
      openFile: vi.fn(), removeFolder: vi.fn(), pinFolder: vi.fn(), copyText: vi.fn() };
    const tree = createRecentTreeNode(node, actions, true);
    const pdf = tree.querySelector<HTMLButtonElement>('[data-kind="pdf"]')!;
    expect(pdf.getAttribute("aria-label")).toBe("Reference.PDF, PDF document, new");
    expect(pdf.firstElementChild?.classList.contains("document-type-icon")).toBe(true);
    expect(pdf.querySelector(".document-type-icon text")?.textContent).toBe("PDF");
    expect(pdf.querySelector(".document-type-icon")?.getAttribute("aria-hidden")).toBe("true");
    expect(tree.querySelector('[data-kind="markdown"] .document-type-icon text')?.textContent).toBe("MD");
    expect(pdf.children[1].className).toBe("tree-file-name");
    expect(tree.querySelectorAll(".tree-file-new-badge")).toHaveLength(2);
    pdf.click();
    expect(actions.openFile).toHaveBeenCalledWith("/docs/nested/Reference.PDF");
    updateRecentTreeActivePath(tree, "/docs/nested/Notes.markdown");
    expect(pdf.getAttribute("aria-current")).toBe("false");
    expect(tree.querySelector('[data-kind="markdown"]')?.getAttribute("aria-current")).toBe("page");
    const nested = tree.querySelector("details")!;
    nested.open = false; nested.dispatchEvent(new Event("toggle"));
    const rebuilt = createRecentTreeNode(node, actions, true);
    expect(rebuilt.querySelector("details")?.open).toBe(false);
    expect(rebuilt.querySelector(".pin-folder-button")?.getAttribute("aria-pressed")).toBe("true");
    expect(rebuilt.querySelectorAll(".tree-file-new-badge")).toHaveLength(2);
  });

  /** Empty-state copy applies to PDF-only and mixed roots as well as Markdown folders. */
  it("describes both supported formats in an empty root", () => {
    const tree = createRecentTreeNode({ name: "empty", path: "/empty", isDirectory: true,
      isNew: false, pinned: false, children: [] }, { activePath: null, folderOpenState: new Map(),
      openFile: vi.fn(), removeFolder: vi.fn(), pinFolder: vi.fn(), copyText: vi.fn() }, true);
    expect(tree.querySelector(".tree-empty")?.textContent).toBe("No Markdown or PDF files");
  });
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
        copyText: vi.fn(),
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
        copyText: vi.fn(),
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
        copyText: vi.fn(),
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
      copyText: vi.fn(),
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

  /** Verifies right-clicking a document opens a menu that copies name or full path. */
  it("copies the document name or path from the context menu", () => {
    const copyText = vi.fn();
    const file = createRecentTreeNode(
      {
        name: "README.md",
        path: "/docs/README.md",
        isDirectory: false,
        isNew: false,
        pinned: false,
        children: [],
      },
      {
        activePath: null,
        folderOpenState: new Map(),
        openFile: vi.fn(),
        removeFolder: vi.fn(),
        pinFolder: vi.fn(),
        copyText,
      },
    ) as HTMLButtonElement;
    document.body.append(file);

    file.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    let menu = document.querySelector(".tree-context-menu")!;
    const items = menu.querySelectorAll<HTMLButtonElement>(".tree-context-menu-item");
    expect(items).toHaveLength(2);

    items[0].click();
    expect(copyText).toHaveBeenCalledWith("README.md");
    expect(document.querySelector(".tree-context-menu")).toBeNull();

    file.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    menu = document.querySelector(".tree-context-menu")!;
    menu.querySelectorAll<HTMLButtonElement>(".tree-context-menu-item")[1].click();
    expect(copyText).toHaveBeenCalledWith("/docs/README.md");
    expect(document.querySelector(".tree-context-menu")).toBeNull();

    file.remove();
  });

  /** Verifies the context menu closes on Escape and on clicking elsewhere. */
  it("dismisses the context menu on Escape or an outside click", () => {
    const file = createRecentTreeNode(
      {
        name: "README.md",
        path: "/docs/README.md",
        isDirectory: false,
        isNew: false,
        pinned: false,
        children: [],
      },
      {
        activePath: null,
        folderOpenState: new Map(),
        openFile: vi.fn(),
        removeFolder: vi.fn(),
        pinFolder: vi.fn(),
        copyText: vi.fn(),
      },
    ) as HTMLButtonElement;
    document.body.append(file);

    file.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(document.querySelector(".tree-context-menu")).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".tree-context-menu")).toBeNull();

    file.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(document.querySelector(".tree-context-menu")).not.toBeNull();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(document.querySelector(".tree-context-menu")).toBeNull();

    file.remove();
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
