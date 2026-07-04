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
      accent: [0, 0.5]
    }
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
    curated: { level: [0.3, 0.7], soft: [0.02, 0.3] }
  },
  {
    id: 'fx-solarize', name: 'Solarize', category: 'FX', source: solarize,
    curated: { level: [0.4, 0.8], strength: [0.5, 1] }
  },
  {
    id: 'fx-mosh-blocks', name: 'Mosh Blocks', category: 'FX', source: moshBlocks,
    curated: { blocks: [10, 48], amount: [0.05, 0.3], chance: [0.1, 0.5], rate: [0.1, 0.8] }
  },
  {
    id: 'fx-grain', name: 'Grain', category: 'FX', source: grain,
    curated: { amount: [0.05, 0.35], size: [1, 3] }
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
  }
]

export const ALL_SHADERS: IsfShader[] = [...GENERATORS, ...FX_SHADERS]

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
