// swift-tools-version:5.9
import PackageDescription

/// A macOS test harness for the Foundation reader shared with the native iOS plugin.
let package = Package(
    name: "DocumentAccessTests",
    platforms: [.macOS(.v13)],
    targets: [
        .target(name: "DocumentAccess", path: "ios/Sources",
                exclude: ["DocumentsPlugin.swift"], sources: ["DocumentReader.swift"]),
        .testTarget(name: "DocumentReaderTests", dependencies: ["DocumentAccess"], path: "tests")
    ]
)
