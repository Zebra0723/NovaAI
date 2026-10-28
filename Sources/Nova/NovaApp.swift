import AppKit

@main
enum NovaMain {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory) // menu bar only until the app window opens
        app.run()
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var hotKey: HotKey?
    private var panel: NovaPanel!
    private let controller = NovaController()
    private lazy var appWindow = AppWindowController(controller: controller)
    private lazy var watcher = ProactiveWatcher(controller: controller)
    private lazy var galaxy = NovaLink(controller: controller)

    func applicationDidFinishLaunching(_ notification: Notification) {
        panel = NovaPanel(controller: controller)
        controller.panel = panel

        NSApp.mainMenu = makeMainMenu()
        setUpStatusItem()

        // ⌃Space summons Nova from anywhere.
        hotKey = HotKey(keyCode: KeyCodes.space, modifiers: .control) { [weak self] in
            self?.controller.toggle()
        }

        Permissions.requestIfNeeded()
        watcher.start()
        galaxy.start()
    }

    /// Tells the Galaxy Nova is going, so its work isn't left waiting on a body that quit.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        Task {
            await galaxy.stop()
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    /// Clicking Nova in the Dock (while the app window is open) brings the window back.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        appWindow.show()
        return true
    }

    // MARK: - Menu bar item

    private func setUpStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = Self.starImage()

        let menu = NSMenu()
        menu.addItem(withTitle: "Open Nova", action: #selector(openApp), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Summon Nova  ⌃Space", action: #selector(summon), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Stop Nova", action: #selector(stop), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Settings…", action: #selector(openSettings), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Nova", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        statusItem.menu = menu
    }

    /// Nova's four-point star as a template image, so it follows the menu bar's color.
    private static func starImage() -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: true) { rect in
            guard let context = NSGraphicsContext.current?.cgContext else { return false }
            let star = StarShape().path(in: rect.insetBy(dx: 2, dy: 2)).cgPath
            context.addPath(star)
            context.setFillColor(NSColor.black.cgColor)
            context.fillPath()
            // A tiny companion star, top right.
            let small = StarShape().path(in: CGRect(x: rect.maxX - 6, y: rect.minY, width: 6, height: 6)).cgPath
            context.addPath(small)
            context.fillPath()
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "Nova"
        return image
    }

    // MARK: - Main menu (shown while the app window is open)

    private func makeMainMenu() -> NSMenu {
        let main = NSMenu()

        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Nova", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
                        keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Settings…", action: #selector(openSettings), keyEquivalent: ",").target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Nova", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit Nova", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        main.addItem(submenu: appMenu, title: "Nova")

        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        main.addItem(submenu: editMenu, title: "Edit")

        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        main.addItem(submenu: windowMenu, title: "Window")
        NSApp.windowsMenu = windowMenu

        return main
    }

    // MARK: - Actions

    @objc private func openApp() { appWindow.show() }
    @objc private func openSettings() { appWindow.show(.settings) }
    @objc private func summon() { controller.show() }
    @objc private func stop() { controller.cancel() }
}

private extension NSMenu {
    func addItem(submenu: NSMenu, title: String) {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.submenu = submenu
        addItem(item)
    }
}
