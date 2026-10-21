// Persistence : what scenes, Randomize, Variation, Generate, a World and the
// mix presets leave alone.
//
// A pin is a key :
//   - one control : its mod target's key (modKey.ts), 'src:0:A:grow',
//     'fx:master:<unit id>:amount', 'lay:1:opacity', 'meta:3', 'bg:depth'...
//   - a layer control the matrix has no target for : 'lay:<i>:speed'
//   - a whole layer : 'layer:<i>'
// The pins belong to the session, outside the scenes : no scene can unpin
// anything, and a scene saved before a pin still recalls around it.
//
// keepPersistent() is the one gate. Every place a whole composition arrives
// (a scene, the sequencer, the scene pad, Randomize, Variation, Generate, a
// World, a mix or layer preset) passes it through here with the composition
// playing now, BEFORE the morph starts : a pinned value is then the same at
// both ends and never moves in a crossfade. A hand on the control itself (a
// drag, a typed number, MIDI or OSC sent to it) still moves it.
//
// A pinned control keeps its modulation too (its rows in the matrix, its Meta
// destinations); a pinned layer keeps all of its own. The modulator cards
// themselves still follow the scene.

import type { CompositionState, FxInstance, FxScope, LayerState, MetaKnobState, ModTarget, SourceSlot } from '@shared/types'
import { FX_OPACITY_INPUT, MAX_MOD_ASSIGNMENTS, META_MAX_DESTS } from '@shared/types'
import { modTargetKey } from './modKey'
import { SHADER_BY_ID } from './shaders/isf'
import { inputsForShader } from './shaders/isf/inputs'

export const layerPin = (i: number): string => `layer:${i}`
export const layerSpeedPin = (i: number): string => `lay:${i}:speed`

type LayField = 'opacity' | 'mix' | 'blend' | 'harmony' | 'speed'
type Pin =
  | { k: 'layer'; layer: number }
  | { k: 'src'; layer: number; slot: 'A' | 'B'; input: string }
  | { k: 'bgsrc'; input: string }
  | { k: 'fx'; scope: FxScope; instId: string; input: string }
  | { k: 'meta'; knob: number }
  | { k: 'lay'; layer: number; field: LayField }
  | { k: 'bg'; field: 'opacity' | 'speed' | 'depth' }

const LAY_FIELDS: readonly LayField[] = ['opacity', 'mix', 'blend', 'harmony', 'speed']
const LAY_PROP: Record<LayField, 'opacity' | 'sourceMix' | 'blend' | 'harmony' | 'speed'> = {
  opacity: 'opacity', mix: 'sourceMix', blend: 'blend', harmony: 'harmony', speed: 'speed'
}

const idx = (v: string | undefined): number => {
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 ? n : -1
}

/** What a pin key points at (null : not a key this version knows). */
function parsePin(key: string): Pin | null {
  const p = key.split(':')
  switch (p[0]) {
    case 'layer': {
      const layer = idx(p[1])
      return layer < 0 ? null : { k: 'layer', layer }
    }
    case 'src': {
      const layer = idx(p[1])
      return layer < 0 || (p[2] !== 'A' && p[2] !== 'B') || !p[3] ? null : { k: 'src', layer, slot: p[2], input: p.slice(3).join(':') }
    }
    case 'bgsrc':
      return p[1] ? { k: 'bgsrc', input: p.slice(1).join(':') } : null
    case 'meta': {
      const knob = idx(p[1])
      return knob < 0 ? null : { k: 'meta', knob }
    }
    case 'lay': {
      const layer = idx(p[1])
      const field = p[2] as LayField
      return layer < 0 || !LAY_FIELDS.includes(field) ? null : { k: 'lay', layer, field }
    }
    case 'bg':
      return p[1] === 'opacity' || p[1] === 'speed' || p[1] === 'depth' ? { k: 'bg', field: p[1] } : null
    case 'fx': {
      if (p[1] === 'master' || p[1] === 'background') {
        return p[2] && p[3] ? { k: 'fx', scope: { kind: p[1] }, instId: p[2], input: p.slice(3).join(':') } : null
      }
      const layer = idx(p[2])
      if ((p[1] !== 'layer' && p[1] !== 'sourceA' && p[1] !== 'sourceB') || layer < 0 || !p[3] || !p[4]) return null
      return { k: 'fx', scope: { kind: p[1], layer }, instId: p[3], input: p.slice(4).join(':') }
    }
  }
  return null
}

// The layer a mod target belongs to (-1 : none, the master, the background...).
function layerOf(t: ModTarget): number {
  if (t.kind === 'source' || t.kind === 'layer') return t.layer
  if (t.kind === 'fx' && (t.scope.kind === 'layer' || t.scope.kind === 'sourceA' || t.scope.kind === 'sourceB')) return t.scope.layer
  return -1
}

const same = (a: unknown, b: unknown): boolean =>
  a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]))

function chainOf(c: CompositionState, s: FxScope): FxInstance[] | undefined {
  if (s.kind === 'master') return c.master
  if (s.kind === 'background') return c.background?.fx
  const l = c.layers[s.layer]
  return s.kind === 'layer' ? l?.fx : s.kind === 'sourceA' ? l?.sourceAFx : l?.sourceBFx
}

function withChain(c: CompositionState, s: FxScope, fx: FxInstance[]): CompositionState {
  if (s.kind === 'master') return { ...c, master: fx }
  if (s.kind === 'background') return c.background ? { ...c, background: { ...c.background, fx } } : c
  const prop = s.kind === 'layer' ? 'fx' : s.kind === 'sourceA' ? 'sourceAFx' : 'sourceBFx'
  return { ...c, layers: c.layers.map((l, i) => (i === s.layer ? { ...l, [prop]: fx } : l)) }
}

const withLayer = (c: CompositionState, i: number, l: LayerState): CompositionState => ({
  ...c,
  layers: c.layers.map((x, j) => (j === i ? l : x))
})

// One input, from the live slot or unit onto the arriving one (absent live :
// at its default, so the arriving one loses its own value too).
function inputsWith<T>(to: Record<string, T>, from: Record<string, T>, input: string): Record<string, T> | null {
  const has = Object.prototype.hasOwnProperty.call(from, input)
  if (has ? same(to[input], from[input]) : !Object.prototype.hasOwnProperty.call(to, input)) return null
  const next = { ...to }
  if (has) next[input] = from[input]
  else delete next[input]
  return next
}

// A slot's input is kept only where the arriving slot plays the same thing
// (the same shader, or the same kind of media) : elsewhere the name means
// something else, or nothing.
const sameSource = (a: SourceSlot | null | undefined, b: SourceSlot | null | undefined): boolean =>
  !!a && !!b && a.kind === b.kind && (a.shaderId ?? null) === (b.shaderId ?? null)

/** One pin onto the arriving composition. Returns it (unchanged when the pin
 *  already holds) and whether the pin applies there at all. */
function graftOne(c: CompositionState, live: CompositionState, p: Pin): { c: CompositionState; applied: boolean } {
  switch (p.k) {
    case 'src': {
      const prop = p.slot === 'A' ? 'sourceA' : 'sourceB'
      const to = c.layers[p.layer]?.[prop]
      const from = live.layers[p.layer]?.[prop]
      if (!to || !from || !sameSource(to, from)) return { c, applied: false }
      const inputs = inputsWith(to.inputs ?? {}, from.inputs ?? {}, p.input)
      if (!inputs) return { c, applied: true }
      return { c: withLayer(c, p.layer, { ...c.layers[p.layer], [prop]: { ...to, inputs } }), applied: true }
    }
    case 'bgsrc': {
      const to = c.background?.source
      const from = live.background?.source
      if (!c.background || !to || !from || !sameSource(to, from)) return { c, applied: false }
      const inputs = inputsWith(to.inputs ?? {}, from.inputs ?? {}, p.input)
      if (!inputs) return { c, applied: true }
      return { c: { ...c, background: { ...c.background, source: { ...to, inputs } } }, applied: true }
    }
    case 'fx': {
      const chain = chainOf(c, p.scope)
      const to = chain?.find((f) => f.id === p.instId)
      const from = chainOf(live, p.scope)?.find((f) => f.id === p.instId)
      if (!chain || !to || !from || to.shaderId !== from.shaderId) return { c, applied: false }
      let unit: FxInstance | null = null
      if (p.input === FX_OPACITY_INPUT) {
        if ((to.opacity ?? 1) !== (from.opacity ?? 1)) unit = { ...to, opacity: from.opacity }
      } else {
        const inputs = inputsWith(to.inputs ?? {}, from.inputs ?? {}, p.input)
        if (inputs) unit = { ...to, inputs }
      }
      if (!unit) return { c, applied: true }
      const u = unit
      return { c: withChain(c, p.scope, chain.map((f) => (f.id === p.instId ? u : f))), applied: true }
    }
    case 'meta': {
      // the whole knob : its value, its curve, its smoothing, where it goes
      const from = live.metaKnobs[p.knob]
      if (!from || !c.metaKnobs[p.knob]) return { c, applied: false }
      if (c.metaKnobs[p.knob] === from) return { c, applied: true }
      return { c: { ...c, metaKnobs: c.metaKnobs.map((k, i) => (i === p.knob ? from : k)) }, applied: true }
    }
    case 'lay': {
      const to = c.layers[p.layer]
      const from = live.layers[p.layer]
      if (!to || !from) return { c, applied: false }
      const prop = LAY_PROP[p.field]
      if (to[prop] === from[prop]) return { c, applied: true }
      return { c: withLayer(c, p.layer, { ...to, [prop]: from[prop] }), applied: true }
    }
    case 'bg': {
      if (!c.background || !live.background) return { c, applied: false }
      if (c.background[p.field] === live.background[p.field]) return { c, applied: true }
      return { c: { ...c, background: { ...c.background, [p.field]: live.background[p.field] } }, applied: true }
    }
    case 'layer': {
      const from = live.layers[p.layer]
      if (!from || !c.layers[p.layer]) return { c, applied: false }
      return { c: c.layers[p.layer] === from ? c : withLayer(c, p.layer, from), applied: true }
    }
  }
}

// The finishing units (Vibe, Context, Finalizer : one of each, always there)
// are the same unit whatever their id, but a Generate builds them anew. When
// something on one is pinned, the arriving one takes the live one's id (its
// modulation rows follow), so the pin holds now and at every recall after.
function adoptLockedIds(c: CompositionState, live: CompositionState, pins: readonly string[]): CompositionState {
  const ren = new Map<string, string>()
  for (const u of live.master) {
    if (!u.locked || !pins.some((k) => k.startsWith(`fx:master:${u.id}:`))) continue
    const a = c.master.find((f) => f.locked && f.shaderId === u.shaderId)
    if (a && a.id !== u.id && !c.master.some((f) => f.id === u.id)) ren.set(a.id, u.id)
  }
  if (!ren.size) return c
  const re = (t: ModTarget): ModTarget =>
    t.kind === 'fx' && t.scope.kind === 'master' && ren.has(t.instId) ? { ...t, instId: ren.get(t.instId)! } : t
  return {
    ...c,
    master: c.master.map((f) => (ren.has(f.id) ? { ...f, id: ren.get(f.id)! } : f)),
    modMatrix: c.modMatrix.map((a) => (a.target.kind === 'fx' && a.target.scope.kind === 'master' && ren.has(a.target.instId) ? { ...a, target: re(a.target) } : a)),
    metaKnobs: c.metaKnobs.map((k) => (k.destinations.some((t) => re(t) !== t) ? { ...k, destinations: k.destinations.map(re) } : k))
  }
}

/** The pins onto an arriving composition, and which of them applied (a
 *  control on an effect the arriving composition lacks, or on a source it
 *  plays something else in, has nothing to hold). */
export function graftPins(incoming: CompositionState, live: CompositionState, pins: readonly string[]): { comp: CompositionState; applied: Set<string> } {
  const applied = new Set<string>()
  if (!pins.length) return { comp: incoming, applied }
  let c = adoptLockedIds(incoming, live, pins)
  const layers = new Set<number>()
  const parsed: Array<[string, Pin]> = []
  for (const key of pins) {
    const p = parsePin(key)
    if (p) parsed.push([key, p])
  }
  // whole layers last : they hold the layer whatever its own pins did
  for (const [key, p] of [...parsed.filter(([, x]) => x.k !== 'layer'), ...parsed.filter(([, x]) => x.k === 'layer')]) {
    const r = graftOne(c, live, p)
    c = r.c
    if (r.applied) {
      applied.add(key)
      if (p.k === 'layer') layers.add(p.layer)
    }
  }
  if (!applied.size) return { comp: c, applied }

  // Their modulation : a pinned control keeps its own rows, a pinned layer all
  // of its own (the arriving ones on them go). A pinned Meta knob already came
  // whole, its destinations with it.
  const held = (t: ModTarget): boolean => applied.has(modTargetKey(t)) || layers.has(layerOf(t))
  const kept = c.modMatrix.filter((a) => !held(a.target))
  const carried = live.modMatrix.filter((a) => held(a.target))
  if (kept.length !== c.modMatrix.length || carried.length) {
    // (over the cap, the arriving rows give way : the pinned ones are yours)
    c = { ...c, modMatrix: [...kept.slice(0, Math.max(0, MAX_MOD_ASSIGNMENTS - carried.length)), ...carried] }
  }
  const pinnedKnob = (i: number): boolean => applied.has(`meta:${i}`)
  let knobsChanged = false
  const metaKnobs = c.metaKnobs.map((k: MetaKnobState, i: number): MetaKnobState => {
    if (pinnedKnob(i)) return k
    const dest = k.destinations.filter((t) => !held(t))
    const add = (live.metaKnobs[i]?.destinations ?? []).filter(held)
    if (dest.length === k.destinations.length && !add.length) return k
    knobsChanged = true
    return { ...k, destinations: [...dest.slice(0, Math.max(0, META_MAX_DESTS - add.length)), ...add] }
  })
  if (knobsChanged) c = { ...c, metaKnobs }
  return { comp: c, applied }
}

/** The gate : an arriving composition with the pins held from the live one. */
export function keepPersistent(incoming: CompositionState, live: CompositionState, pins: readonly string[]): CompositionState {
  return pins.length ? graftPins(incoming, live, pins).comp : incoming
}

/** Does a mod target (a randomized binding's, a control's) sit under a pin ? */
export function isPinnedTarget(t: ModTarget, pins: readonly string[]): boolean {
  return pins.length > 0 && (pins.includes(modTargetKey(t)) || pins.includes(layerPin(layerOf(t))))
}

const LAY_WORDS: Record<LayField, string> = { opacity: 'opacity', mix: 'A·B mix', blend: 'blend', harmony: 'A·B hue', speed: 'speed' }

function inputLabel(shaderId: string | null | undefined, input: string): string {
  if (input === FX_OPACITY_INPUT) return 'dry/wet'
  return (shaderId ? inputsForShader(shaderId).find((d) => d.name === input)?.label : null) ?? input
}

const shaderName = (id: string | null | undefined): string => (id ? SHADER_BY_ID[id]?.name ?? id : 'empty')

/** A pin in words, for the list : what it holds, and whether that is in the
 *  picture now (a pin on an effect since removed, or a source since changed,
 *  holds nothing until it comes back). */
export function describePin(key: string, live: CompositionState): { label: string; here: boolean } {
  const p = parsePin(key)
  if (!p) return { label: key, here: false }
  switch (p.k) {
    case 'layer':
      return { label: `L${p.layer + 1}, the whole layer`, here: !!live.layers[p.layer] }
    case 'lay':
      return { label: `L${p.layer + 1} ${LAY_WORDS[p.field]}`, here: !!live.layers[p.layer] }
    case 'bg':
      return { label: `Background ${p.field}`, here: !!live.background }
    case 'meta':
      return { label: `Meta ${p.knob + 1}${live.metaKnobs[p.knob]?.name ? ` (${live.metaKnobs[p.knob].name})` : ''}`, here: !!live.metaKnobs[p.knob] }
    case 'src': {
      const s = live.layers[p.layer]?.[p.slot === 'A' ? 'sourceA' : 'sourceB']
      const what = s?.shaderId ? shaderName(s.shaderId) : s?.kind && s.kind !== 'none' ? (s.mediaName || s.kind) : 'empty'
      return { label: `L${p.layer + 1} ${p.slot} · ${what} · ${inputLabel(s?.shaderId, p.input)}`, here: !!s && s.kind !== 'none' && (!s.shaderId || inputsForShader(s.shaderId).some((d) => d.name === p.input)) }
    }
    case 'bgsrc': {
      const s = live.background?.source
      return { label: `Background · ${shaderName(s?.shaderId)} · ${inputLabel(s?.shaderId, p.input)}`, here: !!s?.shaderId }
    }
    case 'fx': {
      const u = chainOf(live, p.scope)?.find((f) => f.id === p.instId)
      const where =
        p.scope.kind === 'master' ? 'Master' : p.scope.kind === 'background' ? 'Background FX' : `L${p.scope.layer + 1} ${p.scope.kind === 'layer' ? 'FX' : p.scope.kind === 'sourceA' ? 'A fx' : 'B fx'}`
      return { label: `${where} · ${u ? shaderName(u.shaderId) : 'a removed effect'} · ${inputLabel(u?.shaderId, p.input)}`, here: !!u }
    }
  }
}
