// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "Nova",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "Nova",
            path: "Sources/Nova",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("ScreenCaptureKit"),
                .linkedFramework("Carbon"),
                .linkedFramework("ServiceManagement"),
            ]
        )
    ]
)
