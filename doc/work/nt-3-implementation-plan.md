# NT-3 – Umsetzungsplan (mdview: Initial implementation)

Dieser Plan beschreibt die schrittweise Umsetzung aller offenen Subtasks von
[NT-3](https://netea.atlassian.net/browse/NT-3) in der in NT-3 hinterlegten Phasenreihenfolge
(siehe Kommentar in NT-3 und die Beschreibungsfelder von NT-4 … NT-14).

## Konventionen

**Jira-Status-Übergänge** (Workflow der Subtasks: Backlog → Selected for Development → In Arbeit → Fertig):

| Transition-Name | Transition-ID | Zielstatus |
|---|---|---|
| Schedule | 2 | Selected for Development |
| Start work | 14 | In Arbeit |
| Resolve | 4 | Fertig |

Jeder Subtask wird beim Start der Umsetzung auf **„In Arbeit"** (Transition „Start work") gesetzt
und nach erfolgreicher Validierung auf **„Fertig"** (Transition „Resolve") transitioniert. Beim
Abschluss wird ein Kommentar mit Zusammenfassung, geänderten Dateien und Validierungsergebnis
angehängt.

**Validierungs-Befehle** (aus dem Repository-Root, sofern nicht anders angegeben):

- Frontend-Tests: `npm test` (führt `vitest run` und `node --test scripts/build-macos.node-test.mjs` aus)
- Typecheck + Build: `npm run build` (führt `tsc` und `vite build` aus)
- Rust-Tests: `cargo test` (im Verzeichnis `src-tauri`)
- Rust-Lint: `cargo clippy` (im Verzeichnis `src-tauri`; Projekt hat `pedantic = "warn"` aktiviert, siehe [Cargo.toml](../../src-tauri/Cargo.toml))
- Manueller Smoke-Test: `npm run tauri dev`

**Dokumentationsregeln** (aus [AGENTS.md](../../AGENTS.md)):

- Jede neue Rust-Funktion/Struct/Enum erhält einen RustDoc-Kommentar (`///`).
- Jedes signifikante neue Artefakt/Feature erhält einen Unit-Test, der auch ausgeführt wird.
- Nach Abschluss jeder Phase: vollständige Testsuite (Frontend + Rust) ausführen.
- Neue CLI-Befehle (falls nötig) gehören in eine eigene Datei statt in ein monolithisches Modul.

## Implementierungsstatus

Status-Legende: 🔲 Nicht begonnen · 🟡 In Arbeit · ✅ Fertig · ⛔ Blockiert

Diese Tabelle und die `**Status:**`-Zeile je Phase werden während der Umsetzung fortlaufend
aktualisiert (zusammen mit der jeweiligen Jira-Transition).

| Phase | Subtasks | Status | Zuletzt aktualisiert |
|---|---|---|---|
| 1 – Quick Wins | NT-5, NT-9 | ✅ Fertig | 2026-08-21 |
| 2 – Content-Interaktionsschicht | NT-4, NT-10 | ✅ Fertig | 2026-08-21 |
| 3 – Layout-Fundament | NT-7 | ✅ Fertig | 2026-08-21 |
| 4 – Recent Folders v2 | NT-6, NT-13, NT-14 | ✅ Fertig | 2026-08-21 |
| 5 – Suche | NT-8 | 🔲 Nicht begonnen | – |
| 6 – Druck/PDF-Export | NT-12 | 🔲 Nicht begonnen | – |
| 7 – iOS/iCloud | NT-11 | 🔲 Nicht begonnen | – |

---

## Phase 1 – Quick Wins (NT-5, NT-9)

**Status:** ✅ Fertig (2026-08-21) – `src/clipboard-styles.ts`, Toolbar-Button in `index.html`/`main.ts`, Tests grün, Jira auf „Fertig"

**Nachtrag (2026-08-21):** Kopierte Mermaid-Diagramme werden jetzt als eingebettetes PNG (gerastert via `diagramToPngDataUrl` in `src/diagrams.ts`) statt als reiner SVG-Text kopiert; das Clipboard-PNG wird zusätzlich unabhängig vom Anzeigemodus immer im Light-Theme gerendert (`cacheClipboardImages`). Siehe Kommentare in NT-9.

### Schritt 1.0 – Jira
- NT-5 und NT-9: Transition „Start work" → In Arbeit.

### Schritt 1.1 – NT-5: Open-Directory-Button
1. Button-Markup in [index.html](../../index.html) neben dem bestehenden `#open-button` ergänzen (`#open-directory-button`).
2. In [src/main.ts](../../src/main.ts) Element referenzieren und mit der bereits vorhandenen `chooseDirectory()`-Funktion verdrahten (analog zu `openButton`/`welcomeOpenButton`).
3. Styling in [src/styles.css](../../src/styles.css) ergänzen, falls das neue Icon/Button vom bestehenden Toolbar-Stil abweicht.
4. README/Screenshots in [README.md](../../README.md) aktualisieren, falls die Toolbar dort beschrieben/abgebildet ist.

### Schritt 1.2 – NT-9: Copy/Paste-Farbfehler
1. Neues Modul `src/clipboard-styles.ts` mit einer Funktion (z. B. `normalizeClipboardColors`), die Inline-Styles/CSS-Custom-Properties vor dem Kopieren durch fest aufgelöste, hell-modus-taugliche Farben ersetzt.
2. In [src/main.ts](../../src/main.ts) einen `copy`-Event-Listener auf `#markdown` registrieren, der die Funktion vor `clipboardData.setData("text/html", …)` anwendet.
3. Unit-Test `src/clipboard-styles.test.ts` nach dem Muster der bestehenden Tests (z. B. [src/zoom.test.ts](../../src/zoom.test.ts)).
4. Kommentar/Doku im neuen Modul, kurz begründen warum die Normalisierung nötig ist (Dark-Mode-Leck).

### Schritt 1.3 – Validierung
- `npm test`
- `npm run build`
- Manuell: Datei mit dunklem Theme öffnen, Text markieren, in Word/Outlook einfügen → Farben müssen dem hellen Standard entsprechen.
- Manuell: Toolbar-Button „Open Directory" öffnet den nativen Ordnerdialog und fügt den Ordner dem Recent-Baum hinzu.

### Schritt 1.4 – Jira-Abschluss
- NT-5, NT-9: Kommentar mit Zusammenfassung + Validierungsergebnis, danach Transition „Resolve" → Fertig.

---

## Phase 2 – Content-Interaktionsschicht (NT-4, NT-10)

**Status:** ✅ Fertig (2026-08-21) – `src/content-interactions.ts`, Back-Button + Link-Status + Image-Popout in `index.html`/`main.ts`, `@tauri-apps/plugin-opener`/`tauri-plugin-opener` eingebunden, Tests/Clippy grün, Jira auf „Fertig"

**Nachtrag (2026-08-21):** Popout erweitert um Mermaid-Diagramm-Support, Zoom (Stufen + Ctrl-Mausrad), natives Mausrad-Scrollen und eine schwebende Zoom-/Schließen-Toolbar; neues Modul `src/image-popout.ts`. Siehe Kommentar in NT-10.

**Bugfix (2026-08-21):** Zoom stoppte visuell, sobald der Viewport ausgefüllt war (Flex-Item wurde durch Default-`flex-shrink` zurückgeschrumpft). Fix: `flex: none` auf dem gezoomten Element + `safe center`-Alignment in `styles.css`, damit das Popout in alle Richtungen scrollt statt zu klemmen.

**Refinement (2026-08-21):** Zoom-Berechnung überarbeitet – 100% = tatsächliche Rendergröße im Dokument (inkl. Dokument-Zoomfaktor), dadurch strikt monoton (150% > 100%). Icon-Schritt 25 Punkte, Strg+Mausrad-Schritt 5 Punkte. Öffnen zeigt den echten Fit-Zoom-Prozentwert statt immer „100%". Siehe Kommentar in NT-10.

### Schritt 2.0 – Jira
- NT-4, NT-10: Transition „Start work" → In Arbeit.

### Schritt 2.1 – Gemeinsame Grundlage
1. `@tauri-apps/plugin-opener` zu [package.json](../../package.json) und `tauri-plugin-opener` zu [src-tauri/Cargo.toml](../../src-tauri/Cargo.toml) hinzufügen.
2. Plugin in [src-tauri/src/lib.rs](../../src-tauri/src/lib.rs) registrieren (`.plugin(tauri_plugin_opener::init())`).
3. Capability-Eintrag `opener:default` (bzw. passendes Scope) in [src-tauri/capabilities/default.json](../../src-tauri/capabilities/default.json) ergänzen.
4. Neues Modul `src/content-interactions.ts`: eine gemeinsame Klick-Delegation auf `#markdown`, die zwischen Link-Klicks und Bild-Klicks unterscheidet.

### Schritt 2.2 – NT-4: Link-Navigation
1. In `content-interactions.ts`: relative Markdown-Links (`.md`-Ziel) gegen den Pfad des aktuell offenen Dokuments auflösen und über `loadFile()` öffnen; dabei einen Navigationsverlauf (Back-Stack) führen.
2. Externe `http(s)`-Links: URL sichtbar machen (z. B. Statuszeile/Tooltip) und per `plugin-opener` im System-Browser öffnen statt im Webview.
3. Back-Navigation-Control in der Toolbar ergänzen (Button + Tastaturkürzel).
4. Unit-Test `src/content-interactions.test.ts` für Link-Klassifizierung (relativ vs. extern) und Pfad-Auflösung.

### Schritt 2.3 – NT-10: Popout von Bildern
1. In `content-interactions.ts`: Klick auf `<img>` innerhalb `#markdown` öffnet eine Lightbox/Overlay (neues Markup + CSS in [src/styles.css](../../src/styles.css)) oder alternativ ein natives Tauri-Fenster.
2. Escape-Taste und Klick außerhalb schließen das Popout (Wiederverwendung von [src/keyboard-scroll.ts](../../src/keyboard-scroll.ts)-Mustern, falls sinnvoll).
3. Unit-Test für die Overlay-Erzeugung/-Schließlogik.

### Schritt 2.4 – Validierung
- `npm test`, `npm run build`
- `cargo test`, `cargo clippy` (in `src-tauri`, wegen neuem Plugin)
- Manuell: relativer Markdown-Link öffnet Zieldokument + Zurück-Navigation funktioniert; externer Link öffnet System-Browser statt Webview; Bildklick öffnet Popout und schließt sauber.

### Schritt 2.5 – Jira-Abschluss
- NT-4, NT-10: Kommentar + Transition „Resolve" → Fertig.

---

## Phase 3 – Layout-Fundament (NT-7)

**Status:** ✅ Fertig (2026-08-21) – CSS-Custom-Properties + `src/sidebar-resize.ts` + Drag-Handles, Breakpoints konsolidiert, Tests grün, Jira auf „Fertig"

### Schritt 3.0 – Jira
- NT-7: Transition „Start work" → In Arbeit.

### Schritt 3.1 – Umsetzung
1. Drag-Handles zwischen den drei Grid-Spalten in [index.html](../../index.html) ergänzen.
2. Neues Modul `src/sidebar-resize.ts`: Pointer-Events → Breite in CSS-Custom-Properties statt der festen `grid-template-columns`-Werte aus [src/styles.css](../../src/styles.css#L110-L117) schreiben; Mindest-/Maximalbreiten klemmen.
3. Bestehende `@media`-Breakpoints (Z. 598–653 in [styles.css](../../src/styles.css)) prüfen und anpassen, damit sie mit nutzerdefinierten Breiten koexistieren (z. B. Reset auf Default unterhalb einer Fensterbreiten-Schwelle).
4. Persistenz der gewählten Breiten für die Sitzungsdauer (analog zu `recentFolderOpenState` in [main.ts](../../src/main.ts)); dauerhafte Speicherung optional als Erweiterung vormerken.
5. Unit-Test `src/sidebar-resize.test.ts` für Klemm-Logik (min/max) und Breakpoint-Interaktion.

### Schritt 3.2 – Validierung
- `npm test`, `npm run build`
- Manuell: Sidebars in mehreren Fenstergrößen ziehen, inkl. Verkleinern unter die bestehenden Breakpoints – kein Konflikt/Flackern.

### Schritt 3.3 – Jira-Abschluss
- NT-7: Kommentar + Transition „Resolve" → Fertig.

**Gate vor Phase 6:** Phase 3 muss abgeschlossen und validiert sein, bevor NT-12 (Print-Stylesheet) begonnen wird.

---

## Phase 4 – „Recent Folders v2" (NT-6, NT-13, NT-14)

**Status:** ✅ Fertig (2026-08-21) – Schema-Migration (`RecentFolderEntry`), Pin-Feature, `src-tauri/src/watcher.rs` (notify-Crate, debounced), In-Memory-Baseline-Diff für „neu"-Marker, `read_markdown_file` + Auto-Reload; Tests/Clippy grün, Jira auf „Fertig"

**Refinement (2026-08-21):** „Neu"-Marker basiert jetzt auf Datei-mtime statt Session-Diff: neu, wenn Änderung < 2h alt ODER seit dem letzten Speichern von `recent-folders.json` der Vorsession (je nachdem, was großzügiger ist). Siehe Kommentar in NT-13.

**Bugfix (2026-08-21):** `recent-folders.json`-Parsing war zu strikt und konnte bei abweichenden/fehlerhaften Einträgen mit einem harten Fehler die gesamte Recent-Folder-Liste blockieren. Jetzt toleranter Parser über `serde_json::Value` (einzelne fehlerhafte Einträge werden übersprungen, unbekanntes Format → leere Liste statt Fehler). Siehe Kommentar in NT-6.

### Schritt 4.0 – Jira
- NT-6, NT-13, NT-14: Transition „Start work" → In Arbeit.

### Schritt 4.1 – Schema-Migration (gemeinsam für NT-6 + NT-13)
1. `MarkdownTreeNode`/persistiertes Format in [src-tauri/src/lib.rs](../../src-tauri/src/lib.rs) um `pinned: bool` (NT-6) und `is_new: bool`/`last_seen_at` (NT-13) erweitern.
2. Migrationslogik beim Laden alter `recent-folders.json`-Dateien ergänzen (fehlende Felder mit Default `false`/`None` auffüllen) – Unit-Test für Abwärtskompatibilität mit dem bisherigen Format.
3. Neue Kommandos: `pin_recent_folder` / `unpin_recent_folder` (NT-6); `promote_folder`/`build_recent_tree` so anpassen, dass gepinnte Ordner nicht durch `MAX_RECENT_FOLDERS`-Truncation entfernt werden.

### Schritt 4.2 – Watcher-Grundlage (gemeinsam für NT-13 + NT-14)
1. Crate `notify` zu [src-tauri/Cargo.toml](../../src-tauri/Cargo.toml) hinzufügen.
2. Neues Modul `src-tauri/src/watcher.rs`: ein Watcher pro aktiv beobachtetem Wurzelverzeichnis (Recent Folders) und einer für die aktuell offene Datei; Events per `app.emit(...)` an das Frontend senden.
3. Capability-Prüfung: da Datei-I/O weiterhin über eigene `#[tauri::command]`-Funktionen läuft (nicht über das `fs`-Plugin), sind keine zusätzlichen Capability-Einträge nötig – im PR explizit dokumentieren.

### Schritt 4.3 – NT-13: Tree-Reload + „neu"-Marker
1. Beim Watcher-Event den Tree neu scannen (`scan_directory`) und Diff gegen den vorherigen Zustand bilden, um `is_new` zu markieren.
2. Frontend: [src/recent-tree.ts](../../src/recent-tree.ts) um visuelle „neu"-Marker (Badge/Punkt) erweitern; `renderRecentTree` in [main.ts](../../src/main.ts) auf `listen("recent-tree-changed", …)` reagieren lassen.
3. Unit-Tests: Rust-seitig für Diff-Logik, TS-seitig für das Marker-Rendering in [src/recent-tree.test.ts](../../src/recent-tree.test.ts).

### Schritt 4.4 – NT-14: Auto-Reload geänderter Dokumente
1. Beim Öffnen einer Datei (`loadFile` in [main.ts](../../src/main.ts)) deren Pfad beim Watcher registrieren; bei Änderungsevent Dokument neu laden (`renderMarkdownSource`), Scroll-Position nach Möglichkeit beibehalten.
2. Konflikt-Fall beachten: ungespeicherte Nutzereingaben gibt es in mdview nicht (reiner Viewer) – daher kein Merge-Konflikt-Handling nötig, im Kommentar der Umsetzung kurz festhalten.
3. Unit-Test für die Registrier-/Abmelde-Logik des beobachteten Pfads beim Dateiwechsel.

### Schritt 4.5 – NT-6: Pin-UI
1. Pin-Toggle-Button pro Root-Eintrag in [src/recent-tree.ts](../../src/recent-tree.ts) (`createRootNode`) ergänzen, analog zum bestehenden Remove-Button.
2. Gepinnte Ordner in der Anzeige-Reihenfolge vor den übrigen MRU-Einträgen sortieren.
3. Unit-Test für Sortierung (pinned zuerst) und Toggle-Verhalten.

### Schritt 4.6 – Validierung
- `npm test`, `npm run build`
- `cargo test`, `cargo clippy` (in `src-tauri`, neue Watcher- und Pin-Logik)
- Manuell: Datei extern ändern → Auto-Reload; neue `.md`-Datei in beobachtetem Ordner anlegen → „neu"-Marker + Tree-Update ohne manuellen Refresh; Ordner pinnen → bleibt auch nach Überschreiten von `MAX_RECENT_FOLDERS` erhalten.
- Migrationstest: alte `recent-folders.json` (ohne neue Felder) laden → keine Fehler, Defaults korrekt gesetzt.

### Schritt 4.7 – Jira-Abschluss
- NT-6, NT-13, NT-14: je ein Kommentar + Transition „Resolve" → Fertig.

---

## Phase 5 – Suche (NT-8)

**Status:** 🔲 Nicht begonnen

### Schritt 5.0 – Jira
- NT-8: Transition „Start work" → In Arbeit.

### Schritt 5.1 – Umsetzung
1. Suchleiste + Ergebnisliste in [index.html](../../index.html)/[styles.css](../../src/styles.css).
2. Neues Modul `src/search.ts`:
   - „Suche in Datei": Volltextsuche im aktuell gerenderten `#markdown`-DOM mit Treffer-Hervorhebung und Sprung zum nächsten/vorherigen Treffer.
   - „Suche in Verzeichnis"/„Suche in allen": neues Backend-Kommando (z. B. `search_markdown_files`) in [src-tauri/src/lib.rs](../../src-tauri/src/lib.rs), das `scan_directory`-Ergebnisse wiederverwendet und Dateien on-demand liest (kein Cache, siehe Begründung unten).
3. **Bewusst kein Ergebnis-Cache**, um die in Phase 4 identifizierte Invalidierungs-Problematik zu vermeiden; falls Performance-Probleme auftreten, Caching erst nach Phase 4 als separate Erweiterung mit expliziter Watcher-Invalidierung nachziehen.
4. Unit-Tests: `src/search.test.ts` für Treffer-Highlighting/-Navigation; Rust-Test für das neue Suchkommando.

### Schritt 5.2 – Validierung
- `npm test`, `npm run build`, `cargo test`
- Manuell: Suche in großem Verzeichnis (mehrere Ebenen) liefert korrekte Treffer inkl. Sprung zur Fundstelle.

### Schritt 5.3 – Jira-Abschluss
- NT-8: Kommentar + Transition „Resolve" → Fertig.

---

## Phase 6 – Druck/PDF-Export (NT-12)

**Status:** 🔲 Nicht begonnen

### Schritt 6.0 – Jira
- NT-12: Transition „Start work" → In Arbeit. **Voraussetzung:** Phase 3 (NT-7) ist „Fertig".

### Schritt 6.1 – Umsetzung
1. `@media print`-Block in [src/styles.css](../../src/styles.css) ergänzen: Sidebars, Toolbar und Overlays ausblenden, Dokumentbreite auf 100 % setzen.
2. Farb-Normalisierungs-Helfer aus Phase 1 (`src/clipboard-styles.ts`) verallgemeinern/wiederverwenden (z. B. Umbenennung in `src/export-colors.ts`), damit Dark-Mode-Farben auch beim Druck nicht durchschlagen.
3. Druck-Trigger (Menüeintrag + Toolbar-Button) über `window.print()`; PDF-Export als „Als PDF drucken"-Hinweis dokumentieren oder – falls nativ gewünscht – natives Speichern-Dialog (`plugin-dialog`, bereits vorhanden) mit PDF-Rendering über die Tauri-WebviewWindow-API prüfen.
4. Unit-Test für die Farb-Normalisierung im Export-Kontext (gemeinsam mit dem in Schritt 6.2 refaktorierten Modul).

### Schritt 6.2 – Refactoring-Hinweis
- Da `export-colors.ts` nun von NT-9 (Clipboard) und NT-12 (Print) genutzt wird: bestehenden Test aus Phase 1 (`clipboard-styles.test.ts`) mit umbenennen/anpassen statt duplizieren.

### Schritt 6.3 – Validierung
- `npm test`, `npm run build`
- Manuell: Drucken/„Als PDF sichern" im Dark Mode → Ausgabe hell und ohne Sidebars/Toolbar; Mermaid-Diagramme und Bilder werden korrekt mitgedruckt.

### Schritt 6.4 – Jira-Abschluss
- NT-12: Kommentar + Transition „Resolve" → Fertig.

---

## Phase 7 – iOS/iCloud (NT-11)

**Status:** 🔲 Nicht begonnen

### Schritt 7.0 – Jira
- NT-11: Transition „Start work" → In Arbeit. **Voraussetzung:** Phasen 1–6 sind „Fertig" und die volle Testsuite ist grün (Desktop-Basis muss stabil sein, bevor die mobile Erweiterung beginnt).

### Schritt 7.1 – Projekt-Scaffold
1. `npm run tauri ios init` ausführen → erzeugt `src-tauri/gen/apple`.
2. `tauri.conf.json` um iOS-spezifische Bundle-/Fenstereinstellungen ergänzen.
3. Neue Capability-Datei für das iOS-Fenstertarget in [src-tauri/capabilities/](../../src-tauri/capabilities/) anlegen.
4. Apple-Developer-Entitlement `com.apple.developer.icloud-container-identifiers` sowie `com.apple.developer.icloud-services` für Dokumentenfreigabe konfigurieren; Signing/Provisioning-Profile analog zur macOS-Signierung in [macos/mdview.CertificateSigningRequest.certSigningRequest](../../macos/mdview.CertificateSigningRequest.certSigningRequest) beantragen.

### Schritt 7.2 – Anpassung bestehender Features für Touch/kleine Screens
1. NT-7 (Resizable Sidebars): Touch-Drag-Handling in `src/sidebar-resize.ts` ergänzen; Fallback auf Overlay-Sidebars unterhalb einer Breakpoint-Schwelle.
2. NT-8/NT-10/NT-4: Klick-Interaktionen auf Touch-Tauglichkeit prüfen (z. B. Long-Press-Konflikte bei Bild-Popout).
3. Bestehende `@media`-Breakpoints aus Phase 3 um iOS-Bildschirmgrößen erweitern/prüfen.

### Schritt 7.3 – iCloud-Dokumentenfreigabe
1. Backend-Kommandos aus [lib.rs](../../src-tauri/src/lib.rs) (`open_markdown_file`, `scan_directory`, Watcher aus Phase 4) gegen den iOS-Dokumenten-Sandbox-Pfad statt beliebiger Dateisystempfade prüfen/anpassen.
2. „Open in mdview"-Dokumenten-Typ-Deklaration für iCloud-Drive-Freigabe ergänzen.

### Schritt 7.4 – Build-Pipeline
1. Neues Skript `scripts/build-ios.mjs` analog zu [scripts/build-macos.mjs](../../scripts/build-macos.mjs) inkl. zugehörigem Node-Test (`scripts/build-ios.node-test.mjs`).
2. `package.json`-Skript `build:ios` ergänzen.

### Schritt 7.5 – Validierung
- `npm test`, `npm run build`
- `cargo test`, `cargo clippy` (in `src-tauri`)
- iOS-Simulator-Smoke-Test: App startet, Datei aus iCloud Drive öffnen, Sidebar-Resize per Touch, Suche, Bild-Popout, Druck-Dialog.
- Signierter Test-Build auf physischem Gerät (TestFlight oder Ad-hoc) vor Abschluss.

### Schritt 7.6 – Jira-Abschluss
- NT-11: Kommentar + Transition „Resolve" → Fertig.

---

## Abschluss-Checkliste (nach Phase 7)

- [ ] Alle Subtasks NT-4 … NT-14 in Jira auf „Fertig".
- [ ] `npm test` grün (vitest + node-test).
- [ ] `npm run build` ohne Typfehler.
- [ ] `cargo test` und `cargo clippy` in `src-tauri` ohne neue Warnungen.
- [ ] README.md/THIRD_PARTY_LICENSES.md aktualisiert, falls neue Abhängigkeiten (opener-Plugin, `notify`-Crate, ggf. iOS-Build-Tools) hinzugekommen sind.
- [ ] NT-3 mit Abschlusskommentar versehen und auf „Fertig" transitioniert.
