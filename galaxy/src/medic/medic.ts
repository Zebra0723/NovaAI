// Galaxy Medic's rounds: look at every member, decide (doctor.ts), act, and tell Link.
//
// Everything outside (shell commands, HTTP, files, the clock) comes in through
// `System`, so the rounds can be tested without a Mac.

import { examine, type Observation, type Problem, type Spec, type Verdict } from "./doctor";

export interface System {
  sh(cmd: string, timeoutMs?: number): Promise<{ code: number; out: string }>;
  http(url: string, timeoutMs?: number): Promise<{ status: number; body: string } | null>;
  tail(path: string, lines?: number): string;
  now(): number;
}

export type Call = <T>(method: string, path: string, body?: unknown, timeoutMs?: number) => Promise<T | null>;

export interface MedicOptions {
  sys: System;
  call: Call;
  specs: Spec[];
  /** Optional: Claude, to explain a crash Medic doesn't recognise, in plain words. */
  explain?: (prompt: string) => Promise<string | null>;
}

export interface Round {
  at: number;
  verdicts: Record<string, Verdict>;
  acted: string[];
}

const SILENT_MS = 3 * 60_000;
const STUCK_MINUTES = 45;
const LOOP_WINDOW_MS = 15 * 60_000;

export class Medic {
  /** When Medic last restarted each member, to spot a crash loop. */
  private restarts = new Map<string, number[]>();
  /** How many checkups in a row each member has looked wrong. Medic acts on the second. */
  private strikes = new Map<string, number>();
  /** Problems open last round, by key, so the ones that cleared up get closed. */
  private open = new Map<string, { member: string; title: string }>();
  /** What Medic saw while Link was down, sent once it's back. */
  private backlog: { method: string; path: string; body: unknown }[] = [];
  private explained = new Map<string, number>();

  constructor(private readonly o: MedicOptions) {}

  private async tell(method: string, path: string, body: unknown) {
    if ((await this.o.call(method, path, body)) === null) this.backlog.push({ method, path, body });
  }

  private recentRestarts(id: string): number {
    const cutoff = this.o.sys.now() - LOOP_WINDOW_MS;
    const list = (this.restarts.get(id) ?? []).filter((t) => t > cutoff);
    this.restarts.set(id, list);
    return list.length;
  }

  // ---------------------------------------------------------------- observe

  private async job(label: string): Promise<Observation["job"]> {
    const r = await this.o.sys.sh(`launchctl print gui/$(id -u)/${label}`);
    if (r.code !== 0) return null;
    const pid = Number(/\bpid = (\d+)/.exec(r.out)?.[1] ?? 0);
    const exit = /last exit (?:code|status) = (-?\d+)/.exec(r.out)?.[1];
    return { running: /\bstate = running\b/.test(r.out) || pid > 0, pid, lastExit: exit === undefined ? null : Number(exit) };
  }

  async observe(): Promise<Record<string, Observation>> {
    const { sys } = this.o;
    const bodies = await this.o.call<any[]>("GET", "/v1/bodies");
    const linkUp = bodies !== null;
    const now = sys.now();
    const body = (id: string): Observation["body"] => {
      const b = bodies?.find((x) => x.id === id);
      return b ? { online: !!b.online, lastSeen: b.lastSeen ?? 0 } : null;
    };
    const claimed = linkUp ? ((await this.o.call<any[]>("GET", "/v1/tasks?status=claimed")) ?? []) : [];
    const training = linkUp ? await this.o.call<any>("GET", "/v1/training") : null;
    const out: Record<string, Observation> = {};
    for (const spec of this.o.specs) {
      const o: Observation = {};
      if (spec.label) o.job = await this.job(spec.label);
      if (spec.app) o.process = (await sys.sh(`pgrep -x ${spec.app.process}`)).code === 0;
      if (spec.id === "link") {
        o.answering = linkUp;
      } else if (linkUp) {
        o.body = body(spec.id);
        // Silent for a little while is fine (a heavy turn, a Mac waking up); only longer counts.
        if (o.body && !o.body.online && o.body.lastSeen && now - o.body.lastSeen < SILENT_MS) o.body.online = true;
      }
      if (spec.log) o.logTail = sys.tail(spec.log, 40);
      if (spec.id === "comet") {
        const h = await sys.http("http://127.0.0.1:8787/health", 3000);
        try {
          o.cometHealth = h && h.status === 200 ? { relays: Number(JSON.parse(h.body).relays ?? 0) } : null;
        } catch {
          o.cometHealth = null;
        }
        o.cometLocal = (await sys.sh("launchctl print gui/$(id -u)/com.imessage.server")).code === 0;
        const owner = await sys.sh(`ps -axo user=,command= | awk '/\\/server\\/src\\/index\\.ts/ && !/awk/ {print $1; exit}'`);
        const me = (await sys.sh("id -un")).out.trim();
        if (owner.out.trim() && owner.out.trim() !== me) o.cometUser = owner.out.trim();
      }
      if (spec.id === "trainer") o.trainerStatus = training?.trainerStatus ?? null;
      o.stuck = claimed
        .filter((t) => t.to === spec.id && now - (t.updatedAt ?? now) > STUCK_MINUTES * 60_000)
        .map((t) => ({ id: t.id, title: t.title, minutes: Math.round((now - t.updatedAt) / 60_000) }));
      out[spec.id] = o;
    }
    return out;
  }

  // ------------------------------------------------------------------ rounds

  /** One checkup: look, decide, act, tell Link. */
  async round(): Promise<Round> {
    const { sys } = this.o;
    const seen = await this.observe();
    const verdicts: Record<string, Verdict> = {};
    const acted: string[] = [];
    const nowOpen = new Map<string, { member: string; title: string }>();

    const linkDown = seen.link ? !seen.link.answering : false;
    for (const spec of this.o.specs) {
      if (linkDown && spec.id !== "link") {
        // Without Link, Medic can't tell who's checking in. Bring Link back first.
        verdicts[spec.id] = { health: "unknown", note: "Waiting for Galaxy Link", problems: [] };
        for (const [k, was] of this.open) if (was.member === spec.id) nowOpen.set(k, was);
        continue;
      }
      let v = examine(spec, seen[spec.id]!, this.recentRestarts(spec.id));
      const bad = v.health === "recovering" || v.health === "needs_you";
      const strikes = bad ? (this.strikes.get(spec.id) ?? 0) + 1 : 0;
      this.strikes.set(spec.id, strikes);
      // One bad look can be a blip (a restart in progress, a busy moment). Act on the second.
      if (bad && strikes < 2 && spec.id !== "link") {
        verdicts[spec.id] = { health: "unknown", note: "Checking again", problems: [] };
        for (const p of v.problems) if (this.open.has(p.key)) nowOpen.set(p.key, this.open.get(p.key)!);
        continue;
      }
      if (v.action) {
        const ok = await this.act(v.action);
        (this.restarts.get(spec.id) ?? this.restarts.set(spec.id, []).get(spec.id)!).push(sys.now());
        acted.push(`${spec.id}: ${v.action.kind}`);
        if (!ok) v = { ...v, health: "needs_you", note: "Couldn't restart it" };
      }
      verdicts[spec.id] = v;
      for (const p of v.problems) {
        nowOpen.set(p.key, { member: spec.id, title: p.title });
        await this.tell("POST", "/v1/medic/incidents", {
          key: p.key,
          member: spec.id,
          kind: p.kind,
          status: v.health === "needs_you" ? "needs_you" : "open",
          title: p.title,
          found: p.found,
          did: v.action ? (v.action.kind === "open" ? `Reopened ${spec.name}.` : `Restarted ${spec.name}.`) : "",
          fix: p.fix ?? "",
        });
        if (p.kind === "crash_loop") await this.explainOnce(spec, p);
      }
    }

    // Whatever was wrong last time and isn't now has been fixed.
    for (const [key, was] of this.open) {
      if (nowOpen.has(key)) continue;
      const health = verdicts[was.member]?.health;
      if (health === "healthy" || health === "off") {
        await this.tell("POST", "/v1/medic/resolve", { key, did: this.recentRestarts(was.member) ? "Restarted it; it's running again." : "It's back to normal." });
      } else nowOpen.set(key, was);
    }
    this.open = nowOpen;

    await this.tell("PUT", "/v1/medic/checkup", {
      at: sys.now(),
      members: this.o.specs.map((s) => ({ member: s.id, health: verdicts[s.id]!.health, note: verdicts[s.id]!.note })),
    });
    // Link is back: send what Medic saw while it was down.
    if (verdicts.link?.health === "healthy" && this.backlog.length) {
      const pending = this.backlog.splice(0);
      for (const b of pending) await this.o.call(b.method, b.path, b.body);
    }
    return { at: sys.now(), verdicts, acted };
  }

  private async act(action: NonNullable<Verdict["action"]>): Promise<boolean> {
    const cmd = action.kind === "kickstart" ? `launchctl kickstart -k gui/$(id -u)/${action.label}` : `open -g -b ${action.bundle}`;
    return (await this.o.sys.sh(cmd, 20_000)).code === 0;
  }

  /** A crash Medic can't name: Claude reads the log and says what's wrong in plain words. Once an hour at most. */
  private async explainOnce(spec: Spec, p: Problem) {
    if (!this.o.explain) return;
    const last = this.explained.get(p.key) ?? 0;
    if (this.o.sys.now() - last < 60 * 60_000) return;
    this.explained.set(p.key, this.o.sys.now());
    const text = await this.o.explain(
      `You are Galaxy Medic, keeping a personal assistant's members running on a Mac. ${spec.name} keeps crashing. Here is the end of its log:\n\n${p.found.slice(-4000)}\n\nIn two or three plain sentences for a non-programmer: what is most likely wrong, and the one thing to do about it (an exact Terminal command if there is one). No preamble.`,
    );
    if (text?.trim()) {
      await this.tell("POST", "/v1/medic/incidents", { key: p.key, member: spec.id, kind: p.kind, status: "needs_you", title: p.title, found: `${text.trim()}\n\nFrom its log:\n${p.found}`, fix: p.fix ?? "" });
    }
  }
}
