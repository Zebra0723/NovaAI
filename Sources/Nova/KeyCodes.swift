import Carbon
import CoreGraphics

/// Maps the xdotool-style key names Claude uses ("Return", "ctrl+s", "super+Tab")
/// onto macOS virtual key codes and modifier flags.
enum KeyCodes {
    static let space = UInt32(kVK_Space)
    static let escape = UInt16(kVK_Escape)

    static func modifierFlag(_ name: String) -> CGEventFlags? {
        switch name.lowercased() {
        case "shift": return .maskShift
        case "ctrl", "control": return .maskControl
        case "alt", "option", "opt": return .maskAlternate
        case "super", "cmd", "command", "meta", "win": return .maskCommand
        case "fn": return .maskSecondaryFn
        default: return nil
        }
    }

    /// Parses a modifier string like "ctrl+shift" into flags. Unknown parts are ignored.
    static func modifierFlags(_ combo: String?) -> CGEventFlags {
        guard let combo, !combo.isEmpty else { return [] }
        var flags: CGEventFlags = []
        for part in combo.split(separator: "+") {
            if let flag = modifierFlag(String(part)) { flags.insert(flag) }
        }
        return flags
    }

    /// Parses a combo like "super+shift+t" into (keyCode, flags).
    static func parseCombo(_ combo: String) -> (CGKeyCode, CGEventFlags)? {
        // "+" can itself be the key ("+" or "ctrl++"), so peel that case off first.
        var parts: [String]
        if combo == "+" {
            parts = ["plus"]
        } else if combo.hasSuffix("++") {
            parts = combo.dropLast(2).split(separator: "+").map(String.init) + ["plus"]
        } else {
            parts = combo.split(separator: "+").map(String.init)
        }
        guard let keyName = parts.last, !keyName.isEmpty else { return nil }
        var flags: CGEventFlags = []
        for mod in parts.dropLast() {
            guard let flag = modifierFlag(mod) else { return nil }
            flags.insert(flag)
        }
        // A bare modifier ("shift") is pressed as its own key.
        if parts.count == 1, let code = modifierKeyCodes[keyName.lowercased()] {
            return (code, [])
        }
        guard let code = keyCode(for: keyName) else { return nil }
        return (code, flags)
    }

    static func keyCode(for name: String) -> CGKeyCode? {
        if let code = named[name] ?? named[name.lowercased()] { return code }
        if name.count == 1, let code = characters[name.lowercased()] { return code }
        return nil
    }

    private static let modifierKeyCodes: [String: CGKeyCode] = [
        "shift": CGKeyCode(kVK_Shift), "ctrl": CGKeyCode(kVK_Control), "control": CGKeyCode(kVK_Control),
        "alt": CGKeyCode(kVK_Option), "option": CGKeyCode(kVK_Option),
        "super": CGKeyCode(kVK_Command), "cmd": CGKeyCode(kVK_Command), "command": CGKeyCode(kVK_Command),
        "fn": CGKeyCode(kVK_Function),
    ]

    private static let named: [String: CGKeyCode] = [
        "return": CGKeyCode(kVK_Return), "enter": CGKeyCode(kVK_Return), "kp_enter": CGKeyCode(kVK_ANSI_KeypadEnter),
        "tab": CGKeyCode(kVK_Tab), "space": CGKeyCode(kVK_Space),
        "escape": CGKeyCode(kVK_Escape), "esc": CGKeyCode(kVK_Escape),
        "backspace": CGKeyCode(kVK_Delete), "delete": CGKeyCode(kVK_ForwardDelete),
        "up": CGKeyCode(kVK_UpArrow), "down": CGKeyCode(kVK_DownArrow),
        "left": CGKeyCode(kVK_LeftArrow), "right": CGKeyCode(kVK_RightArrow),
        "home": CGKeyCode(kVK_Home), "end": CGKeyCode(kVK_End),
        "page_up": CGKeyCode(kVK_PageUp), "pageup": CGKeyCode(kVK_PageUp), "prior": CGKeyCode(kVK_PageUp),
        "page_down": CGKeyCode(kVK_PageDown), "pagedown": CGKeyCode(kVK_PageDown), "next": CGKeyCode(kVK_PageDown),
        "f1": CGKeyCode(kVK_F1), "f2": CGKeyCode(kVK_F2), "f3": CGKeyCode(kVK_F3), "f4": CGKeyCode(kVK_F4),
        "f5": CGKeyCode(kVK_F5), "f6": CGKeyCode(kVK_F6), "f7": CGKeyCode(kVK_F7), "f8": CGKeyCode(kVK_F8),
        "f9": CGKeyCode(kVK_F9), "f10": CGKeyCode(kVK_F10), "f11": CGKeyCode(kVK_F11), "f12": CGKeyCode(kVK_F12),
        "minus": CGKeyCode(kVK_ANSI_Minus), "equal": CGKeyCode(kVK_ANSI_Equal), "plus": CGKeyCode(kVK_ANSI_Equal),
        "comma": CGKeyCode(kVK_ANSI_Comma), "period": CGKeyCode(kVK_ANSI_Period), "slash": CGKeyCode(kVK_ANSI_Slash),
        "backslash": CGKeyCode(kVK_ANSI_Backslash), "semicolon": CGKeyCode(kVK_ANSI_Semicolon),
        "apostrophe": CGKeyCode(kVK_ANSI_Quote), "grave": CGKeyCode(kVK_ANSI_Grave),
        "bracketleft": CGKeyCode(kVK_ANSI_LeftBracket), "bracketright": CGKeyCode(kVK_ANSI_RightBracket),
    ]

    private static let characters: [String: CGKeyCode] = [
        "a": CGKeyCode(kVK_ANSI_A), "b": CGKeyCode(kVK_ANSI_B), "c": CGKeyCode(kVK_ANSI_C), "d": CGKeyCode(kVK_ANSI_D),
        "e": CGKeyCode(kVK_ANSI_E), "f": CGKeyCode(kVK_ANSI_F), "g": CGKeyCode(kVK_ANSI_G), "h": CGKeyCode(kVK_ANSI_H),
        "i": CGKeyCode(kVK_ANSI_I), "j": CGKeyCode(kVK_ANSI_J), "k": CGKeyCode(kVK_ANSI_K), "l": CGKeyCode(kVK_ANSI_L),
        "m": CGKeyCode(kVK_ANSI_M), "n": CGKeyCode(kVK_ANSI_N), "o": CGKeyCode(kVK_ANSI_O), "p": CGKeyCode(kVK_ANSI_P),
        "q": CGKeyCode(kVK_ANSI_Q), "r": CGKeyCode(kVK_ANSI_R), "s": CGKeyCode(kVK_ANSI_S), "t": CGKeyCode(kVK_ANSI_T),
        "u": CGKeyCode(kVK_ANSI_U), "v": CGKeyCode(kVK_ANSI_V), "w": CGKeyCode(kVK_ANSI_W), "x": CGKeyCode(kVK_ANSI_X),
        "y": CGKeyCode(kVK_ANSI_Y), "z": CGKeyCode(kVK_ANSI_Z),
        "0": CGKeyCode(kVK_ANSI_0), "1": CGKeyCode(kVK_ANSI_1), "2": CGKeyCode(kVK_ANSI_2), "3": CGKeyCode(kVK_ANSI_3),
        "4": CGKeyCode(kVK_ANSI_4), "5": CGKeyCode(kVK_ANSI_5), "6": CGKeyCode(kVK_ANSI_6), "7": CGKeyCode(kVK_ANSI_7),
        "8": CGKeyCode(kVK_ANSI_8), "9": CGKeyCode(kVK_ANSI_9),
        "-": CGKeyCode(kVK_ANSI_Minus), "=": CGKeyCode(kVK_ANSI_Equal), ",": CGKeyCode(kVK_ANSI_Comma),
        ".": CGKeyCode(kVK_ANSI_Period), "/": CGKeyCode(kVK_ANSI_Slash), "\\": CGKeyCode(kVK_ANSI_Backslash),
        ";": CGKeyCode(kVK_ANSI_Semicolon), "'": CGKeyCode(kVK_ANSI_Quote), "`": CGKeyCode(kVK_ANSI_Grave),
        "[": CGKeyCode(kVK_ANSI_LeftBracket), "]": CGKeyCode(kVK_ANSI_RightBracket),
    ]
}
