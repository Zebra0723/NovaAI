// Every member's mark and colour, the same as in Galaxy Link.

export const MEMBERS = {
  comet: { name: "Comet", sense: "Text", color: "#d97706" },
  nova: { name: "Nova", sense: "Sight", color: "#6d4aff" },
  orbit: { name: "Orbit", sense: "Voice", color: "#dc2626" },
  nebula: { name: "Nebula", sense: "Touch", color: "#059669" },
  zenith: { name: "Zenith", sense: "Time", color: "#2563eb" },
  link: { name: "Galaxy Link", sense: "Hub", color: "#141413" },
  trainer: { name: "Trainer", sense: "Practice", color: "#be185d" },
  medic: { name: "Medic", sense: "Health", color: "#0e7490" },
  you: { name: "You", sense: "", color: "#141413" },
};

const GLYPHS = {
  comet: `<circle cx="16.2" cy="7.8" r="3.4" fill="currentColor"/><path d="M13.6 10.4 4 20" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M12.6 7.6 6.2 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".45"/><path d="M16.4 11.6 10 18" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".45"/>`,
  nova: `<path d="M12 2.5c.55 5.4 3.05 7.9 8.5 9.5-5.45 1.6-7.95 4.1-8.5 9.5-.55-5.4-3.05-7.9-8.5-9.5 5.45-1.6 7.95-4.1 8.5-9.5Z" fill="currentColor"/>`,
  orbit: `<path d="M15.57 5.89A7.6 7.6 0 1 1 8.43 5.89" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"/><circle cx="12" cy="5" r="2.2" fill="currentColor"/>`,
  nebula: `<circle cx="12" cy="16.4" r="2.4" fill="currentColor"/><path d="M7.4 13.2a6.2 6.2 0 0 1 9.2 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"/><path d="M4.2 10.2a10.6 10.6 0 0 1 15.6 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none" opacity=".55"/>`,
  zenith: `<path d="M4.5 17.5 12 6l7.5 11.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="12" cy="6" r="2" fill="currentColor"/><path d="M2.5 20.5h19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".45"/>`,
  trainer: `<circle cx="12" cy="13.6" r="7.4" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 13.6 15.2 10.4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="13.6" r="1.6" fill="currentColor"/><path d="M9.6 3h4.8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>`,
  medic: `<path d="M12 20.2s-7.4-4.4-7.4-10a4.1 4.1 0 0 1 7.4-2.4 4.1 4.1 0 0 1 7.4 2.4c0 5.6-7.4 10-7.4 10Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/><path d="M7.6 12.2h2.2l1.2-2.4 2 4.6 1.3-2.2h2.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  link: `<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6" fill="none" opacity=".45"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/>`,
  you: `<circle cx="12" cy="8.6" r="3.6" fill="currentColor"/><path d="M4.8 20.2c.9-3.8 3.6-5.8 7.2-5.8s6.3 2 7.2 5.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>`,
};

export const glyph = (id) => `<svg viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[id] ?? GLYPHS.link}</svg>`;

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A message in a Galaxy Chat window. */
export function chatLine(id, text, { who = MEMBERS[id]?.name ?? id, cls = "" } = {}) {
  const el = document.createElement("div");
  el.className = `msg ${id === "you" ? "you" : ""} ${cls}`;
  el.style.setProperty("--c", MEMBERS[id]?.color ?? "#57534c");
  el.innerHTML = `${id === "you" ? "" : `<span class="av">${glyph(id)}</span>`}<div class="bubble">${id === "you" || cls === "sys" ? "" : `<span class="who">${esc(who)}</span>`}${text}</div>`;
  return el;
}

/** "…" from a member while it works, removed when it answers. */
export async function typing(box, id, ms) {
  const t = chatLine(id, `<span class="typing"><i></i><i></i><i></i></span>`);
  box.append(t);
  box.scrollTop = box.scrollHeight;
  await sleep(ms);
  t.remove();
}
