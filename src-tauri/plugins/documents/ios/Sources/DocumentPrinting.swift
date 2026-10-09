import UIKit
import WebKit

/// Owns the AirPrint presentation and keeps its source webview alive until completion.
final class DocumentPrinting: NSObject, UIPrintInteractionControllerDelegate {
    /// Source document; CSS applies print-only colors and diagram images during pagination.
    private let webView: WKWebView
    /// Presents within the scene containing the document being printed.
    private weak var presenter: UIViewController?
    /// Resolves the plugin request once even if presentation and completion both fail.
    private let completion: PrintCompletion

    /// Retains the document and its callback for the lifetime of the print dialog.
    init(webView: WKWebView, presenter: UIViewController, completion: @escaping (Error?) -> Void) {
        self.webView = webView
        self.presenter = presenter
        self.completion = PrintCompletion(completion)
        super.init()
    }

    /// Configures native page margins and presents the iPad popover or iPhone sheet.
    func start() {
        guard UIPrintInteractionController.isPrintingAvailable, let presenter else {
            finish(NSError(domain: "mdview.printing", code: 1,
                           userInfo: [NSLocalizedDescriptionKey: "AirPrint is unavailable."]))
            return
        }
        let controller = UIPrintInteractionController.shared
        let info = UIPrintInfo(dictionary: nil)
        info.jobName = webView.title ?? "mdview"
        info.outputType = .general
        controller.printInfo = info
        controller.delegate = self
        let formatter = webView.viewPrintFormatter()
        let pointsPerMillimetre = 72.0 / 25.4
        formatter.perPageContentInsets = UIEdgeInsets(
            top: 26 * pointsPerMillimetre, left: 18 * pointsPerMillimetre,
            bottom: 20 * pointsPerMillimetre, right: 18 * pointsPerMillimetre)
        controller.printFormatter = formatter
        let callback: UIPrintInteractionController.CompletionHandler = { [weak self] _, _, error in
            self?.finish(error)
        }
        let presented: Bool
        if presenter.traitCollection.userInterfaceIdiom == .pad {
            let anchor = CGRect(x: presenter.view.bounds.midX, y: 0, width: 1, height: 1)
            presented = controller.present(from: anchor, in: presenter.view,
                                           animated: true, completionHandler: callback)
        } else {
            presented = controller.present(animated: true, completionHandler: callback)
        }
        if !presented {
            finish(NSError(domain: "mdview.printing", code: 2,
                           userInfo: [NSLocalizedDescriptionKey: "The print dialog could not open."]))
        }
    }

    /// Anchors native presentation to the app's current scene rather than another window.
    func printInteractionControllerParentViewController(
        _ printInteractionController: UIPrintInteractionController
    ) -> UIViewController? {
        presenter
    }

    /// Releases print resources and restores frontend assets after printing or cancellation.
    private func finish(_ error: Error?) {
        guard completion.isPending else { return }
        let controller = UIPrintInteractionController.shared
        controller.delegate = nil
        controller.printFormatter = nil
        webView.evaluateJavaScript("window.dispatchEvent(new Event('afterprint'))", completionHandler: nil)
        completion.finish(error)
    }
}
