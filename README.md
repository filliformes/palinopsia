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

## What's inside

**A four-layer compositor.** Each layer has two source slots (A / B) with an
A↔B mixer, per-source FX racks, a per-layer FX rack, a blend mode into the stack,
and decay-feedback (ping-pong FBOs). Layers stack bottom→top; solo/mute per layer;
shader hot-swaps preserve feedback buffers (no reset-to-black mid-performance).

**67 ISF shaders.** ~23 generative sources (Drift Field, Slabs, Murmuration,
Mycelium, Erosion, Slit Scan, RGB Oscillators, Recurse, Sync Osc…) and ~44 rack
effects across Color · Stylize · Distortion · Blur · Glitch · Feedback · Texture ·
Scan · Utility. Each carries **curated aesthetic sub-ranges** so Randomize stays
on-brand. Physically-modelled Grain (film clumping / digital sensor noise /
CRT·VHS parasites). Includes **Wide Time** — a temporal-average / time-smear FX
(Jean Piché's AE "CC Wide Time" lineage) with motion-blur and frame-blend parity.

**A modulation brain.** An 8-modulator engine (LFO ×7 shapes · Ramp · ADSR · Arp ·
Random · S&H · Slew · Chaos), BPM-syncable, frame-locked in the renderer and
written straight to the compositor (never through React). A capped mod-matrix
feeds a **16-knob Meta Controller** — each knob shapes its own modulator via its
curve, drives up to 8 destinations, and learns a MIDI CC.

**Three always-on master finalizers.** Vibe Palette (colour mastering + 50
palettes) → Context (depth: trails, bloom, haze, 3D key light) → Finalizer
(levels, sharpen, grain). Bypassable, pinned, kept out of Randomize.

**Presets, scenes, Randomize.** ~626 per-shader presets · 50 master-chain presets ·
layer & mixer presets · a scene bank (save/recall full instrument states,
morph-crossfade between them, keys `1`–`9`) · structural scoped Randomize
(All / sources / FX / master / meta / finishing) with global Morph & Speed.

**Sources beyond synthesis.** Imported `<video>` with a transport/timeline
(play mode, speed 1/28×–128×, loop, playhead), webcam / screen / capture-device
Live Input, and **HIVE** live-in (HEVC-over-TCP via WebCodecs) — all treatable
through the source's own FX rack.

**Output & mapping.** A full-page Output view: projection warp / keystone +
alignment grid, a fullscreen output window on a second display (native
second-compositor, pixel-perfect), and network / texture senders — **Spout**
(native DX11 addon), **NDI** (optional), and **HIVE** output (the open
NDI-alternative: HEVC-over-TCP + mDNS, receive in OBS / Resolume).

**Control plane.** Inbound OSC listener + **OSCQuery** self-describing address
tree (so Pandore / dataFLOU auto-bind every parameter), plus Web MIDI CC.

---

## Controls

**OSC** (default port 9000, normalized `0..1` scaled to each target's range):

```
/opsia/layer/{1..4}/{opacity|speed|mix|trail|blend|mute|solo|feedback}
/opsia/layer/{n}/source/{A|B}[/{input} | /fx/{i}/{input}]
/opsia/layer/{n}/fx/{i}/{input}
/opsia/master/{fx/{i}|vibe|context}/{input}
/opsia/meta/{1..16}          /opsia/bpm
/opsia/scene/{n}             /opsia/randomize[/{scope}]
```

**Keyboard:** `1`–`9` recall scenes · `P`/`Shift+P` Vibe open/cycle ·
`C`/`Shift+C` Context open/cycle · `M` toggle Mixer view · `Ctrl+Z`/`Shift+Z`/`Y`
undo/redo (100 levels) · `Ctrl` `+`/`-`/`0` UI zoom.

**MIDI:** per-knob CC learn on the Meta Controller (Web MIDI).

---

## Stack

| Layer | Choice |
|---|---|
| Shell | Electron + electron-vite + TypeScript + React 18 + Tailwind + Zustand (forked from dataFLOU) |
| Engine | WebGL2 + [`interactive-shader-format`](https://github.com/msfeldstein/interactive-shader-format-js) runtime; WebGPU compute is post-MVP |
| Control | `osc` (main) in/out + OSCQuery HTTP tree; Web MIDI in the renderer |
| Video | WebCodecs (HEVC decode/encode), `<video>` hardware decode |
| Output | Fullscreen HDMI · Spout (native DX11) · NDI (optional) · HIVE (HEVC/TCP + mDNS) |
| Host | Gigabyte Aero 16, RTX 4070, Windows (portable to Mac M2) |

## Architecture

```
src/
  main/       Electron main — OSC in/out, OSCQuery, output window, HIVE in/out,
              Spout/NDI senders (native addon via process.dlopen)
  preload/    contextBridge API surface (window.api)
  renderer/   React UI + the WebGL2 engine
    engine/   Compositor (per-layer ISF → blend → stack), modulation engine,
              VideoSource, HiveSource
    shaders/  ISF .fs files + registry (curated ranges) + presets
  shared/     types shared across processes
native/spout/ N-API DX11 Spout sender addon (vendored Spout2 SDK)
```

The store holds one **single write path** — UI edits, session loads, OSC, and
MIDI all reconcile into the engine through `syncFromState`, so nothing races.

## Develop

```bash
npm install
npm run dev          # electron-vite dev
npm run typecheck    # tsc — node + web projects (both must be green)
npm run build:win    # NSIS + portable
npm run build:mac    # DMG
```

The native Spout addon (`native/spout/`) is optional and Windows-only; it's
rebuilt against the Electron ABI and loaded at runtime — the app runs fine
without it (the Spout toggle simply reports unavailable).

## Build phases

| # | Phase | Status |
|---|---|---|
| 0 | Scaffold — forked dataFLOU shell (design system, OSC, session/autosave) | ✅ |
| 1 | MVP — ISF runtime on a WebGL2 layer | ✅ |
| 2 | Compositor — 4 layers · blend modes · per-layer feedback | ✅ |
| 3 | FX racks — per-source / per-layer / master ISF chains + A/B mixer | ✅ |
| 4 | Auto-UI — Inspector renders ISF `INPUTS` as themed controls | ✅ |
| 5 | Modulators — 8-mod engine + 16-knob Meta Controller + mod-matrix | ✅ |
| 6 | Presets + Randomize — curated scopes · scene bank · morph | ✅ |
| 7 | Video + Live-in — video transport · capture · HIVE HEVC live-in | ✅ |
| 8 | Output — warp/keystone · 2nd-display window · Spout · NDI · HIVE out · OSCQuery | ✅ |
| 9 | WebGPU — compute passes for true pixel-sort / particles | ⬜ post-MVP |

**Next chapter — audiovisual reactivity.** An audio-reactive layer (Pandore-over-OSC
+ local Web Audio), a coupling engine binding the A/B pair, singular "World" modes,
and a generative macro-form sequencer — a research direction distilled from the
Chion → Coulter → Basanta → Boucher/Piché lineage on sound/image relations.

## Aesthetic guardrails

The seed ISF library **is** the voice: glitch / datamosh / dither / chroma-shift /
feedback trails / posterize / displacement / scanlines, plus disciplined generative
fields. **No** kaleidoscope, plasma, Lissajous, or additive-glow-on-black. Near-black
canvas, one accent, glitch as controlled texture. New parameters are a fixed, curated
set — never an open-ended pile of knobs.

*Not a clip-launcher VJ app · not a node patcher · not a timeline compositor · not a
3D engine · not defined by analog-video-synth emulation · not cheap psychedelia.*

## Credits & license

Built by **Vincent Fillion** ([filliformes](https://github.com/filliformes)).
Vendors the [Spout2](https://github.com/leadedge/Spout2) SDK (BSD) for the native
sender. HIVE interop follows [gllm/HIVE](https://codeberg.org/gllm/HIVE).
Wide Time after Jean Piché's AE "CC Wide Time."

MIT — see [LICENSE](LICENSE).
