// Orbit: talk to it (your browser's own speech recognition, or type), and it answers out
// loud in a sentence or two. Muted, it says nothing at all, even when a result arrives.

import { esc } from "../marks.js";

const MIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`;

function reply(said) {
  const s = said.toLowerCase();
  const now = new Date();
  if (/time/.test(s)) return `It's ${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
  if (/day|date/.test(s)) return `It's ${now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}.`;
  if (/weather|rain|cold|hot/.test(s)) return "I can't see the weather in this preview, but on your Mac I'd check it and tell you in a sentence.";
  if (/remind/.test(s)) return "Done. I'll put it on your screen when it's time, rather than saying it out loud.";
  if (/\btext\b|message/.test(s)) return "That's one for Comet. It'll send it in your words and tell you when it's gone.";
  if (/screenshot|file|folder|open|screen|click/.test(s)) return "That's one for Nova. I've handed it over, and it'll show you on screen when it's done.";
  if (/website|build|research|plan/.test(s)) return "That's a mission, so it's going to Zenith. It'll bring back something finished.";
  if (/joke/.test(s)) return "Why did the Mac go to therapy? Too many unresolved windows.";
  if (/who are you|what are you|your name/.test(s)) return "I'm Orbit, the voice of your Galaxy. I only speak when you speak to me.";
  if (/thank/.test(s)) return "Anytime.";
  if (/hello|hi\b|hey/.test(s)) return "Hi! What can I do for you?";
  return "Got it. On your Mac I'd answer that or hand it to the right member, in a sentence or two.";
}

export default {
  id: "orbit",
  label: "Orbit",
  mount(stage) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    stage.innerHTML = `<div class="trial">
      <div class="trial-side">
        <h3>Orbit, <em>out loud</em></h3>
        <p>Press the button and talk${Recognition ? "" : " (or type: your browser can't listen)"}. Orbit answers in a sentence or two, made for the ear, and hands anything else to the right member.</p>
        <div class="label">Try saying</div>
        <div class="chips">${["What time is it?", "Remind me to call Sam at 5", "Take a screenshot of my screen", "Build me a study app", "Tell me a joke"].map((s) => `<button class="chip" data-say="${esc(s)}">${esc(s)}</button>`).join("")}</div>
        <div class="label">The golden rule</div>
        <p style="margin-top:0">Orbit only speaks when spoken to. Mute it, then press <b>A result arrives</b>: it stays silent and the result goes on screen.</p>
        <p class="note">Speech recognition and the voice are your browser's own. Nothing is sent from this page.</p>
      </div>
      <div class="window">
        <div class="window-bar"><i></i><i></i><i></i><span>Orbit</span></div>
        <div class="window-body">
          <div class="orbit-stage">
            <button class="mic" id="mic" aria-label="Talk to Orbit">${MIC}</button>
            <div class="orbit-said" id="said" aria-live="polite"><div class="heard">Press and speak</div></div>
            ${Recognition ? "" : `<form class="composer" id="orbit-form" style="border:0;background:none;width:min(420px,100%)"><input id="orbit-type" placeholder="Type what you'd say…"><button class="btn btn-dark sm">Say</button></form>`}
            <div class="orbit-row">
              <label class="switch"><input type="checkbox" id="mute"> Muted</label>
              <button class="btn btn-line xs" id="arrives">A result arrives</button>
            </div>
            <div id="toast"></div>
          </div>
        </div>
      </div>
    </div>`;
    const mic = stage.querySelector("#mic");
    const said = stage.querySelector("#said");
    const mute = stage.querySelector("#mute");
    const toast = stage.querySelector("#toast");
    let rec = null;

    const speak = (text) => {
      if (mute.checked) return; // muted: never a word
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.03;
        speechSynthesis.speak(u);
      } catch {}
    };
    const answer = (heard) => {
      const r = reply(heard);
      said.innerHTML = `<div class="heard">“${esc(heard)}”</div><div class="reply">${esc(mute.checked ? "(muted: Orbit stays silent)" : r)}</div>`;
      speak(r);
    };

    mic.addEventListener("click", () => {
      if (mute.checked) {
        said.innerHTML = `<div class="heard">Muted</div><div class="reply">Unmute Orbit to talk to it.</div>`;
        return;
      }
      if (!Recognition) return stage.querySelector("#orbit-type")?.focus();
      if (rec) return rec.stop();
      rec = new Recognition();
      rec.lang = navigator.language || "en-US";
      rec.interimResults = true;
      mic.classList.add("listening");
      said.innerHTML = `<div class="heard">Listening…</div>`;
      let last = "";
      rec.onresult = (e) => {
        last = [...e.results].map((r) => r[0].transcript).join(" ");
        said.innerHTML = `<div class="heard">“${esc(last)}”</div>`;
      };
      rec.onend = () => {
        mic.classList.remove("listening");
        rec = null;
        if (last) answer(last);
        else said.innerHTML = `<div class="heard">Didn't catch that. Press and try again.</div>`;
      };
      rec.onerror = () => {
        mic.classList.remove("listening");
        rec = null;
        said.innerHTML = `<div class="heard">The microphone isn't available. Try the suggestions instead.</div>`;
      };
      rec.start();
    });
    stage.querySelector("#orbit-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const t = stage.querySelector("#orbit-type");
      if (t.value.trim()) answer(t.value.trim());
      t.value = "";
    });
    mute.addEventListener("change", () => {
      mic.classList.toggle("muted", mute.checked);
      if (mute.checked) speechSynthesis?.cancel?.();
    });
    stage.querySelector("#arrives").addEventListener("click", () => {
      // A result from another member. Orbit never reads results aloud: they go on screen.
      toast.innerHTML = `<div class="screen-toast">On screen · Nova finished “Tidy my desktop”: 34 screenshots moved. Orbit didn't say a word.</div>`;
      setTimeout(() => (toast.innerHTML = ""), 4500);
    });
    stage.addEventListener("click", (e) => {
      const c = e.target.closest("[data-say]");
      if (c) answer(c.dataset.say);
    });
    mic.classList.toggle("muted", mute.checked);
    return () => {
      try {
        rec?.abort();
        speechSynthesis.cancel();
      } catch {}
    };
  },
};
