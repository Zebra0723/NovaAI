// ⌘K: jump anywhere, and find anything the Galaxy has said, done or remembered.

import { api } from "./api.js";
import { avatar, icon } from "./marks.js";
import { state } from "./state.js";
import { $, esc, nameOf, shortDate } from "./util.js";
import { openTask } from "./views.js";

let memories = [];
let hits = [];
let selected = 0;

export function openPalette(pages) {
  if ($(".palette-scrim")) return;
  api.memories().then((m) => (memories = m ?? [])).catch(() => {});
  const scrim = document.createElement("div");
  scrim.className = "palette-scrim";
  scrim.innerHTML = `<div class="palette" role="dialog" aria-label="Search">
    <div class="q">${icon("search")}<input id="palette-q" placeholder="Search the Galaxy, or jump to a page" autocomplete="off" spellcheck="false"></div>
    <div class="results" id="palette-results"></div>
    <div class="foot"><span><kbd>↑</kbd> <kbd>↓</kbd> to move</span><span><kbd>Return</kbd> to open</span><span><kbd>Esc</kbd> to close</span></div>
  </div>`;
  document.body.append(scrim);
  const input = $("#palette-q");
  const draw = () => {
    hits = search(input.value.trim().toLowerCase(), pages);
    selected = Math.min(selected, Math.max(hits.length - 1, 0));
    let html = "";
    let group = "";
    hits.forEach((h, i) => {
      if (h.group !== group) {
        html += `<div class="group">${h.group}</div>`;
        group = h.group;
      }
      html += `<div class="hit ${i === selected ? "on" : ""}" data-i="${i}">${h.ico}<span class="t">${h.title}</span><span class="sub">${h.sub ?? ""}</span></div>`;
    });
    $("#palette-results").innerHTML = html || `<div class="empty">Nothing matches.</div>`;
    $(".hit.on")?.scrollIntoView({ block: "nearest" });
  };
  input.addEventListener("input", () => {
    selected = 0;
    draw();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") (selected = Math.min(selected + 1, hits.length - 1)), draw(), e.preventDefault();
    if (e.key === "ArrowUp") (selected = Math.max(selected - 1, 0)), draw(), e.preventDefault();
    if (e.key === "Enter" && hits[selected]) choose(hits[selected]);
    if (e.key === "Escape") closePalette();
  });
  scrim.addEventListener("mousedown", (e) => {
    if (e.target === scrim) return closePalette();
    const hit = e.target.closest(".hit");
    if (hit) choose(hits[Number(hit.dataset.i)]);
  });
  draw();
  input.focus();
  // Memories arrive a moment later.
  setTimeout(draw, 250);
}

export function closePalette() {
  $(".palette-scrim")?.remove();
}

function choose(hit) {
  closePalette();
  hit.go();
}

const box = (name) => `<span class="ico">${icon(name)}</span>`;

function search(q, pages) {
  const out = [];
  const match = (text) => !q || text.toLowerCase().includes(q);
  for (const [id, label, ico] of pages) {
    if (match(label)) out.push({ group: "Pages", ico: box(ico), title: esc(label), go: () => (location.hash = `#/${id}`) });
  }
  if (!q) return out;
  for (const b of state.overview?.bodies ?? []) {
    if (match(b.name)) out.push({ group: "Members", ico: avatar(b.id, "sm"), title: esc(b.name), sub: b.online ? "Running" : "Not running", go: () => (location.hash = "#/chat") });
  }
  for (const t of state.tasks.filter((t) => match(t.title) || match(t.instructions)).slice(0, 6)) {
    out.push({ group: "Handoffs", ico: avatar(t.to, "sm"), title: esc(t.title), sub: `${esc(nameOf(t.from))} → ${esc(nameOf(t.to))}`, go: () => ((location.hash = "#/handoffs"), setTimeout(() => openTask(t.id), 80)) });
  }
  for (const m of memories.filter((m) => match(m.text)).slice(0, 6)) {
    out.push({ group: "Memory", ico: box("memory"), title: esc(m.text), sub: esc(nameOf(m.source === "user" ? "you" : m.source)), go: () => (location.hash = "#/memory") });
  }
  for (const m of state.chat.filter((m) => match(m.text)).slice(-6).reverse()) {
    out.push({ group: "Galaxy Chat", ico: avatar(m.body, "sm"), title: esc(m.text.split("\n")[0]), sub: esc(shortDate(m.at)), go: () => (location.hash = "#/chat") });
  }
  return out;
}
