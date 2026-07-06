# Palinopsia — Spout sender addon

A minimal N-API addon wrapping **Spout2**'s `spoutDX` (DirectX 11) class, so the
app can publish its composite as a **Spout** source (Resolume, OBS, …) straight
from the readback pixels. DX11 needs no OpenGL context, so it runs headless in
the Electron **main** process.

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
node-gyp rebuild --target=33.4.11 --dist-url=https://electronjs.org/headers --arch=x64
```

Then the **Spout** toggle in ⛶ Output → *Send* activates and streams a
`Palinopsia` sender. Add it as a source in Resolume (Sources → Spout) or OBS
(Spout2 Capture plugin).
