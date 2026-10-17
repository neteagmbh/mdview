import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Resource families needed for offline PDF rendering and viewer controls. */
const directories = ["cmaps", "standard_fonts", "wasm", "iccs", "web/images"];

/** Inventories a pinned PDF.js installation without exposing arbitrary filesystem paths. */
export async function collectPdfjsAssets(root) {
  const packageRoot = join(root, "node_modules/pdfjs-dist");
  const metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  const application = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (application.dependencies["pdfjs-dist"] !== metadata.version) {
    throw new Error("PDF.js must be pinned to the installed exact version.");
  }
  const prefix = `pdfjs/${metadata.version}/`;
  const assets = new Map();
  /** Adds only inventoried distribution files under a versioned public URL. */
  async function add(source, destination) {
    assets.set(prefix + destination, await readFile(join(packageRoot, source)));
  }
  await add("legacy/build/pdf.worker.min.mjs", "pdf.worker.min.mjs");
  await add("LICENSE", "LICENSE");
  assets.set(prefix + "CORE_JS_LICENSE", await readFile(join(root, "node_modules/core-js/LICENSE")));
  for (const directory of directories) {
    for (const entry of await readdir(join(packageRoot, directory), { withFileTypes: true })) {
      // The read-only viewer does not need the optional QuickJS scripting sandbox.
      if (entry.isFile() && !entry.name.startsWith("quickjs-")) {
        await add(`${directory}/${entry.name}`, `${directory.replace("web/", "")}/${entry.name}`);
      }
    }
  }
  return { version: metadata.version, prefix, assets };
}

/** Serves identical offline resources in development and emits them into packaged builds. */
export function pdfjsAssets(root = fileURLToPath(new URL("../", import.meta.url))) {
  let inventory;
  let base;
  let building = false;
  return {
    name: "mdview-pdfjs-assets",
    async configResolved(config) {
      base = config.base;
      building = config.command === "build";
      inventory = await collectPdfjsAssets(resolve(root));
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        const asset = inventory.assets.get(pathname.slice(base.length));
        if (!pathname.startsWith(base) || !asset) return next();
        const type = pathname.endsWith(".mjs") || pathname.endsWith(".js")
          ? "text/javascript" : pathname.endsWith(".wasm")
            ? "application/wasm" : pathname.endsWith(".svg")
              ? "image/svg+xml" : "application/octet-stream";
        response.setHeader("Content-Type", type);
        response.setHeader("Cache-Control", "no-cache");
        response.end(asset);
      });
    },
    buildStart() {
      if (!building) return;
      for (const [fileName, source] of inventory.assets) {
        this.emitFile({ type: "asset", fileName, source });
      }
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { version, assets } = await collectPdfjsAssets(fileURLToPath(new URL("../", import.meta.url)));
  console.log(JSON.stringify({ version, assetCount: assets.size,
    resourceBytes: [...assets.values()].reduce((total, bytes) => total + bytes.byteLength, 0) }, null, 2));
}
