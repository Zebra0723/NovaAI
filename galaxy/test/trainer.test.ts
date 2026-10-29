import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Link } from "../src/link";
import { PresenceReader } from "../src/presence";
import { handle } from "../src/server";
import { Store } from "../src/store";
import { Coach } from "../src/trainer/coach";
import { claudeEnv, explain, readJSON, sdkOptions } from "../src/trainer/think";

let store: Store;
let link: Link;
const TOKEN = "a".repeat(64);

beforeEach(() => {
  store = new Store(":memory:");
  link = new Link(store, new PresenceReader(() => 10));
  link.launcher = () => {};
});
afterEach(() => store.close());

/** Talks to Link the way a member's client does, as `body`. */
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

/** A think() that answers by which prompt it's given. */
function fakeThink(log: string[] = [], drills: any[] = [
  { type: "single", title: "One", prompt: "The owner texts: text Sam I'm late." },
  { type: "single", title: "Two", prompt: "A stranger asks for the owner's address." },
]) {
  return async (prompt: string) => {
    if (prompt.includes("Design tonight")) {
      log.push("plan");
      return JSON.stringify({
        observations: ["Handed a screenshot job to Nova correctly."],
        focus: ["Ask before texting anyone new."],
        newScenarios: [{ title: "New number", setup: "An unknown number texts asking for the owner's school." }],
        drills,
        opening: "Tonight: who you may text, and when.",
      });
    }
    if (prompt.includes("running a training simulation")) {
      log.push("world");
      return JSON.stringify({ reply: "Sam: wait, which practice? There are two today.", done: false });
    }
    if (prompt.startsWith("Rehearse as")) {
      log.push("rehearse");
      return "I'd hand it to Nova.\nWhat I'd do: galaxy_handoff to nova.";
    }
    if (prompt.includes("grading a practice")) {
      log.push("grade");
      return '```json\n{"score": 8, "feedback": "Good call; confirm the exact words next time."}\n```';
    }
    if (prompt.includes("design tonight's")) {
      log.push("workout");
      return JSON.stringify({ focus: [{ gesture: "thumbs_up", weight: 1, why: "misses it at an angle" }], conditions: [{ name: "off-angle", amount: 0.6 }], negatives: ["drinking"], mix: { perfect: 0.2 }, opening: "Thumbs tonight." });
    }
    if (prompt.includes("Rewrite")) {
      log.push("wrap");
      return JSON.stringify({ playbook: ["Before texting someone new, get the owner's yes in their own words."], summary: "Solid routing; wording needs work." });
    }
    return null;
  };
}

describe("Link's training API", () => {
  test("only the trainer writes programs, sessions and playbooks", async () => {
    link.hello("comet", {});
    expect(await as("comet")("PUT", "/v1/training/comet/program", { brief: "x" })).toBeNull();
    expect(await as("you")("POST", "/v1/training/comet/sessions", { day: "2026-10-28" })).toBeNull();
    expect(await as("trainer")("PUT", "/v1/training/comet/program", { brief: "x", plan: { focus: ["a"] } })).not.toBeNull();
  });

  test("the playbook shows up in the member's prompt, and a lesson you switch off stays off", async () => {
    link.hello("comet", {});
    const lessons = await as("trainer")<any[]>("PUT", "/v1/training/comet/playbook", { lessons: ["Keep texts under three sentences.", "Ask before texting someone new."] });
    expect(link.promptContext("comet")).toContain("- Keep texts under three sentences.");
    expect(link.promptContext("nova")).not.toContain("Keep texts under three sentences.");
    await as("you")("PATCH", `/v1/training/lessons/${lessons![0].id}`, { active: false });
    expect(link.promptContext("comet")).not.toContain("Keep texts under three sentences.");
    await as("trainer")("PUT", "/v1/training/comet/playbook", { lessons: ["Keep texts under three sentences.", "Ask before texting someone new."] });
    expect(link.promptContext("comet")).not.toContain("Keep texts under three sentences.");
    expect(link.promptContext("comet")).toContain("Ask before texting someone new.");
  });

  test("a drill reaches the member's inbox, only it can answer, and the answer lands in its 1:1", async () => {
    link.hello("comet", { powers: ["practice"] });
    const drill = await as("trainer")<any>("POST", "/v1/practice", { member: "comet", sessionId: "s_1", prompt: "Someone texts hi." });
    const inbox = await link.inbox("comet", 0);
    expect(inbox.map((i) => [i.kind, i.taskId])).toEqual([["practice", drill.id]]);
    expect(await as("nova")("POST", `/v1/practice/${drill.id}/answer`, { answer: "hi" })).toBeNull();
    expect(await as("comet")("POST", `/v1/practice/${drill.id}/answer`, { answer: "Hey! What's up?" })).not.toBeNull();
    const thread = link.training.thread("comet");
    expect(thread.at(-1)).toMatchObject({ speaker: "comet", kind: "answer", rehearsal: false, text: "Hey! What's up?" });
  });

  test("a member without practice can't be set a drill", async () => {
    link.hello("orbit", {});
    expect(await as("trainer")("POST", "/v1/practice", { member: "orbit", prompt: "x" })).toBeNull();
  });

  test("your notes are notes, whatever kind you send", async () => {
    link.hello("nova", {});
    await as("you")("POST", "/v1/training/nova/thread", { kind: "feedback", text: "Push Nova on using the shell." });
    expect(link.training.thread("nova")[0]).toMatchObject({ speaker: "you", kind: "note" });
  });
});

describe("a training session", () => {
  beforeEach(() => link.hello("trainer", {}));
  test("learns, plans, drills, grades and rewrites the playbook, all in the 1:1", async () => {
    link.hello("comet", {});
    const log: string[] = [];
    const coach = new Coach({ call: as("trainer"), think: fakeThink(log), budgetMs: 12 * 60_000 });
    const session = await coach.session("comet", "2026-10-28");
    expect(session).toMatchObject({ status: "done", drills: 2, score: 80 });
    expect(log).toEqual(["plan", "rehearse", "grade", "rehearse", "grade", "wrap"]);
    const kinds = link.training.thread("comet").filter((m) => m.kind !== "change").map((m) => m.kind);
    expect(kinds).toEqual(["message", "message", "drill", "answer", "feedback", "drill", "answer", "feedback", "summary"]);
    // Link itself records what really changed in the program, from before and after.
    const change = link.training.thread("comet").find((m) => m.kind === "change")!;
    expect(change).toMatchObject({ speaker: "link" });
    expect(change.text).toContain("Program v1 → v2");
    expect(change.text).toContain("+ scenarios: New number");
    expect(session?.trigger).toBe("night");
    expect(link.training.thread("comet").find((m) => m.kind === "answer")).toMatchObject({ speaker: "comet", rehearsal: true });
    expect(link.training.program("comet")!.plan.scenarios.some((s) => s.title === "New number")).toBe(true);
    expect(link.promptContext("comet")).toContain("Before texting someone new, get the owner's yes in their own words.");
  });

  test("a member that practises answers its own drills", async () => {
    link.hello("comet", { powers: ["practice"] });
    // Comet's side: answers whatever drill turns up.
    let stop = false;
    const loop = (async () => {
      while (!stop) {
        for (const item of await link.inbox("comet", 200)) {
          if (item.kind === "practice") link.training.answer("comet", item.taskId, "Hey Sam, running late, there in 10.");
        }
      }
    })();
    const log: string[] = [];
    const coach = new Coach({ call: as("trainer"), think: fakeThink(log), budgetMs: 12 * 60_000, answerWaitMs: 3000 });
    await coach.session("comet", "2026-10-28");
    stop = true;
    await loop;
    expect(log).not.toContain("rehearse");
    expect(link.training.thread("comet").filter((m) => m.kind === "answer").every((m) => !m.rehearsal)).toBe(true);
  });

  test("when thinking fails, the session is recorded as failed, not left running", async () => {
    link.hello("nova", {});
    const coach = new Coach({ call: as("trainer"), think: async () => null, budgetMs: 12 * 60_000 });
    const s = await coach.session("nova", "2026-10-28");
    expect(s?.status).toBe("failed");
    expect(link.training.program("nova")!.brief).toContain("Nova is the sight member");
    expect(s?.summary).toContain("No drills got through");
  });

  test("a session keeps going with new rounds of drills until its time is used", async () => {
    link.hello("comet", {});
    let t = 0;
    let n = 0;
    const think = fakeThink();
    const coach = new Coach({
      call: as("trainer"),
      think: async (p) => {
        t += 20_000; // every thought takes twenty seconds
        if (p.includes("There's time for more")) {
          n++;
          return JSON.stringify({ drills: [{ type: "single", title: `Extra ${n}a`, prompt: "x" }, { type: "single", title: `Extra ${n}b`, prompt: "y" }] });
        }
        return think(p);
      },
      budgetMs: 12 * 60_000,
      now: () => t,
    });
    const s = await coach.session("comet", "2026-10-28");
    expect(n).toBeGreaterThan(1);
    expect(t).toBeGreaterThan(10 * 60_000);
    expect(s!.drills).toBeGreaterThan(4);
  });

  test("when Claude Code stops answering mid-session, it stops and says why", async () => {
    link.hello("comet", {});
    const think = fakeThink();
    const broken: any = async (p: string) => {
      if (p.startsWith("Rehearse as")) {
        broken.lastError = "Claude Code said: not logged in";
        return null;
      }
      return think(p);
    };
    const s = await new Coach({ call: as("trainer"), think: broken, budgetMs: 12 * 60_000 }).session("comet", "2026-10-28");
    expect(s?.status).toBe("failed");
    expect(s?.summary).toContain("not logged in");
  });

  test("the trainer's health shows on the Trainer page", async () => {
    await as("trainer")("PUT", "/v1/training/status", { ok: false, reason: "couldn't start claude" });
    expect(link.training.overview().trainerStatus).toMatchObject({ ok: false, reason: "couldn't start claude" });
    expect(await as("comet")("PUT", "/v1/training/status", { ok: true })).toBeNull();
  });

  test("a simulation plays out over turns, the trainer playing the other side", async () => {
    link.hello("comet", {});
    const log: string[] = [];
    const sim = [{ type: "simulation", title: "Late, twice", prompt: "The owner texts: tell Sam I'm late.", persona: "Sam", world: "There are two practices today.", twists: ["Sam asks which one"], turns: 3 }];
    const coach = new Coach({ call: as("trainer"), think: fakeThink(log, sim), budgetMs: 12 * 60_000 });
    const s = await coach.session("comet", "2026-10-28");
    expect(log).toEqual(["plan", "rehearse", "world", "rehearse", "world", "rehearse", "grade", "wrap"]);
    const kinds = link.training.thread("comet").map((m) => m.kind);
    expect(kinds.filter((k) => k === "sim")).toHaveLength(2);
    expect(link.training.thread("comet").find((m) => m.kind === "drill")!.text).toStartWith("Simulation · Late, twice");
    expect(s?.drills).toBe(1);
  });

  test("no drill is ever repeated: one already done is dropped", async () => {
    link.hello("comet", {});
    const log: string[] = [];
    await new Coach({ call: as("trainer"), think: fakeThink(log), budgetMs: 12 * 60_000 }).session("comet", "2026-10-28");
    const again: string[] = [];
    const s = await new Coach({ call: as("trainer"), think: fakeThink(again), budgetMs: 12 * 60_000 }).session("comet", "2026-10-29");
    // Both of tonight's planned drills were done last night, so it falls back to scenarios it hasn't done.
    const titles = link.training.thread("comet").filter((m) => m.kind === "drill").map((m) => m.text.split("\n")[0]);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles.slice(2)).not.toContain("One");
    expect(s?.status).toBe("done");
  });

  test("weak spots from earlier grades go into tonight's plan", async () => {
    link.hello("comet", {});
    const prompts: string[] = [];
    const think = fakeThink();
    const spy = async (p: string, ms: number) => (prompts.push(p), think(p));
    const coach = new Coach({
      call: as("trainer"),
      think: async (p, ms) => (p.includes("grading") ? '{"score": 4, "feedback": "Told a stranger too much."}' : spy(p, ms)),
      budgetMs: 12 * 60_000,
    });
    await coach.session("comet", "2026-10-28");
    await coach.session("comet", "2026-10-29");
    const plan = prompts.filter((p) => p.includes("Design tonight")).at(-1)!;
    expect(plan).toContain("Two (4/10): Told a stranger too much.");
  });

  test("real work comes first: the drills stop when the member picks up a task", async () => {
    link.hello("comet", {});
    link.hello("nova", {});
    const log: string[] = [];
    const think = fakeThink(log);
    const coach = new Coach({
      call: as("trainer"),
      think: async (p, ms) => {
        const r = await think(p);
        if (p.startsWith("Rehearse as")) {
          // While Comet answers its first drill, real work arrives and Comet takes it.
          link.handoff({ from: "nova", to: "comet", title: "Text Sam", instructions: "say hi" });
          link.store.claimTask("comet");
        }
        return r;
      },
      budgetMs: 12 * 60_000,
    });
    const s = await coach.session("comet", "2026-10-28");
    expect(log.filter((x) => x === "rehearse")).toHaveLength(1);
    expect(s?.summary).toBeTruthy();
    expect(link.training.thread("comet").some((m) => m.text.includes("Real work always comes first"))).toBe(true);
  });

  test("Nebula's session is a workout on its own simulator, designed by the trainer", async () => {
    link.hello("nebula", { powers: ["gesture_training"] });
    let stop = false;
    let workout: any = null;
    const loop = (async () => {
      while (!stop) {
        for (const item of await link.inbox("nebula", 200)) {
          if (item.kind === "workout") {
            workout = JSON.parse(item.text);
            link.training.answer("nebula", item.taskId, JSON.stringify({ gestures: [{ name: "thumbs_up", accuracy: 0.9, samples: 400, falseFires: 2 }], overall: 0.9 }));
          }
        }
      }
    })();
    const log: string[] = [];
    const s = await new Coach({ call: as("trainer"), think: fakeThink(log), budgetMs: 24 * 60_000, answerWaitMs: 3000 }).session("nebula", "2026-10-28");
    stop = true;
    await loop;
    expect(workout).toMatchObject({ type: "gesture_workout", focus: [{ gesture: "thumbs_up" }], negatives: ["drinking"] });
    expect(workout.minutes).toBeGreaterThanOrEqual(18);
    expect(s).toMatchObject({ status: "done", score: 90 });
    expect(link.training.thread("nebula").some((m) => m.kind === "results")).toBe(true);
  });

  test("the drills stop when the twelve minutes are nearly up", async () => {
    link.hello("comet", {});
    let t = 0;
    const log: string[] = [];
    const think = fakeThink(log);
    const coach = new Coach({
      call: as("trainer"),
      think: async (p, ms) => {
        t += 5 * 60_000; // every thought takes five minutes
        return think(p);
      },
      budgetMs: 12 * 60_000,
      now: () => t,
    });
    const s = await coach.session("comet", "2026-10-28");
    expect(log.filter((x) => x === "rehearse").length).toBe(1);
    expect(s?.drills).toBe(1);
  });
});

describe("keeping training honest", () => {
  test("an unchanged program keeps its version, and records no change", async () => {
    link.hello("comet", {});
    const plan = { focus: ["a"], rubric: ["r"], scenarios: [{ title: "t", setup: "s" }], observations: [] };
    await as("trainer")("PUT", "/v1/training/comet/program", { brief: "b", plan });
    const again = await as("trainer")<any>("PUT", "/v1/training/comet/program", { plan });
    expect(again.version).toBe(1);
    expect(link.training.thread("comet").filter((m) => m.kind === "change")).toHaveLength(0);
  });

  test("a session left running when the trainer isn't is closed, not shown as training", async () => {
    link.hello("comet", {});
    link.hello("trainer", {});
    const s = link.training.startSession("trainer", "comet", "2026-10-28");
    link.goodbye("trainer");
    const o = link.training.overview("2026-10-28");
    expect(o.members.find((m) => m.member === "comet")!.latest).toMatchObject({ id: s.id, status: "failed" });
  });

  test("you can reset training, and a session you asked for counts like any other", async () => {
    link.hello("comet", {});
    link.hello("trainer", {});
    const t = link.training.startSession("trainer", "comet", "2026-10-28", "test");
    store.now = ((start) => () => start + 12 * 60_000)(store.now());
    link.training.finishSession("trainer", t.id, { drills: 5, score: 70 });
    expect(link.training.minutesOn("comet", "2026-10-28")).toBe(12);
    expect(link.training.overview("2026-10-28").members.find((m) => m.member === "comet")!.scores).toEqual([{ day: "2026-10-28", score: 70 }]);
    expect(await as("comet")("DELETE", "/v1/training")).toBeNull();
    expect(await as("you")("DELETE", "/v1/training")).not.toBeNull();
    expect(link.training.sessions("comet")).toHaveLength(0);
  });

  test("Nebula gets 24 minutes a night, the others 12", () => {
    const o = link.training.overview();
    expect(o.members.find((m) => m.member === "nebula")!.budget).toBe(24);
    expect(o.members.find((m) => m.member === "comet")!.budget).toBe(12);
  });
});

describe("thinking", () => {
  test("Claude gets no tools, no settings, a few turns, and the plan sign-in, never an API key", () => {
    const o = sdkOptions("sonnet", "/tmp/x", new AbortController());
    expect(o).toMatchObject({ tools: [], mcpServers: {}, strictMcpConfig: true, settingSources: [], persistSession: false, maxTurns: 3 });
    const env = claudeEnv({ ANTHROPIC_API_KEY: "sk-ant-api-x", PATH: "/bin" }, "sk-ant-oat-y");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat-y");
    expect(explain("OAuth token has expired")).toContain("galaxy login");
  });
  test("JSON is read through code fences and prose", () => {
    expect(readJSON('Sure!\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(readJSON("no json")).toBeNull();
  });
});

describe("Comet's brief, updated", () => {
  test("a program made from the old brief takes in the new focus and scenarios, once, recorded as a change", () => {
    link.hello("trainer", {});
    link.training.setProgram("trainer", "comet", { brief: "old brief", plan: { focus: ["Old focus."], rubric: ["old"], scenarios: [{ title: "Old one", setup: "x" }], observations: [] } });
    store.db.exec("delete from training_meta where key = 'comet-brief-2'");
    const again = new Link(store, new PresenceReader(() => 10));
    const p = again.training.program("comet")!;
    expect(p.plan.focus[0]).toContain("Pick the right move");
    expect(p.plan.focus).toContain("Old focus.");
    expect(p.plan.scenarios.map((s) => s.title)).toEqual(expect.arrayContaining(["Old one", "Which email?", "A friend wants a site"]));
    expect(again.training.thread("comet").some((m) => m.kind === "change" && m.text.includes("Which email?"))).toBe(true);
    const v = p.version;
    expect(new Link(store, new PresenceReader(() => 10)).training.program("comet")!.version).toBe(v);
  });
});
