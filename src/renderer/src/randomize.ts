// Randomize — the Rhodopsin button, done right (brief §7).
//
// Every draw comes from the shader's CURATED aesthetic sub-range (the
// registry's `curated` table), not the raw declared MIN/MAX — that curation
// is where the instrument's taste lives. Colors randomize inside a restrained
// register (bounded saturation/value — matte, never neon-on-void). Scoped:
// sources / source+fx / layer / master / modulators / all.

import type {
  CompositionState,
  FxInstance,
  LfoShape,
  ModCurve,
  ModulatorConfig,
  SourceSlot
} from '@shared/types'
import { curatedRange } from './shaders/isf'
import { inputsForShader, type IsfInputDesc } from './shaders/isf/inputs'

export type RandomizeScope =
  | 'all'
  | 'sources'
  | 'sourcefx'
  | 'layer'
  | 'master'
  | 'modulators'

const rnd = (): number => Math.random()
const range = (lo: number, hi: number): number => lo + rnd() * (hi - lo)
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]

// Restrained color register: any hue, but saturation and value bounded so
// results stay matte — the accent, not the spectacle (brief §1).
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

/** Randomize one shader instance's inputs within curated ranges. */
function randomizeInputs(
  shaderId: string,
  current: Record<string, number | number[]>
): Record<string, number | number[]> {
  const out: Record<string, number | number[]> = { ...current }
  for (const d of inputsForShader(shaderId)) {
    out[d.name] = randomizeOneInput(shaderId, d, current[d.name])
  }
  return out
}

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
      // Flip occasionally; mostly keep the author's default behaviour.
      const cur = typeof current === 'number' ? current : typeof d.def === 'number' ? d.def : 0
      return rnd() < 0.3 ? (cur >= 0.5 ? 0 : 1) : cur
    }
    case 'long': {
      const values = d.values ?? []
      if (values.length === 0)
        return typeof current === 'number' ? current : ((d.def as number) ?? 0)
      // New pick ~40% of the time.
      const cur = typeof current === 'number' ? current : ((d.def as number) ?? values[0])
      return rnd() < 0.4 ? pick(values) : cur
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

function randomizeSlot(slot: SourceSlot): SourceSlot {
  if (!slot.shaderId) return slot
  return { ...slot, inputs: randomizeInputs(slot.shaderId, slot.inputs) }
}

function randomizeFxArray(fx: FxInstance[]): FxInstance[] {
  return fx.map((f) =>
    f.shaderId ? { ...f, inputs: randomizeInputs(f.shaderId, f.inputs) } : f
  )
}

// Blend randomization avoids 'normal' dominance but keeps it possible.
const BLENDS = ['add', 'screen', 'multiply', 'difference', 'overlay', 'normal'] as const

const RAND_SHAPES: LfoShape[] = [
  'sine', 'triangle', 'square', 'sawtooth', 'rndStep', 'rndSmooth', 'spastic'
]
// Curve subset that stays legible under randomization.
const RAND_CURVES: ModCurve[] = [
  'linear', 'easeIn', 'easeOut', 'sigmoid', 'smoothstep', 'step', 'gamma', 'sqrt'
]

function randomizeModulator(m: ModulatorConfig): ModulatorConfig {
  if (!m.enabled) return m // never wake sleeping modulators — that's a decision
  const next: ModulatorConfig = {
    ...m,
    // Log-uniform rate in the musically useful band.
    rateHz: Math.pow(10, range(Math.log10(0.05), Math.log10(4))),
    divisionIdx: Math.floor(range(3, 9)), // 1/16 … 2/1
    shape: pick(RAND_SHAPES),
    curve: rnd() < 0.5 ? pick(RAND_CURVES) : m.curve,
    ramp: { ...m.ramp, rampMs: range(500, 20000), curvePct: range(-80, 80) },
    adsr: {
      ...m.adsr,
      attackMs: range(50, 4000),
      decayMs: range(100, 4000),
      sustainMs: range(200, 8000),
      releaseMs: range(100, 6000),
      sustainLevel: range(0.3, 0.9)
    },
    arp: { steps: Math.floor(range(3, 13)), mode: pick(['up', 'down', 'upDown', 'random', 'drunk'] as const) },
    random: { distribution: range(0.2, 0.8) },
    sh: { ...m.sh, probability: range(0.5, 1), distribution: range(0.2, 0.8) },
    slew: {
      ...m.slew,
      riseMs: Math.pow(10, range(Math.log10(50), Math.log10(2000))),
      fallMs: Math.pow(10, range(Math.log10(50), Math.log10(2000)))
    },
    chaos: { r: range(3.5, 4) }
  }
  return next
}

export function randomizeComposition(
  c: CompositionState,
  scope: RandomizeScope
): CompositionState {
  let next = c

  const doSources = scope === 'all' || scope === 'sources' || scope === 'sourcefx'
  const doSourceFx = scope === 'all' || scope === 'sourcefx'
  const doLayer = scope === 'all' || scope === 'layer'
  const doMaster = scope === 'all' || scope === 'master'
  const doMods = scope === 'all' || scope === 'modulators'

  if (doSources || doSourceFx || doLayer) {
    next = {
      ...next,
      layers: next.layers.map((l) => {
        let layer = l
        if (doSources) {
          layer = {
            ...layer,
            sourceA: randomizeSlot(layer.sourceA),
            sourceB: layer.sourceB ? randomizeSlot(layer.sourceB) : layer.sourceB
          }
        }
        if (doSourceFx) {
          layer = {
            ...layer,
            sourceAFx: randomizeFxArray(layer.sourceAFx),
            sourceBFx: randomizeFxArray(layer.sourceBFx)
          }
        }
        if (doLayer) {
          layer = {
            ...layer,
            fx: randomizeFxArray(layer.fx),
            blend: pick(BLENDS),
            opacity: range(0.55, 1),
            sourceMix: layer.sourceB?.shaderId ? range(0.2, 0.8) : layer.sourceMix
          }
        }
        return layer
      })
    }
  }

  if (doMaster) next = { ...next, master: randomizeFxArray(next.master) }
  if (doMods) next = { ...next, modulators: next.modulators.map(randomizeModulator) }

  return next
}
