# PDF document access and resource ownership

Implemented 18 October 2026, implementation-plan step 3.
Application entry-point routing and viewer integration remain subsequent steps.

Update: [step 4 opening and routing](pdf-opening-routing.md) connects application entry points and owns their leases; [step 5 viewing and lifecycle](pdf-viewer-lifecycle.md) renders the pages. The step-3 contract below records the original boundary.

## Contract

Rust's `documents::document_kind()` is the shared backend classifier for case-insensitive Markdown extensions and `.pdf`.
Frontend `DocumentKind` uses the matching `"markdown" | "pdf"` discriminator.
Existing Markdown commands retain their response shapes, UTF-8 behavior, and 16 MiB cap.
Local Markdown reads now enforce the cap during reading as well as before reading.

| Command | Input | Result |
|---|---|---|
| `prepare_pdf_document` | `path`, unique `requestId` | Metadata: `kind`, `handle`, original source `path`, source `name`, byte `size`. |
| `cancel_pdf_preparation` | `requestId` | Cancels pending work; unknown/completed tokens are harmless. |
| `read_pdf_bytes` | `handle` | `tauri::ipc::Response` carrying raw binary bytes, exposed as an `ArrayBuffer`. |
| `retain_pdf_document` | `handle` | Metadata with a new independently releasable lease over the same snapshot. |
| `release_pdf_document` | `handle` | Idempotently closes only that lease. |

No snapshot path or binary content is serialized in metadata.
The Swift bridge returns only source metadata after writing bytes directly into Rust's private staging directory.
`src/documents.ts` wraps this API in `preparePdfResource()` and `PdfResource.read()`, `.retain()`, and `.release()`.
The module remains unused by the Markdown application shell until the routing work.

## Authorization and source identity

On desktop, preparations require a canonical target covered by an existing recent-folder root or an exact native-picker file selection.
Canonicalization rejects symlink escapes from a folder grant; matching uses path components rather than string prefixes.
Native file selections grant only the selected file.
Preparations do not promote folders, scan parents, change the LRU, or add asset-protocol scopes.
Step 4 must register direct OS/drag/drop selections through the appropriate trusted opening path as it connects those entry points.
Restoring a standalone desktop PDF outside recent folders will likewise need an explicit persisted-source authorization policy in that step.

On iOS, preparations require a retained native bookmark/selection.
The resolver accepts both the saved bookmark key and its current resolved provider path.
Directory bookmarks permit descendants; file bookmarks permit exactly one file.
Moved folder prefixes map to the current provider URL, with traversal, sibling-prefix, and symlink-escape checks.
Resolved app-container bookmarks remain usable when no additional security scope is needed.
Unavailable bookmarks remain persisted; missing grants or failed provider reads return an error and can require reselection.

The native provider URL is read through `NSFileCoordinator` off the main thread.
All bytes are copied before the coordination callback returns.
Metadata uses the resolved original source URL rather than a provider staging URL or private snapshot path.
Existing Markdown provider reads retain their coordinated UTF-8 path.

## Snapshot lifecycle

Every successful PDF preparation owns an immutable private snapshot, including desktop local files.
Replacing, deleting, or modifying the original after preparation cannot alter an existing viewer or print lease.
Desktop copying checks source metadata before and after the copy and rejects detected concurrent changes.
The loader checks regular-file type, extension, preflight size, streamed size, read errors, and plausible PDF version headers within the first 1,024 bytes.
PDF.js remains responsible for full document parsing, repair, and password handling.

One viewer lease can be retained into a separate print lease.
Closing the viewer invalidates its handle immediately; a retained print lease continues to refer to the original snapshot.
In-flight reads pin snapshot ownership while their bytes are read.
The last lease/operation removes the snapshot directory.
Handles combine a random session identifier with a monotonic counter and are never reused within a session.
Only source paths belong in persisted reading state; handles and snapshots are ephemeral.

The application cache contains locked session directories.
Launch recovery removes unlocked abandoned sessions, including interrupted initialization, while preserving another live process's snapshots.
A separate recovery lock serializes session creation and crash recovery.
Graceful cleanup uses owned temporary directories; OS locks are released after crashes.

Preparations copy in 64 KiB chunks and check cancellation between chunks and before publishing a lease.
Rust cancellation also writes a private marker checked by Swift.
The frontend wrapper releases a late successful result if cancellation arrived before native registration.
Cancellation does not force an outstanding provider download/coordination callback to return immediately; cleanup completes when native coordination returns.
Preparation errors remove partial output and pending state.
Failed frontend reads release their lease; failed release IPC can be retried through the resource wrapper.

## Bounds and pending decisions

- PDF input cap: **16 MiB**, independently named `MAX_PDF_SIZE`.
- Markdown input cap: unchanged **16 MiB**.
- At most four pending PDF preparations and eight active leases per application session.
- The proposed 64 MiB PDF cap is deferred because step 2 measured only a small fixture and individual canvas allocations, not physical-device peak memory.
- The eight-lease limit includes retained print leases; callers must release them after completion or cancellation.
- File size does not bound decompressed images, PDF.js memory, or page-canvas allocations; renderer scheduling and physical-device measurements remain release gates.
- Real iCloud-only/third-party-provider, offline/reconnect, physical-device, Windows, and Linux access checks remain required as entry points are integrated.
- No native PDF print command is added here; step 8 will consume a retained snapshot rather than the possibly detached JavaScript buffer.

## Regression coverage

Rust tests cover classification and serialized kinds, uppercase extensions, PDF header plausibility, raw IPC response bodies, exact byte limits and overflow, invalid UTF-8, regular-file checks, exact/folder grants, symlink escape, source replacement, independent print leases, stale handles, in-flight ownership, cancellation, copy errors, resource bounds, and abandoned-session recovery.
Swift tests cover binary snapshots, Unicode source identity, source replacement, multichunk copying, bounds and growth, cancellation cleanup, destination non-clobbering, stale/current bookmark paths, file-only grants, folder boundaries, and existing provider-reader behavior.
Frontend tests cover binary response validation, idempotent/retryable release, print ownership, preparation/read errors, cancellation races, and late retained-lease cleanup.

Validation on 18 October 2026:

- All 241 tests passed: 151 frontend, 21 build-script, 50 Rust, and 19 Swift, including optional metadata checks against the rebuilt simulator app.
- TypeScript and the normal production frontend build passed.
- An unsigned ARM64 iOS simulator application build passed with the native snapshot bridge included; the temporary absolute Node build-script path was restored afterward.
- iOS Rust cross-compilation passed. Foundation snapshot tests run on macOS; this does not establish real iCloud or third-party-provider behavior on a physical iPad.
- Clippy completed with four existing diagnostics in incoming-document routing, printing, and application setup; it reported no diagnostic in the new document-access code. A strict `-D warnings` run therefore remains blocked by that existing baseline.
