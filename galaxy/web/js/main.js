// Galaxy Link: the shell, the router, and keeping the current page live.

import { avatar, brandMark, glyph, icon } from "./marks.js";
import { start, state, subscribe } from "./state.js";
import { $, ago, esc } from "./util.js";
import { closeDrawer, VIEWS as LINK_VIEWS } from "./views.js";
import { TRAINEES, TRAINER_VIEWS, traineeRow } from "./trainer.js";

const VIEWS = { ...LINK_VIEWS, ...TRAINER_VIEWS };
import { closePalette, openPalette } from "./palette.js";

const NAV = [
  ["overview", "Overview"],
  ["chat", "Galaxy Chat"],
  ["map", "Galaxy Map"],
  ["handoffs", "Handoffs"],
  ["approvals", "Approvals"],
  ["memory", "Memory"],
  ["activity", "Activity"],
  ["system", "System"],
];
const SPACES = [["trainer", "Trainer"]];
const ICON_FOR = { trainer: "trainer", overview: "overview", chat: "chat", map: "map", handoffs: "handoffs", approvals: "approvals", memory: "memory", activity: "activity", system: "system" };

/** Galaxy Trainer.app opens this same page as ?space=trainer: the Trainer's space on its own. */
const TRAINER_APP = new URLSearchParams(location.search).get("space") === "trainer";
if (TRAINER_APP) document.documentElement.classList.add("trainer-app");

const LINK_SIDEBAR = `
      <div class="brand">${brandMark()}<div><div class="brand-name">Galaxy Link</div><div class="brand-sub">GalaxyAI · hub</div></div></div>
      <button class="search-trigger" id="search-trigger">${icon("search")}Search<kbd>⌘K</kbd></button>
      <nav class="nav" id="nav">${NAV.map(
        ([id, label], i) => `<a href="#/${id}" data-nav="${id}">${icon(ICON_FOR[id])}<span>${label}</span><span class="count" hidden></span><span class="key">⌘${i + 1}</span></a>`,
      ).join("")}</nav>
      <div class="nav-label"><span>Spaces</span></div>
      <nav class="nav spaces">${SPACES.map(
        ([id, label]) => `<a href="#/${id}" data-nav="${id}" data-body="${id}">${icon(ICON_FOR[id])}<span>${label}</span><span class="count live-count" hidden></span><span class="key">⌘9</span></a>`,
      ).join("")}</nav>
      <div class="nav-label"><span>Members</span><span id="roster-count"></span></div>
      <div class="roster" id="roster"></div>`;

const TRAINER_SIDEBAR = `
      <div class="brand">${avatar("trainer", "brand-avatar")}<div><div class="brand-name">Galaxy Trainer</div><div class="brand-sub">GalaxyAI · coach</div></div></div>
      <nav class="nav" id="nav"><a href="#/trainer" data-nav="trainer">${icon("overview")}<span>Squad</span><span class="count live-count" hidden></span></a></nav>
      <div class="nav-label"><span>Trainees</span><span id="roster-count"></span></div>
      <div class="roster trainee-roster" id="roster"></div>`;

document.body.innerHTML = `
  <div class="backdrop"></div>
  <div class="shell">
    <aside class="sidebar">${TRAINER_APP ? TRAINER_SIDEBAR : LINK_SIDEBAR}
      <div class="sidebar-foot"><div class="presence" id="presence"></div></div>
    </aside>
    <main class="main">
      <div class="topbar"><div class="crumb" id="crumb"></div><div class="link-state" id="link-state"><span class="lamp"></span>Connecting</div></div>
      <div class="view" id="view"></div>
    </main>
  </div>`;

let current = null;
const clockNow = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
setInterval(() => {
  const el = $("#clock");
  if (el) el.textContent = clockNow();
}, 15_000);

/** "#/chat" is the chat page; "#/member/nova" is Nova's own page. */
function currentRoute() {
  const [id, param = ""] = location.hash.replace(/^#\/?/, "").split("?")[0].split("/");
  if (id === "trainer" && param) return ["training", param];
  if (TRAINER_APP) return ["trainer", ""];
  return VIEWS[id] ? [id, param] : ["overview", ""];
}
let param = "";

function show() {
  const [id, arg] = currentRoute();
  const view = VIEWS[id];
  current = id;
  param = arg;
  closeDrawer();
  const box = $("#view");
  box.className = view.flush ? "view flush" : "view";
  box.innerHTML = view.render(param);
  box.scrollTop = 0;
  view.mount?.(box);
  document.title = `${id === "member" || id === "training" ? param.charAt(0).toUpperCase() + param.slice(1) : view.title} · ${TRAINER_APP ? "Galaxy Trainer" : "Galaxy Link"}`;
  for (const a of document.querySelectorAll("[data-nav]")) a.classList.toggle("on", a.dataset.nav === (id === "training" ? "trainer" : id));
  for (const a of document.querySelectorAll(".roster .who")) a.classList.toggle("on", id === "member" && a.dataset.body === param);
  drawCrumb();
}

const CRUMB = { overview: "Overview", chat: "Galaxy Chat", map: "Galaxy Map", handoffs: "Handoffs", approvals: "Approvals", memory: "Memory", activity: "Activity", system: "System", trainer: "Trainer" };
function drawCrumb() {
  const name = esc(param.charAt(0).toUpperCase() + param.slice(1));
  if (TRAINER_APP) {
    $("#crumb").innerHTML =
      current === "training"
        ? `<a href="#/trainer">Galaxy Trainer</a><span class="sep">/</span><b>${name}</b>`
        : `<span>Galaxy Trainer</span><span class="sep">/</span><b>Squad</b>`;
    return;
  }
  $("#crumb").innerHTML =
    current === "training"
      ? `<span>Galaxy Link</span><span class="sep">/</span><a href="#/trainer">Trainer</a><span class="sep">/</span><b>${name}</b>`
      : `<span>Galaxy Link</span><span class="sep">/</span><b>${current === "member" ? name : CRUMB[current] ?? ""}</b>`;
}

function chrome() {
  const o = state.overview;
  const pending = state.pending.pending.length;
  const badge = $('[data-nav="approvals"] .count');
  if (badge) {
    badge.hidden = !pending;
    badge.textContent = pending;
  }

  const bodies = (o?.bodies ?? []).filter((b) => b.id !== "trainer");
  const live = state.training?.members.find((m) => m.latest?.status === "running");
  const liveBadge = $('[data-nav="trainer"] .count');
  liveBadge.hidden = !live;
  liveBadge.textContent = live ? "Live" : "";
  const order = ["comet", "orbit", "nova", "nebula", "zenith"];
  if (TRAINER_APP) {
    $("#roster").innerHTML = TRAINEES.map((id) => traineeRow(id, current === "training" && param === id)).join("");
    const done = (state.training?.members ?? []).filter((m) => m.minutesToday >= (state.training?.minutesPerDay ?? 12) - 1).length;
    $("#roster-count").textContent = state.training ? `${done}/${TRAINEES.length} done` : "";
  } else $("#roster").innerHTML = [...bodies]
    .sort((a, b) => (order.indexOf(a.id) + 99) % 99 - (order.indexOf(b.id) + 99) % 99)
    .map(
      (b) => {
        const word = b.working ? "working" : b.online ? "ready" : b.joined ? "off" : "not joined";
        return `<a class="who ${b.online ? "" : "off"} ${b.working ? "busy" : ""}${current === "member" && param === b.id ? " on" : ""}" href="#/member/${b.id}" data-body="${b.id}">
        <span class="avatar xs">${glyph(b.id)}</span><span class="nm">${esc(b.name)}</span>
        <span class="state"><span class="lamp ${b.online ? "on" : b.joined ? "" : "never"}"></span>${word}</span>
        ${b.working ? `<span class="busy-line"><i></i></span>` : ""}</a>`;
      },
    )
    .join("");

  if (!TRAINER_APP) $("#roster-count").textContent = bodies.length ? `${bodies.filter((b) => b.online).length}/${bodies.length}` : "";

  const atMac = o?.presence?.atMac;
  $("#presence").innerHTML = o
    ? `<span class="avatar sm" data-body="you">${glyph("you")}</span><div><b>${atMac ? "At the Mac" : "Away"}</b><span>${atMac ? "Results on screen" : "Results to your phone"}</span></div><time id="clock">${clockNow()}</time>`
    : "";

  const link = $("#link-state");
  link.innerHTML =
    state.connected === false
      ? `<span class="lamp" style="background:var(--bad)"></span>Link offline`
      : state.connected
        ? `<span class="lamp on" style="--c:var(--good)"></span>Link connected${o ? ` · up ${esc(ago(o.startedAt).replace(" ago", ""))}` : ""}`
        : `<span class="lamp"></span>Connecting`;

  let off = $(".offline");
  if (state.connected === false && !off) {
    off = document.createElement("div");
    off.className = "offline";
    off.innerHTML = `<div class="box">${brandMark()}<h1>Galaxy Link isn't running</h1>
      <p>The members can't reach each other until it starts. It normally starts on its own when you log in. To start it now, run this in Terminal:</p>
      <code>launchctl kickstart gui/$(id -u)/ai.galaxy.link</code>
      <p class="muted" style="margin-top:16px;font-size:12.5px">This page reconnects by itself.</p></div>`;
    document.body.append(off);
  } else if (state.connected && off) {
    off.remove();
  }
}

/** What the pages are drawn from, minus what changes every second, so a page redraws only when it should. */
function signature() {
  const o = state.overview;
  return JSON.stringify([
    o && { ...o, now: 0, presence: o.presence?.atMac },
    state.tasks.map((t) => [t.id, t.status, t.updatedAt, t.progress]),
    state.events.length && state.events[state.events.length - 1].id,
    state.approvals.map((a) => [a.id, a.status]),
    state.pending.version,
    state.chat.length && state.chat[state.chat.length - 1].id,
    state.training && { ...state.training, members: state.training.members },
    Object.values(state.threads).reduce((n, l) => n + l.length, 0),
    Math.floor(Date.now() / 60_000), // relative times ("3 min ago") move on once a minute
  ]);
}
let drawn = "";

subscribe((what) => {
  chrome();
  const view = VIEWS[current];
  if (!view) return;
  const sig = signature();
  if (view.update) view.update(what);
  else if (view.deps?.some((d) => what.has(d)) && sig !== drawn) {
    drawn = sig;
    const box = $("#view");
    const top = box.scrollTop;
    box.innerHTML = view.render(param).replace('class="page"', 'class="page" style="animation:none"');
    view.mount?.(box);
    box.scrollTop = top;
  }
});

window.addEventListener("hashchange", () => {
  drawn = "";
  show();
});
const openSearch = () => openPalette([...NAV, ...SPACES].map(([id, label]) => [id, label, ICON_FOR[id]]));
if ($("#search-trigger")) $("#search-trigger").onclick = openSearch;
document.addEventListener("keydown", (e) => {
  if (e.metaKey && e.key.toLowerCase() === "k" && !TRAINER_APP) {
    e.preventDefault();
    return $(".palette-scrim") ? closePalette() : openSearch();
  }
  if (e.key === "Escape") closeDrawer();
  if (e.metaKey && /^[1-9]$/.test(e.key) && !TRAINER_APP) {
    e.preventDefault();
    location.hash = `#/${[...NAV, ...SPACES][Number(e.key) - 1][0]}`;
  }
});

show();
chrome();
start();
