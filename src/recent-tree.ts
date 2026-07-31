export interface MarkdownTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: MarkdownTreeNode[];
}

export interface RecentTreeActions {
  activePath: string | null;
  folderOpenState: Map<string, boolean>;
  openFile: (path: string) => void;
  removeFolder: (path: string, trigger: HTMLButtonElement) => void | Promise<void>;
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

/** Creates a removable top-level entry for a recent folder. */
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
  remove.addEventListener("click", () => {
    void actions.removeFolder(node.path, remove);
  });

  row.append(toggle, remove);
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
  button.textContent = node.name;
  button.title = node.path;
  button.dataset.path = node.path;
  button.setAttribute("aria-current", node.path === actions.activePath ? "page" : "false");
  button.addEventListener("click", () => actions.openFile(node.path));
  return button;
}
