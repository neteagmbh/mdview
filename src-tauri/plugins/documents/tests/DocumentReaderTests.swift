import Foundation
import XCTest
@testable import DocumentAccess

/// Exercises the same Foundation file-coordination reader used by the iOS plugin.
final class DocumentReaderTests: XCTestCase {
    /// Creates an isolated directory and removes it even when an assertion fails.
    private func withDirectory(_ body: (URL) throws -> Void) throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: url) }
        try body(url)
    }

    /// Confirms URL decoding preserves spaces, percent signs, and Unicode filenames.
    func testDecodedProviderPath() throws {
        try withDirectory { directory in
            let url = directory.appendingPathComponent("Über 100% iCloud.md")
            let text = "# Grüße\n"
            try text.write(to: url, atomically: true, encoding: .utf8)
            let result = try DocumentReader.read(url, maxSize: 1024)
            XCTAssertEqual(result.path, url.path)
            XCTAssertEqual(result.content, text)
        }
    }

    /// Verifies exact limits, oversized input, empty content, invalid UTF-8, and missing files.
    func testValidation() throws {
        try withDirectory { directory in
            let url = directory.appendingPathComponent("document.md")
            try Data("abcd".utf8).write(to: url)
            XCTAssertEqual(try DocumentReader.read(url, maxSize: 4).content, "abcd")
            XCTAssertThrowsError(try DocumentReader.read(url, maxSize: 3))
            try Data().write(to: url)
            XCTAssertEqual(try DocumentReader.read(url, maxSize: 4).content, "")
            try Data([0xff]).write(to: url)
            XCTAssertThrowsError(try DocumentReader.read(url, maxSize: 4))
            try FileManager.default.removeItem(at: url)
            XCTAssertThrowsError(try DocumentReader.read(url, maxSize: 4))
        }
    }

    /// Ensures coordinated reads include all chunks rather than truncating at one read.
    func testMultipleChunks() throws {
        try withDirectory { directory in
            let url = directory.appendingPathComponent("large.md")
            let text = String(repeating: "x", count: 150_000)
            try text.write(to: url, atomically: true, encoding: .utf8)
            XCTAssertEqual(try DocumentReader.read(url, maxSize: 150_000).content, text)
            XCTAssertThrowsError(try DocumentReader.read(url, maxSize: 149_999))
        }
    }
}
