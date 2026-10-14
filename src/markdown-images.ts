import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveMarkdownLinkPath } from "./content-interactions";

/** Resolves local image sources against the Markdown file and serves them through Tauri. */
export function resolveMarkdownImages(root: HTMLElement, currentFilePath: string | null): void {
  if (!currentFilePath) {
    return;
  }

  root.querySelectorAll<HTMLImageElement>("img[src]").forEach((image) => {
    const source = image.getAttribute("src");
    if (!source || source.startsWith("//")) {
      return;
    }
    const isWindowsPath = /^[a-z]:[\\/]/i.test(source);
    if (!isWindowsPath && /^[a-z][a-z0-9+.-]*:/i.test(source) && !/^file:/i.test(source)) {
      return;
    }

    try {
      const path = isWindowsPath ? source : resolveMarkdownLinkPath(currentFilePath, source);
      image.src = convertFileSrc(path);
    } catch {
      // Leave malformed image URLs untouched so one image cannot prevent document rendering.
    }
  });
}
