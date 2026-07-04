# Palinopsia

> *palinopsia (n.): the persistence or recurrence of a visual image after the stimulus is gone.*

An **OSC-controlled ISF visual instrument** — the visual sibling to
[dataFLOU](https://github.com/filliformes/dataFLOU). A lightweight Electron +
WebGL2 four-layer compositor, **played** over OSC by Pandore rather than patched
like a tool. It composites four layers of shader-based synthesis and treated
video with blend modes, per-source / per-layer / master ISF effect racks, a
modulation brain, and a curated Randomize button.

The afterglow of a feedback compositor *is* palinopsia — the name is a
description, not a metaphor. It reads as glitchy, deep, digital-arts work —
**never cheap psychedelia, never a 3D game engine.**

## Stack

| Layer | Choice |
|---|---|
| Shell | Electron + electron-vite + TypeScript + React 18 + Tailwind + Zustand (forked from dataFLOU) |
| Engine | WebGL2 + `interactive-shader-format` (ISF runtime); WebGPU compute post-MVP |
| Control | `osc` (main process) in/out + OSCQuery self-describing space |
| Output | Fullscreen HDMI + Spout / Syphon / NDI + HIVE (all post-MVP) |
| Host | Gigabyte Aero 16, RTX 4070, Windows (portable to Mac M2) |

## Develop

```bash
npm install
npm run dev        # electron-vite dev
npm run typecheck  # tsc (node + web projects)
npm run build:win  # NSIS + portable
```

## Build phases

- **0 · Scaffold** ✅ — forked dataFLOU's Electron shell (design system, OSC,
  session/autosave), seed WebGL2 compositor wired to the output canvas.
- **1 · MVP** ✅ — ISF runtime wired; Drift Field seed generator fullscreen.
- **2 · Compositor** ✅ — 4 layers + blend modes + per-layer decay-feedback
  (ping-pong FBOs), solo/mute, hot-swap-safe shader loading; Slabs generator.
- **3 · FX racks** — per-source / per-layer / master ISF chains.
- **4 · Auto-UI** — controls generated from each shader's ISF `INPUTS`.
- **5 · Modulators** — port dataFLOU's 8-mod engine + Meta Controller + mod-matrix.
- **6 · Presets + Randomize** — scene bank + curated-range Randomize.
- **7 · Video + HIVE** — `<video>` → texture + synthify; HIVE WebCodecs live-in.
- **8 · Output** — in-shader warp/mapping + Spout/Syphon/NDI + OSCQuery.
- **9 · WebGPU** *(post-MVP)* — compute passes for true pixel-sort / particles.

## Aesthetic guardrails

The seed ISF library **is** the voice: glitch / datamosh / dither / chroma-shift
/ feedback trails / posterize / displacement / scanlines, plus disciplined
generative fields. **No** kaleidoscope, plasma, Lissajous, or additive-glow-on-
black. Near-black canvas, one accent, glitch as controlled texture. Randomize
draws from curated aesthetic sub-ranges, not raw shader min/max.

---
*Not a clip-launcher VJ app · not a node patcher · not a timeline compositor ·
not a 3D engine · not analog-video-synth emulation · not cheap psychedelia.*
