#!/bin/bash
# Package the launcher, install it on the TV, and start it.
# Needs: Tizen CLI in ~/tizen-studio, a Samsung certificate profile (default name "tv"), tv.json.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TV="$(node "$ROOT/tools/lib.js" ip):26101"
PROFILE="$(node "$ROOT/tools/lib.js" cert)"
APP="$(node "$ROOT/tools/lib.js" app)"
TIZEN="$HOME/tizen-studio/tools/ide/bin/tizen"
SDB="$HOME/tizen-studio/tools/sdb"
BUILD="$ROOT/build"

"$SDB" connect "${TV%%:*}" >/dev/null
rm -rf "$BUILD" && mkdir -p "$BUILD"
cp -R "$ROOT/launcher/." "$BUILD/"

"$TIZEN" package -t wgt -s "$PROFILE" -- "$BUILD"
WGT="$(ls "$BUILD"/*.wgt | head -1)"

"$TIZEN" install -s "$TV" -n "$(basename "$WGT")" -- "$BUILD"
"$TIZEN" run -s "$TV" -p "$APP"
