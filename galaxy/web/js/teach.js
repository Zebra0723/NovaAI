// Galaxy Teach's space: lessons on what came up while you worked, the player you learn
// them in, your notes, and a map of what you know. Galaxy Teach.app opens straight here.
//
// Your screen is never on this page or anywhere in Link: only the topics Teach noticed,
// the lessons Claude wrote about them, and what you did in them.

import { api } from "./api.js";
import { avatar, icon } from "./marks.js";
import { poke, state } from "./state.js";
import { $, ago, dayLabel, esc, toast } from "./util.js";

const o = () => state.teach;
const APP_NAMES = { Terminal: "Terminal", Claude: "the Claude app", "claude.ai": "claude.ai", Code: "VS Code" };
const LEVEL = { new: "New to you", shaky: "Getting there", solid: "Solid" };

/** Plain lesson text: paragraphs, `code`, and **bold**. */
function prose(text) {
  return String(text ?? "")
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\*([^*\s][^*]*)\*/g, "<em>$1</em>").replace(/\n/g, "<br>")}</p>`)
    .join("");
}
const inline = (t) =>
  esc(t)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*\s][^*]*)\*/g, "<em>$1</em>");

// ------------------------------------------------------------------ home

function watcherPill() {
  const w = o()?.watcher;
  if (!w) return `<span class="pill"><span class="lamp"></span>Not watching yet · open Galaxy Teach</span>`;
  if (w.problem) return `<span class="pill attention">${esc(w.problem)}</span>`;
  if (!w.live || !w.watching) return `<span class="pill"><span class="lamp"></span>Not watching right now</span>`;
  const apps = (w.apps?.length ? w.apps : ["Terminal", "Claude", "claude.ai", "Code"]).map((a) => APP_NAMES[a] ?? a);
  return `<span class="pill"><span class="lamp on live" style="--c:var(--teach)"></span>Watching ${esc(apps.slice(0, -1).join(", "))}${apps.length > 1 ? " and " : ""}${esc(apps.at(-1))}</span>`;
}

function headline() {
  const s = o()?.stats;
  const offers = o()?.offers?.length ?? 0;
  if (offers) return offers === 1 ? `Something new <em>came up</em>` : `${offers} things <em>came up</em>`;
  if (s?.streak > 1) return `${s.streak} days <em>in a row</em>`;
  if (s?.finished) return `Keep <em>going</em>`;
  return `Learn what you <em>use</em>`;
}

function offerCard(x) {
  return `<div class="card offer" data-body="teach">
    <div class="offer-top"><span class="chip tint">${esc(APP_NAMES[x.app] ?? (x.app || "Your screen"))}</span><span class="muted small">${esc(ago(x.createdAt))} · ${x.minutes} min</span></div>
    <h3>${inline(x.title)}</h3>
    ${x.why ? `<p>${esc(x.why)}</p>` : ""}
    <div class="offer-actions"><button class="btn primary" data-begin="${x.id}">${icon("play")}Begin lesson</button><button class="btn" data-later="${x.id}" title="It's written now and waits in Saved for later">${icon("bookmark")}Save for later</button><button class="btn quiet" data-skip="${x.id}">Skip</button></div>
  </div>`;
}

function lessonRow(l) {
  const pct = l.status === "done" ? 100 : l.sections ? Math.round((l.position / (l.sections + 1)) * 100) : 0;
  const state =
    l.status === "writing"
      ? `<span class="chip tint writing">Writing…</span>`
      : l.status === "failed"
        ? `<span class="chip bad">Didn't work</span>`
        : l.status === "done"
          ? `<span class="score-pill ${l.score >= 80 ? "good" : l.score >= 50 ? "warn" : "bad"}">${l.score ?? "—"}</span>`
          : l.position
            ? `<span class="chip tint">${pct}%</span>`
            : l.saved
              ? `<span class="chip tint">${icon("bookmark")}Saved</span>`
            : `<span class="chip">New</span>`;
  return `<a class="lesson-row" href="#/teach/lesson/${l.id}" data-body="teach">
    <div class="lr-main"><b>${inline(l.title)}</b><span>${l.minutes} min · ${esc(l.status === "done" ? `finished ${ago(l.finishedAt)}` : l.lastAt ? `last opened ${ago(l.lastAt)}` : `added ${ago(l.createdAt)}`)}</span>
    ${l.status !== "writing" && l.status !== "failed" ? `<span class="lr-bar"><i style="width:${pct}%"></i></span>` : ""}</div>
    ${state}
  </a>`;
}

function mapHTML() {
  const topics = o()?.topics ?? [];
  if (!topics.length) return `<div class="empty small">${icon("layers")}<b>Nothing yet</b>Every topic you learn about shows up here, with how well you know it.</div>`;
  return ["solid", "shaky", "new"]
    .map((lvl) => {
      const list = topics.filter((t) => t.level === lvl && (t.lessons || t.asked || lvl === "solid"));
      if (!list.length) return "";
      return `<div class="map-group ${lvl}"><div class="label">${LEVEL[lvl]} · ${list.length}</div><div class="map-chips">${list
        .map((t) => `<button class="topic ${lvl}" data-topic="${esc(t.key)}" data-level="${lvl}" title="${t.asked ? `${t.right}/${t.asked} right in quizzes. ` : ""}Click to change">${esc(t.title)}</button>`)
        .join("")}</div></div>`;
    })
    .join("");
}

function notesHTML(list, limit = 8) {
  if (!list.length) return `<div class="empty small">${icon("note")}<b>No notes yet</b>Every lesson's takeaways land here, with anything you write.</div>`;
  return `<ul class="notes">${list
    .slice(0, limit)
    .map((n) => `<li><p>${inline(n.text)}</p><span>${n.by === "you" ? "You" : "Takeaway"} · ${esc(ago(n.at))}</span><button class="icon-btn" data-note-del="${n.id}" title="Delete note">${icon("x")}</button></li>`)
    .join("")}</ul>`;
}

let homeDrawn = "";
const home = {
  title: "Teach",
  deps: ["teach", "data"],
  render() {
    const x = o();
    const lessons = x?.lessons ?? [];
    const going = lessons.filter((l) => l.status === "ready" && l.position > 0);
    const later = lessons.filter((l) => l.saved && !going.includes(l) && l.status !== "done");
    const rest = lessons.filter((l) => !going.includes(l) && !later.includes(l));
    const s = x?.stats;
    return `<div class="page teach-page" data-body="teach">
      <section class="hero teach-hero">
        <div>
          <div class="label date">Galaxy Teach · ${x?.teachOnline ? "ready" : "not running"}</div>
          <h1>${headline()}</h1>
          <div class="story">When a command, a bit of code or a new idea comes up while you work, Teach offers you a lesson on it straight away. It's written by Claude for you, with examples from your own GalaxyAI. <b>Your screen is never recorded or saved:</b> Teach only keeps the topics, your lessons and your notes.</div>
          <div class="pills">${watcherPill()}${x?.status && !x.status.ok ? `<span class="pill attention">Can't reach Claude: ${esc(x.status.reason)}</span>` : ""}</div>
        </div>
        <div class="teach-stats">
          <div><b>${s?.streak ?? 0}</b><span>day streak</span></div>
          <div><b>${s?.finished ?? 0}</b><span>lessons done</span></div>
          <div><b>${s?.minutes ?? 0}</b><span>minutes learnt</span></div>
          <div><b>${s?.solid ?? 0}</b><span>topics solid</span></div>
        </div>
      </section>

      <form class="ask card" id="ask-form">
        ${icon("sparkle") || ""}<input id="ask" placeholder="Teach me about… (ports, git rebase, what launchd does, async/await)" autocomplete="off">
        <button class="btn" type="button" id="ask-later" title="It's written now and waits in Saved for later">Save for later</button>
        <button class="btn primary" type="submit">Make a lesson</button>
      </form>

      ${x?.offers?.length ? `<div class="section"><div class="section-head"><h2>Came up just now</h2><span class="muted small">Skip one twice and it won't be offered again</span></div><div class="offers">${x.offers.map(offerCard).join("")}</div></div>` : ""}

      <div class="teach-grid section">
        <div>
          ${going.length ? `<div class="section-head"><h2>Carry on</h2></div><div class="card lessons-list">${going.map(lessonRow).join("")}</div><div style="height:28px"></div>` : ""}
          ${later.length ? `<div class="section-head"><h2>Saved for later</h2><span class="muted small">Ready when you are</span></div><div class="card lessons-list">${later.map(lessonRow).join("")}</div><div style="height:28px"></div>` : ""}
          <div class="section-head"><h2>Your lessons</h2><span class="muted small">${lessons.length ? `${lessons.length} in all` : ""}</span></div>
          <div class="card lessons-list">${rest.length ? rest.map(lessonRow).join("") : `<div class="empty"><b>No lessons yet</b>Begin one from a notification, or ask for one above.</div>`}</div>
        </div>
        <aside>
          <div class="section-head"><h2>What you know</h2></div>
          <div class="card map-card">${mapHTML()}</div>
          <div class="section-head" style="margin-top:28px"><h2>Notes</h2></div>
          <div class="card notes-card">${notesHTML(x?.notes ?? [])}</div>
          ${x?.style?.text ? `<div class="section-head" style="margin-top:28px"><h2>How you learn</h2></div><div class="card style-card"><p>${esc(x.style.text).replace(/\n/g, "<br>")}</p><span class="muted small">What Teach has worked out from your lessons. It shapes every new one.</span></div>` : ""}
        </aside>
      </div>
    </div>`;
  },
  /** Redraws when Teach changes, keeping whatever you were typing in the ask box. */
  update(what) {
    if (!what.has("teach")) return;
    const sig = JSON.stringify({ ...o(), version: 0, watcher: o()?.watcher && { ...o().watcher, at: 0 } });
    if (sig === homeDrawn) return;
    homeDrawn = sig;
    const box = $("#view");
    const ask = $("#ask");
    const typed = ask?.value ?? "";
    const focused = document.activeElement === ask;
    const top = box.scrollTop;
    box.innerHTML = this.render().replace('class="page teach-page"', 'class="page teach-page" style="animation:none"');
    this.mount(box);
    box.scrollTop = top;
    const again = $("#ask");
    if (again) {
      again.value = typed;
      if (focused) again.focus();
    }
  },
  mount(box) {
    $("#ask-form", box)?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = $("#ask");
      const request = input.value.trim();
      if (!request) return;
      try {
        const l = await api.teachAsk(request);
        input.value = "";
        location.hash = `#/teach/lesson/${l.id}`;
      } catch (error) {
        toast(error.message);
      }
    });
    box.onclick = async (e) => {
      const begin = e.target.closest("[data-begin]");
      if (begin) {
        begin.disabled = true;
        try {
          const l = await api.teachBegin(begin.dataset.begin);
          location.hash = `#/teach/lesson/${l.id}`;
        } catch (error) {
          toast(error.message);
          begin.disabled = false;
        }
        return;
      }
      if (e.target.closest("#ask-later")) {
        const input = $("#ask");
        const request = input.value.trim();
        if (!request) return toast("Type what you'd like to learn first");
        try {
          await api.teachAsk(request, true);
          input.value = "";
          toast("Saved for later. It'll be ready in a minute");
          poke();
        } catch (error) {
          toast(error.message);
        }
        return;
      }
      const later = e.target.closest("[data-later]");
      if (later) {
        later.disabled = true;
        try {
          await api.teachLater(later.dataset.later);
          toast("Saved for later");
          poke();
        } catch (error) {
          toast(error.message);
          later.disabled = false;
        }
        return;
      }
      const skip = e.target.closest("[data-skip]");
      if (skip) {
        skip.disabled = true;
        await api.teachSkip(skip.dataset.skip).catch((error) => toast(error.message));
        poke();
        return;
      }
      const topic = e.target.closest("[data-topic]");
      if (topic) {
        const next = { new: "shaky", shaky: "solid", solid: "new" }[topic.dataset.level];
        await api.teachLevel(topic.dataset.topic, next).catch((error) => toast(error.message));
        toast(`${topic.textContent}: ${LEVEL[next].toLowerCase()}`);
        poke();
        return;
      }
      const del = e.target.closest("[data-note-del]");
      if (del) {
        await api.teachDeleteNote(del.dataset.noteDel).catch((error) => toast(error.message));
        poke();
      }
    };
  },
};

// ---------------------------------------------------------------- player

/** The lesson page's own state: which lesson, where you are, and what you've answered. */
const P = { id: "", lesson: null, pos: 0, answers: {}, recap: "", checking: {}, quizDone: false };
const RECAP_AFTER_MS = 10 * 60_000;

async function load(id) {
  const l = await api.teachLesson(id);
  const fresh = P.id !== id;
  P.lesson = l;
  if (fresh) {
    P.id = id;
    P.pos = l.position ?? 0;
    P.answers = { ...(l.answers ?? {}) };
    P.checking = {};
    P.quizDone = l.status === "done";
    // Back after a while, part way through: offer a recap first.
    P.recap = l.status === "ready" && l.position > 0 && Date.now() - (l.lastAt || 0) > RECAP_AFTER_MS ? "ask" : "";
  }
  return l;
}

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.teachProgress(P.id, { position: P.pos, answers: P.answers }).catch(() => {}), 300);
}

function stepsBar(c) {
  const n = c.sections.length;
  const dots = c.sections
    .map((s, i) => `<button class="step ${s.kind}${i === P.pos ? " on" : ""}${i < P.pos ? " done" : ""}" data-go="${i}" title="${esc(s.title)}"><i></i></button>`)
    .join("");
  return `<div class="steps-bar">${dots}<button class="step quiz${P.pos === n ? " on" : ""}${P.quizDone ? " done" : ""}" data-go="${n}" title="Quiz"><i></i></button></div>`;
}

function choicesHTML(key, q, choices, answer, why) {
  const picked = P.answers[key];
  const has = picked !== undefined && picked !== null;
  return `<div class="choices${has ? " answered" : ""}">${choices
    .map((c, i) => {
      const cls = has ? (i === answer ? "right" : i === Number(picked) ? "wrong" : "") : "";
      return `<button class="choice ${cls}" data-answer="${key}" data-i="${i}" ${has ? "disabled" : ""}><span class="ltr">${"ABCDE"[i]}</span><span>${inline(c)}</span></button>`;
    })
    .join("")}</div>
    ${has ? `<div class="reveal ${Number(picked) === answer ? "right" : "wrong"}"><b>${Number(picked) === answer ? "Right." : "Not quite."}</b> ${inline(why || "")}</div>` : ""}`;
}

function sectionHTML(s, i) {
  const key = `s${i}`;
  const kind = { explain: "Learn", scenario: "In the real world", practice: "Your turn" }[s.kind];
  let body = "";
  if (s.kind === "explain") {
    body = `<div class="prose">${prose(s.body)}</div>
      ${s.example ? `<figure class="example"><pre><code>${esc(s.example.code)}</code></pre>${s.example.caption ? `<figcaption>${inline(s.example.caption)}</figcaption>` : ""}</figure>` : ""}
      ${s.check ? `<div class="check"><div class="label">Quick check</div><p class="q">${inline(s.check.q)}</p>${choicesHTML(key, s.check.q, s.check.choices, s.check.answer, s.check.why)}</div>` : ""}`;
  } else if (s.kind === "scenario") {
    body = `<div class="story-card"><div class="story-head">${avatar("link", "xs")}<span>A situation in your GalaxyAI</span></div><div class="prose">${prose(s.story)}</div></div>
      <p class="q">${inline(s.q)}</p>${choicesHTML(key, s.q, s.choices, s.answer, s.why)}`;
  } else {
    const a = P.answers[key] ?? {};
    const pending = P.checking[i];
    body = `<div class="prose"><p>${inline(s.task)}</p></div>
      <div class="term${a.ok === true ? " ok" : a.ok === false ? " no" : ""}">
        <div class="term-bar"><i></i><i></i><i></i><span>practice · nothing here is run</span></div>
        <label class="term-line"><span class="ps">$</span><textarea id="practice-${i}" rows="1" spellcheck="false" autocomplete="off" placeholder="type it here">${esc(a.text ?? "")}</textarea></label>
      </div>
      <div class="practice-actions">
        <button class="btn primary" data-check="${i}" ${pending ? "disabled" : ""}>${pending ? "Claude is looking…" : "Check"}</button>
        ${s.hint ? `<button class="btn" data-hint="${i}">Hint</button>` : ""}
        <button class="btn" data-solution="${i}">Show answer</button>
      </div>
      <div id="hint-${i}" class="reveal hint" hidden>${inline(s.hint)}</div>
      ${a.ok !== undefined ? `<div class="reveal ${a.ok ? "right" : "wrong"}"><b>${a.ok ? "That works." : "Not yet."}</b> ${inline(a.feedback || (a.ok ? s.explain : "Have another go, or use the hint."))}</div>` : ""}
      <div id="solution-${i}" class="reveal solution" ${a.shown ? "" : "hidden"}><div class="label">One answer</div><pre><code>${esc(s.solution)}</code></pre><p>${inline(s.explain)}</p></div>`;
  }
  return `<article class="lesson-section ${s.kind}">
    <div class="label kind">${kind} · ${i + 1} of ${P.lesson.content.sections.length}</div>
    <h2>${inline(s.title)}</h2>
    ${body}
    ${s.keyPoint ? `<div class="key-point">${icon("pin") || ""}<span>${inline(s.keyPoint)}</span></div>` : ""}
  </article>`;
}

function quizHTML(c) {
  const done = P.quizDone;
  const answered = c.quiz.every((_, i) => P.answers[`q${i}`] !== undefined);
  const right = c.quiz.filter((q, i) => Number(P.answers[`q${i}`]) === q.answer).length;
  return `<article class="lesson-section quiz">
    <div class="label kind">Quiz · ${c.quiz.length} questions</div>
    <h2>${done ? `You got ${right} of ${c.quiz.length}` : "Let's see what stuck"}</h2>
    ${done ? `<p class="muted">${right === c.quiz.length ? "Every one. That topic is solid now." : "What you missed will come back in later lessons."}</p>` : ""}
    <ol class="quiz-list">${c.quiz
      .map((q, i) => {
        const key = `q${i}`;
        const picked = P.answers[key];
        return `<li><p class="q">${inline(q.q)}</p><div class="choices${done ? " answered" : ""}">${q.choices
          .map((ch, j) => {
            const cls = done ? (j === q.answer ? "right" : j === Number(picked) ? "wrong" : "") : Number(picked) === j ? "picked" : "";
            return `<button class="choice ${cls}" data-quiz="${key}" data-i="${j}" ${done ? "disabled" : ""}><span class="ltr">${"ABCDE"[j]}</span><span>${inline(ch)}</span></button>`;
          })
          .join("")}</div>${done && q.why ? `<div class="reveal ${Number(picked) === q.answer ? "right" : "wrong"}">${inline(q.why)}</div>` : ""}</li>`;
      })
      .join("")}</ol>
    ${done ? (c.takeaways.length ? `<div class="takeaways"><div class="label">Saved to your notes</div><ul>${c.takeaways.map((t) => `<li>${inline(t)}</li>`).join("")}</ul></div>` : "") : `<button class="btn primary big" id="finish" ${answered ? "" : "disabled"}>Finish lesson</button>`}
  </article>`;
}

function recapHTML(c) {
  const points = c.sections.slice(0, P.pos).map((s) => s.keyPoint || s.title);
  if (P.recap === "ask")
    return `<div class="card recap ask"><div><div class="label">Welcome back</div><h3>You were ${P.pos} of ${c.sections.length} sections in</h3><p>Want a one-minute recap of what you covered first?</p></div>
      <div class="offer-actions"><button class="btn primary" data-recap="show">Recap me</button><button class="btn" data-recap="skip">Skip recap</button></div></div>`;
  return `<div class="card recap"><div class="label">Recap · what you've covered</div><ol>${points.map((p) => `<li>${inline(p)}</li>`).join("")}</ol>
    <button class="btn primary" data-recap="skip">Carry on</button></div>`;
}

function playerBody() {
  const l = P.lesson;
  if (!l) return `<div class="card empty" style="padding:60px"><b>Opening…</b></div>`;
  if (l.status === "writing")
    return `<div class="card writing-card"><div class="quill">${icon("sparkle") || ""}</div><h2>Claude is writing your lesson</h2><p>About a minute. It's being made for you: what you already know, how you learn best, and examples from your own GalaxyAI.</p><div class="dots"><i></i><i></i><i></i></div></div>`;
  if (l.status === "failed")
    return `<div class="card writing-card"><h2>This one didn't come out right</h2><p>${esc(l.error)}</p><button class="btn primary" id="retry">Try again</button></div>`;
  const c = l.content;
  if (P.recap) return recapHTML(c);
  const n = c.sections.length;
  const main = P.pos >= n ? quizHTML(c) : sectionHTML(c.sections[P.pos], P.pos);
  return `${main}
    <div class="player-nav">
      <button class="btn" data-go="${Math.max(0, P.pos - 1)}" ${P.pos === 0 ? "disabled" : ""}>Back</button>
      ${P.pos < n ? `<button class="btn primary" data-go="${P.pos + 1}">${P.pos === n - 1 ? "On to the quiz" : "Next"}</button>` : P.quizDone ? `<a class="btn primary" href="#/teach">Back to lessons</a>` : ""}
    </div>`;
}

function notesFor(id) {
  return (o()?.notes ?? []).filter((n) => n.lessonId === id);
}

function playerHTML() {
  const l = P.lesson;
  const c = l?.content;
  return `<div class="page lesson-page" data-body="teach">
    <header class="lesson-head">
      <a class="back" href="#/teach">${icon("arrow-left") || "←"}Lessons</a>
      <div class="label">${l ? `${l.minutes} minutes${l.request ? " · you asked" : l.why ? " · came up while you worked" : ""}` : ""}</div>
      <h1>${l ? inline(l.title) : ""}</h1>
      ${c?.hook && P.pos === 0 && !P.recap ? `<p class="hook">${inline(c.hook)}</p>` : ""}
      ${c && !P.recap ? stepsBar(c) : ""}
    </header>
    <div class="lesson-grid">
      <div id="player">${playerBody()}</div>
      <aside class="lesson-side">
        <div class="card notes-card"><div class="label">Your notes</div>
          <form id="note-form"><textarea id="note" rows="2" placeholder="Jot something down…"></textarea><button class="btn sm" type="submit">Save note</button></form>
          <div id="lesson-notes">${notesHTML(notesFor(P.id), 20)}</div>
        </div>
        ${l && l.status !== "done" && l.status !== "failed" ? (l.saved ? `<button class="btn sm" id="unsave">${icon("bookmark")}Saved for later · remove</button>` : `<button class="btn sm" id="save-later">${icon("bookmark")}Save for later</button>`) : ""}
        ${l && l.status !== "writing" ? `<button class="btn danger sm" id="delete-lesson">${icon("trash")}Delete lesson</button>` : ""}
      </aside>
    </div>
  </div>`;
}

function redraw() {
  const box = $("#player");
  if (!box) return;
  box.innerHTML = playerBody();
  const head = $(".lesson-head");
  if (head) {
    const tmp = document.createElement("div");
    tmp.innerHTML = playerHTML();
    head.replaceWith(tmp.querySelector(".lesson-head"));
  }
  for (const t of document.querySelectorAll(".term textarea")) grow(t);
}
const grow = (t) => {
  t.style.height = "auto";
  t.style.height = t.scrollHeight + "px";
};

async function checkPractice(i) {
  const s = P.lesson.content.sections[i];
  const text = $(`#practice-${i}`)?.value.trim() ?? "";
  if (!text) return toast("Type your answer first");
  const key = `s${i}`;
  const exact = s.accept.some((re) => {
    try {
      return new RegExp(re).test(text);
    } catch {
      return false;
    }
  });
  if (exact) {
    P.answers[key] = { text, ok: true, feedback: s.explain };
    save();
    return redraw();
  }
  // Not the answer it expected: it may still be right, so Claude looks.
  P.answers[key] = { ...(P.answers[key] ?? {}), text };
  P.checking[i] = true;
  redraw();
  try {
    const c = await api.teachCheck(P.id, i, text);
    let done = c;
    for (let tries = 0; done?.status === "checking" && tries < 6; tries++) done = await api.teachCheckResult(c.id, 20);
    P.answers[key] = { text, ok: done?.status === "done" ? done.ok : false, feedback: done?.status === "done" ? done.feedback : "Teach didn't answer. Compare yours with the answer." };
  } catch (error) {
    toast(error.message);
  }
  P.checking[i] = false;
  save();
  redraw();
}

const player = {
  title: "Lesson",
  render(id) {
    if (P.id !== id) {
      P.id = "";
      P.lesson = null;
      load(id)
        .then(() => {
          const box = $("#view .lesson-page");
          if (box) {
            box.outerHTML = playerHTML();
            player.mount($("#view"));
          }
        })
        .catch((error) => toast(error.message));
    }
    return playerHTML();
  },
  mount(box) {
    if (box.dataset.teachMounted === P.id) return;
    box.dataset.teachMounted = P.id;
    for (const t of document.querySelectorAll(".term textarea")) grow(t);
    box.oninput = (e) => {
      if (e.target.matches(".term textarea")) grow(e.target);
    };
    box.onsubmit = async (e) => {
      if (e.target.id !== "note-form") return;
      e.preventDefault();
      const text = $("#note").value.trim();
      if (!text) return;
      await api.teachNote(P.id, text).catch((error) => toast(error.message));
      $("#note").value = "";
      toast("Saved to your notes");
      poke();
    };
    box.onclick = async (e) => {
      const go = e.target.closest("[data-go]");
      if (go && !go.disabled) {
        P.pos = Number(go.dataset.go);
        save();
        redraw();
        $("#view").scrollTop = 0;
        return;
      }
      const ans = e.target.closest("[data-answer]");
      if (ans) {
        P.answers[ans.dataset.answer] = Number(ans.dataset.i);
        save();
        return redraw();
      }
      const q = e.target.closest("[data-quiz]");
      if (q) {
        P.answers[q.dataset.quiz] = Number(q.dataset.i);
        save();
        return redraw();
      }
      const check = e.target.closest("[data-check]");
      if (check) return checkPractice(Number(check.dataset.check));
      const hint = e.target.closest("[data-hint]");
      if (hint) return ($(`#hint-${hint.dataset.hint}`).hidden = false);
      const sol = e.target.closest("[data-solution]");
      if (sol) {
        const key = `s${sol.dataset.solution}`;
        P.answers[key] = { ...(P.answers[key] ?? {}), shown: true };
        save();
        return ($(`#solution-${sol.dataset.solution}`).hidden = false);
      }
      const recap = e.target.closest("[data-recap]");
      if (recap) {
        P.recap = recap.dataset.recap === "show" ? "show" : "";
        return redraw();
      }
      if (e.target.closest("#finish")) {
        try {
          clearTimeout(saveTimer);
          P.lesson = await api.teachFinish(P.id, P.answers);
          P.quizDone = true;
          toast(`Lesson done: ${P.lesson.score}/100`);
          poke();
        } catch (error) {
          toast(error.message);
        }
        redraw();
        $("#view").scrollTop = 0;
        return;
      }
      if (e.target.closest("#retry")) {
        P.lesson = await api.teachRetry(P.id).catch((error) => (toast(error.message), P.lesson));
        return redraw();
      }
      const del = e.target.closest("[data-note-del]");
      if (del) {
        await api.teachDeleteNote(del.dataset.noteDel).catch((error) => toast(error.message));
        return poke();
      }
      if (e.target.closest("#save-later")) {
        clearTimeout(saveTimer);
        await api.teachSaved(P.id, true).catch((error) => toast(error.message));
        toast("Saved for later. It's on your Lessons page");
        poke();
        location.hash = "#/teach";
        return;
      }
      if (e.target.closest("#unsave")) {
        P.lesson = (await api.teachSaved(P.id, false).catch((error) => (toast(error.message), null))) ?? P.lesson;
        poke();
        const tmp = document.createElement("div");
        tmp.innerHTML = playerHTML();
        $(".lesson-side").replaceWith(tmp.querySelector(".lesson-side"));
        return;
      }
      if (e.target.closest("#delete-lesson")) {
        if (!confirm("Delete this lesson? Its notes stay.")) return;
        await api.teachDelete(P.id).catch((error) => toast(error.message));
        location.hash = "#/teach";
      }
    };
  },
  /** While Claude writes, look again every few seconds; notes stay current. */
  update(what) {
    if (what.has("teach")) {
      const notes = $("#lesson-notes");
      if (notes) notes.innerHTML = notesHTML(notesFor(P.id), 20);
      if (P.lesson?.status === "writing") {
        load(P.id)
          .then((l) => l.status !== "writing" && redraw())
          .catch(() => {});
      }
    }
  },
};

export const TEACH_VIEWS = { teach: home, lesson: player };
