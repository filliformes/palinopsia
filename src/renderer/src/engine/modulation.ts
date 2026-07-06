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
import { audioBus } from './audioIn'

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
  audioValue: number // one-pole smoothed audio feature (audio type)
  physPos: number // physics integrator position 0..1
  physVel: number // physics integrator velocity
  physTarget: number // physics spring target (flips on clock)
  physLastAdvanceAt: number // physics clock (re-kick / period base)
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
    audioValue: 0,
    physPos: 0,
    physVel: 0,
    physTarget: 1,
    physLastAdvanceAt: now,
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
        case 'audio': {
          // Follow one feature off the audio bus (OSC/local). Unclocked — the
          // signal IS the clock. One-pole smoothing tames it toward the value.
          const a = cfg.audio
          if (a) {
            const raw = audioBus.feature(a.feature, a.band)
            const sm = Math.max(0, Math.min(0.99, a.smooth ?? 0))
            s.audioValue += (raw - s.audioValue) * (1 - sm)
            v01 = s.audioValue
          }
          break
        }
        case 'organic': {
          // Irregular periodicity + perpetual variation (Boucher's "water"): a
          // smooth oscillator whose period AND amplitude drift on slow,
          // incommensurate LFOs — never quite the same twice.
          const varn = Math.max(0, Math.min(1, cfg.organic?.variation ?? 0.5))
          const t = now / 1000
          const wobble = 0.5 * Math.sin(t * 0.13) + 0.5 * Math.sin(t * 0.077) // ~[-1,1]
          s.phase += hz * dt * (1 + varn * 0.85 * wobble)
          const amp = 1 - varn * 0.45 * (0.5 + 0.5 * Math.sin(t * 0.19 + 1.7))
          v01 = (Math.sin(s.phase * TWO_PI) * amp + 1) / 2
          break
        }
        case 'physics': {
          // Force-driven scalar motion. The clock re-kicks/relaunches; damping
          // sets restitution / settle. Integrated with a clamped dt for
          // stability across frame hitches.
          const period = hz > 0 ? 1000 / hz : 2000
          let kicked = false
          if (now - s.physLastAdvanceAt >= period) {
            // Snap the clock forward without spamming re-kicks after a stall.
            s.physLastAdvanceAt += period * Math.floor((now - s.physLastAdvanceAt) / period)
            kicked = true
          }
          const damp = Math.max(0, Math.min(1, cfg.physics?.damping ?? 0.5))
          const dtc = Math.min(0.05, dt)
          switch (cfg.physics?.motion ?? 'bounce') {
            case 'bounce': {
              if (kicked) {
                s.physPos = 1
                s.physVel = 0
              }
              s.physVel -= (6 + (1 - damp) * 12) * dtc // gravity
              s.physPos += s.physVel * dtc
              if (s.physPos <= 0) {
                s.physPos = 0
                s.physVel = -s.physVel * (0.35 + damp * 0.6) // restitution
              }
              v01 = s.physPos
              break
            }
            case 'spring': {
              if (kicked) s.physTarget = s.physTarget > 0.5 ? 0 : 1
              s.physVel += (s.physTarget - s.physPos) * 60 * dtc
              s.physVel *= 1 - Math.min(0.9, (1 + damp * 12) * dtc) // damping
              s.physPos += s.physVel * dtc
              v01 = s.physPos
              break
            }
            case 'riser': {
              // Accelerating anticipation ramp, snapping back each period.
              const k = Math.max(0, Math.min(1, (now - s.physLastAdvanceAt) / period))
              v01 = k * k
              break
            }
          }
          break
        }
      }

      this.values[i] = shapeCurve(Math.max(0, Math.min(1, v01)), cfg.curve)
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
    chaos: { r: 3.8 },
    audio: { feature: 'level', band: 0, smooth: 0.2 },
    organic: { variation: 0.5 },
    physics: { motion: 'bounce', damping: 0.5 }
  }
}

export function makeDefaultModulators(): ModulatorConfig[] {
  return Array.from({ length: 8 }, () => makeDefaultModulator())
}

// Live modulated value per target key — the UI's sliders read this each rAF
// to move with the modulation (the dataFLOU behaviour). Key format matches
// the store's modTargetKey exactly.
export const liveModValues = new Map<string, number>()
// Live modulated Meta-knob positions (0..1) — the dials read these each rAF.
export const metaLiveValues = new Map<number, number>()

function liveKey(t: import('@shared/types').ModTarget): string {
  if (t.kind === 'source') return `src:${t.layer}:${t.slot}:${t.input}`
  if (t.kind === 'meta') return `meta:${t.knob}`
  const s = t.scope
  const scopeKey = s.kind === 'master' ? 'master' : `${s.kind}:${s.layer}`
  return `fx:${scopeKey}:${t.instId}:${t.input}`
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
  metaLiveValues.clear()
  // Resolve one ISF-input target's shader + write the given value everywhere
  // it needs to land (engine + live map). Shared by direct and meta paths.
  const writeTarget = (
    t: Exclude<import('@shared/types').ModTarget, { kind: 'meta' }>,
    shaped01: number
  ): void => {
    let shaderId: string | null = null
    if (t.kind === 'source') {
      const layer = c.layers[t.layer]
      const slot = t.slot === 'A' ? layer?.sourceA : layer?.sourceB
      shaderId = slot?.shaderId ?? null
    } else {
      const s = t.scope
      const arr =
        s.kind === 'master'
          ? c.master
          : s.kind === 'layer'
            ? c.layers[s.layer]?.fx
            : s.kind === 'sourceA'
              ? c.layers[s.layer]?.sourceAFx
              : c.layers[s.layer]?.sourceBFx
      shaderId = arr?.find((f) => f.id === t.instId)?.shaderId ?? null
    }
    if (!shaderId) return
    const d = descFor(shaderId).find((x) => x.name === t.input)
    if (!d || d.type !== 'float') return
    const min = typeof d.min === 'number' ? d.min : 0
    const max = typeof d.max === 'number' ? d.max : 1
    const value = min + shaped01 * (max - min)
    liveModValues.set(liveKey(t), value)
    if (t.kind === 'source') comp.layers[t.layer]?.setInput(t.slot, t.input, value)
    else comp.setFxInput(t.scope, t.instId, t.input, value)
  }

  for (const a of c.modMatrix) {
    const v = values[a.mod]
    if (v === undefined) continue
    if (a.target.kind === 'meta') {
      // Meta target: the knob's curve is its SCALING FUNCTION — the raw
      // modulator signal is shaped by the curve first (modulator × scaling
      // function), then swung around the knob's base position by depth. The
      // same shaped value is what the dial animates to AND what fans out to
      // the destinations, so what you see the knob doing is exactly what it
      // sends.
      const knob = c.metaKnobs[a.target.knob]
      if (!knob) continue
      const scaled = shapeCurve(Math.max(0, Math.min(1, v)), knob.curve)
      const v01 = Math.max(0, Math.min(1, knob.value + (scaled - 0.5) * 2 * a.depth))
      metaLiveValues.set(a.target.knob, v01)
      for (const dest of knob.destinations) {
        if (dest.kind === 'meta') continue // knobs never chain into knobs
        writeTarget(dest, v01)
      }
      continue
    }
    if (a.target.kind === 'source') {
      const layer = c.layers[a.target.layer]
      if (!layer) continue
      const slot = a.target.slot === 'A' ? layer.sourceA : layer.sourceB
      if (!slot?.shaderId) continue
      const inputName = a.target.input
      const d = descFor(slot.shaderId).find((x) => x.name === inputName)
      if (!d || d.type !== 'float') continue
      const min = typeof d.min === 'number' ? d.min : 0
      const max = typeof d.max === 'number' ? d.max : 1
      const stored = slot.inputs[a.target.input]
      const base =
        typeof stored === 'number' ? stored : typeof d.def === 'number' ? d.def : min
      const final = Math.max(min, Math.min(max, base + (v - 0.5) * 2 * a.depth * (max - min)))
      liveModValues.set(liveKey(a.target), final)
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
      const inputName = a.target.input
      const d = descFor(inst.shaderId).find((x) => x.name === inputName)
      if (!d || d.type !== 'float') continue
      const min = typeof d.min === 'number' ? d.min : 0
      const max = typeof d.max === 'number' ? d.max : 1
      const stored = inst.inputs[a.target.input]
      const base =
        typeof stored === 'number' ? stored : typeof d.def === 'number' ? d.def : min
      const final = Math.max(min, Math.min(max, base + (v - 0.5) * 2 * a.depth * (max - min)))
      liveModValues.set(liveKey(a.target), final)
      comp.setFxInput(scope, instId, a.target.input, final)
    }
  }
}
