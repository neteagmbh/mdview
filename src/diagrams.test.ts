// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderMermaidDiagrams } from "./diagrams";

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

    await renderMermaidDiagrams(root, {
      dark: true,
      load: async () => renderer,
      sanitize,
    });

    expect(renderer.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: "dark",
        htmlLabels: false,
      }),
    );
    expect(sanitize).toHaveBeenCalled();
    expect(root.querySelector(".mermaid-diagram svg")?.textContent).toBe("diagram");
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

    await renderMermaidDiagrams(root, { load: async () => renderer });

    expect(root.querySelector(".mermaid-diagram script")).toBeNull();
    expect(root.querySelector(".mermaid-diagram text")?.textContent).toBe("safe");
  });
});
