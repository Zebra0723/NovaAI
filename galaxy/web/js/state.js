// What the app knows, kept fresh. Chat and approvals arrive by long poll the
// moment they happen; the dashboard numbers refresh every few seconds.

import { api, Offline } from "./api.js";

const listeners = new Set();
export const state = {
  connected: null, // null until the first answer
  overview: null,
  chat: [],
  tasks: [],
  events: [],
  pending: { version: 0, pending: [] },
  approvals: [],
  // Galaxy Trainer: the overview, one member's detail while its page is open, and every 1:1 thread.
  medic: null,
  teach: null,
  training: null,
  trainingFocus: "",
  trainingDetail: {},
  threads: {},
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let queued = null;
/** One redraw per frame, told everything that changed in it. */
export function changed(what) {
  if (queued) {
    queued.add(what);
    return;
  }
  queued = new Set([what]);
  requestAnimationFrame(() => {
    const all = queued;
    queued = null;
    for (const fn of listeners) fn(all);
  });
}

function connected(ok) {
  if (state.connected !== ok) {
    state.connected = ok;
    changed("connection");
  }
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function refresh() {
  const dayAgo = Date.now() - 7 * 86400_000;
  const [overview, tasks, events, approvals] = await Promise.all([
    api.overview(),
    api.tasks(),
    api.events(dayAgo),
    api.approvals(),
  ]);
  state.overview = overview;
  state.tasks = tasks;
  state.events = events;
  state.approvals = approvals;
  connected(true);
  changed("data");
  // Medic and training are newer than the rest of Link: an older galaxyd just has none.
  const medic = await api.medic().catch(() => null);
  if (JSON.stringify(medic) !== JSON.stringify(state.medic)) {
    state.medic = medic;
    changed("medic");
  }
  const teach = await api.teach().catch(() => null);
  if (JSON.stringify(teach) !== JSON.stringify(state.teach)) {
    state.teach = teach;
    changed("teach");
  }
  const [training, detail] = await Promise.all([
    api.training().catch(() => null),
    state.trainingFocus ? api.trainingMember(state.trainingFocus).catch(() => null) : null,
  ]);
  const before = JSON.stringify([state.training, detail && state.trainingDetail[detail.member]]);
  state.training = training;
  if (detail) state.trainingDetail[detail.member] = { ...detail, thread: undefined };
  if (JSON.stringify([state.training, detail && state.trainingDetail[detail.member]]) !== before) changed("training");
}

/** The member whose training page is open, so its program and playbook stay fresh. */
export function focusTraining(id) {
  if (state.trainingFocus === id) return;
  state.trainingFocus = id;
  if (id) poke();
}

export let newThreadIDs = new Set();
let lastThreadID = 0;

async function threadLoop() {
  for (;;) {
    try {
      const fresh = (await api.trainingThreads(lastThreadID, lastThreadID ? 25 : 0)) ?? [];
      if (fresh.length) {
        newThreadIDs = new Set(lastThreadID ? fresh.map((m) => m.id) : []);
        for (const m of fresh) (state.threads[m.member] ??= []).push(m);
        lastThreadID = fresh[fresh.length - 1].id;
        changed("thread");
      } else if (!lastThreadID) await pause(4000);
    } catch {
      await pause(4000);
    }
  }
}

async function refreshLoop() {
  for (;;) {
    try {
      await refresh();
      await pause(3000);
    } catch (error) {
      if (error instanceof Offline || error.status === 401) connected(false);
      await pause(2500);
    }
  }
}

export let newChatIDs = new Set();

async function chatLoop() {
  for (;;) {
    try {
      if (!state.chat.length) {
        state.chat = (await api.chat(0)) ?? [];
        changed("chat");
        if (!state.chat.length) await pause(2000);
        continue;
      }
      const last = state.chat[state.chat.length - 1].id;
      const fresh = (await api.chat(last, 25)) ?? [];
      if (fresh.length) {
        newChatIDs = new Set(fresh.map((m) => m.id));
        state.chat = state.chat.concat(fresh).slice(-2000);
        changed("chat");
      }
    } catch {
      await pause(2500);
    }
  }
}

async function approvalsLoop() {
  for (;;) {
    try {
      const next = await api.pending(state.pending.version, 25);
      if (next && next.version !== state.pending.version) {
        state.pending = next;
        changed("approvals");
      }
    } catch {
      await pause(2500);
    }
  }
}

export function start() {
  refreshLoop();
  chatLoop();
  approvalsLoop();
  threadLoop();
}

/** Re-reads everything now, after you've changed something. */
export function poke() {
  refresh().catch(() => {});
}
