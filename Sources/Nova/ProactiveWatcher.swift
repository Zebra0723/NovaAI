import AppKit
import SwiftUI

/// Every so often, while the user is active and the screen has changed, asks Haiku whether
/// anything on screen looks like a problem. If so, shows a small card offering to fix it.
@MainActor
final class ProactiveWatcher {
    private let controller: NovaController
    private let store = NovaStore.shared
    private var loop: Task<Void, Never>?
    private var lastFingerprint: [UInt8]?
    private var recentTitles: [String: Date] = [:]
    private lazy var toast = SuggestionPanel(width: 380, height: 190)

    init(controller: NovaController) {
        self.controller = controller
    }

    func start() {
        loop?.cancel()
        loop = Task { [weak self] in
            while !Task.isCancelled {
                let interval = self?.store.settings.proactiveIntervalSeconds ?? 45
                try? await Task.sleep(nanoseconds: UInt64(max(15, interval) * 1_000_000_000))
                await self?.tick()
            }
        }
    }

    private func tick() async {
        guard store.settings.proactiveEnabled,
              let key = Keychain.apiKey,
              Permissions.hasScreenRecording,
              !controller.isWorking, !controller.isShown, !toast.isVisible,
              Self.secondsSinceInput < 120
        else { return }

        guard let shot = try? await ScreenCapture.fullScreen() else { return }

        // Only spend a check when the screen actually changed.
        let fingerprint = Self.fingerprint(shot.jpeg)
        defer { lastFingerprint = fingerprint }
        if let last = lastFingerprint, let fingerprint, Self.difference(last, fingerprint) < 4 { return }

        let app = NSWorkspace.shared.frontmostApplication?.localizedName ?? "unknown"
        let (notice, usage) = await ClaudeClient(apiKey: key).checkScreen(jpeg: shot.jpeg, app: app)
        store.recordBackgroundCheck(usage: usage, noticed: notice != nil)

        guard let notice, !controller.isWorking, !controller.isShown else { return }
        // Don't repeat the same suggestion within ten minutes.
        recentTitles = recentTitles.filter { Date().timeIntervalSince($0.value) < 600 }
        guard recentTitles[notice.title] == nil else { return }
        recentTitles[notice.title] = Date()

        toast.show(title: notice.title, suggestion: notice.suggestion) { [weak self] in
            self?.controller.run(notice.suggestion)
        }
    }

    // MARK: - Helpers

    private static var secondsSinceInput: Double {
        guard let anyInput = CGEventType(rawValue: ~0) else { return 0 }
        return CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: anyInput)
    }

    /// A 32x18 grayscale thumbnail, enough to tell whether the screen changed.
    private static func fingerprint(_ jpeg: Data) -> [UInt8]? {
        guard let image = NSBitmapImageRep(data: jpeg)?.cgImage else { return nil }
        let width = 32, height = 18
        var pixels = [UInt8](repeating: 0, count: width * height)
        let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(data: buffer.baseAddress, width: width, height: height,
                                          bitsPerComponent: 8, bytesPerRow: width,
                                          space: CGColorSpaceCreateDeviceGray(),
                                          bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return false }
            context.interpolationQuality = .low
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        return drawn ? pixels : nil
    }

    private static func difference(_ a: [UInt8], _ b: [UInt8]) -> Double {
        guard a.count == b.count, !a.isEmpty else { return .infinity }
        let total = zip(a, b).reduce(0) { $0 + abs(Int($1.0) - Int($1.1)) }
        return Double(total) / Double(a.count)
    }
}

// MARK: - Suggestion card

@MainActor
private final class SuggestionPanel: NSPanel {
    private let model = SuggestionModel()
    private var dismissTask: Task<Void, Never>?

    private let size: CGSize

    init(width: CGFloat, height: CGFloat) {
        size = CGSize(width: width, height: height)
        super.init(contentRect: NSRect(x: 0, y: 0, width: width, height: height),
                   styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
                   backing: .buffered, defer: false)
        isFloatingPanel = true
        level = .statusBar
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        backgroundColor = .clear
        isOpaque = false
        hasShadow = false
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        let hosting = NSHostingView(rootView: SuggestionCard(model: model, size: size))
        hosting.sizingOptions = []
        contentView = hosting
    }

    func show(title: String, suggestion: String, onAccept: @escaping () -> Void) {
        model.title = title
        model.suggestion = suggestion
        model.onAccept = { [weak self] in
            self?.close()
            onAccept()
        }
        model.onDismiss = { [weak self] in self?.close() }

        if let screen = NSScreen.main {
            let visible = screen.visibleFrame
            setFrame(NSRect(x: visible.maxX - size.width - 4, y: visible.maxY - size.height,
                            width: size.width, height: size.height), display: true)
        }
        orderFrontRegardless()
        model.visible = true

        dismissTask?.cancel()
        dismissTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 15_000_000_000)
            guard !Task.isCancelled else { return }
            self?.close()
        }
    }

    override func close() {
        dismissTask?.cancel()
        model.visible = false
        orderOut(nil)
    }
}

@MainActor
private final class SuggestionModel: ObservableObject {
    @Published var title = ""
    @Published var suggestion = ""
    @Published var visible = false
    var onAccept: () -> Void = {}
    var onDismiss: () -> Void = {}
}

private struct SuggestionCard: View {
    @ObservedObject var model: SuggestionModel
    let size: CGSize

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 18, style: .continuous)
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "sparkle")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(
                        LinearGradient(colors: [Color(red: 0.56, green: 0.80, blue: 1), Color(red: 0.64, green: 0.52, blue: 1)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing)
                    )
                Text("Nova noticed")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.secondary)
                Spacer()
                Button(action: model.onDismiss) {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
            }
            Text(model.title)
                .font(.system(size: 14, weight: .semibold))
                .lineLimit(1)
            Text(model.suggestion)
                .font(.system(size: 12.5))
                .foregroundStyle(.secondary)
                .lineLimit(2)
            HStack {
                Spacer()
                Button("Not now", action: model.onDismiss)
                    .buttonStyle(.plain)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 10)
                Button(action: model.onAccept) {
                    Text("Fix it")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(Color(red: 0.36, green: 0.31, blue: 0.84), in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(16)
        .frame(width: 340)
        .background {
            if #available(macOS 26.0, *) {
                Color.clear.glassEffect(.regular, in: shape)
            } else {
                shape.fill(.ultraThinMaterial)
            }
        }
        .overlay(shape.strokeBorder(Color.white.opacity(0.35), lineWidth: 0.5))
        .shadow(color: .black.opacity(0.18), radius: 18, y: 8)
        .opacity(model.visible ? 1 : 0)
        .offset(y: model.visible ? 0 : -8)
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: model.visible)
        .padding(.top, 12)
        .frame(width: size.width, height: size.height, alignment: .top)
    }
}
