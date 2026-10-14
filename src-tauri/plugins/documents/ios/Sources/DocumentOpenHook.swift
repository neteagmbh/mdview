import Foundation
import ObjectiveC

/// Retains original OS URLs before Tauri serializes them and loses NSURL access metadata.
enum DocumentOpenHook {
    /// Hooks Tauri's application delegate while preserving its original file-open callback.
    static func install(className: String = "AppDelegate", receive: @escaping (URL) -> Void) -> Bool {
        let selector = NSSelectorFromString("application:openURL:options:")
        guard let delegate = NSClassFromString(className),
              let method = class_getInstanceMethod(delegate, selector) else { return false }
        /// The Objective-C application delegate ABI forwarded after URL access is retained.
        typealias Original = @convention(c) (AnyObject, Selector, AnyObject, NSURL, NSDictionary) -> Bool
        let original = unsafeBitCast(method_getImplementation(method), to: Original.self)
        let block: @convention(block) (AnyObject, AnyObject, NSURL, NSDictionary) -> Bool = {
            delegate, application, url, options in
            if url.isFileURL { receive(url as URL) }
            return original(delegate, selector, application, url, options)
        }
        method_setImplementation(method, imp_implementationWithBlock(block))
        return true
    }
}
