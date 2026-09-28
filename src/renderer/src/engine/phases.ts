// Integrated phases : motion that follows a rate knob without jumping.
//
// A generator that animates with `TIME * rate` jumps whenever rate changes :
// the layer clock never resets, so at TIME = 1800 s a 0.01 nudge moves the
// picture 18 units at once, and an LFO or a Morph on rate turns the motion into
// strobing noise. The cure is to integrate : phase += rate · dt, frame by frame,
// so a new rate changes how fast the picture moves from here on, never where
// it is.
//
// A shader asks for one by declaring a plain uniform named PH_<something> :
//
//   uniform float PH_rate;            // ∫ rate dt
//   uniform float PH_speed_x_count;   // ∫ speed · count dt
//
// The name after PH_ lists the inputs whose PRODUCT is integrated, joined by
// `_x_` (constant factors belong in the shader : ∫ 3·rate = 3·∫ rate). A
// shader whose motion law is not a plain product registers its own integrand
// below, keyed by the full uniform name. The declaration must be one line,
// `uniform float PH_name;`, single-spaced, for the runtime's uniform scanner.
//
// A phase is uploaded as a float32 : after a day at a high rate it steps
// visibly. A shader that only uses the phase periodically can opt into a wrap :
//   uniform float PH_rate; // wrap 6.2831853
// keeps the value in [0, period) (the period must be one the shader's use of
// the phase repeats on : 1 for fract(), 2π for sin(), 4096 for a tiling noise).
//
// dt is the renderer's OWN clock (the layer / background / FX clock the
// Compositor stamps as TIME), so layer Speed, global speed, freeze and reverse
// all carry through. Each phase starts at a random offset so two layers
// running the same generator never move in lockstep.

type Get = (name: string) => number

/** Integrands that are not a plain product of inputs, by uniform name. */
const INTEGRANDS: Record<string, (v: Get) => number> = {
  // Sync Osc : the scroll slows to a stop over the first half of `sync`.
  PH_syncScroll: (v) => v('rate') * (1 - smooth(0, 0.5, v('sync'))),
  // Differential : layer k turns at rate·(1 + k·(ratio − 1)), so it needs
  // ∫rate and ∫rate·(ratio − 1).
  PH_diffSpread: (v) => v('rate') * (v('ratio') - 1),
  // Scan : the material drifts along driftAngle, so the drift is a vector ;
  // turning the angle bends the path instead of swinging the whole offset.
  PH_scanDX: (v) => v('drift') * Math.cos(v('driftAngle')),
  PH_scanDY: (v) => v('drift') * Math.sin(v('driftAngle')),
  // Colony : one auto-regrow every `cycle` seconds (0 = off).
  PH_colonyCycle: (v) => (v('cycle') > 0.5 ? 1 / v('cycle') : 0),
  // Organic : the fire rises and the water flows faster with both rate and flow.
  PH_orgRise: (v) => v('rate') * (1.4 + v('rate')) * (0.5 + v('flow')),
  PH_orgFlow: (v) => v('rate') * (0.4 + v('flow')),
  PH_orgPuff: (v) => (v('rate') * 7.5) / Math.sqrt(Math.max(v('scale'), 0.5)),
  // Particle Drift : the field travels along `flow` at speed·count cells/s, a
  // vector (like Scan) : turning flow bends the path, changing speed or count
  // changes the pace, and none of them flings the accumulated offset.
  PH_pdriftX: (v) => v('speed') * v('count') * Math.cos(v('flow')),
  PH_pdriftY: (v) => v('speed') * v('count') * Math.sin(v('flow'))
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

interface PhaseState {
  uniforms: object
  names: string[]
  fns: Array<(v: Get) => number>
  wrap: number[] // 0 = never wrap
  val: number[]
  lastT: number
}

interface PhaseHost {
  uniforms?: Record<string, { value?: unknown }>
  fragmentShader?: string
  setValue: (name: string, value: number) => void
  __opsiaPh?: PhaseState | null
}

function integrandFor(name: string): ((v: Get) => number) | null {
  const custom = INTEGRANDS[name]
  if (custom) return custom
  const parts = name.slice(3).split('_x_').filter(Boolean)
  if (!parts.length) return null
  return (v) => {
    let p = 1
    for (const k of parts) p *= v(k)
    return p
  }
}

/** Advance every PH_ uniform of a renderer to its clock's time `t` (seconds).
 *  Called from the patched setDateUniforms, once per draw. */
export function tickPhases(r: PhaseHost, t: number): void {
  const u = r.uniforms
  if (!u) return
  let st = r.__opsiaPh
  if (st === undefined || (st && st.uniforms !== u)) {
    const names = Object.keys(u).filter((k) => k.startsWith('PH_'))
    if (!names.length) { r.__opsiaPh = null; return }
    const fns: Array<(v: Get) => number> = []
    const kept: string[] = []
    for (const n of names) {
      const f = integrandFor(n)
      if (f) { kept.push(n); fns.push(f) }
    }
    const src = r.fragmentShader ?? ''
    const wrap = kept.map((n) => {
      const m = src.match(new RegExp('uniform float ' + n + ';[ \\t]*//[ \\t]*wrap[ \\t]+([0-9.eE+-]+)'))
      const w = m ? Number(m[1]) : 0
      return Number.isFinite(w) && w > 0 ? w : 0
    })
    st = { uniforms: u, names: kept, fns, wrap, val: kept.map((_, i) => (wrap[i] ? Math.random() * wrap[i] : Math.random() * 64)), lastT: t }
    r.__opsiaPh = st
  }
  if (!st) return
  // A clock that jumps (a session load, a reset) must not fling the phase : a
  // gap is taken as at most a quarter second of motion at the current rate.
  const dt = Math.max(-0.25, Math.min(0.25, t - st.lastT))
  st.lastT = t
  const get: Get = (k) => {
    const x = u[k]?.value
    return typeof x === 'number' ? x : typeof x === 'boolean' ? (x ? 1 : 0) : 0
  }
  for (let i = 0; i < st.names.length; i++) {
    let v = st.val[i] + dt * st.fns[i](get)
    const w = st.wrap[i]
    if (w) v = ((v % w) + w) % w
    st.val[i] = v
    r.setValue(st.names[i], v)
  }
}
