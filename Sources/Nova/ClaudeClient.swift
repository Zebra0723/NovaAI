import Foundation

/// How hard a request is, and which Claude model handles it.
enum Tier: String, CaseIterable, Codable {
    case easy, medium, hard

    var model: String {
        switch self {
        case .easy: return "claude-haiku-5-5"
        case .medium: return "claude-sonnet-5-5"
        case .hard: return "claude-opus-5-5"
        }
    }

    /// Short name shown in the bar while Nova works.
    var label: String {
        switch self {
        case .easy: return "haiku"
        case .medium: return "sonnet"
        case .hard: return "opus"
        }
    }

    var displayName: String {
        switch self {
        case .easy: return "Haiku 5.5"
        case .medium: return "Sonnet 5.5"
        case .hard: return "Opus 5.5"
        }
    }

    var effort: String {
        switch self {
        case .easy: return "low"
        case .medium: return "medium"
        case .hard: return "high"
        }
    }

    /// Sonnet and Opus can return short progress notes between tool calls; Haiku can't.
    var supportsProgressUpdates: Bool { self != .easy }
}

/// Minimal Messages API client. Messages are kept as raw JSON so that every
/// content block Claude returns (thinking blocks included) goes back unchanged.
struct ClaudeClient {
    let apiKey: String

    struct APIError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    struct StreamResult {
        var content: [[String: Any]]
        var stopReason: String?
        var usage: Usage
        /// tool_use blocks whose streamed input wasn't valid JSON.
        var invalidToolIDs: Set<String>
    }

    // MARK: - Agent turns (streamed)

    /// Streams one turn. `onText` gets each new piece of reply text; `onNote` gets the
    /// latest progress note as it grows.
    func stream(tier: Tier, system: String, tools: [[String: Any]], messages: [[String: Any]],
                onText: @escaping (String) async -> Void,
                onNote: @escaping (String) async -> Void) async throws -> StreamResult {
        var thinking: [String: Any] = ["type": "adaptive"]
        var betas: [String] = []
        if tier.supportsProgressUpdates {
            // "updates" returns short progress notes Nova shows in the bar.
            thinking["display"] = "updates"
            betas.append("thinking-display-updates-2026-08-18")
        }

        let body: [String: Any] = [
            "model": tier.model,
            "max_tokens": 32000,
            "stream": true,
            "thinking": thinking,
            "output_config": ["effort": tier.effort],
            // Cache the growing conversation so each agent step only pays for what's new.
            "cache_control": ["type": "ephemeral"],
            "system": system,
            "tools": tools,
            "messages": messages,
        ]

        let (bytes, response) = try await URLSession.shared.bytes(for: request(body, betas: betas))
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else {
            var data = Data()
            for try await byte in bytes { data.append(byte) }
            throw Self.error(status: status, data: data)
        }

        var blocks: [Int: [String: Any]] = [:]
        var partialJSON: [Int: String] = [:]
        var invalid: Set<String> = []
        var stopReason: String?
        var apiUsage: [String: Any] = [:]

        for try await line in bytes.lines {
            guard line.hasPrefix("data:") else { continue }
            let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
            guard let event = (try? JSONSerialization.jsonObject(with: Data(payload.utf8))) as? [String: Any] else {
                continue
            }

            switch event["type"] as? String {
            case "message_start":
                if let message = event["message"] as? [String: Any],
                   let usage = message["usage"] as? [String: Any] {
                    apiUsage.merge(usage) { _, new in new }
                }

            case "content_block_start":
                guard let index = event["index"] as? Int,
                      let block = event["content_block"] as? [String: Any] else { continue }
                blocks[index] = block
                if block["type"] as? String == "tool_use" { partialJSON[index] = "" }

            case "content_block_delta":
                guard let index = event["index"] as? Int,
                      let delta = event["delta"] as? [String: Any] else { continue }
                switch delta["type"] as? String {
                case "text_delta":
                    let text = delta["text"] as? String ?? ""
                    let full = (blocks[index]?["text"] as? String ?? "") + text
                    blocks[index]?["text"] = full
                    await onText(text)
                case "thinking_delta":
                    let piece = delta["thinking"] as? String ?? ""
                    let note = (blocks[index]?["thinking"] as? String ?? "") + piece
                    blocks[index]?["thinking"] = note
                    if !note.isEmpty { await onNote(note) }
                case "signature_delta":
                    let piece = delta["signature"] as? String ?? ""
                    let signature = (blocks[index]?["signature"] as? String ?? "") + piece
                    blocks[index]?["signature"] = signature
                case "input_json_delta":
                    partialJSON[index, default: ""] += delta["partial_json"] as? String ?? ""
                default:
                    break
                }

            case "content_block_stop":
                guard let index = event["index"] as? Int, let json = partialJSON[index] else { continue }
                if json.isEmpty {
                    blocks[index]?["input"] = [String: Any]()
                } else if let input = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] {
                    blocks[index]?["input"] = input
                } else {
                    blocks[index]?["input"] = [String: Any]()
                    if let id = blocks[index]?["id"] as? String { invalid.insert(id) }
                }

            case "message_delta":
                if let delta = event["delta"] as? [String: Any], let reason = delta["stop_reason"] as? String {
                    stopReason = reason
                }
                if let usage = event["usage"] as? [String: Any] {
                    apiUsage.merge(usage) { _, new in new }
                }

            case "error":
                let message = (event["error"] as? [String: Any])?["message"] as? String ?? "Stream error"
                throw APIError(message: message)

            default:
                break
            }
        }

        let content = blocks.keys.sorted().compactMap { blocks[$0] }
        return StreamResult(content: content, stopReason: stopReason,
                            usage: Usage(apiUsage: apiUsage, model: tier.model), invalidToolIDs: invalid)
    }

    // MARK: - Routing

    /// Asks Haiku how hard a request is. Falls back to `.medium` if anything goes wrong.
    func classify(_ request: String, context: String) async -> (Tier, Usage) {
        let schema: [String: Any] = [
            "type": "object",
            "properties": ["tier": ["type": "string", "enum": Tier.allCases.map(\.rawValue)]],
            "required": ["tier"],
            "additionalProperties": false,
        ]
        let body: [String: Any] = [
            "model": Tier.easy.model,
            "max_tokens": 64,
            "thinking": ["type": "disabled"],
            "output_config": ["effort": "low", "format": ["type": "json_schema", "schema": schema]],
            "system": Self.routerPrompt,
            "messages": [["role": "user", "content": "\(context)\n\nRequest: \(request)"]],
        ]
        guard let response = try? await send(body),
              let json = Self.structuredOutput(response),
              let raw = json["tier"] as? String,
              let tier = Tier(rawValue: raw)
        else { return (.medium, Usage()) }
        return (tier, Self.usage(of: response, model: Tier.easy.model))
    }

    private static let routerPrompt = """
    You route requests for Nova, an assistant on the user's Mac that can see their screen and control it. \
    Decide how capable a model the request needs.

    easy: quick facts, short explanations, reading or summarizing something short on screen, a single obvious \
    action (open an app, change one setting, copy something).
    medium: most everyday work: multi-step tasks inside one app, writing or replying to messages, explaining \
    code or errors, organizing files.
    hard: long workflows across several apps, writing or debugging substantial code, deep analysis or \
    research, or anything ambiguous where mistakes would be costly.

    If you're unsure, choose medium.
    """

    // MARK: - Proactive screen check

    struct ScreenNotice {
        let title: String
        let suggestion: String
    }

    /// Asks Haiku whether the screen shows a problem worth offering help with.
    func checkScreen(jpeg: Data, app: String) async -> (ScreenNotice?, Usage) {
        let schema: [String: Any] = [
            "type": "object",
            "properties": [
                "notice": ["type": "boolean"],
                "title": ["type": "string"],
                "suggestion": ["type": "string"],
            ],
            "required": ["notice", "title", "suggestion"],
            "additionalProperties": false,
        ]
        let body: [String: Any] = [
            "model": Tier.easy.model,
            "max_tokens": 300,
            "thinking": ["type": "disabled"],
            "output_config": ["effort": "low", "format": ["type": "json_schema", "schema": schema]],
            "system": Self.watcherPrompt,
            "messages": [[
                "role": "user",
                "content": [
                    ["type": "image",
                     "source": ["type": "base64", "media_type": "image/jpeg", "data": jpeg.base64EncodedString()]],
                    ["type": "text", "text": "Frontmost app: \(app)"],
                ],
            ]],
        ]
        guard let response = try? await send(body) else { return (nil, Usage()) }
        let usage = Self.usage(of: response, model: Tier.easy.model)
        guard let json = Self.structuredOutput(response),
              json["notice"] as? Bool == true,
              let title = json["title"] as? String, !title.isEmpty,
              let suggestion = json["suggestion"] as? String, !suggestion.isEmpty
        else { return (nil, usage) }
        return (ScreenNotice(title: title, suggestion: suggestion), usage)
    }

    private static let watcherPrompt = """
    You glance at the user's Mac screen for Nova, an assistant that can fix things for them. Set notice to \
    true only when the screen clearly shows a problem the user would likely want help with right now: an \
    error message, a failed build or test, a crash or alert dialog, a broken page, or a stuck install. \
    Ordinary content, ads, notifications, and things that are merely unfinished are not problems.

    When notice is true: title is at most 8 words naming the problem ("TypeScript error in api.ts"), and \
    suggestion is one instruction Nova could carry out ("Fix the type error shown in the terminal"). When \
    notice is false, leave title and suggestion empty.
    """

    // MARK: - Practice drills

    /// One plain answer with no tools offered, so nothing can be acted on. Used for Galaxy
    /// Trainer drills. Nil if anything goes wrong or it takes longer than a minute.
    func dryRun(system: String, prompt: String) async -> String? {
        let body: [String: Any] = [
            "model": Tier.medium.model,
            "max_tokens": 1024,
            "thinking": ["type": "disabled"],
            "output_config": ["effort": "low"],
            "system": system,
            "messages": [["role": "user", "content": prompt]],
        ]
        guard var urlRequest = try? request(body, betas: []) else { return nil }
        urlRequest.timeoutInterval = 50 // twice, inside the trainer's two minutes
        guard let (data, response) = try? await URLSession.shared.data(for: urlRequest),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let content = json["content"] as? [[String: Any]]
        else { return nil }
        let text = content
            .filter { $0["type"] as? String == "text" }
            .compactMap { $0["text"] as? String }
            .joined(separator: "\n\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
    }

    // MARK: - HTTP

    private func send(_ body: [String: Any]) async throws -> [String: Any] {
        let (data, response) = try await URLSession.shared.data(for: request(body, betas: []))
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else { throw Self.error(status: status, data: data) }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }

    private func request(_ body: [String: Any], betas: [String]) throws -> URLRequest {
        var request = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 600
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        if !betas.isEmpty {
            request.setValue(betas.joined(separator: ","), forHTTPHeaderField: "anthropic-beta")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return request
    }

    private static func structuredOutput(_ response: [String: Any]) -> [String: Any]? {
        guard let content = response["content"] as? [[String: Any]],
              let text = content.first(where: { $0["type"] as? String == "text" })?["text"] as? String
        else { return nil }
        return (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any]
    }

    private static func usage(of response: [String: Any], model: String) -> Usage {
        Usage(apiUsage: response["usage"] as? [String: Any] ?? [:], model: model)
    }

    private static func error(status: Int, data: Data) -> APIError {
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let message = (json?["error"] as? [String: Any])?["message"] as? String
            ?? String(decoding: data, as: UTF8.self)
        switch status {
        case 401: return APIError(message: "That API key didn't work. Change it in Nova's settings.")
        case 429: return APIError(message: "Rate limited. Give it a moment and try again.")
        case 500...599: return APIError(message: "Claude is overloaded right now. Try again shortly.")
        default: return APIError(message: "API error \(status): \(message)")
        }
    }
}
