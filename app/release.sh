#!/bin/bash
# One .dmg per architecture (each bundles its own Node, so universal would double
# the download) and the SHA256SUMS the Homebrew cask uses.
#
#   ./release.sh              → release/Rally-<version>-{arm64,x86_64}.dmg, release/SHA256SUMS
#   ARCHS=arm64 ./release.sh  one of them
#
# Not notarized (no Developer ID): the first open of a download needs "Open Anyway";
# the cask clears the quarantine itself. Uploading is manual.
set -euo pipefail
cd "$(dirname "$0")"
VERSION="$(node -p "require('../package.json').version")"
ARCHS="${ARCHS:-arm64 x86_64}"
OUT="release"
rm -rf "$OUT"; mkdir -p "$OUT"
for arch in $ARCHS; do
  echo "==> $arch"
  ARCH="$arch" ./build.sh >/dev/null
  app="dist/Rally.app"
  lipo -archs "$app/Contents/MacOS/Rally" | grep -qx "$arch" || { echo "the app is not $arch" >&2; exit 1; }
  lipo -archs "$app/Contents/Resources/node/bin/node" | grep -qx "$arch" || { echo "the bundled node is not $arch" >&2; exit 1; }
  codesign --verify --deep --strict "$app"
  stage="$(mktemp -d)"
  cp -R "$app" "$stage/"
  ln -s /Applications "$stage/Applications"
  dmg="$OUT/Rally-$VERSION-$arch.dmg"
  hdiutil create -quiet -volname "Rally $VERSION" -srcfolder "$stage" -fs HFS+ -format UDZO -ov "$dmg"
  rm -rf "$stage"
  echo "    $dmg ($(du -h "$dmg" | cut -f1))"
done
( cd "$OUT" && shasum -a 256 *.dmg > SHA256SUMS && cat SHA256SUMS )
echo ""
echo "Next: upload release/*.dmg to a GitHub release v$VERSION, then put the"
echo "sums in Casks/rally.rb (sha256 arm: / intel:)."
