# Changelog

All notable changes to Palinopsia. Dates are ISO. Versions follow the `v*` tags
that CI builds into cross-platform releases.

## Unreleased

### Added

- **Fulldome output** (Output page). The engine renders a square **domemaster**
  (equidistant fisheye, front at the bottom) at 2K / 4K / 8K from the flat
  composition, aperture 180–230° (210° default, the SAT Satosphère), and it
  replaces the frame everywhere : preview, projector window, NDI, Spout,
  recording, stills. Three ways to fit a 2D picture : **full dome** (the whole
  frame over the whole 210°, nothing cropped, no black; or cover / contain),
  **panorama** (wrapped around the room, up to the zenith) and **screen** (a flat
  virtual screen re-projected to read undistorted from the centre); rotate, spin,
  rim feather, flip and an
  alignment grid burned into the output. A **3D dome simulator** (ported from the
  TouchDesigner FulldomeSimulator) shows the live master on a dome, from the seat
  or as an outside cutaway, with tilt, template and sweet spot.
- **Resolume OSC mapper** (new page, key `K`). Read a Resolume composition
  (`.avc`) : its layers, groups, columns, clips, effects and dashboard links become
  the columns of a matrix whose rows are Palinopsia's signals (modulators, Meta
  knobs, audio / vision / body features, any `/opsia` address). Click / paint to
  connect, per-cell amount, float / toggle / trigger columns with range and
  smoothing, **Learn** addresses off Resolume's own OSC output, scene → column
  triggers, 8 snapshots, a **lock**, and the whole mapping saved with the session.
- **TouchDesigner recipes** as native nodes, in any rack : **Remap**, **Luma Blur**
  (with a depth-of-field mode on the depth map), **Gooey** (blur then threshold),
  **Matte** (three inputs) and **Lookup** (a live layer as the palette). Nodes can
  now take a second layer input.
- **LighterColor** blend mode (whole-pixel lighter-wins).
- **NDI output, built in** (Output page). Replaces the old optional sender stub:
  Palinopsia now publishes an NDI source itself, calling the NDI runtime directly
  (bundled with the build, or the machine's NDI Tools / Runtime / SDK, or the copy
  TouchDesigner, Resolume or vMix carries). Sends the clean picture or the
  domemaster : **4096×4096 at 30 fps** into a receiver, measured with a GPU-bound
  scene and with the window minimized. Name, rate (25 to 60, 29.97 / 59.94
  exact), size cap, UYVY (GPU-converted) or RGB; Discovery Server, network card,
  extra IPs and groups for venue networks, private to Palinopsia and applied live;
  receiver status, sent rate, ON AIR / PREVIEW tally. `npm run ndi:bundle` ships
  an installed official runtime inside the next build.
- **NDI on a computer with no NDI** : one click installs NDI's official runtime
  (downloaded from NDI over HTTPS, signature checked, NDI's own installer opened),
  and the NDI source goes live by itself when the install finishes.
- **DXV3 recording, in real time** (Resolume's GPU codec) : the graphics card
  compresses each frame (DXT1), a few workers write the DXV3 frames and the file
  is written as it goes, so there is nothing to convert after and **no size limit**
  from a video encoder : the **4096² fulldome master records at full size** (a
  bigger master is scaled to 4096). Constant 30 or 60 fps, the clean picture.
  Checked against FFmpeg's DXV decoder and Resolume's own file layout.
- **Record location** : Output → Record → **location…** picks where takes,
  screenshots and Assemble exports go (checked writable, remembered on this
  computer, ↺ back to Recorded/, click the path to open it). A chosen folder that
  can't be reached (an unplugged drive) falls back to Recorded/ with a warning,
  instead of losing the take.
- **Recording formats know their limits** : the hardware video encoder takes up to
  3840×2160 on this machine (measured), so above that (the 4K dome) the other
  formats show greyed out and a take records DXV3; the MIDI record toggle now uses
  the chosen format too (it always recorded "Fast"). "Fast · no re-encode" is now
  labelled for what it is : MKV, H.264 as captured.
- **Syphon output (macOS)**, the twin of Spout : a built-in Syphon (Metal) server
  named Palinopsia, for Resolume, MadMapper, TouchDesigner, VDMX, OBS on the same
  Mac. Built from the Syphon framework's source in CI.

### Fixed

- **Mosaïque** never matched anything : its matcher named a variable `patch`, a
  reserved word in GLSL ES 3.00, so the matching program never compiled and the
  node could not choose tiles. Found by compiling every engine shader in a plain
  WebGL2 context.
- **The output stage no longer stalls the render loop.** Measured at a 4K
  composition :
  - the projector window : 25-27 fps with it open, now 60 (its readback was
    synchronous; the frame is now read back asynchronously and posted to the
    window from a worker, where the cross-process copy no longer costs the loop);
  - the Output page with the 4096² dome simulator : 47-49 fps, now 60;
  - **Spout delivered 0 frames per second at 4K** (its two-slot readback dropped
    every frame whose fence was late); it now sends ~58 fps of the clean picture
    from the window's own process, top-down (no CPU flip);
  - projector + Spout + a DXV3 take together : 57-60 fps.
- **HIVE output could never start** : its encoder settings asked Windows' hardware
  encoder for 60 fps, which it refuses at every size (measured). It starts now.
- The projector window no longer receives the whole render state every frame
  (left from when it ran its own renderer) : just the keystone, when it changes.
- A recording the encoder never fed no longer leaves an empty file behind.
- **Minimizing the window no longer stalls the show.** A minimized window gets
  (almost) no animation frames from Chromium, so the render loop, and with it the
  projector stream, Spout, Sonify and OSC out, dropped to about one frame a
  second. The loop now notices and runs on a timer until the window paints again,
  and that timer waits for the GPU to finish each frame : without rAF's pacing, a
  heavy scene let the loop run seconds ahead of the GPU, and NDI starved behind
  the queue (measured : 0 to 1 fps, now it follows the render rate).

### Changed

- **Film dust and film scratch, rebuilt from how real film gets damaged** (Finalizer).
  The dust used to be little black and white squares : one cell of a fixed grid
  switched on, all the same size, far too many, held for a whole drawn frame, and
  only when Film Hold was on. It is now its own stage (`engine/filmDamage.ts`),
  on whenever dust, scratch or hair is up :
  - **Dust** changes every **film frame** (24 fps, Super 8 18), not every drawn
    frame. Mostly tiny specks, rarely a big one (a power law), with irregular
    rotated outlines, sharp or out of focus, big pieces mottled like real clumps.
    Dark on the print, white sparkle from the negative, never pure black or white.
    The count changes every frame, bunches up and comes in occasional bursts.
    Specks smaller than a pixel fade instead of flickering, so a 1080p render and
    an 8K dome master look the same. The odd **fibre** too : thin, curved,
    tapered, uneven.
  - **Scratches** run along the strip : each lasts from a fraction of a second to
    a minute, stays straight within a frame, wanders slowly sideways, starts and
    ends partway down a frame, breaks up, and has ragged edges. Mostly dark (the
    print), some white (the negative), some green / yellow (a colour print's
    emulsion), sometimes two or three running together.
  - New : **gate hair** (a hair caught in the projector gate, hanging in from an
    edge and trembling, for seconds to a minute), **film gauge** (35 mm / 16 mm /
    Super 8 : the same dust is ~4x bigger on Super 8) and **dirt on** (print /
    mixed / negative).
  - Dirt and scratches ride the Film Hold boil; the gate hair doesn't.
  - Under half a millisecond per frame at 4096² (measured).
  - Griffé, Peint and Pressé retuned; Randomize no longer dirties the Finalizer
    (dust, scratch, hair, gauge and dirt are left as they are).
  - Older sessions and scenes keep their look : Randomize used to roll dust and
    scratch values that stayed invisible without Film Hold, so a session saved
    before this change with the hold off opens with them at zero (once).
- **Output page order**, top to bottom : Composition size, Render scale, Mapping,
  Fulldome, Fullscreen output, Record, Spout / Syphon, NDI, HIVE, Flash safety,
  Lights, Installation mode. The Spout section is now **Spout / Syphon** and shows
  the one this computer uses. Flash safety starts collapsed (it stays on).
- The **window title** now carries the release version, like dataFLOU_compositor:
  `Palinopsia v1.1.0` on the main window, `Palinopsia v1.1.0 : Output` on the output
  window. Read from `package.json` at launch, so every tagged build titles itself.
  (The output windows' title was also being silently reset to plain "Palinopsia" by
  the shared page `<title>`; it now holds.)

## v1.1.0 — 2026-09-18

The "played by the room" release: embodied control, sound in both directions, and
the instrument reaching out into the space around it (projectors, DMX, MIDI clock).

### Added

- **Body: embodied control (new full-page mode, key `B`).** Opt-in webcam →
  MediaPipe **Hands + Pose + Face + Silhouette** into a live body bus.
  - **Features → modulators:** every tracked quantity (hand height / openness,
    body lean / motion / stance, face blendshapes + head pose, and the silhouette
    zone coverages) is a `body` modulator source, routed with one click.
  - **Rule builder:** author actions from one gesture or a two-gesture combo
    (together `+` or in sequence `→`, with exclusive combos), drawn from the shared
    MIDI/keyboard trigger vocabulary (Randomize scopes, transport, scenes, Sonify
    voices, sessions, undo/redo). Auto-named, with a custom `/body/<name>` OSC out.
  - **Silhouette zones:** the pose segmentation mask reduced to a 3×3 screen grid —
    each zone a continuous feature and a `cover …` occlusion gesture.
  - **Presence** enter/leave triggers (body / hands / face), debounced: the
    installation trigger for someone walking into or out of frame.
  - **Per-gesture sensitivity** on single-gesture rules (global slider is the default).
- **Colour ↔ sound.** An `audio` **noisiness** (spectral flatness) feature and
  `vision` **hue** + **saturation** features, so sound can tint the picture and
  the picture's colour can drive any Sonify parameter through the mod matrix. The
  Sequencer's **Climat** tag takes a "from picture" suggestion off the live palette.
- **Installation / kiosk mode.** Boot a session fullscreen on a chosen display,
  with renderer-crash self-heal and an exit hatch. Custom composition size and
  **multi-projector span** for wide outputs.
- **Light output.** ArtNet/DMX + WLED: push the picture's colour into the room.
- **MIDI output.** 24-PPQN clock + transport and a thru/merge path to drive an
  Ableton Move (or any gear) over USB; the Randomize dice, master-FX chain and
  session buttons are now MIDI-learnable.
- **Audio input** monitoring / passthrough with separate Sonify and monitor levels,
  and an adaptive USB-noise **denoiser** (learn the noise, multi-notch filter).
- **Performance** sub-tab: per-section GPU / CPU / RAM load, with units and tooltips.

### Changed

- Sequencer page: clearer visual sections and hover overviews; a colour-coded,
  aligned Body feature monitor.
- Documentation: full Body section in the README, and the GitHub Pages quickstart
  reworked into a landing page with a download section.

## v1.0.2 — 2026-09-09

- Maintenance and packaging fixes.

## v1.0.1 — 2026-09-09

- Windows app-icon fix.

## v1.0.0 — 2026-09-09

- First public release: the four-layer ISF/WebGL compositor, modulation brain +
  Meta knobs, curated Randomize + Generate, video / capture / HIVE sources, Output
  + warp + Spout/NDI, OSC + OSCQuery, the Sonify image-to-sound engine, MIDI Learn,
  and the Assemble automatic video editor. Windows + macOS + Linux.
