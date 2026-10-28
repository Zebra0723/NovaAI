#!/usr/bin/env node
// Draws Galaxy Link's app icon as a vector illustration and renders it with Chromium,
// so it gets real blur, glass and depth. Writes Resources/AppIcon.png (1024px).
//
//   node scripts/make-icon.mjs            needs Playwright (npm i -g playwright)
//   node scripts/make-icon.mjs --svg      also writes Resources/AppIcon.svg
//
// The picture: a porcelain tile; a tilted orbit that passes behind and in front of
// a glossy dark core (Link); the five members riding it at different depths, each a
// glass sphere carrying its own mark; the orbit's colour flowing from one member to the next.

import { createRequire } from "module";
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "Resources");

const MEMBERS = [
  // name, colour, highlight, deep shade, angle on the orbit (degrees; 90 = nearest you)
  ["comet", "#f59e0b", "#ffd88a", "#b45309", 270],
  ["orbit", "#ef4444", "#ffb0a6", "#991b1b", 342],
  ["nova", "#7c5cff", "#c9bbff", "#4325c4", 54],
  ["nebula", "#10b981", "#9af0cf", "#047857", 126],
  ["zenith", "#3b82f6", "#a9cbff", "#1d4ed8", 198],
];

// The members' marks, in a 24-unit box (the same shapes the app draws).
const MARKS = {
  comet: `<circle cx="16.2" cy="7.8" r="3.4" fill="#fff"/>
    <path d="M13.6 10.4 4 20" stroke="#fff" stroke-width="2.1" stroke-linecap="round"/>
    <path d="M12.6 7.6 6.2 14M16.4 11.6 10 18" stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity=".55"/>`,
  orbit: `<path d="M15.57 5.89A7.6 7.6 0 1 1 8.43 5.89" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none"/>
    <circle cx="12" cy="5" r="2.4" fill="#fff"/>`,
  nova: `<path d="M12 2.5c.55 5.4 3.05 7.9 8.5 9.5-5.45 1.6-7.95 4.1-8.5 9.5-.55-5.4-3.05-7.9-8.5-9.5 5.45-1.6 7.95-4.1 8.5-9.5Z" fill="#fff"/>`,
  nebula: `<circle cx="12" cy="16.4" r="2.5" fill="#fff"/>
    <path d="M7.4 13.2a6.2 6.2 0 0 1 9.2 0" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none"/>
    <path d="M4.2 10.2a10.6 10.6 0 0 1 15.6 0" stroke="#fff" stroke-width="2" stroke-linecap="round" fill="none" opacity=".6"/>`,
  zenith: `<path d="M4.5 17.5 12 6l7.5 11.5" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <circle cx="12" cy="6" r="2.2" fill="#fff"/>
    <path d="M2.5 20.8h19" stroke="#fff" stroke-width="1.7" stroke-linecap="round" opacity=".55"/>`,
};

// The orbit: an ellipse tilted a little, centred on the core.
const CX = 512, CY = 520, RX = 296, RY = 178, TILT = -14;
const rad = (d) => (d * Math.PI) / 180;
function onOrbit(deg) {
  const t = rad(deg);
  const x = RX * Math.cos(t), y = RY * Math.sin(t);
  const k = rad(TILT);
  return { x: CX + x * Math.cos(k) - y * Math.sin(k), y: CY + x * Math.sin(k) + y * Math.cos(k), depth: Math.sin(t) };
}

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c) => `rgb(${c.join(",")})`;

// The ring's colour at an angle: each member's colour, flowing into the next one's.
function ringColor(deg) {
  const sorted = [...MEMBERS].sort((a, b) => a[4] - b[4]);
  const d = ((deg % 360) + 360) % 360;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i], b = sorted[(i + 1) % sorted.length];
    let start = a[4], end = b[4];
    if (end <= start) end += 360;
    let x = d < start ? d + 360 : d;
    if (x >= start && x < end) {
      let t = (x - start) / (end - start);
      t = t * t * (3 - 2 * t);
      return lerp(hexToRgb(a[1]), hexToRgb(b[1]), t);
    }
  }
  return hexToRgb(MEMBERS[0][1]);
}

function ringSegments(from, to, width, opacity) {
  let out = "";
  const step = 2;
  for (let d = from; d < to; d += step) {
    const a = onOrbit(d), b = onOrbit(d + step + 0.6);
    out += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${rgb(ringColor(d))}" stroke-width="${width}" stroke-linecap="round" stroke-opacity="${opacity}"/>`;
  }
  return out;
}

function sphere([name, base, light, deep], x, y, r, id) {
  const s = (r * 1.32) / 24; // the mark fills a comfortable part of the ball
  return `
    <g filter="url(#ballShadow)">
      <circle cx="${x}" cy="${y}" r="${r}" fill="url(#b-${id})"/>
    </g>
    <circle cx="${x}" cy="${y}" r="${r}" fill="url(#rim-${id})"/>
    <g transform="translate(${x - 12 * s} ${y - 12 * s + r * 0.02}) scale(${s})" filter="url(#markShadow)">${MARKS[name]}</g>
    <ellipse cx="${x - r * 0.3}" cy="${y - r * 0.52}" rx="${r * 0.5}" ry="${r * 0.26}" fill="url(#gloss)" transform="rotate(-24 ${x - r * 0.3} ${y - r * 0.52})"/>
    <defs>
      <radialGradient id="b-${id}" cx="34%" cy="28%" r="78%">
        <stop offset="0" stop-color="${light}"/><stop offset=".45" stop-color="${base}"/><stop offset="1" stop-color="${deep}"/>
      </radialGradient>
      <radialGradient id="rim-${id}" cx="50%" cy="50%" r="50%">
        <stop offset=".78" stop-color="${light}" stop-opacity="0"/><stop offset=".97" stop-color="${light}" stop-opacity=".45"/><stop offset="1" stop-color="${light}" stop-opacity="0"/>
      </radialGradient>
    </defs>`;
}

function svg() {
  const placed = MEMBERS.map((m, i) => ({ m, i, ...onOrbit(m[4]) })).sort((a, b) => a.depth - b.depth);
  const radius = (depth) => 70 + depth * 20;

  const back = placed.filter((p) => p.depth < 0);
  const front = placed.filter((p) => p.depth >= 0);

  // Light from each member toward the core: Link.
  const beams = placed
    .map(({ m, x, y }) => `<line x1="${CX}" y1="${CY}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${m[1]}" stroke-width="7" stroke-linecap="round" stroke-opacity=".38"/>`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <clipPath id="tile"><rect x="100" y="100" width="824" height="824" rx="186"/></clipPath>
    <linearGradient id="tileFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#f3f5fa"/><stop offset="1" stop-color="#e2e7f0"/>
    </linearGradient>
    <radialGradient id="aura" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#8b7bff" stop-opacity=".55"/><stop offset=".45" stop-color="#5ea2ff" stop-opacity=".22"/><stop offset="1" stop-color="#5ea2ff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="core" cx="36%" cy="30%" r="80%">
      <stop offset="0" stop-color="#4a5675"/><stop offset=".35" stop-color="#1b2238"/><stop offset=".8" stop-color="#0a0e1a"/><stop offset="1" stop-color="#05070d"/>
    </radialGradient>
    <linearGradient id="coreRim" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffd88a"/><stop offset=".25" stop-color="#ff9f9f"/><stop offset=".5" stop-color="#c9bbff"/><stop offset=".75" stop-color="#7fe6c8"/><stop offset="1" stop-color="#9ec5ff"/>
    </linearGradient>
    <radialGradient id="gloss" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".6" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <filter id="tileShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#0b1220" flood-opacity=".26"/>
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#0b1220" flood-opacity=".12"/>
    </filter>
    <filter id="ballShadow" x="-60%" y="-60%" width="220%" height="220%">
      <feDropShadow dx="0" dy="12" stdDeviation="11" flood-color="#101828" flood-opacity=".28"/>
    </filter>
    <filter id="coreShadow" x="-60%" y="-60%" width="220%" height="220%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#0b1220" flood-opacity=".45"/>
    </filter>
    <filter id="markShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy=".35" stdDeviation=".35" flood-color="#000" flood-opacity=".28"/>
    </filter>
    <filter id="blur40" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="40"/></filter>
    <filter id="blur10" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="10"/></filter>
    <filter id="blur4" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4"/></filter>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7"/>
      <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .05 0"/>
    </filter>
  </defs>

  <!-- The tile -->
  <g filter="url(#tileShadow)"><rect x="100" y="100" width="824" height="824" rx="186" fill="url(#tileFill)"/></g>
  <g clip-path="url(#tile)">
    <!-- Coloured light through glass, one wash per member -->
    ${MEMBERS.map((m) => { const p = onOrbit(m[4]); return `<circle cx="${p.x}" cy="${p.y}" r="210" fill="${m[1]}" opacity=".12" filter="url(#blur40)"/>`; }).join("")}
    <circle cx="${CX}" cy="${CY}" r="250" fill="url(#aura)" filter="url(#blur10)"/>
    <rect x="100" y="100" width="824" height="824" filter="url(#grain)"/>

    <!-- Faint guide orbits, outside and inside -->
    <ellipse cx="${CX}" cy="${CY}" rx="${RX + 84}" ry="${RY + 62}" transform="rotate(${TILT} ${CX} ${CY})" fill="none" stroke="#c8cfdc" stroke-width="2" stroke-dasharray="2 13" stroke-linecap="round"/>
    <ellipse cx="${CX}" cy="${CY}" rx="${RX - 118}" ry="${RY - 70}" transform="rotate(${TILT} ${CX} ${CY})" fill="none" stroke="#d3d9e4" stroke-width="2"/>

    <!-- The half of the orbit behind the core -->
    <g filter="url(#blur4)" opacity=".5">${ringSegments(180, 360, 20, 0.5)}</g>
    ${ringSegments(180, 360, 9, 0.85)}
    ${back.map((p) => sphere(p.m, p.x, p.y, radius(p.depth), p.i)).join("")}

    <!-- Link: the core, and a beam to every member -->
    ${beams}
    <ellipse cx="${CX}" cy="${CY + 142}" rx="140" ry="24" fill="#0b1220" opacity=".16" filter="url(#blur10)"/>
    <g filter="url(#coreShadow)"><circle cx="${CX}" cy="${CY}" r="118" fill="url(#core)"/></g>
    <circle cx="${CX}" cy="${CY}" r="116" fill="none" stroke="url(#coreRim)" stroke-width="5" opacity=".9"/>
    <circle cx="${CX}" cy="${CY}" r="106" fill="none" stroke="#ffffff" stroke-opacity=".08" stroke-width="2"/>
    ${MEMBERS.map((m, i) => { const a = rad(-90 + i * 72); const x = CX + 52 * Math.cos(a), y = CY + 52 * Math.sin(a);
      return `<circle cx="${x}" cy="${y}" r="18" fill="${m[1]}" opacity=".6" filter="url(#blur10)"/><circle cx="${x}" cy="${y}" r="8" fill="${m[2]}"/>`; }).join("")}
    <circle cx="${CX}" cy="${CY}" r="11" fill="#ffffff" opacity=".92"/>
    <ellipse cx="${CX - 36}" cy="${CY - 56}" rx="48" ry="21" fill="url(#gloss)" opacity=".55" transform="rotate(-26 ${CX - 36} ${CY - 56})"/>

    <!-- The half of the orbit in front -->
    <g filter="url(#blur4)" opacity=".5">${ringSegments(0, 180, 20, 0.5)}</g>
    ${ringSegments(0, 180, 9, 1)}
    ${front.map((p) => sphere(p.m, p.x, p.y, radius(p.depth), p.i)).join("")}

    <!-- Glass: a sheen over the top half, and a bright edge -->
    <path d="M100 286 A186 186 0 0 1 286 100 H738 A186 186 0 0 1 924 286 V420 C700 470 324 470 100 420 Z" fill="url(#sheen)" opacity=".28"/>
  </g>
  <rect x="101.5" y="101.5" width="821" height="821" rx="184.5" fill="none" stroke="#ffffff" stroke-opacity=".9" stroke-width="3"/>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="none" stroke="#0b1220" stroke-opacity=".07" stroke-width="1.5"/>
</svg>`;
}

const doc = svg();
if (process.argv.includes("--svg")) writeFileSync(join(OUT, "AppIcon.svg"), doc);

function findPlaywright() {
  const require = createRequire(import.meta.url);
  const roots = [];
  try { roots.push(execSync("npm root -g", { encoding: "utf8" }).trim()); } catch {}
  for (const root of roots) { try { return require(join(root, "playwright")); } catch {} }
  return require("playwright");
}
const { chromium } = findPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(`<html><body style="margin:0;background:transparent">${doc}</body></html>`);
await page.screenshot({ path: join(OUT, "AppIcon.png"), omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
await browser.close();
console.log("wrote", join(OUT, "AppIcon.png"));
