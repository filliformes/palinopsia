// The output EQ's saved configurations : the twelve bands and the input and
// output gains, under a name. Kept on this computer (the EQ tunes the room, not
// the piece : sessions, presets and scenes leave it alone), recalled from the
// EQ card's menu or over OSC. A recall keeps the bypass switch and the glue.

import { normalizeEq, type SoniEq } from './eqMath'

export interface EqPreset {
  name: string
  eq: SoniEq
}

const KEY = 'opsia.eqPresets'

function load(): EqPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw
      .filter((p): p is { name: string; eq: unknown } => !!p && typeof p === 'object' && typeof (p as { name?: unknown }).name === 'string')
      .map((p) => ({ name: p.name.slice(0, 60), eq: normalizeEq(p.eq as Partial<SoniEq>) }))
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

/** What a preset holds of an EQ, as one comparable string. */
function shape(eq: SoniEq): string {
  return JSON.stringify({ i: eq.inGain, o: eq.outGain, b: eq.bands })
}

export const eqPresets = {
  list(): EqPreset[] {
    return list
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  },
  /** Save (or replace, same name) the EQ's bands and gains. */
  save(name: string, eq: SoniEq): void {
    const n = name.trim().slice(0, 60)
    if (!n) return
    const p = { name: n, eq: normalizeEq(eq) }
    const i = list.findIndex((x) => x.name === n)
    commit(i >= 0 ? list.map((x, k) => (k === i ? p : x)) : [...list, p])
  },
  remove(name: string): void {
    commit(list.filter((x) => x.name !== name))
  },
  get(name: string): EqPreset | undefined {
    return list.find((x) => x.name === name)
  },
  /** The preset the EQ is set to now, if any (its bands and gains, exactly). */
  matching(eq: SoniEq): string | null {
    const s = shape(normalizeEq(eq))
    return list.find((x) => shape(x.eq) === s)?.name ?? null
  },
  /** `eq` with a preset's bands and gains; its bypass switch and glue kept. */
  applied(eq: SoniEq, p: EqPreset): SoniEq {
    return { ...p.eq, on: eq.on, glue: eq.glue }
  }
}
