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

### Fixed

- **Mosaïque** never matched anything : its matcher named a variable `patch`, a
  reserved word in GLSL ES 3.00, so the matching program never compiled and the
  node could not choose tiles. Found by compiling every engine shader in a plain
  WebGL2 context.

### Changed

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
