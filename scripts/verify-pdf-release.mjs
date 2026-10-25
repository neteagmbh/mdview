import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { collectPdfjsAssets } from "./pdfjs-assets.mjs";

/** Checks a normal production frontend for exact offline resources and accidental diagnostic PDFs. */
export async function verifyPdfRelease(root, output = join(root, "dist")) {
  const { assets, version } = await collectPdfjsAssets(root);
  for (const [name, expected] of assets) {
    const actual = await readFile(join(output, name));
    if (!actual.equals(expected)) throw new Error(`Mismatched PDF resource: ${name}`);
  }
  /** Walks only the explicitly selected build output, rejecting diagnostic/corpus payloads. */
  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Unexpected build symlink: ${relative(output, path)}`);
      if (/^(dev|testdata)$/.test(entry.name) || /\.pdf$/i.test(entry.name)
          || /(?:pdfjs|pdf-viewer|pdf-print|pdf-search-highlights)-probe|pdfjs-fixture/.test(entry.name)) {
        throw new Error(`Diagnostic or corpus file in release: ${relative(output, path)}`);
      }
      if (entry.isDirectory()) await inspect(path);
    }
  }
  await inspect(output);
  await readFile(join(output, "index.html"));
  return { version, assets: assets.size,
    resourceBytes: [...assets.values()].reduce((sum, bytes) => sum + bytes.length, 0),
    notices: [...assets.keys()].filter(name => /(?:^|\/)\w*LICENSE/.test(name)).length,
    diagnosticsExcluded: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await verifyPdfRelease(fileURLToPath(new URL("../", import.meta.url))), null, 2));
}
