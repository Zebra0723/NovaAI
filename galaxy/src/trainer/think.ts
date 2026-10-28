// How Galaxy Trainer thinks: one `claude -p` call on the Max plan, with no tools.
// It only ever reads what it's given and writes text back.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Text back, or null. When it's null, `lastError` says why. */
export type Think = ((prompt: string, timeoutMs: number) => Promise<string | null>) & { lastError?: string };

const NO_TOOLS = [
  "Bash", "Edit", "Write", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch",
  "Task", "Agent", "Read", "Glob", "Grep", "TodoWrite",
];

export function claudeArgs(prompt: string, model: string): string[] {
  // A few turns, not one: if the model reaches for a tool anyway, the refusal costs a turn,
  // and with only one it would end with error_max_turns instead of an answer.
  return ["-p", prompt, "--output-format", "json", "--model", model, "--max-turns", "3", "--disallowedTools", NO_TOOLS.join(",")];
}

export function claudeThink(claude = process.env.GALAXY_TRAINER_CLAUDE ?? "claude", model = process.env.GALAXY_TRAINER_MODEL ?? "sonnet"): Think {
  const think: Think = (prompt, timeoutMs) =>
    new Promise((resolve) => {
      const env = { ...process.env };
      // An API key would win over the Max plan login. The trainer only ever uses the plan.
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_AUTH_TOKEN;
      const dir = mkdtempSync(join(tmpdir(), "galaxy-trainer-"));
      let out = "";
      let err = "";
      let timedOut = false;
      const done = (value: string | null, why = "") => {
        clearTimeout(timer);
        rmSync(dir, { recursive: true, force: true });
        think.lastError = value === null ? why : undefined;
        if (value === null) console.error(`trainer: Claude Code gave nothing back: ${why}`);
        resolve(value);
      };
      const child = spawn(claude, claudeArgs(prompt, model), { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGINT");
        setTimeout(() => child.kill("SIGKILL"), 5000).unref?.();
      }, timeoutMs);
      child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
      child.stderr.on("data", (c: Buffer) => (err = (err + c.toString("utf8")).slice(-2000)));
      child.on("error", (e) => done(null, `couldn't start ${claude} (${e.message}). Is Claude Code installed and on the trainer's PATH?`));
      child.on("close", (code) => {
        if (timedOut) return done(null, `it took longer than ${Math.round(timeoutMs / 1000)}s`);
        try {
          const event = JSON.parse(out.trim().split("\n").at(-1) ?? "");
          if (event.is_error || typeof event.result !== "string" || !event.result.trim()) {
            return done(null, `Claude Code said: ${String(event.result || event.subtype || "an error").slice(0, 300)}`);
          }
          done(event.result);
        } catch {
          done(null, (err.trim().split("\n").slice(-3).join(" ") || `exit code ${code}`).slice(0, 300));
        }
      });
    });
  return think;
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
