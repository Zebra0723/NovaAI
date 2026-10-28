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
