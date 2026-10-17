import { createCanvas } from "@napi-rs/canvas";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/** Regenerates the original four-color JPX fixture using Apple's built-in JPEG 2000 encoder. */
async function createProbeImage() {
  const temporary = await mkdtemp(join(tmpdir(), "mdview-jpx-"));
  try {
    const canvas = createCanvas(64, 64);
    const context = canvas.getContext("2d");
    for (const [index, color] of ["#e53935", "#43a047", "#1e88e5", "#fdd835"].entries()) {
      context.fillStyle = color;
      context.fillRect((index % 2) * 32, Math.floor(index / 2) * 32, 32, 32);
    }
    const jpeg = join(temporary, "colors.jpg");
    const jpx = join(temporary, "colors.jp2");
    await writeFile(jpeg, canvas.toBuffer("image/jpeg", 95));
    const encoded = spawnSync("/usr/bin/sips", ["-s", "format", "jp2", jpeg, "--out", jpx], { encoding: "utf8" });
    if (encoded.status !== 0) throw new Error(encoded.stderr || "JPEG 2000 encoding failed.");
    await writeFile(new URL("../src/pdfjs-probe-jpx.hex", import.meta.url), (await readFile(jpx)).toString("hex") + "\n");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

await createProbeImage();
