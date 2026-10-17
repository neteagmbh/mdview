import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectPdfjsAssets, pdfjsAssets } from "./pdfjs-assets.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

/** Guards exact-version worker delivery and the complete offline resource inventory. */
test("PDF assets come from the pinned release and retain distribution notices", async () => {
  const { assets, version, prefix } = await collectPdfjsAssets(root);
  const worker = assets.get(prefix + "pdf.worker.min.mjs").toString();
  assert.ok(worker.includes(version));
  for (const family of ["cmaps/", "standard_fonts/", "wasm/", "iccs/", "images/"]) {
    assert.ok([...assets.keys()].some((name) => name.startsWith(prefix + family)));
  }
  assert.ok(assets.has(prefix + "LICENSE"));
  assert.ok(assets.has(prefix + "standard_fonts/LICENSE_FOXIT"));
  assert.ok(assets.has(prefix + "wasm/LICENSE_OPENJPEG"));
  assert.ok(assets.has(prefix + "iccs/LICENSE"));
  assert.ok(![...assets.keys()].some((name) => name.includes("quickjs")));
});

/** A stale installation must fail rather than silently pairing different parser/worker versions. */
test("rejects a mismatched parser/worker installation", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "mdview-pdfjs-assets-"));
  try {
    await mkdir(join(temporary, "node_modules/pdfjs-dist"), { recursive: true });
    await writeFile(join(temporary, "package.json"), JSON.stringify({ dependencies: { "pdfjs-dist": "6.4.299" } }));
    await writeFile(join(temporary, "node_modules/pdfjs-dist/package.json"), JSON.stringify({ version: "6.0.0" }));
    await assert.rejects(collectPdfjsAssets(temporary), /pinned to the installed exact version/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

/** Development must serve the same bytes as packaged builds without arbitrary file access. */
test("dev middleware serves known resources only, with module and WASM MIME types", async () => {
  const plugin = pdfjsAssets(root);
  await plugin.configResolved({ base: "/" });
  let middleware;
  plugin.configureServer({ middlewares: { use: (handler) => { middleware = handler; } } });
  const { assets, prefix } = await collectPdfjsAssets(root);
  for (const [resource, mime] of [["pdf.worker.min.mjs", "text/javascript"], ["wasm/openjpeg.wasm", "application/wasm"]]) {
    const headers = {};
    middleware({ url: "/" + prefix + resource }, {
      setHeader: (name, value) => { headers[name] = value; },
      end: (body) => assert.deepEqual(body, assets.get(prefix + resource)),
    }, () => assert.fail("Known asset was not served"));
    assert.equal(headers["Content-Type"], mime);
  }
  for (const url of ["/pdfjs/other/pdf.worker.min.mjs", "/pdfjs/../../package.json", "/pdfjs/%2e%2e/package.json"]) {
    let next = false;
    middleware({ url }, { end: () => assert.fail("Unexpected resource exposure") }, () => { next = true; });
    assert.ok(next);
  }
});

/** The application CSP allows offline decoding without unrestricted script evaluation or workers. */
test("PDF CSP stays scoped to local workers, local fetches, fonts and WASM", async () => {
  const config = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  const policy = config.app.security.csp;
  assert.match(policy, /worker-src 'self';/);
  assert.match(policy, /script-src 'self' 'wasm-unsafe-eval';/);
  assert.match(policy, /connect-src 'self' ipc: http:\/\/ipc.localhost/);
  assert.ok(!policy.includes("'unsafe-eval'"));
  assert.ok(!policy.includes("worker-src blob:"));
});
