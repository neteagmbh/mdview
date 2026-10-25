import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { collectPdfjsAssets } from "./pdfjs-assets.mjs";
import { verifyPdfRelease } from "./verify-pdf-release.mjs";

/** Verifies byte identity and rejects diagnostic pages, user PDFs and stale workers in releases. */
test("production PDF inventory is complete and excludes test payloads", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const output = await mkdtemp(join(tmpdir(), "mdview-release-"));
  try {
    const { assets, prefix } = await collectPdfjsAssets(root);
    for (const [name, bytes] of assets) {
      await mkdir(dirname(join(output, name)), { recursive: true });
      await writeFile(join(output, name), bytes);
    }
    await writeFile(join(output, "index.html"), "<!doctype html><title>mdview</title>");
    assert.equal((await verifyPdfRelease(root, output)).assets, assets.size);
    const worker = prefix + "pdf.worker.min.mjs";
    await writeFile(join(output, worker), "stale worker");
    await assert.rejects(verifyPdfRelease(root, output), /Mismatched PDF resource/);
    await writeFile(join(output, worker), assets.get(worker));
    for (const name of ["private.pdf", "dev", "pdfjs-fixture-abc.js", "pdf-print-probe-abc.js"]) {
      await writeFile(join(output, name), "test only");
      await assert.rejects(verifyPdfRelease(root, output), /Diagnostic or corpus file/);
      await rm(join(output, name));
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
