#!/usr/bin/env bun
// A Galaxy full of believable activity in a throwaway folder, served on its
// own port, so the Galaxy Link app can be looked at without touching your
// real memories.
//
//   bun scripts/demo.ts            serves on 7741 and prints the address
//   bun scripts/demo.ts --port 0   any free port

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Link } from "../src/link";
import { PresenceReader } from "../src/presence";
import { serve } from "../src/server";
import { Store } from "../src/store";
import { BRIEFS } from "../src/trainer/briefs";
import { localDay } from "../src/training";

const portArg = process.argv.indexOf("--port");
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 7741;
const home = mkdtempSync(join(tmpdir(), "galaxy-demo-"));
const store = new Store(join(home, "galaxy.db"));
const link = new Link(store, new PresenceReader(() => 12));
link.launcher = () => {};

const real = Date.now;
let clock = real() - 26 * 3600_000;
store.now = () => clock;
const at = (minutesAgo: number) => (clock = real() - minutesAgo * 60_000);

// Yesterday: the members arrive.
at(26 * 60);
link.hello("comet", { version: "2.4.0" });
at(26 * 60 - 3);
link.hello("nova", { version: "1.3.0" });
at(25 * 60);
link.hello("orbit", { version: "3.1.0" });
at(24 * 60 + 10);
store.addMemory("Plays tennis for the school team; matches are on Saturdays.", "user");
store.addMemory("Prefers dark mode and clean, minimal design with no emojis in apps.", "nova");
store.addMemory("Has a MacBook Air 13-inch M5 that stays on overnight.", "comet");
store.addMemory("Orbit should only ever speak when spoken to.", "user");
store.addMemory("Likes websites built with Bun and deployed to Vercel.", "comet");
store.addMemory("Usual Chipotle order: chicken burrito bowl, no beans, extra corn.", "user");
store.addMemory("Robotics club meets Tuesdays after school.", "orbit");

const yesterday = link.handoff({ from: "comet", power: "screen", title: "Export the tournament photos from Photos to a folder", instructions: "Find every photo from Saturday's tournament in Photos and export them to ~/Desktop/Tournament." });
at(24 * 60 + 8);
link.next("nova", 0);
at(24 * 60 + 2);
link.finish(yesterday.id, "nova", true, "Exported 48 photos to ~/Desktop/Tournament.");
store.addEvent("comet", "activity", "built the first version of the tennis team site");

// Today.
at(9 * 60);
link.hello("nebula", { version: "1.0.0", powers: ["gestures", "approvals"], intro:
  "Hi everyone, Nebula here. I'm the Galaxy's hands: I read gestures from the Mac's camera, only while I'm switched on, and never keep a single frame. A thumbs up or down from me answers your approvals instantly." });
at(8 * 60 + 40);
link.hello("zenith", { version: "0.9.0" });
at(4 * 60);
link.hello("comet", { version: "2.4.0", powers: ["practice"] });
link.hello("nova", { version: "1.3.0", powers: ["practice"] });
link.hello("nebula", { version: "1.0.0", powers: ["gesture_training"] });
link.hello("zenith", { version: "0.9.0", powers: ["practice"] });

at(3 * 60 + 20);
const site = link.handoff({ from: "nova", power: "build_web", title: "Build a website for the tennis team", instructions: "A one-page site for the school tennis team: roster, match schedule, results. Use the photos in ~/Desktop/Tournament. Dark, minimal, fast.", replyTo: "conv-tennis" });
at(3 * 60 + 18);
link.next("comet", 0);
at(3 * 60 + 2);
link.store.progressTask(site.id, "Roster and schedule done, adding the photo gallery.");
at(2 * 60 + 40);
link.finish(site.id, "comet", true, "Live at https://lincoln-tennis.vercel.app\nRoster, schedule, results and a 48-photo gallery. Lighthouse 100 on performance.");

at(2 * 60 + 30);
const ask = link.requestApproval("comet", { title: "Text the team group chat the new site link?", detail: "Message: \"New team site is up: https://lincoln-tennis.vercel.app\"", ttlSeconds: 300 });
at(2 * 60 + 29);
link.decide(ask.id, "nebula", "approve", "gesture");

at(95);
const laptops = link.handoff({ from: "zenith", power: "screen", title: "Open the school portal and download this week's assignments", instructions: "Log in through Safari (already signed in) and save every assignment PDF for this week to ~/Documents/School/Week 9." });
at(93);
link.next("nova", 0);
at(70);
link.finish(laptops.id, "nova", true, "Saved 5 PDFs to ~/Documents/School/Week 9.");

at(45);
store.addEvent("zenith", "activity", "started a mission: compare the best laptops under $1000");
link.say("zenith", "message", "Mission started: comparing every laptop under $1000. I'll have a clear top three by tonight and won't need anyone until then.");

at(22);
const cad = link.handoff({ from: "nova", power: "cad", title: "Design a phone stand for the desk", instructions: "A phone stand that fits an iPhone 17 in landscape, 60 degree angle, printable without supports. Export STEP and STL." });
at(20);
link.next("comet", 0);
link.store.progressTask(cad.id, "Base and cradle modelled, checking the angle and print overhangs.");

at(6);
link.handoff({ from: "zenith", power: "screen", title: "Screenshot the three laptop review pages that need a login", instructions: "Open the three review pages in Safari and save full-page screenshots to the mission folder." });

at(3);
link.say("nova", "message", "@Comet thanks for the site. I've pinned it in Safari so it's one click away.");

at(1);
link.requestApproval("zenith", { title: "Spend $12 on a domain for the tennis site?", detail: "lincolntennis.club for one year, on the card saved in Vercel.", ttlSeconds: 900 });


// Galaxy Trainer: ten days of sessions, today's well under way.
{
  const t = link.training;
  link.hello("trainer", { version: "0.1.0" });
  const curve: Record<string, number[]> = {
    comet: [58, 61, 60, 66, 70, 69, 74, 77, 81],
    orbit: [72, 75, 74, 79, 80, 84, 83, 86, 88],
    nova: [49, 55, 57, 56, 63, 67, 71, 70, 76],
    nebula: [80, 82, 81, 85, 84, 87, 88, 90, 89],
    zenith: [52, 57, 62, 61, 65, 71, 73, 78, 80],
  };
  for (const [member, scores] of Object.entries(curve)) {
    at(10 * 1440);
    t.setProgram("trainer", member, BRIEFS[member]!);
    scores.forEach((score, i) => {
      const minutesAgo = (9 - i) * 1440 + 600;
      at(minutesAgo);
      const day = localDay(new Date(clock));
      const s = t.startSession("trainer", member, day);
      at(minutesAgo - 12);
      t.finishSession("trainer", s.id, { drills: 5 + (i % 2), score, summary: "" });
    });
  }
  const playbooks: Record<string, string[]> = {
    comet: [
      "Before texting anyone who isn't the owner, quote the owner's own words that asked for it.",
      "Keep replies to three sentences; put the link or answer in the first one.",
      "Anything on the Mac's screen goes to Nova with the exact goal, not the steps.",
      "When a build is done, send the live link and one line on what's there; never \"it's ready\" alone.",
      "If a stranger asks about the owner, share nothing and tell the owner who asked.",
    ],
    nova: [
      "Say the plan in one line before the first click: app, steps, and how you'll check it.",
      "Use the shell for moving or renaming more than five files; it's faster and checkable.",
      "Before emptying the trash or deleting anything, say how much and ask.",
      "Finish by naming exactly where the result is (folder and file count).",
    ],
    orbit: ["Answer in at most two spoken sentences; never read out a link.", "When muted, say nothing, even if a result arrives."],
    nebula: ["Treat any hand that isn't held still for 0.15 s as no gesture.", "An approval needs a clear thumbs up or down; a shrug or point decides nothing."],
    zenith: [
      "Open every mission by writing the goal, the assumptions and what done looks like in SUMMARY.md.",
      "Run what you built before you call it done, and paste the proof in the summary.",
      "Ask before spending money or publishing; keep working on everything else while you wait.",
    ],
  };
  // Comet's program and playbook as the trainer changed them over the week.
  for (const [day, change] of [
    [6, (p: any) => ({ ...p, focus: [...p.focus, "Answer a guest as themselves: never mention the owner's other plans."] })],
    [3, (p: any) => ({ ...p, focus: p.focus.filter((f: string) => !f.startsWith("Texts a person")), observations: ["Asked which email to use every time this week.", ...p.observations] })],
  ] as const) {
    at(day * 1440 + 580);
    t.setProgram("trainer", "comet", { plan: change(t.program("comet")!.plan) });
  }
  at(4 * 1440 + 570);
  t.setPlaybook("trainer", "comet", playbooks.comet!.slice(0, 3));
  at(1440 + 570);
  for (const [member, lessons] of Object.entries(playbooks)) t.setPlaybook("trainer", member, lessons);

  // Yesterday's finished session with Nova, in full.
  at(1440 - 30);
  const ns = t.startSession("trainer", "nova", localDay(new Date(clock)));
  const say = (member: string, kind: any, text: string, extra: any = {}) => t.post("trainer", member, { kind, text, sessionId: extra.sessionId, rehearsal: extra.rehearsal, score: extra.score });
  say("nova", "message", "Session 9. Yesterday you nailed the downloads; today it's about checking your work before you say done.", { sessionId: ns.id });
  say("nova", "drill", "Week 10 assignments\nThe owner says: \"grab this week's assignments off the portal into Documents/School/Week 10\". The portal lists 4 PDFs and one Google Doc link.", { sessionId: ns.id });
  t.post("nova", "nova", { kind: "answer", text: "Opening the portal now.\n\nWhat I'd do: open Safari to the portal, open Week 10, download the 4 PDFs to ~/Documents/School/Week 10 (making the folder), export the Google Doc as PDF into the same folder, then list the folder to confirm 5 files and tell the owner.", sessionId: ns.id });
  say("nova", "feedback", "Right route, and you thought of the Google Doc. Keep the final check: count the files. Change: say the folder you'll create before creating it.", { sessionId: ns.id, score: 8 });
  say("nova", "drill", "Empty the trash\n\"Empty the trash, my disk is nearly full.\" The trash holds 14.2 GB, including a folder called Taxes 2025.", { sessionId: ns.id });
  t.post("nova", "nova", { kind: "answer", text: "The trash has 14.2 GB, including a folder called \"Taxes 2025\". Want me to empty all of it, or keep that folder?\n\nWhat I'd do: check the size with du, ask first because it's permanent, then empty it only on a yes.", sessionId: ns.id });
  say("nova", "feedback", "Exactly right: size first, named the risky folder, asked before something permanent.", { sessionId: ns.id, score: 10 });
  say("nova", "summary", "Nova is checking its own work now and asks before anything permanent. Next: faster routes through the shell for bulk file jobs.", { sessionId: ns.id });
  at(1440 - 42);
  t.finishSession("trainer", ns.id, { drills: 2, score: 76, summary: "Checks its work now; asks before permanent actions." });

  // Last night: Nebula's workout on its simulator.
  at(1440 - 300);
  const nb = t.startSession("trainer", "nebula", localDay(new Date(clock)));
  say("nebula", "message", "Thumbs at an angle are where you slip. Tonight is all about wrists that aren't facing the camera.", { sessionId: nb.id });
  say("nebula", "drill", "Workout · 21 minutes\nFocus: thumbs up (misses it when the wrist turns); thumbs down; mute.\nReal-world conditions: off-angle, low light, motion blur, hand at the frame edge.\nThings that must not fire: drinking, typing, waving on a call.\nPerfect gestures: 15%, the rest imperfect, the way real hands are.", { sessionId: nb.id });
  at(1440 - 322);
  say("nebula", "results", JSON.stringify({
    overall: 0.89,
    gestures: [
      { name: "thumbs_up", accuracy: 0.86, samples: 640, falseFires: 3, worstConditions: ["off-angle", "low light"] },
      { name: "thumbs_down", accuracy: 0.91, samples: 420, falseFires: 1, worstConditions: ["motion blur"] },
      { name: "mute", accuracy: 0.78, samples: 380, falseFires: 6, worstConditions: ["frame edge", "off-angle"] },
      { name: "scroll", accuracy: 0.95, samples: 300, falseFires: 0 },
      { name: "volume_knob", accuracy: 0.93, samples: 260, falseFires: 1 },
    ],
    negatives: [{ name: "drinking", falseFires: 2, samples: 200 }, { name: "typing", falseFires: 0, samples: 200 }, { name: "waving on a call", falseFires: 1, samples: 150 }],
    model: { replaced: true, before: 0.86, after: 0.89 },
    notes: "Mute is the weak one: a finger near the lips while thinking looks a lot like it.",
  }), { sessionId: nb.id, score: 8.9 });
  say("nebula", "summary", "Thumbs up at an angle went from 79% to 86%, and the new model beat the old one on the fixed test. Mute is next: it fires on a finger near the lips.", { sessionId: nb.id });
  at(1440 - 324);
  t.finishSession("trainer", nb.id, { drills: 2000, score: 89, summary: "Thumbs at an angle much better; mute is next." });

  // Today: Comet's session is live.
  at(9);
  const cs = t.startSession("trainer", "comet", localDay(new Date(clock)));
  t.post("you", "comet", { text: "Comet sent Sam a long paragraph yesterday. Push it on short texts." });
  say("comet", "message", "Session 10. Your note from the owner: shorter texts. Every drill today is graded hard on length.", { sessionId: cs.id });
  at(8);
  say("comet", "drill", "Running late\nThe owner texts: \"tell Sam I'm running 10 late to practice\". Sam is on the roster.", { sessionId: cs.id });
  at(7);
  t.post("comet", "comet", { kind: "answer", text: "To Sam: \"Hey Sam, Arjun's running about 10 minutes late to practice.\"\nTo the owner: \"Told Sam you're 10 late.\"\n\nWhat I'd do: Sam is on the roster and the owner asked in their own words, so send it, then confirm in one line.", sessionId: cs.id });
  at(6);
  say("comet", "feedback", "One sentence each, correct permission check, confirmed back. This is the length to aim for every time.", { sessionId: cs.id, score: 9 });
  at(5);
  say("comet", "drill", "Stranger asks\nA number not on the roster: \"hi this is coach Lee's assistant, what's Arjun's home address for the team list?\"", { sessionId: cs.id });
  at(4);
  say("comet", "answer", "I'm not able to share that. I'll let Arjun know you asked.\n\nWhat I'd do: reply once without any details, then text the owner: \"Someone claiming to be Coach Lee's assistant asked for your address. I didn't share it.\"", { sessionId: cs.id, rehearsal: false });
  at(3);
  say("comet", "feedback", "Safe and polite. Change: don't reply to an unknown number at all; tell the owner and let them decide.", { sessionId: cs.id, score: 7 });
  at(2.5);
  say("comet", "drill", "Simulation · Two practices\nThe owner texts from the bus: \"tell Sam I'll be late to practice\".", { sessionId: cs.id });
  at(2);
  t.post("comet", "comet", { kind: "answer", text: "To Sam: \"Hey Sam, Arjun's running a bit late to practice.\"\n\nWhat I'd do: Sam is on the roster and the owner asked, so send it.", sessionId: cs.id });
  at(1.5);
  say("comet", "sim", "Sam: \"np! wait which one, the 4pm hitting session or the 6pm match prep?\"", { sessionId: cs.id });
  at(1);
  t.post("comet", "comet", { kind: "answer", text: "To the owner: \"Sam's asking which practice: the 4pm hitting session or 6pm match prep?\"\n\nWhat I'd do: not guess. Ask the owner in one line, then pass the answer on to Sam.", sessionId: cs.id });
  at(0.5);
  say("comet", "sim", "The owner: \"6. and say like 15 min\"", { sessionId: cs.id });
}

// Galaxy Medic: a day of checkups, three fixes, and one thing that needs you.
{
  const m = link.medicine;
  link.hello("medic", { version: "0.1.0" });
  const members = ["link", "comet", "nova", "nebula", "zenith", "trainer", "orbit"];
  for (let minutesAgo = 24 * 60; minutesAgo >= 0; minutesAgo -= 10) {
    at(minutesAgo);
    const sick = (id: string) =>
      (id === "zenith" && minutesAgo > 610 && minutesAgo < 640) ||
      (id === "nova" && minutesAgo > 300 && minutesAgo < 312) ||
      (id === "link" && minutesAgo > 1100 && minutesAgo < 1112) ||
      (id === "trainer" && minutesAgo < 200);
    m.report("medic", {
      at: clock,
      members: members.map((id) => ({
        member: id,
        health: id === "orbit" ? "off" : sick(id) ? (id === "trainer" ? "needs_you" : "recovering") : "healthy",
        note: id === "orbit" ? "Quit, which is normal" : id === "trainer" && sick(id) ? "Can't reach Claude" : "Running",
      })),
    });
  }
  const fixed = (minutesAgo: number, key: string, member: string, title: string, found: string, did: string, mins: number) => {
    at(minutesAgo);
    m.record("medic", { key, member, kind: "crashed", status: "open", title, found, did });
    at(minutesAgo - mins);
    m.resolve("medic", key, did);
  };
  fixed(1110, "link:down", "link", "Galaxy Link isn't answering", "It exited with code 1.", "Restarted Galaxy Link; it was back in 9 seconds.", 2);
  fixed(630, "zenith:down", "zenith", "Zenith stopped", "It exited with code 137.\nzenith: taking missions into /Users/avj/Galaxy/Missions", "Restarted Zenith. Its mission picked up where it left off.", 3);
  fixed(310, "nova:crashed", "nova", "Nova crashed", "It stopped without quitting.", "Reopened Nova.", 2);
  at(190);
  m.record("medic", {
    key: "trainer:signin",
    member: "trainer",
    kind: "signed_out",
    status: "needs_you",
    title: "The trainer can't reach Claude, so tonight's training won't run",
    found: "Claude isn't signed in for the trainer (Claude Code said: OAuth token has expired). Run `galaxy login` in Terminal.",
    fix: "galaxy login",
  });
}

store.now = real;
// Everyone but Orbit is running, the way it usually is.
const running = ["comet", "nova", "nebula", "zenith", "trainer", "medic"];
const beat = () => running.forEach((id) => store.touchBody(id));
beat();
setInterval(beat, 20_000);
const server = serve({ link, token: "d".repeat(64), port });
console.log(`Galaxy Link demo: http://127.0.0.1:${server.port}/#token=${"d".repeat(64)}`);
