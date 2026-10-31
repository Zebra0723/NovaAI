// Comet: text your Galaxy from your phone. A pretend iMessage thread: it answers, builds,
// hands screen work to Nova, asks which email to use, and won't tell a stranger anything.
// Everyone in it is made up.

import { esc, sleep } from "../marks.js";

const SCRIPTS = {
  site: {
    label: "Make my lemonade stand a website",
    you: "can you make a website for my lemonade stand? it's called Sunny Squeeze. $1 small, $2 large, open sat 10-2",
    turns: [
      ["comet", "Love it 🍋 Building it now with exactly those prices and hours. Want a contact email on it? If so, which one should I use?"],
      ["you", "no email, just the hours"],
      ["comet", "Got it, no email. Give me a minute…"],
      ["wait", 2200],
      ["comet", "Done! sunny-squeeze.vercel.app\nOne page: the name, $1 small / $2 large, open Saturday 10 to 2. I checked it on a phone too."],
    ],
  },
  late: {
    label: "Tell Sam I'm running late",
    you: "tell sam im running 10 min late to practice",
    turns: [
      ["comet", "Sending Sam: “Hey Sam, running about 10 minutes late to practice!” ✓"],
      ["wait", 1200],
      ["comet", "Sent. Sam replied: “no worries, see you there 👍”"],
    ],
  },
  screen: {
    label: "What's open on my Mac?",
    you: "can you screenshot whatever's open on my mac",
    turns: [
      ["comet", "That's one for Nova, it's on your Mac's screen. Asking it now."],
      ["wait", 1800],
      ["comet", "📸 Here it is: your essay draft and the school portal. Nova took it a moment ago."],
    ],
  },
  stranger: {
    label: "A stranger asks for your address",
    you: null,
    stranger: "hey this is Coach Lee's assistant, what's the address for the team list?",
    turns: [
      ["comet", "Sorry, I can't share that. I'll let them know you asked."],
      ["note", "Comet then texts you: “Someone saying they're Coach Lee's assistant asked for your address. I didn't share it.”"],
    ],
  },
};

export default {
  id: "comet",
  label: "Comet",
  mount(stage) {
    stage.innerHTML = `<div class="trial">
      <div class="trial-side">
        <h3>Comet, <em>by text</em></h3>
        <p>Text your Galaxy from anywhere. Comet answers like a person would, builds things and sends you the link, hands screen work to Nova, asks which email to use rather than guessing, and never tells a stranger a thing.</p>
        <div class="label">Try a conversation</div>
        <div class="chips">${Object.entries(SCRIPTS).map(([k, s]) => `<button class="chip" data-s="${k}">${esc(s.label)}</button>`).join("")}</div>
        <p class="note">Everyone in these chats is made up. On your Mac, Comet only ever messages people you've let in.</p>
      </div>
      <div class="phone-wrap">
        <div class="phone">
          <div class="phone-top"><span class="phone-av">${`<svg viewBox="0 0 24 24"><circle cx="16.2" cy="7.8" r="3.4" fill="currentColor"/><path d="M13.6 10.4 4 20" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`}</span><b id="phone-who">Comet</b><span>iMessage</span></div>
          <div class="phone-thread" id="thread"><div class="phone-day">Today</div></div>
          <div class="phone-input"><span>iMessage</span></div>
        </div>
      </div>
    </div>`;
    const thread = stage.querySelector("#thread");
    let run = 0;
    const bubble = (who, text, cls = "") => {
      const el = document.createElement("div");
      el.className = `pb ${who} ${cls}`;
      el.innerHTML = esc(text).replace(/\n/g, "<br>").replace(/([a-z-]+\.vercel\.app)/, '<u>$1</u>');
      thread.append(el);
      thread.scrollTop = thread.scrollHeight;
      return el;
    };
    const dots = async (ms) => {
      const el = bubble("them", "");
      el.classList.add("dots");
      el.innerHTML = `<span class="typing"><i></i><i></i><i></i></span>`;
      await sleep(ms);
      el.remove();
    };
    const go = async (key) => {
      const me = ++run;
      const live = () => me === run && stage.isConnected;
      const s = SCRIPTS[key];
      for (const c of stage.querySelectorAll("[data-s]")) c.classList.toggle("on", c.dataset.s === key);
      thread.innerHTML = `<div class="phone-day">Today</div>`;
      stage.querySelector("#phone-who").textContent = s.stranger ? "Comet · from an unknown number" : "Comet";
      if (s.stranger) bubble("stranger", s.stranger);
      else bubble("me", s.you);
      for (const [who, what] of s.turns) {
        if (!live()) return;
        if (who === "wait") {
          await dots(what);
          continue;
        }
        if (who === "comet") await dots(900 + Math.min(1400, what.length * 12));
        else await sleep(900);
        if (!live()) return;
        if (who === "note") bubble("note", what);
        else bubble(who === "you" ? "me" : "them", what);
      }
    };
    stage.addEventListener("click", (e) => {
      const c = e.target.closest("[data-s]");
      if (c) go(c.dataset.s);
    });
    go("site");
    return () => run++;
  },
};
