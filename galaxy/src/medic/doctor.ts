// What Galaxy Medic knows about each member: how to tell it's healthy, how to tell
// what's wrong, and what it may do about it on its own.
//
// The rule for acting alone: only what you'd do yourself without thinking. Restart a
// background service that stopped; reopen an app that crashed (never one you quit);
// bring Link back. Anything else (a sign-in, a port taken by something else, Comet's
// separate Mac user, a member that's frozen mid-task) Medic tells you about, once,
// with the exact thing to run.

export interface Spec {
  id: string;
  name: string;
  /** A launchd job in your login session. */
  label?: string;
  /** A Mac app: its process name and bundle id. */
  app?: { process: string; bundle: string };
  /** Its log, to read when something's wrong. */
  log?: string;
  /** Never started by Medic (Orbit: it's quit most of the time, by design). */
  optional?: boolean;
}

export function specs(home: string, galaxyHome: string): Spec[] {
  return [
    { id: "link", name: "Galaxy Link", label: "ai.galaxy.link", log: `${galaxyHome}/galaxyd.log` },
    { id: "comet", name: "Comet" },
    { id: "nova", name: "Nova", app: { process: "Nova", bundle: "ai.galaxy.nova" } },
    { id: "nebula", name: "Nebula", app: { process: "Nebula", bundle: "ai.galaxy.nebula" } },
    { id: "zenith", name: "Zenith", label: "ai.galaxy.zenith", log: `${home}/Galaxy/Missions/zenith.log` },
    { id: "trainer", name: "Trainer", label: "ai.galaxy.trainer", log: `${galaxyHome}/trainer.log` },
    { id: "teach", name: "Teach", label: "ai.galaxy.teach", log: `${galaxyHome}/teach.log` },
    { id: "orbit", name: "Orbit", optional: true },
  ];
}

/** What Medic saw of one member in a checkup. */
export interface Observation {
  /** launchd: undefined = not a launchd member; null = not installed. */
  job?: { running: boolean; pid: number; lastExit: number | null } | null;
  /** Is the app's process running? */
  process?: boolean;
  /** Galaxy Link's record of it. null = it has never joined. */
  body?: { online: boolean; lastSeen: number } | null;
  /** The last lines of its log. */
  logTail?: string;
  /** Link only: does /v1/health answer? */
  answering?: boolean;
  /** Comet only: its own server's health check (null = no answer). */
  cometHealth?: { relays: number } | null;
  /** Comet only: it's installed as a launchd job in your session. */
  cometLocal?: boolean;
  /** Comet only: the Mac user it runs as, when that isn't you. */
  cometUser?: string;
  /** Trainer only: can it reach Claude? */
  trainerStatus?: { ok: boolean; reason: string } | null;
  /** Work it claimed and has gone quiet on. */
  stuck?: { id: string; title: string; minutes: number }[];
}

export type Health = "healthy" | "recovering" | "needs_you" | "off" | "unknown";

export type Action =
  | { kind: "kickstart"; label: string }
  | { kind: "open"; bundle: string };

export interface Problem {
  key: string;
  kind: string;
  title: string;
  found: string;
  /** Set when only you can fix it: exactly what to do. */
  fix?: string;
}

export interface Verdict {
  health: Health;
  note: string;
  problems: Problem[];
  /** Something Medic will do about it itself. */
  action?: Action;
}

/** Known failures, by what they leave in a log. */
export function readLog(tail = ""): { kind: string; what: string; fix?: string } | null {
  const t = tail.slice(-6000);
  if (/EADDRINUSE|address already in use|port \d+ in use|Is port \d+ in use/i.test(t)) {
    const port = /port (\d+)/i.exec(t)?.[1];
    return {
      kind: "port_conflict",
      what: `Something else is already using port ${port ?? "it needs"}.`,
      fix: port ? `See what's holding it: sudo lsof -nP -iTCP:${port} -sTCP:LISTEN` : undefined,
    };
  }
  if (/oauth|not logged in|log ?in required|authenticat|401|invalid api key|credential|setup-token/i.test(t)) {
    return { kind: "signed_out", what: "It's signed out of Claude.", fix: "galaxy login" };
  }
  if (/ENOENT|command not found|No such file or directory|Cannot find module|not found on PATH/i.test(t)) {
    return { kind: "missing", what: "Something it needs is missing (a program or a file).", fix: "Reinstall it: cd ~/GalaxyAI/NovaAI && galaxy/install-all.sh" };
  }
  if (/permission denied|EACCES|operation not permitted|Full Disk Access/i.test(t)) {
    return { kind: "permission", what: "macOS is refusing it permission for something.", fix: "Check System Settings › Privacy & Security for it" };
  }
  return null;
}

const lastLines = (tail = "", n = 6) => tail.trim().split("\n").slice(-n).join("\n");

/** Medic's verdict on one member, from what it saw. Pure: no side effects, so it can be tested. */
export function examine(spec: Spec, o: Observation, restartsRecently: number): Verdict {
  const fine = (note: string): Verdict => ({ health: "healthy", note, problems: [] });
  const off = (note: string): Verdict => ({ health: "off", note, problems: [] });
  const stuck = (o.stuck ?? []).map<Problem>((t) => ({
    key: `${spec.id}:stuck:${t.id}`,
    kind: "stuck",
    title: `${spec.name} has been on "${t.title}" for ${t.minutes} minutes without a word`,
    found: `It claimed the handoff ${t.id} and hasn't reported progress since.`,
    fix: `Check on ${spec.name}; if it's frozen, quit and reopen it. The handoff goes back in the queue when it restarts.`,
  }));
  const withStuck = (v: Verdict): Verdict => (stuck.length && v.health === "healthy" ? { ...v, health: "needs_you", note: stuck[0]!.title, problems: [...v.problems, ...stuck] } : v);

  // ---- Galaxy Link: everything else depends on it.
  if (spec.id === "link") {
    if (o.answering) return fine("Running");
    if (o.job === null) return { health: "needs_you", note: "Not installed", problems: [{ key: "link:missing", kind: "missing", title: "Galaxy Link isn't installed", found: "There's no ai.galaxy.link login agent.", fix: "cd ~/GalaxyAI/NovaAI && galaxy/install.sh" }] };
    return restartOrEscalate(spec, o, restartsRecently, "Galaxy Link isn't answering");
  }

  // ---- Orbit: quit most of the time, by design.
  if (spec.optional) return o.body?.online ? fine("Running") : off("Quit, which is normal");

  // ---- Comet: runs as its own Mac user, or as you.
  if (spec.id === "comet") {
    if (o.body?.online) {
      if (o.cometHealth && o.cometHealth.relays === 0) {
        return {
          health: "needs_you",
          note: "Its relay isn't connected",
          problems: [{ key: "comet:relay", kind: "relay", title: "Comet's relay isn't connected, so texts can't get in or out", found: "Comet's server says no relay is connected.", fix: o.cometUser ? `sudo pkill -u ${o.cometUser} -f "relay/src/index.ts"   (its login agent starts it again)` : "launchctl kickstart -k gui/$(id -u)/com.imessage.relay" }],
        };
      }
      return withStuck(fine("Running"));
    }
    if (o.body === null && !o.cometHealth) return off("Hasn't joined Galaxy yet");
    if (o.cometHealth) {
      return {
        health: "needs_you",
        note: "Answering texts, but not connected to Galaxy",
        problems: [{ key: "comet:link", kind: "not_linked", title: "Comet is running but isn't connected to Galaxy Link", found: "Its server answers on port 8787, but it hasn't checked in with Link.", fix: "Update it and give it Link's key: see galaxy/README.md, 'Comet running as its own Mac user'" }],
      };
    }
    if (o.cometLocal) return restartOrEscalate({ ...spec, label: "com.imessage.server" }, o, restartsRecently, "Comet isn't running");
    return {
      health: "needs_you",
      note: "Not running",
      problems: [{ key: "comet:down", kind: "crashed", title: "Comet isn't running, so texts aren't being answered", found: "Neither Galaxy Link nor Comet's own server has heard from it.", fix: o.cometUser ? `sudo pkill -u ${o.cometUser} -f "Available3/(server|relay)/src/index.ts"   (its login agent starts it again; if not, log in to that Mac user once)` : "cd ~/Available3 && ./scripts/install-launchd.sh" }],
    };
  }

  // ---- Mac apps: Nova, Nebula.
  if (spec.app) {
    if (o.body?.online) return withStuck(fine("Running"));
    if (!o.body) return off("Hasn't joined Galaxy yet");
    if (o.body.lastSeen === 0 && !o.process) return off("Quit");
    if (o.process) {
      return {
        health: "needs_you",
        note: "Open but not answering",
        problems: [{ key: `${spec.id}:frozen`, kind: "frozen", title: `${spec.name} is open but has stopped answering`, found: "Its window is up, but it hasn't checked in with Galaxy Link for a few minutes.", fix: `Quit ${spec.name} (⌘Q, or Force Quit) and open it again` }],
      };
    }
    // Gone without saying goodbye: it crashed. Reopen it, unless it keeps crashing.
    if (restartsRecently >= 3) return crashLoop(spec, o);
    return { health: "recovering", note: "Crashed; reopening it", problems: [{ key: `${spec.id}:crashed`, kind: "crashed", title: `${spec.name} crashed`, found: "It stopped without quitting." }], action: { kind: "open", bundle: spec.app.bundle } };
  }

  // ---- Background services: Zenith, Trainer.
  if (o.job === null) return off("Not installed");
  if (spec.id === "trainer" && o.trainerStatus && !o.trainerStatus.ok && o.job?.running) {
    return {
      health: "needs_you",
      note: "Can't reach Claude",
      problems: [{ key: "trainer:signin", kind: "signed_out", title: "The trainer can't reach Claude, so tonight's training won't run", found: o.trainerStatus.reason, fix: "galaxy login" }],
    };
  }
  if (o.job?.running && o.body?.online) return withStuck(fine("Running"));
  if (o.job?.running && !o.body?.online) {
    // Up for launchd but silent to Link: give it a few minutes, then treat it as crashed.
    return restartOrEscalate(spec, o, restartsRecently, `${spec.name} is running but not checking in`);
  }
  return restartOrEscalate(spec, o, restartsRecently, `${spec.name} stopped`);
}

function restartOrEscalate(spec: Spec, o: Observation, restartsRecently: number, title: string): Verdict {
  const known = readLog(o.logTail);
  // A restart won't fix a sign-in, a taken port or a missing program: say what will.
  if (known && known.kind !== "permission") {
    return {
      health: "needs_you",
      note: known.what,
      problems: [{ key: `${spec.id}:${known.kind}`, kind: known.kind, title: `${title}: ${known.what.replace(/\.$/, "").toLowerCase()}`, found: lastLines(o.logTail), fix: known.fix }],
    };
  }
  if (restartsRecently >= 3) return crashLoop(spec, o);
  return {
    health: "recovering",
    note: "Restarting it",
    problems: [{ key: `${spec.id}:down`, kind: "crashed", title, found: o.job?.lastExit ? `It exited with code ${o.job.lastExit}.${o.logTail ? `\n${lastLines(o.logTail)}` : ""}` : lastLines(o.logTail) }],
    action: { kind: "kickstart", label: spec.label! },
  };
}

function crashLoop(spec: Spec, o: Observation): Verdict {
  return {
    health: "needs_you",
    note: "Keeps crashing",
    problems: [
      {
        key: `${spec.id}:loop`,
        kind: "crash_loop",
        title: `${spec.name} keeps crashing, so I've stopped restarting it`,
        found: lastLines(o.logTail, 12) || "Nothing in its log.",
        fix: spec.log ? `Look at its log: tail -50 "${spec.log}"` : `Reopen ${spec.name} and watch what happens`,
      },
    ],
  };
}
