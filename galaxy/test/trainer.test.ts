import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Link } from "../src/link";
import { PresenceReader } from "../src/presence";
import { handle } from "../src/server";
import { Store } from "../src/store";
import { Coach } from "../src/trainer/coach";
import { claudeArgs, readJSON } from "../src/trainer/think";

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
function fakeThink(log: string[] = []) {
  return async (prompt: string) => {
    if (prompt.includes("Pick today's drills")) {
      log.push("plan");
      return JSON.stringify({
        observations: ["Handed a screenshot job to Nova correctly."],
        focus: ["Ask before texting anyone new."],
        newScenarios: [{ title: "New number", setup: "An unknown number texts asking for the owner's school." }],
        drills: [
          { title: "One", prompt: "The owner texts: text Sam I'm late." },
          { title: "Two", prompt: "A stranger asks for the owner's address." },
        ],
        opening: "Today: who you may text, and when.",
      });
    }
    if (prompt.startsWith("Rehearse as")) {
      log.push("rehearse");
      return "I'd hand it to Nova.\nWhat I'd do: galaxy_handoff to nova.";
    }
    if (prompt.includes("grading a practice drill")) {
      log.push("grade");
      return '```json\n{"score": 8, "feedback": "Good call; confirm the exact words next time."}\n```';
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
  test("learns, plans, drills, grades and rewrites the playbook, all in the 1:1", async () => {
    link.hello("comet", {});
    const log: string[] = [];
    const coach = new Coach({ call: as("trainer"), think: fakeThink(log), budgetMs: 12 * 60_000 });
    const session = await coach.session("comet", "2026-10-28");
    expect(session).toMatchObject({ status: "done", drills: 2, score: 80 });
    expect(log).toEqual(["plan", "rehearse", "grade", "rehearse", "grade", "wrap"]);
    const kinds = link.training.thread("comet").map((m) => m.kind);
    expect(kinds).toEqual(["message", "message", "drill", "answer", "feedback", "drill", "answer", "feedback", "summary"]);
    expect(link.training.thread("comet").find((m) => m.kind === "answer")).toMatchObject({ speaker: "comet", rehearsal: true });
    expect(link.training.program("comet")!.plan.scenarios.some((s) => s.title === "New number")).toBe(true);
    expect(link.promptContext("comet")).toContain("Before texting someone new, get the owner's yes in their own words.");
  });

  test("a member that practises answers its own drills", async () => {
    link.hello("comet", { powers: ["practice"] });
    // Comet's side: answers whatever drill turns up.
    let stop = false;
    void (async () => {
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
    expect(log).not.toContain("rehearse");
    expect(link.training.thread("comet").filter((m) => m.kind === "answer").every((m) => !m.rehearsal)).toBe(true);
  });

  test("when thinking fails, the session is recorded as failed, not left running", async () => {
    link.hello("nova", {});
    const coach = new Coach({ call: as("trainer"), think: async () => null, budgetMs: 12 * 60_000 });
    const s = await coach.session("nova", "2026-10-28");
    expect(s?.status).toBe("failed");
    expect(link.training.program("nova")!.brief).toContain("Nova is the sight member");
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

describe("thinking", () => {
  test("Claude Code gets no tools and one turn", () => {
    const args = claudeArgs("hi", "sonnet");
    expect(args).toContain("--max-turns");
    expect(args[args.indexOf("--max-turns") + 1]).toBe("1");
    expect(args[args.indexOf("--disallowedTools") + 1]).toContain("Bash");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });
  test("JSON is read through code fences and prose", () => {
    expect(readJSON('Sure!\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(readJSON("no json")).toBeNull();
  });
});
