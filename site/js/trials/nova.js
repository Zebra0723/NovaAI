// Nova: a pretend Mac desktop. Pick a job and watch Nova plan it, do it and check it,
// and ask before the one that can't be undone.

import { esc, glyph, sleep } from "../marks.js";

const CURSOR = `<svg class="cursor" viewBox="0 0 24 24"><path d="M4 2.5 19.5 12l-7 1.4-3.6 6.6z" fill="#141413" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

const START = [
  { id: "s1", name: "Screenshot 10.21 at 9.14", pic: "🖼️", x: 6, y: 8 },
  { id: "s2", name: "Screenshot 10.24 at 4.02", pic: "🖼️", x: 6, y: 30 },
  { id: "s3", name: "Screenshot 10.27 at 11.40", pic: "🖼️", x: 6, y: 52 },
  { id: "s4", name: "Screenshot 10.29 at 8.03", pic: "🖼️", x: 20, y: 8 },
  { id: "d1", name: "Essay draft.docx", pic: "📄", x: 20, y: 30 },
  { id: "d2", name: "Week 9 notes.pdf", pic: "📕", x: 20, y: 52 },
  { id: "trash", name: "Trash · 14.2 GB", pic: "🗑️", x: 88, y: 64 },
];

const JOBS = {
  tidy: {
    label: "Tidy my screenshots",
    ask: "Put the screenshots on my desktop in a folder, renamed by date.",
    plan: ["Find every screenshot on the Desktop (Terminal: ls)", "Make a Screenshots folder", "Rename each by its date and move it in", "Count what's there to check", "Leave every other file alone"],
  },
  school: {
    label: "Download this week's work",
    ask: "Grab this week's assignments into Documents/School/Week 10.",
    plan: ["Open the school portal in Safari", "Make Documents/School/Week 10", "Download the 4 PDFs and export the Google Doc", "Check there are 5 files", "Tell you where they are"],
  },
  trash: {
    label: "Empty the trash",
    ask: "Empty the trash, my disk is nearly full.",
    plan: ["Check what's in the trash and how big it is", "Ask first: emptying can't be undone", "Empty it the way you said", "Check the space freed"],
  },
};

export default {
  id: "nova",
  label: "Nova",
  mount(stage) {
    stage.innerHTML = `<div class="trial">
      <div class="trial-side">
        <h3>Nova, <em>on your screen</em></h3>
        <p>Give Nova a job on your Mac. It says its plan first, takes the dependable route (Terminal over fiddly clicking when it can), checks the result before saying it's done, and asks before anything permanent.</p>
        <div class="label">Pick a job</div>
        <div class="chips">${Object.entries(JOBS).map(([k, j]) => `<button class="chip" data-job="${k}">${esc(j.label)}</button>`).join("")}</div>
        <div class="label">Then</div>
        <button class="chip" data-reset>Put the desktop back</button>
        <p class="note">In real life you press ⌃Space and say or type the job.</p>
      </div>
      <div class="window">
        <div class="window-bar"><i></i><i></i><i></i><span>Desktop</span></div>
        <div class="window-body"><div class="desk" id="desk"></div></div>
      </div>
    </div>`;
    const desk = stage.querySelector("#desk");
    let run = 0;
    let busy = false;

    const reset = () => {
      run++;
      busy = false;
      desk.innerHTML =
        START.map((f) => `<div class="icon" data-f="${f.id}" style="left:${f.x}%;top:${f.y}%"><span class="pic">${f.pic}</span>${esc(f.name)}</div>`).join("") + CURSOR;
      for (const b of stage.querySelectorAll("[data-job]")) b.disabled = false;
    };
    reset();

    const cursorTo = async (xPct, yPct, live) => {
      const c = desk.querySelector(".cursor");
      c.style.left = `calc(${xPct}% + 26px)`;
      c.style.top = `calc(${yPct}% + 24px)`;
      await sleep(850);
      return live();
    };

    const panel = (job) => {
      const el = document.createElement("div");
      el.className = "nova-panel";
      el.innerHTML = `<div class="head">${glyph("nova")}Nova</div><div style="font-size:13px;color:var(--ink-2);margin-top:4px">“${esc(job.ask)}”</div><ol class="steps">${job.plan.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`;
      desk.append(el);
      return el;
    };
    const step = (el, i) => [...el.querySelectorAll("li")].forEach((li, j) => (li.className = j < i ? "done" : j === i ? "now" : ""));
    const icon = (id) => desk.querySelector(`[data-f="${id}"]`);

    const go = async (key) => {
      if (busy) return;
      busy = true;
      const me = ++run;
      const live = () => me === run && stage.isConnected;
      for (const b of stage.querySelectorAll("[data-job]")) b.disabled = true;
      const job = JOBS[key];
      const p = panel(job);
      step(p, 0);
      await sleep(1200);
      if (!live()) return;

      if (key === "tidy") {
        if (!(await cursorTo(6, 8, live))) return;
        step(p, 1);
        const folder = document.createElement("div");
        folder.className = "icon folder";
        folder.style.cssText = "left:46%;top:14%";
        folder.innerHTML = `<span class="pic">📁</span>Screenshots`;
        desk.append(folder);
        await sleep(700);
        if (!live()) return;
        step(p, 2);
        for (const id of ["s1", "s2", "s3", "s4"]) {
          const el = icon(id);
          if (!(await cursorTo(parseFloat(el.style.left), parseFloat(el.style.top), live))) return;
          el.style.left = "46%";
          el.style.top = "14%";
          el.classList.add("gone");
          if (!(await cursorTo(46, 14, live))) return;
        }
        folder.innerHTML = `<span class="pic">📁</span>Screenshots · 4`;
        step(p, 3);
        await sleep(900);
        if (!live()) return;
        step(p, 4);
        await sleep(700);
        if (!live()) return;
        step(p, 5);
        p.insertAdjacentHTML("beforeend", `<p style="margin:8px 0 0;font-size:13.5px"><b>Done.</b> 4 screenshots renamed by date (2026-10-21 … 2026-10-29) and in Desktop/Screenshots. I counted 4 there. Your essay and notes didn't move.</p>`);
      } else if (key === "school") {
        if (!(await cursorTo(50, 4, live))) return;
        step(p, 1);
        const folder = document.createElement("div");
        folder.className = "icon folder";
        folder.style.cssText = "left:60%;top:30%";
        folder.innerHTML = `<span class="pic">📁</span>Week 10`;
        desk.append(folder);
        await sleep(800);
        if (!live()) return;
        step(p, 2);
        for (let i = 1; i <= 5; i++) {
          if (!(await cursorTo(60, 30, live))) return;
          folder.innerHTML = `<span class="pic">📁</span>Week 10 · ${i}`;
          await sleep(250);
        }
        step(p, 3);
        await sleep(900);
        if (!live()) return;
        step(p, 4);
        await sleep(600);
        if (!live()) return;
        step(p, 5);
        p.insertAdjacentHTML("beforeend", `<p style="margin:8px 0 0;font-size:13.5px"><b>Done.</b> 5 files in Documents/School/Week 10: four PDFs and the Google Doc, saved as a PDF.</p>`);
      } else {
        if (!(await cursorTo(88, 64, live))) return;
        step(p, 1);
        const d = document.createElement("div");
        d.className = "dialog";
        d.innerHTML = `<b>Nova is asking first</b><p>The trash has 14.2 GB, including a folder called “Taxes 2025”. Emptying it can't be undone. What should I do?</p><div class="row"><button class="btn btn-line xs" data-t="keep">Keep “Taxes 2025”</button><button class="btn btn-dark xs" data-t="all">Empty all</button></div>`;
        desk.append(d);
        const choice = await new Promise((r) => d.addEventListener("click", (e) => e.target.closest("[data-t]") && r(e.target.closest("[data-t]").dataset.t)));
        d.remove();
        if (!live()) return;
        step(p, 2);
        await sleep(1000);
        if (!live()) return;
        icon("trash").innerHTML = `<span class="pic">🗑️</span>Trash · ${choice === "keep" ? "0.1 GB" : "empty"}`;
        if (choice === "keep") {
          const t = document.createElement("div");
          t.className = "icon";
          t.style.cssText = "left:72%;top:64%";
          t.innerHTML = `<span class="pic">📁</span>Taxes 2025`;
          desk.append(t);
        }
        step(p, 3);
        await sleep(800);
        if (!live()) return;
        step(p, 4);
        p.insertAdjacentHTML("beforeend", `<p style="margin:8px 0 0;font-size:13.5px"><b>Done.</b> ${choice === "keep" ? "Emptied the rest and put “Taxes 2025” on your Desktop. 14.1 GB free." : "Emptied all of it. 14.2 GB free."}</p>`);
      }
      busy = false;
    };

    stage.addEventListener("click", (e) => {
      const j = e.target.closest("[data-job]");
      if (j) go(j.dataset.job);
      if (e.target.closest("[data-reset]")) reset();
    });
    return () => run++;
  },
};
