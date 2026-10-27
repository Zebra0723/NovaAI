import Foundation

/// Runs Claude's `bash` tool calls in the user's login shell.
/// Each command runs in a fresh zsh starting in the home directory.
enum BashTool {
    static let timeout: TimeInterval = 120
    static let maxOutput = 30_000

    static func run(_ command: String) async -> (output: String, isError: Bool) {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(returning: runSync(command))
            }
        }
    }

    private static func runSync(_ command: String) -> (output: String, isError: Bool) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", command]
        process.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe

        // Collect output as it arrives so a chatty command can't fill the pipe and block.
        let buffer = OutputBuffer()
        pipe.fileHandleForReading.readabilityHandler = { handle in
            buffer.append(handle.availableData)
        }

        do {
            try process.run()
        } catch {
            return ("Failed to start shell: \(error.localizedDescription)", true)
        }

        let deadline = Date().addingTimeInterval(timeout)
        while process.isRunning && Date() < deadline {
            usleep(50_000)
        }
        var timedOut = false
        if process.isRunning {
            process.terminate()
            timedOut = true
        }
        process.waitUntilExit()
        pipe.fileHandleForReading.readabilityHandler = nil
        buffer.append(pipe.fileHandleForReading.readDataToEndOfFile())

        var output = buffer.string
        if output.count > maxOutput {
            output = String(output.prefix(maxOutput)) + "\n… (output truncated)"
        }
        if timedOut {
            output += "\n(command timed out after \(Int(timeout))s)"
        }
        if output.isEmpty { output = "(no output)" }
        let failed = timedOut || process.terminationStatus != 0
        if failed && !timedOut { output += "\n(exit code \(process.terminationStatus))" }
        return (output, failed)
    }

    private final class OutputBuffer {
        private var data = Data()
        private let lock = NSLock()

        func append(_ chunk: Data) {
            lock.lock(); data.append(chunk); lock.unlock()
        }

        var string: String {
            lock.lock(); defer { lock.unlock() }
            return String(decoding: data, as: UTF8.self)
        }
    }
}
