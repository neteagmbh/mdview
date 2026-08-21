// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  attachContentInteractions,
  classifyMarkdownLink,
  resolveMarkdownLinkPath,
} from "./content-interactions";

describe("classifyMarkdownLink", () => {
  /** Verifies http(s) links are classified as external regardless of the open document. */
  it("classifies http(s) links as external", () => {
    expect(classifyMarkdownLink("https://example.com/docs", "/docs/readme.md")).toEqual({
      kind: "external",
      url: "https://example.com/docs",
    });
    expect(classifyMarkdownLink("http://example.com", null)).toEqual({
      kind: "external",
      url: "http://example.com",
    });
  });

  /** Verifies non-web schemes (e.g. mailto) and same-page fragments are left untouched. */
  it("classifies other schemes and pure fragments as other", () => {
    expect(classifyMarkdownLink("mailto:test@example.com", "/docs/readme.md")).toEqual({
      kind: "other",
    });
    expect(classifyMarkdownLink("#section", "/docs/readme.md")).toEqual({ kind: "other" });
  });

  /** Verifies non-Markdown relative links (e.g. images) are not treated as document navigation. */
  it("classifies non-Markdown relative links as other", () => {
    expect(classifyMarkdownLink("./diagram.png", "/docs/readme.md")).toEqual({ kind: "other" });
  });

  /** Verifies relative Markdown links resolve against the current document and keep their fragment. */
  it("classifies relative Markdown links as internal and resolves the path", () => {
    expect(classifyMarkdownLink("./guides/setup.md#install", "/docs/readme.md")).toEqual({
      kind: "internal-markdown",
      path: "/docs/guides/setup.md",
      fragment: "install",
    });
    expect(classifyMarkdownLink("../CHANGELOG.md", "/docs/guides/setup.md")).toEqual({
      kind: "internal-markdown",
      path: "/docs/CHANGELOG.md",
      fragment: null,
    });
  });

  /** Verifies Markdown links without a currently open document cannot be resolved. */
  it("classifies relative Markdown links as other when no document is open", () => {
    expect(classifyMarkdownLink("./setup.md", null)).toEqual({ kind: "other" });
  });
});

describe("resolveMarkdownLinkPath", () => {
  /** Verifies parent-directory segments are collapsed correctly. */
  it("resolves parent-directory references", () => {
    expect(resolveMarkdownLinkPath("/a/b/c/current.md", "../../sibling.md")).toBe(
      "/a/sibling.md",
    );
  });
});

describe("attachContentInteractions", () => {
  /** Verifies an image click opens the popout instead of following default browser behavior. */
  it("delegates image clicks to openImage", () => {
    const root = document.createElement("article");
    root.innerHTML = '<img src="https://example.com/pic.png" alt="A picture">';
    document.body.append(root);
    const handlers = {
      getCurrentPath: () => null,
      openInternalLink: vi.fn(),
      openExternalLink: vi.fn(),
      openImage: vi.fn(),
    };

    attachContentInteractions(root, handlers);
    const image = root.querySelector("img")!;
    image.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(handlers.openImage).toHaveBeenCalledWith(image);
  });

  /** Verifies a click on a Mermaid diagram's SVG opens the popout like an image click. */
  it("delegates Mermaid diagram clicks to openImage", () => {
    const root = document.createElement("article");
    root.innerHTML =
      '<div class="mermaid-diagram"><svg><text>diagram</text></svg></div>';
    document.body.append(root);
    const handlers = {
      getCurrentPath: () => null,
      openInternalLink: vi.fn(),
      openExternalLink: vi.fn(),
      openImage: vi.fn(),
    };

    attachContentInteractions(root, handlers);
    const svg = root.querySelector("svg")!;
    svg.querySelector("text")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(handlers.openImage).toHaveBeenCalledWith(svg);
  });

  /** Verifies an external link click is intercepted and routed to openExternalLink. */
  it("delegates external link clicks to openExternalLink", () => {
    const root = document.createElement("article");
    root.innerHTML = '<a href="https://example.com">Example</a>';
    document.body.append(root);
    const handlers = {
      getCurrentPath: () => "/docs/readme.md",
      openInternalLink: vi.fn(),
      openExternalLink: vi.fn(),
      openImage: vi.fn(),
    };

    attachContentInteractions(root, handlers);
    root
      .querySelector("a")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(handlers.openExternalLink).toHaveBeenCalledWith("https://example.com");
  });

  /** Verifies a relative Markdown link click is intercepted and routed to openInternalLink. */
  it("delegates internal Markdown link clicks to openInternalLink", () => {
    const root = document.createElement("article");
    root.innerHTML = '<a href="./setup.md#install">Setup</a>';
    document.body.append(root);
    const handlers = {
      getCurrentPath: () => "/docs/readme.md",
      openInternalLink: vi.fn(),
      openExternalLink: vi.fn(),
      openImage: vi.fn(),
    };

    attachContentInteractions(root, handlers);
    root
      .querySelector("a")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(handlers.openInternalLink).toHaveBeenCalledWith("/docs/setup.md", "install");
  });
});
