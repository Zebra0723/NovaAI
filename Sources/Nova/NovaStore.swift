import Foundation

// MARK: - Records

/// Token counts for one or more API calls, with an estimated cost.
struct Usage: Codable, Equatable {
    var inputTokens = 0
    var outputTokens = 0
    var cacheReadTokens = 0
    var cacheWriteTokens = 0
    var costUSD: Double = 0

    var totalTokens: Int { inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens }

    static func += (lhs: inout Usage, rhs: Usage) {
        lhs.inputTokens += rhs.inputTokens
        lhs.outputTokens += rhs.outputTokens
        lhs.cacheReadTokens += rhs.cacheReadTokens
        lhs.cacheWriteTokens += rhs.cacheWriteTokens
        lhs.costUSD += rhs.costUSD
    }

    /// Builds usage from an API `usage` object and prices it for `model`.
    init(apiUsage: [String: Any], model: String) {
        func int(_ key: String) -> Int { (apiUsage[key] as? NSNumber)?.intValue ?? 0 }
        inputTokens = int("input_tokens")
        outputTokens = int("output_tokens")
        cacheReadTokens = int("cache_read_input_tokens")
        cacheWriteTokens = int("cache_creation_input_tokens")
        costUSD = Pricing.cost(of: self, model: model)
    }

    init() {}
}

/// Published per-million-token prices. Cache writes are billed at 1.25x input.
enum Pricing {
    static func cost(of usage: Usage, model: String) -> Double {
        let prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
        let rates: (input: Double, output: Double, cacheRead: Double)
        switch model {
        case "claude-haiku-5-5":
            // Haiku 5.5 is cheaper for prompts up to 100K tokens.
            rates = prompt <= 100_000 ? (0.10, 0.50, 0.01) : (0.50, 2.50, 0.05)
        case "claude-sonnet-5-5":
            rates = (2.00, 10.00, 0.20)
        case "claude-opus-5-5":
            rates = (4.00, 20.00, 0.20)
        default:
            rates = (0, 0, 0)
        }
        let perToken = 1.0 / 1_000_000
        return (Double(usage.inputTokens) * rates.input
                + Double(usage.cacheWriteTokens) * rates.input * 1.25
                + Double(usage.cacheReadTokens) * rates.cacheRead
                + Double(usage.outputTokens) * rates.output) * perToken
    }
}

/// Something Nova did on the Mac during an exchange.
struct ActionRecord: Codable, Identifiable, Equatable {
    enum Kind: String, Codable { case computer, shell, memory }

    var id = UUID()
    var date = Date()
    var kind: Kind
    var summary: String
    var isError = false
}

/// One request from the user and Nova's reply.
struct Exchange: Codable, Identifiable, Equatable {
    enum Outcome: String, Codable { case completed, stopped, failed }

    var id = UUID()
    var date = Date()
    var request: String
    var context: [String] = []
    var reply = ""
    var tier: String?
    var model: String?
    var actions: [ActionRecord] = []
    var usage = Usage()
    var duration: TimeInterval = 0
    var outcome: Outcome = .completed
}

/// Everything said between one summon of Nova and closing the bar.
struct Conversation: Codable, Identifiable, Equatable {
    var id = UUID()
    var startedAt = Date()
    var updatedAt = Date()
    var exchanges: [Exchange] = []

    var title: String {
        let first = exchanges.first?.request ?? "Untitled"
        return first.count > 80 ? String(first.prefix(80)) + "…" : first
    }

    var usage: Usage {
        exchanges.reduce(into: Usage()) { $0 += $1.usage }
    }
}

/// A fact Nova keeps about the user across conversations.
struct Memory: Codable, Identifiable, Equatable {
    enum Source: String, Codable { case nova, user }

    var id = UUID()
    var text: String
    var createdAt = Date()
    var source: Source

    /// Short id Nova uses to refer to the memory in its prompt and tools.
    var shortID: String { String(id.uuidString.prefix(6)).lowercased() }
}

/// Running totals for proactive screen checks, which aren't part of any conversation.
struct BackgroundStats: Codable, Equatable {
    var checks = 0
    var notices = 0
    var usage = Usage()
}

struct NovaSettings: Codable, Equatable {
    var proactiveEnabled = true
    var proactiveIntervalSeconds: Double = 45
    var contextSelection = true
    var contextBrowser = true
    var contextFinder = true
}

// MARK: - Store

/// Nova's on-disk state: conversations, memories, and settings, under
/// ~/Library/Application Support/Nova.
@MainActor
final class NovaStore: ObservableObject {
    static let shared = NovaStore()

    @Published private(set) var conversations: [Conversation] = []
    @Published private(set) var memories: [Memory] = []
    @Published private(set) var backgroundStats = BackgroundStats()
    @Published var settings = NovaSettings() {
        didSet { if settings != oldValue { write(settings, to: settingsURL) } }
    }

    let directory: URL
    private var conversationsDirectory: URL { directory.appendingPathComponent("Conversations", isDirectory: true) }
    private var memoriesURL: URL { directory.appendingPathComponent("memories.json") }
    private var settingsURL: URL { directory.appendingPathComponent("settings.json") }
    private var backgroundURL: URL { directory.appendingPathComponent("background.json") }

    private init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        directory = support.appendingPathComponent("Nova", isDirectory: true)
        try? FileManager.default.createDirectory(at: conversationsDirectory, withIntermediateDirectories: true)
        load()
    }

    // MARK: Conversations

    /// Inserts or replaces a conversation and saves it.
    func save(_ conversation: Conversation) {
        guard !conversation.exchanges.isEmpty else { return }
        if let index = conversations.firstIndex(where: { $0.id == conversation.id }) {
            conversations[index] = conversation
        } else {
            conversations.insert(conversation, at: 0)
        }
        conversations.sort { $0.updatedAt > $1.updatedAt }
        write(conversation, to: url(for: conversation.id))
    }

    func delete(_ conversation: Conversation) {
        conversations.removeAll { $0.id == conversation.id }
        try? FileManager.default.removeItem(at: url(for: conversation.id))
    }

    func deleteAllConversations() {
        for conversation in conversations {
            try? FileManager.default.removeItem(at: url(for: conversation.id))
        }
        conversations = []
    }

    // MARK: Memories

    @discardableResult
    func addMemory(_ text: String, source: Memory.Source) -> Memory {
        let memory = Memory(text: text.trimmingCharacters(in: .whitespacesAndNewlines), source: source)
        memories.insert(memory, at: 0)
        write(memories, to: memoriesURL)
        return memory
    }

    func updateMemory(_ memory: Memory, text: String) {
        guard let index = memories.firstIndex(where: { $0.id == memory.id }) else { return }
        memories[index].text = text
        write(memories, to: memoriesURL)
    }

    func deleteMemory(_ memory: Memory) {
        memories.removeAll { $0.id == memory.id }
        write(memories, to: memoriesURL)
    }

    /// Deletes by the short id Nova sees. Returns false if nothing matched.
    @discardableResult
    func deleteMemory(shortID: String) -> Bool {
        guard let memory = memories.first(where: { $0.shortID == shortID.lowercased() }) else { return false }
        deleteMemory(memory)
        return true
    }

    func deleteAllMemories() {
        memories = []
        write(memories, to: memoriesURL)
    }

    // MARK: Background checks

    func recordBackgroundCheck(usage: Usage, noticed: Bool) {
        backgroundStats.checks += 1
        if noticed { backgroundStats.notices += 1 }
        backgroundStats.usage += usage
        write(backgroundStats, to: backgroundURL)
    }

    // MARK: Disk

    private func url(for id: UUID) -> URL {
        conversationsDirectory.appendingPathComponent("\(id.uuidString).json")
    }

    private func load() {
        let decoder = Self.decoder
        if let data = try? Data(contentsOf: settingsURL),
           let saved = try? decoder.decode(NovaSettings.self, from: data) {
            settings = saved
        }
        if let data = try? Data(contentsOf: backgroundURL),
           let saved = try? decoder.decode(BackgroundStats.self, from: data) {
            backgroundStats = saved
        }
        if let data = try? Data(contentsOf: memoriesURL),
           let saved = try? decoder.decode([Memory].self, from: data) {
            memories = saved
        }
        let files = (try? FileManager.default.contentsOfDirectory(at: conversationsDirectory,
                                                                   includingPropertiesForKeys: nil)) ?? []
        conversations = files
            .filter { $0.pathExtension == "json" }
            .compactMap { try? decoder.decode(Conversation.self, from: Data(contentsOf: $0)) }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    private func write<T: Encodable>(_ value: T, to url: URL) {
        guard let data = try? Self.encoder.encode(value) else { return }
        try? data.write(to: url, options: .atomic)
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}
