#!/bin/bash
# Restart the launcher on the TV in debug mode and forward its Chrome DevTools to localhost:9333.
# Then: node tools/tv-debug.js eval "..." | shot out.png | logs
# (or open chrome://inspect, add localhost:9333 under "Configure", and inspect it like a web page)
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TV="$(node "$ROOT/tools/lib.js" ip):26101"
APP="$(node "$ROOT/tools/lib.js" app)"
SDB="$(node "$ROOT/tools/lib.js" sdb)"
OUT="$(mktemp)"

"$SDB" connect "${TV%%:*}" >/dev/null
"$SDB" -s "$TV" shell 0 was_kill "$APP" >/dev/null 2>&1
sleep 2

# `debug` keeps its connection open after printing the port, so read it from a background run.
"$SDB" -s "$TV" shell 0 debug "$APP" >"$OUT" 2>&1 &
PID=$!
for _ in $(seq 1 30); do
  grep -q 'port:' "$OUT" && break
  sleep 1
done
kill "$PID" 2>/dev/null

PORT="$(grep -oE 'port: *[0-9]+' "$OUT" | grep -oE '[0-9]+')"
if [ -z "$PORT" ]; then echo "No debug port: $(cat "$OUT")"; exit 1; fi

"$SDB" -s "$TV" forward --remove-all >/dev/null 2>&1
"$SDB" -s "$TV" forward tcp:9333 "tcp:$PORT" >/dev/null
echo "DevTools on http://127.0.0.1:9333 (TV port $PORT)"
