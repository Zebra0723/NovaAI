import AppKit
import WebKit

/// Galaxy Link.app: the window onto galaxyd. The interface itself is served by
/// galaxyd (galaxy/web); this app hosts it, hands it the token from
/// ~/Library/Application Support/Galaxy, and takes over when Link isn't running.
@main
enum GalaxyLinkMain {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}

/// Where galaxyd lives and how to reach it.
enum Link {
    // #owner
    static let home = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/Galaxy", isDirectory: true)
    static let defaultPort = 7740
    // #consumer static let home = FileManager.default.homeDirectoryForCurrentUser
    // #consumer     .appendingPathComponent("Library/Application Support/Galaxy Consumer", isDirectory: true)
    // #consumer static let defaultPort = 7750
    // #end

    static var port: Int {
        let saved = try? String(contentsOf: home.appendingPathComponent("port"), encoding: .utf8)
        return saved.flatMap { Int($0.trimmingCharacters(in: .whitespacesAndNewlines)) } ?? defaultPort
    }

    static var address: URL { URL(string: "http://127.0.0.1:\(port)/")! }

    /// The same window serves two apps: Galaxy Link, and Galaxy Trainer, which opens
    /// straight into the Trainer's space. Info.plist says which this build is.
    static var appName: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "Galaxy Link" }
    static var space: String { Bundle.main.object(forInfoDictionaryKey: "GalaxySpace") as? String ?? "" }

    /// The page this app opens on.
    static var startPage: URL {
        space.isEmpty ? address : URL(string: "http://127.0.0.1:\(port)/?space=\(space)#/\(space)")!
    }

    static var token: String? {
        let token = (try? String(contentsOf: home.appendingPathComponent("token"), encoding: .utf8))?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return token?.isEmpty == false ? token : nil
    }

    static func isUp() async -> Bool {
        var request = URLRequest(url: address.appendingPathComponent("v1/health"), timeoutInterval: 2)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        guard let (_, response) = try? await URLSession.shared.data(for: request) else { return false }
        return (response as? HTTPURLResponse)?.statusCode == 200
    }

    // #owner
    static let label = "ai.galaxy.link"
    static let notInstalled = "Galaxy Link isn't installed yet. In the NovaAI repo, run galaxy/install.sh."
    // #consumer static let label = "ai.galaxy.consumer.link"
    // #consumer static let notInstalled = "Galaxy Link couldn't start. Quit it and open it again from Applications."
    // #end

    /// Asks launchd to start galaxyd. Returns a problem to show, or nil.
    static func start() async -> String? {
        // #owner
        // #consumer ConsumerAgents.install()
        // #end
        return await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                let process = Process()
                process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
                process.arguments = ["kickstart", "gui/\(getuid())/\(label)"]
                let pipe = Pipe()
                process.standardError = pipe
                process.standardOutput = pipe
                do { try process.run() } catch {
                    continuation.resume(returning: error.localizedDescription)
                    return
                }
                process.waitUntilExit()
                if process.terminationStatus == 0 {
                    continuation.resume(returning: nil)
                } else {
                    continuation.resume(returning: notInstalled)
                }
            }
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var controller: LinkWindowController!
    // #owner
    /// Galaxy Teach.app only: the watcher, and its menu-bar item.
    private var watcher: TeachWatcher?
    private var statusItem: NSStatusItem?
    // #end

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = makeMenu()
        // #owner
        // #consumer ConsumerAgents.install() // Galaxy Link, the Trainer and Medic, running in the background
        // #end
        controller = LinkWindowController()
        // #owner
        if Link.space == "teach" {
            startTeach()
            // Started with the Mac: watch quietly; the window opens when a lesson does.
            let event = NSAppleEventManager.shared().currentAppleEvent
            let atLogin = event?.eventID == AEEventID(kAEOpenApplication)
                && event?.paramDescriptor(forKeyword: AEKeyword(keyAEPropData))?.enumCodeValue == OSType(keyAELaunchedAsLogInItem)
            if atLogin { return }
        }
        // #end
        controller.showWindow(nil)
        NSApp.activate()
    }

    /// Teach keeps watching with its window closed; quitting it from the menu bar stops it.
    // #owner
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { Link.space != "teach" }
    // #consumer func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    // #end

    // #owner
    private func startTeach() {
        let watcher = TeachWatcher()
        watcher.open = { [weak self] lesson in
            guard let self else { return }
            self.controller.go(lesson.map { "teach/lesson/\($0)" } ?? "teach")
            self.controller.showWindow(nil)
            NSApp.activate()
        }
        watcher.onChange = { [weak self] in self?.drawStatusMenu() }
        self.watcher = watcher
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = NSImage(systemSymbolName: "graduationcap", accessibilityDescription: "Galaxy Teach")
        statusItem = item
        drawStatusMenu()
        watcher.start()
    }

    private func drawStatusMenu() {
        guard let watcher, let item = statusItem else { return }
        let menu = NSMenu()
        let state = menu.addItem(withTitle: watcher.statusLine, action: nil, keyEquivalent: "")
        state.isEnabled = false
        if watcher.waiting > 0 {
            menu.addItem(withTitle: watcher.waiting == 1 ? "1 new lesson waiting…" : "\(watcher.waiting) new lessons waiting…", action: #selector(openTeach), keyEquivalent: "").target = self
        }
        if watcher.notificationsAllowed == false {
            menu.addItem(withTitle: "Turn on notifications…", action: #selector(openNotificationSettings), keyEquivalent: "").target = self
        }
        menu.addItem(.separator())
        menu.addItem(withTitle: watcher.paused ? "Resume watching" : "Pause watching", action: #selector(togglePaused), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Open Galaxy Teach", action: #selector(openTeach), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Your screen is never recorded or saved", action: nil, keyEquivalent: "").isEnabled = false
        menu.addItem(withTitle: "Quit Galaxy Teach", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.menu = menu
        item.button?.appearsDisabled = watcher.paused
        // How many lessons are waiting for a Begin or Skip, next to the icon.
        item.length = watcher.waiting > 0 ? NSStatusItem.variableLength : NSStatusItem.squareLength
        item.button?.title = watcher.waiting > 0 ? " \(watcher.waiting)" : ""
        item.button?.imagePosition = .imageLeading
    }

    @objc private func openNotificationSettings() {
        NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension")!)
    }
    @objc private func togglePaused() { watcher?.setPaused(!(watcher?.paused ?? false)) }
    @objc private func openTeach() {
        controller.showWindow(nil)
        NSApp.activate()
    }
    // #end

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        controller.showWindow(nil)
        return true
    }

    private func makeMenu() -> NSMenu {
        let main = NSMenu()

        let app = NSMenu()
        app.addItem(withTitle: "About \(Link.appName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: "Hide \(Link.appName)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        app.addItem(withTitle: "Quit \(Link.appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        main.addItem(submenu: app, title: Link.appName)

        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        main.addItem(submenu: edit, title: "Edit")

        let view = NSMenu(title: "View")
        view.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r").target = self
        view.addItem(.separator())
        view.addItem(withTitle: "Actual Size", action: #selector(actualSize), keyEquivalent: "0").target = self
        view.addItem(withTitle: "Zoom In", action: #selector(zoomIn), keyEquivalent: "+").target = self
        view.addItem(withTitle: "Zoom Out", action: #selector(zoomOut), keyEquivalent: "-").target = self
        view.addItem(.separator())
        view.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
            .keyEquivalentModifierMask = [.command, .control]
        main.addItem(submenu: view, title: "View")

        let window = NSMenu(title: "Window")
        window.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        window.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        main.addItem(submenu: window, title: "Window")
        NSApp.windowsMenu = window
        return main
    }

    @objc private func reload() { controller.load() }
    @objc private func actualSize() { controller.zoom(nil) }
    @objc private func zoomIn() { controller.zoom(0.1) }
    @objc private func zoomOut() { controller.zoom(-0.1) }
}

private extension NSMenu {
    func addItem(submenu: NSMenu, title: String) {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.submenu = submenu
        addItem(item)
    }
}

@MainActor
final class LinkWindowController: NSWindowController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    static let ground = NSColor(red: 0.973, green: 0.969, blue: 0.957, alpha: 1) // #F8F7F4

    private var webView: WKWebView!
    private let content = WKUserContentController()
    private var offline = false
    private var retry: Task<Void, Never>?

    init() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        window.title = Link.appName
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = false
        window.backgroundColor = Self.ground
        window.appearance = NSAppearance(named: .aqua)
        window.minSize = NSSize(width: 980, height: 640)
        window.tabbingMode = .disallowed
        window.center()
        window.setFrameAutosaveName("GalaxyLinkWindow")
        super.init(window: window)

        content.add(self, name: "galaxy")
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = content
        configuration.websiteDataStore = .nonPersistent() // nothing about the Galaxy is kept in a web cache
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.uiDelegate = self
        view.setValue(false, forKey: "drawsBackground")
        webView = view

        // The page runs edge to edge under the traffic lights; a thin native
        // strip on top keeps the window draggable by its top edge, as any Mac window is.
        let container = NSView()
        view.translatesAutoresizingMaskIntoConstraints = false
        let strip = DragStrip()
        strip.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(view)
        container.addSubview(strip)
        NSLayoutConstraint.activate([
            view.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            view.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            view.topAnchor.constraint(equalTo: container.topAnchor),
            view.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            strip.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            strip.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -300),
            strip.topAnchor.constraint(equalTo: container.topAnchor),
            strip.heightAnchor.constraint(equalToConstant: 38),
        ])
        window.contentView = container
        load()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func load() {
        retry?.cancel()
        offline = false
        content.removeAllUserScripts()
        // The page's only secret, handed over directly: never in a URL, never served by a web server.
        let token = Link.token ?? ""
        let script = "window.__GALAXY__ = Object.freeze({ token: \(Self.jsString(token)), app: true });"
        content.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView.load(URLRequest(url: Link.startPage))
    }

    /// Shows a page of the app: "teach/lesson/l_…".
    func go(_ route: String) {
        if offline { load() }
        webView.evaluateJavaScript("location.hash = \(Self.jsString("#/" + route))", completionHandler: nil)
    }

    func zoom(_ step: CGFloat?) {
        guard let step else { webView.pageZoom = 1; return }
        webView.pageZoom = min(1.6, max(0.7, webView.pageZoom + step))
    }

    // MARK: - When Link isn't running

    private func showOffline(_ status: String = "") {
        offline = true
        webView.loadHTMLString(OfflinePage.html(status: status), baseURL: nil)
        retry?.cancel()
        retry = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                guard !Task.isCancelled else { return }
                if await Link.isUp() {
                    self?.load()
                    return
                }
            }
        }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        // #owner
        // #consumer if message.name == "galaxy", (message.body as? String) == "connectClaude" { ConsumerAgents.openClaudeSignIn(); return }
        // #end
        guard offline, message.name == "galaxy", (message.body as? String) == "start" else { return }
        setStatus("Starting Galaxy Link…")
        Task {
            if let problem = await Link.start() {
                setStatus(problem)
                return
            }
            for _ in 0..<20 {
                if await Link.isUp() { load(); return }
                try? await Task.sleep(nanoseconds: 500_000_000)
            }
            setStatus("Galaxy Link didn't start. Its log is in ~/Library/Application Support/Galaxy/galaxyd.log.")
        }
    }

    private func setStatus(_ text: String) {
        webView.evaluateJavaScript("window.setStatus && window.setStatus(\(Self.jsString(text)))", completionHandler: nil)
    }

    // MARK: - Navigation

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let code = (error as NSError).code
        guard code != NSURLErrorCancelled, code != 102 else { return }
        showOffline()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // Links out of the app (a site a member built, a source) open in the browser.
        if let url = navigationAction.request.url, isExternal(url),
           navigationAction.navigationType == .linkActivated || navigationAction.targetFrame == nil {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    private func isExternal(_ url: URL) -> Bool {
        guard let scheme = url.scheme, scheme == "http" || scheme == "https" else { return false }
        return url.host != "127.0.0.1" || url.port != Link.port
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    static func jsString(_ text: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: [text])) ?? Data("[\"\"]".utf8)
        let array = String(decoding: data, as: UTF8.self)
        return String(array.dropFirst().dropLast())
    }
}

/// An invisible band across the top that moves the window, and zooms it on a double click.
final class DragStrip: NSView {
    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 {
            window?.performZoom(nil)
        } else {
            window?.performDrag(with: event)
        }
    }
}

/// Shown when galaxyd doesn't answer: the same look as the app, with a way to start it.
enum OfflinePage {
    static func html(status: String) -> String {
        """
        <!doctype html><html><head><meta charset="utf-8"><style>
        :root { color-scheme: light; }
        html, body { height: 100%; margin: 0; }
        body { background: #f8f7f4; color: #141413; font: 14px/1.55 -apple-system, BlinkMacSystemFont, sans-serif;
               display: grid; place-items: center; -webkit-font-smoothing: antialiased; -webkit-user-select: none; }
        .drag { position: fixed; top: 0; left: 0; right: 0; height: 46px; -webkit-app-region: drag; }
        .box { text-align: center; max-width: 440px; padding: 24px; }
        h1 { font: 400 40px/1.05 "New York", ui-serif, Georgia, serif; letter-spacing: -.02em; margin: 26px 0 12px; }
        p { color: #57534c; margin: 0 0 24px; font-size: 15px; line-height: 1.6; }
        button { height: 36px; padding: 0 18px; border-radius: 9px; border: 1px solid #141413; background: #141413;
                 color: #fff; font: 600 13px -apple-system, sans-serif; cursor: pointer; }
        button:hover { background: #262b36; }
        #status { margin-top: 18px; color: #8a857c; font: 12px ui-monospace, "SF Mono", monospace; min-height: 20px; }
        </style></head><body><div class="drag"></div><div class="box">
        <svg width="64" height="64" viewBox="0 0 32 32"><circle cx="16" cy="16" r="10" fill="none" stroke="#141413" stroke-opacity=".22"/>
        <circle cx="16" cy="16" r="3.4" fill="#141413"/>
        <circle cx="16" cy="6" r="2.3" fill="#d97706"/><circle cx="25.51" cy="12.91" r="2.3" fill="#dc2626"/>
        <circle cx="21.88" cy="24.09" r="2.3" fill="#6d4aff"/><circle cx="10.12" cy="24.09" r="2.3" fill="#059669"/>
        <circle cx="6.49" cy="12.91" r="2.3" fill="#2563eb"/></svg>
        <h1>Galaxy Link isn't running</h1>
        <p>The members can't reach each other until it starts. It normally starts on its own when you log in.</p>
        <button onclick="window.webkit.messageHandlers.galaxy.postMessage('start')">Start Galaxy Link</button>
        <div id="status">\(status.replacingOccurrences(of: "<", with: "&lt;"))</div>
        </div><script>window.setStatus = (t) => { document.getElementById('status').textContent = t; };</script></body></html>
        """
    }
}
