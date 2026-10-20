// The shaping stage of a modulation binding (ModAssignment.shape), between the
// modulator and the parameter, in this order :
//
//   COMBINE    this binding's modulator with one or two others, through + − ×
//              min max (bass × LFO : the LFO swings only while there is bass;
//              LFO − kick : it ducks on the kick; max(hands, kick) : either).
//   THRESHOLD  only what passes the line : room noise or a quiet passage does
//              nothing. cut keeps the part above, opened back to 0..1; gate is
//              on or off.
//   INTEGRATE  the value pushes a running position that STAYS where it got to,
//              instead of falling back to the base when the sound stops. flow :
//              louder = faster, silence = it holds; step : each hit turns it one
//              notch (the kick turning a rotation, a hue, a camera per beat).
//
// Then the binding's depth and mode (mul / rep) map the result as before. All
// values are 0..1. The integrators live here, per binding id, so a session
// opens with every position at its middle (0.5 : the parameter at its base).

import type { ModAssignment, ModCombineOp, ModShape } from '@shared/types'

export const MOD_SLOTS = 8
const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x)

/** A shape from a session (or a hand-edited file) : every field in range, the
 *  combined modulators other than the binding's own; nothing left = none. */
export function sanitizeModShape(v: unknown, own: number): ModShape | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const out: ModShape = {}
  const ops: ModCombineOp[] = ['add', 'sub', 'mul', 'min', 'max']
  if (Array.isArray(o.with) && ops.includes(o.op as ModCombineOp)) {
    const w = [...new Set(o.with.map((x) => Math.round(Number(x))).filter((x) => x >= 0 && x < MOD_SLOTS && x !== own))].slice(0, 2)
    if (w.length) {
      out.with = w
      out.op = o.op as ModCombineOp
    }
  }
  const t = Number(o.threshold)
  if (Number.isFinite(t) && t > 0) {
    out.threshold = Math.min(0.99, t)
    if (o.thresholdMode === 'gate') out.thresholdMode = 'gate'
  }
  if (o.integrate === 'flow' || o.integrate === 'step') {
    out.integrate = o.integrate
    const r = Number(o.rate)
    const s = Number(o.step)
    out.rate = Number.isFinite(r) ? Math.max(0.01, Math.min(4, r)) : 0.25
    out.step = Number.isFinite(s) ? Math.max(0.01, Math.min(0.5, s)) : 0.125
    if (o.ends === 'wrap') out.ends = 'wrap'
  }
  return Object.keys(out).length ? out : undefined
}

/** Is anything on ? (an empty or all-off shape reads as no shape) */
export function shapeActive(s: ModShape | undefined): boolean {
  return !!s && (!!s.with?.length || (s.threshold ?? 0) > 0 || s.integrate === 'flow' || s.integrate === 'step')
}

export function combine(a: number, b: number, op: ModCombineOp): number {
  switch (op) {
    case 'add': return clamp01(a + b)
    case 'sub': return clamp01(a - b)
    case 'mul': return a * b
    case 'min': return Math.min(a, b)
    case 'max': return Math.max(a, b)
  }
}

interface Integrator {
  pos: number // where the push has got to, unwrapped (0.5 = the base)
  shown: number // what plays : pos, eased over a few frames (a step never jumps a frame)
  held: boolean // step : a hit is in progress (waiting to fall back under)
  gate: boolean // threshold gate : on (with a little hysteresis)
}
const state = new Map<string, Integrator>()
const stateOf = (id: string): Integrator => {
  let s = state.get(id)
  if (!s) {
    s = { pos: 0.5, shown: 0.5, held: false, gate: false }
    state.set(id, s)
  }
  return s
}

/** Back to the middle (the parameter at its base) : the editor's reset. */
export function resetIntegrator(id: string): void {
  state.delete(id)
}

/** What each binding's shaping gave this frame, before depth and mode, and the
 *  modulator's own value beside it : the editor's meter. */
export const shapedLive = new Map<string, { raw: number; out: number }>()

let pruneTick = 0
/** Forget the integrators of bindings that are gone (now and then). */
export function pruneShapes(matrix: ModAssignment[]): void {
  if (++pruneTick % 240) return
  const ids = new Set(matrix.map((a) => a.id))
  for (const k of state.keys()) if (!ids.has(k)) state.delete(k)
  for (const k of shapedLive.keys()) if (!ids.has(k)) shapedLive.delete(k)
}

/** The binding's value this frame, shaped. `dt` in seconds. */
export function shapeValue(a: ModAssignment, values: number[], dt: number): number {
  const raw = clamp01(values[a.mod] ?? 0)
  const s = a.shape
  if (!s) return raw
  let v = raw
  // combine
  if (s.with?.length && s.op) {
    for (const m of s.with) {
      const w = values[m]
      if (w !== undefined) v = combine(v, clamp01(w), s.op)
    }
  }
  // threshold
  const t = s.threshold ?? 0
  if (t > 0) {
    if (s.thresholdMode === 'gate') {
      const g = stateOf(a.id)
      // a little hysteresis : a value hovering on the line never chatters
      if (g.gate) g.gate = v >= t - 0.04
      else g.gate = v >= t
      v = g.gate ? 1 : 0
    } else {
      v = v <= t ? 0 : (v - t) / (1 - t)
    }
  }
  // integrate
  if (s.integrate === 'flow' || s.integrate === 'step') {
    const g = stateOf(a.id)
    if (s.integrate === 'flow') {
      g.pos += v * (s.rate ?? 0.25) * dt
      g.shown = g.pos
    } else {
      // a hit : up past the middle after having fallen back under a quarter
      if (!g.held && v > 0.5) {
        g.held = true
        g.pos += s.step ?? 0.125
      } else if (g.held && v < 0.25) g.held = false
      // the notch eases in over ~60 ms : quick, but never a one-frame jump
      g.shown += (g.pos - g.shown) * (1 - Math.exp(-dt / 0.06))
    }
    // keep the numbers small on a long run (whole turns change nothing)
    if (Math.abs(g.pos) > 1e6) {
      const k = Math.floor(g.pos)
      g.pos -= k
      g.shown -= k
    }
    const p = g.shown
    v = s.ends === 'wrap' ? p - Math.floor(p) : 1 - Math.abs((((p % 2) + 2) % 2) - 1)
  }
  shapedLive.set(a.id, { raw, out: v })
  return v
}
