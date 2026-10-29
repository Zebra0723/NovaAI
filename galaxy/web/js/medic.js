// Galaxy Medic's space in Link: how every member is right now, its last day of
// uptime, what needs you (with exactly what to run), and what Medic fixed itself.

import { api } from "./api.js";
import { avatar, hex, icon, MEMBERS } from "./marks.js";
import { poke, state } from "./state.js";
import { ago, clock, esc, toast } from "./util.js";

const ORDER = ["link", "comet", "nova", "nebula", "zenith", "trainer", "teach", "orbit"];
const LABEL = { healthy: "Healthy", recovering: "Recovering", needs_you: "Needs you", off: "Off", unknown: "Checking" };
const nameOf = (id) => MEMBERS[id]?.name ?? id.charAt(0).toUpperCase() + id.slice(1);

function vitals() {
  const members = state.medic?.checkup?.members ?? [];
  return ORDER.map((id) => members.find((m) => m.member === id) ?? { member: id, health: "unknown", note: "Not checked yet" });
}

/** 48 half-hour slots: green when healthy all through, amber for some, red for none, grey for no data. */
function uptimeStrip(id) {
  const slots = state.medic?.uptime?.[id] ?? Array(48).fill(null);
  return `<div class="up-strip" aria-hidden="true">${slots
    .map((v) => `<i class="${v === null ? "none" : v >= 0.99 ? "ok" : v > 0.5 ? "some" : "bad"}"></i>`)
    .join("")}</div>`;
}

function uptimePct(id) {
  const slots = (state.medic?.uptime?.[id] ?? []).filter((v) => v !== null);
  if (!slots.length) return "—";
  const p = (slots.reduce((a, b) => a + b, 0) / slots.length) * 100;
  return `${p >= 99.95 ? "100" : p.toFixed(1)}%`;
}

function headline() {
  const v = vitals();
  const need = v.filter((m) => m.health === "needs_you").length;
  const healing = v.filter((m) => m.health === "recovering").length;
  if (!state.medic?.checkup) return `Waiting for the <em>first checkup</em>`;
  if (need) return need === 1 ? `One member needs <em>you</em>` : `${need} members need <em>you</em>`;
  if (healing) return `Back on its <em>feet</em> soon`;
  return `Everyone's <em>well</em>`;
}

function memberCard(m) {
  const id = m.member;
  return `<div class="card vital ${m.health}" data-body="${id}">
    <div class="v-top">${avatar(id, "lg", m.health === "off" ? "off" : "")}
      <div class="v-name"><b>${esc(nameOf(id))}</b><span class="hpill ${m.health}"><i></i>${LABEL[m.health] ?? m.health}</span></div>
    </div>
    <p class="v-note">${esc(m.note)}</p>
    <div class="v-up"><div class="label"><span>Last 24 hours</span><span>${uptimePct(id)}</span></div>${uptimeStrip(id)}</div>
  </div>`;
}

function needsYou(i) {
  return `<div class="card ticket" data-body="${i.member}">
    <div class="t-head">${avatar(i.member, "sm")}<div><b>${esc(i.title)}</b><span>${esc(nameOf(i.member))} · since ${esc(ago(i.startedAt))}${i.count > 1 ? ` · seen ${i.count} times` : ""}</span></div></div>
    ${i.found ? `<div class="label">What Medic found</div><pre class="found">${esc(i.found)}</pre>` : ""}
    ${i.fix ? `<div class="label">To fix it</div><div class="fix"><code>${esc(i.fix)}</code><button class="btn sm" data-copy="${esc(i.fix)}">${icon("copy")}Copy</button></div>` : ""}
  </div>`;
}

function fixedRow(i) {
  return `<div class="fixed-row" data-body="${i.member}"><time>${esc(clock(i.resolvedAt))}</time>${avatar(i.member, "xs")}
    <div><b>${esc(i.title)}</b><span>${esc(i.did || "Back to normal.")}${i.count > 1 ? ` (${i.count} checks)` : ""}</span></div>
    <span class="chip good">Fixed</span></div>`;
}

const medic = {
  title: "Medic",
  deps: ["medic", "data"],
  render() {
    const o = state.medic;
    const v = vitals();
    const open = o?.open ?? [];
    const fixed = o?.recent ?? [];
    return `<div class="page medic-page" data-body="medic">
      <section class="hero medic-hero">
        <div>
          <div class="label date">Galaxy Medic · ${o?.checkup ? `checked ${esc(ago(o.checkup.at))}` : "no checkup yet"}</div>
          <h1>${headline()}</h1>
          <div class="story">Medic checks on every member once a minute. It restarts what stopped, reopens what crashed and brings Galaxy Link back if Link goes down. When something needs you, it tells you once, with exactly what to run.</div>
          <div class="pills">
            <span class="pill"><span class="lamp ${o?.medicOnline ? "on live" : ""}" style="--c:var(--medic)"></span>${o ? (o.medicOnline ? "Medic is running" : "Medic isn't running") : "Connecting"}</span>
            ${o?.stale && o?.checkup ? `<span class="pill attention">Last checkup was ${esc(ago(o.checkup.at))}</span>` : ""}
            <span class="pill">${o?.fixedToday ?? 0} fixed in the last 24 hours</span>
          </div>
        </div>
        <div class="pulse-panel">
          <div class="pulse">${pulseSVG(v)}</div>
          <button class="btn primary" id="checkup-now">${icon("refresh")}Check everyone now</button>
        </div>
      </section>

      ${open.length ? `<div class="section"><div class="section-head"><h2>Needs you</h2><span class="muted small">Only you can fix these. Medic has already tried what it can.</span></div><div class="tickets">${open.map(needsYou).join("")}</div></div>` : ""}

      <div class="section">
        <div class="section-head"><h2>Vitals</h2><span class="muted small">Each bar is half an hour</span></div>
        <div class="vitals">${v.map(memberCard).join("")}</div>
      </div>

      <div class="split section">
        <div>
          <div class="section-head"><h2>Fixed by Medic</h2></div>
          <div class="card fixed-list">${fixed.length ? fixed.map(fixedRow).join("") : `<div class="empty"><b>Nothing to fix yet</b>When Medic restarts or repairs something, it shows up here.</div>`}</div>
        </div>
        <div>
          <div class="section-head"><h2>What Medic does on its own</h2></div>
          <ol class="card steps medic-steps">
            <li><span class="n">${icon("refresh")}</span><div><b>Restarts</b><p>Galaxy Link, Zenith and the Trainer when they stop, after a second look to be sure.</p></div></li>
            <li><span class="n">${icon("shield")}</span><div><b>Reopens</b><p>Nova and Nebula when they crash. An app you quit stays quit, and Orbit is never started.</p></div></li>
            <li><span class="n">${icon("alert")}</span><div><b>Tells you</b><p>When a restart won't help: a sign-in, a port taken by something else, Comet on its own Mac user, a member frozen mid-task. Once, with the exact fix.</p></div></li>
            <li><span class="n">${icon("wrench")}</span><div><b>Stops</b><p>Restarting anything that crashes three times in fifteen minutes. Instead, Claude reads its log and tells you in plain words what's wrong.</p></div></li>
          </ol>
        </div>
      </div>
    </div>`;
  },
  mount(box) {
    box.addEventListener("click", async (e) => {
      const copy = e.target.closest("[data-copy]");
      if (copy) {
        try {
          await navigator.clipboard.writeText(copy.dataset.copy);
          toast("Copied. Paste it into Terminal");
        } catch {
          toast("Select the command and copy it");
        }
        return;
      }
      if (e.target.closest("#checkup-now")) {
        const btn = $id("checkup-now");
        btn.disabled = true;
        try {
          const r = await api.checkupNow();
          toast(r?.medicOnline ? "Checking everyone now" : "Medic isn't running");
          setTimeout(poke, 4000);
        } catch (error) {
          toast(error.message);
        } finally {
          setTimeout(() => (btn.disabled = false), 4000);
        }
      }
    });
  },
};

const $id = (id) => document.getElementById(id);

/** A heartbeat line across the members: a beat for each one, flat for any that's down. */
function pulseSVG(v) {
  const w = 300;
  const h = 120;
  const step = w / v.length;
  let d = `M0 ${h / 2}`;
  v.forEach((m, i) => {
    const x = i * step;
    const mid = x + step / 2;
    if (m.health === "healthy") d += ` L${mid - 14} ${h / 2} L${mid - 8} ${h / 2 - 34} L${mid - 2} ${h / 2 + 24} L${mid + 4} ${h / 2 - 12} L${mid + 10} ${h / 2}`;
    else if (m.health === "recovering" || m.health === "unknown") d += ` L${mid - 10} ${h / 2} L${mid - 4} ${h / 2 - 12} L${mid + 2} ${h / 2 + 8} L${mid + 8} ${h / 2}`;
    d += ` L${x + step} ${h / 2}`;
  });
  const dots = v
    .map((m, i) => {
      const x = i * step + step / 2;
      const c = m.health === "healthy" ? hex(m.member) : m.health === "needs_you" ? "#b91c1c" : m.health === "off" ? "#c9c4ba" : "#d97706";
      return `<circle cx="${x}" cy="${h - 10}" r="4" fill="${c}"/>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" class="pulse-svg"><path d="${d}" fill="none" stroke="var(--medic)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" class="beat"/>${dots}</svg>`;
}

export const MEDIC_VIEWS = { medic };
