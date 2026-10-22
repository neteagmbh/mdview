//! OS file and folder handoff and consumption before frontend readiness.

#[cfg(any(desktop, test))]
use std::{ffi::OsString, path::Path};
use std::{path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager, Url};

/// File URLs waiting for the document view, deduplicated until their next consumption.
#[derive(Default)]
pub struct IncomingDocuments(Mutex<Vec<String>>);

impl IncomingDocuments {
    /// Appends each file URL once while allowing explicit reopens after consumption.
    fn push(&self, urls: impl IntoIterator<Item = String>) -> Result<(), String> {
        let mut pending = self.0.lock().map_err(|error| error.to_string())?;
        for url in urls {
            if !pending.contains(&url) {
                pending.push(url);
            }
        }
        Ok(())
    }

    /// Removes a batch atomically so startup and runtime notifications cannot replay it.
    fn take(&self) -> Result<Vec<String>, String> {
        let mut pending = self.0.lock().map_err(|error| error.to_string())?;
        Ok(std::mem::take(&mut *pending))
    }
}

/// Validates local Markdown or folder URLs without damaging URL punctuation.
pub fn document_path(source: &str) -> Result<PathBuf, String> {
    let url = Url::parse(source).map_err(|error| format!("Invalid document URL: {error}"))?;
    if url.scheme() != "file"
        || url.query().is_some()
        || url.fragment().is_some()
        || url.host_str().is_some_and(|host| host != "localhost")
    {
        return Err("Only local Markdown, PDF, or folder URLs can be opened.".to_owned());
    }
    let path = url
        .to_file_path()
        .map_err(|()| "Invalid local document path.".to_owned())?;
    if !path.is_dir() && super::documents::document_kind(&path).is_none() {
        return Err("Choose a folder, Markdown file, or PDF file.".to_owned());
    }
    Ok(path)
}

/// Converts launcher filenames and file URLs into requests, excluding the executable and flags.
#[cfg(any(desktop, test))]
pub fn argument_urls(args: impl IntoIterator<Item = OsString>, cwd: &Path) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter_map(|argument| {
            if let Some(source) = argument.to_str() {
                if source.starts_with("file:") {
                    return document_path(source).ok().map(|_| source.to_owned());
                }
                if source.contains("://") {
                    return None;
                }
            }
            if argument.to_string_lossy().starts_with('-') {
                return None;
            }
            let path = PathBuf::from(argument);
            let path = if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            };
            (path.is_dir() || super::documents::document_kind(&path).is_some())
                .then(|| Url::from_file_path(path).ok())
                .flatten()
                .map(|url| url.to_string())
        })
        .collect()
}

/// Queues OS requests and signals the UI without losing requests before its listener exists.
pub fn enqueue(app: &AppHandle, urls: impl IntoIterator<Item = String>) {
    let urls: Vec<_> = urls
        .into_iter()
        .filter(|url| document_path(url).is_ok())
        .collect();
    if urls.is_empty() {
        return;
    }
    #[cfg(not(target_os = "ios"))]
    for path in urls
        .iter()
        .filter_map(|url| document_path(url).ok())
        .filter(|path| path.is_file())
    {
        if let Err(error) = app
            .state::<super::documents::PdfDocuments>()
            .grant_file(&path)
        {
            eprintln!("Could not authorize incoming document: {error}");
        }
    }
    match app.state::<IncomingDocuments>().push(urls) {
        Ok(()) => {
            if let Err(error) = app.emit("incoming-documents", ()) {
                eprintln!("Could not notify the document view: {error}");
            }
        }
        Err(error) => eprintln!("Could not queue incoming documents: {error}"),
    }
    focus_window(app);
}

/// Activates the desktop viewer when an OS request reaches an existing instance.
pub fn focus_window(app: &AppHandle) {
    #[cfg(desktop)]
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    #[cfg(not(desktop))]
    let _ = app;
}

/// Drains pending requests once after the frontend registers its runtime listener.
#[tauri::command]
pub fn take_incoming_documents(app: AppHandle) -> Result<Vec<String>, String> {
    app.state::<IncomingDocuments>().take()
}

/// An OS request resolved into a document or a browsable recent-folder tree.
#[derive(serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum IncomingContent {
    /// A Markdown document ready for rendering.
    Document {
        /// Validated content and the updated recent-folder tree.
        document: super::document_routing::OpenedContent,
    },
    /// A directory added to the existing folder browser.
    Folder {
        /// Canonical folder path used to expand the requested root in the UI.
        path: PathBuf,
        /// Markdown-only tree including the newly promoted folder.
        folders: Vec<super::MarkdownTreeNode>,
    },
}

/// Opens an incoming file or folder using the same provider access as picker selections.
#[tauri::command]
pub async fn open_incoming_document(
    app: AppHandle,
    url: String,
    request_id: String,
) -> Result<IncomingContent, String> {
    #[cfg(target_os = "ios")]
    let access_app = app.clone();
    let path = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(not(target_os = "ios"))]
        let path = document_path(&url)?;
        #[cfg(target_os = "ios")]
        let path = {
            document_path(&url)?;
            PathBuf::from(
                access_app
                    .state::<tauri_plugin_documents::Documents<tauri::Wry>>()
                    .accept(&url)?
                    .path
                    .ok_or_else(|| "No incoming document path.".to_owned())?,
            )
        };
        Ok::<_, String>(path)
    })
    .await
    .map_err(|error| error.to_string())??;
    if path.is_dir() {
        let path = super::canonical_directory(&path)?;
        let folders = super::add_recent_folder(app, path.to_string_lossy().into_owned()).await?;
        Ok(IncomingContent::Folder { path, folders })
    } else {
        super::document_routing::open_document_file(
            app,
            path.to_string_lossy().into_owned(),
            request_id,
            None,
        )
        .await
        .map(|document| IncomingContent::Document { document })
    }
}

#[cfg(test)]
mod tests {
    //! Regression coverage for queue delivery and launcher path semantics.
    use super::*;

    /// PDF handoffs preserve URL punctuation and launcher paths while remote/ambiguous URLs fail.
    #[test]
    fn accepts_pdf_handoff_and_rejects_remote_or_ambiguous_urls() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("Über 100% # source.PDF");
        let url = Url::from_file_path(&path).unwrap();
        assert_eq!(document_path(url.as_str()).unwrap(), path);
        assert_eq!(
            argument_urls(
                ["mdview".into(), path.clone().into_os_string()],
                directory.path()
            ),
            [url.to_string()]
        );
        for source in [
            "https://example.com/a.pdf",
            "file://server/share/a.pdf",
            "file:///tmp/a.pdf?page=2",
            "file:///tmp/a.pdf#page=2",
        ] {
            assert!(document_path(source).is_err());
        }
    }

    /// Verifies duplicate notifications do not replay files and intentional later reopens work.
    #[test]
    fn consumes_requests_once_and_allows_reopening() {
        let queue = IncomingDocuments::default();
        queue
            .push([
                "file:///one.md".into(),
                "file:///one.md".into(),
                "file:///two.md".into(),
            ])
            .unwrap();
        assert_eq!(queue.take().unwrap(), ["file:///one.md", "file:///two.md"]);
        assert!(queue.take().unwrap().is_empty());
        queue.push(["file:///one.md".into()]).unwrap();
        assert_eq!(queue.take().unwrap(), ["file:///one.md"]);
    }

    /// Ensures paths preserve Unicode, spaces, percent signs, and hashes across URL conversion.
    #[test]
    fn decodes_file_paths_and_rejects_non_documents() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("Über 100% # notes.MD");
        let url = Url::from_file_path(&path).unwrap();
        assert_eq!(document_path(url.as_str()).unwrap(), path);
        assert!(document_path("https://example.com/a.md").is_err());
        assert!(document_path("javascript:alert(1)").is_err());
        assert!(document_path("file:///tmp/image.png").is_err());
        assert!(document_path("not a URL").is_err());
    }

    /// Verifies startup and second-instance filenames resolve against the sending working directory.
    #[test]
    fn resolves_arguments_and_skips_flags() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("space # name.md");
        let file_url = Url::from_file_path(&path).unwrap().to_string();
        let args = [
            "mdview".into(),
            "--flag.md".into(),
            "space # name.md".into(),
            file_url.clone().into(),
            "image.png".into(),
            "https://example.com/file.md".into(),
            directory.path().join("other.mkdn").into_os_string(),
        ];
        assert_eq!(
            argument_urls(args, directory.path()),
            [
                file_url.clone(),
                file_url,
                Url::from_file_path(directory.path().join("other.mkdn"))
                    .unwrap()
                    .to_string()
            ]
        );
    }

    /// Ensures all advertised extensions are accepted by incoming URL validation.
    #[test]
    fn accepts_every_registered_extension() {
        let directory = tempfile::tempdir().unwrap();
        for extension in super::super::MARKDOWN_EXTENSIONS {
            let path = directory.path().join(format!("document.{extension}"));
            assert_eq!(
                document_path(Url::from_file_path(&path).unwrap().as_str()).unwrap(),
                path
            );
        }
    }

    /// Accepts extensionless and Markdown-named folders while rejecting unrelated files.
    #[test]
    fn accepts_incoming_folders_and_launcher_paths() {
        let directory = tempfile::tempdir().unwrap();
        for name in ["Über 100% # notes", "archive.md"] {
            let path = directory.path().join(name);
            std::fs::create_dir(&path).unwrap();
            let url = Url::from_directory_path(&path).unwrap().to_string();
            assert_eq!(document_path(&url).unwrap(), path);
            assert_eq!(
                argument_urls(
                    ["mdview".into(), name.into(), url.clone().into()],
                    directory.path(),
                )
                .iter()
                .map(|source| document_path(source).unwrap())
                .collect::<Vec<_>>(),
                [path.clone(), path],
            );
        }
        let path = directory.path().join("image.png");
        std::fs::write(&path, []).unwrap();
        assert!(document_path(Url::from_file_path(path).unwrap().as_str()).is_err());
        let missing = directory.path().join("missing-folder");
        assert!(document_path(Url::from_directory_path(missing).unwrap().as_str()).is_err());
    }

    /// Keeps the folder command response aligned with the frontend's discriminated union.
    #[test]
    fn serializes_incoming_folder_content() {
        let content = IncomingContent::Folder {
            path: PathBuf::from("/Notes"),
            folders: Vec::new(),
        };
        assert_eq!(
            serde_json::to_value(content).unwrap(),
            serde_json::json!({ "kind": "folder", "path": "/Notes", "folders": [] }),
        );
    }
}
