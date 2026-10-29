// The last word before anything ships to other people: does any of it know you?
//
// Scans every file of a build for your name, Comet, Teach, your other Mac user, your
// contacts and the like. Words only you would know (your email, family names, numbers)
// go in a private list that is never committed: ~/.config/galaxy/private-words, one per
// line, or GALAXY_PRIVATE_WORDS (newline-separated) on the build machine.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";

export interface Hit {
  file: string;
  what: string;
  sample: string;
}

/** Things that must never be in the consumer edition, by what they are. */
const RULES: [string, RegExp][] = [
  ["the owner's name", /\barjun\b/i],
  ["Comet", /\bcomet\b/i],
  ["Comet's Mac user", /cometai|dailyos|Available3/i],
  ["Comet's services", /com\.imessage|imessage-?relay|:8787\b/i],
  ["Teach", /galaxy teach|\/v1\/teach|\bteach\.js\b|TEACH_VIEWS/i],
  ["an allowlist", /\ballow[ -]?list\b/i],
  ["a Gmail address", /[\w.+-]+@gmail\.com/i],
  ["a phone number", /\+1[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{4}\b/],
  ["a Claude token", /sk-ant-(?:oat|api|admin)\d\d-[A-Za-z0-9_-]{20,}/],
  ["the owner's Galaxy folder", /Application Support\/Galaxy\/(?!\.\.)|Library\/Application Support\/Galaxy"/],
];

function privateWords(): string[] {
  const words: string[] = [];
  const file = join(homedir(), ".config", "galaxy", "private-words");
  if (existsSync(file)) words.push(...readFileSync(file, "utf8").split("\n"));
  if (process.env.GALAXY_PRIVATE_WORDS) words.push(...process.env.GALAXY_PRIVATE_WORDS.split("\n"));
  return words.map((w) => w.trim()).filter((w) => w.length >= 3 && !w.startsWith("#"));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules") continue;
    statSync(p).isDirectory() ? files(p, out) : out.push(p);
  }
  return out;
}

/** Everything in `dir` that shouldn't be there. Empty means safe to ship. */
export function scan(dir: string, extra: string[] = privateWords()): Hit[] {
  if (!existsSync(dir)) return [{ file: dir, what: "nothing built yet", sample: "" }];
  const rules: [string, RegExp][] = [...RULES, ...extra.map((w): [string, RegExp] => ["a private word", new RegExp(escape(w), "i")])];
  const hits: Hit[] = [];
  for (const file of files(dir)) {
    const text = readFileSync(file).toString("latin1");
    for (const [what, re] of rules) {
      const m = re.exec(text);
      if (m) {
        const at = m.index;
        hits.push({ file: relative(dir, file), what, sample: text.slice(Math.max(0, at - 30), at + 40).replace(/\s+/g, " ") });
      }
    }
  }
  return hits;
}
