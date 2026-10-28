#!/usr/bin/env bun
// Galaxy Trainer: joins Link as the member `trainer` and trains every other member
// overnight, on your Max plan through Claude Code: twelve minutes each, twenty-four
// for Nebula.
//
// Sessions only start inside the overnight window (GALAXY_TRAINER_WINDOW, default
// 1-6, so 1am to 6am) and never while that member is doing real work; it waits and
// tries again. One member at a time. For testing, "Train now" in Galaxy Link (or
// `galaxy train <member>`) runs a twelve-minute session straight away, any time,
// still never over real work.

import { GalaxyLink, type LinkInboxItem } from "../client";
import { budgetFor, inWindow, localDay, TEST_MINUTES, TRAINEES } from "../training";
import { Coach } from "./coach";
import { claudeThink } from "./think";

const link = new GalaxyLink("trainer", { name: "Trainer", powers: ["training"], version: "0.2.0" });
const think = claudeThink();
const coach = new Coach({ call: (m, p, b, t) => link.call(m, p, b, t), think });

/**
 * Can the trainer reach Claude Code? Checked at start and before every session, and told
 * to Link, so a session never starts that can't think, and the Trainer page says why.
 */
let checked = { ok: false, at: 0 };
async function canThink(): Promise<boolean> {
  if (checked.ok && Date.now() - checked.at < 30 * 60_000) return true;
  const reply = await think("Reply with the single word: ready", 120_000);
  const ok = !!reply && /ready/i.test(reply);
  const reason = ok ? "" : think.lastError || `Claude Code answered "${(reply ?? "").slice(0, 80)}"`;
  checked = { ok, at: Date.now() };
  await link.call("PUT", "/v1/training/status", { ok, reason });
  console.log(ok ? "trainer: Claude Code is working" : `trainer: can't reach Claude Code: ${reason}`);
  return ok;
}

type Job = { member: string; trigger: "night" | "test" };
const queue: Job[] = [];
let busy = false;
let current = "";

const queued = (member: string) => current === member || queue.some((j) => j.member === member);
const name = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

async function drain() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const job = queue.shift()!;
      current = job.member;
      if (job.trigger === "night" && !inWindow(new Date())) continue; // the night ended first; tomorrow
      if (await coach.busy(job.member)) {
        // Real work first. A night session waits for the next check; a test session says so.
        if (job.trigger === "test") {
          await link.call("POST", `/v1/training/${job.member}/thread`, {
            kind: "message",
            text: `${name(job.member)} is doing real work right now, so the test session will wait. Ask again when it's done.`,
          });
        }
        continue;
      }
      if (!(await canThink())) {
        if (job.trigger === "test") {
          await link.call("POST", `/v1/training/${job.member}/thread`, {
            kind: "message",
            text: "I can't run a session right now: I can't reach Claude Code. The reason is at the top of the Trainer page.",
          });
        }
        continue;
      }
      const minutes = job.trigger === "test" ? TEST_MINUTES : budgetFor(job.member);
      console.log(`trainer: ${job.trigger} session for ${job.member}, up to ${minutes} min`);
      const s = await coach.session(job.member, localDay(new Date()), { budgetMs: minutes * 60_000, trigger: job.trigger });
      console.log(`trainer: ${job.member} ${s?.status ?? "not started"}${s?.score != null ? ` ${Math.round(s.score)}/100` : ""}${s?.summary ? ` (${s.summary})` : ""}`);
    }
  } finally {
    busy = false;
    current = "";
  }
}

/** Inside the window: queue tonight's session for every member that hasn't had one. */
async function nightly() {
  if (!inWindow(new Date())) return;
  const o = await link.call<{ members: { member: string; joined: boolean; minutesToday: number; latest: { trigger: string; day: string; status: string } | null }[] }>(
    "GET",
    "/v1/training",
  );
  for (const m of o?.members ?? []) {
    // One overnight session a night. A night that failed part way doesn't run again until tomorrow.
    if (m.joined && m.minutesToday === 0 && !queued(m.member)) queue.push({ member: m.member, trigger: "night" });
  }
  void drain();
}

async function onInbox(item: LinkInboxItem) {
  const member = /^train:([a-z][a-z0-9-]{1,31})$/.exec(item.text.trim())?.[1];
  if (member && TRAINEES.includes(member) && !queued(member)) {
    // Tests go to the front: you're watching.
    queue.unshift({ member, trigger: "test" });
    void drain();
  }
}

if (import.meta.main) {
  console.log(`trainer: overnight sessions in window ${process.env.GALAXY_TRAINER_WINDOW ?? "1-6"}; tests on demand`);
  link.run({ onInbox });
  setTimeout(() => void canThink(), 5_000);
  setTimeout(nightly, 15_000);
  setInterval(nightly, 5 * 60_000);
  const quit = async () => {
    await link.goodbye();
    process.exit(0);
  };
  process.on("SIGTERM", quit);
  process.on("SIGINT", quit);
}
