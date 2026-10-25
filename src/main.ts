import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
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
import { resolveMarkdownImages } from "./markdown-images";
import { initializeIncomingDocuments } from "./incoming-documents";
import { createDocumentOpening, pdfPage, type OpenedContent } from "./document-opening";
import { createDocumentView, type RendererCapabilities } from "./document-view";
import { createPdfViewer, type PdfRenderer, type PdfViewerState } from "./pdf-viewer";
import { requestPdfPassword } from "./pdf-password";
import { isPdfPrinting } from "./pdf-print";
import type { PdfResource } from "./documents";
import { rememberPdfPosition, type PdfPosition } from "./pdf-position";
import { renderPdfBookmarks, type PdfBookmark } from "./pdf-outline";
import { createDocumentReload } from "./document-reload";
import { createDocumentNavigation } from "./document-navigation";
import { createFolderSearchScope } from "./folder-search-scope";
import { updateDocumentShell } from "./document-shell";
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
import { createSidebarTabs } from "./sidebar-tabs";
import { attachSidebarToggle, initializeSidebarVisibility } from "./sidebar-toggle";
import {
  createSearchController,
  type FileSearchResult,
  type SearchScope,
} from "./search";
import { openPrintDialog, printWithNativeMargins, waitForPrintLayout } from "./print";
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
import "./pdf-viewer.css";

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
const sidebarToggle = document.querySelector<HTMLButtonElement>("#sidebar-toggle")!;
const foldersTab = document.querySelector<HTMLButtonElement>("#folders-tab")!;
const searchTab = document.querySelector<HTMLButtonElement>("#search-tab")!;
const foldersPanel = document.querySelector<HTMLElement>("#folders-panel")!;
const searchPanel = document.querySelector<HTMLElement>("#search-panel")!;
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
const pdfRegion = document.querySelector<HTMLElement>("#pdf-region")!;
const pdfContainer = document.querySelector<HTMLDivElement>("#pdf-container")!;
const pdfPages = document.querySelector<HTMLDivElement>("#pdf-pages")!;
const pdfControls = document.querySelector<HTMLElement>("#pdf-controls")!;
const pdfPageInput = document.querySelector<HTMLInputElement>("#pdf-page")!;
const pdfPageCount = document.querySelector<HTMLElement>("#pdf-page-count")!;
const pdfPrevious = document.querySelector<HTMLButtonElement>("#pdf-previous")!;
const pdfNext = document.querySelector<HTMLButtonElement>("#pdf-next")!;
const pdfFit = document.querySelector<HTMLSelectElement>("#pdf-fit")!;
const pdfPassword = document.querySelector<HTMLDialogElement>("#pdf-password")!;
const documentStatus = document.querySelector<HTMLElement>("#document-status")!;
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
/** In-memory source destination retained for relative links and Back navigation. */
let activeFragment: string | null = null;
/** Discriminator routes shell interactions to the active document type. */
let activeKind: "markdown" | "pdf" = "markdown";
/** Loading and failed documents must not expose actions backed by stale content. */
let documentReady = false;
/** Folder search retains a root independently from the document's type or nesting depth. */
const folderScope = createFolderSearchScope();
/** Renderer tasks and workers have a shorter lifetime than the application shell. */
const documentView = createDocumentView();
/** Bookmarks are scoped to the current PDF renderer. */
let bookmarks: PdfBookmark[] = [];
/** Last PDF state updates page controls without inspecting upstream viewer internals. */
let pdfState: PdfViewerState = { page: 1, pages: 0, scale: 1, mode: "page-width", rotation: 0 };
let currentZoom = 100;
let linkStatusTimeout: number | undefined;
let viewStateSaveTimeout: number | undefined;
let viewState: ViewState = { ...EMPTY_VIEW_STATE };
/** Cross-renderer Back history captures PDF coordinates before following another source. */
const navigation = createDocumentNavigation(
  () => activePath ? { path: activePath, fragment: activeKind === "pdf" ? null : activeFragment,
    position: currentPdf()?.position() } : null,
  async (destination, sourcePath) => {
    return documentOpening.file(destination.path, destination.fragment, sourcePath, destination.position);
  },
);
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
  documentReady = false;
  welcome.hidden = true;
  markdown.hidden = true;
  pdfRegion.hidden = true;
  pdfControls.hidden = true;
  documentStatus.hidden = true;
  error.hidden = false;
  error.textContent = message instanceof Error ? message.message : String(message);
  setRendererCapabilities({ print: false, find: false, outline: false }, null);
  fileName.textContent = "Document unavailable";
  fileName.title = "";
  window.document.title = "mdview";
  updateRecentTreeActivePath(tree, null);
  renderDocumentOutline();
}

/** Rebuilds the right sidebar from headings in the active document. */
function renderDocumentOutline(): void {
  if (activeKind === "pdf" && !pdfRegion.hidden) {
    renderPdfBookmarks(outlineNav, outlineStatus, bookmarks);
    return;
  }
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

/** Keeps unavailable PDF actions from falling through to Markdown adapters. */
function setRendererCapabilities(capabilities: RendererCapabilities, kind: "markdown" | "pdf" | null = activeKind): void {
  updateDocumentShell({ print: printButton, outline: outlineToggle,
    zoom: [zoomOutButton, zoomResetButton, zoomInButton],
    fileScope: searchScope.querySelector<HTMLOptionElement>('option[value="file"]')!,
    outlineTitle: document.querySelector("#outline-title")!, outlineNav,
    fileIcon: document.querySelector("#file-type-icon")! }, kind, capabilities);
  searchInput.disabled = searchScope.value === "file" && !capabilities.find;
  if (searchInput.disabled) searchPrev.disabled = searchNext.disabled = true;
}

/** Persists a bounded per-source reading history without temporary handles or document content. */
function savePdfPosition(path: string, position: PdfPosition): void {
  updateViewState({ pdfPositions: rememberPdfPosition(viewState.pdfPositions, path, position) });
}

/** Adapts the existing Markdown renderer to the same cancellable view contract as PDFs. */
function showMarkdown(source: string, title: string, path: string | null,
  isCurrent: () => boolean): Promise<void> {
  return documentView.show(signal => ({
    kind: "markdown", capabilities: { print: true, find: true, outline: true },
    ready: renderMarkdownSource(source, title, path, () => !signal.aborted && isCurrent()),
    zoom: direction => applyZoom(direction === 0 ? 100 : stepZoom(currentZoom, direction)),
    destroy: async () => undefined,
  }));
}

/** Reflects the actual PDF page/scale state, including changes caused by scrolling or internal links. */
function updatePdfControls(state: PdfViewerState): void {
  pdfState = state;
  pdfPageInput.value = String(state.page);
  pdfPageInput.max = String(state.pages);
  pdfPageCount.textContent = `of ${state.pages}`;
  pdfPrevious.disabled = state.page <= 1;
  pdfNext.disabled = state.page >= state.pages;
  pdfFit.value = state.mode === "custom" && state.scale === 1 ? "actual" : state.mode;
  zoomResetButton.textContent = `${Math.round(state.scale * 100)}%`;
  zoomResetButton.disabled = false;
  zoomOutButton.disabled = state.scale <= 0.25;
  zoomInButton.disabled = state.scale >= 5;
  zoomResetButton.title = `Reset PDF zoom (currently ${Math.round(state.scale * 100)}%)`;
  if (!documentReady) zoomOutButton.disabled = zoomResetButton.disabled = zoomInButton.disabled = true;
}

/** Returns PDF-specific controls only while the PDF renderer still owns the active view. */
function currentPdf(): PdfRenderer | null {
  const renderer = documentView.current;
  return renderer?.kind === "pdf" ? renderer as PdfRenderer : null;
}

pdfPrevious.addEventListener("click", () => currentPdf()?.goToPage(pdfState.page - 1));
pdfNext.addEventListener("click", () => currentPdf()?.goToPage(pdfState.page + 1));
pdfPageInput.addEventListener("change", () => {
  currentPdf()?.goToPage(pdfPageInput.valueAsNumber);
  pdfPageInput.value = String(pdfState.page);
});
pdfPageInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    currentPdf()?.goToPage(pdfPageInput.valueAsNumber);
    pdfPageInput.value = String(pdfState.page);
    pdfContainer.focus();
  }
});
pdfFit.addEventListener("change", () => {
  const selected = pdfFit.value;
  if (selected === "page-width" || selected === "page-fit" || selected === "actual") currentPdf()?.fit(selected);
});
document.querySelector("#pdf-rotate-left")!.addEventListener("click", () => currentPdf()?.rotate(-1));
document.querySelector("#pdf-rotate-right")!.addEventListener("click", () => currentPdf()?.rotate(1));
new ResizeObserver(() => {
  const height = pdfControls.getBoundingClientRect().height;
  if (height > 0) pdfRegion.style.setProperty("--pdf-controls-height", `${height}px`);
}).observe(pdfControls);
document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && ["+", "=", "-", "0"].includes(event.key) && !pdfPassword.open && documentReady) {
    event.preventDefault();
    documentView.current?.zoom(event.key === "0" ? 0 : event.key === "-" ? -1 : 1);
  }
});

/** Opens or closes the document-outline sidebar and updates accessibility state. */
function setOutlineOpen(open: boolean): void {
  appShell.classList.toggle("outline-closed", !open);
  outlineSidebar.hidden = !open;
  outlineToggle.setAttribute("aria-expanded", String(open));
  const label = activeKind === "pdf" ? "PDF bookmarks" : "document outline";
  outlineToggle.title = `${open ? "Close" : "Open"} ${label}`;
  outlineToggle.setAttribute("aria-label", outlineToggle.title);
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
  backButton.disabled = !navigation.hasBack;
}

/** Navigates back to the document visited before the most recent link click. */
async function navigateBack(): Promise<void> {
  await navigation.back();
  updateBackButtonState();
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

/** Copies text from a tree context-menu action to the system clipboard. */
async function copyTreeText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch (copyError) {
    console.error("Could not copy to clipboard", copyError);
  }
}

/** Rebuilds the recent-folder tree while preserving the active file marker. */
function renderRecentTree(folders: MarkdownTreeNode[]): void {
  folderScope.refresh(folders);
  tree.replaceChildren();
  treeStatus.hidden = folders.length > 0;
  treeStatus.textContent = "Open a folder to browse its Markdown and PDF files.";
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
          copyText: copyTreeText,
        },
        true,
      ),
    );
  });
}

let pendingDiagramRender: Promise<void> = Promise.resolve();

/** Renders Markdown source in the document view without changing persisted state. */
async function renderMarkdownSource(
  source: string,
  title: string,
  path: string | null,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const rendered = await marked.parse(source);
  if (!isCurrent()) return;

  activePath = path;
  activeKind = "markdown";
  documentReady = true;
  pdfRegion.hidden = true;
  pdfControls.hidden = true;
  documentStatus.hidden = true;
  delete content.dataset.renderer;
  setRendererCapabilities({ print: true, find: true, outline: true });
  zoomResetButton.disabled = false;
  applyZoom(currentZoom);
  updateRecentTreeActivePath(tree, activePath);
  markdown.innerHTML = DOMPurify.sanitize(rendered);
  resolveMarkdownImages(markdown, path);
  fileName.textContent = title;
  fileName.title = path ?? title;
  printHeader.textContent = `${title} — ${new Date().toLocaleDateString()}`;
  window.document.title = `${title} — mdview`;
  welcome.hidden = true;
  error.hidden = true;
  markdown.hidden = false;
  pendingDiagramRender = renderMermaidDiagrams(markdown, {
    dark: window.matchMedia("(prefers-color-scheme: dark)").matches,
  });
  await pendingDiagramRender;
  if (!isCurrent()) return;
  printButton.disabled = false;
  content.scrollTo({ top: 0 });
  markdown.focus();
  renderDocumentOutline();
  searchController.refreshHighlights();
}

/** Displays a license document bundled with the application without updating the LRU. */
async function loadEmbeddedDocument(id: EmbeddedDocumentId): Promise<void> {
  try {
    const document = getEmbeddedDocument(id);
    const isCurrent = await documentOpening.clear();
    activeFragment = null;
    await showMarkdown(document.content, document.title, null, isCurrent);
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

/** Opens any supported document path through the shared renderer-discriminated native route. */
async function loadFile(path: string, fragment: string | null = null): Promise<boolean> {
  const opened = await navigation.visit(path, fragment);
  updateBackButtonState();
  return opened;
}

/** Displays a validated picker or OS document through the same persistence and rendering path. */
async function displayOpenedDocument(document: OpenedContent, fragment: string | null,
  isCurrent: () => boolean, resource: PdfResource | null, position?: PdfPosition | null): Promise<void> {
  linkStatus.hidden = true;
  const path = document.kind === "pdf" ? document.document.path : document.path;
  folderScope.file(path);
  if (document.kind === "markdown") {
    await showMarkdown(document.content, basename(path), path, isCurrent);
    if (!isCurrent()) return;
    if (fragment) {
      let id = fragment;
      try { id = decodeURIComponent(fragment); } catch { /* Keep literal malformed anchors harmless. */ }
      const heading = markdown.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
      if (heading) scrollHeadingIntoView(heading);
    }
  } else {
    activePath = path;
    activeKind = "pdf";
    bookmarks = [];
    markdown.replaceChildren();
    markdown.hidden = true;
    welcome.hidden = true;
    error.hidden = true;
    pdfRegion.hidden = false;
    pdfControls.hidden = false;
    content.dataset.renderer = "pdf";
    documentStatus.hidden = false;
    documentStatus.textContent = `Loading ${document.document.name}…`;
    fileName.textContent = document.document.name;
    fileName.title = path;
    window.document.title = `${document.document.name} — mdview`;
    setRendererCapabilities({ print: false, find: false, outline: false });
    renderDocumentOutline();
    searchController.refreshHighlights();
    if (!resource) throw new Error("PDF resource ownership is missing.");
    await documentView.show(signal => createPdfViewer({
      container: pdfContainer, viewer: pdfPages, resource, signal, page: pdfPage(fragment),
      position: position ?? viewState.pdfPositions?.[path],
      positionChanged: position => { if (isCurrent()) savePdfPosition(path, position); },
      outline: items => { bookmarks = items; renderDocumentOutline(); },
      changed: updatePdfControls, openExternal: openExternalLink,
      password: (incorrect, passwordSignal) => requestPdfPassword(pdfPassword, document.document.name, incorrect, passwordSignal),
      failed: failure => {
        if (signal.aborted) return;
        void documentOpening.clear().then(isCurrent => {
          if (isCurrent()) showError(failure);
        }).catch(() => undefined);
      },
    }));
    if (!isCurrent()) return;
    documentStatus.hidden = true;
    documentReady = true;
    updatePdfControls(pdfState);
    setRendererCapabilities({ print: true, find: true, outline: true });
    searchController.refreshHighlights();
  }
  if (!isCurrent()) return;
  activeFragment = fragment;
  renderRecentTree(document.recentFolders);
  updateViewState({ activeDocument: path });
}

/** Every file entry point shares cancellation, stale-result cleanup, and resource ownership. */
const documentOpening = createDocumentOpening({
  display: displayOpenedDocument,
  reset: async () => {
    documentReady = false;
    const position = currentPdf()?.position();
    if (activePath && position) savePdfPosition(activePath, position);
    const stopped = documentView.clear();
    searchController.refreshHighlights();
    pdfRegion.hidden = true;
    pdfControls.hidden = true;
    markdown.hidden = true;
    welcome.hidden = true;
    error.hidden = true;
    setRendererCapabilities({ print: false, find: false, outline: false }, null);
    documentStatus.hidden = false;
    documentStatus.textContent = "Loading document…";
    await stopped;
  },
  folder: (path, folders) => {
    folderScope.folder(path);
    recentFolderOpenState.set(path, true);
    renderRecentTree(folders);
    setSidebarOpen(true);
    sidebarTabs.reveal("folders");
  },
  error: (failure, preserveSource) => {
    if (!preserveSource) {
      activePath = null;
      activeFragment = null;
      updateViewState({ activeDocument: null });
    }
    if (failure instanceof DOMException && failure.name === "AbortError") {
      documentStatus.hidden = true;
      pdfRegion.hidden = true;
      error.hidden = true;
      welcome.hidden = false;
      fileName.textContent = "No file open";
      fileName.title = "";
      window.document.title = "mdview";
      setRendererCapabilities({ print: false, find: false, outline: false }, null);
      delete content.dataset.renderer;
      applyZoom(currentZoom);
      zoomResetButton.disabled = zoomInButton.disabled = zoomOutButton.disabled = true;
    } else showError(failure);
  },
});
window.addEventListener("pagehide", () => {
  const position = currentPdf()?.position();
  if (activePath && position) savePdfPosition(activePath, position);
  window.clearTimeout(viewStateSaveTimeout);
  void invoke("save_view_state", { state: viewState }).catch(() => undefined);
  void documentOpening.clear();
});

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

  // Measure the restored viewport after WebKit has applied the native window size.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  initializeSidebarVisibility(setSidebarOpen, setOutlineOpen);

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
}

/**
 * Re-reads the currently open document from disk and re-renders it, preserving scroll position.
 *
 * mdview is a read-only viewer, so there is no unsaved local state to reconcile with the change.
 */
async function reloadActiveDocument(): Promise<void> {
  reloadController.request();
}

/** A single reload queue preserves source identity and page position through atomic replacements. */
const reloadController = createDocumentReload(() => activePath, async path => {
  const scrollPosition = { top: content.scrollTop, left: content.scrollLeft };
  const success = await documentOpening.reload(path, activeKind === "pdf" ? null : activeFragment);
  if (success && activePath === path && activeKind === "markdown") content.scrollTo(scrollPosition);
  return success;
});

/** Follows a local document link, preserving Markdown anchors and requested PDF pages for Back. */
async function openInternalLink(path: string, fragment: string | null): Promise<void> {
  await navigation.follow(path, fragment);
  updateBackButtonState();
}

/** Prompts for a directory and adds it to the persisted recent folders. */
async function chooseDirectory(): Promise<void> {
  try {
    const selected = await invoke<string | null>("pick_document", { directory: true });

    if (selected) {
      const folders = await invoke<MarkdownTreeNode[]>("add_recent_folder", { path: selected });
      folderScope.folder(folders[0]?.path ?? selected);
      renderRecentTree(folders);
    }
  } catch (directoryError) {
    treeStatus.hidden = false;
    treeStatus.textContent =
      directoryError instanceof Error ? directoryError.message : String(directoryError);
  }
}

/** Prompts for a Markdown/PDF file and opens the selected source through the common route. */
async function chooseFile(): Promise<void> {
  try {
    const selected = await invoke<string | null>("pick_document", { directory: false });
    if (selected) {
      await loadFile(selected);
    }
  } catch (error) {
    showError(error);
  }
}

/** Opens native desktop/mobile printing or the browser fallback on unsupported platforms. */
function printDocument(): void {
  if (!documentReady || !documentView.current?.capabilities.print) return;
  if (documentView.current.kind === "pdf") {
    documentStatus.hidden = true;
    void documentView.current.print?.().catch(printError => {
      const message = `Could not print PDF: ${printError instanceof Error ? printError.message : String(printError)}`;
      if (activeKind === "pdf") { documentStatus.textContent = message; documentStatus.hidden = false; }
      else { error.textContent = message; error.hidden = false; }
    });
    return;
  }
  if (isPdfPrinting()) return;
  void openPrintDialog(
    () => printWithNativeMargins(() => invoke<boolean>("print_document")),
    () => window.print(),
    (printError) => console.error("Could not open native print dialog", printError),
    async () => {
      await pendingDiagramRender;
      preparePrintDocument();
      await waitForPrintLayout(markdown);
    },
  ).catch((printError) => {
    restorePrintDocument?.();
    restorePrintDocument = null;
    error.textContent = `Could not open print dialog: ${
      printError instanceof Error ? printError.message : String(printError)
    }`;
    error.hidden = false;
  });
}

openButton.addEventListener("click", () => void chooseFile());
openDirectoryButton.addEventListener("click", () => void chooseDirectory());
backButton.addEventListener("click", () => void navigateBack());
welcomeOpenButton.addEventListener("click", () => void chooseFile());
refreshButton.addEventListener("click", () => { void refreshRecentTree(); void reloadActiveDocument(); });
zoomOutButton.addEventListener("click", () => documentView.current?.zoom(-1));
zoomResetButton.addEventListener("click", () => documentView.current?.zoom(0));
zoomInButton.addEventListener("click", () => documentView.current?.zoom(1));
printButton.addEventListener("click", printDocument);
outlineToggle.addEventListener("click", () => {
  setOutlineOpen(outlineSidebar.hidden !== false);
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
  const root = scope === "directory" ? folderScope.root : null;
  if (scope === "directory" && !root) {
    return [];
  }
  return invoke<FileSearchResult[]>("search_markdown_files", { query, root });
}

const setSidebarOpen = attachSidebarToggle(appShell, sidebar, sidebarToggle);
const sidebarTabs = createSidebarTabs(
  {
    folders: { tab: foldersTab, panel: foldersPanel },
    search: { tab: searchTab, panel: searchPanel },
  },
  "folders",
);

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
  getFileFind: () => documentReady ? currentPdf()?.find ?? null : null,
  searchFiles,
  // Skip reloading when the clicked result is already the active document.
  openResult: async (path) => { if (path !== activePath) await loadFile(path); },
  onOpenChange: (open) => {
    if (open) {
      setSidebarOpen(true);
      sidebarTabs.reveal("search");
    } else {
      sidebarTabs.conceal("search");
    }
    searchToggle.setAttribute("aria-expanded", String(open));
  },
});
searchScope.addEventListener("change", () => {
  searchInput.disabled = searchScope.value === "file" && !documentReady;
});

searchToggle.addEventListener("click", () => {
  searchController.toggle();
});
document.addEventListener("keydown", (event) => {
  if (pdfPassword.open) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    searchController.open();
  }
});
let restorePrintDocument: (() => void) | null = null;
/** Prepares print assets once, before the native dialog can measure the document. */
function preparePrintDocument(): void {
  if (isPdfPrinting() || documentView.current?.kind !== "markdown" || !documentView.current.capabilities.print) return;
  restorePrintDocument ??= prepareLightModePrint(markdown);
}
window.addEventListener("beforeprint", preparePrintDocument);
window.addEventListener("afterprint", () => {
  restorePrintDocument?.();
  restorePrintDocument = null;
});
document.addEventListener("keydown", (event) => {
  if (!aboutDialog.open) {
    handleDocumentScrollKey(event, activeKind === "pdf" ? pdfContainer : content);
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
setRendererCapabilities({ print: false, find: false, outline: false }, null);
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
void initializeIncomingDocuments({
  listen: (notify) => listen("incoming-documents", notify),
  take: () => invoke<string[]>("take_incoming_documents"),
  initializeLayout: initializeViewState,
  restoreDocument: async () => {
    if (viewState.activeDocument) {
      await loadFile(viewState.activeDocument);
    }
  },
  open: async (url) => {
    await documentOpening.incoming(url);
  },
  reportAdditional: (count) => {
    window.clearTimeout(linkStatusTimeout);
    linkStatus.textContent = `${count} additional item(s) were supplied; open each item individually to view it.`;
    linkStatus.title = linkStatus.textContent;
    linkStatus.hidden = false;
  },
  reportError: showError,
}).catch(showError);
