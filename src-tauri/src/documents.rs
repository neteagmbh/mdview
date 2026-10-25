//! Document classification, bounded transport, and session-owned immutable PDF snapshots.

use serde::Serialize;
#[cfg(not(target_os = "ios"))]
use std::collections::HashSet;
#[cfg(any(not(target_os = "ios"), test))]
use std::io::Write;
use std::{
    collections::HashMap,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{AppHandle, Manager};
use tempfile::TempDir;

/// Independent, conservative PDF input cap pending physical-device memory measurements.
pub const MAX_PDF_SIZE: u64 = 16 * 1024 * 1024;
/// Existing UTF-8 Markdown input cap, also enforced during reads rather than only by stat.
pub const MAX_MARKDOWN_SIZE: u64 = 16 * 1024 * 1024;
/// Bounds disk use and retained viewer/print leases within one application session.
const MAX_LEASES: usize = 8;
/// Bounds concurrent copies, including preparations that have been cancelled but not returned.
const MAX_PREPARATIONS: usize = 4;
/// Recognized Markdown extensions shared by classification and the native picker.
pub const MARKDOWN_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "mkdn"];

/// Stable document discriminator shared with the frontend metadata contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DocumentKind {
    /// A bounded UTF-8 Markdown document.
    Markdown,
    /// A binary PDF document owned through an ephemeral resource handle.
    Pdf,
}

/// Classifies supported extensions without reading or granting access to a path.
pub fn document_kind(path: &Path) -> Option<DocumentKind> {
    let extension = path.extension()?.to_str()?;
    if MARKDOWN_EXTENSIONS
        .iter()
        .any(|allowed| extension.eq_ignore_ascii_case(allowed))
    {
        Some(DocumentKind::Markdown)
    } else if extension.eq_ignore_ascii_case("pdf") {
        Some(DocumentKind::Pdf)
    } else {
        None
    }
}

/// Reads at most one sentinel byte beyond a limit, detecting growth without unbounded allocation.
fn bounded_read(reader: impl Read, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read document: {error}"))?;
    if bytes.len() as u64 > limit {
        return Err(format!(
            "The selected file is larger than {} MiB.",
            limit / 1024 / 1024
        ));
    }
    Ok(bytes)
}

/// Opens only regular files and checks their size before reading any content.
fn open_file(path: &Path, limit: u64) -> Result<File, String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("Could not inspect file: {error}"))?;
    if !metadata.is_file() {
        return Err("The selected path is not a file.".into());
    }
    let file = File::open(path).map_err(|error| format!("Could not open file: {error}"))?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("Could not inspect file: {error}"))?;
    if !metadata.is_file() {
        return Err("The selected path is not a file.".into());
    }
    if metadata.len() > limit {
        return Err(format!(
            "The selected file is larger than {} MiB.",
            limit / 1024 / 1024
        ));
    }
    Ok(file)
}

/// Canonicalizes a source path while preserving errors suitable for the document UI.
#[cfg(not(target_os = "ios"))]
fn canonical(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|error| format!("Could not resolve file path: {error}"))
}

/// Reads bounded local Markdown without ever attempting to decode PDF bytes as UTF-8.
#[cfg(not(target_os = "ios"))]
pub fn read_markdown(path: &Path) -> Result<(PathBuf, String), String> {
    let path = canonical(path)?;
    let bytes = bounded_read(open_file(&path, MAX_MARKDOWN_SIZE)?, MAX_MARKDOWN_SIZE)?;
    let content = String::from_utf8(bytes)
        .map_err(|error| format!("Could not read file as UTF-8: {error}"))?;
    Ok((path, content))
}

/// A locked session directory; field order releases the lock before deleting its directory.
struct Session {
    /// OS-owned lock released automatically after a crash or normal shutdown.
    _lock: File,
    /// Private snapshot root removed when the last preparation or document is released.
    directory: TempDir,
}

impl Session {
    /// Recovers abandoned sessions without removing snapshots belonging to another live process.
    fn new(root: &Path) -> Result<Self, String> {
        fs::create_dir_all(root).map_err(|error| error.to_string())?;
        // Serialize creation/recovery so another launch cannot reap a not-yet-locked session.
        let recovery = File::options()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(root.join("recovery.lock"))
            .map_err(|error| error.to_string())?;
        recovery.lock().map_err(|error| error.to_string())?;
        for entry in fs::read_dir(root)
            .map_err(|error| error.to_string())?
            .flatten()
        {
            if !entry.file_name().to_string_lossy().starts_with("session-")
                || !entry.file_type().is_ok_and(|kind| kind.is_dir())
            {
                continue;
            }
            let lock_path = entry.path().join("lock");
            if !lock_path.exists() {
                let _ = fs::remove_dir_all(entry.path());
                continue;
            }
            let Ok(lock) = File::options().read(true).write(true).open(lock_path) else {
                continue;
            };
            if lock.try_lock().is_ok() {
                // Windows requires closing the lock before deleting the directory.
                drop(lock);
                let _ = fs::remove_dir_all(entry.path());
            }
        }
        let directory = tempfile::Builder::new()
            .prefix("session-")
            .tempdir_in(root)
            .map_err(|error| error.to_string())?;
        let lock =
            File::create_new(directory.path().join("lock")).map_err(|error| error.to_string())?;
        lock.lock().map_err(|error| error.to_string())?;
        Ok(Self {
            _lock: lock,
            directory,
        })
    }
}

/// Shared snapshot ownership retained by in-flight reads and independent print leases.
struct Snapshot {
    /// Snapshot bytes and cancellation marker are isolated from provider/source paths.
    directory: TempDir,
    /// Keeps this process's session lock alive until the last operation ends.
    _session: Arc<Session>,
    /// Signals cancellation to local copying and the native provider reader.
    cancelled: AtomicBool,
}

impl Snapshot {
    /// Returns the private PDF path; this path is never sent to the frontend or persisted.
    fn path(&self) -> PathBuf {
        self.directory.path().join("document.pdf")
    }
    /// Returns the cross-bridge cancellation marker observed by Swift's bounded copy loop.
    fn cancellation_path(&self) -> PathBuf {
        self.directory.path().join("cancelled")
    }
    /// Fails cancelled work before its result can become a live handle.
    fn check_cancelled(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::Acquire) {
            Err("PDF preparation was cancelled.".into())
        } else {
            Ok(())
        }
    }
}

/// Metadata contains the source identity and a lease, never binary content or snapshot paths.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedPdf {
    /// Discriminator for renderer dispatch in subsequent integration work.
    kind: DocumentKind,
    /// Opaque session-only lease; releasing it makes further reads through it fail.
    pub(super) handle: String,
    /// Resolved source path, used for display and future persisted reading state.
    pub(super) path: PathBuf,
    /// Source filename rather than the private snapshot filename.
    name: String,
    /// Validated byte length of the immutable snapshot.
    size: u64,
}

/// A lease combines stable source metadata with shared immutable snapshot ownership.
struct Lease {
    /// Source metadata copied when retaining a separate print lease.
    metadata: PreparedPdf,
    /// Keeps bytes alive independently of the original viewer handle.
    snapshot: Arc<Snapshot>,
}

/// All mutations are short and serialized; provider coordination and copying run outside the lock.
#[derive(Default)]
struct Resources {
    /// Native-picker file grants; these never authorize a parent directory.
    #[cfg(not(target_os = "ios"))]
    files: HashSet<PathBuf>,
    /// Preparations keyed by a caller token so cancellation does not need a published handle.
    pending: HashMap<String, Arc<Snapshot>>,
    /// Viewer and print leases; opaque identifiers are never reused in this session.
    leases: HashMap<String, Lease>,
    /// Monotonic suffix combined with the random session directory name.
    next_id: u64,
}

/// Application-owned PDF resource store, independent of Markdown recent-folder behavior.
pub struct PdfDocuments {
    /// Session lock and crash-recoverable private snapshot directory.
    session: Arc<Session>,
    /// Grants, cancellation tokens, and active leases.
    resources: Mutex<Resources>,
}

/// Pins an authorized immutable snapshot until a native print operation ends.
pub(crate) struct PdfPrintSource {
    /// Shared ownership prevents viewer disposal from deleting the print input.
    snapshot: Arc<Snapshot>,
    /// Original filename used for the native print job, without exposing the cache path.
    pub name: String,
}

impl PdfPrintSource {
    /// Returns only the validated private snapshot selected by an opaque lease.
    pub fn path(&self) -> PathBuf {
        self.snapshot.path()
    }
}

impl PdfDocuments {
    /// Obtains print ownership atomically with the original display name.
    pub(crate) fn print_source(&self, handle: &str) -> Result<PdfPrintSource, String> {
        let resources = self.resources.lock().map_err(|error| error.to_string())?;
        let lease = resources
            .leases
            .get(handle)
            .ok_or("PDF handle is closed or invalid.")?;
        Ok(PdfPrintSource {
            snapshot: lease.snapshot.clone(),
            name: lease.metadata.name.clone(),
        })
    }
    /// Initializes private storage and removes only unlocked abandoned sessions.
    pub fn new(root: &Path) -> Result<Self, String> {
        Ok(Self {
            session: Arc::new(Session::new(root)?),
            resources: Mutex::default(),
        })
    }

    /// Records one native file selection without granting access to siblings or parent folders.
    #[cfg(not(target_os = "ios"))]
    pub fn grant_file(&self, path: &Path) -> Result<(), String> {
        self.resources
            .lock()
            .map_err(|error| error.to_string())?
            .files
            .insert(canonical(path)?);
        Ok(())
    }

    /// Checks canonical targets against exact native selections or already authorized recent roots.
    #[cfg(not(target_os = "ios"))]
    pub(super) fn authorize(&self, path: &Path, folders: &[PathBuf]) -> Result<PathBuf, String> {
        let path = canonical(path)?;
        let resources = self.resources.lock().map_err(|error| error.to_string())?;
        if resources.files.contains(&path)
            || folders
                .iter()
                .filter_map(|folder| canonical(folder).ok())
                .any(|folder| path.starts_with(folder))
        {
            return Ok(path);
        }
        Err("PDF access is not authorized. Choose the file or its folder first.".into())
    }

    /// Registers a bounded preparation with automatic error and cancellation cleanup.
    fn begin(&self, request_id: &str) -> Result<Preparation<'_>, String> {
        if request_id.is_empty() || request_id.len() > 128 {
            return Err("Invalid PDF preparation token.".into());
        }
        let mut resources = self.resources.lock().map_err(|error| error.to_string())?;
        if resources.pending.contains_key(request_id) {
            return Err("A PDF preparation already uses this token.".into());
        }
        if resources.pending.len() >= MAX_PREPARATIONS || resources.leases.len() >= MAX_LEASES {
            return Err("Too many PDF resources are open. Close a document first.".into());
        }
        let snapshot = Arc::new(Snapshot {
            directory: tempfile::Builder::new()
                .prefix("document-")
                .tempdir_in(self.session.directory.path())
                .map_err(|error| error.to_string())?,
            _session: self.session.clone(),
            cancelled: AtomicBool::new(false),
        });
        resources
            .pending
            .insert(request_id.into(), snapshot.clone());
        Ok(Preparation {
            store: self,
            request_id: request_id.into(),
            snapshot,
        })
    }

    /// Cancels a preparation without revoking or deleting any other document's resources.
    fn cancel(&self, request_id: &str) -> Result<(), String> {
        let resources = self.resources.lock().map_err(|error| error.to_string())?;
        if let Some(snapshot) = resources.pending.get(request_id) {
            snapshot.cancelled.store(true, Ordering::Release);
            fs::write(snapshot.cancellation_path(), [])
                .map_err(|error| format!("Could not cancel provider copying: {error}"))?;
        }
        Ok(())
    }

    /// Pins immutable bytes during a read even if its viewer lease is released concurrently.
    fn snapshot(&self, handle: &str) -> Result<Arc<Snapshot>, String> {
        self.resources
            .lock()
            .map_err(|error| error.to_string())?
            .leases
            .get(handle)
            .map(|lease| lease.snapshot.clone())
            .ok_or_else(|| "PDF handle is closed or invalid.".into())
    }

    /// Reads the prepared bytes, never reopening a source path that may have been replaced.
    fn read(&self, handle: &str) -> Result<Vec<u8>, String> {
        let snapshot = self.snapshot(handle)?;
        bounded_read(open_file(&snapshot.path(), MAX_PDF_SIZE)?, MAX_PDF_SIZE)
    }

    /// Allocates a new lease for printing; closing the viewer does not revoke this lease.
    fn retain(&self, handle: &str) -> Result<PreparedPdf, String> {
        let mut resources = self.resources.lock().map_err(|error| error.to_string())?;
        let lease = resources
            .leases
            .get(handle)
            .ok_or("PDF handle is closed or invalid.")?;
        let metadata = lease.metadata.clone();
        let snapshot = lease.snapshot.clone();
        Self::insert(&self.session, &mut resources, metadata, snapshot)
    }

    /// Publishes a unique lease under the state lock after all validation has completed.
    fn insert(
        session: &Session,
        resources: &mut Resources,
        mut metadata: PreparedPdf,
        snapshot: Arc<Snapshot>,
    ) -> Result<PreparedPdf, String> {
        if resources.leases.len() >= MAX_LEASES {
            return Err("Too many PDF leases are open.".into());
        }
        resources.next_id = resources
            .next_id
            .checked_add(1)
            .ok_or("PDF handle limit reached.")?;
        metadata.handle = format!(
            "{}-{}",
            session
                .directory
                .path()
                .file_name()
                .ok_or("Invalid PDF session directory.")?
                .to_string_lossy(),
            resources.next_id
        );
        resources.leases.insert(
            metadata.handle.clone(),
            Lease {
                metadata: metadata.clone(),
                snapshot,
            },
        );
        Ok(metadata)
    }

    /// Idempotently closes one lease; bytes disappear after the last read or print lease ends.
    pub(super) fn release(&self, handle: &str) -> Result<(), String> {
        self.resources
            .lock()
            .map_err(|error| error.to_string())?
            .leases
            .remove(handle);
        Ok(())
    }
}

/// RAII preparation guard removes pending state and temporary bytes on every error path.
struct Preparation<'a> {
    /// Store whose pending entry must be removed when this operation completes.
    store: &'a PdfDocuments,
    /// Caller cancellation token, never used as a filesystem path.
    request_id: String,
    /// Private staging directory transferred into a lease only on success.
    snapshot: Arc<Snapshot>,
}

impl Preparation<'_> {
    /// Copies a regular local file in bounded chunks, checking cancellation and source growth.
    #[cfg(not(target_os = "ios"))]
    fn copy(&self, path: &Path) -> Result<(), String> {
        let mut input = open_file(path, MAX_PDF_SIZE)?;
        let before = input.metadata().map_err(|error| error.to_string())?;
        let mut output =
            File::create_new(self.snapshot.path()).map_err(|error| error.to_string())?;
        copy_pdf(&mut input, &mut output, MAX_PDF_SIZE, || {
            self.snapshot.check_cancelled()
        })?;
        let after = input.metadata().map_err(|error| error.to_string())?;
        if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
            return Err("The source PDF changed while reading. Try opening it again.".into());
        }
        Ok(())
    }

    /// Validates header plausibility and atomically publishes source metadata with its lease.
    fn finish(self, source: PathBuf) -> Result<PreparedPdf, String> {
        if document_kind(&source) != Some(DocumentKind::Pdf) {
            return Err("The resolved source does not have a PDF extension.".into());
        }
        let mut file = open_file(&self.snapshot.path(), MAX_PDF_SIZE)?;
        let mut header = [0; 1032];
        let count = file.read(&mut header).map_err(|error| error.to_string())?;
        if !plausible_pdf(&header[..count]) {
            return Err("The selected file has no valid PDF header.".into());
        }
        let size = file.metadata().map_err(|error| error.to_string())?.len();
        let metadata = PreparedPdf {
            kind: DocumentKind::Pdf,
            handle: String::new(),
            name: source
                .file_name()
                .ok_or("PDF source has no filename.")?
                .to_string_lossy()
                .into_owned(),
            path: source,
            size,
        };
        let mut resources = self
            .store
            .resources
            .lock()
            .map_err(|error| error.to_string())?;
        self.snapshot.check_cancelled()?;
        let metadata = PdfDocuments::insert(
            &self.store.session,
            &mut resources,
            metadata,
            self.snapshot.clone(),
        )?;
        resources.pending.remove(&self.request_id);
        Ok(metadata)
    }
}

impl Drop for Preparation<'_> {
    /// Clears cancellation state after copying ends, including a provider failure or aborted publish.
    fn drop(&mut self) {
        if let Ok(mut resources) = self.store.resources.lock() {
            resources.pending.remove(&self.request_id);
        }
    }
}

/// Checks a supported PDF version header within the first 1,024 bytes; parsing remains PDF.js's job.
fn plausible_pdf(bytes: &[u8]) -> bool {
    bytes.windows(8).take(1024).any(|header| {
        &header[..5] == b"%PDF-"
            && matches!(header[5], b'1' | b'2')
            && header[6] == b'.'
            && header[7].is_ascii_digit()
    })
}

/// Streams one sentinel byte past the limit, never retaining whole PDF bytes during snapshot copying.
#[cfg(any(not(target_os = "ios"), test))]
fn copy_pdf(
    input: &mut impl Read,
    output: &mut impl Write,
    limit: u64,
    check_cancelled: impl Fn() -> Result<(), String>,
) -> Result<u64, String> {
    let mut total = 0;
    let mut buffer = vec![0; 64 * 1024];
    loop {
        check_cancelled()?;
        let capacity = usize::try_from((limit + 1 - total).min(buffer.len() as u64))
            .map_err(|error| error.to_string())?;
        let count = input
            .read(&mut buffer[..capacity])
            .map_err(|error| error.to_string())?;
        if count == 0 {
            return Ok(total);
        }
        total += count as u64;
        if total > limit {
            return Err("The selected PDF exceeds its size limit.".into());
        }
        output
            .write_all(&buffer[..count])
            .map_err(|error| error.to_string())?;
    }
}

/// Prepares immutable PDF bytes off the UI thread without promoting folders or granting asset scopes.
#[tauri::command]
pub async fn prepare_pdf_document(
    app: AppHandle,
    path: String,
    request_id: String,
) -> Result<PreparedPdf, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&path);
        if document_kind(path) != Some(DocumentKind::Pdf) {
            return Err("Choose a file with a PDF extension.".into());
        }
        let store = app.state::<PdfDocuments>();
        let preparation = store.begin(&request_id)?;
        #[cfg(not(target_os = "ios"))]
        let source = {
            let folders = super::load_recent_folders(&app)?
                .into_iter()
                .map(|entry| entry.path)
                .collect::<Vec<_>>();
            let source = store.authorize(path, &folders)?;
            preparation.copy(&source)?;
            source
        };
        #[cfg(target_os = "ios")]
        let source = {
            let result = app
                .state::<tauri_plugin_documents::Documents<tauri::Wry>>()
                .snapshot(
                    &path.to_string_lossy(),
                    &preparation.snapshot.path().to_string_lossy(),
                    &preparation.snapshot.cancellation_path().to_string_lossy(),
                    MAX_PDF_SIZE,
                )?;
            PathBuf::from(result.path)
        };
        preparation.finish(source)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Cancels pending provider/local copying; completed leases are released by their owner instead.
#[allow(clippy::needless_pass_by_value)] // Tauri injects State by value.
#[tauri::command]
pub fn cancel_pdf_preparation(
    store: tauri::State<'_, PdfDocuments>,
    request_id: &str,
) -> Result<(), String> {
    store.cancel(request_id)
}

/// Returns binary IPC content directly, avoiding JSON arrays or base64 across either bridge.
#[tauri::command]
pub async fn read_pdf_bytes(
    app: AppHandle,
    handle: String,
) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<PdfDocuments>()
            .read(&handle)
            .map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Retains an independently releasable snapshot lease for a future native print operation.
#[allow(clippy::needless_pass_by_value)] // Tauri injects State by value.
#[tauri::command]
pub fn retain_pdf_document(
    store: tauri::State<'_, PdfDocuments>,
    handle: &str,
) -> Result<PreparedPdf, String> {
    store.retain(handle)
}

/// Releases a viewer or print lease; a stale handle can never resolve a later document.
#[allow(clippy::needless_pass_by_value)] // Tauri injects State by value.
#[tauri::command]
pub fn release_pdf_document(
    store: tauri::State<'_, PdfDocuments>,
    handle: &str,
) -> Result<(), String> {
    store.release(handle)
}

#[cfg(test)]
#[path = "documents_tests.rs"]
mod tests;
