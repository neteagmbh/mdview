# PDF implementation closure and release verification

Date: 23 October 2026.
Plan: [PDF.js implementation plan](pdf-support-implementation-plan.md).
Status: implementation steps 1–9 closed; release approval remains gated by the
untested platform/device cases below. Closing this plan does not publish a build
or assert that every supported platform has passed release acceptance.

## Delivered scope

PDF.js 6.4.299 legacy components render local PDFs inside the existing Markdown
shell on macOS, Windows, Linux and iOS/iPadOS 18+. Picker/tree/drop, local links,
OS handoff, startup restoration, find, bookmarks, position-preserving reload,
password retry/cancel, read-only appearances and complete-document printing are
implemented. Folder/all-folder search remains Markdown-only. File limits are
16 MiB for each format; the PDF cap remains provisional pending memory evidence.

See the README for supported extensions and user-visible limitations;
[access](pdf-document-access.md), [routing](pdf-opening-routing.md),
[lifecycle](pdf-viewer-lifecycle.md), [reading state](pdf-reading-state.md),
[mixed folders](pdf-mixed-folders.md), [search geometry](pdf-search-range-highlights.md),
and [printing](pdf-printing.md) describe contracts and validation in detail.

Step 9 adds full offline resource notices to the embedded license view, verifies
those notices against the installed files, and documents the current scope.
The asset verifier checks exact pinned worker/resource/notice bytes and rejects
diagnostic pages, generated fixture chunks and PDF corpus files in normal builds.
Previously reported Windows script-test path failures were corrected using
platform-aware expected paths; a fresh Windows run is still required.

## Fixture and licensing policy

Routine tests generate original MIT-licensed PDF text, structure and four-color
images; long/mixed-size/no-text/bookmark variants need no third-party book corpus.
The user-supplied book and Windows evidence remain diagnostic inputs, excluded
from production output. Redistribution rights for that book are not established;
review source-archive contents before public distribution. See
[fixture provenance](../testdata/README.md).

`THIRD_PARTY_LICENSES.md` records the pinned PDF.js version and direct print
bindings. Full PDF.js, Adobe CMap, Foxit/Liberation font, OpenJPEG/JBIG2/QCMS,
ICC and core-js notices ship locally and are embedded in the in-app license view.
QuickJS scripting resources remain excluded. New frontend/native APIs have
documentation comments; behavior and resource ownership have unit coverage.

## Reproducible automated verification

Run on a configured macOS build host with Node 24, Rust and full Xcode:

```sh
npm test
npm run build
node scripts/verify-pdf-release.mjs
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
xcrun swift test --package-path src-tauri/plugins/documents
npm run tauri -- build --no-sign --bundles app
```

Unsigned bundling is a validation artifact, not a signed/notarized release.
Inspect the resulting macOS app plist and an actual iOS app plist with:

```sh
MDVIEW_MACOS_INFO_PLIST="/absolute/path/mdview.app/Contents/Info.plist" \
MDVIEW_IOS_INFO_PLIST="/absolute/path/ios/mdview.app/Info.plist" \
MDVIEW_IOS_APP_INFO_PLIST="/absolute/path/ios/mdview.app/Info.plist" \
xcrun swift test --package-path src-tauri/plugins/documents
```

Missing plist inputs produce explicit skips. Packaging tests verify Markdown,
PDF and folder registration, Viewer/Alternate Apple roles, and iOS 18.0 metadata.
An old compiled plist confirms that artifact only, not a fresh iOS archive.
Use the README's supported iOS build workflow for current archive/device checks.

Build opt-in probes separately; never distribute their output:

```sh
MDVIEW_PDF_PROBE=1 npm run build
MDVIEW_PDF_RENDER_ONLY=1 swift scripts/pdfjs-wk-probe.swift dist /tmp/unused.pdf
MDVIEW_PDF_RENDER_ONLY=1 swift scripts/pdfjs-wk-probe.swift dist /tmp/unused.pdf tauri://localhost/dev/pdf-print-probe.html
# Restore and verify the ordinary production output afterwards.
npm run build
node scripts/verify-pdf-release.mjs
```

## Results on this host

Executed 23 October 2026 on the available Apple host:

| Check | Result |
|---|---|
| Frontend Vitest suite | 221 passed across 37 files, including full embedded PDF notices, renderer/find/resource regressions and sidebar fixes. |
| Node build/script suite | 22 passed, including the new production verifier and platform-aware simulator path expectations. |
| Rust suite | 56 passed; binary/doc-test targets also succeed. |
| Native Swift suite | 22 passed, zero skips with both built Apple plists supplied; 321 total automated tests across the four suites. |
| TypeScript | `tsc --noEmit` passed. |
| Production frontend | Normal Vite build passed after the opt-in probe build; final output excludes diagnostics/corpus. |
| Exact offline inventory | 283 resources, 4,463,193 bytes, 12 notices; every emitted resource equals the pinned installed bytes. |
| macOS application | Fresh unsigned release `mdview.app` bundled successfully (reported 13.97 MiB). No signing/notarization or installer distribution performed. |
| Apple registration/floor | Fresh macOS bundle and existing iOS simulator app pass Markdown/PDF/folder metadata tests; existing iOS app minimum is 18.0. This reuses the previous iOS artifact and is not a fresh archive pass. |
| Native WebKit viewer | Six cycles, 60-page fixture, text selection, 12 find matches, two bookmarks, reading restoration, shorter replacement, image-only find, keyboard focus, original colors and disposal pass. Maximum eight canvases / 3,803,806 aggregate observed canvas pixels. |
| Native WebKit print preparation | All 61 generated mixed-size pages rendered/decoded; 612×792 and 400×500 pt page sizes observed; cleanup passed. No physical printer used. |
| Clippy | Exit zero with four pre-existing warnings: needless pass by value in incoming handoff, float comparison in Markdown margins test, AirPrint doc markup and the long `run` function. Strict warnings-as-errors remains a separate baseline cleanup. |
| Patch whitespace | `git diff --check` passed. |

This session used the bundled Node executable by absolute path because `node`/
`npm` are absent from the inherited shell PATH. The macOS Tauri build used a
temporary config overlay setting only `beforeBuildCommand` to null after the
frontend had already been built and verified; maintained configuration was not
changed. A fresh full iOS archive was not retried under that known npm limitation.

Apple Swift tests require an Apple host; their success does not validate Windows
or Linux engines. Native WebKit probes use the actual custom scheme and maintained
CSP, rather than a browser mock. Canvas counts are allocation observations, not
total process-memory measurements. The step-8 native PDFKit 61-page print-to-PDF
result remains separately documented in the printing report.

## Remaining release gates

| Gate | Existing evidence | Required follow-up before release |
|---|---|---|
| Windows | Earlier production/dev WebView2 packaging probe passed; user report reproduced the old search offset. User confirmed the later selection-geometry fix works. | Run the final application: find/selection alignment, native system print all pages, mixed sizes/rotation, no decorations, cancel/repeat, `afterprint` resource cleanup; rerun aggregate tests after path fixes. |
| Linux | Implementation and bundled assets only; no runtime pass claimed. | Test the intended distribution/WebKitGTK baseline, real worker, offline fonts/decoders, find, links, selection, complete printing and cleanup. |
| iPad hardware | iPadOS 18 simulator rendering/build evidence from earlier steps; plugin and Rust simulator-target builds passed in step 8. | Oldest supported physical iPad plus current iPad: provider downloads, file-only/folder grants, relaunch/offline/stale grants, touch/accessibility, AirPrint cancel/repeat and print source lifetime. |
| Current iOS archive | Earlier simulator app metadata confirms 18.0; step-8 full archive stopped because generated Xcode phase could not find npm. | Build current archive in the normal Node/npm environment; inspect deployment/associations and test signed device installation. |
| Desktop floors | Current macOS WKWebView and earlier packaged Windows engine pass specific probes. | Establish/test oldest supported macOS and Linux engine versions; retain existing build targets until a separate support decision. |
| Memory/fidelity corpus | Whole-file limits, bounded viewer canvases, sequential 150-dpi raster printing and 128 MiB compressed-output cap; generated long fixtures pass. | Measure total process memory/temp storage on long/image-heavy/font-heavy/scan PDFs and repeated switches/print cancellations on each target; test CJK, annotations, corrupt/encrypted/print-restricted inputs. |
| Printing limitations | Original PDFKit/AirPrint input on Apple; complete-page raster path on Windows/Linux. | Verify actual target dialogs/printers; iOS encrypted printing remains explicitly unsupported. Raster output loses searchable text/vectors; printer media may change sheet dimensions. |
| Source distribution | Diagnostic book is excluded from normal app output. | Establish rights or omit the user-supplied book from any public source archive. |

Folder-wide PDF search, OCR, editable forms/annotations, signature verification,
remote PDF opening, thumbnails and Save Original remain deferred scope, not
unfinished implementation tasks in this plan. No additional product decision is
inferred from closing the implementation plan.
