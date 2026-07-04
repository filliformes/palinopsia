// Modulation engine (brief §6) — PORTED from dataFLOU's engine.ts, not
// rewritten: the LFO shapes, S&H probability/distribution/smoothing, slew
// one-pole IIR, logistic-map chaos, ramp/ADSR gain math, BPM-sync divisions,
// and the 14 output curves are dataFLOU's, lifted with their fixes intact
// (rndSmooth cosine wrap, slew target flip-in-place, chaos fixed-point
// clamp, multi-wrap resampling).
//
// It lives in the RENDERER, not main: Palinopsia's output is GL frames, so
// modulation must be frame-locked with rendering (dataFLOU runs its engine in
// main because its output is OSC/MIDI from main — same brain, different
// mouth). Values are applied straight to the Compositor each frame and never
// touch the React store, so nothing re-renders at 60 Hz.

import type { CompositionState, LfoShape, ModCurve, ModulatorConfig } from '@shared/types'

const TWO_PI = Math.PI * 2

// ── BPM sync (dataFLOU's DIVISIONS + effectiveLfoHz) ──────────────────
export const DIVISIONS: Array<{ label: string; beats: number }> = [
  { label: '1/128', beats: 4 / 128 },
  { label: '1/64', beats: 4 / 64 },
  { label: '1/32', beats: 4 / 32 },
  { label: '1/16', beats: 4 / 16 },
  { label: '1/8', beats: 4 / 8 },
  { label: '1/4', beats: 1 },
  { label: '1/2', beats: 2 },
  { label: '1/1', beats: 4 },
  { label: '2/1', beats: 8 },
  { label: '4/1', beats: 16 },
  { label: '8/1', beats: 32 },
  { label: '16/1', beats: 64 },
  { label: '32/1', beats: 128 },
  { label: '64/1', beats: 256 },
  { label: '128/1', beats: 512 }
]

export function effectiveHz(m: ModulatorConfig, bpm: number): number {
  if (m.sync !== 'bpm') return m.rateHz
  const entry = DIVISIONS[Math.max(0, Math.min(DIVISIONS.length - 1, m.divisionIdx))]
  let beats = entry.beats
  if (m.dotted) beats *= 1.5
  if (m.triplet) beats *= 2 / 3
  const periodSec = beats * (60 / Math.max(1, bpm))
  return periodSec > 0 ? 1 / periodSec : 0
}

// ── The 14 output curves (dataFLOU's scaleMetaValue, on [0,1]) ────────
const STEP_COUNT = 8

export function shapeCurve(t: number, curve: ModCurve): number {
  const tc = t < 0 ? 0 : t > 1 ? 1 : t
  switch (curve) {
    case 'linear':
      return tc
    case 'log': {
      const k = 9
      return Math.log(1 + k * tc) / Math.log(1 + k)
    }
    case 'easeIn':
      return tc * tc
    case 'easeOut': {
      const u = 1 - tc
      return 1 - u * u
    }
    case 'cubic':
      return tc * tc * tc
    case 'sqrt':
      return Math.sqrt(tc)
    case 'sigmoid': {
      const k = 6
      const s = (x: number): number => 1 / (1 + Math.exp(-k * (x - 0.5)))
      const s0 = s(0)
      const s1 = s(1)
      return (s(tc) - s0) / (s1 - s0)
    }
    case 'smoothstep':
      return tc * tc * (3 - 2 * tc)
    case 'db': {
      const r = Math.pow(10, -3 * (1 - tc))
      const floor = Math.pow(10, -3)
      return (r - floor) / (1 - floor)
    }
    case 'gamma':
      return Math.pow(tc, 2.2)
    case 'step': {
      const N = STEP_COUNT
      const clamped = tc >= 1 ? N - 1 : Math.floor(tc * N)
      return clamped / (N - 1)
    }
    case 'invert':
      return 1 - tc
    case 'exp':
    case 'geom': // geom is a min/max log-space mapping in dataFLOU; on the
    default: {
      // normalized [0,1] axis it degenerates, so it shares exp's shape.
      const k = 3
      return (Math.exp(k * tc) - 1) / (Math.exp(k) - 1)
    }
  }
}

// ── Distribution warp (dataFLOU's warpDistribution) ───────────────────
function warpDistribution(u: number, distribution: number): number {
  const d = Math.max(0, Math.min(1, distribution))
  if (d === 0.5) return u
  const c = u - 0.5
  const sign = c < 0 ? -1 : 1
  const absC = Math.abs(c) * 2
  const strength = 1 + Math.abs(d - 0.5) * 6
  const warped = d > 0.5 ? Math.pow(absC, strength) : Math.pow(absC, 1 / strength)
  return 0.5 + sign * warped * 0.5
}

// ── LFO shapes (dataFLOU's lfo(), incl. the rndSmooth cosine fix) ─────
function lfoValue(
  shape: LfoShape,
  phase: number,
  s: { rndStepValue: number; rndSmoothPrev: number; rndSmoothNext: number }
): number {
  const p = phase - Math.floor(phase)
  switch (shape) {
    case 'sine':
      return Math.sin(p * TWO_PI)
    case 'triangle':
      return p < 0.5 ? p * 4 - 1 : 3 - p * 4
    case 'sawtooth':
      return p * 2 - 1
    case 'square':
      return p < 0.5 ? 1 : -1
    case 'rndStep':
    case 'spastic':
      return s.rndStepValue
    case 'rndSmooth': {
      // Half-period cosine so k rises 0 → 1 monotonically across the cycle
      // and lands exactly on `next` at the wrap (dataFLOU's pop fix).
      const k = 0.5 - 0.5 * Math.cos(p * Math.PI)
      return s.rndSmoothPrev * (1 - k) + s.rndSmoothNext * k
    }
  }
}

// ── Ramp gain (dataFLOU's computeRampGain, free-length variant) ───────
function rampGain(
  ramp: { rampMs: number; curvePct: number; mode: 'normal' | 'inverted' | 'loop' },
  elapsedMs: number
): number {
  const lenSec = Math.max(0.0001, ramp.rampMs / 1000)
  const elapsedSec = elapsedMs / 1000
  let lin: number
  if (ramp.mode === 'loop') {
    lin = elapsedSec <= 0 ? 0 : (elapsedSec % lenSec) / lenSec
  } else {
    if (elapsedSec <= 0) return ramp.mode === 'inverted' ? 1 : 0
    if (elapsedSec >= lenSec) return ramp.mode === 'inverted' ? 0 : 1
    lin = elapsedSec / lenSec
  }
  const curve = ramp.curvePct ?? 0
  const shaped =
    curve === 0
      ? lin
      : curve > 0
        ? 1 - Math.pow(1 - lin, 1 + (Math.abs(curve) / 100) * 4)
        : Math.pow(lin, 1 + (Math.abs(curve) / 100) * 4)
  return ramp.mode === 'inverted' ? 1 - shaped : shaped
}

// ── ADSR gain (dataFLOU's computeEnvelopeGain, ms variant + loop) ─────
function adsrGain(
  env: {
    attackMs: number
    decayMs: number
    sustainMs: number
    releaseMs: number
    sustainLevel: number
    loop: boolean
  },
  elapsedMs: number
): number {
  const a = env.attackMs / 1000
  const d = env.decayMs / 1000
  const s = env.sustainMs / 1000
  const r = env.releaseMs / 1000
  const total = Math.max(0.0001, a + d + s + r)
  let t = elapsedMs / 1000
  if (env.loop) t = t % total
  const sl = Math.max(0, Math.min(1, env.sustainLevel))
  if (t <= 0) return 0
  if (t < a) return a > 0 ? t / a : 1
  const tA = t - a
  if (tA < d) return d > 0 ? 1 + (sl - 1) * (tA / d) : sl
  const tD = tA - d
  if (tD < s) return sl
  const tS = tD - s
  if (tS < r) return r > 0 ? sl * (1 - tS / r) : 0
  return 0
}

// ── Per-slot runtime state ────────────────────────────────────────────
interface SlotState {
  phase: number
  rndStepValue: number
  rndSmoothPrev: number
  rndSmoothNext: number
  shHeld: number
  shPrev: number
  shLastAdvanceAt: number
  slewValue: number
  slewTarget: number
  slewLastAdvanceAt: number
  chaosX: number
  chaosLastAdvanceAt: number
  randomValue: number
  randomLastAdvanceAt: number
  arpStep: number
  arpDir: 1 | -1
  arpLastAdvanceAt: number
  startedAt: number // ramp/adsr time base (reset by retrigger)
}

function makeSlot(now: number): SlotState {
  return {
    phase: 0,
    rndStepValue: 0,
    rndSmoothPrev: 0,
    rndSmoothNext: Math.random() * 2 - 1,
    shHeld: 0,
    shPrev: 0,
    shLastAdvanceAt: now,
    slewValue: 0,
    slewTarget: 1,
    slewLastAdvanceAt: now,
    chaosX: 0.5,
    chaosLastAdvanceAt: now,
    randomValue: 0.5,
    randomLastAdvanceAt: now,
    arpStep: 0,
    arpDir: 1,
    arpLastAdvanceAt: now,
    startedAt: now
  }
}

export class ModEngine {
  /** Latest post-curve values, 0..1 per slot — read by the panel's meters. */
  readonly values: number[] = new Array(8).fill(0)
  private slots: SlotState[] = []
  private lastNow = 0

  /** Reset a slot's time base (ramp/adsr restart, phase to 0, arp to step 0). */
  retrigger(i: number): void {
    const s = this.slots[i]
    if (!s) return
    s.startedAt = this.lastNow
    s.phase = 0
    s.arpStep = 0
    s.arpDir = 1
  }

  /** Advance every enabled modulator to `now` and return post-curve values. */
  tick(now: number, cfgs: ModulatorConfig[], bpm: number): number[] {
    if (this.slots.length === 0) {
      for (let i = 0; i < 8; i++) this.slots.push(makeSlot(now))
    }
    const dtMs = this.lastNow > 0 ? Math.min(200, now - this.lastNow) : 16
    this.lastNow = now
    const dt = dtMs / 1000

    for (let i = 0; i < 8; i++) {
      const cfg = cfgs[i]
      const s = this.slots[i]
      if (!cfg || !cfg.enabled) {
        this.values[i] = 0
        continue
      }
      const hz = effectiveHz(cfg, bpm)
      let v01 = 0

      switch (cfg.type) {
        case 'lfo': {
          const prevPhase = s.phase
          s.phase += hz * dt
          // Resample stepped/smooth noise on every full-cycle wrap; iterate
          // multiple wraps so a rate jump can't freeze the held value.
          const wraps = Math.floor(s.phase) - Math.floor(prevPhase)
          if (wraps > 0) {
            const spastic = cfg.shape === 'spastic'
            for (let w = 0; w < wraps; w++) {
              s.rndSmoothPrev = s.rndSmoothNext
              s.rndSmoothNext = Math.random() * 2 - 1
              s.rndStepValue = spastic ? (Math.random() < 0.5 ? -1 : 1) : Math.random() * 2 - 1
            }
          }
          v01 = (lfoValue(cfg.shape, s.phase, s) + 1) / 2
          break
        }
        case 'ramp':
          v01 = rampGain(cfg.ramp, now - s.startedAt)
          break
        case 'adsr':
          v01 = adsrGain(cfg.adsr, now - s.startedAt)
          break
        case 'arp': {
          // Stepped level sequence at clock rate — the arp register reduced
          // to its visual essence: N evenly spaced levels walked by mode.
          if (hz > 0) {
            const period = 1000 / hz
            const steps = Math.max(2, Math.min(16, Math.round(cfg.arp.steps)))
            while (now - s.arpLastAdvanceAt >= period) {
              s.arpLastAdvanceAt += period
              switch (cfg.arp.mode) {
                case 'up':
                  s.arpStep = (s.arpStep + 1) % steps
                  break
                case 'down':
                  s.arpStep = (s.arpStep - 1 + steps) % steps
                  break
                case 'upDown': {
                  let next = s.arpStep + s.arpDir
                  if (next >= steps) {
                    s.arpDir = -1
                    next = steps - 2
                  } else if (next < 0) {
                    s.arpDir = 1
                    next = 1
                  }
                  s.arpStep = next
                  break
                }
                case 'random':
                  s.arpStep = Math.floor(Math.random() * steps)
                  break
                case 'drunk': {
                  const move = Math.random() < 0.5 ? -1 : 1
                  s.arpStep = Math.max(0, Math.min(steps - 1, s.arpStep + move))
                  break
                }
              }
            }
            v01 = s.arpStep / (steps - 1)
          }
          break
        }
        case 'random': {
          // Clocked uniform random with distribution warp.
          if (hz > 0) {
            const period = 1000 / hz
            while (now - s.randomLastAdvanceAt >= period) {
              s.randomLastAdvanceAt += period
              s.randomValue = warpDistribution(Math.random(), cfg.random.distribution)
            }
          }
          v01 = s.randomValue
          break
        }
        case 'sh': {
          // Clock-driven stair; probability < 1 can hold a sample across
          // clocks (Turing-machine locked feel); optional cosine smoothing.
          if (hz > 0) {
            const period = 1000 / hz
            const dist = cfg.sh.distribution
            const draw = (): number => {
              if (dist === 0.5) return Math.random() * 2 - 1
              return warpDistribution(Math.random(), dist) * 2 - 1
            }
            while (now - s.shLastAdvanceAt >= period) {
              s.shLastAdvanceAt += period
              if (Math.random() < Math.max(0, Math.min(1, cfg.sh.probability))) {
                s.shPrev = s.shHeld
                s.shHeld = draw()
              }
            }
            let raw: number
            if (cfg.sh.smooth) {
              const into = now - s.shLastAdvanceAt
              const k = 0.5 - 0.5 * Math.cos(Math.max(0, Math.min(1, into / period)) * Math.PI)
              raw = s.shPrev * (1 - k) + s.shHeld * k
            } else {
              raw = s.shHeld
            }
            v01 = (raw + 1) / 2
          }
          break
        }
        case 'slew': {
          // Clock-rate target + per-tick one-pole toward it with independent
          // rise/fall half-lives. Target flips in place (dataFLOU's fix).
          if (hz > 0) {
            const period = 1000 / hz
            while (now - s.slewLastAdvanceAt >= period) {
              s.slewLastAdvanceAt += period
              s.slewTarget = cfg.slew.randomTarget
                ? Math.random() * 2 - 1
                : s.slewTarget >= 0
                  ? -1
                  : 1
            }
          }
          const goingUp = s.slewTarget > s.slewValue
          const halfLifeMs = Math.max(1, goingUp ? cfg.slew.riseMs : cfg.slew.fallMs)
          const alpha = 1 - Math.pow(2, -dtMs / halfLifeMs)
          s.slewValue += (s.slewTarget - s.slewValue) * alpha
          v01 = (s.slewValue + 1) / 2
          break
        }
        case 'chaos': {
          // Logistic-map iterate at clock rate; clamp away from fixed points
          // so the trajectory never stalls (dataFLOU's recovery).
          if (hz > 0) {
            const period = 1000 / hz
            const r = Math.max(3.4, Math.min(4.0, cfg.chaos.r))
            while (now - s.chaosLastAdvanceAt >= period) {
              s.chaosLastAdvanceAt += period
              let x = s.chaosX
              x = r * x * (1 - x)
              if (!Number.isFinite(x) || x <= 0 || x >= 1) x = 0.1 + Math.random() * 0.8
              s.chaosX = x
            }
          }
          v01 = s.chaosX
          break
        }
      }

      this.values[i] = shapeCurve(v01, cfg.curve)
    }
    return this.values
  }
}

// One engine per renderer — App's frame loop ticks it; the modulation panel
// reads `.values` for its meters.
export const modEngine = new ModEngine()

// ── Factory defaults ──────────────────────────────────────────────────
export function makeDefaultModulator(): ModulatorConfig {
  return {
    type: 'lfo',
    enabled: false,
    sync: 'free',
    rateHz: 0.2,
    divisionIdx: 7, // 1/1
    dotted: false,
    triplet: false,
    curve: 'linear',
    shape: 'sine',
    ramp: { rampMs: 4000, curvePct: 0, mode: 'loop' },
    adsr: {
      attackMs: 500,
      decayMs: 1000,
      sustainMs: 2000,
      releaseMs: 1000,
      sustainLevel: 0.7,
      loop: true
    },
    arp: { steps: 8, mode: 'up' },
    random: { distribution: 0.5 },
    sh: { probability: 1, smooth: false, distribution: 0.5 },
    slew: { riseMs: 200, fallMs: 400, randomTarget: true },
    chaos: { r: 3.8 }
  }
}

export function makeDefaultModulators(): ModulatorConfig[] {
  return Array.from({ length: 8 }, () => makeDefaultModulator())
}

/**
 * Apply the mod-matrix on top of the store's base values, writing straight
 * into the Compositor (post-syncFromState, pre-render). Base + bipolar swing:
 * final = clamp(base + (v−0.5)·2·depth·span, min, max).
 */
export function applyModulation(
  comp: {
    layers: Array<{ setInput: (slot: 'A' | 'B', name: string, value: number) => void }>
    setFxInput: (
      scope: import('@shared/types').FxScope,
      instId: string,
      name: string,
      value: number
    ) => void
  },
  c: CompositionState,
  values: number[],
  descFor: (
    shaderId: string
  ) => Array<{ name: string; type: string; min?: number | number[]; max?: number | number[]; def?: number | number[] }>
): void {
  for (const a of c.modMatrix) {
    const v = values[a.mod]
    if (v === undefined) continue
    if (a.target.kind === 'source') {
      const layer = c.layers[a.target.layer]
      if (!layer) continue
      const slot = a.target.slot === 'A' ? layer.sourceA : layer.sourceB
      if (!slot?.shaderId) continue
      const d = descFor(slot.shaderId).find((x) => x.name === a.target.input)
      if (!d || d.type !== 'float') continue
      const min = typeof d.min === 'number' ? d.min : 0
      const max = typeof d.max === 'number' ? d.max : 1
      const stored = slot.inputs[a.target.input]
      const base =
        typeof stored === 'number' ? stored : typeof d.def === 'number' ? d.def : min
      const final = Math.max(min, Math.min(max, base + (v - 0.5) * 2 * a.depth * (max - min)))
      comp.layers[a.target.layer]?.setInput(a.target.slot, a.target.input, final)
    } else {
      const { scope, instId } = a.target
      let arr = c.master
      if (scope.kind !== 'master') {
        const layer = c.layers[scope.layer]
        if (!layer) continue
        arr =
          scope.kind === 'layer'
            ? layer.fx
            : scope.kind === 'sourceA'
              ? layer.sourceAFx
              : layer.sourceBFx
      }
      const inst = arr.find((f) => f.id === instId)
      if (!inst?.shaderId) continue
      const d = descFor(inst.shaderId).find((x) => x.name === a.target.input)
      if (!d || d.type !== 'float') continue
      const min = typeof d.min === 'number' ? d.min : 0
      const max = typeof d.max === 'number' ? d.max : 1
      const stored = inst.inputs[a.target.input]
      const base =
        typeof stored === 'number' ? stored : typeof d.def === 'number' ? d.def : min
      const final = Math.max(min, Math.min(max, base + (v - 0.5) * 2 * a.depth * (max - min)))
      comp.setFxInput(scope, instId, a.target.input, final)
    }
  }
}
