import Foundation
import Tauri
import UIKit
import UniformTypeIdentifiers
import WebKit

/// Options for selecting a single document or a folder in Apple's Files UI.
private struct PickOptions: Decodable {
    let directory: Bool
}

/// Options for bounded reads of documents supplied by iCloud or another provider.
private struct ReadOptions: Decodable {
    let path: String
    let maxSize: Int
}

/// The original file URL supplied by an OS Open In request.
private struct OpenOptions: Decodable {
    let url: String
}

/// Rust-owned staging paths and a bounded copy limit; binary bytes never cross the JSON bridge.
private struct SnapshotOptions: Decodable {
    /// Source identity supplied by an existing native grant.
    let path: String
    /// Private destination allocated by Rust inside its cache session.
    let destination: String
    /// Rust creates this marker when the frontend cancels preparation.
    let cancellationPath: String
    /// Independent PDF input-size bound.
    let maxSize: Int
}

/// Owns document-picker callbacks and long-lived security-scoped grants.
@available(iOS 17.0, *)
final class DocumentsPlugin: Plugin, UIDocumentPickerDelegate {
    /// Persistent bookmarks keyed by the path used by the Rust recent-folder list.
    private let bookmarkKey = "mdview.documentBookmarks"
    /// Started scopes remain active for folder scanning, watching, and image loading.
    private var scopes: [String: URL] = [:]
    /// Resolves old persisted paths to the current URL returned by a bookmark.
    private var restoredURLs: [String: URL] = [:]
    /// Pending picker request; simultaneous presentations are rejected.
    private var pending: Invoke?
    /// Webview supplied by Tauri, used as the source of native print formatters.
    private weak var printWebView: WKWebView?
    /// Retains the print delegate and formatter until the AirPrint dialog closes.
    private var printer: DocumentPrinting?

    /// Captures the app webview without taking ownership of its lifecycle.
    override func load(webview: WKWebView) {
        printWebView = webview
    }

    /// Opens the native AirPrint UI instead of relying on JavaScript window.print().
    @objc public func print(_ invoke: Invoke) {
        DispatchQueue.main.async {
            guard self.printer == nil else {
                invoke.reject("A print dialog is already open.")
                return
            }
            guard let webView = self.printWebView,
                  let presenter = self.manager.viewController,
                  presenter.presentedViewController == nil else {
                invoke.reject("The print dialog cannot be presented right now.")
                return
            }
            let printer = DocumentPrinting(webView: webView, presenter: presenter) { [weak self] error in
                self?.printer = nil
                if let error {
                    invoke.reject("Could not print the document: \(error.localizedDescription)")
                } else {
                    invoke.resolve()
                }
            }
            self.printer = printer
            printer.start()
        }
    }

    /// Restores grants before Rust tries to load the last document or recent folders.
    override init() {
        super.init()
        var bookmarks = UserDefaults.standard.dictionary(forKey: bookmarkKey) as? [String: Data] ?? [:]
        for (path, data) in bookmarks {
            do {
                var stale = false
                let url = try URL(resolvingBookmarkData: data, options: [], relativeTo: nil,
                                  bookmarkDataIsStale: &stale)
                if url.startAccessingSecurityScopedResource() {
                    scopes[path] = url
                }
                // App-container bookmarks may need no security scope; the bookmark still proves selection.
                restoredURLs[path] = url
                if stale {
                    bookmarks[path] = try url.bookmarkData(options: .minimalBookmark,
                                                          includingResourceValuesForKeys: nil,
                                                          relativeTo: nil)
                }
            } catch {
                // Keep unavailable provider bookmarks so they can be retried next launch.
            }
        }
        UserDefaults.standard.set(bookmarks, forKey: bookmarkKey)
        if !DocumentOpenHook.install(receive: { [weak self] url in
            guard let self else { return }
            do {
                try self.retainDocument(url)
            } catch {
                NSLog("Could not retain incoming document: %@", error.localizedDescription)
            }
        }) {
            NSLog("Could not install the Tauri document URL access hook")
        }
    }

    /// Balances each successfully acquired security scope.
    deinit {
        for url in scopes.values { url.stopAccessingSecurityScopedResource() }
    }

    /// Persists access while keeping the original NSURL security-scoped resource alive.
    private func retainDocument(_ url: URL) throws {
        let started = url.startAccessingSecurityScopedResource()
        do {
            let bookmark = try url.bookmarkData(options: .minimalBookmark,
                                               includingResourceValuesForKeys: nil, relativeTo: nil)
            var bookmarks = UserDefaults.standard.dictionary(forKey: bookmarkKey) as? [String: Data] ?? [:]
            bookmarks[url.path] = bookmark
            UserDefaults.standard.set(bookmarks, forKey: bookmarkKey)
            if started {
                scopes[url.path]?.stopAccessingSecurityScopedResource()
                scopes[url.path] = url
            }
            restoredURLs[url.path] = url
        } catch {
            if started { url.stopAccessingSecurityScopedResource() }
            throw error
        }
    }

    /// Resolves an OS document through the retained original URL rather than reconstructing its grant.
    @objc public func accept(_ invoke: Invoke) throws {
        let options = try invoke.parseArgs(OpenOptions.self)
        guard let url = URL(string: options.url), url.isFileURL else {
            invoke.reject("Only local document file URLs can be opened.")
            return
        }
        try retainDocument(restoredURLs[url.path] ?? url)
        invoke.resolve(["path": url.path])
    }

    /// Presents a folder picker or an in-place document picker, including iCloud Drive.
    @objc public func pick(_ invoke: Invoke) throws {
        let options = try invoke.parseArgs(PickOptions.self)
        DispatchQueue.main.async {
            guard self.pending == nil else {
                invoke.reject("A document picker is already open.")
                return
            }
            guard let presenter = self.manager.viewController, presenter.presentedViewController == nil else {
                invoke.reject("The document picker cannot be presented right now.")
                return
            }
            self.pending = invoke
            // Advertise Markdown and the system PDF type; Rust validates the actual file content.
            let markdownTypes = ["md", "markdown", "mdown", "mkd", "mkdn"].compactMap { UTType(filenameExtension: $0) }
            let picker = UIDocumentPickerViewController(
                forOpeningContentTypes: options.directory ? [.folder] : markdownTypes + [.pdf], asCopy: false)
            picker.delegate = self
            picker.allowsMultipleSelection = false
            picker.modalPresentationStyle = .fullScreen
            presenter.present(picker, animated: true)
        }
    }

    /// Retains the original URL's access grant and returns a decoded filesystem path.
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let invoke = pending else { return }
        pending = nil
        guard let url = urls.first else {
            invoke.resolve(["path": NSNull()])
            return
        }
        do {
            try retainDocument(url)
            invoke.resolve(["path": url.path])
        } catch {
            invoke.reject("Could not retain access to the selected document: \(error.localizedDescription)")
        }
    }

    /// Resolves cancellation without changing the active document or folder list.
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pending?.resolve(["path": NSNull()])
        pending = nil
    }

    /// Coordinates provider downloads and reads away from the UIKit main thread.
    @objc public func read(_ invoke: Invoke) throws {
        let options = try invoke.parseArgs(ReadOptions.self)
        let url = restoredURLs[options.path] ?? URL(fileURLWithPath: options.path)
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let document = try DocumentReader.read(url, maxSize: options.maxSize)
                invoke.resolve(["path": document.path, "content": document.content])
            } catch {
                invoke.reject("Could not read the provider document: \(error.localizedDescription)")
            }
        }
    }

    /// Resolves file/folder grants before copying provider bytes into a Rust-owned private snapshot.
    @objc public func snapshot(_ invoke: Invoke) throws {
        let options = try invoke.parseArgs(SnapshotOptions.self)
        let source = try DocumentGrants.resolve(options.path, grants: restoredURLs)
        let destination = URL(fileURLWithPath: options.destination).standardizedFileURL
        let cancellation = URL(fileURLWithPath: options.cancellationPath).standardizedFileURL
        let caches = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask,
                                                appropriateFor: nil, create: true).resolvingSymlinksInPath()
        guard destination.deletingLastPathComponent() == cancellation.deletingLastPathComponent(),
              destination.lastPathComponent == "document.pdf", cancellation.lastPathComponent == "cancelled",
              destination.deletingLastPathComponent().resolvingSymlinksInPath().path.hasPrefix(caches.path + "/") else {
            invoke.reject("Invalid private PDF snapshot destination.")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let path = try DocumentSnapshots.prepare(source, destination: destination, maxSize: options.maxSize,
                    isCancelled: { FileManager.default.fileExists(atPath: cancellation.path) })
                invoke.resolve(["path": path])
            } catch {
                invoke.reject("Could not prepare the provider PDF: \(error.localizedDescription)")
            }
        }
    }
}

/// Entry point called by Tauri when registering the native plugin.
@_cdecl("init_plugin_documents")
@available(iOS 17.0, *)
public func initDocumentsPlugin() -> Plugin {
    DocumentsPlugin()
}
