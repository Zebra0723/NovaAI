// Medic: every member's vitals. Break something and watch Medic notice on its second look,
// restart what it can, and tell you (once, with the fix) about what it can't.

import { esc, MEMBERS } from "../marks.js";

const BEAT = `<svg class="beat" viewBox="0 0 120 30" preserveAspectRatio="none"><path d="M0 15 H40 L46 4 L52 26 L58 10 L62 15 H120" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
const IDS = ["link", "comet", "nova", "nebula", "zenith", "trainer", "orbit"];

export default {
  id: "medic",
  label: "Medic",
  mount(stage) {
    const state = Object.fromEntries(IDS.map((id) => [id, { health: id === "orbit" ? "off" : "ok", strikes: 0, why: "" }]));
    stage.innerHTML = `<div class="trial">
      <div class="trial-side">
        <h3>Medic, <em>on call</em></h3>
        <p>Medic checks every member once a minute (here, every two seconds). It waits for a second look before acting, restarts what stopped, reopens what crashed, and only bothers you about what it can't fix.</p>
        <div class="label">Break something</div>
        <div class="chips">
          <button class="chip" data-break="zenith">Crash Zenith</button>
          <button class="chip" data-break="nova">Quit Nova by accident</button>
          <button class="chip" data-break="link">Stop Galaxy Link</button>
          <button class="chip" data-break="trainer">Sign the Trainer out of Claude</button>
        </div>
        <p class="note">Orbit shows as off on purpose: it's quit most of the time, and Medic never starts it.</p>
      </div>
      <div class="window">
        <div class="window-bar"><i></i><i></i><i></i><span>Galaxy Medic</span></div>
        <div class="window-body"><div class="vitals" id="vitals"></div><ul class="medic-log" id="log"></ul></div>
      </div>
    </div>`;
    const vitals = stage.querySelector("#vitals");
    const log = stage.querySelector("#log");
    const say = (text, cls = "") => {
      const t = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
      log.insertAdjacentHTML("afterbegin", `<li class="${cls}"><time>${t}</time>${text}</li>`);
    };
    const LABEL = { ok: "Healthy", down: "Not answering", fixing: "Restarting", needs: "Needs you", off: "Quit (normal)" };
    const draw = () => {
      vitals.innerHTML = IDS.map((id) => {
        const s = state[id];
        const cls = s.health === "ok" ? "" : s.health === "fixing" ? "fixing" : s.health === "off" ? "off" : s.health === "needs" ? "down needs" : "down";
        return `<div class="vital ${cls}" style="--c:${MEMBERS[id].color === "#141413" ? "#57534c" : MEMBERS[id].color}"><div class="top"><b>${MEMBERS[id].name}</b><span class="hp" style="${s.health === "off" ? "color:var(--ink-3)" : ""}"><i></i>${LABEL[s.health]}</span></div>${s.health === "off" ? `<svg class="beat" viewBox="0 0 120 30"><path d="M0 15 H120" stroke="#e6e2da" stroke-width="2"/></svg>` : BEAT}${s.why ? `<div style="font-size:12px;color:var(--ink-2);margin-top:6px">${esc(s.why)}</div>` : ""}</div>`;
      }).join("");
    };
    draw();
    say("Checkup: everyone's well.");

    const tick = () => {
      for (const id of IDS) {
        const s = state[id];
        if (s.health === "down") {
          s.strikes++;
          if (s.strikes < 2) {
            say(`${MEMBERS[id].name} didn't answer. Looking again before doing anything.`);
            continue;
          }
          s.health = "fixing";
          say(`${MEMBERS[id].name} is down on the second look: ${id === "nova" ? "reopening it" : "restarting it"}.`);
        } else if (s.health === "fixing") {
          s.health = "ok";
          s.strikes = 0;
          s.why = "";
          say(`Fixed: ${MEMBERS[id].name} is back. ${id === "nova" ? "Reopened after the crash." : "Restarted."}`, "fix");
        }
      }
      draw();
    };
    const timer = setInterval(tick, 2000);

    stage.addEventListener("click", (e) => {
      const b = e.target.closest("[data-break]");
      if (!b) return;
      const id = b.dataset.break;
      const s = state[id];
      if (id === "trainer") {
        s.health = "needs";
        s.why = "To fix it: connect Claude again in Galaxy Link.";
        say("The Trainer can't reach Claude, so tonight's training won't run. A restart won't help, so Medic tells you once.", "warn");
      } else if (id === "nova" && b.textContent.includes("Quit")) {
        say("Nova was quit by you, not a crash. Medic leaves an app you quit alone.");
        state.nova.health = "off";
        state.nova.why = "You quit it. It stays quit.";
        setTimeout(() => {
          state.nova.health = "ok";
          state.nova.why = "";
          draw();
        }, 6000);
      } else {
        s.health = "down";
        s.strikes = 0;
      }
      draw();
    });
    return () => clearInterval(timer);
  },
};
