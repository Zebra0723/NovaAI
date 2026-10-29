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
    /// Each lesson's status as last seen, so "ready" is announced once, when it changes.
    private var lessonStatus: [String: String]? = nil
    /// Whether macOS lets Galaxy Teach show notifications. Nil until it has said.
    private(set) var notificationsAllowed: Bool?
    /// Offers waiting for Begin or Skip, for the count on the menu-bar icon.
    private(set) var waiting = 0

    func start() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        let begin = UNNotificationAction(identifier: "BEGIN", title: "Begin lesson", options: [.foreground])
        let later = UNNotificationAction(identifier: "LATER", title: "Save for later", options: [])
        let skip = UNNotificationAction(identifier: "SKIP", title: "Skip", options: [])
        let startNow = UNNotificationAction(identifier: "START", title: "Start now", options: [.foreground])
        center.setNotificationCategories([
            UNNotificationCategory(identifier: "OFFER", actions: [begin, later, skip], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: "READY", actions: [startNow], intentIdentifiers: [], options: []),
        ])
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            Task { @MainActor in
                self.notificationsAllowed = granted
                self.onChange()
                await self.report()
            }
        }

        // Start with the Mac, so it's watching without you opening anything.
        if SMAppService.mainApp.status != .enabled { try? SMAppService.mainApp.register() }
        if !CGPreflightScreenCaptureAccess() { CGRequestScreenCaptureAccess() }

        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.look() }
        }
        Task { await teachLoop() }
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
        if notificationsAllowed == false { return "Notifications are off: System Settings → Notifications → Galaxy Teach" }
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
            "notifications": notificationsAllowed ?? true,
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

    /// Follows Teach: a notification for every new offer, and one when a lesson you began or saved is written.
    private func teachLoop() async {
        while true {
            guard let o = await TeachAPI.call("GET", "/v1/teach?since=\(offersVersion)&wait=25", nil, timeout: 40) as? [String: Any] else {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                continue
            }
            offersVersion = o["version"] as? Int ?? offersVersion
            let offers = o["offers"] as? [[String: Any]] ?? []
            for offer in offers {
                guard let id = offer["id"] as? String, !notified.contains(id) else { continue }
                notified.insert(id)
                let title = (offer["title"] as? String ?? "Something new").replacingOccurrences(of: "`", with: "")
                post(id: id, title: "New: \(title)", subtitle: "\(offer["minutes"] as? Int ?? 15) min lesson",
                     body: offer["why"] as? String ?? "", category: "OFFER", info: ["offer": id])
            }
            UserDefaults.standard.set(Array(notified.suffix(300)), forKey: "teachNotified")

            var now: [String: String] = [:]
            for lesson in o["lessons"] as? [[String: Any]] ?? [] {
                guard let id = lesson["id"] as? String, let status = lesson["status"] as? String else { continue }
                now[id] = status
                // Written while you waited (or saved it for later): it's ready to start.
                if let before = lessonStatus?[id], before == "writing", status == "ready" {
                    let title = (lesson["title"] as? String ?? "Your lesson").replacingOccurrences(of: "`", with: "")
                    let saved = lesson["saved"] as? Bool ?? false
                    post(id: "ready-\(id)", title: "Ready: \(title)", subtitle: "\(lesson["minutes"] as? Int ?? 15) min lesson",
                         body: saved ? "Saved for later. Start it whenever you like." : "Your lesson is written and waiting for you.",
                         category: "READY", info: ["lesson": id])
                }
            }
            lessonStatus = now
            if waiting != offers.count {
                waiting = offers.count
                onChange()
            }
        }
    }

    /// A Mac notification. If macOS won't let Galaxy Teach show its own, a plain one still gets through.
    private func post(id: String, title: String, subtitle: String, body: String, category: String, info: [String: String]) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.subtitle = subtitle
        content.body = body
        content.categoryIdentifier = category
        content.userInfo = info
        content.sound = .default
        if notificationsAllowed == false {
            Self.plainNotification(title: title, body: [subtitle, body].filter { !$0.isEmpty }.joined(separator: " · "))
            return
        }
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil)) { error in
            guard error != nil else { return }
            Task { @MainActor in
                self.notificationsAllowed = false
                self.onChange()
                Self.plainNotification(title: title, body: [subtitle, body].filter { !$0.isEmpty }.joined(separator: " · "))
            }
        }
    }

    /// The system's own notification, through osascript (so it doesn't depend on Galaxy Teach's
    /// own permission): no buttons, but it always shows. Click Open Galaxy Teach in the menu bar.
    static func plainNotification(title: String, body: String) {
        let esc = { (s: String) in s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") }
        let script = "display notification \"\(esc(body))\" with title \"Galaxy Teach\" subtitle \"\(esc(title))\" sound name \"Glass\""
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]
        try? process.run()
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping () -> Void) {
        let id = response.notification.request.content.userInfo["offer"] as? String ?? ""
        let lesson = response.notification.request.content.userInfo["lesson"] as? String
        let action = response.actionIdentifier
        Task { @MainActor in
            if let lesson {
                self.open(lesson) // a lesson that's ready: Start now, or the notification itself
            } else if action == "SKIP" {
                _ = await TeachAPI.call("POST", "/v1/teach/offers/\(id)/skip", [:])
            } else if action == "LATER" {
                _ = await TeachAPI.call("POST", "/v1/teach/offers/\(id)/later", [:]) // written now, waiting in Saved for later
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
