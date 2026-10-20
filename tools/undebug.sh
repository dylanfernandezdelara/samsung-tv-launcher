#!/bin/bash
# Put the launcher back in normal mode after `npm run debug`. Debug mode leaves a DevTools port
# open on the TV that anyone on your Wi-Fi could reach, so always run this when you're done.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TV="$(node "$ROOT/tools/lib.js" ip):26101"
APP="$(node "$ROOT/tools/lib.js" app)"
SDB="$(node "$ROOT/tools/lib.js" sdb)"
TIZEN="$(node "$ROOT/tools/lib.js" tizen)"

"$SDB" connect "${TV%%:*}" >/dev/null
"$SDB" -s "$TV" forward --remove-all >/dev/null 2>&1
"$SDB" -s "$TV" shell 0 was_kill "$APP" >/dev/null 2>&1
sleep 2
"$TIZEN" run -s "$TV" -p "$APP" >/dev/null && echo "Launcher restarted in normal mode."
