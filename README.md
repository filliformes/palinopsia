# Palinopsia

> *palinopsia (n.): the persistence or recurrence of a visual image after the stimulus is gone.*

An **OSC-controlled ISF visual instrument** — the visual sibling to
[dataFLOU](https://github.com/filliformes/dataFLOU). A lightweight Electron +
WebGL2 **four-layer compositor**, *played* over OSC (by [Pandore](https://github.com/filliformes))
rather than patched like a tool. It composites layers of shader synthesis and
treated video through blend modes, per-source / per-layer / master ISF effect
racks, a modulation brain, and a curated Randomize — into a fullscreen or
network output.

The afterglow of a feedback compositor *is* palinopsia — the name is a
description, not a metaphor. The house voice is matte, glitchy, digital-arts
work: **never cheap psychedelia, never a 3D game engine.**

- **Matte over neon** — near-black canvas, one accent, glitch as controlled texture.
- **Curated, not open-ended** — a fixed instrument topology; Randomize draws from
  aesthetic sub-ranges, never raw shader min/max.
- **Played, not patched** — every parameter reachable over OSC, MIDI, or the UI,
  through a single write path.

---

## Contents

- [Concept](#concept)
- [Getting started](#getting-started)
- [The interface](#the-interface) — layers · transport · meta · modulation · sequencer · worlds · output
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Sources](#sources-generators) (30 generators)
- [Effects](#effects) — where FX live · the full catalogue · native nodes · master finalizers
- [OSC implementation](#osc-implementation) — inbound · outbound · OSCQuery · setup
- [Stack & architecture](#stack)
- [Aesthetic guardrails](#aesthetic-guardrails)
- [Credits & license](#credits--license)

---

## Concept

Palinopsia is a **compositor you perform**, not a patcher you wire. Its topology is
fixed and its vocabulary is curated: a seed library of glitch / generative /
digital-arts shaders that *is* the instrument's voice. You build an image by
stacking layers, treating each through effect racks, mastering the whole through
three pinned finalizers, and steering all of it live — by hand, by an internal
modulation brain, or over OSC from a companion "brain" like Pandore.

It also **reads audio** rather than merely pulsing to it: a shared audio bus, an
A↔B coupling engine (synchresis as balance behaviour), global World/diegesis
presets, and named field macros turn sound→image relations into playable
structure. A generative macro-form sequencer can then auto-pilot a whole set from
tagged scenes.

---

## Getting started

```bash
npm install
npm run dev          # electron-vite dev
npm run typecheck    # tsc — node + web projects (both must be green)
npm run build        # electron-vite build (bundle only)
npm run build:win    # NSIS installer + portable
npm run build:mac    # DMG
```

The native Spout addon (`native/spout/`) is optional and Windows-only; it's
rebuilt against the Electron ABI and loaded at runtime — the app runs fine
without it (the Spout toggle simply reports unavailable).

---

## The interface

### The layer stack

Bottom → top: **Background → Layer 1 → Layer 2 → Layer 3 → Layer 4.** Four layers
composite over one background "ground."

Each of the **4 layers** carries:

| Element | What it does |
|---|---|
| **Source A / B** | Two source slots. Each holds a generator, an imported video (`🎞`), a capture (webcam `📷` / screen `🖥` / device `🎥`), a HIVE network stream (`📡`), or nothing. |
| **A/B mix** (`MIX`) | `sourceBlend` (how B combines with A) · `sourceMix` (0 = A only … 1 = full B) · `harmony` (⚖ consonant → dissonant B hue). Inert until B has a source. |
| **Source FX** | A separate effect rack under **each** source slot (`sourceAFx`, `sourceBFx`). |
| **Layer FX** (`FX`) | The layer's own effect rack — the **only** rack that accepts native convolution nodes. |
| **Blend** (`BLEND`) | How the layer composites onto the stack below (17 blend modes). |
| **Opacity** | Header slider (0–1). |
| **Speed** (`SPEED`) | The layer's own clock multiplier (0–20×) over global speed. |
| **Feedback** (`FB` + `TRAIL`) | Samples the layer's own previous frame (ping-pong FBO decay-feedback). |
| **Solo / Mute** (`S` / `M`) | Per-layer isolation; per-layer dice `⚄`. |
| **Coupling** (`CPL`) | Audio drives the A/B balance (hidden until enabled): modes off/lean/hocket/cut/gate/drift + feature + amount + tightness. |

Shader hot-swaps preserve feedback buffers — no reset-to-black mid-performance.
Right-click a layer for Init / Randomize / Copy / Paste / layer presets.

The **Background** slab has one source (from a curated set), its own full FX rack,
opacity, a slow clock (default 0.25×), a **Depth** control (the foreground casts a
soft contact shadow onto it), and a **blend / isolate** mode against the stack. It
has its own preset bank and its own dice, and is never touched by the global
Randomize.

The right column switches between three views (tabs, or keys `L` / `M` / `F`):
**Layers** (the strips + background), **Mixer** (compact opacity/speed/blend for
all four), **Finishing** (the Vibe · Context · Finalizer stack).

### The Transport bar (bottom)

Left → right:

- **BPM** (20–800) · **SPD** global speed (1/64×–64×, log; double-click → 1×) ·
  **MRPH** morph time (0–30 s — scene recalls and Randomize crossfade over this).
- **WRLD** World selector + `⧉` World editor · **Seq** (opens the sequencer;
  lights when running) · **PROX** proximity (far ↔ close depth zone) + `◑`
  audio-brightness follow.
- **Field macros** (bipolar, neutral 0.5): **DENS** sparse↔dense · **G↔T**
  gesture/sharpen ↔ texture/trails · **COAL** grain↔mass.
- **Temperament** (unipolar, neutral 0): **TONE** tonicity (tonal audio pulls
  colour, noise pulls to B&W) · **SHUT** shutter (global stop-motion freeze;
  0 → slow/chunky → fast) · **DRIFT** analog wander · **SUPER** superimposition
  flicker (cross-cuts which layer shows).
- **Vary** (a baseline-anchored variant — structure fixed, values nudged) + amount.
- **amt** Randomize intensity (gentle walk ↔ full re-roll) · **Randomize**
  split-button (main fires the selected scope; `▾` chooses the scope: All /
  Sources / Source Parameters / Source+FX / Source FX / Layers / Layer FX /
  Master FX / Finishing / Modulators / Meta Knobs).

### Meta Controller (16 knobs)

A flat bank of 16 macro knobs. Each tile is a 270° dial (drag vertically, Shift =
fine, double-click resets), with a destination count, a rename, an output **curve**
(linear / log / exp / eases / sigmoid / smoothstep / db / gamma / step / invert), a
**CC** MIDI-learn, and an **M** button binding one modulator to the knob. Each knob
can drive up to 8 destinations. `⚄` shuffles knob positions while keeping bindings.

### Modulation brain (8 modulators + matrix)

Eight modulator slots, each of a chosen **type** — `lfo` (7 shapes) · `ramp` ·
`adsr` · `arp` · `random` · `s&h` · `slew` · `chaos` · `audio` (follower) ·
`organic` · `physics` · `motion` — with a clock (free Hz or BPM division),
type-specific params, a live meter, and retrigger. Slot 8 (`⊛`) is reserved for the
active World's audio routing and is skipped by Randomize.

The **mod-matrix** is a capped list of assignments (M# → target param, with a
bipolar depth and a **Multiply** [VCA-scale the base] or **Replace** [swing] mode).
Bindings are made from each parameter's **M** button in the Inspector or Meta tile.
Modulation reaches **float, enum, and bool** inputs and is written straight to the
compositor at frame rate — never through React re-renders.

### Sequencer (key `Q`)

An auto-pilot over the scene bank. Each scene carries relation tags — **Diégèse**
(world) · **Synchrèse** (coupling) · **Espace-temps** · **Climat**. The sequencer
does weighted / arc / shuffle selection with a no-repeat window, morph/cut/auto
transitions, and subtle no-exact-repeat variation; overlays **Breathe**
(dense↔void) and a **Climate arc** (repose–disturbance–repose); adds **cadence /
rupture / monomedia** punctuation; supports audio/chaos-armed deferred advance; and
exports a Markdown **relation-score** (`⤓ score`). Needs ≥2 scenes to play.

### Worlds / diegesis (key `W`)

A global "proposed world" biases the whole composition — A/B coupling character,
Context mood, and audio routing (which feeds modulator slot 8). The editor holds a
world bank (built-ins + saved), coupling settings, Context mood sliders, an
audio-routing binding, and a live visualiser. Editing the active world updates the
composite live.

### Output & mapping (key `O`)

A full-page takeover (the engine keeps rendering underneath):

- **Mapping** — a live keystone editor (drag four corner handles over a mirror of
  the output) + alignment grid + reset.
- **Resolution** — render-scale 0.1–2× of 1920×1080 (½ lo-fi / 1080p / 1440p / 4K;
  rebuilds the engine).
- **Fullscreen output** — pick a display; borderless-fullscreen or windowed.
- **Record** — format select (MP4/H.264 default; ProRes / FFV1 / uncompressed via
  ffmpeg) + record / stop + screenshot → `Recorded/`.
- **Send** — NDI / Spout toggles (optional native senders); **HIVE** HEVC-over-TCP
  network output + port.
- A resource **HUD** (FPS · CPU · RAM · VRAM · GPU).

### Sessions & scenes

Sessions are `.opsia.json` files: **New / Open / Save / Save As** in the toolbar,
plus **Ctrl/Cmd+S** (overwrites the current file, Save-As the first time). A 60 s
autosave loop and a save-before-quit handshake protect live state. Theme, worlds,
scenes and the sequencer all travel inside the session file.

**Scenes** are full-instrument snapshots recalled by bare **`1`–`9`** or a
double-click in the bank; recall crossfades over the **MRPH** morph time. Scenes
carry their sequencer tags and are saved inside the session.

---

## Keyboard shortcuts

Bare keys are ignored while typing in a text field; `Ctrl/Cmd+S` always fires.

| Key | Action |
|---|---|
| `1`–`9` | Recall scene 1–9 |
| `P` / `Shift+P` | Open Vibe Palette / cycle its presets |
| `C` / `Shift+C` | Open Context / cycle its presets |
| `M` | Toggle the compact Mixer view |
| `O` | Output / Mapping page |
| `W` | World editor |
| `Q` | Sequence page |
| `L` / `F` | Right column → Layers / Finishing |
| `D` / `X` / `I` | Collapse Modulation / Master-FX / Inspector |
| `R` | Fire the Transport's selected Randomize |
| `Esc` | Close World / Output / Sequence page |
| `Ctrl/Cmd+Z` · `Ctrl/Cmd+Shift+Z` / `Ctrl/Cmd+Y` | Undo · Redo (100 levels) |
| `Ctrl/Cmd+S` | Save session |
| `Ctrl/Cmd` `+` / `-` / `0` · `Ctrl`+wheel | UI zoom in / out / reset |

**MIDI:** per-knob CC learn on the Meta Controller (Web MIDI).

---

## Sources (Generators)

30 sources produce an image from nothing. Any generator can fill **Source A or B**
of any layer (and all but a few can be the Background source). Each ships curated
Randomize sub-ranges and its own preset bank.

| Source | Description |
|---|---|
| **Drift Field** | Slow directional noise flow posterized into matte bands over near-black, with an accent tint and a restrained edge chroma-split. |
| **Slabs** | Sparse horizontal slabs on a stepped clock with slice-jitter and a rare accent cell — the slice/shuffle glitch register, built to be blended. |
| **Contour** | Slow marching contour lines over a drifting, domain-warped noise basin — topographic matte line-work. |
| **Grid Drift** | A flat grid whose rows and columns breathe out of alignment, occasionally slipping whole lanes, with sparse filled cells. |
| **Particle Drift** | Sparse points carried through a flow direction with capsule trails, wandering inside their cells. |
| **Interference** | Two near-frequency line fields beating into moiré, handled as matte texture (never op-art); the beat crawls at the detune rate. |
| **Column Scan** | Horizontal scan lines vertically displaced by a drifting internal signal; brightness follows the slope. |
| **Ash** | Sparse particulate falling at per-column rates with lateral wander and flicker — near-black particulate weather. |
| **Murmuration** | A flock of points steered by one shared, slowly-turning wind field — coherent density waves pass through the crowd. |
| **Filaments** | Vertical strands swaying like kelp, each with its own rate and phase; drift leans the whole bed. |
| **Erosion** | Anisotropic ridged noise advected downward, carving streaks that gather and split — the geological register. |
| **Membrane** | One large soft mass slowly deforming in the dark — a breathing thresholded silhouette shaded by depth. |
| **Mycelium** | A thin branching network revealed by a growth front expanding from an off-centre seed, then dissolving and regrowing. |
| **Swell** | An open water surface as pure luminance — several wave trains beating plus chop, no horizon. |
| **Congeal** | A self-referential feedback field: sparse seeds injected, then a domain-warped, decayed copy resampled each frame — material congeals and dissolves. |
| **Slit Scan** | A slit-scan of an internal oscillator — each column is the signal frozen at an earlier moment (time = position), a scrolling time-history. |
| **Ramps** | Clean voltage-style gradient signals (H / V / diagonal / radial / diamond), optionally stepped and drifting — raw material to colorize or key. |
| **RGB Oscillators** | Each channel its own 2D oscillator (waveform × frequency × phase), detuned so colour separates into drifting interference — the analog-video register, kept matte. |
| **Recurse** | Recursive geometry — a shape redrawn into a space shrunk, slightly rotated and shifted off-centre, cascading inward (a spiral, deliberately not a radial kaleidoscope). |
| **Shapes** | Hard-edged primitive fields (circle / ring / bar / cross / triangle), tiled and animatable — a matte source, or a stencil keyed through the A/B mixer. |
| **Op-Art** | Hard-edged optical-illusion fields (waves, grids, moiré, herringbone) with illusory motion — curated and minimal, at home under anaglyph 3D. |
| **Direct Marks** | Hand-drawn direct-film marks — ruled lines, dots or scratches in flat ink, appearing on a gate you can drive from audio (marks on the beat). |
| **Dye Field** | Subtractive pigment pooling over a near-black emulsion, disciplined toward decay and crystallisation — painted-on-film dye, never additive glow. |
| **Reaction** | A Gray-Scott reaction-diffusion field self-organising into drifting spots, stripes, labyrinths and splitting critters, with its own zoom/pan/rotate framing. |
| **Sync Osc** | A morphing video-synth oscillator — one waveform morphing saw → triangle → sine, with a sync control from scrolling → frozen; colorized between two tints. |
| **Differential** | Visual polyrhythm — several wave trains at integer speed ratios beating against each other, rendered as pulsing topographic contour bands. |
| **Solid Color** | A flat colour fill or a smooth 3-stop linear gradient at any angle — the quietest source, to key / tint / grade against. |
| **Organic** | Living elemental textures in motion — fire (upward flames), water (caustic depth), or nature (growing canopy); `vary` shifts each toward an alternate season. |
| **Text** *(native)* | Typography as a source — type in the Inspector; choose font / size / weight / spacing / position; a sidechain layer can fill the glyphs. |
| **Parametric** *(native)* | A literal audio → image reading — the audio bus as a hard raster, waveform trace, spectrum bars, or scrolling spectrogram (needs Audio ingest for real sound). |

> Beyond generators, a source slot can also hold an **imported video** (with a
> transport: play mode, speed, loop, playhead), a **live capture** (webcam / screen /
> device), or a **HIVE** HEVC-over-TCP network stream — each treatable through the
> slot's own Source-FX rack.

---

## Effects

### Where FX live

There are **five effect racks**: **Source-A FX** and **Source-B FX** (one under each
source slot), **Layer FX**, **Master FX**, and **Background FX**.

- **Any standard ISF effect below can be placed in any of the five racks** —
  placement is not restricted by effect. The picker (grouped by sub-category) is the
  same everywhere.
- **Native convolution nodes** (Transfert · Convolution · Réponse · Feedback) appear
  **only in the Layer-FX rack** — they need a full-resolution ping-pong buffer, the
  host/sidechain textures, and inter-frame state that only the layer rack provides.
- **The three master finalizers** (Vibe · Context · Finalizer) are **pinned, locked,
  and always last in the Master rack, in that order.** They can't be added, removed,
  reordered, or duplicated — only bypassed.

An effect's position in a rack matters: effects apply top-to-bottom. Source FX treat
one slot before the A/B mix; Layer FX treat the mixed layer before its blend; Master
FX treat the whole composite before the finalizers.

### The catalogue (46 effects)

| Effect | Description |
|---|---|
| **Posterize** | Quantize tones into matte, gamma-aware bands. |
| **Dither** | 4×4 Bayer ordered dithering at a chosen dot scale, quantizing into few levels — matte texture, not noise. |
| **Chroma Shift** | Restrained RGB split along a chosen axis — subtle chromatic aberration. |
| **Pixelate** | Aspect-correct mosaic quantization of the sampling grid. |
| **Displace** | Drifting value-noise domain warp of the sampling coordinates — asymmetric, never radial. |
| **Scanlines** | Line darkening as controlled texture, with an optional slow roll — darkening only, no glow. |
| **Edge** | Sobel luminance contours, mixable over the source — matte line-work. |
| **Grade** | Brightness / contrast / saturation / lift — the master-rack workhorse. |
| **Slice Shuffle** | Horizontal band displacement on a stepped clock — cuts, not flow. |
| **Smear** | Pseudo pixel-sort — bright pixels streak along a direction with decaying taps, gated to highlights. |
| **Palette** | Re-color by mapping luminance through a 2–5 stop gradient, with band/blend morph and dither — duotones to full palettes. |
| **Threshold** | Luma key to hard two-tone with a soft knee and optional invert — carve shapes. |
| **Solarize** | Invert everything whose luminance clears a level, with a soft knee (Sabattier). |
| **Mosh Blocks** | Macroblock corruption on a stepped clock — displaced, sometimes channel-swapped blocks (datamosh register). |
| **Grain** | Physically-modelled noise per medium — film (clumped, midtone-peaked), digital sensor (shot / read / fixed-pattern), CRT (snow / dropout), VHS (smear / chroma error). |
| **Streak** | Uniform 16-tap directional blur — camera-drag motion smear (not luma-gated). |
| **Sharpen** | 3×3 unsharp mask — makes dithers bite and posterized bands snap. |
| **Fold** | A single-axis mirror at a movable seam with a slide offset — one deliberate fold, kept asymmetric. |
| **Transform** | Zoom / pan / rotate the sampling frame (wrap or clamp); with Shape set, clips the layer into a geometric silhouette. |
| **Stutter** | Probabilistic frame holds — horizontal bands freeze independently on their own irregular clocks, with optional blackout. |
| **Sync Loss** | Vertical hold rolling away plus horizontal tear bands on a stepped clock — the broken-monitor register. |
| **Row Echo** | Chance-selected row bands freeze onto their top line and repeat downward — a line-hold smear. |
| **Byte Corrupt** | Bit-depth crush plus per-block arithmetic scrambling that folds channels into each other — data damage, with a warped block grid. |
| **Ringing** | Alternating-sign high-pass edge echoes repeating at a fixed distance — compression ghosting / over-sharpened broadcast. |
| **Tracking** | VHS tracking error — a noisy head-switch band placed by position and crept by roll, a wandering freeze line, analog x-distortion and tinted chroma bleed. |
| **Motif** | Spatial counterpoint — re-instantiates the image's gesture elsewhere, transposed (translated / rotated / scaled / mirrored) as directional echoes, never radial. |
| **Feedback Zoom** | The image feeds back through a zoom and twist, echoes marching inward / outward — mix-decay so trails converge instead of blooming. |
| **Distort** | Ten warp modes on one control set — wave, ripple, bulge, pinch, swirl, shear, glass, corrugate, pull, turbulent. |
| **Slit Buffer** | A write head sweeps across the frame, freezing the live image into a buffer as it passes — a real slit-scan (normal / inverted / pendulum). |
| **Difference Bloom** | Frame-difference motion key — only what moved survives, spread softly; still areas fall to near-black. |
| **Triangle Flicker** | Triangle-wave rhythmic brightness flicker with an optional hard strobe and beat channel-shuffle — clock it to tempo. |
| **Colorizer** | Analog CV colorizer — luminance through gain + bias, soft-clipped, then a smooth 3-colour gradient (a scan-processor colouring stage). |
| **Wavefold** | Analog wavefolder on the video signal — drive the value and repeatedly reflect it inside [0,1], carving hard contour bands. |
| **Rutt** | Rutt/Etra-style scan processor — horizontal scan lines displaced vertically by the image's own luminance (a wireframe topography). |
| **CRT Screen** | A whole-tube finish — barrel curvature, edge chromatic aberration, scanline grille, corner vignette, rounded bezel. |
| **Pixelmask** | Stencil the image through a pattern (aperture grille / shadow mask / dot / line / bayer / noise); an RGB-triad option gives real phosphor stripes. |
| **Light Trails** | max()-blend trails — the brightest pixels persist and streak (long-exposure light-painting); optional drift. |
| **Decay** | Analogue generation loss — chroma bleed, block crush, head-switch jitter, a bounded feedback ghost, tape noise and dropout lines; only ever degrades. |
| **Abstraction** | One knob from representation to abstraction — luma-driven displacement + posterize + desaturation; a source dissolving into moving matter. |
| **Wide Time** | A temporal average across the last N frames — the image crossfades with its own recent past into evolving scapes (mean / brightest / add / screen / difference / darkest). |
| **Hue Rotate** | Rotate the image's hue, optionally weighted by luminance — the missing colour primitive, beautiful under a slow LFO. |
| **RGB Shift** | The three channels pulled apart geometrically (offset + independently scaled about centre) with an animated wobble — the channel-separation look. |
| **Granular** | Video granular synthesis — the frame shattered into a grid of windowed grains, each rotated / scattered / scaled, with a persistent buffer for temporal smear. |
| **Mosaic** | An analysis/resynthesis grid — each cell its average colour, redrawn as a tile whose size follows its luminance (bright swells, dark shrinks to nothing). |
| **Optical Rain** | Shatters the image's edges into downward-drifting vertical streaks, each carrying a red/cyan disparity — a floating tactile texture under anaglyph 3D. |
| **Phosphene** | The retinal afterimage that names the instrument — a bright stimulus burns a lingering complementary-colour negative ghost that slowly decays. |

### Native convolution nodes — Layer FX only

These run a TypeScript class behind a header-only ISF (so the auto-UI, presets and
modulation still work). They live only in the Layer-FX rack.

| Node | Description |
|---|---|
| **Transfert** | Imprint another layer's **motion** onto this one (optical-flow transfer) — *Déplacement* warps by the sidechain's flow, *Traînée* is a flow-steered line blur. Pick the sidechain layer in the Inspector. |
| **Convolution** | Treat another layer as a convolution **kernel** — every bright pixel of this layer stamps a scaled copy of the sidechain's shape, transferring its glare / texture / energy. |
| **Réponse** | Temporal convolution — the layer's last 16 frames summed through a shaped attack/decay envelope (reversible): a convolution-reverb for image. Uses the layer's own history (no sidechain). |
| **Feedback** | A full video-feedback engine — the last frame re-sampled through a drifting off-centre transform + self-displacement, mixed with the live layer, held at the edge of chaos by AGC + a noise floor. Keyer-into-the-loop, a delay-tap ring, and blend modes. No sidechain. |

### Master finalizers — pinned, always last

| Stage | Description |
|---|---|
| **Vibe Palette** | The always-on colour-**mastering** stage: auto-levels (temporally smoothed min/max), gamma tone placement, palette map, source mix-back, contrast, saturation, and split-tone. Decides the whole output's look; survives every global Randomize. Ships 50 palettes. |
| **Context** | The always-on **depth** finalizer: temporal trails, a soft key light with volumetric bloom, atmospheric haze, spatial blur, a depth vignette, and PBR texture mapping (project the composition onto a material). Every parameter at zero is a clean passthrough. |
| **Finalizer** | The last always-on stage: a final grade (input black/white + gamma + per-channel R/G/B gain), sharpen, and physically-modelled grain over everything, plus an **output shaper** (clip the frame to any of ~21 silhouettes with a drop-shadow, filled by a colour or the Background) and the **Cameraless film hold**. Neutral at defaults. |

`toggleFinishing` bypasses/enables the three as one bank; they are excluded from
Randomize (only their own dice re-rolls their params, holding brightness-critical
bands neutral).

---

## OSC implementation

All addresses live under `/opsia`; anything else is ignored. **Every continuous
control takes a normalized `0..1` float** scaled to the target's declared range.
Enums accept a name (`s`), an int index (`i`), or a `0..1` float across members.
Bools/toggles are true at `≥ 0.5`. Triggers fire on the **rising edge**. **BPM is
the only raw value.** All indices in addresses are **1-based**.

### Inbound (control → instrument)

**Layers** — `/opsia/layer/{1..4}/…`

| Address | Type | Meaning |
|---|---|---|
| `…/opacity` | f | Layer opacity (0..1) |
| `…/speed` | f | Layer speed (0..1 → 0..20×) |
| `…/mix` | f | A/B source mix |
| `…/trail` | f | Feedback trail amount |
| `…/blend` | i / f / s | Layer blend mode (index, 0..1 across 17, or name) |
| `…/sourceblend` | i / f / s | A/B blend mode |
| `…/mute` · `…/solo` · `…/feedback` | bool | Toggles (≥ 0.5) |
| `…/source/{A\|B}` | s | Set source shader (id / name / `none`) |
| `…/source/{A\|B}/{input}` | f · color · point2D | A source shader input |
| `…/source/{A\|B}/fx/{i}/{input}` | f · color · point2D | A Source-FX unit input |
| `…/fx/{i}/{input}` | f · color · point2D | A Layer-FX unit input |
| `…/coupling/mode` | i / f / s | `off·lean·hocket·cut·gate·drift` |
| `…/coupling/amount` · `…/tightness` | f | Coupling depth / tightness |
| `…/coupling/feature` | i / f / s | `level·flux·transient·centroid·band·pitch` |

Blend modes (index 0–16): `normal, add, subtract, multiply, screen, overlay,
softlight, hardlight, darken, lighten, difference, exclusion, dodge, burn, wrap,
weave, lumakey`.

**Master** — `/opsia/master/…`

| Address | Meaning |
|---|---|
| `master/fx/{i}/{input}` | Master-FX unit input (the locked finalizers are excluded here) |
| `master/vibe/{input}` · `master/context/{input}` · `master/finalizer/{input}` | The three locked finalizers' inputs |

**Background** — `/opsia/bg/…`

| Address | Meaning |
|---|---|
| `bg/opacity` · `bg/speed` · `bg/depth` | f (0..1) |
| `bg/blend` | bool → `isolate` (≥ 0.5) else `blend` |
| `bg/source` · `bg/source/{input}` · `bg/fx/{i}/{input}` | Background source / its inputs / FX inputs |

**Macros & temperament** — each a single `0..1` float:
`/opsia/density`, `/gesture`, `/coalesce`, `/proximity` (field macros; 0.5 = centre)
· `/tonicity`, `/shutter`, `/drift`, `/superflicker` (temperament; 0 = off).

**Meta / transport / structure**

| Address | Type | Meaning |
|---|---|---|
| `/opsia/meta/{1..16}` | f | Drives meta knob *n* (smoothed) |
| `/opsia/bpm` | f | Tempo — **raw**, clamped 20..800 |
| `/opsia/world` | s / i | Select World (name, or 1-based index) |
| `/opsia/seq/run` | level | Run (≥ 0.5) / stop the sequencer |
| `/opsia/seq/skip` | trigger | Advance to next scene |
| `/opsia/scene/{n}` | trigger | Recall scene *n* (1-based) |
| `/opsia/randomize[/{scope}]` | trigger | Fire Randomize (scope defaults to `all`; `sources`, `sourceparams`, `sourcefx`, `sourcefxonly`, `layer`, `layerfxonly`, `master`, `finishing`, `modulators`) |

**Audio sensors** (pushed by the "audio brain"; bypass the store, feed the audio bus
directly): `/opsia/audio/{level|flux|transient|centroid|pitch}` and
`/opsia/audio/band/{1..6}` — all `f`, `0..1`.

Type resolution: `float` → `min + v·(max−min)`; enum → nearest member;
`bool`/`event` → `v ≥ 0.5`; `color` → 3–4 raw `0..1` args (or one → grayscale);
`point2D` → 2 per-axis args.

### Outbound (instrument → control, "feedback")

When enabled, the instrument diffs its streamable parameters and pushes the changed
ones to a peer (e.g. Pandore's UI mirrors yours). Same `/opsia/…` addresses, same
`0..1` convention; **every outbound value is a single float `f`** (enums/bools
normalized). Streamed: every layer control, meta knobs, BPM (raw), the three master
finalizers' float inputs, background controls + source inputs, all macros/
temperament, world (1-based index), and `seq/run`. **Not** streamed: `/opsia/audio/*`
and `/opsia/seq/skip`.

Behaviour: a diff loop on a `max(40, interval)` ms timer; a leaf is sent only when it
moves by ≥ `0.0015`; a first-pass burst cap (~97 leaves/tick) spreads the initial
sync over subsequent ticks; a full resend on (re)start.

### OSCQuery

An HTTP server on **OSC port + 1** (loopback only) serves a self-describing address
tree so Pandore / dataFLOU auto-bind every parameter. `?HOST_INFO` reports the OSC
port, UDP transport, and a WebSocket value-stream on the same HTTP port
(`LISTEN` / `IGNORE` per path; pushes `{FULL_PATH, VALUE}` frames while a client is
attached). Advertised leaves are typed `f` with `RANGE`, `VALUE` and `DESCRIPTION`.
The advertised tree covers the streamable set plus the audio sensors and `seq/skip`;
source/FX-unit inputs and scene/randomize triggers are **handled but not advertised**
(address them directly).

### Setup

| Thing | Default | Notes |
|---|---|---|
| Inbound OSC (UDP listen) | port **9000** | bound `0.0.0.0`; enable in the OSC panel |
| OSCQuery HTTP / WS | **9001** (OSC + 1) | `127.0.0.1` only |
| Outbound feedback | host `127.0.0.1`, port **9001** | enable + host/port/interval in the OSC panel |
| Outbound interval | **100 ms** | floor 40 ms |

Enabling the inbound listener starts the UDP receiver + OSCQuery server and returns
this machine's IPv4 addresses so you know where to point the controller. All OSC
config persists to `localStorage`.

---

## Stack

| Layer | Choice |
|---|---|
| Shell | Electron + electron-vite + TypeScript + React 18 + Tailwind + Zustand |
| Engine | WebGL2 + [`interactive-shader-format`](https://github.com/msfeldstein/interactive-shader-format-js) runtime; WebGPU compute is post-MVP |
| Control | `osc` (main) in/out + OSCQuery HTTP tree; Web MIDI in the renderer |
| Video | WebCodecs (HEVC decode/encode), `<video>` hardware decode; `ffmpeg-static` for recording delivery |
| Audio | Web Audio (local) + OSC audio bus |
| Output | Fullscreen HDMI · Spout (native DX11) · NDI (optional) · HIVE (HEVC/TCP + mDNS) |

## Architecture

```
src/
  main/       Electron main — OSC in/out, OSCQuery, output window, HIVE in/out,
              Spout/NDI senders (native addon via process.dlopen)
  preload/    contextBridge API surface (window.api)
  renderer/   React UI + the WebGL2 engine
    engine/   Compositor (per-layer ISF → blend → stack), modulation engine,
              audio bus, coupling, field macros + Proximity, macro-form sequencer,
              Video/Capture/Hive/Text/Parametric sources, native convolution nodes,
              output shaper, PBR
    shaders/  ISF .fs files + registry (curated ranges) + presets
  shared/     types shared across processes
native/spout/ N-API DX11 Spout sender addon (vendored Spout2 SDK)
```

The store holds one **single write path** — UI edits, session loads, OSC and MIDI all
reconcile into the engine through `syncFromState`, so nothing races.

---

## Aesthetic guardrails

The seed ISF library **is** the voice: glitch / datamosh / dither / chroma-shift /
feedback trails / posterize / displacement / scanlines, plus disciplined generative
fields. **No** kaleidoscope, plasma, Lissajous, or additive-glow-on-black. Near-black
canvas, one accent, glitch as controlled texture. New parameters are a fixed, curated
set — never an open-ended pile of knobs.

*Not a clip-launcher VJ app · not a node patcher · not a timeline compositor · not a
3D engine · not defined by analog-video-synth emulation · not cheap psychedelia.*

---

## Credits & license

Built by **Vincent Fillion** ([filliformes](https://github.com/filliformes)).
Vendors the [Spout2](https://github.com/leadedge/Spout2) SDK (BSD) for the native
sender; bundles [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static) for
recording delivery; PBR materials from [ambientCG](https://ambientcg.com) (CC0).
HIVE interop follows [gllm/HIVE](https://codeberg.org/gllm/HIVE). The
audiovisual-relations design draws on the Chion → Coulter → Basanta → Boucher/Piché
lineage on sound/image relations.

MIT — see [LICENSE](LICENSE).
