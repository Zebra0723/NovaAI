#!/usr/bin/env bun
// Galaxy Trainer: joins Link as the member `trainer` and gives every other member
// its daily session, twelve minutes each, on your Max plan through Claude Code.
//
// Sessions run one at a time from GALAXY_TRAINER_HOUR (default 10) onwards, so a
// Mac that was asleep catches up when it wakes. You can also ask for one from the
// Trainer page in Galaxy Link; it still counts against that member's twelve minutes.

import { GalaxyLink, type LinkInboxItem } from "../client";
import { localDay, TRAINEES } from "../training";
import { Coach } from "./coach";
import { claudeThink } from "./think";

const MINUTES = Number(process.env.GALAXY_TRAINER_MINUTES ?? 12);
const START_HOUR = Number(process.env.GALAXY_TRAINER_HOUR ?? 10);
const link = new GalaxyLink("trainer", { name: "Trainer", powers: ["training"], version: "0.1.0" });
const coach = new Coach({ call: (m, p, b, t) => link.call(m, p, b, t), think: claudeThink(), budgetMs: MINUTES * 60_000 });

const queue: string[] = [];
let busy = false;
let current = "";

/** Minutes `member` has trained today, from Link's own records. */
async function minutesToday(member: string): Promise<number | null> {
  const o = await link.call<{ members: { member: string; minutesToday: number; joined: boolean }[] }>("GET", "/v1/training");
  return o?.members.find((m) => m.member === member)?.minutesToday ?? null;
}

async function drain() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const member = queue.shift()!;
      current = member;
      const used = await minutesToday(member);
      if (used === null) continue;
      const left = MINUTES - used;
      if (left < 2) {
        await link.call("POST", `/v1/training/${member}/thread`, {
          kind: "message",
          text: `That's ${member === "orbit" ? "Orbit" : member.charAt(0).toUpperCase() + member.slice(1)}'s ${MINUTES} minutes for today. Next session tomorrow.`,
        });
        continue;
      }
      console.log(`trainer: training ${member} for up to ${left} min`);
      const s = await coach.session(member, localDay(new Date()), left * 60_000);
      console.log(`trainer: ${member} ${s?.status ?? "not started"}${s?.score != null ? ` ${Math.round(s.score)}/100` : ""}`);
    }
  } finally {
    busy = false;
    current = "";
  }
}

/** Queues today's sessions for members that haven't had one. */
async function daily() {
  if (new Date().getHours() < START_HOUR) return;
  const o = await link.call<{ members: { member: string; joined: boolean; minutesToday: number }[] }>("GET", "/v1/training");
  for (const m of o?.members ?? []) {
    if (m.joined && m.minutesToday === 0 && !queue.includes(m.member) && current !== m.member) queue.push(m.member);
  }
  void drain();
}

async function onInbox(item: LinkInboxItem) {
  const member = /^train:([a-z][a-z0-9-]{1,31})$/.exec(item.text.trim())?.[1];
  if (member && TRAINEES.includes(member) && !queue.includes(member) && current !== member) {
    queue.push(member);
    void drain();
  }
}

if (import.meta.main) {
  console.log(`trainer: ${MINUTES} min per member per day, from ${START_HOUR}:00`);
  link.run({ onInbox });
  setTimeout(daily, 15_000);
  setInterval(daily, 5 * 60_000);
  const quit = async () => {
    await link.goodbye();
    process.exit(0);
  };
  process.on("SIGTERM", quit);
  process.on("SIGINT", quit);
}
