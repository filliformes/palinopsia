// ISF INPUTS introspection : the auto-UI's data source (brief §10.3).
//
// Each ISF header declares its controls: name, type, range, default. That
// declaration IS the simplexité mechanism : the UI below is generated from
// it, so authoring a shader is authoring its control surface. Parsed straight
// from the JSON header (no GL context needed) and cached per shader id.

import { SHADER_BY_ID } from './index'
import { INPUT_HINTS } from './inputHints'

export interface IsfInputDesc {
  name: string
  type: 'float' | 'bool' | 'long' | 'color' | 'point2D' | 'image' | 'event'
  label: string
  min?: number | number[]
  max?: number | number[]
  def?: number | number[]
  // For 'long' (enum) inputs.
  values?: number[]
  labels?: string[]
  // Plain-English hover-help (from inputHints.ts) : shown in the control's title.
  hint?: string
  // Opsia extension ("COMPACT": true): small toggles/enums that the Inspector's
  // two-row grid stacks together into ONE cluster cell instead of a cell each.
  compact?: boolean
}

interface RawInput {
  NAME?: string
  TYPE?: string
  LABEL?: string
  MIN?: number | number[]
  MAX?: number | number[]
  DEFAULT?: number | number[] | boolean
  VALUES?: number[]
  LABELS?: string[]
  COMPACT?: boolean
}

const cache = new Map<string, IsfInputDesc[]>()

function parseHeader(source: string): RawInput[] {
  const m = source.match(/\/\*\s*(\{[\s\S]*?\})\s*\*\//)
  if (!m) return []
  try {
    const j = JSON.parse(m[1]) as { INPUTS?: RawInput[] }
    return j.INPUTS ?? []
  } catch {
    return []
  }
}

/** Controls the auto-UI should render for a shader (image inputs excluded —
 *  the engine wires those). Booleans normalize to 0/1 floats so the store's
 *  value model stays numeric. */
export function inputsForShader(shaderId: string): IsfInputDesc[] {
  const hit = cache.get(shaderId)
  if (hit) return hit
  const shader = SHADER_BY_ID[shaderId]
  if (!shader) return []
  const out: IsfInputDesc[] = []
  const hints = INPUT_HINTS[shaderId]
  for (const raw of parseHeader(shader.source)) {
    if (!raw.NAME || !raw.TYPE) continue
    const type = raw.TYPE as IsfInputDesc['type']
    if (type === 'image') continue
    const def =
      typeof raw.DEFAULT === 'boolean' ? (raw.DEFAULT ? 1 : 0) : raw.DEFAULT
    out.push({
      name: raw.NAME,
      type,
      label: raw.LABEL ?? raw.NAME,
      min: raw.MIN,
      max: raw.MAX,
      def,
      values: raw.VALUES,
      labels: raw.LABELS,
      compact: raw.COMPACT,
      hint: hints?.[raw.NAME]
    })
  }
  cache.set(shaderId, out)
  return out
}

/** Every control input's DEFAULT value (image inputs excluded), resolved the
 *  same way a control resolves a missing value : an explicit DEFAULT, else a
 *  type-appropriate fallback. This is the state a freshly-added unit shows.
 *  Used by the Inspector's "reset" button. */
export function defaultInputs(shaderId: string): Record<string, number | number[]> {
  const out: Record<string, number | number[]> = {}
  for (const d of inputsForShader(shaderId)) {
    if (Array.isArray(d.def)) out[d.name] = [...d.def]
    else if (typeof d.def === 'number') out[d.name] = d.def
    else if (d.type === 'color') out[d.name] = [1, 1, 1, 1]
    else if (d.type === 'point2D') out[d.name] = Array.isArray(d.min) ? [...d.min] : [0.5, 0.5]
    else out[d.name] = typeof d.min === 'number' ? d.min : 0
  }
  return out
}
