import { LUCIDE } from "./lucide.js";

// Every member's mark, and the app's line icons. Drawn here, so there are no
// image files to keep in step and every mark takes its member's colour.

export const MEMBERS = {
  comet: { name: "Comet", sense: "Text", role: "iMessage, wherever you are" },
  orbit: { name: "Orbit", sense: "Voice", role: "Speaks only when spoken to" },
  nova: { name: "Nova", sense: "Sight", role: "On your screen, one ⌃Space away" },
  nebula: { name: "Nebula", sense: "Touch", role: "Gestures, on your Mac" },
  zenith: { name: "Zenith", sense: "Time", role: "Commands the long missions" },
  trainer: { name: "Trainer", sense: "Practice", role: "Twelve minutes a day with every member" },
  medic: { name: "Medic", sense: "Health", role: "Keeps every member running" },
  link: { name: "Galaxy Link", sense: "Hub", role: "Where the members meet" },
};
export const ORDER = ["comet", "orbit", "nova", "nebula", "zenith"];
/** The member colours as plain values, for SVG attributes (which can't read CSS variables). */
export const HEX = { comet: "#d97706", orbit: "#dc2626", nova: "#6d4aff", nebula: "#059669", zenith: "#2563eb", trainer: "#be185d", medic: "#0e7490", link: "#141413", you: "#1c1917" };
export const hex = (id) => HEX[id] ?? "#78716c";

const GLYPHS = {
  // A head with a tapering tail.
  comet: `<circle cx="16.2" cy="7.8" r="3.4" fill="currentColor"/>
    <path d="M13.6 10.4 4 20" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
    <path d="M12.6 7.6 6.2 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".45"/>
    <path d="M16.4 11.6 10 18" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".45"/>`,
  // Orbit's own mark: a ring with one body on it.
  orbit: `<path d="M15.57 5.89A7.6 7.6 0 1 1 8.43 5.89" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"/>
    <circle cx="12" cy="5" r="2.2" fill="currentColor"/>`,
  // Nova's four-point star.
  nova: `<path d="M12 2.5c.55 5.4 3.05 7.9 8.5 9.5-5.45 1.6-7.95 4.1-8.5 9.5-.55-5.4-3.05-7.9-8.5-9.5 5.45-1.6 7.95-4.1 8.5-9.5Z" fill="currentColor"/>`,
  // A touch, and the ripples it sends out.
  nebula: `<circle cx="12" cy="16.4" r="2.4" fill="currentColor"/>
    <path d="M7.4 13.2a6.2 6.2 0 0 1 9.2 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"/>
    <path d="M4.2 10.2a10.6 10.6 0 0 1 15.6 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none" opacity=".55"/>`,
  // The highest point, over the horizon.
  zenith: `<path d="M4.5 17.5 12 6l7.5 11.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <circle cx="12" cy="6" r="2" fill="currentColor"/>
    <path d="M2.5 20.5h19" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".45"/>`,
  // A stopwatch: Trainer's twelve minutes.
  trainer: `<circle cx="12" cy="13.6" r="7.4" stroke="currentColor" stroke-width="1.8" fill="none"/>
    <path d="M12 13.6 15.2 10.4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
    <circle cx="12" cy="13.6" r="1.6" fill="currentColor"/>
    <path d="M9.6 3h4.8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
    <path d="M18.4 6.2l1.3-1.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" opacity=".55"/>`,
  // A heart and its beat.
  medic: `<path d="M12 20.2s-7.4-4.4-7.4-10a4.1 4.1 0 0 1 7.4-2.4 4.1 4.1 0 0 1 7.4 2.4c0 5.6-7.4 10-7.4 10Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" fill="none"/>
    <path d="M7.6 12.2h2.2l1.2-2.4 2 4.6 1.3-2.2h2.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  // Link: the hub, as on the map.
  link: `<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.6" fill="none" opacity=".45"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/>`,
  you: `<circle cx="12" cy="8.6" r="3.6" fill="currentColor"/>
    <path d="M4.8 20.2c.9-3.8 3.6-5.8 7.2-5.8s6.3 2 7.2 5.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>`,
  other: `<circle cx="12" cy="12" r="5" fill="currentColor"/>`,
};

export function glyph(id, cls = "") {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[id] ?? GLYPHS.other}</svg>`;
}

export function avatar(id, size = "", extra = "") {
  return `<span class="avatar ${size} ${extra}" data-body="${id}">${glyph(id)}</span>`;
}

/** The Galaxy Link mark: five members held on one orbit around a centre. */
export function brandMark(cls = "brand-mark") {
  const dots = ORDER.map((id, i) => {
    const a = ((-90 + i * 72) * Math.PI) / 180;
    return `<circle cx="${(16 + 10 * Math.cos(a)).toFixed(2)}" cy="${(16 + 10 * Math.sin(a)).toFixed(2)}" r="2.3" fill="${hex(id)}"/>`;
  }).join("");
  return `<svg class="${cls}" viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="10" fill="none" stroke="currentColor" stroke-opacity=".22" stroke-width="1"/>
    <circle cx="16" cy="16" r="3.4" fill="currentColor"/>${dots}</svg>`;
}

export function icon(name, cls = "") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LUCIDE[name] ?? ""}</svg>`;
}
