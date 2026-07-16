// Randomize : the Rhodopsin button, done right (brief §7). STRUCTURAL:
// each scope doesn't just re-roll parameters, it (re)builds its targets —
// picks generators per layer, builds FX racks of random length, enables a
// random number of modulators and rolls a fresh mod-matrix. One press =
// a new instrument state (and one undo step).
//
// Taste guardrails: every float draw comes from the shader's CURATED
// aesthetic sub-range; colors stay matte (bounded S/V); Interference-style
// risks are pre-bounded in the registry; the mod-matrix respects its cap.

import type {
  BackgroundState,
  CompositionState,
  FxInstance,
  FxScope,
  LayerMask,
  LayerState,
  LfoShape,
  ModAssignment,
  ModCurve,
  ModTarget,
  ModulatorConfig,
  ModulatorType,
  SidechainRef,
  SourceSlot
} from '@shared/types'
import { MAX_MOD_ASSIGNMENTS, WORLD_AUTOMOD_SLOT } from '@shared/types'
import { curatedRange, FX_SHADERS, GENERATORS, NATIVE_NODES } from './shaders/isf'
import { inputsForShader, type IsfInputDesc } from './shaders/isf/inputs'
import { BG_SOURCES, BG_DEFAULT_SPEED } from './bgPresets'

export type RandomizeScope =
  | 'all'
  | 'sources'
  | 'sourceparams'
  | 'sourcefx'
  | 'sourcefxonly' // rebuild ONLY the source FX racks (keep sources)
  | 'layerfxonly' // rebuild ONLY the per-layer FX racks
  | 'layer'
  | 'master'
  | 'finishing' // re-roll the three finalizers' params (Vibe/Context/Finalizer)
  | 'modulators'
  | 'meta' // handled in the UI layer (needs the knob smoother), not here

const rnd = (): number => Math.random()
const range = (lo: number, hi: number): number => lo + rnd() * (hi - lo)

// Brightness-critical finalizer params, held to tight NEUTRAL bands during a
// Finishing randomize so the master output can't crush to black or blow out.
// Everything else on these shaders (tints, split-tone, posterize, saturation,
// dither, sharpen, blur, trails, atmosphere hue) still randomizes freely.
const FINISHING_SAFE: Record<string, Record<string, [number, number]>> = {
  'fx-finalizer': {
    black: [0.0, 0.04], // small shadow lift only : never a hard crush
    white: [0.95, 1.0], // stay near full white : never dim the highlights
    gamma: [0.9, 1.15], // gentle either way
    rGain: [0.92, 1.1], // near-unity per-channel gain (mild tint, stable luma)
    gGain: [0.92, 1.1],
    bGain: [0.92, 1.1],
    alpha: [1.0, 1.0]
  },
  'fx-vibe': {
    gamma: [0.9, 1.15],
    contrast: [0.9, 1.25],
    autoLevel: [0.0, 0.5] // auto-levels normalizes : safe, but keep it moderate
  },
  'fx-context': {
    bloom: [0.0, 0.35], // capped so highlights don't bloom to white
    lightGlow: [0.0, 0.2],
    haze: [0.0, 0.28], // haze washes toward its colour : keep it light
    depth: [0.0, 0.5], // depth vignette darkens edges : cap it
    voidEdge: [0.0, 0.35] // the void eats the frame : keep a dice-roll shallow
  }
}
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]
const chance = (p: number): boolean => rnd() < p
const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

// Restrained color register: any hue, bounded saturation/value : matte.
function randomColor(alpha: number): number[] {
  const h = rnd() * 360
  const s = range(0.35, 0.85)
  const v = range(0.45, 0.9)
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [r + m, g + m, b + m, alpha]
}

// ── Parameter draws (curated) ─────────────────────────────────────────
function randomizeOneInput(
  shaderId: string,
  d: IsfInputDesc,
  current: number | number[] | undefined
): number | number[] {
  switch (d.type) {
    case 'float': {
      const declared: [number, number] = [
        typeof d.min === 'number' ? d.min : 0,
        typeof d.max === 'number' ? d.max : 1
      ]
      const [lo, hi] = curatedRange(shaderId, d.name, declared)
      return range(lo, hi)
    }
    case 'event':
      // Momentary triggers : never randomized (a dice must not leave one stuck ON).
      return typeof current === 'number' ? current : typeof d.def === 'number' ? d.def : 0
    case 'bool': {
      const cur = typeof current === 'number' ? current : typeof d.def === 'number' ? d.def : 0
      return chance(0.3) ? (cur >= 0.5 ? 0 : 1) : cur
    }
    case 'long': {
      const values = d.values ?? []
      if (values.length === 0)
        return typeof current === 'number' ? current : ((d.def as number) ?? 0)
      const cur = typeof current === 'number' ? current : ((d.def as number) ?? values[0])
      return chance(0.4) ? pick(values) : cur
    }
    case 'color': {
      const cur = Array.isArray(current) ? current : Array.isArray(d.def) ? d.def : [1, 1, 1, 1]
      return randomColor(cur[3] ?? 1)
    }
    case 'point2D': {
      const min = Array.isArray(d.min) ? d.min : [0, 0]
      const max = Array.isArray(d.max) ? d.max : [1, 1]
      return [range(min[0], max[0]), range(min[1], max[1])]
    }
    default:
      return current ?? 0
  }
}

/** Randomize every input of one shader within curated ranges : used by
 *  Randomize scopes and by the Inspector's ⚄ button. */
// Params Randomize must never touch (like the Text source): the Context PBR
// surface is a deliberate staging decision, not a texture to dice-roll.
const RANDOMIZE_SKIP: Record<string, RegExp> = { 'fx-context': /^(pbr|lightOrder$)/ }

export function randomizeInputs(
  shaderId: string,
  current: Record<string, number | number[]>
): Record<string, number | number[]> {
  const out: Record<string, number | number[]> = { ...current }
  const skip = RANDOMIZE_SKIP[shaderId]
  for (const d of inputsForShader(shaderId)) {
    if (skip?.test(d.name)) continue
    out[d.name] = randomizeOneInput(shaderId, d, current[d.name])
  }
  return out
}

// ── Structural builders ───────────────────────────────────────────────
// Native generators (Text) stay out of the random pool : they need user intent
// (a string, a sidechain), so a random draw would just say "OPSIA" at strangers.
const RANDOM_GENERATORS = GENERATORS.filter((g) => !g.native)
function randomSlot(): SourceSlot {
  const gen = pick(RANDOM_GENERATORS)
  return { kind: 'generator', shaderId: gen.id, inputs: randomizeInputs(gen.id, {}) }
}

function emptySlot(): SourceSlot {
  return { kind: 'none', shaderId: null, inputs: {} }
}

/** Draw a count from an explicit distribution (index = count). */
function drawCount(weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rnd() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return i
  }
  return weights.length - 1
}

// The convolution nodes are LAYER-FX only (they need a sidechain layer) and
// heavy, so they join the random pool only for the per-layer FX rack, capped to
// one per rack, each handed a random sidechain layer so they actually do work.
const CONV_NODE_IDS = ['node-convolve', 'node-transfert']
const CONV_NODES = NATIVE_NODES.filter((n) => CONV_NODE_IDS.includes(n.id))
// The self-contained native nodes need no sidechain, so they join the random pool
// for EVERY rack (not just layer FX). They're `native`, so they share the "≤1
// native node per rack" cap below. (node-parallax is excluded : inert without the
// Depth engine.)
const SELF_NODE_IDS = [
  'node-reponse', 'node-datamosh', 'node-feedback', 'node-chronoscan', 'node-sediment',
  'node-scanner', 'node-autocutter', 'node-eternalism', 'node-afterimage',
  'node-pulfrich', 'node-corrode', 'node-decimate'
]
const SELF_NODES = NATIVE_NODES.filter((n) => SELF_NODE_IDS.includes(n.id))
const randSidechain = (): SidechainRef => ({ kind: 'layer', layer: Math.floor(rnd() * 4) })

/** Build a rack of n DISTINCT random FX, each with randomized params.
 *  `includeConv` (layer FX only) also draws the convolution nodes. */
function randomRack(
  countWeights: number[],
  endWithColor = false,
  exclude: string[] = [],
  includeConv = false
): FxInstance[] {
  const n = drawCount(countWeights)
  const pool = [...FX_SHADERS, ...SELF_NODES, ...(includeConv ? CONV_NODES : [])].filter((f) => !exclude.includes(f.id))
  const picked: typeof FX_SHADERS = []
  let convUsed = 0
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(rnd() * pool.length)
    const s = pool[idx]
    pool.splice(idx, 1)
    if (s.native) {
      if (convUsed >= 1) continue // heavy : at most one convolution node per rack
      convUsed++
    }
    picked.push(s)
  }
  // Master-rack habit: often close the chain with a unifying color pass.
  // Guarded so the rack never exceeds the requested maximum length.
  if (
    endWithColor &&
    n > 0 &&
    picked.length < countWeights.length - 1 &&
    chance(0.6) &&
    !picked.some((p) => p.id === 'fx-palette' || p.id === 'fx-grade')
  ) {
    picked.push(pick(FX_SHADERS.filter((f) => f.id === 'fx-palette' || f.id === 'fx-grade')))
  }
  return picked.map((s) => ({
    id: uid(),
    shaderId: s.id,
    enabled: true,
    inputs: randomizeInputs(s.id, {}),
    // A random sidechain layer when a convolution node lands, so it isn't inert.
    ...(s.native ? { sidechain: randSidechain() } : {})
  }))
}

// ── Modulators (structural) ───────────────────────────────────────────
const RAND_SHAPES: LfoShape[] = [
  'sine', 'triangle', 'square', 'sawtooth', 'rndStep', 'rndSmooth', 'spastic'
]
const RAND_CURVES: ModCurve[] = [
  'linear', 'easeIn', 'easeOut', 'sigmoid', 'smoothstep', 'step', 'gamma', 'sqrt'
]
// Weighted toward the continuously interesting types.
const TYPE_POOL: ModulatorType[] = [
  'lfo', 'lfo', 'lfo', 'sh', 'sh', 'chaos', 'chaos', 'random', 'slew', 'arp', 'ramp', 'adsr'
]

function freshModulator(base: ModulatorConfig, enabled: boolean): ModulatorConfig {
  return {
    ...base,
    enabled,
    type: pick(TYPE_POOL),
    sync: chance(0.35) ? 'bpm' : 'free',
    rateHz: Math.pow(10, range(Math.log10(0.05), Math.log10(4))),
    divisionIdx: Math.floor(range(3, 9)),
    shape: pick(RAND_SHAPES),
    curve: chance(0.5) ? pick(RAND_CURVES) : 'linear',
    ramp: { ...base.ramp, rampMs: range(500, 20000), curvePct: range(-80, 80), mode: 'loop' },
    adsr: {
      ...base.adsr,
      attackMs: range(50, 4000),
      decayMs: range(100, 4000),
      sustainMs: range(200, 8000),
      releaseMs: range(100, 6000),
      sustainLevel: range(0.3, 0.9),
      loop: true
    },
    arp: {
      steps: Math.floor(range(3, 13)),
      mode: pick(['up', 'down', 'upDown', 'random', 'drunk'] as const)
    },
    random: { distribution: range(0.2, 0.8) },
    sh: { ...base.sh, probability: range(0.5, 1), distribution: range(0.2, 0.8) },
    slew: {
      ...base.slew,
      riseMs: Math.pow(10, range(Math.log10(50), Math.log10(2000))),
      fallMs: Math.pow(10, range(Math.log10(50), Math.log10(2000)))
    },
    chaos: { r: range(3.5, 4) }
  }
}

/** Every modulatable float input in the current composition (source + FX). */
export function collectFloatTargets(c: CompositionState): ModTarget[] {
  const out: ModTarget[] = []
  const addFxTargets = (fx: FxInstance[], scope: FxScope): void => {
    for (const inst of fx) {
      if (!inst.shaderId) continue
      for (const d of inputsForShader(inst.shaderId)) {
        if (d.type === 'float') out.push({ kind: 'fx', scope, instId: inst.id, input: d.name })
      }
    }
  }
  c.layers.forEach((l, li) => {
    if (l.sourceA.shaderId) {
      for (const d of inputsForShader(l.sourceA.shaderId)) {
        if (d.type === 'float') out.push({ kind: 'source', layer: li, slot: 'A', input: d.name })
      }
    }
    if (l.sourceB?.shaderId) {
      for (const d of inputsForShader(l.sourceB.shaderId)) {
        if (d.type === 'float') out.push({ kind: 'source', layer: li, slot: 'B', input: d.name })
      }
    }
    addFxTargets(l.sourceAFx, { kind: 'sourceA', layer: li })
    addFxTargets(l.sourceBFx, { kind: 'sourceB', layer: li })
    addFxTargets(l.fx, { kind: 'layer', layer: li })
  })
  // Context is deliberately excluded from random modulation targets : it's the
  // depth finalizer and too powerful to be re-rolled by the Randomizer.
  addFxTargets(c.master.filter((f) => f.shaderId !== 'fx-context'), { kind: 'master' })
  return out
}

function targetKey(t: ModTarget): string {
  if (t.kind === 'source') return `src:${t.layer}:${t.slot}:${t.input}`
  if (t.kind === 'bgSource') return `bgsrc:${t.input}`
  if (t.kind === 'meta') return `meta:${t.knob}`
  const s = t.scope
  return `fx:${s.kind === 'master' || s.kind === 'background' ? s.kind : `${s.kind}:${s.layer}`}:${t.instId}:${t.input}`
}

/** Does this target land on layer `li` (its sources or any of its racks)? */
function targetOnLayer(t: ModTarget, li: number): boolean {
  if (t.kind === 'source') return t.layer === li
  if (t.kind !== 'fx') return false
  const s = t.scope
  return s.kind !== 'master' && s.kind !== 'background' && s.layer === li
}

/** Roll a fresh matrix: 1–2 assignments per enabled mod, capped, deduped.
 *  Then GUARANTEE MOTION : every layer with an active source gets at least one
 *  assignment — a random draw that leaves a layer untargeted reads as a static,
 *  lifeless scene (the "Randomize feels dead" report). */
function randomMatrix(c: CompositionState): ModAssignment[] {
  const targets = collectFloatTargets(c)
  if (targets.length === 0) return []
  const out: ModAssignment[] = []
  const used = new Set<string>()
  const enabledMods: number[] = []
  c.modulators.forEach((m, mi) => {
    if (!m.enabled) return
    if (mi === WORLD_AUTOMOD_SLOT) return // reserved for the World's audio routing
    enabledMods.push(mi)
    const n = drawCount([0.1, 0.5, 0.4]) // 0..2 assignments per mod
    for (let i = 0; i < n; i++) {
      if (out.length >= MAX_MOD_ASSIGNMENTS) return
      const t = pick(targets)
      const key = `${mi}|${targetKey(t)}`
      if (used.has(key)) continue
      used.add(key)
      const sign = chance(0.25) ? -1 : 1
      // Randomize keeps the bipolar-swing feel it's always had → 'replace'.
      out.push({ id: uid(), mod: mi, target: t, depth: sign * range(0.2, 0.75), mode: 'replace' })
    }
  })
  // Coverage pass : hand every untargeted active layer one solid assignment.
  if (enabledMods.length > 0) {
    c.layers.forEach((l, li) => {
      if (out.length >= MAX_MOD_ASSIGNMENTS) return
      if (!l.sourceA.shaderId && !l.sourceB?.shaderId) return
      if (out.some((a) => targetOnLayer(a.target, li))) return
      const local = targets.filter((t) => targetOnLayer(t, li))
      if (local.length === 0) return
      for (let tries = 0; tries < 4; tries++) {
        const t = pick(local)
        const mi = pick(enabledMods)
        const key = `${mi}|${targetKey(t)}`
        if (used.has(key)) continue
        used.add(key)
        // A guaranteed-motion bond should be FELT : solid depth, mostly positive.
        const sign = chance(0.15) ? -1 : 1
        out.push({ id: uid(), mod: mi, target: t, depth: sign * range(0.35, 0.75), mode: 'replace' })
        break
      }
    })
  }
  return out
}

// ── The scoped randomizer ─────────────────────────────────────────────
// Tasteful subset of the 15 modes for random draws (dodge/burn stay manual —
// they blow out too easily for the matte register).
const BLENDS = [
  'normal', 'add', 'subtract', 'multiply', 'screen', 'overlay', 'softlight',
  'hardlight', 'darken', 'lighten', 'difference', 'exclusion', 'wrap'
] as const
// The A/B source mix can also use the relation modes (Weave / Lumakey / the
// stateful Consume). Only used for sourceBlend : as a layer-stack blend they'd
// fall through to normal.
const MIX_BLENDS = [...BLENDS, 'weave', 'lumakey', 'consume'] as const

// Occasionally give a layer a spatial mask (mostly none). Keeps the register
// matte : gentle softness, generous shape size, so it windows rather than hides.
function randomMask(): LayerMask {
  const base: LayerMask = {
    mode: 0, invert: false, soft: 0.1, lumaLo: 0.2, lumaHi: 1,
    angle: 0, pos: 0.5, cx: 0.5, cy: 0.5, size: 0.4, aspect: 1, round: 1
  }
  if (!chance(0.15)) return base
  return {
    ...base,
    mode: pick([1, 2, 3]),
    invert: chance(0.3),
    soft: range(0.06, 0.3),
    lumaLo: range(0.1, 0.4),
    lumaHi: range(0.7, 1),
    angle: range(0, 6.283),
    pos: range(0.3, 0.7),
    cx: range(0.35, 0.65),
    cy: range(0.35, 0.65),
    size: range(0.3, 0.55),
    aspect: range(0.7, 1.5),
    round: pick([0, 1])
  }
}
// Activation odds by layer index : a full stack is possible, a duo is common.
const LAYER_ACTIVE_P = [0.95, 0.7, 0.45, 0.25]

/** Structural randomize of ONE layer (the layer dice / context-menu action):
 *  fresh source(s), fresh racks, blend/feedback : always active. OPACITY is the
 *  player's mix decision and survives the dice untouched. */
export function randomizeSingleLayer(l: LayerState): LayerState {
  const withB = chance(0.25)
  return {
    ...l,
    sourceA: randomSlot(),
    sourceB: withB ? randomSlot() : null,
    sourceAFx: randomRack([0.45, 0.4, 0.15]),
    sourceBFx: withB ? randomRack([0.55, 0.35, 0.1]) : [],
    fx: randomRack([0.35, 0.4, 0.2, 0.05], false, [], true),
    sourceMix: withB ? range(0.25, 0.75) : l.sourceMix,
    sourceBlend: withB ? pick(MIX_BLENDS) : l.sourceBlend,
    blend: pick(BLENDS),
    feedback: chance(0.3),
    feedbackAmount: range(0.3, 0.8),
    mute: false,
    mask: randomMask()
  }
}

/** Re-roll the Background slab (its own dice : the GLOBAL Randomize never
 *  touches the background: the ground stays put while the layers churn).
 *  Draws from the curated background source set; keeps opacity + speed +
 *  depth + blendMode (the user's framing of the ground survives the dice). */
export function randomizeBackground(cur: BackgroundState | undefined): BackgroundState {
  const gen = pick(BG_SOURCES)
  return {
    ...cur,
    source: { kind: 'generator', shaderId: gen.id, inputs: randomizeInputs(gen.id, {}) },
    fx: randomRack([0.45, 0.35, 0.2]),
    opacity: cur?.opacity ?? 1,
    speed: cur?.speed ?? BG_DEFAULT_SPEED
  }
}

/** A fresh "blank open" state: layer 1 gets random source(s) + FX (guaranteed
 *  at least one FX unit), the other three stay empty. A cold launch or the New
 *  button lands on a different living one-layer scene each time.
 *
 *  This path MUST carry the same guarantees as Randomize All (it used to skip
 *  them, which is why cold launches could land on a dead or black "first
 *  frame" : a static source, a dark blend over the near-black background, and
 *  no modulation = a frozen-looking boot):
 *   - the seed source is never a static-by-design generator (Solid Color);
 *   - the layer sits directly on the background, so its blend is stack-safe
 *     and its opacity solid;
 *   - 2 modulators + a small matrix guarantee visible motion. */
const SEED_STATIC_GENS = new Set(['solid-color'])
export function seedRandomStart(base: CompositionState): CompositionState {
  let l0 = randomizeSingleLayer(base.layers[0])
  // Never seed on a static source : re-draw A until it's a living generator.
  for (let tries = 0; tries < 8 && SEED_STATIC_GENS.has(l0.sourceA.shaderId ?? ''); tries++) {
    l0 = { ...l0, sourceA: randomSlot() }
  }
  // Guarantee some treatment : never open on a bare, unprocessed source.
  if (l0.sourceAFx.length + l0.sourceBFx.length + l0.fx.length === 0) {
    l0 = { ...l0, sourceAFx: randomRack([0, 1]) } // exactly one
  }
  // The seed layer composites straight onto the near-black background : a dark
  // blend there is the classic black-window draw. Stack-safe blend + solid
  // opacity, same rule as Randomize All's bottom layer.
  const SAFE_BOTTOM = ['normal', 'add', 'screen', 'lighten']
  if (!SAFE_BOTTOM.includes(l0.blend)) l0 = { ...l0, blend: pick(SAFE_BOTTOM) as LayerState['blend'] }
  l0 = { ...l0, opacity: Math.max(l0.opacity, 0.85) }
  let next: CompositionState = {
    ...base,
    layers: base.layers.map((l, i) =>
      i === 0
        ? l0
        : {
            ...l,
            sourceA: emptySlot(),
            sourceB: null,
            sourceAFx: [],
            sourceBFx: [],
            fx: [],
            mute: false
          }
    )
  }
  // Guaranteed motion : two fresh modulators + a small matrix over the seeded
  // layer, so the boot scene breathes even when the generator itself is slow.
  const slots = [0, 1, 2, 3, 4, 5, 6, 7].filter((s) => s !== WORLD_AUTOMOD_SLOT)
  const chosen = new Set([pick(slots), pick(slots)])
  next = {
    ...next,
    modulators: next.modulators.map((m, i) => (chosen.has(i) ? freshModulator(m, true) : m))
  }
  next = { ...next, modMatrix: randomMatrix(next) }
  return next
}

function randomizeStructural(
  c: CompositionState,
  scope: RandomizeScope
): CompositionState {
  let next = c

  // Source PARAMETERS only : keep the chosen generators, re-roll their ISF
  // inputs within curated ranges (unlike 'sources', which picks new ones).
  // Text is never touched by a global Randomize (its string / font / layout are
  // user intent) : only its own Inspector ⚄ re-rolls it.
  const paramSlot = (s: SourceSlot | null): SourceSlot | null =>
    s && s.shaderId && s.shaderId !== 'gen-text'
      ? { ...s, inputs: randomizeInputs(s.shaderId, s.inputs) }
      : s
  if (scope === 'sourceparams') {
    return {
      ...c,
      layers: c.layers.map((l) => ({
        ...l,
        sourceA: paramSlot(l.sourceA) as SourceSlot,
        sourceB: paramSlot(l.sourceB)
      }))
    }
  }

  // A slot carries a real source (generator OR video/capture) : used to gate FX.
  const slotActive = (s: SourceSlot | null | undefined): boolean =>
    !!s && s.kind !== 'none' && (s.kind !== 'generator' || !!s.shaderId)

  // Source FX racks only : new random chains over whatever sources exist.
  if (scope === 'sourcefxonly') {
    return {
      ...c,
      layers: c.layers.map((l) => ({
        ...l,
        sourceAFx: slotActive(l.sourceA) ? randomRack([0.45, 0.4, 0.15]) : l.sourceAFx,
        sourceBFx: slotActive(l.sourceB) ? randomRack([0.55, 0.35, 0.1]) : l.sourceBFx
      }))
    }
  }

  // Per-layer FX rack only.
  if (scope === 'layerfxonly') {
    return {
      ...c,
      layers: c.layers.map((l) => ({
        ...l,
        fx: slotActive(l.sourceA) || slotActive(l.sourceB) ? randomRack([0.35, 0.4, 0.2, 0.05], false, [], true) : l.fx
      }))
    }
  }

  // Finishing : re-roll the three pinned finalizers' params (Vibe · Context ·
  // Finalizer). CONTROLLED: the brightness-critical params (levels, gamma,
  // gains, bloom, haze) are held in tight neutral bands so the result can never
  // come out crushed-black or blown-out : only the "look" params roam freely.
  if (scope === 'finishing') {
    return {
      ...c,
      master: c.master.map((f) => {
        if (!f.locked || !f.shaderId) return f
        const inputs = randomizeInputs(f.shaderId, f.inputs)
        const safe = FINISHING_SAFE[f.shaderId]
        if (safe) for (const [k, [lo, hi]] of Object.entries(safe)) inputs[k] = range(lo, hi)
        return { ...f, inputs }
      })
    }
  }

  const doSources = scope === 'all' || scope === 'sources' || scope === 'sourcefx'
  const doSourceFx = scope === 'all' || scope === 'sourcefx'
  const doLayer = scope === 'all' || scope === 'layer'
  const doMaster = scope === 'all' || scope === 'master'
  const doMods = scope === 'all' || scope === 'modulators'

  if (doSources || doSourceFx || doLayer) {
    let anyActive = false
    let layers: LayerState[] = next.layers.map((l, li) => {
      let layer = l
      if (doSources) {
        // STRUCTURAL: decide whether this layer plays at all, then pick its
        // generator(s) fresh. Feedback buffers survive either way (brief §1).
        const active = chance(LAYER_ACTIVE_P[li] ?? 0.3)
        if (active) {
          anyActive = true
          const withB = chance(0.25)
          layer = {
            ...layer,
            sourceA: randomSlot(),
            sourceB: withB ? randomSlot() : null,
            sourceBFx: withB ? layer.sourceBFx : [],
            sourceMix: withB ? range(0.25, 0.75) : layer.sourceMix,
            sourceBlend: withB ? pick(MIX_BLENDS) : layer.sourceBlend,
            mute: false
          }
        } else {
          layer = { ...layer, sourceA: emptySlot(), sourceB: null, sourceAFx: [], sourceBFx: [] }
        }
      }
      if (doSourceFx) {
        layer = {
          ...layer,
          sourceAFx: layer.sourceA.shaderId ? randomRack([0.45, 0.4, 0.15]) : [],
          sourceBFx: layer.sourceB?.shaderId ? randomRack([0.55, 0.35, 0.1]) : []
        }
      }
      if (doLayer) {
        const hasSource = !!layer.sourceA.shaderId || !!layer.sourceB?.shaderId
        layer = {
          ...layer,
          fx: hasSource ? randomRack([0.35, 0.4, 0.2, 0.05], false, [], true) : [],
          blend: pick(BLENDS),
          opacity: range(0.55, 1),
          feedback: hasSource ? chance(0.3) : false,
          feedbackAmount: range(0.3, 0.8),
          sourceMix: layer.sourceB?.shaderId ? range(0.2, 0.8) : layer.sourceMix,
          speed: range(0.5, 1.5), // gentle : extreme speeds are a manual move
          mask: hasSource ? randomMask() : layer.mask
        }
      }
      return layer
    })
    // Never randomize into a black or near-empty stage : guarantee at least
    // TWO active layers. A solo layer over the untouched background reads as
    // empty far too often (the "Randomize comes out black" report).
    if (doSources) {
      void anyActive
      const isOn = (l: LayerState): boolean => !!l.sourceA.shaderId || !!l.sourceB?.shaderId
      let need = 2 - layers.filter(isOn).length
      if (need > 0) {
        layers = layers.map((l) => {
          if (need > 0 && !isOn(l)) {
            need--
            return { ...l, sourceA: randomSlot(), sourceAFx: randomRack([0.45, 0.4, 0.15]), mute: false }
          }
          return l
        })
      }
    }
    // The stack's FIRST visible layer sits directly on the background : a dark
    // blend there (multiply / darken / subtract...) is the classic black-window
    // draw. When the dice rolled the blends, force the bottom voice to a
    // stack-safe mode and a solid opacity so the scene always reads.
    if (doLayer) {
      const SAFE_BOTTOM = ['normal', 'add', 'screen', 'lighten']
      const fi = layers.findIndex((l) => (!!l.sourceA.shaderId || !!l.sourceB?.shaderId) && !l.mute)
      if (fi >= 0) {
        layers = layers.map((l, i) =>
          i === fi
            ? {
                ...l,
                blend: SAFE_BOTTOM.includes(l.blend) ? l.blend : (pick(SAFE_BOTTOM) as LayerState['blend']),
                opacity: Math.max(l.opacity, 0.75)
              }
            : l
        )
      }
    }
    next = { ...next, layers }
  }

  if (doMaster) {
    // Both pinned finalizers survive every randomize untouched : the Vibe
    // Palette is the user's look, and Context (depth) is too intense to re-roll.
    // Threshold is excluded from the MASTER pool: on a whole near-black
    // composition it can gate the entire output to black (the black-window
    // report); it stays available in layer/source racks where it carves.
    const locked = next.master.filter((f) => f.locked)
    next = {
      ...next,
      // Up to 8 distinct effects (index = count); peak around 3–4, long tail
      // out to a full 8-deep master chain.
      master: [
        ...randomRack([0, 0.12, 0.16, 0.18, 0.16, 0.14, 0.1, 0.08, 0.06], true, ['fx-threshold']),
        ...locked
      ]
    }
  }

  if (doMods) {
    // STRUCTURAL: enable a random number of modulators (2–5), fully re-roll
    // them (type included), and roll a fresh capped matrix over whatever
    // sources/FX exist at this point.
    const enabledCount = 2 + drawCount([0.25, 0.35, 0.3, 0.1]) // 2..5
    // Slot 8 (WORLD_AUTOMOD_SLOT) is reserved for the active World's audio
    // routing : leave it out of the randomizer so a World's bond survives.
    const slots = [0, 1, 2, 3, 4, 5, 6, 7].filter((s) => s !== WORLD_AUTOMOD_SLOT)
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      ;[slots[i], slots[j]] = [slots[j], slots[i]]
    }
    const chosen = new Set(slots.slice(0, enabledCount))
    const modulators = next.modulators.map((m, i) => freshModulator(m, chosen.has(i)))
    next = { ...next, modulators }
    next = { ...next, modMatrix: randomMatrix(next) }
  }

  return next
}

// ── Parameter JITTER (walk / variation) ───────────────────────────────
// Unlike the structural randomizer, jitter keeps the whole structure (which
// generators, which FX, which blends, which mod assignments) and only nudges
// CONTINUOUS values around where they already are. `amount` 0 = no change,
// 1 = a full-spread nudge (roughly the curated range). Shared by the Randomize
// intensity "walk" (low %) and the Variation button (baseline-anchored spread).
const clampN = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
const jn = (base: number, amount: number, span: number, lo: number, hi: number): number =>
  clampN(base + (rnd() * 2 - 1) * amount * span, lo, hi)

function jitterOneInput(
  shaderId: string,
  d: IsfInputDesc,
  base: number | number[] | undefined,
  amount: number
): number | number[] {
  switch (d.type) {
    case 'float': {
      const declaredLo = typeof d.min === 'number' ? d.min : 0
      const declaredHi = typeof d.max === 'number' ? d.max : 1
      const [lo, hi] = curatedRange(shaderId, d.name, [declaredLo, declaredHi])
      const b = typeof base === 'number' ? base : typeof d.def === 'number' ? d.def : lo
      return jn(b, amount, hi - lo, declaredLo, declaredHi)
    }
    case 'event':
      // Momentary triggers are never jittered (never leave one stuck ON).
      return typeof base === 'number' ? base : typeof d.def === 'number' ? d.def : 0
    case 'bool': {
      const cur = typeof base === 'number' ? base : typeof d.def === 'number' ? d.def : 0
      return chance(amount * 0.5) ? (cur >= 0.5 ? 0 : 1) : cur
    }
    case 'long': {
      const values = d.values ?? []
      const cur = typeof base === 'number' ? base : ((d.def as number) ?? values[0] ?? 0)
      return values.length && chance(amount * 0.4) ? pick(values) : cur
    }
    case 'color': {
      const c = Array.isArray(base) ? base : Array.isArray(d.def) ? d.def : [1, 1, 1, 1]
      // Nudge RGB within a matte envelope; hold alpha.
      return [
        clampN(c[0] + (rnd() * 2 - 1) * amount * 0.35, 0, 1),
        clampN(c[1] + (rnd() * 2 - 1) * amount * 0.35, 0, 1),
        clampN(c[2] + (rnd() * 2 - 1) * amount * 0.35, 0, 1),
        c[3] ?? 1
      ]
    }
    case 'point2D': {
      const min = Array.isArray(d.min) ? d.min : [0, 0]
      const max = Array.isArray(d.max) ? d.max : [1, 1]
      const b = Array.isArray(base) ? base : Array.isArray(d.def) ? d.def : [0, 0]
      return [
        jn(b[0], amount, max[0] - min[0], min[0], max[0]),
        jn(b[1], amount, max[1] - min[1], min[1], max[1])
      ]
    }
    default:
      return base ?? 0
  }
}

/** Nudge every input of one shader around its current value by `amount`. */
function jitterInputs(
  shaderId: string,
  base: Record<string, number | number[]>,
  amount: number
): Record<string, number | number[]> {
  const out: Record<string, number | number[]> = { ...base }
  for (const d of inputsForShader(shaderId)) out[d.name] = jitterOneInput(shaderId, d, base[d.name], amount)
  return out
}

function jitterSlot(slot: SourceSlot | null, amount: number): SourceSlot | null {
  // video/capture/hive/empty: nothing to nudge. Text: left to user intent.
  if (!slot || !slot.shaderId || slot.shaderId === 'gen-text') return slot
  return { ...slot, inputs: jitterInputs(slot.shaderId, slot.inputs, amount) }
}

function jitterFxArray(fx: FxInstance[], amount: number): FxInstance[] {
  return fx.map((f) => {
    if (!f.shaderId) return f
    // Locked finalizers (Vibe/Context) are brightness-critical : nudge gently.
    const amt = f.locked ? amount * 0.4 : amount
    return {
      ...f,
      inputs: jitterInputs(f.shaderId, f.inputs, amt),
      opacity: clampN((f.opacity ?? 1) + (rnd() * 2 - 1) * amt * 0.3, 0, 1)
    }
  })
}

function jitterLayer(l: LayerState, amount: number): LayerState {
  return {
    ...l,
    sourceA: jitterSlot(l.sourceA, amount) as SourceSlot,
    sourceB: l.sourceB ? jitterSlot(l.sourceB, amount) : l.sourceB,
    sourceAFx: jitterFxArray(l.sourceAFx, amount),
    sourceBFx: jitterFxArray(l.sourceBFx, amount),
    fx: jitterFxArray(l.fx, amount),
    opacity: clampN(l.opacity + (rnd() * 2 - 1) * amount * 0.3, 0, 1),
    sourceMix: clampN(l.sourceMix + (rnd() * 2 - 1) * amount * 0.3, 0, 1),
    harmony: clampN(l.harmony + (rnd() * 2 - 1) * amount * 0.3, 0, 1),
    feedbackAmount: clampN(l.feedbackAmount + (rnd() * 2 - 1) * amount * 0.3, 0, 1),
    speed: clampN(l.speed * (1 + (rnd() * 2 - 1) * amount * 0.4), 0, 20)
  }
}

function jitterMods(mods: ModulatorConfig[], amount: number): ModulatorConfig[] {
  return mods.map((m) => ({
    ...m,
    rateHz: clampN(m.rateHz * (1 + (rnd() * 2 - 1) * amount * 0.5), 0.01, 40)
  }))
}

// Which broad areas a scope disturbs : so the intensity walk only nudges the
// same parts the full randomize would have touched.
function scopeAreas(scope: RandomizeScope): { layers: boolean; master: boolean; mods: boolean } {
  return {
    layers:
      scope === 'all' ||
      scope === 'sources' ||
      scope === 'sourceparams' ||
      scope === 'sourcefx' ||
      scope === 'sourcefxonly' ||
      scope === 'layer' ||
      scope === 'layerfxonly',
    master: scope === 'all' || scope === 'master' || scope === 'finishing',
    mods: scope === 'all' || scope === 'modulators'
  }
}

/**
 * Randomize the composition for a scope at a given INTENSITY (0..1).
 *  - 1 (100%): the full structural randomize : new sources / FX / mods.
 *  - <1: a "random walk" : each unit keeps its structure with probability
 *    (1 − intensity) and is merely nudged (params jittered by `intensity`);
 *    otherwise it takes the fresh structural draw. Low % = a gentle drift from
 *    the current scene; high % approaches a full re-roll.
 */
export function randomizeComposition(
  c: CompositionState,
  scope: RandomizeScope,
  intensity = 1
): CompositionState {
  const target = randomizeStructural(c, scope)
  if (intensity >= 0.999) return target
  const p = Math.max(0, Math.min(1, intensity))
  const area = scopeAreas(scope)
  return {
    ...target,
    layers: area.layers
      ? c.layers.map((cl, i) => (chance(p) ? target.layers[i] : jitterLayer(cl, p)))
      : target.layers,
    master: area.master ? (chance(p) ? target.master : jitterFxArray(c.master, p)) : target.master,
    modulators: area.mods
      ? chance(p)
        ? target.modulators
        : jitterMods(c.modulators, p)
      : target.modulators,
    modMatrix: area.mods ? (chance(p) ? target.modMatrix : c.modMatrix) : target.modMatrix
  }
}

/**
 * VARIATION : a fresh variant of `base` at distance `amount` (0.001..1). Keeps
 * the entire structure fixed (same sources, FX, blends, mod assignments) and
 * nudges every continuous value around the baseline. Re-running with the same
 * baseline yields siblings at the same spread; larger amount = bolder variants.
 */
export function varyComposition(base: CompositionState, amount: number): CompositionState {
  const a = Math.max(0, Math.min(1, amount))
  return {
    ...base,
    bpm: Math.round(clampN(base.bpm * (1 + (rnd() * 2 - 1) * a * 0.15), 20, 800)),
    layers: base.layers.map((l) => jitterLayer(l, a)),
    master: jitterFxArray(base.master, a),
    modulators: jitterMods(base.modulators, a),
    modMatrix: base.modMatrix.map((m) => ({
      ...m,
      depth: clampN(m.depth + (rnd() * 2 - 1) * a * 0.3, -1, 1)
    })),
    metaKnobs: base.metaKnobs.map((k) => ({
      ...k,
      value: clampN(k.value + (rnd() * 2 - 1) * a * 0.25, 0, 1)
    }))
  }
}
