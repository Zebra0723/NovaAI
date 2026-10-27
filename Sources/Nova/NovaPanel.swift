import AppKit
import SwiftUI

/// A borderless floating panel that shows Nova over every app and Space
/// without stealing focus from the app the user is working in.
@MainActor
final class NovaPanel: NSPanel {
    /// Room around the bar for its glow and shadow.
    static let margin: CGFloat = 28

    private var contentSize = CGSize(width: 640, height: 56)
    private var acting = false

    init(controller: NovaController) {
        super.init(contentRect: NSRect(x: 0, y: 0, width: 700, height: 120),
                   styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
                   backing: .buffered, defer: false)
        isFloatingPanel = true
        level = .statusBar
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        backgroundColor = .clear
        isOpaque = false
        hasShadow = false
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        animationBehavior = .utilityWindow

        let view = NovaView(controller: controller) { [weak self] size in
            self?.contentSizeChanged(size)
        }
        let hosting = NSHostingView(rootView: view)
        hosting.sizingOptions = []
        contentView = hosting
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    /// Shows the panel. `acting` docks it as a small pill at the top of the screen that
    /// clicks pass through; `interactive` makes it key so the user can type.
    func present(acting: Bool, interactive: Bool) {
        self.acting = acting
        ignoresMouseEvents = acting
        layout()

        if interactive {
            makeKeyAndOrderFront(nil)
        } else {
            // Drop key status so synthesized keystrokes go to the user's app, not Nova.
            if isKeyWindow { orderOut(nil) }
            orderFrontRegardless()
        }
    }

    private func contentSizeChanged(_ size: CGSize) {
        guard size.width > 0, size.height > 0, size != contentSize else { return }
        contentSize = size
        layout()
    }

    private func layout() {
        guard let screen = NSScreen.main else { return }
        let visible = screen.visibleFrame
        let width = contentSize.width + Self.margin * 2
        let height = contentSize.height + Self.margin * 2

        // The bar's top edge stays put while its answer grows downward.
        let top: CGFloat = acting
            ? visible.maxY - 8 + Self.margin              // tucked under the menu bar
            : visible.maxY - visible.height * 0.22 + Self.margin
        let frame = NSRect(x: visible.midX - width / 2, y: top - height, width: width, height: height)
        setFrame(frame, display: true, animate: false)
    }
}
