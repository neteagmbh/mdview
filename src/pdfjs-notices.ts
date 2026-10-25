/** Full offline resource notices, embedded so the license view also works without filesystem access. */
const notices = import.meta.glob<string>([
  "../node_modules/pdfjs-dist/LICENSE",
  "../node_modules/pdfjs-dist/cmaps/LICENSE*",
  "../node_modules/pdfjs-dist/standard_fonts/LICENSE*",
  "../node_modules/pdfjs-dist/wasm/LICENSE*",
  "../node_modules/pdfjs-dist/iccs/LICENSE*",
  "../node_modules/core-js/LICENSE",
], { query: "?raw", import: "default", eager: true });

/** Formats each shipped PDF resource license verbatim for the embedded Markdown license view. */
export function getPdfjsNotices(): string {
  return "## Bundled PDF resource notices\n\n" + Object.entries(notices)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, text]) => `### ${path.replace("../node_modules/", "")}\n\n\`\`\`text\n${text.trim()}\n\`\`\``)
    .join("\n\n");
}
