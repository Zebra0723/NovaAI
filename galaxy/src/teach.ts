// Galaxy Teach's side of Link: what you've been offered to learn, the lessons Claude
// wrote for you, how far you got in each, your notes, and a map of what you know.
//
// What Teach never keeps is your screen. The watcher (Galaxy Teach.app) reads the text
// in Terminal, the Claude app, claude.ai and VS Code, picks out the few lines worth
// teaching from (a command, a line of code, a term) and hands them here. They wait in
// memory, never on disk, until the Teach daemon reads them, turns them into a topic name,
// and they're gone. Only the topic, and the lesson written about it, are saved.

import type { Link } from "./link";
import type { BodyID, Store } from "./store";

export const TEACH = "teach";

export type Level = "new" | "shaky" | "solid";

export interface Topic {
  key: string;
  title: string;
  level: Level;
  /** How many times it came up on your screen. */
  seen: number;
  skipped: number;
  lessons: number;
  /** Quiz answers about it: right and in all. */
  right: number;
  asked: number;
  lastAt: number;
}

export interface Offer {
  id: string;
  topic: string;
  title: string;
  why: string;
  minutes: number;
  /** Which app it came up in. */
  app: string;
  status: "offered" | "skipped" | "begun" | "saved" | "expired";
  lessonId: string;
  createdAt: number;
}

export interface Choice {
  q: string;
  choices: string[];
  answer: number;
  why: string;
  concept?: string;
}

export type Section =
  | { kind: "explain"; title: string; body: string; example?: { code: string; caption: string }; keyPoint: string; check?: Choice }
  | { kind: "scenario"; title: string; story: string; q: string; choices: string[]; answer: number; why: string; keyPoint: string }
  | { kind: "practice"; title: string; task: string; hint: string; accept: string[]; solution: string; explain: string; keyPoint: string };

export interface LessonContent {
  title: string;
  minutes: number;
  hook: string;
  concepts: string[];
  sections: Section[];
  quiz: Choice[];
  takeaways: string[];
  /** Your earlier lessons this one builds on, by title. Only ones you've finished. */
  buildsOn: string[];
}

export interface Lesson {
  id: string;
  topic: string;
  title: string;
  minutes: number;
  status: "writing" | "ready" | "failed" | "done";
  /** What you asked for, when you asked ("teach me about ports"). */
  request: string;
  why: string;
  content: LessonContent | null;
  error: string;
  /** Saved for later: written and waiting, not started yet. */
  saved: boolean;
  /** The section you're on; sections.length means the quiz. */
  position: number;
  /** Your answers so far, by step key ("s3", "q2"): a choice index or what you typed. */
  answers: Record<string, unknown>;
  score: number | null;
  createdAt: number;
  startedAt: number;
  lastAt: number;
  finishedAt: number;
}

export interface Check {
  id: string;
  lessonId: string;
  section: number;
  answer: string;
  status: "checking" | "done";
  ok: boolean;
  feedback: string;
}

export interface Note {
  id: string;
  lessonId: string;
  topic: string;
  text: string;
  by: "you" | "teach";
  at: number;
}

/** A few lines worth teaching from, as the watcher saw them. Only ever in memory. */
export interface Spot {
  app: string;
  snippets: string[];
  at: number;
}

const SCHEMA = `
create table if not exists teach_topics (
  key text primary key,
  title text not null,
  level text not null default 'new',
  seen integer not null default 0,
  skipped integer not null default 0,
  lessons integer not null default 0,
  right integer not null default 0,
  asked integer not null default 0,
  last_at integer not null default 0
);
create table if not exists teach_offers (
  id text primary key,
  topic text not null,
  title text not null,
  why text not null default '',
  minutes integer not null,
  app text not null default '',
  status text not null,
  lesson_id text not null default '',
  created_at integer not null,
  decided_at integer not null default 0
);
create table if not exists teach_lessons (
  id text primary key,
  topic text not null,
  title text not null,
  minutes integer not null,
  status text not null,
  request text not null default '',
  why text not null default '',
  content text,
  error text not null default '',
  position integer not null default 0,
  answers text not null default '{}',
  score real,
  created_at integer not null,
  started_at integer not null default 0,
  last_at integer not null default 0,
  finished_at integer not null default 0
);
create table if not exists teach_checks (
  id text primary key,
  lesson_id text not null,
  section integer not null,
  answer text not null,
  status text not null,
  ok integer not null default 0,
  feedback text not null default '',
  created_at integer not null
);
create table if not exists teach_notes (
  id text primary key,
  lesson_id text not null default '',
  topic text not null default '',
  text text not null,
  by text not null,
  at integer not null
);
create table if not exists teach_meta (key text primary key, value text not null);
`;

/**
 * How Teach talks to you. It starts in plain words and, as you finish lessons, builds on
 * what you learnt in them. A run of low quiz scores steps it back one.
 *   1: plain words, no jargon, everyday analogies
 *   2: plain, but words from your finished lessons are used with a quick reminder
 *   3: builds on your lessons freely and connects new ideas to them
 */
export function languageStage(finished: number, recentAverage: number | null): 1 | 2 | 3 {
  let stage = finished >= 8 ? 3 : finished >= 3 ? 2 : 1;
  if (recentAverage !== null && recentAverage < 60 && stage > 1) stage--;
  return stage as 1 | 2 | 3;
}

export class TeachError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const newID = (prefix: string) => prefix + "_" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
const MAX_SPOTS = 40;
/** An offer you haven't answered in this long is gone. */
const OFFER_TTL_MS = 6 * 60 * 60_000;
/** Skip a topic this many times and it's never offered again (you can still ask for it). */
const SKIP_LIMIT = 2;
const LEVELS: Level[] = ["new", "shaky", "solid"];

/** A topic's key: "brew install" and "Brew Install!" are the same topic. */
export function topicKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[`'"]/g, "")
    .replace(/[^a-z0-9.+#/-]+/g, " ")
    .trim()
    .slice(0, 60);
}

function choice(c: any, i = 0): Choice | null {
  const choices = Array.isArray(c?.choices) ? c.choices.map((x: unknown) => clean(x, 300)).filter(Boolean).slice(0, 5) : [];
  const q = clean(c?.q, 600);
  const answer = Number(c?.answer);
  if (!q || choices.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= choices.length) return null;
  return { q, choices, answer, why: clean(c?.why, 800), concept: clean(c?.concept, 80) || undefined };
}

/** A lesson as Claude wrote it, checked and trimmed so the page can always show it. */
export function tidyLesson(raw: any): LessonContent | null {
  if (!raw || typeof raw !== "object") return null;
  const sections: Section[] = [];
  for (const s of Array.isArray(raw.sections) ? raw.sections.slice(0, 14) : []) {
    const title = clean(s?.title, 120);
    const keyPoint = clean(s?.keyPoint, 300);
    if (!title) continue;
    if (s.kind === "scenario") {
      const c = choice({ q: s.q, choices: s.choices, answer: s.answer, why: s.why });
      const story = clean(s.story, 3000);
      if (c && story) sections.push({ kind: "scenario", title, story, q: c.q, choices: c.choices, answer: c.answer, why: c.why, keyPoint });
    } else if (s.kind === "practice") {
      const task = clean(s.task, 1500);
      const accept = (Array.isArray(s.accept) ? s.accept : [])
        .map((a: unknown) => clean(a, 300))
        .filter((a: string) => {
          try {
            new RegExp(a);
            return !!a;
          } catch {
            return false;
          }
        })
        .slice(0, 6);
      if (task) sections.push({ kind: "practice", title, task, hint: clean(s.hint, 600), accept, solution: clean(s.solution, 600), explain: clean(s.explain, 1500), keyPoint });
    } else {
      const body = clean(s?.body, 6000);
      if (!body) continue;
      const code = clean(s?.example?.code, 2000);
      const check = s?.check ? choice(s.check) : null;
      sections.push({
        kind: "explain",
        title,
        body,
        ...(code ? { example: { code, caption: clean(s.example.caption, 300) } } : {}),
        keyPoint,
        ...(check ? { check } : {}),
      });
    }
  }
  const quiz = (Array.isArray(raw.quiz) ? raw.quiz : []).map(choice).filter(Boolean).slice(0, 10) as Choice[];
  if (sections.length < 2 || quiz.length < 3) return null;
  return {
    title: clean(raw.title, 120) || "A lesson",
    minutes: Math.max(10, Math.min(30, Math.round(Number(raw.minutes) || 15))),
    hook: clean(raw.hook, 600),
    concepts: (Array.isArray(raw.concepts) ? raw.concepts : []).map((c: unknown) => clean(c, 80)).filter(Boolean).slice(0, 8),
    sections,
    quiz,
    takeaways: (Array.isArray(raw.takeaways) ? raw.takeaways : []).map((t: unknown) => clean(t, 300)).filter(Boolean).slice(0, 8),
    buildsOn: (Array.isArray(raw.buildsOn) ? raw.buildsOn : []).map((t: unknown) => clean(t, 140)).filter(Boolean).slice(0, 4),
  };
}

export class Teach {
  private spots: Spot[] = [];
  private spotWaiters = new Set<() => void>();
  private waiters = new Set<() => void>();
  private checkWaiters = new Map<string, Set<() => void>>();
  /** Bumped on every change, for long polls from the watcher and the page. */
  version = 1;

  constructor(
    private readonly link: Link,
    private readonly store: Store = link.store,
  ) {
    this.store.db.exec(SCHEMA);
    const columns = (this.store.db.query("pragma table_info(teach_lessons)").all() as any[]).map((c) => c.name);
    if (!columns.includes("saved")) this.store.db.exec("alter table teach_lessons add column saved integer not null default 0");
  }

  private get db() {
    return this.store.db;
  }
  private now() {
    return this.store.now();
  }
  private needTeach(who: BodyID) {
    if (who !== TEACH) throw new TeachError(403, "only Galaxy Teach can do that");
  }
  private needYou(who: BodyID) {
    if (who !== "you" && who !== "galaxy") throw new TeachError(403, "only you can do that");
  }
  private changed() {
    this.version++;
    for (const wake of [...this.waiters]) wake();
  }

  /** Waits until something changes after `since`, or `waitMs` passes. */
  async waitForChange(since: number, waitMs: number): Promise<void> {
    if (this.version !== since || waitMs <= 0) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, waitMs);
      this.waiters.add(done);
    });
  }

  // ------------------------------------------------------------------- spots

  /** The watcher hands over what it saw. Kept in memory only, and only until Teach reads it. */
  spot(who: BodyID, input: { app?: unknown; snippets?: unknown }): { ok: true; queued: number } {
    if (who !== "you" && who !== TEACH) throw new TeachError(403, "only the watcher can send what it saw");
    const snippets = (Array.isArray(input.snippets) ? input.snippets : [])
      .map((s: unknown) => clean(s, 600))
      .filter(Boolean)
      .slice(0, 12);
    if (snippets.length) {
      this.spots.push({ app: clean(input.app, 40) || "screen", snippets, at: this.now() });
      if (this.spots.length > MAX_SPOTS) this.spots.splice(0, this.spots.length - MAX_SPOTS);
      for (const wake of [...this.spotWaiters]) wake();
    }
    return { ok: true, queued: this.spots.length };
  }

  /** Teach takes everything waiting. After this, Link no longer has it. */
  async takeSpots(who: BodyID, waitMs = 0): Promise<Spot[]> {
    this.needTeach(who);
    if (!this.spots.length && waitMs > 0) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          this.spotWaiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, waitMs);
        this.spotWaiters.add(done);
      });
    }
    return this.spots.splice(0);
  }

  // ------------------------------------------------------------------ topics

  private rowToTopic(r: any): Topic {
    return { key: r.key, title: r.title, level: r.level, seen: r.seen, skipped: r.skipped, lessons: r.lessons, right: r.right, asked: r.asked, lastAt: r.last_at };
  }

  topic(key: string): Topic | null {
    const r = this.db.query("select * from teach_topics where key = ?").get(key);
    return r ? this.rowToTopic(r) : null;
  }

  topics(): Topic[] {
    return (this.db.query("select * from teach_topics order by last_at desc limit 300").all() as any[]).map((r) => this.rowToTopic(r));
  }

  private touchTopic(title: string, bump: Partial<Record<"seen" | "skipped" | "lessons" | "right" | "asked", number>> = {}): Topic {
    const key = topicKey(title);
    if (!key) throw new TeachError(400, "a topic needs a name");
    this.db.query("insert into teach_topics (key, title, last_at) values (?, ?, ?) on conflict(key) do nothing").run(key, clean(title, 120), this.now());
    this.db
      .query("update teach_topics set seen = seen + ?, skipped = skipped + ?, lessons = lessons + ?, right = right + ?, asked = asked + ?, last_at = ? where key = ?")
      .run(bump.seen ?? 0, bump.skipped ?? 0, bump.lessons ?? 0, bump.right ?? 0, bump.asked ?? 0, this.now(), key);
    return this.topic(key)!;
  }

  /** You say how well you know something. Solid topics aren't offered again. */
  setLevel(who: BodyID, key: string, level: unknown): Topic {
    this.needYou(who);
    if (!LEVELS.includes(level as Level)) throw new TeachError(400, "level is new, shaky or solid");
    if (!this.topic(key)) throw new TeachError(404, "no such topic");
    this.db.query("update teach_topics set level = ? where key = ?").run(level as Level, key);
    this.changed();
    return this.topic(key)!;
  }

  /** Whether a topic may be offered: not solid, not skipped twice, not already waiting or being learnt. */
  offerable(title: string): boolean {
    const key = topicKey(title);
    const t = this.topic(key);
    if (t && (t.level === "solid" || t.skipped >= SKIP_LIMIT)) return false;
    const open = this.db
      .query("select 1 from teach_offers where topic = ? and status = 'offered' union select 1 from teach_lessons where topic = ? and status in ('writing', 'ready')")
      .get(key, key);
    return !open;
  }

  // ------------------------------------------------------------------ offers

  private rowToOffer(r: any): Offer {
    return { id: r.id, topic: r.topic, title: r.title, why: r.why, minutes: r.minutes, app: r.app, status: r.status, lessonId: r.lesson_id, createdAt: r.created_at };
  }

  offer(id: string): Offer | null {
    const r = this.db.query("select * from teach_offers where id = ?").get(id);
    return r ? this.rowToOffer(r) : null;
  }

  /** Teach offers you a lesson on something that just came up. Null when it's not one to offer. */
  makeOffer(who: BodyID, input: { topic?: unknown; title?: unknown; why?: unknown; minutes?: unknown; app?: unknown }): Offer | null {
    this.needTeach(who);
    const topic = clean(input.topic, 80);
    if (!topic) throw new TeachError(400, "an offer needs a topic");
    this.touchTopic(topic, { seen: 1 });
    if (!this.offerable(topic)) return null;
    const id = newID("o");
    this.db
      .query("insert into teach_offers (id, topic, title, why, minutes, app, status, created_at) values (?, ?, ?, ?, ?, ?, 'offered', ?)")
      .run(id, topicKey(topic), clean(input.title, 140) || topic, clean(input.why, 400), Math.max(10, Math.min(30, Math.round(Number(input.minutes) || 15))), clean(input.app, 40), this.now());
    this.changed();
    return this.offer(id)!;
  }

  /** Offers waiting for your Begin or Skip, newest first. Old ones expire. */
  pendingOffers(): Offer[] {
    this.db.query("update teach_offers set status = 'expired' where status = 'offered' and created_at < ?").run(this.now() - OFFER_TTL_MS);
    return (this.db.query("select * from teach_offers where status = 'offered' order by created_at desc limit 20").all() as any[]).map((r) => this.rowToOffer(r));
  }

  skip(who: BodyID, id: string): Offer {
    this.needYou(who);
    const o = this.offer(id);
    if (!o) throw new TeachError(404, "no such offer");
    if (o.status === "offered") {
      this.db.query("update teach_offers set status = 'skipped', decided_at = ? where id = ?").run(this.now(), id);
      this.touchTopic(o.topic, { skipped: 1 });
      this.changed();
    }
    return this.offer(id)!;
  }

  /**
   * You press Begin: Teach starts writing the lesson. With `later`, it's written all the
   * same and kept in Saved for later, for whenever you want it.
   */
  begin(who: BodyID, id: string, later = false): Lesson {
    this.needYou(who);
    const o = this.offer(id);
    if (!o) throw new TeachError(404, "no such offer");
    if ((o.status === "begun" || o.status === "saved") && o.lessonId) {
      if (!later) this.db.query("update teach_lessons set saved = 0 where id = ?").run(o.lessonId);
      return this.lesson(o.lessonId)!;
    }
    if (o.status !== "offered") throw new TeachError(409, "that offer has gone");
    const lesson = this.newLesson(this.topic(o.topic)?.title ?? o.title, { title: o.title, minutes: o.minutes, why: o.why, later });
    this.db.query("update teach_offers set status = ?, lesson_id = ?, decided_at = ? where id = ?").run(later ? "saved" : "begun", lesson.id, this.now(), id);
    this.changed();
    return lesson;
  }

  /** You ask for a lesson on anything: "teach me about ports". */
  ask(who: BodyID, input: { request?: unknown; later?: unknown }): Lesson {
    this.needYou(who);
    const request = clean(input.request, 300);
    if (!request) throw new TeachError(400, "what would you like to learn?");
    return this.newLesson(request, { title: request, minutes: 0, why: "", request, later: input.later === true });
  }

  /** You save a lesson for later, or take it out of Saved for later. */
  setSaved(who: BodyID, id: string, saved: boolean): Lesson {
    this.needYou(who);
    if (!this.lesson(id)) throw new TeachError(404, "no such lesson");
    this.db.query("update teach_lessons set saved = ? where id = ? and status != 'done'").run(saved ? 1 : 0, id);
    this.changed();
    return this.lesson(id)!;
  }

  private newLesson(topic: string, o: { title: string; minutes: number; why: string; request?: string; later?: boolean }): Lesson {
    const t = this.touchTopic(topic, { lessons: 1 });
    const id = newID("l");
    this.db
      .query("insert into teach_lessons (id, topic, title, minutes, status, request, why, created_at, saved) values (?, ?, ?, ?, 'writing', ?, ?, ?, ?)")
      .run(id, t.key, clean(o.title, 140), o.minutes || 15, o.request ?? "", o.why, this.now(), o.later ? 1 : 0);
    this.link.postInbox({ body: TEACH, kind: "message", taskId: id, replyTo: "", text: `write:${id}` });
    this.changed();
    return this.lesson(id)!;
  }

  // ----------------------------------------------------------------- lessons

  private rowToLesson(r: any): Lesson {
    let content: LessonContent | null = null;
    let answers: Record<string, unknown> = {};
    try {
      content = r.content ? JSON.parse(r.content) : null;
    } catch {}
    try {
      answers = JSON.parse(r.answers || "{}");
    } catch {}
    return {
      id: r.id,
      topic: r.topic,
      title: r.title,
      minutes: r.minutes,
      status: r.status,
      request: r.request,
      why: r.why,
      content,
      error: r.error,
      saved: !!r.saved,
      position: r.position,
      answers,
      score: r.score ?? null,
      createdAt: r.created_at,
      startedAt: r.started_at,
      lastAt: r.last_at,
      finishedAt: r.finished_at,
    };
  }

  lesson(id: string): Lesson | null {
    const r = this.db.query("select * from teach_lessons where id = ?").get(id);
    return r ? this.rowToLesson(r) : null;
  }

  lessons(limit = 100): Lesson[] {
    return (this.db.query("select * from teach_lessons order by coalesce(nullif(last_at, 0), created_at) desc limit ?").all(limit) as any[]).map((r) => this.rowToLesson(r));
  }

  /** Teach hands in the lesson it wrote. */
  write(who: BodyID, id: string, raw: unknown): Lesson {
    this.needTeach(who);
    const l = this.lesson(id);
    if (!l) throw new TeachError(404, "no such lesson");
    if (l.status !== "writing") throw new TeachError(409, "that lesson is already written");
    const content = tidyLesson(raw);
    if (!content) throw new TeachError(400, "that lesson is missing its sections or quiz");
    // It can only build on lessons you really finished.
    const done = new Map(this.lessons(300).filter((x) => x.status === "done").map((x) => [topicKey(x.title), x.title]));
    content.buildsOn = [...new Set(content.buildsOn.map((t) => done.get(topicKey(t))).filter((t): t is string => !!t))];
    this.db.query("update teach_lessons set status = 'ready', content = ?, title = ?, minutes = ? where id = ?").run(JSON.stringify(content), content.title, content.minutes, id);
    this.changed();
    return this.lesson(id)!;
  }

  fail(who: BodyID, id: string, reason: unknown): Lesson {
    this.needTeach(who);
    if (!this.lesson(id)) throw new TeachError(404, "no such lesson");
    this.db.query("update teach_lessons set status = 'failed', error = ? where id = ? and status = 'writing'").run(clean(reason, 500) || "It couldn't be written.", id);
    this.changed();
    return this.lesson(id)!;
  }

  /** You try a failed lesson again. */
  retry(who: BodyID, id: string): Lesson {
    this.needYou(who);
    const l = this.lesson(id);
    if (!l) throw new TeachError(404, "no such lesson");
    if (l.status !== "failed") return l;
    this.db.query("update teach_lessons set status = 'writing', error = '' where id = ?").run(id);
    this.link.postInbox({ body: TEACH, kind: "message", taskId: id, replyTo: "", text: `write:${id}` });
    this.changed();
    return this.lesson(id)!;
  }

  /** Where you are in a lesson, and your answers so far: so you can stop anywhere and come back. */
  progress(who: BodyID, id: string, input: { position?: unknown; answers?: unknown }): Lesson {
    this.needYou(who);
    const l = this.lesson(id);
    if (!l) throw new TeachError(404, "no such lesson");
    if (!l.content) throw new TeachError(409, "that lesson isn't written yet");
    const position = Math.max(0, Math.min(l.content.sections.length, Math.floor(Number(input.position ?? l.position)) || 0));
    const answers = input.answers && typeof input.answers === "object" ? { ...l.answers, ...(input.answers as object) } : l.answers;
    const text = JSON.stringify(answers);
    if (text.length > 60_000) throw new TeachError(413, "too many answers");
    this.db
      .query("update teach_lessons set position = ?, answers = ?, saved = 0, started_at = coalesce(nullif(started_at, 0), ?), last_at = ? where id = ?")
      .run(position, text, this.now(), this.now(), id);
    this.changed();
    return this.lesson(id)!;
  }

  /**
   * You finish the quiz. Your score sets how well you know the topic (and each concept the
   * quiz asked about), the takeaways become notes, and Teach is told so it can learn how you learn.
   */
  finish(who: BodyID, id: string, input: { answers?: unknown }): Lesson {
    this.needYou(who);
    const l = this.lesson(id);
    if (!l?.content) throw new TeachError(404, "no such lesson");
    if (l.status === "done") return l;
    const given = { ...l.answers, ...(input.answers && typeof input.answers === "object" ? (input.answers as object) : {}) } as Record<string, unknown>;
    const quiz = l.content.quiz;
    let right = 0;
    const byConcept = new Map<string, { right: number; asked: number }>();
    quiz.forEach((q, i) => {
      const ok = Number(given[`q${i}`]) === q.answer;
      if (ok) right++;
      if (q.concept) {
        const c = byConcept.get(q.concept) ?? { right: 0, asked: 0 };
        c.asked++;
        if (ok) c.right++;
        byConcept.set(q.concept, c);
      }
    });
    const score = quiz.length ? Math.round((right / quiz.length) * 100) : 0;
    const level = (share: number): Level => (share >= 0.85 ? "solid" : share >= 0.5 ? "shaky" : "new");
    this.db.transaction(() => {
      this.db
        .query("update teach_lessons set status = 'done', answers = ?, score = ?, position = ?, finished_at = ?, last_at = ? where id = ?")
        .run(JSON.stringify(given), score, l.content!.sections.length, this.now(), this.now(), id);
      this.touchTopic(this.topic(l.topic)?.title ?? l.topic, { right, asked: quiz.length });
      this.db.query("update teach_topics set level = ? where key = ?").run(level(right / Math.max(1, quiz.length)), l.topic);
      for (const [concept, c] of byConcept) {
        if (topicKey(concept) === l.topic) continue;
        const t = this.touchTopic(concept, { right: c.right, asked: c.asked });
        this.db.query("update teach_topics set level = ? where key = ?").run(level(t.right / Math.max(1, t.asked)), t.key);
      }
      for (const text of l.content!.takeaways) {
        this.db.query("insert into teach_notes (id, lesson_id, topic, text, by, at) values (?, ?, ?, ?, 'teach', ?)").run(newID("n"), id, l.topic, text, this.now());
      }
    })();
    this.link.postInbox({ body: TEACH, kind: "message", taskId: id, replyTo: "", text: `finished:${id}` });
    this.changed();
    return this.lesson(id)!;
  }

  remove(who: BodyID, id: string) {
    this.needYou(who);
    if (!this.lesson(id)) throw new TeachError(404, "no such lesson");
    this.db.transaction(() => {
      this.db.query("delete from teach_lessons where id = ?").run(id);
      this.db.query("delete from teach_checks where lesson_id = ?").run(id);
      this.db.query("update teach_offers set lesson_id = '' where lesson_id = ?").run(id);
    })();
    this.changed();
    return { ok: true, removed: id };
  }

  // ------------------------------------------------------------------ checks

  private rowToCheck(r: any): Check {
    return { id: r.id, lessonId: r.lesson_id, section: r.section, answer: r.answer, status: r.status, ok: !!r.ok, feedback: r.feedback };
  }

  check(id: string): Check | null {
    const r = this.db.query("select * from teach_checks where id = ?").get(id);
    return r ? this.rowToCheck(r) : null;
  }

  /** What you typed for a hands-on step, for Teach to look at when it isn't an exact match. */
  askCheck(who: BodyID, lessonId: string, input: { section?: unknown; answer?: unknown }): Check {
    this.needYou(who);
    const l = this.lesson(lessonId);
    const section = Math.floor(Number(input.section));
    if (!l?.content || l.content.sections[section]?.kind !== "practice") throw new TeachError(404, "no such practice step");
    const answer = clean(input.answer, 2000);
    if (!answer) throw new TeachError(400, "type your answer first");
    const id = newID("c");
    this.db.query("insert into teach_checks (id, lesson_id, section, answer, status, created_at) values (?, ?, ?, ?, 'checking', ?)").run(id, lessonId, section, answer, this.now());
    this.link.postInbox({ body: TEACH, kind: "message", taskId: id, replyTo: "", text: `check:${id}` });
    return this.check(id)!;
  }

  answerCheck(who: BodyID, id: string, input: { ok?: unknown; feedback?: unknown }): Check {
    this.needTeach(who);
    if (!this.check(id)) throw new TeachError(404, "no such check");
    this.db.query("update teach_checks set status = 'done', ok = ?, feedback = ? where id = ?").run(input.ok === true ? 1 : 0, clean(input.feedback, 1500), id);
    for (const wake of [...(this.checkWaiters.get(id) ?? [])]) wake();
    return this.check(id)!;
  }

  async waitCheck(id: string, waitMs: number): Promise<Check | null> {
    const c = this.check(id);
    if (!c || c.status === "done" || waitMs <= 0) return c;
    await new Promise<void>((resolve) => {
      const set = this.checkWaiters.get(id) ?? new Set();
      this.checkWaiters.set(id, set);
      const done = () => {
        clearTimeout(timer);
        set.delete(done);
        resolve();
      };
      const timer = setTimeout(done, waitMs);
      set.add(done);
    });
    return this.check(id);
  }

  // ------------------------------------------------------------------- notes

  private rowToNote(r: any): Note {
    return { id: r.id, lessonId: r.lesson_id, topic: r.topic, text: r.text, by: r.by, at: r.at };
  }

  notes(limit = 300): Note[] {
    return (this.db.query("select * from teach_notes order by at desc limit ?").all(limit) as any[]).map((r) => this.rowToNote(r));
  }

  addNote(who: BodyID, input: { lessonId?: unknown; text?: unknown }): Note {
    this.needYou(who);
    const text = clean(input.text, 4000);
    if (!text) throw new TeachError(400, "an empty note");
    const lessonId = clean(input.lessonId, 40);
    const topic = lessonId ? (this.lesson(lessonId)?.topic ?? "") : "";
    const id = newID("n");
    this.db.query("insert into teach_notes (id, lesson_id, topic, text, by, at) values (?, ?, ?, ?, 'you', ?)").run(id, lessonId, topic, text, this.now());
    this.changed();
    return this.rowToNote(this.db.query("select * from teach_notes where id = ?").get(id));
  }

  removeNote(who: BodyID, id: string) {
    this.needYou(who);
    this.db.query("delete from teach_notes where id = ?").run(id);
    this.changed();
    return { ok: true };
  }

  // -------------------------------------------------------------- how you learn

  private meta<T>(key: string): T | null {
    const r = this.db.query("select value from teach_meta where key = ?").get(key) as any;
    try {
      return r ? (JSON.parse(r.value) as T) : null;
    } catch {
      return null;
    }
  }
  private setMeta(key: string, value: unknown) {
    this.db.query("insert into teach_meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value").run(key, JSON.stringify(value));
  }

  /** What Teach has worked out about how you learn best, in its words. It shapes every lesson. */
  style(): { text: string; at: number } | null {
    return this.meta("style");
  }

  setStyle(who: BodyID, input: { text?: unknown }) {
    this.needTeach(who);
    const style = { text: clean(input.text, 2000), at: this.now() };
    this.setMeta("style", style);
    this.changed();
    return style;
  }

  /** Whether the Teach daemon can reach Claude, and why not. */
  setStatus(who: BodyID, input: { ok?: unknown; reason?: unknown }) {
    this.needTeach(who);
    const status = { ok: input.ok === true, reason: clean(input.reason, 500), at: this.now() };
    this.setMeta("status", status);
    this.changed();
    return status;
  }

  /** The watcher says it's watching (and in which apps), or that it can't (no permission). */
  setWatcher(who: BodyID, input: { watching?: unknown; apps?: unknown; problem?: unknown }) {
    if (who !== "you" && who !== TEACH) throw new TeachError(403, "only the watcher can say that");
    const w = {
      watching: input.watching === true,
      apps: (Array.isArray(input.apps) ? input.apps : []).map((a: unknown) => clean(a, 40)).filter(Boolean).slice(0, 8),
      problem: clean(input.problem, 300),
      at: this.now(),
    };
    const before = this.meta<any>("watcher");
    this.setMeta("watcher", w);
    if (!before || before.watching !== w.watching || before.problem !== w.problem) this.changed();
    return w;
  }

  /** Everything the Teach page shows. */
  overview() {
    const lessons = this.lessons();
    const topics = this.topics();
    const watcher = this.meta<{ watching: boolean; apps: string[]; problem: string; at: number }>("watcher");
    const done = lessons.filter((l) => l.status === "done");
    const days = new Set(done.map((l) => new Date(l.finishedAt).toDateString()));
    let streak = 0;
    for (let d = new Date(this.now()); days.has(d.toDateString()); d.setDate(d.getDate() - 1)) streak++;
    return {
      version: this.version,
      teachOnline: this.link.isOnline(TEACH),
      status: this.meta<{ ok: boolean; reason: string; at: number }>("status"),
      // The watcher checks in every few seconds; a minute of silence means it isn't watching.
      watcher: watcher ? { ...watcher, live: this.now() - watcher.at < 60_000 } : null,
      offers: this.pendingOffers(),
      lessons: lessons.map(({ content, answers, ...l }) => ({
        ...l,
        sections: content?.sections.length ?? 0,
        hook: content?.hook ?? "",
      })),
      topics,
      notes: this.notes(),
      style: this.style(),
      stage: this.stage(),
      stats: {
        finished: done.length,
        minutes: done.reduce((s, l) => s + l.minutes, 0),
        streak,
        solid: topics.filter((t) => t.level === "solid").length,
        average: done.length ? Math.round(done.reduce((s, l) => s + (l.score ?? 0), 0) / done.length) : null,
      },
    };
  }

  /** What Teach needs to write a lesson for you: the learner map, your style, recent lessons. */
  context() {
    const done = this.lessons(300).filter((l) => l.status === "done");
    return {
      topics: this.topics().slice(0, 120).map((t) => ({ title: t.title, level: t.level, skipped: t.skipped, lessons: t.lessons })),
      style: this.style()?.text ?? "",
      recent: this.lessons(12).map((l) => ({ title: l.title, score: l.score, status: l.status })),
      stage: this.stage(),
      // What you've learnt here, so new lessons can build on it (and only on it).
      learnt: done.slice(0, 25).map((l) => ({ title: l.title, score: l.score, takeaways: l.content?.takeaways ?? [] })),
    };
  }

  /** How plainly Teach writes for you right now (see languageStage). */
  stage(): 1 | 2 | 3 {
    const done = this.lessons(300).filter((l) => l.status === "done");
    const recent = done.slice(0, 3).map((l) => l.score ?? 0);
    return languageStage(done.length, recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null);
  }
}
