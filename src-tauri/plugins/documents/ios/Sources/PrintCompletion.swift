import Foundation

/// Resolves a print request exactly once, including cancellation and presentation failure.
final class PrintCompletion {
    /// Pending completion, cleared before calling user code to allow reentrant cleanup.
    private var callback: ((Error?) -> Void)?

    /// Indicates whether resources still belong to this job rather than a later presentation.
    var isPending: Bool { callback != nil }

    /// Retains the completion until UIKit closes the print UI or reports an error.
    init(_ callback: @escaping (Error?) -> Void) {
        self.callback = callback
    }

    /// Finishes the request; later UIKit callbacks cannot resolve the same request again.
    func finish(_ error: Error? = nil) {
        let callback = self.callback
        self.callback = nil
        callback?(error)
    }
}
