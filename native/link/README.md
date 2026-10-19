# Palinopsia — Ableton Link addon

A small N-API addon around the **Ableton Link** SDK, so Palinopsia shares its
tempo and bar with every Link app on the network. One Link instance for the
whole app, in the Electron **main** process (`src/main/link.ts`); the page reads
its state 30 times a second and carries the beat on between reads
(`src/renderer/src/link.ts`).

`link_addon.cpp` exposes `enable(on)`, `state(quantum)` →
`{ enabled, peers, tempo, beat, phase }`, `setTempo(bpm)` and `close()`. It is
polled, never calling back into JavaScript.

`sdk/` vendors the header-only sources :

- `sdk/link` : [Ableton/link](https://github.com/Ableton/link) **Link-4.1.1**
  (`include/` without the tests), GPL-2.0-or-later (`LICENSE.md`,
  `GNU-GPL-v2.0.md`). Copyright 2016, Ableton AG.
- `sdk/asio` : asio **1.38.2** (the commit Link 4.1.1 pins), Boost Software
  License 1.0 (`LICENSE_1_0.txt`). Copyright Christopher M. Kohlhoff.

Bundling Link is why Palinopsia is GPL-3.0-or-later from v1.3.0 on.

## Rebuild (per Electron ABI)

The built `build/Release/link.node` is git-ignored : build it after cloning or
changing Electron. Windows needs Visual Studio with *Desktop development with
C++* (node-gyp 12 finds VS 2026; CI uses node-gyp 11 on VS 2022); macOS the
command line tools.

```sh
cd native/link
npm install --ignore-scripts
npx --yes node-gyp@12 rebuild --target=$(node -p "require('electron/package.json').version") --dist-url=https://electronjs.org/headers --arch=x64
# macOS : --arch=arm64, then : codesign --force --sign - build/Release/link.node
node -e "const l = require('./build/Release/link.node'); l.setTempo(123); console.log(l.state(4)); l.close()"
```

N-API is ABI-stable, so the Electron build also loads in plain Node (the last
line). Without the module the Connect tab says Ableton Link is **missing** and
everything else runs.
