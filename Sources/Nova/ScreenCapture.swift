import AppKit
import ScreenCaptureKit

/// Captures the main display with Nova's own windows hidden, sized so Claude
/// can read it and so its coordinates map cleanly back to screen points.
enum ScreenCapture {
    /// Longest edge we send. Well under the model's 2576px limit and the
    /// 1920x1080 ceiling the computer-use docs recommend.
    static let maxLongEdge: CGFloat = 1456

    struct Shot {
        let jpeg: Data
        let size: CGSize
    }

    enum CaptureError: LocalizedError {
        case noDisplay, encodeFailed
        var errorDescription: String? {
            switch self {
            case .noDisplay: return "No display available to capture."
            case .encodeFailed: return "Couldn't encode the screenshot."
            }
        }
    }

    /// Main display size in points (the space CGEvent uses).
    static var displayPoints: CGSize { CGDisplayBounds(CGMainDisplayID()).size }

    /// Screenshot pixels per screen point.
    static var scale: CGFloat {
        let size = displayPoints
        return min(1, maxLongEdge / max(size.width, size.height))
    }

    static var screenshotSize: CGSize {
        let size = displayPoints
        return CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
    }

    /// Converts a screenshot-space coordinate to a global screen point.
    static func toScreen(_ x: Double, _ y: Double) -> CGPoint {
        CGPoint(x: x / scale, y: y / scale)
    }

    /// Converts a global screen point to screenshot space.
    static func toScreenshot(_ point: CGPoint) -> (Int, Int) {
        (Int((point.x * scale).rounded()), Int((point.y * scale).rounded()))
    }

    static func fullScreen() async throws -> Shot {
        let size = screenshotSize
        return try await capture(sourceRect: nil, outputSize: size)
    }

    /// Captures `region` ([x0, y0, x1, y1] in screenshot space) at higher detail.
    static func zoom(region: [Double]) async throws -> Shot {
        guard region.count == 4 else { throw CaptureError.noDisplay }
        let topLeft = toScreen(min(region[0], region[2]), min(region[1], region[3]))
        let bottomRight = toScreen(max(region[0], region[2]), max(region[1], region[3]))
        let rect = CGRect(x: topLeft.x, y: topLeft.y,
                          width: max(1, bottomRight.x - topLeft.x),
                          height: max(1, bottomRight.y - topLeft.y))

        // Retina pixels for the region, capped to the same long-edge limit.
        let backing = NSScreen.main?.backingScaleFactor ?? 2
        var out = CGSize(width: rect.width * backing, height: rect.height * backing)
        let shrink = min(1, maxLongEdge / max(out.width, out.height))
        out = CGSize(width: (out.width * shrink).rounded(), height: (out.height * shrink).rounded())
        return try await capture(sourceRect: rect, outputSize: out)
    }

    private static func capture(sourceRect: CGRect?, outputSize: CGSize) async throws -> Shot {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        let mainID = CGMainDisplayID()
        guard let display = content.displays.first(where: { $0.displayID == mainID }) ?? content.displays.first else {
            throw CaptureError.noDisplay
        }

        // Hide Nova itself so Claude sees the user's screen, not the bar.
        let me = content.applications.filter { $0.processID == ProcessInfo.processInfo.processIdentifier }
        let filter = SCContentFilter(display: display, excludingApplications: me, exceptingWindows: [])

        let config = SCStreamConfiguration()
        config.width = Int(outputSize.width)
        config.height = Int(outputSize.height)
        config.showsCursor = true
        if let sourceRect { config.sourceRect = sourceRect }

        let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
        let rep = NSBitmapImageRep(cgImage: image)
        guard let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.8]) else {
            throw CaptureError.encodeFailed
        }
        return Shot(jpeg: jpeg, size: outputSize)
    }
}
