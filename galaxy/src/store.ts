// Galaxy Link's state: one SQLite file every body shares through the daemon.
//
// Bodies never open this file themselves. They talk to galaxyd over HTTP, so
// the daemon is the only writer and any body (Orbit included) can be quit at
// any time without the others noticing anything but its absence.

import { Database } from "bun:sqlite";

export type BodyID = string;

export interface Body {
  id: BodyID;
  name: string;
  powers: string[];
  /** Shell command that starts the body when work arrives for it, or "" for never. */
  launch: string;
  lastSeen: number; // epoch ms, 0 = never
  version: string;
}

export interface Memory {
  id: string;
  text: string;
  source: BodyID | "user";
  createdAt: number;
  updatedAt: number;
}

export interface GalaxyEvent {
  id: number;
  body: BodyID;
  kind: string;
  summary: string;
  detail: string;
  at: number;
}

export type TaskStatus = "queued" | "claimed" | "done" | "failed" | "cancelled";

export interface Task {
  id: string;
  from: BodyID;
  to: BodyID;
  power: string;
  title: string;
  instructions: string;
  status: TaskStatus;
  result: string;
  progress: string;
  /** Opaque to Link: lets the sender find its way back (an iMessage chat id, a conversation id). */
  replyTo: string;
  createdAt: number;
  updatedAt: number;
}

export interface InboxItem {
  id: number;
  body: BodyID;
  kind: "task_result" | "message";
  taskId: string;
  text: string;
  replyTo: string;
  createdAt: number;
  deliveredAt: number;
}

const SCHEMA = `
create table if not exists bodies (
  id text primary key,
  name text not null,
  powers text not null default '[]',
  launch text not null default '',
  last_seen integer not null default 0,
  version text not null default ''
);
create table if not exists memories (
  id text primary key,
  text text not null,
  norm text not null unique,
  source text not null,
  created_at integer not null,
  updated_at integer not null
);
create virtual table if not exists memories_fts using fts5(text, content='memories', content_rowid='rowid');
create trigger if not exists memories_ai after insert on memories begin
  insert into memories_fts(rowid, text) values (new.rowid, new.text);
end;
create trigger if not exists memories_ad after delete on memories begin
  insert into memories_fts(memories_fts, rowid, text) values ('delete', old.rowid, old.text);
end;
create trigger if not exists memories_au after update on memories begin
  insert into memories_fts(memories_fts, rowid, text) values ('delete', old.rowid, old.text);
  insert into memories_fts(rowid, text) values (new.rowid, new.text);
end;
create table if not exists events (
  id integer primary key autoincrement,
  body text not null,
  kind text not null,
  summary text not null,
  detail text not null default '',
  at integer not null
);
create index if not exists events_at on events(at);
create table if not exists tasks (
  id text primary key,
  sender text not null,
  target text not null,
  power text not null,
  title text not null,
  instructions text not null,
  status text not null,
  result text not null default '',
  progress text not null default '',
  reply_to text not null default '',
  created_at integer not null,
  updated_at integer not null
);
create index if not exists tasks_target on tasks(target, status);
create table if not exists inbox (
  id integer primary key autoincrement,
  body text not null,
  kind text not null,
  task_id text not null default '',
  text text not null,
  reply_to text not null default '',
  created_at integer not null,
  delivered_at integer not null default 0
);
create index if not exists inbox_body on inbox(body, delivered_at);
`;

/** Two memories are the same memory if they differ only in case, spacing and end punctuation. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").replace(/[.!\s]+$/, "").trim();
}

function newID(prefix: string): string {
  return prefix + "_" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}

export class Store {
  readonly db: Database;
  now: () => number = () => Date.now();

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec("pragma journal_mode = wal; pragma busy_timeout = 3000;");
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  // ------------------------------------------------------------------ bodies

  upsertBody(body: Omit<Body, "lastSeen">): Body {
    this.db
      .query(
        `insert into bodies (id, name, powers, launch, last_seen, version) values (?, ?, ?, ?, ?, ?)
         on conflict(id) do update set name = excluded.name, powers = excluded.powers,
           launch = excluded.launch, last_seen = excluded.last_seen, version = excluded.version`,
      )
      .run(body.id, body.name, JSON.stringify(body.powers), body.launch, this.now(), body.version);
    return this.body(body.id)!;
  }

  touchBody(id: BodyID): boolean {
    return this.db.query("update bodies set last_seen = ? where id = ?").run(this.now(), id).changes > 0;
  }

  /** Marks a body gone right away, for a clean quit, rather than waiting for its heartbeat to lapse. */
  leaveBody(id: BodyID) {
    this.db.query("update bodies set last_seen = 0 where id = ?").run(id);
  }

  body(id: BodyID): Body | null {
    const row = this.db.query("select * from bodies where id = ?").get(id) as any;
    return row ? rowToBody(row) : null;
  }

  bodies(): Body[] {
    return (this.db.query("select * from bodies order by id").all() as any[]).map(rowToBody);
  }

  // ---------------------------------------------------------------- memories

  /** Adds a memory, or returns the one already saying the same thing. */
  addMemory(text: string, source: string, createdAt?: number): { memory: Memory; created: boolean } {
    const clean = text.trim();
    const norm = normalize(clean);
    const existing = this.db.query("select * from memories where norm = ?").get(norm) as any;
    if (existing) return { memory: rowToMemory(existing), created: false };
    const id = newID("m");
    const at = createdAt ?? this.now();
    this.db
      .query("insert into memories (id, text, norm, source, created_at, updated_at) values (?, ?, ?, ?, ?, ?)")
      .run(id, clean, norm, source, at, at);
    return { memory: this.memory(id)!, created: true };
  }

  memory(id: string): Memory | null {
    const row = this.db.query("select * from memories where id = ?").get(id) as any;
    return row ? rowToMemory(row) : null;
  }

  updateMemory(id: string, text: string): Memory | null {
    const clean = text.trim();
    try {
      const changed = this.db
        .query("update memories set text = ?, norm = ?, updated_at = ? where id = ?")
        .run(clean, normalize(clean), this.now(), id).changes;
      return changed ? this.memory(id) : null;
    } catch {
      // The new wording is already another memory: keep that one, drop this.
      this.deleteMemory(id);
      const row = this.db.query("select * from memories where norm = ?").get(normalize(clean)) as any;
      return row ? rowToMemory(row) : null;
    }
  }

  deleteMemory(id: string): boolean {
    return this.db.query("delete from memories where id = ?").run(id).changes > 0;
  }

  memories(query = "", limit = 200): Memory[] {
    const terms = query
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.map((t) => `"${t}"*`)
      .join(" OR ");
    if (!terms) {
      return (this.db.query("select * from memories order by updated_at desc limit ?").all(limit) as any[]).map(
        rowToMemory,
      );
    }
    return (
      this.db
        .query(
          `select m.* from memories_fts f join memories m on m.rowid = f.rowid
           where memories_fts match ? order by rank limit ?`,
        )
        .all(terms, limit) as any[]
    ).map(rowToMemory);
  }

  // ------------------------------------------------------------------ events

  addEvent(body: BodyID, kind: string, summary: string, detail = ""): GalaxyEvent {
    const result = this.db
      .query("insert into events (body, kind, summary, detail, at) values (?, ?, ?, ?, ?)")
      .run(body, kind, summary.trim(), detail, this.now());
    // Context is for continuity, not an archive: keep the last few thousand.
    this.db.query("delete from events where id <= ?").run(Number(result.lastInsertRowid) - 5000);
    return this.db.query("select * from events where id = ?").get(result.lastInsertRowid) as GalaxyEvent;
  }

  events(sinceMs = 0, limit = 50): GalaxyEvent[] {
    return (
      this.db.query("select * from events where at >= ? order by id desc limit ?").all(sinceMs, limit) as GalaxyEvent[]
    ).reverse();
  }

  // ------------------------------------------------------------------- tasks

  addTask(t: Pick<Task, "from" | "to" | "power" | "title" | "instructions" | "replyTo">): Task {
    const id = newID("t");
    const at = this.now();
    this.db
      .query(
        `insert into tasks (id, sender, target, power, title, instructions, status, reply_to, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
      )
      .run(id, t.from, t.to, t.power, t.title, t.instructions, t.replyTo, at, at);
    return this.task(id)!;
  }

  task(id: string): Task | null {
    const row = this.db.query("select * from tasks where id = ?").get(id) as any;
    return row ? rowToTask(row) : null;
  }

  tasks(filter: { status?: string; body?: string } = {}, limit = 100): Task[] {
    const where: string[] = [];
    const args: any[] = [];
    if (filter.status) (where.push("status = ?"), args.push(filter.status));
    if (filter.body) (where.push("(sender = ? or target = ?)"), args.push(filter.body, filter.body));
    const sql = `select * from tasks ${where.length ? "where " + where.join(" and ") : ""}
                 order by created_at desc limit ?`;
    return (this.db.query(sql).all(...args, limit) as any[]).map(rowToTask);
  }

  /** Atomically hands the oldest queued task for `body` to it. */
  claimTask(body: BodyID): Task | null {
    const row = this.db
      .query(
        `update tasks set status = 'claimed', updated_at = ?
         where id = (select id from tasks where target = ? and status = 'queued' order by created_at limit 1)
         returning *`,
      )
      .get(this.now(), body) as any;
    return row ? rowToTask(row) : null;
  }

  /** Claimed work whose body went away goes back on the queue. */
  requeueStale(body: BodyID): number {
    return this.db
      .query("update tasks set status = 'queued', updated_at = ? where target = ? and status = 'claimed'")
      .run(this.now(), body).changes;
  }

  progressTask(id: string, note: string): Task | null {
    this.db.query("update tasks set progress = ?, updated_at = ? where id = ? and status = 'claimed'").run(
      note,
      this.now(),
      id,
    );
    return this.task(id);
  }

  finishTask(id: string, status: "done" | "failed" | "cancelled", result: string): Task | null {
    const changed = this.db
      .query("update tasks set status = ?, result = ?, updated_at = ? where id = ? and status in ('queued', 'claimed')")
      .run(status, result, this.now(), id).changes;
    return changed ? this.task(id) : null;
  }

  // ------------------------------------------------------------------- inbox

  addInbox(item: Pick<InboxItem, "body" | "kind" | "taskId" | "text" | "replyTo">): InboxItem {
    const result = this.db
      .query("insert into inbox (body, kind, task_id, text, reply_to, created_at) values (?, ?, ?, ?, ?, ?)")
      .run(item.body, item.kind, item.taskId, item.text, item.replyTo, this.now());
    return rowToInbox(this.db.query("select * from inbox where id = ?").get(result.lastInsertRowid));
  }

  /** Everything waiting for `body`, marked delivered as it is handed over. */
  takeInbox(body: BodyID): InboxItem[] {
    const rows = this.db
      .query("update inbox set delivered_at = ? where body = ? and delivered_at = 0 returning *")
      .all(this.now(), body) as any[];
    return rows.map(rowToInbox).sort((a, b) => a.id - b.id);
  }

  pendingInbox(body: BodyID): number {
    return (this.db.query("select count(*) as n from inbox where body = ? and delivered_at = 0").get(body) as any).n;
  }
}

function rowToBody(r: any): Body {
  return { id: r.id, name: r.name, powers: JSON.parse(r.powers), launch: r.launch, lastSeen: r.last_seen, version: r.version };
}

function rowToMemory(r: any): Memory {
  return { id: r.id, text: r.text, source: r.source, createdAt: r.created_at, updatedAt: r.updated_at };
}

function rowToTask(r: any): Task {
  return {
    id: r.id,
    from: r.sender,
    to: r.target,
    power: r.power,
    title: r.title,
    instructions: r.instructions,
    status: r.status,
    result: r.result,
    progress: r.progress,
    replyTo: r.reply_to,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToInbox(r: any): InboxItem {
  return {
    id: r.id,
    body: r.body,
    kind: r.kind,
    taskId: r.task_id,
    text: r.text,
    replyTo: r.reply_to,
    createdAt: r.created_at,
    deliveredAt: r.delivered_at,
  };
}
