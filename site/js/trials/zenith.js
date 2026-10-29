// Zenith: start a mission and watch hours of work go by in seconds: the plan, the
// checkpoints, the one question it asks (money), and the summary it hands back.

import { esc, sleep } from "../marks.js";

const MISSIONS = {
  site: {
    label: "Build my tennis team a website",
    hours: 3.5,
    steps: [
      ["Scope it", "Goal: a simple site the team can share. Assumed: 4 pages, roster as placeholders until you send names."],
      ["Build the pages", "Home, Schedule, Roster, Photos. Plain HTML so it's fast and free to host."],
      ["Run it and check", "Opened every page, fixed one broken link, checked it on a phone-sized screen."],
      ["Domain?", "ASK"],
      ["Publish and summarise", "Deployed the preview and wrote SUMMARY.md."],
    ],
    ask: "Buy riverside-tennis.club for $12/year?",
    summary: (yes) => `# Riverside Tennis website
**Done.** 4 pages, checked on desktop and phone.

Preview: https://riverside-tennis.vercel.app
Domain: ${yes ? "riverside-tennis.club (bought, $12/yr, connecting now)" : "none yet (you said no; easy to add later)"}

## What's there
- Home with the season's next match
- Schedule (from the PDF you had)
- Roster: placeholders, send me names
- Photos: empty album, ready to fill

## What I assumed
- Team colours: green and white
- No sign-in needed`,
  },
  research: {
    label: "Research 3D printers under $300",
    hours: 2,
    steps: [
      ["Criteria first", "Under $300, beginner friendly, good support, prints PLA well, fits on a desk."],
      ["Gather sources", "11 reviews and 3 forums read. Ignored anything sponsored."],
      ["Compare", "Shortlisted 4 and checked current prices."],
      ["Write it up", "One-paragraph answer first, then the table and the why."],
    ],
    summary: () => `# 3D printers under $300
**Answer:** get the Bambu Lab A1 mini ($249). It's the easiest to live with, has the best support, and prints PLA beautifully out of the box.

| Printer | Price | Why |
|---|---|---|
| Bambu A1 mini | $249 | Easiest, fastest setup |
| Prusa MINI+ kit | $299 | Built to last, you assemble it |
| Creality K1C | $299 | Bigger, a bit louder |
| Elegoo Neptune 4 | $219 | Cheapest, more tinkering |

Sources: 11 reviews, linked in SOURCES.md.`,
  },
  app: {
    label: "Make a flashcard study app",
    hours: 5,
    steps: [
      ["Scope it", "Flashcards, decks, a progress tracker. Runs in the browser, saves on your Mac."],
      ["Build the core", "Decks and cards, with flip and keyboard shortcuts."],
      ["Spaced repetition", "Cards you miss come back sooner."],
      ["Test it", "Wrote 24 checks and ran them. All pass."],
      ["Summarise", "How to open it, and what's next."],
    ],
    summary: () => `# Study app
**Done.** Open study-app/index.html in Safari.

- Make decks, add cards, flip with space
- Missed cards come back sooner
- A progress chart per deck
- 24 automatic checks, all passing

Next, if you want it: import from Quizlet, and sync to your phone.`,
  },
};

export default {
  id: "zenith",
  label: "Zenith",
  mount(stage) {
    stage.innerHTML = `<div class="trial">
      <div class="trial-side">
        <h3>Zenith, <em>for the long haul</em></h3>
        <p>Missions that would take hours run here in about twenty seconds. Zenith scopes the job, works through checkpoints on its own, checks its own work, and asks you only when money or anything public is involved.</p>
        <div class="label">Start a mission</div>
        <div class="chips">${Object.entries(MISSIONS).map(([k, m]) => `<button class="chip" data-m="${k}">${esc(m.label)}</button>`).join("")}</div>
        <p class="note">On your Mac, each mission gets its own walled-off folder, and you can leave it running overnight.</p>
      </div>
      <div class="window">
        <div class="window-bar"><i></i><i></i><i></i><span>Zenith · Missions</span></div>
        <div class="window-body">
          <div class="mission" id="mission">
            <div><div class="clock" id="z-clock">Ready<small>Pick a mission</small></div><div class="progress"><i id="z-bar"></i></div><ol class="checkpoints" id="z-steps"></ol><div id="z-ask"></div></div>
            <div><div class="summary" id="z-summary">SUMMARY.md appears here when the mission is done.</div></div>
          </div>
        </div>
      </div>
    </div>`;
    let run = 0;
    const $ = (s) => stage.querySelector(s);

    const go = async (key) => {
      const me = ++run;
      const live = () => me === run && stage.isConnected;
      const m = MISSIONS[key];
      for (const c of stage.querySelectorAll("[data-m]")) c.classList.toggle("on", c.dataset.m === key);
      $("#z-ask").innerHTML = "";
      $("#z-summary").textContent = "Working…";
      $("#z-steps").innerHTML = m.steps.map(([t]) => `<li><span class="dot"></span><span>${esc(t)}<small></small></span></li>`).join("");
      const items = [...$("#z-steps").children];
      let yes = false;
      for (let i = 0; i < m.steps.length; i++) {
        const [, detail] = m.steps[i];
        items[i].className = "now";
        const hours = (m.hours * (i + 1)) / m.steps.length;
        $("#z-clock").innerHTML = `${Math.floor(hours)}h ${String(Math.round((hours % 1) * 60)).padStart(2, "0")}m<small>Mission time · step ${i + 1} of ${m.steps.length}</small>`;
        if (detail === "ASK") {
          $("#z-ask").innerHTML = `<div class="ask-card"><b>Zenith is asking you</b><br>${esc(m.ask)}<div class="row"><button class="btn btn-dark xs" data-a="yes">Yes, buy it</button><button class="btn btn-line xs" data-a="no">Not now</button></div></div>`;
          yes = await new Promise((r) => $("#z-ask").addEventListener("click", (e) => e.target.closest("[data-a]") && r(e.target.closest("[data-a]").dataset.a === "yes")));
          if (!live()) return;
          $("#z-ask").innerHTML = `<div class="ask-card" style="background:#f1f8f3;border-color:#bbe5c8">${yes ? "Approved. Buying it now." : "Okay, no domain for now."}</div>`;
          items[i].querySelector("small").textContent = yes ? "You said yes: bought it." : "You said no: skipped it.";
        } else {
          await sleep(2600);
          if (!live()) return;
          items[i].querySelector("small").textContent = detail;
        }
        items[i].className = "done";
        $("#z-bar").style.width = `${((i + 1) / m.steps.length) * 100}%`;
      }
      $("#z-clock").innerHTML = `Done<small>${m.hours} hours of work · you checked in once</small>`;
      $("#z-summary").innerHTML = esc(m.summary(yes)).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/^# (.+)$/m, "<b>$1</b>");
    };

    stage.addEventListener("click", (e) => {
      const c = e.target.closest("[data-m]");
      if (c) go(c.dataset.m);
    });
    return () => run++;
  },
};
