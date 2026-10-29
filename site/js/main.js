// Galaxy's preview site: the sky, the members, the trials and the rest of the page.

import { esc, glyph, MEMBERS } from "./marks.js";
import { TRIALS } from "./trials/index.js";

const $ = (s, r = document) => r.querySelector(s);

// ------------------------------------------------------------------ the sky
function stars() {
  const canvas = $("#stars");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let w = 0, h = 0, list = [];
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    list = Array.from({ length: Math.round((w * h) / 4200) }, () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.2 + 0.2, a: Math.random(), s: Math.random() * 0.02 + 0.004 }));
  };
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const draw = () => {
    ctx.clearRect(0, 0, w, h);
    for (const s of list) {
      s.a += s.s;
      const o = 0.35 + Math.abs(Math.sin(s.a)) * 0.65;
      ctx.fillStyle = `rgba(244, 241, 234, ${o * 0.8})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!still) requestAnimationFrame(draw);
  };
  resize();
  addEventListener("resize", resize);
  draw();
}

// ------------------------------------------------------------------ members
const CARDS = [
  { id: "nova", role: "On your screen, one ⌃Space away", what: "Nova sees what's on your screen and drives the mouse, keyboard, apps and Terminal. It plans first, takes the dependable route, checks the result, and asks before anything it can't undo.", send: ["Anything to click, type or open on your Mac", "Tidying, renaming and moving files", "Downloading things into the right folder", "Reading what's on screen"] },
  { id: "orbit", role: "Speaks only when spoken to", what: "Talk to your Mac out loud. Orbit answers in a sentence or two, made for the ear, and passes anything it can't do by voice to the right member. Muted means silent, whatever happens.", send: ["Quick questions, hands free", "\"Remind me…\", \"What's next today?\"", "Starting work for the others, by voice"] },
  { id: "nebula", role: "Gestures, on your Mac", what: "Nebula reads your hand through the camera, only while you switch it on. Scroll, turn the volume like a knob, mute, and answer the Galaxy's questions with a thumbs up or down.", send: ["Hands-free control while you cook or present", "A thumbs up to approve, thumbs down to say no", "Pausing anything with an open palm"] },
  { id: "zenith", role: "Commands the long missions", what: "Give Zenith the big jobs, the ones that take hours. It turns a vague ask into a plan with checkpoints, works through it on its own, checks its work, and brings back something finished with a one-minute summary.", send: ["Building a website or a small app", "A full research report with sources", "Big reorganisations that can run overnight"] },
  { id: "trainer", role: "Twelve minutes a night with every member", what: "Every night the Trainer runs each member through realistic simulations aimed at its weak spots, grades them, and rewrites the playbook it reads before every job. You watch every session.", send: [] },
  { id: "medic", role: "Keeps every member running", what: "Medic checks on everyone once a minute. It restarts what stopped, reopens what crashed, and only bothers you when something needs you, once, with exactly what to do.", send: [] },
];

function members() {
  const box = $("#member-cards");
  box.innerHTML = CARDS.map(
    (c) => `<article class="member reveal" style="--c:${MEMBERS[c.id].color}">
      <div class="member-top"><span class="glyph">${glyph(c.id)}</span><span class="sense">${MEMBERS[c.id].sense}</span></div>
      <h3>${MEMBERS[c.id].name}</h3>
      <p class="role">${esc(c.role)}</p>
      <p class="what">${esc(c.what)}</p>
      ${c.send.length ? `<ul>${c.send.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
      <div class="try-it"><a class="btn sm" href="#try" data-trial="${c.id}">Try ${MEMBERS[c.id].name} →</a></div>
    </article>`,
  ).join("");
}

// ------------------------------------------------------------------- trials
let current = null;
let cleanup = null;

function showTrial(id) {
  const t = TRIALS.find((x) => x.id === id) ?? TRIALS[0];
  current = t.id;
  for (const b of document.querySelectorAll(".tab")) {
    b.classList.toggle("on", b.dataset.id === t.id);
    b.setAttribute("aria-selected", String(b.dataset.id === t.id));
  }
  cleanup?.();
  const stage = $("#trial-stage");
  stage.innerHTML = "";
  stage.style.setProperty("--c", MEMBERS[t.id].color === "#141413" ? "#c9bbff" : MEMBERS[t.id].color);
  cleanup = t.mount(stage) ?? null;
}

function trials() {
  const tabs = $("#trial-tabs");
  tabs.innerHTML = TRIALS.map(
    (t) => `<button class="tab" role="tab" data-id="${t.id}" style="--c:${MEMBERS[t.id].color === "#141413" ? "#c9bbff" : MEMBERS[t.id].color}"><i></i>${esc(t.label)}</button>`,
  ).join("");
  tabs.addEventListener("click", (e) => {
    const b = e.target.closest(".tab");
    if (b) showTrial(b.dataset.id);
  });
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-trial]");
    if (a) showTrial(a.dataset.trial);
  });
  showTrial(location.hash.startsWith("#try-") ? location.hash.slice(5) : "link");
}

// --------------------------------------------------------------- how it works
function diagram() {
  const ids = ["nova", "orbit", "nebula", "zenith", "trainer", "medic"];
  const C = 200, R = 140;
  const nodes = ids
    .map((id, i) => {
      const a = (-60 + i * 60) * (Math.PI / 180); // nothing straight below Link, where its name goes
      const x = C + R * Math.cos(a), y = C + R * Math.sin(a);
      const c = MEMBERS[id].color;
      return `<line x1="${C}" y1="${C}" x2="${x}" y2="${y}" stroke="${c}" stroke-opacity=".5" stroke-width="1.5" class="flow"/>
        <g transform="translate(${x - 26} ${y - 26})"><rect width="52" height="52" rx="16" fill="#fff" stroke="${c}" stroke-opacity=".35"/><g transform="translate(13 13)" color="${c}"><svg width="26" height="26" viewBox="0 0 24 24">${glyph(id).replace(/^<svg[^>]*>|<\/svg>$/g, "")}</svg></g></g>
        <text x="${x}" y="${y + 44}" text-anchor="middle" font-family="Geist, sans-serif" font-size="13" fill="#57534c">${MEMBERS[id].name}</text>`;
    })
    .join("");
  $("#how-diagram").innerHTML = `<svg viewBox="0 0 400 420">
    <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="#e6e2da" stroke-dasharray="3 5"/>
    ${nodes}
    <circle cx="${C}" cy="${C}" r="46" fill="#141413"/>
    <circle cx="${C}" cy="${C}" r="30" fill="none" stroke="#f4f1ea" stroke-opacity=".35"/>
    <circle cx="${C}" cy="${C}" r="10" fill="#f4f1ea"/>
    <rect x="${C - 62}" y="${C + 54}" width="124" height="28" rx="14" fill="#f8f7f4"/>
    <text x="${C}" y="${C + 72}" text-anchor="middle" font-family="Instrument Serif, serif" font-size="22" fill="#141413">Galaxy Link</text>
  </svg>`;
}

// ---------------------------------------------------------------------- day
const DAY = [
  { t: "7:40 AM", id: "orbit", h: "\"What's on today?\"", p: "You ask out loud while making breakfast. Orbit answers in one sentence and stays quiet after." },
  { t: "11:15 AM", id: "nova", h: "Screenshots, sorted", p: "\"Tidy my desktop.\" Nova uses Terminal to move 34 screenshots into a dated folder, checks the count, and leaves your other files alone." },
  { t: "4:00 PM", id: "zenith", h: "A website, by tonight", p: "\"Make my team a website.\" Zenith plans it, builds it, runs it, and asks once before buying a domain." },
  { t: "1:00 AM", id: "trainer", h: "Practice while you sleep", p: "The Trainer drills each member on its weak spots. Medic restarts anything that fell over. By morning everyone's a bit sharper." },
];

function day() {
  $("#timeline").innerHTML = DAY.map((d) => `<li class="reveal" style="--c:${MEMBERS[d.id].color === "#141413" ? "#c9bbff" : MEMBERS[d.id].color}"><time>${d.t} · ${MEMBERS[d.id].name}</time><h3>${esc(d.h)}</h3><p>${esc(d.p)}</p></li>`).join("");
}

// ---------------------------------------------------------------------- faq
const FAQ = [
  ["What do I need?", "A Mac running macOS 14 or newer, and your own Claude account (Pro or Max) for the members that think. Nova and Nebula can also use your own Anthropic key."],
  ["Does Galaxy see everything on my screen?", "Nova only looks at your screen when you ask it to do something, and Nebula only uses the camera while you've switched it on. Nothing is recorded in the background."],
  ["Where do my memories go?", "Into your own Galaxy account. Only you can see them, and they follow you to a new Mac when you sign in. Nobody else's Galaxy can see yours."],
  ["Will it do things without asking?", "Never anything that costs money, can't be undone or goes public. Those wait for your yes, from the app, a thumbs up to Nebula, or out loud to Orbit."],
  ["Does Orbit ever talk on its own?", "No. Orbit only speaks when you speak to it, and when it's muted it says nothing at all. Results that arrive later go on screen, never out loud."],
  ["What does the Trainer actually change?", "Each member's playbook: short lessons it reads before every job, rewritten from its graded drills. You can see every session and switch off any lesson you disagree with."],
  ["Are these demos the real thing?", "They're hands-on previews that behave the way each member does. Nebula's is real hand tracking from your camera, done entirely in your browser."],
];

function faq() {
  $("#faq-list").innerHTML = FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("");
}

// ------------------------------------------------------------------- chrome
function chrome() {
  const nav = $("#nav");
  const onScroll = () => nav.classList.toggle("solid", scrollY > 40);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) (e.target.classList.add("in"), io.unobserve(e.target));
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  for (const el of document.querySelectorAll(".reveal")) io.observe(el);
  for (const p of document.querySelectorAll(".planet[data-glyph]")) p.innerHTML = glyph(p.dataset.glyph);
}

stars();
members();
trials();
diagram();
day();
faq();
chrome();
