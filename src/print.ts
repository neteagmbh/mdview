/** Function that asks the native backend to open a print dialog. */
export type NativePrint = () => Promise<boolean>;

/** Lets AppKit own page margins so WebKit measures and draws the same printable area. */
export async function printWithNativeMargins(
  nativePrint: NativePrint,
  page: Document = document,
): Promise<boolean> {
  const style = page.createElement("style");
  style.textContent = "@media print { @page { margin: auto; } }";
  page.head.append(style);
  const view = page.defaultView!;
  const restore = (): void => {
    style.remove();
    view.removeEventListener("afterprint", restore);
  };
  view.addEventListener("afterprint", restore);
  try {
    const supported = await nativePrint();
    if (!supported) restore();
    return supported;
  } catch (error) {
    restore();
    throw error;
  }
}

/** Waits for print images to decode and for their final dimensions to reach layout. */
export async function waitForPrintLayout(root: HTMLElement): Promise<void> {
  await root.ownerDocument.fonts.ready;
  await Promise.all(
    Array.from(root.querySelectorAll("img"), (image) =>
      image.decode().catch(() => undefined),
    ),
  );
  const view = root.ownerDocument.defaultView!;
  await new Promise<void>((resolve) => {
    view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve()));
  });
}

/** Opens the native print dialog when supported, otherwise invokes the browser fallback. */
export async function openPrintDialog(
  nativePrint: NativePrint,
  browserPrint: () => void,
  onNativeError: (error: unknown) => void = () => undefined,
  waitUntilReady: () => Promise<void> = async () => undefined,
): Promise<"native" | "browser"> {
  await waitUntilReady();
  try {
    if (await nativePrint()) {
      return "native";
    }
  } catch (error) {
    onNativeError(error);
    throw error;
  }

  browserPrint();
  return "browser";
}
