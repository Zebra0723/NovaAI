// What Galaxy Link does, apart from how it's reached.
//
// One assistant, several bodies. Every body shares one memory and one stream
// of what's been happening, and hands work to another only for a power it
// doesn't have itself. Link works with whichever bodies are running: none of
// them is required, and Orbit in particular is usually quit.

import { spawn } from "node:child_process";
import { PresenceReader } from "./presence";
import { Store, type Approval, type Body, type BodyID, type ChatMessage, type InboxItem, type Task } from "./store";

/** How a body reaches you. Link uses this to deliver results, never to start a conversation. */
export type Surface = "phone" | "screen" | "voice" | "none";

export interface BodyProfile {
  name: string;
  powers: string[];
  surface: Surface;
  /** Started by Link when work is queued for it and it isn't running. "" = never. */
  launch: string;
  /** Its first words in Galaxy Chat, unless it brings its own. */
  intro: string;
  /** Who it is, in more detail: what it posts in a round of introductions, and what the others are told about it. */
  about?: string;
  /** Work the others should hand it. Empty: never hand it anything. */
  sendMe?: string[];
  /** What it isn't for, so nobody hands it the wrong thing. */
  notFor?: string;
}

/**
 * The bodies Link knows about before any of them has said hello. A body's
 * hello can add powers; it can't change its surface, and Orbit is never
 * launched, never handed work it didn't ask for, and never sent a result to
 * speak: it only talks when someone talks to it.
 */
export const PROFILES: Record<BodyID, BodyProfile> = {
  comet: {
    name: "Comet",
    powers: ["imessage", "reach_phone", "build_web", "cad", "code", "research", "files"],
    surface: "phone",
    launch: "",
    intro:
      "Hi everyone, Comet here. I live in iMessage, so I'm the one who can reach our human on their phone " +
      "wherever they are. I build websites, CAD models and code with Claude Code. Anything that needs " +
      "building, send it my way.",
    about:
      "I'm Comet, the text member. I live in iMessage on my own Mac account, walled off from the human's files, " +
      "so I'm how GalaxyAI reaches them when they're away from the Mac. I answer texts and voice notes, " +
      "message the people the owner has let in, remember people and their dates, and quiz flashcards. " +
      "With Claude Code I build and deploy websites, make CAD models for printing, write code and do research.",
    sendMe: [
      "anything the human needs to see while they're away from the Mac",
      "texting someone on the human's behalf",
      "building a website, a CAD model or a small program",
      "research that ends in a short written answer",
    ],
    notFor: "anything that has to happen on the Mac's own screen or in its apps (that's Nova)",
  },
  nova: {
    name: "Nova",
    powers: ["screen", "mac_apps", "shell"],
    surface: "screen",
    launch: "open -g -b ai.galaxy.nova",
    intro:
      "Hey all, I'm Nova. I live on the Mac's screen, one Control-Space away. I can see what's on screen " +
      "and drive the mouse, keyboard and shell, so hand me anything that has to happen on this Mac.",
    about:
      "I'm Nova, the sight member. I live on the Mac's screen, one Control-Space away. I can see what's on screen, " +
      "and drive the mouse, the keyboard, any app and the shell. I can also send iMessages from the human's own " +
      "account. When the human is at the Mac, results show up with me on screen.",
    sendMe: [
      "anything that has to be clicked, typed or opened on this Mac",
      "downloading, renaming, moving or tidying files",
      "screenshots, and reading what's on screen",
      "changing a Mac setting or using an app like Photos, Mail or Calendar",
    ],
    notFor: "work that takes hours (that's Zenith), or reaching the human away from the Mac (that's Comet)",
  },
  orbit: {
    name: "Orbit",
    powers: ["voice"],
    surface: "voice",
    launch: "",
    intro:
      "Hello, I'm Orbit, the voice. I only speak when someone speaks to me, and I'm switched off most " +
      "of the time, so don't wait up for me.",
    about:
      "I'm Orbit, the voice member. The human talks to me out loud on the Mac, and I only ever speak when spoken " +
      "to. When I'm muted I stay silent until they unmute me, whatever happens. I'm quit most of the time. When the " +
      "human asks me for something I can't do by voice, I hand it to one of you.",
    sendMe: [],
    notFor: "anything at all: never hand me work or ask me to say something. I hand work out, I don't take it",
  },
  // Installments 4 and 5. They join by saying hello with their own powers.
  zenith: {
    name: "Zenith",
    powers: ["missions"],
    surface: "none",
    launch: "",
    intro:
      "Hi everyone, I'm Zenith. Give me the big missions, the ones that take hours. I work through " +
      "them on my own, one at a time, and bring back the finished thing.",
    about:
      "I'm Zenith, the commander. I take on the big missions, the ones with many steps that take hours. I work on " +
      "this Mac through Claude Code, inside a walled-off folder for each mission (~/Galaxy/Missions), one mission " +
      "at a time. I ask the human before spending money or posting anything in public, and when I finish, the " +
      "result goes to them the usual way: on screen if they're at the Mac, by text through Comet if not.",
    sendMe: [
      "projects with many steps: building an app, a full research report, a big reorganisation",
      "anything the human says to \"make a mission\" of",
      "work that can carry on while nobody is watching",
    ],
    notFor: "quick things (do them yourself, or ask Nova), or anything that needs the Mac's screen right now",
  },
  nebula: {
    name: "Nebula",
    powers: ["gestures", "approvals"],
    surface: "none",
    launch: "",
    intro:
      "Hi everyone, I'm Nebula, the hands. I read the human's gestures through the Mac's camera, so they can " +
      "scroll, turn the volume, mute and answer your questions without touching anything.",
    about:
      "I'm Nebula, the touch member. I watch for the human's hand gestures through the Mac's camera, but only " +
      "while they've switched me on (Fn+F1). Gestures scroll, turn the volume like a knob, mute and unmute, and " +
      "control the window in front. A thumbs up or down answers your approval questions when the human is at the Mac.",
    sendMe: ["approval questions: a thumbs up or down from the human is often the quickest answer"],
    notFor: "tasks: I don't do work myself, I'm how the human's hands reach the rest of you",
  },
};

/** How long an approval waits for an answer unless the asker says otherwise. */
export const APPROVAL_TTL_MS = 120_000;
const APPROVAL_MAX_TTL_MS = 3_600_000;

/** A body counts as running if it has been heard from this recently. */
export const ONLINE_WITHIN_MS = 90_000;
const LAUNCH_COOLDOWN_MS = 60_000;

export class LinkError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface BodyView extends Body {
  online: boolean;
  surface: Surface;
}

type Waiter = (task: Task | null) => void;

export class Link {
  private waiters = new Map<BodyID, Set<Waiter>>();
  private chatWaiters = new Set<() => void>();
  private inboxWaiters = new Map<BodyID, Set<() => void>>();
  private launchedAt = new Map<BodyID, number>();
  /** Bumped whenever the set of pending approvals changes, for long polls. */
  private approvalVersion = 1;
  private approvalListWaiters = new Set<() => void>();
  private approvalWaiters = new Map<string, Set<() => void>>();
  private expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  launcher: (command: string) => void = defaultLauncher;

  constructor(
    readonly store: Store,
    readonly presence = new PresenceReader(),
  ) {}

  // ------------------------------------------------------------------ bodies

  profile(id: BodyID): BodyProfile {
    return PROFILES[id] ?? { name: id, powers: [], surface: "none", launch: "", intro: "" };
  }

  hello(id: BodyID, info: { name?: string; powers?: string[]; version?: string; intro?: string }): BodyView {
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(id)) throw new LinkError(400, "body ids are lowercase words");
    const profile = this.profile(id);
    const powers = [...new Set([...profile.powers, ...(info.powers ?? [])])].filter((p) => /^[a-z_]{2,32}$/.test(p));
    this.store.upsertBody({
      id,
      name: info.name?.slice(0, 40) || profile.name,
      powers,
      launch: profile.launch,
      version: info.version?.slice(0, 40) ?? "",
    });
    // Anything it had claimed before it last went away is its again to pick up.
    this.store.requeueStale(id);
    this.store.addEvent(id, "presence", "started");
    // Every newcomer opens with a greeting and an introduction, once, ever.
    if (!this.store.hasIntroduced(id)) {
      const name = info.name?.slice(0, 40) || profile.name;
      const own = typeof info.intro === "string" ? info.intro.trim().slice(0, 1000) : "";
      const intro =
        own ||
        profile.intro ||
        `Hi everyone, I'm ${name}, the newest part of GalaxyAI.` +
          (powers.length ? ` I can help with ${powers.map((p) => p.replaceAll("_", " ")).join(", ")}.` : "") +
          " Glad to be here.";
      this.say(id, "intro", intro);
      // The others say hello back, so a newcomer knows who to send what from day one.
      if (this.store.hasRound()) this.welcome(id);
      else this.introduceIfDue();
    }
    return this.view(this.store.body(id)!);
  }

  heartbeat(id: BodyID): void {
    if (!this.store.touchBody(id)) throw new LinkError(404, "say hello first");
  }

  goodbye(id: BodyID): void {
    this.store.leaveBody(id);
    this.store.requeueStale(id);
    this.store.addEvent(id, "presence", "quit");
  }

  isOnline(id: BodyID): boolean {
    const body = this.store.body(id);
    return !!body && this.store.now() - body.lastSeen < ONLINE_WITHIN_MS;
  }

  view(body: Body): BodyView {
    return { ...body, online: this.store.now() - body.lastSeen < ONLINE_WITHIN_MS, surface: this.profile(body.id).surface };
  }

  bodies(): BodyView[] {
    return this.store.bodies().map((b) => this.view(b));
  }

  // --------------------------------------------------------------- handoffs

  /**
   * Picks who does a piece of work: the named body, or else the body with the
   * power, running ones first. Never the sender, and never Orbit unless it was
   * named outright - Orbit doesn't take work, it only answers.
   */
  route(from: BodyID, power: string, to?: BodyID): BodyID {
    if (to) {
      if (to === from) throw new LinkError(400, "a body can't hand work to itself");
      if (to === "orbit") throw new LinkError(400, "Orbit only speaks when spoken to; it doesn't take handoffs");
      if (!this.store.body(to) && !PROFILES[to]) throw new LinkError(404, `no body called ${to}`);
      return to;
    }
    const known = new Map<BodyID, string[]>();
    for (const [id, p] of Object.entries(PROFILES)) known.set(id, p.powers);
    for (const b of this.store.bodies()) known.set(b.id, b.powers);
    const able = [...known]
      .filter(([id, powers]) => id !== from && id !== "orbit" && powers.includes(power))
      .map(([id]) => id)
      .sort((a, b) => Number(this.isOnline(b)) - Number(this.isOnline(a)));
    if (!able.length) throw new LinkError(422, `no body has the power "${power}"`);
    return able[0]!;
  }

  handoff(input: { from: BodyID; to?: BodyID; power?: string; title: string; instructions: string; replyTo?: string }): Task {
    const title = input.title?.trim();
    const instructions = input.instructions?.trim();
    if (!title || !instructions) throw new LinkError(400, "a handoff needs a title and instructions");
    const to = this.route(input.from, input.power ?? "", input.to);
    const task = this.store.addTask({
      from: input.from,
      to,
      power: input.power ?? "",
      title: title.slice(0, 200),
      instructions: instructions.slice(0, 20_000),
      replyTo: input.replyTo ?? "",
    });
    this.store.addEvent(input.from, "handoff", `asked ${this.profile(to).name}: ${task.title}`, task.id);
    this.say(input.from, "handoff", `@${this.profile(to).name} could you take this one? ${task.title}`, task.id);
    this.wake(to);
    return task;
  }

  /** Hands the next queued task to `body`, waiting up to `waitMs` for one to arrive. */
  async next(body: BodyID, waitMs: number): Promise<Task | null> {
    this.store.touchBody(body);
    const now = this.claim(body);
    if (now || waitMs <= 0) return now;
    return new Promise((resolve) => {
      const set = this.waiters.get(body) ?? new Set();
      this.waiters.set(body, set);
      const done = (task: Task | null) => {
        clearTimeout(timer);
        set.delete(done);
        resolve(task);
      };
      const timer = setTimeout(() => done(null), waitMs);
      set.add(done);
    });
  }

  private claim(body: BodyID): Task | null {
    const task = this.store.claimTask(body);
    if (task) this.say(body, "claimed", `On it: ${task.title}`, task.id);
    return task;
  }

  progress(id: string, body: BodyID, note: string): Task {
    const task = this.owned(id, body);
    return this.store.progressTask(task.id, note.slice(0, 500))!;
  }

  finish(id: string, body: BodyID, ok: boolean, result: string): Task {
    const task = this.owned(id, body);
    const done = this.store.finishTask(task.id, ok ? "done" : "failed", result.slice(0, 20_000));
    if (!done) throw new LinkError(409, "that task is already finished");
    this.store.addEvent(body, ok ? "task_done" : "task_failed", `${ok ? "finished" : "couldn't finish"}: ${done.title}`, done.id);
    const summary = done.result.length > 600 ? done.result.slice(0, 600) + "…" : done.result;
    this.say(
      body,
      "result",
      `@${this.profile(done.from).name} ${ok ? "done" : "I couldn't finish"}: ${done.title}` + (summary ? `\n\n${summary}` : ""),
      done.id,
    );
    this.deliverResult(done);
    return done;
  }

  cancel(id: string, by: BodyID): Task {
    const task = this.store.task(id);
    if (!task) throw new LinkError(404, "no such task");
    if (task.from !== by) throw new LinkError(403, "only the body that asked can cancel");
    const done = this.store.finishTask(id, "cancelled", "");
    if (!done) throw new LinkError(409, "that task is already finished");
    return done;
  }

  private owned(id: string, body: BodyID): Task {
    const task = this.store.task(id);
    if (!task) throw new LinkError(404, "no such task");
    if (task.to !== body) throw new LinkError(403, "that task belongs to another body");
    return task;
  }

  private wake(body: BodyID) {
    const waiting = this.waiters.get(body);
    if (waiting?.size) {
      const claimed = this.claim(body);
      if (claimed) [...waiting][0]!(claimed);
      return;
    }
    if (!this.isOnline(body)) this.launch(body);
  }

  private launch(body: BodyID) {
    const command = this.store.body(body)?.launch || this.profile(body).launch;
    if (!command) return;
    const last = this.launchedAt.get(body) ?? 0;
    if (this.store.now() - last < LAUNCH_COOLDOWN_MS) return;
    this.launchedAt.set(body, this.store.now());
    this.launcher(command);
  }

  // ---------------------------------------------------------------- delivery

  /**
   * Where something you asked for should reach you. A result goes back to the
   * body you asked, if that body can show it to you where you are: the
   * screen only while you're at the Mac, your phone any time. A voice is
   * never a delivery surface - a result arriving later and spoken aloud would
   * be Orbit talking unprompted.
   */
  deliveryTarget(preferred: BodyID): BodyID {
    const surface = this.profile(preferred).surface;
    const atMac = this.presence.read().atMac;
    if (surface === "phone") return preferred;
    if (surface === "screen" && atMac && this.isOnline(preferred)) return preferred;
    if (atMac && this.isOnline("nova")) return "nova";
    // Comet's queue holds it until Comet is back, and Comet reaches your phone.
    return "comet";
  }

  private deliverResult(task: Task) {
    const target = this.deliveryTarget(task.from);
    const verb = task.status === "done" ? "finished" : "couldn't finish";
    this.post({
      body: target,
      kind: "task_result",
      taskId: task.id,
      // A reply_to only means something to the body that wrote it.
      replyTo: target === task.from ? task.replyTo : "",
      text: `${this.profile(task.to).name} ${verb} "${task.title}".${task.result ? "\n\n" + task.result : ""}`,
    });
  }

  /** A message for you from a body, routed to wherever you are. Only for things you asked for. */
  deliver(from: BodyID, text: string): InboxItem {
    const clean = text?.trim();
    if (!clean) throw new LinkError(400, "nothing to deliver");
    const target = this.deliveryTarget(from);
    return this.post({ body: target, kind: "message", taskId: "", replyTo: "", text: clean.slice(0, 20_000) });
  }

  private post(item: Pick<InboxItem, "body" | "kind" | "taskId" | "text" | "replyTo">): InboxItem {
    const posted = this.store.addInbox(item);
    for (const wake of this.inboxWaiters.get(item.body) ?? []) wake();
    if (!this.isOnline(item.body)) this.launch(item.body);
    return posted;
  }

  async inbox(body: BodyID, waitMs: number): Promise<InboxItem[]> {
    this.store.touchBody(body);
    const now = this.store.takeInbox(body);
    if (now.length || waitMs <= 0) return now;
    await new Promise<void>((resolve) => {
      const set = this.inboxWaiters.get(body) ?? new Set();
      this.inboxWaiters.set(body, set);
      const done = () => {
        clearTimeout(timer);
        set.delete(done);
        resolve();
      };
      const timer = setTimeout(done, waitMs);
      set.add(done);
    });
    return this.store.takeInbox(body);
  }

  // --------------------------------------------------------------- approvals

  /**
   * A body asks the user a yes-or-no. It reaches whoever can answer: Nebula arms its camera
   * for a thumbs up or down, Galaxy Chat shows it. The asker hears the answer the moment it's
   * given (`waitForDecision`), never by polling.
   */
  requestApproval(from: BodyID, input: { title?: unknown; detail?: unknown; ttlSeconds?: unknown }): Approval {
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (!title) throw new LinkError(400, "an approval needs a title: the question being asked");
    const ttl = Number.isFinite(input.ttlSeconds) ? Math.min(Math.max(Number(input.ttlSeconds) * 1000, 5_000), APPROVAL_MAX_TTL_MS) : APPROVAL_TTL_MS;
    const approval = this.store.addApproval({
      from,
      title: title.slice(0, 200),
      detail: typeof input.detail === "string" ? input.detail.slice(0, 4000) : "",
      expiresAt: this.store.now() + ttl,
    });
    this.store.addEvent(from, "approval", `asked for a yes or no: ${approval.title}`, approval.id);
    this.say(from, "approval", `Waiting on a yes or no: ${approval.title}`);
    const timer = setTimeout(() => this.expire(), ttl + 5);
    (timer as any).unref?.();
    this.expiryTimers.set(approval.id, timer);
    this.approvalsChanged();
    return approval;
  }

  approval(id: string): Approval {
    this.expire();
    const a = this.store.approval(id);
    if (!a) throw new LinkError(404, "no such approval");
    return a;
  }

  pendingApprovals(): { version: number; pending: Approval[] } {
    this.expire();
    return { version: this.approvalVersion, pending: this.store.pendingApprovals() };
  }

  /** The pending set as soon as it differs from `since` (a version), waiting up to `waitMs`. */
  async pendingApprovalsSince(since: number, waitMs: number): Promise<{ version: number; pending: Approval[] }> {
    const now = this.pendingApprovals();
    if (now.version !== since || waitMs <= 0) return now;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.approvalListWaiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, waitMs);
      this.approvalListWaiters.add(done);
    });
    return this.pendingApprovals();
  }

  /** Approve or reject. Any body but the asker may answer; the first answer wins. */
  decide(id: string, by: BodyID, decision: unknown, via: unknown): Approval {
    if (decision !== "approve" && decision !== "reject") throw new LinkError(400, 'decision must be "approve" or "reject"');
    const current = this.approval(id);
    if (current.from === by) throw new LinkError(403, "a body can't answer its own question");
    if (current.status !== "pending") throw new LinkError(409, `that approval is already ${current.status}`);
    const how = typeof via === "string" && /^[a-z_ -]{1,32}$/.test(via) ? via : "";
    const settled = this.store.settleApproval(id, decision === "approve" ? "approved" : "rejected", by, how);
    if (!settled) throw new LinkError(409, "that approval was just answered");
    const word = decision === "approve" ? "Approved" : "Rejected";
    this.store.addEvent(by, "approval", `${word.toLowerCase()}: ${settled.title}`, settled.id);
    this.say(by, "approval", `@${this.profile(settled.from).name} ${word}${how === "gesture" ? " with a gesture" : ""}: ${settled.title}`);
    this.settled(settled);
    return settled;
  }

  cancelApproval(id: string, by: BodyID): Approval {
    const current = this.approval(id);
    if (current.from !== by) throw new LinkError(403, "only the body that asked can cancel");
    const settled = this.store.settleApproval(id, "cancelled", by, "");
    if (!settled) throw new LinkError(409, `that approval is already ${current.status}`);
    this.settled(settled);
    return settled;
  }

  /** For the asker: returns as soon as the approval is answered, or after `waitMs`. */
  async waitForDecision(id: string, waitMs: number): Promise<Approval> {
    const now = this.approval(id);
    if (now.status !== "pending" || waitMs <= 0) return now;
    await new Promise<void>((resolve) => {
      const set = this.approvalWaiters.get(id) ?? new Set();
      this.approvalWaiters.set(id, set);
      const done = () => {
        clearTimeout(timer);
        set.delete(done);
        resolve();
      };
      const timer = setTimeout(done, waitMs);
      set.add(done);
    });
    return this.approval(id);
  }

  private expire() {
    for (const a of this.store.expireApprovals()) this.settled(a);
  }

  private settled(a: Approval) {
    const timer = this.expiryTimers.get(a.id);
    if (timer) clearTimeout(timer);
    this.expiryTimers.delete(a.id);
    for (const wake of [...(this.approvalWaiters.get(a.id) ?? [])]) wake();
    this.approvalWaiters.delete(a.id);
    this.approvalsChanged();
  }

  private approvalsChanged() {
    this.approvalVersion++;
    for (const wake of [...this.approvalListWaiters]) wake();
  }

  // ---------------------------------------------------------------- overview

  /**
   * Everything the Galaxy Link app's dashboard shows in one call: every
   * member (including ones that haven't joined yet), where you are, and
   * the day's numbers.
   */
  overview(startedAt: number) {
    const registered = new Map(this.store.bodies().map((b) => [b.id, b]));
    const ids = [...new Set([...Object.keys(PROFILES), ...registered.keys()])];
    const working = this.store.tasks({ status: "claimed" }, 50);
    const bodies = ids.map((id) => {
      const profile = this.profile(id);
      const body = registered.get(id);
      const task = working.find((t) => t.to === id);
      return {
        id,
        name: body?.name || profile.name,
        surface: profile.surface,
        powers: body?.powers ?? profile.powers,
        joined: !!body,
        online: !!body && this.store.now() - body.lastSeen < ONLINE_WITHIN_MS,
        lastSeen: body?.lastSeen ?? 0,
        version: body?.version ?? "",
        working: task ? { id: task.id, title: task.title, progress: task.progress } : null,
      };
    });
    const midnight = new Date(this.store.now());
    midnight.setHours(0, 0, 0, 0);
    const tasks = this.store.taskCounts(midnight.getTime());
    return {
      bodies,
      presence: this.presence.read(),
      counts: {
        memories: this.store.countMemories(),
        chatToday: this.store.countChatSince(midnight.getTime()),
        inFlight: tasks.queued + tasks.claimed,
        finishedToday: tasks.finishedSince,
        approvals: this.pendingApprovals().pending.length,
      },
      startedAt,
      now: this.store.now(),
    };
  }

  // ----------------------------------------------------------- introductions

  /** Members in a fixed order: the five installments first, then anyone newer. */
  private members(): Body[] {
    const order = ["comet", "orbit", "nova", "nebula", "zenith"];
    const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
    return this.store
      .bodies()
      .filter((b) => b.id !== "galaxy" && b.id !== "you")
      .sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
  }

  /** What `id` would like handed to it, as one phrase. */
  private sendMePhrase(id: BodyID): string {
    const send = this.profile(id).sendMe;
    if (send === undefined) {
      const powers = this.store.body(id)?.powers ?? [];
      return powers.length ? powers.map((p) => p.replaceAll("_", " ")).join(", ") : "";
    }
    return send.join("; ");
  }

  /** One member's fuller introduction: who it is, what to send it, and what not to. */
  private aboutMessage(id: BodyID): string {
    const p = this.profile(id);
    const about = p.about || `I'm ${this.store.body(id)?.name ?? p.name}.`;
    const send = this.sendMePhrase(id);
    const lines = [about];
    if (send) lines.push(`Send me: ${send}.`);
    if (p.notFor) lines.push(`Not for me: ${p.notFor}.`);
    return lines.filter(Boolean).join("\n");
  }

  /** What `from` says to the others once it's heard them all. */
  private replyMessage(from: BodyID, others: Body[]): string {
    if (from === "orbit") {
      return "Good to meet you all. When the human asks me for something out loud that I can't do by voice, " +
        "I'll pass it to whichever of you it suits.";
    }
    if (from === "nebula") {
      return "Good to meet you all. Whenever one of you asks the human a yes-or-no question, I'll show it and take their thumbs up or down.";
    }
    const asks = others
      .filter((b) => b.id !== from && this.profile(b.id).sendMe?.length !== 0)
      .map((b) => `@${b.name}, ${this.handoffLine(b.id)}`);
    return ["Good to meet you all.", ...asks].join(" ");
  }

  private handoffLine(to: BodyID): string {
    switch (to) {
      case "comet": return "I'll send you anything that has to reach the human away from the Mac, and anything to build.";
      case "nova": return "anything that has to happen on the Mac itself is yours.";
      case "zenith": return "the long missions go to you.";
      case "nebula": return "I'll ask the human through you when a quick yes or no will do.";
      default: {
        const send = this.sendMePhrase(to);
        return send ? `I'll come to you for ${send}.` : "good to have you.";
      }
    }
  }

  /**
   * A round of introductions in Galaxy Chat: every member says who it is in more
   * detail, what to send it and what not to, then each says how it will work with
   * the others. Written from what Link knows, so it costs no tokens.
   */
  introductions(): ChatMessage[] {
    const members = this.members();
    if (members.length < 2) throw new LinkError(409, "introductions need at least two members");
    const posted: ChatMessage[] = [];
    posted.push(this.say("galaxy", "round", `Introductions: ${members.map((b) => b.name).join(", ")}. Everyone, tell the others what you do and what to send you.`));
    for (const b of members) posted.push(this.say(b.id, "message", this.aboutMessage(b.id)));
    for (const b of members) posted.push(this.say(b.id, "message", this.replyMessage(b.id, members)));
    return posted;
  }

  /** Holds the first round of introductions as soon as there are two members to introduce. */
  introduceIfDue(): void {
    if (!this.store.hasRound() && this.members().length >= 2) this.introductions();
  }

  /** The others welcome a member who joined after the introductions. */
  private welcome(id: BodyID): void {
    const members = this.members();
    this.say(id, "message", this.aboutMessage(id));
    for (const b of members) {
      if (b.id === id || b.id === "orbit") continue;
      const sendable = this.profile(id).sendMe?.length !== 0;
      this.say(b.id, "message", `Welcome, @${this.profile(id).name || id}.${sendable ? ` ${this.handoffLine(id).replace(/^./, (c) => c.toUpperCase())}` : ""}`);
    }
  }

  // -------------------------------------------------------------------- chat

  /** Posts to Galaxy Chat as `body`. Only bodies post; the human watches. */
  say(body: BodyID, kind: ChatMessage["kind"], text: string, taskId = ""): ChatMessage {
    const clean = text?.trim();
    if (!clean) throw new LinkError(400, "nothing to say");
    const message = this.store.addChat(body, kind, clean.slice(0, 4000), taskId);
    for (const wake of [...this.chatWaiters]) wake();
    return message;
  }

  /** New messages after `afterID`, waiting up to `waitMs` for some if there are none yet. */
  async chat(afterID: number, waitMs: number, limit = 200): Promise<ChatMessage[]> {
    const now = this.store.chat(afterID, limit);
    if (now.length || waitMs <= 0 || !afterID) return now;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.chatWaiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, waitMs);
      this.chatWaiters.add(done);
    });
    return this.store.chat(afterID, limit);
  }

  // ----------------------------------------------------------------- context

  /**
   * One block of text a body can put in its system prompt: what the
   * assistant knows about you, what its other bodies have been doing, and
   * which of them are running. This is what makes it one assistant: ask
   * Nova about the site Comet built this morning and Nova knows.
   */
  promptContext(forBody: BodyID, opts: { memoryLimit?: number; hours?: number } = {}): string {
    const memories = this.store.memories("", opts.memoryLimit ?? 60);
    const since = this.store.now() - (opts.hours ?? 24) * 3600_000;
    const events = this.store.events(since, 40).filter((e) => e.kind !== "presence");
    const others = this.bodies().filter((b) => b.id !== forBody);
    const me = this.profile(forBody).name;
    const time = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

    const lines = [
      `You are ${me}, one body of the user's assistant, GalaxyAI. The other bodies share your memory and you share theirs.`,
      "",
      "What you know about the user:",
      ...(memories.length ? memories.map((m) => `- [${m.id}] ${m.text}`) : ["- Nothing yet."]),
      "",
      "What the assistant has been doing (last 24 hours):",
      ...(events.length ? events.map((e) => `- ${time(e.at)} ${this.profile(e.body).name}: ${e.summary}`) : ["- Nothing yet."]),
      "",
      "Your teammates (hand work to one with galaxy_handoff, using the id in brackets):",
      ...(others.length
        ? others.flatMap((b) => {
            const p = this.profile(b.id);
            const send = this.sendMePhrase(b.id);
            return [
              `- ${b.name} [${b.id}], ${b.online ? "running" : "not running right now"}. ${p.about ? `In its own words: "${p.about}"` : `Powers: ${b.powers.join(", ") || "none yet"}.`}`,
              send ? `  Hand ${b.name}: ${send}.` : `  Never hand ${b.name} anything.`,
              ...(p.notFor ? [`  Not for ${b.name}: ${p.notFor}.`] : []),
            ];
          })
        : ["- None has connected yet."]),
      "",
      "Do what you can yourself. Hand work on only for a power you don't have, to the teammate it suits.",
    ];
    return lines.join("\n");
  }
}

function defaultLauncher(command: string) {
  if (process.platform !== "darwin") return;
  const child = spawn("/bin/sh", ["-c", command], { detached: true, stdio: "ignore" });
  child.unref();
}
