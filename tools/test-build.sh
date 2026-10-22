#!/usr/bin/env bash
# Build and launch an ISOLATED copy of Palinopsia for automated testing.
#
#   bash tools/test-build.sh [port]        build + launch (default CDP port 9555)
#   bash tools/test-build.sh [port] stop   close that copy
#   bash tools/test-build.sh [port] launch relaunch the last build of that port (no rebuild)
#
# The copy has its own settings folder in the OS temp dir (never the user's
# AppData/Roaming/palinopsia), so it can run beside the real app without
# touching its sessions, autosaves or OSC state. It is built with
# VITE_OPSIA_TEST=1, which exposes `window.__store` (the Zustand store) and
# `window.__comp` (the Compositor) for a debugger over CDP; real builds compile
# that hook out.
#
# Drive it over CDP (http://127.0.0.1:<port>/json). Close it as soon as a test
# run is done : several app instances at once starve the GPU.
#
# OPSIA_UNTHROTTLED=1 builds a copy Chromium never slows down when its window is
# covered or in the background : a covered window's frames drop to 1 a second,
# which makes any frame-pacing measurement meaningless.
set -e
PORT="${1:-9555}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(node -p "require('os').tmpdir().replace(/\\\\/g, '/')")"
OUT="$TMP/opsia-testbuild-$PORT"
# Electron through its REAL path : Windows picks the graphics card per program
# path, so a copy launched through a worktree's node_modules junction ran on the
# integrated GPU (about 15x slower, measured) while the repo's own path gets the
# discrete one.
ELECTRON="$(node -p "require('fs').realpathSync.native(process.argv[1])" "$ROOT/node_modules/electron/dist/electron.exe")"
UD="$TMP/opsia-testbuild-$PORT-userdata"

stop() {
  powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { \$_.CommandLine -like '*opsia-testbuild-$PORT-userdata*' } | ForEach-Object { \$_.ParentProcessId } | Sort-Object -Unique | ForEach-Object { Stop-Process -Id \$_ -Force -ErrorAction SilentlyContinue }" 2>/dev/null || true
}
if [ "$2" = "stop" ]; then stop; echo "stopped test build on $PORT"; exit 0; fi
stop
sleep 1
if [ "$2" = "launch" ] && [ -f "$OUT/main/index.js" ]; then
  cd "$OUT"
  ("$ELECTRON" . > "$OUT.log" 2>&1 &)
  sleep 8
  echo "relaunched test build on CDP port $PORT"
  exit 0
fi

cd "$ROOT"
rm -rf "$OUT"
VITE_OPSIA_TEST=1 npx electron-vite build --outDir "$OUT" 2>&1 | grep -E "rror" | head -5 || true

# The copy lives outside the repo : point module resolution back at the repo's
# node_modules, then pin its settings folder and debug port.
node - "$OUT" "$ROOT/node_modules" "$UD" "$PORT" <<'JS'
const fs = require('fs'), path = require('path')
const [out, mods, ud, port] = process.argv.slice(2)
const paths = `process.env.NODE_PATH = ${JSON.stringify(mods)}; require('module').Module._initPaths();\n`
const unthrottled = process.env.OPSIA_UNTHROTTLED === '1'
  ? ['disable-backgrounding-occluded-windows', 'disable-renderer-backgrounding', 'disable-background-timer-throttling'].map((f) => `__e.app.commandLine.appendSwitch('${f}');`).join(' ')
  : ''
const extra = `{ const __e = require('electron'); __e.app.setPath('userData', ${JSON.stringify(ud)}); __e.app.commandLine.appendSwitch('remote-debugging-port', '${port}'); ${unthrottled} }\n`
const files = [path.join(out, 'main/index.js'), ...fs.readdirSync(path.join(out, 'preload')).filter((f) => f.endsWith('.js')).map((f) => path.join(out, 'preload', f))]
for (const f of files) {
  let s = fs.readFileSync(f, 'utf8')
  const add = paths + (f.endsWith(path.join('main', 'index.js')) ? extra : '')
  const head = '"use strict";\n'
  s = s.startsWith(head) ? head + add + s.slice(head.length) : add + s
  fs.writeFileSync(f, s)
}
fs.writeFileSync(path.join(out, 'package.json'), '{"name":"opsia-test","main":"main/index.js"}\n')
JS

# An unpackaged app serves the bundled MediaPipe models from <app>/resources (the
# Body page, the Silhouette source) : copy them in (26 MB). A copy, not a link :
# the rm -rf above must never reach through into the repo.
mkdir -p "$OUT/resources"
cp -r "$ROOT/resources/mediapipe" "$OUT/resources/"
# The AI depth engine (Depth AI, about 95 MB) once `npm run fetch:depth` has
# filled it : copied the same way. Without it the copy says the files are missing.
[ -d "$ROOT/resources/depth" ] && cp -r "$ROOT/resources/depth" "$OUT/resources/"
# The native addons built in this checkout (Ableton Link, Spout…) : copied where
# the app looks for them (its own folder's native/<name>/build/Release).
for d in "$ROOT"/native/*/build/Release; do
  [ -d "$d" ] || continue
  rel="${d#$ROOT/}"
  mkdir -p "$OUT/$rel" && cp "$d"/*.node "$OUT/$rel/" 2>/dev/null || true
done

cd "$OUT"
("$ELECTRON" . > "$OUT.log" 2>&1 &)
sleep 10
echo "test build on CDP port $PORT (log: $OUT.log)"
