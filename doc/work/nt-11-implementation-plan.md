# NT-11 – Umsetzungsplan (mdview: iPad-Support und iCloud-Dokumente)

Dieser Plan beschreibt die schrittweise Umsetzung von
[NT-11](https://netea.atlassian.net/browse/NT-11) („IOS Support and iCloud document sharing
support", Phase 7 aus dem NT-3-Plan). Zielplattform ist zunächst das **iPad**; iPhone-Support ist
ausdrücklich nachgelagert. Zuerst werden **lokale `.md`-Dokumente** unterstützt,
**iCloud-Dokumente folgen in einer späteren Phase**.

## Mindestversion iPadOS 17

**Ergebnis: iPadOS 17 ist das Mindestziel.** Die installierte Xcode-Version unterstützt keine
iPadOS-16-Simulator-Runtime mehr.

- **Tauri**: Das Rust-Projekt nutzt Tauri `~2.12.0`. Tauri 2 unterstützt iOS/iPadOS als Build-Target;
  das Standard-Deployment-Target ist **iOS 15.0** (`bundle > iOS > minimumSystemVersion`,
   entspricht `IPHONEOS_DEPLOYMENT_TARGET`). Das Projekt setzt das Minimum auf **17.0**.
- **WebKit/Safari 17** (WKWebView auf iPadOS 17) deckt die vom Frontend genutzten Features ab:
  `details`/`summary`, `backdrop-filter`, CSS-Grid, `:focus-visible`, Pointer Events,
  `navigator.clipboard.writeText` (ab iOS 13.4, erfordert User-Gesture), ES2022. Vite 7 baut
   standardmäßig für „baseline widely available" (inkl. Safari 17). Mermaid 11 und KaTeX laufen in
   Safari 17.
- **Plugins**: `tauri-plugin-dialog` (Datei-Picker über `UIDocumentPickerViewController`) und
  `tauri-plugin-opener` (URLs) unterstützen iOS.
- **Einschränkungen unter iPadOS** (werden im Plan adressiert):
  - Keine nativen Menüs (`tauri::menu` ist Desktop-only) → Menü-Einträge haben Toolbar-Äquivalente.
  - `window.print()`/nativer Druckdialog: der macOS-Pfad (`print_document`) ist `cfg(target_os =
    "macos")`; für iPad zunächst deaktivieren, später optional `UIPrintInteractionController`.
  - Fenster-Geometrie-Persistenz (`onResized`/`onMoved`, `setSize`) ist auf iPad gegenstandslos.
  - Ordner-Auswahl: `UIDocumentPickerViewController` erlaubt Ordner-Auswahl; Zugriff außerhalb des
    App-Sandboxes erfordert **Security-Scoped Bookmarks** (Persistenz) und
    `startAccessingSecurityScopedResource` (Zugriff) → eigener nativer Zugriffs-Layer nötig.
  - Datei-Watcher (`notify`): FSEvents gibt es auf iOS nicht; kqueue-Watching funktioniert nur
    eingeschränkt und nur innerhalb zugreifbarer Pfade → Refresh-Strategie statt Watcher.

**Konfiguration**: `tauri.ios.conf.json` mit `"bundle": { "iOS": { "minimumSystemVersion": "17.0" } }`
und Verifikation auf einem iPadOS-17-Simulator (zusätzlich zum aktuellen iPadOS).

## Konventionen

**Jira-Status-Übergänge** (Workflow: Backlog → Selected for Development → In Arbeit → Fertig):

| Transition-Name | Transition-ID | Zielstatus |
|---|---|---|
| Schedule | 2 | Selected for Development |
| Start work | 14 | In Arbeit |
| Resolve | 4 | Fertig |

NT-11 wird beim Start auf **„In Arbeit"** gesetzt; nach Abschluss aller Phasen (oder – falls
NT-11 in Subtasks aufgeteilt wird – je Subtask) erfolgt „Resolve" mit Abschlusskommentar.

**Validierungs-Befehle**:

- Frontend-Tests: `npm test`
- Typecheck + Build: `npm run build`
- Rust-Tests/-Lint: `cargo test` / `cargo clippy` (in `src-tauri`, inkl. `--target aarch64-apple-ios-sim`)
- iPad-Simulator: `npm run tauri ios dev 'iPad Pro 11-inch (M4)'`
- Physisches iPad: `npm run tauri ios dev --host` (Dev-Server via `TAURI_DEV_HOST`)

**Dokumentationsregeln** (aus [AGENTS.md](../../AGENTS.md)): RustDoc für alle neuen
Rust-Artefakte; Unit-Tests für jedes signifikante neue Artefakt/Feature; nach jeder Phase die
komplette Testsuite ausführen.

## Implementierungsstatus

Status-Legende: 🔲 Nicht begonnen · 🟡 In Arbeit · ✅ Fertig · ⛔ Blockiert

| Phase | Inhalt | Status | Zuletzt aktualisiert |
|---|---|---|---|
| 0 | Toolchain & iOS-Projekt-Scaffolding | ✅ Fertig | 2026-09-30 |
| 1 | Plattform-Abstraktion Desktop-Features | 🔲 Nicht begonnen | – |
| 2 | iPad-UI (Touch, Safe Areas, Layout) | 🔲 Nicht begonnen | – |
| 3 | Lokale `.md`-Dokumente (Files-App, Picker, Bookmarks) | 🔲 Nicht begonnen | – |
| 4 | Signing, Geräte-Validierung, TestFlight | 🔲 Nicht begonnen | – |
| 5 | iCloud-Drive-Dokumente | 🔲 Nicht begonnen | – |
| 6 | Release-Pipeline & Abschluss | 🔲 Nicht begonnen | – |

---

## Phase 0 – Toolchain & iOS-Projekt-Scaffolding

**Status:** ✅ Fertig

Ziel: Die App startet unverändert (Feature-Lücken erlaubt) im iPad-Simulator.

1. Rust-Targets installieren: `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`;
   Xcode + iOS-SDK + Simulator-Runtimes (aktuelles iPadOS **und** iPadOS 17) verifizieren.
2. `npm run tauri ios init` → erzeugt `src-tauri/gen/apple` (XcodeGen-Projekt). Generierte Dateien
   committen; `project.yml`-Anpassungen dokumentieren.
3. `tauri.ios.conf.json` anlegen: `minimumSystemVersion: "17.0"`; Bundle-Identifier
   `tools.netea.mdview` prüfen (muss zum Provisioning-Profil passen); `developmentTeam` via
   `APPLE_DEVELOPMENT_TEAM` (nicht committen).
4. iOS-Icons generieren (`npm run tauri icon` mit `assets/icon-master.png`); vorhandene leere
   `src-tauri/icons/ios/`-Struktur befüllen.
5. `vite.config.ts` um `TAURI_DEV_HOST`-Unterstützung erweitern (Host/HMR-Konfiguration für
   Geräte-Dev, siehe Tauri-Doku).
6. Smoke-Test im Simulator: App startet, Welcome-Screen sichtbar. Erwartete Lücken (Menü, Print,
   Dateiöffnen) notieren.

**Validierung:** Simulator-Start auf iPadOS 17 und aktuellem iPadOS; Desktop-Build unverändert grün.

**Stand 2026-09-29:** Rust-iOS-Targets installiert, Apple-XcodeGen-Projekt generiert,
`tauri.ios.conf.json` mit Deployment-Target 17.0 angelegt (im Xcode-Projekt bestätigt),
iOS-Icons aus `assets/icon-master.png` generiert und `TAURI_DEV_HOST` in Vite eingerichtet.
Rust-Tauri 2.12.0 behebt mit `swift-rs` 1.0.8 den Xcode-27-Swift-Fehler. Das iOS-Target
deaktiviert das Xcode-Buildskript-Sandboxing; die Desktop-Menüregistrierung ist auf
`#[cfg(desktop)]` begrenzt. Der unsignierte iOS-Simulator-Build und der unsignierte
macOS-App-Build sind mit `--ignore-version-mismatches` erfolgreich; `npm test`
(96 Frontend- und 7 Skript-Tests) und `cargo test` (28 Tests) sind grün.
**Stand 2026-09-30:** JS-API und CLI sind auf 2.12.0 abgeglichen. Beide unsignierten Builds
(macOS-App und iOS-Simulator) funktionieren jetzt ohne `--ignore-version-mismatches`;
`npm run build` und `npm test` (96 Frontend- und 7 Skript-Tests) sind grün. Der App-Start
auf iPadOS 17.5, 26.5 und 27.0 ist per `simctl install`/`launch` und sichtbarem
Startbildschirm im Simulator bestätigt. Signierung und Geräte-Tests folgen in Phase 4.

## Phase 1 – Plattform-Abstraktion der Desktop-Features

**Status:** 🔲 Nicht begonnen

Ziel: Ein Binary, das auf Desktop unverändert funktioniert und auf iOS keine Desktop-APIs berührt.

1. **Rust** ([lib.rs](../../src-tauri/src/lib.rs)): Menü-Aufbau, `on_menu_event`,
   Fenster-Geometrie-Wiederherstellung und `print_document` unter `#[cfg(desktop)]` bzw.
   `#[cfg(target_os = "macos")]` kapseln. Neues Command `platform_capabilities()` → liefert dem
   Frontend `{ print: bool, nativeMenu: bool, windowGeometry: bool, watcher: bool, directoryPicker: bool }`.
2. **Watcher** ([watcher.rs](../../src-tauri/src/watcher.rs)): auf iOS nicht starten (cfg-Gate);
   stattdessen Frontend-Refresh bei App-Aktivierung (visibilitychange/Resume) auslösen.
3. **Frontend** ([main.ts](../../src/main.ts)): Capabilities beim Start laden; Print-Button,
   Fenster-Geometrie-Persistenz und Watcher-Listener nur bei vorhandener Capability aktivieren.
   View-State (Zoom, Sidebar-Breiten, aktives Dokument) bleibt – Speicherort (App-Config-Dir)
   funktioniert auf iOS.
4. Unit-Tests: Rust-Tests für Capability-Logik; Frontend-Tests für capability-abhängige
   Initialisierung (Harness mit gemocktem `invoke`).

**Validierung:** `cargo clippy` für Desktop- und iOS-Target; alle bestehenden Tests grün;
Simulator-Smoke-Test ohne Fehlermeldungen in der Konsole.

## Phase 2 – iPad-UI

**Status:** 🔲 Nicht begonnen

Ziel: Bedienbarkeit per Touch auf iPad-Displays (Hoch-/Querformat, Split View).

1. Safe-Area-Insets (`env(safe-area-inset-*)`) in Toolbar/Sidebars berücksichtigen;
   `viewport-fit=cover` im Viewport-Meta.
2. Touch-Ziele auf min. 44×44 pt bringen (Toolbar-Icons, Baum-Zeilen, Pin/Remove-Buttons,
   Tab-Leiste); Hover-only-Affordances überprüfen.
3. Sidebar-Resize-Handles auf Touch prüfen (Pointer Events funktionieren; ggf. breitere
   Hit-Zone) oder auf iPad deaktivieren; Outline-Sidebar als Overlay im Hochformat
   (bestehender `max-width: 900px`-Breakpoint greift bereits – verifizieren).
4. Kontextmenü im Dokumentbaum (NT-16-Feature): Long-Press als `contextmenu`-Äquivalent
   verifizieren (WebKit löst `contextmenu` bei Long-Press aus; sonst Long-Press-Handler ergänzen).
5. Drag&Drop-Overlay und Tastatur-Shortcuts (⌘F, ⌘P) degradieren sauber; ⌘F mit
   Hardware-Tastatur am iPad testen.
6. Unit-Tests für neue UI-Logik (z. B. Long-Press-Handler), manuelle Simulator-Matrix:
   Hoch-/Querformat, Split View, Dark Mode.

**Validierung:** `npm test`, Simulator-Durchgang mit Checkliste; keine Regression im Desktop-Layout.

## Phase 3 – Lokale `.md`-Dokumente

**Status:** 🔲 Nicht begonnen

Ziel: Öffnen, Anzeigen und Wiederfinden lokaler Markdown-Dateien auf dem iPad – Files-App-Ordner
der App zuerst, danach beliebige lokale Orte über den Document Picker.

1. **Files-App-Integration („Open in place")**: `Info.ios.plist` mit `UIFileSharingEnabled` und
   `LSSupportsOpeningDocumentsInPlace` = `true` → der `Documents`-Ordner der App erscheint in der
   Files-App; dort abgelegte `.md`-Dateien sind ohne Bookmarks les-/watchbar. Der App-eigene
   `Documents`-Ordner wird als Default-„Recent Folder" registriert.
2. **Document Picker**: „Open file"/„Open folder" über `tauri-plugin-dialog` (iOS-Picker).
   Verifizieren, was der Plugin-Picker auf iOS zurückgibt (Pfad vs. security-scoped URL) und ob
   Ordner-Auswahl unterstützt wird; andernfalls kleines Swift-Plugin (Tauri-Mobile-Plugin) für
   `UIDocumentPickerViewController` mit `startAccessingSecurityScopedResource`.
3. **Security-Scoped Bookmarks**: Persistenz der „Recent Folders" außerhalb des Sandboxes über
   Bookmark-Daten (Swift-Seite); Rust-Kommandos `open_markdown_file` / `recent_markdown_tree` um
   einen iOS-Zugriffs-Layer erweitern (Zugriff öffnen → lesen → schließen). Fehlerfälle: Bookmark
   abgelaufen/Datei verschoben → Eintrag markieren statt crashen.
4. **Datei-Assoziation**: `bundle > fileAssociations` für `md`/`markdown` (UTType
   `net.daringfireball.markdown`), damit „Öffnen mit mdview" aus der Files-App funktioniert;
   Open-URL-Event im Rust-Backend behandeln.
5. Rust-Unit-Tests für den Zugriffs-Layer (mit Fake-Provider); Frontend unverändert (nutzt
   bestehende Commands).

**Validierung:** Simulator + reales iPad: Datei aus Files-App öffnen, Ordner wählen, Recent-Tree
über App-Neustart hinweg, Suche über Ordner-Scope.

## Phase 4 – Signing, Geräte-Validierung, TestFlight

**Status:** 🔲 Nicht begonnen

1. Apple-Developer-Setup: App-ID `tools.netea.mdview`, Provisioning-Profile (Development +
   App Store), Zertifikate; `developmentTeam` in lokaler, nicht committeter Konfiguration.
2. `npm run tauri ios build` → signiertes `.ipa`; Ad-hoc-Installation auf Test-iPad.
3. Validierungs-Checkliste auf echtem Gerät (iPadOS 17-Gerät oder -Simulator plus aktuelles
   iPadOS): Performance großer Dokumente, Mermaid-Rendering, Zoom, Suche, Speicherverbrauch.
4. TestFlight-Upload (App Store Connect), interne Testgruppe.

**Validierung:** TestFlight-Build läuft auf Referenzgeräten ohne Blocker.

## Phase 5 – iCloud-Drive-Dokumente

**Status:** 🔲 Nicht begonnen

Ziel: `.md`-Dokumente in iCloud Drive lesen und in den Recent Folders führen.

1. **Stufe 1 (bereits ab Phase 3 nutzbar):** iCloud-Drive-Dateien/-Ordner über den Document
   Picker – funktioniert ohne iCloud-Entitlement über security-scoped URLs. Zusätzlich:
   Nicht-lokale Dateien (`NSURLUbiquitousItemDownloadingStatus`) vor dem Lesen via
   `startDownloadingUbiquitousItem` anfordern; UI-Status „wird geladen" im Baum.
2. **Stufe 2 (eigener iCloud-Container):** iCloud-Entitlement (`com.apple.developer.icloud-services`
   = CloudDocuments, Container `iCloud.tools.netea.mdview`), `NSUbiquitousContainers` in
   `Info.ios.plist` → mdview-Ordner erscheint direkt in iCloud Drive; App-Default-Ordner wahlweise
   lokal oder iCloud.
3. Konflikt-/Sync-Fälle: mdview ist Read-only-Viewer → nur aktuellste Version anzeigen; bei
   unloaded Dateien Platzhalter. Metadaten-Refresh beim App-Resume (ersetzt Watcher).
4. macOS-Seite prüfen: gleicher Container optional auch für die Desktop-App (Document-Sharing
   Mac ↔ iPad) – Entscheidung dokumentieren.

**Validierung:** Zwei Geräte (oder Gerät + Mac): Datei in iCloud ablegen, auf iPad öffnen;
Offline-/Unloaded-Verhalten; Provisioning mit iCloud-Entitlement in TestFlight.

## Phase 6 – Release-Pipeline & Abschluss

**Status:** 🔲 Nicht begonnen

1. Build-Skript `scripts/build-ios.mjs` analog zu [build-macos.mjs](../../scripts/build-macos.mjs)
   (Version-Sync, Build, Export, Notarisierung entfällt – App Store Upload via `xcrun altool`/
   `notarytool`-Äquivalent `xcrun iTMSTransporter` bzw. Fastlane; Entscheidung in der Phase).
2. `npm test`-Integration für das neue Skript (`node --test`), README/THIRD_PARTY_LICENSES
   aktualisieren (iPad-Abschnitt).
3. Jira NT-11 abschließen (Kommentar mit Zusammenfassung + Validierung), diesen Plan final
   aktualisieren.

## Risiken & offene Punkte

| Risiko | Auswirkung | Mitigation |
|---|---|---|
| `tauri-plugin-dialog` liefert auf iOS keine Ordner-Auswahl/keine persistierbaren Pfade | Phase 3 aufwändiger | Eigenes kleines Swift-Mobile-Plugin (Picker + Bookmarks); Aufwand in Phase 0 per Spike prüfen |
| Recent-Folder-Modell (rekursiver Scan) auf security-scoped Ordnern langsam | UX | Scan-Tiefe begrenzen, Lazy-Scan pro Aufklappen |
| Kein Watcher auf iOS | Stale-Anzeige | Refresh bei App-Resume + manueller Refresh-Button (existiert) |
| Mermaid/KaTeX-Bundle-Größe auf Mobile | Startzeit | Lazy-Load der Diagramm-Module prüfen (separates Ticket) |
| Tauri-Swift-Build verwendet unter Xcode 27 das macOS-SDK im iOS-Build | Simulator-Start blockiert | Xcode-/Tauri-SDK-Auswahl korrigieren und iPadOS 17 sowie aktuelles iPadOS testen |
