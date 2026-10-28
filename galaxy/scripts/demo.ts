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
link.hello("comet", { version: "2.4.0" });
link.hello("nova", { version: "1.3.0" });
link.hello("nebula", { version: "1.0.0" });
link.hello("zenith", { version: "0.9.0" });

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

store.now = real;
// Everyone but Orbit is running, the way it usually is.
const running = ["comet", "nova", "nebula", "zenith"];
const beat = () => running.forEach((id) => store.touchBody(id));
beat();
setInterval(beat, 20_000);
const server = serve({ link, token: "d".repeat(64), port });
console.log(`Galaxy Link demo: http://127.0.0.1:${server.port}/#token=${"d".repeat(64)}`);
