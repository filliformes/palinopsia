# Changelog

All notable changes to Palinopsia. Dates are ISO. Versions follow the `v*` tags
that CI builds into cross-platform releases.

## v1.2.5 — unreleased

### Added

- **Lowercase**, a new source : machine-cut marks on a stepped clock. Eight figures, from
  a dense data matrix whose cells subdivide into one to three narrow bars, through blocks,
  columns, ticks, a scan rule and a thin lattice, to sprocket ladders down the frame edges
  and a single white slab with bars cut out of it. Everything lands on a step and holds,
  so the picture changes between frames and is still in between, which is what separates
  it from the optical fields of Op-Art and the hand-made edges of Direct Marks. It carries
  its own divided clock (rate up to 120 steps a second, divided by STEP up to 64, a deal
  held for up to 32 steps), so it pulses the moment you pick it, and its gate is a
  modulation target, so a Euclid, a Spastic or an audio transient plays it instead.
  HOLD, JUMP, SCROLL, SHEAR and FLIP decide how it reacts. Every deal is a fresh draw
  (measured over 119 steps : 44 new deals, no slides); SCROLL turns that by degrees into
  the same draw slid one cell per deal, up to only ever sliding, the field read as a
  stream of data. SMEAR recomputes the previous step and trails it behind, the way a
  filmed projection does, with no buffer to keep. CELLS runs
  to 512 : as cells fall below a pixel the grid figures stay crisp 1-bit static instead of
  averaging into gray, and the slab becomes a barcode of about 128 bars. A SIDECHAIN reads
  another layer one sample per cell, so a film arrives as a 1-bit halftone of cells on
  this clock; it is weighed by the layer's alpha, so where that layer is transparent (or
  when none is picked) the cells keep their own density. A single accent color marks a
  regular lattice of cells (one in a period squared, so it reads as meaning rather than
  as confetti). Flat, hard-edged, never radial. It holds its structure with no lattice
  or banding at 24 hours of show time.
  Cost on an Apple M2 : about 6.8 ms for a 4K frame (under 2 ms at 1080p), against 4.0
  for Direct Marks; the sidechain and the audio gate add under half a millisecond.

- **Signal**, a new Sonify voice, before Chord : read heads walk the picture on a
  clock and every cell they cross that is brighter than a threshold fires one
  micro-grain. It is a picture-driven version of the author's Signal instrument,
  and the one thing it drops is the thing that instrument needed most : its 35
  stored rhythms. Here the picture is the pattern, so a field of machine marks
  plays as data (point it at a Lowercase layer and the two close a loop). Kept :
  the micro-synth, as nine grains (pip, damped, noise, click, fm, square, tri,
  pink, ping) from a 0.2 ms tick to a 500 ms ring; and the polymeter, as one to
  four heads whose sweeps SPREAD pulls to 12, 10 and 7 sixteenths of each other.
  Pitch from the place along the bar, with a SNAP from free frequency to the
  scale whose middle is microtonal. Onsets land on their exact sample instead of
  the 128-sample audio block, which is what keeps a fast grid a grid : rendered
  offline, a grain placed 37 samples into a block started on that sample, where
  block quantizing would have moved it 101 samples early. All nine grains sound,
  none ever NaN, every one within 5 dB of the pip after trimming (pink had come
  out 13 dB under). All eight of its controls are modulation targets that move
  the sound, the scan's included : it reads the modulated values itself, where a
  detector reading only its base config would have ignored them.
  Every grain plays a fixed 50 ms after its step, so the grains keep the clock's
  spacing whatever the frame times do : 83.33 ms apart at 12 steps a second, with
  0.8 ms of jitter. Synced, it runs on the beat clock both Sonify sequencers share
  (125.0 ms apart at four steps a beat and 120 BPM). Each read takes the brightest
  point of its whole cell, so a mark thinner than the gap between two steps (a
  Lowercase barcode bar) still fires. The effects sequencer holds it and Auto picks
  it, for machine marks.
  Voices are stored BY INDEX (mixer channel, DJ filter, sequencer mask, MIDI
  binding), so Signal is appended as voice 9 and only SHOWN before Chord : no
  saved session's settings move to another voice.

- **A Vary for each layer**, under Speed : the global Vary aimed at one layer
  alone, with its own amount. Its button is a modulation target that fires on
  the crossing, so a Euclid or a Spastic can re-vary a layer on a pattern; an
  auto-fire stays out of the undo history. Each fire is a fresh variant around the
  layer as it stood before the first, as the global Vary works around its baseline,
  so a modulator can fire it all night and the layer circles your settings instead
  of wandering off. Every driver of one layer counts as one : two modulators fire
  4 times in 4 s, not on every frame, and a Meta knob on it leaves the blend alone.

- **Per-rack dice** on a layer's right-click menu : randomize the effects of
  source A, of source B, or the layer FX, leaving the sources and the other
  racks alone. Only the modulation aimed at the units that went is dropped. An
  empty source's rack is not offered. A new rack is a new starting point for the
  global Vary (so is Randomize layer), which used to deal the old rack back.

- **Every fired action blinks** : the Vary buttons, the global Randomize (button,
  R key, MIDI pad, OSC, every scope) and the six return-to-default buttons, each in
  the color of its kind of action. A return-to-default that disables or hides its
  own button as it acts still shows its blink, and reopening a panel never
  replays an old one.

### Changed

- **The frame rate is shown against the display's refresh rate**, in the Performance tab
  header and in the corner of the preview : `50 fps / 50 Hz`. The render is locked to the
  vsync of the display the window is on, so that rate is the ceiling, and a bare frame
  rate cannot be read without it. A fixed 60 was the reference before, which called a
  perfect 24-of-24 on a 24 Hz display a fault and sent a whole debugging session after
  it. The low-frame-rate warning turns red below 85% of the refresh rate rather than
  below a fixed 40, and the CPU frame-budget figures are measured against one frame on
  that display (20.0 ms at 50 Hz) instead of 16.7 ms. The rate is printed to two
  decimal places only when it needs them, because the platform reports a mode set to a
  round rate a hair off it (60.000003814697266 for 60 Hz) and a bare integer test let
  that through as `60.00 Hz`. Fractional rates that are real, like 59.94 and 23.98,
  keep their decimals.

- **The frames the GPU backlog guard dropped are now counted**, as `skips` beside the
  frame rate. The guard skips a frame whenever the fence from two frames back has not
  signaled, which keeps the driver's queue from running away under load. Those frames
  return before the frame counter runs, so they could never appear in the frame rate :
  nothing showed that the guard was throttling. A steady count there says it is; near
  zero says the frame rate is the display's own pace.

- **Dealt racks reach four effects** on both sources and the layer (they stopped
  at 2, 2 and 3, and a source rack was empty about half the time). Over 200,000
  deals : source A 0.70 to 1.65 effects on average, source B 0.55 to 1.48, the
  layer 0.95 to 1.77.

### Fixed

- **The picture readout no longer costs the frame rate.** Everything that reads the
  composed picture back as control data (the 17 vision features, the Sonify taps, the
  depth estimator's input frame) pulled its grid with a synchronous `readPixels`. That
  call cannot return until the GPU has finished every command queued ahead of it, so it
  drains the whole pipeline, and the drain costs the same whether you ask for one pixel
  or 64K of them : on a GPU that shares memory with the processor and resolves its render
  passes lazily, each read measured about 17 ms (1x1 and 256x256 alike). Opening the
  Performance tab turns the vision readout on, which read at 30 Hz, so the instrument
  spent 391 to 650 ms of every second stopped inside the graphics driver, and the cost
  showed nowhere in the frame budget because the stall happens below the app. The reads
  now go through a ring of pixel-pack buffers with fences, the same way the frame capture
  already did : the read is queued and collected one or two frames later, and nothing
  ever waits on the GPU. Measured on an 8 GB Apple-silicon Mac Mini, blank 1920x1080
  session, 50 Hz display, Performance tab open : **41.9 to 50.0 fps before (three runs),
  50.0 fps in all three after**; the app's own meter reads **1.4 ms of CPU per frame
  instead of 14.2**, of which the vision return is **1.0 ms instead of 13.5**; the worst
  single frame went from **42.8 ms to 5.5 ms**; blocking readback time per second went
  from **560 ms (mean) to 0.1 ms**. The picture is unchanged : the same passes, the same
  formats, the same resolution. Only when the bytes come back moved, and every consumer
  of them already sampled at 11 to 30 Hz, slower than the latency this adds. The queued
  read is submitted to the GPU only when nothing else will submit it : a window that is
  painting does that on its own a moment later, and a submit into a full command queue
  blocks until a slot frees, so submitting by hand there charged the wait to whichever
  section had queued the read (measured at 11.5 ms in the vision section of a scene
  holding the GPU at 98%, once its reads had all gone asynchronous). Measured on a 60 Hz
  display, that removed 26 flush calls per second, exactly one per queued read, and left
  the frame rate at a flat 60. Two readers still read synchronously, both off unless you
  use them : the light output's zone colors and the strip behind `/opsia/av/mark-signal`.
  A queued read hands its grid out once, so two Sonify taps on one source share each
  frame's read (the second found nothing and went silent; both now update 27 times in
  a second), and a tap back from a pause drops what it left in flight, so its first
  grid is the picture now.

- **The GPU and VRAM meters work on a Mac.** They shelled out to a discrete-card driver
  tool that does not exist there, so both read "-" for the whole session. Where the GPU
  shares system memory, they now come from the accelerator statistics the operating
  system already publishes (no privileges, no helper to install), and report utilization
  and the driver's share of total memory. The sampler stops asking after one unanswered
  query instead of spawning a helper every second forever.

- **The capture picker says when the system is refusing it the screen.** On a Mac,
  reading the screen needs a permission granted by hand in the system settings, and no
  app is allowed to prompt for it. Denied, the enumeration still succeeds : it just
  returns a black picture for every screen and strips every window of its name, so the
  picker was a grid of black rectangles with nothing to explain them. It now asks the
  system first, and when the answer is no it says so, opens the right settings pane on a
  click, and states the one thing nothing else does : the permission is read once at
  launch, so granting it only takes effect the next time the app starts. A camera or a
  video file was never affected. Windows and Linux have no such gate and see no change.

- **A fullscreen output closes on Esc** when it covers the control window and is not an
  installation. Its keys were armed only for a kiosk launch, so a plain fullscreen output
  on one display could only be left with Cmd+W. Where the control window is reachable
  (a projector on another display, a span, a framed window), Esc hands focus back to it
  and the show goes on : the output takes focus as it opens, so an Esc meant for the
  Output page would otherwise end it. An installation no longer prints its exit keys on
  the projector for its audience to read.

- **An edit made just before an automatic change stays undoable.** A sequencer step, a
  key-sequencer step or a modulated Vary lands in the history silently, and it became
  the baseline with any edit still inside its 300 ms grouping window folded into it :
  a drag finished just before a step could not be undone. The pending edit is now
  committed first.

## v1.2.0 — 2026-10-08

### Added

- **Sonify's output device in the audio/midi/osc tab** : right under the audio input
  menu, the same size (the two stacked in one column beside the meters; alone at full
  width while the analyser is off), the same menu as the Sonify page's (both drive
  `sonify.sinkId`). One `AudioOutputSelect` now
  serves the Sonify page, that row and the input monitor's row; its list follows
  `devicechange`, a device saved in a session but not plugged in reads "(not
  connected)" instead of "default", and the system's own "default" entry folds into
  "default output".

- **A Picture readout** (Performance tab, its own **picture** section) : all 17 vision
  features live, grouped (light and color, texture, motion, where and how deep), with
  what 0 and 1 mean, swing bars for the signed ones, a dot for the bright mass and a
  color swatch, each row's `/opsia/vision/…` address on hover. Drawn from refs at
  15 Hz; it registers on the vision bus (`visionBus.want`) so the App loop samples the
  picture while it is open, and releases it when folded.

- **Palinopsia is a dataflou node.** A new **dataflou** section in the audio/midi/osc tab
  (ON THE MESH pill, name, universe) joins the decentralized parameter mesh its sibling
  instruments speak, and monitors it : every node on the network (online, remembered,
  forget), its parameters with pickers to wire them to Palinopsia or from it, and every
  connection on the mesh with ✕ to unwire. Palinopsia declares 81 entries (6.9 KB, under
  the 8 KB a microcontroller node can receive) : 38 destinations that play like their
  `/opsia` OSC address (Meta knobs, layer opacity / speed / mix, the feel macros, scene
  recall / next / randomize, BPM) and 31 sources sampled at 30 Hz only while someone
  listens (audio, picture, body, the 8 modulators; Meta knobs are both). The node is a
  TypeScript port of dataflou's reference core in main (`src/main/dataflou/` : a CBOR
  codec with QCBOR's strict typing and preferred float widths, the proto 2 messages, the
  stream_codec UDP plane, gossip / digest / keepalive / range mapping), with its own
  mDNS responder on multicast-dns : bonjour-service's announcements put the service-type
  PTR before our A record, and the reference parser then took 127.0.0.1 every other
  packet (5 reconnects in 45 s, 0 after). Tested against the reference `dataflou-node`
  (built for Windows) : discovery both ways, DECLARE decoded on both sides, values
  streamed both ways (947 values in 45 s), SETVAL, SUBREQ, SUBANNOUNCE, STREAMSTOP,
  gossip relay to a third node, reconnection after a restart with the wires restored.
  Identity : one SKU per install (`userData/dataflou/identity.json`), wires per universe
  beside it. `multicast-dns` is now a direct dependency (it already shipped with
  bonjour-service).

- **The key sequencer draws each mode** (a stage under the mode strip, after dataFLOU's
  per-mode sequencer previews), in one color language : a key's hue is its place on the
  circle of fifths, the key playing glows, pops and ripples when it changes. **List** :
  the written keys as tiles, the playing one lit, a trail behind (bounce, drift).
  **Circle** : the circle of fifths, majors outside and relative minors inside, the pool
  lit, the key and its last four, the lean as an arrow as long as the leap, the relative
  hop as a dashed link. **Affinity** : a constellation around the key, closer = more shared
  notes, bigger = likelier at this smoothness (the engine's own law, `affinityWeight`),
  hollow = ruled out by no repeat or the tour, the three likeliest named. **Pivot** : the
  twelve notes as a clock with the scale lit and its targets ringed, beside the degrees
  (same notes) or the bright-to-dark ladder (same tonic). **Picture** : the picture's hue
  on a wheel (the marker's distance is its saturation), its brightness against the pool's
  moods, the key they give; on cuts, the motion strip with the spikes past the cut line.
  The vision bus is fed in Picture mode while the sequencer runs or the Sonify page is
  open.
- **An OSC monitor, and an OSC section in two halves** (audio/midi/osc tab) : **↙ IN**
  (listen, port, where to send, the last message) and **↗ OUT** (destination, FEEDBACK,
  MARK, a note that the body rules' OSC goes there and the Resolume mapper has its own),
  each with a traffic light and msg/s, both also in the folded header. OUT no longer
  hides until the input is on (it never depended on it). **monitor** shows every message
  both ways (time, direction, address, values, destination), filters by direction and
  address, pauses and clears; **latest** keeps one row per address. Every UDP send now goes
  through one tap (`oscMonitor.ts` : sendOsc / sendOscBatch, used by the feedback mirror,
  MARK, the body rules and the Resolume mapper) and the inbound stream is counted once;
  messages are kept (500, ring) only while a monitor is open. Measured in a test copy :
  in 21/s from a test sender, out 106/s of feedback, both listed, a value coming in and
  FEEDBACK mirroring it back out side by side.
- **The Resolume mapper (K) is a pin board** : a connection is a pin colored by its
  signal's family (modulators, Meta knobs, audio, vision, body, OSC), sized by its amount,
  with a halo that follows what it carries; each column group has its own hue (band, tint,
  separators); rows show their pin count and a live bar in their color; a status line under
  the board describes what is under the cursor and what a click does; an empty page offers
  Open .avc and Learn. It wears the app's own look : the full pages' title bar (RESOLUME ·
  MAPPER, mono, spaced), the theme's UI font, the toolbar buttons. Light themes get deeper
  shades. The canvas draws at dpr × the UI zoom, so it stays sharp zoomed.
- **A dice for the Resolume pins** (🎲, MIDI-learnable as `rand:resolume`) : every row gets
  none, one or two new pins (35 / 45 / 20 %) at amounts 0.4..1, among the unfolded groups'
  float and toggle columns : never a trigger (no clip or column launches at random) nor the
  composition master (no blackout). **↶** puts the previous pins back. Measured : 19 pins
  over 18 rows, none on a trigger, the master or a folded group.
- **Sonify's mixer and sequencers look like its voices** : one set of parts
  (`components/sonifyUi.tsx` : the voice card, the label column, the on / play pill,
  option chips, slider rows, the stepper, the dice / reset buttons) builds all three
  views. The mixer is a voice card per channel (pill, name, volume, filter) and an FX tail
  card; the effects and key sequencers are voice cards with a play pill, their rows in
  the voices' label column, and the key sequencer shows the key now on its own row.
  The two sequencer cards are roomier (more padding and space between rows, thin dividers
  between their groups, bigger mode / root / scale targets).
- **Sonify's level meter tells the truth at a glance.** It did measure the real output
  (after the master and the limiter, films included) but drew the raw amplitude on a
  linear width, so an ordinary -20 dB level filled a tenth of it, the limiter's -1 dB
  ceiling never reached the end, and it jumped between 10 Hz readings. The worklet now
  sends per-channel peak and RMS; the meter draws L and R on a -54..0 dB scale (lines at
  -36 / -18 / -6), RMS as the bar, the peak as a tick held 1.2 s, both falling at 24 dB/s,
  a dB readout beside it, yellow above -9 dB, orange while the limiter works.
- **The sequencers' buttons are the voices' buttons, and the cards resize.** Choices are
  full-width segments (Seg / Toggle in sonifyUi, like Events' spatial / motion / blend),
  the rate is a full-width menu with the free time on its own **every** row, the step
  menus read whole. Each sequencer card has a grip at its foot : drag down / up for more
  or less air between its rows (the card follows the pointer : the drag is shared among
  its gaps, its step list at 3/4), its left corner widens the sequencers' column, which
  now has its own width (280–900 px, `opsia.soniSeqW`; air per card in
  `opsia.soniSpace.fx|key`).
- **The key sequencer runs on free time by default, 5 s**, and free time now reaches
  5 minutes (it stopped at 2); minutes read as `2m30`, double-click the slider for 5 s.
- **A Resolume section in the audio/midi/osc tab** : SENDING / OFF (a click toggles it),
  where it sends, the pin count and messages a second, and **mapper ▸** to open the page
  (it replaces the small Resolume button in the OSC header).
- **Spastic HOLD** (LFO) : how long each throw stays up, separate from the rate. With
  HOLD on, the coin only decides whether it RISES on a tick; the rise holds for HOLD ms,
  then drops to the bottom (the next frame) and rests there until the next rise; a rise
  while up starts the hold again; float throws to a level of its own. 0 (absent) = the
  original. `ModulatorConfig.spasticHold`. Simulated 60 s at 2 Hz : HOLD 100 rose on 68
  of 120 ticks, up 100-117 ms each (frame-quantized), down otherwise; HOLD 5 = one frame;
  HOLD 0 unchanged (up 51 %, runs of 500-2500 ms). The LFO card's params still fit its
  fixed height (85 of 85 px).
- **The key sequencer** (Sonify, seq view) : composes the root, scale and octave of the
  whole instrument over time. Five modes : **List** (written keys, forward / bounce /
  drift), **Circle** (a walk on the circle of fifths : flats / sharps lean, leap 1-3,
  relative major / minor hops), **Affinity** (the next key weighted by shared notes,
  Jaccard over pitch-class sets, `exp(6·smooth·(2a−1))`; no-repeat, tour of the pool),
  **Pivot** (same notes on a new degree : I major, II dorian, III phrygian, IV lydian,
  VI minor; or same tonic, brighter / darker) and **Picture** (hue around the circle of
  fifths, brightness to the mood; on the clock or at scene cuts, with a hold). Rate
  (1 beat … 16 bars or free ms), chance, an optional Euclidean gate, a pool of roots and
  scales, glide 0-4 s, home on stop (a key set by hand while it runs becomes home).
  Effects-sequencer preset steps keep the key while it runs. Sessions carry
  `soniKeySeq` + `soniKeySeqOn` (Installation mode starts it); MIDI `fire:keyseq`; OSC
  `/opsia/sonify/keyseq/on|next|mode|glide|chance`. Measured in a test copy at 240 bpm :
  every mode steps on the beat (250 ms), Circle walks G D A E B F# C# G# D# A#, Pivot
  C major → D dorian → E phrygian → F lydian → A minor, Euclid 3/8 falls 750 / 750 /
  500 ms apart, chance 0 never changes, a hand-set E minor became home and came back
  on stop, the picture's green + dark gave E phrygian and its red C phrygian.
- **Key glide** : a key change can slide every pitch instead of jumping. The worklet
  glides its pitch tables (Spectra, Chord, Filter, Ring bank) per block, eased
  (smoothstep) in log frequency, and Orbit / Raster's single pitch from where it was;
  the Collage resonators glide on the main thread. A table re-sent unchanged (every
  slider move re-sends them) leaves a glide alone; the Ring bank's make-up gain is
  measured every 16th block while it moves. Measured : Orbit C3 → B2 jumps within one
  analysis frame at glide 0 and eases over 1.96 s at glide 2; the Chord's middle note
  F3 → B3 follows the curve (≈224 Hz at 2.8 s of 4 s); the level holds at −12 dB through
  jumps and glides.
- **The Sonify beat clock** : the effects sequencer gains beat / bar rates (1 beat …
  16 bars, free stays its default) on one clock shared with the key sequencer; one
  started while the other runs on the beat waits for the next bar (measured : the
  effects steps then land on the key changes' downbeats).
- **Chord noise** (Sonify) : a smooth pink noise blended into the Chord voice, one
  band-pass on each note (two pink generators, so it is stereo), each band riding its
  note's swell, fade and WAVES like the tone, so the noise breathes with the chord.
  **noise** (0 = the plain chord) and **air** (Q 40 → 1.2 : a pitched breath to a wide
  wash; the band gain follows sqrt(Q), so the level holds at any width). Both are
  modulation targets and OSC (`/chord/noise`, `/chord/air`). Measured : at noise 1 the
  bands sit as loud as the tones (+3 dB overall), flatness 0.007 plain → 0.021 (air 0) …
  0.042 (air 1), level within 0.6 dB across air.
- **Installation mode looks after itself.** Start with the computer (macOS : a
  LaunchAgent that also restarts a crashed app; Windows : a login item and a scheduled
  check every 5 minutes; only one copy ever runs, and a leftover entry with Installation
  mode off quits at once and removes itself). The display never sleeps while an
  installation runs or an output window is open. A crashed, hung (20 s) or frozen (no
  new frame for 45 s) control window reloads with a backoff, and the app relaunches after
  5 failures in 10 minutes, 3 GPU crashes, or no WebGL (at most 6 relaunches in 30
  minutes). A crashed output reloads, a closed output reopens, and the output moves back
  to its projector when displays change (matched by name when Windows renumbers it).
  The default menu shortcuts are off, the output stays on top, the crash-restore
  question never waits, and the exit keys must be held for 1.5 s. Measured in a test
  copy : a control crash, an output crash, a closed output and a renderer stuck in a
  loop all came back with the picture flowing; Ctrl+R did nothing; a second launch quit.
- **An installation plays its sound.** A session now records whether Sonify and its step
  sequence were playing; Installation mode turns them back on at boot and after every
  self-heal reload (opening a session by hand still never starts the sound). Turning
  Sonify on or off now counts as an unsaved change.
- **A log file** : `logs/palinopsia.log` in the app's data folder (2 MB, one previous
  copy) records main-process errors and exceptions (never an error box on screen),
  every window's errors and warnings, crashes, hangs and recoveries; a message repeated
  within a minute is counted, not repeated.
- **Cameras reconnect.** A camera whose track ends (unplugged, reset by USB power
  saving) is tried again at 2, 4, 8… up to 30 s, and at once when a device appears,
  found again by name under another id. Measured with a fake camera : back in 2 s.

- **Recordings carry the Sonify sound, DXV3 included, whenever Sonify plays.** A DXV3
  take now has a PCM sound track (16-bit little-endian, written natively as the frames
  go, in the layout libavformat uses; measured : the sound present, 0 decode errors).
  Every take holds Sonify's audio context open for its length, so the sound is
  recorded when Sonify is switched on before or during the take, or off and on again,
  with silence in between, in sync with the picture (it used to be recorded only if
  Sonify was on at the start, and a restart mid-take lost it for good). A take during
  which Sonify never played is saved with no sound stream at all.

- **Collage : FX before shapes.** A toggle in the Collage's Inspector : the source's
  FX rack processes the films alone, then the seams, contours, torn paper and mask
  holes are drawn over the processed films, crisp. Measured with a coarse Pixelate in
  the rack and seams on : off, the seam is pixelated away (its darkest pixel 29-76 on
  a ~115 median); on, it stays a clean ~22 px black line at 1080p. Works on a layer's
  A or B and on the background, with crossfades and torn paper (which reads the
  neighbouring film mirrored across the tear).

- **A Ring bank on Sonify's Collage voice**, inspired by the S-4 : one 48-band
  resonant filterbank per side over the whole voice, its bands snapped to the key and
  scale across the voice's octave range (one per semitone over the default four
  octaves). wet (mix or send; 0 = the voice as before), decay (12 ms to 10 s, every band
  ringing as long; sustain shapes what goes into the bands, choke what comes out),
  cutoff, peak, slope (LP, BP, HP), tone, tilt, waves and noise (a travelling sine and a
  random level across the bands, each with a rate that is free or locked to the tempo :
  straight, triplet, dotted), detune (a slow wobble plus a random walk, the two sides
  apart), and five voicings from Loopex's filters (Clean, SEM, MS-20, Steiner, K35; the
  last three clip the ring). The filters are Cytomic state-variable band-passes, stable
  up to Nyquist at any sharpness. A make-up computed from the bank's own summed response
  and a slow level follower (held while the films are silent, so the rings decay) keep
  it at the plain voice's level (measured -1 dB; it was +11 dB on tones landing on a
  band). Tuning measured on films : the scale's notes stand 12 to 22 dB over the notes
  between, against 6 to 8 dB without. About 150 µs per 2.7 ms audio block. Five of its
  controls are modulation targets; OSC `/sonify/collage/{bank,decay,cutoff,peak,slope,
  waves,noise,detune,voicing,...}`.
- **Waves on the Chord voice** : the same travelling level across the chord's notes
  (each note swings about 55 dB, measured), free or tempo-locked, so a held chord keeps
  moving inside. A modulation target and `/sonify/chord/waves`.

- **Sonify's Filter voice gets a `loop`** : it replays one frozen stretch of its noise,
  a few hundred milliseconds (a flutter) down to a few milliseconds (a buzz); 0 is free
  noise. Its quantized band centres get their own octave range, Flow gets a pan slider,
  and OSC gains the taps (`/sonify/tap/a|b`), each voice's `/tap`, `/looct` and `/hioct`,
  `/spectra/sync`, `/orbit/shape` and `/filter/loop`.

- **Effects travel between racks.** Right-click an effect's chip for **Copy to Master FX**
  or **Copy to Layer N FX**; or drag a chip from one rack onto another (a chip, or the
  `+ fx` box for the end) to move it, its modulation following, and hold Ctrl or Alt to
  copy instead. Right-clicking the `+ fx` box pastes a copied effect into an empty rack.
  An effect the rack can't host is refused with a popup that says why (`Transfert can't
  go in the Master FX : Transfert is layer-only.`), and the drop marker turns red over it.

- **Sonify : a Collage voice**, the films of a Collage source heard all at once as a
  sound collage. Every film plays its own sound in its own loop window and speed, held
  to its picture (each film gets a hidden player of its ORIGINAL file, resynced on every
  seek and nudged a percent or two to stay within ±15 ms : measured), so a wall of
  optimised clips, whose caches carry no audio, still sings. Every piece is its own
  voice : panned by its place in the frame, then rung through a harmonic resonator
  (band-passes on a note and its 2nd and 3rd harmonics) tuned to the Sonify key and scale
  by its distance from the frame's centre, low in the middle and rising to the edges in
  every direction, up to 64 pieces. resonance (plain films to only the rings, loudness
  matched within 1 dB at any ring, calibrated on noise), ring, harmonics, range, width,
  gain, pan; its own mixer channel, sequencer column, OSC `/opsia/sonify/collage/…` and
  three modulation targets. Masked pieces fall silent; a muted or hidden layer goes quiet,
  a fading one fades. Auto-Sonify switches it on for a composition with a Collage.

- **New and Generate morph over the MRPH time**, live. The plain morph could only snap a
  whole new composition (and a dissolve froze the outgoing picture), so they hand over
  layer by layer, top first, staggered : a slot free in both compositions hosts the new
  layer while the old fades (a true crossfade, after which the engine swaps the two
  slots' Layers, nothing reloads); without a free slot the old fades out and the new in;
  same shaders ease their settings; Vibe, Context and Finalizer ease all along. A new
  layer fades in only once compiled (else the old shader flashed), and the fades are
  applied after every modulator so none overrides them. MRPH 0 : a cut once compiled.
  Measured over 4 s (integrated graphics) : no still frames, brightness steady through the hand-over.

- **Context's light moves** : the light pad (now the composition's shape, and larger)
  takes the Metasurface's draw sequencer. **✎ draw** a path, **▶ play**, and the light
  travels it : direction (forward, backward, ping-pong), **⟳ loop**, **time** (0.2 to
  60 s per pass), **jump** (random teleports) and **wiggle** (a vibrato). Dragging the
  pad places the light and stops the path. The path lives on the Context unit, so it is
  saved with the session and recalled with scenes. The Metasurface and the light share
  one playhead and one transport, so they trace alike.

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
  Inspector shows size, fps and delay. Measured (on the laptop's integrated graphics,
  a floor) : a 1080p source ~45 ms behind at full
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

- **The docs catch up.** The OSC reference (docs/opsia-osc-reference.html) gains the
  video transport (`layer{n}/video/…`), the Background's new rows (speed 0..4×, shadow,
  group, randomize, grounds only), `flow` and the temperament dials, the key
  sequencer, the MARK stream and the OSC monitor; the README's outbound section names
  MARK and the picture readout; the `?` cheat-sheet calls the `A` tab what it holds
  (Audio · MIDI · OSC · Resolume · dataflou); the landing page lists the Background,
  the Picture readout and the audio output.

- **The Background, audited.** Its strip is first in the Layers column (Background, then
  Layers 1 to 4 : the stack read bottom to top) and collapsible like a layer's, with
  opacity, M and dice in the header and a summary when folded. Fixes :
  - **group** (was "isolate") is a real group now : the layers composite on
    transparency (`bgWork` pair) and sit over the Background by `GROUP_FS`
    (`grp + bg × (1 − max(grp.rgb))`); it only forced Layer 1 to 'normal', so an opaque
    Layer 1 hid the Background entirely;
  - **blend in** under a fading Background : Layer 1 is taken onto the whole Background
    in its mode and alone, mixed by the opacity (it switched at 0.001 : a multiply
    Layer 1 went black at a low opacity, and a morph popped at its halfway point);
  - the **outside fill** follows the Background's opacity (over the fill color) and is
    graded with the picture : the Background takes the shape's outside before the
    master stages, the graded frame becomes the fill, the shape is still cut last so
    the film dust stays inside (it was the raw Background);
  - its **dice** drops modulation aimed at the old source and rack (bg-fx rows dangled on
    dead ids and ate the 12-row cap); **Init background** empties it entirely (it only
    cleared the source); built-in presets keep the shadow and mode;
  - **speed** is 0 to 4× everywhere (the slider stopped at 2, OSC at 1×; OSCQuery
    advertised 0.5); opacity, speed and **shadow** (the "Depth" control, renamed for
    what it is) are modulation targets (`{ kind: 'bg' }`), Meta destinations and
    MIDI-learnable;
  - OSC `/opsia/bg/source` accepts only grounds (an effect name was taken, an unknown
    name cleared it), `/opsia/bg/randomize` and `/opsia/bg/shadow` are new;
  - Generate lays its themed Background in **group** (Layer 1 lands opaque 'normal', so in
    blend the ground was hidden; grouped it shows through the dark parts), and never
    puts an empty Collage in it (Film Wall did); New's seed
    layer lets the ground show (screen / lighten / add, or 'normal' at 0.6 to 0.8)
    instead of covering it at 85 % 'normal';
  - an older session's Background gets the fields it lacks.
  Measured : multiply over a fading green ground goes white → green with no black step;
  in group, the dark side of a black-to-white layer shows the red ground (149,63,66 vs
  40,43,47); the fill moves with the Finalizer's gamma and the Background's opacity.

- **Every change morphs, without the flick.** A scene recall, Randomize, Variation or the
  sequencer used to hide every structural change (a source, an effect, a blend mode, a
  switch) behind a 320 ms dissolve of a FROZEN frame, whatever the Morph time : the
  "flick" at each scene change. `beginSceneMorph` (morph.ts) now picks : the same
  structure on both sides (sources, racks, blends, mute/solo/feedback, mask kind,
  coupling mode, and every bool/long input of the sources and effects) eases every number
  over the whole morph (masks, coupling and harmony too); anything else goes through the
  relay New and Generate use, so changed layers crossfade live. Sessions now relay over
  the Morph time too (Morph 0 keeps the hold-then-dissolve). Modulation : ModEngine runs
  16 slots, a morph forks the 8 modulators into ghost slots 8..15 (`forkGhosts`) so the
  old assignments fade out on the old motion while the new ones fade in, and a morph that
  starts mid-morph starts from what is showing. Relay fixes : a borrowed host must sit
  right beside the layer (with a visible layer between, the new content composited over it
  then dropped under it at the hand-over, one frame 3x brighter); a host slot no longer
  overwrites the borrowed content with its own empty layer; and a slot the old content
  just left stays dark 400 ms (its stale frames flashed at full opacity for four frames).
  Measured frame by frame with the picture held still : no frozen frame, no flash at the
  hand-overs; what remains is each source's own motion.

- **Body tracking runs on its own thread.** MediaPipe Hands / Pose / Face (and the
  Silhouette mask) now run in a worker that loads MediaPipe's own bundle over
  `opsia-asset://` (`resources/mediapipe/vision_bundle.js`, the package's
  `vision_bundle.cjs`; keep it the wasm's version). The main thread only copies each new
  camera frame to an ImageBitmap and turns the landmarks that come back into features,
  gestures and the silhouette, exactly as before. One frame is in the worker at a time;
  the motion field still reads every camera frame. If the worker cannot start or build
  its models, the tracker falls back to the main thread for the session. Measured on the
  RTX 4070, synthetic camera, Mycelial at 1080p : main-thread cost per frame hands
  3.1 -> 0.1 ms, hands + pose 4.4 -> 0.1, + face 5.4 -> 0.09, + silhouette + motion
  4.7 -> 0.03 (the worker itself takes 8 to 17 ms a frame, off the picture's thread);
  60 fps with everything on (55.8 on the main thread). A fast off / on comes back
  tracking with the silhouette.
- **A modulation keeps its full swing at the edge of a range.** A base at its minimum
  (a Collage's `cuts` at 2) lost half the cycle : Replace held the edge half the time
  and only ever rose, Multiply never moved. When the span a modulation sweeps fits in
  the range but crosses an edge, it now shifts inside (Vincent's choice). Measured over
  an LFO cycle : cuts at 2, Replace 0.5 → 2..64 with no time held at the edge (was
  2..33, held 50 %); Multiply 0.5 → 2..3 (was stuck at 2); mid-range swings unchanged;
  a swing wider than the range and Multiply's over-drive keep their clamp. A Replace
  depth of 0.5 or more sweeps a span as wide as the range, so it now covers the whole
  range whatever the base; sessions whose modulations hugged an edge swing further.
- **Sonify has a seq view** (voices · mixer · seq) : the effects sequencer moved there
  from under the mixer, room for the sequencers to grow.
- **Every Sonify parameter explains itself on hover**, like the Inspector's : 45 sliders
  (every voice's gain and pan, Spectra's rate / contrast / breath, Orbit's radius / drive
  / smooth, Flow's sense / density / grain / breath, Events' sense / density / decay /
  highs, Raster's smooth / tone, Transmission's transpose / tick, Filter's resonance /
  noise / contrast, the FX tail's send / delay / reverb / size / predelay / mod rate)
  showed only their value; each row's label now carries the same info.
- **The Output button lights while the external output is on** (◉ Output), like Sonify's
  while its sound runs.
- **Electron 44** (from 33), with electron-builder 26, Vite 7, electron-vite 5 and
  plugin-react 5; CI builds on Node 22. Adapted to it :
  - the app's own file schemes (`opsia-media://` for films, `opsia-asset://` for the
    MediaPipe models) are CORS-enabled and answer every request with
    `Access-Control-Allow-Origin` : Chromium 152 refuses a cross-origin request to a
    custom scheme otherwise, which left every Collage, Assemble and Collage-voice film
    unloaded (readyState 0) and hand / pose / face tracking unable to load;
  - screen capture asks for the `display-capture` permission (Electron 36), which the
    permission handler now grants;
  - file pickers (Collage and Assemble folders, Open Session, Link a folder of
    sessions) open where they were last used, remembered across launches : since
    Electron 43 a picker without a starting folder always opened in Downloads;
  - `postcss.config.js` is now `postcss.config.mjs` (the build's module-type warning).
  Checked on the upgrade : the HEVC and occlusion feature switches still reach Chromium
  with their case (Electron 36 documents `app.commandLine` as lowercasing), hardware
  HEVC decode + encode, Spout, OSC in, recordings with sound, the discrete GPU.
- **The sound card stays awake.** Sonify's audio context opens a few seconds after
  launch and stays running, silent, instead of closing whenever the sound and the
  recordings stop. A sound card idle for a few seconds goes to sleep, and waking it
  held the audio clock still for up to 3 s : every take after a pause started a second
  after REC, and Sonify was slow to sound. Measured : a take starts in 46 to 68 ms after
  any pause (was 1.1 to 1.2 s), Sonify sounds within 0.1 s.

- **Messages dock in the bottom toolbar** : a warning or a confirmation (a refused effect
  drop, a saved recording) appears centered in the toolbar's empty middle, over no
  control, instead of at the window's bottom center, which the side panels made land on
  the toolbar's buttons. A long instruction grows upward from there; too narrow a window
  falls back to the old place.
- **A, B and BG are buttons** : the layer's source selectors and the background's look
  like the toolbar buttons (Output, Sonify, World), lit when selected, instead of plain
  letters nobody would think to click.

- **The Finalizer's output shape comes last**, after the film hold, boil and film damage
  (only the scene dissolve, freeze, Flash safety and the dome follow it). It used to come
  first, so dust, hairs and scratches landed on the fill outside the shape; now the film
  gathers them inside a fixed aperture and the outside stays clean (measured : 97-122
  specks on the black fill over 20 frames before, 0 after).
- **Torn paper tears like real paper** (Collage and the Autocutter). It used to paint the same off-white
  band on both sides of every cut (and along the frame's edges), which read as a seam.
  Now, as in a torn-magazine collage, one piece of each tear lies over the other : only
  its ripped edge shows the white core of the paper, a hairline for long stretches and
  then deep bites, ragged at every scale (the fine raggedness stays the paper's fiber
  size, so a deep bite never turns furry), with a thin translucent rim, a few loose
  fibers, a faint ink line where the printed skin broke, and a soft shadow longer away
  from the light. A tear over a masked hole drops its shadow on the layers beneath; the
  frame's edges stay clean cuts. The torn code compiles into its own programs, so torn
  at 0 runs only the plain shader; on (4K, RTX 4070) it costs about the old torn's 0.3 ms
  in Collage, and the Autocutter got cheaper both ways (3.7 to 3.1 ms off, 4.1 to 3.6 ms
  on), its plain program no longer carrying the torn branch.
- **Performance has its own tab**, right of the setup tab, always open there (and
  metering only while shown). The setup tab is now **audio/midi/osc**, its sections in
  that order.
- **Context's blur is yours alone.** It starts at 0, and New, Randomize (every scope and
  the Context dice), Variation, Generate and Worlds no longer set it : the picture only
  softens when you move the slider (or a modulator, MIDI or OSC you bound to it). The
  World editor drops its blur row. Saved sessions keep their blur.
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

- **No em dashes in the app text.** Empty menu choices read plainly (`none`, `nothing`,
  `solid color`, `voices`, `no saved sessions`) instead of being wrapped in dashes; an
  empty readout (FPS, frame time, CPU / GPU %, the Assemble clip counter) shows `-`, an
  idle MIDI input says `no MIDI received yet`, and Sonify's centered mixer filter shows
  `off`. Toasts, tooltips, Study blurbs and the OSC panic description use a colon or
  plain punctuation, and the Body page's help and tooltip quote the new `nothing`.

- **docs/bibliography.md** : the research papers behind the instrument, cited in APA 7.

- The **window title** now carries the release version, like dataFLOU_compositor:
  `Palinopsia v1.1.0` on the main window, `Palinopsia v1.1.0 : Output` on the output
  window. Read from `package.json` at launch, so every tagged build titles itself.
  (The output windows' title was also being silently reset to plain "Palinopsia" by
  the shared page `<title>`; it now holds.)

### Fixed

- **The Resolume mapper's scrollbars flickered** : the canvas sat inside the scroll area,
  so a redraw could add and remove the scrollbars frame after frame. It is laid over the
  scroll area now and never changes what scrolls (measured : one scroll-area size over 2 s
  of frames).
- **A click in the Resolume mapper toggled a pin far to its left** at any UI zoom below
  100 % (and to its right above) : the matrix compared viewport pixels with its own. Hit
  tests now divide by the effective zoom. Measured in a test copy : four clicks at 80 %,
  100 % and 125 % each toggled exactly the clicked pin. The msg/s readout no longer
  shows 0 for its first second.
- **The Body pip sits in the lower right** of the full-page views (Sonify, Output,
  World, Sequence, Resolume), where it no longer covers Sonify's tap menu. On the main
  view it steps aside : it covered the tap-tempo end of the toolbar, whose lit Body
  button is the tell there.
- **Development (`npm run dev`) : a hot update no longer leaves a second engine
  running.** Editing the sound engine, the audio input or the body tracker re-runs
  that module with a fresh copy, and the old one played on with nothing left to stop
  it : Sonify off and the sound still going (its audio context is kept open now), a
  line-in monitor still on the speakers, or two trackers on one camera (lag, and the
  camera driver's "Failed to reserve output capture buffer"). The new copy now shuts
  the old one down. Compiled out of a real build, which never had the problem.
- **A modulated on/off button now looks modulated** (accent2, blue in the Studio theme,
  like a modulated slider or menu) and shows its LIVE state, ON and OFF flipping with
  the modulator (a Collage's `freeze` driven by an LFO); a click still sets the stored
  state. The shared live overlay gained a paint-it-yourself subscriber for it.
- **The Ring bank's driven voicings rasped like a ring modulator.** MS-20, Steiner and
  K35 soft-clipped the WHOLE mix of the Collage's pieces before the bank; the loud low
  pieces (the centre of the frame gets the lowest notes) intermodulated there, sums and
  differences of their notes. The drive now pushes each band's own clip instead : the
  grit stays (every band still clips, harder), the rasp goes. Measured offline on the
  worklet's own RingBank (low scale tones + film noise, the Kamouropsia settings) : 2.22 %
  of the MS-20 output fell off every note, 0.09 % now (Steiner 0.84 → 0.06, K35 1.45 →
  0.08, Clean 0.04); peaks unchanged; 0.2-0.55 ms per audio block.
- **Sonify heals itself after an audio device error.** Its audio context now stays open
  for the whole session, so a device error (an interface unplugged, the output switched,
  a driver hiccup : twice in one Windows run) could leave it closed, suspended or
  silently stalled for good. It now listens for the device's error and state changes and
  checks every 5 s that its clock still moves; then it resumes, or rebuilds the context
  and restarts the sound. Never in the middle of a take (its sound track belongs to the
  context) : right after it. Measured : suspended → back in 0.45 s; closed → a new
  context, sound on; closed during a take → the take saved, rebuilt as it ended.
- **Double-clicking a modulation depth slider resets it to 0.5** (the depth a new binding
  starts at), like every other slider : in the Inspector's modulate panel, the Modulation
  panel, a Meta knob's binding and Sonify's targets. Their tooltips say so.
- **After a GPU crash the engine came back broken.** A GPU reset hands back the SAME
  WebGL context object with every program, texture and vertex array dead, and five
  caches keyed by it kept serving the dead objects (the shader bridge's blank texture
  and cleanup VAO, Collage, Text, Parametric, the native nodes) : "object does not
  belong to this context" on every frame, shaders failing to load, then no WebGL at all
  until a restart (seen twice in a Kamouropsia run). A GL generation
  (`engine/glGeneration.ts`), bumped when a context is lost AND when it is restored, now
  invalidates them all; the old engine stops drawing at the loss. Measured with a
  simulated reset : no GL error after the restore (it was a steady stream), the Collage
  playing and the picture moving. The Collage also stopped asking the GPU four blocking
  questions per render (twice a frame with FX before shapes). An ISF load error now
  logs its message instead of "[object Object]".
- **macOS installation** : the control window (which renders the picture the output
  shows) now keeps full speed while the fullscreen output covers it (Chromium's Mac
  occlusion tracking is off, like Windows' already was, in the SAME switch : a second
  `disable-features` would have replaced the first), the app opts out of App Nap
  (`NSAppSleepDisabled`), and the installation output's always-on-top is Windows only
  (on macOS it could fight the fullscreen Space). The README gains a Mac checklist.
- **OSC video speed now matches the slider.** `/opsia/layer{n}/video/speed` mapped 0..1
  across 1/28× to 128× (log) while the transport slider runs from 1/64×, so a
  controller's value and the slider disagreed (outbound feedback too). Both use 1/64×
  to 128× now : a controller mapped to the old range lands a little slower at the low
  end. Two app texts were also out of date : the Record section said DXV3 has no sound,
  and the toast after leaving an installation named a "launch on restart" button that is
  now "Enable on next restart".
- **A reloaded window froze the projector.** The frame link between the control window
  and the output was wired once, at the output's first load : a reloaded control window
  (a crash self-heal, Ctrl+R) or output never got a new one, and a reloaded control
  window forgot the output was open. It is wired on every load, and a reloaded control
  window streams to the open output again (measured : frames flowing after a control
  reload and after an output crash).
- **Cmd+Q on macOS left the app half-dead.** The subsystems stopped on `before-quit`,
  before the Save prompt : cancelling it left OSC, autosave and the senders dead. A quit
  now closes the window through its prompt first; everything stops on `will-quit`.
- **macOS output** : moving a fullscreen output to another display rebuilds it (macOS
  ignored the new bounds), and a span may cover several screens.
- **The macOS app is signed again (ad hoc).** electron-builder 26 no longer signs an app
  ad hoc by itself : the CI build skipped signing entirely, and Apple Silicon refuses to
  run unsigned code ("Palinopsia is damaged"). `identity: "-"` signs it, the hardened
  runtime is off (it would silently block the camera and the microphone without
  notarization), and CI now verifies the signature, the bundled ffmpeg included. The
  app also declares why it asks for the camera, the microphone, the screen, Documents
  and the local network (macOS 15 silently blocks OSC, NDI and light output without
  that last one), and the build is pinned to arm64. The install steps (Applications
  first, then `xattr -cr` or Open Anyway; right-click → Open stopped working in macOS
  15) are in the README, the release notes and the site.
- **A toggle could not be modulated : the Collage's freeze never froze under a
  modulator.** A toggle was assigned Multiply, whose law keeps a zero base at zero, so a
  modulator on a switch stored off did nothing at all; a switch stored on stayed on at
  the default depth; and even Replace never flipped one under depth 0.5. Toggles now
  follow one law in both modes (the chip reads `tgl`) : at depth 1 the toggle follows the
  modulator (on in its upper half), and less depth leans toward the stored state.
  Measured on a Collage with a 0.5 Hz sine : freeze stored off, default depth, frozen
  0 % of the time before and 34 % now, 50 % at depth 1; stored on, default depth, 100 %
  before and 68 % now; every film resumes after. Saved sessions' toggle assignments
  start working too. A menu sitting on its first choice is now also assigned Replace
  (Multiply could never move it off that choice).
- **The first take after launching the app could come out empty.** The hardware H.264
  encoder took 1.5 to 2.5 s to deliver its first frames the first time it was used, so a
  first MP4 or ProRes take shorter than that saved nothing (1 cold start in 3, measured).
  The app now warms the encoder up a few seconds after launch with a short hidden
  recording of an offscreen canvas (no file, no toast) : the first take's first data now
  arrives after about 0.6 s, 4 cold launches out of 4.
- **The output shape always looked feathered.** Its edge faded over a fixed 0.8 % of the
  frame height whatever the resolution : ~7 px at 1080p and about 33 px on a 4096 dome
  master, a soft edge you could not turn off. It is now anti-aliased over about one pixel
  (measured : the fill-to-picture ramp at 1080p went from 6-7 px to under 1), and a new
  **feather** control on the output shape softens it on purpose (0.05 is the old edge,
  0.5 a 54 px fade at 1080p).

- **Collage : lighter and sturdier.** Frame uploads now share a 4 ms main-thread budget
  per frame, round-robin (50 films at a speed of 2 uploaded every film every frame,
  ~15 ms); the upload staging cache holds 16 frame sizes under 160 MB instead of 4 (a
  mixed folder re-created a texture on every upload). Auto deals faster than a second
  re-cut the wall and re-shuffle the films already playing instead of reloading files
  (a reload storm froze pieces on their old frame; measured : 8 re-cuts in 3 s, 0 file
  loads; a 2 s Strobe deal still loads new films). A file that fails to load or decode
  is never dealt again and its piece moves to another film (it used to stay frozen, a
  re-deal re-cueing the same file); the folder scan now converts the containers and
  codecs Chromium doesn't open (.avi, .mxf, .mpg; MPEG-1, MPEG-4 part 2, WMV). A deal on
  a stopped wall (layer or global Speed 0) shows its new films; a window ending at the
  file's end no longer seeks twice per loop; a new file re-arms its frame callback (a
  stranded one dropped the film to the ~8 fps fallback); a background Collage that
  isn't shown stops decoding after a second. Measured on the RTX 4070 : 60 fps with 12
  films (wall 2.9 ms) and with 24 films at speed 2 (6.2 ms).

- **Dragging a modulated slider moves its base by as much as you drag.** The thumb
  shows the live (modulated) value, so grabbing it set the base to wherever the
  modulator happened to be (in Multiply mode the base sank a little with every grab),
  and after the release the thumb stayed frozen until something else took the focus.
  Now a drag or an arrow key moves the base relative to where the thumb was grabbed
  (measured : the thumb at 2, the base at 20, a +3 drag → 23), and the slider lets go
  of the focus on release. Counts (Collage `cuts`, `films`) step and read in whole
  numbers, and the modulation depth slider is five times finer.

- **Collage : `cuts` and `films` can be modulated.** Every whole-number step of `cuts`
  re-drew the whole partition and its film assignment from one random stream, so an
  LFO reshuffled the wall every frame (86-100 % of the frame changed film per step).
  The partition is now stable : each piece's choices hang on the piece (the cut-up's
  n-1 splits are the same whatever the count; the mosaic seeds are a best-candidate
  sequence whose every prefix is evenly spread), films go to the least-used film in
  creation order, and the mask order and rotations are per piece. Measured : 0-13 % of
  the frame changes film per step (cut-up), 2-14 % (mosaic). The count steps with a
  little hysteresis (0 rebuilds with a modulator hovering at 12.5) and the deck array
  is sized from the stored count, never the modulated one (a slow modulator used to
  reallocate up to 80 MB). A film no piece plays keeps running 1.5 s before it pauses,
  a `films` step no longer restarts every film (measured : they play on), the churn
  re-rolls no longer repeat after each change, a modulated `window` applies while it
  moves (every 0.3 s), and morphs (Randomize, Variation, scenes) take `films`, `shape`
  and `feed` straight to the target instead of building a decoder per step. The mosaic
  shader now searches every seed (60 fps at 64 shards with torn paper, RTX 4070).

- **Menus open on their anchor at any UI zoom.** A source picker's list and every
  right-click menu were placed in screen pixels inside the zoomed interface, so the zoom
  was applied twice : at 80 % a layer's source list opened hundreds of pixels to the left
  of its button. They now open on the button (or the cursor) at 80, 100 and 125 %
  (within 2 px, measured), and follow it when you zoom with a menu open.

- **Sonify's Collage voice crossfades instead of cutting.** At every deal the sound
  dropped to silence for 100 to 200 ms (measured), because a film loading its new clip
  reads as paused and the voice paused its sound with it; and each piece was rewired to
  its new film on the spot. Now a deal crossfades every piece (the old places and notes
  fade out as the new ones come in, equal power) over the Collage's own crossfade time,
  30 ms at 0; a film taking a new clip, or jumping (a window loop, a re-cue), hands over
  between two players once the new one sounds. Over three deals the quietest 10 ms now
  stays within 3 dB of the median, as with no deal at all. Deals faster than the
  crossfade shorten it, so the fades never pile up.

- **The Sonify audit** (three passes : the audio engine, the page and its links, the DSP) :
  - **The noise repeated every 218 ms.** The noise generator's arithmetic lost its low
    bits, so every seed fell into the same 10,466-sample cycle : the Filter voice's wind
    was a 4.6 Hz loop (correlation 1.0 at that lag). It is true noise now; the loop is
    the Filter's new `loop` knob if you miss it.
  - **The reverb mix did nothing** : both reverb sliders, the `fxReverb` modulation and
    OSC `/fx/reverbmix` were ignored. It works now, with 0.6 (the default) at exactly the
    level the reverb always had.
  - **Switching a voice clicked** (the sequencer did it in rhythm) : the jump at a
    toggle measured 0.49, 4.7x the largest normal sample step; with a 5 ms fade, 0.06.
    A voice coming back no longer restarts at its old level or fires the notes queued
    while it was off.
  - **Every slider move, OSC message and sequencer step wiped the modulation** for up to
    50 ms (a modulated pitch or probe snapped to its base) : the modulated values now
    follow every config.
  - **The FX tail stopped mid-echo** after one quiet block, and the stranded echo came
    back when the send rose again : it now plays out (stops once quiet for longer than
    the delay time) and clears.
  - **Events** : a busy frame let the onsets due in one block overwrite the same note
    (only the last of five sounded); a stolen note cut with a click. Now each lands on
    its own voice and a stolen note fades over 3 ms.
  - **Notes past Nyquist** folded back out of key (a raised root octave put Spectra's top
    partial at 59.7 kHz, heard at 11.7 kHz) and an Events note could run its phase away
    into a thump and a dropout : Spectra and Chord partials past it go silent, Flow and
    Events notes drop an octave; Filter bands above its ceiling drop by octaves instead
    of stacking into one whistle.
  - **Prism's freeze dulled** after any size change (a float32 glide stalled a fraction
    of a sample short); the Orbit's Lissajous jumped every few minutes at high pitches;
    the frame crossfade could jump (the Orbit now crossfades per sample); the master,
    delay mix and voice gains stepped; Raster's tone switched hard into its open setting;
    Flow ignored its pan; new Flow and Events onsets replaced still-pending ones; the
    reverb's buffers clamped at 96 kHz; a NaN (from OSC) could silence a voice until a
    restart.
  - **The audio thread works a third as hard** : the oscillators and Flow's grains read
    wave tables (the same sound within -120 dB, measured) : Flow 533 to 108 µs per block,
    Spectra 191 to 73, Chord 68 to 17.
  - **Turning Sonify on then off quickly** (a double tap, a momentary OSC button) left the
    engine running under a page that said off; line-in never reopened after a restart;
    two quick line-in requests could sum the mic twice; a failed start leaked an audio
    context per retry; a voice switched on burst with motion against a stale frame; the
    image ticks ran at an uneven 24-30 Hz; the sequencer drifted late; a step whose
    preset was deleted or missing on this machine did nothing (it plays its voices now).
    The Collage voice played a new film's first moments before syncing and left dropped
    pieces attached to their film.
  - **The page** : the probes were drawn and dragged over the mirror's black bars, not on
    the picture (a held line at x 0 sat on the left bar); a held line dragged by x
    whatever its path; the sweeps were drawn at the stored rate, not the synced or
    modulated one; the Orbit drew a circle whatever its shape; a modulated Raster rect
    couldn't be grabbed where it showed, and jumped its center onto the pointer.
    The mixer's double-click reset every voice to 0.5 (now each one's default); older
    sessions showed Flow's color at 0 while it played 0.6. Suggest could pick a voice set
    silent on a still frame, and missed a Collage on the background or fed by assemblages.
  - **OSC** advertised index addresses as floats over their raw range, so a client
    following the advertisement sent 4.0 for octave 4 and got octave 6 : they are
    advertised and sent as integers now. A NaN float is read as 0.
  - **Copy** : the Sonify page names no tools or artists in its tooltips, spells color
    and center, has no em dashes, and its sequencer columns are two letters (F/F and C/C
    were twins). The Body page's gesture list can toggle the Collage voice, and the
    MIDI label says Transmission.

- **Sonify's stereo field.** The Chord, Flow and Events voices panned their notes with a
  linear law, so a note in the middle lost 3 dB against one at the side (measured), and
  Chord's spread put the root note hard left. They now pan with equal power (every note
  within 0.6 dB wherever it sits), and Chord's spread keeps the bass in the middle and
  fans the notes above alternately right and left, the highest widest. The Collage
  voice's pieces only balanced their stereo films : a centred piece kept the film's own
  width (a left-only tone stayed 34 dB left) and an edge piece got louder. Each piece is
  now a point source, the film folded to mono and placed by its position with equal power.
- **Palinopsia could run on a laptop's integrated graphics.** Windows picks a hybrid
  laptop's graphics card per program, and leaves one it doesn't know on the integrated
  chip unless its graphics settings say otherwise; the WebGL contexts' power preference
  alone didn't move it. The app now asks Chromium for the discrete GPU at launch.
  Measured from a path Windows had put on the Intel Iris Xe : the RTX 4070 with the
  switch, the Iris Xe without it, about 15x apart.
- **Context's Vibe Color button picked a color that wasn't on screen.** It read the
  Vibe's five manual stops whatever the mode : with a color chord on (whose stops
  replace them) or only two stops active, it usually landed on white and the light
  looked unchanged. It now takes the colors the Vibe is actually painting with (the
  chord's, or the active stops), at full brightness, and turns the light up to 0.25 if
  it was off. One shared helper for the Context section and the Inspector.
- **The previous session kept playing after a session change.** Loading a session (or
  New) compiles its shaders a few per frame, and every layer still waiting its turn kept
  drawing the OLD session's generator, so the projector showed the old visuals for
  seconds, swapping layer by layer. Now the picture holds still until the new session
  has compiled (spending more per frame while nobody watches it assemble), then
  dissolves into it over 0.5 s. Measured (integrated graphics) with 21 shaders to compile : 2.2 s of old
  visuals still playing (14 to 20 different frames) became about 1 s of still frame and
  the dissolve (1.5 s to the new picture on the projector, at most 6 s held).
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
