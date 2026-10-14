// @vitest-environment jsdom

import { convertFileSrc } from "@tauri-apps/api/core";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveMarkdownImages } from "./markdown-images";

vi.mock("@tauri-apps/api/core", () => ({
  /** Models Tauri's platform-specific conversion while recording the requested file paths. */
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`),
}));

/** Creates a detached document root with the supplied rendered images. */
function imageRoot(html: string): HTMLElement {
  const root = document.createElement("article");
  root.innerHTML = html;
  return root;
}

describe("resolveMarkdownImages", () => {
  beforeEach(() => vi.clearAllMocks());

  /** Reproduces the reported sibling PNG references through parsing and sanitization. */
  it("loads the provider settings images from the Markdown folder", async () => {
    const source = [
      "#### V1 Provider Settings",
      "![OTDS Authentication Handler Settings 1](designdraftoption1image001.png)",
      "#### V2 Provider Settings",
      "![OTDS Authentication Handler Settings 1](designdraftoption1image003.png)",
    ].join("\n\n");
    const root = imageRoot(DOMPurify.sanitize(await marked.parse(source)));

    resolveMarkdownImages(root, "/docs/design.md");

    expect(vi.mocked(convertFileSrc).mock.calls).toEqual([
      ["/docs/designdraftoption1image001.png"],
      ["/docs/designdraftoption1image003.png"],
    ]);
    expect(Array.from(root.querySelectorAll("img"), (image) => image.getAttribute("src")))
      .toEqual([
        "asset://localhost/%2Fdocs%2Fdesigndraftoption1image001.png",
        "asset://localhost/%2Fdocs%2Fdesigndraftoption1image003.png",
      ]);
  });

  /** Preserves filesystem names with URL punctuation and decodes encoded image destinations. */
  it("resolves nested images in folders containing spaces, Unicode, percent and hash", () => {
    const root = imageRoot('<img src="./images/Gr%C3%BC%C3%9Fe%20%231.png">');

    resolveMarkdownImages(root, "/docs/100% # Über/design.md");

    expect(convertFileSrc).toHaveBeenCalledWith("/docs/100% # Über/images/Grüße #1.png");
  });

  /** Checks URL-relative destinations through the complete Markdown rendering pipeline. */
  it.each([
    ["picture.png", "/docs/guides/picture.png"],
    ["./picture.png", "/docs/guides/picture.png"],
    ["images/picture.png", "/docs/guides/images/picture.png"],
    ["images/../picture.png", "/docs/guides/picture.png"],
    ["../images/picture.png", "/docs/images/picture.png"],
    ["../../picture.png", "/picture.png"],
    ["./images/picture%20one.png?raw=1", "/docs/guides/images/picture one.png"],
    ["./images/picture%231.png", "/docs/guides/images/picture#1.png"],
  ])("resolves %s to the local path %s", async (source, expectedPath) => {
    const root = imageRoot(DOMPurify.sanitize(await marked.parse(`![Picture](${source})`)));

    resolveMarkdownImages(root, "/docs/guides/design.md");

    expect(convertFileSrc).toHaveBeenCalledExactlyOnceWith(expectedPath);
    expect(root.querySelector("img")?.getAttribute("src"))
      .toBe(`asset://localhost/${encodeURIComponent(expectedPath)}`);
  });

  /** Supports Windows relative paths and explicit filesystem destinations. */
  it("resolves Windows image paths", () => {
    const root = imageRoot('<img src="images/picture.png"><img src="D:\\images\\other.png">');

    resolveMarkdownImages(root, "C:\\docs\\design.md");

    expect(vi.mocked(convertFileSrc).mock.calls).toEqual([
      ["C:\\docs\\images\\picture.png"],
      ["D:\\images\\other.png"],
    ]);
  });

  /** Converts absolute and file URLs without resolving them against the application URL. */
  it("supports absolute local paths and file URLs", () => {
    const root = imageRoot('<img src="/docs/picture.png"><img src="file:///docs/other%20image.png">');

    resolveMarkdownImages(root, "/docs/design.md");

    expect(vi.mocked(convertFileSrc).mock.calls).toEqual([
      ["/docs/picture.png"],
      ["/docs/other image.png"],
    ]);
  });

  /** Keeps remote, embedded, and already converted image URLs intact. */
  it("leaves non-file URLs untouched", () => {
    const html = '<img src="https://example.com/a.png"><img src="//example.com/a.png">'
      + '<img src="data:image/png;base64,AA=="><img src="blob:example">'
      + '<img src="asset://localhost/a.png"><img src="">';
    const root = imageRoot(html);

    resolveMarkdownImages(root, "/docs/design.md");

    expect(convertFileSrc).not.toHaveBeenCalled();
    expect(root.innerHTML).toBe(html);
  });

  /** Leaves bundled document images unchanged when there is no filesystem base. */
  it("leaves images untouched without a document path", () => {
    const root = imageRoot('<img src="picture.png">');

    resolveMarkdownImages(root, null);

    expect(convertFileSrc).not.toHaveBeenCalled();
    expect(root.querySelector("img")?.getAttribute("src")).toBe("picture.png");
  });

  /** Prevents one malformed image reference from blocking the remaining document images. */
  it("continues resolving images after a malformed URL", () => {
    const root = imageRoot('<img src="bad%ZZ.png"><img src="picture.png">');

    expect(() => resolveMarkdownImages(root, "/docs/design.md")).not.toThrow();

    expect(convertFileSrc).toHaveBeenCalledExactlyOnceWith("/docs/picture.png");
    expect(root.querySelector("img")?.getAttribute("src")).toBe("bad%ZZ.png");
  });

  /** Recomputes the base when navigation opens another Markdown document. */
  it("uses the current document folder on each render", () => {
    resolveMarkdownImages(imageRoot('<img src="picture.png">'), "/first/design.md");
    resolveMarkdownImages(imageRoot('<img src="picture.png">'), "/second/design.md");

    expect(vi.mocked(convertFileSrc).mock.calls).toEqual([
      ["/first/picture.png"],
      ["/second/picture.png"],
    ]);
  });
});
