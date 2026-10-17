// swift-tools-version:5.9
import PackageDescription

/// Native document-provider package linked by Tauri's plugin build integration.
let package = Package(
    name: "tauri-plugin-documents",
    platforms: [.iOS("18.0")],
    products: [.library(name: "tauri-plugin-documents", type: .static, targets: ["Documents"])],
    dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
    targets: [.target(name: "Documents", dependencies: [.byName(name: "Tauri")], path: "Sources")]
)
