// Nebula: real hand tracking from your camera, in your browser (MediaPipe Hand Landmarker).
// Hold a gesture for half a second and it fires; an unclear hand does nothing, which is the
// point. No camera? The gesture buttons below do the same thing.

import { esc } from "../marks.js";

const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const HOLD_MS = 500;
const COOLDOWN_MS = 1300;

const GESTURES = {
  palm: { emoji: "✋", name: "Open palm", does: "Paused what's playing" },
  up: { emoji: "👍", name: "Thumbs up", does: "Approved: Zenith may spend $12 on the domain" },
  down: { emoji: "👎", name: "Thumbs down", does: "Declined: Zenith won't buy the domain" },
  peace: { emoji: "✌️", name: "Peace", does: "Took a screenshot of the front window" },
  fist: { emoji: "✊", name: "Fist", does: "Muted the Mac" },
};

const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Which gesture a hand is making, or null when it isn't clearly one. */
export function classify(lm) {
  const wrist = lm[0];
  const ext = (tip, pip) => d(lm[tip], wrist) > d(lm[pip], wrist) * 1.12;
  const index = ext(8, 6), middle = ext(12, 10), ring = ext(16, 14), pinky = ext(20, 18);
  const thumb = d(lm[4], lm[17]) > d(lm[3], lm[17]) * 1.08 && d(lm[4], lm[9]) > d(lm[5], lm[9]) * 1.1;
  const fingers = [index, middle, ring, pinky].filter(Boolean).length;
  if (fingers === 4 && thumb) return "palm";
  if (index && middle && !ring && !pinky) return "peace";
  if (fingers === 0 && thumb) {
    const rise = lm[2].y - lm[4].y; // up is smaller y
    const size = d(lm[0], lm[9]);
    if (rise > size * 0.55) return "up";
    if (-rise > size * 0.55) return "down";
    return null;
  }
  if (fingers === 0 && !thumb) return "fist";
  return null;
}

const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

export default {
  id: "nebula",
  label: "Nebula",
  mount(stage) {
    stage.innerHTML = `<div class="trial">
      <div class="trial-side">
        <h3>Nebula, <em>in your hands</em></h3>
        <p>Switch on your camera and hold up a gesture for half a second. Nebula fires only on a clear, deliberate one, so waving at someone or pointing at the screen does nothing.</p>
        <div class="label">Gestures</div>
        <div class="chips">${Object.values(GESTURES).map((g) => `<span class="chip" style="cursor:default">${g.emoji} ${esc(g.name)}</span>`).join("")}</div>
        <div class="label">Waiting for your answer</div>
        <p style="margin-top:0" id="neb-question">Zenith asks: <b>Spend $12 on a domain for the team site?</b> Thumbs up or down.</p>
        <p class="note">Your camera picture stays in this browser tab. Nothing is recorded or sent.</p>
      </div>
      <div class="window">
        <div class="window-bar"><i></i><i></i><i></i><span>Nebula</span></div>
        <div class="window-body">
          <div class="cam" id="cam">
            <div class="placeholder" id="cam-placeholder">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="16.4" r="2.4" fill="currentColor"/><path d="M7.4 13.2a6.2 6.2 0 0 1 9.2 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"/><path d="M4.2 10.2a10.6 10.6 0 0 1 15.6 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none" opacity=".55"/></svg>
              <b>Nebula is off</b>
              <p>Switch it on to use your camera. On your Mac this is Fn+F1.</p>
              <button class="btn btn-light sm" id="cam-on">Switch on camera</button>
            </div>
          </div>
          <div class="neb-board">${Object.entries(GESTURES).map(([k, g]) => `<button class="neb-g" data-g="${k}" title="Try it without a camera"><b>${g.emoji}</b>${esc(g.name)}</button>`).join("")}</div>
        </div>
      </div>
    </div>`;
    const cam = stage.querySelector("#cam");
    let stream = null, landmarker = null, raf = 0, alive = true;
    let held = null, heldSince = 0, lastFire = 0, answered = false;

    const fire = (k) => {
      const g = GESTURES[k];
      const now = performance.now();
      if (now - lastFire < COOLDOWN_MS) return;
      lastFire = now;
      let does = g.does;
      if (k === "up" || k === "down") {
        if (answered) does = "No question waiting, so nothing happened";
        else {
          answered = true;
          stage.querySelector("#neb-question").innerHTML = k === "up" ? "Zenith's question: <b>approved</b> with a thumbs up." : "Zenith's question: <b>declined</b> with a thumbs down.";
        }
      }
      for (const b of stage.querySelectorAll(".neb-g")) b.classList.toggle("fired", b.dataset.g === k);
      setTimeout(() => stage.querySelector(`.neb-g[data-g="${k}"]`)?.classList.remove("fired"), 900);
      cam.querySelector(".neb-effect")?.remove();
      cam.insertAdjacentHTML("beforeend", `<div class="neb-effect">${g.emoji} <b>${esc(g.name)}</b><br>${esc(does)}</div>`);
      setTimeout(() => cam.querySelector(".neb-effect")?.remove(), 2600);
    };

    const start = async () => {
      const ph = stage.querySelector("#cam-placeholder");
      ph.querySelector("b").textContent = "Switching on…";
      ph.querySelector("p").textContent = "Loading the hand tracker and asking for your camera.";
      ph.querySelector("button").remove();
      try {
        const [{ FilesetResolver, HandLandmarker }, media] = await Promise.all([
          import(`${VISION}/vision_bundle.mjs`),
          navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: false }),
        ]);
        stream = media;
        if (!alive) return stop();
        const files = await FilesetResolver.forVisionTasks(`${VISION}/wasm`);
        landmarker = await HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate: "GPU" }, runningMode: "VIDEO", numHands: 1 });
        if (!alive) return stop();
        cam.innerHTML = `<video playsinline muted></video><canvas class="overlay"></canvas><div class="gesture-hud"><span id="g-name">Show me your hand</span><div class="bar"><i id="g-bar"></i></div></div>`;
        const video = cam.querySelector("video");
        video.srcObject = stream;
        await video.play();
        const canvas = cam.querySelector("canvas");
        const ctx = canvas.getContext("2d");
        const name = cam.querySelector("#g-name");
        const bar = cam.querySelector("#g-bar");
        const loop = () => {
          if (!alive) return;
          raf = requestAnimationFrame(loop);
          if (video.readyState < 2) return;
          if (canvas.width !== video.videoWidth) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }
          const result = landmarker.detectForVideo(video, performance.now());
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const lm = result.landmarks?.[0];
          const now = performance.now();
          if (!lm) {
            held = null;
            name.textContent = "Show me your hand";
            bar.style.width = "0";
            return;
          }
          ctx.strokeStyle = "rgba(52, 211, 153, .9)";
          ctx.lineWidth = 3;
          for (const [a, b] of BONES) {
            ctx.beginPath();
            ctx.moveTo(lm[a].x * canvas.width, lm[a].y * canvas.height);
            ctx.lineTo(lm[b].x * canvas.width, lm[b].y * canvas.height);
            ctx.stroke();
          }
          ctx.fillStyle = "#fff";
          for (const p of lm) {
            ctx.beginPath();
            ctx.arc(p.x * canvas.width, p.y * canvas.height, 4, 0, Math.PI * 2);
            ctx.fill();
          }
          const g = classify(lm);
          if (g !== held) {
            held = g;
            heldSince = now;
          }
          if (!g) {
            name.textContent = "Not a gesture: nothing happens";
            bar.style.width = "0";
            return;
          }
          const p = Math.min(1, (now - heldSince) / HOLD_MS);
          name.textContent = `${GESTURES[g].emoji} ${GESTURES[g].name}${p < 1 ? ": hold it…" : ""}`;
          bar.style.width = `${p * 100}%`;
          if (p >= 1) {
            fire(g);
            heldSince = now + COOLDOWN_MS; // one fire per hold
          }
        };
        loop();
      } catch (e) {
        stop();
        cam.innerHTML = `<div class="placeholder"><b>The camera isn't available</b><p>${esc(e?.name === "NotAllowedError" ? "Camera access was turned down." : "This browser couldn't start the hand tracker.")} The gesture buttons below still work.</p></div>`;
      }
    };

    const stop = () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      try {
        landmarker?.close();
      } catch {}
      landmarker = null;
    };

    stage.addEventListener("click", (e) => {
      if (e.target.closest("#cam-on")) start();
      const b = e.target.closest("[data-g]");
      if (b) {
        lastFire = 0;
        fire(b.dataset.g);
      }
    });
    return () => {
      alive = false;
      stop();
    };
  },
};
