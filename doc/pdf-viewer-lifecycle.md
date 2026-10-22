# PDF viewer and lifecycle

Implemented: 22 October 2026, implementation-plan step 5.

Update: [step 6 search and reading state](pdf-reading-state.md) now enables PDF find/bookmarks and preserves reading positions. Deferred-feature statements below record the original step-5 boundary.

## Behavior

The shared shell now displays PDF pages through the pinned PDF.js 6.4.299 viewer components.
The parser, viewer components, and real module worker load only when a PDF opens.
All existing document entry points reach the same renderer.
Continuous pages retain their original colors in light and dark themes.
Text layers support native selection/copy; image-only PDFs remain viewable.

The PDF toolbar shows the current page and page count, previous/next buttons, a direct
page field, fit-width/fit-page/100% choices, and quarter-turn rotation.
The shared zoom controls and Ctrl/Cmd +/−/0 rerender PDF pages at the requested scale.
Explicit zoom is limited to 25–500%; fit modes follow the available viewport.
Page navigation is flushed before transforms so rapid zoom/rotation keeps the selected page.
The direct page field accepts Enter and returns keyboard focus to the page container.
Existing keyboard scrolling targets the PDF container.

Internal destinations and page-navigation actions work within the PDF.
External HTTP(S) links use the existing system-browser handler; credential-bearing URLs
and other schemes are disabled. Embedded attachments, named print/save actions, PDF
scripting, interactive forms, annotation editing, XFA, and automatic URL detection are disabled.
Static annotation and form appearances remain visible.
PDF.js runs under the existing local-worker CSP; general JavaScript eval is disallowed.

Password-protected documents use a modal password field with submit, retry, Cancel,
and Escape. The field is cleared on every completion and retry. Passwords go directly
to PDF.js and never enter application state, storage, logs, or native commands.
Reopening the generated encrypted test PDF requests its password again.

PDF current-file find, outline/bookmarks, reading-position persistence, and printing
remain deferred to steps 6 and 8. Their shell actions cannot fall through to Markdown.
Folder/all-folder text search remains Markdown-only.
Markdown search scope, outline visibility, and document zoom are restored on return.

## Ownership and limits

`document-view.ts` serializes renderer disposal and invalidates stale initialization.
`document-opening.ts` owns native PDF leases and releases the previous snapshot after
its renderer has stopped. Incoming folders update the tree without cancelling the view.
`pdf-viewer.ts` owns its loading task, explicit native worker, PDFViewer, event listeners,
canvas mount, and cancellation signal. Worker failures and page failures surface as errors.

Switching documents aborts pending work/password prompts immediately, stops page rendering,
disconnects upstream observers through its supported abort signal, destroys the loading
task, terminates the owned worker, clears canvas backing stores, and empties the mount.
A worker that becomes ready after cancellation is immediately destroyed.
Native snapshot cleanup remains governed by the step-3 lease manager.

PDF.js schedules visible/nearby pages through its rendering queue and viewport-sized cache.
Each base/detail canvas has a 2,097,152-pixel budget and a 4,096-pixel dimension ceiling.
Detail canvases retain readable visible regions at higher zoom without allocating a
full high-resolution bitmap for every page. These are canvas limits, not a guarantee
on total process memory: document structures, fonts, decoded images, and WebKit also allocate memory.
The existing provisional 16 MiB native PDF input limit remains unchanged.

## Validation

- Unit suites: 176 frontend, 21 script, 54 Rust, and 20 Swift tests pass; Apple metadata tests use built macOS/iOS plists.
- TypeScript checking and normal frontend production build pass; normal builds exclude both development probes and retain separate lazy PDF chunks.
- Native macOS WKWebView: six open/render/close cycles of an original generated 60-page PDF pass with no errors or unhandled rejections.
- That probe verifies selected text, JPX image pixels, external link routing, page 40, fit/zoom/rotation with an actual landscape canvas, per-canvas limits, and empty mounts/terminated workers after every cycle.
- Observed probe maxima: three cached page views, three canvases, and 2,836,508 aggregate canvas pixels. These observations describe this fixture/viewport, rather than universal bounds.
- The existing native three-page print prototype still passes; application PDF printing remains deferred.
- An isolated packaged macOS app passes native-picker opening with Unicode/percent/hash filenames, mixed page sizes, internal page links, rotation, password request/incorrect retry/unlock/reopen/cancel, PDF→Markdown→PDF switching, and a relative `#page=2` destination.
- Visual macOS inspection confirms a dark shell with original white PDF pages and original red/green artwork.
- The unsigned ARM64 iOS simulator application builds with the iOS 18 deployment minimum.

Run the focused production-viewer probe after `MDVIEW_PDF_PROBE=1 npm run build`:

```sh
MDVIEW_PDF_RENDER_ONLY=1 xcrun swift scripts/pdfjs-wk-probe.swift dist /tmp/mdview-viewer-probe.pdf
```

Pending release validation: integrated-viewer interaction on iOS 18 and physical iPad,
Windows/WebView2 and Linux/WebKitGTK runtime checks, representative large/scanned PDFs,
and process-memory plateaus over longer repeated document switches. The step-2 platform
prototype results do not establish these step-5 integration results.
