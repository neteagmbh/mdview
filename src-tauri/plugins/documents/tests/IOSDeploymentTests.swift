import Foundation
import XCTest

/// Guards the application deployment floor across maintained, generated, and packaged metadata.
final class IOSDeploymentTests: XCTestCase {
    /// Locates the Tauri project from this native test source.
    private var root: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
    }

    /// Reads a tracked project input as UTF-8.
    private func text(_ path: String) throws -> String {
        try String(contentsOf: root.appendingPathComponent(path), encoding: .utf8)
    }

    /// Reads the application minimum from the maintained Tauri iOS configuration.
    private func configuredMinimum() throws -> String {
        let data = try Data(contentsOf: root.appendingPathComponent("tauri.ios.conf.json"))
        let config = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let bundle = try XCTUnwrap(config["bundle"] as? [String: Any])
        let ios = try XCTUnwrap(bundle["iOS"] as? [String: Any])
        return try XCTUnwrap(ios["minimumSystemVersion"] as? String)
    }

    /// Extracts a version from the small SwiftPM, YAML, and Ruby configuration inputs.
    private func version(_ path: String, pattern: String) throws -> String {
        let source = try text(path)
        let expression = try NSRegularExpression(pattern: pattern, options: [.anchorsMatchLines])
        let match = try XCTUnwrap(expression.firstMatch(in: source, range: NSRange(source.startIndex..., in: source)))
        let range = try XCTUnwrap(Range(match.range(at: 1), in: source))
        return String(source[range])
    }

    /// Ensures regeneration inputs and native dependencies agree on the required iOS 18 floor.
    func testDeploymentInputsAgree() throws {
        let minimum = try configuredMinimum()
        XCTAssertEqual(minimum, "18.0")
        XCTAssertEqual(try version("plugins/documents/ios/Package.swift",
                                  pattern: #"\.iOS\("([0-9.]+)"\)"#), minimum)
        XCTAssertEqual(try version("gen/apple/project.yml",
                                  pattern: #"^\s+iOS:\s+([0-9.]+)\s*$"#), minimum)
        XCTAssertEqual(try version("gen/apple/Podfile",
                                  pattern: #"^\s*platform\s+:ios,\s*'([0-9.]+)'\s*$"#), minimum)
    }

    /// Checks effective debug/release targets, including target overrides of project settings.
    func testXcodeDeploymentTargetsAgree() throws {
        let data = try Data(contentsOf: root.appendingPathComponent("gen/apple/mdview.xcodeproj/project.pbxproj"))
        let project = try XCTUnwrap(PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])
        let objects = try XCTUnwrap(project["objects"] as? [String: [String: Any]])
        let projectID = try XCTUnwrap(project["rootObject"] as? String)
        let projectObject = try XCTUnwrap(objects[projectID])
        let target = try XCTUnwrap(objects.values.first {
            $0["isa"] as? String == "PBXNativeTarget" && $0["name"] as? String == "mdview_iOS"
        })

        /// Resolves a build-configuration list into settings keyed by configuration name.
        func configurations(_ owner: [String: Any]) throws -> [String: [String: Any]] {
            let listID = try XCTUnwrap(owner["buildConfigurationList"] as? String)
            let ids = try XCTUnwrap(objects[listID]?["buildConfigurations"] as? [String])
            return try Dictionary(uniqueKeysWithValues: ids.map { id in
                let config = try XCTUnwrap(objects[id])
                return (try XCTUnwrap(config["name"] as? String),
                        try XCTUnwrap(config["buildSettings"] as? [String: Any]))
            })
        }

        let projectConfigs = try configurations(projectObject)
        let targetConfigs = try configurations(target)
        XCTAssertEqual(Set(targetConfigs.keys), ["debug", "release"])
        for (name, settings) in targetConfigs {
            let effective = settings["IPHONEOS_DEPLOYMENT_TARGET"]
                ?? projectConfigs[name]?["IPHONEOS_DEPLOYMENT_TARGET"]
            XCTAssertEqual(effective as? String, try configuredMinimum(), name)
        }
    }

    /// Validates the compiled app floor when an actual iOS app plist is supplied.
    func testBuiltAppMinimumOSVersion() throws {
        guard let path = ProcessInfo.processInfo.environment["MDVIEW_IOS_APP_INFO_PLIST"] else {
            throw XCTSkip("Supply MDVIEW_IOS_APP_INFO_PLIST from a built iOS app.")
        }
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        let metadata = try XCTUnwrap(PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any])
        XCTAssertEqual(metadata["MinimumOSVersion"] as? String, try configuredMinimum())
    }
}
