// Galaxy Trainer's side of Link: each member's training program, its daily
// sessions, the playbook of lessons it has learned, the 1:1 thread between the
// trainer and each member that you oversee, and practice drills.
//
// Link only keeps and serves these. The trainer itself (src/trainer.ts) is a
// member like any other: it reads what happened, writes programs, runs drills
// and grades them, all through this API.
//
// A drill is a dry run. The member answers with what it would do, and never
// does it: members that support practice answer through their own brain with
// no tools; the rest are rehearsed by the trainer and marked as such.

import { exists } from "./edition";
import { diffPlans } from "./casebook";
import { BRIEFS } from "./trainer/briefs";
import type { Link } from "./link";
import type { BodyID, Store } from "./store";

/** Who training is for: every member that does work. The trainer doesn't train itself. */
// #owner
const ALL_TRAINEES = ["comet", "orbit", "nova", "nebula", "zenith"];
// #consumer const ALL_TRAINEES = ["orbit", "nova", "nebula", "zenith"];
// #end
/** The members the trainer trains in this edition (no Comet in the consumer one). */
export const trainees = () => ALL_TRAINEES.filter(exists);
export const TRAINER = "trainer";
/** Minutes of overnight training each member gets: Nebula, whose skill is the hardest to get right, gets double. */
export const BUDGET_MINUTES: Record<string, number> = { nebula: 24 };
export const DEFAULT_MINUTES = 12;
/** A session asked for by hand, to test training: always this long. */
export const TEST_MINUTES = 12;
export const budgetFor = (member: string) => BUDGET_MINUTES[member] ?? DEFAULT_MINUTES;
/** Overnight window, local hours [start, end): sessions only start inside it. */
export function trainingWindow(spec = process.env.GALAXY_TRAINER_WINDOW ?? "1-6"): [number, number] {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(spec.trim());
  return m ? [Number(m[1]) % 24, Number(m[2]) % 24] : [1, 6];
}
export function inWindow(d: Date, [start, end] = trainingWindow()): boolean {
  const h = d.getHours();
  return start <= end ? h >= start && h < end : h >= start || h < end;
}

/** Lessons a member's playbook holds at most. Fewer, sharper lessons beat a long list. */
export const PLAYBOOK_MAX = 12;
const LESSON_MAX_CHARS = 280;

export interface Program {
  member: BodyID;
  /** Where training started: the brief written before any session. */
  brief: string;
  /** The program as it stands: focus areas, rubric, scenario bank, data. JSON the trainer owns. */
  plan: TrainingPlan;
  version: number;
  updatedAt: number;
}

export interface TrainingPlan {
  /** What this member is working on, most important first. */
  focus: string[];
  /** How a drill is graded. */
  rubric: string[];
  /** Scenario bank: drills to draw from, growing every day. */
  scenarios: { title: string; setup: string; data?: string; good?: string }[];
  /** Notes the trainer keeps on this member: patterns it has seen in real work. */
  observations: string[];
}

export interface Session {
  id: string;
  member: BodyID;
  day: string;
  status: "running" | "done" | "failed";
  startedAt: number;
  endedAt: number;
  drills: number;
  /** 0 to 100, the day's average. */
  score: number | null;
  summary: string;
  /** "night" for the overnight program, "test" for one you asked for. */
  trigger: "night" | "test";
  /** When it was paused, or 0 if it isn't. */
  pausedAt: number;
  /** Time spent paused, in ms: it doesn't count towards the session's minutes. */
  pausedMs: number;
}

export interface Lesson {
  id: string;
  member: BodyID;
  text: string;
  sessionId: string;
  active: boolean;
  createdAt: number;
}

export type ThreadKind = "message" | "drill" | "answer" | "feedback" | "summary" | "note" | "sim" | "results" | "change";

/** A line in the 1:1 between the trainer and one member. You can add notes; you watch the rest. */
export interface ThreadMessage {
  id: number;
  member: BodyID;
  speaker: BodyID;
  kind: ThreadKind;
  text: string;
  sessionId: string;
  /** For answers: true when the trainer rehearsed the member instead of the member answering itself. */
  rehearsal: boolean;
  /** For feedback: the drill's score, 0 to 10. */
  score: number | null;
  at: number;
}

export interface Practice {
  id: string;
  /** "practice": answer a drill in words. "workout": Nebula trains its gestures on simulated hands. */
  kind: "practice" | "workout";
  member: BodyID;
  sessionId: string;
  prompt: string;
  answer: string;
  status: "waiting" | "answered" | "expired";
  createdAt: number;
  answeredAt: number;
}

const SCHEMA = `
create table if not exists training_programs (
  member text primary key,
  brief text not null,
  plan text not null,
  version integer not null,
  updated_at integer not null
);
create table if not exists training_sessions (
  id text primary key,
  member text not null,
  day text not null,
  status text not null,
  started_at integer not null,
  ended_at integer not null default 0,
  drills integer not null default 0,
  score real,
  summary text not null default ''
);
create index if not exists training_sessions_member on training_sessions(member, day);
create table if not exists training_program_versions (
  member text not null,
  version integer not null,
  brief text not null,
  plan text not null,
  at integer not null,
  primary key (member, version)
);
create table if not exists training_playbook_versions (
  id integer primary key autoincrement,
  member text not null,
  lessons text not null,
  session_id text not null default '',
  by text not null default '',
  at integer not null
);
create table if not exists training_lessons (
  id text primary key,
  member text not null,
  text text not null,
  session_id text not null default '',
  active integer not null default 1,
  created_at integer not null
);
create index if not exists training_lessons_member on training_lessons(member, active);
create table if not exists training_thread (
  id integer primary key autoincrement,
  member text not null,
  speaker text not null,
  kind text not null,
  text text not null,
  session_id text not null default '',
  rehearsal integer not null default 0,
  score real,
  at integer not null
);
create index if not exists training_thread_member on training_thread(member, id);
create table if not exists practice (
  id text primary key,
  member text not null,
  session_id text not null,
  prompt text not null,
  answer text not null default '',
  status text not null,
  created_at integer not null,
  answered_at integer not null default 0
);
`;

export class TrainingError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const newID = (prefix: string) => prefix + "_" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
const clean = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const strings = (v: unknown, maxItems: number, maxChars: number) =>
  Array.isArray(v) ? v.map((x) => clean(x, maxChars)).filter(Boolean).slice(0, maxItems) : [];

/** Keeps a plan to a known shape and size, whatever the trainer sent. */
export function tidyPlan(input: any): TrainingPlan {
  const scenarios = Array.isArray(input?.scenarios) ? input.scenarios : [];
  return {
    focus: strings(input?.focus, 8, 300),
    rubric: strings(input?.rubric, 8, 300),
    scenarios: scenarios
      .map((s: any) => ({
        title: clean(s?.title, 120),
        setup: clean(s?.setup, 1500),
        ...(clean(s?.data, 3000) ? { data: clean(s?.data, 3000) } : {}),
        ...(clean(s?.good, 800) ? { good: clean(s?.good, 800) } : {}),
      }))
      .filter((s: any, i: number, all: any[]) => s.title && s.setup && all.findIndex((x: any) => x.title?.toLowerCase() === s.title.toLowerCase()) === i)
      .slice(-60),
    observations: strings(input?.observations, 20, 400),
  };
}

export class Training {
  private threadWaiters = new Set<() => void>();
  private practiceWaiters = new Map<string, Set<() => void>>();

  constructor(
    private readonly link: Link,
    private readonly store: Store = link.store,
  ) {
    this.store.db.exec(SCHEMA);
    const columns = (table: string) => (this.db.query(`pragma table_info(${table})`).all() as any[]).map((c) => c.name);
    if (!columns("training_sessions").includes("trigger")) this.db.exec("alter table training_sessions add column trigger text not null default 'night'");
    if (!columns("practice").includes("kind")) this.db.exec("alter table practice add column kind text not null default 'practice'");
    // Pausing: when it was paused (0 = not paused), and how long it has been paused in all.
    if (!columns("training_sessions").includes("paused_at")) this.db.exec("alter table training_sessions add column paused_at integer not null default 0");
    if (!columns("training_sessions").includes("paused_ms")) this.db.exec("alter table training_sessions add column paused_ms integer not null default 0");
    this.db.exec("create table if not exists training_meta (key text primary key, value text not null)");
    // Sessions before 0.3 could end in seconds without really running. Start everyone again from their brief, once.
    if (!this.db.query("select 1 from training_meta where key = 'reset-0.4'").get()) {
      this.wipe();
      this.db.query("insert into training_meta (key, value) values ('reset-0.4', ?)").run(String(this.now()));
    }
    // #owner
    // Comet's brief grew (talking to people he lets in, building for them, never filling in an
    // email). A program made from the old brief takes in the new focus, rubric and scenarios, once.
    if (!this.db.query("select 1 from training_meta where key = 'comet-brief-2'").get()) {
      const before = this.program("comet");
      if (before) {
        const brief = BRIEFS.comet!;
        const focus = [...brief.plan.focus, ...before.plan.focus.filter((f) => !brief.plan.focus.includes(f))].slice(0, 8);
        const known = new Set(before.plan.scenarios.map((x) => x.title.toLowerCase()));
        const scenarios = [...before.plan.scenarios, ...brief.plan.scenarios.filter((x) => !known.has(x.title.toLowerCase()))];
        const plan = tidyPlan({ ...before.plan, focus, rubric: brief.plan.rubric, scenarios });
        this.db.query("update training_programs set brief = ?, plan = ?, version = version + 1, updated_at = ? where member = 'comet'").run(brief.brief, JSON.stringify(plan), this.now());
        this.recordChange("comet", before, this.program("comet")!);
      }
      this.db.query("insert into training_meta (key, value) values ('comet-brief-2', ?)").run(String(this.now()));
    }
    // #end
  }

  private wipe() {
    this.db.exec(
      "delete from training_sessions; delete from training_lessons; delete from training_programs; delete from training_thread; delete from practice; " +
        "delete from training_program_versions; delete from training_playbook_versions;",
    );
  }

  /** You start training over: every program, session, lesson and 1:1 goes. Members start from their brief again. */
  reset(who: BodyID) {
    if (who !== "you" && who !== "galaxy") throw new TrainingError(403, "only you can reset training");
    this.wipe();
    for (const wake of [...this.threadWaiters]) wake();
    return { ok: true };
  }

  /**
   * A session still marked running when the trainer isn't, or long past its time, didn't
   * really happen: it's closed as stopped, so nothing claims to be training when it isn't.
   */
  private settleStale() {
    const trainerUp = this.link.isOnline(TRAINER);
    const rows = this.db.query("select id, member, started_at, paused_at, paused_ms from training_sessions where status = 'running'").all() as any[];
    for (const r of rows) {
      const paused = r.paused_ms + (r.paused_at ? this.now() - r.paused_at : 0);
      // Paused more than an hour: it's not coming back. Otherwise only running time counts.
      const late = r.paused_at ? this.now() - r.paused_at > 60 * 60_000 : this.now() - r.started_at - paused > (budgetFor(r.member) + 10) * 60_000;
      if (!trainerUp || late) {
        this.db
          .query("update training_sessions set status = 'failed', ended_at = ?, summary = ? where id = ?")
          .run(this.now(), trainerUp ? "Ran past its time and was closed." : "The trainer stopped part way.", r.id);
      }
    }
  }

  private get db() {
    return this.store.db;
  }
  private now() {
    return this.store.now();
  }

  private needTrainee(member: string): BodyID {
    if (!trainees().includes(member) && !this.store.body(member)) throw new TrainingError(404, `no member called ${member}`);
    if (member === TRAINER) throw new TrainingError(400, "the trainer doesn't train itself");
    return member;
  }

  private needTrainer(who: BodyID) {
    if (who !== TRAINER) throw new TrainingError(403, "only Galaxy Trainer can do that");
  }

  // ---------------------------------------------------------------- programs

  program(member: BodyID): Program | null {
    const r = this.db.query("select * from training_programs where member = ?").get(member) as any;
    return r ? { member: r.member, brief: r.brief, plan: JSON.parse(r.plan), version: r.version, updatedAt: r.updated_at } : null;
  }

  /** Each member's program and playbook, for keeping in your account. */
  snapshot(): Record<string, { brief: string; plan: TrainingPlan; version: number; lessons: string[] }> {
    const out: Record<string, { brief: string; plan: TrainingPlan; version: number; lessons: string[] }> = {};
    for (const member of trainees()) {
      const p = this.program(member);
      if (p) out[member] = { brief: p.brief, plan: p.plan, version: p.version, lessons: this.lessons(member).filter((l) => l.active).map((l) => l.text) };
    }
    return out;
  }

  /** Puts back what your account kept, on a Mac that has none of it yet. Never overwrites. */
  restore(snapshot: Record<string, { brief?: string; plan?: unknown; version?: number; lessons?: unknown }>) {
    for (const [member, s] of Object.entries(snapshot ?? {})) {
      if (!trainees().includes(member) || this.program(member)) continue;
      this.db
        .query("insert into training_programs (member, brief, plan, version, updated_at) values (?, ?, ?, ?, ?)")
        .run(member, clean(s.brief, 6000), JSON.stringify(tidyPlan(s.plan ?? {})), Math.max(1, Math.floor(Number(s.version) || 1)), this.now());
      for (const text of strings(s.lessons, PLAYBOOK_MAX, LESSON_MAX_CHARS)) {
        this.db.query("insert into training_lessons (id, member, text, session_id, active, created_at) values (?, ?, ?, '', 1, ?)").run(newID("l"), member, text, this.now());
      }
    }
  }

  setProgram(who: BodyID, member: string, input: { brief?: string; plan?: unknown }): Program {
    this.needTrainer(who);
    this.needTrainee(member);
    const before = this.program(member);
    const brief = clean(input.brief, 6000) || before?.brief || "";
    const plan = tidyPlan(input.plan ?? before?.plan ?? {});
    // The version goes up only when something really changed: no new number for an unchanged program.
    if (before && brief === before.brief && JSON.stringify(plan) === JSON.stringify(tidyPlan(before.plan))) return before;
    this.db
      .query(
        `insert into training_programs (member, brief, plan, version, updated_at) values (?, ?, ?, 1, ?)
         on conflict(member) do update set brief = excluded.brief, plan = excluded.plan, version = version + 1, updated_at = excluded.updated_at`,
      )
      .run(member, brief, JSON.stringify(plan), this.now());
    const after = this.program(member)!;
    this.snapshotProgram(after);
    if (before) this.recordChange(member, before, after);
    return after;
  }

  private snapshotProgram(p: Program) {
    this.db
      .query("insert or replace into training_program_versions (member, version, brief, plan, at) values (?, ?, ?, ?, ?)")
      .run(p.member, p.version, p.brief, JSON.stringify(p.plan), this.now());
  }

  private snapshotPlaybook(member: BodyID, sessionId: string, by: string) {
    const lessons = this.lessons(member).map((l) => l.text);
    const last = this.db.query("select lessons from training_playbook_versions where member = ? order by id desc limit 1").get(member) as any;
    if (last && last.lessons === JSON.stringify(lessons)) return;
    this.db
      .query("insert into training_playbook_versions (member, lessons, session_id, by, at) values (?, ?, ?, ?, ?)")
      .run(member, JSON.stringify(lessons), sessionId, by, this.now());
  }

  /** Every version of a member's program and playbook, newest first. */
  history(member: string) {
    this.needTrainee(member);
    const current = this.program(member);
    if (current && !this.db.query("select 1 from training_program_versions where member = ? and version = ?").get(member, current.version)) {
      this.snapshotProgram(current); // programs from before history was kept
    }
    const programs = (this.db.query("select * from training_program_versions where member = ? order by version desc limit 100").all(member) as any[]).map((r) => ({
      version: r.version,
      brief: r.brief,
      plan: JSON.parse(r.plan) as TrainingPlan,
      at: r.at,
    }));
    const playbooks = (this.db.query("select * from training_playbook_versions where member = ? order by id desc limit 100").all(member) as any[]).map((r, i, all) => ({
      n: all.length - i,
      lessons: JSON.parse(r.lessons) as string[],
      sessionId: r.session_id,
      by: r.by,
      at: r.at,
    }));
    return { programs, playbooks };
  }

  // ------------------------------------------------------------- pausing

  /** You pause a running session. The trainer stops at the next drill or turn and waits. */
  pause(who: BodyID, id: string): Session {
    if (who !== "you" && who !== "galaxy") throw new TrainingError(403, "only you can pause a session");
    const s = this.session(id);
    if (!s) throw new TrainingError(404, "no such session");
    if (s.status !== "running") throw new TrainingError(409, "that session isn't running");
    if (!s.pausedAt) this.db.query("update training_sessions set paused_at = ? where id = ?").run(this.now(), id);
    for (const wake of [...this.threadWaiters]) wake();
    return this.session(id)!;
  }

  resume(who: BodyID, id: string): Session {
    if (who !== "you" && who !== "galaxy") throw new TrainingError(403, "only you can resume a session");
    const s = this.session(id);
    if (!s) throw new TrainingError(404, "no such session");
    if (s.pausedAt) {
      this.db.query("update training_sessions set paused_ms = paused_ms + ?, paused_at = 0 where id = ?").run(this.now() - s.pausedAt, id);
    }
    for (const wake of [...this.threadWaiters]) wake();
    return this.session(id)!;
  }

  /**
   * You stop a running session now: it ends as stopped, its open drills close, and the
   * trainer gives up at its next drill or turn without changing the program or playbook.
   */
  stop(who: BodyID, id: string): Session {
    if (who !== "you" && who !== "galaxy") throw new TrainingError(403, "only you can stop a session");
    const s = this.session(id);
    if (!s) throw new TrainingError(404, "no such session");
    if (s.status !== "running") return s;
    const pausedFor = s.pausedAt ? this.now() - s.pausedAt : 0;
    this.db.transaction(() => {
      this.db
        .query("update training_sessions set status = 'failed', ended_at = ?, paused_at = 0, paused_ms = paused_ms + ?, summary = 'Stopped by you.' where id = ?")
        .run(this.now(), pausedFor, id);
      this.db.query("update practice set status = 'expired' where session_id = ? and status = 'waiting'").run(id);
    })();
    for (const wake of [...this.threadWaiters]) wake();
    return this.session(id)!;
  }

  /** The trainer only writes into a session that's still running: one you stopped or removed stays that way. */
  private needLive(sessionId: unknown) {
    const id = clean(sessionId, 40);
    if (!id) return;
    const s = this.session(id);
    if (!s || s.status !== "running") throw new TrainingError(409, "that session was stopped");
  }

  /**
   * You remove a finished session from history: it, its drills and its 1:1 lines go, and it
   * no longer counts in scores or minutes. What it taught (program changes, playbook) stays,
   * since that already happened; change those in their own tabs.
   */
  removeSession(who: BodyID, id: string) {
    if (who !== "you" && who !== "galaxy") throw new TrainingError(403, "only you can remove a session");
    const s = this.session(id);
    if (!s) throw new TrainingError(404, "no such session");
    if (s.status === "running") throw new TrainingError(409, "stop or wait for the session to finish first");
    this.db.transaction(() => {
      this.db.query("delete from training_thread where session_id = ?").run(id);
      this.db.query("delete from practice where session_id = ?").run(id);
      this.db.query("delete from training_sessions where id = ?").run(id);
    })();
    for (const wake of [...this.threadWaiters]) wake();
    return { ok: true, removed: id };
  }

  /**
   * Link's own line in the 1:1 saying what the trainer changed, worked out from the program
   * before and after. It's what really happened, whatever the trainer says about it.
   */
  private recordChange(member: BodyID, before: Program, after: Program) {
    const d = diffPlans(before.plan, after.plan);
    if (d.empty) return;
    const label: Record<string, string> = { focus: "focus", rubric: "graded on", observations: "noticed", scenarios: "scenarios" };
    const lines: string[] = [];
    for (const k of ["focus", "scenarios", "rubric", "observations"]) {
      const plus = d.added[k] ?? [];
      const minus = d.removed[k] ?? [];
      if (plus.length) lines.push(`+ ${label[k]}: ${plus.slice(0, 4).join(" · ")}${plus.length > 4 ? ` (+${plus.length - 4} more)` : ""}`);
      if (minus.length && k !== "observations") lines.push(`− ${label[k]}: ${minus.slice(0, 3).join(" · ")}${minus.length > 3 ? ` (+${minus.length - 3} more)` : ""}`);
    }
    this.db
      .query("insert into training_thread (member, speaker, kind, text, session_id, rehearsal, score, at) values (?, 'link', 'change', ?, '', 0, null, ?)")
      .run(member, `Program v${before.version} → v${after.version}\n${lines.join("\n")}`, this.now());
    for (const wake of [...this.threadWaiters]) wake();
  }

  // ---------------------------------------------------------------- sessions

  private rowToSession(r: any): Session {
    return {
      id: r.id,
      member: r.member,
      day: r.day,
      status: r.status,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      drills: r.drills,
      score: r.score,
      summary: r.summary,
      trigger: r.trigger === "test" ? "test" : "night",
      pausedAt: r.paused_at ?? 0,
      pausedMs: r.paused_ms ?? 0,
    };
  }

  session(id: string): Session | null {
    const r = this.db.query("select * from training_sessions where id = ?").get(id) as any;
    return r ? this.rowToSession(r) : null;
  }

  sessions(member: BodyID, limit = 30): Session[] {
    return (this.db.query("select * from training_sessions where member = ? order by started_at desc limit ?").all(member, limit) as any[]).map(
      (r) => this.rowToSession(r),
    );
  }

  startSession(who: BodyID, member: string, day: string, trigger: "night" | "test" = "night"): Session {
    this.needTrainer(who);
    this.needTrainee(member);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new TrainingError(400, "day is YYYY-MM-DD");
    // A session left running (the trainer was quit mid-way) is closed off first.
    this.db
      .query("update training_sessions set status = 'failed', ended_at = ?, summary = 'Stopped part way.' where member = ? and status = 'running'")
      .run(this.now(), member);
    const id = newID("s");
    this.db
      .query("insert into training_sessions (id, member, day, status, started_at, trigger) values (?, ?, ?, 'running', ?, ?)")
      .run(id, member, day, this.now(), trigger === "test" ? "test" : "night");
    return this.session(id)!;
  }

  finishSession(who: BodyID, id: string, input: { status?: string; drills?: number; score?: number | null; summary?: string }): Session {
    this.needTrainer(who);
    const s = this.session(id);
    if (!s) throw new TrainingError(404, "no such session");
    if (s.status !== "running") return s; // you stopped it first: that stands
    const status = input.status === "failed" ? "failed" : "done";
    const score = typeof input.score === "number" && Number.isFinite(input.score) ? Math.max(0, Math.min(100, input.score)) : null;
    this.db
      .query("update training_sessions set status = ?, ended_at = ?, drills = ?, score = ?, summary = ? where id = ?")
      .run(status, this.now(), Math.max(0, Math.floor(Number(input.drills) || 0)), score, clean(input.summary, 2000), id);
    this.link.store.addEvent(TRAINER, "training", `${status === "done" ? "trained" : "couldn't finish training"} ${this.link.profile(s.member).name}${score !== null ? ` (${Math.round(score)}/100)` : ""}`);
    return this.session(id)!;
  }

  /** Minutes of training a member has had on `day`. Sessions you asked for count like any other. */
  minutesOn(member: BodyID, day: string): number {
    const rows = this.db.query("select started_at, ended_at, paused_at, paused_ms from training_sessions where member = ? and day = ?").all(member, day) as any[];
    const ms = rows.reduce(
      (sum, r) => sum + ((r.ended_at || this.now()) - r.started_at) - r.paused_ms - (r.paused_at && !r.ended_at ? this.now() - r.paused_at : 0),
      0,
    );
    return Math.round(ms / 60_000);
  }

  // ----------------------------------------------------------------- lessons

  private rowToLesson(r: any): Lesson {
    return { id: r.id, member: r.member, text: r.text, sessionId: r.session_id, active: !!r.active, createdAt: r.created_at };
  }

  lessons(member: BodyID, all = false): Lesson[] {
    const sql = all
      ? "select * from training_lessons where member = ? order by created_at desc limit 200"
      : "select * from training_lessons where member = ? and active = 1 order by created_at";
    return (this.db.query(sql).all(member) as any[]).map((r) => this.rowToLesson(r));
  }

  /**
   * The trainer replaces a member's playbook with a new one. Lessons it keeps
   * stay as they are; the ones it drops are switched off, not deleted, so you
   * can see what was there. Ones you switched off yourself stay off.
   */
  setPlaybook(who: BodyID, member: string, texts: unknown, sessionId = ""): Lesson[] {
    this.needTrainer(who);
    this.needTrainee(member);
    this.needLive(sessionId);
    const wanted = strings(texts, PLAYBOOK_MAX, LESSON_MAX_CHARS);
    const key = (t: string) => t.toLowerCase().replace(/\s+/g, " ").replace(/[.!\s]+$/, "");
    const current = this.lessons(member);
    const removedByYou = new Set(
      (this.db.query("select text from training_lessons where member = ? and active = -1").all(member) as any[]).map((r) => key(r.text)),
    );
    const keep = new Set(wanted.map(key));
    this.db.transaction(() => {
      for (const l of current) if (!keep.has(key(l.text))) this.db.query("update training_lessons set active = 0 where id = ?").run(l.id);
      const have = new Set(current.map((l) => key(l.text)));
      for (const text of wanted) {
        if (have.has(key(text)) || removedByYou.has(key(text))) continue;
        this.db
          .query("insert into training_lessons (id, member, text, session_id, active, created_at) values (?, ?, ?, ?, 1, ?)")
          .run(newID("l"), member, text, sessionId, this.now());
      }
    })();
    this.snapshotPlaybook(member, sessionId, "trainer");
    return this.lessons(member);
  }

  /** You switch a lesson off (or back on). Switched off by you, the trainer can't bring it back. */
  setLessonActive(who: BodyID, id: string, active: boolean): Lesson {
    if (who !== "you" && who !== TRAINER) throw new TrainingError(403, "only you or the trainer can change the playbook");
    const r = this.db.query("select * from training_lessons where id = ?").get(id) as any;
    if (!r) throw new TrainingError(404, "no such lesson");
    this.db.query("update training_lessons set active = ? where id = ?").run(active ? 1 : who === "you" ? -1 : 0, id);
    this.snapshotPlaybook(r.member, "", who);
    return this.rowToLesson(this.db.query("select * from training_lessons where id = ?").get(id));
  }

  /** The playbook block a member reads in its prompt. Empty until it has lessons. */
  playbookContext(member: BodyID): string[] {
    const lessons = this.lessons(member);
    if (!lessons.length) return [];
    return [
      "",
      "Your playbook (what Galaxy Trainer has taught you from practice and from your real work; follow it):",
      ...lessons.map((l) => `- ${l.text}`),
    ];
  }

  // ------------------------------------------------------------------ thread

  private rowToThread(r: any): ThreadMessage {
    return {
      id: r.id,
      member: r.member,
      speaker: r.speaker,
      kind: r.kind,
      text: r.text,
      sessionId: r.session_id,
      rehearsal: !!r.rehearsal,
      score: r.score,
      at: r.at,
    };
  }

  /**
   * Adds a line to the 1:1 between the trainer and `member`. The trainer can
   * say anything; the member answers drills; you leave notes for the trainer.
   */
  post(
    who: BodyID,
    member: string,
    input: { kind?: string; text?: string; sessionId?: string; rehearsal?: boolean; score?: number | null; speaker?: string },
  ): ThreadMessage {
    this.needTrainee(member);
    const text = clean(input.text, 20_000);
    if (!text) throw new TrainingError(400, "nothing to say");
    if (who === TRAINER) this.needLive(input.sessionId);
    let kind = (input.kind ?? "message") as ThreadKind;
    let speaker: BodyID = who;
    if (who === "you") kind = "note";
    else if (who === TRAINER) {
      if (!["message", "drill", "answer", "feedback", "summary", "sim", "results"].includes(kind)) kind = "message";
      // The trainer posts a rehearsed answer in the member's place, marked as rehearsed.
      if (kind === "answer") speaker = member;
    } else if (who === member) kind = kind === "answer" ? "answer" : "message";
    else throw new TrainingError(403, "only the trainer, the member and you talk in this thread");
    const score = typeof input.score === "number" && Number.isFinite(input.score) ? Math.max(0, Math.min(10, input.score)) : null;
    const rehearsal = kind === "answer" && who === TRAINER && input.rehearsal !== false;
    const result = this.db
      .query("insert into training_thread (member, speaker, kind, text, session_id, rehearsal, score, at) values (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(member, speaker, kind, text, clean(input.sessionId, 40), rehearsal ? 1 : 0, kind === "feedback" || kind === "results" ? score : null, this.now());
    for (const wake of [...this.threadWaiters]) wake();
    return this.rowToThread(this.db.query("select * from training_thread where id = ?").get(result.lastInsertRowid));
  }

  thread(member: BodyID, afterID = 0, limit = 400): ThreadMessage[] {
    const rows = afterID
      ? (this.db.query("select * from training_thread where member = ? and id > ? order by id limit ?").all(member, afterID, limit) as any[])
      : (this.db.query("select * from training_thread where member = ? order by id desc limit ?").all(member, limit) as any[]).reverse();
    return rows.map((r) => this.rowToThread(r));
  }

  /** New lines in any thread after `afterID`, waiting up to `waitMs` for some. */
  async threads(afterID: number, waitMs: number): Promise<ThreadMessage[]> {
    const read = () => (this.db.query("select * from training_thread where id > ? order by id limit 500").all(afterID) as any[]).map((r) => this.rowToThread(r));
    const now = read();
    if (now.length || waitMs <= 0) return now;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.threadWaiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, waitMs);
      this.threadWaiters.add(done);
    });
    return read();
  }

  /** Your notes to the trainer about `member` since its last session started. */
  notesSince(member: BodyID, sinceMs: number): ThreadMessage[] {
    return (this.db.query("select * from training_thread where member = ? and kind = 'note' and at > ? order by id").all(member, sinceMs) as any[]).map((r) =>
      this.rowToThread(r),
    );
  }

  // ---------------------------------------------------------------- practice

  private rowToPractice(r: any): Practice {
    return {
      id: r.id,
      kind: r.kind === "workout" ? "workout" : "practice",
      member: r.member,
      sessionId: r.session_id,
      prompt: r.prompt,
      answer: r.answer,
      status: r.status,
      createdAt: r.created_at,
      answeredAt: r.answered_at,
    };
  }

  practice(id: string): Practice | null {
    const r = this.db.query("select * from practice where id = ?").get(id) as any;
    return r ? this.rowToPractice(r) : null;
  }

  /** The trainer sets a member a drill. It reaches the member through its inbox, as kind "practice". */
  setDrill(who: BodyID, input: { member?: string; sessionId?: string; prompt?: string; kind?: string }): Practice {
    this.needTrainer(who);
    const member = this.needTrainee(String(input.member ?? ""));
    const kind = input.kind === "workout" ? "workout" : "practice";
    const prompt = clean(input.prompt, kind === "workout" ? 20_000 : 12_000);
    if (!prompt) throw new TrainingError(400, "a drill needs a prompt");
    this.needLive(input.sessionId);
    const power = kind === "workout" ? "gesture_training" : "practice";
    if (!this.link.isOnline(member) || !this.store.body(member)?.powers.includes(power)) {
      throw new TrainingError(409, `${this.link.profile(member).name} can't take a ${kind === "workout" ? "workout" : "drill"} right now`);
    }
    const id = newID("p");
    this.db
      .query("insert into practice (id, member, session_id, prompt, status, created_at, kind) values (?, ?, ?, ?, 'waiting', ?, ?)")
      .run(id, member, clean(input.sessionId, 40), prompt, this.now(), kind);
    this.link.postInbox({ body: member, kind, taskId: id, text: prompt, replyTo: "" });
    return this.practice(id)!;
  }

  /** The member answers its drill. Only the member it was set for can. */
  answer(who: BodyID, id: string, answer: unknown): Practice {
    const p = this.practice(id);
    if (!p) throw new TrainingError(404, "no such drill");
    if (p.member !== who) throw new TrainingError(403, "that drill was set for someone else");
    if (p.status !== "waiting") throw new TrainingError(409, "that drill is closed");
    const text = clean(answer, p.kind === "workout" ? 60_000 : 6000);
    if (!text) throw new TrainingError(400, "an empty answer");
    this.db.query("update practice set answer = ?, status = 'answered', answered_at = ? where id = ?").run(text, this.now(), id);
    // The member's own answer goes straight into its 1:1, in its own name. A workout's
    // results are read and posted by the trainer, once it has made sense of them.
    if (p.kind === "practice") this.post(who, p.member, { kind: "answer", text, sessionId: p.sessionId });
    for (const wake of [...(this.practiceWaiters.get(id) ?? [])]) wake();
    return this.practice(id)!;
  }

  /** The drill, once answered or after `waitMs`, whichever comes first. Closes it if it times out. */
  async awaitAnswer(id: string, waitMs: number): Promise<Practice> {
    const p = this.practice(id);
    if (!p) throw new TrainingError(404, "no such drill");
    if (p.status === "waiting" && waitMs > 0) {
      await new Promise<void>((resolve) => {
        const set = this.practiceWaiters.get(id) ?? new Set();
        this.practiceWaiters.set(id, set);
        const done = () => {
          clearTimeout(timer);
          set.delete(done);
          if (!set.size) this.practiceWaiters.delete(id);
          resolve();
        };
        const timer = setTimeout(done, waitMs);
        set.add(done);
      });
    }
    return this.practice(id)!;
  }

  expireDrill(who: BodyID, id: string): Practice {
    this.needTrainer(who);
    this.db.query("update practice set status = 'expired' where id = ? and status = 'waiting'").run(id);
    const p = this.practice(id);
    if (!p) throw new TrainingError(404, "no such drill");
    return p;
  }

  // ------------------------------------------------------------------ health

  /** The trainer reports whether it can think (reach Claude Code), and why not. */
  setStatus(who: BodyID, input: { ok?: unknown; reason?: unknown }) {
    this.needTrainer(who);
    const status = { ok: input.ok === true, reason: clean(input.reason, 500), at: this.now() };
    this.db.query("insert into training_meta (key, value) values ('status', ?) on conflict(key) do update set value = excluded.value").run(JSON.stringify(status));
    return status;
  }

  status(): { ok: boolean; reason: string; at: number } | null {
    const r = this.db.query("select value from training_meta where key = 'status'").get() as any;
    try {
      return r ? JSON.parse(r.value) : null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- overview

  /** Everything the Trainer page shows at a glance. */
  overview(day = localDay(new Date(this.now()))) {
    this.settleStale();
    const [start, end] = trainingWindow();
    return {
      day,
      minutesPerDay: DEFAULT_MINUTES,
      testMinutes: TEST_MINUTES,
      window: { start, end },
      trainerOnline: this.link.isOnline(TRAINER),
      trainerStatus: this.status(),
      members: trainees().map((member) => {
        const sessions = this.sessions(member, 14);
        const program = this.program(member);
        return {
          member,
          joined: !!this.store.body(member),
          practises: !!this.store.body(member)?.powers.includes(member === "nebula" ? "gesture_training" : "practice"),
          budget: budgetFor(member),
          minutesToday: this.minutesOn(member, day),
          lessons: this.lessons(member).length,
          programVersion: program?.version ?? 0,
          focus: program?.plan.focus.slice(0, 3) ?? [],
          latest: sessions[0] ?? null,
          scores: sessions
            .filter((s) => s.status === "done" && s.score !== null)
            .map((s) => ({ day: s.day, score: s.score! }))
            .reverse(),
        };
      }),
    };
  }

  /** One member's whole training: program, playbook, sessions and the 1:1. */
  member(member: string) {
    this.needTrainee(member);
    this.settleStale();
    return {
      member,
      program: this.program(member),
      lessons: this.lessons(member, true),
      sessions: this.sessions(member, 30),
      thread: this.thread(member),
      history: this.history(member),
    };
  }
}

/** 2026-10-28, in the Mac's own time zone. */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
