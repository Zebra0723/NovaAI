// Talking to galaxyd. The app's window hands over the token (it reads it from
// ~/Library/Application Support/Galaxy/token), so the page never holds a secret
// that a web server could serve.

function readToken() {
  if (window.__GALAXY__?.token) return window.__GALAXY__.token;
  // For trying the app in a browser on this Mac: open it once with #token=…
  const fromHash = location.hash.match(/token=([a-f0-9]{32,})/)?.[1];
  try {
    if (fromHash) {
      sessionStorage.setItem("galaxy-token", fromHash);
      history.replaceState(null, "", location.pathname);
    }
    return fromHash || sessionStorage.getItem("galaxy-token") || "";
  } catch {
    return fromHash || "";
  }
}

const TOKEN = readToken();

export class Offline extends Error {}

export async function call(method, path, body, { timeout = 10_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        // The app acts for you, not for a member: approvals it decides and
        // memories it adds are yours.
        "x-galaxy-body": "you",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError" && timeout > 20_000) return null; // a long poll that simply ran out
    throw new Offline(String(error));
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Link said ${res.status}`), { status: res.status });
  return data;
}

export const api = {
  overview: () => call("GET", "/v1/overview"),
  chat: (after = 0, wait = 0) =>
    call("GET", `/v1/chat?after=${after}&limit=400${wait ? `&wait=${wait}` : ""}`, undefined, { timeout: wait ? (wait + 10) * 1000 : 10_000 }),
  tasks: () => call("GET", "/v1/tasks"),
  events: (since) => call("GET", `/v1/events?since=${since}&limit=400`),
  memories: (q = "") => call("GET", `/v1/memory?limit=1000${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  remember: (text) => call("POST", "/v1/memory", { text, source: "user" }),
  updateMemory: (id, text) => call("PATCH", `/v1/memory/${id}`, { text }),
  forget: (id) => call("DELETE", `/v1/memory/${id}`),
  approvals: () => call("GET", "/v1/approvals?limit=60"),
  pending: (since = 0, wait = 0) =>
    call("GET", `/v1/approvals/pending?since=${since}${wait ? `&wait=${wait}` : ""}`, undefined, { timeout: wait ? (wait + 10) * 1000 : 10_000 }),
  decide: (id, approve) => call("POST", `/v1/approvals/${id}/decide`, { decision: approve ? "approve" : "reject", via: "app" }),
};
