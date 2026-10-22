// @vitest-environment jsdom
import { expect, it } from "vitest";
import { updateDocumentShell } from "./document-shell";

/** Real controls exercise renderer transitions without importing Tauri's application bootstrap. */
it("labels and gates PDF, Markdown, and unavailable document controls", () => {
  const print = document.createElement("button"), outline = document.createElement("button");
  const zoom = [document.createElement("button"), document.createElement("button")];
  const fileScope = document.createElement("option"), outlineTitle = document.createElement("h2"), outlineNav = document.createElement("nav");
  const fileIcon = document.createElement("span");
  const controls = { print, outline, zoom, fileScope, outlineTitle, outlineNav, fileIcon };
  updateDocumentShell(controls, "pdf", { print: false, find: true, outline: true });
  expect(print.disabled).toBe(true);
  expect(fileIcon.hidden).toBe(false);
  expect(fileIcon.querySelector("svg text")?.textContent).toBe("PDF");
  expect(print.title).toContain("not available yet");
  expect(print.getAttribute("aria-label")).toContain("PDF");
  expect(fileScope.textContent).toBe("This PDF");
  expect(fileScope.disabled).toBe(false);
  expect(outline.disabled).toBe(false);
  expect(outlineTitle.textContent).toBe("Bookmarks");
  expect(outlineNav.getAttribute("aria-label")).toBe("PDF bookmarks");
  outline.setAttribute("aria-expanded", "true");
  updateDocumentShell(controls, "markdown", { print: true, find: true, outline: true });
  expect(print.disabled).toBe(false);
  expect(fileIcon.querySelector("svg text")?.textContent).toBe("MD");
  expect(fileIcon.children).toHaveLength(1);
  expect(fileScope.textContent).toBe("This Markdown file");
  expect(outline.title).toBe("Close document outline");
  expect(outlineTitle.textContent).toBe("On this page");
  updateDocumentShell(controls, null, { print: false, find: false, outline: false });
  expect(fileScope.disabled && outline.disabled && print.disabled && zoom.every(button => button.disabled)).toBe(true);
  expect(fileIcon.hidden).toBe(true);
  expect(fileIcon.children).toHaveLength(0);
});
