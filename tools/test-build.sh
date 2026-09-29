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
set -e
PORT="${1:-9555}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(node -p "require('os').tmpdir().replace(/\\\\/g, '/')")"
OUT="$TMP/opsia-testbuild-$PORT"
UD="$TMP/opsia-testbuild-$PORT-userdata"

stop() {
  powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { \$_.CommandLine -like '*opsia-testbuild-$PORT-userdata*' } | ForEach-Object { \$_.ParentProcessId } | Sort-Object -Unique | ForEach-Object { Stop-Process -Id \$_ -Force -ErrorAction SilentlyContinue }" 2>/dev/null || true
}
if [ "$2" = "stop" ]; then stop; echo "stopped test build on $PORT"; exit 0; fi
stop
sleep 1
if [ "$2" = "launch" ] && [ -f "$OUT/main/index.js" ]; then
  cd "$OUT"
  ("$ROOT/node_modules/electron/dist/electron.exe" . > "$OUT.log" 2>&1 &)
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
const extra = `{ const __e = require('electron'); __e.app.setPath('userData', ${JSON.stringify(ud)}); __e.app.commandLine.appendSwitch('remote-debugging-port', '${port}'); }\n`
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

cd "$OUT"
("$ROOT/node_modules/electron/dist/electron.exe" . > "$OUT.log" 2>&1 &)
sleep 10
echo "test build on CDP port $PORT (log: $OUT.log)"
