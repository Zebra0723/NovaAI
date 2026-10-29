import AppKit

/// The consumer edition's background services, started by the app itself: Galaxy Link
/// (galaxyd), the Trainer and Medic. Everything they need ships inside Galaxy Link.app
/// (Contents/Resources/galaxy, and Bun to run it), so there's nothing to install.
///
/// Each one is a launch agent in ~/Library/LaunchAgents pointing into the app. Opening the
/// app writes them (again, if a new version moved anything) and starts them; replacing
/// the app with a newer one and opening it is the whole update.
enum ConsumerAgents {
    struct Agent {
        let label: String
        let script: String
        let log: String
    }

    static let agents = [
        Agent(label: "ai.galaxy.consumer.link", script: "bin/consumer/galaxyd.js", log: "galaxyd.log"),
        Agent(label: "ai.galaxy.consumer.trainer", script: "bin/trainer/main.js", log: "trainer.log"),
        Agent(label: "ai.galaxy.consumer.medic", script: "bin/medic/main.js", log: "medic.log"),
    ]

    static var resources: URL { Bundle.main.resourceURL ?? Bundle.main.bundleURL.appendingPathComponent("Contents/Resources") }
    static var bun: URL { resources.appendingPathComponent("bun") }
    static var galaxy: URL { resources.appendingPathComponent("galaxy") }

    /// Writes and starts every agent whose plist is new or changed. Quick when nothing has.
    static func install() {
        let fm = FileManager.default
        let agentsDir = fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents", isDirectory: true)
        try? fm.createDirectory(at: agentsDir, withIntermediateDirectories: true)
        try? fm.createDirectory(at: Link.home, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        guard fm.isExecutableFile(atPath: bun.path) else { return } // a build without its runtime: nothing to start
        for agent in agents {
            let plist = agentsDir.appendingPathComponent("\(agent.label).plist")
            let data = plistData(agent)
            if (try? Data(contentsOf: plist)) == data { continue }
            try? data.write(to: plist)
            let domain = "gui/\(getuid())"
            run("/bin/launchctl", ["bootout", "\(domain)/\(agent.label)"])
            if !run("/bin/launchctl", ["bootstrap", domain, plist.path]) {
                Thread.sleep(forTimeInterval: 1.5)
                run("/bin/launchctl", ["bootstrap", domain, plist.path])
            }
            run("/bin/launchctl", ["kickstart", "\(domain)/\(agent.label)"])
        }
    }

    static func plistData(_ agent: Agent) -> Data {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let logs = Link.home.appendingPathComponent(agent.log).path
        let dict: [String: Any] = [
            "Label": agent.label,
            "ProgramArguments": [bun.path, galaxy.appendingPathComponent(agent.script).path],
            "WorkingDirectory": galaxy.path,
            "RunAtLoad": true,
            "KeepAlive": true,
            "ProcessType": "Background",
            "EnvironmentVariables": [
                // Claude Code runs on the Bun beside it; there's no Node in the app.
                "PATH": "\(resources.path):/usr/bin:/bin:/usr/sbin:/sbin",
                "HOME": home,
                "GALAXY_WEB": galaxy.appendingPathComponent("web").path,
            ],
            "StandardOutPath": logs,
            "StandardErrorPath": logs,
        ]
        return (try? PropertyListSerialization.data(fromPropertyList: dict, format: .xml, options: 0)) ?? Data()
    }

    /// Opens Terminal on `claude setup-token`, with the Claude Code that ships in the app,
    /// so the person can sign in to their own Claude and paste the token into Galaxy Link.
    static func openClaudeSignIn() {
        let cli = galaxy.appendingPathComponent("node_modules/@anthropic-ai/claude-agent-sdk/cli.js").path
        let command = "clear; echo 'Sign in to Claude in your browser, then copy the token below into Galaxy Link.'; echo; '\(bun.path)' '\(cli)' setup-token"
        let script = """
        tell application "Terminal"
            activate
            do script "\(command.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\""))"
        end tell
        """
        var error: NSDictionary?
        NSAppleScript(source: script)?.executeAndReturnError(&error)
    }

    @discardableResult
    static func run(_ tool: String, _ args: [String]) -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: tool)
        process.arguments = args
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return false }
        process.waitUntilExit()
        return process.terminationStatus == 0
    }
}
