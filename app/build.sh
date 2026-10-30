#!/bin/bash
# Builds Rally.app: a WebKit window over the page, running `node rally.js state` per refresh
# (no server). The JS (no dependencies) and the official nodejs.org Node (self-contained,
# unlike Homebrew's; checked against SHASUMS256.txt) are bundled. RALLY_BUNDLE_NODE=0 omits Node.
#
#   ./build.sh                    this Mac's architecture
#   ARCH=x86_64 ./build.sh        the other one (release.sh builds both)
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
ARCH="${ARCH:-$(uname -m)}"
NODE_VERSION="${NODE_VERSION:-v24.21.0}"   # LTS; engines asks for ≥ 22.13
VERSION="$(node -p "require('$ROOT/package.json').version")"

echo "==> swift build -c release ($ARCH)"
swift build -c release --arch "$ARCH"
BIN="$(swift build -c release --arch "$ARCH" --show-bin-path)"

APP="dist/Rally.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/js"
cp "$BIN/Rally" "$APP/Contents/MacOS/Rally"
cp "$BIN/rally-ptyd" "$APP/Contents/MacOS/rally-ptyd"
cp Info.plist "$APP/Contents/Info.plist"
# the version comes from package.json only
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" -c "Set :CFBundleVersion $VERSION" "$APP/Contents/Info.plist"

# <NAME>_BUNDLE_NODE under the current name, else a legacy one (lib/names.js)
NAMES=($(node -p "require('$ROOT/lib/names.js').NAMES.join(' ')"))
BUNDLE_NODE=1
for n in "${NAMES[@]}"; do v="$(echo "$n" | tr a-z A-Z)_BUNDLE_NODE"; if [ -n "${!v+x}" ]; then BUNDLE_NODE="${!v}"; break; fi; done
if [ "$BUNDLE_NODE" != 0 ]; then
  case "$ARCH" in arm64) NARCH=arm64 ;; x86_64) NARCH=x64 ;; *) echo "unknown ARCH $ARCH" >&2; exit 1 ;; esac
  NAME="node-$NODE_VERSION-darwin-$NARCH"
  CACHE=".build/node"
  mkdir -p "$CACHE"
  if [ ! -f "$CACHE/$NAME.tar.gz" ]; then
    echo "==> download $NAME"
    curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/$NAME.tar.gz" -o "$CACHE/$NAME.tar.gz.part"
    mv "$CACHE/$NAME.tar.gz.part" "$CACHE/$NAME.tar.gz"
  fi
  # the checksums of one version never change: fetched once (a build with no network still works, from the cache)
  if [ ! -s "$CACHE/SHASUMS256-$NODE_VERSION.txt" ]; then
    curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$CACHE/SHASUMS256-$NODE_VERSION.txt.part"
    mv "$CACHE/SHASUMS256-$NODE_VERSION.txt.part" "$CACHE/SHASUMS256-$NODE_VERSION.txt"
  fi
  want="$(awk -v f="$NAME.tar.gz" '$2 == f { print $1 }' "$CACHE/SHASUMS256-$NODE_VERSION.txt")"
  got="$(shasum -a 256 "$CACHE/$NAME.tar.gz" | awk '{ print $1 }')"
  if [ -z "$want" ] || [ "$want" != "$got" ]; then
    echo "$NAME.tar.gz does not match SHASUMS256.txt — removed, run again" >&2
    rm -f "$CACHE/$NAME.tar.gz"; exit 1
  fi
  echo "==> bundle node $NODE_VERSION ($NARCH)"
  mkdir -p "$APP/Contents/Resources/node/bin"
  tar -xzf "$CACHE/$NAME.tar.gz" -C "$APP/Contents/Resources/node" --strip-components=1 \
    "$NAME/bin/node" "$NAME/LICENSE"
fi

echo "==> bundle the JS"
# the icon first: one drawing for the app icon and the site (docs/icon.png)
if [ ! -f AppIcon.icns ] || [ make-icon.swift -nt AppIcon.icns ]; then
  echo "==> generate AppIcon.icns, docs/icon.png"
  swift make-icon.swift "$ROOT"
  iconutil -c icns AppIcon.iconset -o AppIcon.icns
fi
cp -R "$ROOT/bin" "$ROOT/lib" "$ROOT/package.json" "$APP/Contents/Resources/js/"
# loaded from file://
node "$ROOT/bin/rally.js" page > "$APP/Contents/Resources/page.html"

cp AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

# Signed with a local key when ~/.rally/signing (or a legacy name's) exists, so macOS keeps its
# privacy grants across rebuilds; an ad-hoc build is a new app each time and asks again.
# The keychain and identity keep the names they were made with.
SIGN=""
for n in "${NAMES[@]}"; do if [ -d "$HOME/.$n/signing" ]; then SIGN="$HOME/.$n/signing"; break; fi; done
KC="$SIGN/agentkanban-signing.keychain-db"
ID=""
if [ -n "$SIGN" ] && [ -f "$KC" ] && [ -f "$SIGN/pass" ]; then
  security unlock-keychain -p "$(cat "$SIGN/pass")" "$KC" 2>/dev/null &&
    ID=$(security find-identity "$KC" 2>/dev/null | awk '/AgentKanban Local Signing/{print $2; exit}')
fi
if [ -n "$ID" ]; then
  echo "==> codesign (this Mac's key)"
  codesign --force --deep -s "$ID" --keychain "$KC" "$APP"
else
  echo "==> codesign (ad-hoc)"
  codesign --force --deep -s - "$APP"
fi

echo "==> done: $APP"
echo ""
echo "Install:"
echo "  rm -rf ~/Applications/Rally.app && cp -r $APP ~/Applications/"
echo "  open ~/Applications/Rally.app"
