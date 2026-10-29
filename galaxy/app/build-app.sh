#!/bin/zsh
# Builds Galaxy Link.app into ./build. Pass --install to copy it to /Applications and open it.
# Pass --trainer to build Galaxy Trainer.app instead: the same window, opening on the Trainer.
# Pass --teach for Galaxy Teach.app: the same window on Teach, plus its watcher and menu-bar item.
#
# The app is the window; galaxyd serves what's in it. Install galaxyd first (../install.sh).
# Signs with $GALAXY_SIGN_IDENTITY, else $NOVA_SIGN_IDENTITY (your "Apple Development: …"
# certificate), else ad hoc.
set -euo pipefail

cd "$(dirname "$0")"

INSTALL=0; NAME="Galaxy Link"; EXE="GalaxyLink"; PLIST="Resources/Info.plist"; ICON="Resources/AppIcon.png"
for arg in "$@"; do
    case "$arg" in
        --install) INSTALL=1 ;;
        --trainer) NAME="Galaxy Trainer"; EXE="GalaxyTrainer"; PLIST="Resources/Info-Trainer.plist"; ICON="Resources/AppIcon-Trainer.png" ;;
        --teach) NAME="Galaxy Teach"; EXE="GalaxyTeach"; PLIST="Resources/Info-Teach.plist"; ICON="Resources/AppIcon-Teach.png" ;;
    esac
done

swift build -c release

APP="build/$NAME.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$(swift build -c release --show-bin-path)/GalaxyLink" "$APP/Contents/MacOS/$EXE"
cp "$PLIST" "$APP/Contents/Info.plist"

# App icon: AppIcon.icns from the 1024px PNG (redraw it with: node scripts/make-icon.mjs).
ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
    sips -z $size $size "$ICON" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    sips -z $((size * 2)) $((size * 2)) "$ICON" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

codesign --force --sign "${GALAXY_SIGN_IDENTITY:-${NOVA_SIGN_IDENTITY:--}}" "$APP"
echo "Built $APP"

if [[ "$INSTALL" == 1 ]]; then
    pkill -x "$EXE" 2>/dev/null || true
    for _ in $(seq 20); do pgrep -x "$EXE" >/dev/null || break; sleep 0.25; done
    rm -rf "/Applications/$NAME.app"
    cp -R "$APP" /Applications/
    # Opening the moment it's copied can fail (-609) while Launch Services catches up.
    for _ in 1 2 3; do open "/Applications/$NAME.app" 2>/dev/null && break; sleep 1; done
    echo "Installed /Applications/$NAME.app"
fi
