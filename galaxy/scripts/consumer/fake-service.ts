// A stand-in for Galaxy's Supabase project, for tests and for trying the consumer edition
// on your own Mac without one: accounts, and rows that belong to one account each.
//
//   bun scripts/consumer/fake-service.ts      serves it on http://127.0.0.1:7790 (anon key "anon")

/** A stand-in for the Supabase project: accounts, and rows that belong to one account each. */
export function fakeService() {
  const users = new Map<string, { id: string; password: string }>();
  const tokens = new Map<string, string>(); // access token -> user id
  const rows = { memories: [] as any[], documents: [] as any[] };
  const keys = new Map<string, string>();
  let n = 0;
  const session = (email: string) => {
    const u = users.get(email)!;
    const access = `at_${++n}`;
    tokens.set(access, u.id);
    return { access_token: access, refresh_token: `rt_${n}`, expires_in: 3600, user: { id: u.id, email } };
  };
  const fetcher = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const bearer = String((init.headers as any)?.authorization ?? "").replace("Bearer ", "");
    const who = tokens.get(bearer);
    const ok = (v: unknown, status = 200) => new Response(v === undefined ? "" : JSON.stringify(v), { status });
    if (u.pathname === "/auth/v1/signup") {
      if (users.has(body.email)) return ok({ msg: "User already registered" }, 422);
      users.set(body.email, { id: crypto.randomUUID(), password: body.password });
      return ok(session(body.email));
    }
    if (u.pathname === "/auth/v1/token") {
      const user = users.get(body.email);
      if (!user || user.password !== body.password) return ok({ error_description: "Invalid login credentials" }, 400);
      return ok(session(body.email));
    }
    if (u.pathname === "/auth/v1/logout") return ok({});
    if (u.pathname === "/functions/v1/device-key") {
      if (!who) return ok({ error: "sign in first" }, 401);
      if (init.method === "DELETE") return ok({ ok: true });
      const key = `gx_${++n}`;
      keys.set(key, who);
      return ok({ key });
    }
    const table = u.pathname.replace("/rest/v1/", "") as "memories" | "documents";
    if (!who) return ok({ message: "JWT required" }, 401);
    // Row-level security: only ever this account's rows.
    const mine = rows[table].filter((r) => r.user_id === who);
    if (init.method === "GET") {
      const key = u.searchParams.get("key");
      return ok(key ? mine.filter((r) => `eq.${r.key}` === key) : mine);
    }
    if (init.method === "POST") {
      for (const r of body) {
        const id = table === "memories" ? "id" : "key";
        rows[table] = rows[table].filter((x) => !(x.user_id === who && x[id] === r[id]));
        rows[table].push({ ...r, user_id: who });
      }
      return ok(undefined, 201);
    }
    if (init.method === "DELETE") {
      const ids = (u.searchParams.get("id") ?? "").replace(/^in\.\(|\)$/g, "").split(",");
      rows.memories = rows.memories.filter((r) => !(r.user_id === who && ids.includes(r.id)));
      return ok(undefined, 204);
    }
    return ok({ message: "not here" }, 404);
  };
  return { fetcher, rows, keys };
}


if (import.meta.main) {
  const { fetcher } = fakeService();
  const server = Bun.serve({
    port: Number(process.env.PORT ?? 7790),
    hostname: "127.0.0.1",
    fetch: async (req) => {
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();
      return fetcher(req.url, { method: req.method, headers: Object.fromEntries(req.headers), body: body || undefined });
    },
  });
  console.log(`fake Galaxy service on http://127.0.0.1:${server.port} (anon key "anon")`);
}
