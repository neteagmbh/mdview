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


## License

mdview is available under the [MIT License](LICENSE).
See [Third-party licenses](THIRD_PARTY_LICENSES.md) for the libraries used by the project.

## Disclaimer

(c) 2026 netea GmbH

Parts of the software and documentation are created / edited using AI tools.
