import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Link } from "../src/link";
import { PresenceReader } from "../src/presence";
import { handle } from "../src/server";
import { Store } from "../src/store";
import { examine, readLog, specs, type Observation } from "../src/medic/doctor";
import { Medic, type System } from "../src/medic/medic";

const SPECS = specs("/Users/a", "/Users/a/Library/Application Support/Galaxy");
const spec = (id: string) => SPECS.find((s) => s.id === id)!;

describe("the doctor", () => {
  test("a background service that stopped is restarted", () => {
    const v = examine(spec("zenith"), { job: { running: false, pid: 0, lastExit: 1 }, body: { online: false, lastSeen: 5 }, logTail: "boom" }, 0);
    expect(v).toMatchObject({ health: "recovering", action: { kind: "kickstart", label: "ai.galaxy.zenith" } });
  });

  test("a restart won't fix a sign-in, so it says what will", () => {
    const v = examine(spec("zenith"), { job: { running: false, pid: 0, lastExit: 1 }, body: null, logTail: "Error: OAuth token has expired" }, 0);
    expect(v.health).toBe("needs_you");
    expect(v.action).toBeUndefined();
    expect(v.problems[0]).toMatchObject({ kind: "signed_out", fix: "galaxy login" });
  });

  test("a port taken by something else is named, with how to see what", () => {
    expect(readLog("error: Failed to start server. Is port 8787 in use?")).toMatchObject({ kind: "port_conflict" });
    expect(readLog("error: Failed to start server. Is port 8787 in use?")!.fix).toContain("8787");
  });

  test("an app you quit stays quit; one that crashed is reopened", () => {
    expect(examine(spec("nova"), { process: false, body: { online: false, lastSeen: 0 } }, 0)).toMatchObject({ health: "off" });
    expect(examine(spec("nova"), { process: false, body: { online: false, lastSeen: 123 } }, 0)).toMatchObject({ health: "recovering", action: { kind: "open", bundle: "ai.galaxy.nova" } });
  });

  test("an app that's open but silent is frozen: Medic asks you rather than killing it", () => {
    const v = examine(spec("nebula"), { process: true, body: { online: false, lastSeen: 123 } }, 0);
    expect(v.health).toBe("needs_you");
    expect(v.action).toBeUndefined();
  });

  test("three restarts in a row is a crash loop: Medic stops and tells you", () => {
    const v = examine(spec("trainer"), { job: { running: false, pid: 0, lastExit: 1 }, body: null, logTail: "weird" }, 3);
    expect(v).toMatchObject({ health: "needs_you", problems: [{ kind: "crash_loop" }] });
    expect(v.action).toBeUndefined();
  });

  test("Orbit being quit is normal, and is never started", () => {
    expect(examine(spec("orbit"), { body: { online: false, lastSeen: 9 } }, 0)).toMatchObject({ health: "off", problems: [] });
  });

  test("Comet on its own Mac user can't be restarted by Medic: it gives you the command", () => {
    const v = examine(spec("comet"), { body: { online: false, lastSeen: 9 }, cometHealth: null, cometLocal: false, cometUser: "cometai-by-dailyos" }, 0);
    expect(v.health).toBe("needs_you");
    expect(v.problems[0]!.fix).toContain("sudo pkill -u cometai-by-dailyos");
  });

  test("the trainer signed out of Claude needs galaxy login", () => {
    const v = examine(spec("trainer"), { job: { running: true, pid: 4, lastExit: 0 }, body: { online: true, lastSeen: 1 }, trainerStatus: { ok: false, reason: "not signed in" } }, 0);
    expect(v.problems[0]).toMatchObject({ fix: "galaxy login" });
  });

  test("work claimed and gone quiet on for 45 minutes is flagged", () => {
    const v = examine(spec("nova"), { process: true, body: { online: true, lastSeen: 1 }, stuck: [{ id: "t_1", title: "Tidy the desktop", minutes: 50 }] }, 0);
    expect(v.health).toBe("needs_you");
    expect(v.problems[0]!.title).toContain("Tidy the desktop");
  });
});

describe("Medic's rounds", () => {
  let store: Store;
  let link: Link;
  const TOKEN = "a".repeat(64);
  beforeEach(() => {
    store = new Store(":memory:");
    link = new Link(store, new PresenceReader(() => 10));
    link.launcher = () => {};
    link.hello("medic", {});
  });
  afterEach(() => store.close());

  const call = async <T>(method: string, path: string, data?: unknown): Promise<T | null> => {
    const res = await handle(link, TOKEN, new Request("http://127.0.0.1:7740" + path, { method, body: data === undefined ? undefined : JSON.stringify(data), headers: { authorization: `Bearer ${TOKEN}`, "x-galaxy-body": "medic", host: "127.0.0.1:7740" } }));
    return res.ok ? ((await res.json()) as T) : null;
  };

  /** A Mac where Zenith has stopped, and comes back once kickstarted. */
  function mac() {
    let zenithUp = false;
    const ran: string[] = [];
    const sys: System = {
      now: () => store.now(),
      sh: async (cmd) => {
        ran.push(cmd);
        if (cmd.includes("kickstart -k gui/$(id -u)/ai.galaxy.zenith")) {
          zenithUp = true;
          link.hello("zenith", {});
          return { code: 0, out: "" };
        }
        if (cmd.includes("print gui/$(id -u)/ai.galaxy.zenith")) return { code: 0, out: zenithUp ? "state = running\npid = 42" : "state = not running\nlast exit code = 1" };
        if (cmd.startsWith("launchctl print")) return { code: 113, out: "" };
        if (cmd.startsWith("pgrep")) return { code: 1, out: "" };
        if (cmd === "id -un") return { code: 0, out: "avj" };
        return { code: 0, out: "" };
      },
      http: async () => null,
      tail: () => "",
    };
    return { sys, ran };
  }

  test("it restarts a stopped service on the second look, then closes the incident once it's back", async () => {
    link.hello("zenith", {});
    store.touchBody("zenith");
    const clock = store.now();
    store.now = () => clock + 10 * 60_000; // Zenith went silent ten minutes ago
    const { sys, ran } = mac();
    const medic = new Medic({ sys, call, specs: SPECS });

    const first = await medic.round();
    expect(first.verdicts.zenith!.health).toBe("unknown"); // one bad look could be a blip
    expect(ran.some((c) => c.includes("kickstart"))).toBe(false);

    const second = await medic.round();
    expect(second.acted).toContain("zenith: kickstart");
    expect(link.medicine.overview().open.map((i) => i.key)).toContain("zenith:down");

    const third = await medic.round();
    expect(third.verdicts.zenith!.health).toBe("healthy");
    const o = link.medicine.overview();
    expect(o.open.map((i) => i.key)).not.toContain("zenith:down");
    expect(o.recent[0]).toMatchObject({ key: "zenith:down", status: "fixed" });
    expect(o.checkup!.members.find((m) => m.member === "zenith")!.health).toBe("healthy");
    expect(store.chat().some((m) => m.body === "medic" && m.text.startsWith("Fixed: Zenith stopped"))).toBe(true);
  });

  test("something only you can fix reaches you once, not every minute", async () => {
    const { sys } = mac();
    sys.tail = () => "OAuth token has expired";
    const medic = new Medic({ sys, call, specs: SPECS });
    for (let i = 0; i < 4; i++) await medic.round();
    const delivered = store.takeInbox("comet").concat(store.takeInbox("nova")).filter((m) => m.text.includes("Galaxy Medic"));
    expect(delivered.length).toBe(1);
    expect(link.medicine.overview().open.find((i) => i.member === "zenith")!.fix).toBe("galaxy login");
  });

  test("only Medic reports checkups", async () => {
    const res = await handle(link, TOKEN, new Request("http://127.0.0.1:7740/v1/medic/checkup", { method: "PUT", body: "{}", headers: { authorization: `Bearer ${TOKEN}`, "x-galaxy-body": "comet", host: "127.0.0.1:7740" } }));
    expect(res.status).toBe(403);
  });
});
