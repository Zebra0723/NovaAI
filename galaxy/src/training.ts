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

import { diffPlans } from "./casebook";
import type { Link } from "./link";
import type { BodyID, Store } from "./store";

/** Who training is for: every member that does work. The trainer doesn't train itself. */
export const TRAINEES = ["comet", "orbit", "nova", "nebula", "zenith"];
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
    this.db.exec("create table if not exists training_meta (key text primary key, value text not null)");
    // Sessions before 0.3 could end in seconds without really running. Start everyone again from their brief, once.
    if (!this.db.query("select 1 from training_meta where key = 'reset-0.4'").get()) {
      this.wipe();
      this.db.query("insert into training_meta (key, value) values ('reset-0.4', ?)").run(String(this.now()));
    }
  }

  private wipe() {
    this.db.exec("delete from training_sessions; delete from training_lessons; delete from training_programs; delete from training_thread; delete from practice;");
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
    const rows = this.db.query("select id, member, started_at from training_sessions where status = 'running'").all() as any[];
    for (const r of rows) {
      const late = this.now() - r.started_at > (budgetFor(r.member) + 10) * 60_000;
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
    if (!TRAINEES.includes(member) && !this.store.body(member)) throw new TrainingError(404, `no member called ${member}`);
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
    if (before) this.recordChange(member, before, after);
    return after;
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
    const rows = this.db.query("select started_at, ended_at from training_sessions where member = ? and day = ?").all(member, day) as any[];
    const ms = rows.reduce((sum, r) => sum + ((r.ended_at || this.now()) - r.started_at), 0);
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
    return this.lessons(member);
  }

  /** You switch a lesson off (or back on). Switched off by you, the trainer can't bring it back. */
  setLessonActive(who: BodyID, id: string, active: boolean): Lesson {
    if (who !== "you" && who !== TRAINER) throw new TrainingError(403, "only you or the trainer can change the playbook");
    const r = this.db.query("select * from training_lessons where id = ?").get(id) as any;
    if (!r) throw new TrainingError(404, "no such lesson");
    this.db.query("update training_lessons set active = ? where id = ?").run(active ? 1 : who === "you" ? -1 : 0, id);
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
      members: TRAINEES.map((member) => {
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
    };
  }
}

/** 2026-10-28, in the Mac's own time zone. */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
