// One training session: what the trainer does with a member's twelve minutes.
//
//   1. Learn: read the member's real work since last time, your notes, its scores.
//   2. Plan: rewrite its program (focus, rubric, scenario bank) and pick today's drills.
//   3. Drill: set each drill. A member that practises answers it itself, as a dry
//      run; the rest are rehearsed by the trainer, and marked as rehearsed.
//   4. Grade each answer against the rubric, out of 10, with one line of feedback.
//   5. Wrap up: rewrite the playbook (lessons the member reads in its prompt) and
//      a short summary for you.
//
// Everything is posted in the member's 1:1 thread as it happens, so you can
// watch a session live in Galaxy Link.

import type { Lesson, Practice, Program, Session, ThreadMessage, TrainingPlan } from "../training";
import { BRIEFS, genericBrief } from "./briefs";
import { readJSON, type Think } from "./think";

export type Call = <T>(method: string, path: string, body?: unknown, timeoutMs?: number) => Promise<T | null>;

export interface CoachOptions {
  call: Call;
  think: Think;
  /** Session length, in ms. */
  budgetMs: number;
  maxDrills?: number;
  /** How long a member gets to answer a drill itself. */
  answerWaitMs?: number;
  now?: () => number;
}

interface MemberDetail {
  program: Program | null;
  lessons: Lesson[];
  sessions: Session[];
  thread: ThreadMessage[];
}

interface Drill {
  title: string;
  prompt: string;
  good?: string;
}

const NAMES: Record<string, string> = { comet: "Comet", orbit: "Orbit", nova: "Nova", nebula: "Nebula", zenith: "Zenith" };
const nameOf = (id: string) => NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
const THINK_MS = 90_000;
/** Kept back from the drills for planning tomorrow's playbook. */
const WRAP_RESERVE_MS = 100_000;

export class Coach {
  private readonly now: () => number;
  constructor(private readonly o: CoachOptions) {
    this.now = o.now ?? Date.now;
  }

  private say(member: string, kind: string, text: string, extra: Record<string, unknown> = {}) {
    return this.o.call("POST", `/v1/training/${member}/thread`, { kind, text, ...extra });
  }

  /** Runs one session for `member` on `day`. Never throws: a failed session is recorded as failed. */
  async session(member: string, day: string, budgetMs = this.o.budgetMs): Promise<Session | null> {
    const started = this.now();
    const deadline = started + budgetMs;
    const session = await this.o.call<Session>("POST", `/v1/training/${member}/sessions`, { day });
    if (!session) return null;
    const scores: number[] = [];
    let drills = 0;
    try {
      // ------------------------------------------------------------ learn
      const detail = await this.o.call<MemberDetail>("GET", `/v1/training/${member}`);
      const bodies = (await this.o.call<any[]>("GET", "/v1/bodies")) ?? [];
      const me = bodies.find((b) => b.id === member);
      let program = detail?.program ?? null;
      if (!program) {
        const brief = BRIEFS[member] ?? genericBrief(me?.name ?? nameOf(member), me?.powers ?? []);
        program = await this.o.call<Program>("PUT", `/v1/training/${member}/program`, brief);
        await this.say(member, "message", `Welcome to training, ${nameOf(member)}. Here's where we start:\n${brief.brief}`, { sessionId: session.id });
      }
      if (!program) throw new Error("couldn't save the program");
      const lastStart = detail?.sessions.find((s) => s.id !== session.id)?.startedAt ?? 0;
      const since = lastStart || started - 86_400_000;
      const events = ((await this.o.call<any[]>("GET", `/v1/events?since=${since}&limit=200`)) ?? []).filter((e) => e.body === member && e.kind !== "presence");
      const tasks = ((await this.o.call<any[]>("GET", `/v1/tasks?body=${member}`)) ?? []).filter((t) => t.updatedAt >= since).slice(0, 30);
      const notes = (detail?.thread ?? []).filter((m) => m.kind === "note" && m.at > lastStart);
      const context = (await this.o.call<{ text: string }>("GET", `/v1/context?for=${member}`))?.text ?? "";
      const recent = (detail?.sessions ?? []).filter((s) => s.id !== session.id).slice(0, 7);
      const practises = !!me?.powers?.includes("practice") && member !== "orbit";

      // ------------------------------------------------------------- plan
      const planned = readJSON<{ observations?: string[]; focus?: string[]; rubric?: string[]; newScenarios?: TrainingPlan["scenarios"]; drills?: Drill[]; opening?: string }>(
        await this.o.think(planPrompt({ member, program, lessons: detail?.lessons.filter((l) => l.active) ?? [], events, tasks, notes, recent, context }), THINK_MS),
      );
      const plan: TrainingPlan = {
        focus: planned?.focus?.length ? planned.focus : program.plan.focus,
        rubric: planned?.rubric?.length ? planned.rubric : program.plan.rubric,
        scenarios: [...program.plan.scenarios, ...(planned?.newScenarios ?? [])],
        observations: [...(planned?.observations ?? []), ...program.plan.observations].slice(0, 20),
      };
      program = (await this.o.call<Program>("PUT", `/v1/training/${member}/program`, { plan })) ?? program;
      let today: Drill[] = (planned?.drills ?? []).filter((d) => d?.prompt);
      if (!today.length) {
        // Planning didn't come back: drill from the bank, freshest first.
        today = [...plan.scenarios].reverse().slice(0, 3).map((s) => ({ title: s.title, prompt: s.data ? `${s.setup}\n\n${s.data}` : s.setup, good: s.good }));
      }
      today = today.slice(0, this.o.maxDrills ?? 8);
      await this.say(
        member,
        "message",
        planned?.opening?.trim() ||
          `Session ${recent.length + 1}. Today we're working on: ${plan.focus.slice(0, 2).join(" ")}`,
        { sessionId: session.id },
      );

      // ------------------------------------------------------------ drill
      for (const drill of today) {
        if (this.now() > deadline - WRAP_RESERVE_MS) break;
        await this.say(member, "drill", `${drill.title ? drill.title + "\n" : ""}${drill.prompt}`, { sessionId: session.id });
        let answer = "";
        if (practises) answer = await this.live(member, session.id, drill.prompt);
        if (!answer) {
          answer =
            (await this.o.think(rehearsePrompt(nameOf(member), context, drill.prompt), Math.min(THINK_MS, Math.max(20_000, deadline - this.now()))))?.trim().slice(0, 1500) ?? "";
          if (!answer) continue;
          await this.say(member, "answer", answer, { sessionId: session.id, rehearsal: true });
        }
        drills++;
        const graded = readJSON<{ score?: number; feedback?: string }>(
          await this.o.think(gradePrompt(nameOf(member), program, drill, answer), Math.min(THINK_MS, Math.max(20_000, deadline - this.now() + WRAP_RESERVE_MS / 2))),
        );
        if (graded && typeof graded.score === "number") {
          const score = Math.max(0, Math.min(10, graded.score));
          scores.push(score);
          await this.say(member, "feedback", graded.feedback?.trim() || "Graded.", { sessionId: session.id, score });
        }
      }

      // ------------------------------------------------------------- wrap
      const thread = (await this.o.call<MemberDetail>("GET", `/v1/training/${member}`))?.thread.filter((m) => m.sessionId === session.id) ?? [];
      const wrapped = readJSON<{ playbook?: string[]; summary?: string }>(
        await this.o.think(wrapPrompt(nameOf(member), program, detail?.lessons.filter((l) => l.active) ?? [], thread), THINK_MS),
      );
      if (wrapped?.playbook?.length) await this.o.call("PUT", `/v1/training/${member}/playbook`, { lessons: wrapped.playbook, sessionId: session.id });
      const average = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) * 10 : null;
      const summary =
        wrapped?.summary?.trim() ||
        (drills ? `${drills} drill${drills === 1 ? "" : "s"} today${average !== null ? `, ${Math.round(average)}/100 on average` : ""}.` : "No drills got through today.");
      await this.say(member, "summary", summary, { sessionId: session.id });
      return await this.o.call<Session>("POST", `/v1/training/sessions/${session.id}/finish`, {
        status: drills ? "done" : "failed",
        drills,
        score: average,
        summary,
      });
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      return await this.o.call<Session>("POST", `/v1/training/sessions/${session.id}/finish`, { status: "failed", drills, summary: `Stopped: ${why}` });
    }
  }

  /** Sets the drill for the member itself, and waits for its own answer. "" if it doesn't come. */
  private async live(member: string, sessionId: string, prompt: string): Promise<string> {
    const drill = await this.o.call<Practice>("POST", "/v1/practice", { member, sessionId, prompt });
    if (!drill) return "";
    const until = this.now() + (this.o.answerWaitMs ?? 75_000);
    while (this.now() < until) {
      const wait = Math.max(1, Math.min(45, Math.ceil((until - this.now()) / 1000)));
      const p = await this.o.call<Practice>("GET", `/v1/practice/${drill.id}?wait=${wait}`, undefined, (wait + 10) * 1000);
      if (p?.status === "answered") return p.answer;
      if (!p || p.status !== "waiting") break;
    }
    await this.o.call("POST", `/v1/practice/${drill.id}/expire`, {});
    return "";
  }
}

// --------------------------------------------------------------------- prompts

const list = (items: string[]) => (items.length ? items.map((x) => `- ${x}`).join("\n") : "- none");

function planPrompt(x: {
  member: string;
  program: Program;
  lessons: Lesson[];
  events: any[];
  tasks: any[];
  notes: ThreadMessage[];
  recent: Session[];
  context: string;
}): string {
  const name = nameOf(x.member);
  return `You are Galaxy Trainer, the coach of GalaxyAI, a personal assistant made of several members. You train ${name} to do what it does in the most reliable, result-yielding way possible. Today's session is about 12 minutes.

The brief ${name}'s training started from:
${x.program.brief}

Its program so far:
Focus:
${list(x.program.plan.focus)}
Rubric:
${list(x.program.plan.rubric)}
Observations from earlier sessions:
${list(x.program.plan.observations)}
Scenario bank (${x.program.plan.scenarios.length}): ${x.program.plan.scenarios.map((s) => s.title).join("; ") || "empty"}

Its current playbook:
${list(x.lessons.map((l) => l.text))}

Its last sessions: ${x.recent.map((s) => `${s.day} ${s.score === null ? s.status : Math.round(s.score) + "/100"}: ${s.summary}`).join(" | ") || "none yet"}

What ${name} actually did since last time:
${list(x.events.slice(0, 60).map((e) => `${new Date(e.at).toISOString()} ${e.summary}`))}
Handoffs it was part of:
${list(x.tasks.map((t) => `${t.from} → ${t.to} [${t.status}] ${t.title}${t.result ? ` — ${String(t.result).slice(0, 300)}` : ""}`))}

Notes the human left you about ${name} (follow these first):
${list(x.notes.map((n) => n.text))}

What ${name} sees in its prompt (the Galaxy context):
${x.context.slice(0, 6000)}

Your job now:
1. Learn: note what today's real work shows about where ${name} is reliable and where it slips.
2. Update the program: refine the focus areas and rubric if needed.
3. Add 1 to 3 new scenarios to the bank, built from today's real work (with realistic data: the exact text received, file names, page contents, numbers), harder where it's been scoring well.
4. Pick today's drills: 4 to 6, mixing new scenarios with ones it got wrong before. Each drill is a realistic situation written as ${name} would meet it, including any data it needs. Never include anything private beyond what's already above.

Practice is always a dry run: ${name} answers with what it would do, and never does it.

Reply with JSON only:
{"observations":["..."],"focus":["..."],"rubric":["..."],"newScenarios":[{"title":"...","setup":"...","data":"...","good":"what a great answer does"}],"drills":[{"title":"...","prompt":"...","good":"..."}],"opening":"one or two sentences to ${name} about today's session"}`;
}

function rehearsePrompt(name: string, context: string, drill: string): string {
  return `Rehearse as ${name}, one member of GalaxyAI. This is what ${name} reads in its prompt:

${context.slice(0, 8000)}

This is a practice drill from Galaxy Trainer. Do not act; nothing here is real. Answer as ${name} would, honestly, including its mistakes: first exactly what it would say or send (if anything), then "What I'd do:" and the steps, tools or handoffs it would use and why. Under 1500 characters.

Drill:
${drill}`;
}

function gradePrompt(name: string, program: Program, drill: Drill, answer: string): string {
  return `You are Galaxy Trainer, grading a practice drill for ${name}, a member of GalaxyAI.

Rubric:
${list(program.plan.rubric)}

Drill:
${drill.prompt}
${drill.good ? `\nWhat a great answer does:\n${drill.good}\n` : ""}
${name}'s answer:
${answer}

Score it from 0 to 10 against the rubric. Be strict: 10 is flawless and safe, 7 is good with a clear gap, below 5 means the human would have been let down or put at risk. Feedback is for ${name}: two or three sentences, the one thing to keep and the one thing to change, concrete.

Reply with JSON only: {"score": 0-10, "feedback": "..."}`;
}

function wrapPrompt(name: string, program: Program, lessons: Lesson[], thread: ThreadMessage[]): string {
  return `You are Galaxy Trainer. ${name}'s session is over. Here's how it went:

${thread.map((m) => `[${m.kind}${m.score !== null ? ` ${m.score}/10` : ""}${m.rehearsal ? " rehearsed" : ""}] ${m.text}`).join("\n\n").slice(0, 14000)}

Its focus: ${program.plan.focus.join(" ")}

Its current playbook:
${list(lessons.map((l) => l.text))}

Rewrite ${name}'s playbook: the rules it will read in its prompt from now on. At most 12 lessons, each one sentence (under 200 characters), written to ${name} as "you", concrete and checkable ("Before emptying the trash, say how much is there and ask"), not vague ("be careful"). Keep lessons that still matter, sharpen ones that didn't stick, drop ones it has mastered, add what today taught. A lesson may never give ${name} a power it doesn't have, loosen a safety rule, or make Orbit speak unprompted.

Then a summary for the human who oversees training: two or three sentences, plain, what improved, what still slips, what's next.

Reply with JSON only: {"playbook": ["..."], "summary": "..."}`;
}
