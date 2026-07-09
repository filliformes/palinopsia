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

**~75 shaders + native nodes.** ~26 generative sources (Drift Field, Slabs,
Murmuration, Mycelium, Erosion, Slit Scan, RGB Oscillators, Recurse, Organic…) and
~47 rack effects across Color · Stylize · Distortion · Blur · Glitch · Feedback ·
Texture · Scan · Convolution · Utility. Each carries **curated aesthetic sub-ranges**
so Randomize stays on-brand. Physically-modelled Grain (film clumping / digital
sensor noise / CRT·VHS parasites), a rebuilt VHS **Tracking** and generation-loss
**Decay**, and **Wide Time** (Jean Piché's AE "CC Wide Time" lineage). Plus
**native nodes** — a header-only ISF gives the auto-UI while a TS class does the GL:
**Text** (50 fonts, sidechain glyph-fill), **Parametric** (the audio buffer as
raster / waveform / bars / spectrogram, Ikeda), **Transfert** (optical-flow motion
transfer), and **Motif** (spatial-counterpoint transpose echoes).

**A modulation brain.** An 8-modulator engine (LFO ×7 shapes · Ramp · ADSR · Arp ·
Random · S&H · Slew · Chaos · **Audio**-follower · **Organic** · **Physics** ·
**Motion**-archetype), BPM-syncable, frame-locked in the renderer and written
straight to the compositor (never through React). Modulation reaches **float, enum,
and bool** inputs, in **Multiply** (VCA-scale the base) or **Replace** (swing) mode.
A capped mod-matrix feeds a **16-knob Meta Controller** — each knob shapes its own
modulator via its curve, drives up to 8 destinations, and learns a MIDI CC.

**A Background slab.** A fifth "ground" beneath the four layers — its own curated
source + FX rack, a slow clock, a foreground contact-shadow **Depth**, blend/isolate
against the stack, and its own preset bank. Never touched by Randomize.

**Three always-on master finalizers.** Vibe Palette (colour mastering + 50
palettes) → Context (depth: trails, bloom, haze, 3D key light, **+ PBR texture
mapping** — project the whole composition onto a material) → Finalizer (levels,
sharpen, grain, **+ an output shaper**: clip the frame to any of 21 silhouettes with
a floating drop-shadow, filled by a colour or the Background). Bypassable, pinned,
kept out of Randomize.

**Presets, scenes, Randomize.** ~626 per-shader presets · 50 master-chain presets ·
layer & mixer presets · a scene bank (save/recall full instrument states,
morph-crossfade between them, keys `1`–`9`) · structural scoped Randomize
(All / sources / FX / master / meta / finishing) with global Morph & Speed.

**Sources beyond synthesis.** Imported `<video>` with a transport/timeline
(play mode, speed 1/28×–128×, loop, playhead), webcam / screen / capture-device
Live Input, and **HIVE** live-in (HEVC-over-TCP via WebCodecs) — all treatable
through the source's own FX rack.

**An audiovisual-relations layer.** Opsia *reads* audio rather than just pulsing to
it — a research direction distilled from the Chion → Coulter → Basanta →
Boucher/Piché lineage, made playable. A shared **audio bus** (local Web Audio / OSC);
an A↔B **coupling engine** (the synchresis catalogue as balance behaviours: lean ·
hocket · cut · gate · drift, with a tightness dial); global **World / diegesis**
presets that bias the whole composition; a **Proximity** depth-zone macro; and named
**field macros** — Density, Gesture⇄Texture, Coalesce.

**A generative macro-form sequencer.** An auto-pilot over the scene bank driven by
each scene's relation tags (**Diégèse · Synchrèse · Espace-temps · Climat**):
weighted / arc / shuffle selection with no-repeat, morph/cut transitions,
subtle no-exact-repeat variation; the **Breathe** (dense↔void) and **Climate-arc**
(repose–disturbance–repose) overlays; **cadence / rupture / monomedia** punctuation;
audio/chaos-armed deferred advance; and a Markdown **relation-score** export. A live
composition monitor and per-scene tag editor sit in its own page.

**Output & mapping.** A full-page Output view: projection warp / keystone +
alignment grid, a fullscreen output window on a second display (native
second-compositor, pixel-perfect), network / texture senders — **Spout** (native
DX11 addon), **NDI** (optional), and **HIVE** output (HEVC-over-TCP + mDNS) — a
realtime **resource HUD** (FPS · CPU · RAM · VRAM · GPU), and **recording** (a
hardware-H.264 master → ffmpeg delivery to MP4/H.265/ProRes/FFV1/uncompressed/VP9)
plus screenshots, into a `Recorded/` folder. Render resolution scales lo-fi↔4K.

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
`C`/`Shift+C` Context open/cycle · `W` World editor · `Q` Sequence page · `O`
Output view · `L`/`F` Layers/Finishing · `D`/`X`/`I` collapse panels · `R` fire
Randomize · `Ctrl+Z`/`Shift+Z`/`Y` undo/redo (100 levels) · `Ctrl` `+`/`-`/`0` (and
`Ctrl`+wheel) UI zoom.

**MIDI:** per-knob CC learn on the Meta Controller (Web MIDI).

---

## Stack

| Layer | Choice |
|---|---|
| Shell | Electron + electron-vite + TypeScript + React 18 + Tailwind + Zustand (forked from dataFLOU) |
| Engine | WebGL2 + [`interactive-shader-format`](https://github.com/msfeldstein/interactive-shader-format-js) runtime; WebGPU compute is post-MVP |
| Control | `osc` (main) in/out + OSCQuery HTTP tree; Web MIDI in the renderer |
| Video | WebCodecs (HEVC decode/encode), `<video>` hardware decode; `ffmpeg-static` for recording delivery |
| Audio | Web Audio (local) + OSC audio bus |
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
              audio bus, coupling, field macros + Proximity, macro-form sequencer,
              Video/Capture/Hive/Text/Parametric sources, output shaper, PBR
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
| 8 | Output — warp/keystone · 2nd-display window · Spout · NDI · HIVE out · OSCQuery · recording · HUD | ✅ |
| 9 | Audiovisual relations — audio bus · coupling engine · World modes · Proximity · field macros | ✅ |
| 10 | Macro-form — generative scene/relation sequencer (S1–S4) + relation-score export | ✅ |
| 11 | WebGPU — compute passes for true pixel-sort / particles | ⬜ post-MVP |

The **audiovisual-relations** work (phases 9–10) distils the Chion → Coulter →
Basanta → Boucher/Piché lineage on sound/image relations into playable structure —
see [`docs/opsia-sequencer-spec.md`](docs/opsia-sequencer-spec.md).

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
sender; bundles [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static) for
recording delivery; PBR materials from [ambientCG](https://ambientcg.com) (CC0).
HIVE interop follows [gllm/HIVE](https://codeberg.org/gllm/HIVE). Wide Time after
Jean Piché's AE "CC Wide Time." The audiovisual-relations design draws on Chion,
Coulter, Basanta, and Boucher/Piché.

MIT — see [LICENSE](LICENSE).
