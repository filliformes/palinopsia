// Your own master chains : "my chains", first in the chain presets menu. The
// Master FX chain saved under a name, kept on this computer like the layer,
// background and EQ presets. A chain of yours has the shape of a built-in one
// (masterPresets.ts) and is applied the same way (the store's
// applyMasterPreset : one undo step, what is Persistent stays) : its effects in
// order with every input, on or off and dry / wet, the layer a node reads named
// as the built-in chains name it (the lowest, second or highest playing layer),
// and the Vibe and Context settings.
//
// Every chain the instrument offers goes through here (`allChains`), yours
// first : the strip's menu, Ctrl+K and the chain next / previous / random
// actions see the same list, and `chainPlaying` names the one that plays.

import { useSyncExternalStore } from 'react'
import type { CompositionState, FxInstance } from '@shared/types'
import {
  MASTER_PRESETS,
  layerAsPick,
  playingLayers,
  type LayerPick,
  type MasterPreset,
  type MasterPresetFx
} from './shaders/isf/masterPresets'
import { SHADER_BY_ID } from './shaders/isf'

export const MY_CHAINS = 'my chains'
const KEY = 'opsia.userChains'
export const CHAIN_NAME_MAX = 60

// ── Reading them back : anything malformed is left out, never a crash ───────

type Values = Record<string, number | number[]>
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isPick = (v: unknown): v is LayerPick => v === 'bottom' || v === 'top' || v === 'second'

function cleanValues(v: unknown): Values | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out: Values = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (isNum(x)) out[k] = x
    else if (Array.isArray(x) && x.length > 0 && x.length <= 16 && x.every(isNum)) out[k] = x.slice()
  }
  return out
}

function cleanFx(v: unknown): MasterPresetFx | null {
  if (!v || typeof v !== 'object') return null
  const f = v as Record<string, unknown>
  if (typeof f.shaderId !== 'string' || !f.shaderId || f.shaderId.length > 120) return null
  const inputs = cleanValues(f.inputs)
  if (!inputs) return null
  return {
    shaderId: f.shaderId,
    inputs,
    ...(isPick(f.reads) ? { reads: f.reads } : {}),
    ...(isPick(f.reads2) ? { reads2: f.reads2 } : {}),
    ...(f.enabled === false ? { enabled: false } : {}),
    ...(isNum(f.opacity) ? { opacity: Math.max(0, Math.min(1, f.opacity)) } : {})
  }
}

function cleanChain(v: unknown): MasterPreset | null {
  if (!v || typeof v !== 'object') return null
  const c = v as Record<string, unknown>
  const name = typeof c.name === 'string' ? c.name.trim().slice(0, CHAIN_NAME_MAX) : ''
  if (!name || !Array.isArray(c.fx)) return null
  const fx = c.fx.map(cleanFx)
  if (!fx.length || fx.some((f) => !f)) return null // a chain missing a piece is not that chain
  const context = cleanValues(c.context)
  return {
    name,
    group: MY_CHAINS,
    fx: fx as MasterPresetFx[],
    vibe: cleanValues(c.vibe) ?? {},
    ...(context ? { context } : {})
  }
}

function load(): MasterPreset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    const out: MasterPreset[] = []
    for (const r of raw) {
      const c = cleanChain(r)
      if (c && !out.some((x) => x.name === c.name)) out.push(c)
    }
    return out
  } catch {
    return []
  }
}

let list: MasterPreset[] = load()
const listeners = new Set<() => void>()

function commit(next: MasterPreset[]): void {
  list = next
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* full or blocked : kept for this run */ }
  for (const fn of listeners) fn()
}

export const userChains = {
  list(): MasterPreset[] {
    return list
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  },
  get(name: string): MasterPreset | undefined {
    return list.find((x) => x.name === name)
  },
  /** Keep a chain under its name : a name you already have is replaced in its
   *  place in the list, a new one goes at the end. */
  save(chain: MasterPreset): void {
    const c = cleanChain(chain)
    if (!c) return
    const i = list.findIndex((x) => x.name === c.name)
    commit(i >= 0 ? list.map((x, k) => (k === i ? c : x)) : [...list, c])
  },
  remove(name: string): void {
    commit(list.filter((x) => x.name !== name))
  },
  /** False when the new name is empty or another chain of yours has it. */
  rename(from: string, to: string): boolean {
    const n = to.trim().slice(0, CHAIN_NAME_MAX)
    if (!n || (n !== from && list.some((x) => x.name === n))) return false
    commit(list.map((x) => (x.name === from ? { ...x, name: n } : x)))
    return true
  }
}

/** Your chains, re-rendering when one is saved, renamed or deleted. */
export function useUserChains(): MasterPreset[] {
  return useSyncExternalStore(userChains.subscribe, userChains.list)
}

// ── The chain as it plays now ─────────────────────────────────────────────

const nameOf = (id: string | null): string => (id ? (SHADER_BY_ID[id]?.name ?? id) : 'effect')

/** The Master FX chain playing in `c`, as a chain (no name yet), and the
 *  effects whose layer it cannot name (a node reading an image, the third of
 *  four playing layers, or a muted or empty layer : it will read no layer). */
export function chainFromComposition(c: CompositionState): { chain: Omit<MasterPreset, 'name'>; dropped: string[] } {
  const playing = playingLayers(c.layers)
  const dropped: string[] = []
  const fx: MasterPresetFx[] = c.master
    .filter((f) => !f.locked && f.shaderId)
    .map((f) => {
      const pick = (ref: FxInstance['sidechain']): LayerPick | undefined => {
        if (!ref) return undefined
        const p = ref.kind === 'layer' ? layerAsPick(playing, ref.layer) : undefined
        if (!p && !dropped.includes(nameOf(f.shaderId))) dropped.push(nameOf(f.shaderId))
        return p
      }
      const reads = pick(f.sidechain)
      const reads2 = pick(f.sidechain2)
      return {
        shaderId: f.shaderId!,
        inputs: structuredClone(f.inputs),
        ...(reads ? { reads } : {}),
        ...(reads2 ? { reads2 } : {}),
        ...(f.enabled ? {} : { enabled: false }),
        ...(f.opacity !== undefined ? { opacity: f.opacity } : {})
      }
    })
  const locked = (id: string): Values | undefined => {
    const u = c.master.find((f) => f.locked && f.shaderId === id)
    return u ? structuredClone(u.inputs) : undefined
  }
  const context = locked('fx-context')
  return { chain: { group: MY_CHAINS, fx, vibe: locked('fx-vibe') ?? {}, ...(context ? { context } : {}) }, dropped }
}

// ── Every chain, and which one plays ────────────────────────────────────────

/** The menu's value for a chain : a built-in one's name; yours, its name
 *  marked (a chain of yours may share a built-in one's name). */
export const userChainKey = (name: string): string => `mine:${name}`

export interface ChainEntry {
  key: string
  preset: MasterPreset
  mine: boolean
}

let cacheFor: MasterPreset[] | null = null
let cache: ChainEntry[] = []
/** Every chain the instrument offers, yours first. */
export function allChains(): ChainEntry[] {
  if (cacheFor !== list) {
    cacheFor = list
    cache = [
      ...list.map((p) => ({ key: userChainKey(p.name), preset: p, mine: true })),
      ...MASTER_PRESETS.map((p) => ({ key: p.name, preset: p, mine: false }))
    ]
  }
  return cache
}

export function chainByKey(key: string | null | undefined): ChainEntry | undefined {
  return key ? allChains().find((e) => e.key === key) : undefined
}

const idsOf = (fx: { shaderId: string | null }[]): string => fx.map((f) => f.shaderId).join('|')
const same = (a: number | number[], b: number | number[] | undefined): boolean =>
  Array.isArray(a) ? Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]) : a === b

/** Does the chain hold these effects : 'exact' (every value it sets, on / off
 *  and dry / wet too), 'ids' (the same effects in the same order), or not. */
function matches(p: MasterPreset, units: FxInstance[]): 'exact' | 'ids' | null {
  if (idsOf(p.fx) !== idsOf(units)) return null
  const exact = p.fx.every((f, i) => {
    const u = units[i]
    return (
      (f.enabled ?? true) === u.enabled &&
      (f.opacity ?? 1) === (u.opacity ?? 1) &&
      Object.entries(f.inputs).every(([k, v]) => same(v, u.inputs[k]))
    )
  })
  return exact ? 'exact' : 'ids'
}

/** The chain the menu names for these effects (the chain's own units, the
 *  finishing left out). The one picked lately (`recent` : by hand, then by an
 *  action) while it still holds them, else any chain that holds them exactly,
 *  yours first, else any with the same effects; '' when none does. */
export function chainPlaying(units: FxInstance[], recent: (string | null | undefined)[]): string {
  if (!units.length) return ''
  const picked = recent.map(chainByKey).filter((e): e is ChainEntry => !!e)
  const all = allChains()
  // exact first : your chain saved from a built-in one keeps its own name
  for (const e of [...picked, ...all]) if (matches(e.preset, units) === 'exact') return e.key
  for (const e of picked) if (matches(e.preset, units)) return e.key
  for (const e of all.filter((x) => !x.mine)) if (matches(e.preset, units)) return e.key
  for (const e of all.filter((x) => x.mine)) if (matches(e.preset, units)) return e.key
  return ''
}
