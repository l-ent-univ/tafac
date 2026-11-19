// swift-tools-version:5.5

import PackageDescription

let package = Package(
  name: "tauri-plugin-moodle",
  platforms: [
    .macOS(.v10_13),
    .iOS(.v15),
  ],
  products: [
    .library(
      name: "tauri-plugin-moodle",
      type: .static,
      targets: ["tauri-plugin-moodle"])
  ],
  dependencies: [
    // Tauri's iOS API, which the plugin's build puts there.
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-moodle",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
