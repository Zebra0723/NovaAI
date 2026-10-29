// galaxyd's HTTP face. Loopback only, a token on every call, and the only
// web pages that can reach it are its own: the Galaxy Link app. A page you
// happen to visit elsewhere can't.

import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { Link, LinkError } from "./link";
import { MedicError } from "./medicine";
import { TeachError } from "./teach";
import { TrainingError } from "./training";

/** The Galaxy Link app's pages, served at /. */
export const WEB_ROOT = join(import.meta.dir, "..", "web");
const STARTED_AT = Date.now();
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

export interface ServerOptions {
  link: Link;
  token: string;
  port: number;
  hostname?: string;
}

const MAX_BODY = 256 * 1024;
const MAX_WAIT_MS = 50_000;

export function serve({ link, token, port, hostname = "127.0.0.1" }: ServerOptions) {
  return Bun.serve({
    port,
    hostname,
    // Long polls hold a request open for up to MAX_WAIT_MS.
    idleTimeout: 60,
    fetch: (req) => handle(link, token, req),
  });
}

export async function handle(link: Link, token: string, req: Request): Promise<Response> {
  try {
    return await route(link, token, req);
  } catch (error) {
    if (error instanceof LinkError || error instanceof TrainingError || error instanceof MedicError || error instanceof TeachError) return json({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return json({ error: "that isn't JSON" }, 400);
    console.error("galaxyd:", error);
    return json({ error: "something went wrong in Link" }, 500);
  }
}

async function route(link: Link, token: string, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // DNS rebinding: a name that resolves to 127.0.0.1 is still the wrong name.
  const hostHeader = req.headers.get("host") ?? "";
  const host = hostHeader.replace(/:\d+$/, "");
  if (host && !["127.0.0.1", "localhost", "[::1]"].includes(host)) {
    return json({ error: "wrong host" }, 403);
  }
  // A browser always says where a request came from; the bodies never do.
  // The one page allowed through is Link's own app, served from this origin.
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if ((site !== null && site !== "same-origin" && site !== "none") || (origin !== null && origin !== `http://${hostHeader}`)) {
    return json({ error: "Link doesn't talk to other web pages" }, 403);
  }

  if (path === "/v1/health" && method === "GET") return json({ ok: true, service: "galaxy-link" });
  if (method === "GET" && !path.startsWith("/v1/")) return page(path);

  if (!sameToken(req.headers.get("authorization") ?? "", `Bearer ${token}`)) {
    return json({ error: "missing or wrong token" }, 401);
  }
  const body = (req.headers.get("x-galaxy-body") ?? "").toLowerCase();
  const needBody = () => {
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(body)) throw new LinkError(400, "say which body you are in X-Galaxy-Body");
    return body;
  };
  const input = async (): Promise<any> => {
    const text = await req.text();
    if (text.length > MAX_BODY) throw new LinkError(413, "too big");
    return text ? JSON.parse(text) : {};
  };
  const wait = () => Math.min(Math.max(Number(url.searchParams.get("wait") ?? 0), 0), MAX_WAIT_MS / 1000) * 1000;

  // ------------------------------------------------------------------ bodies
  if (path === "/v1/hello" && method === "POST") return json(link.hello(needBody(), await input()));
  if (path === "/v1/heartbeat" && method === "POST") {
    link.heartbeat(needBody());
    return json({ ok: true, inbox: link.store.pendingInbox(body) });
  }
  if (path === "/v1/goodbye" && method === "POST") {
    link.goodbye(needBody());
    return json({ ok: true });
  }
  if (path === "/v1/bodies" && method === "GET") return json(link.bodies());
  if (path === "/v1/overview" && method === "GET") return json(link.overview(STARTED_AT));
  if (path === "/v1/presence" && method === "GET") return json(link.presence.read());

  // ---------------------------------------------------------------- memory
  if (path === "/v1/memory" && method === "GET") {
    const limit = clamp(Number(url.searchParams.get("limit") ?? 200), 1, 1000);
    return json(link.store.memories(url.searchParams.get("q") ?? "", limit));
  }
  if (path === "/v1/memory" && method === "POST") {
    const { text, source } = await input();
    if (typeof text !== "string" || !text.trim()) throw new LinkError(400, "a memory needs text");
    const { memory, created } = link.store.addMemory(text.slice(0, 2000), source === "user" ? "user" : needBody());
    return json(memory, created ? 201 : 200);
  }
  if (path === "/v1/memory/import" && method === "POST") {
    const { items } = await input();
    if (!Array.isArray(items) || items.length > 5000) throw new LinkError(400, "items must be a list");
    let added = 0;
    for (const item of items) {
      if (typeof item?.text !== "string" || !item.text.trim()) continue;
      const source = typeof item.source === "string" && /^[a-z][a-z0-9-]{1,31}$/.test(item.source) ? item.source : needBody();
      const at = Number.isFinite(item.createdAt) ? item.createdAt : undefined;
      if (link.store.addMemory(item.text.slice(0, 2000), source, at).created) added++;
    }
    return json({ found: items.length, added });
  }
  const memoryMatch = path.match(/^\/v1\/memory\/(m_[a-z0-9]+)$/);
  if (memoryMatch) {
    const id = memoryMatch[1]!;
    if (method === "PATCH") {
      const { text } = await input();
      if (typeof text !== "string" || !text.trim()) throw new LinkError(400, "a memory needs text");
      const updated = link.store.updateMemory(id, text.slice(0, 2000));
      return updated ? json(updated) : json({ error: "no such memory" }, 404);
    }
    if (method === "DELETE") {
      return link.store.deleteMemory(id) ? json({ ok: true }) : json({ error: "no such memory" }, 404);
    }
  }

  // --------------------------------------------------------------- context
  if (path === "/v1/events" && method === "GET") {
    const since = Number(url.searchParams.get("since") ?? 0);
    return json(link.store.events(since, clamp(Number(url.searchParams.get("limit") ?? 50), 1, 500)));
  }
  if (path === "/v1/events" && method === "POST") {
    const { kind, summary, detail } = await input();
    if (typeof summary !== "string" || !summary.trim()) throw new LinkError(400, "an event needs a summary");
    const k = typeof kind === "string" && /^[a-z_]{2,32}$/.test(kind) ? kind : "activity";
    return json(link.store.addEvent(needBody(), k, summary.slice(0, 500), String(detail ?? "").slice(0, 4000)), 201);
  }
  if (path === "/v1/context" && method === "GET") {
    return json({ text: link.promptContext(url.searchParams.get("for") || needBody()) });
  }

  // ----------------------------------------------------------------- tasks
  if (path === "/v1/tasks" && method === "POST") {
    const { to, power, title, instructions, replyTo } = await input();
    return json(link.handoff({ from: needBody(), to, power, title, instructions, replyTo }), 201);
  }
  if (path === "/v1/tasks" && method === "GET") {
    return json(
      link.store.tasks({
        status: url.searchParams.get("status") ?? undefined,
        body: url.searchParams.get("body") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
      }),
    );
  }
  if (path === "/v1/tasks/next" && method === "GET") {
    const task = await link.next(needBody(), wait());
    return task ? json(task) : new Response(null, { status: 204 });
  }
  const taskMatch = path.match(/^\/v1\/tasks\/(t_[a-z0-9]+)(?:\/(progress|done|cancel))?$/);
  if (taskMatch) {
    const [, id, action] = taskMatch as unknown as [string, string, string | undefined];
    if (!action && method === "GET") {
      const task = link.store.task(id);
      return task ? json(task) : json({ error: "no such task" }, 404);
    }
    if (method === "POST" && action === "progress") return json(link.progress(id, needBody(), String((await input()).note ?? "")));
    if (method === "POST" && action === "done") {
      const { ok, result } = await input();
      return json(link.finish(id, needBody(), ok !== false, String(result ?? "")));
    }
    if (method === "POST" && action === "cancel") return json(link.cancel(id, needBody()));
  }

  // ------------------------------------------------------------------ chat
  if (path === "/v1/chat" && method === "GET") {
    const after = Math.max(Number(url.searchParams.get("after") ?? 0) || 0, 0);
    return json(await link.chat(after, wait(), clamp(Number(url.searchParams.get("limit") ?? 200), 1, 1000)));
  }
  if (path === "/v1/chat" && method === "POST") {
    const who = needBody();
    if (!link.store.body(who)) throw new LinkError(403, "only bodies of GalaxyAI can talk in Galaxy Chat");
    const { text } = await input();
    return json(link.say(who, "message", String(text ?? "")), 201);
  }

  // ------------------------------------------------------------------ teach
  const teach = link.teach;
  if (path === "/v1/teach" && method === "GET") {
    await teach.waitForChange(Number(url.searchParams.get("since") ?? 0) || 0, url.searchParams.has("since") ? wait() : 0);
    return json(teach.overview());
  }
  if (path === "/v1/teach/spots" && method === "POST") return json(teach.spot(needBody(), await input()), 202);
  if (path === "/v1/teach/spots" && method === "GET") return json(await teach.takeSpots(needBody(), wait()));
  if (path === "/v1/teach/offers" && method === "POST") return json(teach.makeOffer(needBody(), await input()), 201);
  if (path === "/v1/teach/offers" && method === "GET") {
    await teach.waitForChange(Number(url.searchParams.get("since") ?? 0) || 0, url.searchParams.has("since") ? wait() : 0);
    return json({ version: teach.version, offers: teach.pendingOffers() });
  }
  const offer = path.match(/^\/v1\/teach\/offers\/([\w-]+)\/(begin|later|skip)$/);
  if (offer && method === "POST") {
    const [, oid, act] = offer as unknown as [string, string, string];
    return json(act === "skip" ? teach.skip(needBody(), oid) : teach.begin(needBody(), oid, act === "later"));
  }
  if (path === "/v1/teach/lessons" && method === "POST") return json(teach.ask(needBody(), await input()), 201);
  if (path === "/v1/teach/context" && method === "GET") return json(teach.context());
  if (path === "/v1/teach/style" && method === "PUT") return json(teach.setStyle(needBody(), await input()));
  if (path === "/v1/teach/status" && method === "PUT") return json(teach.setStatus(needBody(), await input()));
  if (path === "/v1/teach/watcher" && method === "PUT") return json(teach.setWatcher(needBody(), await input()));
  if (path === "/v1/teach/notes" && method === "POST") return json(teach.addNote(needBody(), await input()), 201);
  const note = path.match(/^\/v1\/teach\/notes\/([\w-]+)$/);
  if (note && method === "DELETE") return json(teach.removeNote(needBody(), note[1]!));
  const topic = path.match(/^\/v1\/teach\/topics\/(.+)$/);
  if (topic && method === "PATCH") return json(teach.setLevel(needBody(), decodeURIComponent(topic[1]!), (await input()).level));
  const check = path.match(/^\/v1\/teach\/checks\/([\w-]+)$/);
  if (check && method === "GET") {
    const c = await teach.waitCheck(check[1]!, wait());
    if (!c) throw new TeachError(404, "no such check");
    return json(c);
  }
  if (check && method === "PUT") return json(teach.answerCheck(needBody(), check[1]!, await input()));
  const tlesson = path.match(/^\/v1\/teach\/lessons\/([\w-]+)(?:\/(content|fail|retry|progress|finish|checks|saved))?$/);
  if (tlesson) {
    const [, lid, part] = tlesson as unknown as [string, string, string | undefined];
    if (!part && method === "GET") {
      const l = teach.lesson(lid);
      if (!l) throw new TeachError(404, "no such lesson");
      return json(l);
    }
    if (!part && method === "DELETE") return json(teach.remove(needBody(), lid));
    if (part === "content" && method === "PUT") return json(teach.write(needBody(), lid, (await input()).content));
    if (part === "fail" && method === "POST") return json(teach.fail(needBody(), lid, (await input()).reason));
    if (part === "retry" && method === "POST") return json(teach.retry(needBody(), lid));
    if (part === "progress" && method === "PUT") return json(teach.progress(needBody(), lid, await input()));
    if (part === "finish" && method === "POST") return json(teach.finish(needBody(), lid, await input()));
    if (part === "saved" && method === "PUT") return json(teach.setSaved(needBody(), lid, (await input()).saved !== false));
    if (part === "checks" && method === "POST") return json(teach.askCheck(needBody(), lid, await input()), 201);
  }

  // ------------------------------------------------------------------ medic
  const medicine = link.medicine;
  if (path === "/v1/medic" && method === "GET") return json(medicine.overview());
  if (path === "/v1/medic/checkup" && method === "PUT") return json(medicine.report(needBody(), await input()));
  if (path === "/v1/medic/incidents" && method === "POST") return json(medicine.record(needBody(), await input()), 201);
  if (path === "/v1/medic/resolve" && method === "POST") {
    const { key, did } = await input();
    return json(medicine.resolve(needBody(), String(key ?? ""), typeof did === "string" ? did : ""));
  }
  // You ask for a checkup now: Medic hears it through its inbox.
  if (path === "/v1/medic/checkup-now" && method === "POST") {
    if (!["you", "galaxy"].includes(needBody())) throw new LinkError(403, "only you can ask for a checkup");
    link.postInbox({ body: "medic", kind: "message", taskId: "", replyTo: "", text: "checkup" });
    return json({ ok: true, medicOnline: link.isOnline("medic") }, 202);
  }

  // --------------------------------------------------------------- training
  const training = link.training;
  if (path === "/v1/training" && method === "GET") return json(training.overview());
  if (path === "/v1/training" && method === "DELETE") return json(training.reset(needBody()));
  if (path === "/v1/training/status" && method === "PUT") return json(training.setStatus(needBody(), await input()));
  if (path === "/v1/training/threads" && method === "GET") {
    return json(await training.threads(Math.max(Number(url.searchParams.get("after") ?? 0) || 0, 0), wait()));
  }
  const lesson = path.match(/^\/v1\/training\/lessons\/([\w-]+)$/);
  if (lesson && method === "PATCH") return json(training.setLessonActive(needBody(), lesson[1]!, Boolean((await input()).active)));
  const finish = path.match(/^\/v1\/training\/sessions\/([\w-]+)\/finish$/);
  if (finish && method === "POST") return json(training.finishSession(needBody(), finish[1]!, await input()));
  const sess = path.match(/^\/v1\/training\/sessions\/([\w-]+)(?:\/(pause|resume|stop))?$/);
  if (sess) {
    const [, sid, act] = sess as unknown as [string, string, string | undefined];
    if (!act && method === "GET") {
      const s = training.session(sid);
      if (!s) throw new LinkError(404, "no such session");
      return json(s);
    }
    if (!act && method === "DELETE") return json(training.removeSession(needBody(), sid));
    if (act === "pause" && method === "POST") return json(training.pause(needBody(), sid));
    if (act === "resume" && method === "POST") return json(training.resume(needBody(), sid));
    if (act === "stop" && method === "POST") return json(training.stop(needBody(), sid));
  }
  const tm = path.match(/^\/v1\/training\/([a-z][a-z0-9-]{1,31})(?:\/(program|sessions|playbook|thread|train))?$/);
  if (tm) {
    const [, member, part] = tm as unknown as [string, string, string | undefined];
    if (!part && method === "GET") return json(training.member(member));
    if (part === "program" && method === "PUT") return json(training.setProgram(needBody(), member, await input()));
    if (part === "sessions" && method === "POST") {
      const { day, trigger } = await input();
      return json(training.startSession(needBody(), member, String(day ?? ""), trigger === "test" ? "test" : "night"), 201);
    }
    if (part === "playbook" && method === "PUT") {
      const { lessons, sessionId } = await input();
      return json(training.setPlaybook(needBody(), member, lessons, typeof sessionId === "string" ? sessionId : ""));
    }
    if (part === "thread" && method === "POST") return json(training.post(needBody(), member, await input()), 201);
    // You ask for a session now: the trainer hears it through its inbox.
    if (part === "train" && method === "POST") {
      // You, from the app or from Terminal (`galaxy train`).
      if (!["you", "galaxy"].includes(needBody())) throw new LinkError(403, "only you can ask for a session");
      training.member(member);
      link.postInbox({ body: "trainer", kind: "message", taskId: "", replyTo: "", text: `train:${member}` });
      return json({ ok: true, trainerOnline: link.isOnline("trainer") }, 202);
    }
  }
  if (path === "/v1/practice" && method === "POST") return json(training.setDrill(needBody(), await input()), 201);
  const pr = path.match(/^\/v1\/practice\/([\w-]+)(?:\/(answer|expire))?$/);
  if (pr) {
    const [, id, act] = pr as unknown as [string, string, string | undefined];
    if (act === "answer" && method === "POST") return json(training.answer(needBody(), id, (await input()).answer));
    if (act === "expire" && method === "POST") return json(training.expireDrill(needBody(), id));
    if (!act && method === "GET") return json(await training.awaitAnswer(id, wait()));
  }

  // A fresh round of introductions, from the app or `galaxy introduce`.
  if (path === "/v1/introductions" && method === "POST") return json(link.introductions(), 201);

  // ------------------------------------------------------------- approvals
  if (path === "/v1/approvals" && method === "POST") return json(link.requestApproval(needBody(), await input()), 201);
  if (path === "/v1/approvals" && method === "GET") {
    link.pendingApprovals(); // settles anything past its deadline first
    return json(link.store.approvals(clamp(Number(url.searchParams.get("limit") ?? 50), 1, 500)));
  }
  if (path === "/v1/approvals/pending" && method === "GET") {
    const since = Number(url.searchParams.get("since") ?? 0) || 0;
    return json(await link.pendingApprovalsSince(since, wait()));
  }
  const approvalMatch = path.match(/^\/v1\/approvals\/(a_[a-z0-9]+)(?:\/(decide|cancel))?$/);
  if (approvalMatch) {
    const [, id, action] = approvalMatch as unknown as [string, string, string | undefined];
    if (!action && method === "GET") return json(await link.waitForDecision(id, wait()));
    if (action === "decide" && method === "POST") {
      const { decision, via } = await input();
      return json(link.decide(id, needBody(), decision, via));
    }
    if (action === "cancel" && method === "POST") return json(link.cancelApproval(id, needBody()));
  }

  // -------------------------------------------------------------- delivery
  if (path === "/v1/deliver" && method === "POST") return json(link.deliver(needBody(), (await input()).text), 201);
  if (path === "/v1/inbox" && method === "GET") return json(await link.inbox(needBody(), wait()));

  return json({ error: "no such thing" }, 404);
}

/** The app's static files. They hold no secrets: the token is handed to the app by its window, not served. */
function page(path: string): Response {
  const rel = path === "/" ? "index.html" : decodeURIComponent(path).replace(/^\/+/, "");
  const file = normalize(join(WEB_ROOT, rel));
  if (!file.startsWith(WEB_ROOT + sep) || !existsSync(file) || !statSync(file).isFile()) {
    return new Response("Not here.", { status: 404, headers: { "content-type": "text/plain" } });
  }
  return new Response(readFileSync(file), {
    headers: {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-cache",
      "content-security-policy":
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function clamp(n: number, lo: number, hi: number) {
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : lo;
}

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
