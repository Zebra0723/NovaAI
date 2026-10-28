#!/usr/bin/env node
// Draws Galaxy Trainer's app icon and renders it with Chromium, like Galaxy Link's.
// Writes Resources/AppIcon-Trainer.png (1024px).
//
//   node scripts/make-trainer-icon.mjs          needs Playwright
//   node scripts/make-trainer-icon.mjs --svg    also writes Resources/AppIcon-Trainer.svg
//
// The picture: a dark glass tile; five rings, one per member in its own colour, each
// filling towards its twelve minutes; at the centre, the stopwatch hand that times them.

import { createRequire } from "module";
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "Resources");

// Outer to inner: colour, light end of the arc, how full the ring is.
const RINGS = [
  ["#f59e0b", "#ffd88a", 0.92],
  ["#ef4444", "#ffb0a6", 0.78],
  ["#7c5cff", "#c9bbff", 0.86],
  ["#10b981", "#9af0cf", 0.7],
  ["#3b82f6", "#a9cbff", 0.95],
];
const C = 512;
const W = 46;
const GAP = 14;
const R0 = 300;

function arc(r, frac) {
  const a0 = -Math.PI / 2;
  const a1 = a0 + frac * 2 * Math.PI;
  const x0 = C + r * Math.cos(a0), y0 = C + r * Math.sin(a0);
  const x1 = C + r * Math.cos(a1), y1 = C + r * Math.sin(a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function end(r, frac) {
  const a = -Math.PI / 2 + frac * 2 * Math.PI;
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a), a };
}

function svg() {
  const rings = RINGS.map(([col, light, frac], i) => {
    const r = R0 - i * (W + GAP);
    const e = end(r, frac);
    return `
    <circle cx="${C}" cy="${C}" r="${r}" fill="none" stroke="${col}" stroke-opacity=".16" stroke-width="${W}"/>
    <path d="${arc(r, frac)}" fill="none" stroke="${col}" stroke-width="${W + 26}" stroke-linecap="round" opacity=".32" filter="url(#glow)"/>
    <path d="${arc(r, frac)}" fill="none" stroke="url(#g${i})" stroke-width="${W}" stroke-linecap="round"/>
    <path d="${arc(r - W / 2 + 7, frac)}" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="5" stroke-linecap="round"/>
    <circle cx="${e.x}" cy="${e.y}" r="${W / 2 - 1}" fill="${light}"/>
    <circle cx="${e.x - 6}" cy="${e.y - 7}" r="${W / 5}" fill="#fff" opacity=".55"/>`;
  }).join("");
  const grads = RINGS.map(([col, light], i) => {
    const r = R0 - i * (W + GAP);
    return `<linearGradient id="g${i}" gradientUnits="userSpaceOnUse" x1="${C - r}" y1="${C + r}" x2="${C + r}" y2="${C - r}"><stop offset="0" stop-color="${col}"/><stop offset="1" stop-color="${light}"/></linearGradient>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26202a"/><stop offset=".55" stop-color="#141116"/><stop offset="1" stop-color="#0b0a0d"/></linearGradient>
    <radialGradient id="bloom" cx=".28" cy=".18" r=".7"><stop offset="0" stop-color="#be185d" stop-opacity=".45"/><stop offset="1" stop-color="#be185d" stop-opacity="0"/></radialGradient>
    <radialGradient id="face" cx=".42" cy=".36" r=".75"><stop offset="0" stop-color="#2d2730"/><stop offset="1" stop-color="#0d0b0f"/></radialGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    ${grads}
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="16"/></filter>
    <filter id="tileShadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="22" stdDeviation="26" flood-color="#000" flood-opacity=".35"/></filter>
    <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .035 0"/></filter>
    <clipPath id="clip"><rect x="100" y="100" width="824" height="824" rx="186"/></clipPath>
  </defs>
  <g filter="url(#tileShadow)"><rect x="100" y="100" width="824" height="824" rx="186" fill="url(#tile)"/></g>
  <g clip-path="url(#clip)">
    <rect x="100" y="100" width="824" height="824" fill="url(#bloom)"/>
    <rect x="100" y="100" width="824" height="824" filter="url(#grain)"/>
    ${rings}
    <!-- The stopwatch at the centre -->
    <circle cx="${C}" cy="${C}" r="31" fill="url(#face)"/>
    <circle cx="${C}" cy="${C}" r="31" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="3"/>
    ${Array.from({ length: 12 }, (_, k) => { const a = (k / 12) * 2 * Math.PI - Math.PI / 2; const r1 = 25, r2 = k % 3 === 0 ? 18 : 21;
      return `<line x1="${C + r1 * Math.cos(a)}" y1="${C + r1 * Math.sin(a)}" x2="${C + r2 * Math.cos(a)}" y2="${C + r2 * Math.sin(a)}" stroke="#fff" stroke-opacity="${k % 3 === 0 ? 0.7 : 0.3}" stroke-width="${k % 3 === 0 ? 3.5 : 2.5}" stroke-linecap="round"/>`; }).join("")}
    <line x1="${C}" y1="${C}" x2="${C + 11}" y2="${C - 13}" stroke="#ff4f9a" stroke-width="5" stroke-linecap="round"/>
    <circle cx="${C}" cy="${C}" r="5" fill="#fff"/>
    <path d="M100 286 A186 186 0 0 1 286 100 H738 A186 186 0 0 1 924 286 V400 C700 450 324 450 100 400 Z" fill="url(#sheen)" opacity=".35"/>
  </g>
  <rect x="101.5" y="101.5" width="821" height="821" rx="184.5" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="3"/>
</svg>`;
}

const doc = svg();
if (process.argv.includes("--svg")) writeFileSync(join(OUT, "AppIcon-Trainer.svg"), doc);

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
await page.screenshot({ path: join(OUT, "AppIcon-Trainer.png"), omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
await browser.close();
console.log("wrote", join(OUT, "AppIcon-Trainer.png"));
