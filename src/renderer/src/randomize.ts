// Randomize — the Rhodopsin button, done right (brief §7). STRUCTURAL:
// each scope doesn't just re-roll parameters, it (re)builds its targets —
// picks generators per layer, builds FX racks of random length, enables a
// random number of modulators and rolls a fresh mod-matrix. One press =
// a new instrument state (and one undo step).
//
// Taste guardrails: every float draw comes from the shader's CURATED
// aesthetic sub-range; colors stay matte (bounded S/V); Interference-style
// risks are pre-bounded in the registry; the mod-matrix respects its cap.

import type {
  CompositionState,
  FxInstance,
  FxScope,
  LayerState,
  LfoShape,
  ModAssignment,
  ModCurve,
  ModTarget,
  ModulatorConfig,
  ModulatorType,
  SourceSlot
} from '@shared/types'
import { MAX_MOD_ASSIGNMENTS } from '@shared/types'
import { curatedRange, FX_SHADERS, GENERATORS } from './shaders/isf'
import { inputsForShader, type IsfInputDesc } from './shaders/isf/inputs'

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
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]
const chance = (p: number): boolean => rnd() < p
const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

// Restrained color register: any hue, bounded saturation/value — matte.
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
    case 'bool':
    case 'event': {
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

/** Randomize every input of one shader within curated ranges — used by
 *  Randomize scopes and by the Inspector's ⚄ button. */
export function randomizeInputs(
  shaderId: string,
  current: Record<string, number | number[]>
): Record<string, number | number[]> {
  const out: Record<string, number | number[]> = { ...current }
  for (const d of inputsForShader(shaderId)) {
    out[d.name] = randomizeOneInput(shaderId, d, current[d.name])
  }
  return out
}

// ── Structural builders ───────────────────────────────────────────────
function randomSlot(): SourceSlot {
  const gen = pick(GENERATORS)
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

/** Build a rack of n DISTINCT random FX, each with randomized params. */
function randomRack(
  countWeights: number[],
  endWithColor = false,
  exclude: string[] = []
): FxInstance[] {
  const n = drawCount(countWeights)
  const pool = FX_SHADERS.filter((f) => !exclude.includes(f.id))
  const picked: typeof FX_SHADERS = []
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(rnd() * pool.length)
    picked.push(pool[idx])
    pool.splice(idx, 1)
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
    inputs: randomizeInputs(s.id, {})
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
  // Context is deliberately excluded from random modulation targets — it's the
  // depth finalizer and too powerful to be re-rolled by the Randomizer.
  addFxTargets(c.master.filter((f) => f.shaderId !== 'fx-context'), { kind: 'master' })
  return out
}

function targetKey(t: ModTarget): string {
  if (t.kind === 'source') return `src:${t.layer}:${t.slot}:${t.input}`
  if (t.kind === 'meta') return `meta:${t.knob}`
  const s = t.scope
  return `fx:${s.kind === 'master' ? 'master' : `${s.kind}:${s.layer}`}:${t.instId}:${t.input}`
}

/** Roll a fresh matrix: 1–2 assignments per enabled mod, capped, deduped. */
function randomMatrix(c: CompositionState): ModAssignment[] {
  const targets = collectFloatTargets(c)
  if (targets.length === 0) return []
  const out: ModAssignment[] = []
  const used = new Set<string>()
  c.modulators.forEach((m, mi) => {
    if (!m.enabled) return
    const n = drawCount([0.15, 0.5, 0.35]) // 0..2 assignments per mod
    for (let i = 0; i < n; i++) {
      if (out.length >= MAX_MOD_ASSIGNMENTS) return
      const t = pick(targets)
      const key = `${mi}|${targetKey(t)}`
      if (used.has(key)) continue
      used.add(key)
      const sign = chance(0.25) ? -1 : 1
      out.push({ id: uid(), mod: mi, target: t, depth: sign * range(0.2, 0.75) })
    }
  })
  return out
}

// ── The scoped randomizer ─────────────────────────────────────────────
// Tasteful subset of the 15 modes for random draws (dodge/burn stay manual —
// they blow out too easily for the matte register).
const BLENDS = [
  'normal', 'add', 'subtract', 'multiply', 'screen', 'overlay', 'softlight',
  'hardlight', 'darken', 'lighten', 'difference', 'exclusion', 'wrap'
] as const
// Activation odds by layer index — a full stack is possible, a duo is common.
const LAYER_ACTIVE_P = [0.95, 0.7, 0.45, 0.25]

/** Structural randomize of ONE layer (the layer context menu's action):
 *  fresh source(s), fresh racks, blend/opacity/feedback — always active. */
export function randomizeSingleLayer(l: LayerState): LayerState {
  const withB = chance(0.25)
  return {
    ...l,
    sourceA: randomSlot(),
    sourceB: withB ? randomSlot() : null,
    sourceAFx: randomRack([0.45, 0.4, 0.15]),
    sourceBFx: withB ? randomRack([0.55, 0.35, 0.1]) : [],
    fx: randomRack([0.35, 0.4, 0.2, 0.05]),
    sourceMix: withB ? range(0.25, 0.75) : l.sourceMix,
    sourceBlend: withB ? pick(BLENDS) : l.sourceBlend,
    blend: pick(BLENDS),
    opacity: range(0.55, 1),
    feedback: chance(0.3),
    feedbackAmount: range(0.3, 0.8),
    mute: false
  }
}

export function randomizeComposition(
  c: CompositionState,
  scope: RandomizeScope
): CompositionState {
  let next = c

  // Source PARAMETERS only — keep the chosen generators, re-roll their ISF
  // inputs within curated ranges (unlike 'sources', which picks new ones).
  if (scope === 'sourceparams') {
    return {
      ...c,
      layers: c.layers.map((l) => ({
        ...l,
        sourceA: l.sourceA.shaderId
          ? { ...l.sourceA, inputs: randomizeInputs(l.sourceA.shaderId, l.sourceA.inputs) }
          : l.sourceA,
        sourceB:
          l.sourceB && l.sourceB.shaderId
            ? { ...l.sourceB, inputs: randomizeInputs(l.sourceB.shaderId, l.sourceB.inputs) }
            : l.sourceB
      }))
    }
  }

  // A slot carries a real source (generator OR video/capture) — used to gate FX.
  const slotActive = (s: SourceSlot | null | undefined): boolean =>
    !!s && s.kind !== 'none' && (s.kind !== 'generator' || !!s.shaderId)

  // Source FX racks only — new random chains over whatever sources exist.
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
        fx: slotActive(l.sourceA) || slotActive(l.sourceB) ? randomRack([0.35, 0.4, 0.2, 0.05]) : l.fx
      }))
    }
  }

  // Finishing — re-roll the three pinned finalizers' params within curated
  // ranges (Vibe Palette · Context · Finalizer). Deliberate, user-triggered.
  if (scope === 'finishing') {
    return {
      ...c,
      master: c.master.map((f) =>
        f.locked && f.shaderId ? { ...f, inputs: randomizeInputs(f.shaderId, f.inputs) } : f
      )
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
            sourceBlend: withB ? pick(BLENDS) : layer.sourceBlend,
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
          fx: hasSource ? randomRack([0.35, 0.4, 0.2, 0.05]) : [],
          blend: pick(BLENDS),
          opacity: range(0.55, 1),
          feedback: hasSource ? chance(0.3) : false,
          feedbackAmount: range(0.3, 0.8),
          sourceMix: layer.sourceB?.shaderId ? range(0.2, 0.8) : layer.sourceMix,
          speed: range(0.5, 1.5) // gentle — extreme speeds are a manual move
        }
      }
      return layer
    })
    // Never randomize into a black stage.
    if (doSources && !anyActive) {
      layers = layers.map((l, li) => (li === 0 ? { ...l, sourceA: randomSlot(), mute: false } : l))
    }
    next = { ...next, layers }
  }

  if (doMaster) {
    // Both pinned finalizers survive every randomize untouched — the Vibe
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
    const slots = [0, 1, 2, 3, 4, 5, 6, 7]
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
