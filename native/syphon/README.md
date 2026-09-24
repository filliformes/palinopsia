# Palinopsia — Syphon sender addon (macOS)

The macOS twin of `native/spout`: a minimal N-API addon over the Syphon
framework's `SyphonMetalServer`, so the app publishes its composite as a
**Syphon** source (Resolume, MadMapper, TouchDesigner, VDMX, OBS…) straight from
the readback pixels. Metal needs no window, so it runs headless in the Electron
**main** process. Same three calls as the Spout addon, wired into
`src/main/output.ts`: `open(name)`, `send(rgbaBuffer, w, h)` (GL bottom-up,
flipped by Syphon), `close()`. It skips the upload while no client is watching.

The Syphon framework (BSD, [Syphon/Syphon-Framework](https://github.com/Syphon/Syphon-Framework))
is built from source at a pinned commit and shipped next to `syphon.node`.
It is not compiled into the addon because its Metal server loads a shader
library that the framework's Xcode project compiles into the bundle.

## Build

Needs **Xcode** (command line tools alone lack the Metal compiler).

```sh
sh native/syphon/build.sh
```

It clones the framework, builds it with `xcodebuild`, builds the addon for the
app's Electron version with `node-gyp`, and leaves `build/Release/syphon.node` +
`build/Release/Syphon.framework`. CI runs it on the macOS job; if it fails there,
the release still ships and the Syphon toggle reports it unavailable.

Then **Output → Spout / Syphon → Syphon on** publishes a `Palinopsia` server.
Check it with Syphon's *Simple Client* or add it as a source in Resolume
(Sources → Syphon) or MadMapper.

Not built on Windows / Linux (Spout covers Windows; Linux has neither).
