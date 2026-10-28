import { MEMBERS } from "./marks.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function nameOf(id) {
  if (id === "you") return "You";
  return MEMBERS[id]?.name ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export function ago(ms, now = Date.now()) {
  if (!ms) return "never";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  if (s < 90) return "1 min ago";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 5400) return "1 hr ago";
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function clock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function dayLabel(ms) {
  const d = new Date(ms);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

export function shortDate(ms) {
  const d = new Date(ms);
  if (d.toDateString() === new Date().toDateString()) return clock(ms);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Message text: escaped, with @Names in their member's colour and links made clickable. */
export function richText(text) {
  let html = esc(text);
  html = html.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/@(Comet|Orbit|Nova|Nebula|Zenith)\b/g, (_, n) => `<span class="at" data-body="${n.toLowerCase()}">@${n}</span>`);
  return html;
}

export function toast(text) {
  let host = $(".toasts");
  if (!host) {
    host = document.createElement("div");
    host.className = "toasts";
    document.body.append(host);
  }
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.2 4.2L19 7"/></svg>${esc(text)}`;
  host.append(el);
  setTimeout(() => {
    el.style.transition = "opacity .3s";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, 2400);
}
