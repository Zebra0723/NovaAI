import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Account } from "../src/consumer/account";
import { consumerLink } from "../src/consumer/galaxyd";
import { fakeService } from "../scripts/consumer/fake-service";
import { bundle, makeTree, typecheck } from "../scripts/consumer/build";
import { scan } from "../scripts/consumer/privacy";
import { strip } from "../scripts/consumer/strip";

const TOKEN = "c".repeat(64);
const SERVICE = { url: "https://galaxy.example", anonKey: "anon" };

const req = (path: string, method = "GET", body?: unknown, as = "you") =>
  new Request("http://127.0.0.1:7750" + path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { authorization: `Bearer ${TOKEN}`, "x-galaxy-body": as, host: "127.0.0.1:7750" },
  });

let homes: string[] = [];
const home = () => {
  const h = mkdtempSync(join(tmpdir(), "galaxy-consumer-"));
  homes.push(h);
  return h;
};

describe("the consumer edition", () => {
  beforeAll(() => {
    process.env.GALAXY_EDITION = "consumer";
  });
  afterAll(() => {
    delete process.env.GALAXY_EDITION;
    for (const h of homes) rmSync(h, { recursive: true, force: true });
  });

  test("the owner-only parts are cut out, and the consumer lines switched on", () => {
    const src = ['const a = 1;', '// #owner', 'const who = "the owner";', '// #consumer const who = "you";', '// #end', 'export { a, who };'].join("\n");
    expect(strip(src)).toBe(['const a = 1;', 'const who = "you";', 'export { a, who };'].join("\n"));
    expect(() => strip("// #owner\nx")).toThrow("never closed");
  });

  test("nothing works until you sign in, and then it's your own Galaxy", async () => {
    const svc = fakeService();
    const c = consumerLink(TOKEN, new Account(home(), SERVICE, svc.fetcher), true);
    const locked = await c.fetch(req("/v1/overview"));
    expect(locked.status).toBe(401);
    expect(await locked.json()).toMatchObject({ signedOut: true });
    // Only the Galaxy Link window can sign in: not a member.
    expect((await c.fetch(req("/v1/account/signup", "POST", { email: "a@example.com", password: "password1" }, "nova"))).status).toBe(403);
    const r = await (await c.fetch(req("/v1/account/signup", "POST", { email: "a@example.com", password: "password1" }))).json();
    expect(r).toMatchObject({ signedIn: true, user: { email: "a@example.com" }, claude: false });
    // Their own Claude, connected once, for every member.
    expect((await c.fetch(req("/v1/account/claude", "PUT", { token: "not a token" }))).status).toBe(400);
    const claude = await (await c.fetch(req("/v1/account/claude", "PUT", { token: "sk-ant-oat01-" + "x".repeat(40) }))).json();
    expect(claude.claude).toBe(true);
    expect((await c.fetch(req("/v1/overview"))).status).toBe(200);
    c.close();
  });

  test("there's no Comet and no Teach: nothing can be handed to Comet, and nobody mentions it", async () => {
    const svc = fakeService();
    const c = consumerLink(TOKEN, new Account(home(), SERVICE, svc.fetcher), false);
    await c.fetch(req("/v1/account/signup", "POST", { email: "b@example.com", password: "password1" }));
    expect((await c.fetch(req("/v1/hello", "POST", { name: "Comet" }, "comet"))).status).toBe(404);
    await c.fetch(req("/v1/hello", "POST", {}, "nova"));
    const handoff = await c.fetch(req("/v1/tasks", "POST", { to: "comet", title: "text Sam", instructions: "say hi" }, "nova"));
    expect(handoff.status).toBe(404);
    expect((await c.fetch(req("/v1/teach"))).status).toBe(404);
    const overview = await (await c.fetch(req("/v1/overview"))).json();
    expect(overview.bodies.map((b: any) => b.id)).not.toContain("comet");
    expect(overview.bodies.map((b: any) => b.id)).not.toContain("teach");
    const prompt = c.current()!.promptContext("nova");
    expect(prompt.toLowerCase()).not.toContain("comet");
    c.close();
  });

  test("each account's memories are its own, kept in the account, and come back on a new Mac", async () => {
    const svc = fakeService();
    // Ada's Mac.
    const ada = consumerLink(TOKEN, new Account(home(), SERVICE, svc.fetcher), true);
    await ada.fetch(req("/v1/account/signup", "POST", { email: "ada@example.com", password: "password1" }));
    await ada.fetch(req("/v1/memory", "POST", { text: "Ada's dog is called Biscuit.", source: "user" }));
    await ada.fetch(req("/v1/account/signout", "POST", {})); // pushes, then forgets this Mac's session
    expect(svc.rows.memories.map((m) => m.text)).toEqual(["Ada's dog is called Biscuit."]);
    ada.close();

    // Ben, on his own Mac, sees none of it, and can't learn about Ada.
    const ben = consumerLink(TOKEN, new Account(home(), SERVICE, svc.fetcher), true);
    await ben.fetch(req("/v1/account/signup", "POST", { email: "ben@example.com", password: "password1" }));
    const benMemories = await (await ben.fetch(req("/v1/memory"))).json();
    expect(benMemories).toEqual([]);
    expect(ben.current()!.promptContext("nova")).not.toContain("Biscuit");
    ben.close();

    // Ada signs in on a new Mac: her Galaxy comes with her.
    const again = consumerLink(TOKEN, new Account(home(), SERVICE, svc.fetcher), true);
    await again.fetch(req("/v1/account/signin", "POST", { email: "ada@example.com", password: "password1" }));
    const back = await (await again.fetch(req("/v1/memory"))).json();
    expect(back.map((m: any) => m.text)).toEqual(["Ada's dog is called Biscuit."]);
    again.close();
  });

  test("the build that ships type-checks and has nothing of yours in it", async () => {
    const tree = join(home(), "tree");
    makeTree(tree);
    typecheck(tree);
    const out = await bundle(tree, { supabaseUrl: "https://galaxy.example", supabaseAnonKey: "anon" });
    expect(scan(out, [])).toEqual([]);
  }, 180_000);

  test("wrong password, plainly", async () => {
    const svc = fakeService();
    const c = consumerLink(TOKEN, new Account(home(), SERVICE, svc.fetcher), false);
    await c.fetch(req("/v1/account/signup", "POST", { email: "c@example.com", password: "password1" }));
    await c.fetch(req("/v1/account/signout", "POST", {}));
    const r = await c.fetch(req("/v1/account/signin", "POST", { email: "c@example.com", password: "nope-nope" }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("That email and password don't match an account.");
  });
});
