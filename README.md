# mdview

A small desktop Markdown viewer built with Rust, Tauri 2, TypeScript, and Vite.

## Features

- Native Markdown file picker
- Drag-and-drop opening
- OS Open With registration for `.md`, `.markdown`, `.mdown`, `.mkd`, and `.mkdn` (`text/markdown`)
- iOS Open In document handoff with provider access retained across relaunches
- Persistent LRU of recently viewed folders with pinning to exempt folders from eviction
- Recursive Markdown file tree with refresh support and live updates for new/changed files
- Toggleable document outline with heading navigation
- Markdown search within the current file, a folder, or all recent folders
- Printing and PDF export with a repeating filename/date header and page numbers
- Syntax highlighting for fenced code blocks
- Mermaid diagram rendering
- Session document zoom controls
- Native directory opening and removable recent folders
- Auto-reload of the open document when it changes on disk
- GitHub-flavored Markdown
- Sanitized HTML output
- Light and dark mode
- macOS, Windows, and Linux support

## Prerequisites

Install Node.js, Rust, and the platform dependencies listed in the
[Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/).

## Development

Use Node.js 24 LTS (minimum 22.13.0) for the PDF.js dependency and build tools.

```sh
npm install
npm run tauri dev
```

### PDF.js compatibility probe

The PDF.js packaging prototype is available separately from the Markdown viewer.
Normal builds exclude its test page. To build the offline probe on macOS/Linux:

```sh
MDVIEW_PDF_PROBE=1 npm run build
```

On macOS, verify the production bundle in a real WKWebView:

```sh
xcrun swift scripts/pdfjs-wk-probe.swift dist /tmp/mdview-pdf-print.pdf
```

The Swift command requires macOS and verifies real WebKit rendering and three-page
native print-to-PDF output. See [PDF.js validation](doc/pdfjs-compatibility.md) for
development-server, packaged-app, platform, and memory-measurement details.

## Build

Build the installer or application bundle on each target operating system:

```sh
npm run tauri build
```

Tauri applications are normally built on the operating system they target.

File associations are included in packaged builds. Install the desktop bundle or
iOS app to expose mdview in the OS document-opening menus. Incoming files open in
the current viewer, including when they launch the app; an incoming startup file
takes precedence over the last session's document. When several files arrive
together, mdview opens the first and reports the additional files. Apple declares
mdview as an alternate viewer for Markdown. A dedicated Share/Action extension is
a separate feature.

### Signed and notarized macOS build

Install a `Developer ID Application` certificate in the macOS login keychain,
then select its identity. Configure either App Store Connect API credentials:

```sh
security find-identity -v -p codesigning
export APPLE_SIGNING_IDENTITY="Developer ID Application: Example Company (TEAMID)"
export APPLE_API_ISSUER="issuer-uuid"
export APPLE_API_KEY="key-id"
export APPLE_API_KEY_PATH="/secure/path/AuthKey_key-id.p8"
npm run build:macos
```

Or use Apple ID credentials with an app-specific password:

```sh
export APPLE_ID="developer@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
npm run build:macos
```

The command fails before building when the signing identity or a complete
notarization credential set is missing. Tauri signs, submits, and staples the
generated application and DMG with hardened runtime enabled. Keep all signing
credentials outside the repository. See the
[Tauri macOS signing guide](https://v2.tauri.app/distribute/sign/macos/).

If DMG packaging fails with `error running bundle_dmg.sh`, rerun with verbose
output to see the failing disk-image or Finder command:

```sh
npm run build:macos -- --verbose
```

The final `bundle_dmg.sh` error is a summary; inspect the preceding output for
the underlying error before changing signing settings or removing build files.

### iOS / iPad builds

Build on a Mac with full Xcode installed. Open Xcode to complete its initial
setup and install an iOS simulator runtime in its settings. The app requires
iOS/iPadOS 18 or newer. Devices running iOS/iPadOS 17 must upgrade before
installing this version; an existing mdview installation can remain on the device.

Install the dependencies and Rust targets from the project root:

```sh
npm install
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
brew install cocoapods
```

If `src-tauri/gen/apple` is missing, initialize the Xcode project:

```sh
npm run tauri -- ios init
```

To run in an iPad simulator, disconnect physical iOS devices and select an iPad
simulator when prompted:

```sh
npm run tauri -- ios dev
```

To run on a physical iPad:

1. Connect the iPad by USB, unlock it, and trust the Mac.
2. Enable **Settings → Privacy & Security → Developer Mode** on the iPad and
   follow the restart prompts.
3. Add your Apple account in **Xcode → Settings → Accounts**.
4. Start the development server and open Xcode:

```sh
npm run tauri -- ios dev --open --host
```

In Xcode, select the mdview iOS target, open **Signing & Capabilities**, enable
**Automatically manage signing**, and select your development team. Select
your iPad as the run destination and press **⌘R**. An `Apple Development`
certificate is appropriate for this workflow.

Keep the terminal command running while developing in Xcode. Keep the Mac and
iPad on the same network and allow the app's local-network permission prompt.
The Vite configuration already supports the host supplied by Tauri.

Once signing is configured, build a standalone development package:

```sh
npm run tauri -- ios build --export-method debugging
```

This build embeds the frontend and does not need the development server.
Installing it requires a provisioning profile covering your iPad; Xcode
automatic signing can manage this.

With Xcode 27 / Swift 6.4, release builds can fail to link Swift bridge symbols
such as `retain_object`, `release_object`, and `string_from_bytes`. Until the
[upstream visibility issue](https://github.com/tauri-apps/tauri/issues/16130) is
resolved, `src-tauri/Cargo.toml` enables line-table debug information for the
Tauri crate automatically. The normal build command above requires no additional
environment flags.

Rust keeps its release optimizations. The `swift-rs` build integration selects
the debug configuration for Tauri's native Swift bridge when that crate's debug
information is enabled, keeping the required C exports visible. Other crates and
the native document plugin retain their existing release configuration.

The IPA is generated in `src-tauri/gen/apple/build/arm64/`. Install it through
**Xcode → Open Developer Tool → Device Hub**. Select your iPad, click the
**ⓘ (Info)** toolbar button, select **Apps**, and click **Add** to choose the IPA.
Older Xcode versions use **Window → Devices and Simulators → your iPad →
Installed Apps → +** instead.

**Open file** and **Open folder** use Apple's Files picker on iPad, including
iCloud Drive and other document providers. Select a folder to authorize browsing
its Markdown tree; selecting a single file grants access to that file only.
The app retains bookmarks to reopen selected documents and folders after a restart.
Cloud-only documents are downloaded by the provider when opened.

**Print** opens the native AirPrint dialog on iPad. Printing uses light colors
and light Mermaid images while the document on screen keeps its current theme.
Closing or cancelling the dialog restores the temporary print resources.

Run the native document-reader and print-completion unit tests on macOS with:

```sh
xcrun swift test --package-path src-tauri/plugins/documents
```

The native tests also check that Tauri, SwiftPM, CocoaPods, and Xcode agree on
the iOS deployment minimum. To verify a compiled app's `MinimumOSVersion`, set
`MDVIEW_IOS_APP_INFO_PLIST` to that app's `Info.plist` when running the tests.

See the [Tauri iOS prerequisites](https://v2.tauri.app/start/prerequisites/#ios),
[mobile development guide](https://v2.tauri.app/develop/#developing-your-mobile-application),
and [iOS signing guide](https://v2.tauri.app/distribute/sign/ios/).

## License

mdview is available under the [MIT License](LICENSE).
See [Third-party licenses](THIRD_PARTY_LICENSES.md) for the libraries used by the project.

## Disclaimer

(c) 2026 netea GmbH

Parts of the software and documentation are created / edited using AI tools.
