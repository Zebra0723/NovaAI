// The Galaxy's way to Claude. Members call it exactly like the Anthropic API (it's their
// ANTHROPIC_BASE_URL), with their Mac's device key; it checks the key, the account's
// daily allowance and the model, and passes the request on with Galaxy's own API key,
// which never leaves this function.
//
// Settings (supabase secrets set ...):
//   ANTHROPIC_API_KEY     required
//   DAILY_TOKEN_LIMIT     tokens per account per day, input and output together (default 3000000)
//   ALLOWED_MODELS        comma-separated model name prefixes (default claude-sonnet,claude-haiku)
//   DEFAULT_MODEL         what anything else is switched to (default claude-sonnet-5-5)

import { db, json, sha256 } from "../_shared.ts";

const ANTHROPIC = "https://api.anthropic.com";
const LIMIT = Number(Deno.env.get("DAILY_TOKEN_LIMIT") ?? 3_000_000);
const ALLOWED = (Deno.env.get("ALLOWED_MODELS") ?? "claude-sonnet,claude-haiku").split(",").map((s) => s.trim()).filter(Boolean);
const DEFAULT_MODEL = Deno.env.get("DEFAULT_MODEL") ?? "claude-sonnet-5-5";
const PATHS = ["/v1/messages", "/v1/messages/count_tokens", "/v1/models"];

const anthropicError = (status: number, message: string, type = "permission_error") =>
  json({ type: "error", error: { type, message } }, status);

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/claude/, "") || "/";
  if (!PATHS.some((p) => path === p || path.startsWith(p + "/"))) return anthropicError(404, "not here", "not_found_error");

  // The device key, however the SDK sends it.
  const key = req.headers.get("x-api-key") ?? (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!key.startsWith("gx_")) return anthropicError(401, "Sign in to Galaxy in Galaxy Link.", "authentication_error");
  const [device] = (await db("GET", `device_keys?key_hash=eq.${await sha256(key)}&revoked=eq.false&select=id,user_id`)) ?? [];
  if (!device) return anthropicError(401, "This Mac is signed out of Galaxy. Sign in again in Galaxy Link.", "authentication_error");

  const today = new Date().toISOString().slice(0, 10);
  const [usage] = (await db("GET", `ai_usage?user_id=eq.${device.user_id}&day=eq.${today}&select=input_tokens,output_tokens`)) ?? [];
  if (usage && Number(usage.input_tokens) + Number(usage.output_tokens) >= LIMIT) {
    return anthropicError(429, "Today's Galaxy allowance is used up. It resets at midnight UTC.", "rate_limit_error");
  }

  let body: string | undefined;
  if (req.method === "POST") {
    const parsed = await req.json().catch(() => null);
    if (!parsed) return anthropicError(400, "that isn't JSON", "invalid_request_error");
    if (typeof parsed.model === "string" && !ALLOWED.some((p) => parsed.model.startsWith(p))) parsed.model = DEFAULT_MODEL;
    body = JSON.stringify(parsed);
  }
  const headers: Record<string, string> = {
    "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
    "anthropic-version": req.headers.get("anthropic-version") ?? "2023-06-01",
    "content-type": "application/json",
  };
  const beta = req.headers.get("anthropic-beta");
  if (beta) headers["anthropic-beta"] = beta;
  const upstream = await fetch(ANTHROPIC + path + url.search, { method: req.method, headers, body });

  const record = (input: number, output: number) =>
    db("POST", "rpc/add_ai_usage", { p_user: device.user_id, p_in: input, p_out: output }).catch((e) => console.error(e.message));
  const passOn = new Headers({ "content-type": upstream.headers.get("content-type") ?? "application/json" });
  const requestId = upstream.headers.get("request-id");
  if (requestId) passOn.set("request-id", requestId);

  if (!path.startsWith("/v1/messages") || path.endsWith("count_tokens") || !upstream.body) {
    return new Response(upstream.body, { status: upstream.status, headers: passOn });
  }

  // Streamed: pass every byte straight on, and read the token counts as they go past.
  if ((upstream.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const [toClient, toCount] = upstream.body.tee();
    const counting = (async () => {
      let input = 0, output = 0, buffer = "";
      const reader = toCount.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const event = JSON.parse(line.slice(5));
            const u = event.message?.usage ?? event.usage;
            if (u) {
              input = Math.max(input, (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0));
              output = Math.max(output, u.output_tokens ?? 0);
            }
          } catch {}
        }
      }
      await record(input, output);
    })();
    // @ts-ignore: EdgeRuntime is Supabase's, and keeps the count going after the response ends.
    globalThis.EdgeRuntime?.waitUntil?.(counting);
    return new Response(toClient, { status: upstream.status, headers: passOn });
  }

  const text = await upstream.text();
  try {
    const u = JSON.parse(text).usage;
    if (u) await record((u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), u.output_tokens ?? 0);
  } catch {}
  return new Response(text, { status: upstream.status, headers: passOn });
});
