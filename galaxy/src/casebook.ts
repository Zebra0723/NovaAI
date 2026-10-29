// The casebook: how well each member is really doing, and the 1:1 where Galaxy
// Medic brings the Trainer what it found.
//
//   - Performance: every member's real record, worked out by Link from what
//     happened (handoffs finished or failed, how long they took, work that went
//     quiet, crashes, your noes, practice scores), never from what a member says.
//   - Claim checks: Medic checks each finished handoff's result against its ask.
//     "Done" with nothing to show for it is unverified; "done" that says it failed
//     is contradicted. Those count against the member.
//   - The Medic and Trainer 1:1: Medic reports a low point with its evidence; the
//     Trainer answers by changing that member's program. What changed is recorded
//     by Link itself, from the program before and after, so "I've added that" can
//     never stand in for actually adding it. A report nobody acted on stays open,
//     and Medic follows up on whether the member got better.

import type { Link } from "./link";
import type { BodyID, Store } from "./store";
import type { TrainingPlan } from "./training";

export const CASE_MEMBERS = ["comet", "orbit", "nova", "nebula", "zenith"];
const DAY = 86_400_000;

export type Verdict = "verified" | "unverified" | "contradicted";

export interface Audit {
  taskId: string;
  member: string;
  title: string;
  verdict: Verdict;
  why: string;
  at: number;
}

export type CaseKind = "report" | "reply" | "change" | "followup";
export type CaseStatus = "open" | "acted" | "improved" | "still_low" | "closed";

export interface CaseEntry {
  id: number;
  kind: CaseKind;
  /** medic, trainer, or link (Link's own record of a change). */
  speaker: string;
  member: string;
  text: string;
  /** report: the low point and its evidence; change: the program's diff. */
  data: any;
  /** Reports only. */
  status: CaseStatus | "";
  /** Replies, changes and follow-ups: the report they answer. */
  ref: number;
  at: number;
}

export interface Performance {
  member: string;
  window: { from: number; to: number };
  handoffs: { done: number; failed: number; cancelled: number; open: number };
  /** Share of finished handoffs that failed, 0 to 1, or null with none finished. */
  failRate: number | null;
  /** Median minutes from handoff to finish. */
  medianMinutes: number | null;
  claims: { verified: number; unverified: number; contradicted: number };
  crashes: number;
  stuck: number;
  refusedByYou: number;
  practice: { latest: number | null; previous: number | null };
  /** Per day for the chart, oldest first: share of its handoffs that went well (done and not contradicted). */
  days: { day: string; good: number; bad: number }[];
}

const SCHEMA = `
create table if not exists medic_audits (
  task_id text primary key,
  member text not null,
  title text not null,
  verdict text not null,
  why text not null default '',
  at integer not null
);
create table if not exists casebook (
  id integer primary key autoincrement,
  kind text not null,
  speaker text not null,
  member text not null,
  text text not null,
  data text not null default '{}',
  status text not null default '',
  ref integer not null default 0,
  at integer not null
);
create index if not exists casebook_ref on casebook(ref);
`;

export class CaseError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const dayOf = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** What changed between two versions of a program, as plain lines. Link's record, not the trainer's. */
export function diffPlans(before: TrainingPlan | null, after: TrainingPlan | null): { added: Record<string, string[]>; removed: Record<string, string[]>; empty: boolean } {
  const added: Record<string, string[]> = {};
  const removed: Record<string, string[]> = {};
  const lists = (p: TrainingPlan | null) => ({
    focus: p?.focus ?? [],
    rubric: p?.rubric ?? [],
    observations: p?.observations ?? [],
    scenarios: (p?.scenarios ?? []).map((s) => s.title),
  });
  const a = lists(before);
  const b = lists(after);
  for (const k of Object.keys(b) as (keyof typeof b)[]) {
    const plus = b[k].filter((x) => !a[k].includes(x));
    const minus = a[k].filter((x) => !b[k].includes(x));
    if (plus.length) added[k] = plus;
    if (minus.length) removed[k] = minus;
  }
  return { added, removed, empty: !Object.keys(added).length && !Object.keys(removed).length };
}

export class Casebook {
  private waiters = new Set<() => void>();

  constructor(
    private readonly link: Link,
    private readonly store: Store = link.store,
  ) {
    this.store.db.exec(SCHEMA);
  }

  private get db() {
    return this.store.db;
  }
  private now() {
    return this.store.now();
  }

  // ------------------------------------------------------------ claim checks

  /** Finished handoffs Medic hasn't checked yet, newest first. */
  unaudited(limit = 10) {
    return (
      this.db
        .query(
          `select * from tasks t where t.status = 'done' and t.updated_at > ? and not exists (select 1 from medic_audits a where a.task_id = t.id)
           order by t.updated_at desc limit ?`,
        )
        .all(this.now() - 3 * DAY, limit) as any[]
    ).map((r) => ({ id: r.id, from: r.sender, to: r.target, title: r.title, instructions: r.instructions, result: r.result }));
  }

  audit(who: BodyID, input: { taskId?: unknown; verdict?: unknown; why?: unknown }): Audit {
    if (who !== "medic") throw new CaseError(403, "only Galaxy Medic checks claims");
    const task = this.store.task(clean(input.taskId, 40));
    if (!task) throw new CaseError(404, "no such handoff");
    const verdict: Verdict = input.verdict === "contradicted" ? "contradicted" : input.verdict === "unverified" ? "unverified" : "verified";
    this.db
      .query("insert into medic_audits (task_id, member, title, verdict, why, at) values (?, ?, ?, ?, ?, ?) on conflict(task_id) do update set verdict = excluded.verdict, why = excluded.why, at = excluded.at")
      .run(task.id, task.to, task.title, verdict, clean(input.why, 600), this.now());
    return { taskId: task.id, member: task.to, title: task.title, verdict, why: clean(input.why, 600), at: this.now() };
  }

  audits(member?: string, sinceMs = this.now() - 7 * DAY): Audit[] {
    const rows = (member
      ? this.db.query("select * from medic_audits where member = ? and at > ? order by at desc").all(member, sinceMs)
      : this.db.query("select * from medic_audits where at > ? order by at desc").all(sinceMs)) as any[];
    return rows.map((r) => ({ taskId: r.task_id, member: r.member, title: r.title, verdict: r.verdict, why: r.why, at: r.at }));
  }

  // ------------------------------------------------------------ performance

  /** A member's real record over the last `days` days, from what happened. */
  performance(member: string, days = 7): Performance {
    const to = this.now();
    const from = to - days * DAY;
    const tasks = (this.db.query("select * from tasks where target = ? and created_at > ?").all(member, from) as any[]);
    const finished = tasks.filter((t) => t.status === "done" || t.status === "failed");
    const audits = this.audits(member, from);
    const verdictOf = new Map(audits.map((a) => [a.taskId, a.verdict]));
    const minutes = finished.map((t) => (t.updated_at - t.created_at) / 60_000).sort((a, b) => a - b);
    const incidents = this.db.query("select kind, started_at from medic_incidents where member = ? and started_at > ?").all(member, from) as any[];
    const approvals = this.db.query("select count(*) as n from approvals where sender = ? and status = 'rejected' and created_at > ?").get(member, from) as any;
    const sessions = this.link.training.sessions(member, 10).filter((s) => s.status === "done" && s.score !== null);
    const byDay = new Map<string, { good: number; bad: number }>();
    for (let i = days - 1; i >= 0; i--) byDay.set(dayOf(to - i * DAY), { good: 0, bad: 0 });
    for (const t of finished) {
      const d = byDay.get(dayOf(t.updated_at));
      if (!d) continue;
      if (t.status === "done" && verdictOf.get(t.id) !== "contradicted") d.good++;
      else d.bad++;
    }
    return {
      member,
      window: { from, to },
      handoffs: {
        done: tasks.filter((t) => t.status === "done").length,
        failed: tasks.filter((t) => t.status === "failed").length,
        cancelled: tasks.filter((t) => t.status === "cancelled").length,
        open: tasks.filter((t) => t.status === "queued" || t.status === "claimed").length,
      },
      failRate: finished.length ? finished.filter((t) => t.status === "failed" || verdictOf.get(t.id) === "contradicted").length / finished.length : null,
      medianMinutes: minutes.length ? Math.round(minutes[Math.floor(minutes.length / 2)]!) : null,
      claims: {
        verified: audits.filter((a) => a.verdict === "verified").length,
        unverified: audits.filter((a) => a.verdict === "unverified").length,
        contradicted: audits.filter((a) => a.verdict === "contradicted").length,
      },
      crashes: incidents.filter((i) => i.kind === "crashed" || i.kind === "crash_loop").length,
      stuck: incidents.filter((i) => i.kind === "stuck").length,
      refusedByYou: approvals?.n ?? 0,
      practice: { latest: sessions[0]?.score ?? null, previous: sessions[1]?.score ?? null },
      days: [...byDay].map(([day, v]) => ({ day, ...v })),
    };
  }

  // ---------------------------------------------------------------- the 1:1

  private row(r: any): CaseEntry {
    let data: any = {};
    try {
      data = JSON.parse(r.data);
    } catch {}
    return { id: r.id, kind: r.kind, speaker: r.speaker, member: r.member, text: r.text, data, status: r.status, ref: r.ref, at: r.at };
  }

  entry(id: number): CaseEntry | null {
    const r = this.db.query("select * from casebook where id = ?").get(id);
    return r ? this.row(r) : null;
  }

  private add(kind: CaseKind, speaker: string, member: string, text: string, data: unknown, status: CaseStatus | "", ref: number): CaseEntry {
    const r = this.db
      .query("insert into casebook (kind, speaker, member, text, data, status, ref, at) values (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(kind, speaker, member, text, JSON.stringify(data ?? {}), status, ref, this.now());
    for (const wake of [...this.waiters]) wake();
    return this.entry(Number(r.lastInsertRowid))!;
  }

  /** Open reports about `member`, or with this `key`. */
  openReports(member?: string): CaseEntry[] {
    const rows = (member
      ? this.db.query("select * from casebook where kind = 'report' and member = ? and status in ('open', 'acted') order by id").all(member)
      : this.db.query("select * from casebook where kind = 'report' and status in ('open', 'acted') order by id").all()) as any[];
    return rows.map((r) => this.row(r));
  }

  /**
   * Medic reports a low point. The member's program is snapshotted now, so whatever
   * the trainer changes in answer can be shown exactly. The trainer hears through its inbox.
   */
  report(who: BodyID, input: { member?: unknown; key?: unknown; text?: unknown; evidence?: unknown; metric?: unknown }): CaseEntry {
    if (who !== "medic") throw new CaseError(403, "only Galaxy Medic files reports");
    const member = clean(input.member, 32);
    if (!CASE_MEMBERS.includes(member)) throw new CaseError(400, "reports are about a member");
    const key = clean(input.key, 120);
    const text = clean(input.text, 3000);
    if (!key || !text) throw new CaseError(400, "a report needs a key and what's wrong");
    const already = this.openReports(member).find((r) => r.data.key === key);
    if (already) return already;
    const program = this.link.training.program(member);
    const evidence = Array.isArray(input.evidence) ? input.evidence.map((e) => clean(e, 600)).filter(Boolean).slice(0, 12) : [];
    const entry = this.add("report", "medic", member, text, { key, evidence, metric: input.metric ?? null, before: program ? { version: program.version, plan: program.plan } : null }, "open", 0);
    this.link.postInbox({ body: "trainer", kind: "message", taskId: "", replyTo: "", text: `report:${entry.id}` });
    this.store.addEvent("medic", "medic", `reported a low point to the trainer: ${this.link.profile(member).name}: ${text.split("\n")[0]!.slice(0, 120)}`);
    return entry;
  }

  /**
   * The trainer answers a report. Link compares the member's program now with the
   * snapshot taken at the report and records exactly what changed. No change, no
   * credit: the report stays open, however the reply is worded.
   */
  reply(who: BodyID, input: { ref?: unknown; text?: unknown }): { reply: CaseEntry; change: CaseEntry } {
    if (who !== "trainer") throw new CaseError(403, "only the trainer answers reports");
    const report = this.entry(Number(input.ref));
    if (!report || report.kind !== "report") throw new CaseError(404, "no such report");
    const text = clean(input.text, 3000);
    if (!text) throw new CaseError(400, "nothing to say");
    const reply = this.add("reply", "trainer", report.member, text, {}, "", report.id);
    const now = this.link.training.program(report.member);
    const diff = diffPlans(report.data.before?.plan ?? null, now?.plan ?? null);
    const change = this.add(
      "change",
      "link",
      report.member,
      diff.empty
        ? `No change to ${this.link.profile(report.member).name}'s program yet. The report stays open.`
        : `${this.link.profile(report.member).name}'s program went from v${report.data.before?.version ?? 0} to v${now?.version ?? 0}.`,
      { ...diff, from: report.data.before?.version ?? 0, to: now?.version ?? 0 },
      "",
      report.id,
    );
    if (!diff.empty) this.setStatus(report.id, "acted");
    return { reply, change };
  }

  /** Medic, days later: did it get better? */
  followUp(who: BodyID, input: { ref?: unknown; text?: unknown; improved?: unknown; metric?: unknown }): CaseEntry {
    if (who !== "medic") throw new CaseError(403, "only Galaxy Medic follows up");
    const report = this.entry(Number(input.ref));
    if (!report || report.kind !== "report") throw new CaseError(404, "no such report");
    const improved = input.improved === true;
    const entry = this.add("followup", "medic", report.member, clean(input.text, 2000) || (improved ? "Better now." : "Still low."), { improved, metric: input.metric ?? null }, "", report.id);
    this.setStatus(report.id, improved ? "improved" : "still_low");
    if (!improved) this.link.postInbox({ body: "trainer", kind: "message", taskId: "", replyTo: "", text: `report:${report.id}` });
    return entry;
  }

  private setStatus(id: number, status: CaseStatus) {
    this.db.query("update casebook set status = ? where id = ?").run(status, id);
    for (const wake of [...this.waiters]) wake();
  }

  thread(afterID = 0, limit = 300): CaseEntry[] {
    const rows = afterID
      ? (this.db.query("select * from casebook where id > ? order by id limit ?").all(afterID, limit) as any[])
      : (this.db.query("select * from casebook order by id desc limit ?").all(limit) as any[]).reverse();
    return rows.map((r) => this.row(r));
  }

  async wait(afterID: number, waitMs: number): Promise<CaseEntry[]> {
    const now = this.thread(afterID);
    if (now.length || waitMs <= 0) return now;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, waitMs);
      this.waiters.add(done);
    });
    return this.thread(afterID);
  }

  overview() {
    return {
      performance: CASE_MEMBERS.map((m) => this.performance(m)),
      thread: this.thread(),
      audits: this.audits().slice(0, 30),
    };
  }
}
