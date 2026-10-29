import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Link } from "../src/link";
import { PresenceReader } from "../src/presence";
import { handle } from "../src/server";
import { Store } from "../src/store";
import { languageStage, tidyLesson } from "../src/teach";
import { languageGuide, lessonPrompt } from "../src/teach/tutor";
import { Tutor } from "../src/teach/tutor";

let store: Store;
let link: Link;
const TOKEN = "a".repeat(64);

beforeEach(() => {
  store = new Store(":memory:");
  link = new Link(store, new PresenceReader(() => 10));
  link.launcher = () => {};
});
afterEach(() => store.close());

const as =
  (body: string) =>
  async <T>(method: string, path: string, data?: unknown): Promise<T | null> => {
    const res = await handle(
      link,
      TOKEN,
      new Request("http://127.0.0.1:7740" + path, {
        method,
        body: data === undefined ? undefined : JSON.stringify(data),
        headers: { authorization: `Bearer ${TOKEN}`, "x-galaxy-body": body, host: "127.0.0.1:7740" },
      }),
    );
    return res.ok ? ((await res.json()) as T) : null;
  };

const LESSON = {
  title: "What launchctl kickstart does",
  minutes: 14,
  hook: "Medic does this to Comet ten times a week.",
  concepts: ["launchd agents"],
  sections: [
    { kind: "explain", title: "launchd is the Mac's babysitter", body: "Every background member is a launchd agent.", keyPoint: "Agents live in ~/Library/LaunchAgents.", check: { q: "Where do agents live?", choices: ["/tmp", "~/Library/LaunchAgents"], answer: 1, why: "That's the folder." } },
    { kind: "scenario", title: "Comet went quiet", story: "Comet stopped replying.", q: "What do you run?", choices: ["launchctl kickstart -k gui/$(id -u)/com.imessage.server", "rm -rf ~"], answer: 0, why: "Restart it.", keyPoint: "-k kills first." },
    { kind: "practice", title: "Restart galaxyd", task: "Type the command that restarts Galaxy Link.", hint: "Its label is ai.galaxy.link.", accept: ["^\\s*launchctl\\s+kickstart\\s+-k\\s+gui/\\S+/ai\\.galaxy\\.link\\s*$"], solution: "launchctl kickstart -k gui/$(id -u)/ai.galaxy.link", explain: "-k restarts it.", keyPoint: "Label after the domain." },
  ],
  quiz: [
    { q: "What does -k do?", choices: ["Kills it first", "Keeps it"], answer: 0, why: "", concept: "launchctl kickstart" },
    { q: "What's gui/501?", choices: ["Your login session", "A port"], answer: 0, why: "", concept: "launchd agents" },
    { q: "Who restarts crashed members?", choices: ["Medic", "Orbit"], answer: 0, why: "", concept: "launchd agents" },
  ],
  takeaways: ["launchctl kickstart -k gui/$(id -u)/LABEL restarts an agent."],
};

describe("Galaxy Teach", () => {
  test("what the watcher sees stays in memory and is gone once Teach reads it", async () => {
    await as("you")("POST", "/v1/teach/spots", { app: "Terminal", snippets: ["$ launchctl kickstart -k gui/501/ai.galaxy.link"] });
    expect(await as("nova")("GET", "/v1/teach/spots")).toBeNull(); // only Teach reads them
    const spots = await as("teach")<any[]>("GET", "/v1/teach/spots");
    expect(spots).toHaveLength(1);
    expect(await as("teach")<any[]>("GET", "/v1/teach/spots")).toEqual([]);
    // Nothing about them was written down.
    const tables = (store.db.query("select name from sqlite_master where type = 'table' and name like 'teach_%'").all() as any[]).map((r) => r.name);
    for (const t of tables) expect(JSON.stringify(store.db.query(`select * from ${t}`).all())).not.toContain("ai.galaxy.link");
  });

  test("an offer becomes a lesson on Begin; skipping twice means never again", async () => {
    const o = await as("teach")<any>("POST", "/v1/teach/offers", { topic: "launchctl kickstart", title: "What launchctl kickstart does", why: "You ran it twice", minutes: 15, app: "Terminal" });
    expect(o.status).toBe("offered");
    // The same topic isn't offered twice while one is waiting.
    expect(await as("teach")("POST", "/v1/teach/offers", { topic: "Launchctl Kickstart" })).toBeNull();
    const l = await as("you")<any>("POST", `/v1/teach/offers/${o.id}/begin`, {});
    expect(l).toMatchObject({ status: "writing", topic: "launchctl kickstart" });
    expect((await link.inbox("teach", 0)).map((i) => i.text)).toContain(`write:${l.id}`);

    for (let i = 0; i < 2; i++) {
      const s = await as("teach")<any>("POST", "/v1/teach/offers", { topic: "chmod" });
      await as("you")("POST", `/v1/teach/offers/${s.id}/skip`, {});
    }
    expect(await as("teach")("POST", "/v1/teach/offers", { topic: "chmod" })).toBeNull();
  });

  test("save for later: the lesson is written now and waits until you start it", async () => {
    const o = await as("teach")<any>("POST", "/v1/teach/offers", { topic: "lsof -i", title: "lsof -i", minutes: 12 });
    const l = await as("you")<any>("POST", `/v1/teach/offers/${o.id}/later`, {});
    expect(l).toMatchObject({ status: "writing", saved: true });
    expect((await link.inbox("teach", 0)).map((i) => i.text)).toContain(`write:${l.id}`);
    expect((await as("you")<any>("GET", "/v1/teach/offers")).offers).toHaveLength(0);
    expect(await as("teach")("POST", "/v1/teach/offers", { topic: "lsof -i" })).toBeNull(); // not offered again while saved
    await as("teach")("PUT", `/v1/teach/lessons/${l.id}/content`, { content: LESSON });
    expect((await as("you")<any>("GET", `/v1/teach/lessons/${l.id}`)).saved).toBe(true);
    // Starting it takes it out of Saved for later.
    await as("you")("PUT", `/v1/teach/lessons/${l.id}/progress`, { position: 1 });
    expect((await as("you")<any>("GET", `/v1/teach/lessons/${l.id}`)).saved).toBe(false);
    // And you can save any lesson for later yourself, including one you asked for.
    const asked = await as("you")<any>("POST", "/v1/teach/lessons", { request: "ports", later: true });
    expect(asked.saved).toBe(true);
    expect((await as("you")<any>("PUT", `/v1/teach/lessons/${asked.id}/saved`, { saved: false })).saved).toBe(false);
  });

  test("plain words at first, then it builds on what you've learnt, and steps back if quizzes go badly", async () => {
    expect(languageStage(0, null)).toBe(1);
    expect(languageStage(3, 80)).toBe(2);
    expect(languageStage(9, 90)).toBe(3);
    expect(languageStage(9, 40)).toBe(2);
    expect(languageGuide(1)).toContain("No jargon");

    // The first lesson's prompt says to assume nothing.
    const first = await as("you")<any>("POST", "/v1/teach/lessons", { request: "ports" });
    const ctx0 = await as("teach")<any>("GET", "/v1/teach/context");
    expect(ctx0.stage).toBe(1);
    expect(lessonPrompt(first, ctx0)).toContain("assume no background at all");

    // Finish three lessons and the next one is told what they learnt, and may build on it.
    for (const topic of ["ports", "chmod", "git pull"]) {
      const l = await as("you")<any>("POST", "/v1/teach/lessons", { request: topic });
      await as("teach")("PUT", `/v1/teach/lessons/${l.id}/content`, { content: { ...LESSON, title: `Lesson on ${topic}` } });
      await as("you")("POST", `/v1/teach/lessons/${l.id}/finish`, { answers: { q0: 0, q1: 0, q2: 0 } });
    }
    const ctx = await as("teach")<any>("GET", "/v1/teach/context");
    expect(ctx.stage).toBe(2);
    const prompt = lessonPrompt({ ...first, title: "lsof -i" }, ctx);
    expect(prompt).toContain('"Lesson on chmod"');
    expect(prompt).toContain("launchctl kickstart -k gui/$(id -u)/LABEL restarts an agent.");

    // It can only claim to build on lessons that were really finished.
    const next = await as("you")<any>("POST", "/v1/teach/lessons", { request: "lsof -i" });
    const written = await as("teach")<any>("PUT", `/v1/teach/lessons/${next.id}/content`, { content: { ...LESSON, buildsOn: ["Lesson on ports", "A lesson that never happened"] } });
    expect(written.content.buildsOn).toEqual(["Lesson on ports"]);
  });

  test("a lesson must hold together to be accepted", () => {
    expect(tidyLesson({ title: "x", sections: [], quiz: [] })).toBeNull();
    const t = tidyLesson({ ...LESSON, quiz: [...LESSON.quiz, { q: "bad", choices: ["a"], answer: 3 }] })!;
    expect(t.quiz).toHaveLength(3);
    expect(t.sections.map((s) => s.kind)).toEqual(["explain", "scenario", "practice"]);
  });

  test("progress is kept, and finishing the quiz updates what you know and saves the takeaways", async () => {
    const l = await as("you")<any>("POST", "/v1/teach/lessons", { request: "launchctl kickstart" });
    expect(await as("teach")("PUT", `/v1/teach/lessons/${l.id}/content`, { content: LESSON })).not.toBeNull();
    await as("you")("PUT", `/v1/teach/lessons/${l.id}/progress`, { position: 2, answers: { s0: 1, s1: 0 } });
    expect((await as("you")<any>("GET", `/v1/teach/lessons/${l.id}`)).position).toBe(2);
    const done = await as("you")<any>("POST", `/v1/teach/lessons/${l.id}/finish`, { answers: { q0: 0, q1: 0, q2: 1 } });
    expect(done).toMatchObject({ status: "done", score: 67 });
    const o = await as("you")<any>("GET", "/v1/teach");
    expect(o.topics.find((t: any) => t.key === "launchctl kickstart").level).toBe("shaky");
    expect(o.notes.map((n: any) => n.text)).toContain("launchctl kickstart -k gui/$(id -u)/LABEL restarts an agent.");
    expect(o.stats).toMatchObject({ finished: 1, streak: 1 });
  });

  test("the tutor offers, writes and checks through Claude", async () => {
    link.hello("teach", {});
    const prompts: string[] = [];
    const think = Object.assign(
      async (p: string) => {
        prompts.push(p);
        if (p.includes("Pick AT MOST TWO")) return JSON.stringify({ offers: [{ topic: "launchctl kickstart", title: "What launchctl kickstart does", why: "You ran it twice", minutes: 15 }] });
        if (p.includes("Write a lesson")) return "Here it is:\n" + JSON.stringify(LESSON);
        if (p.includes("checking a hands-on step")) return '{"ok": true, "feedback": "Spot on."}';
        if (p.includes("how this learner learns")) return '{"style": "Likes scenarios first."}';
        return null;
      },
      { lastError: undefined as string | undefined },
    );
    const tutor = new Tutor({ call: as("teach"), think });
    expect(await tutor.offersFrom([{ app: "Terminal", snippets: ["launchctl kickstart -k gui/501/ai.galaxy.link"], at: 0 }])).toBe(1);
    const offer = (await as("you")<any>("GET", "/v1/teach/offers")).offers[0];
    const l = await as("you")<any>("POST", `/v1/teach/offers/${offer.id}/begin`, {});
    expect(await tutor.write(l.id)).toBe(true);
    const ready = await as("you")<any>("GET", `/v1/teach/lessons/${l.id}`);
    expect(ready.status).toBe("ready");
    const c = await as("you")<any>("POST", `/v1/teach/lessons/${l.id}/checks`, { section: 2, answer: "launchctl kickstart -k gui/501/ai.galaxy.link" });
    expect(await tutor.check(c.id)).toBe(true);
    expect(await as("you")<any>("GET", `/v1/teach/checks/${c.id}`)).toMatchObject({ status: "done", ok: true, feedback: "Spot on." });
    await as("you")("POST", `/v1/teach/lessons/${l.id}/finish`, { answers: { q0: 0, q1: 0, q2: 0 } });
    expect(await tutor.learnFrom(l.id)).toBe(true);
    expect((await as("you")<any>("GET", "/v1/teach")).style.text).toBe("Likes scenarios first.");
    // The lesson prompt knew the learner and was told to set things in GalaxyAI.
    expect(prompts.find((p) => p.includes("Write a lesson"))).toContain("GalaxyAI");
  });

  test("a lesson that won't come out right is marked failed, and can be retried", async () => {
    const think = Object.assign(async () => '{"title": "nope"}', { lastError: undefined as string | undefined });
    const l = await as("you")<any>("POST", "/v1/teach/lessons", { request: "ports" });
    expect(await new Tutor({ call: as("teach"), think }).write(l.id)).toBe(false);
    expect((await as("you")<any>("GET", `/v1/teach/lessons/${l.id}`)).status).toBe("failed");
    expect((await as("you")<any>("POST", `/v1/teach/lessons/${l.id}/retry`, {})).status).toBe("writing");
  });
});
