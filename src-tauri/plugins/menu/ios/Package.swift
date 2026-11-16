// swift-tools-version:5.5

import PackageDescription

let package = Package(
  name: "tauri-plugin-menu",
  platforms: [
    .macOS(.v10_13),
    .iOS(.v15),
  ],
  products: [
    .library(
      name: "tauri-plugin-menu",
      type: .static,
      targets: ["tauri-plugin-menu"])
  ],
  dependencies: [
    // Tauri's iOS API, which the plugin's build puts there.
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-menu",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
