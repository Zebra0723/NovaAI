#!/bin/bash
# Installs or updates the whole Galaxy on this Mac in one go: Galaxy Link and its app,
# Nova, Comet, Nebula and Zenith. Orbit too, with --orbit.
#
# You don't need to know where anything is: it finds each repo on this Mac by its
# GitHub address, and downloads any that are missing into ~/GalaxyAI.
#
#   galaxy/install-all.sh            everything but Orbit
#   galaxy/install-all.sh --orbit    Orbit as well
set -uo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"   # this NovaAI checkout
HOME_DIR="$HOME/GalaxyAI"
WITH_ORBIT=0
[ "${1:-}" = "--orbit" ] && WITH_ORBIT=1

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
FAILED=()

# find_repo NAME: prints the folder of the checkout whose origin is Zebra0723/NAME.
find_repo() {
  local name="$1" git dir url
  while IFS= read -r git; do
    dir="$(dirname "$git")"
    url="$(git -C "$dir" remote get-url origin 2>/dev/null | tr '[:upper:]' '[:lower:]')"
    case "$url" in
      *"zebra0723/$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')"|*"zebra0723/$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]').git")
        printf '%s\n' "$dir"; return 0 ;;
    esac
  done < <(find "$HOME" -maxdepth 4 -name .git \
             -not -path "*/Library/*" -not -path "*/node_modules/*" -not -path "*/.Trash/*" 2>/dev/null)
  return 1
}

# checkout NAME BRANCH: finds (or downloads) the repo and brings BRANCH up to date. Prints its folder.
checkout() {
  local name="$1" branch="$2" dir="${3:-}"
  if [ -n "$dir" ] && git -C "$dir" rev-parse >/dev/null 2>&1; then
    dir="$(git -C "$dir" rev-parse --show-toplevel)"
  elif ! dir="$(find_repo "$name")"; then
    mkdir -p "$HOME_DIR"
    dir="$HOME_DIR/$name"
    git clone -q "https://github.com/Zebra0723/$name" "$dir" >&2 || return 1
  fi
  # Changes of your own come along: they're set aside, the update goes in, and they go back on top.
  git -C "$dir" fetch -q origin "$branch" >&2 || return 1
  if ! git -C "$dir" checkout -q "$branch" >&2 2>/dev/null; then
    git -C "$dir" stash push -q -m "galaxy install-all $(date +%s)" >&2 &&
      git -C "$dir" checkout -q "$branch" >&2 &&
      git -C "$dir" stash pop -q >&2 || { warn "$name: couldn't switch to $branch in $dir" >&2; return 1; }
  fi
  git -C "$dir" -c rebase.autoStash=true pull -q --rebase origin "$branch" >&2 ||
    { warn "$name: couldn't update $dir (changes of your own clash with the update)" >&2; return 1; }
  printf '%s\n' "$dir"
}

step() { # step NAME COMMAND...: runs it, notes a failure without stopping everything else
  local name="$1"; shift
  if "$@"; then ok "$name"; else warn "$name didn't finish (see above)"; FAILED+=("$name"); fi
}

say "Galaxy Link"
step "Galaxy Link (galaxyd)" "$HERE/galaxy/install.sh"
step "Galaxy Link app" "$HERE/galaxy/app/build-app.sh" --install
step "Galaxy Trainer app" "$HERE/galaxy/app/build-app.sh" --trainer --install

say "Nova"
step "Nova app" "$HERE/scripts/build-app.sh" --install

say "Comet"
# Comet may run as its own Mac user, walled off from yours. Then it's updated as that
# user (see galaxy/README.md), never from here: a second copy as you would fight it for its port.
COMET_USER="$(ps -axo user=,command= | awk '/\/server\/src\/index\.ts/ && !/awk/ {print $1; exit}')"
if [ -n "$COMET_USER" ] && [ "$COMET_USER" != "$(id -un)" ]; then
  ok "Comet runs as its own user ($COMET_USER); leaving it to that user"
else
# The Comet that's actually running, if launchd knows where it is.
LIVE_COMET="$(/usr/libexec/PlistBuddy -c 'Print :WorkingDirectory' "$HOME/Library/LaunchAgents/com.imessage.server.plist" 2>/dev/null || true)"
if COMET="$(checkout CometAI claude/nice-knuth-5l429p "$LIVE_COMET")"; then
  ok "Comet is in $COMET"
  step "Comet's packages" bash -c "cd '$COMET' && bun install --silent"
  if [ -f "$HOME/Library/LaunchAgents/com.imessage.server.plist" ]; then
    for label in com.imessage.server com.imessage.relay; do
      launchctl kickstart -k "gui/$(id -u)/$label" >/dev/null 2>&1 && ok "restarted $label" || warn "couldn't restart $label"
    done
  else
    # Comet isn't a login agent yet, so nothing runs it: set that up now.
    step "Comet's login agents" bash -c "cd '$COMET' && ./scripts/install-launchd.sh"
  fi
else
  warn "couldn't get CometAI"; FAILED+=("Comet")
fi
fi

say "Nebula"
if NEBULA="$(checkout NebulaAI claude/laughing-shannon-7j3yyk)"; then
  ok "Nebula is in $NEBULA"
  if [ -d "/Applications/Nebula.app" ]; then
    ok "Nebula is already installed. To rebuild after recording, see $NEBULA/README.md"
  else
    # First install: the recording build, which can't fire any gesture until you've recorded some.
    step "Nebula (recording build)" "$NEBULA/scripts/build-app.sh" --recorder --install
  fi
else
  warn "couldn't get NebulaAI"; FAILED+=("Nebula")
fi

say "Zenith"
if ZENITH="$(checkout ZenithAI claude/nice-knuth-5l429p)"; then
  ok "Zenith is in $ZENITH"
  step "Zenith" "$ZENITH/install.sh"
else
  warn "couldn't get ZenithAI"; FAILED+=("Zenith")
fi

if [ "$WITH_ORBIT" = 1 ]; then
  say "Orbit"
  if ORBIT="$(checkout OrbitAI claude/nice-knuth-5l429p)"; then
    step "Orbit" bash -c "cd '$ORBIT/macos-daily-welcome' && ./install.sh && cd app && ./build-app.sh --install"
  else
    warn "couldn't get OrbitAI"; FAILED+=("Orbit")
  fi
fi

say "Done"
"$HOME/.local/bin/galaxy" status 2>/dev/null || true
if [ "${#FAILED[@]}" -gt 0 ]; then
  printf '\nThese need another look: %s\n' "${FAILED[*]}"
  exit 1
fi
echo "Open Galaxy Link from Applications to watch the members join."
