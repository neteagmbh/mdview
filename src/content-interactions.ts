/** Markdown file extensions recognized when classifying a link target. */
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd", "mkdn"]);

/** Result of inspecting a link's `href` against the currently open document. */
export type LinkClassification =
  | { kind: "external"; url: string }
  | { kind: "internal-markdown"; path: string; fragment: string | null }
  | { kind: "internal-pdf"; path: string; fragment: string | null }
  | { kind: "other" };

/** Converts an absolute file-system path into a `file://` URL usable as a resolution base. */
function toFileUrl(path: string): URL {
  const normalized = path.replace(/\\/g, "/");
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return new URL(`file://${withLeadingSlash.split("/").map(encodeURIComponent).join("/")}`);
}

/** Converts a resolved `file://` URL back into a display path matching the source path's style. */
function fromFileUrl(url: URL, useBackslashes: boolean): string {
  const pathname = decodeURIComponent(url.pathname);
  if (useBackslashes) {
    return pathname.replace(/^\//, "").replace(/\//g, "\\");
  }
  return pathname;
}

/** Resolves a relative Markdown link against the absolute path of the currently open document. */
export function resolveMarkdownLinkPath(currentFilePath: string, href: string): string {
  const useBackslashes = currentFilePath.includes("\\") && !currentFilePath.includes("/");
  const resolved = new URL(href, toFileUrl(currentFilePath));
  return fromFileUrl(resolved, useBackslashes);
}

/** Classifies rendered web links and local Markdown/PDF destinations without accepting remote file hosts. */
export function classifyMarkdownLink(
  href: string,
  currentFilePath: string | null,
): LinkClassification {
  if (/^https?:/i.test(href)) {
    return { kind: "external", url: href };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//") || href.startsWith("\\\\")) {
    return { kind: "other" };
  }
  if (!currentFilePath) {
    return { kind: "other" };
  }

  const [pathAndQuery, fragment] = href.split("#");
  const withoutQuery = pathAndQuery.split("?")[0];
  let decoded: string;
  try { decoded = decodeURIComponent(withoutQuery); } catch { return { kind: "other" }; }
  const extension = decoded.split(".").pop()?.toLowerCase() ?? "";
  if (!withoutQuery || (!MARKDOWN_EXTENSIONS.has(extension) && extension !== "pdf")) {
    return { kind: "other" };
  }

  return {
    kind: extension === "pdf" ? "internal-pdf" : "internal-markdown",
    path: resolveMarkdownLinkPath(currentFilePath, withoutQuery),
    fragment: fragment ?? null,
  };
}

/** Handlers invoked for the content-interaction events delegated from the rendered document. */
export interface ContentInteractionHandlers {
  getCurrentPath: () => string | null;
  openInternalLink: (path: string, fragment: string | null) => void;
  openExternalLink: (url: string) => void;
  openImage: (element: HTMLImageElement | SVGSVGElement) => void;
}

/** Delegates clicks on links and images inside a rendered Markdown root to the given handlers. */
export function attachContentInteractions(
  root: HTMLElement,
  handlers: ContentInteractionHandlers,
): void {
  root.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const image = event.target.closest("img");
    if (image && root.contains(image)) {
      event.preventDefault();
      handlers.openImage(image);
      return;
    }

    const diagram = event.target.closest(".mermaid-diagram svg");
    if (diagram && root.contains(diagram)) {
      event.preventDefault();
      handlers.openImage(diagram as unknown as SVGSVGElement);
      return;
    }

    const link = event.target.closest("a");
    if (!link || !root.contains(link)) {
      return;
    }

    const href = link.getAttribute("href");
    if (!href) {
      return;
    }

    const classification = classifyMarkdownLink(href, handlers.getCurrentPath());
    if (classification.kind === "external") {
      event.preventDefault();
      handlers.openExternalLink(classification.url);
    } else if (classification.kind === "internal-markdown" || classification.kind === "internal-pdf") {
      event.preventDefault();
      handlers.openInternalLink(classification.path, classification.fragment);
    }
  });
}
