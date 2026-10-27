# ✦ Nova

**Nova is the on-screen member of the Galaxy.**

| | Lives in | Talks by | Does |
|---|---|---|---|
| ☄️ **Comet** | iMessage | Text | Builds websites, CAD, and more |
| 🪐 **Orbit** | Your laptop's speakers | Voice | Gives the daily brief when you open your Mac |
| ✦ **Nova** | Your screen | A glowing bar | Sees what you see and acts on your Mac |

Press **⌃Space** anywhere. A minimal glass bar appears. Ask about whatever's on screen ("what's wrong with this error?", "summarize this page"), or tell Nova to do something ("rename these screenshots by date", "reply to this email saying I'll be there", "open Figma and export the selected frame"). It replies in the bar, or it does the task itself.

## How it works

- **Sees**: every request includes a screenshot of your main display (Nova hides itself from the capture).
- **Thinks with the right model**: a quick Claude Haiku call first rates each request as easy, medium, or hard. The request then runs on the matching model, and the bar shows which one:

  | Difficulty | Model | Effort | Examples |
  |---|---|---|---|
  | Easy | Claude Haiku 5.5 | low | Quick facts, "what does this say?", "open Spotify" |
  | Medium | Claude Sonnet 5.5 | medium | Replying to an email, explaining an error, sorting files |
  | Hard | Claude Opus 5.5 | high | Multi-app workflows, real coding, deep analysis |

  If the rating fails for any reason, Nova uses Sonnet. Follow-ups get rated again, so a conversation can move between models.
- **Streams**: answers appear word by word as Claude writes them.
- **Picks up context**: when you summon Nova, it grabs your selected text, the page open in your browser (Safari, Chrome, Arc, Brave, Edge, Vivaldi), and files selected in Finder. They show as chips in the bar; click × on any you don't want to send.
- **Remembers**: Nova saves lasting facts about you (preferences, people, projects) with a `remember` tool and uses them in every conversation. Manage them in the app.
- **Speaks up**: while you work, Nova checks your screen with Haiku when it changes. If it spots a problem, like an error or a failed build, a small card offers to fix it. Each check costs a fraction of a cent; turn it off or slow it down in Settings.
- **Acts**: Claude's [computer use toolset](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) handles clicks, typing, scrolling, and zoom. A `bash` tool handles files, apps, and anything else the shell does well.
- **Full auto**: Nova doesn't ask before acting. While it's driving your Mac, the bar shrinks to a small pill under the menu bar that clicks pass through. **Press Esc at any time to stop it.**

Close the bar (Esc, or ⌃Space again) to end the conversation. While it's open, you can keep typing follow-ups.

Drag the bar anywhere on screen, and resize it with the grip in its bottom-right corner. Nova remembers both. **Settings → Bar size and position** puts it back.

## The Nova app

Click the star in the menu bar → **Open Nova**. The app has four pages:

- **Conversations**: every conversation Nova has had, searchable, with each request, reply, the actions Nova took, the model, time, tokens, and cost.
- **Memory**: everything Nova remembers about you. Add, edit, or delete memories.
- **Stats**: totals, requests per day, a breakdown by model, and what proactive checks have cost.
- **Settings**: API key, proactive help, smart context, launch at login, permissions, and your data.

Everything is stored on your Mac in `~/Library/Application Support/Nova`.

## Setup

Requirements: macOS 14 or later (built for macOS 27 and Liquid Glass), Xcode or the Swift toolchain, and an [Anthropic API key](https://platform.claude.com/).

```sh
git clone https://github.com/zebra0723/novaai.git
cd novaai
./scripts/build-app.sh --install
```

Then:

1. **Grant permissions** when macOS asks: **Screen Recording** (to see) and **Accessibility** (to click and type). They're in System Settings → Privacy & Security. Relaunch Nova after granting them.
2. Press **⌃Space** and paste your API key into the bar. It's stored in your login keychain. You can also set `ANTHROPIC_API_KEY` instead.
3. Optional: turn on **Launch at login** in Nova's Settings.

> **Heads up:** macOS uses ⌃Space to switch keyboard input sources. If you have more than one input source, turn that shortcut off in System Settings → Keyboard → Keyboard Shortcuts → Input Sources.

> **Rebuilding:** macOS ties permissions to the app's signature, and ad-hoc signing changes it on every build. To keep permissions across rebuilds, sign with your developer identity:
> `NOVA_SIGN_IDENTITY="Apple Development: you@example.com (TEAMID)" ./scripts/build-app.sh --install`

## Project layout

```
Sources/Nova/
  NovaApp.swift            App entry, menus, menu-bar item, ⌃Space hotkey
  NovaStore.swift          Conversations, memories, settings, usage and cost (on disk)
  ContextGatherer.swift    Selected text, browser tab, Finder selection
  ProactiveWatcher.swift   Background screen checks and the suggestion card
  App/                     The Nova app window: conversations, memory, stats, settings
  NovaController.swift     UI state, request lifecycle, Esc kill switch
  NovaPanel.swift          Floating, non-activating panel (bar ↔ pill)
  NovaView.swift           The glass bar, nova glow, and answer view
  NovaAgent.swift          Agent loop: request + screenshot → Claude → tools → repeat
  ClaudeClient.swift       Messages API client (raw HTTP, streaming), routing, screen checks
  ComputerController.swift Computer toolset actions as CGEvents
  ScreenCapture.swift      ScreenCaptureKit screenshots and zoom, coordinate mapping
  BashTool.swift           Shell commands for the bash tool
  HotKey.swift             Global hotkey (Carbon)
  KeyCodes.swift           Key names → macOS key codes
  Keychain.swift           API key storage
  Permissions.swift        Screen Recording / Accessibility checks
scripts/build-app.sh       Builds and signs Nova.app
```

## Galaxy link (next)

Comet, Orbit, and Nova don't talk to each other yet. The plan is a shared local hub that all three can use:

- **Shared memory**: one place that holds what you're working on, your preferences, and recent results.
- **Handoffs**: "Nova, send this to Comet to build", or "Orbit, put this in tomorrow's brief".

Nova's agent loop is where the handoff tools will plug in.
