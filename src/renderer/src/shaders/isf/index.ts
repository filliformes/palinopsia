// ISF shader registry. Sources are imported as raw strings (Vite `?raw`) so
// the ISF runtime can parse each one's JSON header + GLSL at load time. This
// curated seed set IS the instrument's voice (brief §1, §5): glitch /
// generative / digital-arts — never kaleidoscope, plasma, or audio-bloom.
//
// Each entry will later carry a per-input CURATED aesthetic sub-range for the
// Randomize button (Phase 6).

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

export interface IsfShader {
  id: string
  name: string
  category: 'Generator' | 'FX'
  source: string
}

export const GENERATORS: IsfShader[] = [
  { id: 'drift-field', name: 'Drift Field', category: 'Generator', source: driftField },
  { id: 'slabs', name: 'Slabs', category: 'Generator', source: slabs }
]

// The glitch/digital-arts FX vocabulary (brief §5): pixel-smear, dither,
// chroma, displacement, slices, scanlines, posterize, edge, grade, pixelate.
export const FX_SHADERS: IsfShader[] = [
  { id: 'fx-posterize', name: 'Posterize', category: 'FX', source: posterize },
  { id: 'fx-dither', name: 'Dither', category: 'FX', source: dither },
  { id: 'fx-chroma-shift', name: 'Chroma Shift', category: 'FX', source: chromaShift },
  { id: 'fx-pixelate', name: 'Pixelate', category: 'FX', source: pixelate },
  { id: 'fx-displace', name: 'Displace', category: 'FX', source: displace },
  { id: 'fx-scanlines', name: 'Scanlines', category: 'FX', source: scanlines },
  { id: 'fx-edge', name: 'Edge', category: 'FX', source: edge },
  { id: 'fx-grade', name: 'Grade', category: 'FX', source: grade },
  { id: 'fx-slice-shuffle', name: 'Slice Shuffle', category: 'FX', source: sliceShuffle },
  { id: 'fx-smear', name: 'Smear', category: 'FX', source: smear }
]

export const ALL_SHADERS: IsfShader[] = [...GENERATORS, ...FX_SHADERS]

export const SHADER_BY_ID: Record<string, IsfShader> = Object.fromEntries(
  ALL_SHADERS.map((s) => [s.id, s])
)

/** Source lookup the engine's syncFromState consumes. */
export function shaderSourceById(id: string): string | null {
  return SHADER_BY_ID[id]?.source ?? null
}
