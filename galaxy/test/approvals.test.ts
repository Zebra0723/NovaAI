import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Link, LinkError } from "../src/link";
import { PresenceReader } from "../src/presence";
import { handle } from "../src/server";
import { Store } from "../src/store";

let store: Store;
let link: Link;
let clock: number;

beforeEach(() => {
  store = new Store(":memory:");
  clock = 1_000_000;
  store.now = () => clock;
  link = new Link(store, new PresenceReader(() => 10));
  link.launcher = () => {};
  link.hello("comet", {});
  link.hello("nebula", {});
});
afterEach(() => store.close());

describe("approvals", () => {
  test("a body asks, Nebula answers, and the asker hears it at once", async () => {
    const a = link.requestApproval("comet", { title: "Send the email to Priya?" });
    expect(a.status).toBe("pending");
    const waiting = link.waitForDecision(a.id, 10_000);
    const started = Date.now();
    setTimeout(() => link.decide(a.id, "nebula", "approve", "gesture"), 20);
    const settled = await waiting;
    expect(settled.status).toBe("approved");
    expect(settled.decidedBy).toBe("nebula");
    expect(settled.via).toBe("gesture");
    expect(Date.now() - started).toBeLessThan(500);
    expect(store.chat().some((m) => m.kind === "approval" && m.text.includes("Approved with a gesture"))).toBe(true);
  });

  test("Nebula's long poll wakes the moment something is pending", async () => {
    const { version } = link.pendingApprovals();
    const poll = link.pendingApprovalsSince(version, 10_000);
    setTimeout(() => link.requestApproval("comet", { title: "Deploy?" }), 20);
    const started = Date.now();
    const next = await poll;
    expect(next.pending.map((p) => p.title)).toEqual(["Deploy?"]);
    expect(next.version).not.toBe(version);
    expect(Date.now() - started).toBeLessThan(500);
  });

  test("the first answer wins, and nobody answers their own question", () => {
    const a = link.requestApproval("comet", { title: "Book it?" });
    expect(() => link.decide(a.id, "comet", "approve", "")).toThrow(LinkError);
    link.decide(a.id, "nebula", "reject", "gesture");
    expect(() => link.decide(a.id, "nova", "approve", "")).toThrow("already rejected");
    expect(() => link.decide(a.id, "nebula", "maybe", "")).toThrow();
  });

  test("unanswered approvals expire, and leave the pending list", () => {
    const a = link.requestApproval("comet", { title: "Quick?", ttlSeconds: 10 });
    expect(link.pendingApprovals().pending).toHaveLength(1);
    clock += 11_000;
    expect(link.pendingApprovals().pending).toHaveLength(0);
    expect(link.approval(a.id).status).toBe("expired");
  });

  test("only the asker can cancel", () => {
    const a = link.requestApproval("comet", { title: "Run it?" });
    expect(() => link.cancelApproval(a.id, "nebula")).toThrow();
    expect(link.cancelApproval(a.id, "comet").status).toBe("cancelled");
  });

  test("over HTTP", async () => {
    const req = (method: string, path: string, body: string, data?: unknown) =>
      handle(link, "tok", new Request("http://127.0.0.1:7740" + path, {
        method,
        headers: { authorization: "Bearer tok", "x-galaxy-body": body, ...(data ? { "content-type": "application/json" } : {}) },
        body: data ? JSON.stringify(data) : undefined,
      }));
    const created = await (await req("POST", "/v1/approvals", "comet", { title: "Ship?" })).json();
    expect(created.status).toBe("pending");
    const pending = await (await req("GET", "/v1/approvals/pending?since=0", "nebula")).json();
    expect(pending.pending[0].id).toBe(created.id);
    const decided = await (await req("POST", `/v1/approvals/${created.id}/decide`, "nebula", { decision: "approve", via: "gesture" })).json();
    expect(decided.status).toBe("approved");
    const seen = await (await req("GET", `/v1/approvals/${created.id}?wait=1`, "comet")).json();
    expect(seen.status).toBe("approved");
    expect((await req("POST", "/v1/approvals", "comet", {})).status).toBe(400);
  });
});
