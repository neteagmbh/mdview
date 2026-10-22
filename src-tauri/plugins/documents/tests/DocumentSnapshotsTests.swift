import Foundation
import XCTest
@testable import DocumentAccess

/// Tests the provider snapshot implementation shared with the actual iOS plugin.
final class DocumentSnapshotsTests: XCTestCase {
    /// Creates an isolated provider/cache fixture and always removes it.
    private func withDirectory(_ body: (URL) throws -> Void) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try body(root)
    }

    /// Provider bytes remain binary, source identity survives replacement, and the snapshot is independent.
    func testBinarySnapshotAndSourceIdentity() throws {
        try withDirectory { root in
            let source = root.appendingPathComponent("Über 100% # source.PDF")
            let destination = root.appendingPathComponent("snapshot.pdf")
            let bytes = Data(Array("%PDF-1.7\n".utf8) + [0xff, 0xfe])
            try bytes.write(to: source)
            XCTAssertEqual(try DocumentSnapshots.prepare(source, destination: destination, maxSize: bytes.count), source.path)
            try Data("replacement".utf8).write(to: source, options: .atomic)
            XCTAssertEqual(try Data(contentsOf: destination), bytes)
        }
    }

    /// Bounds, directories, missing input, invalid extensions, and existing destinations fail without clobbering.
    func testValidationAndCleanup() throws {
        try withDirectory { root in
            let source = root.appendingPathComponent("source.pdf")
            let destination = root.appendingPathComponent("snapshot.pdf")
            try Data(repeating: 0xff, count: 150_000).write(to: source)
            XCTAssertThrowsError(try DocumentSnapshots.prepare(source, destination: destination, maxSize: 149_999))
            XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
            XCTAssertThrowsError(try DocumentSnapshots.prepare(source, destination: destination, maxSize: 0))
            XCTAssertThrowsError(try DocumentSnapshots.prepare(root, destination: destination, maxSize: 200_000))
            XCTAssertThrowsError(try DocumentSnapshots.prepare(root.appendingPathComponent("missing.pdf"), destination: destination, maxSize: 200_000))
            try Data("keep".utf8).write(to: destination)
            XCTAssertThrowsError(try DocumentSnapshots.prepare(source, destination: destination, maxSize: 200_000))
            XCTAssertEqual(try Data(contentsOf: destination), Data("keep".utf8))
        }
    }

    /// Cancelling during a multi-chunk copy or immediately before returning removes partial output.
    func testCancellationRemovesPartialSnapshots() throws {
        try withDirectory { root in
            let source = root.appendingPathComponent("source.pdf")
            let destination = root.appendingPathComponent("snapshot.pdf")
            try Data(repeating: 0xff, count: 150_000).write(to: source)
            var checks = 0
            XCTAssertThrowsError(try DocumentSnapshots.prepare(source, destination: destination, maxSize: 150_000,
                isCancelled: { checks += 1; return checks >= 4 }))
            XCTAssertGreaterThanOrEqual(checks, 4)
            XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
            XCTAssertThrowsError(try DocumentSnapshots.prepare(source, destination: destination, maxSize: 150_000,
                isCancelled: { true }))
            XCTAssertFalse(FileManager.default.fileExists(atPath: destination.path))
        }
    }

    /// The streaming loop itself catches growth beyond a preflight size and respects the exact byte bound.
    func testCopyGrowthLimit() throws {
        try withDirectory { root in
            let source = root.appendingPathComponent("growing.pdf")
            let destination = root.appendingPathComponent("snapshot.pdf")
            try Data("12345".utf8).write(to: source)
            try Data().write(to: destination)
            let input = try FileHandle(forReadingFrom: source)
            let output = try FileHandle(forWritingTo: destination)
            defer { try? input.close(); try? output.close() }
            XCTAssertThrowsError(try DocumentSnapshots.copy(input: input, output: output, maxSize: 4, isCancelled: { false }))
            XCTAssertLessThanOrEqual(try Data(contentsOf: destination).count, 4)
        }
    }

    /// Exact file grants do not authorize siblings; moved bookmarks resolve to the current source URL.
    func testFileOnlyAndStalePathGrants() throws {
        try withDirectory { root in
            let current = root.appendingPathComponent("current.pdf")
            try Data().write(to: current)
            let stale = root.appendingPathComponent("old.pdf").path
            let grants = [stale: current]
            XCTAssertEqual(try DocumentGrants.resolve(stale, grants: grants), current)
            XCTAssertEqual(try DocumentGrants.resolve(current.path, grants: grants), current)
            XCTAssertThrowsError(try DocumentGrants.resolve(root.appendingPathComponent("sibling.pdf").path, grants: grants))
            XCTAssertThrowsError(try DocumentGrants.resolve(stale + "/child.pdf", grants: grants))
            XCTAssertThrowsError(try DocumentGrants.resolve("relative.pdf", grants: grants))
            XCTAssertThrowsError(try DocumentGrants.resolve(current.path, grants: [:]))
        }
    }

    /// Folder bookmarks map old prefixes and reject traversal, prefix collisions, and symlink escapes.
    func testFolderGrantBoundaries() throws {
        try withDirectory { root in
            let current = root.appendingPathComponent("current", isDirectory: true)
            try FileManager.default.createDirectory(at: current, withIntermediateDirectories: true)
            let source = current.appendingPathComponent("child.pdf")
            try Data().write(to: source)
            let old = root.appendingPathComponent("old").path
            let grants = [old: current]
            XCTAssertEqual(try DocumentGrants.resolve(old + "/child.pdf", grants: grants), source)
            XCTAssertEqual(try DocumentGrants.resolve(source.path, grants: grants), source)
            XCTAssertThrowsError(try DocumentGrants.resolve(old + "-other/file.pdf", grants: grants))
            XCTAssertThrowsError(try DocumentGrants.resolve(old + "/../outside.pdf", grants: grants))
            let outside = root.appendingPathComponent("private.pdf")
            try Data().write(to: outside)
            try FileManager.default.createSymbolicLink(at: current.appendingPathComponent("link.pdf"), withDestinationURL: outside)
            XCTAssertThrowsError(try DocumentGrants.resolve(old + "/link.pdf", grants: grants))
        }
    }
}
