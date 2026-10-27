import AppKit
import SwiftUI

/// The Nova app window: conversations, memory, stats, and settings.
@MainActor
final class AppWindowController: NSObject, NSWindowDelegate {
    private var window: NSWindow?
    private let controller: NovaController
    private let navigation = AppNavigation()

    init(controller: NovaController) {
        self.controller = controller
    }

    func show(_ section: AppSection? = nil) {
        if let section { navigation.section = section }
        if window == nil { window = makeWindow() }
        // Show a Dock icon and app menu while the window is open.
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }

    func windowWillClose(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
    }

    private func makeWindow() -> NSWindow {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1080, height: 720),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        window.title = "Nova"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.isMovableByWindowBackground = true
        window.appearance = NSAppearance(named: .aqua) // light mode only
        window.backgroundColor = NSColor(Theme.background)
        window.minSize = NSSize(width: 900, height: 600)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentView = NSHostingView(
            rootView: AppRootView(navigation: navigation, controller: controller)
                .environment(\.colorScheme, .light)
        )
        window.center()
        window.setFrameAutosaveName("NovaAppWindow")
        return window
    }
}

enum AppSection: String, CaseIterable, Identifiable {
    case conversations, memory, stats, settings
    var id: String { rawValue }

    var title: String {
        switch self {
        case .conversations: return "Conversations"
        case .memory: return "Memory"
        case .stats: return "Stats"
        case .settings: return "Settings"
        }
    }

    var icon: String {
        switch self {
        case .conversations: return "text.bubble"
        case .memory: return "brain"
        case .stats: return "chart.bar"
        case .settings: return "gearshape"
        }
    }
}

@MainActor
final class AppNavigation: ObservableObject {
    @Published var section: AppSection = .conversations
}

struct AppRootView: View {
    @ObservedObject var navigation: AppNavigation
    @ObservedObject var controller: NovaController
    @ObservedObject private var store = NovaStore.shared

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            Rectangle().fill(Theme.hairline).frame(width: 1)
            Group {
                switch navigation.section {
                case .conversations: ConversationsView(store: store)
                case .memory: MemoryView(store: store)
                case .stats: StatsView(store: store)
                case .settings: SettingsView(store: store, controller: controller)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.background)
        }
        .ignoresSafeArea()
        .foregroundStyle(Theme.ink)
        .tint(Theme.accent)
    }

    private static func count(_ n: Int, _ singular: String, _ plural: String? = nil) -> String {
        "\(n) \(n == 1 ? singular : (plural ?? singular + "s"))"
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 9) {
                NovaGlyph()
                    .frame(width: 18, height: 18)
                Text("Nova")
                    .font(Theme.display(20))
            }
            .padding(.horizontal, 12)
            .padding(.top, 52)
            .padding(.bottom, 24)

            ForEach(AppSection.allCases) { section in
                SidebarRow(section: section, selected: navigation.section == section) {
                    navigation.section = section
                }
            }

            Spacer()

            VStack(alignment: .leading, spacing: 4) {
                Text("Press ⌃Space to summon Nova")
                    .font(Theme.caption(11))
                    .foregroundStyle(Theme.tertiary)
                Text("\(Self.count(store.conversations.count, "conversation")) · \(Self.count(store.memories.count, "memory", "memories"))")
                    .font(Theme.caption(11))
                    .foregroundStyle(Theme.tertiary)
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 18)
        }
        .padding(.horizontal, 10)
        .frame(width: 224)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Theme.sidebar)
    }
}

private struct SidebarRow: View {
    let section: AppSection
    let selected: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: section.icon)
                    .font(.system(size: 13, weight: .regular))
                    .frame(width: 18)
                    .foregroundStyle(selected ? Theme.accent : Theme.secondary)
                Text(section.title)
                    .font(.system(size: 13.5, weight: selected ? .semibold : .regular))
                    .foregroundStyle(selected ? Theme.ink : Theme.secondary)
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(selected ? Theme.selection : (hovering ? Theme.selection.opacity(0.5) : .clear))
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

/// Nova's four-point star in the app's accent, used in the sidebar.
struct NovaGlyph: View {
    var body: some View {
        StarShape()
            .fill(LinearGradient(colors: [Color(red: 0.56, green: 0.72, blue: 1), Theme.accent],
                                 startPoint: .topLeading, endPoint: .bottomTrailing))
    }
}

/// A four-point star with concave sides (shared by the app UI and the menu-bar icon).
struct StarShape: Shape {
    func path(in rect: CGRect) -> Path {
        let c = CGPoint(x: rect.midX, y: rect.midY)
        let r = min(rect.width, rect.height) / 2
        let pinch = r * 0.16
        let tips = [
            CGPoint(x: c.x, y: c.y - r), CGPoint(x: c.x + r, y: c.y),
            CGPoint(x: c.x, y: c.y + r), CGPoint(x: c.x - r, y: c.y),
        ]
        let controls = [
            CGPoint(x: c.x + pinch, y: c.y - pinch), CGPoint(x: c.x + pinch, y: c.y + pinch),
            CGPoint(x: c.x - pinch, y: c.y + pinch), CGPoint(x: c.x - pinch, y: c.y - pinch),
        ]
        var path = Path()
        path.move(to: tips[0])
        for i in 0..<4 {
            path.addQuadCurve(to: tips[(i + 1) % 4], control: controls[i])
        }
        path.closeSubpath()
        return path
    }
}
