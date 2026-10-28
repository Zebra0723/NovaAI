// How Galaxy Trainer thinks: one `claude -p` call on the Max plan, with no tools.
// It only ever reads what it's given and writes text back.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Think = (prompt: string, timeoutMs: number) => Promise<string | null>;

const NO_TOOLS = [
  "Bash", "Edit", "Write", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch",
  "Task", "Agent", "Read", "Glob", "Grep", "TodoWrite",
];

export function claudeArgs(prompt: string, model: string): string[] {
  return [
    "-p", prompt,
    "--output-format", "json",
    "--model", model,
    "--max-turns", "1",
    "--disallowedTools", NO_TOOLS.join(","),
    "--settings", JSON.stringify({ sandbox: { enabled: true, filesystem: { denyRead: ["~/"] }, network: { allowedDomains: [] } } }),
  ];
}

export function claudeThink(claude = process.env.GALAXY_TRAINER_CLAUDE ?? "claude", model = process.env.GALAXY_TRAINER_MODEL ?? "sonnet"): Think {
  return (prompt, timeoutMs) =>
    new Promise((resolve) => {
      const env = { ...process.env };
      // An API key would win over the Max plan login. The trainer only ever uses the plan.
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_AUTH_TOKEN;
      const dir = mkdtempSync(join(tmpdir(), "galaxy-trainer-"));
      const done = (value: string | null) => {
        clearTimeout(timer);
        rmSync(dir, { recursive: true, force: true });
        resolve(value);
      };
      let out = "";
      const child = spawn(claude, claudeArgs(prompt, model), { cwd: dir, env, stdio: ["ignore", "pipe", "ignore"] });
      const timer = setTimeout(() => {
        child.kill("SIGINT");
        setTimeout(() => child.kill("SIGKILL"), 5000).unref?.();
      }, timeoutMs);
      child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
      child.on("error", () => done(null));
      child.on("close", () => {
        try {
          const event = JSON.parse(out.trim().split("\n").at(-1) ?? "");
          done(!event.is_error && typeof event.result === "string" && event.result.trim() ? event.result : null);
        } catch {
          done(null);
        }
      });
    });
}

/** The first JSON object in a model's reply, or null. Tolerates code fences and prose around it. */
export function readJSON<T = any>(text: string | null): T | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
