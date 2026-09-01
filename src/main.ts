import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import appIconUrl from "../assets/icon-master.png";
import {
  buildLightModeClipboardHtml,
  prepareLightModePrint,
} from "./clipboard-styles";
import { attachContentInteractions } from "./content-interactions";
import { renderMermaidDiagrams } from "./diagrams";
import { getEmbeddedDocument, type EmbeddedDocumentId } from "./embedded-documents";
import { highlightCode } from "./markdown";
import { handleDocumentScrollKey } from "./keyboard-scroll";
import { createImagePopoutController } from "./image-popout";
import {
  buildHeadingOutline,
  scrollHeadingIntoView,
  updateOutlineStatus,
} from "./outline";
import {
  createRecentTreeNode,
  type MarkdownTreeNode,
  sortPinnedFirst,
  updateRecentTreeActivePath,
} from "./recent-tree";
import { attachSidebarResize } from "./sidebar-resize";
import {
  createSearchController,
  type FileSearchResult,
  type SearchScope,
} from "./search";
import { openPrintDialog } from "./print";
import { stepZoom, ZOOM_LEVELS, zoomFactor, zoomLabel } from "./zoom";
import {
  EMPTY_VIEW_STATE,
  normalizeViewState,
  OUTLINE_WIDTH_BOUNDS,
  SIDEBAR_WIDTH_BOUNDS,
  type ViewState,
  type WindowGeometry,
} from "./view-state";
import "./styles.css";

interface OpenedDocument {
  content: string;
  path: string;
  recentFolders: MarkdownTreeNode[];
}

const openButton = document.querySelector<HTMLButtonElement>("#open-button")!;
const openDirectoryButton =
  document.querySelector<HTMLButtonElement>("#open-directory-button")!;
const backButton = document.querySelector<HTMLButtonElement>("#back-button")!;
const welcomeOpenButton =
  document.querySelector<HTMLButtonElement>("#welcome-open-button")!;
const refreshButton = document.querySelector<HTMLButtonElement>("#refresh-button")!;
const zoomOutButton = document.querySelector<HTMLButtonElement>("#zoom-out")!;
const zoomResetButton = document.querySelector<HTMLButtonElement>("#zoom-reset")!;
const zoomInButton = document.querySelector<HTMLButtonElement>("#zoom-in")!;
const printButton = document.querySelector<HTMLButtonElement>("#print-button")!;
const outlineToggle = document.querySelector<HTMLButtonElement>("#outline-toggle")!;
const searchToggle = document.querySelector<HTMLButtonElement>("#search-toggle")!;
const searchBar = document.querySelector<HTMLElement>("#search-bar")!;
const searchInput = document.querySelector<HTMLInputElement>("#search-input")!;
const searchScope = document.querySelector<HTMLSelectElement>("#search-scope")!;
const searchCount = document.querySelector<HTMLElement>("#search-count")!;
const searchPrev = document.querySelector<HTMLButtonElement>("#search-prev")!;
const searchNext = document.querySelector<HTMLButtonElement>("#search-next")!;
const searchClose = document.querySelector<HTMLButtonElement>("#search-close")!;
const searchResults = document.querySelector<HTMLElement>("#search-results")!;
const fileName = document.querySelector<HTMLElement>("#file-name")!;
const linkStatus = document.querySelector<HTMLElement>("#link-status")!;
const appShell = document.querySelector<HTMLElement>(".app-shell")!;
const sidebar = document.querySelector<HTMLElement>("#sidebar")!;
const sidebarResizeHandle =
  document.querySelector<HTMLElement>("#sidebar-resize-handle")!;
const outlineResizeHandle =
  document.querySelector<HTMLElement>("#outline-resize-handle")!;
const tree = document.querySelector<HTMLElement>("#recent-tree")!;
const treeStatus = document.querySelector<HTMLElement>("#tree-status")!;
const outlineSidebar = document.querySelector<HTMLElement>("#outline-sidebar")!;
const outlineNav = document.querySelector<HTMLElement>("#document-outline")!;
const outlineStatus = document.querySelector<HTMLElement>("#outline-status")!;
const welcome = document.querySelector<HTMLElement>("#welcome")!;
const markdown = document.querySelector<HTMLElement>("#markdown")!;
const error = document.querySelector<HTMLElement>("#error")!;
const content = document.querySelector<HTMLElement>("#content")!;
const printHeader = document.querySelector<HTMLElement>("#print-header")!;
const dropOverlay = document.querySelector<HTMLElement>("#drop-overlay")!;
const aboutDialog = document.querySelector<HTMLDialogElement>("#about-dialog")!;
const aboutIcon = document.querySelector<HTMLImageElement>("#about-icon")!;
const aboutVersion = document.querySelector<HTMLElement>("#about-version")!;
const imagePopout = document.querySelector<HTMLElement>("#image-popout")!;
const imagePopoutContent =
  document.querySelector<HTMLElement>("#image-popout-content")!;
const imagePopoutZoomOut =
  document.querySelector<HTMLButtonElement>("#image-popout-zoom-out")!;
const imagePopoutZoomReset =
  document.querySelector<HTMLButtonElement>("#image-popout-zoom-reset")!;
const imagePopoutZoomIn =
  document.querySelector<HTMLButtonElement>("#image-popout-zoom-in")!;
const imagePopoutClose =
  document.querySelector<HTMLButtonElement>("#image-popout-close")!;
const embeddedDocumentLinks = document.querySelectorAll<HTMLAnchorElement>(
  "[data-embedded-document]",
);
const appWindow = getCurrentWindow();

const imagePopoutController = createImagePopoutController({
  overlay: imagePopout,
  content: imagePopoutContent,
  zoomInButton: imagePopoutZoomIn,
  zoomOutButton: imagePopoutZoomOut,
  zoomResetButton: imagePopoutZoomReset,
  closeButton: imagePopoutClose,
});

let activePath: string | null = null;
let currentZoom = 100;
let linkStatusTimeout: number | undefined;
let viewStateSaveTimeout: number | undefined;
let viewState: ViewState = { ...EMPTY_VIEW_STATE };
/** Documents visited via in-content link navigation, most recent last. */
const linkNavigationHistory: string[] = [];
/** Folder expansion state retained until the application session ends. */
const recentFolderOpenState = new Map<string, boolean>();

marked.use(
  markedHighlight({
    langPrefix: "hljs language-",
    highlight: highlightCode,
  }),
);
marked.setOptions({
  gfm: true,
  breaks: false,
});

/** Extracts a cross-platform file name from a path. */
function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** Returns the parent directory of a path, or `null` when the path has no separator. */
function parentFolder(path: string): string | null {
  const match = path.match(/^(.*)[\\/][^\\/]+$/);
  return match ? match[1] : null;
}

/** Schedules the current view state for native persistence after rapid changes settle. */
function scheduleViewStateSave(): void {
  window.clearTimeout(viewStateSaveTimeout);
  viewStateSaveTimeout = window.setTimeout(() => {
    void invoke("save_view_state", { state: viewState }).catch((saveError) => {
      console.error("Could not save view state", saveError);
    });
  }, 250);
}

/** Replaces selected persisted state fields and schedules them for storage. */
function updateViewState(update: Partial<ViewState>): void {
  viewState = { ...viewState, ...update };
  scheduleViewStateSave();
}

/** Reads the current physical main-window geometry. */
async function currentWindowGeometry(): Promise<WindowGeometry> {
  const [size, position] = await Promise.all([
    appWindow.innerSize(),
    appWindow.outerPosition(),
  ]);
  return {
    width: size.width,
    height: size.height,
    x: position.x,
    y: position.y,
  };
}

/** Displays a document-level error and clears the current outline. */
function showError(message: unknown): void {
  welcome.hidden = true;
  markdown.hidden = true;
  error.hidden = false;
  error.textContent = message instanceof Error ? message.message : String(message);
  printButton.disabled = true;
  renderDocumentOutline();
}

/** Rebuilds the right sidebar from headings in the active document. */
function renderDocumentOutline(): void {
  outlineNav.replaceChildren();
  const headings = markdown.hidden ? [] : buildHeadingOutline(markdown);
  updateOutlineStatus(outlineStatus, headings.length > 0);

  headings.forEach((heading) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "outline-link";
    button.textContent = heading.text;
    button.title = heading.text;
    button.style.setProperty(
      "--outline-indent",
      `${Math.min(heading.level - 1, 3) * 0.7}rem`,
    );
    button.addEventListener("click", () => {
      scrollHeadingIntoView(heading.element);
      window.history.replaceState(null, "", `#${encodeURIComponent(heading.id)}`);
    });
    outlineNav.append(button);
  });
}

/** Opens or closes the document-outline sidebar and updates accessibility state. */
function setOutlineOpen(open: boolean): void {
  appShell.classList.toggle("outline-closed", !open);
  outlineSidebar.hidden = !open;
  outlineToggle.setAttribute("aria-expanded", String(open));
  outlineToggle.title = open ? "Close document outline" : "Open document outline";
}

/** Shows a link's destination briefly before handing it off to the system browser. */
function showLinkStatus(url: string): void {
  window.clearTimeout(linkStatusTimeout);
  linkStatus.hidden = false;
  linkStatus.textContent = `Opening ${url}`;
  linkStatus.title = url;
  linkStatusTimeout = window.setTimeout(() => {
    linkStatus.hidden = true;
  }, 4000);
}

/** Opens an external web link in the system browser after surfacing its URL. */
function openExternalLink(url: string): void {
  showLinkStatus(url);
  void openUrl(url);
}

/** Enables or disables the back-navigation control based on the link history. */
function updateBackButtonState(): void {
  backButton.disabled = linkNavigationHistory.length === 0;
}

/** Navigates back to the document visited before the most recent link click. */
async function navigateBack(): Promise<void> {
  const previousPath = linkNavigationHistory.pop();
  updateBackButtonState();
  if (previousPath) {
    await loadFile(previousPath);
  }
}


/** Applies a document-only zoom level and updates toolbar controls. */
function applyZoom(level: number): void {
  currentZoom = level;
  markdown.style.setProperty("--document-zoom", String(zoomFactor(level)));
  zoomResetButton.textContent = zoomLabel(level);
  zoomResetButton.title = `Reset document zoom (currently ${zoomLabel(level)})`;
  zoomOutButton.disabled = level === ZOOM_LEVELS[0];
  zoomInButton.disabled = level === ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
}

/** Rebuilds the recent-folder tree while preserving the active file marker. */
function renderRecentTree(folders: MarkdownTreeNode[]): void {
  tree.replaceChildren();
  treeStatus.hidden = folders.length > 0;
  treeStatus.textContent = "Open a Markdown file to add its folder.";
  sortPinnedFirst(folders).forEach((folder) => {
    tree.append(
      createRecentTreeNode(
        folder,
        {
          activePath,
          folderOpenState: recentFolderOpenState,
          openFile: (path) => void loadFile(path),
          removeFolder: removeRecentFolder,
          pinFolder: setFolderPinned,
        },
        true,
      ),
    );
  });
}

/** Renders Markdown source in the document view without changing persisted state. */
async function renderMarkdownSource(
  source: string,
  title: string,
  path: string | null,
): Promise<void> {
  const rendered = await marked.parse(source);

  activePath = path;
  updateRecentTreeActivePath(tree, activePath);
  markdown.innerHTML = DOMPurify.sanitize(rendered);
  fileName.textContent = title;
  fileName.title = path ?? title;
  printHeader.textContent = `${title} — ${new Date().toLocaleDateString()}`;
  window.document.title = `${title} — mdview`;
  welcome.hidden = true;
  error.hidden = true;
  markdown.hidden = false;
  printButton.disabled = false;
  await renderMermaidDiagrams(markdown, {
    dark: window.matchMedia("(prefers-color-scheme: dark)").matches,
  });
  content.scrollTo({ top: 0 });
  markdown.focus();
  renderDocumentOutline();
}

/** Displays a license document bundled with the application without updating the LRU. */
async function loadEmbeddedDocument(id: EmbeddedDocumentId): Promise<void> {
  try {
    const document = getEmbeddedDocument(id);
    await renderMarkdownSource(document.content, document.title, null);
  } catch (embeddedError) {
    showError(embeddedError);
  }
}

/** Opens the in-application About dialog. */
function showAboutDialog(): void {
  if (!aboutDialog.open) {
    aboutDialog.showModal();
  }
}

/** Removes a recent-folder entry and refreshes the persisted tree. */
async function removeRecentFolder(path: string, trigger: HTMLButtonElement): Promise<void> {
  trigger.disabled = true;
  try {
    const folders = await invoke<MarkdownTreeNode[]>("remove_recent_folder", { path });
    renderRecentTree(folders);
  } catch (removeError) {
    treeStatus.hidden = false;
    treeStatus.textContent =
      removeError instanceof Error ? removeError.message : String(removeError);
    trigger.disabled = false;
  }
}

/** Pins or unpins a recent-folder entry and refreshes the persisted tree. */
async function setFolderPinned(
  path: string,
  pinned: boolean,
  trigger: HTMLButtonElement,
): Promise<void> {
  trigger.disabled = true;
  try {
    const folders = await invoke<MarkdownTreeNode[]>("set_recent_folder_pinned", {
      path,
      pinned,
    });
    renderRecentTree(folders);
  } catch (pinError) {
    treeStatus.hidden = false;
    treeStatus.textContent = pinError instanceof Error ? pinError.message : String(pinError);
  } finally {
    trigger.disabled = false;
  }
}

/** Reloads the recent-folder tree from the native backend. */
async function refreshRecentTree(): Promise<void> {
  refreshButton.disabled = true;
  try {
    const folders = await invoke<MarkdownTreeNode[]>("recent_markdown_tree");
    renderRecentTree(folders);
  } catch (refreshError) {
    tree.replaceChildren();
    treeStatus.hidden = false;
    treeStatus.textContent =
      refreshError instanceof Error ? refreshError.message : String(refreshError);
  } finally {
    refreshButton.disabled = false;
  }
}

/** Loads, renders, and activates a Markdown document from an explicit path. */
async function loadFile(path: string): Promise<void> {
  try {
    const document = await invoke<OpenedDocument>("open_markdown_file", { path });
    await renderMarkdownSource(document.content, basename(document.path), document.path);
    renderRecentTree(document.recentFolders);
    updateViewState({ activeDocument: document.path });
  } catch (loadError) {
    if (viewState.activeDocument === path) {
      updateViewState({ activeDocument: null });
    }
    showError(loadError);
  }
}

/** Restores persisted layout and document state, then starts observing window changes. */
async function initializeViewState(): Promise<void> {
  void getVersion()
    .then((version) => {
      aboutVersion.textContent = `Version ${version}`;
    })
    .catch(() => undefined);

  try {
    viewState = normalizeViewState(await invoke<ViewState>("load_view_state"));
    if (viewState.sidebarWidth !== null) {
      appShell.style.setProperty("--sidebar-width", `${viewState.sidebarWidth}px`);
    }
    if (viewState.outlineWidth !== null) {
      appShell.style.setProperty("--outline-width", `${viewState.outlineWidth}px`);
    }
    if (viewState.window) {
      await appWindow.setSize(
        new PhysicalSize(viewState.window.width, viewState.window.height),
      );
      await appWindow.setPosition(new PhysicalPosition(viewState.window.x, viewState.window.y));
    }
  } catch (restoreError) {
    console.error("Could not restore view state", restoreError);
  }

  try {
    viewState = { ...viewState, window: await currentWindowGeometry() };
    await appWindow.onResized(({ payload }) => {
      const geometry = viewState.window;
      if (geometry) {
        updateViewState({ window: { ...geometry, width: payload.width, height: payload.height } });
      }
    });
    await appWindow.onMoved(({ payload }) => {
      const geometry = viewState.window;
      if (geometry) {
        updateViewState({ window: { ...geometry, x: payload.x, y: payload.y } });
      }
    });
  } catch (observeError) {
    console.error("Could not observe window geometry", observeError);
  }

  await refreshRecentTree();
  if (viewState.activeDocument) {
    await loadFile(viewState.activeDocument);
  }
}

/**
 * Re-reads the currently open document from disk and re-renders it, preserving scroll position.
 *
 * mdview is a read-only viewer, so there is no unsaved local state to reconcile with the change.
 */
async function reloadActiveDocument(): Promise<void> {
  if (!activePath) {
    return;
  }
  const scrollPosition = { top: content.scrollTop, left: content.scrollLeft };
  try {
    const source = await invoke<string>("read_markdown_file", { path: activePath });
    await renderMarkdownSource(source, basename(activePath), activePath);
    content.scrollTo(scrollPosition);
  } catch (reloadError) {
    showError(reloadError);
  }
}

/** Follows a relative Markdown link, recording the current document for back navigation. */
async function openInternalLink(path: string, fragment: string | null): Promise<void> {
  if (activePath) {
    linkNavigationHistory.push(activePath);
    updateBackButtonState();
  }
  await loadFile(path);
  if (fragment) {
    const heading = document.getElementById(decodeURIComponent(fragment));
    if (heading) {
      scrollHeadingIntoView(heading);
    }
  }
}

/** Prompts for a directory and adds it to the persisted recent folders. */
async function chooseDirectory(): Promise<void> {
  try {
    const selected = await open({
      multiple: false,
      directory: true,
    });

    if (selected) {
      const folders = await invoke<MarkdownTreeNode[]>("add_recent_folder", { path: selected });
      renderRecentTree(folders);
    }
  } catch (directoryError) {
    treeStatus.hidden = false;
    treeStatus.textContent =
      directoryError instanceof Error ? directoryError.message : String(directoryError);
  }
}

/** Prompts for a Markdown file and opens the selected document. */
async function chooseFile(): Promise<void> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [
      {
        name: "Markdown",
        extensions: ["md", "markdown", "mdown", "mkd", "mkdn"],
      },
    ],
  });

  if (selected) {
    await loadFile(selected);
  }
}

/** Opens the platform print dialog, retaining browser printing as a non-macOS fallback. */
function printDocument(): void {
  void openPrintDialog(
    () => invoke<boolean>("print_document"),
    () => window.print(),
    (printError) => console.error("Could not open native print dialog", printError),
  );
}

openButton.addEventListener("click", () => void chooseFile());
openDirectoryButton.addEventListener("click", () => void chooseDirectory());
backButton.addEventListener("click", () => void navigateBack());
welcomeOpenButton.addEventListener("click", () => void chooseFile());
refreshButton.addEventListener("click", () => void refreshRecentTree());
zoomOutButton.addEventListener("click", () => applyZoom(stepZoom(currentZoom, -1)));
zoomResetButton.addEventListener("click", () => applyZoom(100));
zoomInButton.addEventListener("click", () => applyZoom(stepZoom(currentZoom, 1)));
printButton.addEventListener("click", printDocument);
outlineToggle.addEventListener("click", () => {
  setOutlineOpen(outlineSidebar.hidden);
});
embeddedDocumentLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    aboutDialog.close();
    void loadEmbeddedDocument(link.dataset.embeddedDocument as EmbeddedDocumentId);
  });
});

/** Runs a backend Markdown search scoped to a folder or all recent folders. */
async function searchFiles(query: string, scope: SearchScope): Promise<FileSearchResult[]> {
  const root = scope === "directory" ? (activePath ? parentFolder(activePath) : null) : null;
  if (scope === "directory" && !root) {
    return [];
  }
  return invoke<FileSearchResult[]>("search_markdown_files", { query, root });
}

const searchController = createSearchController({
  bar: searchBar,
  input: searchInput,
  scopeSelect: searchScope,
  countLabel: searchCount,
  previousButton: searchPrev,
  nextButton: searchNext,
  closeButton: searchClose,
  results: searchResults,
  getContentRoot: () => markdown,
  searchFiles,
  openResult: (path) => loadFile(path),
});

searchToggle.addEventListener("click", () => {
  searchController.toggle();
  searchToggle.setAttribute("aria-expanded", String(searchController.isOpen()));
});
searchClose.addEventListener("click", () => {
  searchToggle.setAttribute("aria-expanded", "false");
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    searchController.open();
    searchToggle.setAttribute("aria-expanded", "true");
  }
});
let restorePrintDocument: (() => void) | null = null;
window.addEventListener("beforeprint", () => {
  restorePrintDocument?.();
  restorePrintDocument = prepareLightModePrint(markdown);
});
window.addEventListener("afterprint", () => {
  restorePrintDocument?.();
  restorePrintDocument = null;
});
document.addEventListener("keydown", (event) => {
  if (!aboutDialog.open) {
    handleDocumentScrollKey(event, content);
  }
});
attachContentInteractions(markdown, {
  getCurrentPath: () => activePath,
  openInternalLink: (path, fragment) => void openInternalLink(path, fragment),
  openExternalLink,
  openImage: (element) => imagePopoutController.open(element),
});
markdown.addEventListener("copy", (event) => {
  const selection = window.getSelection();
  const html = selection ? buildLightModeClipboardHtml(selection) : null;
  if (!html || !event.clipboardData || !selection) {
    return;
  }
  event.preventDefault();
  event.clipboardData.setData("text/html", html);
  event.clipboardData.setData("text/plain", selection.toString());
});
void listen("menu-open-file", () => void chooseFile());
void listen("menu-open-directory", () => void chooseDirectory());
void listen("menu-print", printDocument);
void listen("menu-about", showAboutDialog);
void listen<{ paths: string[] }>("watched-path-changed", (event) => {
  const { paths } = event.payload;
  if (activePath && paths.includes(activePath)) {
    void reloadActiveDocument();
  }
  void refreshRecentTree();
});

void getCurrentWebview().onDragDropEvent((event) => {
  if (event.payload.type === "over") {
    dropOverlay.hidden = false;
  } else if (event.payload.type === "drop") {
    dropOverlay.hidden = true;
    const [path] = event.payload.paths;
    if (path) {
      void loadFile(path);
    }
  } else {
    dropOverlay.hidden = true;
  }
});

applyZoom(100);
aboutIcon.src = appIconUrl;
attachSidebarResize({
  handle: sidebarResizeHandle,
  target: appShell,
  cssVariable: "--sidebar-width",
  bounds: SIDEBAR_WIDTH_BOUNDS,
  direction: "grow-right",
  getCurrentWidth: () => sidebar.getBoundingClientRect().width,
  onResizeEnd: (sidebarWidth) => updateViewState({ sidebarWidth }),
});
attachSidebarResize({
  handle: outlineResizeHandle,
  target: appShell,
  cssVariable: "--outline-width",
  bounds: OUTLINE_WIDTH_BOUNDS,
  direction: "grow-left",
  getCurrentWidth: () => outlineSidebar.getBoundingClientRect().width,
  onResizeEnd: (outlineWidth) => updateViewState({ outlineWidth }),
});
void initializeViewState();
