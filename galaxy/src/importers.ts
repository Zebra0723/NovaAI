// Reads each body's own memories so they can be merged into the shared one.
// Safe to run again: a fact Link already has is skipped, however it was
// capitalised.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ImportItem {
  text: string;
  source: string;
  createdAt?: number;
}

export const defaultSources = () => ({
  nova: join(homedir(), "Library", "Application Support", "Nova", "memories.json"),
  orbit: join(
    process.env.WELCOME_STATE_DIR || join(homedir(), ".local", "state", "daily-welcome"),
    "memory",
    "facts.txt",
  ),
});

const time = (s?: string) => {
  const at = s ? Date.parse(s) : NaN;
  return Number.isFinite(at) ? at : undefined;
};

/** Nova: a JSON array of { text, createdAt (ISO), source: "nova" | "user" }. */
export function readNova(path: string): ImportItem[] | null {
  if (!existsSync(path)) return null;
  const items = JSON.parse(readFileSync(path, "utf8"));
  return (Array.isArray(items) ? items : [])
    .filter((i: any) => typeof i?.text === "string" && i.text.trim())
    .map((i: any) => ({ text: i.text, source: i.source === "user" ? "user" : "nova", createdAt: time(i.createdAt) }));
}

/** Orbit: one fact a line, "YYYY-MM-DD<tab>fact". */
export function readOrbit(path: string): ImportItem[] | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const [date, ...rest] = line.split("\t");
      return rest.length
        ? { text: rest.join("\t"), source: "orbit", createdAt: time(date) }
        : { text: line, source: "orbit" };
    })
    .filter((i) => i.text.trim());
}
