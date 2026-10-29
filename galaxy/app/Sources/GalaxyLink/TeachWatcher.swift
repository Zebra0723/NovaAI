import AppKit
import ScreenCaptureKit
import ServiceManagement
import UserNotifications
import Vision

/// Galaxy Teach's eyes. Every few seconds it reads the text of the window in front, but only
/// when that's Terminal, the Claude app, claude.ai or VS Code, and picks out the few lines worth
/// teaching from: a command, a line of code, a term. Only those lines go to Galaxy Link, which
/// keeps them in memory until Teach has turned them into a topic name.
///
/// Nothing it sees is ever written down: no screenshots, no screen text, no logs. The image
/// is read and dropped in the same moment, and what it remembers of lines it has already
/// passed on is a hash, so the same line isn't sent twice.
@MainActor
final class TeachWatcher: NSObject, UNUserNotificationCenterDelegate {
    /// The apps it reads, by bundle id, and the name Teach shows for each.
    static let apps: [String: String] = [
        "com.apple.Terminal": "Terminal",
        "com.anthropic.claudefordesktop": "Claude",
        "com.microsoft.VSCode": "Code",
    ]
    /// Browsers: read only while the tab in front is claude.ai.
    static let browsers: Set<String> = ["com.apple.Safari", "com.google.Chrome", "company.thebrowser.Browser", "com.microsoft.edgemac", "com.brave.Browser"]

    /// Called with a lesson to open (from Begin), or nil for the Teach page.
    var open: (String?) -> Void = { _ in }
    private(set) var paused = UserDefaults.standard.bool(forKey: "teachPaused")
    var onChange: () -> Void = {}

    private var timer: Timer?
    private var busy = false
    private var sent = Set<Int>()
    private var notified = Set(UserDefaults.standard.stringArray(forKey: "teachNotified") ?? [])
    private var offersVersion = 0
    private var problem = ""

    func start() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        let begin = UNNotificationAction(identifier: "BEGIN", title: "Begin lesson", options: [.foreground])
        let skip = UNNotificationAction(identifier: "SKIP", title: "Skip", options: [])
        center.setNotificationCategories([UNNotificationCategory(identifier: "OFFER", actions: [begin, skip], intentIdentifiers: [], options: [])])
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }

        // Start with the Mac, so it's watching without you opening anything.
        if SMAppService.mainApp.status != .enabled { try? SMAppService.mainApp.register() }
        if !CGPreflightScreenCaptureAccess() { CGRequestScreenCaptureAccess() }

        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.look() }
        }
        Task { await offersLoop() }
        Task {
            while true {
                await report()
                try? await Task.sleep(nanoseconds: 20_000_000_000)
            }
        }
    }

    func setPaused(_ on: Bool) {
        paused = on
        UserDefaults.standard.set(on, forKey: "teachPaused")
        onChange()
        Task { await report() }
    }

    var statusLine: String {
        if paused { return "Paused" }
        if !problem.isEmpty { return problem }
        return "Watching Terminal, Claude and VS Code"
    }

    // MARK: - Looking

    private func look() async {
        guard !paused, !busy, let app = NSWorkspace.shared.frontmostApplication, let id = app.bundleIdentifier else { return }
        busy = true
        defer { busy = false }
        guard let name = Self.apps[id] ?? (Self.browsers.contains(id) ? "claude.ai" : nil) else { return }

        var text = ""
        if id == "com.apple.Terminal" {
            text = Self.terminalText()
        } else {
            guard CGPreflightScreenCaptureAccess() else {
                setProblem("Teach needs Screen Recording: System Settings → Privacy & Security → Screen Recording → Galaxy Teach")
                return
            }
            guard let window = await Self.frontWindow(of: app.processIdentifier) else { return }
            if name == "claude.ai" {
                let title = (window.title ?? "").lowercased()
                guard title.contains("claude") else { return } // any other site is never read
            }
            text = await Self.read(window)
        }
        if !problem.isEmpty { setProblem("") }
        let fresh = Self.teachable(in: text, app: name).filter { sent.insert($0.hashValue).inserted }
        if sent.count > 5000 { sent.removeAll() }
        guard !fresh.isEmpty else { return }
        _ = await TeachAPI.call("POST", "/v1/teach/spots", ["app": name, "snippets": Array(fresh.prefix(10))])
    }

    private func setProblem(_ text: String) {
        problem = text
        onChange()
        Task { await report() }
    }

    private func report() async {
        _ = await TeachAPI.call("PUT", "/v1/teach/watcher", [
            "watching": !paused && problem.isEmpty,
            "apps": ["Terminal", "Claude", "claude.ai", "Code"],
            "problem": paused ? "" : problem,
        ])
    }

    /// The last screenful of the Terminal tab in front, through Terminal's own scripting.
    static func terminalText() -> String {
        let source = "tell application \"Terminal\" to if (count of windows) > 0 then get contents of selected tab of front window"
        var error: NSDictionary?
        let result = NSAppleScript(source: source)?.executeAndReturnError(&error).stringValue ?? ""
        return result.split(separator: "\n", omittingEmptySubsequences: false).suffix(80).joined(separator: "\n")
    }

    static func frontWindow(of pid: pid_t) async -> SCWindow? {
        guard let content = try? await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true) else { return nil }
        return content.windows
            .filter { $0.owningApplication?.processID == pid && $0.windowLayer == 0 && $0.frame.width > 200 && $0.frame.height > 150 }
            .max { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }
    }

    /// The window's text, read on the Mac with Vision. The image never leaves this function.
    static func read(_ window: SCWindow) async -> String {
        let config = SCStreamConfiguration()
        let scale = 1.5
        config.width = Int(window.frame.width * scale)
        config.height = Int(window.frame.height * scale)
        config.showsCursor = false
        guard let image = try? await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: window), configuration: config) else { return "" }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        guard (try? VNImageRequestHandler(cgImage: image, options: [:]).perform([request])) != nil else { return "" }
        return (request.results ?? [])
            .sorted { $0.boundingBox.minY > $1.boundingBox.minY }
            .compactMap { $0.topCandidates(1).first?.string }
            .joined(separator: "\n")
    }

    // MARK: - What's worth teaching

    static let commands = try! NSRegularExpression(pattern:
        #"^\s*(?:[$%❯➜>#]\s+)?(?:sudo\s+)?(?:brew|git|bun|bunx|npm|npx|node|deno|launchctl|lsof|ps|kill|pkill|killall|chmod|chown|curl|wget|ssh|scp|swift|swiftc|xcode-select|xcrun|xcodebuild|defaults|export|source|cd|ls|cat|less|grep|rg|find|mkdir|rm|cp|mv|tail|head|sed|awk|open|osascript|codesign|plutil|tccutil|xattr|which|python3?|pip3?|gh|docker|make|du|df|top|echo|touch|ln|tar|unzip|crontab|security|dscl|sysadminctl|id|whoami|sqlite3|claude|galaxy|nano|vim|code|env|printenv|caffeinate|pmset|diskutil|networksetup|ping|nc|jq|zsh|bash|sh|alias|history)\b[^\n]{0,180}$"#,
        options: [.anchorsMatchLines])
    static let code = try! NSRegularExpression(pattern:
        #"(?:\basync\b|\bawait\b|=>|\bfunction\b|\bimport\b .+ from|\bconst \w+ =|\bstruct \w+|\bfunc \w+\(|\bclass \w+|\binterface \w+|\bselect .+ from\b|\bguard let\b|\bPromise<|\.map\(|\.filter\(|\btry\b|new RegExp|\bextends\b)"#,
        options: [.caseInsensitive])
    /// Anything that looks like a secret or a person never leaves the Mac.
    static let secret = try! NSRegularExpression(pattern:
        #"(?:token|password|passwd|secret|api[_-]?key|bearer|sk-[a-z0-9]|[A-Za-z0-9+=_-]{32,}|[0-9a-f]{24,}|[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s().-]{8,}\d)"#,
        options: [.caseInsensitive])

    static func teachable(in text: String, app: String) -> [String] {
        var out: [String] = []
        for raw in text.split(separator: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            guard line.count >= 4, line.count <= 220 else { continue }
            let range = NSRange(line.startIndex..., in: line)
            if secret.firstMatch(in: line, range: range) != nil { continue }
            let isCommand = commands.firstMatch(in: line, range: range) != nil
            let isCode = app != "Terminal" && code.firstMatch(in: line, range: range) != nil
            if isCommand || isCode { out.append(line) }
            if out.count >= 12 { break }
        }
        return out
    }

    // MARK: - Offers and notifications

    private func offersLoop() async {
        while true {
            guard let reply = await TeachAPI.call("GET", "/v1/teach/offers?since=\(offersVersion)&wait=25", nil, timeout: 40) as? [String: Any] else {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                continue
            }
            offersVersion = reply["version"] as? Int ?? offersVersion
            for offer in reply["offers"] as? [[String: Any]] ?? [] {
                guard let id = offer["id"] as? String, !notified.contains(id) else { continue }
                notified.insert(id)
                notify(id: id, title: offer["title"] as? String ?? "Something new", why: offer["why"] as? String ?? "", minutes: offer["minutes"] as? Int ?? 15)
            }
            UserDefaults.standard.set(Array(notified.suffix(300)), forKey: "teachNotified")
        }
    }

    private func notify(id: String, title: String, why: String, minutes: Int) {
        let content = UNMutableNotificationContent()
        content.title = "New: \(title.replacingOccurrences(of: "`", with: ""))"
        content.subtitle = "\(minutes) min lesson"
        content.body = why
        content.categoryIdentifier = "OFFER"
        content.userInfo = ["offer": id]
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping () -> Void) {
        let id = response.notification.request.content.userInfo["offer"] as? String ?? ""
        let action = response.actionIdentifier
        Task { @MainActor in
            if action == "SKIP" {
                _ = await TeachAPI.call("POST", "/v1/teach/offers/\(id)/skip", [:])
            } else if action == "BEGIN" {
                let lesson = await TeachAPI.call("POST", "/v1/teach/offers/\(id)/begin", [:]) as? [String: Any]
                self.open(lesson?["id"] as? String)
            } else {
                self.open(nil) // the notification itself: show the offers
            }
            completionHandler()
        }
    }
}

/// Galaxy Link's API as you, which is who Teach's watcher acts for.
enum TeachAPI {
    static func call(_ method: String, _ path: String, _ body: [String: Any]?, timeout: TimeInterval = 10) async -> Any? {
        guard let token = Link.token, let url = URL(string: path, relativeTo: Link.address) else { return nil }
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("you", forHTTPHeaderField: "X-Galaxy-Body")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let status = (response as? HTTPURLResponse)?.statusCode, status < 300 else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }
}
