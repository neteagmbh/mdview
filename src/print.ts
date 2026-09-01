/** Function that asks the native backend to open a print dialog. */
export type NativePrint = () => Promise<boolean>;

/** Opens the native print dialog when supported, otherwise invokes the browser fallback. */
export async function openPrintDialog(
  nativePrint: NativePrint,
  browserPrint: () => void,
  onNativeError: (error: unknown) => void = () => undefined,
): Promise<"native" | "browser"> {
  try {
    if (await nativePrint()) {
      return "native";
    }
  } catch (error) {
    onNativeError(error);
  }

  browserPrint();
  return "browser";
}