// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "NimbalystNative",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(
            name: "NimbalystNative",
            targets: ["NimbalystNative"]
        ),
    ],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "7.0.0"),
    ],
    targets: [
        .target(
            name: "NimbalystNative",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
            ],
            path: "Sources"
        ),
        .testTarget(
            name: "NimbalystNativeTests",
            dependencies: ["NimbalystNative"],
            path: "Tests"
        ),
    ]
)
