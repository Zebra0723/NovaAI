import AppKit
import ApplicationServices

/// Nova needs Screen Recording (to see) and Accessibility (to click and type).
enum Permissions {
    static var hasScreenRecording: Bool { CGPreflightScreenCaptureAccess() }
    static var hasAccessibility: Bool { AXIsProcessTrusted() }

    static func requestIfNeeded(force: Bool = false) {
        if !hasScreenRecording {
            CGRequestScreenCaptureAccess()
        }
        if !hasAccessibility {
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            AXIsProcessTrustedWithOptions(options)
        }
        if force && hasScreenRecording && hasAccessibility {
            let alert = NSAlert()
            alert.messageText = "Nova is all set"
            alert.informativeText = "Screen Recording and Accessibility are both enabled."
            alert.runModal()
        }
    }

    /// A short explanation of what's missing, or nil when everything is granted.
    static var missingDescription: String? {
        var missing: [String] = []
        if !hasScreenRecording { missing.append("Screen Recording") }
        if !hasAccessibility { missing.append("Accessibility") }
        guard !missing.isEmpty else { return nil }
        return "Nova needs \(missing.joined(separator: " and ")) access. Turn it on in System Settings → Privacy & Security, then relaunch Nova."
    }
}
