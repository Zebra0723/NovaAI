// Galaxy Link: ask the Galaxy anything and watch it reach the right member, in Galaxy Chat.

import { chatLine, esc, sleep, typing } from "../marks.js";

const SUGGESTIONS = [
  "Rename the screenshots on my desktop by date",
  "Build my tennis team a website",
  "Research the best 3D printers under $300",
  "Turn the volume down",
  "Empty the trash",
  "What should I focus on today?",
];

/** Who it goes to, and how that member talks it through. Plain keyword routing, like a first guess. */
function plan(ask) {
  const a = ask.toLowerCase();
  if (/website|app\b|research|report|plan (?:a|my)|build|mission|overnight/.test(a)) {
    return {
      to: "zenith",
      why: "a mission that takes hours",
      steps: [
        ["zenith", "On it. Goal: something finished and checked. I'll write the plan first, then build in checkpoints."],
        ["zenith", "Checkpoint 2 of 5 done. I'll only stop to ask if something costs money or goes public."],
      ],
      done: `Finished. ${/research|report/.test(a) ? "A ranked shortlist with sources and a one-paragraph answer up top" : "It's built, I ran it to check it works, and the summary has the preview link"}. Everything's in your Missions folder.`,
    };
  }
  if (/volume|mute|scroll|pause/.test(a)) {
    return {
      to: "nebula",
      why: "gestures",
      steps: [["nebula", "You can do that with your hand: turn an open palm like a knob for volume, or a fist to mute. Want me to switch on?"]],
      done: "Switched on. I'm watching for gestures until you turn me off with Fn+F1.",
    };
  }
  if (/trash|delete|remove/.test(a)) {
    return {
      to: "nova",
      why: "the screen, and it can't be undone",
      steps: [["nova", "The trash has 14.2 GB, including a folder called “Taxes 2025”. Emptying is permanent, so: empty all of it, or keep that folder?"]],
      ask: true,
      done: "Emptied, and I kept “Taxes 2025” on your Desktop. 14.1 GB free now.",
    };
  }
  if (/rename|screenshot|file|folder|download|open|click|desktop|screen/.test(a)) {
    return {
      to: "nova",
      why: "something on the Mac's screen",
      steps: [
        ["nova", "Plan: use Terminal to find every screenshot on your Desktop, rename it by its date, and move it into Screenshots/. Then I'll count them to check."],
        ["nova", "Moving 34 files… the 6 other files on your Desktop stay put."],
      ],
      done: "Done: 34 screenshots renamed (2026-10-21 … 2026-10-29) and in Desktop/Screenshots. I counted 34 there.",
    };
  }
  return {
    to: "orbit",
    why: "a quick answer, out loud",
    steps: [],
    done: "You've got three things today. The tennis site is the one with a deadline, so I'd start there.",
  };
}

export default {
  id: "link",
  label: "Galaxy Link",
  mount(stage) {
    stage.innerHTML = `<div class="trial">
      <div class="trial-side">
        <h3>Ask the <em>Galaxy</em></h3>
        <p>Type anything, or pick one below. Galaxy Link decides who's best for it, hands it over, and the member keeps you posted in Galaxy Chat. Anything permanent waits for your yes.</p>
        <div class="label">Try asking</div>
        <div class="chips">${SUGGESTIONS.map((s) => `<button class="chip" data-ask="${esc(s)}">${esc(s)}</button>`).join("")}</div>
        <p class="note">This preview routes by keywords. The real Link lets the members decide between themselves.</p>
      </div>
      <div class="window">
        <div class="window-bar"><i></i><i></i><i></i><span>Galaxy Chat</span></div>
        <div class="window-body">
          <div class="chat" id="link-chat"></div>
          <form class="composer" id="link-form"><input id="link-ask" placeholder="Ask the Galaxy anything…" autocomplete="off"><button class="btn btn-dark sm" type="submit">Send</button></form>
        </div>
      </div>
    </div>`;
    const chat = stage.querySelector("#link-chat");
    const input = stage.querySelector("#link-ask");
    let run = 0;
    const say = (el) => {
      chat.append(el);
      chat.scrollTop = chat.scrollHeight;
    };
    say(chatLine("link", "Hi! I'm Galaxy Link. Ask for anything and I'll get it to the right member.", { who: "Galaxy Link" }));

    const go = async (ask) => {
      if (!ask.trim()) return;
      const me = ++run;
      const live = () => me === run && stage.isConnected;
      for (const b of stage.querySelectorAll("[data-ask], #link-form button")) b.disabled = true;
      input.value = "";
      say(chatLine("you", esc(ask)));
      const p = plan(ask);
      await sleep(500);
      if (!live()) return;
      say(chatLine("link", `Handing this to <b>${p.to[0].toUpperCase() + p.to.slice(1)}</b>: ${esc(p.why)}.`, { cls: "sys" }));
      for (const [id, text] of p.steps) {
        await typing(chat, id, 1100);
        if (!live()) return;
        say(chatLine(id, esc(text)));
      }
      if (p.ask) {
        const choice = await new Promise((resolve) => {
          const el = chatLine("you", `<span style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-light xs" data-a="keep">Keep that folder</button><button class="btn btn-light xs" data-a="all">Empty all of it</button></span>`);
          say(el);
          el.addEventListener("click", (e) => {
            const b = e.target.closest("[data-a]");
            if (!b) return;
            el.querySelector(".bubble").textContent = b.textContent;
            resolve(b.dataset.a);
          });
        });
        if (!live()) return;
        if (choice === "all") p.done = "Emptied, all of it. 14.2 GB free now.";
      }
      await typing(chat, p.to, 1300);
      if (!live()) return;
      say(chatLine(p.to, esc(p.done)));
      for (const b of stage.querySelectorAll("[data-ask], #link-form button")) b.disabled = false;
    };

    stage.querySelector("#link-form").addEventListener("submit", (e) => {
      e.preventDefault();
      go(input.value);
    });
    stage.addEventListener("click", (e) => {
      const c = e.target.closest("[data-ask]");
      if (c) go(c.dataset.ask);
    });
    return () => run++;
  },
};
