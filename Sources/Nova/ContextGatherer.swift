import AppKit
import ApplicationServices

/// A piece of context Nova picked up when it was summoned, shown as a chip in the bar.
struct ContextItem: Identifiable, Equatable {
    enum Kind: String { case selection, browser, finder }

    let id = UUID()
    let kind: Kind
    /// Short text for the chip.
    let label: String
    /// What Claude sees.
    let detail: String
}

/// Collects what the user is looking at: selected text, the browser tab, and Finder's selection.
enum ContextGatherer {
    private static let browsers: [String: String] = [
        "com.apple.Safari": "safari",
        "com.google.Chrome": "chromium",
        "company.thebrowser.Browser": "chromium", // Arc
        "com.brave.Browser": "chromium",
        "com.microsoft.edgemac": "chromium",
        "com.vivaldi.Vivaldi": "chromium",
    ]

    static func gather(settings: NovaSettings) async -> [ContextItem] {
        guard let app = await MainActor.run(body: { NSWorkspace.shared.frontmostApplication }),
              app.bundleIdentifier != Bundle.main.bundleIdentifier else { return [] }
        let bundleID = app.bundleIdentifier ?? ""
        let appName = app.localizedName ?? "the app"
        var items: [ContextItem] = []

        if settings.contextSelection, let text = selectedText(pid: app.processIdentifier) {
            let words = text.split(whereSeparator: \.isWhitespace).count
            items.append(ContextItem(kind: .selection,
                                     label: "Selection · \(words) word\(words == 1 ? "" : "s")",
                                     detail: "Text the user has selected in \(appName):\n\"\"\"\n\(text.prefix(20_000))\n\"\"\""))
        }

        if settings.contextBrowser, let flavor = browsers[bundleID],
           let tab = await browserTab(appName: appName, flavor: flavor) {
            let host = URL(string: tab.url)?.host ?? tab.url
            items.append(ContextItem(kind: .browser,
                                     label: host,
                                     detail: "Open in \(appName): \(tab.title)\n\(tab.url)"))
        }

        if settings.contextFinder, bundleID == "com.apple.finder", let paths = await finderSelection(), !paths.isEmpty {
            let label = paths.count == 1
                ? (paths[0] as NSString).lastPathComponent
                : "\(paths.count) files in Finder"
            items.append(ContextItem(kind: .finder,
                                     label: label,
                                     detail: "Selected in Finder:\n" + paths.joined(separator: "\n")))
        }
        return items
    }

    // MARK: - Selected text (Accessibility)

    private static func selectedText(pid: pid_t) -> String? {
        let app = AXUIElementCreateApplication(pid)
        var focused: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
              let element = focused, CFGetTypeID(element) == AXUIElementGetTypeID() else { return nil }
        var selected: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element as! AXUIElement, kAXSelectedTextAttribute as CFString,
                                            &selected) == .success,
              let text = selected as? String else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    // MARK: - Browser tab and Finder selection (AppleScript)

    private static func browserTab(appName: String, flavor: String) async -> (url: String, title: String)? {
        let script = flavor == "safari"
            ? "tell application \"\(appName)\" to return (URL of front document) & linefeed & (name of front document)"
            : "tell application \"\(appName)\" to return (URL of active tab of front window) & linefeed & (title of active tab of front window)"
        guard let output = await osascript(script) else { return nil }
        let lines = output.components(separatedBy: "\n")
        guard let url = lines.first, !url.isEmpty else { return nil }
        return (url, lines.dropFirst().joined(separator: " "))
    }

    private static func finderSelection() async -> [String]? {
        let script = """
        tell application "Finder"
            set out to ""
            repeat with f in (get selection)
                set out to out & POSIX path of (f as alias) & linefeed
            end repeat
            return out
        end tell
        """
        guard let output = await osascript(script) else { return nil }
        return output.split(separator: "\n").map(String.init)
    }

    /// Runs AppleScript with a short timeout. The first time, macOS asks the user
    /// to allow Nova to control that app.
    private static func osascript(_ script: String) async -> String? {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let process = Process()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
                process.arguments = ["-e", script]
                let pipe = Pipe()
                process.standardOutput = pipe
                process.standardError = Pipe()
                do { try process.run() } catch {
                    continuation.resume(returning: nil)
                    return
                }
                let deadline = Date().addingTimeInterval(3)
                while process.isRunning && Date() < deadline { usleep(20_000) }
                if process.isRunning { process.terminate() }
                process.waitUntilExit()
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                let text = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
                continuation.resume(returning: process.terminationStatus == 0 && !text.isEmpty ? text : nil)
            }
        }
    }
}
