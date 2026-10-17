# PDF.js packaging and compatibility validation

Date: 17 October 2026.
Scope: implementation plan step 2; document opening and application-shell integration remain steps 3–7.

## Packaging decisions

- Pin `pdfjs-dist` to 6.4.299; parser, legacy viewer, and legacy module worker use the same npm installation.
- Use Node 24 in CI; the package requires Node 22.13+ or 24+.
- Preserve existing Vite output targets (`chrome105` / `safari13`); changing the iOS minimum does not silently change desktop requirements.
- Load parser, viewer, and viewer CSS through `loadPdfjs()` only when requested.
- Keep the compatibility page out of normal builds; opt in with `MDVIEW_PDF_PROBE=1`.
- Emit offline resources at `pdfjs/6.4.299/` through the same Vite plugin used for development serving.
- Include the module worker, CMaps, standard fonts, image decoders and JavaScript fallbacks, ICC profile, viewer icons, and license notices.
- Exclude the optional QuickJS scripting sandbox.
- Use an explicitly created browser `Worker` with `PDFWorker.create({ port })`; a failed worker cannot silently become a fake worker.
- Release the external browser worker as well as PDF.js worker state when its owner closes it.
- Fetch ancillary resources through PDF.js's display factories (`useWorkerFetch: false`) for custom Tauri schemes.
- Restrict workers to the same origin; allow local resource fetches, blob fonts/images, and WASM compilation without general JavaScript `unsafe-eval`.
- Keep filesystem asset scopes and file-opening permissions unchanged.

## Compatibility fixes

### Iterator joining

PDF.js 6.4's find normalization calls `Map.keys().join("")`.
Use the scoped `core-js` 3.50.0 iterator-join polyfill after both legacy bundles initialize.
The polyfill loads with the PDF runtime, not during Markdown startup.
A regression test removes the operation before loading the polyfill.
The complete upstream renderer remains an npm dependency; there is no patched distribution fork.

### Safari text streams

iPadOS 18 renders pages but fails `getTextContent()` because its `ReadableStream` lacks async iteration.
The captured stack points to PDF.js's `for await (const value of readableStream)` loop.
This is also reported upstream. [PDF.js issue 21924](https://github.com/mozilla/pdf.js/issues/21924)

`preparePdfDocument()` adapts each document's public `getPage()` results only when that browser feature is absent.
It reads `streamTextContent()` through `getReader()`, merges items/styles/language, and releases the lock on success or error.
Native browser stream prototypes remain unchanged.
Supporting browsers and pure-XFA extraction retain upstream behavior.
The adapter is idempotent for documents and cached page objects.
Future PDF loading code must call `preparePdfDocument(await loadingTask.promise)` before handing a document to viewer components.

### WASM decoding

The host WebKit cannot compile the shipped OpenJPEG WASM because relaxed SIMD is unsupported.
PDF.js's shipped JavaScript fallback successfully decodes an original JPEG 2000 image on all three fixture pages.
The probe checks actual decoded pixels; a successful text-only page is insufficient evidence for image decoding.
The normal library decoder selection remains enabled rather than requiring a newer WebKit engine.

## Reproducible probe

The original fixture contains three Letter pages, twelve standard-font variants per page, a web-link annotation, and a four-color JPEG 2000 image.
The probe requires all 36 find hits, text selection, three decoded images, a real worker, and local resource delivery.
It prepares every print page independently of the on-screen viewer's rendering cache.

Build the minified production probe on a POSIX shell:

```sh
MDVIEW_PDF_PROBE=1 npm run build
node scripts/pdfjs-assets.mjs
```

On macOS, run the real WKWebView/native-print harness:

```sh
xcrun swift scripts/pdfjs-wk-probe.swift dist /tmp/mdview-pdfjs-print.pdf
```

The harness serves the production bundle through `tauri://localhost` with the maintained application CSP.
It returns JSON and a nonzero exit code on failure.
It saves native print output and PNG previews, verifies exactly three distinct printed pages, and exits without sending a job to a printer.
Native printing runs asynchronously after WebKit returns its script-message callback.
A separate watchdog bounds stalled checks.

To test development URLs, start the probe server and run the harness against it:

```sh
MDVIEW_PDF_PROBE=1 npm run dev -- --host 127.0.0.1 --port 1422
xcrun swift scripts/pdfjs-wk-probe.swift dist /tmp/mdview-pdfjs-dev-print.pdf http://127.0.0.1:1422/dev/pdfjs-probe.html
```

Probe mode applies the same CSP to development responses and disables HMR; ordinary development keeps its existing HMR behavior.

To build the probe in an actual Tauri app:

```sh
MDVIEW_PDF_PROBE=1 npm run tauri -- build --config src-tauri/tauri.pdf-probe.conf.json
MDVIEW_PDF_PROBE=1 npm run tauri -- ios build --debug --target aarch64-sim --no-sign --ci --config src-tauri/tauri.pdf-probe.conf.json
```

On Windows, set `$env:MDVIEW_PDF_PROBE="1"` in PowerShell before the desktop build command.
Use the host-appropriate build command; the Swift harness is macOS-only.
Remove the opt-in environment variable and config overlay for a normal application build.

The JPEG 2000 sample is stored as hexadecimal fixture data, avoiding a new production image-generation dependency.
`node scripts/create-pdfjs-probe-image.mjs` regenerates it on macOS with the optional Node canvas package and Apple's built-in encoder.

## Verified results

| Check | Result |
|---|---|
| macOS WKWebView, minified production assets, custom Tauri scheme and application CSP | Pass: real worker, selection, 36 hits, links, fonts, local resources, JPX image decoding. |
| macOS WKWebView, Vite development URLs | Pass: same checks and native print output. |
| Complete native AppKit print-to-PDF | Pass: exactly three distinct pages; page-one and page-three PNG previews visually inspected. |
| Packaged iPadOS 18.0 simulator, minified production frontend | Pass: real worker, selection, all 36 find hits, links, fonts, resources, and all three decoded JPX images after the text-stream adapter; approximately 1.57 seconds. |
| Windows WebView2 / Linux WebKitGTK | Not executable on this macOS host; native runtime/print checks remain pending. |
| Oldest supported macOS / representative Linux distributions | Baselines still need to be agreed; no desktop support floor was raised. |
| Physical iPad and AirPrint | Pending; simulator/rendering checks do not establish physical-device printing or memory limits. |

### Size and memory observations

- Offline resource inventory: 283 files, 4,463,193 bytes, including worker, decoder/font/profile resources, icons, and notices.
- Production parser/adapter chunk: approximately 544 kB raw / 166 kB gzip.
- Production viewer chunk: approximately 231 kB raw / 73 kB gzip.
- The separately loaded iterator compatibility chunk adds roughly 21 kB raw / 7 kB gzip.
- Probe input: 7,970 bytes; three pages with twelve font samples each.
- Maximum single print canvas allocation: 4,362,336 bytes at the prototype's 108 dpi.
- Host rendering/probe elapsed time before native printing: approximately 0.8–1.3 seconds in observed runs.
- Packaged iPadOS 18 simulator: 1,567 ms for the same probe, with no reported text-extraction error.

These figures are a small-fixture benchmark, not a total resident-memory measurement.
They exclude decoder heaps, retained PNG images, text layers, native web processes, and high-DPI display canvases.
The proposed 64 MiB input cap remains unvalidated until representative documents are measured on physical devices.
Normal Markdown startup does not import the PDF runtime or instantiate its worker.

## Printing decision for step 8

The proven macOS prototype path prepares every page at print intent and uses asynchronous AppKit printing of a dedicated print DOM.
PDF printing needs original page dimensions and its own native margin configuration; the existing Markdown margins must remain unchanged.
The prototype's raster output does not preserve original vector data and does not establish production print resolution or long-document memory behavior.
Prefer native original-PDF input on iOS as planned; verify it during step 8.
Windows/Linux print dialogs and output remain platform gates rather than inferred successes from browser unit tests.

## Checks and remaining limits

- Final automated suites: 139 frontend, 21 build-script, 35 Rust, and 12 Swift tests passed (207 total; Swift metadata checks used the built simulator application's Info.plist).
- TypeScript and the normal production build passed; the normal build contains the offline worker/resources and excludes the probe page and PDF runtime chunks until application integration imports them.
- Regression coverage includes real PDF parsing/rendering, forced text-stream adaptation, stream failures/lock release, adapter idempotence, iterator joining, worker cleanup, resource inventory/version agreement, dev serving, and CSP constraints.
- Node build-script tests now include all existing `*.node-test.mjs` files.
- npm audit reports no PDF.js/core-js advisory; existing KaTeX/Mermaid and source-map-js findings remain outside this work package.
- CMap/ICC delivery is checked; a broad CJK, embedded-font, CMYK, encrypted, and damaged-PDF corpus remains release work.
- Actual PDF file access, file associations, provider snapshots, and shell controls remain later implementation steps.
- No Windows/Linux runtime pass or physical-device result is claimed by this report.
