//! Regression coverage for document classification, bounds, grants, and snapshot ownership.
use super::*;
use std::{
    cell::Cell,
    io::{self, Cursor},
};

/// Original binary sample includes bytes that cannot be decoded as UTF-8.
const PDF: &[u8] = b"%PDF-1.7\n\xff\xfe\n%%EOF\n";

/// Creates a prepared snapshot using the same copy and publish path as desktop commands.
fn prepare(store: &PdfDocuments, path: &Path, token: &str) -> PreparedPdf {
    store.grant_file(path).unwrap();
    let source = store.authorize(path, &[]).unwrap();
    let preparation = store.begin(token).unwrap();
    preparation.copy(&source).unwrap();
    preparation.finish(source).unwrap()
}

/// Recognizes all Markdown variants and uppercase PDFs through one classifier.
#[test]
fn classifies_document_kinds() {
    for extension in MARKDOWN_EXTENSIONS {
        assert_eq!(
            document_kind(Path::new(&format!("notes.{}", extension.to_uppercase()))),
            Some(DocumentKind::Markdown)
        );
    }
    assert_eq!(
        document_kind(Path::new("Über # 100%.PDF")),
        Some(DocumentKind::Pdf)
    );
    for path in ["pdf", "file.pdf.exe", "file.txt", ""] {
        assert_eq!(document_kind(Path::new(path)), None);
    }
    assert_eq!(
        serde_json::to_value(DocumentKind::Markdown).unwrap(),
        "markdown"
    );
    assert_eq!(serde_json::to_value(DocumentKind::Pdf).unwrap(), "pdf");
}

/// Allows plausible version headers and recovery preambles without accepting unrelated binary files.
#[test]
fn validates_pdf_header() {
    assert!(plausible_pdf(PDF));
    assert!(plausible_pdf(b"preamble\n%PDF-2.0\n"));
    for bytes in [
        b"".as_slice(),
        b"%PDF-",
        b"%PDF-9.9",
        b"%PDF-1.x",
        b"# Markdown",
    ] {
        assert!(!plausible_pdf(bytes));
    }
    let mut bytes = vec![b' '; 1024];
    bytes.extend(PDF);
    assert!(!plausible_pdf(&bytes));
    bytes.remove(0);
    assert!(plausible_pdf(&bytes));
}

/// Checks actual streamed length, including a sentinel past a misleading initial size estimate.
#[test]
fn enforces_exact_stream_limits() {
    assert_eq!(bounded_read(Cursor::new(b"abcd"), 4).unwrap(), b"abcd");
    assert!(bounded_read(Cursor::new(b"abcde"), 4).is_err());
    let mut output = Vec::new();
    assert_eq!(
        copy_pdf(&mut Cursor::new(b"abcd"), &mut output, 4, || Ok(())).unwrap(),
        4
    );
    assert_eq!(output, b"abcd");
    assert!(copy_pdf(&mut Cursor::new(b"abcde"), &mut Vec::new(), 4, || Ok(())).is_err());
}

/// Rejects sparse oversized files, directories, missing paths, and invalid UTF-8 Markdown.
#[test]
fn validates_local_inputs() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("large.pdf");
    File::create(&path)
        .unwrap()
        .set_len(MAX_PDF_SIZE + 1)
        .unwrap();
    assert!(open_file(&path, MAX_PDF_SIZE).is_err());
    assert!(open_file(root.path(), MAX_PDF_SIZE).is_err());
    assert!(open_file(&root.path().join("missing.pdf"), MAX_PDF_SIZE).is_err());
    fs::write(&path, PDF).unwrap();
    assert!(read_markdown(&path).unwrap_err().contains("UTF-8"));
}

/// Native file selections authorize only that canonical file; folder grants respect path boundaries.
#[test]
fn checks_exact_file_and_folder_grants() {
    let root = tempfile::tempdir().unwrap();
    let store = PdfDocuments::new(&root.path().join("cache")).unwrap();
    let folder = root.path().join("notes");
    fs::create_dir(&folder).unwrap();
    let path = folder.join("one.PDF");
    let sibling = folder.join("two.pdf");
    fs::write(&path, PDF).unwrap();
    fs::write(&sibling, PDF).unwrap();
    assert!(store.authorize(&path, &[]).is_err());
    store.grant_file(&path).unwrap();
    assert_eq!(
        store.authorize(&path, &[]).unwrap(),
        canonical(&path).unwrap()
    );
    assert!(store.authorize(&sibling, &[]).is_err());
    assert!(
        store
            .authorize(&sibling, std::slice::from_ref(&folder))
            .is_ok()
    );
    assert!(
        store
            .authorize(&sibling, &[root.path().join("note")])
            .is_err()
    );
}

/// A symlink inside a granted folder must not authorize a PDF outside that folder.
#[cfg(unix)]
#[test]
fn rejects_symlink_escape() {
    let root = tempfile::tempdir().unwrap();
    let store = PdfDocuments::new(&root.path().join("cache")).unwrap();
    let folder = root.path().join("authorized");
    fs::create_dir(&folder).unwrap();
    let outside = root.path().join("private.pdf");
    fs::write(&outside, PDF).unwrap();
    let alias = folder.join("alias.pdf");
    std::os::unix::fs::symlink(outside, &alias).unwrap();
    assert!(store.authorize(&alias, &[folder]).is_err());
}

/// Source replacement cannot change existing bytes; print leases survive closing the viewer.
#[test]
fn snapshots_preserve_bytes_and_independent_leases() {
    let root = tempfile::tempdir().unwrap();
    let store = PdfDocuments::new(&root.path().join("cache")).unwrap();
    let path = root.path().join("Über 100% # original.PDF");
    fs::write(&path, PDF).unwrap();
    let original = prepare(&store, &path, "first");
    let print = store.retain(&original.handle).unwrap();
    let snapshot_path = store.snapshot(&original.handle).unwrap().path();
    fs::remove_file(&path).unwrap();
    fs::write(&path, b"%PDF-2.0\nreplacement\n").unwrap();
    assert_eq!(store.read(&original.handle).unwrap(), PDF);
    let response = tauri::ipc::Response::new(store.read(&original.handle).unwrap());
    assert!(matches!(tauri::ipc::IpcResponse::body(response).unwrap(),
        tauri::ipc::InvokeResponseBody::Raw(bytes) if bytes == PDF));
    let replacement = prepare(&store, &path, "second");
    assert_ne!(original.handle, replacement.handle);
    store.release(&original.handle).unwrap();
    assert!(store.read(&original.handle).is_err());
    assert!(store.retain(&original.handle).is_err());
    assert_eq!(store.read(&print.handle).unwrap(), PDF);
    assert!(snapshot_path.exists());
    store.release(&print.handle).unwrap();
    assert!(!snapshot_path.exists());
    store.release(&print.handle).unwrap();
    assert_ne!(store.read(&replacement.handle).unwrap(), PDF);
    let json = serde_json::to_value(&original).unwrap();
    assert_eq!(json["kind"], "pdf");
    assert_eq!(json["name"], "Über 100% # original.PDF");
    assert_eq!(json["size"], PDF.len());
    assert_eq!(
        json["path"],
        canonical(&path).unwrap().to_string_lossy().as_ref()
    );
    assert!(json.get("content").is_none());
}

/// An operation pins bytes until it ends even after the last frontend lease is closed.
#[test]
fn in_flight_ownership_delays_cleanup() {
    let root = tempfile::tempdir().unwrap();
    let store = PdfDocuments::new(&root.path().join("cache")).unwrap();
    let source = root.path().join("document.pdf");
    fs::write(&source, PDF).unwrap();
    let metadata = prepare(&store, &source, "request");
    let pinned = store.snapshot(&metadata.handle).unwrap();
    let path = pinned.path();
    store.release(&metadata.handle).unwrap();
    assert!(path.exists());
    drop(pinned);
    assert!(!path.exists());
}

/// Failed headers and cancelled preparations leave neither pending entries nor partial snapshots.
#[test]
fn errors_and_cancellation_remove_snapshots() {
    let root = tempfile::tempdir().unwrap();
    let store = PdfDocuments::new(&root.path().join("cache")).unwrap();
    let source = root.path().join("document.pdf");
    fs::write(&source, b"not PDF").unwrap();
    let preparation = store.begin("invalid").unwrap();
    let path = preparation.snapshot.directory.path().to_path_buf();
    preparation.copy(&source).unwrap();
    assert!(
        preparation
            .finish(source.clone())
            .unwrap_err()
            .contains("header")
    );
    assert!(!path.exists());
    let preparation = store.begin("cancel").unwrap();
    let path = preparation.snapshot.directory.path().to_path_buf();
    store.cancel("cancel").unwrap();
    assert!(preparation.snapshot.cancellation_path().exists());
    assert!(preparation.copy(&source).unwrap_err().contains("cancelled"));
    drop(preparation);
    assert!(!path.exists());
    assert!(store.resources.lock().unwrap().pending.is_empty());
    store.cancel("unknown").unwrap();
}

/// Cancellation is checked between chunks, and a native result cannot publish after cancellation.
#[test]
fn cancels_mid_copy_and_before_publish() {
    let calls = Cell::new(0);
    let mut output = Vec::new();
    assert!(
        copy_pdf(
            &mut Cursor::new(vec![b'x'; 150_000]),
            &mut output,
            MAX_PDF_SIZE,
            || {
                calls.set(calls.get() + 1);
                if calls.get() > 1 {
                    Err("cancelled".into())
                } else {
                    Ok(())
                }
            }
        )
        .unwrap_err()
        .contains("cancelled")
    );
    assert_eq!(output.len(), 64 * 1024);
    let root = tempfile::tempdir().unwrap();
    let store = PdfDocuments::new(&root.path().join("cache")).unwrap();
    let preparation = store.begin("native").unwrap();
    let path = preparation.snapshot.path();
    fs::write(&path, PDF).unwrap();
    store.cancel("native").unwrap();
    assert!(
        preparation
            .finish(root.path().join("original.pdf"))
            .is_err()
    );
    assert!(!path.exists());
    assert!(store.resources.lock().unwrap().leases.is_empty());
}

/// Copy failures preserve the I/O error rather than returning a truncated successful document.
#[test]
fn propagates_stream_read_errors() {
    /// Reader modelling a provider that fails partway through making content available.
    struct FailedReader;
    impl Read for FailedReader {
        /// Always returns the original provider failure.
        fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
            Err(io::Error::other("provider offline"))
        }
    }
    assert!(
        copy_pdf(&mut FailedReader, &mut Vec::new(), MAX_PDF_SIZE, || Ok(()))
            .unwrap_err()
            .contains("provider offline")
    );
}

/// Limits preparation concurrency, duplicate request tokens, and separately retained print leases.
#[test]
fn bounds_resource_ownership() {
    let root = tempfile::tempdir().unwrap();
    let store = PdfDocuments::new(&root.path().join("cache")).unwrap();
    let mut preparations = Vec::new();
    for index in 0..MAX_PREPARATIONS {
        preparations.push(store.begin(&index.to_string()).unwrap());
    }
    assert!(store.begin("0").is_err());
    assert!(store.begin("overflow").is_err());
    drop(preparations);
    assert!(store.begin("").is_err());
    let path = root.path().join("one.pdf");
    fs::write(&path, PDF).unwrap();
    let original = prepare(&store, &path, "first");
    for _ in 1..MAX_LEASES {
        store.retain(&original.handle).unwrap();
    }
    assert!(store.retain(&original.handle).is_err());
    assert!(store.begin("overflow").is_err());
}

/// Recovers crash leftovers while preserving another process/session's actively locked snapshots.
#[test]
fn recovers_abandoned_sessions_only() {
    let root = tempfile::tempdir().unwrap();
    let first = PdfDocuments::new(root.path()).unwrap();
    let active = first.session.directory.path().to_path_buf();
    let abandoned = root.path().join("session-abandoned");
    fs::create_dir(&abandoned).unwrap();
    File::create(abandoned.join("lock")).unwrap();
    fs::write(abandoned.join("partial.pdf"), PDF).unwrap();
    let interrupted = root.path().join("session-before-lock");
    fs::create_dir(&interrupted).unwrap();
    let second = PdfDocuments::new(root.path()).unwrap();
    assert!(active.exists());
    assert!(!abandoned.exists());
    assert!(!interrupted.exists());
    let second_path = second.session.directory.path().to_path_buf();
    drop(second);
    assert!(!second_path.exists());
    drop(first);
    assert!(!active.exists());
}
