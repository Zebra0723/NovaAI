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
    static let home = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/Galaxy", isDirectory: true)

    static var port: Int {
        let saved = try? String(contentsOf: home.appendingPathComponent("port"), encoding: .utf8)
        return saved.flatMap { Int($0.trimmingCharacters(in: .whitespacesAndNewlines)) } ?? 7740
    }

    static var address: URL { URL(string: "http://127.0.0.1:\(port)/")! }

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

    /// Asks launchd to start galaxyd. Returns a problem to show, or nil.
    static func start() async -> String? {
        await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                let process = Process()
                process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
                process.arguments = ["kickstart", "gui/\(getuid())/ai.galaxy.link"]
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
                    continuation.resume(returning: "Galaxy Link isn't installed yet. In the NovaAI repo, run galaxy/install.sh.")
                }
            }
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var controller: LinkWindowController!

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = makeMenu()
        controller = LinkWindowController()
        controller.showWindow(nil)
        NSApp.activate()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        controller.showWindow(nil)
        return true
    }

    private func makeMenu() -> NSMenu {
        let main = NSMenu()

        let app = NSMenu()
        app.addItem(withTitle: "About Galaxy Link", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: "Hide Galaxy Link", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        app.addItem(withTitle: "Quit Galaxy Link", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        main.addItem(submenu: app, title: "Galaxy Link")

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
    static let ground = NSColor(red: 0.957, green: 0.961, blue: 0.973, alpha: 1) // #F4F5F8

    private var webView: WKWebView!
    private let content = WKUserContentController()
    private var offline = false
    private var retry: Task<Void, Never>?

    init() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        window.title = "Galaxy Link"
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
        webView.load(URLRequest(url: Link.address))
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
        body { background: #f4f5f8; color: #0d1017; font: 14px/1.55 -apple-system, BlinkMacSystemFont, sans-serif;
               display: grid; place-items: center; -webkit-font-smoothing: antialiased; -webkit-user-select: none; }
        .drag { position: fixed; top: 0; left: 0; right: 0; height: 46px; -webkit-app-region: drag; }
        .box { text-align: center; max-width: 440px; padding: 24px; }
        h1 { font: 600 24px/1.2 -apple-system, BlinkMacSystemFont, sans-serif; letter-spacing: -.02em; margin: 22px 0 8px; }
        p { color: #4a5160; margin: 0 0 22px; }
        button { height: 36px; padding: 0 18px; border-radius: 9px; border: 1px solid #0d1017; background: #0d1017;
                 color: #fff; font: 600 13px -apple-system, sans-serif; cursor: pointer; }
        button:hover { background: #262b36; }
        #status { margin-top: 16px; color: #6b7280; font-size: 12.5px; min-height: 20px; }
        </style></head><body><div class="drag"></div><div class="box">
        <svg width="72" height="72" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="8.5" fill="#fff" stroke="#e6e8ee"/>
        <circle cx="16" cy="16" r="9.6" fill="none" stroke="#d9dce4"/><circle cx="16" cy="16" r="3.6" fill="#0d1017"/>
        <circle cx="16" cy="6.4" r="2.4" fill="#e48a00"/><circle cx="25.13" cy="13.03" r="2.4" fill="#e5483b"/>
        <circle cx="21.64" cy="23.77" r="2.4" fill="#7259f5"/><circle cx="10.36" cy="23.77" r="2.4" fill="#0ea887"/>
        <circle cx="6.87" cy="13.03" r="2.4" fill="#2c74f0"/></svg>
        <h1>Galaxy Link isn't running</h1>
        <p>The members can't reach each other until it starts. It normally starts on its own when you log in.</p>
        <button onclick="window.webkit.messageHandlers.galaxy.postMessage('start')">Start Galaxy Link</button>
        <div id="status">\(status.replacingOccurrences(of: "<", with: "&lt;"))</div>
        </div><script>window.setStatus = (t) => { document.getElementById('status').textContent = t; };</script></body></html>
        """
    }
}
