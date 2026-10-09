import XCTest
@testable import DocumentAccess

/// Exercises native print-request completion independently of UIKit presentation.
final class PrintCompletionTests: XCTestCase {
    /// Cancellation resolves successfully and a late error cannot resolve the request again.
    func testCancellationResolvesOnce() {
        var results: [Error?] = []
        let completion = PrintCompletion { results.append($0) }
        completion.finish()
        completion.finish(NSError(domain: "test", code: 1))
        XCTAssertEqual(results.count, 1)
        XCTAssertNil(results[0])
    }

    /// Presentation failures retain their diagnostic when UIKit later reports cancellation.
    func testPresentationFailurePreservesError() {
        let failure = NSError(domain: "test", code: 2)
        var result: NSError?
        let completion = PrintCompletion { result = $0 as NSError? }
        completion.finish(failure)
        completion.finish()
        XCTAssertEqual(result, failure)
    }

    /// Reentrant cleanup cannot call the pending callback twice.
    func testReentrantCompletion() {
        var calls = 0
        var completion: PrintCompletion!
        completion = PrintCompletion { _ in
            calls += 1
            completion.finish()
        }
        completion.finish()
        XCTAssertEqual(calls, 1)
    }
}
