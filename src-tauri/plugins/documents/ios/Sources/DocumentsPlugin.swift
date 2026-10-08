import Foundation
import Tauri
import UIKit
import UniformTypeIdentifiers

/// Options for selecting a single document or a folder in Apple's Files UI.
private struct PickOptions: Decodable {
    let directory: Bool
}

/// Options for bounded reads of documents supplied by iCloud or another provider.
private struct ReadOptions: Decodable {
    let path: String
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
                    restoredURLs[path] = url
                    if stale {
                        bookmarks[path] = try url.bookmarkData(options: .minimalBookmark,
                                                              includingResourceValuesForKeys: nil,
                                                              relativeTo: nil)
                    }
                }
            } catch {
                // Keep unavailable provider bookmarks so they can be retried next launch.
            }
        }
        UserDefaults.standard.set(bookmarks, forKey: bookmarkKey)
    }

    /// Balances each successfully acquired security scope.
    deinit {
        for url in scopes.values { url.stopAccessingSecurityScopedResource() }
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
            // Accept provider documents; Rust validates Markdown extensions after selection.
            let picker = UIDocumentPickerViewController(
                forOpeningContentTypes: options.directory ? [.folder] : [.data], asCopy: false)
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
            invoke.resolve(["path": url.path])
        } catch {
            if started { url.stopAccessingSecurityScopedResource() }
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
}

/// Entry point called by Tauri when registering the native plugin.
@_cdecl("init_plugin_documents")
@available(iOS 17.0, *)
func initDocumentsPlugin() -> Plugin {
    DocumentsPlugin()
}
