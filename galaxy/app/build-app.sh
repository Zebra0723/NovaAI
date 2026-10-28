#!/bin/zsh
# Builds Galaxy Link.app into ./build. Pass --install to copy it to /Applications and open it.
#
# The app is the window; galaxyd serves what's in it. Install galaxyd first (../install.sh).
# Signs with $GALAXY_SIGN_IDENTITY, else $NOVA_SIGN_IDENTITY (your "Apple Development: …"
# certificate), else ad hoc.
set -euo pipefail

cd "$(dirname "$0")"

swift build -c release

APP="build/Galaxy Link.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$(swift build -c release --show-bin-path)/GalaxyLink" "$APP/Contents/MacOS/GalaxyLink"
cp Resources/Info.plist "$APP/Contents/Info.plist"

# App icon: AppIcon.icns from the 1024px PNG (redraw it with scripts/make-icon.py).
ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
    sips -z $size $size Resources/AppIcon.png --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    sips -z $((size * 2)) $((size * 2)) Resources/AppIcon.png --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

codesign --force --sign "${GALAXY_SIGN_IDENTITY:-${NOVA_SIGN_IDENTITY:--}}" "$APP"
echo "Built $APP"

if [[ "${1:-}" == "--install" ]]; then
    pkill -x GalaxyLink 2>/dev/null || true
    rm -rf "/Applications/Galaxy Link.app"
    cp -R "$APP" /Applications/
    open "/Applications/Galaxy Link.app"
    echo "Installed and opened /Applications/Galaxy Link.app"
fi
