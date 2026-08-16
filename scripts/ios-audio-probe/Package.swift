// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "AWProbe",
  platforms: [.iOS(.v15)],
  products: [.library(name: "AWProbe", targets: ["AWProbe"])],
  targets: [
    .target(name: "AWProbe"),
    .testTarget(name: "AWProbeTests", dependencies: ["AWProbe"]),
  ]
)
