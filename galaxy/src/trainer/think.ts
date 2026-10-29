// How Galaxy Trainer thinks: Claude through the Claude Agent SDK, on your Max plan,
// the way Comet does it. No tools, no settings, no saved sessions: it only ever reads
// what it's given and writes text back.
//
// Sign-in: the year-long token `galaxy login` saves (CLAUDE_CODE_OAUTH_TOKEN), so it
// works from the background under launchd, where Terminal's `claude` login can't be
// reached. Never an API key: one would win over the plan, so it's removed.

import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isConsumer } from "../edition";
import { readClaudeToken } from "../paths";

/** Text back, or null. When it's null, `lastError` says why. */
export type Think = ((prompt: string, timeoutMs: number) => Promise<string | null>) & { lastError?: string };

const DENY = "Galaxy Trainer only thinks; nothing can be run. Answer in words only.";
const SYSTEM =
  "You are Galaxy Trainer, the coach of GalaxyAI, a personal assistant made of several members. " +
  "You have no tools. Answer exactly in the format each request asks for.";

/** The environment Claude runs with: the plan sign-in, never an API key. */
export function claudeEnv(base: Record<string, string | undefined> = process.env, token = readClaudeToken()): Record<string, string | undefined> {
  const env = { ...base };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  if (token && !base.CLAUDE_CODE_OAUTH_TOKEN) env.CLAUDE_CODE_OAUTH_TOKEN = token;
  return env;
}

export function sdkOptions(model: string, cwd: string, abort: AbortController, system = SYSTEM): Options {
  return {
    model,
    cwd,
    abortController: abort,
    // A few turns, not one: if the model reaches for a tool anyway, the refusal costs a turn.
    maxTurns: 3,
    tools: [],
    mcpServers: {},
    strictMcpConfig: true,
    settingSources: [],
    persistSession: false,
    systemPrompt: system,
    // The consumer app has no Node: Claude Code runs on the Bun it ships with.
    ...(isConsumer() ? { executable: "bun" as const } : {}),
    env: claudeEnv(),
    hooks: {
      PreToolUse: [
        { hooks: [async () => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: DENY } })] },
      ],
    },
    canUseTool: async () => ({ behavior: "deny", message: DENY }),
  };
}

/** Plain-language reasons for the ways the sign-in goes wrong. */
export function explain(error: string): string {
  if (isConsumer() && /oauth|token.*(expired|invalid)|not logged in|log ?in|authenticat|401|credential/i.test(error)) {
    return `Galaxy isn't connected to Claude (${error.slice(0, 160)}). Connect Claude again from the account menu in Galaxy Link.`;
  }
  // #owner
  if (/oauth|token.*(expired|invalid)|not logged in|log ?in|authenticat|401|credential/i.test(error)) {
    return `Claude isn't signed in for Galaxy (${error.slice(0, 160)}). Run \`galaxy login\` in Terminal.`;
  }
  // #end
  return error.slice(0, 300);
}

export function claudeThink(model = process.env.GALAXY_TRAINER_MODEL ?? "sonnet", system = SYSTEM, who = "trainer"): Think {
  const think: Think = async (prompt, timeoutMs) => {
    const dir = mkdtempSync(join(tmpdir(), `galaxy-${who}-`));
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    let result: string | null = null;
    let error = "";
    const said: string[] = [];
    try {
      for await (const message of query({ prompt, options: sdkOptions(model, dir, abort, system) })) {
        if (message.type === "assistant") {
          for (const block of message.message.content ?? []) if (block.type === "text" && typeof block.text === "string") said.push(block.text);
        }
        if (message.type === "result") {
          if (message.subtype === "success" && typeof message.result === "string" && message.result.trim()) result = message.result;
          else error = `Claude Code said: ${(message as any).result || message.subtype}`;
        }
      }
    } catch (e) {
      error = abort.signal.aborted ? `it took longer than ${Math.round(timeoutMs / 1000)}s` : e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(timer);
      rmSync(dir, { recursive: true, force: true });
    }
    // Out of turns but it did write something: that's still the answer.
    if (!result && said.length) result = said.join("\n");
    think.lastError = result ? undefined : explain(error || "no answer");
    if (!result) console.error(`${who}: Claude gave nothing back: ${think.lastError}`);
    return result;
  };
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
