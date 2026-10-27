import Foundation

/// Minimal Messages API client. Messages are kept as raw JSON so that every
/// content block Claude returns (thinking blocks included) goes back unchanged.
struct ClaudeClient {
    static let model = "claude-opus-5-5"

    let apiKey: String

    struct APIError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    func send(system: String, messages: [[String: Any]]) async throws -> [String: Any] {
        let body: [String: Any] = [
            "model": Self.model,
            "max_tokens": 16000,
            // Adaptive thinking; "updates" returns short progress notes Nova shows in the bar.
            "thinking": ["type": "adaptive", "display": "updates"],
            "output_config": ["effort": "medium"],
            // If a safety classifier declines, let the API retry on a suitable fallback model.
            "fallbacks": "default",
            // Cache the growing conversation so each agent step only pays for what's new.
            "cache_control": ["type": "ephemeral"],
            "system": system,
            "tools": [
                ["type": "computer_toolset_20260801"],
                ["type": "bash_20250124", "name": "bash"],
            ],
            "messages": messages,
        ]

        var request = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 600
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        request.setValue("thinking-display-updates-2026-08-18,server-side-fallback-2026-07-01",
                         forHTTPHeaderField: "anthropic-beta")
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
