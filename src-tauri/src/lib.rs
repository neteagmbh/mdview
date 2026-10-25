use notify::RecommendedWatcher;
use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime},
};
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager};
#[cfg(not(target_os = "ios"))]
use tauri_plugin_dialog::DialogExt;

mod document_routing;
mod documents;
mod incoming_documents;
mod pdf_printing;
#[cfg(target_os = "macos")]
mod printing;
mod watcher;

/// Maximum Markdown document size accepted by the viewer.
#[cfg(any(target_os = "ios", test))]
const MAX_FILE_SIZE: u64 = documents::MAX_MARKDOWN_SIZE;
/// Maximum number of recently viewed folders retained in persistent storage.
const MAX_RECENT_FOLDERS: usize = 10;
/// Maximum number of matches reported per file by the directory search.
const MAX_SEARCH_MATCHES_PER_FILE: usize = 50;
/// Maximum number of characters retained from a matching line for display.
const MAX_SEARCH_LINE_CHARS: usize = 200;
/// File extensions recognized as Markdown, without the leading dot.
#[cfg(test)]
const MARKDOWN_EXTENSIONS: &[&str] = documents::MARKDOWN_EXTENSIONS;
/// File name used for the persistent recent-folder list.
const RECENT_FOLDERS_FILE: &str = "recent-folders.json";
/// File name used for persisted window, sidebar, and active-document state.
const VIEW_STATE_FILE: &str = "view-state.json";
/// Files modified more recently than this are always eligible for the "new document" marker.
const NEW_FILE_WINDOW: Duration = Duration::from_secs(2 * 60 * 60);
/// Stable identifier for the native File → Open menu item.
const OPEN_FILE_MENU_ID: &str = "open_file";
/// Stable identifier for the native File → Open Directory menu item.
const OPEN_DIRECTORY_MENU_ID: &str = "open_directory";
/// Stable identifier for the native File → Print menu item.
const PRINT_MENU_ID: &str = "print";
/// Stable identifier for the native About menu item.
const ABOUT_MENU_ID: &str = "about_mdview";

/// A directory, Markdown file, or PDF displayed in the recent-folder tree.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MarkdownTreeNode {
    /// File-system display name.
    name: String,
    /// Absolute file-system path.
    path: PathBuf,
    /// Whether this node represents a directory.
    is_directory: bool,
    /// Whether this file was not yet present the last time this root was listed.
    is_new: bool,
    /// Whether this node is a pinned recent-folder root (always `false` for descendants).
    pinned: bool,
    /// Supported document descendants for a directory node.
    children: Vec<MarkdownTreeNode>,
}

/// A directory in the persisted recent-folder list, together with its pin state.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentFolderEntry {
    /// Absolute file-system path of the folder.
    path: PathBuf,
    /// Whether the folder is exempt from LRU eviction.
    #[serde(default)]
    pinned: bool,
}

/// Watcher for the current recent-folder roots, held for as long as the app runs.
#[derive(Default)]
struct WatcherState(Mutex<Option<RecommendedWatcher>>);

/// Session-fixed cutoff for the "new document" marker (see `new_file_threshold`).
struct NewFileThreshold(SystemTime);

/// Data returned to the frontend after opening a Markdown document.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenedDocument {
    /// UTF-8 Markdown source.
    content: String,
    /// Canonical path of the opened document.
    path: PathBuf,
    /// Refreshed recent-folder tree in most-recently-used order.
    recent_folders: Vec<MarkdownTreeNode>,
}

/// Physical size and position of the main application window.
#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
struct WindowGeometry {
    /// Inner window width in physical pixels.
    width: u32,
    /// Inner window height in physical pixels.
    height: u32,
    /// Outer window x-coordinate in physical pixels.
    x: i32,
    /// Outer window y-coordinate in physical pixels.
    y: i32,
}

/// Persisted application view state restored on the next launch.
#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
struct ViewState {
    /// Last known main-window geometry, if it has been observed.
    window: Option<WindowGeometry>,
    /// Width of the recent-folders sidebar in CSS pixels.
    sidebar_width: Option<f64>,
    /// Width of the document-outline sidebar in CSS pixels.
    outline_width: Option<f64>,
    /// Last successfully opened Markdown or PDF document.
    active_document: Option<PathBuf>,
    /// Optional PDF reading coordinates keyed by original source path, normalized by the frontend.
    pdf_positions: std::collections::BTreeMap<PathBuf, PdfPosition>,
}

/// Portable PDF reading coordinates; transient handles and passwords are never stored here.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfPosition {
    /// One-based page, clamped against the replacement document during restoration.
    page: u32,
    /// Relative vertical offset inside the rotated page.
    offset: f64,
    /// Relative horizontal offset inside the rotated page.
    left: f64,
    /// Explicit display scale when the mode is custom.
    scale: f64,
    /// Page-width, page-fit, or custom scale policy.
    mode: String,
    /// Clockwise rotation in quarter turns.
    rotation: u16,
}

/// A single matched line within a Markdown document, reported by directory search.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchMatch {
    /// One-based line number of the match.
    line: usize,
    /// One-based character column of the first character of the match on its line.
    column: usize,
    /// Display text of the matching line, truncated to `MAX_SEARCH_LINE_CHARS` characters.
    line_text: String,
}

/// All matches found in a single Markdown file by the directory search.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileSearchResult {
    /// File-system display name of the matched file.
    name: String,
    /// Absolute path of the matched file.
    path: PathBuf,
    /// Matches within the file, in document order.
    matches: Vec<SearchMatch>,
}

/// Returns whether a path has one of the supported Markdown extensions.
fn is_markdown(path: &Path) -> bool {
    documents::document_kind(path) == Some(documents::DocumentKind::Markdown)
}

/// Returns a human-readable final component for a file-system path.
fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map_or_else(|| path.display().to_string(), ToOwned::to_owned)
}

/// Recursively finds Markdown and PDF files below a directory.
///
/// Directory branches without supported document descendants and symbolic links are omitted. Files
/// modified after `new_file_threshold` are flagged as new documents.
fn scan_directory(
    path: &Path,
    new_file_threshold: SystemTime,
) -> io::Result<Vec<MarkdownTreeNode>> {
    let mut nodes = Vec::new();

    for entry in fs::read_dir(path)? {
        let Ok(entry) = entry else {
            continue;
        };
        let entry_path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            let children = scan_directory(&entry_path, new_file_threshold).unwrap_or_default();
            if !children.is_empty() {
                nodes.push(MarkdownTreeNode {
                    name: display_name(&entry_path),
                    path: entry_path,
                    is_directory: true,
                    is_new: false,
                    pinned: false,
                    children,
                });
            }
        } else if file_type.is_file() && documents::document_kind(&entry_path).is_some() {
            let is_new = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .is_ok_and(|modified| modified > new_file_threshold);
            nodes.push(MarkdownTreeNode {
                name: display_name(&entry_path),
                path: entry_path,
                is_directory: false,
                is_new,
                pinned: false,
                children: Vec::new(),
            });
        }
    }

    nodes.sort_by_cached_key(|node| (!node.is_directory, node.name.to_lowercase()));
    Ok(nodes)
}

/// Collects the absolute paths of all Markdown files within a recent-folder tree.
fn collect_markdown_files(nodes: &[MarkdownTreeNode], files: &mut Vec<PathBuf>) {
    for node in nodes {
        if node.is_directory {
            collect_markdown_files(&node.children, files);
        } else if is_markdown(&node.path) {
            files.push(node.path.clone());
        }
    }
}

/// Truncates a matching line to `MAX_SEARCH_LINE_CHARS` characters for display.
fn truncate_search_line(line: &str) -> String {
    if line.chars().count() > MAX_SEARCH_LINE_CHARS {
        line.chars().take(MAX_SEARCH_LINE_CHARS).collect()
    } else {
        line.to_owned()
    }
}

/// Finds all case-insensitive occurrences of `query` in `content`, grouped by line.
///
/// Returns at most `MAX_SEARCH_MATCHES_PER_FILE` matches. An empty or whitespace-only query
/// yields no matches. Columns are one-based character offsets on the matching line.
fn find_matches_in_content(content: &str, query: &str) -> Vec<SearchMatch> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Vec::new();
    }

    let mut matches = Vec::new();
    for (line_index, line) in content.lines().enumerate() {
        let haystack = line.to_lowercase();
        let mut search_start = 0;
        while let Some(offset) = haystack[search_start..].find(&needle) {
            let byte_position = search_start + offset;
            let column = haystack[..byte_position].chars().count() + 1;
            matches.push(SearchMatch {
                line: line_index + 1,
                column,
                line_text: truncate_search_line(line),
            });
            if matches.len() >= MAX_SEARCH_MATCHES_PER_FILE {
                return matches;
            }
            search_start = byte_position + needle.len();
            if search_start >= haystack.len() {
                break;
            }
        }
    }

    matches
}

/// Computes the cutoff before which files are not flagged as new documents.
///
/// A file counts as new when it was modified within the last two hours, or since the previous
/// session last saved the recent-folder list — whichever cutoff is more lenient (further in
/// the past), so the marker stays meaningful both right after a restart and during long sessions.
fn new_file_threshold(now: SystemTime, previous_session_save: Option<SystemTime>) -> SystemTime {
    let recency_cutoff = now.checked_sub(NEW_FILE_WINDOW).unwrap_or(now);
    match previous_session_save {
        Some(previous_session_save) => previous_session_save.min(recency_cutoff),
        None => recency_cutoff,
    }
}

/// Builds display trees for existing folders while preserving LRU order.
fn build_recent_tree(
    folders: &[RecentFolderEntry],
    new_file_threshold: SystemTime,
) -> Vec<MarkdownTreeNode> {
    folders
        .iter()
        .filter(|entry| entry.path.is_dir())
        .map(|entry| MarkdownTreeNode {
            name: display_name(&entry.path),
            path: entry.path.clone(),
            is_directory: true,
            is_new: false,
            pinned: entry.pinned,
            children: scan_directory(&entry.path, new_file_threshold).unwrap_or_default(),
        })
        .collect()
}

/// Moves a folder to the front of the recent-folder list, preserving its existing pin state.
///
/// Unpinned entries beyond `MAX_RECENT_FOLDERS` are evicted; pinned entries never are.
fn promote_folder(folders: &mut Vec<RecentFolderEntry>, folder: PathBuf) {
    let pinned = folders
        .iter()
        .find(|entry| entry.path == folder)
        .is_some_and(|entry| entry.pinned);
    folders.retain(|entry| entry.path != folder);
    folders.insert(
        0,
        RecentFolderEntry {
            path: folder,
            pinned,
        },
    );
    enforce_recent_folder_limit(folders);
}

/// Evicts the oldest unpinned entries once the list exceeds `MAX_RECENT_FOLDERS`.
fn enforce_recent_folder_limit(folders: &mut Vec<RecentFolderEntry>) {
    let mut unpinned_seen = 0usize;
    folders.retain(|entry| {
        if entry.pinned {
            return true;
        }
        unpinned_seen += 1;
        unpinned_seen <= MAX_RECENT_FOLDERS
    });
}

/// Promotes the existing LRU ancestor that covers a document folder.
///
/// The document's immediate folder is added only when no existing root already includes it.
fn promote_document_folder(folders: &mut Vec<RecentFolderEntry>, folder: PathBuf) {
    let promoted = folders
        .iter()
        .find(|entry| folder.starts_with(&entry.path))
        .map(|entry| entry.path.clone())
        .unwrap_or(folder);
    promote_folder(folders, promoted);
}

/// Removes a folder from the recent-folder list.
fn remove_folder(folders: &mut Vec<RecentFolderEntry>, folder: &Path) -> bool {
    let previous_len = folders.len();
    folders.retain(|entry| entry.path != folder);
    folders.len() != previous_len
}

/// Sets a folder's pin state, exempting or re-exposing it to LRU eviction.
fn set_folder_pinned(folders: &mut [RecentFolderEntry], folder: &Path, pinned: bool) -> bool {
    folders
        .iter_mut()
        .find(|entry| entry.path == folder)
        .map(|entry| entry.pinned = pinned)
        .is_some()
}

/// Validates and canonicalizes a directory path.
fn canonical_directory(path: &Path) -> Result<PathBuf, String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("Could not inspect directory: {error}"))?;
    if !metadata.is_dir() {
        return Err("The selected path is not a directory.".to_owned());
    }

    fs::canonicalize(path).map_err(|error| format!("Could not resolve directory path: {error}"))
}

/// Resolves the recent-folder data file inside Tauri's platform app-data directory.
fn recent_folders_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(RECENT_FOLDERS_FILE))
        .map_err(|error| format!("Could not locate application storage: {error}"))
}

/// Resolves the view-state file inside Tauri's platform app-data directory.
fn view_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join(VIEW_STATE_FILE))
        .map_err(|error| format!("Could not locate application storage: {error}"))
}

/// Reads view state from a path, returning defaults on first launch or malformed data.
fn load_view_state_from_path(path: &Path) -> Result<ViewState, String> {
    match fs::read_to_string(path) {
        Ok(json) => Ok(serde_json::from_str(&json).unwrap_or_default()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(ViewState::default()),
        Err(error) => Err(format!("Could not read view state: {error}")),
    }
}

/// Persists view state at a path, creating its parent directory when necessary.
fn save_view_state_to_path(path: &Path, state: &ViewState) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "View-state path has no parent directory.".to_owned())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create application storage: {error}"))?;
    let json = serde_json::to_string_pretty(state)
        .map_err(|error| format!("Could not encode view state: {error}"))?;
    fs::write(path, json).map_err(|error| format!("Could not save view state: {error}"))
}

/// Returns persisted window, sidebar, and active-document state to the frontend.
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
fn load_view_state(app: AppHandle) -> Result<ViewState, String> {
    load_view_state_from_path(&view_state_path(&app)?)
}

/// Replaces the persisted window, sidebar, and active-document state.
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
fn save_view_state(app: AppHandle, state: ViewState) -> Result<(), String> {
    save_view_state_to_path(&view_state_path(&app)?, &state)
}

/// Loads the persistent recent-folder list, returning an empty list on first launch.
fn load_recent_folders(app: &AppHandle) -> Result<Vec<RecentFolderEntry>, String> {
    let path = recent_folders_path(app)?;
    match fs::read_to_string(path) {
        Ok(json) => Ok(parse_recent_folders(&json)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(format!("Could not read recent folders: {error}")),
    }
}

/// Parses the persisted recent-folder list, tolerating the legacy plain-path-array format,
/// entries with a missing or malformed `pinned` field, and other unrecognized entries.
///
/// If the file cannot be interpreted as a list of paths at all (e.g. corrupted or from an
/// unrelated schema), the recent-folder list starts over empty rather than blocking the
/// application; saving again afterwards republishes the current schema to disk.
fn parse_recent_folders(json: &str) -> Vec<RecentFolderEntry> {
    let Ok(raw_entries) = serde_json::from_str::<Vec<serde_json::Value>>(json) else {
        return Vec::new();
    };

    raw_entries
        .into_iter()
        .filter_map(|value| match value {
            serde_json::Value::String(path) => Some(RecentFolderEntry {
                path: PathBuf::from(path),
                pinned: false,
            }),
            serde_json::Value::Object(fields) => {
                let path = fields.get("path")?.as_str()?;
                let pinned = fields
                    .get("pinned")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false);
                Some(RecentFolderEntry {
                    path: PathBuf::from(path),
                    pinned,
                })
            }
            _ => None,
        })
        .collect()
}

/// Persists the recent-folder list in Tauri's platform app-data directory.
fn save_recent_folders(app: &AppHandle, folders: &[RecentFolderEntry]) -> Result<(), String> {
    let path = recent_folders_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "Application storage path has no parent directory.".to_owned())?;

    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create application storage: {error}"))?;
    let json = serde_json::to_string_pretty(folders)
        .map_err(|error| format!("Could not encode recent folders: {error}"))?;
    fs::write(path, json).map_err(|error| format!("Could not save recent folders: {error}"))
}

/// Replaces the live filesystem watcher with one covering the current recent-folder roots.
fn restart_watcher(app: &AppHandle, folders: &[RecentFolderEntry]) {
    let roots: Vec<PathBuf> = folders.iter().map(|entry| entry.path.clone()).collect();
    let watcher_state = app.state::<WatcherState>();
    if let Ok(mut guard) = watcher_state.0.lock() {
        *guard = watcher::spawn_watcher(app.clone(), &roots);
    }
}

/// Computes the session's "new document" cutoff from the recent-folder file's previous save time.
fn compute_new_file_threshold(app: &AppHandle) -> SystemTime {
    let previous_session_save = recent_folders_path(app)
        .ok()
        .and_then(|path| fs::metadata(path).ok())
        .and_then(|metadata| metadata.modified().ok());
    new_file_threshold(SystemTime::now(), previous_session_save)
}

/// Builds the recent-folder tree using the app's session-fixed new-file cutoff.
fn build_recent_tree_with_threshold(
    app: &AppHandle,
    folders: &[RecentFolderEntry],
) -> Vec<MarkdownTreeNode> {
    build_recent_tree(folders, app.state::<NewFileThreshold>().0)
}

/// Returns the current recent-folder tree to the frontend.
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
fn recent_markdown_tree(app: AppHandle) -> Result<Vec<MarkdownTreeNode>, String> {
    let folders = load_recent_folders(&app)?;
    Ok(build_recent_tree_with_threshold(&app, &folders))
}

/// Adds or promotes a directory in the persistent recent-folder list.
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
async fn add_recent_folder(app: AppHandle, path: String) -> Result<Vec<MarkdownTreeNode>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let folder = canonical_directory(Path::new(&path))?;
        let mut folders = load_recent_folders(&app)?;
        promote_folder(&mut folders, folder);
        save_recent_folders(&app, &folders)?;
        restart_watcher(&app, &folders);
        Ok(build_recent_tree_with_threshold(&app, &folders))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Removes a directory from the persistent recent-folder list.
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
fn remove_recent_folder(app: AppHandle, path: String) -> Result<Vec<MarkdownTreeNode>, String> {
    let mut folders = load_recent_folders(&app)?;
    remove_folder(&mut folders, Path::new(&path));
    save_recent_folders(&app, &folders)?;
    restart_watcher(&app, &folders);
    Ok(build_recent_tree_with_threshold(&app, &folders))
}

/// Pins or unpins a directory in the persistent recent-folder list.
///
/// Pinned folders are exempt from the `MAX_RECENT_FOLDERS` LRU eviction.
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
fn set_recent_folder_pinned(
    app: AppHandle,
    path: String,
    pinned: bool,
) -> Result<Vec<MarkdownTreeNode>, String> {
    let folder = canonical_directory(Path::new(&path))?;
    let mut folders = load_recent_folders(&app)?;
    set_folder_pinned(&mut folders, &folder, pinned);
    save_recent_folders(&app, &folders)?;
    Ok(build_recent_tree_with_threshold(&app, &folders))
}

/// Opens the platform document or folder picker without blocking the UI thread.
#[tauri::command]
async fn pick_document(app: AppHandle, directory: bool) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "ios")]
        {
            app.state::<tauri_plugin_documents::Documents<tauri::Wry>>()
                .pick(directory)
                .map(|selection| selection.path)
        }
        #[cfg(not(target_os = "ios"))]
        {
            let picker = app.dialog().file();
            let selected = if directory {
                picker.blocking_pick_folder()
            } else {
                picker
                    .add_filter(
                        "Markdown and PDF",
                        &["md", "markdown", "mdown", "mkd", "mkdn", "pdf"],
                    )
                    .blocking_pick_file()
            };
            let selected = selected
                .map(|path| {
                    path.into_path()
                        .map(|path| path.to_string_lossy().into_owned())
                        .map_err(|error| error.to_string())
                })
                .transpose()?;
            if !directory && let Some(path) = &selected {
                app.state::<documents::PdfDocuments>()
                    .grant_file(Path::new(path))?;
            }
            Ok(selected)
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Reads a bounded Markdown document from a local filesystem.
#[cfg(not(target_os = "ios"))]
fn read_local_document(path: &Path) -> Result<(PathBuf, String), String> {
    documents::read_markdown(path)
}

/// Validates the extension and delegates cloud-provider reads to iOS file coordination.
fn read_document(app: &AppHandle, path: &Path) -> Result<(PathBuf, String), String> {
    if !is_markdown(path) {
        return Err("Choose a file with a Markdown extension.".to_owned());
    }
    #[cfg(target_os = "ios")]
    {
        let document = app
            .state::<tauri_plugin_documents::Documents<tauri::Wry>>()
            .read(&path.to_string_lossy(), MAX_FILE_SIZE)?;
        Ok((PathBuf::from(document.path), document.content))
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        read_local_document(path)
    }
}

/// Validates and opens a Markdown file without blocking the picker or cloud download.
#[tauri::command]
async fn open_markdown_file(app: AppHandle, path: String) -> Result<OpenedDocument, String> {
    tauri::async_runtime::spawn_blocking(move || open_document(&app, Path::new(&path)))
        .await
        .map_err(|error| error.to_string())?
}

/// Promotes an authorized folder and refreshes the tree after a successful read.
fn open_document(app: &AppHandle, path: &Path) -> Result<OpenedDocument, String> {
    let (canonical_path, content) = read_document(app, path)?;
    let folder = canonical_path
        .parent()
        .ok_or_else(|| "The selected file has no parent folder.".to_owned())?
        .to_path_buf();

    app.asset_protocol_scope()
        .allow_directory(&folder, true)
        .map_err(|error| format!("Could not allow document images: {error}"))?;

    Ok(OpenedDocument {
        content,
        recent_folders: promote_opened_folder(app, &canonical_path)?,
        path: canonical_path,
    })
}

/// Promotes a source folder only when the platform grant authorizes browsing it.
fn promote_opened_folder(app: &AppHandle, path: &Path) -> Result<Vec<MarkdownTreeNode>, String> {
    let folder = path
        .parent()
        .ok_or("The selected file has no parent folder.")?
        .to_path_buf();
    let mut folders = load_recent_folders(app)?;
    // A file-only iOS grant does not authorize scanning its parent directory.
    if !cfg!(target_os = "ios") || folders.iter().any(|entry| folder.starts_with(&entry.path)) {
        promote_document_folder(&mut folders, folder);
        save_recent_folders(app, &folders)?;
        restart_watcher(app, &folders);
    }

    Ok(build_recent_tree_with_threshold(app, &folders))
}

/// Re-reads a Markdown file's content without touching the recent-folder LRU or watcher.
///
/// Used to auto-reload the currently open document after an external change, which should not
/// re-promote its folder or restart the watcher on every edit.
#[tauri::command]
async fn read_markdown_file(app: AppHandle, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_document(&app, Path::new(&path)).map(|(_, content)| content)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Opens the native webview print dialog where Tauri supports it.
///
/// macOS uses `AppKit` and iOS presents AirPrint. Other platforms return `false`
/// so the frontend can retain `window.print()` as its cross-platform fallback.
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
async fn print_document(webview: tauri::Webview) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        printing::open_print_dialog(&webview)?;
        Ok(true)
    }

    #[cfg(target_os = "ios")]
    {
        // Wait for UIKit's completion callback without blocking the UI or async executor.
        tauri::async_runtime::spawn_blocking(move || {
            webview
                .state::<tauri_plugin_documents::Documents<tauri::Wry>>()
                .print()?;
            Ok(true)
        })
        .await
        .map_err(|error| format!("Could not complete native printing: {error}"))?
    }

    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = webview;
        Ok(false)
    }
}

/// Searches Markdown files below one or all recent-folder roots for a query string.
///
/// When `root` is `Some`, only that directory is searched; when `None`, every persisted
/// recent folder is searched. Files are read on demand without caching, so results always
/// reflect the current on-disk content. Files that cannot be read as UTF-8 are skipped.
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
async fn search_markdown_files(
    app: AppHandle,
    query: String,
    root: Option<String>,
) -> Result<Vec<FileSearchResult>, String> {
    tauri::async_runtime::spawn_blocking(move || search_documents(&app, &query, root))
        .await
        .map_err(|error| error.to_string())?
}

/// Searches authorized roots on a worker thread, coordinating cloud reads on iOS.
fn search_documents(
    app: &AppHandle,
    query: &str,
    root: Option<String>,
) -> Result<Vec<FileSearchResult>, String> {
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let roots = match root {
        Some(root) => vec![canonical_directory(Path::new(&root))?],
        None => load_recent_folders(app)?
            .into_iter()
            .map(|entry| entry.path)
            .collect(),
    };

    let threshold = app.state::<NewFileThreshold>().0;
    let mut files = Vec::new();
    for root in &roots {
        let nodes = scan_directory(root, threshold).unwrap_or_default();
        collect_markdown_files(&nodes, &mut files);
    }
    files.sort();
    files.dedup();

    let mut results = Vec::new();
    for file in files {
        let Ok((_, content)) = read_document(app, &file) else {
            continue;
        };
        let matches = find_matches_in_content(&content, query);
        if !matches.is_empty() {
            results.push(FileSearchResult {
                name: display_name(&file),
                path: file,
                matches,
            });
        }
    }

    Ok(results)
}

/// Returns whether a native menu event should open the file picker.
fn is_open_file_menu_event(id: &str) -> bool {
    id == OPEN_FILE_MENU_ID
}

/// Returns whether a native menu event should open the directory picker.
fn is_open_directory_menu_event(id: &str) -> bool {
    id == OPEN_DIRECTORY_MENU_ID
}

/// Returns whether a native menu event should open the system print dialog.
fn is_print_menu_event(id: &str) -> bool {
    id == PRINT_MENU_ID
}

/// Returns whether a native menu event should open the About dialog.
fn is_about_menu_event(id: &str) -> bool {
    id == ABOUT_MENU_ID
}

/// Emits the frontend event associated with a native application menu item.
fn emit_menu_event(app: &AppHandle, id: &str) {
    if is_open_file_menu_event(id) {
        let _ = app.emit("menu-open-file", ());
    } else if is_open_directory_menu_event(id) {
        let _ = app.emit("menu-open-directory", ());
    } else if is_print_menu_event(id) {
        let _ = app.emit("menu-print", ());
    } else if is_about_menu_event(id) {
        let _ = app.emit("menu-about", ());
    }
}

/// Builds and runs the Tauri application.
///
/// # Panics
///
/// Panics if Tauri cannot initialize or encounters a fatal runtime error.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder =
        tauri::Builder::default().manage(incoming_documents::IncomingDocuments::default());
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        incoming_documents::enqueue(
            app,
            incoming_documents::argument_urls(
                args.into_iter().map(std::ffi::OsString::from),
                Path::new(&cwd),
            ),
        );
        incoming_documents::focus_window(app);
    }));
    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(tauri_plugin_documents::init());
    let builder = builder
        .manage(WatcherState::default())
        .setup(|app| {
            app.manage(
                documents::PdfDocuments::new(&app.path().app_cache_dir()?.join("pdf-documents"))
                    .map_err(io::Error::other)?,
            );
            initialize_document_state(app);
            #[cfg(desktop)]
            if let Ok(cwd) = std::env::current_dir() {
                incoming_documents::enqueue(
                    app.handle(),
                    incoming_documents::argument_urls(std::env::args_os(), &cwd),
                );
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(not(target_os = "ios"))]
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                for path in paths
                    .iter()
                    .filter(|path| documents::document_kind(path).is_some())
                {
                    if let Err(error) = window.state::<documents::PdfDocuments>().grant_file(path) {
                        eprintln!("Could not authorize dropped document: {error}");
                    }
                }
            }
            #[cfg(target_os = "ios")]
            let _ = (window, event);
        });
    #[cfg(desktop)]
    let builder = builder
        .menu(|app| {
            let menu = Menu::default(app)?;
            let open =
                MenuItem::with_id(app, OPEN_FILE_MENU_ID, "Open…", true, Some("CmdOrCtrl+O"))?;
            let open_directory = MenuItem::with_id(
                app,
                OPEN_DIRECTORY_MENU_ID,
                "Open Directory…",
                true,
                Some("CmdOrCtrl+Shift+O"),
            )?;
            let print = MenuItem::with_id(app, PRINT_MENU_ID, "Print…", true, Some("CmdOrCtrl+P"))?;
            let about = MenuItem::with_id(app, ABOUT_MENU_ID, "About mdview", true, None::<&str>)?;
            let file = Submenu::with_items(
                app,
                "File",
                true,
                &[
                    &open,
                    &open_directory,
                    &PredefinedMenuItem::separator(app)?,
                    &print,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::close_window(app, None)?,
                    #[cfg(not(target_os = "macos"))]
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?;
            #[cfg(not(target_os = "macos"))]
            let help = Submenu::with_id_and_items(
                app,
                tauri::menu::HELP_SUBMENU_ID,
                "Help",
                true,
                &[&about],
            )?;

            #[cfg(target_os = "macos")]
            {
                menu.remove_at(1)?;
                menu.insert(&file, 1)?;
                let menu_items = menu.items()?;
                if let Some(tauri::menu::MenuItemKind::Submenu(application_menu)) =
                    menu_items.first()
                {
                    application_menu.remove_at(0)?;
                    application_menu.prepend(&about)?;
                }
            }
            #[cfg(target_os = "windows")]
            {
                menu.remove_at(0)?;
                menu.insert(&file, 0)?;
            }
            #[cfg(any(
                target_os = "linux",
                target_os = "dragonfly",
                target_os = "freebsd",
                target_os = "netbsd",
                target_os = "openbsd"
            ))]
            menu.prepend(&file)?;

            #[cfg(not(target_os = "macos"))]
            {
                if let Some(default_help) = menu.get(tauri::menu::HELP_SUBMENU_ID) {
                    menu.remove(&default_help)?;
                }
                menu.append(&help)?;
            }

            Ok(menu)
        })
        .on_menu_event(|app, event| emit_menu_event(app, event.id().as_ref()));
    builder
        .invoke_handler(tauri::generate_handler![
            add_recent_folder,
            documents::prepare_pdf_document,
            documents::cancel_pdf_preparation,
            documents::read_pdf_bytes,
            documents::retain_pdf_document,
            documents::release_pdf_document,
            document_routing::open_document_file,
            document_routing::reload_document_file,
            incoming_documents::take_incoming_documents,
            incoming_documents::open_incoming_document,
            load_view_state,
            open_markdown_file,
            pick_document,
            print_document,
            pdf_printing::print_pdf_document,
            pdf_printing::print_pdf_pages,
            read_markdown_file,
            recent_markdown_tree,
            remove_recent_folder,
            save_view_state,
            search_markdown_files,
            set_recent_folder_pinned
        ])
        .build(tauri::generate_context!())
        .expect("error while building mdview")
        .run(|app, event| {
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = event {
                incoming_documents::enqueue(app, urls.into_iter().map(|url| url.to_string()));
            }
            #[cfg(not(any(target_os = "macos", target_os = "ios")))]
            let _ = (app, event);
        });
}

/// Restores folder watchers and the new-document cutoff after native plugins initialize.
fn initialize_document_state(app: &mut tauri::App) {
    let handle = app.handle().clone();
    #[cfg(not(target_os = "ios"))]
    if let Ok(storage) = view_state_path(&handle)
        && let Ok(state) = load_view_state_from_path(&storage)
        && let Some(path) = state.active_document
        && documents::document_kind(&path) == Some(documents::DocumentKind::Pdf)
    {
        let _ = handle.state::<documents::PdfDocuments>().grant_file(&path);
    }
    app.manage(NewFileThreshold(compute_new_file_threshold(&handle)));
    if let Ok(folders) = load_recent_folders(&handle) {
        restart_watcher(&handle, &folders);
    }
}

#[cfg(test)]
mod tests {
    //! Unit tests for Markdown discovery, LRU ordering, and native menu routing.

    /// PDF-only branches survive discovery while folder text search remains Markdown-only.
    #[test]
    fn discovers_mixed_and_pdf_only_folders_without_searching_pdf_bytes() {
        let root = tempfile::tempdir().unwrap();
        let pdf_folder = root.path().join("PDF only");
        std::fs::create_dir(&pdf_folder).unwrap();
        std::fs::write(pdf_folder.join("Über # 100%.PDF"), b"%PDF-1.7\n").unwrap();
        std::fs::write(root.path().join("z.md"), "# Markdown").unwrap();
        std::fs::write(root.path().join("a.pdf"), b"%PDF-1.7\n").unwrap();
        std::fs::write(root.path().join("ignored.txt"), "ignored").unwrap();
        let nodes = super::scan_directory(root.path(), std::time::UNIX_EPOCH).unwrap();
        assert_eq!(
            nodes
                .iter()
                .map(|node| node.name.as_str())
                .collect::<Vec<_>>(),
            ["PDF only", "a.pdf", "z.md"]
        );
        assert!(nodes[0].children[0].is_new);
        let mut files = Vec::new();
        super::collect_markdown_files(&nodes, &mut files);
        assert_eq!(files, [root.path().join("z.md")]);
    }

    /// Verifies filesystem paths containing spaces and Unicode are preserved.
    #[cfg(not(target_os = "ios"))]
    #[test]
    fn local_document_preserves_decoded_paths_and_utf8() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("Über iCloud notes.md");
        std::fs::write(&path, "# Grüße\n").unwrap();
        let (resolved, content) = super::read_local_document(&path).unwrap();
        assert_eq!(resolved, std::fs::canonicalize(path).unwrap());
        assert_eq!(content, "# Grüße\n");
    }

    /// Verifies directories, oversized files, and invalid UTF-8 are rejected.
    #[cfg(not(target_os = "ios"))]
    #[test]
    fn local_document_rejects_unreadable_inputs() {
        let directory = tempfile::tempdir().unwrap();
        assert!(
            super::read_local_document(directory.path())
                .unwrap_err()
                .contains("not a file")
        );
        let path = directory.path().join("invalid.md");
        std::fs::write(&path, [0xff]).unwrap();
        assert!(
            super::read_local_document(&path)
                .unwrap_err()
                .contains("UTF-8")
        );
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(super::MAX_FILE_SIZE + 1).unwrap();
        assert!(
            super::read_local_document(&path)
                .unwrap_err()
                .contains("16 MiB")
        );
    }

    use super::{
        MAX_RECENT_FOLDERS, MAX_SEARCH_MATCHES_PER_FILE, MarkdownTreeNode, RecentFolderEntry,
        ViewState, WindowGeometry, canonical_directory, collect_markdown_files,
        find_matches_in_content, is_about_menu_event, is_markdown, is_open_directory_menu_event,
        is_open_file_menu_event, is_print_menu_event, load_view_state_from_path,
        new_file_threshold, parse_recent_folders, promote_document_folder, promote_folder,
        remove_folder, save_view_state_to_path, scan_directory, set_folder_pinned,
    };
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{Duration, SystemTime},
    };

    /// Builds an unpinned recent-folder entry for a test path.
    fn entry(path: &str) -> RecentFolderEntry {
        RecentFolderEntry {
            path: PathBuf::from(path),
            pinned: false,
        }
    }

    /// Builds a pinned recent-folder entry for a test path.
    fn pinned_entry(path: &str) -> RecentFolderEntry {
        RecentFolderEntry {
            path: PathBuf::from(path),
            pinned: true,
        }
    }

    /// Supported extensions are matched without case sensitivity.
    #[test]
    fn recognizes_supported_extensions_case_insensitively() {
        assert!(is_markdown(Path::new("README.md")));
        assert!(is_markdown(Path::new("NOTES.MARKDOWN")));
        assert!(!is_markdown(Path::new("notes.txt")));
        assert!(!is_markdown(Path::new("README")));
    }

    /// Promoting folders maintains uniqueness, order, and the configured size bound.
    #[test]
    fn recent_folders_are_unique_and_most_recent_first() {
        let mut folders: Vec<RecentFolderEntry> = (0..MAX_RECENT_FOLDERS)
            .map(|index| entry(&format!("folder-{index}")))
            .collect();

        promote_folder(&mut folders, PathBuf::from("folder-4"));
        assert_eq!(
            folders.first().map(|entry| &entry.path),
            Some(&PathBuf::from("folder-4"))
        );
        assert_eq!(folders.len(), MAX_RECENT_FOLDERS);
        assert_eq!(
            folders
                .iter()
                .filter(|entry| entry.path == Path::new("folder-4"))
                .count(),
            1
        );

        promote_folder(&mut folders, PathBuf::from("new-folder"));
        assert_eq!(
            folders.first().map(|entry| &entry.path),
            Some(&PathBuf::from("new-folder"))
        );
        assert_eq!(folders.len(), MAX_RECENT_FOLDERS);
    }

    /// Pinned folders survive eviction even once the unpinned entries exceed the size bound.
    #[test]
    fn pinned_folders_are_exempt_from_eviction() {
        let mut folders = vec![pinned_entry("pinned-a"), pinned_entry("pinned-b")];
        folders.extend((0..MAX_RECENT_FOLDERS).map(|index| entry(&format!("folder-{index}"))));

        promote_folder(&mut folders, PathBuf::from("one-more"));

        assert!(
            folders
                .iter()
                .any(|entry| entry.path == Path::new("pinned-a"))
        );
        assert!(
            folders
                .iter()
                .any(|entry| entry.path == Path::new("pinned-b"))
        );
        assert_eq!(
            folders.iter().filter(|entry| !entry.pinned).count(),
            MAX_RECENT_FOLDERS
        );
    }

    /// Re-promoting an existing folder preserves its pin state instead of resetting it.
    #[test]
    fn promoting_an_existing_folder_preserves_its_pin_state() {
        let mut folders = vec![pinned_entry("docs"), entry("other")];

        promote_folder(&mut folders, PathBuf::from("docs"));

        assert!(folders[0].pinned);
    }

    /// Pinning and unpinning updates only the matching entry.
    #[test]
    fn set_folder_pinned_updates_only_the_matching_entry() {
        let mut folders = vec![entry("one"), entry("two")];

        assert!(set_folder_pinned(&mut folders, Path::new("one"), true));
        assert!(folders[0].pinned);
        assert!(!folders[1].pinned);
        assert!(!set_folder_pinned(&mut folders, Path::new("missing"), true));
    }

    /// The legacy plain-path-array format migrates to unpinned entries.
    #[test]
    fn parses_legacy_plain_path_array_as_unpinned_entries() {
        let entries = parse_recent_folders(r#"["/docs", "/notes"]"#);

        assert_eq!(entries, vec![entry("/docs"), entry("/notes")]);
    }

    /// The current entry-object format round-trips, including the pin state.
    #[test]
    fn parses_current_entry_format_with_pin_state() {
        let entries = parse_recent_folders(r#"[{"path":"/docs","pinned":true}]"#);

        assert_eq!(entries, vec![pinned_entry("/docs")]);
    }

    /// A missing or malformed `pinned` field defaults to unpinned instead of failing the entry.
    #[test]
    fn parses_entries_with_missing_or_null_pinned_field_as_unpinned() {
        let entries = parse_recent_folders(r#"[{"path":"/docs"},{"path":"/notes","pinned":null}]"#);

        assert_eq!(entries, vec![entry("/docs"), entry("/notes")]);
    }

    /// Entries without a usable `path` are skipped instead of failing the whole list.
    #[test]
    fn skips_individually_malformed_entries() {
        let entries = parse_recent_folders(r#"[{"pinned":true},{"path":"/docs"},42]"#);

        assert_eq!(entries, vec![entry("/docs")]);
    }

    /// An unrecognized top-level shape resets to an empty list instead of failing.
    #[test]
    fn resets_to_an_empty_list_for_an_unrecognized_shape() {
        assert_eq!(parse_recent_folders(r#"{"not":"a list"}"#), Vec::new());
        assert_eq!(parse_recent_folders("not json at all"), Vec::new());
    }

    /// Files absent from the baseline are marked new, and the resulting `seen` set is exhaustive.
    #[test]
    fn new_file_threshold_prefers_the_more_lenient_bound() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        let two_hours_ago = now - Duration::from_secs(2 * 60 * 60);

        // No previous session: falls back to the two-hour recency window.
        assert_eq!(new_file_threshold(now, None), two_hours_ago);

        // A previous save from last week is the more lenient (older) bound.
        let last_week = now - Duration::from_secs(7 * 24 * 60 * 60);
        assert_eq!(new_file_threshold(now, Some(last_week)), last_week);

        // A previous save from ten minutes ago is stricter than two hours, so it is ignored.
        let ten_minutes_ago = now - Duration::from_secs(600);
        assert_eq!(
            new_file_threshold(now, Some(ten_minutes_ago)),
            two_hours_ago
        );
    }

    /// Files modified after the threshold are flagged new; files modified before it are not.
    #[test]
    fn scan_directory_flags_files_modified_after_the_threshold()
    -> Result<(), Box<dyn std::error::Error>> {
        let temporary = tempfile::tempdir()?;
        fs::write(temporary.path().join("README.md"), "# Read me")?;

        let recent_nodes = scan_directory(
            temporary.path(),
            SystemTime::now() - Duration::from_secs(3600),
        )?;
        assert!(recent_nodes[0].is_new);

        let future_nodes = scan_directory(
            temporary.path(),
            SystemTime::now() + Duration::from_secs(3600),
        )?;
        assert!(!future_nodes[0].is_new);
        Ok(())
    }

    /// Opening a document below an existing root promotes that root without adding its parent.
    #[test]
    fn document_below_recent_root_does_not_add_nested_folder() {
        let root = PathBuf::from("docs");
        let mut folders = vec![entry("other"), entry("docs")];

        promote_document_folder(&mut folders, root.join("guides/reference"));

        assert_eq!(
            folders
                .into_iter()
                .map(|entry| entry.path)
                .collect::<Vec<_>>(),
            vec![root, PathBuf::from("other")]
        );
    }

    /// Path coverage compares complete components rather than similarly prefixed names.
    #[test]
    fn similarly_prefixed_folder_is_not_treated_as_covered() {
        let mut folders = vec![entry("docs")];
        let separate = PathBuf::from("docs-archive/guides");

        promote_document_folder(&mut folders, separate.clone());

        assert_eq!(
            folders
                .into_iter()
                .map(|entry| entry.path)
                .collect::<Vec<_>>(),
            vec![separate, PathBuf::from("docs")]
        );
    }

    /// Recursive discovery includes Markdown files and prunes unrelated branches.
    #[test]
    fn discovers_markdown_files_recursively() -> Result<(), Box<dyn std::error::Error>> {
        let temporary = tempfile::tempdir()?;
        let nested = temporary.path().join("guides");
        let unrelated = temporary.path().join("images");
        fs::create_dir_all(&nested)?;
        fs::create_dir_all(&unrelated)?;
        fs::write(temporary.path().join("README.md"), "# Read me")?;
        fs::write(temporary.path().join("notes.txt"), "not Markdown")?;
        fs::write(nested.join("install.MARKDOWN"), "# Install")?;
        fs::write(unrelated.join("logo.txt"), "not Markdown")?;

        let nodes = scan_directory(temporary.path(), SystemTime::UNIX_EPOCH)?;

        assert_eq!(nodes.len(), 2);
        assert!(nodes.iter().any(|node| node.name == "README.md"));
        let guides = nodes
            .iter()
            .find(|node| node.name == "guides")
            .ok_or("missing guides directory")?;
        assert_eq!(guides.children.len(), 1);
        assert_eq!(guides.children[0].name, "install.MARKDOWN");
        assert!(!nodes.iter().any(|node| node.name == "images"));
        Ok(())
    }

    /// Only the File → Open menu identifier routes to the picker event.
    #[test]
    fn recognizes_open_file_menu_event() {
        assert!(is_open_file_menu_event("open_file"));
        assert!(!is_open_file_menu_event("close"));
    }

    /// Only the Open Directory menu identifier routes to the directory picker event.
    #[test]
    fn recognizes_open_directory_menu_event() {
        assert!(is_open_directory_menu_event("open_directory"));
        assert!(!is_open_directory_menu_event("open_file"));
    }

    /// Only the Print menu identifier routes to the browser print dialog event.
    #[test]
    fn recognizes_print_menu_event() {
        assert!(is_print_menu_event("print"));
        assert!(!is_print_menu_event("open_file"));
    }

    /// Only the About menu identifier routes to the in-application dialog.
    #[test]
    fn recognizes_about_menu_event() {
        assert!(is_about_menu_event("about_mdview"));
        assert!(!is_about_menu_event("open_file"));
    }

    /// Removing a folder affects only the matching recent entry.
    #[test]
    fn removes_matching_recent_folder() {
        let mut folders = vec![entry("one"), entry("two")];

        assert!(remove_folder(&mut folders, Path::new("one")));
        assert_eq!(
            folders
                .into_iter()
                .map(|entry| entry.path)
                .collect::<Vec<_>>(),
            vec![PathBuf::from("two")]
        );
        let mut remaining = vec![entry("two")];
        assert!(!remove_folder(&mut remaining, Path::new("missing")));
    }

    /// Directory validation accepts directories and rejects regular files.
    #[test]
    fn validates_selected_directory() -> Result<(), Box<dyn std::error::Error>> {
        let temporary = tempfile::tempdir()?;
        let file = temporary.path().join("README.md");
        fs::write(&file, "# Test")?;

        assert_eq!(
            canonical_directory(temporary.path())?,
            fs::canonicalize(temporary.path())?
        );
        assert!(canonical_directory(&file).is_err());
        Ok(())
    }

    /// Persisted view state round-trips all geometry, sidebar, and document fields.
    #[test]
    fn view_state_round_trips_through_json_file() -> Result<(), Box<dyn std::error::Error>> {
        let temporary = tempfile::tempdir()?;
        let path = temporary.path().join("nested/view-state.json");
        let state = ViewState {
            window: Some(WindowGeometry {
                width: 1280,
                height: 800,
                x: 120,
                y: 80,
            }),
            sidebar_width: Some(310.5),
            outline_width: Some(260.0),
            active_document: Some(PathBuf::from("/docs/README.md")),
            pdf_positions: std::collections::BTreeMap::from([(
                PathBuf::from("/docs/original.pdf"),
                super::PdfPosition {
                    page: 7,
                    offset: 0.4,
                    left: 0.2,
                    scale: 1.25,
                    mode: "custom".into(),
                    rotation: 90,
                },
            )]),
        };

        save_view_state_to_path(&path, &state)?;

        assert_eq!(load_view_state_from_path(&path)?, state);
        Ok(())
    }

    /// Missing and malformed view-state files fall back to a clean default state.
    #[test]
    fn view_state_defaults_when_missing_or_malformed() -> Result<(), Box<dyn std::error::Error>> {
        let temporary = tempfile::tempdir()?;
        let path = temporary.path().join("view-state.json");

        assert_eq!(load_view_state_from_path(&path)?, ViewState::default());
        fs::write(&path, "not json")?;
        assert_eq!(load_view_state_from_path(&path)?, ViewState::default());
        Ok(())
    }

    /// Older Markdown sessions deserialize without requiring PDF reading coordinates.
    #[test]
    fn view_state_accepts_legacy_markdown_sessions() -> Result<(), Box<dyn std::error::Error>> {
        let state: ViewState = serde_json::from_str(r#"{"activeDocument":"/docs/old.md"}"#)?;
        assert_eq!(state.active_document, Some(PathBuf::from("/docs/old.md")));
        assert!(state.pdf_positions.is_empty());
        Ok(())
    }

    /// Builds a Markdown file tree node for the search-collection tests.
    fn file_node(path: &str) -> MarkdownTreeNode {
        MarkdownTreeNode {
            name: super::display_name(Path::new(path)),
            path: PathBuf::from(path),
            is_directory: false,
            is_new: false,
            pinned: false,
            children: Vec::new(),
        }
    }

    /// Flattening a tree yields every Markdown file across nested directories in order.
    #[test]
    fn collects_markdown_files_across_nested_directories() {
        let tree = vec![
            file_node("/docs/README.md"),
            MarkdownTreeNode {
                name: "guides".to_owned(),
                path: PathBuf::from("/docs/guides"),
                is_directory: true,
                is_new: false,
                pinned: false,
                children: vec![file_node("/docs/guides/install.md")],
            },
        ];

        let mut files = Vec::new();
        collect_markdown_files(&tree, &mut files);

        assert_eq!(
            files,
            vec![
                PathBuf::from("/docs/README.md"),
                PathBuf::from("/docs/guides/install.md"),
            ]
        );
    }

    /// Case-insensitive search reports every occurrence with one-based line and column.
    #[test]
    fn finds_all_matches_case_insensitively() {
        let content = "First Alpha line\nno hit here\nalpha and ALPHA again";

        let matches = find_matches_in_content(content, "alpha");

        assert_eq!(matches.len(), 3);
        assert_eq!((matches[0].line, matches[0].column), (1, 7));
        assert_eq!(matches[0].line_text, "First Alpha line");
        assert_eq!((matches[1].line, matches[1].column), (3, 1));
        assert_eq!((matches[2].line, matches[2].column), (3, 11));
    }

    /// A blank query yields no matches instead of matching every position.
    #[test]
    fn blank_query_yields_no_matches() {
        assert!(find_matches_in_content("anything at all", "   ").is_empty());
        assert!(find_matches_in_content("anything at all", "").is_empty());
    }

    /// Reported matches are capped per file to bound the payload size.
    #[test]
    fn caps_matches_per_file() {
        let content = "x".repeat(MAX_SEARCH_MATCHES_PER_FILE + 20);

        let matches = find_matches_in_content(&content, "x");

        assert_eq!(matches.len(), MAX_SEARCH_MATCHES_PER_FILE);
    }
}
