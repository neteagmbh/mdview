import Foundation
import XCTest

/// Checks platform registration metadata against the file formats the application accepts.
final class DocumentRegistrationTests: XCTestCase {
    /// Locates maintained Tauri configuration alongside the native test harness.
    private var root: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
    }

    /// Parses plist dictionaries using the same Foundation format used by Apple bundles.
    private func plist(_ name: String) throws -> [String: Any] {
        try plist(at: root.appendingPathComponent(name))
    }

    /// Reads a maintained or packaged property list without assuming XML rather than binary format.
    private func plist(at url: URL) throws -> [String: Any] {
        let data = try Data(contentsOf: url)
        return try XCTUnwrap(PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])
    }

    /// Verifies extension, MIME, and UTI declarations agree and register a viewer role.
    func testMarkdownTypeRegistration() throws {
        let data = try Data(contentsOf: root.appendingPathComponent("tauri.conf.json"))
        let config = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let bundle = try XCTUnwrap(config["bundle"] as? [String: Any])
        let associations = try XCTUnwrap(bundle["fileAssociations"] as? [[String: Any]])
        let association = try XCTUnwrap(associations.first)
        let extensions = ["md", "markdown", "mdown", "mkd", "mkdn"]
        XCTAssertEqual(association["ext"] as? [String], extensions)
        XCTAssertEqual(association["mimeType"] as? String, "text/markdown")
        XCTAssertEqual(association["role"] as? String, "Viewer")
        XCTAssertEqual(association["rank"] as? String, "Alternate")
        let types = try XCTUnwrap(try plist("Info.plist")["UTImportedTypeDeclarations"] as? [[String: Any]])
        let type = try XCTUnwrap(types.first)
        XCTAssertEqual(association["contentTypes"] as? [String], [try XCTUnwrap(type["UTTypeIdentifier"] as? String)])
        let tags = try XCTUnwrap(type["UTTypeTagSpecification"] as? [String: Any])
        XCTAssertEqual(tags["public.filename-extension"] as? [String], extensions)
        XCTAssertEqual(tags["public.mime-type"] as? String, "text/markdown")
        XCTAssertEqual(type["UTTypeConformsTo"] as? [String], ["public.plain-text", "public.data"])
        XCTAssertNil(try plist("Info.plist")["UTExportedTypeDeclarations"])
        XCTAssertEqual(try plist("Info.ios.plist")["LSSupportsOpeningDocumentsInPlace"] as? Bool, true)
    }

    /// Registers Apple's existing folder type without claiming ownership or inventing an extension.
    func testFolderTypeRegistration() throws {
        let data = try Data(contentsOf: root.appendingPathComponent("tauri.conf.json"))
        let config = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let bundle = try XCTUnwrap(config["bundle"] as? [String: Any])
        let associations = try XCTUnwrap(bundle["fileAssociations"] as? [[String: Any]])
        let folder = try XCTUnwrap(associations.first { ($0["contentTypes"] as? [String]) == ["public.folder"] })
        XCTAssertEqual(folder["ext"] as? [String], [])
        XCTAssertEqual(folder["role"] as? String, "Viewer")
        XCTAssertEqual(folder["rank"] as? String, "Alternate")
        XCTAssertNil(folder["exportedType"])
    }

    /// Validates real build output when callers supply macOS bundle and generated iOS plist paths.
    func testPackagedAndGeneratedAppleMetadata() throws {
        let environment = ProcessInfo.processInfo.environment
        let keys = ["MDVIEW_MACOS_INFO_PLIST", "MDVIEW_IOS_INFO_PLIST"]
        let paths = keys.compactMap { environment[$0] }
        guard !paths.isEmpty else { throw XCTSkip("Supply built plist paths for packaging validation.") }
        for path in paths {
            let metadata = try plist(at: URL(fileURLWithPath: path))
            let documents = try XCTUnwrap(metadata["CFBundleDocumentTypes"] as? [[String: Any]])
            let document = try XCTUnwrap(documents.first)
            XCTAssertEqual(document["CFBundleTypeRole"] as? String, "Viewer")
            XCTAssertEqual(document["LSHandlerRank"] as? String, "Alternate")
            XCTAssertEqual(document["CFBundleTypeExtensions"] as? [String], ["md", "markdown", "mdown", "mkd", "mkdn"])
            XCTAssertEqual(document["LSItemContentTypes"] as? [String], ["net.daringfireball.markdown"])
            let folder = try XCTUnwrap(documents.first { ($0["LSItemContentTypes"] as? [String]) == ["public.folder"] })
            XCTAssertEqual(folder["CFBundleTypeRole"] as? String, "Viewer")
            XCTAssertEqual(folder["LSHandlerRank"] as? String, "Alternate")
            let types = try XCTUnwrap(metadata["UTImportedTypeDeclarations"] as? [[String: Any]])
            let tags = try XCTUnwrap(types.first?["UTTypeTagSpecification"] as? [String: Any])
            XCTAssertEqual(tags["public.mime-type"] as? String, "text/markdown")
            if path == environment["MDVIEW_IOS_INFO_PLIST"] {
                XCTAssertEqual(metadata["LSSupportsOpeningDocumentsInPlace"] as? Bool, true)
            }
        }
    }
}
