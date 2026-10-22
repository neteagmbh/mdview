# PDF opening and registration

Implemented 21 October 2026, implementation-plan step 4.

Update: [step 5 viewing and lifecycle](pdf-viewer-lifecycle.md) now renders the prepared PDFs and adds controls/passwords. The boundary below records step 4 before renderer integration.

## Implemented boundary

The application routes Markdown and PDF files through a shared document-opening controller.
PDFs are prepared into immutable snapshots and displayed as a PDF-ready state with their source name and optional requested page.
This state explicitly says that preview is unavailable in this build.
Page rendering, PDF viewer controls, passwords, and PDF outline/find integration remain steps 5–7; PDF printing remains step 8.
No placeholder content is treated as a printable PDF page.

| Entry point | Routing and ownership |
|---|---|
| Native picker | Markdown/PDF filters; desktop file selection grants the exact canonical file; iOS retains its provider URL. |
| Mixed folder tree | PDF-only branches and uppercase PDF extensions appear alongside Markdown, preserving directory-first sorting, new markers, pinning, and LRU behavior. |
| Native drop | Desktop native drop notifications grant the supplied files before frontend opening; the first supplied file uses the common route. |
| OS handoff / launch / second instance | Local PDFs pass the existing deduplicated queue and startup-precedence logic; native desktop enqueue grants the incoming file. |
| Last-session restore | The last source path is restored; desktop initialization reauthorizes only the persisted active PDF. iOS resolves its retained bookmark. |
| Relative links | Local Markdown/PDF links resolve against the source file, preserving Markdown fragments and positive PDF `#page=N` destinations. Back retains the previous source and fragment. |
| Watcher reload | A dedicated common reload route re-prepares the source without promoting the LRU or restarting watchers on every event. |

The first-file and additional-item notification behavior remains in place.
Remote incoming URLs, remote file hosts, and ambiguous incoming URL query/fragment suffixes are rejected.
Percent signs, hashes, spaces, and Unicode in local filenames remain encoded as path data, rather than being confused with URL fragments.
HTTP(S) links in Markdown retain the existing external-browser behavior.

## Native and frontend contracts

`open_document_file(path, requestId, sourcePath?)` and `reload_document_file(path, requestId)` return a discriminated result:

- Markdown: `kind: "markdown"`, UTF-8 `content`, source `path`, and `recentFolders`.
- PDF: `kind: "pdf"`, prepared `document` metadata/handle, and `recentFolders`.

The OS incoming wrapper still distinguishes a document from a folder, with the same discriminated document inside it.
Binary PDF bytes remain available through the step-3 raw IPC API; they are never decoded as Markdown or inserted into the Markdown DOM.
Legacy Markdown commands remain available, while the application shell uses the common commands.

`src/document-opening.ts` owns PDF leases and request cancellation.
Switching documents, showing embedded license content, and page teardown release the prior lease.
Late native results are released instead of replacing the newer document.
Asynchronous Markdown rendering checks the same request guard before committing content.
Failed preparation/display work releases owned handles and reports only the active request's error.

Desktop relative-link requests carry the source document context.
Only an already authorized local source can select a linked target outside existing roots; that selection itself grants only the target.
Subsequent successful opening uses the existing desktop folder-promotion policy.
iOS does not inherit access from the desktop link policy: its file/folder security-scoped grants remain authoritative.
A file-only iOS selection never promotes or scans its parent directory.
Missing provider access can therefore require selecting the target file or its containing folder.

Folder-wide search collects only Markdown paths even though the shared tree now contains PDFs.
Native PDF printing and Markdown print preparation are disabled for the PDF-ready state.
Requested PDF page destinations are retained in navigation state; persistent reading-position behavior remains step 6.

## Registration

Maintained Tauri configuration adds a separate `.pdf` association with MIME `application/pdf`, system UTI `com.adobe.pdf`, role `Viewer`, and rank `Alternate`.
Existing Markdown and folder associations remain separate.
The maintained Apple overlays explain that PDF uses the system type; only Markdown has an imported type declaration.
The generated iOS plist is synchronized with Markdown, PDF, and folder document types.
No default-application reassignment or system PDF UTI ownership declaration is made.
Registration tests select entries by UTI instead of assuming an association occupies the first array element.

## Validation and remaining checks

- All 255 automated tests passed: 160 frontend, 21 build-script, 54 Rust, and 20 Swift; supplying both freshly built Apple plists exercised the optional metadata checks without skips.
- Automated coverage includes PDF-only/mixed discovery, Markdown-only search collection, unusual local PDF paths, launcher URLs, remote/ambiguous URL rejection, source/target grant boundaries, common result serialization, PDF link clicks/page fragments, stale-result disposal, reload ownership, incoming folders, and embedded-document guards.
- TypeScript, the normal production frontend build, macOS app bundling, and unsigned ARM64 iOS simulator app building pass.
- Both compiled Apple bundles are checked for Markdown, PDF, and folder associations; the built iOS minimum remains 18.0.
- On 22 October 2026, an isolated macOS test application passed native picker → PDF-ready, PDF → Markdown, relative PDF `#page=2`, and Back → Markdown checks through its actual WKWebView/native IPC path. It used a distinct application identifier and temporary storage; the installed mdview application was left running unchanged.
- Clippy completed with the four existing diagnostics in incoming routing, printing, and application setup; no new diagnostics remain. The temporary absolute Node path needed by the Xcode test build was restored.
- Physical iPad Files/iCloud/third-party-provider handoff and native drop behavior require device validation.
- Windows/Linux installation registration and native opening remain platform checks; step-2 Windows renderer results do not establish these new entry-point behaviors.
- The conservative 16 MiB PDF cap and provider/snapshot limitations from [step 3](pdf-document-access.md) remain in force.
