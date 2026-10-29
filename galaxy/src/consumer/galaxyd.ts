#!/usr/bin/env bun
// galaxyd for the consumer edition: Galaxy Link, behind a Galaxy account.
//
// Until someone signs in it only serves the app's pages (which show the sign-in) and
// /v1/account. Once they do, it opens that account's own Galaxy, in its own folder,
// brings down what the account kept, and keeps it in sync. Sign out and it closes.
// Nothing here knows anyone else, and nothing is shared between accounts.

import { writeFileSync } from "node:fs";
import { Link } from "../link";
import { configuredPort, ensureHome, galaxyHome, paths, readOrCreateToken } from "../paths";
import { gate, handle, json } from "../server";
import { Store } from "../store";
import { Account, AccountError } from "./account";
import { Sync } from "./sync";

export interface ConsumerLink {
  account: Account;
  current(): Link | null;
  fetch(req: Request): Promise<Response>;
  open(): Promise<void>;
  close(): void;
}

/** The consumer galaxyd's state and request handling, without the network: tests drive it directly. */
export function consumerLink(token: string, account = new Account(galaxyHome()), sync = true): ConsumerLink {
  let link: Link | null = null;
  let store: Store | null = null;
  let syncer: Sync | null = null;

  const open = async () => {
    if (link || !account.signedIn) return;
    store = new Store(`${account.dataDir()}/galaxy.db`);
    link = new Link(store);
    if (sync) {
      syncer = new Sync(link, account);
      await syncer.start();
    }
    link.introduceIfDue();
  };
  const close = () => {
    syncer?.stop();
    store?.close();
    link = store = syncer = null;
  };

  const accountRoute = async (req: Request, path: string): Promise<Response> => {
    const input = async () => {
      const text = await req.text();
      if (text.length > 8192) throw new AccountError(413, "too big");
      return text ? JSON.parse(text) : {};
    };
    const status = () => ({ ...account.status(), sync: syncer ? { lastSyncedAt: syncer.lastSyncedAt, problem: syncer.lastError } : null });
    if (path === "/v1/account" && req.method === "GET") return json(status());
    // Who's signed in is the app's to change: only the Galaxy Link window, acting for you.
    if ((req.headers.get("x-galaxy-body") ?? "") !== "you" && req.method !== "GET") throw new AccountError(403, "only the Galaxy Link app can sign in or out");
    if (path === "/v1/account/signup" && req.method === "POST") {
      const { email, password } = await input();
      const r = await account.signUp(email, password);
      if (!r.needsConfirmation) await open();
      return json({ ...status(), ...r });
    }
    if (path === "/v1/account/signin" && req.method === "POST") {
      const { email, password } = await input();
      await account.signIn(email, password);
      await open();
      return json(status());
    }
    if (path === "/v1/account/signout" && req.method === "POST") {
      // Last changes go up first, then this Mac forgets the session and its Claude key.
      await syncer?.push().catch(() => {});
      close();
      await account.signOut();
      return json(status());
    }
    return json({ error: "not here" }, 404);
  };

  const fetchFn = async (req: Request): Promise<Response> => {
    const stop = gate(req, token);
    if (stop) return stop;
    const path = new URL(req.url).pathname;
    try {
      if (path === "/v1/account" || path.startsWith("/v1/account/")) return await accountRoute(req, path);
      if (!link) await open().catch(() => {});
      if (!link) return json({ error: "sign in to Galaxy first", signedOut: true }, 401);
      return await handle(link, token, req);
    } catch (error) {
      if (error instanceof AccountError) return json({ error: error.message }, error.status);
      if (error instanceof SyntaxError) return json({ error: "that isn't JSON" }, 400);
      console.error("galaxyd:", error);
      return json({ error: "something went wrong in Link" }, 500);
    }
  };

  return { account, current: () => link, fetch: fetchFn, open, close };
}

if (import.meta.main) {
  ensureHome();
  const token = readOrCreateToken();
  const port = configuredPort();
  const c = consumerLink(token);
  await c.open().catch((e) => console.error("galaxyd: couldn't open the account's Galaxy:", e.message));
  const server = Bun.serve({ port, hostname: "127.0.0.1", idleTimeout: 60, fetch: c.fetch });
  writeFileSync(paths.port, String(server.port) + "\n");
  console.log(`galaxyd (consumer): listening on 127.0.0.1:${server.port}, ${c.account.signedIn ? "signed in" : "waiting for sign-in"}`);
  const stop = () => {
    server.stop(true);
    c.close();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
