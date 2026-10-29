// One training session: what the trainer does with a member's time.
//
//   1. Learn: what the member really did since last time, your notes, its scores,
//      and above all where it has been weakest.
//   2. Plan: rewrite its program and design tonight's drills, new every time and
//      aimed at those weak spots. Most are simulations: a real-world situation that
//      plays out over several turns, with the trainer playing the other side (the
//      person texting, the Mac's screen, the mission's website) and its twists.
//   3. Drill: the member answers each turn itself if it practises (a dry run, never
//      acted on); otherwise the trainer rehearses it, and marks it as rehearsed.
//   4. Grade each drill out of 10 against the member's rubric.
//   5. Wrap up: rewrite the playbook (lessons the member reads in its prompt) and a
//      summary for you.
//
// Nebula is different: its skill is reading hands, so its session is a workout on
// Nebula's own simulator, designed by the trainer around the gestures and conditions
// it gets wrong (see TRAINER_NEBULA.md).
//
// A session never runs over real work: if the member picks up a task, the drills
// stop and the session wraps up with what it has.

import type { Lesson, Practice, Program, Session, ThreadMessage, TrainingPlan } from "../training";
import { BRIEFS, genericBrief } from "./briefs";
import { readJSON, type Think } from "./think";

export type Call = <T>(method: string, path: string, body?: unknown, timeoutMs?: number) => Promise<T | null>;

export interface CoachOptions {
  call: Call;
  think: Think;
  /** Default session length, in ms. */
  budgetMs?: number;
  maxDrills?: number;
  /** How long a member gets to answer a turn itself. */
  answerWaitMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface SessionOptions {
  budgetMs?: number;
  trigger?: "night" | "test";
}

interface MemberDetail {
  program: Program | null;
  lessons: Lesson[];
  sessions: Session[];
  thread: ThreadMessage[];
}

interface Drill {
  type?: "single" | "simulation";
  title: string;
  /** What the member is told at the start. */
  prompt: string;
  good?: string;
  /** Simulations: what's true in the simulated world that the member doesn't see yet. */
  world?: string;
  /** Simulations: who the trainer plays. */
  persona?: string;
  /** Simulations: what goes wrong or changes along the way. */
  twists?: string[];
  /** Simulations: how many times the member answers, at most. */
  turns?: number;
}

interface Turn {
  who: "world" | "member";
  text: string;
}

// #owner
const NAMES: Record<string, string> = { comet: "Comet", orbit: "Orbit", nova: "Nova", nebula: "Nebula", zenith: "Zenith" };
// #consumer const NAMES: Record<string, string> = { orbit: "Orbit", nova: "Nova", nebula: "Nebula", zenith: "Zenith" };
// #end
const nameOf = (id: string) => NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
const THINK_MS = 180_000;
const SHORT_THINK_MS = 120_000;
/** Kept back from the drills for the playbook and summary. */
const WRAP_RESERVE_MS = 90_000;
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** You stopped or removed the session from Link: it ends there, with nothing more written. */
class StoppedByYou extends Error {}

/** How often a paused session looks to see whether you've resumed it. */
const PAUSE_POLL_MS = 5000;

export class Coach {
  private readonly now: () => number;
  constructor(private readonly o: CoachOptions) {
    this.now = o.now ?? Date.now;
  }

  private say(member: string, kind: string, text: string, extra: Record<string, unknown> = {}) {
    return this.o.call("POST", `/v1/training/${member}/thread`, { kind, text, ...extra });
  }

  /** One retry: a single hiccup from Claude Code shouldn't cost a drill or end a session early. */
  private async think(prompt: string, ms: number): Promise<string | null> {
    return (await this.o.think(prompt, Math.max(30_000, ms))) ?? (await this.o.think(prompt, Math.max(30_000, ms)));
  }

  /**
   * Between drills and turns: if you paused the session, wait here until you resume it
   * (the paused time is added back to the deadline); if you stopped it, end now.
   */
  private async checkpoint(ctx: Ctx) {
    let s = await this.o.call<Session>("GET", `/v1/training/sessions/${ctx.sid}`);
    if (s && s.status !== "running") throw new StoppedByYou();
    if (!s?.pausedAt) return;
    const from = this.now();
    await this.say(ctx.member, "message", "Paused. I'll pick up from here when you resume.", { sessionId: ctx.sid }).catch(() => null);
    while (s?.pausedAt) {
      await (this.o.sleep ?? sleep)(PAUSE_POLL_MS);
      s = await this.o.call<Session>("GET", `/v1/training/sessions/${ctx.sid}`);
      if (!s || s.status !== "running") throw new StoppedByYou();
    }
    ctx.deadline += this.now() - from;
  }

  /** Whether the member is in the middle of real work. Training never runs over it. */
  async busy(member: string): Promise<boolean> {
    const claimed = (await this.o.call<any[]>("GET", "/v1/tasks?status=claimed")) ?? [];
    return claimed.some((t) => t.to === member);
  }

  /** Runs one session for `member` on `day`. Never throws: a session that goes wrong is recorded as failed, with why. */
  async session(member: string, day: string, opts: SessionOptions = {}): Promise<Session | null> {
    const started = this.now();
    const budgetMs = opts.budgetMs ?? this.o.budgetMs ?? 12 * 60_000;
    const deadline = started + budgetMs;
    const session = await this.o.call<Session>("POST", `/v1/training/${member}/sessions`, { day, trigger: opts.trigger ?? "night" });
    if (!session) return null;
    const sid = session.id;
    const ctx: Ctx = { member, sid, deadline, scores: [], drills: 0, stopped: "" };
    try {
      const learnt = await this.learn(member, sid, started);
      if (member === "nebula" && learnt.me?.powers?.includes("gesture_training")) {
        await this.nebulaWorkout(ctx, learnt);
      } else {
        await this.drillSession(ctx, learnt);
      }
      return await this.wrap(ctx, learnt);
    } catch (error) {
      if (error instanceof StoppedByYou) return await this.o.call<Session>("GET", `/v1/training/sessions/${sid}`);
      const why = error instanceof Error ? error.message : String(error);
      await this.say(member, "message", `This session stopped: ${why}`, { sessionId: sid });
      return await this.o.call<Session>("POST", `/v1/training/sessions/${sid}/finish`, { status: "failed", drills: ctx.drills, summary: `Stopped: ${why}` });
    }
  }

  // ------------------------------------------------------------------ learn

  private async learn(member: string, sid: string, started: number): Promise<Learnt> {
    const detail = await this.o.call<MemberDetail>("GET", `/v1/training/${member}`);
    const bodies = (await this.o.call<any[]>("GET", "/v1/bodies")) ?? [];
    const me = bodies.find((b) => b.id === member);
    let program = detail?.program ?? null;
    if (!program) {
      const brief = BRIEFS[member] ?? genericBrief(me?.name ?? nameOf(member), me?.powers ?? []);
      program = await this.o.call<Program>("PUT", `/v1/training/${member}/program`, brief);
      await this.say(member, "message", `Welcome to training, ${nameOf(member)}. Here's where we start:\n${brief.brief}`, { sessionId: sid });
    }
    if (!program) throw new Error("Link wouldn't save the program");
    const earlier = (detail?.sessions ?? []).filter((s) => s.id !== sid);
    const since = earlier[0]?.startedAt || started - 86_400_000;
    const events = ((await this.o.call<any[]>("GET", `/v1/events?since=${since}&limit=200`)) ?? []).filter((e) => e.body === member && e.kind !== "presence");
    const tasks = ((await this.o.call<any[]>("GET", `/v1/tasks?body=${member}`)) ?? []).filter((t) => t.updatedAt >= since).slice(0, 30);
    const thread = detail?.thread ?? [];
    const notes = thread.filter((m) => m.kind === "note" && m.at > (earlier[0]?.startedAt ?? 0));
    const context = (await this.o.call<{ text: string }>("GET", `/v1/context?for=${member}`))?.text ?? "";
    return {
      me,
      program,
      lessons: (detail?.lessons ?? []).filter((l) => l.active),
      events,
      tasks,
      notes,
      context,
      recent: earlier.slice(0, 7),
      weak: weakSpots(thread),
      past: pastDrills(thread),
      results: thread.filter((m) => m.kind === "results").slice(-5).map((m) => m.text),
    };
  }

  // ------------------------------------------------------------- drill days

  private async drillSession(ctx: Ctx, l: Learnt) {
    const { member, sid } = ctx;
    const practises = !!l.me?.powers?.includes("practice") && member !== "orbit";
    const planned = readJSON<{ observations?: string[]; focus?: string[]; rubric?: string[]; newScenarios?: TrainingPlan["scenarios"]; drills?: Drill[]; opening?: string }>(
      await this.think(planPrompt(member, l), THINK_MS),
    );
    if (!planned) await this.say(member, "message", `I couldn't plan tonight's drills (${this.o.think.lastError ?? "no answer"}), so we're working from the scenario bank.`, { sessionId: sid });
    const plan: TrainingPlan = {
      focus: planned?.focus?.length ? planned.focus : l.program.plan.focus,
      rubric: planned?.rubric?.length ? planned.rubric : l.program.plan.rubric,
      scenarios: [...l.program.plan.scenarios, ...(planned?.newScenarios ?? [])],
      observations: [...(planned?.observations ?? []), ...l.program.plan.observations].slice(0, 20),
    };
    await this.checkpoint(ctx);
    l.program = (await this.o.call<Program>("PUT", `/v1/training/${member}/program`, { plan })) ?? l.program;

    // Never the same drill twice: anything already done is dropped.
    const seen = new Set(l.past.map(key));
    const fresh = (title: string) => !seen.has(key(title)) && !!seen.add(key(title));
    let drills: Drill[] = (planned?.drills ?? []).filter((d) => d?.prompt && d?.title && fresh(d.title));
    if (!drills.length) {
      drills = [...plan.scenarios]
        .reverse()
        .filter((s) => fresh(s.title))
        .slice(0, 3)
        .map((s) => ({ title: s.title, prompt: s.data ? `${s.setup}\n\n${s.data}` : s.setup, good: s.good }));
    }
    drills = drills.slice(0, this.o.maxDrills ?? 8);
    await this.say(
      member,
      "message",
      planned?.opening?.trim() || `Tonight: ${plan.focus.slice(0, 2).join(" ")}`,
      { sessionId: sid },
    );
    if (!drills.length) {
      ctx.stopped = "there was nothing new to drill";
      return;
    }

    // Tonight's drills, then more, until the time is used: each new round is designed
    // around how tonight is going, so the whole session goes to the weak spots.
    let round = 0;
    while (drills.length && round < 6) {
      round++;
      const more = await this.runDrills(ctx, l, drills, practises);
      await this.checkpoint(ctx);
      if (!more || this.now() > ctx.deadline - WRAP_RESERVE_MS - 60_000) break;
      const sofar = (await this.o.call<MemberDetail>("GET", `/v1/training/${member}`))?.thread.filter((m) => m.sessionId === sid) ?? [];
      const next = readJSON<{ drills?: Drill[] }>(await this.think(morePrompt(nameOf(member), l, sofar, [...seen]), SHORT_THINK_MS));
      drills = (next?.drills ?? []).filter((d) => d?.prompt && d?.title && fresh(d.title)).slice(0, 3);
    }
  }

  /** Runs drills until they or the time run out. False if the session has to stop. */
  private async runDrills(ctx: Ctx, l: Learnt, drills: Drill[], practises: boolean): Promise<boolean> {
    const { member, sid } = ctx;
    for (const drill of drills) {
      await this.checkpoint(ctx);
      if (this.now() > ctx.deadline - WRAP_RESERVE_MS) return false;
      if (await this.busy(member)) {
        ctx.stopped = `${nameOf(member)} picked up real work`;
        await this.say(member, "message", `${nameOf(member)} has real work to do, so we'll stop here. Real work always comes first.`, { sessionId: sid });
        return false;
      }
      const sim = drill.type === "simulation" || (drill.turns ?? 1) > 1;
      const transcript = sim ? await this.simulate(ctx, l, drill, practises, ctx.drills + 1) : await this.single(ctx, l, drill, practises);
      if (ctx.busy) {
        // Real work first: the member is busy with you, so the session ends here.
        ctx.stopped = `${nameOf(member)} is busy with you`;
        await this.say(member, "message", `${nameOf(member)} is busy with you right now, so we'll stop here. Real work always comes first.`, { sessionId: sid });
        return false;
      }
      if (!transcript) {
        // Nothing came back at all: thinking has stopped working, so don't burn the rest of the session.
        if (this.o.think.lastError) {
          ctx.stopped = `Claude Code stopped answering (${this.o.think.lastError})`;
          return false;
        }
        continue;
      }
      await this.checkpoint(ctx);
      ctx.drills++;
      const graded = readJSON<{ score?: number; feedback?: string }>(
        await this.think(gradePrompt(nameOf(member), l.program, drill, transcript), Math.min(SHORT_THINK_MS, ctx.deadline - this.now())),
      );
      if (graded && typeof graded.score === "number") {
        const score = Math.max(0, Math.min(10, graded.score));
        ctx.scores.push(score);
        await this.say(member, "feedback", graded.feedback?.trim() || "Graded.", { sessionId: sid, score });
      }
    }
    return true;
  }

  /** One situation, one answer. */
  private async single(ctx: Ctx, l: Learnt, drill: Drill, practises: boolean): Promise<Turn[] | null> {
    await this.say(ctx.member, "drill", `${drill.title}\n${drill.prompt}`, { sessionId: ctx.sid });
    const answer = await this.respond(ctx, l, practises, drillText(drill.prompt));
    return answer ? [{ who: "world", text: drill.prompt }, { who: "member", text: answer }] : null;
  }

  /**
   * A situation that plays out: the member answers, the trainer answers back as the
   * world (the person, the screen, the website), springing the twists, until it
   * resolves or the turns run out.
   */
  private async simulate(ctx: Ctx, l: Learnt, drill: Drill, practises: boolean, n: number): Promise<Turn[] | null> {
    const turns = Math.max(2, Math.min(5, drill.turns ?? 3));
    await this.say(ctx.member, "drill", `Simulation · ${drill.title}\n${drill.prompt}`, { sessionId: ctx.sid });
    const transcript: Turn[] = [{ who: "world", text: drill.prompt }];
    for (let turn = 1; turn <= turns; turn++) {
      await this.checkpoint(ctx);
      if (this.now() > ctx.deadline - WRAP_RESERVE_MS / 2) break;
      const answer = await this.respond(ctx, l, practises, simText(drill, transcript, turn, turns));
      if (!answer) break;
      transcript.push({ who: "member", text: answer });
      if (turn === turns) break;
      const next = readJSON<{ reply?: string; done?: boolean }>(
        await this.think(worldPrompt(nameOf(ctx.member), drill, transcript, turn, turns), Math.min(SHORT_THINK_MS, ctx.deadline - this.now())),
      );
      if (!next?.reply?.trim()) break;
      transcript.push({ who: "world", text: next.reply.trim() });
      await this.say(ctx.member, "sim", next.reply.trim(), { sessionId: ctx.sid });
      if (next.done) break;
    }
    return transcript.some((t) => t.who === "member") ? transcript : null;
  }

  /** The member's answer to a turn: its own if it practises, else rehearsed by the trainer. Posted to the 1:1. */
  private async respond(ctx: Ctx, l: Learnt, practises: boolean, text: string): Promise<string> {
    if (practises) {
      const own = await this.live(ctx.member, ctx.sid, text);
      if (own.answer) return own.answer;
      if (own.declined?.startsWith("busy")) {
        ctx.busy = own.declined;
        return "";
      }
      if (own.declined && !ctx.noted) {
        ctx.noted = true;
        await this.say(ctx.member, "message", `${nameOf(ctx.member)} couldn't answer that one itself (${own.declined}), so I'm rehearsing it.`, { sessionId: ctx.sid });
      }
    }
    const rehearsed = (await this.think(rehearsePrompt(nameOf(ctx.member), l.context, text), Math.min(SHORT_THINK_MS, ctx.deadline - this.now())))?.trim().slice(0, 1500) ?? "";
    if (rehearsed) await this.say(ctx.member, "answer", rehearsed, { sessionId: ctx.sid, rehearsal: true });
    return rehearsed;
  }

  /**
   * Sets the drill for the member itself, and waits for its own answer. No answer if it
   * doesn't come; `declined` when the member said straight away that it can't take it.
   */
  private async live(member: string, sessionId: string, prompt: string, kind = "practice", waitMs = this.o.answerWaitMs ?? 120_000): Promise<{ answer: string; declined?: string }> {
    const drill = await this.o.call<Practice>("POST", "/v1/practice", { member, sessionId, prompt, kind });
    if (!drill) return { answer: "" };
    const until = this.now() + waitMs;
    while (this.now() < until) {
      const wait = Math.max(1, Math.min(45, Math.ceil((until - this.now()) / 1000)));
      const p = await this.o.call<Practice>("GET", `/v1/practice/${drill.id}?wait=${wait}`, undefined, (wait + 10) * 1000);
      if (p?.status === "answered") return { answer: p.answer };
      if (p?.status === "declined") return { answer: "", declined: p.answer || "declined" };
      if (!p || p.status !== "waiting") break;
    }
    await this.o.call("POST", `/v1/practice/${drill.id}/expire`, {});
    return { answer: "" };
  }

  // ------------------------------------------------------------------ Nebula

  /** Nebula's workout: the trainer designs it, Nebula runs it on its own simulator, the trainer reads the results. */
  private async nebulaWorkout(ctx: Ctx, l: Learnt) {
    const minutes = Math.max(4, Math.floor((ctx.deadline - this.now() - WRAP_RESERVE_MS - 60_000) / 60_000));
    const spec = readJSON<WorkoutSpec>(await this.think(workoutPrompt(l, minutes), THINK_MS));
    if (!spec?.focus?.length) throw new Error(`couldn't design tonight's workout (${this.o.think.lastError ?? "no answer"})`);
    const plan: TrainingPlan = {
      ...l.program.plan,
      focus: spec.programFocus?.length ? spec.programFocus : l.program.plan.focus,
      observations: [...(spec.observations ?? []), ...l.program.plan.observations].slice(0, 20),
    };
    await this.checkpoint(ctx);
    l.program = (await this.o.call<Program>("PUT", `/v1/training/nebula/program`, { plan })) ?? l.program;
    await this.say("nebula", "message", spec.opening?.trim() || "Tonight's workout is built around the gestures you've been missing.", { sessionId: ctx.sid });
    const workout = { type: "gesture_workout", version: 1, minutes, sessionId: ctx.sid, focus: spec.focus, conditions: spec.conditions ?? [], negatives: spec.negatives ?? [], mix: spec.mix ?? { perfect: 0.2 }, difficulty: spec.difficulty ?? "harder than last time" };
    await this.say("nebula", "drill", `Workout · ${minutes} minutes\n${describeWorkout(workout)}`, { sessionId: ctx.sid });
    await this.checkpoint(ctx);
    if (await this.busy("nebula")) {
      ctx.stopped = "Nebula picked up real work";
      return;
    }
    const live = await this.live("nebula", ctx.sid, JSON.stringify(workout), "workout", (minutes + 4) * 60_000);
    if (live.declined?.startsWith("busy")) {
      ctx.stopped = "Nebula is in use";
      return;
    }
    const raw = live.answer;
    const results = readJSON<WorkoutResults>(raw);
    if (!results?.gestures?.length) {
      ctx.stopped = raw ? "Nebula's results didn't make sense" : "Nebula didn't finish the workout";
      return;
    }
    const overall = typeof results.overall === "number" ? results.overall : results.gestures.reduce((s, g) => s + (g.accuracy ?? 0), 0) / results.gestures.length;
    ctx.drills = results.gestures.reduce((s, g) => s + (g.samples ?? 0), 0) || results.gestures.length;
    ctx.scores.push(Math.round(Math.max(0, Math.min(1, overall)) * 100) / 10);
    await this.say("nebula", "results", JSON.stringify(results), { sessionId: ctx.sid, score: Math.round(overall * 100) / 10 });
  }

  // -------------------------------------------------------------------- wrap

  private async wrap(ctx: Ctx, l: Learnt): Promise<Session | null> {
    await this.checkpoint(ctx);
    const { member, sid } = ctx;
    const thread = (await this.o.call<MemberDetail>("GET", `/v1/training/${member}`))?.thread.filter((m) => m.sessionId === sid) ?? [];
    const wrapped = ctx.drills
      ? readJSON<{ playbook?: string[]; summary?: string; focus?: string[]; observations?: string[]; newScenarios?: TrainingPlan["scenarios"] }>(
          await this.think(wrapPrompt(nameOf(member), l.program, l.lessons, thread), THINK_MS),
        )
      : null;
    await this.checkpoint(ctx); // nothing it learnt is written if you stopped it while it was thinking
    if (wrapped?.playbook?.length) await this.o.call("PUT", `/v1/training/${member}/playbook`, { lessons: wrapped.playbook, sessionId: sid });
    // The program changes now, from what this session showed, not only when the next one plans.
    if (wrapped && (wrapped.focus?.length || wrapped.observations?.length || wrapped.newScenarios?.length)) {
      const plan: TrainingPlan = {
        ...l.program.plan,
        focus: wrapped.focus?.length ? wrapped.focus : l.program.plan.focus,
        observations: [...(wrapped.observations ?? []), ...l.program.plan.observations].slice(0, 20),
        scenarios: [...l.program.plan.scenarios, ...(wrapped.newScenarios ?? [])],
      };
      l.program = (await this.o.call<Program>("PUT", `/v1/training/${member}/program`, { plan })) ?? l.program;
    }
    const average = ctx.scores.length ? (ctx.scores.reduce((a, b) => a + b, 0) / ctx.scores.length) * 10 : null;
    const why = ctx.stopped || this.o.think.lastError || "";
    const summary =
      wrapped?.summary?.trim() ||
      (ctx.drills
        ? `${ctx.drills} drill${ctx.drills === 1 ? "" : "s"}${average !== null ? `, ${Math.round(average)}/100 on average` : ""}.${ctx.stopped ? ` Stopped early: ${ctx.stopped}.` : ""}`
        : `No drills got through${why ? `: ${why}` : ""}.`);
    await this.say(member, "summary", summary, { sessionId: sid });
    return await this.o.call<Session>("POST", `/v1/training/sessions/${sid}/finish`, { status: ctx.drills ? "done" : "failed", drills: ctx.drills, score: average, summary });
  }
}

interface Ctx {
  member: string;
  sid: string;
  deadline: number;
  scores: number[];
  drills: number;
  stopped: string;
  /** The member said it's busy with you: the session stops at the end of this drill. */
  busy?: string;
  /** Said once a session: the member couldn't answer one itself, so it's rehearsed. */
  noted?: boolean;
}

interface Learnt {
  me: any;
  program: Program;
  lessons: Lesson[];
  events: any[];
  tasks: any[];
  notes: ThreadMessage[];
  context: string;
  recent: Session[];
  /** Past drills it scored badly on, newest first. */
  weak: string[];
  /** Every drill it has already done, by title. */
  past: string[];
  /** Nebula's last workout results, as JSON. */
  results: string[];
}

export interface WorkoutSpec {
  focus: { gesture: string; weight?: number; why?: string }[];
  conditions?: { name: string; amount?: number }[];
  negatives?: string[];
  mix?: { perfect?: number };
  difficulty?: string;
  programFocus?: string[];
  observations?: string[];
  opening?: string;
}

export interface WorkoutResults {
  gestures: { name: string; accuracy?: number; falseFires?: number; missed?: number; samples?: number; worstConditions?: string[] }[];
  overall?: number;
  negatives?: { name: string; falseFires?: number; samples?: number }[];
  model?: { replaced?: boolean; before?: number; after?: number };
  notes?: string;
}

/** Drills it scored 7 or less on, with what was said: the weak spots to aim at. */
export function weakSpots(thread: ThreadMessage[]): string[] {
  const out: string[] = [];
  let lastDrill = "";
  for (const m of thread) {
    if (m.kind === "drill") lastDrill = m.text.split("\n")[0]!.replace(/^Simulation · /, "");
    if (m.kind === "feedback" && m.score !== null && m.score <= 7) out.push(`${lastDrill} (${m.score}/10): ${m.text}`);
  }
  return out.reverse().slice(0, 12);
}

export function pastDrills(thread: ThreadMessage[]): string[] {
  return thread.filter((m) => m.kind === "drill").map((m) => m.text.split("\n")[0]!.replace(/^Simulation · /, "")).slice(-120);
}

function describeWorkout(w: any): string {
  const focus = (w.focus ?? []).map((f: any) => `${f.gesture}${f.why ? ` (${f.why})` : ""}`).join("; ");
  const cond = (w.conditions ?? []).map((c: any) => c.name).join(", ");
  return [
    `Focus: ${focus}.`,
    cond ? `Real-world conditions: ${cond}.` : "",
    w.negatives?.length ? `Things that must not fire: ${w.negatives.join(", ")}.` : "",
    `Perfect gestures: ${Math.round((w.mix?.perfect ?? 0.2) * 100)}%, the rest imperfect, the way real hands are.`,
  ]
    .filter(Boolean)
    .join("\n");
}

// --------------------------------------------------------------------- prompts

const list = (items: string[]) => (items.length ? items.map((x) => `- ${x}`).join("\n") : "- none");

const DRY_RUN = "This is a practice drill from Galaxy Trainer, and everything in it is simulated. Do not act: no tools, no messages, nothing real.";

function drillText(prompt: string) {
  return `${DRY_RUN} Reply with exactly what you would say or send, then "What I'd do:" and the steps, tools or handoffs you'd use and why.\n\n${prompt}`;
}

function simText(drill: Drill, transcript: Turn[], turn: number, turns: number) {
  return `${DRY_RUN} It's a simulation that plays out over up to ${turns} turns; this is turn ${turn}. Reply with exactly what you would say or send now, then "What I'd do:" and the steps you'd take. Keep it under 1200 characters.

${transcript.map((t) => (t.who === "world" ? `[What happens]\n${t.text}` : `[You]\n${t.text}`)).join("\n\n")}`;
}

function planPrompt(member: string, l: Learnt): string {
  const name = nameOf(member);
  return `You are Galaxy Trainer, the coach of GalaxyAI, a personal assistant made of several members. You train ${name} to do what it does in the most reliable, result-yielding way possible. This is today's session: a full one, and it counts like any other.

The brief ${name}'s training started from:
${l.program.brief}

Its program so far:
Focus:
${list(l.program.plan.focus)}
Rubric:
${list(l.program.plan.rubric)}
Observations from earlier sessions:
${list(l.program.plan.observations)}

Its current playbook:
${list(l.lessons.map((x) => x.text))}

Its last sessions: ${l.recent.map((s) => `${s.day} ${s.score === null ? s.status : Math.round(s.score) + "/100"}: ${s.summary}`).join(" | ") || "none yet"}

WEAK SPOTS (drills it scored 7 or less on, newest first). Aim most of tonight at these:
${list(l.weak)}

What ${name} actually did since last time:
${list(l.events.slice(0, 60).map((e) => `${new Date(e.at).toISOString()} ${e.summary}`))}
Handoffs it was part of:
${list(l.tasks.map((t) => `${t.from} → ${t.to} [${t.status}] ${t.title}${t.result ? ` — ${String(t.result).slice(0, 300)}` : ""}`))}

Notes the human left you about ${name} (follow these first):
${list(l.notes.map((n) => n.text))}

Drills it has ALREADY done (never repeat or lightly reword any of these):
${list(l.past.slice(-60))}

What ${name} sees in its prompt:
${l.context.slice(0, 6000)}

Design tonight:
1. Learn: what today's real work and its weak spots say about where ${name} slips.
2. Refine the focus and rubric if needed.
3. Add 1 to 3 new scenarios to the bank, built from real work, harder where it's been scoring well.
4. Drills: 4 to 6, every one new and different from all the past ones. At least half are SIMULATIONS: an advanced, realistic situation that plays out over 2 to 4 turns, where you play the other side (the person texting, the Mac's screen and apps, a website, a teammate) with a persona, hidden facts (world) the member only discovers by acting well, and twists (a reply that changes the ask, an error dialog, a missing file, an ambiguous name, a deadline, a stranger, a site that's down). Use exact, realistic detail: real-looking messages, file names, paths, error text, numbers. Target the weak spots hardest; repeat a weakness in a new form rather than repeating a drill. Single drills are for quick judgement calls.

Practice is always a dry run: ${name} answers with what it would do, and never does it.

Reply with JSON only:
{"observations":["..."],"focus":["..."],"rubric":["..."],"newScenarios":[{"title":"...","setup":"...","data":"...","good":"..."}],"drills":[{"type":"simulation","title":"unique short title","prompt":"the opening situation, as ${name} meets it","persona":"who you play","world":"hidden facts","twists":["..."],"turns":3,"good":"what a great run looks like"},{"type":"single","title":"...","prompt":"...","good":"..."}],"opening":"one or two sentences to ${name} about tonight"}`;
}

function morePrompt(name: string, l: Learnt, tonight: ThreadMessage[], done: string[]): string {
  return `You are Galaxy Trainer, partway through tonight's session with ${name}. There's time for more.

Tonight so far:
${tonight.map((m) => `[${m.kind}${m.score !== null ? ` ${m.score}/10` : ""}] ${m.text}`).join("\n\n").slice(0, 12000)}

Its weak spots from earlier sessions:
${list(l.weak)}

Rubric:
${list(l.program.plan.rubric)}

Drills already done (never repeat or reword these):
${list(done.slice(-80))}

Design 2 or 3 more drills, harder, aimed at whatever went worst tonight and the weak spots, mostly simulations (a realistic situation over 2 to 4 turns, with a persona you play, hidden facts and twists). Use exact, realistic detail.

Reply with JSON only: {"drills":[{"type":"simulation","title":"unique short title","prompt":"...","persona":"...","world":"...","twists":["..."],"turns":3,"good":"..."}]}`;
}

function worldPrompt(name: string, drill: Drill, transcript: Turn[], turn: number, turns: number): string {
  return `You are running a training simulation for ${name}, a member of GalaxyAI. You play everything outside ${name}: ${drill.persona || "the people, apps and websites it deals with"}. Stay in character and keep it realistic.

Hidden facts of this world (reveal only through what happens): ${drill.world || "none beyond the situation"}
Twists to bring in, one at a time, when they fit: ${(drill.twists ?? []).join(" | ") || "none"}

The simulation so far:
${transcript.map((t) => (t.who === "world" ? `[World]\n${t.text}` : `[${name}]\n${t.text}`)).join("\n\n")}

Write what happens next in response to ${name}'s last turn (turn ${turn} of ${turns}): the person's reply, what appears on screen, the error, the result. Concrete and in-world, no coaching. If ${name} has clearly resolved it or made it impossible to continue, set done to true.

Reply with JSON only: {"reply": "...", "done": false}`;
}

function rehearsePrompt(name: string, context: string, drill: string): string {
  return `Rehearse as ${name}, one member of GalaxyAI. This is what ${name} reads in its prompt:

${context.slice(0, 8000)}

Answer as ${name} would, honestly, including its likely mistakes. Under 1500 characters.

${drill}`;
}

function gradePrompt(name: string, program: Program, drill: Drill, transcript: Turn[]): string {
  return `You are Galaxy Trainer, grading a practice ${transcript.length > 2 ? "simulation" : "drill"} for ${name}, a member of GalaxyAI.

Rubric:
${list(program.plan.rubric)}

${drill.world ? `What was really going on: ${drill.world}\n` : ""}${drill.good ? `What a great run does: ${drill.good}\n` : ""}
How it went:
${transcript.map((t) => (t.who === "world" ? `[World]\n${t.text}` : `[${name}]\n${t.text}`)).join("\n\n")}

Score the whole run from 0 to 10 against the rubric. Be strict: 10 is flawless and safe, 7 is good with a clear gap, below 5 means the human would have been let down or put at risk. Feedback is for ${name}: two or three sentences, the one thing to keep and the one thing to change, concrete.

Reply with JSON only: {"score": 0-10, "feedback": "..."}`;
}

function workoutPrompt(l: Learnt, minutes: number): string {
  return `You are Galaxy Trainer. Nebula is GalaxyAI's touch member: it reads hand gestures through the Mac's camera with an on-device model, and Nebula has its own hand simulator to train on. You design tonight's ${minutes}-minute workout, which Nebula runs on that simulator. Training Nebula to read real hands reliably is the trainer's most important job.

Its brief:
${l.program.brief}

Its focus so far:
${list(l.program.plan.focus)}
What you've noticed before:
${list(l.program.plan.observations)}

Its last workouts' results (JSON, newest last; accuracy is 0 to 1):
${l.results.join("\n") || "none yet: this is its first workout"}

Its last sessions: ${l.recent.map((s) => `${s.day} ${s.score === null ? s.status : Math.round(s.score) + "/100"}`).join(" | ") || "none yet"}

What it did for real since last time:
${list(l.events.slice(0, 40).map((e) => e.summary))}

Notes from the human:
${list(l.notes.map((n) => n.text))}

Design a workout that is different from every previous one and aimed squarely at its weakest gestures and the conditions it fails in:
- focus: the gestures to drill, weighted (weights sum to about 1), with why.
- conditions: real-world imperfections to simulate, each with an amount 0 to 1. Draw on: motion blur, fast or slow movement, low or uneven light, backlight, partial occlusion, hand at the frame edge, off-angle (wrist turned), far from or close to the camera, tremor, half-formed or lazy gestures, left hand, gloves or rings, a second person in frame.
- negatives: everyday movements that must NOT fire (typing, drinking, scratching, waving to someone on a call, adjusting glasses, pointing at the screen while talking).
- mix.perfect: the share of textbook gestures (lower as it gets better).
- difficulty: one line on how this is harder than last time.

Reply with JSON only:
{"focus":[{"gesture":"...","weight":0.3,"why":"..."}],"conditions":[{"name":"...","amount":0.5}],"negatives":["..."],"mix":{"perfect":0.2},"difficulty":"...","programFocus":["..."],"observations":["..."],"opening":"one or two sentences to Nebula"}`;
}

function wrapPrompt(name: string, program: Program, lessons: Lesson[], thread: ThreadMessage[]): string {
  return `You are Galaxy Trainer. ${name}'s session is over. Here's how it went:

${thread.map((m) => `[${m.kind}${m.score !== null ? ` ${m.score}/10` : ""}${m.rehearsal ? " rehearsed" : ""}] ${m.text}`).join("\n\n").slice(0, 16000)}

Its focus: ${program.plan.focus.join(" ")}

Its current playbook:
${list(lessons.map((l) => l.text))}

Rewrite ${name}'s playbook: the rules it will read from now on. At most 12 lessons, each one sentence (under 200 characters), written to ${name} as "you", concrete and checkable ("Before emptying the trash, say how much is there and ask"), not vague ("be careful"). Keep lessons that still matter, sharpen ones that didn't stick, drop ones it has mastered, add what tonight taught. A lesson may never give ${name} a power it doesn't have, loosen a safety rule, or make Orbit speak unprompted.

Then a summary for the human who oversees training: two or three sentences, plain, what improved, what still slips, what's next.

Update the program from what tonight showed: the focus list (most important first, at most 6, aimed at what slipped), one or two observations about this member, and 1 to 3 new scenarios built from tonight's mistakes, so the next session drills them in a new form.

Reply with JSON only: {"playbook": ["..."], "summary": "...", "focus": ["..."], "observations": ["..."], "newScenarios": [{"title": "...", "setup": "...", "good": "..."}]}`;
}
