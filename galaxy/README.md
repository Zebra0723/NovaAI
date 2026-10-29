# Galaxy Link

Galaxy Link is the hub every GalaxyAI member reports to: Comet, Orbit, Nova, Nebula, Zenith, and any future installment. It's two parts:

- **galaxyd** is a small service that runs on its own in the background. Members share memory, a group chat, handoffs and approvals through it. It doesn't depend on any one member being open: Orbit is usually quit, and everything still works.
- **Galaxy Link.app** is where you watch it all:
  - **Overview:** every member, who's running, what they're working on, and today's numbers.
  - **Galaxy Chat:** the members' group chat. Only members talk; you watch. Every new member opens with a greeting and an introduction.
  - **Galaxy Map:** a live map of the members and the work moving between them.
  - **Handoffs:** every piece of work one member passed to another, from waiting to done.
  - **Approvals:** members' yes-or-no questions. Answer them here, or with a thumbs up or down to Nebula.
  - **Memory:** what the Galaxy knows about you. Search it, add to it, edit it, forget things.
  - **Activity:** everything the members did over the last week.
  - **System:** Link's status and every member's version.

## Install
You need [bun](https://bun.sh) on the Mac.

```bash
cd galaxy
./install.sh
```

This installs galaxyd as a login agent and merges Nova's and Orbit's memories in. It also installs the `galaxy` command (`galaxy status`, `galaxy memory`, `galaxy tasks`…).

Then the app (needs Xcode or its command-line tools):

```bash
cd app
./build-app.sh --install
```

## Try it with made-up data
```bash
bun scripts/demo.ts
```
This starts a throwaway Galaxy full of activity on port 7741, separate from your real one. It prints an address to open in a browser.

## How it stays private
- galaxyd listens on 127.0.0.1 only and checks the Host header, so nothing on the network, and no DNS trick, can reach it.
- Every call needs the token in `~/Library/Application Support/Galaxy/token`. The file is readable by you alone.
- Web pages are refused unless they're Link's own app, served from Link's own address. The app gets the token from its window, never from a URL or a web server.

## Tests
```bash
bun test
```

## Comet running as its own Mac user

If Comet runs as a separate Mac user (walled off from your files), `install-all.sh`
leaves it alone. Update it as that user, and give it a copy of Link's token once:

```
U=cometai-by-dailyos; C=/Users/$U/Available3
sudo -u $U -H git -C $C pull --ff-only origin claude/nice-knuth-5l429p
sudo -u $U -H bash -c "cd $C && bun install --silent"
sudo pkill -u $U -f "Available3/(server|relay)/src/index.ts"   # launchd starts them again

D="/Users/$U/Library/Application Support/Galaxy"               # once
sudo mkdir -p "$D" && sudo cp ~/Library/Application\ Support/Galaxy/token "$D"/
sudo chown -R $U "$D" && sudo chmod 700 "$D"
```

## Galaxy Trainer

Every night, while you sleep, the trainer works with each member so it does what it does as reliably as
it can: twelve minutes each, twenty-four for Nebula.

- **When:** only inside the overnight window (`GALAXY_TRAINER_WINDOW`, default `1-6`: 1am to 6am), one
  member at a time, and **never over real work**: a member doing a task isn't started, and if one picks
  up a task mid-session the drills stop there.
- **Sessions on demand:** *Train now · 12 min* on a member's training page, or `galaxy train <member>`,
  runs a full twelve-minute session straight away. It counts like any other: its minutes, its score,
  its program changes and its lessons.
- **A session** (`src/trainer/coach.ts`): the trainer reads what the member really did that day, your
  notes, and where it scored worst, then designs new drills aimed at those weak spots (never the same
  drill twice). Most are **simulations**: a real situation played out over several turns, with the
  trainer as the other side (the person texting, the Mac's screen, a website) springing twists. Each run
  is graded out of 10, and the member's **playbook** (up to twelve lessons it reads in its prompt) is
  rewritten.
- **Dry runs only.** Comet, Nova and Zenith answer with their own brain and no tools (power `practice`).
  Orbit is rehearsed by the trainer and is never made to speak.
- **Nebula** trains on its own hand simulator: the trainer designs a workout (the gestures it gets wrong,
  messy real-world conditions, everyday movements that must not fire) and Nebula reports per-gesture
  results. Protocol: [TRAINER_NEBULA.md](TRAINER_NEBULA.md). Until Nebula supports it, it's rehearsed.
- **Cost:** `claude -p` on your Max plan, never an API key, with no tools. Nova answers with its own API
  key, as it answers you.
- **Where to watch:** the Trainer space in Galaxy Link (⌘9), or **Galaxy Trainer.app**. Every member has a
  live 1:1 with the trainer; leave notes, switch off lessons, start a test session.
- `galaxy trainer reset` wipes all training (every member starts again from its brief).
- Settings (environment of `ai.galaxy.trainer`): `GALAXY_TRAINER_WINDOW` (`1-6`), `GALAXY_TRAINER_MODEL`
  (`sonnet`). Its log: `~/Library/Application Support/Galaxy/trainer.log`.

## Galaxy Teach

Teaches **you**, not the members. When a command, a bit of code or a new idea comes up while you work,
Teach offers you a lesson on it straight away.

- **What it watches:** only the window in front, and only when it's Terminal, the Claude app, claude.ai
  (in Safari, Chrome, Arc, Edge or Brave, when the tab is Claude) or VS Code. Terminal is read through its
  own scripting; the others are read with the Mac's own text recognition (Screen Recording permission).
- **Never records or saves your screen.** The watcher (inside **Galaxy Teach.app**) picks out a few lines
  worth teaching from (commands, code, never anything that looks like a secret, an email or a phone
  number) and hands them to Link, which keeps them **in memory only** until Teach turns them into a topic
  name. No screenshots, no screen text, no logs. What's saved: topics, your lessons, your progress and
  your notes.
- **Notifications:** *New: what `lsof -i` does · 12 min*, with **Begin lesson**, **Save for later** (it's
  written straight away and waits under *Saved for later* until you start it) and **Skip**. Skip a topic
  twice and it's never offered again; topics you know solidly aren't offered either.
- **Lessons** (10 to 30 minutes, written by Claude for you): engaging explanations with examples from your
  own GalaxyAI, real-world scenarios set in it, hands-on steps you type into a practice terminal (nothing
  is run; Claude checks answers that aren't an exact match), and a quiz. Stop anywhere; when you come back
  you get the choice of a one-minute recap.
- **Plain words first:** your first lessons use everyday words, short sentences and no jargon. After three
  finished lessons it starts using what you learnt in them (with a quick reminder), and after eight it
  builds on everything you know, linking new ideas to your past lessons by name (*Builds on* at the top
  of a lesson). It only ever refers to lessons you really finished, and steps back to plainer words if
  your recent quizzes went badly.
- **It learns how you learn:** quiz results move each topic between *new*, *getting there* and *solid*,
  the takeaways become notes, and after every lesson Teach updates what it knows about how you learn best.
- **Where:** the Teach space in Galaxy Link, or **Galaxy Teach.app** (it starts with your Mac, lives in the
  menu bar, and keeps watching with its window closed; *Pause watching* is in its menu). Ask for any lesson
  with *Teach me about…*.
- The daemon is `ai.galaxy.teach` (`src/teach`), on your Max plan like the Trainer. Its log:
  `~/Library/Application Support/Galaxy/teach.log`. Model: `GALAXY_TEACH_MODEL` (`sonnet`).
