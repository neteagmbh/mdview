import AppKit
import PDFKit
import WebKit

/// Serves a production bundle through the same custom scheme and CSP used by Tauri on Apple.
final class ProbeResources: NSObject, WKURLSchemeHandler {
    /// Production frontend directory containing the opt-in probe page.
    let root: URL
    /// Application policy copied from maintained Tauri configuration.
    let policy: String

    /// Captures only the explicitly selected production bundle and policy.
    init(root: URL, policy: String) {
        self.root = root.standardizedFileURL
        self.policy = policy
    }

    /// Supplies local bytes with correct script/WASM MIME types and no filesystem traversal.
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        do {
            let url = urlSchemeTask.request.url!
            let path = root.appendingPathComponent(url.path).standardizedFileURL
            guard path.path.hasPrefix(root.path + "/") else { throw CocoaError(.fileReadNoPermission) }
            let data = try Data(contentsOf: path)
            let types = ["html": "text/html", "js": "text/javascript", "mjs": "text/javascript",
                         "css": "text/css", "wasm": "application/wasm", "svg": "image/svg+xml"]
            let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": types[path.pathExtension] ?? "application/octet-stream",
                               "Content-Security-Policy": policy])!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            urlSchemeTask.didFailWithError(error)
        }
    }

    /// No background reads remain once a synchronous resource response has completed.
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

/// Receives real WebKit observations and verifies complete paginated PDF print output.
final class ProbeResult: NSObject, WKScriptMessageHandler {
    /// Webview whose print layout must be verified after the page probe succeeds.
    weak var webView: WKWebView?
    /// Destination for the native print-to-PDF result.
    let output: URL
    /// Observations retained until the asynchronous native print operation completes.
    private var pending: [String: Any]?
    /// Keeps the native operation alive during PDF generation.
    private var printOperation: NSPrintOperation?

    /// Records the explicit output destination.
    init(output: URL) { self.output = output }

    /// Saves AppKit print output without presenting a printer dialog or sending a print job.
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let result = message.body as? [String: Any], let webView else { return }
        // Return the WebKit message callback before requesting synchronous print layout.
        DispatchQueue.main.async { self.finish(result, webView: webView) }
    }

    /// Runs printing after WebKit is free to service print-layout requests.
    private func finish(_ observations: [String: Any], webView: WKWebView) {
        let result = observations
        if result["status"] as? String == "passed" {
            let info = NSPrintInfo()
            info.paperSize = NSSize(width: 612, height: 792)
            info.topMargin = 0
            info.bottomMargin = 0
            info.leftMargin = 0
            info.rightMargin = 0
            info.jobDisposition = .save
            info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = output
            let operation = webView.printOperation(with: info)
            operation.showsPrintPanel = false
            operation.showsProgressPanel = false
            pending = result
            printOperation = operation
            fputs("Rendering checks passed; starting native print-to-PDF.\n", stderr)
            operation.runModal(for: webView.window!, delegate: self,
                didRun: #selector(didPrint(_:success:context:)), contextInfo: nil)
            return
        }
        publish(result)
    }

    /// Verifies asynchronous AppKit output includes all three pages.
    @objc private func didPrint(_ operation: NSPrintOperation, success: Bool, context: UnsafeMutableRawPointer?) {
        var result = pending!
        let document = PDFDocument(url: output)
        result["nativePrintPages"] = document?.pageCount ?? 0
        result["nativePrintSucceeded"] = success
        let thumbnails = (0..<(document?.pageCount ?? 0)).compactMap { index -> Data? in
            guard let page = document?.page(at: index),
                  let tiff = page.thumbnail(of: NSSize(width: 612, height: 792), for: .mediaBox).tiffRepresentation,
                  let bitmap = NSBitmapImageRep(data: tiff),
                  let png = bitmap.representation(using: .png, properties: [:]) else { return nil }
            try? png.write(to: output.deletingPathExtension().appendingPathExtension("page-\(index + 1).png"))
            return png
        }
        result["nativePrintDistinctPages"] = Set(thumbnails).count
        if !success || document?.pageCount != 3 || Set(thumbnails).count != 3 {
            result["status"] = "failed"
            result["error"] = "Native print output must contain exactly three pages."
        }
        publish(result)
    }

    /// Writes final machine-readable observations and terminates the isolated test process.
    private func publish(_ result: [String: Any]) {
        let data = try! JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
        print(String(decoding: data, as: UTF8.self))
        fflush(stdout)
        exit(result["status"] as? String == "passed" ? 0 : 1)
    }
}

let arguments = CommandLine.arguments
guard arguments.count == 3 || arguments.count == 4 else {
    fatalError("Usage: swift scripts/pdfjs-wk-probe.swift <production-dist> <print-output.pdf> [loopback-dev-url]")
}
let root = URL(fileURLWithPath: arguments[1], isDirectory: true)
let configuration = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    .appendingPathComponent("../src-tauri/tauri.conf.json")
let config = try JSONSerialization.jsonObject(with: Data(contentsOf: configuration)) as! [String: Any]
let app = config["app"] as! [String: Any]
let security = app["security"] as! [String: Any]
let resources = ProbeResources(root: root, policy: security["csp"] as! String)
let result = ProbeResult(output: URL(fileURLWithPath: arguments[2]))
let webConfig = WKWebViewConfiguration()
webConfig.websiteDataStore = .nonPersistent()
webConfig.setURLSchemeHandler(resources, forURLScheme: "tauri")
webConfig.userContentController.add(result, name: "pdfProbe")
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 960, height: 720),
                      styleMask: [.titled, .closable], backing: .buffered, defer: false)
window.title = "mdview PDF.js runtime check"
let webView = WKWebView(frame: window.contentView!.bounds, configuration: webConfig)
window.contentView = webView
result.webView = webView
window.makeKeyAndOrderFront(nil)
let url = arguments.count == 4 ? URL(string: arguments[3])!
    : URL(string: "tauri://localhost/dev/pdfjs-probe.html")!
precondition(url.scheme == "tauri" || ["localhost", "127.0.0.1"].contains(url.host), "Only local probe URLs are allowed.")
webView.load(URLRequest(url: url))
DispatchQueue.global().asyncAfter(deadline: .now() + 45) {
    fputs("PDF.js WebKit probe timed out.\n", stderr)
    exit(1)
}
application.run()
