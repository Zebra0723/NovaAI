# ZenithAI: the plan

Zenith is GalaxyAI's fifth body, and its sense is time. It is the **commander of the Galaxy**: you give it a big goal, and it runs the whole Galaxy to get it done over hours, days or weeks. It works on a cloud computer of its own and commands Nova (the Mac), Comet (phone and iMessage) and Nebula (approvals). The finished result lands on a mission board.

## What sets it apart from ChatGPT, Claude and Gemini agents
1. **Keys to real life.** The heavy work happens in the cloud, but Nova uses the Mac, which is already signed in everywhere, and Comet texts through iMessage. A giant's agent is stuck at logins, 2FA and the user's own devices.
2. **Knows the user from day one**, through the shared Galaxy memory in Galaxy Link.
3. **Missions outlive the task.** Living missions keep results working and up to date.
4. **The user's rules**: budget, approvals, and no pings except the done text.
5. **One goal, five bodies**, coordinated through Galaxy Link.

## Cost: nothing beyond the user's Claude Max 20x plan
- All AI work runs through **Claude Code logged into the Max plan**, never the paid API. Routing: Opus 5.5 plans and reviews, Sonnet 5.5 does the bulk, Haiku 5.5 handles tiny steps. Tokens are minimized throughout: compact context, cached briefs, no redundant passes.
- **The cloud computer**, cheapest first:
  - **A.** Claude Code cloud sessions (included in the plan; they keep running with the Mac off). First verify that they can be launched and monitored automatically from the Mac.
  - **B.** Fallback: an isolated sandbox (container) on the always-on Mac.
- **Galaxy budget governor**:
  - The whole Galaxy uses at most **50% of the weekly Max limit**.
  - Zenith runs only when there's room under that cap.
  - It schedules heavy work **overnight**, in limit windows the user would otherwise waste.
  - It queues parallel missions automatically when usage is tight.
  - It pauses and reports before crossing the cap.
- **Known issue:** Nova currently uses a paid API key. To meet the "nothing extra" rule, Nova moves onto the Max plan too. Its screen control needs a plan-compatible path; investigate that.
- Ballpark share of the weekly limit:
  - Nebula: about 0%.
  - Orbit: 1–3%.
  - Nova: 5–15%.
  - Comet: 10–20%.
  - Each big Zenith mission: 5–20%.
  - Total with regular use and 2–3 missions a week: about 30–60%, held at 50% by the governor.

## How a mission flows
1. **Brief:** from the Zenith app, by texting Comet "Zenith: …", or by asking Orbit or Nova. "Make it a mission" from any conversation turns that conversation into a mission, context included.
2. **Forecast:** the plan, which members it will use, the time, the estimated usage, and what will need the user. One thumbs up (in the app or with Nebula) launches it.
3. **No questions at the start.** Zenith decides what it can and writes down its assumptions.
4. **Work:** the cloud computer researches, codes, builds, deploys and creates files.
   - Nova acts on the Mac **anytime**, pausing the instant the user touches the mouse or keyboard.
   - Comet messages the user and allowlisted people without asking; anyone else needs a thumbs up.
   - It never spends money or posts publicly without a thumbs up.
5. **Needs you:** it finishes everything that doesn't need the user, then waits with **all its questions in one batch**. Nebula's approval mode arms for thumbs up/down decisions.
6. **Self-check:** a reviewer pass (Opus) checks the work against the brief: the site loads, the facts are sourced, the code runs.
7. **Done:** the results, a summary and the assumptions go on the board, plus **one Comet text** saying it's done. Nothing else is sent unprompted.
8. **Status on request:** Orbit, Comet and Nova can all answer "how's my mission?" through Galaxy Link.

## Several missions at once
Yes, limited by the budget governor.

## The surprise upgrades (all in)
1. **Self-upgrading Galaxy.** When a mission needs an ability no member has, Zenith builds and tests it as a new tool, script or skill. After the user's thumbs up it installs it into Comet, Nova or itself for good.
2. **Mission Replay.** A scrubbable time-lapse of each finished mission: cloud screen snapshots, Nova's actions and Comet's messages on one timeline.
3. **Living missions.** Finished results are kept alive silently (fix the site, refresh prices, update schedules). They are shown on the board only.
4. **"Make it a mission" from anywhere**, including a Nebula custom gesture.
5. **Galaxy Map.** A live view in the Galaxy Link app of all members working on a mission, with handoffs drawn as they happen.
6. **Status on request** from any member. No pings.

## The Zenith app
A Mac app with its own sleek look: no emojis in the UI, excellent typography, and as polished as Nova and Orbit.app.
- **Mission board:** Forecast → Working → Needs you → Done → Living.
- **New mission:** the goal goes in, the forecast comes out, and one thumbs up launches it.
- **Mission view:**
  - live timeline;
  - the active member;
  - cloud screen snapshots;
  - usage so far;
  - pause, redirect and stop.
- **Needs you:** batched questions, answered in one place.
- **Replay.**
- **Living missions.**
- **Galaxy budget:** a weekly usage meter against the 50% cap.
- **Settings:** the no-approval allowlist, the budget cap, the overnight schedule and permissions.

## Galaxy Link
Zenith joins as body `zenith` and greets Galaxy Chat with its intro. Link lives on the Mac, so a small **Zenith connector** on the Mac relays between Link and the cloud worker. The connector polls outward, so nothing on the Mac is exposed to the internet. Handoffs, approvals, status and the done text all go through Link.

## What Zenith can do (example missions)
- **Build:** sites, apps, games and tools, deployed.
- **Research and decide:** comparisons with a clear pick and sources.
- **Make documents:** reports, decks, spreadsheets.
- **Sort digital life:** files and photos on the Mac, via Nova.
- **Coordinate people:** texts via Comet, with the replies gathered.
- **Keep things running:** living missions.
- **Upgrade the Galaxy:** new skills for the other members.
