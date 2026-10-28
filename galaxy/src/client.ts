// A body's way into Galaxy Link, for bodies written in TypeScript (Comet,
// and later Nebula and Zenith). Copy this one file in; it has no imports
// beyond Node's.
//
// Everything here fails soft. If galaxyd isn't running, calls resolve to
// null or [] and the body carries on alone - Link makes a body better, it
// is never a reason for one to stop working.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface LinkTask {
  id: string;
  from: string;
  to: string;
  power: string;
  title: string;
  instructions: string;
  status: string;
  result: string;
  progress: string;
  replyTo: string;
}

export interface LinkInboxItem {
  id: number;
  kind: "task_result" | "message";
  taskId: string;
  text: string;
  replyTo: string;
}

export interface LinkApproval {
  id: string;
  from: string;
  title: string;
  detail: string;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
  decidedBy: string;
  via: string;
  expiresAt: number;
}

export interface LinkMemory {
  id: string;
  text: string;
  source: string;
}

export interface GalaxyLinkOptions {
  name?: string;
  powers?: string[];
  version?: string;
  home?: string;
  port?: number;
  token?: string;
}

export class GalaxyLink {
  private stopped = false;
  private home: string;

  constructor(
    readonly body: string,
    private opts: GalaxyLinkOptions = {},
  ) {
    this.home = opts.home ?? process.env.GALAXY_HOME ?? join(homedir(), "Library", "Application Support", "Galaxy");
  }

  private token(): string | null {
    if (this.opts.token) return this.opts.token;
    try {
      return readFileSync(join(this.home, "token"), "utf8").trim();
    } catch {
      return null;
    }
  }

  private base(): string {
    let port = this.opts.port;
    if (!port) {
      try {
        port = Number(readFileSync(join(this.home, "port"), "utf8").trim());
      } catch {}
    }
    return `http://127.0.0.1:${port || 7740}`;
  }

  /** null when Link isn't there or said no; the parsed body otherwise. */
  async call<T>(method: string, path: string, body?: unknown, timeoutMs = 10_000): Promise<T | null> {
    const token = this.token();
    if (!token) return null;
    try {
      const res = await fetch(this.base() + path, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "x-galaxy-body": this.body,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 204 || !res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  async available(): Promise<boolean> {
    try {
      const res = await fetch(this.base() + "/v1/health", { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  hello() {
    return this.call("POST", "/v1/hello", { name: this.opts.name, powers: this.opts.powers, version: this.opts.version });
  }

  goodbye() {
    this.stopped = true;
    return this.call("POST", "/v1/goodbye", {});
  }

  // Memory, shared by every body.
  memories(query = "") {
    return this.call<LinkMemory[]>("GET", "/v1/memory" + (query ? "?q=" + encodeURIComponent(query) : ""));
  }
  remember(text: string, fromUser = false) {
    return this.call<LinkMemory>("POST", "/v1/memory", { text, source: fromUser ? "user" : undefined });
  }
  forget(id: string) {
    return this.call("DELETE", "/v1/memory/" + encodeURIComponent(id));
  }

  /** A block for the system prompt: memory, what the other bodies did, who's running. */
  async context(): Promise<string | null> {
    return (await this.call<{ text: string }>("GET", "/v1/context"))?.text ?? null;
  }

  /** Tells the other bodies what this one just did, so they can pick up where it left off. */
  note(summary: string, detail = "", kind = "activity") {
    return this.call("POST", "/v1/events", { kind, summary, detail });
  }

  /** Hands work to whichever body has `power` (or to `to`). Only for powers this body lacks. */
  handoff(task: { power?: string; to?: string; title: string; instructions: string; replyTo?: string }) {
    return this.call<LinkTask>("POST", "/v1/tasks", task);
  }

  task(id: string) {
    return this.call<LinkTask>("GET", "/v1/tasks/" + id);
  }
  progress(id: string, note: string) {
    return this.call<LinkTask>("POST", `/v1/tasks/${id}/progress`, { note });
  }
  finish(id: string, ok: boolean, result: string) {
    return this.call<LinkTask>("POST", `/v1/tasks/${id}/done`, { ok, result });
  }

  /**
   * Asks the user a yes-or-no and waits for the answer (a thumbs up or down to Nebula, or
   * another body). Resolves to the settled approval, or null if Link isn't there.
   */
  async ask(title: string, opts: { detail?: string; ttlSeconds?: number } = {}): Promise<LinkApproval | null> {
    const created = await this.call<LinkApproval>("POST", "/v1/approvals", { title, ...opts });
    if (!created) return null;
    const deadline = Date.now() + (opts.ttlSeconds ?? 120) * 1000 + 5000;
    while (Date.now() < deadline) {
      const now = await this.call<LinkApproval>("GET", `/v1/approvals/${created.id}?wait=25`, undefined, 30_000);
      if (!now) return null;
      if (now.status !== "pending") return now;
    }
    return null;
  }

  /** Answers another body's approval. */
  decide(id: string, approve: boolean, via = "text") {
    return this.call<LinkApproval>("POST", `/v1/approvals/${id}/decide`, { decision: approve ? "approve" : "reject", via });
  }

  /** A message for the user, delivered wherever they are. Only ever for something they asked for. */
  deliver(text: string) {
    return this.call("POST", "/v1/deliver", { text });
  }

  /**
   * Says hello, then keeps three loops going until goodbye(): a heartbeat,
   * work handed to this body, and results coming back to it. Link being
   * down just means the loops wait and try again.
   */
  run(handlers: {
    onTask?: (task: LinkTask) => Promise<{ ok: boolean; result: string }>;
    onInbox?: (item: LinkInboxItem) => Promise<void>;
  }) {
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const loop = async (step: () => Promise<boolean>) => {
      while (!this.stopped) {
        const worked = await step().catch(() => false);
        if (!worked) await pause(5000);
      }
    };
    void loop(async () => {
      const ok = (await this.call("POST", "/v1/heartbeat", {})) ?? (await this.hello());
      await pause(30_000);
      return ok !== null;
    });
    void this.hello();
    if (handlers.onTask) {
      const onTask = handlers.onTask;
      void loop(async () => {
        const task = await this.call<LinkTask>("GET", "/v1/tasks/next?wait=25", undefined, 30_000);
        if (!task) return (await this.available());
        const outcome = await onTask(task).catch((e) => ({ ok: false, result: String(e?.message ?? e) }));
        await this.finish(task.id, outcome.ok, outcome.result);
        return true;
      });
    }
    if (handlers.onInbox) {
      const onInbox = handlers.onInbox;
      void loop(async () => {
        const items = await this.call<LinkInboxItem[]>("GET", "/v1/inbox?wait=25", undefined, 30_000);
        if (items === null) return false;
        for (const item of items) await onInbox(item).catch(() => {});
        return true;
      });
    }
  }
}
