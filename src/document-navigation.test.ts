import { expect, it, vi } from "vitest";
import { createDocumentNavigation, type DocumentDestination } from "./document-navigation";

/** Back restores the captured PDF destination even when the source's saved position changes later. */
it("restores PDF coordinates across Markdown links and preserves Markdown anchors", async () => {
  let current: DocumentDestination = { path: "/original.pdf", fragment: null,
    position: { page: 40, offset: 0.35, left: 0.2, mode: "custom", scale: 1.5, rotation: 90 } };
  const source = structuredClone(current);
  const open = vi.fn(async (next: DocumentDestination, _source?: string) => { current = next; return true; });
  const navigation = createDocumentNavigation(() => current, open);
  await navigation.follow("/readme.md", "heading");
  await navigation.follow("/other.pdf", "page=3");
  await navigation.back();
  expect(current).toEqual({ path: "/readme.md", fragment: "heading" });
  await navigation.back();
  expect(current).toEqual(source);
  expect(navigation.hasBack).toBe(false);
  expect(open).toHaveBeenCalledWith({ path: "/readme.md", fragment: "heading" }, "/original.pdf");
});

/** Failed links do not create phantom history entries. */
it("does not retain a failed navigation", async () => {
  const navigation = createDocumentNavigation(() => ({ path: "/readme.md", fragment: null }), vi.fn(async () => false));
  await navigation.follow("/missing.pdf", null);
  expect(navigation.hasBack).toBe(false);
});

/** A tree/picker switch from PDF to Markdown can return to the exact PDF destination. */
it("records explicit cross-type visits without relative-link authorization", async () => {
  let current: DocumentDestination = { path: "/read.pdf", fragment: null,
    position: { page: 4, offset: 0.4, left: 0, scale: 1, mode: "page-width", rotation: 0 } };
  const original = structuredClone(current);
  const open = vi.fn(async (next: DocumentDestination) => { current = next; return true; });
  const navigation = createDocumentNavigation(() => current, open);
  expect(await navigation.visit("/readme.md", null)).toBe(true);
  expect(open).toHaveBeenCalledExactlyOnceWith({ path: "/readme.md", fragment: null });
  await navigation.back();
  expect(current).toEqual(original);
});
