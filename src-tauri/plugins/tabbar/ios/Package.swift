// swift-tools-version:5.3

import PackageDescription

let package = Package(
  name: "tauri-plugin-tabbar",
  platforms: [
    .macOS(.v10_13),
    .iOS(.v13),
  ],
  products: [
    .library(
      name: "tauri-plugin-tabbar",
      type: .static,
      targets: ["tauri-plugin-tabbar"])
  ],
  dependencies: [
    // Tauri's iOS API, which the plugin's build puts there.
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-tabbar",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
