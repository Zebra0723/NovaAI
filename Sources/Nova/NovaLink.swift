import Foundation

/// Keeps Nova in the Galaxy while it runs: says hello (Link posts Nova's intro in Galaxy Chat
/// the first time), keeps the shared memory in step, does the screen work other members hand
/// over, and shows the results Link routes to the screen.
///
/// None of it is needed: with Galaxy Link not installed or not running, every loop just waits
/// and Nova works on its own exactly as before.
@MainActor
final class NovaLink {
    private let controller: NovaController
    private var loops: [Task<Void, Never>] = []
    /// True while a Galaxy Trainer drill is being answered; drills run one at a time.
    private var practicing = false
    /// Drills that arrived while one was being answered: they wait their turn, never dropped.
    private var drills: [(item: GalaxyLink.InboxItem, at: Date)] = []

    init(controller: NovaController) {
        self.controller = controller
    }

    func start() {
        let link = GalaxyLink.shared
        loops = [
            // Presence and memory: every 30 seconds.
            Task { [weak self] in
                while !Task.isCancelled {
                    if await link.heartbeat() { await self?.syncMemory() }
                    try? await Task.sleep(nanoseconds: 30_000_000_000)
                }
            },
            // Work handed to Nova. Each poll waits up to 25 seconds for a task.
            Task { [weak self] in
                while !Task.isCancelled {
                    guard let task = await link.nextTask() else {
                        if !(await link.isRunning()) { try? await Task.sleep(nanoseconds: 10_000_000_000) }
                        continue
                    }
                    guard let self else { return }
                    let outcome = await self.controller.runHandoff(from: task.from, title: task.title,
                                                                    instructions: task.instructions)
                    await link.finish(task.id, ok: outcome.ok, result: outcome.result)
                }
            },
            // Results and messages for the user, while they're at the Mac.
            Task { [weak self] in
                while !Task.isCancelled {
                    guard let items = await link.inbox() else {
                        try? await Task.sleep(nanoseconds: 10_000_000_000)
                        continue
                    }
                    for item in items {
                        // Practice drills are dry runs answered to Link, never shown on screen.
                        if item.kind == "practice" {
                            self?.practice(item)
                        } else {
                            self?.controller.showDelivery(item.text)
                        }
                    }
                }
            },
        ]
    }

    func stop() async {
        loops.forEach { $0.cancel() }
        await GalaxyLink.shared.goodbye()
    }

    /// A Galaxy Trainer drill: Nova says what it would do, without doing any of it. Only the model
    /// is called (no tools, screen, shell, iMessage, memory writes or UI).
    ///
    /// Every drill gets an answer, or the trainer is told at once why not: drills that arrive
    /// together queue up (one at a time), a drill while you're using Nova is declined as busy
    /// (real work first: the trainer stops the session), and if Claude doesn't answer it's
    /// tried once more before the trainer is told, so it rehearses instead of waiting.
    private func practice(_ item: GalaxyLink.InboxItem) {
        drills.append((item, Date()))
        nextDrill()
    }

    private func nextDrill() {
        guard !practicing, !drills.isEmpty else { return }
        let (item, at) = drills.removeFirst()
        // The trainer stops waiting after two minutes; an older drill has already moved on.
        if Date().timeIntervalSince(at) > 110 { return nextDrill() }
        practicing = true
        let memories = NovaStore.shared.memories
        let working = controller.isWorking
        let key = Keychain.apiKey
        Task { [weak self] in
            let link = GalaxyLink.shared
            if working {
                await link.practiceDecline(id: item.taskId, reason: "busy: the user is using Nova right now")
            } else if let key {
                let galaxy = await link.promptContext()
                var answer = await NovaAgent.practice(item.text, apiKey: key, memories: memories, galaxy: galaxy)
                if answer == nil { answer = await NovaAgent.practice(item.text, apiKey: key, memories: memories, galaxy: galaxy) }
                if let answer {
                    await link.practiceAnswer(id: item.taskId, answer: answer)
                } else {
                    await link.practiceDecline(id: item.taskId, reason: "Nova couldn't reach Claude")
                }
            } else {
                await link.practiceDecline(id: item.taskId, reason: "Nova has no API key set")
            }
            self?.practicing = false
            self?.nextDrill()
        }
    }

    /// Memories saved while Link wasn't running go up first; then Link's copy comes down.
    private func syncMemory() async {
        let store = NovaStore.shared
        let unlinked = store.unlinkedMemories
        if !unlinked.isEmpty {
            let items = unlinked.map {
                GalaxyLink.ImportItem(text: $0.text, source: $0.source == .user ? "user" : "nova",
                                      createdAt: $0.createdAt.timeIntervalSince1970 * 1000)
            }
            guard await GalaxyLink.shared.importMemories(items) else { return }
        }
        if let shared = await GalaxyLink.shared.memories() {
            store.applyLinkMemories(shared)
        }
    }
}
