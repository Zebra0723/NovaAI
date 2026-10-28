#!/usr/bin/env bun
// galaxy: look at and steer Galaxy Link from Terminal.

import { GalaxyLink, type LinkMemory, type LinkTask } from "./client";
import { defaultSources, readNova, readOrbit } from "./importers";

const link = new GalaxyLink("galaxy");
const [command = "status", ...args] = process.argv.slice(2);

const HELP = `galaxy - Galaxy Link from Terminal

  galaxy status              which bodies are running, and what's queued
  galaxy memory [search]     what the assistant knows about you
  galaxy remember <fact>     add something
  galaxy forget <id>         remove a memory by its id (m_...)
  galaxy activity            what the bodies have been doing today
  galaxy tasks               recent handoffs between bodies
  galaxy context <body>      the prompt block a body sees
  galaxy import              merge Nova's and Orbit's own memories in (safe to rerun)
  galaxy introduce           a round of introductions in Galaxy Chat, so every member knows the others
  galaxy doctor              why a member hasn't joined, and what to do about it`;

async function need<T>(value: Promise<T | null>): Promise<T> {
  const result = await value;
  if (result === null) {
    console.error("Galaxy Link isn't answering. Start it with: launchctl kickstart gui/$(id -u)/ai.galaxy.link");
    process.exit(1);
  }
  return result;
}

const ago = (ms: number) => {
  if (!ms) return "never";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

switch (command) {
  case "status": {
    const bodies = await need(link.call<any[]>("GET", "/v1/bodies"));
    const presence = await need(link.call<any>("GET", "/v1/presence"));
    const queued = await need(link.call<LinkTask[]>("GET", "/v1/tasks?status=queued"));
    console.log("Galaxy Link is running.\n");
    for (const b of bodies.filter((b) => b.id !== "galaxy")) {
      console.log(`  ${b.online ? "●" : "○"} ${b.name.padEnd(8)} ${b.online ? "running" : "not running, seen " + ago(b.lastSeen)}`);
    }
    if (!bodies.length) console.log("  No body has connected yet.");
    console.log(`\n  You are ${presence.atMac ? "at the Mac" : "away from the Mac"}; results go ${presence.atMac ? "to the screen" : "to your phone"}.`);
    console.log(`  ${queued.length} handoff${queued.length === 1 ? "" : "s"} waiting.`);
    break;
  }
  case "memory": {
    const memories = await need(link.call<LinkMemory[]>("GET", "/v1/memory?q=" + encodeURIComponent(args.join(" "))));
    for (const m of memories) console.log(`  ${m.id}  ${m.text}  (${m.source})`);
    if (!memories.length) console.log(args.length ? "Nothing matches." : "No memories yet.");
    break;
  }
  case "remember": {
    if (!args.length) throw new Error("galaxy remember <fact>");
    const m = await need(link.remember(args.join(" "), true));
    console.log(`Remembered (${m.id}).`);
    break;
  }
  case "forget": {
    if (!args[0]) throw new Error("galaxy forget <id>");
    await need(link.forget(args[0]));
    console.log("Forgotten.");
    break;
  }
  case "activity": {
    const events = await need(link.call<any[]>("GET", `/v1/events?since=${Date.now() - 86400_000}&limit=100`));
    for (const e of events) {
      const at = new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      console.log(`  ${at}  ${e.body.padEnd(7)} ${e.summary}`);
    }
    if (!events.length) console.log("Nothing today.");
    break;
  }
  case "tasks": {
    const tasks = await need(link.call<LinkTask[]>("GET", "/v1/tasks"));
    for (const t of tasks) console.log(`  ${t.id}  ${t.status.padEnd(9)} ${t.from} → ${t.to}  ${t.title}`);
    if (!tasks.length) console.log("No handoffs yet.");
    break;
  }
  case "context": {
    const body = args[0] ?? "nova";
    const ctx = await need(link.call<{ text: string }>("GET", "/v1/context?for=" + encodeURIComponent(body)));
    console.log(ctx.text);
    break;
  }
  case "import": {
    const sources = defaultSources();
    for (const [name, read] of [
      ["Nova", () => readNova(sources.nova)],
      ["Orbit", () => readOrbit(sources.orbit)],
    ] as const) {
      const items = read();
      if (!items) {
        console.log(`  ${name}: nothing to import`);
        continue;
      }
      const r = await need(link.call<{ found: number; added: number }>("POST", "/v1/memory/import", { items }));
      console.log(`  ${name}: ${r.added} new of ${r.found}`);
    }
    break;
  }
  case "introduce": {
    const posted = await need(link.call<unknown[]>("POST", "/v1/introductions"));
    console.log(`Introductions posted in Galaxy Chat (${posted.length} messages). Open Galaxy Link to read them.`);
    break;
  }
  case "doctor": {
    // Why a member hasn't joined: checks each one's install from the outside.
    const { spawnSync } = await import("node:child_process");
    const { existsSync, readFileSync } = await import("node:fs");
    const { homedir } = await import("node:os");
    const sh = (cmd: string) => spawnSync("/bin/bash", ["-c", cmd], { encoding: "utf8" }).stdout.trim();
    const home = homedir();
    const up = await link.available();
    console.log(`${up ? "✓" : "✗"} Galaxy Link ${up ? "is running" : "isn't running: launchctl kickstart gui/$(id -u)/ai.galaxy.link"}`);
    const bodies = up ? ((await link.call<any[]>("GET", "/v1/bodies")) ?? []) : [];
    const joined = (id: string) => bodies.find((b) => b.id === id);
    const report = (id: string, lines: string[]) => {
      const b = joined(id);
      console.log(`\n${b?.online ? "✓" : b ? "○" : "✗"} ${id.charAt(0).toUpperCase() + id.slice(1)}: ${b?.online ? "connected" : b ? "joined before, not running now" : "has never joined"}`);
      if (!b?.online) for (const l of lines) console.log("    " + l);
    };
    // Comet: where launchd runs it from, and whether that copy knows about Link.
    const plist = `${home}/Library/LaunchAgents/com.imessage.server.plist`;
    const cometDir = existsSync(plist) ? sh(`/usr/libexec/PlistBuddy -c 'Print :WorkingDirectory' '${plist}'`) : "";
    const cometRoot = cometDir ? sh(`git -C '${cometDir}' rev-parse --show-toplevel 2>/dev/null`) : "";
    const cometLines: string[] = [];
    if (!cometRoot) cometLines.push("Comet's server isn't installed as a login agent (com.imessage.server).");
    else {
      cometLines.push(`runs from ${cometRoot}, branch ${sh(`git -C '${cometRoot}' branch --show-current`) || "?"}`);
      if (!existsSync(`${cometRoot}/server/src/galaxy/client.ts`))
        cometLines.push("that copy predates Galaxy Link: run galaxy/install-all.sh again (it updates this exact folder)");
      const env = existsSync(`${cometRoot}/.env`) ? readFileSync(`${cometRoot}/.env`, "utf8") : "";
      if (/^\s*GALAXY_LINK\s*=\s*(0|off|false|no)\b/im.test(env)) cometLines.push("GALAXY_LINK is switched off in its .env");
      const running = sh("launchctl list | grep com.imessage.server");
      cometLines.push(running ? "its server is loaded; restart it: launchctl kickstart -k gui/$(id -u)/com.imessage.server" : "its server isn't running: launchctl kickstart gui/$(id -u)/com.imessage.server");
      const logLine = sh(`grep -rih "galaxy link" '${cometRoot}/logs' 2>/dev/null | tail -1`);
      if (logLine) cometLines.push(`last log: ${logLine.slice(0, 160)}`);
    }
    report("comet", cometLines);
    report("nova", ["open Nova (it joins while it's running)", existsSync("/Applications/Nova.app") ? "" : "Nova.app isn't in Applications: run galaxy/install-all.sh"].filter(Boolean));
    report("orbit", ["Orbit joins while its menu bar app is running, and is usually quit; that's fine"]);
    report("nebula", ["open Nebula (it joins while it's running)"]);
    report("trainer", [sh("launchctl list | grep ai.galaxy.trainer") ? "loaded; its log is ~/Library/Application Support/Galaxy/trainer.log" : "not installed: run galaxy/install.sh (it needs Claude Code logged into your plan)"]);
    report("zenith", [sh("launchctl list | grep ai.galaxy.zenith") ? "loaded; check ~/Galaxy/Missions/zenith.log" : "not installed: run galaxy/install-all.sh"]);
    break;
  }
  case "help":
  case "-h":
  case "--help":
    console.log(HELP);
    break;
  default:
    console.error(HELP);
    process.exit(2);
}
