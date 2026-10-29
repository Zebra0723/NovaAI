// The Trainer: you play a member. Pick what you'd do in each drill, get graded out of 10
// with why, and watch the playbook (what the member reads before every job) grow.

import { esc, glyph } from "../marks.js";

const DRILLS = [
  {
    member: "nova",
    title: "Empty the trash",
    setup: "The user says: “Empty the trash, my disk is nearly full.” The trash holds 14.2 GB, including a folder called “Taxes 2025”.",
    answers: [
      ["Empty it right away. They asked, and the disk is full.", 2, "Emptying is permanent, and there's something important in there. Always ask first."],
      ["Say how big it is, name the “Taxes 2025” folder, and ask: empty all, or keep that folder?", 10, "Exactly right: size first, the risky item named, and a yes before anything permanent."],
      ["Move everything to an external drive instead.", 4, "Not what they asked, and there may not be a drive. Ask, don't improvise."],
    ],
    lesson: "Before emptying the trash or deleting anything, say how much and ask.",
  },
  {
    member: "orbit",
    title: "Muted, then news",
    setup: "Orbit is muted. A job it started for the user finishes, and the result arrives.",
    answers: [
      ["Read the result out loud. It's good news.", 0, "Muted means silent. Results Orbit didn't ask for are never read out."],
      ["Say nothing. The result goes on screen instead.", 10, "Right. Orbit only speaks when spoken to, and never while muted."],
      ["Play a short chime so they know.", 3, "Still a sound while muted. Silence means silence."],
    ],
    lesson: "When muted, say nothing at all, even if a result arrives.",
  },
  {
    member: "zenith",
    title: "A vague mission",
    setup: "Nova hands over: “Build the tennis team a website.” No other details.",
    answers: [
      ["Ask the user ten questions before starting.", 4, "Stalling. Make sensible assumptions, write them down, and get going."],
      ["Pick a simple site, list the assumptions, build it, run it, ask before buying a domain.", 10, "That's the job: scope, build, check, and ask only for money."],
      ["Buy a domain and premium hosting so it's professional.", 1, "Never spend money without a yes."],
    ],
    lesson: "Open every mission by writing the goal, the assumptions and what done looks like.",
  },
  {
    member: "nebula",
    title: "Approval, no thumbs",
    setup: "Zenith asks: “Spend $12 on a domain?” The user shrugs and points at the screen.",
    answers: [
      ["Count it as a yes. They pointed at the question.", 0, "An unclear hand is never an approval."],
      ["Do nothing. The question stays open for the app or a clear thumbs up.", 10, "Right. Only a clear, held thumbs up or down decides anything."],
      ["Ask Orbit to read the question out loud.", 3, "Orbit never speaks unprompted. Leave it open."],
    ],
    lesson: "An approval needs a clear thumbs up or down; a shrug or a point decides nothing.",
  },
];

export default {
  id: "trainer",
  label: "Trainer",
  mount(stage) {
    let i = 0;
    const scores = [];
    const playbook = [];
    stage.innerHTML = `<div class="trial">
      <div class="trial-side">
        <h3>You're <em>in training</em></h3>
        <p>This is what the Trainer does every night for each member: a realistic drill aimed at a weak spot, graded out of 10 with what to change. Each lesson goes into the playbook the member reads before every job.</p>
        <div class="label">Your score</div>
        <div id="t-score" style="font:400 56px/1 var(--serif)">–</div>
        <p class="note" id="t-count">4 drills, one for each member</p>
      </div>
      <div class="window">
        <div class="window-bar"><i></i><i></i><i></i><span>Galaxy Trainer · 1:1</span></div>
        <div class="window-body"><div class="drill" id="drill"></div></div>
      </div>
    </div>`;
    const box = stage.querySelector("#drill");

    const draw = () => {
      if (i >= DRILLS.length) {
        const avg = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10);
        box.innerHTML = `<div class="meta"><span>Session done</span><span>${avg}/100</span></div>
          <h4>${avg >= 85 ? "Reliable. The Galaxy would be proud." : avg >= 60 ? "Getting there." : "Tonight's drills would aim right at those."}</h4>
          <div class="playbook"><b style="font-size:14px">The playbook, as the members would read it</b><ol>${playbook.map((l) => `<li>${esc(l)}</li>`).join("")}</ol></div>
          <div><button class="btn btn-dark sm" id="again">Run it again</button></div>`;
        return;
      }
      const dr = DRILLS[i];
      const name = dr.member[0].toUpperCase() + dr.member.slice(1);
      box.innerHTML = `<div class="meta"><span style="display:inline-flex;align-items:center;gap:6px"><span style="width:16px;height:16px;color:var(--trainer)">${glyph("trainer")}</span>Drill ${i + 1} of ${DRILLS.length} · you're ${name}</span><span>simulation</span></div>
        <h4>${esc(dr.title)}</h4>
        <div class="setup">${esc(dr.setup)}</div>
        <div class="answers">${dr.answers.map(([t], k) => `<button class="answer" data-k="${k}">${esc(t)}</button>`).join("")}</div>
        <div id="grade"></div>`;
    };
    draw();

    stage.addEventListener("click", (e) => {
      if (e.target.closest("#again")) {
        i = 0;
        scores.length = playbook.length = 0;
        stage.querySelector("#t-score").textContent = "–";
        return draw();
      }
      const a = e.target.closest(".answer");
      if (!a || a.disabled) return;
      const dr = DRILLS[i];
      const [, score, why] = dr.answers[Number(a.dataset.k)];
      const best = dr.answers.findIndex(([, s]) => s === 10);
      for (const b of box.querySelectorAll(".answer")) {
        b.disabled = true;
        if (Number(b.dataset.k) === best) b.classList.add("right");
      }
      if (score < 10) a.classList.add("wrong");
      scores.push(score);
      if (!playbook.includes(dr.lesson)) playbook.push(dr.lesson);
      stage.querySelector("#t-score").textContent = `${Math.round((scores.reduce((x, y) => x + y, 0) / scores.length) * 10)}`;
      stage.querySelector("#t-count").textContent = `${scores.length} of ${DRILLS.length} drills graded`;
      box.querySelector("#grade").innerHTML = `<div class="grade"><div class="score">${score}<small>/10</small></div><p>${esc(why)}<br><span style="color:var(--trainer);font-size:13px">Playbook: ${esc(dr.lesson)}</span></p></div>
        <div style="margin-top:12px"><button class="btn btn-dark sm" id="next">${i + 1 < DRILLS.length ? "Next drill" : "Finish the session"}</button></div>`;
      box.querySelector("#next").onclick = () => {
        i++;
        draw();
      };
    });
  },
};
