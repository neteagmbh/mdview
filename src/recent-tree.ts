export interface MarkdownTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  isNew: boolean;
  pinned: boolean;
  children: MarkdownTreeNode[];
}

export interface RecentTreeActions {
  activePath: string | null;
  folderOpenState: Map<string, boolean>;
  openFile: (path: string) => void;
  removeFolder: (path: string, trigger: HTMLButtonElement) => void | Promise<void>;
  pinFolder: (path: string, pinned: boolean, trigger: HTMLButtonElement) => void | Promise<void>;
  copyText: (text: string) => void | Promise<void>;
}

/** Removes the currently open tree context menu, if any. */
export function closeTreeContextMenu(): void {
  document.querySelector(".tree-context-menu")?.remove();
}

/**
 * Opens a context menu at the pointer position offering to copy a document's
 * name or its full path to the clipboard via the supplied copy action.
 */
export function openTreeContextMenu(
  event: MouseEvent,
  node: Pick<MarkdownTreeNode, "name" | "path">,
  copyText: RecentTreeActions["copyText"],
): void {
  event.preventDefault();
  closeTreeContextMenu();

  const menu = document.createElement("div");
  menu.className = "tree-context-menu";
  menu.setAttribute("role", "menu");

  const close = () => {
    menu.remove();
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKeyDown, true);
  };
  const onPointerDown = (pointerEvent: PointerEvent) => {
    if (!menu.contains(pointerEvent.target as Node)) {
      close();
    }
  };
  const onKeyDown = (keyEvent: KeyboardEvent) => {
    if (keyEvent.key === "Escape") {
      close();
    }
  };

  const entries: Array<[label: string, text: string]> = [
    ["Copy Name", node.name],
    ["Copy Path", node.path],
  ];
  entries.forEach(([label, text]) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "tree-context-menu-item";
    item.setAttribute("role", "menuitem");
    item.textContent = label;
    item.addEventListener("click", () => {
      void copyText(text);
      close();
    });
    menu.append(item);
  });

  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  document.body.append(menu);
  // Keep the menu inside the viewport when opened near the right/bottom edge.
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(0, Math.min(event.clientX, window.innerWidth - rect.width))}px`;
  menu.style.top = `${Math.max(0, Math.min(event.clientY, window.innerHeight - rect.height))}px`;

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);
}

/** Returns a new array with pinned recent-folder roots ordered before unpinned ones. */
export function sortPinnedFirst(folders: MarkdownTreeNode[]): MarkdownTreeNode[] {
  return [...folders].sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

/** Updates the active-file marker without rebuilding or changing the tree. */
export function updateRecentTreeActivePath(root: ParentNode, activePath: string | null): void {
  root.querySelectorAll<HTMLButtonElement>(".tree-file").forEach((button) => {
    button.setAttribute("aria-current", button.dataset.path === activePath ? "page" : "false");
  });
}

/** Appends a directory node's children or its empty-state message. */
function appendChildren(
  container: HTMLElement,
  node: MarkdownTreeNode,
  actions: RecentTreeActions,
): void {
  if (node.children.length === 0) {
    const empty = document.createElement("span");
    empty.className = "tree-empty";
    empty.textContent = "No Markdown files";
    container.append(empty);
    return;
  }

  node.children.forEach((child) => {
    container.append(createRecentTreeNode(child, actions));
  });
}

/** Creates a removable, pinnable top-level entry for a recent folder. */
function createRootNode(node: MarkdownTreeNode, actions: RecentTreeActions): HTMLElement {
  const root = document.createElement("div");
  root.className = "tree-root-entry";

  const row = document.createElement("div");
  row.className = "tree-root-row";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "tree-root-toggle";
  toggle.textContent = node.name;
  toggle.title = node.path;
  const isOpen = actions.folderOpenState.get(node.path) ?? true;
  toggle.setAttribute("aria-expanded", String(isOpen));

  const pin = document.createElement("button");
  pin.type = "button";
  pin.className = "pin-folder-button";
  pin.classList.toggle("pinned", node.pinned);
  pin.title = node.pinned ? `Unpin ${node.name}` : `Pin ${node.name}`;
  pin.setAttribute("aria-label", pin.title);
  pin.setAttribute("aria-pressed", String(node.pinned));
  pin.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M10 2.5v4M6 9.5h8l-1.3 3.2H7.3zM10 12.7V17.5" />
    </svg>
  `;

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-folder-button";
  remove.title = `Remove ${node.name} from recent folders`;
  remove.setAttribute("aria-label", remove.title);
  remove.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M4.5 5.5h11M8 3.5h4M6.5 5.5l.7 11h5.6l.7-11M8.5 8v5.5M11.5 8v5.5" />
    </svg>
  `;

  const children = document.createElement("div");
  children.className = "tree-children tree-root-children";
  children.hidden = !isOpen;
  appendChildren(children, node, actions);

  toggle.addEventListener("click", () => {
    children.hidden = !children.hidden;
    const open = !children.hidden;
    actions.folderOpenState.set(node.path, open);
    toggle.setAttribute("aria-expanded", String(open));
  });
  pin.addEventListener("click", () => {
    void actions.pinFolder(node.path, !node.pinned, pin);
  });
  remove.addEventListener("click", () => {
    void actions.removeFolder(node.path, remove);
  });

  row.append(toggle, pin, remove);
  root.append(row, children);
  return root;
}

/** Creates a folder or file control for the recent Markdown tree. */
export function createRecentTreeNode(
  node: MarkdownTreeNode,
  actions: RecentTreeActions,
  root = false,
): HTMLElement {
  if (root) {
    return createRootNode(node, actions);
  }

  if (node.isDirectory) {
    const details = document.createElement("details");
    details.className = "tree-folder";
    details.open = actions.folderOpenState.get(node.path) ?? false;
    details.addEventListener("toggle", () => {
      actions.folderOpenState.set(node.path, details.open);
    });

    const summary = document.createElement("summary");
    summary.textContent = node.name;
    summary.title = node.path;
    details.append(summary);

    const children = document.createElement("div");
    children.className = "tree-children";
    appendChildren(children, node, actions);
    details.append(children);
    return details;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "tree-file";
  button.title = node.path;
  button.dataset.path = node.path;
  button.setAttribute("aria-current", node.path === actions.activePath ? "page" : "false");
  button.addEventListener("click", () => actions.openFile(node.path));
  button.addEventListener("contextmenu", (event) => {
    openTreeContextMenu(event, node, actions.copyText);
  });

  const label = document.createElement("span");
  label.textContent = node.name;
  button.append(label);

  if (node.isNew) {
    const badge = document.createElement("span");
    badge.className = "tree-file-new-badge";
    badge.textContent = "New";
    button.append(badge);
  }

  return button;
}
