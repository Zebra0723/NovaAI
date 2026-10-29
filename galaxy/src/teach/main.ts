#!/usr/bin/env bun
// Galaxy Teach: joins Link as `teach` and teaches you what comes up while you work.
//
// The watcher in Galaxy Teach.app picks out a few lines from Terminal, the Claude app,
// claude.ai and VS Code and hands them to Link, in memory only. This reads them the
// moment they arrive, asks Claude whether anything there is worth a lesson, and offers
// it (the app shows the notification, with Begin and Skip). Begin, and Claude writes
// the lesson for you. The lines themselves are never written anywhere.

import { GalaxyLink, type LinkInboxItem } from "../client";
import type { Spot } from "../teach";
import { claudeThink } from "../trainer/think";
import { Tutor } from "./tutor";

const SYSTEM =
  "You are Galaxy Teach, a warm, sharp tutor inside GalaxyAI, a personal assistant a student is building. " +
  "You have no tools. Answer exactly in the format each request asks for.";

const link = new GalaxyLink("teach", { name: "Teach", powers: ["teaching"], version: "0.1.0" });
const think = claudeThink(process.env.GALAXY_TEACH_MODEL ?? "sonnet", SYSTEM, "teach");
const tutor = new Tutor({ call: (m, p, b, t) => link.call(m, p, b, t), think });

let checked = { ok: false, at: 0 };
async function canThink(): Promise<boolean> {
  if (checked.ok && Date.now() - checked.at < 30 * 60_000) return true;
  const reply = await think("Reply with the single word: ready", 120_000);
  const ok = !!reply && /ready/i.test(reply);
  checked = { ok, at: Date.now() };
  await link.call("PUT", "/v1/teach/status", { ok, reason: ok ? "" : think.lastError || "Claude didn't answer" });
  console.log(ok ? "teach: Claude is working" : `teach: can't reach Claude: ${think.lastError}`);
  return ok;
}

/** Right away, but a moment's grace so one burst of output becomes one look, not five. */
async function watchSpots() {
  for (;;) {
    const first = (await link.call<Spot[]>("GET", "/v1/teach/spots?wait=25", undefined, 40_000)) ?? [];
    if (!first.length) {
      await Bun.sleep(first === null ? 5000 : 0);
      continue;
    }
    await Bun.sleep(3000);
    const more = (await link.call<Spot[]>("GET", "/v1/teach/spots")) ?? [];
    const spots = [...first, ...more];
    if (!(await canThink())) continue; // dropped, not kept: they were only ever for right now
    const made = await tutor.offersFrom(spots).catch((e) => (console.error("teach:", e), 0));
    if (made) console.log(`teach: offered ${made} lesson${made === 1 ? "" : "s"}`);
  }
}

async function onInbox(item: LinkInboxItem) {
  const [, what, id] = /^(write|check|finished):([\w-]+)$/.exec(item.text.trim()) ?? [];
  if (!what || !id) return;
  if (what === "write") {
    if (!(await canThink())) {
      await link.call("POST", `/v1/teach/lessons/${id}/fail`, { reason: think.lastError || "I can't reach Claude right now." });
      return;
    }
    console.log(`teach: writing lesson ${id}`);
    void tutor.write(id).then((ok) => console.log(`teach: lesson ${id} ${ok ? "ready" : "failed"}`));
  } else if (what === "check") void tutor.check(id);
  else void tutor.learnFrom(id);
}

if (import.meta.main) {
  link.run({ onInbox });
  setTimeout(() => void canThink(), 3_000);
  void watchSpots();
  const quit = async () => {
    await link.goodbye();
    process.exit(0);
  };
  process.on("SIGTERM", quit);
  process.on("SIGINT", quit);
}
