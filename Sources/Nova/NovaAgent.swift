import AppKit

/// One Nova conversation: sends the user's request plus a screenshot to Claude,
/// then runs the tool calls it makes until it's done.
final class NovaAgent {
    enum Event {
        case status(String)         // short progress note for the bar
        case acting(Bool)           // true while Nova is driving the mouse/keyboard
        case tier(Tier)             // which model is handling this request
        case text(String)           // the reply so far, as it streams in
        case action(ActionRecord)   // something Nova did
        case usage(Usage)           // tokens and cost of one API call
    }

    static let maxSteps = 80

    private let client: ClaudeClient
    private let systemPrompt: String
    private let tools: [[String: Any]]
    /// True when Galaxy Link was running as the conversation began, so Nova can hand work to the others.
    private let linked: Bool
    private var messages: [[String: Any]] = []
    private var lastRequest: String?

    /// `memories` (or, with Galaxy Link running, the Galaxy's shared context) are fixed for the
    /// whole conversation so the system prompt never changes mid-way.
    init(apiKey: String, memories: [Memory], galaxy: String? = nil) {
        client = ClaudeClient(apiKey: apiKey)
        linked = galaxy != nil
        systemPrompt = Self.systemPrompt(memories: memories, galaxy: galaxy)
        tools = Self.baseTools + [Self.messageTool] + (galaxy != nil ? [Self.handoffTool] : [])
    }

    /// Runs one user request to completion and returns Nova's reply.
    func run(_ request: String, context: [ContextItem],
             onEvent: @escaping @MainActor (Event) -> Void) async throws -> String {
        await onEvent(.status("Thinking…"))
        let app = await MainActor.run { NSWorkspace.shared.frontmostApplication?.localizedName } ?? "unknown"

        // Each request picks its own model: Haiku for easy, Sonnet for medium, Opus for hard.
        var routing = "Frontmost app: \(app)"
        if let lastRequest { routing += "\nPrevious request in this conversation: \(lastRequest)" }
        if !context.isEmpty { routing += "\nAttached: " + context.map(\.label).joined(separator: ", ") }
        let (tier, routerUsage) = await client.classify(request, context: routing)
        lastRequest = request
        await onEvent(.usage(routerUsage))
        await onEvent(.tier(tier))

        messages.append(["role": "user", "content": await userContent(for: request, app: app, context: context)])

        for _ in 0..<Self.maxSteps {
            try Task.checkCancellation()

            var turnText = ""
            let result = try await client.stream(
                tier: tier, system: systemPrompt, tools: tools, messages: messages,
                onText: { piece in
                    turnText += piece
                    let snapshot = turnText
                    await onEvent(.text(snapshot))
                },
                onNote: { note in
                    await onEvent(.status(note))
                }
            )
            await onEvent(.usage(result.usage))
            // Append the full content unchanged; thinking blocks must round-trip as-is.
            messages.append(["role": "assistant", "content": result.content])

            let reply = result.content
                .filter { $0["type"] as? String == "text" }
                .compactMap { $0["text"] as? String }
                .joined(separator: "\n\n")

            switch result.stopReason {
            case "tool_use":
                // Text before a tool call is narration, not the answer.
                await onEvent(.text(""))
                if !reply.isEmpty { await onEvent(.status(reply)) }
                let results = try await runTools(in: result.content, invalid: result.invalidToolIDs, onEvent: onEvent)
                messages.append(["role": "user", "content": results])
                await onEvent(.status("Thinking…"))
            case "refusal":
                await onEvent(.acting(false))
                return reply.isEmpty ? "Nova can't help with that one." : reply
            case "max_tokens":
                await onEvent(.acting(false))
                return reply + "\n\n_(cut off: hit the length limit)_"
            default:
                await onEvent(.acting(false))
                return reply.isEmpty ? "Done." : reply
            }
        }
        await onEvent(.acting(false))
        return "I hit my step limit before finishing. Tell me to keep going if you want me to continue."
    }

    // MARK: - Tools

    private static let baseTools: [[String: Any]] = [
        ["type": "computer_toolset_20260801"],
        ["type": "bash_20250124", "name": "bash"],
        [
            "name": "remember",
            "description": """
            Save a lasting fact about the user for future conversations: preferences, people and how to \
            reach them, projects, recurring details, or anything they ask you to remember. Don't save \
            one-off details or secrets such as passwords. Write the fact as a short, standalone sentence.
            """,
            "input_schema": [
                "type": "object",
                "properties": ["fact": ["type": "string", "description": "The fact, as one short sentence."]],
                "required": ["fact"],
                "additionalProperties": false,
            ],
            "eager_input_streaming": true,
        ],
        [
            "name": "forget",
            "description": "Delete a saved memory that's wrong or that the user asks you to forget.",
            "input_schema": [
                "type": "object",
                "properties": ["memory_id": ["type": "string", "description": "The id shown in brackets."]],
                "required": ["memory_id"],
                "additionalProperties": false,
            ],
            "eager_input_streaming": true,
        ],
    ]

    private static let messageTool: [String: Any] = [
        "name": "send_imessage",
        "description": """
        Send an iMessage from the user's own Messages account. `to` is a phone number, an email, or a \
        person's name as it appears in their Contacts. Use this whenever the user asks you to text or \
        message someone; don't drive the Messages window with the mouse for it.
        """,
        "input_schema": [
            "type": "object",
            "properties": [
                "to": ["type": "string", "description": "Phone number, email, or contact name."],
                "text": ["type": "string", "description": "The message, exactly as it should be sent."],
            ],
            "required": ["to", "text"],
            "additionalProperties": false,
        ],
    ]

    private static let handoffTool: [String: Any] = [
        "name": "galaxy_handoff",
        "description": """
        Hand a piece of work to another member of the user's Galaxy, for a power you don't have. \
        build_web, cad, code and research go to Comet (it builds and deploys websites, CAD models and \
        code with Claude Code); missions (big jobs that take hours) go to Zenith. Don't hand off \
        anything you can do yourself on this Mac. You don't wait for the result: it reaches the user \
        on their screen or phone when it's done.
        """,
        "input_schema": [
            "type": "object",
            "properties": [
                "power": ["type": "string", "enum": ["build_web", "cad", "code", "research", "missions"]],
                "title": ["type": "string", "description": "A short title for the work, like a task name."],
                "instructions": ["type": "string", "description": "Everything the other member needs to do it well."],
            ],
            "required": ["power", "title", "instructions"],
            "additionalProperties": false,
        ],
    ]

    private func runTools(in content: [[String: Any]], invalid: Set<String>,
                          onEvent: @escaping @MainActor (Event) -> Void) async throws -> [[String: Any]] {
        var results: [[String: Any]] = []
        var computerFailed = false

        for block in content where block["type"] as? String == "tool_use" {
            guard let id = block["id"] as? String, let name = block["name"] as? String else { continue }
            let input = block["input"] as? [String: Any] ?? [:]

            if let toolset = block["toolset_name"] as? String {
                // Computer toolset member. Batched actions run in order; stop at the first failure.
                var result: [String: Any] = ["type": "tool_result", "tool_use_id": id, "toolset_name": toolset]
                if computerFailed || invalid.contains(id) {
                    result["is_error"] = true
                    result["content"] = invalid.contains(id)
                        ? "Error: the action's input wasn't valid JSON. Try again."
                        : "Not executed: an earlier computer action in this turn failed."
                    computerFailed = true
                    results.append(result)
                    continue
                }
                try Task.checkCancellation()
                let visible = !["screenshot", "zoom", "cursor_position", "wait"].contains(name)
                if visible { await onEvent(.acting(true)) }
                do {
                    switch try await ComputerController.run(name, input: input) {
                    case .text(let text):
                        result["content"] = [["type": "text", "text": text]]
                    case .image(let shot):
                        result["content"] = [Self.imageBlock(shot)]
                    }
                    if visible {
                        await onEvent(.action(ActionRecord(kind: .computer, summary: Self.describe(name, input))))
                    }
                } catch {
                    if error is CancellationError { throw error }
                    computerFailed = true
                    result["is_error"] = true
                    result["content"] = "Error: \(error.localizedDescription)"
                    await onEvent(.action(ActionRecord(kind: .computer, summary: Self.describe(name, input),
                                                       isError: true)))
                }
                results.append(result)

            } else if name == "bash" {
                try Task.checkCancellation()
                if input["restart"] as? Bool == true {
                    results.append(["type": "tool_result", "tool_use_id": id, "content": "Shell restarted."])
                    continue
                }
                let command = input["command"] as? String ?? ""
                await onEvent(.status("Running \(command.prefix(60))"))
                let (output, isError) = await BashTool.run(command)
                var result: [String: Any] = ["type": "tool_result", "tool_use_id": id, "content": output]
                if isError { result["is_error"] = true }
                results.append(result)
                await onEvent(.action(ActionRecord(kind: .shell, summary: command, isError: isError)))

            } else if name == "send_imessage" {
                if invalid.contains(id) {
                    results.append(["type": "tool_result", "tool_use_id": id, "is_error": true,
                                    "content": "Error: the input wasn't valid JSON. Try again."])
                    continue
                }
                let to = input["to"] as? String ?? ""
                await onEvent(.status("Texting \(to)"))
                let outcome = await MessagesTool.send(to: to, text: input["text"] as? String ?? "")
                var result: [String: Any] = ["type": "tool_result", "tool_use_id": id, "content": outcome.text]
                if outcome.isError { result["is_error"] = true }
                results.append(result)
                await onEvent(.action(ActionRecord(kind: .shell, summary: "Texted \(to)", isError: outcome.isError)))
                if !outcome.isError { Task { await GalaxyLink.shared.note("texted \(to)") } }

            } else if name == "galaxy_handoff" {
                let power = input["power"] as? String ?? ""
                let title = input["title"] as? String ?? ""
                let instructions = input["instructions"] as? String ?? ""
                if invalid.contains(id) || !linked || title.isEmpty || instructions.isEmpty {
                    results.append(["type": "tool_result", "tool_use_id": id, "is_error": true,
                                    "content": linked ? "Error: power, title and instructions are all needed."
                                                      : "Galaxy Link isn't running, so there's no one to hand this to."])
                    continue
                }
                let task = await GalaxyLink.shared.handoff(power: power, title: title, instructions: instructions,
                                                            replyTo: "")
                if let task {
                    let who = task.to.prefix(1).uppercased() + task.to.dropFirst()
                    results.append(["type": "tool_result", "tool_use_id": id,
                                    "content": "Handed to \(who). The result will reach the user on their screen or phone when it's done."])
                    await onEvent(.action(ActionRecord(kind: .shell, summary: "Handed to \(who): \(title)")))
                } else {
                    results.append(["type": "tool_result", "tool_use_id": id, "is_error": true,
                                    "content": "Galaxy Link didn't take the handoff. Tell the user it couldn't be passed on."])
                }

            } else if name == "remember" || name == "forget" {
                results.append(await runMemoryTool(name, id: id, input: input, invalid: invalid.contains(id),
                                                   onEvent: onEvent))

            } else {
                results.append(["type": "tool_result", "tool_use_id": id, "is_error": true,
                                "content": "Unknown tool: \(name)"])
            }
        }
        return results
    }

    private func runMemoryTool(_ name: String, id: String, input: [String: Any], invalid: Bool,
                               onEvent: @escaping @MainActor (Event) -> Void) async -> [String: Any] {
        func error(_ message: String) -> [String: Any] {
            ["type": "tool_result", "tool_use_id": id, "is_error": true, "content": message]
        }
        if invalid { return error("Error: the input wasn't valid JSON. Try again.") }

        if name == "remember" {
            guard let fact = input["fact"] as? String,
                  !fact.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return error("Error: `fact` must be a non-empty string.")
            }
            let memory = await MainActor.run { NovaStore.shared.addMemory(fact, source: .nova) }
            await onEvent(.action(ActionRecord(kind: .memory, summary: "Remembered: \(memory.text)")))
            return ["type": "tool_result", "tool_use_id": id, "content": "Saved as [\(memory.shortID)]."]
        } else {
            guard let memoryID = input["memory_id"] as? String, !memoryID.isEmpty else {
                return error("Error: `memory_id` must be a non-empty string.")
            }
            var deleted = await MainActor.run { NovaStore.shared.deleteMemory(shortID: memoryID) }
            // A shared memory Nova hasn't copied locally yet still goes, from the whole Galaxy.
            if !deleted, memoryID.hasPrefix("m_") { deleted = await GalaxyLink.shared.forget(memory: memoryID) }
            guard deleted else { return error("No memory with id \(memoryID).") }
            await onEvent(.action(ActionRecord(kind: .memory, summary: "Forgot memory \(memoryID)")))
            return ["type": "tool_result", "tool_use_id": id, "content": "Forgotten."]
        }
    }

    /// A short, human-readable line for the history view.
    private static func describe(_ name: String, _ input: [String: Any]) -> String {
        func coordinate(_ key: String) -> String {
            guard let xy = input[key] as? [Any], xy.count == 2 else { return "" }
            let values = xy.compactMap { ($0 as? NSNumber)?.intValue }
            return values.count == 2 ? " at (\(values[0]), \(values[1]))" : ""
        }
        switch name {
        case "left_click": return "Clicked" + coordinate("coordinate")
        case "right_click": return "Right-clicked" + coordinate("coordinate")
        case "middle_click": return "Middle-clicked" + coordinate("coordinate")
        case "double_click": return "Double-clicked" + coordinate("coordinate")
        case "triple_click": return "Triple-clicked" + coordinate("coordinate")
        case "left_click_drag": return "Dragged" + coordinate("start_coordinate") + " to" + coordinate("coordinate")
        case "mouse_move": return "Moved the pointer" + coordinate("coordinate")
        case "left_mouse_down": return "Pressed the mouse button"
        case "left_mouse_up": return "Released the mouse button"
        case "scroll": return "Scrolled \(input["scroll_direction"] as? String ?? "")" + coordinate("coordinate")
        case "type":
            let text = input["text"] as? String ?? ""
            return "Typed \u{201C}\(text.count > 60 ? String(text.prefix(60)) + "…" : text)\u{201D}"
        case "key": return "Pressed \(input["text"] as? String ?? "")"
        case "hold_key": return "Held \(input["text"] as? String ?? "")"
        default: return name.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    // MARK: - Request context

    private func userContent(for request: String, app: String, context: [ContextItem]) async -> [[String: Any]] {
        var content: [[String: Any]] = []
        if Permissions.hasScreenRecording, let shot = try? await ScreenCapture.fullScreen() {
            content.append(Self.imageBlock(shot))
        }
        var text = "[Frontmost app: \(app)]"
        for item in context { text += "\n\n[\(item.detail)]" }
        content.append(["type": "text", "text": text + "\n\n" + request])
        return content
    }

    private static func imageBlock(_ shot: ScreenCapture.Shot) -> [String: Any] {
        [
            "type": "image",
            "source": ["type": "base64", "media_type": "image/jpeg", "data": shot.jpeg.base64EncodedString()],
        ]
    }

    private static func systemPrompt(memories: [Memory], galaxy: String?) -> String {
        let size = ScreenCapture.screenshotSize
        let remembered: String
        if let galaxy {
            // Link's block: shared memory (ids in brackets), what the others did today, who's running.
            remembered = galaxy
        } else {
            remembered = memories.isEmpty
                ? "You don't have any memories about the user yet."
                : "What you remember about the user (ids in brackets):\n"
                    + memories.map { "- [\($0.shortID)] \($0.text)" }.joined(separator: "\n")
        }
        let galaxyNote = galaxy == nil ? "" : """

        The Galaxy: memories are shared by every member, so what you remember, they know. When the user \
        asks for something only another member can do (build or deploy a website, CAD, a big coding job, \
        a mission that takes hours), use `galaxy_handoff` and tell them who's doing it. Otherwise do it yourself.
        """
        return """
        You are Nova, part of the user's personal AI Galaxy alongside Comet (their iMessage agent that \
        builds websites, CAD and code), Orbit (their voice agent, which only speaks when spoken to), \
        Nebula (gesture control) and Zenith (long missions). You live on the user's Mac and appear as a small \
        bar when they press Control-Space. The user's message comes with a screenshot of their screen at that \
        moment (\(Int(size.width))x\(Int(size.height)) px, the main display), so "this", "here" or "it" usually \
        means something on screen. It may also include text they had selected, the browser page they had open, \
        or files selected in Finder.

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
        - To text someone, use `send_imessage`. You can send iMessages from the user's own account.

        Memory: use `remember` when you learn something worth knowing next time, and `forget` when a memory \
        is wrong or the user asks. Use what you remember without announcing it.
        \(remembered)\(galaxyNote)

        Your reply shows in a small bar, so keep it short: lead with the answer, a few sentences at most, \
        light markdown only (bold, `code`, short lists), no headings.
        """
    }
}
