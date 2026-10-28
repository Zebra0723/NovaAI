// Galaxy Link: the shell, the router, and keeping the current page live.

import { brandMark, glyph, icon } from "./marks.js";
import { start, state, subscribe } from "./state.js";
import { $, ago, esc } from "./util.js";
import { closeDrawer, VIEWS } from "./views.js";
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
const ICON_FOR = { overview: "overview", chat: "chat", map: "map", handoffs: "handoffs", approvals: "approvals", memory: "memory", activity: "activity", system: "system" };

document.body.innerHTML = `
  <div class="backdrop"></div>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">${brandMark()}<div><div class="brand-name">Galaxy Link</div><div class="brand-sub">GalaxyAI · hub</div></div></div>
      <button class="search-trigger" id="search-trigger">${icon("search")}Search<kbd>⌘K</kbd></button>
      <nav class="nav" id="nav">${NAV.map(
        ([id, label], i) => `<a href="#/${id}" data-nav="${id}">${icon(ICON_FOR[id])}<span>${label}</span><span class="count" hidden></span><span class="key">⌘${i + 1}</span></a>`,
      ).join("")}</nav>
      <div class="nav-label"><span>Members</span><span id="roster-count"></span></div>
      <div class="roster" id="roster"></div>
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
  document.title = `${id === "member" ? param.charAt(0).toUpperCase() + param.slice(1) : view.title} · Galaxy Link`;
  for (const a of document.querySelectorAll("[data-nav]")) a.classList.toggle("on", a.dataset.nav === id);
  for (const a of document.querySelectorAll(".roster .who")) a.classList.toggle("on", id === "member" && a.dataset.body === param);
  drawCrumb();
}

const CRUMB = { overview: "Overview", chat: "Galaxy Chat", map: "Galaxy Map", handoffs: "Handoffs", approvals: "Approvals", memory: "Memory", activity: "Activity", system: "System" };
function drawCrumb() {
  $("#crumb").innerHTML = `<span>Galaxy Link</span><span class="sep">/</span><b>${
    current === "member" ? esc(param.charAt(0).toUpperCase() + param.slice(1)) : CRUMB[current] ?? ""
  }</b>`;
}

function chrome() {
  const o = state.overview;
  const pending = state.pending.pending.length;
  const badge = $('[data-nav="approvals"] .count');
  badge.hidden = !pending;
  badge.textContent = pending;

  const bodies = o?.bodies ?? [];
  const order = ["comet", "orbit", "nova", "nebula", "zenith"];
  $("#roster").innerHTML = [...bodies]
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

  $("#roster-count").textContent = bodies.length ? `${bodies.filter((b) => b.online).length}/${bodies.length}` : "";

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
const openSearch = () => openPalette(NAV.map(([id, label]) => [id, label, ICON_FOR[id]]));
$("#search-trigger").onclick = openSearch;
document.addEventListener("keydown", (e) => {
  if (e.metaKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    return $(".palette-scrim") ? closePalette() : openSearch();
  }
  if (e.key === "Escape") closeDrawer();
  if (e.metaKey && /^[1-8]$/.test(e.key)) {
    e.preventDefault();
    location.hash = `#/${NAV[Number(e.key) - 1][0]}`;
  }
});

show();
chrome();
start();
