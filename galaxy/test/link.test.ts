import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GalaxyLink } from "../src/client";
import { Link, LinkError } from "../src/link";
import { PresenceReader } from "../src/presence";
import { handle, serve } from "../src/server";
import { Store } from "../src/store";

let store: Store;
let link: Link;
let idle: number | null;
let launched: string[];

beforeEach(() => {
  store = new Store(":memory:");
  idle = 10;
  link = new Link(store, new PresenceReader(() => idle));
  launched = [];
  link.launcher = (c) => launched.push(c);
});
afterEach(() => store.close());

/** A fresh presence reading, past the reader's 5s cache. */
function at(seconds: number | null) {
  idle = seconds;
  (link.presence as any).cached = null;
}

describe("memory", () => {
  test("is shared, and the same fact twice is one memory", () => {
    const a = store.addMemory("Arjun's sister is called Priya.", "comet");
    const b = store.addMemory("arjun's  sister is called priya", "nova");
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.memory.id).toBe(a.memory.id);
    expect(store.memories()).toHaveLength(1);
  });

  test("search finds by word", () => {
    store.addMemory("Prefers dark mode", "nova");
    store.addMemory("Has a robotics competition in March", "comet");
    expect(store.memories("robotics").map((m) => m.text)).toEqual(["Has a robotics competition in March"]);
    expect(store.memories("dark").map((m) => m.source)).toEqual(["nova"]);
  });

  test("rewording into an existing memory merges them", () => {
    const keep = store.addMemory("Likes sushi", "comet").memory;
    const other = store.addMemory("Likes ramen", "nova").memory;
    const merged = store.updateMemory(other.id, "likes sushi");
    expect(merged?.id).toBe(keep.id);
    expect(store.memories()).toHaveLength(1);
  });
});

describe("works with any body missing", () => {
  test("Orbit quit changes nothing for the others", () => {
    link.hello("comet", {});
    link.hello("nova", {});
    // Orbit never said hello at all.
    const task = link.handoff({ from: "comet", power: "screen", title: "Fill the form", instructions: "..." });
    expect(task.to).toBe("nova");
    expect(link.promptContext("nova")).not.toContain("Orbit");
  });

  test("work for a body that isn't running waits for it, and Nova is started", async () => {
    link.hello("comet", {});
    const task = link.handoff({ from: "comet", power: "screen", title: "Rename the files", instructions: "..." });
    expect(task.status).toBe("queued");
    expect(launched).toEqual(["open -g -b ai.galaxy.nova"]);
    link.hello("nova", {});
    const claimed = await link.next("nova", 0);
    expect(claimed?.id).toBe(task.id);
  });

  test("Orbit is never started, never handed work, and never a delivery", () => {
    link.hello("orbit", {});
    expect(() => link.route("comet", "voice")).toThrow(LinkError);
    expect(() => link.handoff({ from: "comet", to: "orbit", title: "say hi", instructions: "say hi" })).toThrow(
      /only speaks when spoken to/,
    );
    at(5);
    expect(link.deliveryTarget("orbit")).not.toBe("orbit");
    at(5000);
    expect(link.deliveryTarget("orbit")).toBe("comet");
    expect(launched).toEqual([]);
  });

  test("a body can't hand work to itself, or for a power nobody has", () => {
    expect(() => link.handoff({ from: "nova", to: "nova", title: "x", instructions: "y" })).toThrow();
    expect(() => link.handoff({ from: "nova", power: "teleport", title: "x", instructions: "y" })).toThrow(/no body/);
  });
});

describe("handoffs", () => {
  test("go to the body with the power, and the result comes back", async () => {
    link.hello("comet", {});
    link.hello("nova", {});
    at(5); // at the Mac
    const task = link.handoff({ from: "nova", power: "build_web", title: "Build a site", instructions: "...", replyTo: "conv-1" });
    expect(task.to).toBe("comet");
    const claimed = await link.next("comet", 0);
    link.finish(claimed!.id, "comet", true, "https://example.site");
    const inbox = await link.inbox("nova", 0);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.text).toContain("Comet finished \"Build a site\"");
    expect(inbox[0]!.replyTo).toBe("conv-1");
    expect(await link.inbox("nova", 0)).toHaveLength(0);
  });

  test("a result for Nova goes to your phone if you've walked away", async () => {
    link.hello("comet", {});
    link.hello("nova", {});
    const task = link.handoff({ from: "nova", power: "cad", title: "Make the bracket", instructions: "..." });
    await link.next("comet", 0);
    at(3600); // gone an hour
    link.finish(task.id, "comet", true, "bracket.step");
    expect(await link.inbox("nova", 0)).toHaveLength(0);
    const comet = await link.inbox("comet", 0);
    expect(comet[0]!.text).toContain("bracket.step");
    expect(comet[0]!.replyTo).toBe(""); // Nova's reply_to means nothing to Comet
  });

  test("a waiting body gets work the moment it arrives", async () => {
    link.hello("comet", {});
    link.hello("nova", {});
    const waiting = link.next("nova", 2000);
    const task = link.handoff({ from: "comet", power: "screen", title: "Open Figma", instructions: "..." });
    expect((await waiting)?.id).toBe(task.id);
  });

  test("only the doer can finish, only the asker can cancel, and only once", async () => {
    link.hello("comet", {});
    link.hello("nova", {});
    const task = link.handoff({ from: "comet", power: "screen", title: "t", instructions: "i" });
    expect(() => link.finish(task.id, "comet", true, "")).toThrow(/another body/);
    expect(() => link.cancel(task.id, "nova")).toThrow(/only the body that asked/);
    link.cancel(task.id, "comet");
    expect(() => link.cancel(task.id, "comet")).toThrow(/already finished/);
  });

  test("work claimed by a body that quit goes back on the queue", async () => {
    link.hello("comet", {});
    link.hello("nova", {});
    const task = link.handoff({ from: "comet", power: "screen", title: "t", instructions: "i" });
    await link.next("nova", 0);
    link.goodbye("nova");
    expect(store.task(task.id)?.status).toBe("queued");
  });
});

describe("context", () => {
  test("one body knows what another did", () => {
    link.hello("comet", {});
    store.addMemory("Goes to Lincoln High", "comet");
    store.addEvent("comet", "activity", "Built the robotics club website");
    const text = link.promptContext("nova");
    expect(text).toContain("You are Nova");
    expect(text).toContain("Goes to Lincoln High");
    expect(text).toContain("Comet: Built the robotics club website");
    expect(text).toContain("Comet [comet], running");
  });
});

describe("the HTTP door", () => {
  const TOKEN = "t".repeat(64);
  const req = (path: string, init: RequestInit & { body?: any } = {}, headers: Record<string, string> = {}) =>
    handle(
      link,
      TOKEN,
      new Request("http://127.0.0.1:7740" + path, {
        ...init,
        headers: { authorization: `Bearer ${TOKEN}`, "x-galaxy-body": "comet", host: "127.0.0.1:7740", ...headers },
      }),
    );

  test("health needs nothing; everything else needs the token", async () => {
    expect((await req("/v1/health", {}, { authorization: "" })).status).toBe(200);
    expect((await req("/v1/memory", {}, { authorization: "Bearer nope" })).status).toBe(401);
    expect((await req("/v1/memory")).status).toBe(200);
  });

  test("browsers and rebound hostnames are refused", async () => {
    expect((await req("/v1/memory", {}, { origin: "https://evil.example" })).status).toBe(403);
    expect((await req("/v1/memory", {}, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await req("/v1/memory", {}, { host: "evil.example:7740" })).status).toBe(403);
  });

  test("a whole handoff over HTTP", async () => {
    await req("/v1/hello", { method: "POST", body: "{}" });
    await req("/v1/hello", { method: "POST", body: "{}" }, { "x-galaxy-body": "nova" });
    const created = await req("/v1/tasks", {
      method: "POST",
      body: JSON.stringify({ power: "screen", title: "Click it", instructions: "Click the button" }),
    });
    expect(created.status).toBe(201);
    const task = await created.json();
    const next = await (await req("/v1/tasks/next", {}, { "x-galaxy-body": "nova" })).json();
    expect(next.id).toBe(task.id);
    const empty = await req("/v1/tasks/next", {}, { "x-galaxy-body": "nova" });
    expect(empty.status).toBe(204);
    const done = await req(`/v1/tasks/${task.id}/done`, { method: "POST", body: JSON.stringify({ ok: true, result: "Clicked." }) }, { "x-galaxy-body": "nova" });
    expect((await done.json()).status).toBe("done");
    const inbox = await (await req("/v1/inbox")).json();
    expect(inbox[0].text).toContain("Clicked.");
  });

  test("bad input is a 400, not a crash", async () => {
    expect((await req("/v1/memory", { method: "POST", body: "{not json" })).status).toBe(400);
    expect((await req("/v1/memory", { method: "POST", body: "{}" })).status).toBe(400);
    expect((await req("/v1/tasks", { method: "POST", body: "{}" })).status).toBe(400);
    expect((await req("/v1/memory", {}, { "x-galaxy-body": "" })).status).toBe(200);
    expect((await req("/v1/events", { method: "POST", body: '{"summary":"x"}' }, { "x-galaxy-body": "../etc" })).status).toBe(400);
  });
});

describe("the client", () => {
  test("with Link down, everything resolves to null and nothing throws", async () => {
    const home = mkdtempSync(join(tmpdir(), "galaxy-"));
    const client = new GalaxyLink("comet", { home, port: 1, token: "x" });
    expect(await client.available()).toBe(false);
    expect(await client.memories()).toBeNull();
    expect(await client.context()).toBeNull();
    expect(await client.handoff({ power: "screen", title: "t", instructions: "i" })).toBeNull();
    rmSync(home, { recursive: true, force: true });
  });

  test("against a real galaxyd", async () => {
    const TOKEN = "k".repeat(64);
    const server = serve({ link, token: TOKEN, port: 0 });
    const comet = new GalaxyLink("comet", { port: server.port, token: TOKEN });
    const nova = new GalaxyLink("nova", { port: server.port, token: TOKEN });
    expect(await comet.available()).toBe(true);
    await comet.hello();
    await nova.hello();
    await comet.remember("Birthday is 12 May", true);
    expect((await nova.memories("birthday"))?.[0]?.source).toBe("user");
    await comet.note("Sent Mum the photos");
    expect(await nova.context()).toContain("Sent Mum the photos");
    const task = await comet.handoff({ power: "screen", title: "Resize window", instructions: "..." });
    expect(task?.to).toBe("nova");
    server.stop(true);
  });
});
