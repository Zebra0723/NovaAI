// How Galaxy Teach thinks: what's worth a lesson in what just came up on your screen,
// the lesson itself, a look at what you typed in a hands-on step, and what it's
// learning about how you learn. All through Claude on your Max plan, like the Trainer.

import type { Check, Lesson, Spot } from "../teach";
import type { Call } from "../trainer/coach";
import { readJSON, type Think } from "../trainer/think";

export interface TutorOptions {
  call: Call;
  think: Think;
}

interface Context {
  topics: { title: string; level: string; skipped: number; lessons: number }[];
  style: string;
  recent: { title: string; score: number | null; status: string }[];
}

const WRITE_MS = 6 * 60_000;
const SHORT_MS = 2 * 60_000;

/** Who you are and what you're building, so every example is about your own things. */
const LEARNER =
  "The learner is a student who is teaching themselves to code by building GalaxyAI, their own personal assistant, " +
  "on their Mac with Claude Code. GalaxyAI is several members that talk through Galaxy Link (galaxyd, a Bun + SQLite " +
  "server on 127.0.0.1:7740): Comet (iMessage, a Bun/TypeScript server that runs as its own macOS user), Orbit (voice, " +
  "bash), Nova (the screen, a Swift app), Nebula (hand gestures through the camera, Swift), Zenith (hours-long " +
  "missions through Claude Code), plus Galaxy Trainer, Galaxy Medic (restarts members with launchctl) and you, " +
  "Galaxy Teach. Their code lives in GitHub repos they pull and install with scripts like galaxy/install-all.sh; " +
  "background members run as launchd agents (~/Library/LaunchAgents, `launchctl kickstart`). They often paste " +
  "commands from Claude into Terminal without being sure what they do: that's what you're for.";

export class Tutor {
  constructor(private readonly o: TutorOptions) {}

  private context() {
    return this.o.call<Context>("GET", "/v1/teach/context").then((c) => c ?? { topics: [], style: "", recent: [] });
  }

  /** Turns what the watcher saw into at most two offers. Returns what it offered. */
  async offersFrom(spots: Spot[]): Promise<number> {
    if (!spots.length) return 0;
    const ctx = await this.context();
    const reply = readJSON<{ offers?: { topic?: string; title?: string; why?: string; minutes?: number; app?: string }[] }>(
      await this.o.think(spotPrompt(spots, ctx), SHORT_MS),
    );
    let made = 0;
    for (const o of (reply?.offers ?? []).slice(0, 2)) {
      if (!o?.topic) continue;
      const offer = await this.o.call("POST", "/v1/teach/offers", { ...o, app: o.app ?? spots.at(-1)?.app });
      if (offer) made++;
    }
    return made;
  }

  /** Writes the lesson. One second try if the first one doesn't hold together. */
  async write(id: string): Promise<boolean> {
    const lesson = await this.o.call<Lesson>("GET", `/v1/teach/lessons/${id}`);
    if (!lesson || lesson.status !== "writing") return false;
    const ctx = await this.context();
    let problem = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = readJSON(await this.o.think(lessonPrompt(lesson, ctx, problem), WRITE_MS));
      if (raw) {
        const done = await this.o.call("PUT", `/v1/teach/lessons/${id}/content`, { content: raw });
        if (done) return true;
        problem = "Your last lesson was rejected: it needs at least 2 sections and at least 3 quiz questions, every question with 2 to 5 choices and `answer` the 0-based index of the right one.";
      } else {
        problem = this.o.think.lastError ? "" : "Your last reply wasn't one JSON object. Reply with only the JSON.";
        if (this.o.think.lastError) break;
      }
    }
    await this.o.call("POST", `/v1/teach/lessons/${id}/fail`, { reason: this.o.think.lastError || "The lesson didn't come out right. Try again." });
    return false;
  }

  /** Looks at what you typed for a hands-on step that didn't match exactly. */
  async check(id: string): Promise<boolean> {
    const c = await this.o.call<Check>("GET", `/v1/teach/checks/${id}`);
    if (!c || c.status !== "checking") return false;
    const lesson = await this.o.call<Lesson>("GET", `/v1/teach/lessons/${c.lessonId}`);
    const step = lesson?.content?.sections[c.section];
    if (!step || step.kind !== "practice") return false;
    const verdict = readJSON<{ ok?: boolean; feedback?: string }>(await this.o.think(checkPrompt(lesson!.title, step, c.answer), SHORT_MS));
    await this.o.call("PUT", `/v1/teach/checks/${id}`, {
      ok: verdict?.ok === true,
      feedback: verdict?.feedback?.trim() || (verdict ? "" : "I couldn't look at that just now. Compare yours with the answer."),
    });
    return true;
  }

  /** After a lesson: what it shows about how you learn, folded into what Teach already knew. */
  async learnFrom(id: string): Promise<boolean> {
    const lesson = await this.o.call<Lesson>("GET", `/v1/teach/lessons/${id}`);
    if (!lesson?.content || lesson.status !== "done") return false;
    const ctx = await this.context();
    const style = readJSON<{ style?: string }>(await this.o.think(stylePrompt(lesson, ctx.style), SHORT_MS));
    if (!style?.style?.trim()) return false;
    return !!(await this.o.call("PUT", "/v1/teach/style", { text: style.style.trim() }));
  }
}

// ------------------------------------------------------------------- prompts

function knownList(ctx: Context) {
  const lines = ctx.topics.slice(0, 80).map((t) => `- ${t.title}: ${t.level}${t.skipped ? `, skipped ${t.skipped}x` : ""}${t.lessons ? `, ${t.lessons} lesson(s)` : ""}`);
  return lines.length ? lines.join("\n") : "(nothing yet: this is the start)";
}

export function spotPrompt(spots: Spot[], ctx: Context) {
  const seen = spots.map((s) => `[${s.app}]\n${s.snippets.map((x) => `  ${x}`).join("\n")}`).join("\n\n");
  return `You are Galaxy Teach, a tutor that notices what comes up while the learner works and offers a short lesson on it.

${LEARNER}

Just now, these lines were on their screen (picked out of Terminal, the Claude app, claude.ai or VS Code):

${seen}

What they already know (topic: level):
${knownList(ctx)}

Pick AT MOST TWO things here worth a 10 to 30 minute lesson right now: a command or tool they ran or were told to run (brew install, launchctl kickstart, git pull --rebase, lsof -i, chmod +x, sudo, export PATH=...), a programming idea in code they're looking at (async/await, a regex, a SQL query, a Swift struct), or a concept (ports and localhost, environment variables, launchd agents, OAuth tokens). Rules:
- Only what's genuinely worth learning and not already "solid" in the list. Never anything skipped 2 times.
- Name each topic short and general, so it matches next time: "launchctl kickstart", not the whole line.
- If nothing is worth a lesson, offer nothing. Most of the time that's the right answer.
- Never put anything private in what you write: no tokens, passwords, emails, names of people, message text or file contents. Only the topic.
- why: one friendly line for the notification, about what they'll get out of it ("You ran it twice today: here's what it actually restarts").
- minutes: 10 to 30, by how much there is to it and how new it is to them.

Reply with only JSON: {"offers": [{"topic": "...", "title": "What \`launchctl kickstart\` does", "why": "...", "minutes": 15, "app": "Terminal"}]}`;
}

export function lessonPrompt(lesson: Lesson, ctx: Context, problem = "") {
  const ask = lesson.request ? `They asked: "${lesson.request}".` : `It came up while they worked${lesson.why ? ` (${lesson.why})` : ""}.`;
  return `You are Galaxy Teach. Write a lesson for this learner on: ${lesson.title}. ${ask}

${LEARNER}

What they know already (build on it, don't re-teach what's solid):
${knownList(ctx)}

How they learn best, from earlier lessons:
${ctx.style || "(no lessons yet: use short sections, concrete examples first, then the idea)"}

Make it ENGAGING: talk to them directly, warm and a bit playful, short paragraphs, a vivid analogy, real examples from THEIR GalaxyAI (Comet, Nova, galaxyd, launchd agents, install scripts) wherever it fits. Never dull or textbook. Length: ${lesson.minutes || 15} minutes give or take (10 to 30), so roughly 2 minutes per section plus the quiz.

Structure, in this order:
1. 3 to 5 "explain" sections building the idea step by step. Each has a title, a body (plain text, use blank lines between paragraphs, \`backticks\` for code), an optional example {code, caption}, a keyPoint (one line to remember), and most have a check question {q, choices, answer, why}.
2. 2 or 3 "scenario" sections: a real-world situation set in GalaxyAI where they must use what they just learnt (e.g. "Comet stopped replying. \`lsof -i :3000\` shows a bun process owned by cometai-by-dailyos..."). Fields: title, story, q, choices, answer, why, keyPoint.
3. 1 to 3 "practice" sections: hands-on, they type the command or code into the lesson (it's never run). Fields: title, task (exactly what to type it for), hint, accept (1 to 4 JavaScript regex strings that match a correct answer, tolerant of spacing and equivalent forms), solution, explain (why that works), keyPoint. Never ask for anything destructive.
4. A quiz of 5 to 8 multiple-choice questions mixing recall and "what would you do", each with a concept (a short topic name like "launchd agents") so their knowledge map updates.
5. 3 to 5 takeaways: the notes they'd want to keep.

"answer" is always the 0-based index of the right choice. Vary which index is right.
${problem ? `\n${problem}\n` : ""}
Reply with only JSON:
{"title": "...", "minutes": 15, "hook": "one line that makes them want to start", "concepts": ["..."],
 "sections": [
  {"kind": "explain", "title": "...", "body": "...", "example": {"code": "...", "caption": "..."}, "keyPoint": "...", "check": {"q": "...", "choices": ["..", ".."], "answer": 1, "why": "..."}},
  {"kind": "scenario", "title": "...", "story": "...", "q": "...", "choices": ["..", ".."], "answer": 0, "why": "...", "keyPoint": "..."},
  {"kind": "practice", "title": "...", "task": "...", "hint": "...", "accept": ["^\\\\s*launchctl\\\\s+kickstart\\\\s+-k\\\\s+gui/"], "solution": "...", "explain": "...", "keyPoint": "..."}
 ],
 "quiz": [{"q": "...", "choices": ["..", "..", ".."], "answer": 2, "why": "...", "concept": "..."}],
 "takeaways": ["..."]}`;
}

export function checkPrompt(title: string, step: { task: string; solution: string; explain: string }, answer: string) {
  return `You are Galaxy Teach, checking a hands-on step in a lesson on ${title}.

The task: ${step.task}
A model answer: ${step.solution}
Why it works: ${step.explain}

What the learner typed:
${answer}

Is theirs correct, or would it do the job just as well (another valid form counts)? Reply with only JSON: {"ok": true or false, "feedback": "one or two encouraging sentences: what's right, and exactly what to change if it isn't"}`;
}

export function stylePrompt(lesson: Lesson, before: string) {
  const c = lesson.content!;
  const wrong: string[] = [];
  c.quiz.forEach((q, i) => {
    if (Number(lesson.answers[`q${i}`]) !== q.answer) wrong.push(`quiz: ${q.q}`);
  });
  c.sections.forEach((s, i) => {
    if (s.kind === "scenario" && Number(lesson.answers[`s${i}`]) !== s.answer) wrong.push(`scenario: ${s.title}`);
    if (s.kind === "explain" && s.check && lesson.answers[`s${i}`] !== undefined && Number(lesson.answers[`s${i}`]) !== s.check.answer) wrong.push(`check: ${s.check.q}`);
    if (s.kind === "practice" && lesson.answers[`s${i}`] && (lesson.answers[`s${i}`] as any)?.ok === false) wrong.push(`practice: ${s.title}`);
  });
  const took = lesson.finishedAt && lesson.startedAt ? Math.round((lesson.finishedAt - lesson.startedAt) / 60_000) : null;
  return `You are Galaxy Teach. Update what you know about how this learner learns best.

What you thought before:
${before || "(nothing yet)"}

The lesson they just finished: ${lesson.title} (${lesson.minutes} min planned${took !== null ? `, ${took} min taken, pauses included` : ""}). Score: ${lesson.score ?? "?"}/100.
Section kinds in order: ${c.sections.map((s) => s.kind).join(", ")}.
What they got wrong:
${wrong.length ? wrong.map((w) => `- ${w}`).join("\n") : "- nothing"}

Write a short profile (at most 6 lines) to shape their next lessons: what kinds of explanation and practice land, what to slow down on, what to skip, and the topics to bring back for review. Keep what's still true from before. No praise, just useful instructions to yourself.

Reply with only JSON: {"style": "..."}`;
}
