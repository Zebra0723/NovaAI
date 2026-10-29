// Galaxy Medic's side of Link: every checkup's result, the incidents Medic opens
// and closes, and each member's uptime, for the Medic page.
//
// Link only keeps and serves these. Medic itself (src/medic) runs on its own, so
// it can bring Link back when Link is what went down; what it saw then is sent
// here once Link is up again.

import type { Link } from "./link";
import type { BodyID, Store } from "./store";

export const MEDIC = "medic";

/** How a member is doing, as Medic sees it. */
export type Health = "healthy" | "recovering" | "needs_you" | "off" | "unknown";

export interface MemberHealth {
  member: string;
  health: Health;
  /** One line for you: "Running", "Restarted after a crash", "Signed out of Claude". */
  note: string;
}

export interface Checkup {
  at: number;
  members: MemberHealth[];
}

export type IncidentStatus = "open" | "fixed" | "needs_you";

export interface Incident {
  id: string;
  /** Same problem, same key: a crash that keeps happening is one incident, not fifty. */
  key: string;
  member: string;
  kind: string;
  status: IncidentStatus;
  title: string;
  /** What Medic found. */
  found: string;
  /** What Medic did about it. */
  did: string;
  /** For needs_you: exactly what to run or do. */
  fix: string;
  count: number;
  startedAt: number;
  updatedAt: number;
  resolvedAt: number;
}

const SCHEMA = `
create table if not exists medic_incidents (
  id text primary key,
  key text not null,
  member text not null,
  kind text not null,
  status text not null,
  title text not null,
  found text not null default '',
  did text not null default '',
  fix text not null default '',
  count integer not null default 1,
  started_at integer not null,
  updated_at integer not null,
  resolved_at integer not null default 0
);
create index if not exists medic_incidents_key on medic_incidents(key, status);
create table if not exists medic_samples (
  at integer not null,
  member text not null,
  up integer not null
);
create index if not exists medic_samples_at on medic_samples(at);
create table if not exists medic_meta (key text primary key, value text not null);
`;

export class MedicError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const HEALTH: Health[] = ["healthy", "recovering", "needs_you", "off", "unknown"];
const DAY = 86_400_000;

export class Medicine {
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
  private needMedic(who: BodyID) {
    if (who !== MEDIC) throw new MedicError(403, "only Galaxy Medic can do that");
  }

  // ---------------------------------------------------------------- checkups

  /** Medic reports a checkup: how every member is, and a sample for uptime. */
  report(who: BodyID, input: { members?: unknown; at?: unknown }): Checkup {
    this.needMedic(who);
    const members: MemberHealth[] = (Array.isArray(input.members) ? input.members : [])
      .map((m: any) => ({
        member: clean(m?.member, 32),
        health: HEALTH.includes(m?.health) ? m.health : "unknown",
        note: clean(m?.note, 300),
      }))
      .filter((m) => /^[a-z][a-z0-9-]{1,31}$/.test(m.member))
      .slice(0, 20);
    // A checkup Medic saw while Link was down arrives late, stamped with when it happened.
    const at = typeof input.at === "number" && input.at <= this.now() && input.at > this.now() - DAY ? input.at : this.now();
    const checkup = { at, members };
    this.db.query("insert into medic_meta (key, value) values ('checkup', ?) on conflict(key) do update set value = excluded.value").run(JSON.stringify(checkup));
    const sample = this.db.query("insert into medic_samples (at, member, up) values (?, ?, ?)");
    for (const m of members) if (m.health !== "off") sample.run(at, m.member, m.health === "healthy" ? 1 : 0);
    this.db.query("delete from medic_samples where at < ?").run(this.now() - 2 * DAY);
    return checkup;
  }

  checkup(): Checkup | null {
    const r = this.db.query("select value from medic_meta where key = 'checkup'").get() as any;
    try {
      return r ? JSON.parse(r.value) : null;
    } catch {
      return null;
    }
  }

  /** Each member's last 24 hours, in 48 half-hour slots: share of checks that found it healthy, or null with none. */
  uptime(sinceMs = this.now() - DAY, slots = 48): Record<string, (number | null)[]> {
    const rows = this.db.query("select at, member, up from medic_samples where at >= ? order by at").all(sinceMs) as any[];
    const width = (this.now() - sinceMs) / slots;
    const out: Record<string, { up: number; n: number }[]> = {};
    for (const r of rows) {
      const slot = Math.min(slots - 1, Math.floor((r.at - sinceMs) / width));
      const list = (out[r.member] ??= Array.from({ length: slots }, () => ({ up: 0, n: 0 })));
      list[slot]!.n++;
      list[slot]!.up += r.up;
    }
    return Object.fromEntries(Object.entries(out).map(([m, list]) => [m, list.map((s) => (s.n ? s.up / s.n : null))]));
  }

  // --------------------------------------------------------------- incidents

  private rowToIncident(r: any): Incident {
    return {
      id: r.id,
      key: r.key,
      member: r.member,
      kind: r.kind,
      status: r.status,
      title: r.title,
      found: r.found,
      did: r.did,
      fix: r.fix,
      count: r.count,
      startedAt: r.started_at,
      updatedAt: r.updated_at,
      resolvedAt: r.resolved_at,
    };
  }

  /**
   * Medic opens or updates an incident. The same key while it's still unresolved is the
   * same incident (its count goes up); once fixed, the next one starts fresh. Telling you
   * about a needs-you incident happens once, when it first needs you.
   */
  record(
    who: BodyID,
    input: { key?: unknown; member?: unknown; kind?: unknown; status?: unknown; title?: unknown; found?: unknown; did?: unknown; fix?: unknown },
  ): Incident {
    this.needMedic(who);
    const key = clean(input.key, 120);
    const member = clean(input.member, 32);
    const title = clean(input.title, 200);
    if (!key || !member || !title) throw new MedicError(400, "an incident needs a key, a member and a title");
    const status: IncidentStatus = input.status === "fixed" ? "fixed" : input.status === "needs_you" ? "needs_you" : "open";
    const at = this.now();
    const existing = this.db.query("select * from medic_incidents where key = ? and status != 'fixed' order by started_at desc limit 1").get(key) as any;
    const fields = { kind: clean(input.kind, 40) || "problem", found: clean(input.found, 4000), did: clean(input.did, 2000), fix: clean(input.fix, 1000) };
    let id: string;
    if (existing) {
      id = existing.id;
      this.db
        .query("update medic_incidents set status = ?, title = ?, found = ?, did = ?, fix = ?, kind = ?, count = count + ?, updated_at = ?, resolved_at = ? where id = ?")
        .run(status, title, fields.found || existing.found, fields.did || existing.did, fields.fix || existing.fix, fields.kind, status === "fixed" ? 0 : 1, at, status === "fixed" ? at : 0, id);
    } else {
      id = "i_" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
      this.db
        .query(
          `insert into medic_incidents (id, key, member, kind, status, title, found, did, fix, started_at, updated_at, resolved_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, key, member, fields.kind, status, title, fields.found, fields.did, fields.fix, at, at, status === "fixed" ? at : 0);
    }
    const incident = this.rowToIncident(this.db.query("select * from medic_incidents where id = ?").get(id));
    const name = this.link.profile(member).name || member;
    if (!existing || existing.status !== status) {
      if (status === "fixed") {
        this.store.addEvent(MEDIC, "medic", `fixed ${name}: ${title}`, incident.id);
        if (this.link.store.body(MEDIC)) this.link.say(MEDIC, "message", `Fixed: ${title}.${fields.did ? ` ${fields.did}` : ""}`);
      } else if (status === "needs_you") {
        this.store.addEvent(MEDIC, "medic", `needs you for ${name}: ${title}`, incident.id);
        if (this.link.store.body(MEDIC)) this.link.say(MEDIC, "message", `${name} needs you: ${title}.${fields.fix ? ` To fix it: ${fields.fix}` : ""}`);
        // The one time Medic reaches out: something only you can fix.
        try {
          this.link.deliver(MEDIC, `Galaxy Medic: ${name} needs you. ${title}.${fields.fix ? `\n\nTo fix it: ${fields.fix}` : ""}`);
        } catch {}
      }
    }
    return incident;
  }

  /** Medic closes whatever it had open under `key`, now that it's fine again. */
  resolve(who: BodyID, key: string, did = ""): Incident | null {
    this.needMedic(who);
    const open = this.db.query("select * from medic_incidents where key = ? and status != 'fixed' order by started_at desc limit 1").get(key) as any;
    if (!open) return null;
    return this.record(who, { key, member: open.member, kind: open.kind, status: "fixed", title: open.title, did: did || "It's back to normal." });
  }

  incidents(limit = 60): Incident[] {
    return (this.db.query("select * from medic_incidents order by (status = 'fixed'), updated_at desc limit ?").all(limit) as any[]).map((r) => this.rowToIncident(r));
  }

  /** Everything the Medic page shows. */
  overview() {
    const checkup = this.checkup();
    const incidents = this.incidents();
    const since = this.now() - DAY;
    return {
      medicOnline: this.link.isOnline(MEDIC),
      checkup,
      // A checkup older than five minutes means Medic isn't looking any more.
      stale: !checkup || this.now() - checkup.at > 5 * 60_000,
      open: incidents.filter((i) => i.status !== "fixed"),
      recent: incidents.filter((i) => i.status === "fixed" && i.resolvedAt > since - 6 * DAY).slice(0, 30),
      fixedToday: incidents.filter((i) => i.status === "fixed" && i.resolvedAt > since).length,
      uptime: this.uptime(),
    };
  }
}
