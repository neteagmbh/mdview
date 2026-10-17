# PDF viewing in mdview — feasibility analysis

Analysis date: 17 October 2026.
Repository snapshot: version 0.2.0, commit `0224abe`.
Scope: source inspection and upstream documentation; no implementation or runtime compatibility testing.

## Recommendation

PDF viewing is feasible within the existing Tauri application.
The most economical shared implementation is a dedicated PDF.js viewer integrated with mdview’s existing document shell.
The main work is binary document loading and adapting search, outline, zoom, printing, and provider access.
Adding `.pdf` to the accepted extensions alone cannot work because both existing readers decode files as UTF-8.

**Resolve the minimum-platform requirement before selecting the renderer release.**
mdview currently targets iOS/iPadOS 17.
Mozilla’s current compatibility table lists Safari 18+ for PDF.js’s legacy build and marks support as partial.
That table does not establish compatibility with mdview’s iPadOS 17 minimum.
The legacy bundle is therefore a candidate, not a verified solution for every current platform. [Mozilla compatibility FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions)

If iPadOS 17 must remain supported, evaluate a native PDFKit backend for Apple devices alongside PDF.js for Windows/Linux.
This preserves the platform requirement at the cost of maintaining two viewer implementations.
A shared PDF.js backend remains preferable if a maintained release passes the actual minimum-device tests.
Raising mdview’s minimum OS would be a separate product decision.

## Current features and their implications

The feature baseline below combines the README with the actual frontend and backend source.

| Current mdview feature | Implication for PDF support |
|---|---|
| Native file and folder pickers | Reuse the workflow; add document-kind dispatch and desktop PDF filtering. |
| Drag-and-drop opening | Reuse the entry point; route dropped PDFs to the PDF loader. |
| OS Open With / iOS Open In | Add PDF association metadata and generalize incoming-document validation. |
| Five Markdown extensions | Preserve `.md`, `.markdown`, `.mdown`, `.mkd`, and `.mkdn`; add `.pdf` as a separate kind. |
| One active document in the current viewer | Keep the same interaction model; tabs are unnecessary for initial PDF support. |
| Multiple incoming files: first opens, extras reported | Apply the same rule to mixed Markdown/PDF handoffs. |
| Recursive folder tree | Include PDFs and directories containing only PDFs; add a type indicator. |
| Persistent recent-folder LRU | Reuse folder paths and pinning; the existing limit is ten unpinned entries. |
| Folder removal, refresh, expansion, active/new markers | Reuse behavior after broadening tree scanning. |
| Auto-reload and live tree updates | Reuse filesystem notifications; PDF reload needs renderer disposal and page-position restoration. |
| Heading outline | Use embedded PDF bookmarks; show an empty state or page list when absent. |
| Current-file search with highlights and next/previous | Use PDF text extraction and its find controller; Markdown DOM highlighting cannot search a canvas. |
| Folder/all-recent-folder search | Requires separate PDF text extraction and caching; this is a substantial additional feature. |
| Session zoom: 75–150% | Reuse toolbar controls; PDF zoom must rerender pages and support fit-width/fit-page. |
| Persisted active path, window geometry, sidebar widths | Reuse state; PDF page/offset/rotation would need additional state fields. |
| Resizable/toggleable sidebars, folder/search tabs, keyboard scrolling | Reuse shell; check focus, shortcuts, touch gestures, and PDF scrolling. |
| Relative Markdown links and Back navigation | Generalize navigation to mixed documents; interpret PDF destinations separately from heading IDs. |
| External HTTP(S) links | Reuse the external opener with explicit safe-link handling for PDF annotations. |
| Local/remote images, image and Mermaid popouts | Continue within Markdown; PDF pages are handled by the PDF renderer. |
| GitHub-flavored Markdown, code highlighting, Mermaid, sanitized HTML | Keep the Markdown pipeline; PDFs require a separate rendering pipeline. |
| Light/dark theme | Keep the shell theme; retain original PDF page colors by default. |
| Styled clipboard copy | PDF copy requires the text layer; Markdown-specific HTML conversion should stay scoped to Markdown. |
| Printing / PDF export | Existing export prints rendered Markdown; viewing and printing an input PDF require new handling. |
| About and embedded license documents | Keep embedded documents as Markdown; add renderer license notices. |

Evidence: [README](/Users/michaelfromme/Build/netea-tools/mdview/README.md), [frontend integration](/Users/michaelfromme/Build/netea-tools/mdview/src/main.ts), [search](/Users/michaelfromme/Build/netea-tools/mdview/src/search.ts), [view state](/Users/michaelfromme/Build/netea-tools/mdview/src/view-state.ts), [backend](/Users/michaelfromme/Build/netea-tools/mdview/src-tauri/src/lib.rs).

## Current platforms

| Platform | Repository evidence | PDF-specific concern |
|---|---|---|
| macOS | Desktop support; signed/notarized build workflow; native AppKit printing. | Test the supported OS/WebKit floor; PDFKit is an alternative renderer. |
| Windows | Desktop support; CI builds installers; second-instance file forwarding. | Test the packaged WebView2 application and file associations. |
| Linux | Desktop support; CI builds bundles; WebKitGTK 4.1 development dependency. | Test actual distribution runtimes; WebKitGTK versions vary. |
| iOS/iPadOS | Native documents plugin; Files/iCloud provider access; persistent bookmarks; AirPrint; minimum 17.0. | Preserve provider grants and coordinated reads; test memory limits and renderer compatibility on iPadOS 17. |
| iPhone | Generated project contains phone orientation settings; README build/use guidance focuses on iPad. | iPhone usability and supported-device scope are not established by this analysis. |
| Android | No Android project, native provider implementation, or documented build workflow found. | Tauri capability alone does not establish current mdview Android support. |
| Standalone web browser | Vite builds the frontend; document access depends on Tauri commands. | This repository does not establish a standalone browser product. |

Tauri uses WebView2 on Windows, WKWebView on Apple platforms, and WebKitGTK on Linux.
Installed engine versions depend on the target system. [Tauri webview versions](https://v2.tauri.app/reference/webview-versions/)

Desktop minimum OS versions are not explicitly set in the inspected mdview configuration.
Current CI covers Windows/Linux builds and frontend tests; it does not prove macOS/iPad rendering compatibility.
Evidence: [CI](/Users/michaelfromme/Build/netea-tools/mdview/.github/workflows/build.yml), [iOS configuration](/Users/michaelfromme/Build/netea-tools/mdview/src-tauri/tauri.ios.conf.json), [Apple project](/Users/michaelfromme/Build/netea-tools/mdview/src-tauri/gen/apple/project.yml).

## Renderer options

The fit and effort assessments are engineering judgments based on mdview’s architecture.

| Option | Advantages | Costs and limits | Assessment |
|---|---|---|---|
| PDF.js in the existing frontend | Shared document UI; no additional native renderer binary; direct fit with TypeScript/Vite. | Requires worker/assets, text/link layers, viewer integration, and engine-floor verification. | Preferred shared implementation, subject to the compatibility gate. |
| Bundled PDF.js full viewer | Existing page navigation, find, outline, and print UI reduce custom viewer work. | Second toolbar/shortcut system; bridge and theme integration; hide unsupported editing features. | Good feasibility prototype; compare with embedding its viewer components into mdview. |
| Native PDFKit on macOS/iOS plus PDF.js elsewhere | Native Apple document view; potential solution for the existing iPadOS minimum. | Two rendering implementations; native layout, focus, resizing, accessibility, and command bridges. | Strong fallback when retaining iPadOS 17 is mandatory. |
| PDFium through a native library or WASM | Alternative rendering engine; potential performance/fidelity advantages to benchmark. | Additional build/package/toolchain work; text selection, navigation, and UI still need integration. | Consider if PDF.js fails concrete compatibility or performance requirements. |
| Native browser PDF embedding via iframe/object | Small experimental integration. | Different webviews need not expose equivalent viewers or controllable APIs; shell integration remains uncertain. | Do not use as the cross-platform support contract without per-platform proof. |
| Open in the system PDF application | Minimal integration. | Leaves mdview’s viewer and navigation. | Useful optional fallback; does not satisfy in-app viewing. |

PDF.js separates core, display, and viewer layers and uses a worker; it is Apache-2.0 licensed. [PDF.js integration overview](https://mozilla.github.io/pdf.js/getting_started/)
Apple PDFKit provides PDF views, thumbnails, document search, selections, and outline objects. [Apple PDFKit](https://developer.apple.com/documentation/pdfkit)
PDFium uses Chromium build tooling, including GN/Ninja, so a native integration brings a separate dependency-build lifecycle. [PDFium build documentation](https://pdfium.googlesource.com/pdfium/+/main/README.md)

## Proposed integration boundaries

### 1. General document loading

Introduce a document kind independently of the existing Markdown extension list.
Keep the current Markdown text path and add an explicitly binary PDF path.
Return document metadata separately from its content transport.
Centralize dispatch so picker, tree, drop, startup restore, links, and OS handoff all resolve document types consistently.

Current blockers are concrete:

- `read_document` rejects every non-Markdown extension.
- `read_local_document` uses `fs::read_to_string` and a 16 MiB limit.
- `OpenedDocument` assumes `content: string`.
- `scan_directory` includes only Markdown files and prunes other directories.
- `incoming_documents::document_path` rejects PDF handoffs.
- Desktop picker filters and frontend link classification list Markdown extensions only.
- `displayOpenedDocument` always calls `renderMarkdownSource`.

Evidence: [load/dispatch](/Users/michaelfromme/Build/netea-tools/mdview/src-tauri/src/lib.rs:564), [incoming documents](/Users/michaelfromme/Build/netea-tools/mdview/src-tauri/src/incoming_documents.rs:32), [link classification](/Users/michaelfromme/Build/netea-tools/mdview/src/content-interactions.ts:34), [display](/Users/michaelfromme/Build/netea-tools/mdview/src/main.ts:429).

### 2. Binary transport and iOS providers

Use bounded binary transport for an initial supported PDF size range.
Tauri can return binary command responses, avoiding a JSON array of every byte. [Tauri command responses](https://v2.tauri.app/develop/calling-rust/)
PDF.js accepts typed-array input, passwords, custom range transport, and resource URLs for fonts/CMaps/WASM. [PDF.js loading API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html)

Treat the PDF byte limit separately from the existing Markdown limit.
Choose the supported limit using device measurements rather than assuming file size predicts rendering memory.
For larger documents, assess an authorized range-reading protocol after validating demand.
The currently enabled asset protocol is scoped for document images; it is not proof that PDF fetch/range transport already works.

On iOS, retain the original security-scoped URL, restored bookmark, and `NSFileCoordinator` workflow.
Add a binary read or coordinated app-owned snapshot instead of decoding provider data as text.
Keep a snapshot stable for a render session; invalidate it on a confirmed source change.
Keep file-only grants limited to that file; do not promote them into permission to scan a parent directory.
Avoid transporting large PDFs as base64 through the current Swift string response.
Account for Swift-to-Rust copies as well as Rust-to-JavaScript copies when measuring memory.

Evidence: [coordinated reader](/Users/michaelfromme/Build/netea-tools/mdview/src-tauri/plugins/documents/ios/Sources/DocumentReader.swift), [provider/bookmark plugin](/Users/michaelfromme/Build/netea-tools/mdview/src-tauri/plugins/documents/ios/Sources/DocumentsPlugin.swift), [folder grant handling](/Users/michaelfromme/Build/netea-tools/mdview/src-tauri/src/lib.rs:648).

### 3. Separate renderers behind the existing shell

Keep `renderMarkdownSource` responsible for Markdown.
Give PDF its own mount, navigation state, search adapter, zoom behavior, print path, and cleanup.
Route shell actions through the active renderer’s supported capabilities.
Cancel old loading/render jobs when switching files or receiving repeated reload events.
Ignore late results from a previously active document.
Release canvases, document workers, and any temporary URLs when leaving a PDF.

Render visible and nearby pages with a bounded cache.
Cap canvas pixel allocation on high-DPI/mobile devices.
Mozilla explicitly recommends rendering visible pages to control canvas memory. [PDF.js memory guidance](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions)

A canvas alone is insufficient for usable selection, copy, links, and accessible navigation.
Include a text layer, annotation/link handling, page labels, and keyboard focus behavior.
Use embedded bookmarks for the outline; PDF.js exposes an outline API. [PDF.js document API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFDocumentProxy.html)

### 4. Search semantics

Keep Markdown folder search behavior intact during the first PDF milestone.
Implement current-PDF search through page text rather than the existing Markdown DOM walker.
Use results identified by page and text position; existing backend results use source line numbers.
Scanned PDFs without a text layer require OCR for text search.
OCR would be a separate dependency, performance, storage, and product scope.

For later folder-wide PDF search, extract text asynchronously and cache it by document identity/change state.
Use bounded concurrency, cancellation, and invalidation when files change or provider access expires.
Explain search scope in the UI while folder search covers Markdown only.
Do not run extraction over every PDF synchronously on each query.

Evidence: [backend folder search](/Users/michaelfromme/Build/netea-tools/mdview/src-tauri/src/lib.rs:731), [frontend search](/Users/michaelfromme/Build/netea-tools/mdview/src/search.ts).

### 5. Printing, theme, and document trust

Printing an input PDF needs its own path because on-screen page virtualization omits off-screen canvases.
Assess PDF.js print rendering on desktop and native PDF-data printing on Apple devices.
Preserve PDF page dimensions, rotations, and existing page content.
Apply filename/date headers only as an explicit option for input PDFs.
“Save original PDF” should copy original bytes; printing to PDF may change document properties and fidelity.

Keep PDF page colors unchanged by default while adapting surrounding controls to dark mode.
An optional reading filter would require separate validation for images and print output.

Bundle the selected worker and supporting assets locally for offline viewing.
Package the worker at exactly the same PDF.js version as the main library. [PDF.js version guidance](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions)
Review the existing CSP for worker, font, WASM, and any authorized PDF transport needs.
Prefer narrowly scoped sources and keep the rest of the application policy intact.
DOMPurify protects the current Markdown HTML path; it does not validate PDF parser input or PDF actions.
Treat PDF links/actions as untrusted; permit intended destinations explicitly and keep embedded scripting/editing disabled for the read-only scope.
Verify these controls against the selected viewer release rather than assuming parser defaults enforce them.

Evidence: [CSP](/Users/michaelfromme/Build/netea-tools/mdview/src-tauri/tauri.conf.json), [current print preparation](/Users/michaelfromme/Build/netea-tools/mdview/src/main.ts:546), [watcher](/Users/michaelfromme/Build/netea-tools/mdview/src-tauri/src/watcher.rs).

## Suggested work packages and acceptance gates

| Package | Result | Relative effort |
|---|---|---|
| Compatibility evaluation | Choose a maintained renderer strategy that covers agreed minimum OS versions; measure actual packaged apps. | Small investigation; can change the architecture. |
| Basic integrated viewer | Binary loading, page rendering/navigation, crisp zoom, mixed tree, pick/drop/Open With, session restore, current-file find, bookmarks, text selection. | Medium-to-large feature. |
| Platform completion | iCloud/provider behavior, reload cleanup, native/platform printing, memory limits, accessibility, packaging and license updates. | Medium-to-large; iOS and printing are the largest uncertainties. |
| Folder-wide PDF search | Cached extraction, page-oriented results, invalidation, bounded background work. | Separate substantial feature. |
| Optional extensions | OCR, editable forms, annotations, signature verification. | Separate product decisions. |

Do not commit to a delivery duration before the compatibility evaluation.
The main cost is feature/platform parity rather than drawing the first PDF page.

Acceptance coverage should include:

- All open entry points, including cold start and an already running application.
- Mixed Markdown/PDF trees, pinning, LRU eviction, PDF-only folders, Unicode paths, spaces, hashes, and percent signs.
- Markdown→PDF navigation and Back; PDF page destinations and external links.
- Born-digital and scanned PDFs; encrypted/password-protected and damaged files.
- Embedded/CJK fonts, links, bookmarks, rotated/mixed-size pages, large images, and long documents.
- Current-file find, copying, keyboard/touch navigation, and assistive technology behavior.
- iPadOS 17 and an up-to-date iPad; iCloud-only files, file-only grants, relaunch, offline/unavailable providers.
- Each desktop system’s actual packaged webview, including the oldest supported macOS and selected Linux distributions.
- Rapid switching/reloads, source replacement/deletion, print cancel/completion, and bounded memory use.
- Regression tests for existing Markdown rendering, search, tree, incoming-document handling, and printing.

Current frontend tests, Rust unit tests, and Swift plugin tests provide useful extension points.
Real platform tests remain necessary because DOM unit tests cannot establish rendering, provider, or print compatibility.

## Outcome and limits

mdview can become a mixed Markdown/PDF viewer while retaining its existing shell and workflows.
PDF.js is the leading shared-renderer candidate; the existing iPadOS 17 minimum prevents an unconditional recommendation of the current upstream bundle.
Binary access, provider coordination, renderer lifecycle, and printing deserve explicit design work.
Folder-wide PDF search and OCR should remain separate milestones.

No source/configuration files were changed.
No dependencies were installed.
No builds or tests were run because this task was analysis only.
The report is stored in `doc/pdf-support-analysis.md`.
