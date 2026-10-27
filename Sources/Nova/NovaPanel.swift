import AppKit
import SwiftUI

/// A borderless floating panel that shows Nova over every app and Space
/// without stealing focus from the app the user is working in.
@MainActor
final class NovaPanel: NSPanel {
    /// Room around the bar for its aura and shadow.
    static let margin: CGFloat = 44

    private static let positionKey = "nova.barTopLeft"

    private var contentSize = CGSize(width: 640, height: 56)
    private var acting = false

    /// Where the user dragged the bar: the screen position of its top-left corner.
    /// nil means the default spot, centered near the top of the screen.
    private var customTopLeft: CGPoint? = {
        guard let saved = UserDefaults.standard.string(forKey: NovaPanel.positionKey) else { return nil }
        return NSPointFromString(saved)
    }()
    private var dragStart: (mouse: NSPoint, origin: NSPoint)?

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

    /// Nova has no Edit menu (it's menu-bar only), so ⌘V and friends are routed here by hand.
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if event.type == .keyDown, flags == .command || flags == [.command, .shift] {
            let shift = flags.contains(.shift)
            var action: Selector?
            switch event.charactersIgnoringModifiers?.lowercased() {
            case "v": action = #selector(NSText.paste(_:))
            case "c": action = #selector(NSText.copy(_:))
            case "x": action = #selector(NSText.cut(_:))
            case "a": action = #selector(NSText.selectAll(_:))
            case "z": action = shift ? Selector(("redo:")) : Selector(("undo:"))
            default: break
            }
            if let action, NSApp.sendAction(action, to: nil, from: self) {
                return true
            }
        }
        return super.performKeyEquivalent(with: event)
    }

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

    // MARK: - Moving

    /// Called repeatedly while the user drags the bar. Uses the global mouse
    /// position, so the window moving underneath the gesture doesn't matter.
    func userDragChanged() {
        let mouse = NSEvent.mouseLocation
        if dragStart == nil { dragStart = (mouse, frame.origin) }
        guard let start = dragStart else { return }
        setFrameOrigin(NSPoint(x: start.origin.x + mouse.x - start.mouse.x,
                               y: start.origin.y + mouse.y - start.mouse.y))
    }

    func userDragEnded() {
        dragStart = nil
        pinPosition(force: true)
    }

    /// Anchors the bar where it is now, so resizing grows it right and down
    /// instead of re-centering it.
    func pinPosition(force: Bool = false) {
        guard !acting, force || customTopLeft == nil else { return }
        let topLeft = CGPoint(x: frame.minX + Self.margin, y: frame.maxY - Self.margin)
        customTopLeft = topLeft
        UserDefaults.standard.set(NSStringFromPoint(topLeft), forKey: Self.positionKey)
    }

    func resetPosition() {
        customTopLeft = nil
        UserDefaults.standard.removeObject(forKey: Self.positionKey)
        layout()
    }

    // MARK: - Layout

    private func layout() {
        guard dragStart == nil, let screen = NSScreen.main else { return }
        let visible = screen.visibleFrame
        let width = contentSize.width + Self.margin * 2
        let height = contentSize.height + Self.margin * 2

        var frame: NSRect
        if acting {
            // Tucked under the menu bar, centered.
            let top = visible.maxY - 8 + Self.margin
            frame = NSRect(x: visible.midX - width / 2, y: top - height, width: width, height: height)
        } else if let topLeft = customTopLeft, Self.isOnScreen(topLeft) {
            // Where the user put it. The top edge stays put while the answer grows downward.
            frame = NSRect(x: topLeft.x - Self.margin, y: topLeft.y + Self.margin - height,
                           width: width, height: height)
        } else {
            let top = visible.maxY - visible.height * 0.22 + Self.margin
            frame = NSRect(x: visible.midX - width / 2, y: top - height, width: width, height: height)
        }
        setFrame(frame, display: true, animate: false)
    }

    /// True if the point is on a connected display (a saved spot can vanish with an external monitor).
    private static func isOnScreen(_ point: CGPoint) -> Bool {
        NSScreen.screens.contains { $0.frame.insetBy(dx: -1, dy: -1).contains(point) }
    }
}
