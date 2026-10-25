import { describe, expect, it } from "vitest";
import { getEmbeddedDocument } from "./embedded-documents";
import { readFileSync, readdirSync } from "node:fs";

describe("getEmbeddedDocument", () => {
  /** Verifies that the complete project license is embedded as displayable Markdown. */
  it("provides the MIT license", () => {
    const document = getEmbeddedDocument("license");

    expect(document.title).toBe("MIT License");
    expect(document.content).toContain("Permission is hereby granted");
  });

  /** Verifies that third-party notices are bundled without filesystem or LRU metadata. */
  it("provides third-party notices independently of the LRU", () => {
    const document = getEmbeddedDocument("third-party-licenses");

    expect(document.content).toContain("Runtime frontend libraries");
    expect(document).not.toHaveProperty("path");
    expect(document).not.toHaveProperty("recentFolders");
  });

  /** Guards the complete locally shipped license inventory, including fonts, CMaps and decoders. */
  it("embeds the full text of every bundled PDF resource notice", () => {
    const content = getEmbeddedDocument("third-party-licenses").content;
    const distribution = new URL("../node_modules/pdfjs-dist/", import.meta.url);
    const files = [new URL("LICENSE", distribution), new URL("../core-js/LICENSE", distribution)];
    for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
      const root = new URL(`${directory}/`, distribution);
      files.push(...readdirSync(root).filter(name => name.startsWith("LICENSE"))
        .map(name => new URL(name, root)));
    }
    expect(files.length).toBeGreaterThan(8);
    for (const file of files) {
      expect(content).toContain(readFileSync(file, "utf8").trim());
    }
  });
});
