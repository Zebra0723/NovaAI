// Gives a signed-in Mac its key for Claude (POST), or takes it back on sign-out (DELETE).
// Only a hash of the key is kept here.

import { db, json, sha256, SUPABASE_URL } from "../_shared.ts";

Deno.serve(async (req) => {
  // Who's asking: the account behind the sign-in token.
  const auth = req.headers.get("authorization") ?? "";
  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { authorization: auth, apikey: Deno.env.get("SUPABASE_ANON_KEY")! },
  });
  if (!who.ok) return json({ error: "sign in first" }, 401);
  const user = await who.json();
  let body: any = {};
  try {
    body = await req.json();
  } catch {}

  if (req.method === "POST") {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const key = "gx_" + btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]!);
    await db("POST", "device_keys", { user_id: user.id, key_hash: await sha256(key), name: String(body.name ?? "Mac").slice(0, 60) }, "return=minimal");
    return json({ key });
  }
  if (req.method === "DELETE") {
    // This Mac's key if it says which, else every key the account has.
    const filter = typeof body.key === "string" && body.key.startsWith("gx_") ? `&key_hash=eq.${await sha256(body.key)}` : "";
    await db("PATCH", `device_keys?user_id=eq.${user.id}${filter}`, { revoked: true }, "return=minimal");
    return json({ ok: true });
  }
  return json({ error: "not here" }, 404);
});
