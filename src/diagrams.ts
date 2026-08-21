import DOMPurify from "dompurify";

interface MermaidRenderer {
  initialize: (configuration: Record<string, unknown>) => void;
  render: (id: string, source: string) => Promise<{ svg: string }>;
}

interface MermaidRenderOptions {
  dark?: boolean;
  load?: () => Promise<MermaidRenderer>;
  sanitize?: (svg: string) => string;
  renderClipboardImage?: ClipboardImageRenderer;
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

/** Low-level rasterizer: draws a `data:image/svg+xml` URL onto a canvas and returns a PNG data URL. */
export type SvgToPngRenderer = (
  svgDataUrl: string,
  width: number,
  height: number,
) => Promise<string>;

/** Renders an SVG data URL onto an offscreen canvas with a white background and returns a PNG data URL. */
async function rasterizeSvgToPng(
  svgDataUrl: string,
  width: number,
  height: number,
): Promise<string> {
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not load the diagram for rasterization."));
  });
  image.src = svgDataUrl;
  await loaded;

  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas rendering is not available.");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

/** Reads a rendered diagram's display size from its viewBox, falling back to its bounding box. */
function measureSvgSize(svg: SVGSVGElement): { width: number; height: number } {
  const viewBoxAttr = svg.getAttribute("viewBox");
  if (viewBoxAttr) {
    const parts = viewBoxAttr.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }
  const rect = svg.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return { width: rect.width, height: rect.height };
  }
  return { width: 800, height: 600 };
}

/** Encodes an SVG element as a `data:image/svg+xml` URL. */
function svgToDataUrl(svg: SVGSVGElement): string {
  const markup = new XMLSerializer().serializeToString(svg);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

/** Renders a diagram's SVG to a PNG data URL, for embedding where inline SVG is not supported (e.g. Word/Outlook paste). */
export type ClipboardImageRenderer = (svg: SVGSVGElement) => Promise<string>;

/** Default clipboard-image renderer: rasterizes the diagram via {@link rasterizeSvgToPng}. */
export async function diagramToPngDataUrl(
  svg: SVGSVGElement,
  render: SvgToPngRenderer = rasterizeSvgToPng,
): Promise<string> {
  const { width, height } = measureSvgSize(svg);
  return render(svgToDataUrl(svg), width, height);
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

  const rendered: { container: HTMLElement; source: string }[] = [];

  for (const { pre, source } of blocks) {
    const container = document.createElement("div");
    container.className = "mermaid-diagram";
    pre.replaceWith(container);

    try {
      diagramId += 1;
      const { svg } = await renderer.render(`mdview-mermaid-${diagramId}`, source);
      container.innerHTML = (options.sanitize || sanitizeMermaidSvg)(svg);
      rendered.push({ container, source });
    } catch (error) {
      showDiagramError(container, source, error);
    }
  }

  await cacheClipboardImages(renderer, rendered, options);
}

/**
 * Caches a light-theme PNG on each diagram for the clipboard, independent of the on-screen theme.
 *
 * Word/Outlook paste onto a white page, so the exported diagram must always use the light Mermaid
 * theme even while the document itself is displayed in dark mode.
 */
async function cacheClipboardImages(
  renderer: MermaidRenderer,
  rendered: { container: HTMLElement; source: string }[],
  options: MermaidRenderOptions,
): Promise<void> {
  if (rendered.length === 0) {
    return;
  }

  if (options.dark) {
    try {
      renderer.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: "default",
        htmlLabels: false,
      });
    } catch {
      return;
    }
  }

  for (const { container, source } of rendered) {
    try {
      let lightSvg: SVGSVGElement | null;
      if (options.dark) {
        diagramId += 1;
        const { svg } = await renderer.render(`mdview-mermaid-clipboard-${diagramId}`, source);
        const detached = document.createElement("div");
        detached.innerHTML = (options.sanitize || sanitizeMermaidSvg)(svg);
        lightSvg = detached.querySelector("svg");
      } else {
        lightSvg = container.querySelector("svg");
      }

      if (lightSvg) {
        container.dataset.clipboardPng = await (
          options.renderClipboardImage || diagramToPngDataUrl
        )(lightSvg);
      }
    } catch {
      delete container.dataset.clipboardPng;
    }
  }
}
