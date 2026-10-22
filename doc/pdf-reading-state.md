# PDF search, bookmarks, and reading state

Implemented 22 October 2026, implementation-plan step 6.

## Search and bookmarks

The existing search bar uses PDF.js `PDFFindController` for the current PDF.
Ctrl/Cmd+F, query entry, match counts, next/previous buttons, Enter, Shift+Enter,
and Escape share the Markdown search UI. PDF.js extracts text across pages, renders
highlights, and reveals off-screen hits. Counts update while extraction proceeds.
The sidebar identifies the selected hit by page and match number; the adapter retains
the PDF page and text offset rather than inventing Markdown line numbers.
Changing documents, query, scope, or closing search invalidates late UI updates.

Folder and all-folder options explicitly say “Markdown”; they keep the existing native
Markdown backend. PDFs with no text layer return no results. OCR is not included.

The existing outline panel displays embedded bookmarks as nested, keyboard-accessible
buttons and displays “No bookmarks” when none are present. Titles use text nodes.
Traversal is bounded to 2,000 items and 32 levels. Internal destinations use the restricted
PDF link service; HTTP(S) destinations use the existing validated external-link handler.
File/script/attachment actions remain unsupported.

## Reading positions and Back

The optional `pdfPositions` field in native view-state JSON maps original source paths
to page, relative vertical/horizontal offsets, fit/custom scale policy, numeric scale,
and quarter-turn rotation. The most recently read twenty source paths are retained.
No PDF content, password, native handle, or snapshot path enters this field.
Older Markdown-only state loads without migration; malformed frontend coordinates are
discarded and valid ranges are clamped before passing values to PDF.js.

On reopen/restart/reload, PDF.js resolves the actual target-page geometry and settles
its initial mixed-size layout before the saved relative coordinates are reapplied.
Fit policies adapt to the current viewport rather than preserving an obsolete pixel width.
Explicit `#page=N` destinations take precedence over the saved position.
When a replacement contains fewer pages, the saved page is clamped to the new last page.

Back history now captures PDF coordinates before following another document link or
opening a file from the picker, tree, or drop. It also retains Markdown anchors.
Captured Back coordinates go directly to the renderer, so a newer saved position cannot
overwrite an older history destination. History is session-only and capped at 100 visits.
Position updates share the existing debounced native persistence; pagehide also flushes
the current state. Restoring the active document retains incoming-file startup precedence.

## Reload and provider limitations

The desktop watcher already coalesces create/modify/remove/rename events. The frontend
adds a single reload queue with a 150 ms debounce and at most one queued follow-up.
A failed read retries twice at 250 ms intervals to tolerate atomic-replacement gaps.
The source identity and saved position survive these failures; navigating away drops
stale source requests. A persistent failure remains visible and can be retried manually.

The recent-folders Refresh button now reloads the active document as well as the tree.
Markdown keeps its existing scroll coordinates; PDFs restore page-relative coordinates.
This provides an explicit reload route when provider notifications are unavailable.
The change does not add iOS provider change subscriptions, background polling, or a
guarantee that every provider reports external edits. Physical-provider behavior still
requires device validation; users can use Refresh after an external save finishes.

## Validation

- 194 frontend tests pass, including search adapter/controller integration, no-text results, stale callbacks, nested/absent bookmarks, position normalization/bounds, Back across renderer types, exact destination forwarding, shorter replacements, and reload coalescing/retry limits.
- 55 Rust tests pass, including PDF-coordinate JSON round-trip and legacy Markdown-state compatibility; 21 script tests and all 20 Swift tests pass, including built Apple metadata validation.
- TypeScript and normal production frontend builds pass; test probes remain opt-in.
- Native macOS WKWebView passes a 60-page mixed-size fixture with two nested bookmarks, twelve hits on off-screen page 55, next/previous selection, no-result queries, and six restoration/disposal cycles with no asynchronous errors.
- The same probe restores page/relative offset/scale/rotation across fresh renderer/worker instances, handles an image-only PDF with no outline, and clamps a saved distant page against a two-page replacement.
- The isolated packaged macOS app passes shared search with visible text highlights/counts, nested bookmark navigation, PDF→Markdown→Back, and restart restoration of a rotated page and fit policy.
- Manual refresh was tested after removing only the generated test folder from watcher roots: an atomic three-page→two-page replacement remained unchanged in the viewer until Refresh; Refresh loaded the new content and clamped to page 2 while retaining the fit/rotation policy.
- macOS application packaging and an unsigned ARM64 iOS simulator build pass.

Pending release checks: integrated iOS 18/physical iPad provider interaction, Windows and
Linux runtime validation, representative document/process-memory measurements, and
the broader mixed-folder checks in step 7. Application PDF printing remains step 8.
