//! Native iOS document selection, coordinated file-provider reads, and AirPrint.

use serde::Deserialize;
use tauri::{
    Manager, Runtime,
    plugin::{Builder, PluginHandle, TauriPlugin},
};

tauri::ios_plugin_binding!(init_plugin_documents);

/// Native document-provider bridge retained for the application's lifetime.
pub struct Documents<R: Runtime>(PluginHandle<R>);

/// A decoded filesystem path selected by the user, or cancellation.
#[derive(Deserialize)]
pub struct Selection {
    /// Selected filesystem path, without a file URL prefix or percent encoding.
    pub path: Option<String>,
}

/// A coordinated UTF-8 read from an iOS file provider.
#[derive(Deserialize)]
pub struct Document {
    /// Current filesystem path after resolving the provider URL.
    pub path: String,
    /// UTF-8 document content.
    pub content: String,
}

impl<R: Runtime> Documents<R> {
    /// Presents AirPrint and waits until its dialog is closed or cancelled.
    pub fn print(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin("print", serde_json::json!({}))
            .map_err(|error| error.to_string())
    }

    /// Presents Apple's Files picker for a single file or directory.
    pub fn pick(&self, directory: bool) -> Result<Selection, String> {
        self.0
            .run_mobile_plugin("pick", serde_json::json!({ "directory": directory }))
            .map_err(|error| error.to_string())
    }

    /// Coordinates a bounded UTF-8 read, downloading cloud content as needed.
    pub fn read(&self, path: &str, max_size: u64) -> Result<Document, String> {
        self.0
            .run_mobile_plugin(
                "read",
                serde_json::json!({ "path": path, "maxSize": max_size }),
            )
            .map_err(|error| error.to_string())
    }
}

/// Initializes the Swift plugin and restores security-scoped bookmarks.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("documents")
        .setup(|app, api| {
            app.manage(Documents(api.register_ios_plugin(init_plugin_documents)?));
            Ok(())
        })
        .build()
}
