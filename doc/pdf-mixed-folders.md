# Mixed Markdown/PDF folders

Implemented 22 October 2026, implementation-plan step 7.

## Browser and search behavior

The shared tree shows an MD or PDF document icon before each filename, with the same
icon before the current filename in the header. The header icon follows document-type
changes and is hidden when no document is available.
Accessible button names identify Markdown/PDF documents and whether they are new;
the visual type icon is hidden from assistive technology to avoid duplicate labels.
Active-file state, New badges, pinning, and remembered branch expansion remain independent
from the file type. Empty folders say “No Markdown or PDF files.” Loaded trees hide
stale loading/empty instructions instead of displaying them alongside real entries.

“This folder (Markdown)” uses the recent-folder root covering the selected file, including
a PDF nested several directories below that root. With overlapping recent roots, the
most specific covering root wins. Comparisons respect path-component boundaries and
Windows separators/case. A standalone source falls back to its parent directory.
An explicitly opened folder can select the search root while the current PDF stays open.
Reordering/promoting recent roots does not change that selection; removing an explicitly
selected folder clears its directory selection.

Folder/all-folder searches remain Markdown-only and display asynchronous backend match
counts. Current-file scope is labelled “This PDF” or “This Markdown file” and continues
to use the appropriate renderer adapter. PDF selection does not introduce a duplicate
nested recent root or alter the native LRU/pinning policy.

## Shell capabilities and appearance

PDF outline controls and navigation identify embedded bookmarks; Markdown keeps its
heading outline. PDF print remains disabled with “PDF printing is not available yet,”
pending step 8. Loading, failed, and empty views disable current-file search, outline,
and zoom actions instead of acting on stale content. Folder searches remain available.
Failed documents clear stale filename/window/active-file labels.

The PDF page container receives keyboard focus after readiness; Markdown retains its
existing focus behavior. Shell colors follow the appearance preference. PDF pages
remain white with their original artwork colors, without a dark-mode inversion filter.

## Validation

- Full unit suites pass: 201 frontend, 21 script, 55 Rust, and 20 Swift tests, including built Apple metadata checks.
- New coverage exercises mixed-tree type/New/active/pin/expansion state, actual CSS hidden-status behavior, covering-root selection and Windows path boundaries, capability/label transitions, folder result counts, and PDF keyboard focus.
- TypeScript checking, the normal production frontend build, and macOS app packaging pass; probes remain excluded from normal builds.
- An isolated packaged macOS app opened a mixed root containing parent Markdown and nested Markdown/PDF files. Selecting the nested PDF and searching its folder found a parent-root Markdown match. The root stayed intact, expansion/New markers survived promotion and pinning, and opening the Markdown result restored print/outline/zoom labels and behavior.
- Visual macOS inspection confirmed the MD/PDF badges coexist with New and active markers without replacing filenames.
- The native WebKit viewer probe passed in explicit light and dark window appearances. Both checked original white/unfiltered pages, decoded original image pixels, correctly themed controls, keyboard focus, six document restoration/disposal cycles, off-screen find, bookmarks, and a shorter replacement.

Remaining release validation includes physical iOS/provider interaction, Windows and
Linux runtime checks, representative process-memory measurements, complete-document
PDF printing in step 8, and final release checks in step 9. This step adds no provider
change subscriptions or folder-wide PDF text extraction.
