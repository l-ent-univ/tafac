// swift-tools-version:5.5

import PackageDescription

let package = Package(
  name: "tauri-plugin-share",
  platforms: [
    .macOS(.v10_13),
    .iOS(.v15),
  ],
  products: [
    .library(
      name: "tauri-plugin-share",
      type: .static,
      targets: ["tauri-plugin-share"])
  ],
  dependencies: [
    // Tauri's iOS API, which the plugin's build puts there.
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-share",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
