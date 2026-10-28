// swift-tools-version:5.10
import PackageDescription

let package = Package(
    name: "GalaxyLink",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "GalaxyLink",
            path: "Sources/GalaxyLink",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("WebKit"),
            ]
        )
    ]
)
