// Keeps a consumer's Galaxy in their account: their memories, and each member's training
// program and playbook. Link works from the copy on the Mac; this sends changes up
// every half minute, and on a Mac that has nothing yet, brings everything down first.
//
// Row-level security in Supabase means an account can only ever read or write its
// own rows (consumer/supabase/migrations), so nothing is shared between people.

import type { Link } from "../link";
import type { Account } from "./account";

const EVERY_MS = 30_000;

export class Sync {
  private pushedMemories = "";
  private pushedIds = new Set<string>();
  private pushedTraining = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  lastError = "";
  lastSyncedAt = 0;

  constructor(
    private readonly link: Link,
    private readonly account: Account,
  ) {}

  private async rest(method: string, path: string, body?: unknown, prefer = "") {
    const token = await this.account.accessToken();
    return this.account.call(method, `/rest/v1/${path}`, body, token, prefer ? { prefer } : {});
  }

  /** On a Mac with nothing yet: everything the account kept. Then keeps it up to date. */
  async start() {
    await this.pull().catch((e) => (this.lastError = e.message));
    await this.push().catch((e) => (this.lastError = e.message));
    this.timer = setInterval(() => void this.push().catch((e) => (this.lastError = e.message)), EVERY_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async pull() {
    const store = this.link.store;
    if (!store.memories("", 1).length) {
      const rows = ((await this.rest("GET", "memories?select=id,text,source,created_at,updated_at&order=created_at.asc")) ?? []) as any[];
      for (const r of rows) store.importMemory({ id: r.id, text: r.text, source: r.source, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) });
      this.pushedIds = new Set(rows.map((r) => r.id));
    }
    const docs = ((await this.rest("GET", "documents?select=key,value&key=eq.training")) ?? []) as any[];
    if (docs[0]?.value) this.link.training.restore(docs[0].value);
  }

  async push() {
    const memories = this.link.store.memories("", 5000);
    const sig = JSON.stringify(memories.map((m) => [m.id, m.text, m.updatedAt]));
    if (sig !== this.pushedMemories) {
      if (memories.length) {
        await this.rest(
          "POST",
          "memories?on_conflict=user_id,id",
          memories.map((m) => ({ id: m.id, text: m.text, source: m.source, created_at: m.createdAt, updated_at: m.updatedAt })),
          "resolution=merge-duplicates,return=minimal",
        );
      }
      // Forgotten here is forgotten in the account too.
      const now = new Set(memories.map((m) => m.id));
      const gone = [...this.pushedIds].filter((id) => !now.has(id));
      for (let i = 0; i < gone.length; i += 100) {
        await this.rest("DELETE", `memories?id=in.(${gone.slice(i, i + 100).map(encodeURIComponent).join(",")})`, undefined, "return=minimal");
      }
      this.pushedIds = now;
      this.pushedMemories = sig;
    }
    const training = this.link.training.snapshot();
    const tsig = JSON.stringify(training);
    if (tsig !== this.pushedTraining) {
      await this.rest("POST", "documents?on_conflict=user_id,key", [{ key: "training", value: training }], "resolution=merge-duplicates,return=minimal");
      this.pushedTraining = tsig;
    }
    this.lastError = "";
    this.lastSyncedAt = Date.now();
  }
}
