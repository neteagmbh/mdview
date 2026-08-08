# mdview

A small desktop Markdown viewer built with Rust, Tauri 2, TypeScript, and Vite.

## Features

- Native Markdown file picker
- Drag-and-drop opening
- Persistent LRU of recently viewed folders
- Recursive Markdown file tree with refresh support
- Toggleable document outline with heading navigation
- Syntax highlighting for fenced code blocks
- Mermaid diagram rendering
- Session document zoom controls
- Native directory opening and removable recent folders
- GitHub-flavored Markdown
- Sanitized HTML output
- Light and dark mode
- macOS, Windows, and Linux support

## Prerequisites

Install Node.js, Rust, and the platform dependencies listed in the
[Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/).

## Development

```sh
npm install
npm run tauri dev
```

## Build

Build the installer or application bundle on each target operating system:

```sh
npm run tauri build
```

Tauri applications are normally built on the operating system they target.

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


## License

mdview is available under the [MIT License](LICENSE).
See [Third-party licenses](THIRD_PARTY_LICENSES.md) for the libraries used by the project.

## Disclaimer

(c) 2026 netea GmbH

Parts of the software and documentation are created / edited using AI tools.
