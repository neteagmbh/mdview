//! Complete-source PDF printing, separate from Markdown's decorated webview print path.

use tauri::Manager;

/// Prints a pinned original snapshot on Apple; desktop raster preparation is selected elsewhere.
#[tauri::command]
pub async fn print_pdf_document(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    handle: String,
    password: Option<String>,
) -> Result<bool, String> {
    let source = app
        .state::<crate::documents::PdfDocuments>()
        .print_source(&handle)?;
    #[cfg(target_os = "macos")]
    {
        macos::print(&webview, source, password).await?;
        Ok(true)
    }
    #[cfg(target_os = "ios")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let result = webview
                .state::<tauri_plugin_documents::Documents<tauri::Wry>>()
                .print_pdf(
                    &source.path().to_string_lossy(),
                    &source.name,
                    password.as_deref(),
                );
            drop(source);
            result.map(|()| true)
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = (source, webview, password);
        Ok(false)
    }
}

/// Opens a system dialog for the complete prepared print DOM, never the virtualized PDF viewer.
#[tauri::command]
#[allow(unsafe_code)] // WebView2 requires UI-thread COM calls through Tauri's native controller.
pub async fn print_pdf_pages(webview: tauri::Webview) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM, ICoreWebView2_16,
        };
        use windows::core::Interface;
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        webview
            .with_webview(move |platform| {
                // SAFETY: Tauri calls this closure on its owning UI/COM thread. All COM references
                // are scoped to the callback; the system dialog requires explicit user confirmation.
                let result = unsafe {
                    platform
                        .controller()
                        .CoreWebView2()
                        .and_then(|view| view.cast::<ICoreWebView2_16>())
                        .and_then(|view| view.ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM))
                        .map(|()| true)
                        .map_err(|error| format!("Could not open PDF system print dialog: {error}"))
                };
                let _ = sender.send(result);
            })
            .map_err(|error| error.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            receiver.recv().map_err(|error| error.to_string())?
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(target_os = "linux")]
    {
        webview
            .print()
            .map_err(|error| format!("Could not open PDF print dialog: {error}"))?;
        Ok(true)
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = webview;
        Err("Prepared-page printing is not used on this platform.".into())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2::AnyThread;
    use objc2_app_kit::NSPrintInfo;
    use objc2_foundation::{NSCopying, NSData, NSString};
    use objc2_pdf_kit::{PDFDocument, PDFPrintScalingMode};

    /// Uses `PDFKit`'s original vector/annotation print operation and waits through cancellation.
    #[allow(unsafe_code)]
    pub async fn print(
        webview: &tauri::Webview,
        source: crate::documents::PdfPrintSource,
        password: Option<String>,
    ) -> Result<(), String> {
        let (source, bytes) = tauri::async_runtime::spawn_blocking(move || {
            let bytes = std::fs::read(source.path())
                .map_err(|error| format!("Could not read PDF print input: {error}"));
            (source, bytes)
        })
        .await
        .map_err(|error| error.to_string())?;
        let bytes = bytes?;
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        webview
            .with_webview(move |_platform| {
                // SAFETY: PDFKit/AppKit objects are created, used, and dropped on Tauri's UI thread.
                // NSData copies valid owned bytes. The synchronous modal operation retains its view;
                // source, document and print-info stay live until printing or cancellation returns.
                let result = unsafe {
                    (|| {
                        let data = NSData::with_bytes(&bytes);
                        let pdf = PDFDocument::initWithData(PDFDocument::alloc(), &data)
                            .ok_or("The original PDF could not be prepared for printing.")?;
                        if pdf.isLocked()
                            && !password.as_deref().is_some_and(|value| {
                                pdf.unlockWithPassword(&NSString::from_str(value))
                            })
                        {
                            return Err("The PDF print password was not accepted.".into());
                        }
                        if !pdf.allowsPrinting() {
                            return Err("Printing is disabled by this PDF's permissions.".into());
                        }
                        if pdf.pageCount() == 0 {
                            return Err("The PDF contains no printable pages.".into());
                        }
                        let info = NSPrintInfo::sharedPrintInfo().copy();
                        info.setTopMargin(0.0);
                        info.setBottomMargin(0.0);
                        info.setLeftMargin(0.0);
                        info.setRightMargin(0.0);
                        let mtm = objc2::MainThreadMarker::new()
                            .ok_or("PDF printing requires the UI thread.")?;
                        let operation = pdf
                            .printOperationForPrintInfo_scalingMode_autoRotate(
                                Some(&info),
                                PDFPrintScalingMode::PageScaleDownToFit,
                                true,
                                mtm,
                            )
                            .ok_or("The PDF print operation could not be created.")?;
                        operation.setJobTitle(Some(&NSString::from_str(&source.name)));
                        operation.setShowsPrintPanel(true);
                        // AppKit reports false for cancellation; no partial-view fallback is attempted.
                        let _ = operation.runOperation();
                        Ok(())
                    })()
                };
                drop(source);
                let _ = sender.send(result);
            })
            .map_err(|error| error.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            receiver.recv().map_err(|error| error.to_string())?
        })
        .await
        .map_err(|error| error.to_string())?
    }
}
