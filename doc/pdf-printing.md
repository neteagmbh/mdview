# Complete-document PDF printing

Implemented 22 October 2026, implementation plan step 8. Platform release checks
listed below remain pending; implementation and runtime validation are separate.

## Dispatch and fidelity

The PDF Print button, keyboard shortcut and native Print menu use the PDF
renderer. Markdown retains its existing print preparation, native margins,
filename/date header, light Mermaid assets and page numbering.

| Platform | PDF print path |
|---|---|
| macOS | PDFKit prints the immutable original snapshot, retaining vector content, original page rotations and existing annotation appearances supported by PDFKit. The transient viewer password is supplied in memory. Native print settings choose paper; oversized pages scale down and may rotate to fit that paper, avoiding clipping. |
| iOS | AirPrint receives the original private PDF URL rather than a webview formatter. UIKit selects printer media and pagination. Encrypted PDFs currently fail explicitly; passing a viewer password cannot unlock UIKit's URL input. |
| Windows | A separate PDF.js job prepares every original page, then WebView2 opens the **system** print dialog. This avoids selecting the browser preview with its inherited title/date/URL decoration preferences. Actual system-dialog output and completion events require Windows validation. |
| Linux | The same complete-page preparation opens the native webview print dialog. Actual WebKitGTK printing and completion events require Linux validation. |

Input PDFs receive no Markdown repeating header/page-number decoration. Desktop
raster pages use named CSS page sizes and explicitly clear inherited margin-box
content. The source's page rotation determines print orientation; viewer zoom
and temporary screen rotation do not change the original print input.

Saving through a print dialog creates a **new printed PDF**, not a byte-for-byte
copy of the original. No Save Original command is introduced. Windows/Linux
output is rasterized and does not preserve original searchable text or vectors.
Native printer media constraints can change the output sheet size on all platforms.

## Ownership and limits

- Frontend printing retains an independent `PdfResource` lease. Rust atomically
  pins the snapshot behind the opaque handle; print IPC never accepts a source
  filesystem path from the frontend. Closing or reloading the viewer does not
  delete input already owned by a print job.
- Apple print RPCs finish when the native UI completes or is cancelled. The iOS
  delegate clears its formatter/item and resolves once. macOS's synchronous
  modal print operation runs on the UI thread while the async command waits off it.
- Windows/Linux pages, blob URLs, worker, task and lease remain live until
  `afterprint` (or page teardown). Duplicate PDF jobs are rejected. A missing
  completion event on a target engine is a release issue, not a reason to free
  pages while its dialog is still using them.
- Raster preparation uses a separate worker and loads **every page sequentially**,
  independent of the virtualized viewer cache. Cancel/Escape stops preparation;
  failure on any page prevents opening a partial-document print dialog.
- Resolution is 150 dpi, reduced for unusually large pages to keep one canvas
  within 16,777,216 pixels and 8192 pixels per dimension. Original physical page
  dimensions remain in the print layout. Compressed PNG output is limited to
  128 MiB; exceeding it fails clearly and releases prepared pages.
- This bounds owned canvases/compressed blobs, **not total process memory**.
  Browser image decoding, print spoolers, PDF decoders and native PDFKit/UIKit
  allocations require representative-document memory measurements.
- Printing permissions are checked by PDFKit on macOS, by the PDF input validator
  on iOS, and by PDF.js before raster preparation. Native failure does not fall
  back to printing visible canvases.

## Implementation and automated checks

- `src/pdf-print.ts` owns original/raster dispatch, preparation, cancellation,
  print-dialog lifetime, and complete cleanup. `src/pdf-print.css` isolates the
  PDF print DOM from Markdown and application chrome.
- `src-tauri/src/pdf_printing.rs` owns native platform dispatch. `PdfPrintSource`
  in `documents.rs` pins only an authorized immutable snapshot.
- The documents plugin uses `DocumentPrinting.swift` for both existing Markdown
  formatting and original-PDF AirPrint. `PdfPrintInput.swift` validates the private
  cache input, permissions, PDF content and encryption limitation.
- Tests cover long mixed-size preparation, canvas/output bounds, cancellation,
  partial failures, completion timing, duplicate/repeated jobs, retained leases,
  native failure without fallback, source/password dispatch and disposal.
- Rust tests cover print snapshot ownership after viewer release. Swift tests
  cover original/cache validation, corrupt/foreign input, encrypted input, and
  exactly-once native completion.

Validation on this macOS host:

| Check | Result |
|---|---|
| Native PDFKit print-to-PDF | 61/61 pages from an original mixed-size/rotated fixture; every source page's text survives on its corresponding output page. No physical printer used. First, rotated third, and last page previews visually inspected. |
| Production WebKit print preparation | 61/61 mixed-size pages rendered and decoded using the production helper under the custom Tauri scheme/CSP; all print DOM/blobs released. |
| Frontend, script, Rust, Swift unit suites | 219 frontend + 21 Node script + 56 Rust + 20 Swift checks passed (316 total). Two Swift packaging metadata checks skipped because built app plists were not supplied. |
| iOS Swift documents plugin | Simulator SDK build passed, including the new UIKit/PDFKit path. |
| iOS Rust bridge | `cargo check --target aarch64-apple-ios-sim` passed; existing desktop-menu dead-code warnings remain. |
| Full iOS archive | Blocked by the pre-existing generated Xcode build phase invoking `npm`, absent from this session's PATH. Direct plugin build and Rust target checking passed separately. |
| Clippy | Passes with existing warnings in `incoming_documents.rs`, the Markdown margin test, and `lib.rs`; strict `-D warnings` is not clean. No new print-module warning remains. |

## Reproduction and pending release gates

Build the opt-in probes with `MDVIEW_PDF_PROBE=1 npm run build`. Run complete
render preparation in native macOS WebKit:

```sh
MDVIEW_PDF_RENDER_ONLY=1 swift scripts/pdfjs-wk-probe.swift dist /tmp/unused.pdf tauri://localhost/dev/pdf-print-probe.html
```

Validate original PDFKit printing using a redistributable mixed-size/rotated PDF:

```sh
swift scripts/pdf-original-print-probe.swift input.pdf /tmp/printed-output.pdf
```

The helper writes a new print-to-PDF output and preview PNGs; it does not send a
physical print job. Compare source/output page counts and visible first/last,
rotated, mixed-size, annotation and embedded-font content.

Before release, run the actual app on Windows and Linux: Print from page 1 and a
distant page, verify every original page appears, check no browser/Markdown
decorations, inspect mixed sizes/rotation/annotations, cancel/reopen the dialog,
repeat printing, and close/reload the viewer while a print job owns the source.
Verify `afterprint` cleanup and native-error reporting; browser preparation alone
does not establish a native-platform pass. Measure long/image-heavy memory use.

Also required: physical iPad AirPrint, cancellation/repeated printing, provider
snapshots after viewer closure, encrypted/print-restricted corpus, and full iOS
archive validation in the standard Node/npm build environment. No Windows/Linux
dialog pass or physical AirPrint/printer pass is claimed here.

Native APIs: [Apple PDFKit printing](https://developer.apple.com/documentation/pdfkit/pdfdocument/printoperation(for:scalingmode:autorotate:))
and [Microsoft WebView2 printing](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/print).
