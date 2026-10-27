import AppKit
import CoreGraphics

/// Runs the computer toolset's member actions (left_click, type, scroll, ...)
/// against the real Mac using synthesized CGEvents.
enum ComputerController {
    /// Tag on every event Nova posts, so Nova's Esc kill switch can ignore its own key presses.
    static let eventTag: Int64 = 0x4E4F5641

    enum Output {
        case text(String)
        case image(ScreenCapture.Shot)
    }

    struct ActionError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    static func run(_ name: String, input: [String: Any]) async throws -> Output {
        switch name {
        case "screenshot":
            return .image(try await ScreenCapture.fullScreen())

        case "zoom":
            return .image(try await ScreenCapture.zoom(region: doubles(input["region"])))

        case "left_click", "right_click", "middle_click", "double_click", "triple_click":
            let point = try point(input["coordinate"]) ?? currentLocation()
            let flags = KeyCodes.modifierFlags(input["text"] as? String)
            click(name, at: point, flags: flags)
            return .text("OK")

        case "left_click_drag":
            guard let start = try point(input["start_coordinate"]), let end = try point(input["coordinate"]) else {
                throw ActionError(message: "left_click_drag needs start_coordinate and coordinate")
            }
            drag(from: start, to: end, flags: KeyCodes.modifierFlags(input["text"] as? String))
            return .text("OK")

        case "mouse_move":
            guard let p = try point(input["coordinate"]) else { throw ActionError(message: "mouse_move needs coordinate") }
            post(mouse: .mouseMoved, at: p, button: .left)
            return .text("OK")

        case "left_mouse_down":
            post(mouse: .leftMouseDown, at: currentLocation(), button: .left)
            return .text("OK")

        case "left_mouse_up":
            post(mouse: .leftMouseUp, at: currentLocation(), button: .left)
            return .text("OK")

        case "cursor_position":
            let (x, y) = ScreenCapture.toScreenshot(currentLocation())
            return .text("[\(x), \(y)]")

        case "scroll":
            if let p = try point(input["coordinate"]) { post(mouse: .mouseMoved, at: p, button: .left) }
            let amount = Int32(number(input["scroll_amount"]) ?? 3)
            scroll(direction: input["scroll_direction"] as? String ?? "down", amount: amount,
                   flags: KeyCodes.modifierFlags(input["text"] as? String))
            return .text("OK")

        case "type":
            guard let text = input["text"] as? String else { throw ActionError(message: "type needs text") }
            type(text)
            return .text("OK")

        case "key":
            guard let combo = input["text"] as? String else { throw ActionError(message: "key needs text") }
            let repeatCount = max(1, min(100, Int(number(input["repeat"]) ?? 1)))
            for _ in 0..<repeatCount { try press(combo) }
            return .text("OK")

        case "hold_key":
            guard let combo = input["text"] as? String else { throw ActionError(message: "hold_key needs text") }
            let seconds = min(300, number(input["duration"]) ?? 1)
            try await hold(combo, seconds: seconds)
            return .text("OK")

        case "wait":
            let seconds = min(300, number(input["duration"]) ?? 1)
            try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            return .text("OK")

        default:
            throw ActionError(message: "Unsupported computer action: \(name)")
        }
    }

    // MARK: - Mouse

    private static func click(_ kind: String, at point: CGPoint, flags: CGEventFlags) {
        var down = CGEventType.leftMouseDown, up = CGEventType.leftMouseUp, button = CGMouseButton.left
        if kind == "right_click" {
            down = .rightMouseDown; up = .rightMouseUp; button = .right
        } else if kind == "middle_click" {
            down = .otherMouseDown; up = .otherMouseUp; button = .center
        }
        let count = kind == "double_click" ? 2 : kind == "triple_click" ? 3 : 1

        post(mouse: .mouseMoved, at: point, button: .left)
        for clickState in 1...count {
            post(mouse: down, at: point, button: button, flags: flags, clickState: clickState)
            post(mouse: up, at: point, button: button, flags: flags, clickState: clickState)
        }
    }

    private static func drag(from start: CGPoint, to end: CGPoint, flags: CGEventFlags) {
        post(mouse: .mouseMoved, at: start, button: .left)
        post(mouse: .leftMouseDown, at: start, button: .left, flags: flags)
        let steps = 20
        for i in 1...steps {
            let t = CGFloat(i) / CGFloat(steps)
            let p = CGPoint(x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t)
            post(mouse: .leftMouseDragged, at: p, button: .left, flags: flags)
            usleep(8_000)
        }
        post(mouse: .leftMouseUp, at: end, button: .left, flags: flags)
    }

    private static func scroll(direction: String, amount: Int32, flags: CGEventFlags) {
        // Each "click" scrolls a few lines so Claude's amounts feel natural on macOS.
        let lines = amount * 3
        var dy: Int32 = 0, dx: Int32 = 0
        switch direction {
        case "up": dy = lines
        case "down": dy = -lines
        case "left": dx = lines
        case "right": dx = -lines
        default: dy = -lines
        }
        guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 2,
                                  wheel1: dy, wheel2: dx, wheel3: 0) else { return }
        event.flags = flags
        tag(event).post(tap: .cghidEventTap)
    }

    private static func post(mouse type: CGEventType, at point: CGPoint, button: CGMouseButton,
                             flags: CGEventFlags = [], clickState: Int = 1) {
        guard let event = CGEvent(mouseEventSource: nil, mouseType: type,
                                  mouseCursorPosition: point, mouseButton: button) else { return }
        event.flags = flags
        event.setIntegerValueField(.mouseEventClickState, value: Int64(clickState))
        tag(event).post(tap: .cghidEventTap)
        usleep(12_000)
    }

    // MARK: - Keyboard

    private static func type(_ text: String) {
        // Unicode events type any character regardless of keyboard layout.
        let utf16 = Array(text.utf16)
        var index = 0
        while index < utf16.count {
            let chunk = Array(utf16[index..<min(index + 16, utf16.count)])
            for keyDown in [true, false] {
                guard let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: keyDown) else { continue }
                event.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
                tag(event).post(tap: .cghidEventTap)
            }
            index += 16
            usleep(10_000)
        }
    }

    private static func press(_ combo: String) throws {
        guard let parsed = KeyCodes.parseCombo(combo) else {
            throw ActionError(message: "Unknown key: \(combo)")
        }
        let (code, flags) = parsed
        for keyDown in [true, false] {
            guard let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: keyDown) else { continue }
            event.flags = flags
            tag(event).post(tap: .cghidEventTap)
        }
        usleep(15_000)
    }

    private static func hold(_ combo: String, seconds: Double) async throws {
        guard let parsed = KeyCodes.parseCombo(combo) else {
            throw ActionError(message: "Unknown key: \(combo)")
        }
        let (code, flags) = parsed
        if let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true) {
            down.flags = flags
            tag(down).post(tap: .cghidEventTap)
        }
        // Always release, even if the run is cancelled mid-hold.
        defer {
            if let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) {
                up.flags = flags
                tag(up).post(tap: .cghidEventTap)
            }
        }
        try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
    }

    // MARK: - Helpers

    private static func tag(_ event: CGEvent) -> CGEvent {
        event.setIntegerValueField(.eventSourceUserData, value: eventTag)
        return event
    }

    private static func currentLocation() -> CGPoint {
        CGEvent(source: nil)?.location ?? .zero
    }

    private static func number(_ value: Any?) -> Double? {
        if let d = value as? Double { return d }
        if let i = value as? Int { return Double(i) }
        if let n = value as? NSNumber { return n.doubleValue }
        return nil
    }

    private static func doubles(_ value: Any?) -> [Double] {
        (value as? [Any])?.compactMap(number) ?? []
    }

    private static func point(_ value: Any?) throws -> CGPoint? {
        guard let value else { return nil }
        let xy = doubles(value)
        guard xy.count == 2 else { throw ActionError(message: "Coordinates must be [x, y]") }
        return ScreenCapture.toScreen(xy[0], xy[1])
    }
}
