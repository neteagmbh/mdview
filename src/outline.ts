export interface HeadingOutlineItem {
  element: HTMLHeadingElement;
  id: string;
  level: number;
  text: string;
}

/** Converts heading text into a stable URL-fragment base. */
function headingSlug(text: string): string {
  return (
    text
      .trim()
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

/** Builds an ordered outline and assigns unique IDs to document headings. */
export function buildHeadingOutline(root: ParentNode): HeadingOutlineItem[] {
  const usedIds = new Set<string>();

  return Array.from(
    root.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4, h5, h6"),
  ).map((element) => {
    const text = element.textContent?.trim() || "Untitled section";
    const baseId = headingSlug(text);
    let id = baseId;
    let suffix = 2;

    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }

    usedIds.add(id);
    element.id = id;

    return {
      element,
      id,
      level: Number.parseInt(element.tagName.slice(1), 10),
      text,
    };
  });
}

/** Smoothly aligns a selected heading with the top of the viewport. */
export function scrollHeadingIntoView(element: Element): void {
  element.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}
