// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { requestPdfPassword } from "./pdf-password";

/** Models native dialog open/close while retaining real form and abort event handling. */
function fixture() {
  const dialog = document.createElement("dialog");
  dialog.innerHTML = '<form><p data-password-message></p><input type="password"><button data-password-cancel type="button">Cancel</button></form>';
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new Event("close")); };
  document.body.append(dialog);
  return { dialog, input: dialog.querySelector("input")!, abort: new AbortController() };
}

describe("PDF password requests", () => {
  /** Submitted values are delivered only to the caller and immediately removed from the DOM. */
  it("submits and clears transient passwords", async () => {
    const { dialog, input, abort } = fixture();
    const pending = requestPdfPassword(dialog, "private.pdf", false, abort.signal);
    expect(dialog.open).toBe(true);
    input.value = "test-secret";
    dialog.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(await pending).toBe("test-secret");
    expect(input.value).toBe("");
    expect(dialog.open).toBe(false);
  });

  /** Incorrect-password retry changes the message without reusing the old field value. */
  it("starts retry requests with empty input", async () => {
    const { dialog, input, abort } = fixture();
    input.value = "old-password";
    const pending = requestPdfPassword(dialog, "private.pdf", true, abort.signal);
    expect(input.value).toBe("");
    expect(dialog.textContent).toContain("Incorrect password");
    abort.abort();
    expect(await pending).toBeNull();
    expect(dialog.open).toBe(false);
  });

  /** Both Escape and the explicit cancel button resolve cancellation rather than retaining a secret. */
  it("handles button and Escape cancellation", async () => {
    for (const action of ["button", "escape"]) {
      const { dialog, input, abort } = fixture();
      const pending = requestPdfPassword(dialog, "private.pdf", false, abort.signal);
      input.value = "discard";
      if (action === "button") dialog.querySelector("button")!.click();
      else dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
      expect(await pending).toBeNull();
      expect(input.value).toBe("");
      expect(dialog.open).toBe(false);
    }
  });
});
