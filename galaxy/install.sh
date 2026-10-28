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
  rm -f "$PLIST" "$HOME/.local/bin/galaxy"
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
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
for _ in $(seq 20); do launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || break; sleep 0.5; done
launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null || { sleep 2; launchctl bootstrap "$DOMAIN" "$PLIST"; }
launchctl kickstart -k "$DOMAIN/$LABEL"

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if "$HOME/.local/bin/galaxy" status >/dev/null 2>&1; then break; fi
  sleep 0.5
done
"$HOME/.local/bin/galaxy" import
"$HOME/.local/bin/galaxy" status
