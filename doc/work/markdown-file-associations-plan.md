# Markdown file registration and Apple sharing plan

Status: option A selected and implemented on 2026-10-14. Share/Action extensions remain separate options.

## Initial project findings

- The viewer accepts `md`, `markdown`, `mdown`, `mkd`, and `mkdn`.
- Neither Tauri configuration declares file associations.
- The generated iOS plist has no document-type declaration or open-in-place setting.
- Rust does not handle OS-delivered file-open events; the frontend currently opens files through the picker, navigation, restoration, or drag-and-drop.
- The iOS documents plugin already coordinates provider reads and retains security-scoped bookmarks. Incoming OS document URLs must join that same access lifecycle.

## Options

| Option | User experience | Additional work |
| --- | --- | --- |
| A — file registration and opening | Finder/Explorer/file-manager Open With; iOS Open In/Copy to mdview where the sending app offers document handoff | Associations, Apple type declarations, startup/runtime file delivery, provider access |
| B — A plus Share import | A dedicated mdview share destination accepts Markdown attachments and saves them for the main app | Native extension targets, activation rules, App Group storage, import UI, signing and embedding |
| C — A plus Action preview | A “View Markdown” action displays the document within the sending app’s sharing interface | Native Action extension and an extension-safe preview renderer |

Recommend A as the first independently deliverable package. It establishes full-app document opening on every target. Choose B when a dedicated share-destination icon is required; choose C when immediate preview inside another app is the desired interaction. File registration alone does not create a dedicated Share extension. Apple documents Action extensions as suitable for viewing content and distinguishes their placement from Share extensions. [Apple Action extensions](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Action.html), [Apple Share extensions](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html).

On iOS, design B to import successfully without requiring the extension to launch the main app. Apple's documented `NSExtensionContext.open` support is extension-point-specific; automatic transition to the containing app must not be promised for Share/Action extensions. App Groups provide a supported shared container. [Apple extension URL opening](https://developer.apple.com/documentation/foundation/nsextensioncontext/open%28_%3Acompletionhandler%3A%29), [Apple shared containers](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionScenarios.html).

## Package A implementation

1. **Register the supported types.** Add Tauri `bundle.fileAssociations` for all five existing extensions, with the registered MIME type `text/markdown`, name “Markdown document”, and Apple role `Viewer`. Use `Alternate` handler rank on Apple. Register availability without changing the user’s chosen default app. [IANA Markdown registration](https://www.iana.org/assignments/media-types/text/markdown), [Tauri configuration](https://v2.tauri.app/reference/config/).
2. **Declare Apple document support.** Reuse the conventional `net.daringfireball.markdown` identifier already proposed in the project’s iPad plan. Supply an imported type declaration mapping the extensions and MIME type, conforming to plain text/data. Markdown is not a proprietary mdview format, so avoid exporting a new mdview-owned Markdown identifier. Merge maintained macOS/iOS plist overlays through Tauri configuration; verify the built plists rather than relying on generated-project edits. [Apple imported declarations](https://developer.apple.com/documentation/bundleresources/information-property-list/utimportedtypedeclarations).
3. **Route incoming files.** Introduce a small Rust module for incoming-document requests. Handle Apple `RunEvent::Opened`; queue requests before frontend readiness, then consume them once. Register listeners before draining the queue. A newly requested document takes precedence over restoring the previous document. Reject unsupported schemes/extensions through existing validation. Decode filesystem URLs using URL APIs. [Tauri file delivery](https://v2.tauri.app/learn/mobile-file-associations/).
4. **Support Windows/Linux launch delivery.** Parse filename arguments and the launch working directory. Forward subsequent launches to the existing desktop instance and bring its window forward. Inspect generated installer registrations and Linux desktop/MIME artifacts. Treat a Windows Send To shortcut as a separate optional feature from Open With registration. [Tauri single-instance plugin](https://v2.tauri.app/plugin/single-instance/).
5. **Retain iOS access.** Capture security-scoped access from the original incoming URL before reducing it to a filesystem path. Reuse the documents plugin’s bookmark and coordinated-read logic. Enable opening in place for provider-backed documents; retain imported copies delivered by other apps. Enable Files exposure of the app’s Documents folder only if an import inbox is part of the selected scope.
6. **Choose multiple-file behavior.** Proposed first release: open the first supported document in the existing window and notify the user if additional files were supplied. Batch navigation requires a separate scope decision.

## Package B implementation

- Add native macOS and iOS Share extension targets with their own identifiers, provisioned App Group, and explicit Markdown-file activation rules.
- Accept a file attachment first. Supporting generic shared text would make mdview appear for many non-Markdown selections; keep this a separate opt-in scope decision.
- Copy transient provider attachments into the shared import inbox before completing the request. Preserve filenames with collision-safe storage, and have the main app drain imports once without duplication.
- Provide a compact import confirmation UI. Do not assume the extension can switch directly to the main app on iOS.
- Maintain extension source and build descriptions outside disposable generated files. Embed and sign the extension inside the macOS app and iOS app; verify archive/export output as well as debug builds.

## Package C implementation

- Add a native Action extension activated for Markdown attachments.
- Reuse an isolated rendering bundle with sanitized HTML and bundled styles. The extension must work independently of Tauri IPC and the main application lifecycle.
- Preview within the host extension UI; close with Done. Main-app imports remain an optional separate behavior.

## Images and provider access

Opening one Markdown file on iOS does not automatically authorize reading adjacent image files. A Tauri asset-scope grant cannot enlarge the OS security grant. Preserve the source folder when access exists; otherwise offer folder selection for linked assets. Copying a Markdown attachment alone also cannot bring along images that the sending app never supplied. Test these cases with the preceding image-path fix.

## Validation and acceptance

- Unit tests: supported extensions, decoded paths, startup queue consumption, request deduplication, restoration precedence, argument parsing, invalid inputs, and multiple-file handling.
- Packaging checks: macOS/iOS document declarations, imported UTI/MIME mappings, installer associations, Linux desktop entries, and extension embedding/signing when selected.
- macOS: installed app appears in Open With; opening while stopped or running displays the requested document and activates the window.
- iOS/iPadOS: Files, iCloud Drive, and a third-party document handoff work while stopped or running; provider access survives relaunch where bookmarks permit it.
- Windows/Linux: installed app opens filenames containing spaces, Unicode, and URL punctuation; repeated opens reach the existing window.
- B/C only: exercise actual sharing from Files and another host app, cancellation, repeated imports, and unsupported attachments on a real device.
- Run all frontend/Rust unit tests and production builds. Report simulator, real-device, and cross-platform checks separately; metadata inspection alone does not prove the OS menus work.

## Decisions for discussion

1. Start with A, or include B/C in the first implementation?
2. If an extension is included, should it import files into mdview or preview immediately in the sending app?
3. Should shared plain text and multiple attachments be supported, or only one Markdown file?

## Option A implementation and validation results

- All five extensions and `text/markdown` are registered. Both Apple builds declare the imported Markdown UTI, Viewer role, and Alternate rank; iOS enables opening in place.
- Apple file-open events and desktop launcher arguments enter a queue consumed after the UI listener is registered. Incoming startup files take precedence over document restoration. Windows/Linux subsequent launches forward to the existing viewer.
- The iOS plugin captures original NSURLs before Tauri converts them to strings and reuses its picker bookmark lifecycle. This bridge targets the existing single-app-delegate lifecycle; scene-based document delivery would require an additional native bridge if a scene manifest is introduced.
- Multiple-file delivery opens the first file and displays a notice for additional files.
- Passed: 129 frontend tests, 35 Rust tests, 17 build-script tests, and 9 Swift tests (190 total), TypeScript checking, and the production frontend build.
- Passed: macOS debug bundle build and launch, iOS simulator Rust check, native Swift simulator compilation, and full unsigned iOS simulator app build.
- Packaging tests check the actual macOS and iOS app plists for document types, MIME mappings, Viewer/Alternate declarations, and iOS opening-in-place support.
- The existing Xcode build phase requires `npm` on PATH. Simulator build verification used a temporary direct Node/Tauri CLI invocation; the tracked build phase was restored afterward.
- Remaining OS-level validation: actual Finder/Files Open With/Open In handoff, real-device iCloud access and relaunch, and Windows/Linux installation and repeated opening. Build artifacts and metadata checks do not substitute for those tests.
