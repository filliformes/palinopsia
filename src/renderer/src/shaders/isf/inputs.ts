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
  // A shorter label shown only where a section header already says the rest
  // (the Finishing sections : "dust" under FILM DAMAGE). Modulation, OSC and the
  // M panel keep the full `label`.
  display?: string
  // Opsia extension ("COMPACT": true): small toggles/enums that the Inspector's
  // two-row grid stacks together into ONE cluster cell instead of a cell each.
  compact?: boolean
  // Opsia extension ("INTEGER": true) : a float that only means whole numbers (a
  // count) : its slider steps by 1 and its readout shows no decimals.
  integer?: boolean
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
  INTEGER?: boolean
  HINT?: string
}

/** The widest MIN..MAX a `long` without VALUES is offered as a menu. Wider, it is
 *  an integer slider : one menu entry per integer froze the app on 0..65535 and
 *  crashed it on 0..1e10. */
export const LONG_MENU_MAX = 64

/** A `long` control as every reader takes it (the Inspector, OSC, modulation,
 *  the agent, the Source Editor) : its VALUES when it declares them (a menu),
 *  MIN..MAX as a menu when that is a small range, else an integer slider. */
export function longShape(raw: { MIN?: unknown; MAX?: unknown; VALUES?: unknown; LABELS?: unknown; DEFAULT?: unknown }):
  | { menu: true; values: number[]; labels?: string[] }
  | { menu: false; min: number; max: number } {
  const labels = Array.isArray(raw.LABELS) ? raw.LABELS.map((l) => String(l)) : undefined
  const vs = raw.VALUES
  if (Array.isArray(vs) && vs.length && vs.every((v) => typeof v === 'number' && Number.isFinite(v)))
    return { menu: true, values: vs as number[], labels }
  const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  let lo = Math.round(fin(raw.MIN) ? raw.MIN : 0)
  let hi = Math.round(fin(raw.MAX) ? raw.MAX : Math.max(lo + 1, fin(raw.DEFAULT) ? raw.DEFAULT : lo + 1))
  if (hi < lo) [lo, hi] = [hi, lo]
  if (hi - lo + 1 <= LONG_MENU_MAX) return { menu: true, values: Array.from({ length: hi - lo + 1 }, (_, i) => lo + i), labels }
  return { menu: false, min: lo, max: hi }
}

/** A header's own hover-help for a control ("HINT" : your shaders, any ISF). */
export function hintOf(raw: { HINT?: unknown }): string | undefined {
  if (typeof raw.HINT !== 'string') return undefined
  const h = raw.HINT.replace(/\s+/g, ' ').trim()
  return h ? (h.length > 400 ? `${h.slice(0, 397)}...` : h) : undefined
}

const cache = new Map<string, IsfInputDesc[]>()

/** A shader's source changed (one of yours, saved again) : read its controls anew. */
export function invalidateInputs(shaderId: string): void {
  cache.delete(shaderId)
}

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

/** Controls the auto-UI should render for a shader (image inputs excluded :
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
    let type = raw.TYPE as IsfInputDesc['type']
    if (type === 'image') continue
    const def =
      typeof raw.DEFAULT === 'boolean' ? (raw.DEFAULT ? 1 : 0) : raw.DEFAULT
    let { MIN: min, MAX: max, VALUES: values, LABELS: labels, INTEGER: integer } = raw
    if (type === 'long') {
      const l = longShape(raw)
      if (l.menu) ({ values, labels } = l)
      else { type = 'float'; min = l.min; max = l.max; integer = true; values = undefined; labels = undefined }
    }
    out.push({
      name: raw.NAME,
      type,
      label: raw.LABEL ?? raw.NAME,
      min,
      max,
      def,
      values,
      labels,
      compact: raw.COMPACT,
      integer,
      hint: hints?.[raw.NAME] ?? hintOf(raw)
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
