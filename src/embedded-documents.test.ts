import { describe, expect, it } from "vitest";
import { getEmbeddedDocument } from "./embedded-documents";

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
});
