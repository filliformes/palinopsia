# Changelog

All notable changes to Palinopsia. Dates are ISO. Versions follow the `v*` tags
that CI builds into cross-platform releases.

## Unreleased

### Added

- **New effect controls** (defaults keep today's look) : per-column / per-band audio on
  Byte Corrupt, Databend, Mosh Blocks, Row Echo, Slice Shuffle, Tiles, Distort (audio
  rings) and Motif (band echoes); `fire` on Databend and Row Echo; Threshold `alpha key`;
  Pixel Sort `angle`; Pixelate and Tiles `average`; Compress `vary`; Databend `wrap`; CRT
  Screen `lines` and `moire`; Scanlines `moire`; Rutt `relief` (hanging or mountain);
  Grade `gamma`; Hue Rotate `rate`; Palette `cycle`; RGB Shift wobble rate; Edge `ink`;
  Transform `cutout`; Wavefold and Colorizer `invert` (the old negative look).
- **Collage** : `speed spread` (each piece plays at its own rate) and `freeze`.
- **Text** : crawl (a ticker along the baseline), shrink to fit, letter drift,
  typewriter reveal, and one line at a time with `next line`.
- **New source controls** from the generator audit, every default keeping
  today's look :
  - Drift Field `strata angle` and `reseed`;
  - Slabs `spectrum light`;
  - Contour `index lines` and `audio swell`;
  - Ten Print arcs as a second `style`;
  - Particle Drift `trail fade`, `density` and `audio pulse`;
  - Column Scan `audio trace`;
  - Murmuration `heading` and `veer`;
  - Filaments `audio sway`;
  - Congeal `clear` and `audio sparks`;
  - Ramps `mirror` and a movable center;
  - RGB Oscillators `chroma` and `audio FM`;
  - Recurse `drift angle` and per-level `audio`;
  - Shapes `density` and `spin`;
  - Op-Art `audio`;
  - Direct Marks `boil`, `fps`, a `seed` for a new hand, and `audio gate`;
  - Metamorph `birth` (at rate 0, births happen only on the trigger);
  - Sync Osc `audio FM`;
  - Differential `audio bands`.

  Every non-obvious input now has a tooltip, and there are new presets and
  search words.
- **tools/shader-rig** : checks any generator or effect offscreen, with no app
  window : a 24-hour show in one step, knob scrubs, 4K cost, stills at 16:9 and
  square, and a moving test card for effects (`tools/shader-rig/README.md`).
  **tools/test-build.sh** builds and launches an isolated copy of the app for
  automated tests, beside the real one, with its own settings.
- **Grown** (Organic) : a texture that grows itself. A tiny neural cellular
  automaton, trained offline on a real photographed surface (lava, mossy rock,
  bark : `tools/nca`, CC0 scans), grows that texture cell by cell from an empty
  grid and keeps it alive. DAMAGE cuts a hole that heals within a second (the
  cells were trained to heal wounds), REGROW starts over. Cells, speed, drift,
  color, brightness; six presets. Paced by the layer clock (Speed and freeze
  apply).
- **Scan** (Organic) : a real photographed surface. The 30 CC0 ambientCG
  material scans now ship their colour maps too (4 MB, re-encoded), laid across
  the frame with hex tiling (Mikkelsen 2022 : shifted, blended tiles, so a 1K
  scan never visibly repeats) and relit by the organic relief light. Colony's
  new transparent `ground` grows lichen or rust over it. Ten presets.
- **Colony** (Organic) : living matter growing across a surface. One generator,
  four kinds : lichen on granite, mould on agar, burning paper, rust on steel
  (verdigris on copper). Seeds spread cell by cell with the rough front measured
  on real growth (burning paper, bacterial colonies), slowed by poor ground,
  stopping short of each other; each colony ages (lichen crusts crack into
  areolae, mould sporulates in rings, char turns to ash, rust pits and flakes).
  Lit as a relief. Regrow on a button or on a cycle; ten presets.
- **Ground** (Organic) : the surfaces under the living things, lit as a relief.
  Cracked mud drying (cracks widening, edges curling, a second generation late),
  sand ripples migrating with the wind, rock strata, wood end grain, bark; each
  with an alternate palette. Ten presets.
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

- **Effects audit, glitch / analog / color / geometry (41 effects).** Fixed what was
  broken and kept what gives character (the corrupted-data smears, the stepped blocks,
  the CRT moiré, the edge fringes stay the default look; the clean variants are options).
  - Texture reads that the shader loader silently rewrote : Databend's rotated bands
    read the frame diagonal, Compress never saw vertical edges, Aperture's blur and
    Optical Rain's stereo taps went diagonal.
  - Transparency : Compress, Databend, Pixel Sort, Tiles, CRT Screen, Rutt, Optical Rain
    and Phosphene turned a transparent layer into an opaque black slab.
  - Knobs that did nothing : Pixel Sort's length (capped at 96 px), the Compress grid at
    small blocks, the Pixelmask grid, digital grain size; Row Echo's fade worked
    backwards.
  - Rutt drew no lines in bright areas; Phosphene burned in for good and white left no
    afterimage; Wavefold and Colorizer's fold turned dark grounds white; Palette mapped
    pure white to the wrong color; Distort's bulge and pinch were swapped; Fold's "Floor
    fold" smeared a third of the frame.
  - Knobs that jumped the picture (NTSC field crawl, Scanlines roll, Optical Rain).
  - Presets set every input, so one no longer leaks into the next; 20 Colorizer presets
    named after films, film stocks and brands renamed descriptively.
  - Sizes follow the frame height, so 4K and the dome keep the 1080p look.
