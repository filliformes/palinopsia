// ISF shader registry. Sources are imported as raw strings (Vite `?raw`) so
// the ISF runtime can parse each one's JSON header + GLSL at load time. This
// curated seed set IS the instrument's voice (brief §1, §5): glitch /
// generative / digital-arts — never kaleidoscope, plasma, or audio-bloom.
//
// `curated` is each shader's AESTHETIC sub-range per input — what Randomize
// draws from (brief §7). Declared MIN/MAX is the legal range; curated is the
// tasteful one. This table is where the instrument's taste lives: it keeps
// randomization in the glitch register and out of kaleidoscope soup.

import driftField from './DriftField.fs?raw'
import organic from './Organic.fs?raw'
import { TEXT_FONTS } from '../../textFonts'
import slabs from './Slabs.fs?raw'
import contour from './Contour.fs?raw'
import gridDrift from './GridDrift.fs?raw'
import particleDrift from './ParticleDrift.fs?raw'
import interference from './Interference.fs?raw'
import columnScan from './ColumnScan.fs?raw'
import ash from './Ash.fs?raw'
import murmuration from './Murmuration.fs?raw'
import filaments from './Filaments.fs?raw'
import erosion from './Erosion.fs?raw'
import membrane from './Membrane.fs?raw'
import mycelium from './Mycelium.fs?raw'
import swell from './Swell.fs?raw'
import congeal from './Congeal.fs?raw'
import slitScan from './SlitScan.fs?raw'
import ramps from './Ramps.fs?raw'
import rgbOsc from './RgbOsc.fs?raw'
import recurse from './Recurse.fs?raw'
import shapes from './Shapes.fs?raw'
import syncOsc from './SyncOsc.fs?raw'
import differential from './Differential.fs?raw'
import solidColor from './SolidColor.fs?raw'
import posterize from './fx/Posterize.fs?raw'
import dither from './fx/Dither.fs?raw'
import chromaShift from './fx/ChromaShift.fs?raw'
import pixelate from './fx/Pixelate.fs?raw'
import displace from './fx/Displace.fs?raw'
import scanlines from './fx/Scanlines.fs?raw'
import edge from './fx/Edge.fs?raw'
import grade from './fx/Grade.fs?raw'
import sliceShuffle from './fx/SliceShuffle.fs?raw'
import smear from './fx/Smear.fs?raw'
import palette from './fx/Palette.fs?raw'
import threshold from './fx/Threshold.fs?raw'
import solarize from './fx/Solarize.fs?raw'
import moshBlocks from './fx/MoshBlocks.fs?raw'
import grain from './fx/Grain.fs?raw'
import streak from './fx/Streak.fs?raw'
import sharpen from './fx/Sharpen.fs?raw'
import fold from './fx/Fold.fs?raw'
import transform from './fx/Transform.fs?raw'
import stutter from './fx/Stutter.fs?raw'
import slitBuffer from './fx/SlitBuffer.fs?raw'
import differenceBloom from './fx/DifferenceBloom.fs?raw'
import triangleFlicker from './fx/TriangleFlicker.fs?raw'
import colorizer from './fx/Colorizer.fs?raw'
import wavefold from './fx/Wavefold.fs?raw'
import rutt from './fx/Rutt.fs?raw'
import crtScreen from './fx/CrtScreen.fs?raw'
import pixelmask from './fx/Pixelmask.fs?raw'
import lightTrails from './fx/LightTrails.fs?raw'
import wideTime from './fx/WideTime.fs?raw'
import hueRotate from './fx/HueRotate.fs?raw'
import rgbShift from './fx/RgbShift.fs?raw'
import granular from './fx/Granular.fs?raw'
import mosaic from './fx/Mosaic.fs?raw'
import syncLoss from './fx/SyncLoss.fs?raw'
import rowEcho from './fx/RowEcho.fs?raw'
import byteCorrupt from './fx/ByteCorrupt.fs?raw'
import ringing from './fx/Ringing.fs?raw'
import tracking from './fx/Tracking.fs?raw'
import motif from './fx/Motif.fs?raw'
import decay from './fx/Decay.fs?raw'
import abstraction from './fx/Abstraction.fs?raw'
import feedbackZoom from './fx/FeedbackZoom.fs?raw'
import distort from './fx/Distort.fs?raw'
import vibe from './fx/Vibe.fs?raw'
import context from './fx/Context.fs?raw'
import finalizer from './fx/Finalizer.fs?raw'

export interface IsfShader {
  id: string
  name: string
  category: 'Generator' | 'FX'
  source: string
  /** Randomize's aesthetic sub-range per float input (tighter than MIN/MAX). */
  curated?: Record<string, [number, number]>
  /** Native convolution node (`node-*`): run by a TS class, not the ISF runtime.
   *  `source` is a header-only stub so the auto-UI/presets/randomize still parse
   *  its INPUTS. Excluded from the Randomize FX pool (needs a sidechain). */
  native?: boolean
}

// ── Native convolution nodes (visual-convolution spec) ──────────────────
// Registered like shaders (header-only source ⇒ auto-UI + modulation + presets +
// randomize) but the engine runs a TS class and hands it a sidechain texture.
// Kept OUT of FX_SHADERS (the Randomize pool) — added to the picker + lookups.
export const NATIVE_NODES: IsfShader[] = [
  {
    id: 'node-transfert',
    name: 'Transfert',
    category: 'FX',
    native: true,
    source: `/*{
      "DESCRIPTION": "Transfert — imprint another layer's MOVEMENT onto this one (optical-flow transfer). Déplacement warps by the sidechain's flow; Traînée is a flow-steered line blur (motion blur painted by another layer's gesture). Pick the sidechain in the Inspector.",
      "CATEGORIES": ["FX", "Convolution"],
      "INPUTS": [
        { "NAME": "mode", "TYPE": "long", "VALUES": [0,1], "LABELS": ["deplacement","trainee"], "DEFAULT": 0, "LABEL": "mode" },
        { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.35, "LABEL": "amount" },
        { "NAME": "inertie", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6, "LABEL": "inertie" },
        { "NAME": "flowScale", "TYPE": "float", "MIN": 0.25, "MAX": 4.0, "DEFAULT": 1.0, "LABEL": "flow scale" },
        { "NAME": "flowBlur", "TYPE": "float", "MIN": 0.0, "MAX": 24.0, "DEFAULT": 8.0, "LABEL": "flow blur" },
        { "NAME": "magnitudeGamma", "TYPE": "float", "MIN": 0.25, "MAX": 4.0, "DEFAULT": 1.0, "LABEL": "mag gamma" },
        { "NAME": "channelSpread", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "chroma pull" },
        { "NAME": "taps", "TYPE": "float", "MIN": 2.0, "MAX": 24.0, "DEFAULT": 12.0, "LABEL": "taps" },
        { "NAME": "falloff", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "falloff" },
        { "NAME": "invert", "TYPE": "bool", "DEFAULT": false, "LABEL": "invert", "COMPACT": true },
        { "NAME": "bidirectional", "TYPE": "bool", "DEFAULT": true, "LABEL": "bidir", "COMPACT": true },
        { "NAME": "flowRes", "TYPE": "long", "VALUES": [0,1,2], "LABELS": ["128","256","512"], "DEFAULT": 1, "LABEL": "flow res", "COMPACT": true }
      ]
    }*/`,
    curated: {
      amount: [0.15, 0.6],
      inertie: [0.3, 0.85],
      flowScale: [0.6, 2.0],
      flowBlur: [4, 14],
      magnitudeGamma: [0.6, 1.6],
      channelSpread: [0, 0.4],
      taps: [8, 18],
      falloff: [0.2, 0.8]
    }
  },
  {
    // Module 1 — Convolution (ConvolveSpatial). The sidechain frame is the
    // KERNEL (point-spread function): every host pixel stamps a scaled copy of
    // it — transfers glare shape / texture / energy. Native (engine/convNodes).
    id: 'node-convolve',
    name: 'Convolution',
    category: 'FX',
    native: true,
    source: `/*{
      "DESCRIPTION": "Convolution — treat another layer as a convolution kernel (impulse response). Every bright pixel of this layer stamps a scaled copy of the sidechain's shape, transferring its glare / texture / energy signature (UE convolution-bloom, run forward). Pick the kernel layer in the Inspector. Direct kernel path; a live sidechain = an animated impulse response.",
      "CATEGORIES": ["FX", "Convolution"],
      "INPUTS": [
        { "NAME": "scale", "TYPE": "float", "MIN": 0.05, "MAX": 2.0, "DEFAULT": 0.8, "LABEL": "spread" },
        { "NAME": "taps", "TYPE": "float", "MIN": 3.0, "MAX": 12.0, "DEFAULT": 7.0, "LABEL": "kernel res" },
        { "NAME": "threshold", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.1, "LABEL": "kernel thresh" },
        { "NAME": "kernelGamma", "TYPE": "float", "MIN": 0.25, "MAX": 4.0, "DEFAULT": 1.0, "LABEL": "kernel gamma" },
        { "NAME": "boost", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "highlight gate" },
        { "NAME": "gain", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "wet gain" },
        { "NAME": "mix", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6, "LABEL": "mix" },
        { "NAME": "additive", "TYPE": "bool", "DEFAULT": false, "LABEL": "additive", "COMPACT": true }
      ]
    }*/`,
    curated: {
      scale: [0.3, 1.2], taps: [5, 10], threshold: [0.05, 0.4], kernelGamma: [0.6, 2.0],
      boost: [0, 0.6], gain: [0.6, 1.8], mix: [0.4, 0.9]
    }
  },
  {
    // Module 3 — Réponse (temporal frame-echo convolution). Convolves the host
    // layer's OWN recent time-history against a shaped envelope — rhythmic
    // pulsing trails / temporal smear. Native (engine/convNodes). No sidechain.
    id: 'node-reponse',
    name: 'Réponse',
    category: 'FX',
    native: true,
    source: `/*{
      "DESCRIPTION": "Réponse — temporal convolution: this layer's last 16 frames summed through a shaped envelope (attack onset × decay tail, reversible). Trails that pulse with a captured rhythm — a convolution-reverb for image. Uses the layer's own history (no sidechain).",
      "CATEGORIES": ["FX", "Feedback", "Convolution"],
      "INPUTS": [
        { "NAME": "length", "TYPE": "float", "MIN": 2.0, "MAX": 16.0, "DEFAULT": 10.0, "LABEL": "length" },
        { "NAME": "decay", "TYPE": "float", "MIN": 0.05, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "decay" },
        { "NAME": "attack", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.1, "LABEL": "attack" },
        { "NAME": "gain", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "gain" },
        { "NAME": "reverse", "TYPE": "bool", "DEFAULT": false, "LABEL": "reverse", "COMPACT": true },
        { "NAME": "mix", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6, "LABEL": "mix" }
      ]
    }*/`,
    curated: {
      length: [6, 16], decay: [0.2, 0.9], attack: [0, 0.4], gain: [0.6, 1.4], mix: [0.4, 0.9]
    }
  }
]

export const GENERATORS: IsfShader[] = [
  {
    id: 'drift-field',
    name: 'Drift Field',
    category: 'Generator',
    source: driftField,
    curated: {
      rate: [0.05, 0.4],
      scale: [1.2, 5],
      warp: [0.2, 1.0],
      steps: [3, 9],
      contrast: [0.9, 1.6],
      split: [0, 0.5]
    }
  },
  {
    id: 'slabs',
    name: 'Slabs',
    category: 'Generator',
    source: slabs,
    curated: {
      rate: [0.1, 0.6],
      bands: [8, 48],
      density: [0.15, 0.6],
      jitter: [0.1, 0.7],
      drift: [0, 0.6],
      accent: [0, 0.5],
      chaos: [0, 0.6]
    }
  },
  {
    id: 'contour',
    name: 'Contour',
    category: 'Generator',
    source: contour,
    curated: {
      rate: [0.03, 0.3],
      scale: [1, 5],
      levels: [5, 20],
      width: [0.05, 0.3],
      warp: [0.15, 1.1],
      fill: [0, 0.5]
    }
  },
  {
    id: 'grid-drift',
    name: 'Grid Drift',
    category: 'Generator',
    source: gridDrift,
    curated: {
      cells: [5, 24],
      rate: [0.05, 0.4],
      breathe: [0.1, 0.7],
      slip: [0.05, 0.6],
      lineW: [0.02, 0.12],
      density: [0, 0.35]
    }
  },
  {
    id: 'particle-drift',
    name: 'Particle Drift',
    category: 'Generator',
    source: particleDrift,
    curated: {
      count: [6, 28],
      speed: [0.1, 1.2],
      flow: [0, 6.2832],
      size: [0.04, 0.2],
      trail: [0.1, 1.6],
      jitter: [0.2, 0.9],
      vary: [0.3, 0.9]
    }
  },
  {
    id: 'interference',
    name: 'Interference',
    category: 'Generator',
    source: interference,
    // detune + skew stay small — big values tip into op-art vibration.
    curated: {
      freq: [15, 80],
      detune: [0.005, 0.08],
      angle: [0, 6.2832],
      skew: [0.03, 0.4],
      rate: [0.03, 0.4],
      contrast: [0.9, 2.2]
    }
  },
  {
    id: 'column-scan',
    name: 'Column Scan',
    category: 'Generator',
    source: columnScan,
    curated: {
      lines: [20, 80],
      amp: [0.015, 0.1],
      scale: [1, 5],
      rate: [0.05, 0.5],
      width: [0.06, 0.35]
    }
  },
  {
    id: 'ash',
    name: 'Ash',
    category: 'Generator',
    source: ash,
    curated: {
      count: [10, 45],
      speed: [0.05, 0.8],
      physics: [0, 0.85],
      size: [0.04, 0.2],
      wander: [0.15, 0.8],
      flicker: [0.1, 0.7],
      accent: [0.05, 0.6]
    }
  },
  {
    id: 'murmuration',
    name: 'Murmuration',
    category: 'Generator',
    source: murmuration,
    curated: { count: [14, 45], speed: [0.2, 1.5], cohesion: [0.4, 0.95], size: [0.04, 0.15], stretch: [0.2, 1.1] }
  },
  {
    id: 'filaments',
    name: 'Filaments',
    category: 'Generator',
    source: filaments,
    curated: { strands: [6, 28], rate: [0.1, 1], sway: [0.2, 0.8], width: [0.08, 0.4], lean: [-0.5, 0.5] }
  },
  {
    id: 'erosion',
    name: 'Erosion',
    category: 'Generator',
    source: erosion,
    curated: { rate: [0.05, 1], scale: [1.5, 5], streaks: [2, 9], carve: [0.3, 0.9], sediment: [0.15, 0.6] }
  },
  {
    id: 'membrane',
    name: 'Membrane',
    category: 'Generator',
    source: membrane,
    curated: { rate: [0.05, 0.6], mass: [0.3, 0.65], warp: [0.3, 1.2], softness: [0.04, 0.3], veins: [0.1, 0.7] }
  },
  {
    id: 'mycelium',
    name: 'Mycelium',
    category: 'Generator',
    source: mycelium,
    curated: { rate: [0.1, 0.8], scale: [2.5, 8], width: [0.06, 0.3], density: [0.3, 0.85], front: [0.15, 0.7] }
  },
  {
    id: 'swell',
    name: 'Swell',
    category: 'Generator',
    source: swell,
    curated: { rate: [0.1, 1.2], scale: [2, 8], chop: [0.15, 0.8], direction: [0, 6.2832], spread: [0.15, 0.7] }
  },
  {
    id: 'congeal',
    name: 'Congeal',
    category: 'Generator',
    source: congeal,
    curated: { rate: [0.15, 1.2], decay: [0.9, 0.99], warp: [0.15, 0.8], seed: [0.15, 0.6], scale: [1, 5] }
  },
  {
    id: 'slit-scan',
    name: 'Slit Scan',
    category: 'Generator',
    source: slitScan,
    curated: { rate: [0.2, 1.5], span: [3, 20], freq: [3, 20], bands: [3, 14] }
  },
  {
    id: 'ramps',
    name: 'Ramps',
    category: 'Generator',
    source: ramps,
    curated: { freq: [1, 6], steps: [1, 16], rate: [0, 1], angle: [0, 6.2832] }
  },
  {
    id: 'rgb-osc',
    name: 'RGB Oscillators',
    category: 'Generator',
    source: rgbOsc,
    curated: { freq: [2, 20], spread: [0.05, 0.6], symmetry: [0, 1], angle: [0, 6.2832], rate: [0.05, 1.5], level: [0.5, 0.95] }
  },
  {
    id: 'recurse',
    name: 'Recurse',
    category: 'Generator',
    source: recurse,
    curated: { iterations: [4, 9], scale: [0.68, 0.9], angle: [0.1, 0.9], drift: [0.05, 0.35], width: [0.02, 0.12], rate: [0.05, 1] }
  },
  {
    id: 'shapes',
    name: 'Shapes',
    category: 'Generator',
    source: shapes,
    curated: { count: [1, 12], size: [0.2, 0.85], soft: [0.02, 0.3], rate: [0.05, 1.2] }
  },
  {
    id: 'sync-osc',
    name: 'Sync Osc',
    category: 'Generator',
    source: syncOsc,
    curated: { freq: [3, 40], shape: [0, 1], sync: [0, 1], rate: [0.05, 1.5], angle: [0, 6.2832] }
  },
  {
    id: 'differential',
    name: 'Differential',
    category: 'Generator',
    source: differential,
    curated: {
      count: [2, 6],
      ratio: [1.5, 3],
      rate: [0.1, 2],
      freq: [1.5, 8],
      thickness: [0.05, 0.3],
      lines: [3, 12],
      skew: [0.1, 0.7],
      angle: [0, 6.2832]
    }
  },
  {
    id: 'solid-color',
    name: 'Solid Color',
    category: 'Generator',
    source: solidColor,
    curated: { gradient: [0, 1], angle: [0, 6.2832], midpoint: [0.3, 0.7], dither: [0.3, 0.7] }
  },
  {
    id: 'organic',
    name: 'Organic',
    category: 'Generator',
    source: organic,
    curated: {
      rate: [0.15, 1.1],
      scale: [1.2, 5],
      detail: [0.3, 0.9],
      flow: [0.25, 0.85],
      vary: [0, 0.7],
      contrast: [0.8, 1.5]
    }
  },
  {
    // Native Text generator (TextSource.ts) — typography as a source, glyphs
    // fillable by a sidechain layer (the convolution move). Header-only source:
    // the auto-UI/presets parse INPUTS; the engine runs the TS class. Font
    // VALUES/LABELS order must match TEXT_FONTS in engine/TextSource.ts.
    id: 'gen-text',
    name: 'Text',
    category: 'Generator',
    native: true,
    // Header generated from TEXT_FONTS so the picker always matches the
    // registry (and the bundled @font-face set) — one source of truth.
    source: `/*${JSON.stringify({
      DESCRIPTION:
        "Text — typography as a source. Type in the Inspector; pick a font, size, weight and letter-spacing; place it with angle/position. A sidechain layer can FILL the glyphs (the letters become a matte over that layer's texture) — no sidechain = solid colour.",
      CATEGORIES: ['Generator'],
      INPUTS: [
        { NAME: 'font', TYPE: 'long', VALUES: TEXT_FONTS.map((_, i) => i), LABELS: TEXT_FONTS, DEFAULT: 1, LABEL: 'font' },
        { NAME: 'size', TYPE: 'float', MIN: 0.02, MAX: 1.0, DEFAULT: 0.25, LABEL: 'size' },
        { NAME: 'weight', TYPE: 'float', MIN: 100.0, MAX: 900.0, DEFAULT: 700.0, LABEL: 'weight' },
        { NAME: 'spacing', TYPE: 'float', MIN: -0.15, MAX: 0.8, DEFAULT: 0.0, LABEL: 'spacing' },
        { NAME: 'stretch', TYPE: 'float', MIN: 0.25, MAX: 4.0, DEFAULT: 1.0, LABEL: 'v stretch' },
        { NAME: 'angle', TYPE: 'float', MIN: -3.1416, MAX: 3.1416, DEFAULT: 0.0, LABEL: 'angle' },
        { NAME: 'posX', TYPE: 'float', MIN: -1.0, MAX: 1.0, DEFAULT: 0.0, LABEL: 'pos x' },
        { NAME: 'posY', TYPE: 'float', MIN: -1.0, MAX: 1.0, DEFAULT: 0.0, LABEL: 'pos y' },
        { NAME: 'color', TYPE: 'color', DEFAULT: [1.0, 1.0, 1.0, 1.0] }
      ]
    })}*/`,
    curated: {
      size: [0.1, 0.5],
      weight: [300, 900],
      spacing: [0, 0.3],
      stretch: [0.7, 2.2],
      angle: [-0.6, 0.6],
      posX: [-0.4, 0.4],
      posY: [-0.4, 0.4]
    }
  },
  {
    // Parametric — the audio-buffer→texture generator (Boucher/Piché Parametric
    // diegesis; Ikeda Test Pattern). NATIVE (engine/ParametricSource.ts). Reads
    // the LOCAL audio bus's spectrum/waveform; a procedural signal when silent.
    id: 'gen-parametric',
    name: 'Parametric',
    category: 'Generator',
    native: true,
    source: `/*${JSON.stringify({
      DESCRIPTION:
        'Parametric — a literal audio→image reading (Ikeda test-pattern). Renders the LOCAL audio bus as a hard raster, a waveform trace, spectrum bars, or a scrolling spectrogram. Needs Audio ingest ON (local) to read real sound; otherwise a procedural test signal. Abstract by design — a raster/waveform/spectrogram, never an oscilloscope.',
      CATEGORIES: ['Generator'],
      INPUTS: [
        { NAME: 'mode', TYPE: 'long', VALUES: [0, 1, 2, 3], LABELS: ['raster', 'waveform', 'bars', 'spectrogram'], DEFAULT: 0, LABEL: 'mode' },
        { NAME: 'gain', TYPE: 'float', MIN: 0.0, MAX: 4.0, DEFAULT: 1.2, LABEL: 'gain' },
        { NAME: 'scale', TYPE: 'float', MIN: 0.0, MAX: 1.0, DEFAULT: 0.4, LABEL: 'scale' },
        { NAME: 'scan', TYPE: 'float', MIN: 0.0, MAX: 1.0, DEFAULT: 0.3, LABEL: 'scan' },
        { NAME: 'mono', TYPE: 'bool', DEFAULT: true, LABEL: 'mono' },
        { NAME: 'color', TYPE: 'color', DEFAULT: [0.6, 0.85, 1.0, 1.0] }
      ]
    })}*/`,
    curated: { gain: [0.6, 2.0], scale: [0.1, 0.8], scan: [0.1, 0.7] }
  }
]

// The glitch/digital-arts FX vocabulary (brief §5).
export const FX_SHADERS: IsfShader[] = [
  {
    id: 'fx-posterize', name: 'Posterize', category: 'FX', source: posterize,
    curated: { levels: [3, 10], gamma: [0.8, 1.4] }
  },
  {
    id: 'fx-dither', name: 'Dither', category: 'FX', source: dither,
    curated: { levels: [2, 5], scale: [1, 4], amount: [0.6, 1] }
  },
  {
    id: 'fx-chroma-shift', name: 'Chroma Shift', category: 'FX', source: chromaShift,
    curated: { amount: [0.002, 0.02], angle: [0, 6.2832] }
  },
  {
    id: 'fx-pixelate', name: 'Pixelate', category: 'FX', source: pixelate,
    curated: { cells: [40, 240] }
  },
  {
    id: 'fx-displace', name: 'Displace', category: 'FX', source: displace,
    curated: { amount: [0.01, 0.08], scale: [1.5, 8], rate: [0.05, 0.5] }
  },
  {
    id: 'fx-scanlines', name: 'Scanlines', category: 'FX', source: scanlines,
    curated: { count: [200, 900], darkness: [0.1, 0.5], roll: [0, 0.3] }
  },
  {
    id: 'fx-edge', name: 'Edge', category: 'FX', source: edge,
    curated: { gain: [1, 3], blend: [0.3, 1] }
  },
  {
    id: 'fx-grade', name: 'Grade', category: 'FX', source: grade,
    curated: { brightness: [-0.15, 0.15], contrast: [0.8, 1.6], saturation: [0.3, 1.3], lift: [0, 0.08] }
  },
  {
    id: 'fx-slice-shuffle', name: 'Slice Shuffle', category: 'FX', source: sliceShuffle,
    curated: { slices: [8, 64], amount: [0.02, 0.25], chance: [0.1, 0.5], rate: [0.1, 0.7] }
  },
  {
    id: 'fx-smear', name: 'Smear', category: 'FX', source: smear,
    curated: { reach: [0.02, 0.2], threshold: [0.25, 0.7], angle: [0, 6.2832] }
  },
  {
    id: 'fx-palette', name: 'Palette', category: 'FX', source: palette,
    curated: { stops: [2, 5], blend: [0, 1], dither: [0, 0.6], mixSrc: [0, 0.4] }
  },
  {
    id: 'fx-threshold', name: 'Threshold', category: 'FX', source: threshold,
    // Curated level sits LOW: the seed generators live near black, and a
    // mid threshold gates them entirely to black (the Randomize-black bug).
    curated: { level: [0.08, 0.35], soft: [0.05, 0.3] }
  },
  {
    id: 'fx-solarize', name: 'Solarize', category: 'FX', source: solarize,
    curated: { level: [0.4, 0.8], strength: [0.5, 1] }
  },
  {
    id: 'fx-mosh-blocks', name: 'Mosh Blocks', category: 'FX', source: moshBlocks,
    curated: { blocks: [10, 48], amount: [0.05, 0.3], chance: [0.1, 0.5], rate: [0.1, 0.8], freak: [0, 0.5] }
  },
  {
    id: 'fx-grain', name: 'Grain', category: 'FX', source: grain,
    curated: { amount: [0.05, 0.35], size: [1, 3], chroma: [0, 0.6], parasites: [0.05, 0.5] }
  },
  {
    id: 'fx-streak', name: 'Streak', category: 'FX', source: streak,
    curated: { reach: [0.02, 0.15], angle: [0, 6.2832] }
  },
  {
    id: 'fx-sharpen', name: 'Sharpen', category: 'FX', source: sharpen,
    curated: { amount: [0.3, 2] }
  },
  {
    id: 'fx-fold', name: 'Fold', category: 'FX', source: fold,
    // Seam kept off-centre — a centred fold is the symmetry the brief refuses.
    curated: { seam: [0.55, 0.8], offset: [-0.3, 0.3] }
  },
  {
    id: 'fx-transform', name: 'Transform', category: 'FX', source: transform,
    curated: { zoom: [0.7, 1.6], posX: [-0.3, 0.3], posY: [-0.3, 0.3], rotate: [-0.6, 0.6], shape: [0, 0] }
  },
  {
    id: 'fx-stutter', name: 'Stutter', category: 'FX', source: stutter,
    curated: { rate: [2, 12], chance: [0.2, 0.7], bands: [1, 12], jitter: [0, 0.8], blackout: [0, 0.5] }
  },
  {
    id: 'fx-sync-loss', name: 'Sync Loss', category: 'FX', source: syncLoss,
    curated: { roll: [0.05, 0.8], tear: [0.02, 0.25], bands: [2, 8], rate: [0.1, 0.7] }
  },
  {
    id: 'fx-row-echo', name: 'Row Echo', category: 'FX', source: rowEcho,
    curated: { rows: [20, 140], chance: [0.1, 0.6], fade: [0.1, 0.8], rate: [0.1, 0.7] }
  },
  {
    id: 'fx-byte-corrupt', name: 'Byte Corrupt', category: 'FX', source: byteCorrupt,
    curated: { depth: [3, 10], scramble: [0.15, 0.7], blocks: [4, 32], warpByte: [0, 0.6], rate: [0.1, 0.7], chaos: [0, 0.6] }
  },
  {
    id: 'fx-ringing', name: 'Ringing', category: 'FX', source: ringing,
    curated: { gap: [0.003, 0.02], intensity: [0.3, 1.3], angle: [0, 6.2832] }
  },
  {
    id: 'fx-tracking', name: 'Tracking', category: 'FX', source: tracking,
    curated: {
      band: [0.05, 0.25], position: [0, 1], roll: [0, 0.6], wobble: [0.01, 0.1],
      noise: [0.2, 0.8], rate: [0.2, 0.8], freeze: [0, 0.6], distort: [0, 0.4],
      bleed: [0, 0.5], bleedRange: [0.4, 1.4]
    }
  },
  {
    id: 'fx-motif', name: 'Motif', category: 'FX', source: motif,
    curated: {
      offX: [-0.3, 0.3], offY: [-0.25, 0.25], rotate: [-1.2, 1.2],
      scale: [0.75, 1.15], fade: [0.4, 0.8]
    }
  },
  {
    id: 'fx-feedback-zoom', name: 'Feedback Zoom', category: 'FX', source: feedbackZoom,
    curated: { zoom: [0.95, 1.08], twist: [-0.08, 0.08], amount: [0.35, 0.85] }
  },
  {
    id: 'fx-distort', name: 'Distort', category: 'FX', source: distort,
    curated: { amount: [0.1, 0.6], scale: [1, 12], angle: [0, 6.2832], rate: [0.1, 2] }
  },
  {
    id: 'fx-slit-buffer', name: 'Slit Buffer', category: 'FX', source: slitBuffer,
    curated: { rate: [0.05, 1], width: [0.01, 0.1], jitter: [0, 0.7], jumps: [0, 0.6], direction: [0, 2] }
  },
  {
    id: 'fx-difference-bloom', name: 'Difference Bloom', category: 'FX', source: differenceBloom,
    curated: { gain: [1.5, 6], spread: [0.004, 0.03], keep: [0, 0.4] }
  },
  {
    id: 'fx-triangle-flicker', name: 'Triangle Flicker', category: 'FX', source: triangleFlicker,
    curated: { rate: [1, 12], depth: [0.2, 0.9], hard: [0, 1], swap: [0, 0.6] }
  },
  {
    id: 'fx-colorizer', name: 'Colorizer', category: 'FX', source: colorizer,
    curated: { gain: [0.5, 2.5], bias: [-0.4, 0.4], fold: [0, 0.6], mixSrc: [0.15, 0.4] }
  },
  {
    id: 'fx-wavefold', name: 'Wavefold', category: 'FX', source: wavefold,
    curated: { fold: [0.1, 0.8], bias: [-0.3, 0.3], symmetry: [0, 1], wet: [0.4, 1] }
  },
  {
    id: 'fx-rutt', name: 'Rutt', category: 'FX', source: rutt,
    curated: { lines: [40, 160], amp: [0.03, 0.2], width: [0.08, 0.4], color: [0, 1] }
  },
  {
    id: 'fx-crt-screen', name: 'CRT Screen', category: 'FX', source: crtScreen,
    curated: { curve: [0.05, 0.4], aberration: [0.002, 0.02], scanline: [0.1, 0.5], vignette: [0.15, 0.7], corner: [0.02, 0.12] }
  },
  {
    id: 'fx-pixelmask', name: 'Pixelmask', category: 'FX', source: pixelmask,
    curated: { scale: [1.5, 8], amount: [0.3, 0.9] }
  },
  {
    id: 'fx-light-trails', name: 'Light Trails', category: 'FX', source: lightTrails,
    curated: { decay: [0.9, 0.99], drift: [0, 0.012], angle: [0, 6.2832] }
  },
  {
    id: 'fx-decay', name: 'Decay', category: 'FX', source: decay,
    curated: { amount: [0.3, 0.8], smear: [0.1, 0.55], chroma: [0.2, 0.75], blocks: [0.1, 0.6], dropout: [0, 0.4], jitter: [0.1, 0.6] }
  },
  {
    id: 'fx-abstraction', name: 'Abstraction', category: 'FX', source: abstraction,
    curated: { amount: [0.25, 0.85], disperse: [0.3, 0.9], posterize: [0.2, 0.8], desat: [0.2, 0.8] }
  },
  {
    id: 'fx-wide-time', name: 'Wide Time', category: 'FX', source: wideTime,
    curated: {
      width: [12, 140], amount: [0.6, 1], mode: [0, 1],
      soften: [0, 0.4], drift: [-0.006, 0.006], hue: [-0.03, 0.03]
    }
  },
  {
    id: 'fx-hue-rotate', name: 'Hue Rotate', category: 'FX', source: hueRotate,
    curated: { shift: [0, 1], byLuma: [-0.6, 0.6] }
  },
  {
    id: 'fx-rgb-shift', name: 'RGB Shift', category: 'FX', source: rgbShift,
    curated: { offset: [0.003, 0.04], scale: [0, 0.06], angle: [0, 6.2832], wobble: [0, 0.7] }
  },
  {
    id: 'fx-granular', name: 'Granular', category: 'FX', source: granular,
    curated: { grain: [0.2, 0.8], density: [0.5, 1], scatter: [0, 0.5], rotate: [0, 0.5], smear: [0, 0.6], rate: [0.1, 3] }
  },
  {
    id: 'fx-mosaic', name: 'Mosaic', category: 'FX', source: mosaic,
    curated: { grid: [0.2, 0.7], size: [0.5, 1], lumaSize: [0.2, 0.9], soft: [0.02, 0.2], shape: [0, 3], gapMix: [0, 0.4] }
  }
  // PHASE 9 (post-MVP experiment): Cross-FM — a source that takes ANOTHER
  // layer's frame as a video-rate FM input (Lumen A→B→C→A cross-oscillator
  // feedback). Needs engine plumbing (a second image input bound to a layer
  // buffer), so it waits with WebGPU (brief §15.1). Not built here.
]

// The Vibe mastering stage — pinned to the master rack's end (store-locked),
// deliberately NOT in FX_SHADERS so racks and Randomize can't add a second.
export const VIBE_SHADER: IsfShader = {
  id: 'fx-vibe',
  name: 'Vibe Palette',
  category: 'FX',
  source: vibe
}

// The Context depth finalizer — pinned AFTER Vibe, also store-locked and kept
// out of FX_SHADERS. Curated ranges keep the Inspector dice tasteful.
export const CONTEXT_SHADER: IsfShader = {
  id: 'fx-context',
  name: 'Context',
  category: 'FX',
  source: context,
  curated: {
    trails: [0, 0.6],
    blur: [0, 0.4],
    bloom: [0.1, 0.7],
    depth: [0.1, 0.7],
    haze: [0, 0.5],
    lightGlow: [0, 0.6],
    lightSize: [0.3, 0.9]
  }
}

// The Finalizer — the last always-on master stage after Context (grade + grain
// + sharpen). Store-locked, kept out of FX_SHADERS.
export const FINALIZER_SHADER: IsfShader = {
  id: 'fx-finalizer',
  name: 'Finalizer',
  category: 'FX',
  source: finalizer,
  curated: {
    black: [0, 0.15],
    white: [0.85, 1],
    gamma: [0.8, 1.3],
    rGain: [0.85, 1.15],
    gGain: [0.85, 1.15],
    bGain: [0.85, 1.15],
    sharpen: [0, 0.6],
    grain: [0, 0.3],
    grainSize: [1, 2.5],
    chroma: [0, 0.4],
    parasites: [0, 0.3],
    // The output shaper is a deliberate compositional move — never randomized.
    outShape: [0, 0],
    outBgSource: [0, 0]
  }
}

export const ALL_SHADERS: IsfShader[] = [
  ...GENERATORS,
  ...FX_SHADERS,
  ...NATIVE_NODES,
  VIBE_SHADER,
  CONTEXT_SHADER,
  FINALIZER_SHADER
]

export const SHADER_BY_ID: Record<string, IsfShader> = Object.fromEntries(
  ALL_SHADERS.map((s) => [s.id, s])
)

// ── Menu ordering ─────────────────────────────────────────────────────
// Sources list alphabetically; FX group by their sub-category (from the ISF
// header CATEGORIES), colour first. These drive the pickers only — the raw
// arrays keep their authoring order for Randomize's pools.

export const GENERATORS_ALPHA: IsfShader[] = [...GENERATORS].sort((a, b) =>
  a.name.localeCompare(b.name)
)

// A shader's display group = its first CATEGORIES tag that isn't the top-level
// "FX" (Color, Glitch, Distortion, …).
function fxGroup(sh: IsfShader): string {
  const m = sh.source.match(/"CATEGORIES"\s*:\s*\[([^\]]*)\]/)
  if (!m) return 'Other'
  const cats = m[1].split(',').map((x) => x.replace(/["'\s]/g, ''))
  return cats.find((c) => c && c !== 'FX') ?? 'Other'
}

/** FX bucketed by sub-category — groups AND shaders alphabetical (matching the
 *  alphabetical sources list), so any new group (e.g. Convolution) slots in. */
export const FX_GROUPS: Array<{ group: string; shaders: IsfShader[] }> = (() => {
  const buckets = new Map<string, IsfShader[]>()
  // Native convolution nodes appear in the picker alongside FX (their own group).
  for (const sh of [...FX_SHADERS, ...NATIVE_NODES]) {
    const g = fxGroup(sh)
    if (!buckets.has(g)) buckets.set(g, [])
    buckets.get(g)!.push(sh)
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([group, shaders]) => ({
      group,
      shaders: [...shaders].sort((x, y) => x.name.localeCompare(y.name))
    }))
})()

/** Source lookup the engine's syncFromState consumes. */
export function shaderSourceById(id: string): string | null {
  return SHADER_BY_ID[id]?.source ?? null
}

/** Randomize's range for one input: curated if present, else declared. */
export function curatedRange(
  shaderId: string,
  input: string,
  declared: [number, number]
): [number, number] {
  return SHADER_BY_ID[shaderId]?.curated?.[input] ?? declared
}
