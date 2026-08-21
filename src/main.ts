import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { markedHighlight } from "marked-highlight";
import appIconUrl from "../assets/icon-master.png";
import { buildLightModeClipboardHtml } from "./clipboard-styles";
import { attachContentInteractions } from "./content-interactions";
import { renderMermaidDiagrams } from "./diagrams";
import {
  getEmbeddedDocument,
  type EmbeddedDocumentId,
} from "./embedded-documents";
import { highlightCode } from "./markdown";
import { handleDocumentScrollKey } from "./keyboard-scroll";
import {
  buildHeadingOutline,
  scrollHeadingIntoView,
  updateOutlineStatus,
} from "./outline";
import {
  createRecentTreeNode,
  type MarkdownTreeNode,
  updateRecentTreeActivePath,
} from "./recent-tree";
import { stepZoom, ZOOM_LEVELS, zoomFactor, zoomLabel } from "./zoom";
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
const outlineToggle = document.querySelector<HTMLButtonElement>("#outline-toggle")!;
const fileName = document.querySelector<HTMLElement>("#file-name")!;
const linkStatus = document.querySelector<HTMLElement>("#link-status")!;
const appShell = document.querySelector<HTMLElement>(".app-shell")!;
const tree = document.querySelector<HTMLElement>("#recent-tree")!;
const treeStatus = document.querySelector<HTMLElement>("#tree-status")!;
const outlineSidebar = document.querySelector<HTMLElement>("#outline-sidebar")!;
const outlineNav = document.querySelector<HTMLElement>("#document-outline")!;
const outlineStatus = document.querySelector<HTMLElement>("#outline-status")!;
const welcome = document.querySelector<HTMLElement>("#welcome")!;
const markdown = document.querySelector<HTMLElement>("#markdown")!;
const error = document.querySelector<HTMLElement>("#error")!;
const content = document.querySelector<HTMLElement>("#content")!;
const dropOverlay = document.querySelector<HTMLElement>("#drop-overlay")!;
const aboutDialog = document.querySelector<HTMLDialogElement>("#about-dialog")!;
const aboutIcon = document.querySelector<HTMLImageElement>("#about-icon")!;
const imagePopout = document.querySelector<HTMLElement>("#image-popout")!;
const imagePopoutImage =
  document.querySelector<HTMLImageElement>("#image-popout-image")!;
const imagePopoutClose =
  document.querySelector<HTMLButtonElement>("#image-popout-close")!;
const embeddedDocumentLinks = document.querySelectorAll<HTMLAnchorElement>(
  "[data-embedded-document]",
);

let activePath: string | null = null;
let currentZoom = 100;
let linkStatusTimeout: number | undefined;
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

/** Displays a document-level error and clears the current outline. */
function showError(message: unknown): void {
  welcome.hidden = true;
  markdown.hidden = true;
  error.hidden = false;
  error.textContent = message instanceof Error ? message.message : String(message);
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

/** Displays an image from the document in a full-window popout overlay. */
function openImagePopout(src: string, alt: string): void {
  imagePopoutImage.src = src;
  imagePopoutImage.alt = alt;
  imagePopout.hidden = false;
  imagePopoutClose.focus();
}

/** Closes the image popout overlay and releases the displayed image. */
function closeImagePopout(): void {
  imagePopout.hidden = true;
  imagePopoutImage.src = "";
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
  folders.forEach((folder) => {
    tree.append(
      createRecentTreeNode(
        folder,
        {
          activePath,
          folderOpenState: recentFolderOpenState,
          openFile: (path) => void loadFile(path),
          removeFolder: removeRecentFolder,
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
  window.document.title = `${title} — mdview`;
  welcome.hidden = true;
  error.hidden = true;
  markdown.hidden = false;
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
  } catch (loadError) {
    showError(loadError);
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

openButton.addEventListener("click", () => void chooseFile());
openDirectoryButton.addEventListener("click", () => void chooseDirectory());
backButton.addEventListener("click", () => void navigateBack());
welcomeOpenButton.addEventListener("click", () => void chooseFile());
refreshButton.addEventListener("click", () => void refreshRecentTree());
zoomOutButton.addEventListener("click", () => applyZoom(stepZoom(currentZoom, -1)));
zoomResetButton.addEventListener("click", () => applyZoom(100));
zoomInButton.addEventListener("click", () => applyZoom(stepZoom(currentZoom, 1)));
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
document.addEventListener("keydown", (event) => {
  if (!imagePopout.hidden && event.key === "Escape") {
    event.preventDefault();
    closeImagePopout();
    return;
  }
  if (!aboutDialog.open) {
    handleDocumentScrollKey(event, content);
  }
});
imagePopoutClose.addEventListener("click", () => closeImagePopout());
imagePopout.addEventListener("click", (event) => {
  if (event.target === imagePopout) {
    closeImagePopout();
  }
});
attachContentInteractions(markdown, {
  getCurrentPath: () => activePath,
  openInternalLink: (path, fragment) => void openInternalLink(path, fragment),
  openExternalLink,
  openImage: openImagePopout,
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
void listen("menu-about", showAboutDialog);

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

void refreshRecentTree();
applyZoom(100);
aboutIcon.src = appIconUrl;
