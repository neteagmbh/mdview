use serde::Serialize;
use std::{
    fs, io,
    path::{Path, PathBuf},
};
use tauri::{
    AppHandle, Emitter, Manager,
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
};

/// Maximum Markdown document size accepted by the viewer.
const MAX_FILE_SIZE: u64 = 16 * 1024 * 1024;
/// Maximum number of recently viewed folders retained in persistent storage.
const MAX_RECENT_FOLDERS: usize = 10;
/// File extensions recognized as Markdown, without the leading dot.
const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "mkdn"];
/// File name used for the persistent recent-folder list.
const RECENT_FOLDERS_FILE: &str = "recent-folders.json";
/// Stable identifier for the native File → Open menu item.
const OPEN_FILE_MENU_ID: &str = "open_file";
/// Stable identifier for the native File → Open Directory menu item.
const OPEN_DIRECTORY_MENU_ID: &str = "open_directory";
/// Stable identifier for the native About menu item.
const ABOUT_MENU_ID: &str = "about_mdview";

/// A directory or Markdown file displayed in the recent-folder tree.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownTreeNode {
    /// File-system display name.
    name: String,
    /// Absolute file-system path.
    path: PathBuf,
    /// Whether this node represents a directory.
    is_directory: bool,
    /// Markdown-containing descendants for a directory node.
    children: Vec<MarkdownTreeNode>,
}

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

/// Returns whether a path has one of the supported Markdown extensions.
fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            MARKDOWN_EXTENSIONS
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
}

/// Returns a human-readable final component for a file-system path.
fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map_or_else(|| path.display().to_string(), ToOwned::to_owned)
}

/// Recursively finds Markdown files below a directory.
///
/// Directory branches without Markdown descendants and symbolic links are omitted.
fn scan_directory(path: &Path) -> io::Result<Vec<MarkdownTreeNode>> {
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
            let children = scan_directory(&entry_path).unwrap_or_default();
            if !children.is_empty() {
                nodes.push(MarkdownTreeNode {
                    name: display_name(&entry_path),
                    path: entry_path,
                    is_directory: true,
                    children,
                });
            }
        } else if file_type.is_file() && is_markdown(&entry_path) {
            nodes.push(MarkdownTreeNode {
                name: display_name(&entry_path),
                path: entry_path,
                is_directory: false,
                children: Vec::new(),
            });
        }
    }

    nodes.sort_by_cached_key(|node| (!node.is_directory, node.name.to_lowercase()));
    Ok(nodes)
}

/// Builds display trees for existing folders while preserving LRU order.
fn build_recent_tree(folders: &[PathBuf]) -> Vec<MarkdownTreeNode> {
    folders
        .iter()
        .filter(|folder| folder.is_dir())
        .map(|folder| MarkdownTreeNode {
            name: display_name(folder),
            path: folder.clone(),
            is_directory: true,
            children: scan_directory(folder).unwrap_or_default(),
        })
        .collect()
}

/// Moves a folder to the front of the bounded recent-folder list.
fn promote_folder(folders: &mut Vec<PathBuf>, folder: PathBuf) {
    folders.retain(|existing| existing != &folder);
    folders.insert(0, folder);
    folders.truncate(MAX_RECENT_FOLDERS);
}

/// Promotes the existing LRU ancestor that covers a document folder.
///
/// The document's immediate folder is added only when no existing root already includes it.
fn promote_document_folder(folders: &mut Vec<PathBuf>, folder: PathBuf) {
    let promoted = folders
        .iter()
        .find(|existing| folder.starts_with(existing))
        .cloned()
        .unwrap_or(folder);
    promote_folder(folders, promoted);
}

/// Removes a folder from the recent-folder list.
fn remove_folder(folders: &mut Vec<PathBuf>, folder: &Path) -> bool {
    let previous_len = folders.len();
    folders.retain(|existing| existing != folder);
    folders.len() != previous_len
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

/// Loads the persistent recent-folder list, returning an empty list on first launch.
fn load_recent_folders(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let path = recent_folders_path(app)?;
    match fs::read_to_string(path) {
        Ok(json) => serde_json::from_str(&json)
            .map_err(|error| format!("Could not read recent folders: {error}")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(format!("Could not read recent folders: {error}")),
    }
}

/// Persists the recent-folder list in Tauri's platform app-data directory.
fn save_recent_folders(app: &AppHandle, folders: &[PathBuf]) -> Result<(), String> {
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

/// Returns the current recent-folder tree to the frontend.
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
fn recent_markdown_tree(app: AppHandle) -> Result<Vec<MarkdownTreeNode>, String> {
    load_recent_folders(&app).map(|folders| build_recent_tree(&folders))
}

/// Adds or promotes a directory in the persistent recent-folder list.
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
fn add_recent_folder(app: AppHandle, path: String) -> Result<Vec<MarkdownTreeNode>, String> {
    let folder = canonical_directory(Path::new(&path))?;
    let mut folders = load_recent_folders(&app)?;
    promote_folder(&mut folders, folder);
    save_recent_folders(&app, &folders)?;
    Ok(build_recent_tree(&folders))
}

/// Removes a directory from the persistent recent-folder list.
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
fn remove_recent_folder(app: AppHandle, path: String) -> Result<Vec<MarkdownTreeNode>, String> {
    let mut folders = load_recent_folders(&app)?;
    remove_folder(&mut folders, Path::new(&path));
    save_recent_folders(&app, &folders)?;
    Ok(build_recent_tree(&folders))
}

/// Validates and opens a Markdown file, promotes its covering LRU root, and refreshes the tree.
#[allow(clippy::needless_pass_by_value)]
#[tauri::command]
fn open_markdown_file(app: AppHandle, path: String) -> Result<OpenedDocument, String> {
    let path = PathBuf::from(path);
    if !is_markdown(&path) {
        return Err("Choose a file with a Markdown extension.".to_owned());
    }

    let metadata =
        fs::metadata(&path).map_err(|error| format!("Could not inspect file: {error}"))?;
    if !metadata.is_file() {
        return Err("The selected path is not a file.".to_owned());
    }
    if metadata.len() > MAX_FILE_SIZE {
        return Err("The selected file is larger than 16 MiB.".to_owned());
    }

    let canonical_path =
        fs::canonicalize(&path).map_err(|error| format!("Could not resolve file path: {error}"))?;
    let content = fs::read_to_string(&canonical_path)
        .map_err(|error| format!("Could not read file as UTF-8: {error}"))?;
    let folder = canonical_path
        .parent()
        .ok_or_else(|| "The selected file has no parent folder.".to_owned())?
        .to_path_buf();

    let mut folders = load_recent_folders(&app)?;
    promote_document_folder(&mut folders, folder);
    save_recent_folders(&app, &folders)?;

    Ok(OpenedDocument {
        content,
        path: canonical_path,
        recent_folders: build_recent_tree(&folders),
    })
}

/// Returns whether a native menu event should open the file picker.
fn is_open_file_menu_event(id: &str) -> bool {
    id == OPEN_FILE_MENU_ID
}

/// Returns whether a native menu event should open the directory picker.
fn is_open_directory_menu_event(id: &str) -> bool {
    id == OPEN_DIRECTORY_MENU_ID
}

/// Returns whether a native menu event should open the About dialog.
fn is_about_menu_event(id: &str) -> bool {
    id == ABOUT_MENU_ID
}

/// Builds and runs the Tauri desktop application.
///
/// # Panics
///
/// Panics if Tauri cannot initialize or encounters a fatal runtime error.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            let about = MenuItem::with_id(app, ABOUT_MENU_ID, "About mdview", true, None::<&str>)?;
            let file = Submenu::with_items(
                app,
                "File",
                true,
                &[
                    &open,
                    &open_directory,
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
        .on_menu_event(|app, event| {
            if is_open_file_menu_event(event.id().as_ref()) {
                let _ = app.emit("menu-open-file", ());
            } else if is_open_directory_menu_event(event.id().as_ref()) {
                let _ = app.emit("menu-open-directory", ());
            } else if is_about_menu_event(event.id().as_ref()) {
                let _ = app.emit("menu-about", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            add_recent_folder,
            open_markdown_file,
            recent_markdown_tree,
            remove_recent_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running mdview");
}

#[cfg(test)]
mod tests {
    //! Unit tests for Markdown discovery, LRU ordering, and native menu routing.

    use super::{
        MAX_RECENT_FOLDERS, canonical_directory, is_about_menu_event, is_markdown,
        is_open_directory_menu_event, is_open_file_menu_event, promote_document_folder,
        promote_folder, remove_folder, scan_directory,
    };
    use std::{
        fs,
        path::{Path, PathBuf},
    };

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
        let mut folders: Vec<PathBuf> = (0..MAX_RECENT_FOLDERS)
            .map(|index| PathBuf::from(format!("folder-{index}")))
            .collect();

        promote_folder(&mut folders, PathBuf::from("folder-4"));
        assert_eq!(folders.first(), Some(&PathBuf::from("folder-4")));
        assert_eq!(folders.len(), MAX_RECENT_FOLDERS);
        assert_eq!(
            folders
                .iter()
                .filter(|folder| *folder == &PathBuf::from("folder-4"))
                .count(),
            1
        );

        promote_folder(&mut folders, PathBuf::from("new-folder"));
        assert_eq!(folders.first(), Some(&PathBuf::from("new-folder")));
        assert_eq!(folders.len(), MAX_RECENT_FOLDERS);
    }

    /// Opening a document below an existing root promotes that root without adding its parent.
    #[test]
    fn document_below_recent_root_does_not_add_nested_folder() {
        let root = PathBuf::from("docs");
        let mut folders = vec![PathBuf::from("other"), root.clone()];

        promote_document_folder(&mut folders, root.join("guides/reference"));

        assert_eq!(folders, vec![root, PathBuf::from("other")]);
    }

    /// Path coverage compares complete components rather than similarly prefixed names.
    #[test]
    fn similarly_prefixed_folder_is_not_treated_as_covered() {
        let mut folders = vec![PathBuf::from("docs")];
        let separate = PathBuf::from("docs-archive/guides");

        promote_document_folder(&mut folders, separate.clone());

        assert_eq!(folders, vec![separate, PathBuf::from("docs")]);
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

        let nodes = scan_directory(temporary.path())?;

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

    /// Only the About menu identifier routes to the in-application dialog.
    #[test]
    fn recognizes_about_menu_event() {
        assert!(is_about_menu_event("about_mdview"));
        assert!(!is_about_menu_event("open_file"));
    }

    /// Removing a folder affects only the matching recent entry.
    #[test]
    fn removes_matching_recent_folder() {
        let mut folders = vec![PathBuf::from("one"), PathBuf::from("two")];

        assert!(remove_folder(&mut folders, Path::new("one")));
        assert_eq!(folders, vec![PathBuf::from("two")]);
        assert!(!remove_folder(&mut folders, Path::new("missing")));
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
}
