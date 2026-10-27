import AppKit
import SwiftUI

/// Owns Nova's bar state and runs requests through the agent.
@MainActor
final class NovaController: ObservableObject {
    @Published var input = ""
    @Published var status = ""
    @Published var answer: String?
    @Published var liveText = ""          // the reply as it streams in
    @Published var answeredBy: Tier?
    @Published var answerIsError = false
    @Published var isShown = false
    @Published var isWorking = false
    @Published var isActing = false
    @Published var tier: Tier?
    @Published var context: [ContextItem] = []
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

    private let store = NovaStore.shared
    private var agent: NovaAgent?
    private var conversation: Conversation?
    private var exchange: Exchange?
    private var task: Task<Void, Never>?
    private var contextTask: Task<Void, Never>?
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
        // Only force key entry when there's no key; don't undo "Change API Key".
        if Keychain.apiKey == nil { needsKey = true }
        if !isShown && !isWorking { gatherContext() }
        panel?.present(acting: isActing, interactive: !isWorking)
        isShown = true
        focusToken += 1
    }

    /// Opens the bar and immediately runs `request` (used by proactive suggestions).
    func run(_ request: String) {
        guard !isWorking else { return }
        if isShown { hide() }
        show()
        context = []
        contextTask?.cancel()
        input = request
        submit()
    }

    func hide() {
        panel?.orderOut(nil)
        isShown = false
        // Closing the bar ends the conversation; the next summon starts fresh.
        agent = nil
        conversation = nil
        answer = nil
        liveText = ""
        answeredBy = nil
        answerIsError = false
        input = ""
        status = ""
        context = []
        contextTask?.cancel()
        // Backing out of "Change API Key" keeps the current key.
        needsKey = Keychain.apiKey == nil
    }

    func beginKeyEntry() {
        needsKey = true
        answer = nil
        show()
    }

    func removeContext(_ item: ContextItem) {
        context.removeAll { $0.id == item.id }
    }

    private func gatherContext() {
        context = []
        contextTask?.cancel()
        let settings = store.settings
        contextTask = Task { [weak self] in
            let items = await ContextGatherer.gather(settings: settings)
            guard !Task.isCancelled else { return }
            self?.context = items
        }
    }

    // MARK: - Size

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
            answer = "Key saved. Nova is awake."
            return
        }
        guard let key = Keychain.apiKey else { needsKey = true; return }

        let agent = self.agent ?? NovaAgent(apiKey: key, memories: store.memories)
        self.agent = agent
        if conversation == nil { conversation = Conversation() }

        // Context is attached to the first request after a summon only.
        let attached = context
        context = []
        contextTask?.cancel()
        exchange = Exchange(request: text, context: attached.map(\.label))

        input = ""
        answer = nil
        liveText = ""
        status = "Thinking…"
        isWorking = true
        // Give keyboard focus back to the user's app so Nova's typing lands there.
        panel?.present(acting: false, interactive: false)

        let started = Date()
        task = Task { [weak self] in
            do {
                let reply = try await agent.run(text, context: attached) { event in
                    self?.handle(event)
                }
                self?.finish(with: reply, outcome: .completed, started: started)
            } catch {
                let cancelled = Task.isCancelled || error is CancellationError
                    || (error as? URLError)?.code == .cancelled
                self?.finish(with: cancelled ? "Stopped." : error.localizedDescription,
                             outcome: cancelled ? .stopped : .failed, started: started)
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
            exchange?.tier = tier.rawValue
            exchange?.model = tier.model
        case .text(let text):
            liveText = text
        case .action(let record):
            exchange?.actions.append(record)
        case .usage(let usage):
            exchange?.usage += usage
        case .acting(let acting):
            guard acting != isActing else { return }
            isActing = acting
            panel?.present(acting: acting, interactive: false)
        }
    }

    private func finish(with reply: String, outcome: Exchange.Outcome, started: Date) {
        task = nil
        // A cancelled or failed run can leave a tool call unanswered, so start over next time.
        if outcome != .completed { agent = nil }
        answeredBy = outcome == .completed ? tier : nil
        answerIsError = outcome == .failed
        isWorking = false
        isActing = false
        status = ""
        liveText = ""
        tier = nil
        answer = reply

        if var exchange, var conversation {
            exchange.reply = reply
            exchange.outcome = outcome
            exchange.duration = Date().timeIntervalSince(started)
            conversation.exchanges.append(exchange)
            conversation.updatedAt = Date()
            self.conversation = conversation
            store.save(conversation)
        }
        exchange = nil

        if isShown {
            panel?.present(acting: false, interactive: true)
            focusToken += 1
        } else {
            panel?.orderOut(nil)
        }
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
        // Other windows (like the Nova app) keep their own Esc behavior.
        if let local = NSEvent.addLocalMonitorForEvents(matching: .keyDown, handler: { [weak self] event in
            guard event.keyCode == KeyCodes.escape else { return event }
            let handled = MainActor.assumeIsolated { () -> Bool in
                guard let self, self.panel?.isKeyWindow == true else { return false }
                if self.isWorking { self.cancel() } else { self.hide() }
                return true
            }
            return handled ? nil : event
        }) {
            monitors.append(local)
        }
    }
}
