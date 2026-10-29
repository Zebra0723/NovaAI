// The consumer edition's Galaxy account: the sign-in (or create-an-account) screen
// before anything else, and the account chip at the bottom of the sidebar.
// One account for Galaxy Link and every member; everything is kept in it.

import { call } from "./api.js";
import { brandMark } from "./marks.js";
import { esc, toast } from "./util.js";

let account = null;

/** Waits here until someone is signed in. */
export async function accountGate() {
  for (;;) {
    try {
      account = await call("GET", "/v1/account");
      if (account?.signedIn) return account;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 2000)); // Link starting up
    }
  }
  await new Promise((done) => drawGate(done));
  return account;
}

function drawGate(done) {
  let mode = "signin";
  const root = document.createElement("div");
  root.className = "gate";
  document.body.append(root);
  const draw = (note = "") => {
    const signup = mode === "signup";
    root.innerHTML = `<div class="gate-card">
      ${brandMark("gate-mark")}
      <h1>${signup ? "Make your <em>Galaxy</em>" : "Welcome to <em>Galaxy</em>"}</h1>
      <p class="gate-sub">${signup ? "One account for Galaxy Link and every member. Your memories and settings are kept in it, and only you can see them." : "Sign in to your Galaxy account. One account works for every member."}</p>
      ${account && !account.configured ? `<p class="gate-note bad">This copy of Galaxy isn't connected to its account service yet.</p>` : ""}
      <form id="gate-form">
        <label>Email<input id="gate-email" type="email" autocomplete="email" required></label>
        <label>Password<input id="gate-password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="8" required></label>
        <button class="btn primary big" type="submit">${signup ? "Create account" : "Sign in"}</button>
      </form>
      ${note ? `<p class="gate-note">${note}</p>` : ""}
      <p class="gate-switch">${signup ? "Already have an account?" : "New to Galaxy?"} <a href="#" id="gate-mode">${signup ? "Sign in" : "Create an account"}</a></p>
    </div>`;
    root.querySelector("#gate-mode").onclick = (e) => {
      e.preventDefault();
      mode = signup ? "signin" : "signup";
      draw();
    };
    root.querySelector("#gate-form").onsubmit = async (e) => {
      e.preventDefault();
      const email = root.querySelector("#gate-email").value.trim();
      const password = root.querySelector("#gate-password").value;
      const button = root.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        const r = await call("POST", signup ? "/v1/account/signup" : "/v1/account/signin", { email, password });
        account = r;
        if (r.needsConfirmation) {
          mode = "signin";
          return draw(`Check <b>${esc(email)}</b> for a link to confirm your account, then sign in here.`);
        }
        root.remove();
        done();
      } catch (error) {
        draw(`<span class="bad">${esc(error.message)}</span>`);
      }
    };
  };
  draw();
}

/** Who's signed in, and Sign out, at the foot of the sidebar. */
export function mountAccountChip() {
  const foot = document.querySelector(".sidebar-foot");
  if (!foot || !account?.user) return;
  const chip = document.createElement("div");
  chip.className = "account-chip";
  chip.innerHTML = `<span class="who-email" title="${esc(account.user.email)}">${esc(account.user.email)}</span><button class="btn sm" id="sign-out">Sign out</button>`;
  foot.prepend(chip);
  chip.querySelector("#sign-out").onclick = async () => {
    if (!confirm("Sign out of Galaxy on this Mac? Everything stays in your account.")) return;
    try {
      await call("POST", "/v1/account/signout", {});
      location.reload();
    } catch (error) {
      toast(error.message);
    }
  };
}
