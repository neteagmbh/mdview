# Third-party licenses

mdview uses the libraries listed below. Each library remains subject to its own license.
The resolved versions are taken from `package-lock.json` and `src-tauri/Cargo.lock`.

License identifiers follow the [SPDX License List](https://spdx.org/licenses/).
Upstream source links provide the applicable license and copyright notices.

## Runtime frontend libraries

| Library | Resolved version | License | Upstream source |
| --- | --- | --- | --- |
| `@tauri-apps/api` | 2.11.1 | Apache-2.0 OR MIT | [tauri-apps/tauri](https://github.com/tauri-apps/tauri) |
| `@tauri-apps/plugin-dialog` | 2.7.2 | MIT OR Apache-2.0 | [tauri-apps/plugins-workspace](https://github.com/tauri-apps/plugins-workspace) |
| `@tauri-apps/plugin-opener` | 2.5.4 | MIT OR Apache-2.0 | [tauri-apps/plugins-workspace](https://github.com/tauri-apps/plugins-workspace) |
| `dompurify` | 3.4.12 | MPL-2.0 OR Apache-2.0 | [cure53/DOMPurify](https://github.com/cure53/DOMPurify) |
| `highlight.js` | 11.11.1 | BSD-3-Clause | [highlightjs/highlight.js](https://github.com/highlightjs/highlight.js) |
| `marked` | 16.4.2 | MIT | [markedjs/marked](https://github.com/markedjs/marked) |
| `marked-highlight` | 2.2.4 | MIT | [markedjs/marked-highlight](https://github.com/markedjs/marked-highlight) |
| `mermaid` | 11.16.0 | MIT | [mermaid-js/mermaid](https://github.com/mermaid-js/mermaid) |

## Rust runtime and build libraries

| Library | Resolved version | License | Upstream source |
| --- | --- | --- | --- |
| `serde` | 1.0.229 | MIT OR Apache-2.0 | [serde-rs/serde](https://github.com/serde-rs/serde) |
| `serde_json` | 1.0.151 | MIT OR Apache-2.0 | [serde-rs/json](https://github.com/serde-rs/json) |
| `notify` | 8.2.0 | CC0-1.0 | [notify-rs/notify](https://github.com/notify-rs/notify) |
| `tauri` | 2.11.5 | Apache-2.0 OR MIT | [tauri-apps/tauri](https://github.com/tauri-apps/tauri) |
| `tauri-build` | 2.6.3 | Apache-2.0 OR MIT | [tauri-apps/tauri](https://github.com/tauri-apps/tauri) |
| `tauri-plugin-dialog` | 2.7.2 | Apache-2.0 OR MIT | [tauri-apps/plugins-workspace](https://github.com/tauri-apps/plugins-workspace) |
| `tauri-plugin-opener` | 2.5.4 | Apache-2.0 OR MIT | [tauri-apps/plugins-workspace](https://github.com/tauri-apps/plugins-workspace) |

## Development-only libraries

| Library | Resolved version | License | Upstream source |
| --- | --- | --- | --- |
| `@tauri-apps/cli` | 2.11.4 | Apache-2.0 OR MIT | [tauri-apps/tauri](https://github.com/tauri-apps/tauri) |
| `@types/dompurify` | 3.0.5 | MIT | [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) |
| `jsdom` | 28.1.0 | MIT | [jsdom/jsdom](https://github.com/jsdom/jsdom) |
| `typescript` | 5.9.3 | Apache-2.0 | [microsoft/TypeScript](https://github.com/microsoft/TypeScript) |
| `vite` | 7.3.6 | MIT | [vitejs/vite](https://github.com/vitejs/vite) |
| `vitest` | 4.1.10 | MIT | [vitest-dev/vitest](https://github.com/vitest-dev/vitest) |
| `tempfile` | 3.27.0 | MIT OR Apache-2.0 | [Stebalien/tempfile](https://github.com/Stebalien/tempfile) |

## Transitive dependencies

The complete resolved dependency inventories are recorded in
[`package-lock.json`](package-lock.json) and [`src-tauri/Cargo.lock`](src-tauri/Cargo.lock).
Transitive dependencies remain subject to the licenses and notices published by their
respective copyright holders.
