import Foundation

/// How hard a request is, and which Claude model handles it.
enum Tier: String, CaseIterable {
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

    func send(tier: Tier, system: String, messages: [[String: Any]]) async throws -> [String: Any] {
        var thinking: [String: Any] = ["type": "adaptive"]
        var betas: [String] = []
        if tier.supportsProgressUpdates {
            // "updates" returns short progress notes Nova shows in the bar.
            thinking["display"] = "updates"
            betas.append("thinking-display-updates-2026-08-18")
        }

        let body: [String: Any] = [
            "model": tier.model,
            "max_tokens": 16000,
            "thinking": thinking,
            "output_config": ["effort": tier.effort],
            // Cache the growing conversation so each agent step only pays for what's new.
            "cache_control": ["type": "ephemeral"],
            "system": system,
            "tools": [
                ["type": "computer_toolset_20260801"],
                ["type": "bash_20250124", "name": "bash"],
            ],
            "messages": messages,
        ]
        return try await post(body, betas: betas)
    }

    /// Asks Haiku how hard a request is. Falls back to `.medium` if anything goes wrong.
    func classify(_ request: String, context: String) async -> Tier {
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
        guard let response = try? await post(body, betas: []),
              let content = response["content"] as? [[String: Any]],
              let text = content.first(where: { $0["type"] as? String == "text" })?["text"] as? String,
              let json = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
              let raw = json["tier"] as? String,
              let tier = Tier(rawValue: raw)
        else { return .medium }
        return tier
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

    private func post(_ body: [String: Any], betas: [String]) async throws -> [String: Any] {
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

        let (data, response) = try await URLSession.shared.data(for: request)
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0

        guard status == 200 else {
            let message = (json["error"] as? [String: Any])?["message"] as? String
                ?? String(decoding: data, as: UTF8.self)
            switch status {
            case 401: throw APIError(message: "That API key didn't work. Use “Change API Key…” in the menu bar.")
            case 429: throw APIError(message: "Rate limited. Give it a moment and try again.")
            case 500...599: throw APIError(message: "Claude is overloaded right now. Try again shortly.")
            default: throw APIError(message: "API error \(status): \(message)")
            }
        }
        return json
    }
}
