/** Requests a password without logging, persisting, or retaining the entered value in the DOM. */
export function requestPdfPassword(dialog: HTMLDialogElement, name: string, incorrect: boolean,
  signal: AbortSignal): Promise<string | null> {
  signal.throwIfAborted();
  const form = dialog.querySelector<HTMLFormElement>("form")!;
  const input = dialog.querySelector<HTMLInputElement>("input")!;
  const message = dialog.querySelector<HTMLElement>("[data-password-message]")!;
  const cancel = dialog.querySelector<HTMLButtonElement>("[data-password-cancel]")!;
  message.textContent = incorrect ? `Incorrect password for ${name}. Try again.` : `Enter the password for ${name}.`;
  input.value = "";
  return new Promise(resolve => {
    /** Clears sensitive input and removes every request-specific listener before resolving. */
    const finish = (value: string | null) => {
      form.removeEventListener("submit", submit);
      cancel.removeEventListener("click", cancelled);
      dialog.removeEventListener("cancel", cancelled);
      dialog.removeEventListener("close", cancelled);
      signal.removeEventListener("abort", aborted);
      input.value = "";
      if (dialog.open) dialog.close();
      resolve(value);
    };
    /** Uses only the current submitted value, then clears the field before notifying PDF.js. */
    const submit = (event: Event) => { event.preventDefault(); finish(input.value); };
    /** Escape, the explicit cancel button, and native closing all cancel this request. */
    const cancelled = (event: Event) => { event.preventDefault(); finish(null); };
    /** A document switch closes the modal immediately, allowing the next document to load. */
    const aborted = () => finish(null);
    form.addEventListener("submit", submit);
    cancel.addEventListener("click", cancelled);
    dialog.addEventListener("cancel", cancelled);
    dialog.addEventListener("close", cancelled);
    signal.addEventListener("abort", aborted, { once: true });
    dialog.showModal();
    input.focus();
  });
}
