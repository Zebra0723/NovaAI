import Foundation

/// Sends an iMessage from the user's own Messages account, the way they
/// would: to a phone number, an email, or a name from Contacts.
///
/// Nova used to say it couldn't text anyone, because nothing told it it
/// could. This is a real tool, not a mouse-and-keyboard trip through the
/// Messages window: faster, and it can't mistype into the wrong chat.
enum MessagesTool {
    struct Outcome {
        let text: String
        let isError: Bool
    }

    static func send(to recipient: String, text: String) async -> Outcome {
        let who = recipient.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !who.isEmpty, !body.isEmpty else {
            return Outcome(text: "Error: both `to` and `text` are needed.", isError: true)
        }

        var handle = who
        var label = who
        if !looksLikeHandle(who) {
            let found = await osascript(lookUpScript, [who])
            guard found.ok, !found.output.isEmpty else {
                return Outcome(text: "No contact matches \u{201C}\(who)\u{201D}. Ask for their number, or try their full name.",
                               isError: true)
            }
            // "Full Name<TAB>handle"
            let parts = found.output.components(separatedBy: "\t")
            label = parts.first ?? who
            handle = parts.count > 1 ? parts[1] : found.output
        }

        let sent = await osascript(sendScript, [handle, body])
        guard sent.ok else {
            return Outcome(text: "Messages didn't send it: \(sent.output). If macOS asked to let Nova control Messages, allow it and try again.",
                           isError: true)
        }
        return Outcome(text: "Sent to \(label == handle ? handle : "\(label) (\(handle))").", isError: false)
    }

    static func looksLikeHandle(_ text: String) -> Bool {
        if text.contains("@") { return true }
        let digits = text.filter(\.isNumber)
        return digits.count >= 7 && text.allSatisfy { $0.isNumber || " +-().".contains($0) }
    }

    // The name and text are passed as arguments, never pasted into the script,
    // so nothing in them can change what the script does.
    private static let sendScript = """
    on run argv
        set target to item 1 of argv
        set message to item 2 of argv
        tell application "Messages"
            set service to 1st account whose service type = iMessage
            send message to participant target of service
        end tell
    end run
    """

    /// Exact name first, then the first name that contains it. Phones before emails.
    private static let lookUpScript = """
    on run argv
        set wanted to item 1 of argv
        tell application "Contacts"
            set found to (every person whose name is wanted)
            if (count of found) is 0 then set found to (every person whose name contains wanted)
            if (count of found) is 0 then return ""
            set p to item 1 of found
            if (count of phones of p) > 0 then return (name of p) & tab & (value of item 1 of phones of p)
            if (count of emails of p) > 0 then return (name of p) & tab & (value of item 1 of emails of p)
        end tell
        return ""
    end run
    """

    private static func osascript(_ script: String, _ arguments: [String]) async -> (ok: Bool, output: String) {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let process = Process()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
                process.arguments = ["-e", script] + arguments
                let out = Pipe()
                process.standardOutput = out
                process.standardError = out
                do { try process.run() } catch {
                    continuation.resume(returning: (false, error.localizedDescription))
                    return
                }
                process.waitUntilExit()
                let text = String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                continuation.resume(returning: (process.terminationStatus == 0, text))
            }
        }
    }
}
