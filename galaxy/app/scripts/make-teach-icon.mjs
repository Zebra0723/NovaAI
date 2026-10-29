#!/usr/bin/env node
// Draws Galaxy Teach's app icon and renders it with Chromium, like the Trainer's.
// Writes Resources/AppIcon-Teach.png (1024px).
//
//   node scripts/make-teach-icon.mjs          needs Playwright
//   node scripts/make-teach-icon.mjs --svg    also writes Resources/AppIcon-Teach.svg
//
// The picture: a dark glass tile; an open book whose pages glow, a spark of something
// new rising off it, and the five members' colours along its spine.

import { createRequire } from "module";
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "Resources");
const C = 512;
const MEMBERS = ["#f59e0b", "#ef4444", "#7c5cff", "#10b981", "#3b82f6"];

function star(cx, cy, r, inner) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 2 * Math.PI - Math.PI / 2;
    const rr = i % 2 ? inner : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

function svg() {
  // Each page: from the spine out, curving up at the edge.
  const left = `M${C} 470 C 440 420, 330 410, 236 432 L 236 712 C 330 690, 440 700, ${C} 752 Z`;
  const right = `M${C} 470 C 584 420, 694 410, 788 432 L 788 712 C 694 690, 584 700, ${C} 752 Z`;
  const lines = (side) =>
    [0, 1, 2, 3, 4]
      .map((k) => {
        const y = 490 + k * 44;
        const x0 = side < 0 ? 286 : 560;
        const x1 = side < 0 ? 464 : 738;
        return `<path d="M${x0} ${y + (side < 0 ? 0 : 0)} Q ${(x0 + x1) / 2} ${y - 16} ${x1} ${y + 6}" stroke="#fff" stroke-opacity="${k === 0 ? 0.5 : 0.22}" stroke-width="${k === 0 ? 9 : 7}" stroke-linecap="round" fill="none"/>`;
      })
      .join("");
  const dots = MEMBERS.map((c, i) => `<circle cx="${C}" cy="${500 + i * 52}" r="13" fill="${c}"/><circle cx="${C - 3}" cy="${497 + i * 52}" r="4" fill="#fff" opacity=".6"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#20261c"/><stop offset=".55" stop-color="#121510"/><stop offset="1" stop-color="#0a0c09"/></linearGradient>
    <radialGradient id="bloom" cx=".5" cy=".3" r=".65"><stop offset="0" stop-color="#84cc16" stop-opacity=".42"/><stop offset="1" stop-color="#84cc16" stop-opacity="0"/></radialGradient>
    <linearGradient id="pageL" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9f99d"/><stop offset=".6" stop-color="#65a30d"/><stop offset="1" stop-color="#3f6212"/></linearGradient>
    <linearGradient id="pageR" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ecfccb"/><stop offset=".6" stop-color="#84cc16"/><stop offset="1" stop-color="#4d7c0f"/></linearGradient>
    <radialGradient id="spark" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#fef9c3"/><stop offset="1" stop-color="#facc15" stop-opacity="0"/></radialGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="22"/></filter>
    <filter id="tileShadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="22" stdDeviation="26" flood-color="#000" flood-opacity=".35"/></filter>
    <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .035 0"/></filter>
    <clipPath id="clip"><rect x="100" y="100" width="824" height="824" rx="186"/></clipPath>
  </defs>
  <g filter="url(#tileShadow)"><rect x="100" y="100" width="824" height="824" rx="186" fill="url(#tile)"/></g>
  <g clip-path="url(#clip)">
    <rect x="100" y="100" width="824" height="824" fill="url(#bloom)"/>
    <rect x="100" y="100" width="824" height="824" filter="url(#grain)"/>
    <path d="${left}" fill="#84cc16" opacity=".35" filter="url(#glow)"/>
    <path d="${right}" fill="#84cc16" opacity=".35" filter="url(#glow)"/>
    <path d="${left}" fill="url(#pageL)"/>
    <path d="${right}" fill="url(#pageR)"/>
    ${lines(-1)}${lines(1)}
    <path d="M${C} 470 V 752" stroke="#1a2e05" stroke-opacity=".55" stroke-width="10"/>
    ${dots}
    <!-- The spark: something new, rising off the page -->
    <circle cx="${C}" cy="300" r="120" fill="url(#spark)" opacity=".55"/>
    <polygon points="${star(C, 300, 92, 24)}" fill="#fff"/>
    <polygon points="${star(C, 300, 92, 24)}" fill="#fef08a" opacity=".55"/>
    <circle cx="${C + 128}" cy="236" r="10" fill="#fef9c3" opacity=".85"/>
    <circle cx="${C - 140}" cy="262" r="7" fill="#fef9c3" opacity=".6"/>
    <path d="M100 286 A186 186 0 0 1 286 100 H738 A186 186 0 0 1 924 286 V400 C700 450 324 450 100 400 Z" fill="url(#sheen)" opacity=".35"/>
  </g>
  <rect x="101.5" y="101.5" width="821" height="821" rx="184.5" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="3"/>
</svg>`;
}

const doc = svg();
if (process.argv.includes("--svg")) writeFileSync(join(OUT, "AppIcon-Teach.svg"), doc);

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
await page.screenshot({ path: join(OUT, "AppIcon-Teach.png"), omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
await browser.close();
console.log("wrote", join(OUT, "AppIcon-Teach.png"));
