//! One document-opening contract for native entry points, explicit paths, and reloads.
use super::documents::{self, DocumentKind, PdfDocuments, PreparedPdf};
use std::path::Path;
use tauri::{AppHandle, Manager};

/// Renderer-discriminated metadata; PDF content is transported separately through binary IPC.
#[derive(Debug, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OpenedContent {
    /// Existing UTF-8 Markdown source and its source/tree metadata.
    Markdown {
        /// Flattening preserves the existing Markdown payload fields.
        #[serde(flatten)]
        document: super::OpenedDocument,
    },
    /// An owned PDF lease over immutable source bytes.
    Pdf {
        /// Source identity and session-only resource handle.
        document: PreparedPdf,
        /// Shared mixed-document tree after opening or reloading.
        #[serde(rename = "recentFolders")]
        recent_folders: Vec<super::MarkdownTreeNode>,
    },
}

/// Dispatches by the authoritative classifier and releases PDF ownership if post-open work fails.
async fn route(
    app: AppHandle,
    path: String,
    request_id: String,
    promote: bool,
) -> Result<OpenedContent, String> {
    match documents::document_kind(Path::new(&path)) {
        Some(DocumentKind::Markdown) => tauri::async_runtime::spawn_blocking(move || {
            let document = if promote {
                super::open_document(&app, Path::new(&path))?
            } else {
                let (path, content) = super::read_document(&app, Path::new(&path))?;
                super::OpenedDocument {
                    path,
                    content,
                    recent_folders: super::recent_markdown_tree(app)?,
                }
            };
            Ok(OpenedContent::Markdown { document })
        })
        .await
        .map_err(|error| error.to_string())?,
        Some(DocumentKind::Pdf) => {
            let document = documents::prepare_pdf_document(app.clone(), path, request_id).await?;
            let handle = document.handle.clone();
            let scan_app = app.clone();
            let result = tauri::async_runtime::spawn_blocking(move || {
                let recent_folders = if promote {
                    super::promote_opened_folder(&scan_app, &document.path)?
                } else {
                    super::recent_markdown_tree(scan_app)?
                };
                Ok(OpenedContent::Pdf {
                    document,
                    recent_folders,
                })
            })
            .await
            .map_err(|error| error.to_string())
            .and_then(|result| result);
            if result.is_err() {
                let _ = app.state::<PdfDocuments>().release(&handle);
            }
            result
        }
        None => Err("Choose a Markdown or PDF file.".into()),
    }
}

/// Opens a selected document and applies the existing recent-folder promotion rules.
#[tauri::command]
pub async fn open_document_file(
    app: AppHandle,
    path: String,
    request_id: String,
    source_path: Option<String>,
) -> Result<OpenedContent, String> {
    #[cfg(not(target_os = "ios"))]
    if let Some(source) = source_path {
        let folders = super::load_recent_folders(&app)?
            .into_iter()
            .map(|entry| entry.path)
            .collect::<Vec<_>>();
        let store = app.state::<PdfDocuments>();
        authorize_link(&store, Path::new(&source), Path::new(&path), &folders)?;
    }
    #[cfg(target_os = "ios")]
    let _ = source_path; // Native provider scopes remain authoritative for relative links.
    route(app, path, request_id, true).await
}

/// A user-followed local link may select a file outside desktop roots, without granting its siblings.
#[cfg(not(target_os = "ios"))]
fn authorize_link(
    store: &PdfDocuments,
    source: &Path,
    target: &Path,
    folders: &[std::path::PathBuf],
) -> Result<(), String> {
    if documents::document_kind(source).is_none() || documents::document_kind(target).is_none() {
        return Err("Choose a local Markdown or PDF document link.".into());
    }
    store.authorize(source, folders)?;
    store.grant_file(target)
}

/// Replaces content without promoting folders or restarting watchers on each filesystem event.
#[tauri::command]
pub async fn reload_document_file(
    app: AppHandle,
    path: String,
    request_id: String,
) -> Result<OpenedContent, String> {
    route(app, path, request_id, false).await
}

#[cfg(test)]
mod tests {
    //! Serialization agreement with the frontend's discriminated document-result union.
    /// Relative-link selection requires an authorized source and grants only the selected target.
    #[cfg(not(target_os = "ios"))]
    #[test]
    fn authorizes_link_target_without_authorizing_its_sibling() {
        let root = tempfile::tempdir().unwrap();
        let store = crate::documents::PdfDocuments::new(&root.path().join("cache")).unwrap();
        let source = root.path().join("readme.md");
        let target = root.path().join("target.pdf");
        let sibling = root.path().join("private.pdf");
        for path in [&source, &target, &sibling] {
            std::fs::write(path, b"sample").unwrap();
        }
        assert!(super::authorize_link(&store, &source, &target, &[]).is_err());
        store.grant_file(&source).unwrap();
        super::authorize_link(&store, &source, &target, &[]).unwrap();
        assert!(store.authorize(&target, &[]).is_ok());
        assert!(store.authorize(&sibling, &[]).is_err());
    }
    /// Markdown retains its source fields while adding a renderer discriminator.
    #[test]
    fn serializes_markdown_content_without_changing_source_identity() {
        let content = super::OpenedContent::Markdown {
            document: crate::OpenedDocument {
                content: "# source".into(),
                path: "/Notes/source.md".into(),
                recent_folders: Vec::new(),
            },
        };
        assert_eq!(
            serde_json::to_value(content).unwrap(),
            serde_json::json!({
                "kind":"markdown", "content":"# source", "path":"/Notes/source.md", "recentFolders":[]
            })
        );
    }
}
