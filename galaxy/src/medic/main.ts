#!/usr/bin/env bun
// Galaxy Medic: joins Link as the member `medic` and checks on every member once a
// minute. It restarts what stopped, reopens what crashed, brings Link back if Link
// is what went down, and tells you (once, with what to run) when only you can fix it.
//
// It runs as its own login agent, apart from Link, for exactly that last case.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { GalaxyLink, type LinkInboxItem } from "../client";
import { galaxyHome } from "../paths";
import { claudeThink } from "../trainer/think";
import { specs } from "./doctor";
import { Medic, type System } from "./medic";

const sys: System = {
  sh: (cmd, timeoutMs = 10_000) =>
    new Promise((resolve) => {
      const child = spawn("/bin/bash", ["-c", cmd], { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
      child.stderr.on("data", (c: Buffer) => (out += c.toString("utf8")));
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.on("error", () => (clearTimeout(timer), resolve({ code: 127, out })));
      child.on("close", (code) => (clearTimeout(timer), resolve({ code: code ?? 1, out })));
    }),
  http: async (url, timeoutMs = 3000) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      return { status: res.status, body: await res.text() };
    } catch {
      return null;
    }
  },
  tail: (path, lines = 40) => {
    try {
      return readFileSync(path, "utf8").split("\n").slice(-lines).join("\n");
    } catch {
      return "";
    }
  },
  now: () => Date.now(),
};

const link = new GalaxyLink("medic", { name: "Medic", powers: ["health"], version: "0.1.0" });
const think = claudeThink(process.env.GALAXY_MEDIC_MODEL ?? "haiku");
const medic = new Medic({
  sys,
  call: (m, p, b, t) => link.call(m, p, b, t),
  specs: specs(homedir(), galaxyHome()),
  explain: (prompt) => think(prompt, 90_000),
});

let running = false;
async function checkup() {
  if (running) return;
  running = true;
  try {
    const r = await medic.round();
    const notes = Object.entries(r.verdicts)
      .filter(([, v]) => v.health !== "healthy" && v.health !== "off")
      .map(([id, v]) => `${id}: ${v.note}`);
    if (notes.length || r.acted.length) console.log(`medic: ${[...r.acted, ...notes].join("; ")}`);
  } catch (error) {
    console.error("medic: checkup failed:", error);
  } finally {
    running = false;
  }
}

async function onInbox(item: LinkInboxItem) {
  if (item.text.trim() === "checkup") await checkup();
}

if (import.meta.main) {
  console.log("medic: checking on every member once a minute");
  link.run({ onInbox });
  setTimeout(checkup, 10_000);
  setInterval(checkup, 60_000);
  const quit = async () => {
    await link.goodbye();
    process.exit(0);
  };
  process.on("SIGTERM", quit);
  process.on("SIGINT", quit);
}
