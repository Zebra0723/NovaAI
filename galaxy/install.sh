#!/bin/bash
# Installs Galaxy Link as a login agent, so it runs whichever bodies are open.
#   ./install.sh            install (or update) and start it
#   ./install.sh --remove   stop it and remove the agent; your memories stay
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LABEL="ai.galaxy.link"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

if [ "${1:-}" = "--remove" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  launchctl bootout "$DOMAIN/ai.galaxy.trainer" 2>/dev/null || true
  launchctl bootout "$DOMAIN/ai.galaxy.medic" 2>/dev/null || true
  launchctl bootout "$DOMAIN/ai.galaxy.teach" 2>/dev/null || true
  rm -f "$PLIST" "$HOME/Library/LaunchAgents/ai.galaxy.trainer.plist" "$HOME/Library/LaunchAgents/ai.galaxy.medic.plist" "$HOME/Library/LaunchAgents/ai.galaxy.teach.plist" "$HOME/.local/bin/galaxy"
  echo "Galaxy Link removed. Your memories are still in ~/Library/Application Support/Galaxy."
  exit 0
fi

BUN="$(command -v bun || true)"
[ -z "$BUN" ] && [ -x "$HOME/.bun/bin/bun" ] && BUN="$HOME/.bun/bin/bun"
if [ -z "$BUN" ]; then
  echo "Galaxy Link needs bun. Install it with: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Application Support/Galaxy" "$HOME/.local/bin"
# The trainer talks to Claude through the Claude Agent SDK, like Comet.
(cd "$ROOT" && "$BUN" install --silent)
chmod 700 "$HOME/Library/Application Support/Galaxy"
sed -e "s|__BUN__|$BUN|g" -e "s|__ROOT__|$ROOT|g" -e "s|__HOME__|$HOME|g" \
  "$ROOT/launchd/$LABEL.plist" > "$PLIST"

cat > "$HOME/.local/bin/galaxy" <<SH
#!/bin/bash
exec "$BUN" "$ROOT/src/cli.ts" "\$@"
SH
chmod +x "$HOME/.local/bin/galaxy"

# bootout returns before the job is gone, and bootstrapping into that gap fails with
# "Bootstrap failed: 5: Input/output error". Wait for it to go, and retry once.
load_agent() { # load_agent LABEL PLIST
  launchctl bootout "$DOMAIN/$1" 2>/dev/null || true
  for _ in $(seq 20); do launchctl print "$DOMAIN/$1" >/dev/null 2>&1 || break; sleep 0.5; done
  launchctl bootstrap "$DOMAIN" "$2" 2>/dev/null || { sleep 2; launchctl bootstrap "$DOMAIN" "$2"; }
  launchctl kickstart -k "$DOMAIN/$1"
}
load_agent "$LABEL" "$PLIST"

# Galaxy Medic: checks on every member once a minute and fixes what it can.
MEDIC_PLIST="$HOME/Library/LaunchAgents/ai.galaxy.medic.plist"
MEDIC_PATHS="$(dirname "$BUN"):$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
sed -e "s|__BUN__|$BUN|g" -e "s|__ROOT__|$ROOT|g" -e "s|__HOME__|$HOME|g" -e "s|__PATH__|$MEDIC_PATHS|g" \
  "$ROOT/launchd/ai.galaxy.medic.plist" > "$MEDIC_PLIST"
load_agent ai.galaxy.medic "$MEDIC_PLIST"

# Galaxy Trainer: daily practice for every member, through Claude Code on your plan.
TRAINER_PLIST="$HOME/Library/LaunchAgents/ai.galaxy.trainer.plist"
CLAUDE="$(command -v claude || true)"
if [ -n "$CLAUDE" ]; then
  # The exact Claude Code the trainer runs, and node's folder too (an npm-installed claude needs it),
  # since launchd doesn't read your shell's PATH.
  CLAUDE="$(cd "$(dirname "$CLAUDE")" && pwd -P)/$(basename "$CLAUDE")"
  NODE_DIR="$(dirname "$(command -v node || echo /usr/bin/node)")"
  PATHS="$(dirname "$BUN"):$(dirname "$CLAUDE"):$NODE_DIR:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  sed -e "s|__BUN__|$BUN|g" -e "s|__ROOT__|$ROOT|g" -e "s|__HOME__|$HOME|g" -e "s|__PATH__|$PATHS|g" -e "s|__CLAUDE__|$CLAUDE|g" \
    "$ROOT/launchd/ai.galaxy.trainer.plist" > "$TRAINER_PLIST"
  load_agent ai.galaxy.trainer "$TRAINER_PLIST"
  # Galaxy Teach: lessons on what comes up while you work, written by Claude the same way.
  TEACH_PLIST="$HOME/Library/LaunchAgents/ai.galaxy.teach.plist"
  sed -e "s|__BUN__|$BUN|g" -e "s|__ROOT__|$ROOT|g" -e "s|__HOME__|$HOME|g" -e "s|__PATH__|$PATHS|g" -e "s|__CLAUDE__|$CLAUDE|g" \
    "$ROOT/launchd/ai.galaxy.teach.plist" > "$TEACH_PLIST"
  load_agent ai.galaxy.teach "$TEACH_PLIST"
  [ -s "$HOME/Library/Application Support/Galaxy/claude-token" ] ||
    echo "Galaxy Trainer: sign it in to Claude once with: galaxy login" >&2
else
  echo "Galaxy Trainer needs Claude Code (claude) logged into your plan; skipping it for now." >&2
fi

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if "$HOME/.local/bin/galaxy" status >/dev/null 2>&1; then break; fi
  sleep 0.5
done
"$HOME/.local/bin/galaxy" import
"$HOME/.local/bin/galaxy" status
