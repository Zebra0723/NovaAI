// Galaxy Link: the shell, the router, and keeping the current page live.

import { brandMark, glyph, icon } from "./marks.js";
import { start, state, subscribe } from "./state.js";
import { $, ago, esc } from "./util.js";
import { closeDrawer, VIEWS } from "./views.js";

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
      <div class="brand">${brandMark()}<div><div class="brand-name">Galaxy Link</div><div class="brand-sub">GalaxyAI</div></div></div>
      <nav class="nav" id="nav">${NAV.map(
        ([id, label], i) => `<a href="#/${id}" data-nav="${id}">${icon(ICON_FOR[id])}<span>${label}</span><span class="count" hidden></span><span class="key">⌘${i + 1}</span></a>`,
      ).join("")}</nav>
      <div class="nav-label">Members</div>
      <div class="roster" id="roster"></div>
      <div class="sidebar-foot"><div class="presence" id="presence"></div></div>
    </aside>
    <main class="main">
      <div class="topbar"><div class="link-state" id="link-state"><span class="lamp"></span>Connecting</div></div>
      <div class="view" id="view"></div>
    </main>
  </div>`;

let current = null;

function currentRoute() {
  const id = location.hash.replace(/^#\/?/, "").split("?")[0];
  return VIEWS[id] ? id : "overview";
}

function show() {
  const id = currentRoute();
  const view = VIEWS[id];
  current = id;
  closeDrawer();
  const box = $("#view");
  box.className = view.flush ? "view flush" : "view";
  box.innerHTML = view.render();
  box.scrollTop = 0;
  view.mount?.(box);
  document.title = `${view.title} · Galaxy Link`;
  for (const a of document.querySelectorAll("[data-nav]")) a.classList.toggle("on", a.dataset.nav === id);
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
      (b) => `<a class="who ${b.online ? "" : "off"}" href="#/chat" data-body="${b.id}">
        ${glyph(b.id, "glyph-sm")}${esc(b.name)}
        <span class="state"><span class="lamp ${b.online ? "on" : b.joined ? "" : "never"}"></span></span></a>`,
    )
    .join("");

  const atMac = o?.presence?.atMac;
  $("#presence").innerHTML = o
    ? `<span class="lamp on" style="--c:${atMac ? "var(--good)" : "var(--zenith)"}"></span><div><b>${atMac ? "You're at the Mac" : "You're away"}</b><span>${
        atMac ? "Results show on the screen." : "Results go to your phone through Comet."
      }</span></div>`
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

subscribe((what) => {
  chrome();
  const view = VIEWS[current];
  if (!view) return;
  if (view.update) view.update(what);
  else if (view.deps?.some((d) => what.has(d))) {
    const box = $("#view");
    const top = box.scrollTop;
    box.innerHTML = view.render().replace('class="page"', 'class="page" style="animation:none"');
    view.mount?.(box);
    box.scrollTop = top;
  }
});

window.addEventListener("hashchange", show);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDrawer();
  if (e.metaKey && /^[1-8]$/.test(e.key)) {
    e.preventDefault();
    location.hash = `#/${NAV[Number(e.key) - 1][0]}`;
  }
});

show();
chrome();
start();
