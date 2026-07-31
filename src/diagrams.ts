import DOMPurify from "dompurify";

interface MermaidRenderer {
  initialize: (configuration: Record<string, unknown>) => void;
  render: (id: string, source: string) => Promise<{ svg: string }>;
}

interface MermaidRenderOptions {
  dark?: boolean;
  load?: () => Promise<MermaidRenderer>;
  sanitize?: (svg: string) => string;
}

let diagramId = 0;

/** Loads Mermaid on demand so documents without diagrams avoid its cost. */
async function loadMermaid(): Promise<MermaidRenderer> {
  const { default: mermaid } = await import("mermaid");
  return mermaid as unknown as MermaidRenderer;
}

/** Removes unsafe content from a Mermaid-generated SVG. */
function sanitizeMermaidSvg(svg: string): string {
  return String(
    DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
    }),
  );
}

/** Replaces one failed diagram with a readable error and its original source. */
function showDiagramError(container: HTMLElement, source: string, error: unknown): void {
  container.className = "mermaid-error";
  const message = document.createElement("p");
  message.textContent = `Could not render Mermaid diagram: ${
    error instanceof Error ? error.message : String(error)
  }`;
  const sourceBlock = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = source;
  sourceBlock.append(code);
  container.replaceChildren(message, sourceBlock);
}

/** Renders all Mermaid code fences below a document root as sanitized SVG diagrams. */
export async function renderMermaidDiagrams(
  root: ParentNode,
  options: MermaidRenderOptions = {},
): Promise<void> {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>("pre > code.language-mermaid"),
  ).map((code) => ({
    source: code.textContent || "",
    pre: code.parentElement as HTMLElement,
  }));

  if (blocks.length === 0) {
    return;
  }

  let renderer: MermaidRenderer;
  try {
    renderer = await (options.load || loadMermaid)();
    renderer.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: options.dark ? "dark" : "default",
      htmlLabels: false,
    });
  } catch (error) {
    blocks.forEach(({ pre, source }) => {
      const container = document.createElement("div");
      pre.replaceWith(container);
      showDiagramError(container, source, error);
    });
    return;
  }

  for (const { pre, source } of blocks) {
    const container = document.createElement("div");
    container.className = "mermaid-diagram";
    pre.replaceWith(container);

    try {
      diagramId += 1;
      const { svg } = await renderer.render(`mdview-mermaid-${diagramId}`, source);
      container.innerHTML = (options.sanitize || sanitizeMermaidSvg)(svg);
    } catch (error) {
      showDiagramError(container, source, error);
    }
  }
}
