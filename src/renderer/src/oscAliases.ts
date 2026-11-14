// OSC aliases (the map table) : a controller's own address played onto an /opsia
// address, scaled. Per computer. The router (oscInput.ts route) asks aliasesFor()
// before OSC Learn, and an alias plays alongside a learned mapping of the same
// address. An alias never starts with /opsia or /composition and always targets
// /opsia, so it can never call itself.

import type { OscAlias } from '@shared/types'
import { useStore } from './store'

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

export function cleanAlias(x: unknown): OscAlias | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const address = typeof o.address === 'string' ? o.address.trim() : ''
  const target = typeof o.target === 'string' ? o.target.trim() : ''
  if (!/^\/\S+$/.test(address) || address.length > 200 || address.startsWith('/opsia') || address.startsWith('/composition')) return null
  if (!target.startsWith('/opsia/') || target.length > 200) return null
  return {
    id: typeof o.id === 'string' && o.id ? o.id.slice(0, 16) : Math.random().toString(36).slice(2, 10),
    on: o.on !== false,
    address,
    arg: Math.max(0, Math.min(15, Math.round(num(o.arg, 0)))),
    inMin: num(o.inMin, 0),
    inMax: num(o.inMax, 1),
    outMin: num(o.outMin, 0),
    outMax: num(o.outMax, 1),
    curve: Math.max(0.1, Math.min(10, num(o.curve, 1))),
    invert: o.invert === true,
    target
  }
}

export function loadOscAliases(): OscAlias[] {
  try {
    const arr = JSON.parse(localStorage.getItem('opsia.oscAliases') || '[]') as unknown[]
    return Array.isArray(arr) ? arr.map(cleanAlias).filter((a): a is OscAlias => !!a).slice(0, 256) : []
  } catch {
    return []
  }
}

export function saveOscAliases(list: OscAlias[]): void {
  try {
    localStorage.setItem('opsia.oscAliases', JSON.stringify(list))
  } catch {
    /* quota : they just won't survive the restart */
  }
}

let index: { list: OscAlias[]; by: Map<string, OscAlias[]> } | null = null

/** The aliases on this address (on ones only). */
export function aliasesFor(address: string): OscAlias[] | undefined {
  const list = useStore.getState().oscAliases
  if (!index || index.list !== list) {
    const by = new Map<string, OscAlias[]>()
    for (const a of list) if (a.on) by.set(a.address, [...(by.get(a.address) ?? []), a])
    index = { list, by }
  }
  return index.by.get(address)
}

/** A controller's value through an alias : its range to 0..1, inverted, curved,
 *  onto the output range. */
export function aliasValue(a: OscAlias, v: number): number {
  const span = a.inMax - a.inMin
  let t = span !== 0 ? (v - a.inMin) / span : 0
  t = Math.max(0, Math.min(1, t))
  if (a.invert) t = 1 - t
  t = Math.pow(t, a.curve)
  return a.outMin + (a.outMax - a.outMin) * t
}
