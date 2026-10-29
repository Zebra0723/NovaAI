// The consumer edition's Galaxy account: one sign-in for Galaxy Link and every member.
//
// Accounts live in Supabase (consumer/supabase). Signing in here keeps the session in
// account.json and a device key for Claude in ai.json, both readable by this Mac user
// alone; every member reads ai.json to think, so nobody signs in twice. Signing out
// deletes both and revokes the device key.

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { consumerService } from "../edition";

export interface Session {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  /** ms since epoch. */
  expiresAt: number;
}

/** What every member needs to reach Claude through the Galaxy proxy. */
export interface AiAccess {
  baseUrl: string;
  apiKey: string;
}

export class AccountError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class Account {
  private session: Session | null = null;

  constructor(
    private readonly home: string,
    private readonly service = consumerService(),
    private readonly fetcher: Fetch = (i, init) => fetch(i, init),
    private readonly now: () => number = Date.now,
  ) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    try {
      this.session = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {}
  }

  private get file() {
    return join(this.home, "account.json");
  }
  get aiFile() {
    return join(this.home, "ai.json");
  }

  get signedIn() {
    return !!this.session;
  }
  get user() {
    return this.session ? { id: this.session.userId, email: this.session.email } : null;
  }

  /** The folder this account's Galaxy lives in. Each account has its own; they never mix. */
  dataDir(): string {
    if (!this.session) throw new AccountError(401, "not signed in");
    const dir = join(this.home, "accounts", this.session.userId.replace(/[^a-zA-Z0-9-]/g, ""));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
  }

  status() {
    return {
      signedIn: this.signedIn,
      user: this.user,
      configured: !!(this.service.url && this.service.anonKey),
      ai: existsSync(this.aiFile),
    };
  }

  // ---------------------------------------------------------------- sign in

  async signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }> {
    const r = await this.auth("/auth/v1/signup", { email: clean(email), password: String(password ?? "") });
    if (r.access_token) {
      await this.adopt(r);
      return { needsConfirmation: false };
    }
    // The project asks new accounts to confirm their email first.
    return { needsConfirmation: true };
  }

  async signIn(email: string, password: string) {
    const r = await this.auth("/auth/v1/token?grant_type=password", { email: clean(email), password: String(password ?? "") });
    await this.adopt(r);
    return this.status();
  }

  async signOut() {
    const token = this.session?.accessToken;
    if (token) {
      // Revoke this Mac's Claude key and end the session. Signed out here either way.
      let key = "";
      try {
        key = JSON.parse(readFileSync(this.aiFile, "utf8")).apiKey ?? "";
      } catch {}
      await this.call("DELETE", "/functions/v1/device-key", { key }, token).catch(() => null);
      await this.call("POST", "/auth/v1/logout", {}, token).catch(() => null);
    }
    this.session = null;
    rmSync(this.file, { force: true });
    rmSync(this.aiFile, { force: true });
    return this.status();
  }

  /** A current access token, refreshed when it's near its end. */
  async accessToken(): Promise<string> {
    if (!this.session) throw new AccountError(401, "not signed in");
    if (this.session.expiresAt - this.now() > 60_000) return this.session.accessToken;
    try {
      const r = await this.auth("/auth/v1/token?grant_type=refresh_token", { refresh_token: this.session.refreshToken });
      this.save(r);
    } catch (e) {
      // A refresh token that's no longer good means signing in again.
      if (e instanceof AccountError && e.status >= 400 && e.status < 500) {
        this.session = null;
        rmSync(this.file, { force: true });
        rmSync(this.aiFile, { force: true });
      }
      throw e;
    }
    return this.session!.accessToken;
  }

  /** The Galaxy proxy and this Mac's device key, made once per sign-in. */
  async ai(): Promise<AiAccess> {
    try {
      return JSON.parse(readFileSync(this.aiFile, "utf8"));
    } catch {}
    const token = await this.accessToken();
    const r = await this.call("POST", "/functions/v1/device-key", { name: "Mac" }, token);
    if (!r?.key) throw new AccountError(502, "the Galaxy service didn't give this Mac a key");
    const access: AiAccess = { baseUrl: `${this.service.url}/functions/v1/claude`, apiKey: r.key };
    writeFileSync(this.aiFile, JSON.stringify(access), { mode: 0o600 });
    chmodSync(this.aiFile, 0o600);
    return access;
  }

  // ---------------------------------------------------------------- helpers

  private async adopt(r: any) {
    this.save(r);
    await this.ai().catch((e) => console.error("galaxyd: couldn't get a Claude key yet:", e.message));
  }

  private save(r: any) {
    if (!r?.access_token || !r?.user?.id) throw new AccountError(502, "the Galaxy service sent back something odd");
    this.session = {
      userId: r.user.id,
      email: r.user.email ?? "",
      accessToken: r.access_token,
      refreshToken: r.refresh_token,
      expiresAt: this.now() + (Number(r.expires_in) || 3600) * 1000,
    };
    writeFileSync(this.file, JSON.stringify(this.session), { mode: 0o600 });
    chmodSync(this.file, 0o600);
  }

  private auth(path: string, body: unknown) {
    return this.call("POST", path, body);
  }

  /** A call to the Galaxy service. Errors come back in plain words. */
  async call(method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}): Promise<any> {
    if (!this.service.url || !this.service.anonKey) throw new AccountError(503, "this Galaxy isn't connected to an account service yet");
    let res: Response;
    try {
      res = await this.fetcher(this.service.url + path, {
        method,
        headers: {
          apikey: this.service.anonKey,
          authorization: `Bearer ${token ?? this.service.anonKey}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new AccountError(503, "can't reach the Galaxy service. Are you online?");
    }
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    if (!res.ok) {
      const said = data?.msg || data?.error_description || data?.message || data?.error || text.slice(0, 200);
      throw new AccountError(res.status, friendly(String(said || res.statusText)));
    }
    return data;
  }
}

const clean = (s: unknown) => String(s ?? "").trim().toLowerCase().slice(0, 200);

function friendly(said: string): string {
  if (/invalid login credentials/i.test(said)) return "That email and password don't match an account.";
  if (/email not confirmed/i.test(said)) return "Confirm your email first: there's a link in your inbox.";
  if (/already registered|already exists/i.test(said)) return "There's already an account with that email. Sign in instead.";
  if (/password/i.test(said) && /(short|least|weak)/i.test(said)) return "Pick a longer password (at least 8 characters).";
  return said;
}
