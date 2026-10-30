// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Rally",
    platforms: [.macOS(.v14)],
    targets: [
        // forkpty + replay ring, shared by the app (fallback) and rally-ptyd
        .target(name: "PtyCore", path: "Sources/PtyCore"),
        .executableTarget(name: "Rally", dependencies: ["PtyCore"], path: "Sources/Rally"),
        // keeps the terminals running across app restarts
        .executableTarget(name: "rally-ptyd", dependencies: ["PtyCore"], path: "Sources/ptyd")
    ]
)
