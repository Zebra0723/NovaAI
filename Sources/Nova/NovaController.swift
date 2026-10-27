import AppKit
import SwiftUI

/// Owns Nova's UI state and runs requests through the agent.
@MainActor
final class NovaController: ObservableObject {
    @Published var input = ""
    @Published var status = ""
    @Published var answer: String?
    @Published var answeredBy: Tier?
    @Published var answerIsError = false
    @Published var isShown = false
    @Published var isWorking = false
    @Published var isActing = false
    @Published var tier: Tier?
    @Published var needsKey = Keychain.apiKey == nil
    @Published var focusToken = 0 // bumped to pull keyboard focus into the field

    // Bar size the user picked with the resize grip; saved between launches.
    static let defaultBarWidth: CGFloat = 680
    @Published var barWidth: CGFloat = {
        let saved = UserDefaults.standard.double(forKey: "nova.barWidth")
        return saved > 0 ? saved : NovaController.defaultBarWidth
    }()
    /// Fixed height for the answer area, or nil to fit the answer (up to a limit).
    @Published var answerHeight: CGFloat? = {
        let saved = UserDefaults.standard.double(forKey: "nova.answerHeight")
        return saved > 0 ? saved : nil
    }()

    weak var panel: NovaPanel?

    private var agent: NovaAgent?
    private var task: Task<Void, Never>?
    private var monitors: [Any] = []

    init() {
        installEscapeMonitors()
    }

    // MARK: - Showing and hiding

    func toggle() {
        if panel?.isVisible == true && !isWorking {
            hide()
        } else {
            show()
        }
    }

    func show() {
        // Only force key entry when there's no key; don't undo "Change API Key…".
        if Keychain.apiKey == nil { needsKey = true }
        panel?.present(acting: isActing, interactive: !isWorking)
        isShown = true
        focusToken += 1
    }

    func hide() {
        panel?.orderOut(nil)
        isShown = false
        // Closing the bar ends the conversation; the next summon starts fresh.
        agent = nil
        answer = nil
        answeredBy = nil
        answerIsError = false
        input = ""
        status = ""
        // Backing out of "Change API Key…" keeps the current key.
        needsKey = Keychain.apiKey == nil
    }

    func saveSize() {
        UserDefaults.standard.set(Double(barWidth), forKey: "nova.barWidth")
        if let answerHeight {
            UserDefaults.standard.set(Double(answerHeight), forKey: "nova.answerHeight")
        }
    }

    func resetSizeAndPosition() {
        barWidth = Self.defaultBarWidth
        answerHeight = nil
        UserDefaults.standard.removeObject(forKey: "nova.barWidth")
        UserDefaults.standard.removeObject(forKey: "nova.answerHeight")
        panel?.resetPosition()
    }

    func beginKeyEntry() {
        needsKey = true
        answer = nil
        show()
    }

    // MARK: - Requests

    func submit() {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isWorking else { return }

        if needsKey {
            Keychain.saveAPIKey(text)
            agent = nil // the old conversation was using the old key
            input = ""
            needsKey = false
            answeredBy = nil
            answerIsError = false
            answer = "Key saved. Nova is awake ✦"
            return
        }
        guard let key = Keychain.apiKey else { needsKey = true; return }

        let agent = self.agent ?? NovaAgent(apiKey: key)
        self.agent = agent
        input = ""
        answer = nil
        status = "Thinking…"
        isWorking = true
        // Give keyboard focus back to the user's app so Nova's typing lands there.
        panel?.present(acting: false, interactive: false)

        task = Task { [weak self] in
            do {
                let reply = try await agent.run(text) { event in
                    self?.handle(event)
                }
                self?.finish(with: reply, failed: false)
            } catch {
                let cancelled = Task.isCancelled || error is CancellationError
                    || (error as? URLError)?.code == .cancelled
                self?.finish(with: cancelled ? "Stopped." : error.localizedDescription, failed: true,
                             isError: !cancelled)
            }
        }
    }

    func cancel() {
        guard isWorking else { return }
        task?.cancel()
    }

    private func handle(_ event: NovaAgent.Event) {
        switch event {
        case .status(let note):
            status = note
        case .tier(let tier):
            self.tier = tier
        case .acting(let acting):
            guard acting != isActing else { return }
            isActing = acting
            panel?.present(acting: acting, interactive: false)
        }
    }

    private func finish(with reply: String, failed: Bool, isError: Bool = false) {
        task = nil
        // A cancelled or failed run can leave a tool call unanswered, so start over next time.
        if failed { agent = nil }
        answeredBy = failed ? nil : tier
        answerIsError = isError
        isWorking = false
        isActing = false
        status = ""
        tier = nil
        answer = reply
        panel?.present(acting: false, interactive: true)
        focusToken += 1
    }

    // MARK: - Esc kill switch

    private func installEscapeMonitors() {
        // Global: Esc anywhere stops a running task. Ignores the key presses Nova itself posts.
        if let global = NSEvent.addGlobalMonitorForEvents(matching: .keyDown, handler: { [weak self] event in
            guard event.keyCode == KeyCodes.escape,
                  event.cgEvent?.getIntegerValueField(.eventSourceUserData) != ComputerController.eventTag
            else { return }
            Task { @MainActor in self?.cancel() }
        }) {
            monitors.append(global)
        }

        // Local: Esc while the bar has focus stops a task, or closes the bar.
        if let local = NSEvent.addLocalMonitorForEvents(matching: .keyDown, handler: { [weak self] event in
            guard event.keyCode == KeyCodes.escape else { return event }
            let handled = MainActor.assumeIsolated { () -> Bool in
                guard let self else { return false }
                if self.isWorking { self.cancel() } else { self.hide() }
                return true
            }
            return handled ? nil : event
        }) {
            monitors.append(local)
        }
    }
}
