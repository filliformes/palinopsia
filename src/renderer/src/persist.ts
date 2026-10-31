// Persistence : what scenes, Randomize, Variation, Generate, a World and the
// mix presets leave alone.
//
// A pin is a key :
//   - one control : its mod target's key (modKey.ts), 'src:0:A:grow',
//     'fx:master:<unit id>:amount', 'lay:1:opacity', 'meta:3', 'bg:depth'...
//   - a layer control the matrix has no target for : 'lay:<i>:speed'
//   - a whole layer : 'layer:<i>'
//   - a whole effect unit : 'fxunit:<rack>:<unit id>' (the rack as a control
//     key spells it : 'master', 'background', 'layer:1', 'sourceA:0'...)
//   - a whole source slot : 'src:<i>:<A|B>' (a control on it has one more
//     part, its input : 'src:0:A:grow')
//   - a modulator card : 'mod:<n>'
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
// destinations); a pinned layer keeps all of its own, a pinned effect or
// source all of its own (a source : its effects' too). A pinned modulator card
// is its configuration only : the bindings riding it follow their own rules (a
// binding on a pinned control is kept, any other is the scene's), so a pinned
// control's carried binding runs its own modulator when that card is pinned too.
//
// Whole pins carry the thing whole whatever arrives :
//   - an effect, into its own rack at the place it has now (clamped before the
//     finishing units), whether the arriving rack had it or not; a rack that
//     cannot host it (the Background off, a source rack on an empty slot) has
//     nothing to hold. A finishing unit (always there) is replaced in place.
//   - a source slot : its source (kind, shader or media, inputs, framing,
//     transport...) and its effect rack, as they are now. It is the slot that
//     is pinned : a hand swap of its source keeps the pin, on the new source.
//   - a modulator card : its configuration, as it is now (pinning a World's
//     modulator makes it yours : store.ts togglePin).
// A whole pin wins over the control pins inside it (they hold the same values).
// The dice deal around whole pins as around a pinned control's effect
// (keepPinnedUnits); the dice of a pinned source's own rack refuses, as a
// pinned layer's dice do. An effect dragged into another rack by hand takes
// its pins along (movePins).

import type { CompositionState, FxInstance, FxScope, LayerState, MetaKnobState, ModAssignment, ModTarget, SourceSlot } from '@shared/types'
import { FX_OPACITY_INPUT, MAX_MOD_ASSIGNMENTS, META_MAX_DESTS } from '@shared/types'
import { controlKey, modTargetKey } from './modKey'
import { SHADER_BY_ID } from './shaders/isf'
import { inputsForShader } from './shaders/isf/inputs'

export const layerPin = (i: number): string => `layer:${i}`
export const layerSpeedPin = (i: number): string => `lay:${i}:speed`
const rackKey = (s: FxScope): string => (s.kind === 'master' || s.kind === 'background' ? s.kind : `${s.kind}:${s.layer}`)
export const unitPin = (s: FxScope, instId: string): string => `fxunit:${rackKey(s)}:${instId}`
export const slotPin = (layer: number, slot: 'A' | 'B'): string => `src:${layer}:${slot}`
export const modPin = (n: number): string => `mod:${n}`

// The menu words for the whole pins (Pin.tsx usePinItems)
export const PIN_WORDS = {
  unit: { pin: 'Persistent effect', every: 'Set this effect in every scene' },
  slot: { pin: 'Persistent source', every: 'Set this source in every scene' },
  mod: { pin: 'Persistent modulator', every: 'Set this modulator in every scene' }
}

type LayField = 'opacity' | 'mix' | 'blend' | 'harmony' | 'speed'
type Pin =
  | { k: 'layer'; layer: number }
  | { k: 'src'; layer: number; slot: 'A' | 'B'; input: string }
  | { k: 'bgsrc'; input: string }
  | { k: 'fx'; scope: FxScope; instId: string; input: string }
  | { k: 'meta'; knob: number }
  | { k: 'lay'; layer: number; field: LayField }
  | { k: 'bg'; field: 'opacity' | 'speed' | 'depth' }
  | { k: 'unit'; scope: FxScope; instId: string }
  | { k: 'slot'; layer: number; slot: 'A' | 'B' }
  | { k: 'mod'; n: number }

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
      if (layer < 0 || (p[2] !== 'A' && p[2] !== 'B')) return null
      // (no input : the whole slot)
      if (p.length === 3) return { k: 'slot', layer, slot: p[2] }
      return !p[3] ? null : { k: 'src', layer, slot: p[2], input: p.slice(3).join(':') }
    }
    case 'mod': {
      const n = idx(p[1])
      return n < 0 || p.length !== 2 ? null : { k: 'mod', n }
    }
    case 'fxunit': {
      if (p[1] === 'master' || p[1] === 'background') {
        const instId = p.slice(2).join(':')
        return instId ? { k: 'unit', scope: { kind: p[1] }, instId } : null
      }
      const layer = idx(p[2])
      const instId = p.slice(3).join(':')
      if ((p[1] !== 'layer' && p[1] !== 'sourceA' && p[1] !== 'sourceB') || layer < 0 || !instId) return null
      return { k: 'unit', scope: { kind: p[1], layer }, instId }
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

// A pinned Meta knob's destination, still the same control in the arriving
// composition : the same source in its slot, the same effect unit (a layer's
// own controls, the Background's, Sonify, the dome... always there). Elsewhere
// it would seize another source's input of the same name, or hold nothing.
function destHolds(c: CompositionState, live: CompositionState, t: ModTarget): boolean {
  switch (t.kind) {
    case 'source': {
      const prop = t.slot === 'A' ? 'sourceA' : 'sourceB'
      return sameSource(c.layers[t.layer]?.[prop], live.layers[t.layer]?.[prop])
    }
    case 'bgSource':
      return sameSource(c.background?.source, live.background?.source)
    case 'fx': {
      const to = chainOf(c, t.scope)?.find((f) => f.id === t.instId)
      const from = chainOf(live, t.scope)?.find((f) => f.id === t.instId)
      return !!to && (!from || to.shaderId === from.shaderId)
    }
    case 'layer':
      return !!c.layers[t.layer]
    case 'bg':
      return !!c.background
    default:
      return true
  }
}

const sameDests = (a: readonly ModTarget[], b: readonly ModTarget[]): boolean =>
  a === b || (a.length === b.length && a.every((t, i) => modTargetKey(t) === modTargetKey(b[i])))

const sameKnob = (a: MetaKnobState, b: MetaKnobState): boolean =>
  a === b ||
  (a.name === b.name && a.value === b.value && a.smoothMs === b.smoothMs && a.curve === b.curve &&
    (a.midiCc?.channel ?? -1) === (b.midiCc?.channel ?? -1) && (a.midiCc?.number ?? -1) === (b.midiCc?.number ?? -1) &&
    sameDests(a.destinations, b.destinations))

// The same binding, whatever the object (a scene's copy, the live one).
const sameRow = (a: ModAssignment, b: ModAssignment): boolean =>
  a === b ||
  (a.id === b.id && a.mod === b.mod && a.depth === b.depth && (a.mode ?? 'replace') === (b.mode ?? 'replace') &&
    !!a.muted === !!b.muted && modTargetKey(a.target) === modTargetKey(b.target) &&
    JSON.stringify(a.shape ?? null) === JSON.stringify(b.shape ?? null))

// A pinned Context or film key is yours, not the World's : the World amount
// fades on it what it faded there before (the arriving World's or scene's own
// change would else pull the pinned value away below amount 1). A composition
// from before the change was kept (worldBase alone) just lets the key go.
function withWorldKey(c: CompositionState, live: CompositionState, k: string): CompositionState {
  const legacy = !!c.worldBase && !c.worldShift
  const pick = (to: Record<string, number> | undefined, from: Record<string, number> | undefined): Record<string, number> | undefined => {
    const has = !legacy && !!from && k in from
    if (has ? to?.[k] === from![k] : !to || !(k in to)) return to
    const next = { ...(to ?? {}) }
    if (has) next[k] = from![k]
    else delete next[k]
    return next
  }
  const worldBase = pick(c.worldBase, live.worldBase)
  const worldShift = legacy ? c.worldShift : pick(c.worldShift, live.worldShift)
  return worldBase === c.worldBase && worldShift === c.worldShift ? c : { ...c, worldBase, worldShift }
}

// ...every such key of a whole pinned Context or Finalizer.
function withWorldKeys(c: CompositionState, live: CompositionState, shaderId: string): CompositionState {
  const keys = new Set([c.worldBase, c.worldShift, live.worldBase, live.worldShift].flatMap((r) => (r ? Object.keys(r) : [])))
  if (!keys.size) return c
  const names = new Set(inputsForShader(shaderId).map((d) => d.name))
  for (const k of keys) if (names.has(k)) c = withWorldKey(c, live, k)
  return c
}

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
      // (wherever that is still the same control : see destHolds)
      const from = live.metaKnobs[p.knob]
      const to = c.metaKnobs[p.knob]
      if (!from || !to) return { c, applied: false }
      const destinations = from.destinations.filter((t) => destHolds(c, live, t))
      const knob = destinations.length === from.destinations.length ? from : { ...from, destinations }
      if (sameKnob(to, knob)) return { c, applied: true }
      return { c: { ...c, metaKnobs: c.metaKnobs.map((k, i) => (i === p.knob ? knob : k)) }, applied: true }
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
    case 'unit': {
      // the whole effect, at the place it has now (see the head of this file)
      const liveChain = chainOf(live, p.scope)
      const from = liveChain?.find((f) => f.id === p.instId)
      const chain = chainOf(c, p.scope)
      if (!liveChain || !from || !chain || !hostsRack(c, p.scope)) return { c, applied: false }
      const here = chain.findIndex((f) => f.id === p.instId)
      if (from.locked) {
        // a finishing unit : always there, never moved (adoptLockedIds gave it the live id)
        if (here < 0) return { c, applied: false }
        if (chain[here] === from || sameDeep(chain[here], from)) return { c, applied: true }
        return { c: withChain(c, p.scope, chain.map((f, j) => (j === here ? from : f))), applied: true }
      }
      const rest = here < 0 ? chain : chain.filter((f) => f.id !== p.instId)
      const lockedAt = rest.findIndex((f) => f.locked)
      const at = Math.min(liveChain.indexOf(from), lockedAt >= 0 ? lockedAt : rest.length)
      if (here === at && (chain[here] === from || sameDeep(chain[here], from))) return { c, applied: true }
      return { c: withChain(c, p.scope, [...rest.slice(0, at), from, ...rest.slice(at)]), applied: true }
    }
    case 'slot': {
      // the whole slot : the source as it is and its effect rack
      const to = c.layers[p.layer]
      const from = live.layers[p.layer]
      if (!to || !from) return { c, applied: false }
      const prop = p.slot === 'A' ? 'sourceA' : 'sourceB'
      const rack = p.slot === 'A' ? 'sourceAFx' : 'sourceBFx'
      const src = to[prop] === from[prop] || sameDeep(to[prop], from[prop])
      const fx = to[rack] === from[rack] || sameDeep(to[rack], from[rack])
      if (src && fx) return { c, applied: true }
      return { c: withLayer(c, p.layer, { ...to, [prop]: from[prop], [rack]: from[rack] }), applied: true }
    }
    case 'mod': {
      // the card's configuration (its bindings follow their own rules)
      const from = live.modulators[p.n]
      const to = c.modulators[p.n]
      if (!from || !to) return { c, applied: false }
      if (to === from || sameDeep(to, from)) return { c, applied: true }
      return { c: { ...c, modulators: c.modulators.map((m, i) => (i === p.n ? from : m)) }, applied: true }
    }
  }
}

// What a whole pin holds a mod target under : an effect pinned whole, or the
// source slot it belongs to (its own inputs, its rack's effects).
function heldWhole(t: ModTarget, has: (key: string) => boolean): boolean {
  if (t.kind === 'source') return has(slotPin(t.layer, t.slot))
  if (t.kind !== 'fx') return false
  if (has(unitPin(t.scope, t.instId))) return true
  return (t.scope.kind === 'sourceA' || t.scope.kind === 'sourceB') && has(slotPin(t.scope.layer, t.scope.kind === 'sourceA' ? 'A' : 'B'))
}

// The finishing units (Vibe, Context, Finalizer : one of each, always there)
// are the same unit whatever their id, but a Generate builds them anew. When
// something on one is pinned (or a pinned Meta knob goes there), the arriving
// one takes the live one's id (its modulation rows follow), so the pin holds
// now and at every recall after.
function adoptLockedIds(c: CompositionState, live: CompositionState, pins: readonly string[]): CompositionState {
  const ren = new Map<string, string>()
  const knobs = parsedOf(pins).flatMap(([, p]) => (p.k === 'meta' && live.metaKnobs[p.knob] ? [live.metaKnobs[p.knob]] : []))
  const knobOn = (id: string): boolean =>
    knobs.some((k) => k.destinations.some((t) => t.kind === 'fx' && t.scope.kind === 'master' && t.instId === id))
  for (const u of live.master) {
    if (!u.locked || !(pins.some((k) => k.startsWith(`fx:master:${u.id}:`) || k === `fxunit:master:${u.id}`) || knobOn(u.id))) continue
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

// The pins parsed, kept while the pin list is the same array (the scene pad
// grafts on every frame).
let parsedKeys: readonly string[] | null = null
let parsedPins: Array<[string, Pin]> = []
function parsedOf(pins: readonly string[]): Array<[string, Pin]> {
  if (pins !== parsedKeys) {
    parsedPins = []
    for (const key of pins) {
      const p = parsePin(key)
      if (p) parsedPins.push([key, p])
    }
    parsedKeys = pins
  }
  return parsedPins
}

// The order pins land in : whole slots first, then whole effects (in their rack's
// order, so each lands at its own place), then the controls (they find what the
// whole pins put there); whole layers after them, they hold the layer whatever
// its own pins did; the Meta knobs last, their destinations checked on what is
// then there.
const RANK: Record<Pin['k'], number> = { slot: 0, unit: 1, src: 2, bgsrc: 2, fx: 2, lay: 2, bg: 2, mod: 2, layer: 3, meta: 4 }

/** The pins onto an arriving composition, which of them applied (a control on
 *  an effect the arriving composition lacks, or on a source it plays something
 *  else in, has nothing to hold), and how many of the arriving composition's
 *  own rows and Meta destinations had to give way to the pinned ones (a full
 *  matrix). */
export function graftPins(incoming: CompositionState, live: CompositionState, pins: readonly string[]): { comp: CompositionState; applied: Set<string>; cut: number } {
  const applied = new Set<string>()
  if (!pins.length) return { comp: incoming, applied, cut: 0 }
  let c = adoptLockedIds(incoming, live, pins)
  const layers = new Set<number>()
  const parsed = parsedOf(pins)
  const order = (p: Pin): number =>
    RANK[p.k] * 1000 + (p.k === 'unit' ? Math.max(0, chainOf(live, p.scope)?.findIndex((f) => f.id === p.instId) ?? 0) : 0)
  const sorted = parsed.length > 1 ? [...parsed].sort((a, b) => order(a[1]) - order(b[1])) : parsed
  let wholes = false // (a whole effect or source applied : its rows are held too)
  let rows = false // (anything but a modulator card : rows or Meta destinations to hold)
  for (const [key, p] of sorted) {
    const r = graftOne(c, live, p)
    c = r.c
    if (r.applied) {
      applied.add(key)
      if (p.k !== 'mod') rows = true
      if (p.k === 'unit' || p.k === 'slot') wholes = true
      if (p.k === 'layer') layers.add(p.layer)
      // a pinned Context / film key : what the World amount fades there too
      if ((p.k === 'fx' || p.k === 'unit') && p.scope.kind === 'master') {
        const u = c.master.find((f) => f.id === p.instId)
        if (u?.shaderId === 'fx-context' || u?.shaderId === 'fx-finalizer') c = p.k === 'fx' ? withWorldKey(c, live, p.input) : withWorldKeys(c, live, u.shaderId)
      }
    }
  }
  if (!rows) return { comp: c, applied, cut: 0 }

  // Their modulation : a pinned control keeps its own rows, a pinned layer, a
  // pinned effect or source all of their own (the arriving ones on them go). A
  // pinned Meta knob already came whole, its destinations with it. Nothing is
  // rebuilt when the arriving rows there are already the same (a scene saved
  // with them).
  let cut = 0
  const has = (k: string): boolean => applied.has(k)
  // (a color's parts are held by the color's own pin : controlKey)
  const held = (t: ModTarget): boolean => applied.has(controlKey(t)) || layers.has(layerOf(t)) || (wholes && heldWhole(t, has))
  const kept = c.modMatrix.filter((a) => !held(a.target))
  const carried = live.modMatrix.filter((a) => held(a.target))
  const arrived = c.modMatrix.filter((a) => held(a.target))
  const sameRows = arrived.length === carried.length && carried.every((a) => arrived.some((b) => sameRow(a, b)))
  if (!sameRows) {
    // (over the cap, the arriving rows give way : the pinned ones are yours)
    const room = Math.max(0, MAX_MOD_ASSIGNMENTS - carried.length)
    cut += Math.max(0, kept.length - room)
    c = { ...c, modMatrix: [...kept.slice(0, room), ...carried] }
  }
  const pinnedKnob = (i: number): boolean => applied.has(`meta:${i}`)
  let knobsChanged = false
  const metaKnobs = c.metaKnobs.map((k: MetaKnobState, i: number): MetaKnobState => {
    if (pinnedKnob(i)) return k
    const dest = k.destinations.filter((t) => !held(t))
    const add = (live.metaKnobs[i]?.destinations ?? []).filter(held)
    const here = k.destinations.filter(held)
    if (here.length === add.length && add.every((t) => here.some((h) => modTargetKey(h) === modTargetKey(t)))) return k
    knobsChanged = true
    const room = Math.max(0, META_MAX_DESTS - add.length)
    cut += Math.max(0, dest.length - room)
    return { ...k, destinations: [...dest.slice(0, room), ...add] }
  })
  if (knobsChanged) c = { ...c, metaKnobs }
  return { comp: c, applied, cut }
}

/** The same value, deep (what a graft rebuilt can still be what a scene held). */
export function sameDeep(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  return ka.length === kb.length && ka.every((k) => sameDeep((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/** The gate : an arriving composition with the pins held from the live one. */
export function keepPersistent(incoming: CompositionState, live: CompositionState, pins: readonly string[]): CompositionState {
  return pins.length ? graftPins(incoming, live, pins).comp : incoming
}

/** Does a mod target (a randomized binding's, a control's) sit under a pin ? */
export function isPinnedTarget(t: ModTarget, pins: readonly string[]): boolean {
  if (!pins.length) return false
  return pins.includes(controlKey(t)) || pins.includes(layerPin(layerOf(t))) || heldWhole(t, (k) => pins.includes(k))
}

/** An effect moved by hand into another rack (same id) : the pins on it go with
 *  it, the whole unit's and its controls' (its rows and Meta destinations do). */
export function movePins(pins: string[], from: FxScope, to: FxScope, instId: string): string[] {
  const unit = unitPin(from, instId)
  const head = `fx:${rackKey(from)}:${instId}:`
  if (!pins.some((k) => k === unit || k.startsWith(head))) return pins
  const toHead = `fx:${rackKey(to)}:${instId}:`
  return pins.map((k) => (k === unit ? unitPin(to, instId) : k.startsWith(head) ? toHead + k.slice(head.length) : k))
}

/** Which of one unit's inputs sit under a pin : its own dice and its reset
 *  leave them (a dice is a randomize; a preset picked by hand still moves them). */
export function pinnedInputs(target: ((input: string) => ModTarget) | undefined, pins: readonly string[]): (input: string) => boolean {
  return (input) => !!target && isPinnedTarget(target(input), pins)
}

/** A unit's next inputs with the pinned ones as they are now (a reset). */
export function holdPinnedInputs<T>(next: Record<string, T>, cur: Record<string, T>, held: (input: string) => boolean): Record<string, T> {
  let out: Record<string, T> | null = null
  for (const k of new Set([...Object.keys(next), ...Object.keys(cur)])) {
    if (!held(k)) continue
    out ??= { ...next }
    if (Object.prototype.hasOwnProperty.call(cur, k)) out[k] = cur[k]
    else delete out[k]
  }
  return out ?? next
}

// Can a rack hold an effect here (a source rack : only on a slot that plays).
function hostsRack(c: CompositionState, s: FxScope): boolean {
  if (s.kind === 'master') return true
  if (s.kind === 'background') return !!c.background
  const l = c.layers[s.layer]
  if (!l || s.kind === 'layer') return !!l
  const slot = s.kind === 'sourceA' ? l.sourceA : l.sourceB
  return !!slot && slot.kind !== 'none'
}

/** A dice that deals racks anew keeps the pinned effects where they sat, with
 *  their modulation, and deals the rest around them (a pinned control on a unit
 *  the dice threw away would hold nothing). Before keepPersistent, which then
 *  holds their values (and a whole pinned effect whole). */
export function keepPinnedUnits(incoming: CompositionState, live: CompositionState, pins: readonly string[]): CompositionState {
  let c = incoming
  const back = new Set<string>()
  for (const key of pins) {
    const p = parsePin(key)
    if (!p || (p.k !== 'fx' && p.k !== 'unit') || back.has(p.instId)) continue
    const from = chainOf(live, p.scope)
    const unit = from?.find((f) => f.id === p.instId)
    const chain = chainOf(c, p.scope)
    if (!from || !unit || unit.locked || !chain || chain.some((f) => f.id === unit.id) || !hostsRack(c, p.scope)) continue
    // (the same effect freshly dealt beside it goes : a dealt rack never repeats one)
    const rest = chain.filter((f) => f.locked || back.has(f.id) || f.shaderId !== unit.shaderId)
    const lockedAt = rest.findIndex((f) => f.locked)
    const at = Math.min(from.indexOf(unit), lockedAt >= 0 ? lockedAt : rest.length)
    c = withChain(c, p.scope, [...rest.slice(0, at), unit, ...rest.slice(at)])
    back.add(unit.id)
  }
  if (!back.size) return c
  const has = new Set(c.modMatrix.map((a) => a.id))
  const rows = live.modMatrix.filter((a) => a.target.kind === 'fx' && back.has(a.target.instId) && !has.has(a.id))
  const room = Math.max(0, MAX_MOD_ASSIGNMENTS - c.modMatrix.length)
  return rows.length && room ? { ...c, modMatrix: [...c.modMatrix, ...rows.slice(0, room)] } : c
}

const LAY_WORDS: Record<LayField, string> = { opacity: 'opacity', mix: 'A·B mix', blend: 'blend', harmony: 'A·B hue', speed: 'speed' }
// (the Background's depth is its contact shadow on screen)
const BG_WORDS: Record<'opacity' | 'speed' | 'depth', string> = { opacity: 'opacity', speed: 'speed', depth: 'shadow' }

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
      return { label: `Background ${BG_WORDS[p.field]}`, here: !!live.background }
    case 'meta':
      return { label: `Meta ${p.knob + 1}${live.metaKnobs[p.knob]?.name ? ` (${live.metaKnobs[p.knob].name})` : ''}`, here: !!live.metaKnobs[p.knob] }
    case 'src': {
      const s = live.layers[p.layer]?.[p.slot === 'A' ? 'sourceA' : 'sourceB']
      return { label: `L${p.layer + 1} ${p.slot} · ${slotWords(s)} · ${inputLabel(s?.shaderId, p.input)}`, here: !!s && s.kind !== 'none' && (!s.shaderId || inputsForShader(s.shaderId).some((d) => d.name === p.input)) }
    }
    case 'bgsrc': {
      const s = live.background?.source
      return {
        label: `Background · ${shaderName(s?.shaderId)} · ${inputLabel(s?.shaderId, p.input)}`,
        here: !!s?.shaderId && inputsForShader(s.shaderId).some((d) => d.name === p.input)
      }
    }
    case 'fx': {
      const u = chainOf(live, p.scope)?.find((f) => f.id === p.instId)
      return { label: `${rackWords(p.scope)} · ${u ? shaderName(u.shaderId) : 'a removed effect'} · ${inputLabel(u?.shaderId, p.input)}`, here: !!u }
    }
    case 'unit': {
      const u = chainOf(live, p.scope)?.find((f) => f.id === p.instId)
      return { label: `${rackWords(p.scope)} · ${u ? shaderName(u.shaderId) : 'a removed effect'}, the whole effect`, here: !!u }
    }
    case 'slot': {
      const s = live.layers[p.layer]?.[p.slot === 'A' ? 'sourceA' : 'sourceB']
      return { label: `L${p.layer + 1} ${p.slot} · ${slotWords(s)}, the whole source`, here: !!live.layers[p.layer] }
    }
    case 'mod': {
      const m = live.modulators[p.n]
      return { label: `M${p.n + 1}${m ? ` (${m.type})` : ''}, the modulator`, here: !!m }
    }
  }
}

const rackWords = (s: FxScope): string =>
  s.kind === 'master' ? 'Master' : s.kind === 'background' ? 'Background FX' : `L${s.layer + 1} ${s.kind === 'layer' ? 'FX' : s.kind === 'sourceA' ? 'A fx' : 'B fx'}`

// What a slot plays, in a word or two : its generator, its film, else its kind
function slotWords(s: SourceSlot | null | undefined): string {
  if (s?.shaderId) return shaderName(s.shaderId)
  return s?.kind && s.kind !== 'none' ? s.mediaName || s.kind : 'empty'
}
