#!/bin/zsh
# Builds Nova.app into ./build. Pass --install to copy it to /Applications and launch it.
#
# macOS ties Screen Recording and Accessibility permissions to the app's code signature.
# Ad-hoc signing (the default) changes the signature on every build, so you'd have to re-grant
# permissions after each rebuild. Set NOVA_SIGN_IDENTITY to your "Apple Development: …"
# identity (see `security find-identity -p codesigning -v`) to keep them across builds.
set -euo pipefail

cd "$(dirname "$0")/.."

swift build -c release

APP=build/Nova.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$(swift build -c release --show-bin-path)/Nova" "$APP/Contents/MacOS/Nova"
cp Resources/Info.plist "$APP/Contents/Info.plist"

# App icon: build AppIcon.icns from the 1024px PNG.
ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
    sips -z $size $size Resources/AppIcon.png --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    sips -z $((size * 2)) $((size * 2)) Resources/AppIcon.png --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

codesign --force --sign "${NOVA_SIGN_IDENTITY:--}" "$APP"
echo "Built $APP"

if [[ "${1:-}" == "--install" ]]; then
    pkill -x Nova 2>/dev/null || true
    rm -rf /Applications/Nova.app
    cp -R "$APP" /Applications/
    open /Applications/Nova.app
    echo "Installed and launched /Applications/Nova.app"
fi
