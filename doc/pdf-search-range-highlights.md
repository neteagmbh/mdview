# PDF search highlights using selection geometry

Implemented 2026-10-22 for the displacement reported on macOS and Windows.

## Behavior

PDF.js still extracts and normalizes text, finds matches, converts original
UTF-16 offsets to text-item boundaries, counts results, and navigates between
them. mdview replaces only the search-highlight painter.

The painter constructs a DOM Range for each match without inserting highlight
spans or replacing text nodes. It uses `Range.getClientRects()`, the same geometry
source as the installed PDF.js selection overlay, and draws noninteractive
rectangles outside the text layer. The current hit is green; other hits are
magenta. Distinct line/fragment rectangles are preserved and exact duplicates
are removed. No character-width estimation or diacritic stripping is performed.

Coordinates are normalized against the **text layer's** viewport bounds, then
painted in the **canvas wrapper's** coordinate plane, matching PDF.js DrawLayer
selection rendering. These dimensions must not be assumed equal. This accounts
for the actual page origin, borders, zoom, rotation, and CSS pixel coordinates
without multiplying by device pixel ratio. Upstream page
enable/disable events remove or repaint overlays during rendering and cache
eviction; completed text-layer renders refresh reused geometry. Closing search
clears overlays, and disposing the renderer removes overlays and event hooks.

## Correction after the first implementation

The first painter normalized against its own overlay instead of the text layer.
Its test compared those painted rectangles directly to DOM rectangles in the
same wrong coordinate plane. Passing that test did not establish agreement with
the actual rendered selection overlay, and the user reported unchanged offsets.

Paired native WebKit screenshots reproduced the difference. At 100% on page 269,
the text layer measured **642 x 906** CSS pixels while the canvas wrapper and
search overlay measured **624 x 888**. Page borders plus the application's global
border-box sizing explain the 18-pixel difference. Native PDF.js selection
normalizes the source text-layer coordinates before painting on the smaller
canvas plane; the corrected search painter now performs that same mapping.

The regression suite now explicitly uses different source/target dimensions.
The native probe compares against the selection mapping, and its visual modes
allow actual search and selection screenshots to be compared on pages 269/297.

## Integration boundary

- `src/pdf-search-highlights.ts` adapts the page highlighter's `_updateMatches`
  method and reuses `_convertMatches` in pinned PDF.js **6.4.299**.
- `src/pdf-viewer.ts` installs the adapter before document initialization.
- `src/pdf-viewer.css` defines overlay colors, positioning and forced-colors styles.
- These PDF.js members are internal. Revalidate the adapter and native probes
  when upgrading PDF.js; no dependency files or upstream prototypes are patched.
- Range geometry still depends on the browser text layer. This fix makes search
  follow selection geometry; it does not promise independent PDF glyph-ink boxes.

## Validation

- 208 frontend unit tests, 21 Node script tests, and 55 Rust tests passed.
- TypeScript checking and the normal production Vite build passed.
- Six-cycle native macOS WebKit viewer probe passed: real-worker rendering,
  selection, offscreen search, next/previous navigation, no-match search,
  search-overlay cleanup, bookmarks, zoom/rotation, caching, replacement and disposal.
- Native macOS WebKit geometry probe passed **24 cases** for the checksum-verified
  `testdata/10.1515_9783111059228.pdf`: physical pages **269 and 297**, scales
  **1, 1.25, 1.5625**, rotations **0, 90, 180, 270**. It compared the selected
  `Koordinaten` hit's painted rectangles against an independently constructed
  DOM Range mapped into the native selection plane. Maximum difference:
  **0.014581 CSS pixels**. This measures agreement
  with selection, not independent glyph-ink accuracy or every hit on each page.
- The corrected geometry probe passed from the development origin and from
  minified production assets under `tauri://localhost` with the application's CSP.
  The six-cycle viewer lifecycle probe also passed against those production assets.
- Unit regressions cover partial and cross-item matches, split lines, UTF-16
  offsets, combining marks, existing-selection preservation, selected-only mode,
  geometry refresh, empty/disconnected pages and disposal.
- Paired native search/selection screenshots were visually inspected on both
  affected pages after the coordinate mapping was corrected. Upstream match
  boundaries are retained, including separately extracted combining-mark fragments.
- **Windows/WebView2 verification of this fix remains pending.** The earlier
  Windows report documents the original failure, not a post-fix pass.

## Repeat on Windows

1. Run the normal app and repeat the scenarios in
   [the Windows test procedure](pdf-search-highlighting-windows-test.md), using
   [the original results](work/windows-pdf-highlight-results.md) as the baseline.
2. Search `Koordinaten` and inspect all hits on physical pages 269/297, including
   bold text, compounds, split-line fragments and nearby combining accents.
3. Select exactly the highlighted substring and compare the boundaries. Exercise
   next/previous, clear/re-entry, zoom, quarter-turn rotation and page eviction.
4. Search rectangles now use `.pdf-search-highlights .pdf-search-highlight`;
   the current result has `.is-selected`. The text layer must contain no
   `.highlight` spans. The old collector's `.textLayer .highlight` selector no
   longer captures search rectangles; keep baseline data separate.
5. For automated browser geometry checks, run the opt-in local probe:

   ```powershell
   $env:MDVIEW_PDF_PROBE = "1"
   npm run dev
   ```

   Open `http://localhost:1420/dev/pdf-search-highlights-probe.html` in the target
   browser and retain the final JSON report. It uses the production renderer and
   actual fixture with the 24-case matrix above. Browser results do not substitute
   for testing the native WebView2 app. Stop the server and remove the environment
   variable afterward with `Remove-Item Env:MDVIEW_PDF_PROBE`.

   For a visual comparison, append `?visual=search&page=269` or
   `?visual=selection&page=269`; use `page=297` for the other affected page.
   Visual mode retains the page and worker until the probe tab/window is closed.

The fixture regression page is a development/opt-in probe. The normal application
build includes neither that page nor the book PDF.
