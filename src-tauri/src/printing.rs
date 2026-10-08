//! macOS printing with a single source of truth for printable page dimensions.

use objc2_app_kit::{NSPrintInfo, NSWindow};
use objc2_foundation::NSCopying;
use objc2_web_kit::WKWebView;

/// Applies document margins in `AppKit`'s point units.
///
/// CSS page margins must be `auto` for this operation so `WebKit` inherits these
/// dimensions during both native page counting and drawing.
fn configure_document_margins(info: &NSPrintInfo) {
    let points_per_mm = 72.0 / 25.4;
    info.setTopMargin(26.0 * points_per_mm);
    info.setBottomMargin(20.0 * points_per_mm);
    info.setLeftMargin(18.0 * points_per_mm);
    info.setRightMargin(18.0 * points_per_mm);
    info.setHorizontallyCentered(false);
    info.setVerticallyCentered(false);
}

/// Opens a modal print operation on Tauri's UI thread with native document margins.
#[allow(unsafe_code)] // AppKit integration requires Tauri's documented native pointers.
pub fn open_print_dialog(webview: &tauri::Webview) -> Result<(), String> {
    webview
        .with_webview(|platform| {
            // SAFETY: Tauri supplies live WKWebView and NSWindow pointers on the UI
            // thread for this callback. References do not escape the callback. The
            // operation retains its print view and info; no delegate, selector or
            // context pointer is supplied to the asynchronous modal operation.
            unsafe {
                let view = &*platform.inner().cast::<WKWebView>();
                let window = &*platform.ns_window().cast::<NSWindow>();
                let info = NSPrintInfo::sharedPrintInfo().copy();
                configure_document_margins(&info);
                let operation = view.printOperationWithPrintInfo(&info);
                operation.setCanSpawnSeparateThread(true);
                operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                    window,
                    None,
                    None,
                    std::ptr::null_mut(),
                );
            }
        })
        .map_err(|error| format!("Could not open print dialog: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Native margins preserve paper settings and leave shared preferences untouched.
    #[test]
    fn document_margins_use_points_without_changing_shared_print_info() {
        let shared = NSPrintInfo::sharedPrintInfo();
        let original_margins = (
            shared.topMargin(),
            shared.bottomMargin(),
            shared.leftMargin(),
            shared.rightMargin(),
        );
        let info = shared.copy();
        configure_document_margins(&info);
        assert!((info.topMargin() - 73.700_787_401_574_81).abs() < 0.001);
        assert!((info.bottomMargin() - 56.692_913_385_826_78).abs() < 0.001);
        assert!((info.leftMargin() - 51.023_622_047_244_096).abs() < 0.001);
        assert_eq!(info.rightMargin(), info.leftMargin());
        assert_eq!(info.paperSize(), shared.paperSize());
        assert_eq!(
            original_margins,
            (
                shared.topMargin(),
                shared.bottomMargin(),
                shared.leftMargin(),
                shared.rightMargin()
            )
        );
        assert!(!info.isHorizontallyCentered());
        assert!(!info.isVerticallyCentered());
    }
}
