import AppKit
import ServiceManagement
import SwiftUI

struct SettingsView: View {
    @ObservedObject var store: NovaStore
    @ObservedObject var controller: NovaController

    @State private var maskedKey = SettingsView.mask(Keychain.apiKey)
    @State private var editingKey = false
    @State private var newKey = ""
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    @State private var screenRecording = Permissions.hasScreenRecording
    @State private var accessibility = Permissions.hasAccessibility
    @State private var confirmingClear = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                PageHeader(title: "Settings")
                apiKey
                proactive
                context
                general
                permissions
                data
            }
            .padding(.horizontal, 40)
            .padding(.top, 48)
            .padding(.bottom, 40)
            .frame(maxWidth: 820, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear(perform: refresh)
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            refresh()
        }
    }

    private func refresh() {
        maskedKey = Self.mask(Keychain.apiKey)
        screenRecording = Permissions.hasScreenRecording
        accessibility = Permissions.hasAccessibility
        launchAtLogin = SMAppService.mainApp.status == .enabled
    }

    // MARK: - Sections

    private var apiKey: some View {
        group("Anthropic API key") {
            if editingKey {
                HStack(spacing: 10) {
                    SecureField("sk-ant-…", text: $newKey)
                        .novaField()
                        .onSubmit(saveKey)
                    Button("Cancel") {
                        editingKey = false
                        newKey = ""
                    }
                    .buttonStyle(NovaButtonStyle())
                    Button("Save", action: saveKey)
                        .buttonStyle(NovaButtonStyle(kind: .primary))
                        .disabled(newKey.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            } else {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(maskedKey ?? "No key saved")
                            .font(Theme.mono(13))
                            .foregroundStyle(maskedKey == nil ? Theme.secondary : Theme.ink)
                        Text("Stored in your login keychain. Create keys at platform.claude.com.")
                            .font(Theme.caption(11.5))
                            .foregroundStyle(Theme.tertiary)
                    }
                    Spacer()
                    if maskedKey != nil {
                        Button("Remove") {
                            Keychain.deleteAPIKey()
                            refresh()
                        }
                        .buttonStyle(NovaButtonStyle(kind: .destructive))
                    }
                    Button(maskedKey == nil ? "Add key" : "Change key") { editingKey = true }
                        .buttonStyle(NovaButtonStyle(kind: .primary))
                }
            }
        }
    }

    private var proactive: some View {
        group("Proactive help") {
            toggle("Offer help when Nova spots a problem",
                   detail: "Nova glances at your screen when it changes and offers to fix errors and failed builds. Each check uses Haiku and costs a fraction of a cent.",
                   isOn: $store.settings.proactiveEnabled)
            if store.settings.proactiveEnabled {
                Hairline()
                HStack {
                    Text("Check at most every")
                        .font(Theme.body())
                    Spacer()
                    Picker("", selection: $store.settings.proactiveIntervalSeconds) {
                        Text("30 seconds").tag(30.0)
                        Text("45 seconds").tag(45.0)
                        Text("1 minute").tag(60.0)
                        Text("2 minutes").tag(120.0)
                        Text("5 minutes").tag(300.0)
                    }
                    .labelsHidden()
                    .frame(width: 160)
                }
            }
        }
    }

    private var context: some View {
        group("Smart context") {
            toggle("Selected text", detail: "Include text you've highlighted in the app you're using.",
                   isOn: $store.settings.contextSelection)
            Hairline()
            toggle("Browser tab", detail: "Include the page open in Safari, Chrome, Arc, Brave, Edge, or Vivaldi.",
                   isOn: $store.settings.contextBrowser)
            Hairline()
            toggle("Finder selection", detail: "Include the files you've selected in Finder.",
                   isOn: $store.settings.contextFinder)
        }
    }

    private var general: some View {
        group("General") {
            toggle("Launch at login", detail: "Start Nova when you log in to your Mac.", isOn: Binding(
                get: { launchAtLogin },
                set: { enabled in
                    do {
                        if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
                    } catch {
                        NSLog("Nova: login item change failed: \(error)")
                    }
                    launchAtLogin = SMAppService.mainApp.status == .enabled
                }
            ))
            Hairline()
            row("Shortcut", detail: "Summon Nova from anywhere.") {
                Text("⌃ Space")
                    .font(.system(size: 12.5, weight: .medium, design: .rounded))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Theme.selection.opacity(0.6), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
            Hairline()
            row("Bar size and position", detail: "Put the bar back in the middle at its original size.") {
                Button("Reset") { controller.resetSizeAndPosition() }
                    .buttonStyle(NovaButtonStyle())
            }
        }
    }

    private var permissions: some View {
        group("Permissions") {
            permissionRow("Screen Recording", detail: "Lets Nova see your screen.", granted: screenRecording,
                          pane: "Privacy_ScreenCapture")
            Hairline()
            permissionRow("Accessibility", detail: "Lets Nova click, type, and read selected text.",
                          granted: accessibility, pane: "Privacy_Accessibility")
        }
    }

    private var data: some View {
        group("Data") {
            row("Nova's folder", detail: "Conversations, memories, and settings are stored on this Mac only.") {
                Button("Show in Finder") {
                    NSWorkspace.shared.activateFileViewerSelecting([store.directory])
                }
                .buttonStyle(NovaButtonStyle())
            }
            Hairline()
            row("Conversation history", detail: "\(store.conversations.count) conversations saved.") {
                Button("Delete all") { confirmingClear = true }
                    .buttonStyle(NovaButtonStyle(kind: .destructive))
                    .disabled(store.conversations.isEmpty)
                    .confirmationDialog("Delete every conversation?", isPresented: $confirmingClear) {
                        Button("Delete all", role: .destructive) { store.deleteAllConversations() }
                    } message: {
                        Text("This can't be undone. Memories are kept.")
                    }
            }
        }
    }

    // MARK: - Building blocks

    private func group<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(title)
            Card(padding: 0) {
                VStack(alignment: .leading, spacing: 0) {
                    content()
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 6)
            }
        }
    }

    private func toggle(_ title: String, detail: String, isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(Theme.body())
                Text(detail)
                    .font(Theme.caption(11.5))
                    .foregroundStyle(Theme.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .toggleStyle(.switch)
        .padding(.vertical, 12)
    }

    private func row<Trailing: View>(_ title: String, detail: String,
                                     @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(Theme.body())
                Text(detail)
                    .font(Theme.caption(11.5))
                    .foregroundStyle(Theme.tertiary)
            }
            Spacer()
            trailing()
        }
        .padding(.vertical, 12)
    }

    private func permissionRow(_ title: String, detail: String, granted: Bool, pane: String) -> some View {
        row(title, detail: detail) {
            HStack(spacing: 12) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(granted ? Color(red: 0.2, green: 0.6, blue: 0.4) : Theme.danger)
                        .frame(width: 7, height: 7)
                    Text(granted ? "Allowed" : "Not allowed")
                        .font(Theme.caption(12))
                        .foregroundStyle(Theme.secondary)
                }
                if !granted {
                    Button("Open Settings") {
                        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)") {
                            NSWorkspace.shared.open(url)
                        }
                    }
                    .buttonStyle(NovaButtonStyle())
                }
            }
        }
    }

    private func saveKey() {
        let key = newKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { return }
        Keychain.saveAPIKey(key)
        controller.needsKey = false
        newKey = ""
        editingKey = false
        refresh()
    }

    private static func mask(_ key: String?) -> String? {
        guard let key, key.count > 12 else { return key == nil ? nil : "••••" }
        return String(key.prefix(7)) + "••••••••" + String(key.suffix(4))
    }
}
