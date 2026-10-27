// What Galaxy Link does, apart from how it's reached.
//
// One assistant, several bodies. Every body shares one memory and one stream
// of what's been happening, and hands work to another only for a power it
// doesn't have itself. Link works with whichever bodies are running: none of
// them is required, and Orbit in particular is usually quit.

import { spawn } from "node:child_process";
import { PresenceReader } from "./presence";
import { Store, type Body, type BodyID, type InboxItem, type Task } from "./store";

/** How a body reaches you. Link uses this to deliver results, never to start a conversation. */
export type Surface = "phone" | "screen" | "voice" | "none";

export interface BodyProfile {
  name: string;
  powers: string[];
  surface: Surface;
  /** Started by Link when work is queued for it and it isn't running. "" = never. */
  launch: string;
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
  },
  nova: {
    name: "Nova",
    powers: ["screen", "mac_apps", "shell"],
    surface: "screen",
    launch: "open -g -b ai.galaxy.nova",
  },
  orbit: { name: "Orbit", powers: ["voice"], surface: "voice", launch: "" },
  // Installments 4 and 5. They join by saying hello with their own powers.
  nebula: { name: "Nebula", powers: [], surface: "none", launch: "" },
  zenith: { name: "Zenith", powers: [], surface: "none", launch: "" },
};

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
  private inboxWaiters = new Map<BodyID, Set<() => void>>();
  private launchedAt = new Map<BodyID, number>();
  launcher: (command: string) => void = defaultLauncher;

  constructor(
    readonly store: Store,
    readonly presence = new PresenceReader(),
  ) {}

  // ------------------------------------------------------------------ bodies

  profile(id: BodyID): BodyProfile {
    return PROFILES[id] ?? { name: id, powers: [], surface: "none", launch: "" };
  }

  hello(id: BodyID, info: { name?: string; powers?: string[]; version?: string }): BodyView {
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
    this.wake(to);
    return task;
  }

  /** Hands the next queued task to `body`, waiting up to `waitMs` for one to arrive. */
  async next(body: BodyID, waitMs: number): Promise<Task | null> {
    this.store.touchBody(body);
    const now = this.store.claimTask(body);
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

  progress(id: string, body: BodyID, note: string): Task {
    const task = this.owned(id, body);
    return this.store.progressTask(task.id, note.slice(0, 500))!;
  }

  finish(id: string, body: BodyID, ok: boolean, result: string): Task {
    const task = this.owned(id, body);
    const done = this.store.finishTask(task.id, ok ? "done" : "failed", result.slice(0, 20_000));
    if (!done) throw new LinkError(409, "that task is already finished");
    this.store.addEvent(body, ok ? "task_done" : "task_failed", `${ok ? "finished" : "couldn't finish"}: ${done.title}`, done.id);
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
      const claimed = this.store.claimTask(body);
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
      "The other bodies:",
      ...(others.length
        ? others.map((b) => `- ${b.name} (${b.online ? "running" : "not running"}): ${b.powers.join(", ") || "no powers yet"}`)
        : ["- None has connected yet."]),
    ];
    return lines.join("\n");
  }
}

function defaultLauncher(command: string) {
  if (process.platform !== "darwin") return;
  const child = spawn("/bin/sh", ["-c", command], { detached: true, stdio: "ignore" });
  child.unref();
}
