import AppKit

/// One Nova conversation: sends the user's request plus a screenshot to Claude,
/// then runs the computer and bash tool calls it makes until it's done.
final class NovaAgent {
    enum Event {
        case status(String)      // short progress note for the bar
        case acting(Bool)        // true while Nova is driving the mouse/keyboard
        case tier(Tier)          // which model is handling this request
    }

    static let maxSteps = 80

    private let client: ClaudeClient
    private var messages: [[String: Any]] = []
    private var lastRequest: String?

    init(apiKey: String) {
        client = ClaudeClient(apiKey: apiKey)
    }

    /// Runs one user request to completion and returns Nova's reply.
    func run(_ request: String, onEvent: @escaping @MainActor (Event) -> Void) async throws -> String {
        await onEvent(.status("Thinking…"))
        let app = await MainActor.run { NSWorkspace.shared.frontmostApplication?.localizedName } ?? "unknown"

        // Each request picks its own model: Haiku for easy, Sonnet for medium, Opus for hard.
        var context = "Frontmost app: \(app)"
        if let lastRequest { context += "\nPrevious request in this conversation: \(lastRequest)" }
        let tier = await client.classify(request, context: context)
        lastRequest = request
        await onEvent(.tier(tier))

        messages.append(["role": "user", "content": await userContent(for: request, app: app)])

        for _ in 0..<Self.maxSteps {
            try Task.checkCancellation()

            let response = try await client.send(tier: tier, system: Self.systemPrompt, messages: messages)
            let content = response["content"] as? [[String: Any]] ?? []
            // Append the full content unchanged; thinking blocks must round-trip as-is.
            messages.append(["role": "assistant", "content": content])

            var replyText: [String] = []
            for block in content {
                switch block["type"] as? String {
                case "thinking":
                    if let note = block["thinking"] as? String, !note.isEmpty {
                        await onEvent(.status(note))
                    }
                case "text":
                    if let text = block["text"] as? String { replyText.append(text) }
                default:
                    break
                }
            }

            switch response["stop_reason"] as? String {
            case "tool_use":
                let results = try await runTools(in: content, onEvent: onEvent)
                messages.append(["role": "user", "content": results])
                await onEvent(.status("Thinking…"))
            case "refusal":
                await onEvent(.acting(false))
                let reply = replyText.joined(separator: "\n\n")
                return reply.isEmpty ? "Nova can't help with that one." : reply
            case "max_tokens":
                await onEvent(.acting(false))
                return replyText.joined(separator: "\n\n") + "\n\n_(cut off: hit the length limit)_"
            default:
                await onEvent(.acting(false))
                let reply = replyText.joined(separator: "\n\n")
                return reply.isEmpty ? "Done." : reply
            }
        }
        await onEvent(.acting(false))
        return "I hit my step limit before finishing. Tell me to keep going if you want me to continue."
    }

    // MARK: - Tools

    private func runTools(in content: [[String: Any]],
                          onEvent: @escaping @MainActor (Event) -> Void) async throws -> [[String: Any]] {
        var results: [[String: Any]] = []
        var computerFailed = false

        for block in content where block["type"] as? String == "tool_use" {
            guard let id = block["id"] as? String, let name = block["name"] as? String else { continue }
            let input = block["input"] as? [String: Any] ?? [:]

            if let toolset = block["toolset_name"] as? String {
                // Computer toolset member. Batched actions run in order; stop at the first failure.
                var result: [String: Any] = ["type": "tool_result", "tool_use_id": id, "toolset_name": toolset]
                if computerFailed {
                    result["is_error"] = true
                    result["content"] = "Not executed: an earlier computer action in this turn failed."
                    results.append(result)
                    continue
                }
                try Task.checkCancellation()
                if !["screenshot", "zoom", "cursor_position", "wait"].contains(name) {
                    await onEvent(.acting(true))
                }
                do {
                    switch try await ComputerController.run(name, input: input) {
                    case .text(let text):
                        result["content"] = [["type": "text", "text": text]]
                    case .image(let shot):
                        result["content"] = [Self.imageBlock(shot)]
                    }
                } catch {
                    if error is CancellationError { throw error }
                    computerFailed = true
                    result["is_error"] = true
                    result["content"] = "Error: \(error.localizedDescription)"
                }
                results.append(result)
            } else if name == "bash" {
                try Task.checkCancellation()
                if input["restart"] as? Bool == true {
                    results.append(["type": "tool_result", "tool_use_id": id, "content": "Shell restarted."])
                    continue
                }
                let command = input["command"] as? String ?? ""
                await onEvent(.status("Running `\(command.prefix(60))`"))
                let (output, isError) = await BashTool.run(command)
                var result: [String: Any] = ["type": "tool_result", "tool_use_id": id, "content": output]
                if isError { result["is_error"] = true }
                results.append(result)
            } else {
                results.append(["type": "tool_result", "tool_use_id": id, "is_error": true,
                                "content": "Unknown tool: \(name)"])
            }
        }
        return results
    }

    // MARK: - Request context

    private func userContent(for request: String, app: String) async -> [[String: Any]] {
        var content: [[String: Any]] = []
        if Permissions.hasScreenRecording, let shot = try? await ScreenCapture.fullScreen() {
            content.append(Self.imageBlock(shot))
        }
        content.append(["type": "text", "text": "[Frontmost app: \(app)]\n\n\(request)"])
        return content
    }

    private static func imageBlock(_ shot: ScreenCapture.Shot) -> [String: Any] {
        [
            "type": "image",
            "source": ["type": "base64", "media_type": "image/jpeg", "data": shot.jpeg.base64EncodedString()],
        ]
    }

    private static var systemPrompt: String {
        let size = ScreenCapture.screenshotSize
        return """
        You are Nova, part of the user's personal AI Galaxy alongside Comet (their iMessage agent) and \
        Orbit (their voice agent that gives a daily brief). You live on the user's Mac and appear as a small \
        bar when they press Control-Space. The user's message comes with a screenshot of their screen at that \
        moment (\(Int(size.width))x\(Int(size.height)) px, the main display), so "this", "here" or "it" usually \
        means something on screen.

        How you work:
        - If the user asks a question, about their screen or anything else, just answer. Only use the computer \
        when the request needs an action.
        - When it does, do the task yourself with the computer tools and the bash tool. The user has given you \
        full autonomy, so don't ask for confirmation. Do the task, then say briefly what you did.
        - Prefer bash for files, opening apps (`open -a`), and anything the shell does reliably. Use the mouse \
        and keyboard for work inside app interfaces.
        - On macOS, Command is `super` in key combos (super+c copies, super+space opens Spotlight).
        - Each bash command runs in a fresh zsh in the home directory, and `cd` doesn't carry over, so chain \
        steps with `&&`.
        - After acting, take a screenshot to confirm it worked before you say you're done.
        - The user can stop you at any time with Esc.

        Your reply shows in a small bar, so keep it short: lead with the answer, a few sentences at most, \
        light markdown only (bold, `code`, short lists), no headings.
        """
    }
}
