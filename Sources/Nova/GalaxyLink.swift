import Foundation

/// Nova's connection to Galaxy Link (galaxyd), the local service every
/// GalaxyAI body shares memory and work through.
///
/// Every call fails soft: when Link isn't running, calls return nil and Nova
/// carries on with its own memory, exactly as it did before Link existed.
actor GalaxyLink {
    static let shared = GalaxyLink()

    struct LinkTask: Codable, Identifiable {
        let id: String
        let from: String
        let to: String
        let power: String
        let title: String
        let instructions: String
        let status: String
        let result: String
        let replyTo: String
    }

    struct InboxItem: Codable, Identifiable {
        let id: Int
        let kind: String
        let taskId: String
        let text: String
        let replyTo: String
    }

    struct LinkMemory: Codable, Identifiable {
        let id: String
        let text: String
        let source: String
        let createdAt: Double
    }

    struct ImportItem: Codable {
        let text: String
        let source: String
        let createdAt: Double?
    }

    static let body = "nova"
    static let home = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/Galaxy", isDirectory: true)

    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 40
        config.connectionProxyDictionary = [:] // loopback only, never through a proxy
        return URLSession(configuration: config)
    }()

    // MARK: - Plumbing

    private func token() -> String? {
        let url = Self.home.appendingPathComponent("token")
        let token = (try? String(contentsOf: url, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
        return token?.isEmpty == false ? token : nil
    }

    private func baseURL() -> URL {
        let saved = (try? String(contentsOf: Self.home.appendingPathComponent("port"), encoding: .utf8))
            .flatMap { Int($0.trimmingCharacters(in: .whitespacesAndNewlines)) }
        return URL(string: "http://127.0.0.1:\(saved ?? 7740)")!
    }

    /// The response body for a 2xx with content; nil for anything else, including Link not running.
    private func call(_ method: String, _ path: String, body: Any? = nil, timeout: TimeInterval = 10) async -> Data? {
        guard let token = token(), let url = URL(string: path, relativeTo: baseURL()) else { return nil }
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(Self.body, forHTTPHeaderField: "X-Galaxy-Body")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        guard let (data, response) = try? await session.data(for: request),
              let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode), http.statusCode != 204 else { return nil }
        return data
    }

    private func decode<T: Decodable>(_ type: T.Type, _ data: Data?) -> T? {
        data.flatMap { try? JSONDecoder().decode(type, from: $0) }
    }

    // MARK: - Presence

    @discardableResult
    func hello() async -> Bool {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
        // "practice": Nova answers Galaxy Trainer drills (dry runs only; see NovaLink).
        let body: [String: Any] = ["name": "Nova", "version": version, "powers": ["practice"]]
        return await call("POST", "/v1/hello", body: body) != nil
    }

    /// False when Link has never heard of Nova (it restarted with a fresh state), so say hello again.
    func heartbeat() async -> Bool {
        if await call("POST", "/v1/heartbeat", body: [String: String]()) != nil { return true }
        return await hello()
    }

    func goodbye() async {
        _ = await call("POST", "/v1/goodbye", body: [String: String](), timeout: 2)
    }

    // MARK: - Memory

    func memories() async -> [LinkMemory]? {
        decode([LinkMemory].self, await call("GET", "/v1/memory?limit=1000"))
    }

    func remember(_ text: String, fromUser: Bool) async -> LinkMemory? {
        var body: [String: Any] = ["text": text]
        if fromUser { body["source"] = "user" }
        return decode(LinkMemory.self, await call("POST", "/v1/memory", body: body))
    }

    func update(memory id: String, text: String) async {
        _ = await call("PATCH", "/v1/memory/\(id)", body: ["text": text])
    }

    @discardableResult
    func forget(memory id: String) async -> Bool {
        await call("DELETE", "/v1/memory/\(id)") != nil
    }

    func importMemories(_ items: [ImportItem]) async -> Bool {
        let list = items.map { item -> [String: Any] in
            var entry: [String: Any] = ["text": item.text, "source": item.source]
            if let at = item.createdAt { entry["createdAt"] = at }
            return entry
        }
        return await call("POST", "/v1/memory/import", body: ["items": list]) != nil
    }

    // MARK: - Context

    /// Memory, what the other bodies have been doing, and who's running, ready for the system prompt.
    func promptContext() async -> String? {
        // Short: a new conversation waits on this, and Nova's own memory is a fine fallback.
        guard let data = await call("GET", "/v1/context", timeout: 1.5),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return object["text"] as? String
    }

    func note(_ summary: String, detail: String = "") async {
        _ = await call("POST", "/v1/events", body: ["kind": "activity", "summary": summary, "detail": detail])
    }

    // MARK: - Handoffs

    func handoff(power: String, title: String, instructions: String, replyTo: String) async -> LinkTask? {
        decode(LinkTask.self, await call("POST", "/v1/tasks", body: [
            "power": power, "title": title, "instructions": instructions, "replyTo": replyTo,
        ]))
    }

    /// The next piece of work for Nova, waiting up to 25 seconds for one.
    func nextTask() async -> LinkTask? {
        decode(LinkTask.self, await call("GET", "/v1/tasks/next?wait=25", timeout: 35))
    }

    func finish(_ id: String, ok: Bool, result: String) async {
        _ = await call("POST", "/v1/tasks/\(id)/done", body: ["ok": ok, "result": result])
    }

    /// Results and messages for the user that Link routed to the screen, waiting up to 25 seconds.
    func inbox() async -> [InboxItem]? {
        decode([InboxItem].self, await call("GET", "/v1/inbox?wait=25", timeout: 35))
    }

    // MARK: - Practice

    /// Nova's dry-run answer to a Galaxy Trainer practice drill.
    @discardableResult
    func practiceAnswer(id: String, answer: String) async -> Bool {
        await call("POST", "/v1/practice/\(id)/answer", body: ["answer": answer]) != nil
    }

    /// Tells the trainer straight away that Nova can't take this drill, and why, so it never
    /// waits on an answer that isn't coming. "busy…" means the user is using Nova.
    @discardableResult
    func practiceDecline(id: String, reason: String) async -> Bool {
        await call("POST", "/v1/practice/\(id)/decline", body: ["reason": reason]) != nil
    }

    func isRunning() async -> Bool {
        guard let url = URL(string: "/v1/health", relativeTo: baseURL()) else { return false }
        let request = URLRequest(url: url, timeoutInterval: 2)
        guard let (_, response) = try? await session.data(for: request) else { return false }
        return (response as? HTTPURLResponse)?.statusCode == 200
    }
}
