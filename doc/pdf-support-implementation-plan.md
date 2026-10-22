# PDF.js viewing implementation plan

Date: 17 October 2026.
Status: steps 1–7 implemented. Step 7 passes the full unit suites, packaged macOS mixed-folder checks, and native WebKit light/dark appearance checks. Linux, physical-device, desktop-baseline, and representative-document memory validation gates remain open; steps 8–9 pending.
Background: [PDF feasibility analysis](pdf-support-analysis.md).

## Confirmed decisions

- The requested format is PDF; the user confirmed that “PSD” was a typo.
- Use PDF.js for in-app PDF rendering.
- Raise the application minimum to iOS/iPadOS 18.0.
- Preserve macOS, Windows, Linux, and the existing iPad-focused iOS workflow.
- Create and discuss the work plan before changing implementation code.
- The iOS 17 constraint in the earlier analysis is superseded by this decision.

## Proposed first-release scope

- Open PDFs through the native picker, folder tree, drag-and-drop, OS handoff, startup restoration, and relative document links.
- Display one active Markdown or PDF document within the existing shell.
- Preserve existing recent-folder, pinning, new-file, refresh, and navigation behavior.
- Provide continuous PDF pages, page navigation, fit-width/fit-page, crisp zoom, rotation, and selectable/copyable text.
- Provide current-PDF search with next/previous matches and the existing search UI.
- Show embedded PDF bookmarks in the existing outline panel.
- Preserve original PDF page colors while adapting shell controls to the selected theme.
- Support password entry, cancellation, clear loading/errors, and read-only annotation appearance.
- Restore PDF reading position and reload externally changed documents without resetting the reader unnecessarily.
- Support printing the complete PDF, including pages outside the visible rendering window.
- Preserve all current Markdown rendering, Mermaid, image, clipboard, search, print, and embedded-license behavior.

Proposed later scope: folder-wide PDF text search, OCR, annotation editing, editable forms, digital-signature verification, thumbnails, arbitrary remote PDF opening, and a separate Save Original command.
Folder/all-recent-folder search would explicitly remain Markdown-only in the first release.
PDFs without a text layer would remain viewable but would have no searchable text.
These scope choices remain proposals until discussed; they are not additional requirements inferred from “viewing.”

## Architecture

Use the existing application shell with separate Markdown and PDF renderers.
Use PDF.js viewer components for page scheduling, text layers, links, destinations, and find behavior where the selected release exposes suitable integration points.
Keep mdview’s toolbar, sidebars, and shortcuts as the single user-facing control system.
Avoid maintaining a fork of the complete upstream viewer application.
Confirm the viewer-component integration during step 2 before fixing internal module APIs.

Separate document metadata from content transport.
Keep Markdown content as text; transfer PDF bytes through an optimized binary response.
Use an ephemeral backend document handle for PDF resource ownership and printing.
Keep persisted state tied to the original document identity/path, not a temporary snapshot or handle.

For iOS, prepare an app-private PDF snapshot within the existing coordinated provider-read workflow.
Return snapshot metadata through the Swift bridge; let Rust read the authorized snapshot and return binary bytes to JavaScript.
Avoid base64 or byte arrays serialized through Swift/Rust JSON.
Retain the snapshot while the viewer or print operation needs it; clean up after release and recover abandoned snapshots on launch.
Reuse the existing security-scoped bookmarks and original provider URLs.

Start with bounded whole-file loading.
Keep range loading as a later optimization unless step 2 demonstrates it is necessary for the agreed file-size requirement.
PDF.js may transfer ownership of the input buffer to its worker; native printing/resource management must not depend on retaining that JavaScript buffer.

## Ordered implementation steps

### 1. Raise and verify the iOS deployment minimum

Dependencies: none.

- Set `bundle.iOS.minimumSystemVersion` to `18.0` in `src-tauri/tauri.ios.conf.json`.
- Align `src-tauri/plugins/documents/ios/Package.swift` with the application minimum.
- Verify whether `.iOS(.v18)` is available under the declared Swift tools version; use `.iOS("18.0")` or a justified tools-version update as appropriate.
- Synchronize tracked generated settings: `gen/apple/project.yml`, `Podfile`, and debug/release deployment targets in `mdview.xcodeproj/project.pbxproj`.
- Treat maintained Tauri configuration as the application deployment source; verify regeneration/builds do not revert generated settings.
- Update the README minimum and release/upgrade notes.
- Keep `@available(iOS 17.0, *)` annotations where they correctly describe API availability; do not mechanically replace every historical “17.”
- Keep previous implementation plans and the feasibility report as historical documents.

Acceptance: debug/release application settings and built iOS `MinimumOSVersion` agree on 18.0; the native plugin builds; existing Markdown usage works on iPadOS 18.
Tests: deployment-metadata consistency coverage and native plugin regression tests.

Implementation results (17 October 2026):

- Updated Tauri configuration, SwiftPM, CocoaPods, generated project YAML, and Xcode debug/release settings to 18.0.
- Used `.iOS("18.0")` while retaining Swift tools 5.9; `swift package dump-package` resolves the minimum to 18.0.
- Updated the README minimum, upgrade note, and built-app metadata test instructions.
- Added native tests for deployment-input agreement, effective Xcode debug/release targets, and compiled-app `MinimumOSVersion`.
- Passed all 184 unit tests: 129 frontend, 8 build-script, 35 Rust, and 12 Swift tests; supplying the built iOS plist exercised both optional packaging checks without skips.
- Passed TypeScript checking, the production Vite build, and an unsigned ARM64 iOS simulator app build.
- Verified Xcode's effective debug/release settings and the compiled app's `MinimumOSVersion` are 18.0; the build retained the updated configuration.
- Installed/launched the app on an iPad Pro 11-inch simulator running iPadOS 18.0 and visually confirmed README Markdown rendering.
- The `simctl openurl` invocation exceeded its 30-second command timeout after delivering the file; the simulator screenshot confirmed the requested README was displayed.
- The build shell required explicit Node paths; the temporary Xcode build-script adjustment was reverted after verification.
- Physical-device validation and a signed device/archive build remain untested; API availability annotations and historical documents remain unchanged.

### 2. Validate PDF.js packaging and runtime compatibility

Dependencies: step 1.

- Evaluate the current maintained `pdfjs-dist` release and pin the chosen version in the dependency manifest/lockfile.
- Candidate checked during planning: upstream release `v6.4.299`; recheck maintenance/security status when implementation begins.
- Start with the legacy distribution for Safari/WebKit compatibility; verify compatible viewer-component imports and worker variants for that exact release.
- Bundle the worker, viewer CSS, fonts, CMaps, WASM, and other required assets locally.
- Lazy-load PDF code so Markdown startup does not eagerly load the PDF renderer.
- Verify dev-server and production-bundle asset URLs, including the packaged Tauri origin.
- Review `vite.config.ts`: existing build targets are `chrome105` and `safari13`; transpilation does not supply missing browser APIs.
- Review PDF.js package engine requirements against CI’s current Node 20; update the build runtime if required without confusing Node requirements with device runtime support.
- Add only the CSP sources required by the selected packaging strategy for workers/fonts/WASM; avoid broad network or filesystem grants.
- Verify a real worker is running rather than accepting an unnoticed fake-worker fallback.
- Exercise first-page rendering, text selection, current-file find, links, a font-heavy PDF, and complete multipage printing in packaged target webviews.
- Record bundle-size and memory measurements with the chosen release.

Acceptance: offline rendering works in iPadOS 18 WKWebView, macOS WKWebView, Windows WebView2, and the selected Linux WebKitGTK baseline.
Gate: resolve a failed desktop compatibility check before broad integration; do not silently change desktop minimum requirements.
Gate: choose the printing integration proven by the multipage test before implementing step 8.

Implementation results (17 October 2026):

- Pinned PDF.js 6.4.299 and its legacy components; bundled version-matched offline resources and notices through a shared dev/build plugin.
- Added a lazy runtime and an opt-in compatibility page; normal Markdown startup does not load the parser, viewer, or worker.
- Updated CI to Node 24 and documented the minimum Node 22.13 runtime requirement.
- Retained existing desktop Vite targets and limited CSP additions to local workers/resources, blob fonts/images, and WASM decoding.
- Added scoped iterator-join compatibility and a public text-stream adapter for iPadOS 18's missing ReadableStream async iteration; no global stream replacement or forked renderer.
- Passed production custom-scheme and development-URL WKWebView checks on macOS, including real worker, selection, 36 find hits, links, font resources, and JPX decoder fallback.
- Passed the minified probe in an actual packaged iPadOS 18.0 simulator app: real worker, 36 find hits, three decoded images, and no text-extraction error.
- Verified three distinct pages in native AppKit print-to-PDF output and inspected print previews; the prototype requires PDF-specific paper/margins and asynchronous printing.
- Recorded resource/chunk sizes, canvas allocation, reproduction commands, known compatibility fixes, and pending platform checks in [PDF.js validation](pdfjs-compatibility.md).
- Passed all 207 automated tests, TypeScript, and the normal production build; confirmed that the probe remains excluded from normal output.
- Linux WebKitGTK, physical iPad/AirPrint, oldest desktop baselines, and representative-document memory tests remain explicit validation gates.

Windows validation results (17 October 2026):

- Built the opt-in production probe on Windows build 26200 x64 using Node 22.13.1 and Rust 1.100.0-nightly; produced MSI (6.48 MiB) and NSIS (5.38 MiB) installers. Launched the built executable directly; installer installation was not exercised.
- Passed the actual packaged WebView2 probe at `http://tauri.localhost/dev/pdfjs-probe.html` with the maintained CSP, using the reported Chromium/Edge 155 engine: real worker, first-page rendering, selectable text, all 36 find hits, link annotation, twelve standard-font variants per page, four local resource checks, three decoded JPEG 2000 images, and WASM compilation; no warnings or text errors. Elapsed time: 1,094 ms.
- Passed the same probe in the actual development-mode WebView2 app at `http://localhost:1420/dev/pdfjs-probe.html`: 1,855 ms, no warnings. TypeScript and the normal production build passed; confirmed normal output excludes the probe page and PDF runtime chunks.
- Opened the native WebView2 print UI and saved complete output: three Letter pages (612 × 792 pt), each containing its own raster image; inspected extracted page-one and page-three images with distinct page labels, all twelve fonts, and the four-color image. Development print cancellation and reopening also retained all three preview pages. Physical printing was not attempted. Browser preview initially included date/title/URL/page headers and footers; step 8 must explicitly control those settings and validate final output fidelity.
- Matched the 283-file / 4,463,193-byte offline inventory; peak single print canvas remained 4,362,336 bytes. These are fixture measurements, not total process memory or evidence for the provisional 64 MiB cap.
- Passed all 139 frontend and 34 Windows Rust unit tests. Fixed the real PDF fixture test's Windows resource paths: forward slashes for font loading and a `file:` URL for decoder module imports. Build-script tests passed 18/21; three existing `run-ipad.node-test.mjs` cases fail because mocked macOS paths are joined with Windows separators. The aggregate `npm test` command therefore remains failing on Windows; Swift tests require an Apple host.
- Detailed reproduction, production chunk sizes, development checks, and remaining limitations are recorded in [PDF.js validation](pdfjs-compatibility.md). Windows runtime success does not close the Linux or representative-document printing/memory gates.

### 3. Add document kinds and binary PDF access

Dependencies: step 2.

- Introduce one backend classifier for Markdown/PDF and matching frontend document-kind types.
- Add a distinct binary PDF loader while retaining bounded UTF-8 Markdown reads and their 16 MiB limit.
- Move new loading/resource responsibilities into focused modules, such as `src-tauri/src/documents.rs`, rather than expanding `lib.rs` with another subsystem.
- Define a PDF handle lifecycle: prepare/open, read bytes, retain for printing, release, and cleanup after errors.
- Use optimized binary IPC, such as `tauri::ipc::Response`, rather than JSON serialization of file bytes.
- Check file type, extension/content plausibility, canonical paths, size limits, read failures, and growth while reading.
- Keep the PDF size limit separate; finalize its value using the measurements in step 2.
- Add Swift coordinated snapshot creation, bounded copying, cancellation/error cleanup, and stale-bookmark/provider-path handling.
- Ensure snapshot preparation resolves content before a provider-coordination callback ends.
- Preserve file-only iOS grants; a single PDF selection must not authorize scanning its parent folder.
- Keep user-facing filenames and persisted paths tied to the source PDF.

Acceptance: local and provider-backed PDF bytes load without UTF-8 conversion; unauthorized/invalid/oversized files fail clearly; released handles cannot read another file.
Tests: classification, uppercase extensions, invalid content, byte limits, source replacement, cancellation, snapshot cleanup, and provider-reader regressions.

Implementation results (18 October 2026):

- Added the shared document-kind classifier, matching frontend kinds, and a dedicated document-access module.
- Added metadata-only PDF preparation, raw binary IPC, cancellation, independent viewer/print leases, and idempotent release.
- Snapshot ownership preserves original bytes after source replacement and removes partial, released, and abandoned resources without deleting another live session's snapshots.
- Added coordinated Swift binary copying, file/folder grant boundaries, moved-bookmark path resolution, and cancellation cleanup while preserving source identity.
- Kept the Markdown UTF-8 contract and 16 MiB cap; local reads now detect growth beyond that cap.
- Selected a separate provisional 16 MiB PDF cap, four pending preparations, and eight leases; the proposed 64 MiB cap awaits physical-device memory evidence.
- Passed 241 tests, TypeScript, the normal frontend build, iOS cross-compilation, and an unsigned ARM64 simulator application build. Existing Clippy baseline diagnostics remain documented in the access report.
- Entry-point routing, associations, renderer dispatch, and native PDF printing remain subsequent work. See [document-access contract and limits](pdf-document-access.md).

### 4. Route every open path and register PDF support

Dependencies: step 3.

- Generalize open/reload command routing and frontend document-result types.
- Include PDFs and PDF-only folders in the recursive tree; retain ordering, markers, pinning, LRU, and symlink behavior.
- Generalize `incoming_documents.rs` URL validation and launcher handling to accept PDFs.
- Preserve startup-request precedence, duplicate suppression, single-instance forwarding, and first-file/multiple-file notices.
- Add native picker filters and update Markdown-only error/help/drop text.
- Add `.pdf`, MIME `application/pdf`, and Apple UTI `com.adobe.pdf` as a separate viewer association.
- Preserve Apple `Viewer`/`Alternate` behavior and current default-app choices.
- Keep the existing Markdown imported UTI declaration; use the system PDF type without inventing an mdview-owned PDF UTI.
- Update maintained Apple plist overlays and inspect generated/built registration metadata.
- Make metadata tests select associations by document type rather than assuming the first association is the only one.
- Extend relative-link navigation to local PDFs, including `#page=N`; preserve Markdown heading anchors and Back navigation.
- Keep incoming remote URLs unsupported for this release.

Primary touchpoints: `lib.rs`, `incoming_documents.rs`, `tauri.conf.json`, `Info.plist`, `Info.ios.plist`, `src/main.ts`, `incoming-documents.ts`, `recent-tree.ts`, and `content-interactions.ts`.
Acceptance: all supported entry points open the same PDF through the same access/rendering lifecycle.
Tests: mixed types, PDF-only folders, OS URLs, unusual paths, initial/runtime handoff, association metadata, and navigation classification.

Implementation results (21 October 2026):

- Added common document open/reload results and one frontend entry-point controller with cancellation, stale-result guards, and PDF lease disposal.
- Included PDFs/PDF-only folders in the existing tree while retaining Markdown-only folder search and existing ordering/pinning/LRU behavior.
- Routed picker, native drop, OS/launcher handoff, restoration, relative links, and watcher reloads through the common contract; retained startup precedence and additional-item handling.
- Added native PDF filters and a separate `.pdf`/`application/pdf`/`com.adobe.pdf` Viewer/Alternate association; synchronized generated iOS metadata and selected metadata-test entries by UTI.
- Preserved local Markdown fragments and PDF `#page=N` destinations, including Back navigation; remote incoming URLs remain unsupported.
- Passed 255 tests, TypeScript, frontend production build, macOS bundling, and an unsigned iOS simulator build; checked both built Apple association lists. On 22 October, an isolated macOS app also passed native-picker opening, Markdown switching, relative PDF page navigation, and Back checks.
- PDF opening currently shows a prepared-document state; page preview remains step 5 and PDF printing remains step 8. See [routing implementation and validation](pdf-opening-routing.md).

### 5. Integrate the PDF renderer and lifecycle

Dependencies: steps 2–4.

- Add focused frontend modules, provisionally `document-view.ts` and `pdf-viewer.ts`, with an active-renderer contract.
- Provide a PDF content mount in `index.html` and scoped PDF styles in `src/styles.css` or a dedicated stylesheet.
- Adapt existing shell actions to the active document’s capabilities.
- Implement page count/current page, direct page navigation, fit-width, fit-page, zoom, and rotation.
- Rerender at appropriate resolution; CSS scaling alone must not be the PDF zoom implementation.
- Include text and annotation/link layers; preserve text selection and keyboard focus.
- Render visible/nearby pages with bounded canvas allocation and concurrency.
- Treat external links and PDF actions explicitly; block embedded scripting, launch actions, and editing features in the read-only viewer.
- Add password request/retry/cancel UI without persisting passwords.
- Cancel superseded loading/render jobs and ignore late results from old documents.
- Dispose PDF workers, render tasks, listeners, handles, and snapshots when switching or closing.
- Keep Markdown-specific copy styling, image popouts, Mermaid work, and DOM interactions scoped to the Markdown renderer.

Acceptance: repeated PDF↔Markdown switching remains correct; every PDF control works with keyboard/touch; memory reaches a stable bound for repeated document switching.
Tests: renderer dispatch, stale asynchronous results, cancellation, password flow, action filtering, navigation state, and resource disposal.

Implemented 22 October 2026:

- Added an abortable active-renderer contract and lazy upstream PDFViewer integration with real worker ownership.
- Added continuous pages, selectable text, read-only annotation/link layers, current/total pages, direct navigation, fit modes, rerendered zoom, rotation, and transient password retry/cancellation.
- Scoped shell controls to renderer capabilities; preserved Markdown rendering and disabled PDF find/outline/printing until their planned steps.
- Capped base/detail canvases at 2,097,152 pixels and 4,096 pixels per dimension; retained upstream visible/nearby scheduling and viewport-sized caching.
- Passed 176 frontend, 21 script, 54 Rust, and 20 Swift tests, including built Apple metadata checks. Native WebKit passed six rendering/disposal cycles on a 60-page fixture with no asynchronous errors; packaged macOS passed PDF↔Markdown navigation and password checks. The unsigned ARM64 iOS simulator app builds.
- Resource release and bounded canvas allocation are verified; representative-document process-memory plateaus and physical iOS touch/memory behavior remain release-validation gates.

See [viewer implementation and validation](pdf-viewer-lifecycle.md).

### 6. Add PDF find, outline, and position restoration

Dependencies: step 5.

- Add a PDF search adapter, provisionally `pdf-search.ts`, backed by PDF.js page text/find behavior.
- Reuse the existing search bar, query state, counts, next/previous controls, and keyboard shortcuts.
- Represent PDF hits by page/text position; do not force them into Markdown source-line matches.
- Keep folder/all-recent-folder search on the existing Markdown backend, with explicit scope labeling.
- Render embedded bookmarks in the outline panel; show “No bookmarks” when absent.
- Restore optional PDF page, relative offset, scale/fit mode, and rotation while preserving old saved-state compatibility.
- Extend Back history sufficiently to restore a PDF destination, rather than remembering only its filename.
- Preserve page/relative position during reload; clamp state if a replacement PDF has fewer pages.
- Coalesce reload requests and account for atomic source replacement.
- Test manual refresh where provider change notifications are unavailable; document that platform limitation accurately.

Acceptance: find reaches off-screen pages; bookmarks navigate correctly; restart/Back/reload restore valid PDF positions; old Markdown sessions still restore.
Tests: empty/no-text PDFs, find navigation, result counts, state normalization, cross-type Back history, fewer-page replacements, and repeated reloads.

Implemented 22 October 2026:

- Added PDF.js find-controller integration to the existing search bar, counts, next/previous buttons, Enter/Shift-Enter, and text-layer highlights; PDF results retain page/text offsets. Folder scopes explicitly identify Markdown-only search.
- Added safe nested bookmark rendering and “No bookmarks” for PDFs without outlines.
- Persisted page-relative vertical/horizontal offsets, fit/custom zoom, and rotation under original source paths, retaining the twenty most recently read PDFs; older Markdown state remains compatible.
- Extended Back to capture exact PDF destinations for relative links and picker/tree/drop visits; explicit `#page=N` links override saved positions.
- Preserved reading state on reload, settled mixed-size page geometry before restoring coordinates, clamped shorter replacements, coalesced concurrent reloads, and bounded retries for atomic replacement gaps.
- Refresh now reloads both the folder tree and active source; this was tested with an unwatched source and an atomically replaced, shorter PDF.
- Passed 194 frontend, 21 script, 55 Rust, and 20 Swift tests. Native WebKit passed off-screen search, nested bookmarks, six mixed-size document restoration/disposal cycles, image-only/no-outline results, and shorter replacements without asynchronous errors.
- The isolated macOS app passed shared search/highlights, bookmark navigation, cross-type Back, restart restoration, and manual refresh; macOS packaging and an unsigned ARM64 iOS simulator build pass. Physical/provider runtime validation remains open.

See [search and reading-state implementation](pdf-reading-state.md).

### 7. Confirm mixed-folder behavior and user-facing scope

Dependencies: steps 4–6.

- Add unobtrusive file-type indicators where Markdown/PDF distinction helps the reader.
- Verify selecting a PDF does not break folder-root search selection or recent-folder promotion.
- Keep filename/status/error/accessibility labels accurate for both document types.
- Preserve the current new-file indicator and folder expansion behavior.
- Keep PDF pages in original colors; limit dark-mode adaptation to surrounding UI by default.
- Confirm unsupported capabilities have clear UI behavior rather than invoking Markdown code on PDF content.

Acceptance: a mixed folder works as one coherent document browser; every enabled control has meaningful behavior for the active document.
Tests: mixed-tree interaction, scope labels, toolbar capability changes, focus, and theme behavior.

Implemented 22 October 2026:

- Added unobtrusive MD/PDF badges and accessible document-type/New labels; retained active-file, folder expansion, and pin behavior. Empty-state copy covers both formats, and loaded trees hide obsolete empty/loading text.
- Resolved folder search against the covering recent-folder root rather than a nested document's immediate parent; explicit folder selection stays independent from the displayed PDF and LRU ordering.
- Added accurate current-file scope, PDF bookmark, and unavailable-print labels; loading/error/empty views disable unsupported current-document actions and zoom shortcuts.
- Corrected folder result counts so valid Markdown results are not accompanied by a stale “No results” counter.
- Passed 201 frontend, 21 script, 55 Rust, and 20 Swift tests. TypeScript, normal production frontend build, and macOS application packaging pass.
- In an isolated macOS bundle, a nested PDF retained its parent recent root; folder search found a Markdown match in that root, selecting the result restored Markdown controls, and root promotion/pinning retained expansion and New markers.
- Native WebKit passed the integrated viewer probe in explicit light and dark appearances, checking original white/unfiltered PDF pages, original image pixels, themed controls, keyboard focus, and existing rendering/search/restoration/disposal behavior.

See [mixed-folder implementation and validation](pdf-mixed-folders.md). Physical iOS/provider, Windows, and Linux runtime release checks remain pending.

### 8. Implement complete-document PDF printing

Dependencies: printing gate in step 2 and PDF handle lifecycle in step 3.

- Keep existing Markdown print preparation, light Mermaid assets, filename/date header, and page numbering unchanged.
- Print every PDF page independently of the on-screen virtualization cache.
- Prefer native printing of the prepared original PDF snapshot on iOS through the documents plugin.
- Validate the desktop PDF print service from step 2 with native macOS printing and Windows/Linux print dialogs.
- Preserve original page dimensions, rotations, and annotation appearance where supported.
- Do not add Markdown’s repeating header/page-number decoration to input PDFs by default.
- Hold native resources until print completion/cancellation and clean up on every exit path.
- Clearly distinguish printing to a new PDF from copying the original document.
- Treat platform print failure as an explicit release issue; do not silently fall back to printing visible canvases only.

Primary touchpoints: `src/print.ts`, new `pdf-print.ts` if needed, `src-tauri/src/printing.rs`, `DocumentsPlugin.swift`, and `DocumentPrinting.swift` or a focused PDF print implementation.
Acceptance: a long mixed-page-size PDF prints completely; cancellation and repeated printing work; Markdown print output remains unchanged.
Tests: print dispatch, complete-page preparation, cleanup/completion, and platform-specific print smoke tests.

### 9. Finish documentation, licensing, and release verification

Dependencies: steps 1–8.

- Update README features, supported extensions, iOS 18 requirement, PDF search scope, size limit, and known PDF limitations.
- Add the selected PDF.js version and applicable bundled asset notices to `THIRD_PARTY_LICENSES.md` and embedded license views.
- Keep significant new Rust artifacts documented with RustDoc; document frontend/native module APIs consistently.
- Add unit tests alongside every significant new artifact/feature, as required by `AGENTS.md`.
- Use small reproducible fixtures with clear redistribution rights; avoid committing a large arbitrary PDF corpus.
- Run the complete frontend/build-script, Rust, and native Swift unit suites after integration.
- Build production bundles and inspect worker/assets, file registration, and minimum OS metadata.
- Record actual OS/device checks separately from unit tests and simulator/build checks.

Planned commands from the project root:

```sh
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
xcrun swift test --package-path src-tauri/plugins/documents
npm run tauri build
```

Run platform builds on their supported hosts.
Use the documented iOS build workflow and supply built plist paths to the native packaging tests.
Include formatter/lint checks appropriate to changed code and fix introduced diagnostics.

Acceptance: all required automated checks pass; platform verification results and any remaining gaps are written down before release.

## Open issues and pending decisions

| Item | Recommended default / next action | Decision or evidence still needed |
|---|---|---|
| Folder-wide PDF search | Ship current-PDF find first; retain clearly labeled Markdown folder search. | Confirm whether PDF text search across folders is required for the initial release. Including it adds extraction, caching, and invalidation work. |
| Desktop compatibility floor | Preserve existing targets; test actual runtime engines before selecting final PDF.js build settings. | Specify oldest supported macOS and representative Linux distributions/WebKitGTK versions. Raising iOS does not raise desktop WebKit versions. |
| PDF file-size limit | Step 3 enforces a separate provisional 16 MiB PDF cap; Markdown stays at 16 MiB. Defer the proposed 64 MiB cap. | Measure peak memory on the oldest supported iPad and representative PDFs before raising/finalizing the cap. File size alone does not bound canvas memory. |
| Viewer components | Integrate upstream components beneath mdview controls. | Prove the selected release’s component/worker APIs in step 2; document any justified departure before broader integration. |
| PDF.js version/build runtime | PDF.js 6.4.299 legacy build pinned; CI uses Node 24. | Available Apple and packaged Windows WebView2 probes pass; Linux and oldest-desktop checks remain pending. |
| Printing | Include complete-document printing in the first release; native PDF input on iOS. | Prove desktop print integration and page fidelity in step 2. Any reduced platform print scope needs an explicit product decision. |
| Password-protected PDFs | Support password retry/cancel; keep passwords in memory only. | Verify behavior for printing restrictions and encrypted source printing on each target. Show clear unsupported cases rather than promising universal fidelity. |
| Forms and signatures | Display existing appearance; do not edit forms or claim signature validation. | Confirm if interactive form filling or signature verification is a launch requirement; either expands scope. |
| Original-PDF saving | Leave a separate Save Original command for later. | Confirm if in-app export/copy is required beyond existing file access and print dialogs. |
| Validation hardware | Test iPadOS 18 plus an up-to-date iPad, and each desktop engine. | Identify available oldest-device hardware and desktop hosts; record unavailable checks as pending. |

Only the PDF format, PDF.js renderer choice, and iOS 18 minimum are settled user decisions.
The table records proposed defaults and engineering gates without reopening those settled choices.

## Release acceptance matrix

| Area | Required coverage |
|---|---|
| Entry points | Picker, drop, tree, relative link, cold-start handoff, running-app handoff, last-session restore. |
| Provider access | Local, iCloud-only, file-only grant, folder grant, stale/unavailable provider, relaunch, offline failure. |
| Document corpus | Text PDFs, scans, CJK/embedded fonts, annotations, bookmarks/no bookmarks, encrypted/corrupt files, mixed page sizes/rotation, long/image-heavy files. |
| Interaction | Search across unloaded pages, text copy, fit/zoom, rotation, outline, Back, page restoration, keyboard, touch, assistive technology. |
| Lifecycle | Rapid switching, cancellation, atomic file replacement, deletion, repeated reload, print cancel/completion, bounded memory and temporary storage. |
| Packaging | iOS 18 metadata, both PDF/Markdown associations, matching worker version, offline fonts/CMaps/WASM, development and release asset URLs. |
| Regression | Markdown syntax, highlighting, Mermaid, images/popouts, sanitized HTML, search, LRU/pinning, sidebar state, clipboard, print, and license documents. |

## Planning sources

- [PDF.js compatibility and worker-version FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions): current legacy support lists Safari 18+ as partial; actual WKWebView tests remain necessary.
- [PDF.js integration overview](https://mozilla.github.io/pdf.js/getting_started/): core/display/viewer layers and offline asset packaging.
- [PDF.js v6.4.299 release](https://github.com/mozilla/pdf.js/releases/tag/v6.4.299): maintained-release candidate checked during planning.
- [PDF.js loading API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html): typed-array input and worker/resource settings; confirm APIs against the chosen release rather than relying solely on draft documentation.
- [Tauri binary command responses](https://v2.tauri.app/develop/calling-rust/): optimized response transport for byte buffers.

## Current change boundary

Step 1 changes the iOS minimum, associated build metadata, tests, and documentation.
Step 2 adds PDF.js packaging, a lazy runtime, compatibility adapters, and an opt-in validation prototype.
Step 3 adds bounded binary access, provider snapshots, document kinds, and resource ownership.
Step 4 connects document entry points, mixed trees, local navigation, and platform associations.
Step 5 adds PDF page rendering, controls, passwords, capability dispatch, and renderer/resource disposal.
Step 6 adds PDF find, bookmarks, bounded reading-state persistence, exact Back destinations, and coalesced position-preserving reloads.
Step 7 adds mixed-tree type/status/accessibility labels, root-aware Markdown folder search, shell capability transitions, and appearance/focus checks.
Complete-document PDF printing and final release verification remain steps 8–9.
