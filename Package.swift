// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CapacitorCodePushClient",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapacitorCodePushClient",
            targets: ["CodePushPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/weichsel/ZIPFoundation.git", exact: "0.9.20")
    ],
    targets: [
        // The state machine, staging and downloads: Foundation only, so XCTest reaches it without a bridge.
        .target(
            name: "CodePushCore",
            dependencies: [
                .product(name: "ZIPFoundation", package: "ZIPFoundation")
            ],
            path: "ios/Sources/CodePushCore"),
        .target(
            name: "CodePushPlugin",
            dependencies: [
                "CodePushCore",
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/CodePushPlugin")
    ]
)
