// The output EQ's saved configurations : the twelve bands, the input and output
// gains and the glue (its on / off, amount and voice), under a name. Kept on this
// computer (the EQ tunes the room : Sonify presets and scenes leave it alone; a
// session carries its own EQ and glue, and opening it brings them), recalled from
// the EQ card's menu or over OSC. A recall keeps the EQ's bypass switch. A preset
// saved before presets carried the glue (no `withGlue`) leaves the glue as it is.

import { normalizeEq, type SoniEq } from './eqMath'

export interface EqPreset {
  name: string
  eq: SoniEq
  /** Saved with its glue (every preset since 1.3.0); absent : the glue is left alone. */
  withGlue?: boolean
}

const KEY = 'opsia.eqPresets'

function load(): EqPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .filter((p): p is { name: string; eq: unknown; withGlue?: unknown } => !!p && typeof p === 'object' && typeof (p as { name?: unknown }).name === 'string')
      .map((p) => ({ name: p.name.slice(0, 60), eq: normalizeEq(p.eq as Partial<SoniEq>), ...(p.withGlue === true ? { withGlue: true } : {}) }))
  } catch {
    return []
  }
}

let list: EqPreset[] = load()
const listeners = new Set<() => void>()

function commit(next: EqPreset[]): void {
  list = next
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* full or blocked : kept for this run */ }
  for (const fn of listeners) fn()
}

/** What a preset holds of an EQ, as one comparable string (its glue too when it
 *  carries one). */
function shape(eq: SoniEq, glue: boolean): string {
  return JSON.stringify({ i: eq.inGain, o: eq.outGain, b: eq.bands, ...(glue ? { g: eq.glue } : {}) })
}

export const eqPresets = {
  list(): EqPreset[] {
    return list
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  },
  /** Save (or replace, same name) the EQ's bands, gains and glue. */
  save(name: string, eq: SoniEq): void {
    const n = name.trim().slice(0, 60)
    if (!n) return
    const p: EqPreset = { name: n, eq: normalizeEq(eq), withGlue: true }
    const i = list.findIndex((x) => x.name === n)
    commit(i >= 0 ? list.map((x, k) => (k === i ? p : x)) : [...list, p])
  },
  remove(name: string): void {
    commit(list.filter((x) => x.name !== name))
  },
  get(name: string): EqPreset | undefined {
    return list.find((x) => x.name === name)
  },
  /** The preset the EQ is set to now, if any (its bands, gains and glue, exactly). */
  matching(eq: SoniEq): string | null {
    const e = normalizeEq(eq)
    return list.find((x) => shape(x.eq, !!x.withGlue) === shape(e, !!x.withGlue))?.name ?? null
  },
  /** `eq` with a preset's bands, gains and glue (an older preset keeps the glue
   *  playing); the EQ's bypass switch kept. */
  applied(eq: SoniEq, p: EqPreset): SoniEq {
    return { ...p.eq, on: eq.on, glue: p.withGlue ? { ...p.eq.glue } : eq.glue }
  }
}
