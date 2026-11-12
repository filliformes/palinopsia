# Palinopsia — Spout sender and receiver addon

A minimal N-API addon wrapping **Spout2**'s `spoutDX` (DirectX 11) class, so the
app can publish its composite as a **Spout** source (Resolume, OBS, …) straight
from the readback pixels. DX11 needs no OpenGL context, so it runs headless in
the main window's preload (or the **main** process as a fallback).

It also **receives** (the layer source *Spout / Syphon Input…*, `src/preload/shareIn.ts`) :
`senders()`, `recvOpen(name, gpu)`, `recvState`, `recvRing` / `recvTake` / `recvRetire`
(GPU route : every new frame copied on the graphics card into one of four textures
shared by NT handle, imported once by Electron's `sharedTexture`), `recvRead` (copy route :
read back on the receiver's thread, copied into the page's buffer off the JS thread),
`recvClose`. Each receiver runs on a thread of its own with its own D3D11 device (on the
high-performance graphics card, the one Chromium draws with), and finds its sender again
by name when it closes, restarts or changes size. `adapters()` lists the graphics cards,
and `open(name, format, adapter)` lets a test sender pick a format and a card.

`sdk/` vendors the required Spout2 SDK sources (BSD-3-Clause,
[leadedge/Spout2](https://github.com/leadedge/Spout2)). `spout_addon.cpp` exposes
`open(name)`, `send(rgbaBuffer, w, h)` (flips GL bottom-up → top-down), `close()`,
wired into `src/main/output.ts`.

## Rebuild (per Electron ABI)

Requires **Visual Studio** with the *Desktop development with C++* workload and a
recent **node-gyp** (npm 11's bundled node-gyp 12+ recognises VS 2022 **and**
2026). The prebuilt `build/Release/spout.node` is git-ignored, so rebuild after
cloning or changing Electron:

```bat
:: from a VS Developer prompt (or after calling vcvars64.bat), in native/spout:
npm install --ignore-scripts
:: match your Electron version (node -p "require('electron/package.json').version")
node-gyp rebuild --target=44.5.1 --dist-url=https://electronjs.org/headers --arch=x64
```

Then the **Spout** toggle in ⛶ Output → *Send* activates and streams a
`Palinopsia` sender. Add it as a source in Resolume (Sources → Spout) or OBS
(Spout2 Capture plugin).
