import { describe, expect, it } from "vitest";
import { highlightCode } from "./markdown";

describe("highlightCode", () => {
  /** Verifies token markup for a registered fenced-code language. */
  it("adds syntax tokens for a known fenced-code language", () => {
    const highlighted = highlightCode("const answer = 42;", "typescript");

    expect(highlighted).toContain('class="hljs-keyword"');
    expect(highlighted).toContain('class="hljs-number"');
  });

  /** Verifies safe plain-text rendering for unsupported language names. */
  it("escapes unknown-language code without adding guessed tokens", () => {
    const highlighted = highlightCode("<widget>", "not-a-language");

    expect(highlighted).toBe("&lt;widget&gt;");
  });
});
