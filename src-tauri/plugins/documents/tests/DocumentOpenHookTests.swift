import Foundation
import XCTest
@testable import DocumentAccess

/// Models Tauri's Objective-C delegate without requiring UIKit in the macOS test harness.
@objc(MDViewTestAppDelegate)
final class TestAppDelegate: NSObject {
    /// Records the original callback's deliveries.
    var opened: [NSURL] = []

    /// Matches the native file-open selector and preserves a deliberately false return value.
    @objc(application:openURL:options:)
    dynamic func open(_ application: NSObject, url: NSURL, options: NSDictionary) -> Bool {
        opened.append(url)
        return false
    }
}

/// Verifies original URL capture occurs before forwarding to the framework delegate.
final class DocumentOpenHookTests: XCTestCase {
    /// Confirms file URLs reach the hook, web URLs bypass it, and the original result survives.
    func testCapturesFileURLsAndForwardsOriginalCallback() {
        let delegate = TestAppDelegate()
        var received: [URL] = []
        XCTAssertTrue(DocumentOpenHook.install(className: "MDViewTestAppDelegate") { url in
            XCTAssertEqual(delegate.opened.count, 0)
            received.append(url)
        })
        let file = NSURL(fileURLWithPath: "/tmp/Über 100% # notes.md")
        XCTAssertFalse(delegate.open(NSObject(), url: file, options: [:]))
        XCTAssertEqual(received, [file as URL])
        XCTAssertEqual(delegate.opened, [file])
        let web = NSURL(string: "https://example.com/file.md")!
        XCTAssertFalse(delegate.open(NSObject(), url: web, options: [:]))
        XCTAssertEqual(received.count, 1)
        XCTAssertEqual(delegate.opened, [file, web])
        XCTAssertFalse(DocumentOpenHook.install(className: "NoSuchDocumentDelegate") { _ in })
    }
}
