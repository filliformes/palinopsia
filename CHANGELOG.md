# Changelog

All notable changes to Palinopsia. Dates are ISO. Versions follow the `v*` tags
that CI builds into cross-platform releases.

## Unreleased

### Added

- **Veins** (Organic) : leaf veins and roots grown by the space-colonization model
  botanists use for real leaves (Runions et al.). A blade grows from its margin and
  calls its veins; open leaves branch, closed leaves fuse into loops, roots reach down
  through the soil; widths follow the pipe model. It grows, holds, fades and starts a
  new one. Six presets (Green leaf, Ginkgo, Skeleton leaf, Autumn, Roots, Fine roots).

- **NDI input** : a layer's source menu → **NDI Input…** lists every NDI® source on the
  network and plays the one you pick like a webcam (framing, FX, blend) : a camera, a
  phone's NDI camera app, OBS, NDI Tools, another Palinopsia. Received through the same
  NDI runtime as the sender (no virtual-webcam hop), full quality, shared when several
  layers show one source; a session remembers the source by name and reconnects when it
  appears. Always the newest frame (NDI's frame sync : skipped, never queued, so it can't
  drift behind), copied off the main thread and turned the right way up on the GPU; the
  Inspector shows size, fps and delay. Measured : a 1080p source ~45 ms behind at full
  rate; a 4096×4096 source ~110 ms behind with the app at 53 fps (the first version :
  580 ms behind and the whole app down to 17 fps). Listing never touches the camera.

- **Slime Mould** (Organic) : a slime mould's transport network, grown live by
  hundreds of thousands of agents (Jones' Physarum model). A fine mesh within seconds
  matures into a web of veins that thicken, prune and reroute; seeded as a disc it
  contracts, then migrates and forages with branching fronts. Six presets.

- **Fluid** (Organic) : a real fluid, solved live. **Ink** blooms and folds in still
  water, **smoke** rises from vents into eddies and spreads under the ceiling,
  **fire** is hot gas that lifts, puffs and glows by its temperature, soot above it.
  Stable fluids on the GPU with vorticity confinement, a grid kept to the frame
  height (4K and the dome look like 1080p), fixed steps on the layer clock. Flow,
  sources, wander, swirl, buoyancy, viscosity, fade, detail, `stir ▸` and `clear ▸`;
  seven presets (Ink in water, Indigo bloom, Marbling, Smoke column, Incense,
  Campfire, Candle). About 1 to 1.5 ms a frame.

- **Context : surface material evolution.** A new **evolution** slider in the surface
  material (Finishing > Context) keeps the surface from sitting perfectly still, as if a
  little wind moved the projector or the camera filming it : the material drifts a few
  pixels under the image in a slow, irregular sway with light gusts, turns and breathes
  very slightly, and the raking light shifts with it. 0 (the default) is perfectly
  still, so existing sessions look the same.

- **Click a modulation chip to turn it off** (and again to turn it back on) : the
  assignment stays with its depth, its parameter sits at its own value meanwhile.
- **Video : stop, scrub and browse.** A **■ stop** button (pause and back to the in
  point); click or drag anywhere on the timeline to move the playhead, playing or
  paused; a **clip** row (◀ / ▶ and a dropdown) steps through the other videos in the
  clip's folder, keeping speed, direction, loop and grain. The **◇ smooth** button
  lights up when the settings will strobe on an ordinary clip.
- **Finishing : default** on Vibe, Context and Finalizer puts the stage back as a New
  session starts it, every parameter included (Context's hidden surface relief too).
- **Link a folder of sessions** : right-click the Session **Load** button, pick a folder,
  and every session in it (subfolders included) joins the dropdown, grouped under the
  folder's name and listed in name order. Linked, not copied : sessions saved there
  later show up too. The same menu lists the linked folders (click to jump, × to unlink).
- **Movement qualities** (Body page, with Pose on) : HOW the body moves, not only where.
  Six features read from the pose, measured against the body's own size so near and far
  read alike : **energy** (still to vigorous), **expansion** (folded in to limbs spread
  wide), **fluidity** (a shake or a stop-go reads jerky, a sweep smooth), **suddenness**
  (sustained to sudden), **directness** (circles and meanders to straight to the point)
  and **symmetry** (left against right). Two new gestures : **impulse**, a burst out of
  calm, and **freeze**, a quick stop held still. The camera's own jitter is learned and
  taken off, so a still body reads still on any camera. Streamed over OSC with the other
  body features (`/opsia/body/moveEnergy` …).
- **Silhouette source** (listed with the live inputs in the source picker) : the body
  in front of the Body camera, cut out of the room, as a picture on any layer.
  **Cutout** shows the camera where you are and nothing elsewhere (background removal,
  no green screen), **matte** a white body on black (to key another layer or feed a
  Matte node), **shadow** a flat colored silhouette, **hole** the room with you taken
  out. Threshold and softness shape the edge, and **trail** leaves fading echoes of the
  body behind it. It never turns the camera on by itself : its Inspector line says
  whether the camera is live and offers the click that turns it on. When nobody is in
  frame the silhouette empties rather than freezing on the last shape.
- **Motion field** (Body page, **Motion** toggle) : the camera's optical flow (a
  pyramidal Lucas–Kanade on a small copy of each frame, no body model) read as nine
  features : how much moves, which way, whether it **spreads out or closes in** (someone
  approaching, arms opening), whether it **turns**, whether it moves **as one or in every
  direction**, where, and how much of the frame. New gestures : swipe L / R / up / down,
  approach, withdraw, turn cw / ccw, and **stillness** (a moving room holding still). It
  follows anything that moves, a crowd or a curtain as well as a body. The picture itself
  gains the same reading on the vision bus (`flowX`, `flowY`, `divergence`, `curl`,
  `coherence`), and body features now stream over OSC as `/opsia/body/<feature>`.
- **Three new Generate families** :
  - **Dome** (Aurora, Canopy, Flock Overhead, Strata, Deep Water) : made for a fulldome,
    no vignette, nothing framing the edges, slow motion overhead;
  - **Film Wall** (Film Wall, Contact Sheet, Nitrate, Projection Booth) : your own films
    through a Collage, graded and damaged. It plays the Collage folder of the session, or
    the last one picked on this computer; with none yet it stands in with painted sources
    and says how to pick a folder;
  - **Node Workshop** (Gooey Blobs, Borrowed Palette, Layer Matte, Displaced, Focus Pull,
    Fault Line) : one recipe node per theme, on the layer that reads the others.
- **25 new master chains**, in three groups of the chain presets menu :
  - **Time & memory** : Echo Memory, Sediment, Time Map, Eternal Pair, Ghost Complement,
    Low Frame Rate, Oxidized and Slow Loop (Réponse, Sediment, Chronoscan, Eternalism,
    Afterimage, Decimate, Corrode and Feedback on the master bus);
  - **Node recipes** : Fault Lines, Gooey, Luma Focus, Live Palette, Layer Matte,
    Remapped, Imprint, Stamp, Live Mosaic, Wake and Painterly (the layer-reading nodes
    are wired to layers in use);
  - **Dome** : Clean, Film, Drift, Glow, Memory and Sky, with Context's vignette off
    (it darkens the rim of a fisheye) and nothing that frames the edges.

  They keep the scene's palette mix (a generated scene keeps its colors and its level)
  instead of dropping to the raw sources as the older chains do.
- **Chain presets can wire the nodes that read another layer.** A master chain preset
  says which layer a node reads (the bottom, top or second layer in use), resolved when
  it is applied, so Lookup, Matte, Remap, Transfert, Convolution and Mosaïque work
  inside presets. A preset can also set Context (a dome-safe chain turns its vignette off).
- **Generated scenes move.** Every Generate theme now binds a few modulators across its
  layers, in its family's way of moving : slow breathing for Organic, Living Surfaces and
  Cinematic, drawn cadences for film, stepped and on the beat for Glitch and Data, sine
  and saw sweeps for Analog. Every active layer gets at least one moving parameter; the
  master (the theme's color and finish) and the World's audio route are left alone, and
  the Feel studies stay still so each one isolates its macro. A theme can bend its
  family's recipe (`motion` in themes.ts).
- **Generate uses the whole instrument.** Ten Print, Congeal, Metamorph and Text (with
  words from the theme) join the themes they fit; the eleven effects it never picked
  (Abstraction, Aperture, Difference Bloom, Force Lines, Granular, Tiles, Motif, Slit
  Buffer, Smear, Solarize, Triangle Flicker) and fourteen native nodes now land too.
  Nodes that read another layer (Lookup, Matte, Remap, Convolution, Transfert, Mosaïque)
  are handed a layer that is actually in the scene. LighterColor, weave, lumakey and
  consume join the blends. A new **Living Surfaces** family : Lichen, Rust, Mold Culture,
  Burning Paper, Dry Earth and Grown, real surfaces that grow, crack and rust.
- **Finalizer `dirt burst ▸`** (film damage) : a dirty stretch of film passes the gate,
  four to eight times the dust for about a second, then clean again. Works even with
  dust at 0. Fire it on a beat or an onset (bind M, MIDI or OSC).

- **Time and feedback controls** : Light Trails `knee` and `clear`, Wide Time `burn` and
  `clear`, Difference Bloom `hold` and `soft`, Feedback Zoom `center`, `drift`, `edge` and
  `clear`, Force Lines `slide`, crawl `rate`, `vary` and `audio`, Granular `stagger`,
  `sizeVar`, `edges` and `audio`, Slit Buffer `angle` and `grab`, Smear / Streak `smooth`,
  Decay `headSwitch`, Abstraction `rate` and `coherence`. Tooltips for the color and
  geometry effects.

- **New node controls** (defaults keep today's look) : Feedback `clear`, Sediment
  `snapshot`, Eternalism `freeze`, Réponse and Chronoscan `stride` (longer memory),
  Chronoscan ping-pong sweep, Parallax sway rate and a smooth depth-of-field disc,
  Scanner audio lines, Afterimage `dwell`, Melt `mix`, Faultline and Decimate beat
  `sync`, Sillage `scan` / `ground` / swirl center / `clear`, Toile smooth strokes,
  Pulfrich zero plane, Corrode eat-to-transparent, Luma Blur smooth quality and `mix`,
  Matte transparent cut-out.

- **Phase wrap** : a shader can declare `uniform float PH_x; // wrap <period>` so a
  periodic phase stays precise over day-long shows. Finalizer `film grab` (re-draw or
  re-freeze on a trigger). Context `smoothing`. `tools/shader-rig build.cjs --out` for
  parallel rigs.

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

### Changed

- **Mycelium grows for real.** Its threads used to be contour lines of noise : closed
  loops that never had tips, never branched and never fused. It is now a colony of
  hyphal tips (native) : they run out from spores, branch, bend toward fresh ground,
  fuse where they meet the network and eat the soil, so it advances as a front,
  bundles into cords, stalls, dissolves and starts again elsewhere. Same controls, so
  sessions keep theirs, plus **regrow ▸** and a ground color.

- **Reaction runs natively, at full precision.** Its chemistry lived in the shader
  runtime's 8-bit buffer, which stalls the slow terms and bands the pattern; it now
  runs in 32-bit floats on its own grid. The pattern keeps its size in the frame at
  1080p, 4K and on the dome, runs the same at any frame rate, `rate` goes up to 3
  (the old explicit step broke past 1.2), a `scale` change reshapes the living
  pattern instead of restarting it, and **regrow ▸** starts it over. Same inputs, so
  sessions keep their settings. It costs about 0.7 ms a frame at 4K. Built on a new
  registry for native generators (Grown moved onto it), the base for the next organic
  engines.

- **Context's "surface" section is now "surface material"** (plain "surface" also named
  the Metasurface). The material once called **rock rough** is now **stacked stone**,
  which is what it is (layered stone blocks); sessions keep it.
- **Flash safety holds softly** : a held region now fades out over most of a cell
  instead of a quarter of one, so it reads as a soft patch rather than a 6x6 grid of
  blocks (dragging a slider fast, e.g. texture scale, used to show the grid). The held
  cells are limited exactly as before; their neighbours a little more.

- **Context shows what the picture actually gets** : Proximity (toward far), Coalesce
  (toward mass), Flow, Gesture⇄Texture and the sequencer's Breathe / Arc add blur,
  haze, trails or depth ON TOP of Context's sliders, so every slider at 0 could still
  soften the image with nothing on screen saying why. A line under Context's header now
  reads e.g. `live blur 0.23 · haze 0.13 ← Proximity, Coalesce` whenever the engine
  uses more than the sliders, and **neutral** puts those macros back to 0.5. Proximity
  and the field macros are remembered on the computer between sessions.
- **Fulldome is much lighter on the graphics card** (after two blue screens, 0x116
  VIDEO_TDR_FAILURE with the driver out of resources, in dome output) : the main canvas
  no longer carries a multisampled colour buffer and a depth buffer it never used, which
  at a 4096² master cost hundreds of MB of video memory (the dome now adds ~300 MB
  instead of ~750, measured). The live dome tops out at 4K (a live 8K master added
  ~1.9 GB); the shared-output capture never exceeds 4096; and the engine skips a frame
  instead of queueing more work when the card falls two frames behind. A few small
  graphics-memory leaks are closed (a failed shader load, the light-output zones).
- **The Body camera tracks each camera frame once** : the models used to run again on
  every display frame, twice or more per picture. Tracking now costs about half. **Hi-res**
  (Body page) runs them on every display frame as before, for a fast camera or the
  finest landmarks. Body motion reads as it did.
- **The "Test" family in Generate is now "Feel Studies"**, at the end of the list : one
  theme per Feel macro, each keeping everything else still so the macro can be heard.
- **An Analog section in the source pickers** (layers and Background), after Organic :
  RGB Oscillators, Sync Osc, Slit Scan, Ramps, Column Scan, Differential and Interference,
  the analog video-synth lineage in one place. Generate's Analog Video Synthesis themes
  draw on all of it.
- **Finishing panel in labelled sections.** Vibe Palette, Context and Finalizer
  were each one long list of sliders; each is now split into named families
  with a thin coloured header and a matching rail down the left :
  - Vibe Palette : palette · color chord · tone · split-tone
  - Context : softness · distance · light · surface
  - Finalizer : grade · character · 3D · hand-made film · film damage · output shape
  - A section's master switch (character, 3D stereo, film hold, output shape,
    PBR surface, color chord) sits in its header, and a section whose switch
    is off folds itself away until you turn it on (or click its header).
  - Rows drop only the words their header already says ("film dust" is "dust"
    under film damage); the modulation lists and OSC keep the full names.
  - Rows that do nothing right now are greyed with the reason in the tooltip
    (parasites outside crt / vhs, palette stops beyond "stops used" or under a
    color chord, the fill color when the Background fills the outside).
  - Colors, dropdowns and toggles now sit on one line like the sliders.
  - The "Finishing on · Vibe · Context · Finalizer" line at the top of the tab
    is gone (the same toggle is in the Master FX strip).

- **CRT / VHS parasites, rebuilt** (Finalizer character and the Grain FX). They
  were small rectangles : one band out of 60 across the frame (18 px tall at
  1080p) with a hard-edged dash in it. Now counted in real scanlines (480, so a
  dropout is one line tall at any output size) :
  - **VHS** : line edges wobble (no time-base corrector), the head-switch tear
    frays the last lines at the bottom, and **dropouts** (the head losing the
    tape for an instant) turn a single scanline white from where they hit,
    fading over a tail as the signal recovers, a few dark, in bursts, a new
    set every field. Pushed high, a **tracking band** of torn, snowy lines
    drifts through the picture, coming and going.
  - **CRT** : a soft **hum bar** rolling up the screen, a faint **RF weave**
    that comes and goes, and short **impulse specks** on single lines.
  - One shared implementation (`shaders/isf/lib/analogParasites.glsl`).

- **The Organic family, made physical** (research : noise and growth models,
  wave physics, flame colour; every change measured at 60 fps at 4K) :
  - **An Organic section** in the source picker : the living generators first.
  - **Relief lighting** on Reaction, Erosion, Membrane, Mycelium and Dye Field :
    none of them had any light, which is the main thing that made them read
    flat. `relief` and `light angle` : one low raking light, soft shadows, a
    cavity term, matte (0 = the old flat print).
  - **Swell** rebuilt : 24 wave trains, each at the speed its length gives it on
    deep water (longer waves faster), spread around the wind; shaded like water
    (dark body, sky mirror, sun glitter, whitecaps and wind streaks).
  - **Organic water** : the caustics are now sunlight focused by real waves onto
    the bed (the refraction's Jacobian), not a ridge of two noises.
  - **Organic fire** : flames accelerate and stretch as they rise, puff out of
    phase (the real flicker rhythm), coloured by temperature on the blackbody curve.
  - **Reaction** : the field wraps around (no seams when zoomed out), keeps its
    size in the frame at 4K and on the dome, holds its rate under the stability
    limit, and no longer seeds new critters in rows (its hash repeated).
  - **Dye Field** : pools are round, no longer stretched sideways at 16:9.
  - A shared **organic toolkit** (`shaders/isf/lib/`) : sine-free hashes, gradient
    noise with derivatives, exact Voronoi borders, blackbody colour, relief lighting.

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

- **App text** uses American spelling throughout, and names, presets and tooltips no
  longer carry third-party brand or artist names (the Colorizer film-stock presets, a
  Palette and a master preset are renamed descriptively).

- **docs/bibliography.md** : the research papers behind the instrument, cited in APA 7.

- The **window title** now carries the release version, like dataFLOU_compositor:
  `Palinopsia v1.1.0` on the main window, `Palinopsia v1.1.0 : Output` on the output
  window. Read from `package.json` at launch, so every tagged build titles itself.
  (The output windows' title was also being silently reset to plain "Palinopsia" by
  the shared page `<title>`; it now holds.)

### Fixed

- **A session could be overwritten without asking.** Load, Open, New, Generate and
  quitting silently saved the outgoing session into its file, so an experiment or a
  dice roll replaced the saved work. And after a crash **Restore** forgot which file
  the work came from, so the next switch wrote it into `Sessions/<the name inside the
  session>`, which a Save As copy shares with its original : another session was
  overwritten. Now a session file only changes when you save it : switching asks
  **Save changes?** (Save · Don't save · Cancel) when something changed, Don't save
  keeps a recovery copy (`Sessions/.history/_unsaved`), a MIDI-triggered switch
  never asks and never writes the file, Restore reconnects to its file, Save As names
  the session after the file, and **every overwrite keeps the previous version**
  (right-click Load → **Earlier versions**). The autosave ring keeps the last hour
  (it kept ten minutes).

- **Surface materials keep their proportions** : seven of the 30 scans are not square
  (bricks, concrete, corrugated steel, painted plaster, rock face, wood grain, paper
  crumpled) and were squeezed into square tiles, stretched to about twice their height,
  in Context's surface material and in the Scan source alike. They now tile at their
  real proportions. **Paper crumpled** also lost a streak of dark pits in its scan that
  repeated across the frame as vertical lines, and now tiles cleanly.

- **Video above 8x froze on real footage** : each frame was an exact seek, which on an
  ordinary (long-GOP) clip decodes from the previous keyframe : 0.5-3 s per seek on
  heavy 1080p / 4K (measured), so the picture held for seconds. ffmpeg now indexes a
  clip's keyframes once in the background, and when a clip's seeks run slow the player
  steps keyframe to keyframe (each such seek decodes one frame) : 14-18 pictures a
  second at 16-64x on camera-like 1080p, about 3 on clips with a keyframe only every 10
  s. Reverse uses it too. The ◇ smooth copy still gives the most (about 40).
- **Video speed** : 8× froze an ordinary (long-GOP) clip outright, and anything slower
  than 1/16× silently played at 1/16×. A clip now drops to frame-stepping when its
  decoder stalls at speed, and slow motion runs down to 1/64× (measured : 1/64, 1/28,
  8 and 64 all play at their set rate).
- **Video grain was upside down** (the voices were flipped twice), and while a grain
  voice was still loading its placeholder formed a GL feedback loop that dropped the
  whole grain picture for those frames.
- **A paused video ignored seeks** (OSC `/video/position`, modulation) : it now lands
  and shows the frame.

- **Context no longer softens the picture with its sliders at 0** : with the surface
  texture off, its hidden relief (default 0.5) still ran the surface stage on the
  flat maps, which are 8-bit and so a hair off flat : the whole frame shifted and
  darkened slightly, a soft blur nothing visible could turn off. Texture off is now an
  exact passthrough (measured identical to Context bypassed).

- Materials without an ambient-occlusion map no longer log a "file not found" error
  each time they load (12 of the 30 ship none; the neutral map is used, as before).
- **The heart shape** (Transform and the Finalizer's output shape) stood upside down,
  tip up, and its edge smudged at the sides and the cusp (it was an implicit curve, not
  a distance). It is now an exact heart, lobes up, with an edge as clean as every other
  shape and the same width as before. Rotate it by 180° for the old inverted one.

- **Weave, lumakey and consume now work as layer blend modes.** They were offered in the
  layer BLEND menu (and reachable by a modulated blend) but only existed in the A/B
  source mixer, so on a layer they quietly acted as normal. Against the stack below :
  weave displaces the two by each other's brightness and interleaves them, lumakey keys
  out the layer's near-black background, and consume runs the mixer's living competition
  field between the layer and the stack (the brighter side eats, they embrace at the
  front).

- **Context's material relief works, and the master no longer skips frames.** An image
  pushed into an effect outside its draw (Context's PBR maps) could be replaced on its
  texture unit by any renderer drawing in between. So Context read a random buffer as its
  brick or bark relief, and when that buffer was its own target, WebGL dropped the
  pass: Vibe and Context were silently bypassed about 13 times a second, even with no
  material selected. Image inputs now bind at draw time. A session saved with a Context
  material now shows that material's relief, which it never did before.

- **Console noise** : a shader swap waiting on the compile budget no longer logs
  "No uniform named ..." for every input the new shader brings.

- **Time and feedback effects (11).** Light Trails and Wide Time never faded back to
  black (an 8-bit stall left a permanent fog of everything that passed); they now fade
  fully, with stochastic rounding so the long trails keep their length. Wide Time froze
  at a quarter of its input, flickered at 30 Hz in difference mode and blew out in add /
  screen (the blowout is kept as a `burn` mode). Feedback Zoom, Light Trails, Decay and
  Slit Buffer showed last frame instead of this one. Difference Bloom blinked on video
  that updates slower than the display. Granular's grains never re-rolled their angle.
  Force Lines' taps were silently miscompiled; its old vertical slide is kept as the
  default. Smear and Streak keep their stepped ghost copies, with a `smooth` knob for
  the clean streak.

- **Every multi-pass effect sampled a black input on its first frame** (a pushed texture
  landed on a unit the pass buffers take), which also stored garbage in persistent
  buffers; and any shader whose last pass renders to a buffer crashed on draw. Both
  fixed in the shader bridge.

- **Native effect nodes (all 25).** Every node forced an opaque output; they now keep
  the layer's transparency. Feedback's brightness control lifted near-black grounds into
  a gray fog and its add blend clipped to white (now it targets the live layer, keeps
  headroom and turns rigidly at 16:9); Sediment's memory never faded (a half-float
  stall); Datamosh's actant mask never cleared and its first frame jolted; Réponse's
  gain did nothing; Chronoscan showed the present at quarter resolution; Eternalism's
  HOLD frames were always one apart; Parallax's fog darkened the near planes; Pulfrich's
  delay mapping wrapped; Melt never crept; Corrode ate the frame in seconds instead of
  minutes (bury is now the time to full corrosion, one minute to an hour) and left a dot
  grid; Sillage's noise collapsed into stripes over long shows; Toile cost 14 ms at 4K
  (now about 3); Mosaïque's tiles stretched at 16:9; Luma Blur and Gooey stepped at 4K;
  Decimate juddered. Nodes restart cleanly after insert, PANIC or a re-enable, follow
  the frame step, and compile lazily. Their signature looks (Feedback's heat, Datamosh's
  melt, the Autocutter's torn paper, the stepped ghosts) are kept.

- **Flash safety now does its job.** The limiter measured per frame on gamma-encoded
  light, so a 10 Hz black / white strobe got through at the default setting (and at
  144 Hz nothing was limited). It now counts flashes per second in real luminance, with
  a saturated-red term, per region of the frame, as flash-safety guidance does : a
  10 Hz strobe comes out with no flashes at the default 0.35, while ordinary content
  (pans, scrolling stripes, cuts, every generator tested) passes through bit for bit.
  Film flutter on a very bright scene can now be softened, since it counts as flashing.

- **The finishing chain.** Vibe mapped pure white to the wrong color stop (clipped
  highlights went gray or black); Context put the whole master one frame late and its
  trails could leave a permanent ghost; digital grain size did nothing; sharpening was
  lost in 3D; torn VHS lines smeared the frame edge. Context's ring-shaped blur and
  bloom stay the default look, with a new `smoothing` knob for the soft version.

- **Finalizer opacity** : the old "A" slider (which reached no output) is now a real
  fade to black, labeled "opacity". A session saved with it below 1 now looks darker.

- **Output stages** : Cameraless could re-show an old frozen frame and its draw clock
  could bank debt; the depth shadow fell the wrong way; the output shaper's edge was
  undefined; Frame-Weave jumped when its rate moved; the superimposition flicker ran
  at 7.5 Hz and now lands on the drawn film frames.

- **Native effect nodes run on their layer's clock** (Speed, freeze, global speed and
  the background's slow clock apply; they used the wall clock), see "no depth" when
  Depth is off (so their brightness fallbacks work), and can read the audio. The depth
  estimator now sees the picture upright. PANIC also clears the trail buffers of the
  rack effects, which could hold a ghost for good.

- **Randomize and Variation** leave deliberate settings alone : anaglyph 3D, film hold,
  the output shape and Vibe's chord mode are never rolled; a pinned dice range now
  keeps the current value (it used to force one); the walk and Variation respect the
  same rules. Palettes (Palette, Colorizer, Vibe) roll as one hue from near-black to
  pale instead of five clashing colors; Lookup no longer gets a random palette layer.

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

- **The picture could freeze when a Parametric slot was switched away** : its
  disposal broke every shader draw. Parametric, Text and Collage now own their
  vertex setup and survive a GPU reset.

- **Collage** :
  - Churn re-rolls were identical, so the wall collapsed onto one film.
  - Churn and window only applied at the next deal.
  - Optimise was ignored on a running wall.
  - Mosaic pieces smeared edge pixels.
  - Crossfades restarted from a stale frame.
  - An aborted seek could leave a piece stuck.
  - Pieces went soft at 4K, because tile size now follows the output.
  - Presets leaked into each other.
  - Layer Speed and the background's slow clock were ignored.
  - Every Collage started from the same seed.
  - A minimized control window froze the wall.

- **Text** :
  - The weight dial did nothing on most fonts; each face is now declared at
    its real weights, and the dial grays out when a font has only one.
  - Modulating size or spacing redrew the whole frame every frame and moved in
    visible steps; Text now uses a glyph atlas, so it is smooth and cheap.
  - Stretch went soft.
  - A Text layer was an opaque black slab in Normal blend.
  - Presets forced the first font.

- **Parametric** :
  - Raster ignored the audio.
  - The frequency axis wasted three quarters of the spectrum; it now uses 512
    log columns.
  - The spectrogram blurred as it scrolled, and its speed depended on frame
    rate.
  - Bars mode ignored `scale`.
  - OSC-audio mode now draws the six bus bands.

- **Source generators, after an audit of all 23.**
  - Every rate-driven source now integrates its rate, so a knob never jumps the picture.
  - Each one still moves, unrepeating, after 24 hours. Before, Slabs froze after about
    3 hours and its cuts looped every 9 s; Particle Drift collapsed into a lattice, Ten
    Print into vertical stripes, and Ash into evenly spaced strings.
  - Lines keep a constant pixel width with a 1-px floor.
  - The 1-px scanlines, which turned into moiré when resampled, are gone.
  - Aspect is correct at 16:9 and on the square dome.
  - Highlights:
    - Murmuration's birds accelerated forever and became strobing dots after about
      10 minutes; they now move in bounded, heading-aligned travelling waves.
    - Congeal never faded back to black (a flat fog).
    - Sync Osc's shape knob had a gray dead zone, and "frozen horizontal" was diagonal.
    - Metamorph had a notch on every blob and a parent that popped out.
    - Differential's fast layers strobed and its presets formed rosettes.
    - Direct Marks' gate swept across the marks as a wave.
    - Ash sliced flecks at column edges.
    - Filaments and Column Scan lost the peaks of their lines.
    - Shapes cut shapes at cell borders.
    - Solid Color's gradient never reached its end colors.
    - Presets now set every input, so one preset no longer leaks into the next.
    - Dice no longer paint the dark grounds a bright color.

- **Knobs no longer jump the picture.** Motion that ran on `time × rate` jumped
  whenever the rate moved : half an hour into a show a small nudge flung the
  picture, and an LFO, a Morph or MIDI on the rate turned it into strobing noise.
  Rates are now integrated frame by frame (a shader declares `PH_rate` and the
  engine accumulates it on the layer's own clock, so Speed, freeze and reverse
  still apply) : the Organic family (Fire / Water / Nature, Membrane, Mycelium,
  Erosion, Dye Field, Swell, Ground, Scan, Colony) and the glitch effects
  (Aperture, Byte Corrupt, Databend, Displace, Distort, Granular, Mosh Blocks,
  Row Echo, Slice Shuffle, Slit Buffer, Stutter, Sync Loss, Tracking, Triangle
  Flicker).

- **Long shows.** The old shader hash lost precision as time grew, so glitch
  effects, the Finalizer's grain and CRT / VHS parasites settled into fixed
  patterns within an hour or two. A precise hash and wrapped seeds everywhere.

- **Audio-reactive generators read the wrong row.** The shared audio texture's
  waveform and spectrum rows were swapped whenever a shader had loaded since the
  last video frame (the shader runtime leaves the upload flip on). The spectrum
  row is now log-spaced 30 Hz to 16 kHz, so it spreads musically across elements
  instead of bunching into the left fifth. Any generator that declares the audio
  input gets it, on the background slab too.

- **Freeze-proofing.** The video source and the film, output-shape,
  flash-safety and depth-shadow stages now each own their vertex setup, so none
  of them can break every shader draw when it is disposed; the effect nodes
  rebuild after a GPU reset; photo materials no longer load upside down
  depending on load order.

- **Fresh installs started with the wrong defaults** : Flash safety off (meant
  to be on, mild, at 0.35), the Flow macro fully engaged instead of neutral,
  Morph at 0 ms, the audio monitor muted.

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

- **Recording can always be stopped.** When the video encoder refused a take (the
  4096² dome master is beyond it), the take died silently and STOP waited forever for
  it, so the REC pill never went away. Stop now always ends the take, a second click
  joins the first, and a take that dies ends by itself with a message saying why.

- **Minimizing the window no longer stalls the show.** A minimized window gets
  (almost) no animation frames from Chromium, so the render loop, and with it the
  projector stream, Spout, Sonify and OSC out, dropped to about one frame a
  second. The loop now notices and runs on a timer until the window paints again,
  and that timer waits for the GPU to finish each frame : without rAF's pacing, a
  heavy scene let the loop run seconds ahead of the GPU, and NDI starved behind
  the queue (measured : 0 to 1 fps, now it follows the render rate).

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
