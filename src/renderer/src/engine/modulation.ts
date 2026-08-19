// Modulation engine (brief §6) : PORTED from dataFLOU's engine.ts, not
// rewritten: the LFO shapes, S&H probability/distribution/smoothing, slew
// one-pole IIR, logistic-map chaos, ramp/ADSR gain math, BPM-sync divisions,
// and the 14 output curves are dataFLOU's, lifted with their fixes intact
// (rndSmooth cosine wrap, slew target flip-in-place, chaos fixed-point
// clamp, multi-wrap resampling).
//
// It lives in the RENDERER, not main: Palinopsia's output is GL frames, so
// modulation must be frame-locked with rendering (dataFLOU runs its engine in
// main because its output is OSC/MIDI from main : same brain, different
// mouth). Values are applied straight to the Compositor each frame and never
// touch the React store, so nothing re-renders at 60 Hz.

import type { CompositionState, LfoShape, ModCurve, ModulatorConfig } from '@shared/types'
import { audioBus } from './audioIn'
import { visionBus } from './visionIn'

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
  visionValue: number // one-pole smoothed picture feature (vision type)
  homeoFeat: number // one-pole smoothed feature (homeostat type)
  homeoBase: number // slow-adapting baseline the controller regulates around
  homeoInt: number // homeostat integrator (accumulated correction, ±0.5)
  homeoSeeded: boolean // false until the baseline is seeded to the first reading
  physPos: number // physics integrator position 0..1
  physVel: number // physics integrator velocity
  physTarget: number // physics spring target (flips on clock)
  physLastAdvanceAt: number // physics clock (re-kick / period base)
  euclidStep: number // euclid : current step index
  euclidEnv: number // euclid : the gate's release envelope (0..1)
  euclidLastAdvanceAt: number
  turingReg: number // turing : the shift register (bitmask, read as a value)
  turingLastAdvanceAt: number
  cellRow: number[] // cellular : the current 1-D generation
  cellLastAdvanceAt: number
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
    visionValue: 0,
    homeoFeat: 0.5,
    homeoBase: 0.5,
    homeoInt: 0,
    homeoSeeded: false,
    physPos: 0,
    physVel: 0,
    physTarget: 1,
    physLastAdvanceAt: now,
    euclidStep: 0,
    euclidEnv: 0,
    euclidLastAdvanceAt: now,
    turingReg: 0,
    turingLastAdvanceAt: now,
    cellRow: [],
    cellLastAdvanceAt: now,
    startedAt: now
  }
}

// Euclidean : does step i carry one of `pulses` onsets spread evenly over `steps`?
// (the Bresenham form of Bjorklund : same even distribution, deterministic.)
function euclidHit(i: number, steps: number, pulses: number): boolean {
  if (pulses <= 0) return false
  if (pulses >= steps) return true
  const j = ((i % steps) + steps) % steps
  return Math.floor(((j + 1) * pulses) / steps) !== Math.floor((j * pulses) / steps)
}

// True when every cell is dead (a plain loop : `.every(x=>x===0)` narrows the
// array's element type to the literal `0` and then blocks the reseed write).
function allDead(row: number[]): boolean {
  for (const x of row) if (x !== 0) return false
  return true
}

// One generation of a 1-D elementary cellular automaton under Wolfram `rule`,
// wrapping at the edges. Neighbourhood (left,centre,right) → 3-bit index → bit.
function cellNext(row: number[], rule: number): number[] {
  const n = row.length
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const idx = (row[(i - 1 + n) % n] << 2) | (row[i] << 1) | row[(i + 1) % n]
    out[i] = (rule >> idx) & 1
  }
  return out
}

export class ModEngine {
  /** Latest post-curve values, 0..1 per slot : read by the panel's meters. */
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

      // SLIP : the clock still ticks, some ticks just don't fire. Keeping the
      // GRID while dropping the EVENT is what reads as cross-rhythm instead of
      // sloppiness — and it survives BPM sync, which a jittered period would
      // not. Capped below 1 so the top of the dial is sparse, never frozen.
      // Each modulator draws its own coin : the slots slip independently.
      const slipSkip = (): boolean => {
        const p = Math.max(0, Math.min(1, cfg.slip ?? 0)) * 0.85
        return p > 0 && Math.random() < p
      }

      switch (cfg.type) {
        case 'lfo': {
          const prevPhase = s.phase
          s.phase += hz * dt
          // Resample stepped/smooth noise on every full-cycle wrap; iterate
          // multiple wraps so a rate jump can't freeze the held value.
          const wraps = Math.floor(s.phase) - Math.floor(prevPhase)
          if (wraps > 0) {
            // SPASTIC's whole point is that you can't feel its clock — the
            // speed reads as random, near-polyrhythmic against everything else.
            // In 'binary' that falls straight out of the coin flip: half the
            // ticks land on the value it already holds, so the holds run 1, 2,
            // 3… ticks and the pulse disappears.
            //
            // 'float' therefore CANNOT just draw a new number every tick — that
            // puts the grid right back, and a steady pulse is the one thing
            // Spastic must not have. It takes the same coin flip, so its holds
            // land on the identical distribution; and when it does move it has
            // to move FAR enough to read as a jump, since a tiny step is
            // indistinguishable from a hold and would quietly reintroduce the
            // metronome at half rate.
            const spasticShape = cfg.shape === 'spastic'
            const spasticBinary = spasticShape && (cfg.spasticMode ?? 'binary') === 'binary'
            for (let w = 0; w < wraps; w++) {
              // SLIP holds the two stepped shapes on a skipped tick. The two
              // shapes hold DIFFERENTLY : rndStep holds a sampled value, so it
              // just skips the resample; rndSmooth is a phase-driven ramp from
              // prev→next, so `prev` must ALWAYS advance to the value it just
              // arrived at (else the next cycle re-ramps from the old prev, a
              // jump backwards) while only the new TARGET is held — that makes
              // the held cycle interpolate flat. Spastic is excluded : its own
              // coin flip already IS this, and stacking would halve its rate.
              const stepped = cfg.shape === 'rndStep' || cfg.shape === 'rndSmooth'
              const slipHold = stepped && slipSkip()
              s.rndSmoothPrev = s.rndSmoothNext
              if (!slipHold) s.rndSmoothNext = Math.random() * 2 - 1
              if (slipHold) continue
              if (spasticBinary) {
                s.rndStepValue = Math.random() < 0.5 ? -1 : 1
              } else if (spasticShape) {
                if (Math.random() < 0.5) {
                  let next = Math.random() * 2 - 1
                  // Span is -1..1, so 0.7 is a third of the range : big enough
                  // to register as a throw rather than a wobble.
                  for (let g = 0; g < 8 && Math.abs(next - s.rndStepValue) < 0.7; g++) {
                    next = Math.random() * 2 - 1
                  }
                  s.rndStepValue = next
                }
              } else {
                s.rndStepValue = Math.random() * 2 - 1 // rndStep : steady grid
              }
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
          // Stepped level sequence at clock rate : the arp register reduced
          // to its visual essence: N evenly spaced levels walked by mode.
          if (hz > 0) {
            const period = 1000 / hz
            const steps = Math.max(2, Math.min(16, Math.round(cfg.arp.steps)))
            // Guard the catch-up loop against a huge idle gap (slot re-enabled or
            // type switched after minutes): snap forward so one fresh step fires
            // instead of burning idle/period iterations in a single frame.
            if (now - s.arpLastAdvanceAt > period * 4) s.arpLastAdvanceAt = now - period
            while (now - s.arpLastAdvanceAt >= period) {
              // The clock advances whether or not the step does : dropping the
              // EVENT while keeping the GRID is the whole point.
              s.arpLastAdvanceAt += period
              if (slipSkip()) continue
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
            if (now - s.randomLastAdvanceAt > period * 4) s.randomLastAdvanceAt = now - period
            while (now - s.randomLastAdvanceAt >= period) {
              s.randomLastAdvanceAt += period
              if (slipSkip()) continue
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
            if (now - s.shLastAdvanceAt > period * 4) s.shLastAdvanceAt = now - period
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
            if (now - s.slewLastAdvanceAt > period * 4) s.slewLastAdvanceAt = now - period
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
            if (now - s.chaosLastAdvanceAt > period * 4) s.chaosLastAdvanceAt = now - period
            while (now - s.chaosLastAdvanceAt >= period) {
              s.chaosLastAdvanceAt += period
              if (slipSkip()) continue
              let x = s.chaosX
              x = r * x * (1 - x)
              if (!Number.isFinite(x) || x <= 0 || x >= 1) x = 0.1 + Math.random() * 0.8
              s.chaosX = x
            }
          }
          v01 = s.chaosX
          break
        }
        case 'euclid': {
          // Bjorklund gate : advance one step per clock, output 1 on an onset.
          if (hz > 0) {
            const period = 1000 / hz
            const steps = Math.max(2, Math.min(32, Math.round(cfg.euclid.steps)))
            const pulses = Math.max(0, Math.min(steps, Math.round(cfg.euclid.pulses)))
            if (now - s.euclidLastAdvanceAt > period * 4) s.euclidLastAdvanceAt = now - period
            while (now - s.euclidLastAdvanceAt >= period) {
              s.euclidLastAdvanceAt += period
              if (slipSkip()) continue // a skipped tick holds the gate an extra step
              s.euclidStep = (s.euclidStep + 1) % steps
            }
            // The raw gate rises instantly on a pulse step; `decay` gives it a
            // release once the pulse ends, so the output rides continuously
            // between beats instead of snapping 1→0 (decay 0 = a hard gate).
            const gate = euclidHit(s.euclidStep, steps, pulses) ? 1 : 0
            const decay = Math.max(0, Math.min(1, cfg.euclid.decay ?? 0.35))
            if (gate >= s.euclidEnv) s.euclidEnv = gate
            else if (decay < 0.005) s.euclidEnv = 0
            else s.euclidEnv *= Math.exp(-dtMs / (20 * Math.pow(300, decay))) // ~20ms → ~6s
            v01 = s.euclidEnv
          }
          break
        }
        case 'turing': {
          // Shift-register sequence : the falling bit feeds back (loop) unless
          // `mutate` flips it (rewrite). Read the whole register as a value.
          if (hz > 0) {
            const period = 1000 / hz
            const len = Math.max(2, Math.min(16, Math.round(cfg.turing.length)))
            const mask = (1 << len) - 1
            const mutate = Math.max(0, Math.min(1, cfg.turing.mutate))
            if ((s.turingReg & mask) === 0) s.turingReg = (Math.floor(Math.random() * mask) | 1) & mask // seed / revive
            if (now - s.turingLastAdvanceAt > period * 4) s.turingLastAdvanceAt = now - period
            while (now - s.turingLastAdvanceAt >= period) {
              s.turingLastAdvanceAt += period
              if (slipSkip()) continue // hold the register a step
              const outBit = (s.turingReg >> (len - 1)) & 1
              const newBit = Math.random() < mutate ? 1 - outBit : outBit
              s.turingReg = ((s.turingReg << 1) | newBit) & mask
            }
            v01 = (s.turingReg & mask) / mask
          }
          break
        }
        case 'cellular': {
          // 1-D elementary CA advanced one generation per clock; output = density.
          if (hz > 0) {
            const period = 1000 / hz
            const cells = Math.max(8, Math.min(48, Math.round(cfg.cellular.cells)))
            const rule = Math.round(cfg.cellular.rule)
            // (Re)seed with a single centre cell if the row is the wrong size or died.
            if (s.cellRow.length !== cells || allDead(s.cellRow)) {
              s.cellRow = new Array<number>(cells).fill(0)
              s.cellRow[cells >> 1] = 1
            }
            if (now - s.cellLastAdvanceAt > period * 4) s.cellLastAdvanceAt = now - period
            while (now - s.cellLastAdvanceAt >= period) {
              s.cellLastAdvanceAt += period
              if (slipSkip()) continue // hold the generation a step
              s.cellRow = cellNext(s.cellRow, rule)
              if (allDead(s.cellRow)) s.cellRow[cells >> 1] = 1 // revive if it dies out
            }
            let live = 0
            for (const x of s.cellRow) live += x
            v01 = live / cells
          }
          break
        }
        case 'audio': {
          // Follow one feature off the audio bus (OSC/local). Unclocked : the
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
        case 'vision': {
          // Follow one feature off the vision bus (the composited PICTURE, one
          // frame behind). Unclocked : the image is the clock. One-pole smoothed.
          const vc = cfg.vision
          if (vc) {
            const raw = visionBus.feature(vc.feature)
            const sm = Math.max(0, Math.min(0.99, vc.smooth ?? 0))
            s.visionValue += (raw - s.visionValue) * (1 - sm)
            v01 = s.visionValue
          }
          break
        }
        case 'homeostat': {
          // Negative-feedback controller (AGC-as-modulator). Watch a picture
          // feature and regulate it around a SELF-ADAPTING baseline, so a feature
          // that naturally sits high or low (edges, motion…) still gives full
          // control range instead of pinning a rail. The signed deviation from
          // baseline, scaled by `range`, is compared to `setpoint` (0.5 = hold at
          // baseline; higher/lower biases above/below it). The error is integrated
          // into a corrective output centred on 0.5, so a `replace`-mode binding
          // nudges the bound param to hold the feature — parking the rig at the
          // chosen edge-of-chaos level. `adapt` sets how fast the baseline
          // re-centres (low = hold a level, high = only fight quick swings). The
          // binding depth's SIGN sets plant polarity; the integrator is clamped
          // (anti-windup) so a mis-signed or dead loop saturates, never runs away.
          const hc = cfg.homeostat
          if (hc) {
            const raw = visionBus.feature(hc.feature)
            if (!s.homeoSeeded) {
              s.homeoFeat = raw
              s.homeoBase = raw
              s.homeoSeeded = true
            }
            s.homeoFeat += (raw - s.homeoFeat) * 0.3 // fixed light de-noise
            // Slow baseline the loop regulates around (0.02 → ~2 Hz re-centre).
            const adapt = Math.max(0, Math.min(1, hc.adapt ?? 0.3))
            const baseRate = Math.min(1, (0.02 + adapt * 2) * dt)
            s.homeoBase += (s.homeoFeat - s.homeoBase) * baseRate
            // GAIN = grip : one knob for both deviation sensitivity and drive.
            const g = Math.max(0, Math.min(1, hc.gain ?? 0.4))
            const sens = 1 + g * 8 // 1…9× — fills the control span from small swings
            const norm = Math.max(0, Math.min(1, 0.5 + (s.homeoFeat - s.homeoBase) * sens))
            const set = Math.max(0, Math.min(1, hc.setpoint ?? 0.5))
            const error = set - norm
            const ki = 0.05 + g * 1.2 // integral rate (per unit-error · second)
            s.homeoInt = Math.max(-0.5, Math.min(0.5, s.homeoInt + error * ki * dt))
            v01 = 0.5 + s.homeoInt + error * (g * 0.3) // + a light proportional snap
          }
          break
        }
        case 'organic': {
          // Irregular periodicity + perpetual variation: a
          // base undulation plus INCOMMENSURATE partials whose phases slowly
          // DRIFT against each other : so the waveform is non-sinusoidal and
          // never repeats. `variation` grows the partials + a period wobble.
          // At variation 0 it degenerates to a clean sine.
          const varn = Math.max(0, Math.min(1, cfg.organic?.variation ?? 0.5))
          const td = now * 0.001
          const wobble = 0.5 * Math.sin(td * 0.11) + 0.5 * Math.sin(td * 0.067) // ~[-1,1]
          s.phase += hz * dt * (1 + varn * 0.8 * wobble)
          const p = s.phase * TWO_PI
          let v = Math.sin(p)
          v += varn * 0.7 * Math.sin(p * 1.71 + td * 0.31)
          v += varn * 0.4 * Math.sin(p * 2.93 + td * 0.47)
          v += varn * 0.22 * Math.sin(p * 0.51 - td * 0.19)
          const norm = 1 + varn * 1.32
          v01 = (v / norm) * 0.5 + 0.5
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
          const dtc = Math.min(0.04, dt)
          switch (cfg.physics?.motion ?? 'bounce') {
            case 'bounce': {
              // A real bouncing ball: launched to apex ≈ 1, losing energy at each
              // contact (restitution) so successive arcs shrink and quicken
              // (the Zeno feel), then resting until the next clock kick.
              const g = 14
              const r = 0.85 - damp * 0.58 // restitution 0.85 → 0.27
              if (kicked) {
                s.physPos = 0
                s.physVel = Math.sqrt(2 * g) // launch so the apex lands near 1
              }
              s.physVel -= g * dtc
              s.physPos += s.physVel * dtc
              if (s.physPos <= 0) {
                s.physPos = 0
                s.physVel = -s.physVel * r
              }
              v01 = s.physPos
              break
            }
            case 'spring': {
              // Damped harmonic oscillator toward an alternating target. `damp`
              // maps the damping ratio ζ from bouncy-underdamped to smooth-
              // critical: F = k·(target−x) − c·v, c = 2ζ√k (semi-implicit Euler).
              if (kicked) s.physTarget = s.physTarget > 0.5 ? 0 : 1
              const k = 90
              const zeta = 0.1 + damp * 0.9
              const c = 2 * zeta * Math.sqrt(k)
              s.physVel += (k * (s.physTarget - s.physPos) - c * s.physVel) * dtc
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
        case 'motion': {
          // Named motion archetypes + force behaviours —
          // each a characteristic scalar trajectory over one clocked cycle.
          s.phase += hz * dt
          const p = s.phase - Math.floor(s.phase) // [0,1) cycle position
          const shape = cfg.motion?.shape ?? 'oscillation'
          switch (shape) {
            case 'ascent': v01 = p * p; break // accelerating rise
            case 'descent': v01 = (1 - p) * (1 - p); break // decelerating fall
            case 'oscillation': v01 = 0.5 - 0.5 * Math.cos(TWO_PI * p); break
            case 'rotation': v01 = p; break // continuous wrap (angle)
            case 'dilation': v01 = 1 - (1 - p) * (1 - p); break // ease-out expand
            case 'contraction': v01 = 1 - Math.sqrt(p); break // quick pull-in
            case 'convergence': v01 = 0.5 + 0.5 * Math.cos(TWO_PI * 3 * p) * (1 - p); break // damped → centre
            case 'divergence': v01 = 0.5 + 0.5 * Math.sin(TWO_PI * 3 * p) * p; break // grows from centre
            case 'gravity': {
              // Bouncing fall: a parabola per cycle, energy bleeding across it.
              const b = Math.abs(Math.sin(Math.PI * p * 2.0))
              v01 = 1 - b * (0.4 + 0.6 * (1 - p))
              break
            }
            case 'wind': {
              // Gusty drift : summed incommensurate sines, never quite repeating.
              const td = now * 0.001
              v01 = 0.5 + 0.28 * Math.sin(TWO_PI * p) + 0.14 * Math.sin(td * 1.7 + 1.0) + 0.08 * Math.sin(td * 0.53)
              break
            }
            case 'attract': v01 = 1 - Math.pow(1 - p, 3); break // ease toward a pole, hold
            case 'drag': v01 = Math.exp(-3.2 * p); break // launch then decay to rest
          }
          break
        }
      }

      this.values[i] = shapeCurve(Math.max(0, Math.min(1, v01)), cfg.curve)
    }
    return this.values
  }
}

// One engine per renderer : App's frame loop ticks it; the modulation panel
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
    vision: { feature: 'brightness', smooth: 0.3 },
    organic: { variation: 0.5 },
    physics: { motion: 'bounce', damping: 0.5 },
    motion: { shape: 'oscillation' },
    homeostat: { feature: 'edges', setpoint: 0.5, gain: 0.4, adapt: 0.3 },
    euclid: { steps: 16, pulses: 5, decay: 0.35 },
    turing: { length: 8, mutate: 0.15 },
    cellular: { rule: 90, cells: 24 }
  }
}

export function makeDefaultModulators(): ModulatorConfig[] {
  return Array.from({ length: 8 }, () => makeDefaultModulator())
}

// Live modulated value per target key : the UI's sliders read this each rAF
// to move with the modulation (the dataFLOU behaviour). Key format matches
// the store's modTargetKey exactly.
export const liveModValues = new Map<string, number>()
// Live modulated Meta-knob positions (0..1) : the dials read these each rAF.
export const metaLiveValues = new Map<number, number>()

// ── Sonify probe modulation ───────────────────────────────────────────
// The Sonify page's probes (scan lines, orbit, raster rect) + pitches as
// mod-matrix / Meta targets. Values land in `sonifyModValues` (REAL units);
// the sonify engine reads them each tick and overlays them onto its config.
// Pitch params live in NOTE space (24..72) : the engine snaps/convert them.
export const SONIFY_MOD_DESCS: Record<string, { min: number; max: number; def: number }> = {
  spectraX: { min: 0, max: 1, def: 0.5 },
  filterX: { min: 0, max: 1, def: 0.5 },
  orbitX: { min: 0, max: 1, def: 0.5 },
  orbitY: { min: 0, max: 1, def: 0.5 },
  orbitR: { min: 0.02, max: 0.5, def: 0.25 },
  orbitPitch: { min: 24, max: 72, def: 45 },
  rasterX: { min: 0, max: 0.9, def: 0.35 },
  rasterY: { min: 0, max: 0.9, def: 0.35 },
  rasterW: { min: 0.04, max: 0.9, def: 0.3 },
  rasterH: { min: 0.03, max: 0.9, def: 0.3 },
  rasterPitch: { min: 24, max: 72, def: 45 }
}
export const sonifyModValues = new Map<string, number>()
// The engine registers a getter for each param's BASE value (swing centre).
export let sonifyModBase: ((param: string) => number | undefined) | null = null
export function registerSonifyModBase(fn: (param: string) => number | undefined): void {
  sonifyModBase = fn
}

function liveKey(t: import('@shared/types').ModTarget): string {
  if (t.kind === 'source') return `src:${t.layer}:${t.slot}:${t.input}`
  if (t.kind === 'bgSource') return `bgsrc:${t.input}`
  if (t.kind === 'meta') return `meta:${t.knob}`
  if (t.kind === 'sonify') return `soni:${t.param}`
  const s = t.scope
  const scopeKey =
    s.kind === 'master' || s.kind === 'background' ? s.kind : `${s.kind}:${s.layer}`
  return `fx:${scopeKey}:${t.instId}:${t.input}`
}

// A modulatable input descriptor (float / long-enum / bool), widened so the
// value mappers can reach an enum's declared VALUES.
interface ModDesc {
  type: string
  min?: number | number[]
  max?: number | number[]
  def?: number | number[]
  values?: number[]
}
const asNum = (x: unknown, d: number): number => (typeof x === 'number' ? x : d)
const nearest = (vals: number[], raw: number): number => {
  let best = vals[0]
  let bd = Infinity
  for (const v of vals) {
    const dd = Math.abs(v - raw)
    if (dd < bd) { bd = dd; best = v }
  }
  return best
}

/** Map an ABSOLUTE 0..1 position onto a settable value for any modulatable type
 *  (float spans [min,max]; enum maps across its ordered values; bool thresholds).
 *  null = not modulatable. Used by Meta destinations (knob position is absolute). */
export function inputValueFrom01(d: ModDesc, v01: number): number | null {
  const x = v01 < 0 ? 0 : v01 > 1 ? 1 : v01
  if (d.type === 'float') return asNum(d.min, 0) + x * (asNum(d.max, 1) - asNum(d.min, 0))
  if (d.type === 'long') {
    const vals = d.values ?? []
    return vals.length ? vals[Math.min(vals.length - 1, Math.floor(x * vals.length))] : null
  }
  if (d.type === 'bool' || d.type === 'event') return x >= 0.5 ? 1 : 0
  return null
}

/** Bipolar swing around the stored base : the 'replace' direct-modulator model.
 *  Enums snap to the nearest declared value; bools threshold. null = not modulatable. */
function inputValueFromSwing(
  d: ModDesc,
  stored: number | number[] | undefined,
  v: number,
  depth: number
): number | null {
  if (d.type === 'float') {
    const min = asNum(d.min, 0)
    const max = asNum(d.max, 1)
    const base = typeof stored === 'number' ? stored : asNum(d.def, min)
    return Math.max(min, Math.min(max, base + (v - 0.5) * 2 * depth * (max - min)))
  }
  if (d.type === 'long') {
    const vals = d.values ?? []
    if (!vals.length) return null
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const base = typeof stored === 'number' ? stored : asNum(d.def, min)
    return nearest(vals, base + (v - 0.5) * 2 * depth * (max - min))
  }
  if (d.type === 'bool' || d.type === 'event') {
    const base = typeof stored === 'number' ? stored : asNum(d.def, 0)
    return base + (v - 0.5) * 2 * depth >= 0.5 ? 1 : 0
  }
  return null
}

/** VCA-style 'multiply': scale the base by the modulator. `factor` = 1 at
 *  |depth| 0 (no effect) → `m` at |depth| 1 (full multiply); negative depth
 *  inverts the signal. Clamped/snapped per type. null = not modulatable. */
function inputValueFromMultiply(
  d: ModDesc,
  stored: number | number[] | undefined,
  v: number,
  depth: number
): number | null {
  const amt = Math.min(1, Math.abs(depth))
  const m = depth < 0 ? 1 - v : v
  const factor = 1 - amt + amt * m
  if (d.type === 'float') {
    const min = asNum(d.min, 0)
    const max = asNum(d.max, 1)
    const base = typeof stored === 'number' ? stored : asNum(d.def, min)
    return Math.max(min, Math.min(max, base * factor))
  }
  if (d.type === 'long') {
    const vals = d.values ?? []
    if (!vals.length) return null
    const base = typeof stored === 'number' ? stored : asNum(d.def, vals[0])
    return nearest(vals, base * factor)
  }
  if (d.type === 'bool' || d.type === 'event') {
    const base = typeof stored === 'number' ? stored : asNum(d.def, 0)
    return base * factor >= 0.5 ? 1 : 0
  }
  return null
}

/** Dispatch on the assignment's mode ('multiply' default; undefined =
 *  'replace' for pre-mode sessions). */
function inputValueForMode(
  d: ModDesc,
  stored: number | number[] | undefined,
  v: number,
  depth: number,
  mode: import('@shared/types').ModMode | undefined
): number | null {
  return mode === 'multiply'
    ? inputValueFromMultiply(d, stored, v, depth)
    : inputValueFromSwing(d, stored, v, depth)
}

/**
 * Apply the mod-matrix on top of the store's base values, writing straight
 * into the Compositor (post-syncFromState, pre-render). Base + bipolar swing:
 * final = clamp(base + (v−0.5)·2·depth·span, min, max). Enums/bools are driven
 * too (snap / threshold).
 */
// Video slots aren't ISF shaders, so their modulatable inputs carry synthetic
// descriptors : `position` = the normalized playhead within the in/out trim (the
// modulatable playhead), `speed` = a rate multiplier over the transport speed.
const VIDEO_MOD_DESCS: Record<string, ModDesc> = {
  position: { type: 'float', min: 0, max: 1, def: 0.5 },
  speed: { type: 'float', min: 0, max: 4, def: 1 },
  grainSize: { type: 'float', min: 0.05, max: 1, def: 0.25 },
  grainSpray: { type: 'float', min: 0, max: 1, def: 0.15 },
  loopIn: { type: 'float', min: 0, max: 1, def: 0 },
  loopOut: { type: 'float', min: 0, max: 1, def: 1 }
}

// The engine surface the overlay passes write into (the Compositor, or the
// output window's recording proxy). Shared by applyModulation + applyMetaGlides.
export interface ModComp {
  layers: Array<{
    setInput: (slot: 'A' | 'B', name: string, value: number) => void
    setVideoInput?: (slot: 'A' | 'B', name: string, value: number) => void
  } | null>
  setFxInput: (
    scope: import('@shared/types').FxScope,
    instId: string,
    name: string,
    value: number
  ) => void
  setBgSourceInput: (name: string, value: number) => void
}

/** Resolve one ISF-input target's shader + write the given ABSOLUTE 0..1
 *  position everywhere it needs to land (engine + live map). Shared by the
 *  mod-matrix meta path and the Meta-knob glide overlay. */
export function writeModTarget(
  comp: ModComp,
  c: CompositionState,
  descFor: (shaderId: string) => Array<{ name: string } & ModDesc>,
  t: Exclude<import('@shared/types').ModTarget, { kind: 'meta' }>,
  shaped01: number
): void {
  // Sonify probe : absolute 0..1 mapped over the param's declared span.
  if (t.kind === 'sonify') {
    const d = SONIFY_MOD_DESCS[t.param]
    if (!d) return
    const v = d.min + Math.max(0, Math.min(1, shaped01)) * (d.max - d.min)
    sonifyModValues.set(t.param, v)
    liveModValues.set(liveKey(t), v)
    return
  }
  let shaderId: string | null = null
  if (t.kind === 'source') {
    const layer = c.layers[t.layer]
    const slot = t.slot === 'A' ? layer?.sourceA : layer?.sourceB
    // Video slot : route position/speed through the video seam (no shader).
    if (slot?.kind === 'video' && VIDEO_MOD_DESCS[t.input]) {
      const value = inputValueFrom01(VIDEO_MOD_DESCS[t.input], shaped01)
      if (value === null || typeof value !== 'number') return
      liveModValues.set(liveKey(t), value)
      comp.layers[t.layer]?.setVideoInput?.(t.slot, t.input, value)
      return
    }
    shaderId = slot?.shaderId ?? null
  } else if (t.kind === 'bgSource') {
    shaderId = c.background?.source.shaderId ?? null
  } else {
    const s = t.scope
    const arr =
      s.kind === 'master'
        ? c.master
        : s.kind === 'background'
          ? c.background?.fx
          : s.kind === 'layer'
            ? c.layers[s.layer]?.fx
            : s.kind === 'sourceA'
              ? c.layers[s.layer]?.sourceAFx
              : c.layers[s.layer]?.sourceBFx
    shaderId = arr?.find((f) => f.id === t.instId)?.shaderId ?? null
  }
  if (!shaderId) return
  const d = descFor(shaderId).find((x) => x.name === t.input)
  if (!d) return
  const value = inputValueFrom01(d, shaped01)
  if (value === null) return
  liveModValues.set(liveKey(t), value)
  if (t.kind === 'source') comp.layers[t.layer]?.setInput(t.slot, t.input, value)
  else if (t.kind === 'bgSource') comp.setBgSourceInput(t.input, value)
  else comp.setFxInput(t.scope, t.instId, t.input, value)
}

/** Meta-knob glide overlay : while a knob glides (MIDI CC / randomize) or is
 *  dragged, its display position fans out to destinations HERE, straight into
 *  the engine — zero store writes per frame. The gesture's final value is
 *  committed to the store once, on settle (metaSmooth.ts). Runs after
 *  applyModulation so a live gesture wins the frame. */
export function applyMetaGlides(
  comp: ModComp,
  c: CompositionState,
  descFor: (shaderId: string) => Array<{ name: string } & ModDesc>,
  glides: Iterable<[number, number]>
): void {
  for (const [i, v01] of glides) {
    const knob = c.metaKnobs[i]
    if (!knob) continue
    // Same mapping as the settle-time store fan-out (metaSmooth.applyKnob) :
    // position shaped by the knob's curve, then mapped per destination.
    const shaped = shapeCurve(Math.max(0, Math.min(1, v01)), knob.curve)
    metaLiveValues.set(i, Math.max(0, Math.min(1, v01)))
    for (const dest of knob.destinations) {
      if (dest.kind === 'meta') continue // knobs never chain into knobs
      writeModTarget(comp, c, descFor, dest, shaped)
    }
  }
}

export function applyModulation(
  comp: ModComp,
  c: CompositionState,
  values: number[],
  descFor: (shaderId: string) => Array<{ name: string } & ModDesc>,
  bypass = false
): void {
  metaLiveValues.clear()
  sonifyModValues.clear()
  // Clear the live map each frame too (symmetric with metaLiveValues): otherwise
  // a removed mod-matrix assignment leaves a stale entry that liveOverlay keeps
  // writing into the slider forever, so the control never reverts to its base.
  liveModValues.clear()
  // Global modulation mute: with the maps cleared and no writes issued, the
  // Compositor keeps this frame's base values (syncFromState already ran) and
  // every slider reverts to its stored position. One flag, whole rig held still.
  if (bypass) return
  // Resolve one ISF-input target's shader + write the given value everywhere
  // it needs to land (engine + live map). Shared by direct and meta paths.
  const writeTarget = (
    t: Exclude<import('@shared/types').ModTarget, { kind: 'meta' }>,
    shaped01: number
  ): void => writeModTarget(comp, c, descFor, t, shaped01)

  for (const a of c.modMatrix) {
    const v = values[a.mod]
    if (v === undefined) continue
    if (a.target.kind === 'meta') {
      // Meta target: the knob's curve is its SCALING FUNCTION : the raw
      // modulator signal is shaped by the curve first (modulator × scaling
      // function), then swung around the knob's base position by depth. The
      // same shaped value is what the dial animates to AND what fans out to
      // the destinations, so what you see the knob doing is exactly what it
      // sends.
      const knob = c.metaKnobs[a.target.knob]
      if (!knob) continue
      const scaled = shapeCurve(Math.max(0, Math.min(1, v)), knob.curve)
      // Multiply scales the knob's base position (VCA on the macro); Replace
      // swings it around the base (default for pre-mode sessions).
      let v01: number
      if (a.mode === 'multiply') {
        const amt = Math.min(1, Math.abs(a.depth))
        const m = a.depth < 0 ? 1 - scaled : scaled
        v01 = Math.max(0, Math.min(1, knob.value * (1 - amt + amt * m)))
      } else {
        v01 = Math.max(0, Math.min(1, knob.value + (scaled - 0.5) * 2 * a.depth))
      }
      metaLiveValues.set(a.target.knob, v01)
      for (const dest of knob.destinations) {
        if (dest.kind === 'meta') continue // knobs never chain into knobs
        writeTarget(dest, v01)
      }
      continue
    }
    if (a.target.kind === 'sonify') {
      const d = SONIFY_MOD_DESCS[a.target.param]
      if (!d) continue
      const stored = sonifyModBase?.(a.target.param)
      const final = inputValueForMode(
        { type: 'float', min: d.min, max: d.max, def: d.def },
        stored, v, a.depth, a.mode
      )
      if (final === null || typeof final !== 'number') continue
      sonifyModValues.set(a.target.param, final)
      liveModValues.set(liveKey(a.target), final)
      continue
    }
    if (a.target.kind === 'source') {
      const layer = c.layers[a.target.layer]
      if (!layer) continue
      const slot = a.target.slot === 'A' ? layer.sourceA : layer.sourceB
      // Video slot : position/speed modulate through the video seam.
      if (slot?.kind === 'video' && VIDEO_MOD_DESCS[a.target.input]) {
        const d = VIDEO_MOD_DESCS[a.target.input]
        const final = inputValueForMode(d, undefined, v, a.depth, a.mode)
        if (final === null || typeof final !== 'number') continue
        liveModValues.set(liveKey(a.target), final)
        comp.layers[a.target.layer]?.setVideoInput?.(a.target.slot, a.target.input, final)
        continue
      }
      if (!slot?.shaderId) continue
      const input = a.target.input
      const d = descFor(slot.shaderId).find((x) => x.name === input)
      if (!d) continue
      const final = inputValueForMode(d, slot.inputs[input], v, a.depth, a.mode)
      if (final === null) continue
      liveModValues.set(liveKey(a.target), final)
      comp.layers[a.target.layer]?.setInput(a.target.slot, a.target.input, final)
    } else if (a.target.kind === 'bgSource') {
      const src = c.background?.source
      if (!src?.shaderId) continue
      const input = a.target.input
      const d = descFor(src.shaderId).find((x) => x.name === input)
      if (!d) continue
      const final = inputValueForMode(d, src.inputs[input], v, a.depth, a.mode)
      if (final === null) continue
      liveModValues.set(liveKey(a.target), final)
      comp.setBgSourceInput(input, final)
    } else {
      const { scope, instId, input } = a.target
      let arr = c.master
      if (scope.kind === 'background') {
        arr = c.background?.fx ?? []
      } else if (scope.kind !== 'master') {
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
      const d = descFor(inst.shaderId).find((x) => x.name === input)
      if (!d) continue
      const final = inputValueForMode(d, inst.inputs[input], v, a.depth, a.mode)
      if (final === null) continue
      liveModValues.set(liveKey(a.target), final)
      comp.setFxInput(scope, instId, input, final)
    }
  }
}
