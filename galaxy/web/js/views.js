// The pages. Each view renders from `state`; the chat and memory pages keep
// their own DOM between updates so scrolling and typing are never disturbed.

import { api } from "./api.js";
import { avatar, glyph, hex, icon, MEMBERS, ORDER } from "./marks.js";
import { newChatIDs, poke, state } from "./state.js";
import { $, $$, ago, clock, dayLabel, esc, nameOf, richText, shortDate, toast } from "./util.js";

const bodiesInOrder = () => {
  const list = state.overview?.bodies ?? ORDER.map((id) => ({ id, name: MEMBERS[id].name, joined: false, online: false, powers: [] }));
  return [...list].sort((a, b) => rank(a.id) - rank(b.id));
};
const rank = (id) => (ORDER.includes(id) ? ORDER.indexOf(id) : 99);
const byId = (id) => bodiesInOrder().find((b) => b.id === id);

function greeting() {
  const h = new Date().getHours();
  const [a, b] = h < 5 ? ["Late", "night"] : h < 12 ? ["Good", "morning"] : h < 18 ? ["Good", "afternoon"] : ["Good", "evening"];
  return `${a} <em>${b}</em>`;
}

function route(from, to, size = "xs") {
  return `<span class="route">${avatar(from, size)}${icon("arrow", "arrow")}${avatar(to, size)}</span>`;
}

function statusChip(status) {
  return (
    {
      queued: '<span class="chip">Waiting</span>',
      claimed: '<span class="chip warn">Working</span>',
      done: '<span class="chip good">Done</span>',
      failed: '<span class="chip bad">Didn\'t finish</span>',
      cancelled: '<span class="chip">Cancelled</span>',
    }[status] ?? `<span class="chip">${esc(status)}</span>`
  );
}

// ------------------------------------------------------------------ drawer

export function openTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  closeDrawer();
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  const drawer = document.createElement("aside");
  drawer.className = "drawer";
  drawer.innerHTML = `
    <header>
      ${route(t.from, t.to, "sm")}
      <div><h3>${esc(t.title)}</h3><div class="muted" style="font-size:12.5px;margin-top:4px">
        ${esc(nameOf(t.from))} asked ${esc(nameOf(t.to))} · ${esc(ago(t.createdAt))}</div></div>
      <button class="icon-btn close" aria-label="Close">${icon("x")}</button>
    </header>
    <div class="body">
      <div class="label">Status</div>
      <div style="display:flex;gap:8px;align-items:center">${statusChip(t.status)}<span class="chip mono">${esc(t.id)}</span>${
        t.power ? `<span class="chip">${esc(t.power.replaceAll("_", " "))}</span>` : ""
      }</div>
      ${t.progress && t.status === "claimed" ? `<div class="label">Latest</div><pre>${esc(t.progress)}</pre>` : ""}
      <div class="label">What was asked</div><pre>${esc(t.instructions)}</pre>
      ${t.result ? `<div class="label">${t.status === "done" ? "Result" : "What happened"}</div><pre>${esc(t.result)}</pre>` : ""}
      <div class="label">Timeline</div>
      <div class="kv"><dt>Asked</dt><dd>${esc(new Date(t.createdAt).toLocaleString())}</dd>
      <dt>Last update</dt><dd>${esc(new Date(t.updatedAt).toLocaleString())}</dd></div>
    </div>`;
  scrim.onclick = closeDrawer;
  $(".close", drawer).onclick = closeDrawer;
  document.body.append(scrim, drawer);
}

export function closeDrawer() {
  $$(".scrim, .drawer").forEach((el) => el.remove());
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-task]");
  if (el) openTask(el.dataset.task);
});

// ---------------------------------------------------------------- overview

/** Twelve hours of a member's activity, one bar an hour. */
function sparkline(id) {
  const now = Date.now();
  const bins = new Array(12).fill(0);
  for (const e of state.events) {
    if (e.body !== id || e.kind === "presence") continue;
    const h = Math.floor((now - e.at) / 3600_000);
    if (h >= 0 && h < 12) bins[11 - h]++;
  }
  for (const m of state.chat) {
    if (m.body !== id) continue;
    const h = Math.floor((now - m.at) / 3600_000);
    if (h >= 0 && h < 12) bins[11 - h]++;
  }
  const max = Math.max(1, ...bins);
  const bars = bins
    .map((v, i) => {
      if (!v) return `<rect x="${i * 10 + 1}" y="25" width="7" height="1" fill="#e9e6df"/>`;
      const h = 4 + (v / max) * 20;
      return `<rect x="${i * 10 + 1}" y="${26 - h}" width="7" height="${h}" rx="1.5" fill="${hex(id)}" fill-opacity="${0.35 + (v / max) * 0.55}"/>`;
    })
    .join("");
  return `<svg viewBox="0 0 120 26" preserveAspectRatio="none" aria-label="Activity over the last 12 hours">${bars}</svg>`;
}

function memberCard(b) {
  const meta = MEMBERS[b.id] ?? { sense: "New", role: b.powers.map((p) => p.replaceAll("_", " ")).join(", ") };
  const status = b.online ? "Running" : b.joined ? "Not running" : "Not joined yet";
  const when = b.online ? "now" : b.joined ? ago(b.lastSeen) : "";
  const doing = b.working
    ? `<span class="label">Working on</span>${esc(b.working.title)}`
    : b.online
      ? `<span class="muted">Ready for anything</span>`
      : b.id === "orbit"
        ? `<span class="muted">Quiet until you talk to it</span>`
        : b.joined
          ? `<span class="muted">Picks up where it left off</span>`
          : `<span class="muted">Joins with an intro when it first connects</span>`;
  return `<a class="card member ${b.online ? "online" : ""} ${b.joined ? "" : "never"}" data-body="${b.id}" href="#/member/${b.id}">
    <div class="top">${avatar(b.id, "lg", b.online ? "" : "off")}<span class="sense">${esc(meta.sense)}</span></div>
    <h3>${esc(b.name)}</h3>
    <div class="role">${esc(meta.role)}</div>
    <div class="doing">${doing}</div>
    <div class="spark">${sparkline(b.id)}</div>
    <div class="status"><span class="lamp ${b.online ? "on live" : b.joined ? "" : "never"}"></span>${status}<span class="when">${esc(when)}</span></div>
  </a>`;
}

/** What's going on, in a sentence or two. */
function story() {
  const bodies = bodiesInOrder();
  const who = (id) => `<span class="who" data-body="${id}">${esc(nameOf(id))}</span>`;
  const parts = [];
  const working = bodies.filter((b) => b.working);
  for (const b of working.slice(0, 2)) parts.push(`${who(b.id)} is working on <b>${esc(b.working.title)}</b>.`);
  const pending = state.pending.pending;
  if (pending.length === 1) parts.push(`${who(pending[0].from)} is waiting on your yes.`);
  if (pending.length > 1) parts.push(`<b>${pending.length} questions</b> are waiting on your yes.`);
  const waiting = state.tasks.filter((t) => t.status === "queued").length;
  if (waiting) parts.push(`${waiting === 1 ? "One handoff is" : `${waiting} handoffs are`} waiting to be picked up.`);
  if (!parts.length) {
    const running = bodies.filter((b) => b.online).length;
    parts.push(running ? "Everyone's free, and nothing needs you." : "No members are running right now.");
  }
  return parts.join(" ");
}

function feedRow(m) {
  return `<div class="feed-row">${avatar(m.body, "sm")}<div class="body">
    <div class="line1"><span class="name-c" data-body="${m.body}">${esc(nameOf(m.body))}</span><span class="time">${esc(shortDate(m.at))}</span></div>
    <div class="text">${richText(m.text)}</div></div></div>`;
}

function leftWords(ms) {
  const s = Math.ceil(ms / 1000);
  if (s <= 0) return "time's up";
  if (s < 90) return `${s}s left`;
  return `${Math.round(s / 60)} min left`;
}

function askCard(a, compact = false) {
  const total = Math.max(a.expiresAt - a.createdAt, 1);
  const left = Math.max(a.expiresAt - Date.now(), 0);
  return `<article class="card ask${compact ? " compact" : ""}" data-body="${a.from}" data-ask="${a.id}" data-created="${a.createdAt}" data-expires="${a.expiresAt}">
    ${avatar(a.from, compact ? "" : "lg")}
    <div><div class="who">${esc(nameOf(a.from))} is asking</div><div class="q">${esc(a.title)}</div>${
      a.detail && !compact ? `<div class="detail">${esc(a.detail)}</div>` : ""
    }</div>
    <div class="actions">
      <button class="btn danger" data-decide="${a.id}" data-approve="0">${icon("x")}Reject</button>
      <button class="btn good" data-decide="${a.id}" data-approve="1">${icon("check")}Approve</button>
    </div>
    <div class="clock"><i style="width:${((left / total) * 100).toFixed(1)}%"></i></div>
    ${compact ? "" : `<div class="gesture-hint">${glyph("nebula", "glyph-sm")}Or answer with a thumbs up or down to Nebula · ${leftWords(left)}</div>`}
  </article>`;
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-decide]");
  if (!btn) return;
  const approve = btn.dataset.approve === "1";
  $$(`[data-decide="${btn.dataset.decide}"]`).forEach((b) => (b.disabled = true));
  try {
    await api.decide(btn.dataset.decide, approve);
    toast(approve ? "Approved" : "Rejected");
    state.pending.pending = state.pending.pending.filter((a) => a.id !== btn.dataset.decide);
    poke();
  } catch (error) {
    toast(error.message);
    $$(`[data-decide="${btn.dataset.decide}"]`).forEach((b) => (b.disabled = false));
  }
});

// Countdown bars tick down between updates.
setInterval(() => {
  for (const el of $$("[data-ask]")) {
    const total = Math.max(el.dataset.expires - el.dataset.created, 1);
    const left = Math.max(el.dataset.expires - Date.now(), 0);
    const bar = $(".clock i", el);
    if (bar) bar.style.width = `${((left / total) * 100).toFixed(1)}%`;
    const hint = $(".gesture-hint", el);
    if (hint) hint.lastChild.textContent = `Or answer with a thumbs up or down to Nebula · ${leftWords(left)}`;
  }
}, 1000);

function toolsCard() {
  return `<div class="card tools"><h3>Galaxy Tools</h3><p>Saved for later. Say the word when you want one built.</p>
    <div class="tool"><span class="ico">${icon("web")}</span><div><b>Galaxy Web</b><span>The whole Galaxy from any browser, anywhere.</span></div></div>
    <div class="tool"><span class="ico">${icon("search")}</span><div><b>Galaxy Search</b><span>One bar for the web, your files and memory. Answers, not links.</span></div></div>
    <div class="tool"><span class="ico">${icon("mail")}</span><div><b>Galaxy Mail</b><span>An address you forward or CC anything to.</span></div></div></div>`;
}

const overview = {
  title: "Overview",
  deps: ["data", "approvals", "chat"],
  render() {
    const o = state.overview;
    const bodies = bodiesInOrder();
    const running = bodies.filter((b) => b.online).length;
    const recent = state.chat.filter((m) => m.kind !== "claimed").slice(-6).reverse();
    const pending = state.pending.pending;
    const flying = state.tasks.filter((t) => t.status === "queued" || t.status === "claimed");
    const c = o?.counts ?? { chatToday: 0, inFlight: 0, finishedToday: 0, memories: 0, approvals: 0 };
    const stat = (k, v, sub, ico, attention = false) =>
      `<div class="card stat ${attention ? "attention" : ""}"><div class="k">${k}</div><span class="ico">${icon(ico)}</span><div class="v">${v}</div><div class="s">${sub}</div></div>`;
    return `<div class="page">
      <section class="hero">
        <div>
          <div class="label date">${esc(new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }))}</div>
          <h1>${greeting()}</h1>
          <div class="story">${story()}</div>
          <div class="pills">
            <a class="pill" href="#/chat"><span class="lamp on" style="--c:var(--good)"></span>${running} of ${bodies.length} running</a>
            <a class="pill" href="#/system">${o?.presence?.atMac ? "You're at the Mac · results on screen" : "You're away · results to your phone"}</a>
            ${pending.length ? `<a class="pill attention" href="#/approvals">${pending.length} waiting on you</a>` : ""}
          </div>
        </div>
        <a class="hero-map" href="#/map" aria-label="Open the Galaxy Map">${mapSVG({ compact: true, uid: "h" })}</a>
      </section>

      <div class="members">${bodies.map(memberCard).join("")}</div>

      <div class="stats">
        ${stat("Messages today", c.chatToday, "in Galaxy Chat", "chatline")}
        ${stat("In flight", c.inFlight, "handoffs between members", "flight")}
        ${stat("Finished today", c.finishedToday, "handoffs done", "done")}
        ${stat("Memories", c.memories, "shared by everyone", "memory")}
        ${stat("Waiting on you", pending.length, pending.length ? "yes or no needed" : "nothing to answer", "approvals", pending.length > 0)}
      </div>

      <div class="split section">
        <div>
          <div class="section-head"><h2>Latest in Galaxy Chat</h2><a class="more" href="#/chat">Open chat</a></div>
          <div class="card feed">${recent.length ? recent.map(feedRow).join("") : `<div class="empty"><b>Quiet so far</b>Members post here as they join and work.</div>`}</div>
        </div>
        <div>
          ${
            pending.length
              ? `<div class="section-head"><h2>Needs a yes</h2><a class="more" href="#/approvals">All approvals</a></div><div class="asks">${pending.slice(0, 2).map((a) => askCard(a, true)).join("")}</div>`
              : `<div class="section-head"><h2>Saved for later</h2></div>${toolsCard()}`
          }
        </div>
      </div>

      ${
        flying.length
          ? `<div class="section"><div class="section-head"><h2>In flight</h2><a class="more" href="#/handoffs">All handoffs</a></div>
          <div class="card" style="padding:4px 20px">${flying
            .slice(0, 6)
            .map(
              (t) => `<div class="flight" data-task="${t.id}" style="cursor:pointer">${route(t.from, t.to)}<span class="t">${esc(t.title)}</span>${statusChip(t.status)}<span class="muted" style="font-size:12px">${esc(ago(t.createdAt))}</span></div>`,
            )
            .join("")}</div></div>`
          : ""
      }
    </div>`;
  },
};

// -------------------------------------------------------------------- chat

let chatFilter = "";

function chatHTML(list) {
  let html = "";
  let prev = null;
  let lastDay = "";
  for (const m of list) {
    const day = dayLabel(m.at);
    if (day !== lastDay) {
      html += `<div class="day">${esc(day)}</div>`;
      lastDay = day;
      prev = null;
    }
    const fresh = newChatIDs.has(m.id) ? " new" : "";
    if (m.kind === "round") {
      html += `<div class="round${fresh}"><span class="round-mark">${icon("spark")}</span><div><div class="label">Introductions</div><p>${esc(
        m.text.replace(/^Introductions:\s*/, ""),
      )}</p></div><time>${esc(clock(m.at))}</time></div>`;
      prev = null;
      continue;
    }
    if (m.body === "you") {
      html += `<div class="system-line${fresh}"><span>${esc(m.text.replace(/^@\w+\s*/, "You "))}</span></div>`;
      prev = null;
      continue;
    }
    if (m.kind === "intro") {
      html += `<div class="card joined${fresh}" data-body="${m.body}">${avatar(m.body, "lg")}<div>
        <div class="title"><span>${esc(nameOf(m.body))}</span> joined the Galaxy</div>
        <div class="text">${richText(m.text)}</div><div class="time">${esc(clock(m.at))}</div></div></div>`;
      prev = null;
      continue;
    }
    if (m.kind === "claimed") {
      const title = m.text.replace(/^On it:\s*/, "");
      html += `<div class="msg compact${fresh}" data-body="${m.body}">${avatar(m.body, "xs")}<div class="text"><b>${esc(nameOf(m.body))}</b> picked up “${esc(title)}”${
        m.taskId ? ` · <span class="chip link mono" data-task="${m.taskId}">${esc(m.taskId)}</span>` : ""
      }</div></div>`;
      prev = null;
      continue;
    }
    const cont = prev && prev.body === m.body && m.at - prev.at < 5 * 60_000;
    let text = m.text;
    let quote = "";
    if (m.kind === "result") {
      const split = text.indexOf("\n\n");
      if (split > 0) {
        quote = text.slice(split + 2);
        text = text.slice(0, split);
      }
    }
    const chips = [];
    if (m.kind === "handoff") chips.push('<span class="chip tint">Handoff</span>');
    if (m.kind === "result") chips.push(/couldn't/.test(text) ? '<span class="chip bad">Didn\'t finish</span>' : '<span class="chip good">Done</span>');
    if (m.kind === "approval") chips.push('<span class="chip warn">Approval</span>');
    if (m.taskId) chips.push(`<span class="chip link mono" data-task="${m.taskId}">${esc(m.taskId)}</span>`);
    html += `<div class="msg${cont ? " cont" : ""}${fresh}" data-body="${m.body}">${avatar(m.body)}<div class="content">
      ${cont ? "" : `<div class="meta"><span class="name-c">${esc(nameOf(m.body))}</span><span class="time">${esc(clock(m.at))}</span></div>`}
      <div class="text">${richText(text)}</div>
      ${quote ? `<div class="quote">${richText(quote)}</div>` : ""}
      ${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}
    </div></div>`;
    prev = m;
  }
  return html;
}

const chat = {
  title: "Galaxy Chat",
  flush: true,
  render() {
    return `<div class="chat">
      <div class="chat-main">
        <div class="chat-head">
          <div><h1>Galaxy Chat</h1><div class="sub" id="chat-sub"></div></div>
          <div class="stack" id="chat-stack"></div>
          <button class="btn" id="introduce" title="Every member tells the others what it does and what to send it">${icon("spark")}Introductions</button>
        </div>
        <div class="messages" id="messages"></div>
        <div class="watching">${icon("eye")}Only Galaxy members talk here. You're watching, and anything that needs you shows up under Approvals.</div>
      </div>
      <aside class="chat-side"><h4>Show</h4><div id="chat-filters"></div></aside>
    </div>`;
  },
  mount() {
    this.drawChrome();
    this.drawMessages(true);
    $("#introduce").onclick = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await api.introduce();
        chatFilter = "";
        toast("Introductions posted");
      } catch (error) {
        toast(error.message);
      } finally {
        btn.disabled = false;
      }
    };
    $("#chat-filters").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-filter]");
      if (!btn) return;
      chatFilter = btn.dataset.filter;
      this.drawChrome();
      this.drawMessages(true);
    });
  },
  update(what) {
    if (what.has("chat")) this.drawMessages(false);
    this.drawChrome();
  },
  drawChrome() {
    const bodies = bodiesInOrder();
    const joined = bodies.filter((b) => b.joined);
    const online = bodies.filter((b) => b.online);
    $("#chat-sub").textContent = `${joined.length} member${joined.length === 1 ? "" : "s"} · ${online.length} online · read only`;
    $("#chat-stack").innerHTML = joined.map((b) => avatar(b.id, "", b.online ? "" : "off")).join("");
    const counts = {};
    for (const m of state.chat) counts[m.body] = (counts[m.body] ?? 0) + 1;
    const item = (id, label, glyphHTML) =>
      `<button class="filter ${chatFilter === id ? "on" : ""}" data-filter="${id}" ${id ? `data-body="${id}"` : ""}>${glyphHTML}${esc(label)}<span class="n">${
        id ? (counts[id] ?? 0) : state.chat.length
      }</span></button>`;
    $("#chat-filters").innerHTML =
      item("", "Everyone", `<span class="avatar xs" style="--c:var(--ink-2)">${icon("chat")}</span>`) +
      bodies.map((b) => item(b.id, b.name, avatar(b.id, "xs", b.online ? "" : "off"))).join("");
  },
  drawMessages(jump) {
    const box = $("#messages");
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
    const list = chatFilter ? state.chat.filter((m) => m.body === chatFilter) : state.chat;
    box.innerHTML = list.length
      ? chatHTML(list)
      : `<div class="empty" style="margin-top:80px"><b>${chatFilter ? `Nothing from ${esc(nameOf(chatFilter))} yet` : "No one has said anything yet"}</b>Each member introduces itself here the first time it connects.</div>`;
    if (jump || nearBottom) box.scrollTop = box.scrollHeight;
  },
};

// --------------------------------------------------------------------- map

let mapSignature = "";

/** The Galaxy Map. `compact` is the small version in the overview's hero: no labels. */
function mapSVG({ compact = false, uid = "m" } = {}) {
  const bodies = bodiesInOrder();
  const W = 1000,
    H = 660,
    cx = W / 2,
    cy = H / 2 + 6;
  const rx = compact ? 360 : 330,
    ry = compact ? 250 : 232;
  const pos = {};
  bodies.forEach((b, i) => {
    const a = ((-90 + (i * 360) / bodies.length) * Math.PI) / 180;
    pos[b.id] = { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  });
  const color = hex;
  const now = Date.now();
  const arcs = state.tasks.filter(
    (t) => pos[t.from] && pos[t.to] && (t.status === "queued" || t.status === "claimed" || now - t.updatedAt < 15 * 60_000),
  );
  const nodeR = compact ? 46 : 34;

  // The orbit the members sit on.
  let lines = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#e9e6df" stroke-width="${compact ? 2 : 1}"/>`;
  let defs = "";
  for (const b of bodies) {
    const p = pos[b.id];
    const dx = p.x - cx,
      dy = p.y - cy,
      d = Math.hypot(dx, dy);
    const x1 = cx + (dx / d) * (compact ? 80 : 64),
      y1 = cy + (dy / d) * (compact ? 80 : 64),
      x2 = p.x - (dx / d) * (nodeR + 6),
      y2 = p.y - (dy / d) * (nodeR + 6);
    defs += `<linearGradient id="${uid}-s-${b.id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
      <stop offset="0" stop-color="${color(b.id)}" stop-opacity=".1"/><stop offset="1" stop-color="${color(b.id)}" stop-opacity=".75"/></linearGradient>`;
    lines += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${b.online ? `url(#${uid}-s-${b.id})` : "#e9e6df"}" stroke-width="${compact ? 2.5 : 1.25}" stroke-linecap="round" ${
      b.online ? "" : `stroke-dasharray="${compact ? "6 10" : "3 6"}"`
    }/>`;
  }

  let flows = "";
  arcs.forEach((t, i) => {
    const a = pos[t.from],
      b = pos[t.to];
    const mx = (a.x + b.x) / 2,
      my = (a.y + b.y) / 2;
    // Bow each arc toward the centre, and apart from any arc going the other way.
    const nx = -(b.y - a.y),
      ny = b.x - a.x,
      nl = Math.hypot(nx, ny) || 1;
    const qx = mx + (cx - mx) * 0.38 + (nx / nl) * 34,
      qy = my + (cy - my) * 0.38 + (ny / nl) * 34;
    const id = `${uid}-arc-${i}`;
    defs += `<linearGradient id="${uid}-g-${i}" gradientUnits="userSpaceOnUse" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}">
      <stop offset="0" stop-color="${color(t.from)}"/><stop offset="1" stop-color="${color(t.to)}"/></linearGradient>`;
    const d = `M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${qx.toFixed(1)} ${qy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    const w = compact ? 3.5 : 1.75;
    if (t.status === "claimed") {
      flows += `<path id="${id}" d="${d}" fill="none" stroke="url(#${uid}-g-${i})" stroke-width="${w}" stroke-linecap="round"/>
        <circle r="${compact ? 8 : 4.5}" fill="${color(t.to)}" stroke="#fff" stroke-width="${compact ? 3 : 2}"><animateMotion dur="2.6s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines=".4 0 .2 1"><mpath href="#${id}"/></animateMotion></circle>`;
    } else if (t.status === "queued") {
      flows += `<path d="${d}" fill="none" stroke="url(#${uid}-g-${i})" stroke-width="${w * 0.8}" stroke-opacity=".75" stroke-dasharray="${compact ? "10 12" : "5 7"}" stroke-linecap="round" class="dash"/>`;
    } else {
      const fade = Math.max(0.15, 0.55 - (now - t.updatedAt) / (15 * 60_000) / 2);
      flows += `<path d="${d}" fill="none" stroke="url(#${uid}-g-${i})" stroke-width="${w * 0.7}" stroke-opacity="${fade.toFixed(2)}"/>`;
    }
  });

  let nodes = "";
  for (const b of bodies) {
    const p = pos[b.id];
    const c = color(b.id);
    const status = b.online ? (b.working ? "Working" : "Running") : b.joined ? "Not running" : "Not joined";
    const g = compact ? 44 : 30;
    nodes += `<g class="node ${b.online ? "online" : ""}" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})">
      ${b.online ? `<circle class="node-ring" r="${nodeR + 7}" fill="none" stroke="${c}" stroke-width="${compact ? 2.5 : 1.25}"/>` : ""}
      <circle r="${nodeR}" fill="#ffffff" stroke="${b.online ? c : "#dcd8cf"}" stroke-width="${compact ? 3 : 1.5}" filter="url(#${uid}-shadow)"/>
      <circle r="${nodeR - (compact ? 7 : 5)}" fill="${c}" fill-opacity="${b.online ? 0.07 : 0}"/>
      <svg x="${-g / 2}" y="${-g / 2}" width="${g}" height="${g}" viewBox="0 0 24 24" style="color:${b.online ? c : "#b3ada2"}">${glyph(b.id).replace(/^<svg[^>]*>|<\/svg>$/g, "")}</svg>
      ${
        compact
          ? ""
          : `<text y="${nodeR + 30}" text-anchor="middle" fill="#141413" font-size="22" stroke="#f8f7f4" stroke-width="6" paint-order="stroke" style="font-family:var(--serif)">${esc(b.name)}</text>
      <text y="${nodeR + 48}" text-anchor="middle" fill="${b.online ? c : "#8a857c"}" font-size="10" letter-spacing="1.2" stroke="#f8f7f4" stroke-width="5" paint-order="stroke" style="font-family:var(--mono)">${status.toUpperCase()}</text>`
      }
    </g>`;
  }

  const atMac = state.overview?.presence?.atMac;
  const coreR = compact ? 52 : 44;
  const core = `<g transform="translate(${cx} ${cy})">
    <circle class="core-ring" r="${coreR + 30}" fill="none" stroke="#dcd8cf" stroke-width="${compact ? 2 : 1}" stroke-dasharray="${compact ? "3 12" : "2 8"}"/>
    <circle r="${coreR}" fill="#141413" filter="url(#${uid}-shadow)"/>
    ${
      compact
        ? `<circle r="${coreR * 0.18}" fill="#f8f7f4"/>`
        : `<text y="2" text-anchor="middle" fill="#f8f7f4" font-size="24" style="font-family:var(--serif)">Link</text>
    <text y="20" text-anchor="middle" fill="#a8a399" font-size="9" letter-spacing="1.2" style="font-family:var(--mono)">${atMac ? "YOU'RE HERE" : "YOU'RE AWAY"}</text>`
    }
  </g>`;

  return `<svg viewBox="${compact ? "70 10 860 650" : `0 0 ${W} ${H}`}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Galaxy Map">
    <defs>${defs}
      <radialGradient id="${uid}-core" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#4b5263"/><stop offset=".6" stop-color="#151922"/><stop offset="1" stop-color="#0d1017"/></radialGradient>
      <filter id="${uid}-glow" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="${uid}-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="${compact ? 6 : 3}" stdDeviation="${compact ? 9 : 5}" flood-color="#141413" flood-opacity=".10"/></filter>
    </defs>
    ${lines}${flows}${core}${nodes}
  </svg>`;
}

const map = {
  title: "Galaxy Map",
  deps: ["data"],
  render() {
    mapSignature = "";
    return `<div class="page">
      <div class="head"><div><div class="eyebrow">Live</div><h1>Galaxy Map</h1>
      <p>Every member, and the work moving between them right now. Everything passes through Link at the centre.</p></div></div>
      <div class="map">
        <div class="card map-stage" id="map-stage"></div>
        <div class="map-side">
          <div class="card" style="flex:1;min-height:0;display:flex;flex-direction:column">
            <div class="section-head" style="margin-bottom:6px"><h2>Moving now</h2></div>
            <div class="list" id="map-list"></div>
          </div>
          <div class="card"><div class="section-head" style="margin-bottom:12px"><h2>Reading the map</h2></div>
            <div class="legend">
              <div><i></i>A member working on a handoff</div>
              <div><i class="dash"></i>Waiting for a member to pick it up</div>
              <div><i class="fade"></i>Finished in the last 15 minutes</div>
              <div><span class="lamp on live" style="--c:var(--good)"></span>Running right now</div>
            </div>
            <p class="muted" style="font-size:12px;margin:14px 0 0">Orbit never takes handoffs. It only speaks when someone speaks to it.</p>
          </div>
        </div>
      </div></div>`;
  },
  mount() {
    this.update();
  },
  update() {
    const stage = $("#map-stage");
    if (!stage) return;
    const bodies = bodiesInOrder();
    const sig = JSON.stringify([
      bodies.map((b) => [b.id, b.online, b.joined, !!b.working]),
      state.tasks.map((t) => [t.id, t.status]),
      state.overview?.presence?.atMac,
    ]);
    if (sig !== mapSignature) {
      mapSignature = sig;
      stage.innerHTML = mapSVG();
    }
    const flying = state.tasks.filter((t) => t.status === "queued" || t.status === "claimed");
    $("#map-list").innerHTML = flying.length
      ? flying
          .map((t) => `<div class="flight" data-task="${t.id}" style="cursor:pointer">${route(t.from, t.to)}<span class="t">${esc(t.title)}</span>${statusChip(t.status)}</div>`)
          .join("")
      : `<div class="empty" style="padding:28px 8px"><b>All quiet</b>Handoffs appear here the moment a member passes work on.</div>`;
  },
};

// ---------------------------------------------------------------- handoffs

const handoffs = {
  title: "Handoffs",
  deps: ["data"],
  render() {
    const cols = [
      ["Waiting", (t) => t.status === "queued", "var(--ink-3)"],
      ["Working", (t) => t.status === "claimed", "var(--warn)"],
      ["Done", (t) => t.status === "done", "var(--good)"],
      ["Didn't finish", (t) => t.status === "failed" || t.status === "cancelled", "var(--bad)"],
    ];
    const card = (t) => `<button class="task" data-task="${t.id}" data-body="${t.to}">
      <div class="title">${esc(t.title)}</div>
      <div class="route">${avatar(t.from, "xs")}${avatar(t.to, "xs")}<span class="nm">${esc(nameOf(t.from))} to ${esc(nameOf(t.to))}</span><span class="when">${esc(ago(t.updatedAt))}</span></div>
      ${t.status === "claimed" && t.progress ? `<div class="note">${esc(t.progress)}</div>` : ""}
      ${(t.status === "done" || t.status === "failed") && t.result ? `<div class="note">${esc(t.result)}</div>` : ""}
      ${t.status === "claimed" ? `<div class="bar"><i></i></div>` : ""}
    </button>`;
    return `<div class="page">
      <div class="head"><div><div class="eyebrow">Between members</div><h1>Handoffs</h1>
      <p>When one member needs a power another has, it hands the work over. Here's every handoff, live.</p></div></div>
      <div class="board">${cols
        .map(([name, keep, dot]) => {
          const list = state.tasks.filter(keep);
          return `<div class="card col"><div class="col-head"><span class="dot" style="background:${dot}"></span>${name}<span class="n">${list.length}</span></div>
            ${list.length ? list.map(card).join("") : `<div class="empty" style="padding:24px 8px">None</div>`}</div>`;
        })
        .join("")}</div></div>`;
  },
};

// --------------------------------------------------------------- approvals

const approvals = {
  title: "Approvals",
  deps: ["approvals", "data"],
  render() {
    const pending = state.pending.pending;
    const history = state.approvals.filter((a) => a.status !== "pending");
    const word = { approved: "Approved", rejected: "Rejected", expired: "Expired", cancelled: "Withdrawn" };
    const cls = { approved: "good", rejected: "bad", expired: "", cancelled: "" };
    return `<div class="page">
      <div class="head"><div><div class="eyebrow">Your yes or no</div><h1>Approvals</h1>
      <p>Members ask before anything that needs you: sending to someone new, spending money, posting in public. Answer here, or with a thumbs up or down to Nebula.</p></div></div>
      ${
        pending.length
          ? `<div class="asks">${pending.map((a) => askCard(a)).join("")}</div>`
          : `<div class="card empty" style="padding:44px"><b>Nothing waiting on you</b>When a member needs a decision it shows up here right away.</div>`
      }
      <div class="section"><div class="section-head"><h2>Recent decisions</h2></div>
        <div class="card history">${
          history.length
            ? history
                .map(
                  (a) => `<div class="hrow">${avatar(a.from, "sm")}<div style="min-width:0"><div class="t">${esc(a.title)}</div>
                <div class="by">${esc(nameOf(a.from))} asked${a.decidedBy ? ` · ${a.decidedBy === "you" ? "you answered" : `${esc(nameOf(a.decidedBy))} answered`}${a.via ? ` with ${a.via === "app" ? "the app" : a.via === "gesture" ? "a gesture" : esc(a.via)}` : ""}` : ""}</div></div>
                <span class="chip ${cls[a.status]}">${word[a.status] ?? esc(a.status)}</span><span class="time">${esc(shortDate(a.decidedAt || a.createdAt))}</span></div>`,
                )
                .join("")
            : `<div class="empty">No decisions yet.</div>`
        }</div></div></div>`;
  },
};

// ------------------------------------------------------------------ memory

const mem = { list: [], q: "", editing: "", confirming: "", timer: 0 };

async function loadMemories() {
  try {
    mem.list = (await api.memories(mem.q)) ?? [];
  } catch {}
  drawMemories();
}

function drawMemories() {
  const box = $("#memories");
  if (!box) return;
  $("#mem-count").textContent = `${mem.list.length} ${mem.q ? "found" : "memories"}`;
  box.innerHTML = mem.list.length
    ? mem.list
        .map((m) => {
          const src = m.source === "user" ? "you" : m.source;
          if (mem.editing === m.id)
            return `<div class="memory editing"><div class="edit"><input class="input" id="mem-edit" value="${esc(m.text)}"></div><span></span>
            <div class="row-actions"><button class="btn sm primary" data-mem-save="${m.id}">Save</button><button class="btn sm quiet" data-mem-cancel>Cancel</button></div></div>`;
          if (mem.confirming === m.id)
            return `<div class="memory confirm"><div class="text">${esc(m.text)}</div><span class="muted" style="font-size:12.5px">Forget this for every member?</span>
            <div class="row-actions"><button class="btn sm danger" data-mem-forget="${m.id}">Forget</button><button class="btn sm quiet" data-mem-cancel>Keep</button></div></div>`;
          return `<div class="memory"><div class="text" data-mem-edit="${m.id}">${esc(m.text)}</div>
            <div style="display:flex;gap:10px;align-items:center"><span class="chip tint" data-body="${src}">${esc(nameOf(src))}</span><span class="when">${esc(shortDate(m.updatedAt))}</span></div>
            <div class="row-actions"><button class="icon-btn" aria-label="Edit" data-mem-edit="${m.id}">${icon("edit")}</button><button class="icon-btn danger" aria-label="Forget" data-mem-ask="${m.id}">${icon("trash")}</button></div></div>`;
        })
        .join("")
    : `<div class="empty"><b>${mem.q ? "Nothing matches" : "No memories yet"}</b>${mem.q ? "Try another word." : "Members save what they learn about you here, and so can you."}</div>`;
  const edit = $("#mem-edit");
  if (edit) {
    edit.focus();
    edit.setSelectionRange(edit.value.length, edit.value.length);
  }
}

const memory = {
  title: "Memory",
  render() {
    return `<div class="page">
      <div class="head"><div><div class="eyebrow">Shared by every member</div><h1>Memory</h1>
      <p>What the Galaxy knows about you. Anything here, every member knows. Click a memory to change it.</p></div>
      <span class="chip" id="mem-count"></span></div>
      <div class="toolbar"><div class="search">${icon("search")}<input class="input" id="mem-q" placeholder="Search memories" value="${esc(mem.q)}"></div></div>
      <div class="card composer"><input class="input" id="mem-new" placeholder="Tell the Galaxy something to remember, then press Return">
        <button class="btn primary" id="mem-add">${icon("plus")}Remember</button></div>
      <div class="card memories" id="memories"></div></div>`;
  },
  mount(root) {
    mem.editing = mem.confirming = "";
    loadMemories();
    $("#mem-q").addEventListener("input", (e) => {
      clearTimeout(mem.timer);
      mem.timer = setTimeout(() => {
        mem.q = e.target.value.trim();
        loadMemories();
      }, 160);
    });
    const add = async () => {
      const input = $("#mem-new");
      const text = input.value.trim();
      if (!text) return;
      try {
        await api.remember(text);
        input.value = "";
        toast("Remembered");
        loadMemories();
        poke();
      } catch (error) {
        toast(error.message);
      }
    };
    $("#mem-add").onclick = add;
    $("#mem-new").addEventListener("keydown", (e) => e.key === "Enter" && add());
    root.addEventListener("click", async (e) => {
      const t = e.target.closest("[data-mem-edit],[data-mem-ask],[data-mem-cancel],[data-mem-save],[data-mem-forget]");
      if (!t) return;
      if (t.dataset.memEdit) mem.editing = t.dataset.memEdit;
      if (t.dataset.memAsk) mem.confirming = t.dataset.memAsk;
      if ("memCancel" in t.dataset) mem.editing = mem.confirming = "";
      if (t.dataset.memSave) return saveEdit(t.dataset.memSave);
      if (t.dataset.memForget) {
        await api.forget(t.dataset.memForget).catch((err) => toast(err.message));
        mem.confirming = "";
        toast("Forgotten");
        loadMemories();
        poke();
        return;
      }
      drawMemories();
    });
    root.addEventListener("keydown", (e) => {
      if (e.target.id !== "mem-edit") return;
      if (e.key === "Enter") saveEdit(mem.editing);
      if (e.key === "Escape") {
        mem.editing = "";
        drawMemories();
      }
    });
    async function saveEdit(id) {
      const text = $("#mem-edit")?.value.trim();
      if (!text) return;
      await api.updateMemory(id, text).catch((err) => toast(err.message));
      mem.editing = "";
      toast("Saved");
      loadMemories();
    }
  },
};

// ---------------------------------------------------------------- activity

const KIND = { presence: "Status", handoff: "Handoff", task_done: "Finished", task_failed: "Didn't finish", approval: "Approval", activity: "Activity" };

const activity = {
  title: "Activity",
  deps: ["data"],
  render() {
    const events = [...state.events].reverse();
    let html = "";
    let lastDay = "";
    for (const e of events) {
      const day = dayLabel(e.at);
      if (day !== lastDay) {
        if (lastDay) html += "</div>";
        html += `<div class="day">${esc(day)}</div><div class="card timeline">`;
        lastDay = day;
      }
      html += `<div class="event" data-body="${e.body}"><span class="time">${esc(clock(e.at))}</span>${avatar(e.body, "xs")}
        <span class="what"><b>${esc(nameOf(e.body))}</b> ${esc(e.summary)}</span><span class="chip">${esc(KIND[e.kind] ?? e.kind)}</span></div>`;
    }
    if (lastDay) html += "</div>";
    return `<div class="page">
      <div class="head"><div><div class="eyebrow">The last seven days</div><h1>Activity</h1>
      <p>Everything the members did, in order. This is what lets one member pick up where another left off.</p></div></div>
      ${html || `<div class="card empty" style="padding:44px"><b>Nothing yet</b>Members log what they do here as they work.</div>`}</div>`;
  },
};

// ------------------------------------------------------------------ system

const system = {
  title: "System",
  deps: ["data"],
  render() {
    const o = state.overview;
    const bodies = bodiesInOrder();
    return `<div class="page">
      <div class="head"><div><div class="eyebrow">Under the hood</div><h1>System</h1>
      <p>Galaxy Link runs on its own in the background, so every member works whether or not the others are open.</p></div></div>
      <div class="grid2">
        <div class="card pad"><div class="section-head"><h2>Link</h2><span class="chip good">Running</span></div>
          <dl class="kv">
            <dt>Address</dt><dd class="mono">${esc(location.host)}</dd>
            <dt>Running since</dt><dd>${o ? esc(new Date(o.startedAt).toLocaleString()) : ""}</dd>
            <dt>Data</dt><dd class="mono">~/Library/Application Support/Galaxy</dd>
            <dt>Reachable from</dt><dd>This Mac only. Other web pages are refused.</dd>
            <dt>Where results go</dt><dd>${o?.presence?.atMac ? "The screen, since you're at the Mac" : "Your phone, through Comet"}</dd>
          </dl></div>
        <div class="card pad"><div class="section-head"><h2>Keyboard</h2></div>
          <div class="keys">
            <kbd>⌘1</kbd><span>Overview</span><kbd>⌘2</kbd><span>Galaxy Chat</span><kbd>⌘3</kbd><span>Galaxy Map</span>
            <kbd>⌘4</kbd><span>Handoffs</span><kbd>⌘5</kbd><span>Approvals</span><kbd>⌘6</kbd><span>Memory</span>
            <kbd>⌘7</kbd><span>Activity</span><kbd>⌘8</kbd><span>System</span><kbd>Esc</kbd><span>Close a panel</span>
          </div></div>
      </div>
      <div class="section"><div class="section-head"><h2>Members</h2></div>
        <div class="card pad"><table class="table"><thead><tr><th>Member</th><th>Status</th><th>Version</th><th>Last seen</th><th>Powers</th></tr></thead><tbody>
        ${bodies
          .map(
            (b) => `<tr data-body="${b.id}"><td><span style="display:flex;gap:10px;align-items:center">${avatar(b.id, "xs", b.online ? "" : "off")}${esc(b.name)}</span></td>
          <td><span style="display:flex;gap:8px;align-items:center"><span class="lamp ${b.online ? "on" : b.joined ? "" : "never"}"></span>${b.online ? "Running" : b.joined ? "Not running" : "Not joined"}</span></td>
          <td class="mono">${esc(b.version || "·")}</td><td>${esc(b.online ? "now" : b.joined ? ago(b.lastSeen) : "·")}</td>
          <td style="color:var(--ink-3)">${esc(b.powers.map((p) => p.replaceAll("_", " ")).join(", ") || "·")}</td></tr>`,
          )
          .join("")}</tbody></table></div></div>
      <div class="section">${toolsCard()}</div></div>`;
  },
};

// ------------------------------------------------------------- one member

let memberMemories = { id: "", list: [] };

const member = {
  title: "Member",
  deps: ["data", "chat"],
  render(id) {
    const b = bodiesInOrder().find((x) => x.id === id);
    if (!b) return `<div class="page"><div class="card empty" style="padding:60px"><b>No member called ${esc(id)}</b><a href="#/overview">Back to the overview</a></div></div>`;
    const meta = MEMBERS[id] ?? { sense: "New", role: b.powers.map((p) => p.replaceAll("_", " ")).join(", ") };
    const tasks = state.tasks.filter((t) => t.from === id || t.to === id);
    const did = tasks.filter((t) => t.to === id && t.status === "done").length;
    const asked = tasks.filter((t) => t.from === id).length;
    const msgs = state.chat.filter((m) => m.body === id);
    if (memberMemories.id !== id) {
      memberMemories = { id, list: [] };
      api.memories().then((list) => {
        memberMemories = { id, list: (list ?? []).filter((m) => m.source === id) };
        const box = $("#member-mem");
        if (box) box.textContent = memberMemories.list.length;
      }).catch(() => {});
    }
    const events = state.events.filter((e) => e.body === id).slice(-12).reverse();
    const intro = state.chat.find((m) => m.body === id && m.kind === "intro");
    const status = b.online ? "Running" : b.joined ? "Not running" : "Hasn't joined yet";
    return `<div class="page" data-body="${id}">
      <section class="card profile">
        ${avatar(id, "xl", b.online ? "" : "off")}
        <div class="who">
          <div class="eyebrow" style="color:inherit"><span class="sense-pill">${esc(meta.sense)}</span></div>
          <h1>${esc(b.name)}</h1>
          <p>${esc(meta.role)}</p>
          <div class="pills">
            <span class="pill"><span class="lamp ${b.online ? "on live" : b.joined ? "" : "never"}"></span>${status}${b.online ? "" : b.joined ? ` · seen ${esc(ago(b.lastSeen))}` : ""}</span>
            ${b.version ? `<span class="pill">Version ${esc(b.version)}</span>` : ""}
            <a class="pill" href="#/chat" data-chat-filter="${id}">See ${esc(b.name)}'s messages</a>
          </div>
        </div>
        <div class="now">
          <div class="label">Right now</div>
          ${
            b.working
              ? `<div class="doing"><b>${esc(b.working.title)}</b>${b.working.progress ? `<span>${esc(b.working.progress)}</span>` : ""}</div><div class="bar"><i></i></div>`
              : `<div class="doing"><span>${b.online ? "Free, ready for anything." : id === "orbit" ? "Quiet until you talk to it." : "Not running."}</span></div>`
          }
        </div>
      </section>

      <div class="stats" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <div class="card stat"><div class="k">Messages in chat</div><span class="ico">${icon("chatline")}</span><div class="v">${msgs.length}</div><div class="s">in Galaxy Chat</div></div>
        <div class="card stat"><div class="k">Work finished</div><span class="ico">${icon("done")}</span><div class="v">${did}</div><div class="s">handed to ${esc(b.name)}</div></div>
        <div class="card stat"><div class="k">Work handed on</div><span class="ico">${icon("flight")}</span><div class="v">${asked}</div><div class="s">to other members</div></div>
        <div class="card stat"><div class="k">Memories saved</div><span class="ico">${icon("memory")}</span><div class="v" id="member-mem">${memberMemories.list.length}</div><div class="s">shared with everyone</div></div>
      </div>

      <div class="split section">
        <div>
          <div class="section-head"><h2>Recent activity</h2></div>
          <div class="card timeline">${
            events.length
              ? events.map((e) => `<div class="event" data-body="${e.body}"><span class="time">${esc(shortDate(e.at))}</span>${avatar(e.body, "xs")}<span class="what">${esc(e.summary)}</span><span class="chip">${esc(KIND[e.kind] ?? e.kind)}</span></div>`).join("")
              : `<div class="empty">Nothing yet.</div>`
          }</div>
        </div>
        <div>
          <div class="section-head"><h2>Powers</h2></div>
          <div class="card pad"><div class="powers">${
            b.powers.length ? b.powers.map((p) => `<span class="chip tint">${esc(p.replaceAll("_", " "))}</span>`).join("") : `<span class="muted">None yet.</span>`
          }</div>
          ${intro ? `<div class="label" style="margin-top:18px">How ${esc(b.name)} introduced itself</div><p class="intro">${richText(intro.text)}</p>` : ""}
          </div>
        </div>
      </div>

      <div class="section"><div class="section-head"><h2>Handoffs</h2><a class="more" href="#/handoffs">All handoffs</a></div>
        <div class="card" style="padding:4px 20px">${
          tasks.length
            ? tasks.slice(0, 8).map((t) => `<div class="flight" data-task="${t.id}" style="cursor:pointer">${route(t.from, t.to)}<span class="t">${esc(t.title)}</span>${statusChip(t.status)}<span class="muted" style="font-size:12px">${esc(ago(t.updatedAt))}</span></div>`).join("")
            : `<div class="empty">No handoffs yet.</div>`
        }</div></div>
    </div>`;
  },
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-chat-filter]");
  if (el) chatFilter = el.dataset.chatFilter;
});

export const VIEWS = { overview, chat, map, handoffs, approvals, memory, activity, system, member };
