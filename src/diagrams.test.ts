// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { diagramToPngDataUrl, renderMermaidDiagrams } from "./diagrams";

describe("diagramToPngDataUrl", () => {
  /** Verifies the diagram's viewBox size and an SVG data URL are passed to the renderer. */
  it("measures the SVG from its viewBox and forwards an svg+xml data URL", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 320 200");
    svg.innerHTML = "<text>diagram</text>";
    const render = vi.fn().mockResolvedValue("data:image/png;base64,fake");

    const result = await diagramToPngDataUrl(svg, render);

    expect(result).toBe("data:image/png;base64,fake");
    expect(render).toHaveBeenCalledWith(
      expect.stringContaining("data:image/svg+xml;charset=utf-8,"),
      320,
      200,
    );
  });

  /** Verifies a missing/empty viewBox falls back to a fixed default size. */
  it("falls back to a default size when no viewBox is present", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const render = vi.fn().mockResolvedValue("data:image/png;base64,fake");

    await diagramToPngDataUrl(svg, render);

    expect(render).toHaveBeenCalledWith(expect.any(String), 800, 600);
  });
});

describe("renderMermaidDiagrams", () => {
  /** Verifies that lazy loading is skipped when no Mermaid fence exists. */
  it("does not load Mermaid when the document has no Mermaid fence", async () => {
    const root = document.createElement("article");
    root.innerHTML = "<pre><code>plain code</code></pre>";
    const load = vi.fn();

    await renderMermaidDiagrams(root, { load });

    expect(load).not.toHaveBeenCalled();
  });

  /** Verifies strict initialization, SVG labels, sanitization, and DOM insertion. */
  it("renders and sanitizes Mermaid fences using strict configuration", async () => {
    const root = document.createElement("article");
    root.innerHTML = '<pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre>';
    const renderer = {
      initialize: vi.fn(),
      render: vi.fn().mockResolvedValue({ svg: "<svg><text>diagram</text></svg>" }),
    };
    const sanitize = vi.fn((svg: string) => svg);
    const renderClipboardImage = vi.fn().mockResolvedValue("data:image/png;base64,fake");

    await renderMermaidDiagrams(root, {
      dark: true,
      load: async () => renderer,
      sanitize,
      renderClipboardImage,
    });

    expect(renderer.initialize).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: "dark",
        htmlLabels: false,
      }),
    );
    expect(sanitize).toHaveBeenCalled();
    expect(root.querySelector(".mermaid-diagram svg")?.textContent).toBe("diagram");
    expect(renderClipboardImage).toHaveBeenCalledWith(
      expect.objectContaining({ textContent: "diagram" }),
    );
    expect(root.querySelector<HTMLElement>(".mermaid-diagram")?.dataset.clipboardPng).toBe(
      "data:image/png;base64,fake",
    );
  });

  /** Verifies the clipboard image is rendered in the light theme even when the document is dark. */
  it("re-renders in the light theme for the clipboard image while displaying dark mode", async () => {
    const root = document.createElement("article");
    root.innerHTML = '<pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre>';
    const renderer = {
      initialize: vi.fn(),
      render: vi.fn().mockResolvedValue({ svg: "<svg><text>diagram</text></svg>" }),
    };

    await renderMermaidDiagrams(root, {
      dark: true,
      load: async () => renderer,
      renderClipboardImage: async () => "data:image/png;base64,fake",
    });

    expect(renderer.initialize).toHaveBeenCalledTimes(2);
    expect(renderer.initialize).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ theme: "default" }),
    );
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(renderer.render.mock.calls[1][1]).toBe("graph TD; A-->B");
  });

  /** Verifies that one parse failure does not replace surrounding document content. */
  it("keeps a failed diagram local and displays its source", async () => {
    const root = document.createElement("article");
    root.innerHTML = `
      <p>Before</p>
      <pre><code class="language-mermaid">invalid diagram</code></pre>
      <p>After</p>
    `;
    const renderer = {
      initialize: vi.fn(),
      render: vi.fn().mockRejectedValue(new Error("parse error")),
    };

    await renderMermaidDiagrams(root, { load: async () => renderer });

    expect(root.querySelector(".mermaid-error")?.textContent).toContain("parse error");
    expect(root.querySelector(".mermaid-error code")?.textContent).toBe("invalid diagram");
    expect(root.querySelectorAll("p")).toHaveLength(3);
  });

  /** Verifies that a loader failure produces a readable source-preserving fallback. */
  it("shows a localized fallback when the lazy Mermaid import fails", async () => {
    const root = document.createElement("article");
    root.innerHTML = '<pre><code class="language-mermaid">graph TD</code></pre>';

    await renderMermaidDiagrams(root, {
      load: async () => Promise.reject(new Error("module unavailable")),
    });

    expect(root.querySelector(".mermaid-error")?.tagName).toBe("DIV");
    expect(root.querySelector(".mermaid-error")?.textContent).toContain("module unavailable");
    expect(root.querySelector(".mermaid-error code")?.textContent).toBe("graph TD");
  });

  /** Verifies that executable SVG elements are removed before insertion. */
  it("removes executable content from rendered SVG", async () => {
    const root = document.createElement("article");
    root.innerHTML = '<pre><code class="language-mermaid">graph TD</code></pre>';
    const renderer = {
      initialize: vi.fn(),
      render: vi.fn().mockResolvedValue({
        svg: "<svg><script>alert('unsafe')</script><text>safe</text></svg>",
      }),
    };

    await renderMermaidDiagrams(root, {
      load: async () => renderer,
      renderClipboardImage: async () => "data:image/png;base64,fake",
    });

    expect(root.querySelector(".mermaid-diagram script")).toBeNull();
    expect(root.querySelector(".mermaid-diagram text")?.textContent).toBe("safe");
  });

  /** Verifies a clipboard-image rendering failure is swallowed, leaving the diagram usable. */
  it("leaves the diagram usable when clipboard-image rendering fails", async () => {
    const root = document.createElement("article");
    root.innerHTML = '<pre><code class="language-mermaid">graph TD</code></pre>';
    const renderer = {
      initialize: vi.fn(),
      render: vi.fn().mockResolvedValue({ svg: "<svg><text>diagram</text></svg>" }),
    };

    await renderMermaidDiagrams(root, {
      load: async () => renderer,
      renderClipboardImage: async () => Promise.reject(new Error("rasterization unavailable")),
    });

    expect(root.querySelector(".mermaid-diagram svg")).not.toBeNull();
    expect(
      root.querySelector<HTMLElement>(".mermaid-diagram")?.dataset.clipboardPng,
    ).toBeUndefined();
  });
});
