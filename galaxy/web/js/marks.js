// Every member's mark, and the app's line icons. Drawn here, so there are no
// image files to keep in step and every mark takes its member's colour.

export const MEMBERS = {
  comet: { name: "Comet", sense: "Text", role: "iMessage, wherever you are" },
  orbit: { name: "Orbit", sense: "Voice", role: "Speaks only when spoken to" },
  nova: { name: "Nova", sense: "Sight", role: "On your screen, one ⌃Space away" },
  nebula: { name: "Nebula", sense: "Touch", role: "Gestures, on your Mac" },
  zenith: { name: "Zenith", sense: "Time", role: "Commands the long missions" },
};
export const ORDER = ["comet", "orbit", "nova", "nebula", "zenith"];
/** The member colours as plain values, for SVG attributes (which can't read CSS variables). */
export const HEX = { comet: "#ffb547", orbit: "#ff5a4d", nova: "#b9a6ff", nebula: "#4fe0c2", zenith: "#6fa8ff", you: "#f3f4f6" };
export const hex = (id) => HEX[id] ?? "#c7ccd6";

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

/** The Galaxy Link mark: five members held around one centre. */
export function brandMark(cls = "brand-mark") {
  const colors = ORDER.map(hex);
  const dots = colors
    .map((c, i) => {
      const a = (-90 + i * 72) * (Math.PI / 180);
      return `<circle cx="${(16 + 11 * Math.cos(a)).toFixed(2)}" cy="${(16 + 11 * Math.sin(a)).toFixed(2)}" r="2.6" fill="${c}"/>`;
    })
    .join("");
  return `<svg class="${cls}" viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="11" fill="none" stroke="#2a2f3b" stroke-width="1"/>
    <circle cx="16" cy="16" r="3.4" fill="#f3f4f6"/>${dots}</svg>`;
}

const ICONS = {
  overview: `<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>`,
  chat: `<path d="M20 11.5c0 4.1-3.6 7.2-8 7.2-1.1 0-2.2-.2-3.1-.5L4 20l1.3-3.6C4.5 15.1 4 13.4 4 11.5 4 7.4 7.6 4.3 12 4.3s8 3.1 8 7.2Z"/>`,
  map: `<circle cx="6" cy="7" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="12" cy="17.5" r="2.2"/><path d="m8 8.2 2.8 7.4M16.6 7.8l-3.4 7.7M8.2 6.8l7.6-.6"/>`,
  handoffs: `<path d="M4 8h13m0 0-3.5-3.5M17 8l-3.5 3.5M20 16H7m0 0 3.5-3.5M7 16l3.5 3.5"/>`,
  approvals: `<circle cx="12" cy="12" r="8.5"/><path d="m8.4 12.2 2.4 2.4 4.8-5"/>`,
  memory: `<path d="M5 6.5c0-1.4 3.1-2.5 7-2.5s7 1.1 7 2.5-3.1 2.5-7 2.5-7-1.1-7-2.5Z"/><path d="M5 6.5v5.5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6.5"/><path d="M5 12v5.5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V12"/>`,
  activity: `<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>`,
  system: `<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>`,
  search: `<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>`,
  arrow: `<path d="M5 12h14m0 0-5-5m5 5-5 5"/>`,
  check: `<path d="m5 12.5 4.2 4.2L19 7"/>`,
  x: `<path d="M6 6l12 12M18 6 6 18"/>`,
  edit: `<path d="M14.5 5.5 18.5 9.5 9 19H5v-4z"/>`,
  trash: `<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  eye: `<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>`,
  web: `<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.6 3.5 5.4 3.5 8.5s-1.1 5.9-3.5 8.5c-2.4-2.6-3.5-5.4-3.5-8.5S9.6 6.1 12 3.5Z"/>`,
  mail: `<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>`,
  down: `<path d="M12 5v14m0 0-6-6m6 6 6-6"/>`,
};

export function icon(name, cls = "") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
}
