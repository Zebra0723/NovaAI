// Where Link keeps things, and the token every body reads to reach it.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const DEFAULT_PORT = 7740;

export function galaxyHome(): string {
  return process.env.GALAXY_HOME || join(homedir(), "Library", "Application Support", "Galaxy");
}

export const paths = {
  get home() {
    return galaxyHome();
  },
  get db() {
    return join(galaxyHome(), "galaxy.db");
  },
  /** Readable by you alone. Any body on this Mac, running as you, can read it; nothing else can. */
  get token() {
    return join(galaxyHome(), "token");
  },
  get port() {
    return join(galaxyHome(), "port");
  },
  get log() {
    return join(galaxyHome(), "galaxyd.log");
  },
  /**
   * Your Claude sign-in for the members that run in the background (the trainer, Zenith):
   * a year-long token from `claude setup-token`, saved by `galaxy login`. The same kind
   * of sign-in Comet uses, so they don't depend on Terminal's login. Readable by you alone.
   */
  get claudeToken() {
    return join(galaxyHome(), "claude-token");
  },
};

/** The saved Claude sign-in, if there is one. */
export function readClaudeToken(): string {
  try {
    return readFileSync(paths.claudeToken, "utf8").trim();
  } catch {
    return "";
  }
}

export function ensureHome() {
  mkdirSync(galaxyHome(), { recursive: true, mode: 0o700 });
}

export function readOrCreateToken(): string {
  ensureHome();
  if (existsSync(paths.token)) {
    const token = readFileSync(paths.token, "utf8").trim();
    if (token.length >= 32) return token;
  }
  const token = randomBytes(32).toString("hex");
  writeFileSync(paths.token, token + "\n", { mode: 0o600 });
  chmodSync(paths.token, 0o600);
  return token;
}

export function configuredPort(): number {
  const fromEnv = Number(process.env.GALAXY_PORT);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  try {
    const saved = Number(readFileSync(paths.port, "utf8").trim());
    if (Number.isInteger(saved) && saved > 0) return saved;
  } catch {}
  return DEFAULT_PORT;
}
