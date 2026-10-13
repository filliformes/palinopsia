# Palinopsia — USB input addon (macOS)

A minimal N-API addon over **AVFoundation** for the cameras Chromium cannot see,
first of all an **iPhone or iPad plugged in by USB**. macOS shows its screen as a
camera (QuickTime's *New Movie Recording* offers it), but:

- only to an app that opts in (`kCMIOHardwarePropertyAllowScreenCaptureDevices`), and
- as a **muxed** device (sound and picture in one), while Chromium's enumeration
  asks AVFoundation for video-type devices only.

So the ordinary Live Input never lists it. This addon opts in, lists video **and**
muxed devices, and captures one : each frame is scaled down when its long side
passes 1920 (vImage), turned from BGRA into RGBA and kept as the newest frame.
The same recipe as OBS's `mac-avcapture` (the opt-in, a muxed discovery session, a
BGRA output).

It runs in the window's own process (`src/preload/avcapture.ts`), like the NDI
receiver : frames reach the page by transfer, not IPC. Calls :

| call | does |
|---|---|
| `enable()` | opt in to screen-capture devices (an iPhone appears about a second later) |
| `list()` | `[{ id, name, model, muxed }]` |
| `open(id, maxSide)` | start capturing in the background, returns a handle |
| `frame(handle)` | `{ state, w, h, srcW, srcH, seq, idle, error }` : `starting` · `running` · `missing` · `denied` · `failed` · `gone` |
| `copy(handle, arrayBuffer)` | the newest frame into a buffer of exactly `w*h*4` bytes, returns its `seq` (0 : nothing) |
| `setMaxSide(handle, px)` | the size cap, from the next frame |
| `close(handle)` | stop |

The preload opens a device again by itself whenever it is `missing` or `gone`,
every two seconds, for as long as a layer shows it : an installation's iPhone that
powers up after the computer joins on its own.

## Build

Needs the Xcode command line tools (no framework to build).

```sh
sh native/avcapture/build.sh
```

It builds `build/Release/avcapture.node` for the app's Electron version, signs it
ad hoc (arm64 code must carry a signature to load) and loads it once in Node to
list the devices. CI runs it on the macOS job; if it fails there, the release
still ships and the USB input reports itself unavailable.

Not built on Windows / Linux : an iPhone shows its screen as a camera only to a Mac.
