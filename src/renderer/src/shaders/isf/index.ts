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
import syncLoss from './fx/SyncLoss.fs?raw'
import rowEcho from './fx/RowEcho.fs?raw'
import byteCorrupt from './fx/ByteCorrupt.fs?raw'
import ringing from './fx/Ringing.fs?raw'
import tracking from './fx/Tracking.fs?raw'
import feedbackZoom from './fx/FeedbackZoom.fs?raw'
import vibe from './fx/Vibe.fs?raw'

export interface IsfShader {
  id: string
  name: string
  category: 'Generator' | 'FX'
  source: string
  /** Randomize's aesthetic sub-range per float input (tighter than MIN/MAX). */
  curated?: Record<string, [number, number]>
}

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
    curated: { amount: [0.05, 0.35], size: [1, 3], parasites: [0.05, 0.5] }
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
    curated: { zoom: [0.7, 1.6], posX: [-0.3, 0.3], posY: [-0.3, 0.3], rotate: [-0.6, 0.6] }
  },
  {
    id: 'fx-stutter', name: 'Stutter', category: 'FX', source: stutter,
    curated: { rate: [2, 12], chance: [0.2, 0.7] }
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
    curated: { depth: [3, 10], scramble: [0.15, 0.7], blocks: [4, 32], rate: [0.1, 0.7], chaos: [0, 0.6] }
  },
  {
    id: 'fx-ringing', name: 'Ringing', category: 'FX', source: ringing,
    curated: { gap: [0.003, 0.02], intensity: [0.3, 1.3], angle: [0, 6.2832] }
  },
  {
    id: 'fx-tracking', name: 'Tracking', category: 'FX', source: tracking,
    curated: { band: [0.05, 0.25], wobble: [0.01, 0.1], noise: [0.2, 0.8], rate: [0.2, 0.8] }
  },
  {
    id: 'fx-feedback-zoom', name: 'Feedback Zoom', category: 'FX', source: feedbackZoom,
    curated: { zoom: [0.95, 1.08], twist: [-0.08, 0.08], amount: [0.35, 0.85] }
  }
]

// The Vibe mastering stage — pinned to the master rack's end (store-locked),
// deliberately NOT in FX_SHADERS so racks and Randomize can't add a second.
export const VIBE_SHADER: IsfShader = {
  id: 'fx-vibe',
  name: 'Vibe',
  category: 'FX',
  source: vibe
}

export const ALL_SHADERS: IsfShader[] = [...GENERATORS, ...FX_SHADERS, VIBE_SHADER]

export const SHADER_BY_ID: Record<string, IsfShader> = Object.fromEntries(
  ALL_SHADERS.map((s) => [s.id, s])
)

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
