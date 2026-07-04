// ISF shader registry. Sources are imported as raw strings (Vite `?raw`) so
// the ISF runtime can parse each one's JSON header + GLSL at load time. This
// curated seed set IS the instrument's voice (brief §1, §5): glitch /
// generative / digital-arts — never kaleidoscope, plasma, or audio-bloom.
//
// Generators grow here through Phase 3 (FX shaders get their own racks). Each
// entry will later carry a per-input CURATED aesthetic sub-range for the
// Randomize button (Phase 6).

import driftField from './DriftField.fs?raw'

export interface IsfShader {
  id: string
  name: string
  category: 'Generator' | 'FX'
  source: string
}

export const GENERATORS: IsfShader[] = [
  { id: 'drift-field', name: 'Drift Field', category: 'Generator', source: driftField }
]

export const SHADER_BY_ID: Record<string, IsfShader> = Object.fromEntries(
  GENERATORS.map((g) => [g.id, g])
)
