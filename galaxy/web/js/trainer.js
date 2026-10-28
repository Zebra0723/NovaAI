// Galaxy Trainer's space in Link: the squad at a glance, and each member's
// training page with its live 1:1 with the trainer, its playbook, its program
// and its history. You watch every session here and leave the trainer notes.

import { api } from "./api.js";
import { avatar, glyph, hex, icon, MEMBERS } from "./marks.js";
import { focusTraining, newThreadIDs, poke, state } from "./state.js";
import { $, ago, clock, dayLabel, esc, nameOf, richText, toast } from "./util.js";

export const TRAINEES = ["comet", "orbit", "nova", "nebula", "zenith"];
const MINUTES = () => state.training?.minutesPerDay ?? 12;
/** A member's overnight minutes: twelve, or twenty-four for Nebula. */
const BUDGET = (id) => memberOf(id)?.budget ?? (id === "nebula" ? 24 : MINUTES());
const TEST = () => state.training?.testMinutes ?? 12;
const hour = (h) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric" });
const windowText = () => {
  const w = state.training?.window ?? { start: 1, end: 6 };
  return `${hour(w.start)} to ${hour(w.end)}`;
};

const memberOf = (id) => state.training?.members.find((m) => m.member === id);
const bodyOf = (id) => state.overview?.bodies?.find((b) => b.id === id);
const trainerOnline = () => !!state.training?.trainerOnline;
const running = (m) => m?.latest?.status === "running";
const pct = (n) => Math.round(n);

/** "Mon 27", for chart ticks. */
const tick = (day) => new Date(day + "T12:00:00").toLocaleDateString([], { weekday: "short", day: "numeric" });

// ------------------------------------------------------------------ drawings

/** Five concentric rings, one per member: today's minutes out of twelve. */
function squadRings(size = 280) {
  const c = size / 2;
  const w = 9;
  const gap = 5;
  return `<svg viewBox="0 0 ${size} ${size}" class="rings-svg" aria-hidden="true">${TRAINEES.map((id, i) => {
    const r = c - w / 2 - 4 - i * (w + gap);
    const len = 2 * Math.PI * r;
    const m = memberOf(id);
    const frac = Math.min(1, (m?.minutesToday ?? 0) / BUDGET(id));
    return `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${hex(id)}" stroke-opacity=".12" stroke-width="${w}"/>
      ${frac <= 0 ? "" : `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${hex(id)}" stroke-width="${w}" stroke-linecap="round"
        stroke-dasharray="${(len * frac).toFixed(1)} ${len.toFixed(1)}" transform="rotate(-90 ${c} ${c})" class="${running(m) ? "ring-live" : ""}"/>`}`;
  }).join("")}</svg>`;
}

/** One ring: a member's minutes today. */
function ring(id, size = 44, stroke = 4) {
  const m = memberOf(id);
  const c = size / 2;
  const r = c - stroke / 2 - 1;
  const len = 2 * Math.PI * r;
  const frac = Math.min(1, (m?.minutesToday ?? 0) / BUDGET(id));
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="mini-ring" aria-hidden="true">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${hex(id)}" stroke-opacity=".14" stroke-width="${stroke}"/>
    ${frac <= 0 ? "" : `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${hex(id)}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${(len * frac).toFixed(1)} ${len.toFixed(1)}" transform="rotate(-90 ${c} ${c})" class="${running(m) ? "ring-live" : ""}"/>`}</svg>`;
}

/** Scores over the last sessions, as a line with a soft fill. */
function scoreChart(id, scores, { w = 260, h = 64, axis = false } = {}) {
  if (!scores.length) return `<div class="chart-empty">${icon("trending")}<span>Scores appear after the first session</span></div>`;
  const pts = scores.slice(-14);
  const pad = 6;
  const x = (i) => (pts.length === 1 ? w / 2 : pad + (i * (w - pad * 2)) / (pts.length - 1));
  const y = (v) => h - pad - (Math.max(0, Math.min(100, v)) / 100) * (h - pad * 2);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.score).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1).toFixed(1)} ${h} L${x(0).toFixed(1)} ${h} Z`;
  const uid = `g-${id}-${w}`;
  return `<svg viewBox="0 0 ${w} ${h}" class="score-chart" style="height:${h}px" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hex(id)}" stop-opacity=".18"/><stop offset="1" stop-color="${hex(id)}" stop-opacity="0"/></linearGradient></defs>
    ${[25, 50, 75].map((v) => `<line x1="0" x2="${w}" y1="${y(v)}" y2="${y(v)}" stroke="#e9e6df" stroke-dasharray="2 4"/>`).join("")}
    <path d="${area}" fill="url(#${uid})"/>
    <path d="${line}" fill="none" stroke="${hex(id)}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.score)}" r="${i === pts.length - 1 ? 3.6 : 2.2}" fill="${i === pts.length - 1 ? hex(id) : "#fff"}" stroke="${hex(id)}" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`).join("")}
  </svg>${
    axis
      ? `<div class="chart-axis">${pts
          .filter((p, i) => i === 0 || i === pts.length - 1 || i === Math.floor((pts.length - 1) / 2))
          .map((p) => `<span>${esc(tick(p.day))}</span>`)
          .join("")}</div>`
      : ""
  }`;
}

function scoreTone(v, outOf = 100) {
  const s = (v / outOf) * 10;
  return s >= 8 ? "good" : s >= 5 ? "warn" : "bad";
}

function delta(scores) {
  if (scores.length < 2) return "";
  const d = Math.round(scores[scores.length - 1].score - scores[scores.length - 2].score);
  if (!d) return `<span class="delta flat">±0</span>`;
  return `<span class="delta ${d > 0 ? "up" : "down"}">${d > 0 ? "+" : "−"}${Math.abs(d)}</span>`;
}

function statusLine(m) {
  if (!m?.joined) return `<span class="st"><span class="lamp never"></span>Hasn't joined Galaxy yet</span>`;
  if (running(m)) return `<span class="st live"><span class="lamp on live"></span>Training now</span>`;
  if (m.latest?.trigger === "night" && m.latest.day === state.training?.day && m.latest.status !== "running")
    return `<span class="st"><span class="lamp on" style="--c:var(--good)"></span>Trained last night</span>`;
  return `<span class="st"><span class="lamp"></span>${trainerOnline() ? `Tonight from ${esc(hour(state.training?.window?.start ?? 1))}` : "Waiting for the trainer"}</span>`;
}

const modeTag = (m) =>
  m?.member === "nebula" && m?.practises
    ? `<span class="mode own" title="Trains on its own hand simulator">${icon("live")}Own simulator</span>`
    : m?.practises
    ? `<span class="mode own" title="Answers its drills itself, as a dry run">${icon("live")}Own answers</span>`
    : `<span class="mode" title="The trainer rehearses this member's answers">${icon("rehearse")}Rehearsed</span>`;

/** Shown when the trainer can't reach Claude Code: no session can run until it can. */
function alertHTML() {
  const st = state.training?.trainerStatus;
  if (!st || st.ok) return "";
  return `<div class="t-alert">${icon("x")}<div><b>The trainer can't reach Claude Code, so no session can run.</b><p>${esc(st.reason || "No reason given.")}</p>
    <p class="muted">Check that Claude Code is logged in to your plan (run <code>claude</code> once in Terminal), then reinstall the trainer: <code>galaxy/install.sh</code>. Checked ${esc(ago(st.at))}.</p></div></div>`;
}

// ------------------------------------------------------------------ overview

function traineeCard(id) {
  const m = memberOf(id);
  const name = MEMBERS[id]?.name ?? nameOf(id);
  const scores = m?.scores ?? [];
  const latest = scores.length ? scores[scores.length - 1].score : null;
  return `<a class="card trainee ${m?.joined ? "" : "off"}" data-body="${id}" href="#/trainer/${id}">
    <div class="t-top">
      ${avatar(id, "lg", m?.joined ? "" : "off")}
      <div class="t-name"><b>${esc(name)}</b>${modeTag(m)}</div>
    </div>
    <div class="t-score">
      <span class="num ${latest === null ? "none" : ""}">${latest === null ? "—" : pct(latest)}</span>
      <span class="of">${latest === null ? "no score yet" : "/100"}</span>${delta(scores)}
    </div>
    <div class="t-chart">${scoreChart(id, scores, { w: 240, h: 56 })}</div>
    <div class="t-focus"><div class="label"><span>Working on</span><span>${m?.lessons ?? 0} lesson${m?.lessons === 1 ? "" : "s"}</span></div><p>${esc(m?.focus?.[0] ?? "Starts with its brief at the first session.")}</p></div>
    <div class="t-foot">${statusLine(m)}<span class="t-min">${ring(id, 18, 2.5)}${m?.minutesToday ?? 0}<i>/${BUDGET(id)}</i></span></div>
  </a>`;
}

function latestFromSessions() {
  const items = [];
  for (const id of TRAINEES) for (const msg of state.threads[id] ?? []) if (msg.kind === "feedback" || msg.kind === "summary" || msg.kind === "note") items.push(msg);
  items.sort((a, b) => b.at - a.at);
  return items.slice(0, 7);
}

const trainer = {
  title: "Trainer",
  deps: ["training", "thread", "data"],
  render() {
    focusTraining("");
    const t = state.training;
    const all = TRAINEES.map(memberOf).filter(Boolean);
    const total = all.reduce((s, m) => s + Math.min(m.minutesToday, BUDGET(m.member)), 0);
    const nightly = TRAINEES.reduce((s, id) => s + BUDGET(id), 0);
    const now = all.find(running);
    const feed = latestFromSessions();
    const avg = (() => {
      const latest = all.map((m) => m.scores?.[m.scores.length - 1]?.score).filter((v) => typeof v === "number");
      return latest.length ? pct(latest.reduce((a, b) => a + b, 0) / latest.length) : null;
    })();
    return `<div class="page trainer-page" data-body="trainer">${alertHTML()}
      <section class="hero trainer-hero">
        <div>
          <div class="label date">Galaxy Trainer · ${esc(new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }))}</div>
          <h1>Practice makes <em>reliable</em></h1>
          <div class="story">Every night while you sleep, ${esc(windowText())}: ${MINUTES()} minutes with each member and ${BUDGET("nebula")} with Nebula. Simulations of real situations built from that day's work and aimed at each one's weak spots, graded, and turned into a playbook it reads before every job. Real work always comes first.</div>
          <div class="pills">
            <span class="pill"><span class="lamp ${trainerOnline() ? "on live" : ""}" style="--c:var(--trainer)"></span>${t ? (trainerOnline() ? "Trainer is running" : "Trainer isn't running") : "Connecting"}</span>
            ${now ? `<a class="pill attention-live" href="#/trainer/${now.member}">Training ${esc(nameOf(now.member))} now</a>` : ""}
            ${avg !== null ? `<span class="pill">Squad average ${avg}/100</span>` : ""}
          </div>
        </div>
        <div class="rings">
          ${squadRings()}
          <div class="rings-center"><b>${total}</b><span>of ${nightly} min</span><span>last night</span></div>
        </div>
      </section>

      <div class="ring-legend">${TRAINEES.map((id) => `<a href="#/trainer/${id}" data-body="${id}"><i></i>${esc(MEMBERS[id].name)}<span>${memberOf(id)?.minutesToday ?? 0}/${BUDGET(id)}</span></a>`).join("")}</div>

      <div class="section">
        <div class="section-head"><h2>The squad</h2><span class="muted small">Scores are out of 100, from the last ${14} sessions</span></div>
        <div class="trainees">${TRAINEES.map(traineeCard).join("")}</div>
      </div>

      <div class="split section">
        <div>
          <div class="section-head"><h2>From the sessions</h2></div>
          <div class="card coach-feed">${
            feed.length
              ? feed
                  .map(
                    (m) => `<a class="feed-line" href="#/trainer/${m.member}" data-body="${m.member}">
                ${avatar(m.member, "sm")}
                <div><div class="meta"><b>${esc(nameOf(m.member))}</b><span>${m.kind === "summary" ? "Session summary" : m.kind === "note" ? "Your note" : "Feedback"}</span><time>${esc(ago(m.at))}</time></div>
                <p>${esc(m.text.length > 220 ? m.text.slice(0, 220) + "…" : m.text)}</p></div>
                ${m.score !== null && m.score !== undefined ? `<span class="score-pill ${scoreTone(m.score, 10)}">${m.score}<i>/10</i></span>` : ""}
              </a>`,
                  )
                  .join("")
              : `<div class="empty"><b>No sessions yet</b>The first ones run tonight${trainerOnline() ? "" : ", once the trainer is running"}. To see one now, open a member and press Test session.</div>`
          }</div>
        </div>
        <div>
          <div class="section-head"><h2>How a session works</h2></div>
          <ol class="card steps">
            <li><span class="n">01</span><div><b>Learn</b><p>Reads what the member really did that day, the notes you left, and where it scored worst.</p></div></li>
            <li><span class="n">02</span><div><b>Simulate</b><p>Plays out real-world situations over several turns, with the trainer as the other side and twists along the way. Never the same drill twice, always aimed at the weak spots. A dry run: nothing is ever done for real.</p></div></li>
            <li><span class="n">03</span><div><b>Grade</b><p>Scores each run out of 10 against the member's rubric, with one thing to keep and one to change.</p></div></li>
            <li><span class="n">04</span><div><b>Playbook</b><p>Rewrites up to twelve lessons the member reads in its prompt from then on. You can switch any of them off.</p></div></li>
            <li><span class="n">05</span><div><b>Nebula's workout</b><p>Twenty-four minutes on its own hand simulator, perfect gestures and messy real ones, designed around the gestures it gets wrong.</p></div></li>
          </ol>
        </div>
      </div>
    </div>`;
  },
};

// ------------------------------------------------------------- member page

let tab = "playbook";

function threadHTML(id, list) {
  let html = "";
  let session = null;
  let drillNo = 0;
  const sessions = state.trainingDetail[id]?.sessions ?? [];
  for (const m of list) {
    const fresh = newThreadIDs.has(m.id) ? " new" : "";
    if (m.sessionId && m.sessionId !== session) {
      session = m.sessionId;
      drillNo = 0;
      const s = sessions.find((x) => x.id === m.sessionId);
      html += `<div class="session-rule"><span>${esc(s ? `Session · ${dayLabel(s.startedAt)}` : dayLabel(m.at))}</span>${
        s?.status === "running" ? `<em class="live">${icon("live")}Live</em>` : s?.score !== null && s?.score !== undefined ? `<em class="${scoreTone(s.score)}">${pct(s.score)}/100</em>` : ""
      }</div>`;
    }
    if (m.kind === "note") {
      html += `<div class="tm note${fresh}"><div class="bubble"><div class="meta"><b>You</b><span>note to the trainer</span><time>${esc(clock(m.at))}</time></div><p>${richText(m.text)}</p></div></div>`;
    } else if (m.kind === "drill") {
      drillNo++;
      let [title, ...rest] = m.text.split("\n");
      const body = rest.join("\n").trim();
      let label = `Drill ${String(drillNo).padStart(2, "0")}`;
      let cls = "";
      if (title.startsWith("Simulation · ")) {
        label = `Simulation ${String(drillNo).padStart(2, "0")}`;
        title = title.slice("Simulation · ".length);
        cls = " sim";
      } else if (title.startsWith("Workout · ")) {
        label = title;
        title = "Tonight's workout";
        cls = " workout";
      }
      html += `<div class="tm drill${fresh}"><div class="drill-card${cls}"><div class="drill-k">${icon(cls === " sim" ? "rehearse" : cls ? "trainer" : "target")}${esc(label)}<time>${esc(clock(m.at))}</time></div>
        ${body ? `<h4>${esc(title)}</h4><p>${richText(body)}</p>` : `<p>${richText(title)}</p>`}</div></div>`;
    } else if (m.kind === "sim") {
      html += `<div class="tm world${fresh}"><div class="world-card"><div class="world-k">${icon("rehearse")}What happens next<time>${esc(clock(m.at))}</time></div><p>${richText(m.text)}</p></div></div>`;
    } else if (m.kind === "results") {
      html += resultsHTML(m, fresh);
    } else if (m.kind === "answer") {
      html += `<div class="tm answer${fresh}" data-body="${id}">${avatar(id, "sm")}<div class="bubble">
        <div class="meta"><b>${esc(nameOf(id))}</b>${m.rehearsal ? `<span class="tag">${icon("rehearse")}Rehearsed by the trainer</span>` : `<span class="tag own">${icon("live")}Its own answer</span>`}<time>${esc(clock(m.at))}</time></div>
        <p>${richText(m.text)}</p></div></div>`;
    } else if (m.kind === "feedback") {
      html += `<div class="tm coach feedback${fresh}" data-body="trainer">${avatar("trainer", "sm")}<div class="bubble">
        <div class="meta"><b>Trainer</b><span>feedback</span><time>${esc(clock(m.at))}</time></div>
        <div class="fb">${m.score !== null ? `<span class="score-pill ${scoreTone(m.score, 10)}">${m.score}<i>/10</i></span>` : ""}<p>${richText(m.text)}</p></div></div></div>`;
    } else if (m.kind === "summary") {
      html += `<div class="tm summary${fresh}"><div class="summary-card"><div class="label">Session summary</div><p>${richText(m.text)}</p></div></div>`;
    } else {
      html += `<div class="tm coach${fresh}" data-body="trainer">${avatar("trainer", "sm")}<div class="bubble">
        <div class="meta"><b>Trainer</b><time>${esc(clock(m.at))}</time></div><p>${richText(m.text)}</p></div></div>`;
    }
  }
  return html;
}

function asideHTML(id) {
  const d = state.trainingDetail[id];
  const p = d?.program;
  const lessons = d?.lessons ?? [];
  const on = lessons.filter((l) => l.active);
  const off = lessons.filter((l) => !l.active).slice(0, 8);
  const tabs = [
    ["playbook", "Playbook", on.length],
    ["program", "Program", p ? `v${p.version}` : ""],
    ["history", "History", d?.sessions?.length ?? ""],
  ];
  let body = "";
  if (tab === "playbook") {
    body = on.length
      ? `<p class="aside-note">${id === "nebula" ? "Rules the trainer builds Nebula's workouts around, and for you to check against how it really behaves." : `What ${esc(nameOf(id))} reads in its prompt before every job.`} Switch off anything you disagree with; the trainer won't bring it back.</p>
        <ol class="lessons">${on
          .map(
            (l, i) => `<li><span class="n">${String(i + 1).padStart(2, "0")}</span><p>${esc(l.text)}</p>
            <button class="icon-btn" data-lesson="${l.id}" data-active="0" title="Switch this lesson off">${icon("x")}</button></li>`,
          )
          .join("")}</ol>
        ${off.length ? `<div class="label" style="margin:22px 0 8px">Switched off</div><ul class="lessons off">${off.map((l) => `<li><p>${esc(l.text)}</p><button class="icon-btn" data-lesson="${l.id}" data-active="1" title="Switch back on">${icon("restore")}</button></li>`).join("")}</ul>` : ""}`
      : `<div class="empty small">${icon("book")}<b>No lessons yet</b>The playbook is written at the end of the first session.</div>`;
  } else if (tab === "program") {
    body = p
      ? `<div class="label">Brief</div><p class="brief">${esc(p.brief)}</p>
        <div class="label">Focus</div><ul class="ticks">${p.plan.focus.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
        <div class="label">Graded on</div><ul class="ticks plain">${p.plan.rubric.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
        ${p.plan.observations.length ? `<div class="label">What the trainer has noticed</div><ul class="ticks plain">${p.plan.observations.slice(0, 6).map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
        <div class="label">Scenario bank · ${p.plan.scenarios.length}</div><ul class="bank">${[...p.plan.scenarios].reverse().slice(0, 10).map((s) => `<li><b>${esc(s.title)}</b><span>${esc(s.setup)}</span></li>`).join("")}</ul>`
      : `<div class="empty small">${icon("note")}<b>No program yet</b>It starts from ${esc(nameOf(id))}'s brief at the first session.</div>`;
  } else {
    const sessions = d?.sessions ?? [];
    const scores = sessions.filter((s) => s.status === "done" && s.score !== null).map((s) => ({ day: s.day, score: s.score })).reverse();
    body = sessions.length
      ? `<div class="history-chart">${scoreChart(id, scores, { w: 320, h: 96, axis: true })}</div>
        <ul class="sessions">${sessions
          .map(
            (s) => `<li><div><b>${esc(dayLabel(s.startedAt))}${s.trigger === "test" ? ` <em class="test-tag">Test</em>` : ""}</b><span>${s.status === "running" ? "In progress" : `${s.drills} drill${s.drills === 1 ? "" : "s"} · ${Math.max(1, Math.round(((s.endedAt || Date.now()) - s.startedAt) / 60000))} min`}</span>${s.summary ? `<p>${esc(s.summary)}</p>` : ""}</div>
            ${s.status === "running" ? `<span class="score-pill live">Live</span>` : s.score !== null ? `<span class="score-pill ${scoreTone(s.score)}">${pct(s.score)}</span>` : `<span class="score-pill">${s.status === "failed" ? "—" : ""}</span>`}</li>`,
          )
          .join("")}</ul>`
      : `<div class="empty small">${icon("history")}<b>No sessions yet</b>Every session lands here with its score.</div>`;
  }
  return `<div class="tabs">${tabs.map(([k, label, n]) => `<button class="${tab === k ? "on" : ""}" data-tab="${k}">${label}${n !== "" ? `<span>${esc(String(n))}</span>` : ""}</button>`).join("")}</div><div class="tab-body">${body}</div>`;
}

/** Nebula's workout results: every gesture's accuracy, and what fired when it shouldn't have. */
function resultsHTML(m, fresh) {
  let r = null;
  try {
    r = JSON.parse(m.text);
  } catch {}
  if (!r?.gestures) return `<div class="tm summary${fresh}"><div class="summary-card"><p>${richText(m.text)}</p></div></div>`;
  const rows = [...r.gestures].sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0));
  const pctOf = (v) => Math.round((v ?? 0) * 100);
  return `<div class="tm results${fresh}"><div class="results-card">
    <div class="results-head"><div class="label">Workout results</div>${typeof r.overall === "number" ? `<b class="${scoreTone(r.overall * 100)}">${pctOf(r.overall)}<i>%</i></b>` : ""}</div>
    <div class="gesture-rows">${rows
      .map(
        (g) => `<div class="g-row"><span class="g-name">${esc(String(g.name).replaceAll("_", " "))}</span>
        <span class="g-bar"><i class="${scoreTone((g.accuracy ?? 0) * 100)}" style="width:${pctOf(g.accuracy)}%"></i></span>
        <span class="g-v">${pctOf(g.accuracy)}%</span>
        <span class="g-meta">${g.samples ?? "?"} tries${g.falseFires ? ` · ${g.falseFires} false` : ""}${g.worstConditions?.length ? ` · worst: ${esc(g.worstConditions.slice(0, 2).join(", "))}` : ""}</span></div>`,
      )
      .join("")}</div>
    ${r.negatives?.length ? `<div class="label" style="margin-top:14px">Must not fire</div><div class="neg-row">${r.negatives.map((n) => `<span class="chip ${n.falseFires ? "bad" : "good"}">${esc(n.name)} · ${n.falseFires ?? 0} false</span>`).join("")}</div>` : ""}
    ${r.model ? `<p class="results-model">${r.model.replaced ? `New model kept: ${pctOf(r.model.before)}% → ${pctOf(r.model.after)}% on the fixed test.` : `Kept the current model${typeof r.model.before === "number" ? ` (${pctOf(r.model.before)}% on the fixed test)` : ""}: the new one wasn't better.`}</p>` : ""}
    ${r.notes ? `<p class="results-notes">${richText(r.notes)}</p>` : ""}
  </div></div>`;
}

function headHTML(id) {
  const m = memberOf(id);
  const d = state.trainingDetail[id];
  const scores = m?.scores ?? [];
  const latest = scores.length ? pct(scores[scores.length - 1].score) : null;
  const week = scores.slice(-7);
  const avg = week.length ? pct(week.reduce((a, b) => a + b.score, 0) / week.length) : null;
  const sessions = d?.sessions?.length ?? 0;
  const lastNight = (d?.sessions ?? []).find((x) => x.trigger === "night");
  return `<section class="profile training-head">
      ${avatar(id, "xl", m?.joined ? "" : "off")}
      <div class="who">
        <div class="eyebrow"><span class="sense-pill">Training</span></div>
        <h1>${esc(MEMBERS[id]?.name ?? nameOf(id))}</h1>
        <p>${esc(MEMBERS[id]?.role ?? "")}</p>
        <div class="pills">${statusLine(m)}<span class="pill">${id === "nebula" ? (m?.practises ? "Trains on its own simulator" : "Rehearsed until its simulator joins in") : m?.practises ? "Answers its own drills" : "Drills are rehearsed by the trainer"}</span>${d?.program ? `<span class="pill">Program v${d.program.version}</span>` : ""}</div>
      </div>
      <div class="now today-card">
        <div class="label">Overnight</div>
        <div class="today">${ring(id, 64, 6)}<div><b>${m?.minutesToday ?? 0}<i> of ${BUDGET(id)} min</i></b><span>${running(m) ? "Session in progress" : lastNight ? `Last night: ${lastNight.score !== null ? `${pct(lastNight.score)}/100` : lastNight.status === "failed" ? "didn't finish" : "done"}` : `Every night, ${esc(windowText())}`}</span></div></div>
        <button class="btn primary" id="train-now" title="A ${TEST()}-minute session now, for testing. It never runs over real work." ${running(m) || !m?.joined ? "disabled" : ""}>${icon("play")}${running(m) ? "Training now" : `Test session · ${TEST()} min`}</button>
      </div>
    </section>
    <div class="stats" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <div class="card stat"><div class="k">Latest score</div><div class="v ${latest !== null ? scoreTone(latest) : ""}">${latest ?? "—"}<small>${latest !== null ? "/100" : ""}</small></div><div class="s">${scores.length > 1 ? `${delta(scores)} on the session before` : "from the last session"}</div></div>
      <div class="card stat"><div class="k">7-session average</div><div class="v">${avg ?? "—"}</div><div class="s">${week.length} session${week.length === 1 ? "" : "s"}</div></div>
      <div class="card stat"><div class="k">Sessions</div><div class="v">${sessions}</div><div class="s">since training began</div></div>
      <div class="card stat"><div class="k">Playbook</div><div class="v">${m?.lessons ?? 0}</div><div class="s">lessons in its prompt</div></div>
    </div>`;
}

const training = {
  title: "Training",
  render(id) {
    if (!TRAINEES.includes(id)) return `<div class="page"><div class="card empty" style="padding:60px"><b>No trainee called ${esc(id)}</b><a href="#/trainer">Back to Trainer</a></div></div>`;
    focusTraining(id);
    return `<div class="page training-page" data-body="${id}">
      <div id="t-alert">${alertHTML()}</div>
      <div id="t-head">${headHTML(id)}</div>
      <div class="training-grid section">
        <div class="card coach-thread">
          <div class="thread-head">
            <div class="pair">${avatar("trainer", "sm")}${avatar(id, "sm")}</div>
            <div><b>Trainer &amp; ${esc(nameOf(id))}</b><span>One-to-one · you're overseeing</span></div>
            <span class="thread-live" id="thread-live"></span>
          </div>
          <div class="thread" id="thread"></div>
          <form class="composer" id="note-form">
            <textarea id="note" rows="1" placeholder="Leave the trainer a note about ${esc(nameOf(id))}: what to push on, what went wrong today…"></textarea>
            <button class="btn primary" type="submit">${icon("send")}Send note</button>
          </form>
        </div>
        <aside class="card training-aside" id="t-aside">${asideHTML(id)}</aside>
      </div>
    </div>`;
  },
  mount(box) {
    const id = currentId();
    this.drawThread(true);
    box.addEventListener("click", async (e) => {
      const t = e.target.closest("[data-tab]");
      if (t) {
        tab = t.dataset.tab;
        $("#t-aside").innerHTML = asideHTML(id);
        return;
      }
      const l = e.target.closest("[data-lesson]");
      if (l) {
        l.disabled = true;
        try {
          await api.setLesson(l.dataset.lesson, l.dataset.active === "1");
          toast(l.dataset.active === "1" ? "Lesson back on" : "Lesson switched off");
          poke();
        } catch (error) {
          toast(error.message);
          l.disabled = false;
        }
        return;
      }
      if (e.target.closest("#train-now")) {
        const btn = $("#train-now");
        btn.disabled = true;
        try {
          const r = await api.trainNow(id);
          toast(r?.trainerOnline ? `Starting a ${TEST()}-minute test session for ${nameOf(id)}` : "Queued: the trainer isn't running yet");
          poke();
        } catch (error) {
          toast(error.message);
          btn.disabled = false;
        }
      }
    });
    const note = $("#note");
    note.addEventListener("input", () => {
      note.style.height = "auto";
      note.style.height = Math.min(note.scrollHeight, 160) + "px";
    });
    note.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        $("#note-form").requestSubmit();
      }
    });
    $("#note-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = note.value.trim();
      if (!text) return;
      try {
        await api.noteToTrainer(id, text);
        note.value = "";
        note.style.height = "auto";
        toast("Note left for the trainer");
      } catch (error) {
        toast(error.message);
      }
    });
  },
  update(what) {
    const id = currentId();
    if (what.has("thread")) this.drawThread(false);
    if (what.has("training") || what.has("data")) {
      const head = $("#t-head");
      if (head) head.innerHTML = headHTML(id);
      const alert = $("#t-alert");
      if (alert) alert.innerHTML = alertHTML();
      const aside = $("#t-aside");
      if (aside && !aside.contains(document.activeElement)) aside.innerHTML = asideHTML(id);
      this.drawLive(id);
    }
  },
  drawLive(id) {
    const el = $("#thread-live");
    if (el) el.innerHTML = running(memberOf(id)) ? `<span class="lamp on live" style="--c:var(--trainer)"></span>Session live` : "";
  },
  drawThread(jump) {
    const id = currentId();
    const box = $("#thread");
    if (!box) return;
    const list = state.threads[id] ?? [];
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
    box.innerHTML = list.length
      ? threadHTML(id, list)
      : `<div class="empty thread-empty">${avatar("trainer", "lg")}<b>Nothing here yet</b>${esc(nameOf(id))}'s sessions with the trainer show up here as they happen: every drill, answer, grade and summary.</div>`;
    this.drawLive(id);
    if (jump || nearBottom) box.scrollTop = box.scrollHeight;
  },
};

const currentId = () => location.hash.replace(/^#\/?/, "").split("/")[1] ?? "";

export const TRAINER_VIEWS = { trainer, training };

/** For the router: "#/trainer/comet" is Comet's training page. */
export function trainerRoute(id, param) {
  return id === "trainer" && param ? ["training", param] : null;
}

/** A trainee in Galaxy Trainer.app's sidebar: name, today's ring and the latest score. */
export function traineeRow(id, on) {
  const m = memberOf(id);
  const scores = m?.scores ?? [];
  const latest = scores.length ? pct(scores[scores.length - 1].score) : null;
  return `<a class="who trainee-row ${m?.joined ? "" : "off"}${on ? " on" : ""}" href="#/trainer/${id}" data-body="${id}">
    <span class="avatar xs">${glyph(id)}</span><span class="nm">${esc(MEMBERS[id]?.name ?? nameOf(id))}</span>
    <span class="state">${running(m) ? `<span class="lamp on live" style="--c:var(--trainer)"></span>live` : latest !== null ? `<b>${latest}</b>` : "—"}${ring(id, 18, 2.5)}</span></a>`;
}
