import AppKit
import ServiceManagement

@main
enum NovaMain {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory) // menu bar only, no Dock icon
        app.run()
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var hotKey: HotKey?
    private var panel: NovaPanel!
    private let controller = NovaController()

    func applicationDidFinishLaunching(_ notification: Notification) {
        panel = NovaPanel(controller: controller)
        controller.panel = panel

        setUpStatusItem()

        // ⌃Space summons Nova from anywhere.
        hotKey = HotKey(keyCode: KeyCodes.space, modifiers: .control) { [weak self] in
            self?.controller.toggle()
        }

        Permissions.requestIfNeeded()
    }

    private func setUpStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "sparkle", accessibilityDescription: "Nova")
        }

        let menu = NSMenu()
        menu.addItem(withTitle: "Summon Nova  ⌃Space", action: #selector(summon), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Stop Nova", action: #selector(stop), keyEquivalent: "").target = self
        menu.addItem(.separator())

        let login = NSMenuItem(title: "Launch at Login", action: #selector(toggleLoginItem(_:)), keyEquivalent: "")
        login.target = self
        login.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(login)

        menu.addItem(withTitle: "Change API Key…", action: #selector(changeKey), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Reset Size & Position", action: #selector(resetLayout), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Check Permissions", action: #selector(checkPermissions), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Nova", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        statusItem.menu = menu
    }

    @objc private func summon() { controller.show() }
    @objc private func stop() { controller.cancel() }
    @objc private func changeKey() { controller.beginKeyEntry() }
    @objc private func resetLayout() { controller.resetSizeAndPosition() }
    @objc private func checkPermissions() { Permissions.requestIfNeeded(force: true) }

    @objc private func toggleLoginItem(_ sender: NSMenuItem) {
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
                sender.state = .off
            } else {
                try SMAppService.mainApp.register()
                sender.state = .on
            }
        } catch {
            NSLog("Nova: login item change failed: \(error)")
        }
    }
}
