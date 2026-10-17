import { describe, expect, it } from "vitest";
import { createPdfjsFixture } from "./pdfjs-fixture";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { preparePdfDocument } from "./pdfjs-compatibility";

describe("PDF.js probe fixture", () => {
  /** A real parser verifies the generated cross-reference table, fonts, pages and link annotations. */
  it("parses all three pages and their twelve font samples and links", async () => {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({ data: createPdfjsFixture(),
      standardFontDataUrl: fileURLToPath(new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url)),
      wasmUrl: fileURLToPath(new URL("../node_modules/pdfjs-dist/wasm/", import.meta.url)), useWasm: false });
    try {
      const pdf = preparePdfDocument(await task.promise, false);
      expect(pdf.numPages).toBe(3);
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        const text = await page.getTextContent();
        const lines = text.items.filter((item) => "str" in item && item.str.includes(`probe page ${number}:`));
        expect(lines).toHaveLength(12);
        expect((await page.getAnnotations())[0].url).toBe("https://mozilla.github.io/pdf.js/");
        const canvas = createCanvas(918, 1188);
        await page.render({ canvas: canvas as unknown as HTMLCanvasElement,
          viewport: page.getViewport({ scale: 1.5 }), intent: "print" }).promise;
        const pixel = canvas.getContext("2d").getImageData(690, 993, 1, 1).data;
        expect(pixel[0]).toBeGreaterThan(180);
        expect(pixel[1]).toBeLessThan(120);
        expect(pixel[2]).toBeLessThan(120);
      }
    } finally {
      await task.destroy();
    }
  });
});
