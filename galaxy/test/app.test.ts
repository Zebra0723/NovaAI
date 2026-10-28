import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Link } from "../src/link";
import { PresenceReader } from "../src/presence";
import { handle } from "../src/server";
import { Store } from "../src/store";

let store: Store;
let link: Link;
const TOKEN = "a".repeat(64);

beforeEach(() => {
  store = new Store(":memory:");
  link = new Link(store, new PresenceReader(() => 10));
  link.launcher = () => {};
});
afterEach(() => store.close());

const req = (path: string, init: RequestInit = {}, headers: Record<string, string> = {}) =>
  handle(
    link,
    TOKEN,
    new Request("http://127.0.0.1:7740" + path, {
      ...init,
      headers: { authorization: `Bearer ${TOKEN}`, "x-galaxy-body": "you", host: "127.0.0.1:7740", ...headers },
    }),
  );

describe("Galaxy Chat", () => {
  test("every newcomer opens with a greeting and an intro, once ever", () => {
    link.hello("comet", {});
    link.hello("comet", {});
    link.goodbye("comet");
    link.hello("comet", {});
    const intros = store.chat().filter((m) => m.kind === "intro");
    expect(intros).toHaveLength(1);
    expect(intros[0]!.text).toStartWith("Hi everyone, Comet here.");
  });

  test("a body can bring its own intro, and a future member gets one made for it", () => {
    link.hello("nebula", { intro: "Hi all, I'm Nebula, the hands." });
    link.hello("aurora", { name: "Aurora", powers: ["dreams"] });
    const intro = (id: string) => store.chat().find((m) => m.body === id && m.kind === "intro")!.text;
    expect(intro("nebula")).toBe("Hi all, I'm Nebula, the hands.");
    expect(intro("aurora")).toContain("Hi everyone, I'm Aurora");
    expect(intro("aurora")).toContain("dreams");
  });

  test("a handoff reads as a conversation: asked, picked up, done", async () => {
    link.hello("comet", {});
    link.hello("nova", {});
    const task = link.handoff({ from: "comet", power: "screen", title: "Open Figma", instructions: "..." });
    await link.next("nova", 0);
    link.finish(task.id, "nova", true, "Opened it.");
    const kinds = store.chat().filter((m) => m.taskId === task.id).map((m) => [m.body, m.kind]);
    expect(kinds).toEqual([
      ["comet", "handoff"],
      ["nova", "claimed"],
      ["nova", "result"],
    ]);
    expect(store.chat().at(-1)!.text).toContain("@Comet done: Open Figma");
  });

  test("you watch; only members can post", async () => {
    link.hello("comet", {});
    expect((await req("/v1/chat", { method: "POST", body: '{"text":"hi"}' })).status).toBe(403);
    expect((await req("/v1/chat", { method: "POST", body: '{"text":"hi"}' }, { "x-galaxy-body": "comet" })).status).toBe(201);
  });

  test("a waiting reader hears new messages the moment they're posted", async () => {
    link.hello("comet", {});
    const last = store.chat().at(-1)!.id;
    const waiting = link.chat(last, 2000);
    link.say("comet", "message", "Built it.");
    expect((await waiting).map((m) => m.text)).toEqual(["Built it."]);
  });
});

describe("the dashboard", () => {
  test("shows every member, including the ones that haven't joined", () => {
    link.hello("comet", {});
    const o = link.overview(0);
    const ids = o.bodies.map((b) => b.id);
    expect(ids).toEqual(expect.arrayContaining(["comet", "orbit", "nova", "nebula", "zenith"]));
    expect(o.bodies.find((b) => b.id === "comet")).toMatchObject({ joined: true, online: true });
    expect(o.bodies.find((b) => b.id === "zenith")).toMatchObject({ joined: false, online: false });
  });

  test("says who's working on what, and counts the day", async () => {
    link.hello("comet", {});
    link.hello("nova", {});
    store.addMemory("Likes sushi", "user");
    const task = link.handoff({ from: "comet", power: "screen", title: "Rename files", instructions: "..." });
    await link.next("nova", 0);
    const o = link.overview(0);
    expect(o.bodies.find((b) => b.id === "nova")!.working?.title).toBe("Rename files");
    expect(o.counts).toMatchObject({ memories: 1, inFlight: 1, finishedToday: 0, approvals: 0 });
    link.finish(task.id, "nova", true, "");
    expect(link.overview(0).counts).toMatchObject({ inFlight: 0, finishedToday: 1 });
  });

  test("you can answer an approval from the app", async () => {
    link.hello("comet", {});
    const a = link.requestApproval("comet", { title: "Send it?" });
    const res = await req(`/v1/approvals/${a.id}/decide`, { method: "POST", body: '{"decision":"approve","via":"app"}' });
    expect((await res.json()).status).toBe("approved");
    const history = await (await req("/v1/approvals")).json();
    expect(history[0]).toMatchObject({ id: a.id, status: "approved", decidedBy: "you", via: "app" });
  });
});

describe("the app's pages", () => {
  test("are served without a token, and hold nothing secret", async () => {
    const page = await req("/", {}, { authorization: "" });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(page.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await page.text()).not.toContain(TOKEN);
    expect((await req("/js/main.js", {}, { authorization: "" })).status).toBe(200);
  });

  test("never serve anything outside the app's folder", async () => {
    for (const path of ["/../src/server.ts", "/%2e%2e/src/server.ts", "/js/../../package.json", "/nope.html"]) {
      expect((await req(path, {}, { authorization: "" })).status).toBe(404);
    }
  });

  test("the app's own pages can call Link; any other page is refused", async () => {
    const same = { origin: "http://127.0.0.1:7740", "sec-fetch-site": "same-origin" };
    expect((await req("/v1/overview", {}, same)).status).toBe(200);
    expect((await req("/v1/memory", { method: "POST", body: '{"text":"x","source":"user"}' }, same)).status).toBe(201);
    expect((await req("/v1/overview", {}, { origin: "http://127.0.0.1:9999", "sec-fetch-site": "same-site" })).status).toBe(403);
    expect((await req("/v1/overview", {}, { origin: "https://evil.example", "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await req("/v1/overview", {}, { origin: "https://evil.example" })).status).toBe(403);
  });

  test("a page still needs the token to read anything", async () => {
    const same = { origin: "http://127.0.0.1:7740", "sec-fetch-site": "same-origin", authorization: "" };
    expect((await req("/v1/overview", {}, same)).status).toBe(401);
  });
});
