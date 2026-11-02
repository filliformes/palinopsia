// The Sonify Synth's sound engine (plain JS, no imports : loaded into the
// Sonify AudioWorklet's global scope with its own addModule, BEFORE
// soni.worklet.js, and testable in Node the same way). It hands itself over as
// `globalThis.OpsiaSynth`; the Sonify processor builds one and drives it.
//
// THIS FILE IS THE CONTRACT between the two halves of the Synth :
// - the sound (this engine : eight engines, the voices, the filter, the
//   envelope, drift, chorus), and
// - the play (sonify.ts : the moving things found in the picture, the notes
//   they play, the picture patchbay, the panel, the plumbing).
// The interface below is fixed; what is behind it is the sound's to build.
//
// ── Interface ──────────────────────────────────────────────────────────────
//
//   const s = new globalThis.OpsiaSynth(sampleRate)
//
//   s.setConfig(cfg)   the static sound, sent on change (never per sample).
//     Every number is 0..1 unless said otherwise; the engine maps it to its
//     own ranges and smooths it.
//     { engine:  'dco' | 'ms' | 'swarm' | 'fm' | 'modal' | 'voice' | 'fold' | 'pluck',
//       timbre, harmonics, morph,            the engine's three macros
//       voices:  'poly' | 'unison' | 'mono', (poly : 8 voices)
//       filter:  'ladder' | 'ms' | 'morph',
//       cutoff, reso, drive, hpf,
//       fmode,                               the morph filter's LP → BP → HP
//       envAmt,                              -1..1 : the envelope on the cutoff
//       attack, decay, sustain, release,
//       glide, drift,
//       chorus:  0 | 1 | 2,                  off · I · II
//       level }                              the synth's own output level
//
//   s.noteOn(id, hz, vel)   a moving thing plays (id : its integer track id;
//     vel 0..1). The engine picks the voice (poly : a free one, else the
//     oldest is stolen with a short fade; unison : all voices on this note;
//     mono : last note wins, glide from the one before). noteOn on an id that
//     is already sounding RE-STRIKES it on the same voice (Steps : a thing
//     crossing scale notes), gliding from its pitch when glide > 0.
//   s.setPitch(id, hz)      the same note slides to a new pitch, no strike (Slide).
//   s.noteOff(id)           the thing stopped or left : its voice releases.
//   s.setMods(id, m)        the picture patchbay's result for that thing,
//     sent ~30 times a second, smoothed by the engine (never zippers) :
//     { vel,                  0..1 : continuous expression (about ±6 dB
//                             around the strike's own velocity)
//       timbre, harmonics, morph, cutoff, reso, drive,
//                             -1..1 : offsets around the config's values,
//                             the sum clamped to 0..1
//       env,                  -1..1 : the envelope's times (-1 plucky … +1
//                             a slow pad), applied at the next strike
//       pan,                  -1..1 : the voice's place (absolute)
//       bend }                -1..1 : ± 2 semitones
//   s.allOff()              every voice releases now (stop, panic).
//   s.render(outL, outR, n) ADDS n frames of stereo into the two buffers.
//   s.activeVoices()        how many voices sound (for the meters).
//
// Rules (the worklet's) : no allocation inside render(); never a click (a
// switched engine crossfades, a stolen voice fades over ~5 ms); every engine
// band-limited (no aliasing whistle up high) and loudness-matched to the
// others.
//
// ── What is behind it ──────────────────────────────────────────────────────
//
// Eight voices, each : an engine (its three macros) → a DC blocker → drive →
// the tone filter → the VCA (one ADSR for amp and filter) → pan. The voices sum
// into one bus : the non-resonant HPF, the BBD chorus, the level, a soft knee.
// Everything that moves is updated every CTL (16) samples and ramped linearly
// sample by sample in between (the control-rate pattern of schwung-quark), so
// nothing steps and the per-sample loops stay small.
//
// Sources, each credited again above its block (full notices in
// THIRD_PARTY_NOTICES.md) :
// - jx-move, aphex-move, essaim-move (Vincent Fillion, MIT) : the DCO pair with
//   exact-event BLEP / BLAMP, sync and the cross-clock metal; the IR3109-style
//   ladder; the BBD chorus and the HPF; the Korg-35 style pair; the drift
//   design; the swarm voice; the linear release.
// - schwung-hank (Charles Vestal, MIT) : the 2-op FM macro layer, its ratio
//   list, the coupled modulator envelope and the bite shaper.
// - schwung-quark (James Fish, MIT) : the control-rate ramps, the first-order
//   ADAA soft clip drive, the morphing SVF weights.
// - klaine/crest (Klaine, MIT) : per-sample shape / density smoothing, the
//   detuned density copies, the saturating SVF, the 4-point polyBLEP form.
// - TinyPro5 (Mathew Taylor, MIT) : the three-band 1/f drift walk, the
//   self-oscillation seeding.
// - Built here from the published methods : the complex one-pole modal bank
//   (Mathews and Smith), the formant voice (Peterson and Barney's vowel
//   formants), the ADAA wavefolder and low-pass gate, the Karplus-Strong
//   string with Lagrange tuning and allpass dispersion.

;(() => {
'use strict'

const TAU = 6.283185307179586
const NV = 8
const CTL = 16
const INV_CTL = 1 / CTL
const LN1000 = 6.907755278982137
const BLOCK = 512

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x }
function sstep(x) { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x) }
function exp2(x) { return Math.pow(2, x) }
// Padé tanh : within ~2 % of tanh for |x| < 3, exactly ±1 beyond (jx-move).
function ftanh(x) {
  if (x > 3) return 1
  if (x < -3) return -1
  const x2 = x * x
  return (x * (27 + x2)) / (27 + 9 * x2)
}

// A 4096-point sine table, linearly read (error under -120 dB).
const SIN_N = 4096
const SIN_T = new Float64Array(SIN_N + 1)
for (let i = 0; i <= SIN_N; i++) SIN_T[i] = Math.sin((TAU * i) / SIN_N)
/** sin(2π·ph), ph in turns (any real). */
function sin1(ph) {
  ph -= Math.floor(ph)
  const f = ph * SIN_N
  const i = f | 0
  return SIN_T[i] + (SIN_T[i + 1] - SIN_T[i]) * (f - i)
}

// ── band-limited steps and corners ─────────────────────────────────────────
// After jx-move (Vincent Fillion, MIT) : the cubic B-spline kernel, 4 points,
// step (blep4) and its integral for slope corners (blamp4), t in samples from
// the event.
function blep4(t) {
  if (t <= -2 || t >= 2) return 0
  if (t < -1) { const u = 2 + t; return (u * u * u * u) / 24 }
  const t2 = t * t, t3 = t2 * t, t4 = t2 * t2
  if (t < 0) return 0.5 + t * (2 / 3) - t3 / 3 - t4 * 0.125
  if (t < 1) return -0.5 + t * (2 / 3) - t3 / 3 + t4 * 0.125
  const u = 2 - t
  return -(u * u * u * u) / 24
}
function blamp4(t) {
  const a = t < 0 ? -t : t
  if (a >= 2) return 0
  if (a >= 1) { const u = 2 - a; return (u * u * u * u * u) / 120 }
  const a2 = a * a, a4 = a2 * a2
  return 7 / 30 - a * 0.5 + a2 / 3 - a4 / 12 + (a4 * a) / 40
}
// The same kernel read from an oscillator's phase (klaine/crest's 4-point
// polyBLEP form, MIT) : a corrected edge is naive + jump * pblep(t, dt), t the
// phase since the edge, dt the phase step (dt < 0.25).
function pblep(t, dt) {
  if (t < 2 * dt) {
    const x = t / dt
    if (x < 1) return x * (2 / 3 + x * x * (-1 / 3 + x * 0.125)) - 0.5
    const u = 2 - x
    return -(u * u * u * u) / 24
  }
  if (t > 1 - 2 * dt) {
    const x = (t - 1) / dt
    if (x > -1) return x * (2 / 3 + x * x * (-1 / 3 - x * 0.125)) + 0.5
    const u = 2 + x
    return (u * u * u * u) / 24
  }
  return 0
}
/** Band-limited triangle (-1 at phase 0, +1 at 0.5). */
function triBL(t, dt) {
  let y = t < 0.5 ? 4 * t - 1 : 3 - 4 * t
  const D = 8 * dt
  if (t < 2 * dt) y += D * blamp4(t / dt)
  else if (t > 1 - 2 * dt) y += D * blamp4((t - 1) / dt)
  const d = t - 0.5
  if (d > -2 * dt && d < 2 * dt) y -= D * blamp4(d / dt)
  return y
}
function sawBL(t, dt) { return 2 * t - 1 - 2 * pblep(t, dt) }
/** Band-limited square, low then high (in phase with the saw : a crossfade
 *  between them never cancels). */
function sqrBL(t, dt) {
  let y = t < 0.5 ? -1 : 1
  y -= 2 * pblep(t, dt)
  let t2 = t - 0.5
  if (t2 < 0) t2 += 1
  return y + 2 * pblep(t2, dt)
}

// ── the drive : first-order ADAA soft clip ─────────────────────────────────
// After schwung-quark (James Fish, MIT) : 1.5u - 0.5u³ (unity at ±1), its
// antiderivative, and the level / bias / makeup law of its drive.
function sclip(u) { return u > 1 ? 1 : u < -1 ? -1 : 1.5 * u - 0.5 * u * u * u }
function sclipF(u) {
  const a = u < 0 ? -u : u
  if (a > 1) return a - 0.375
  const u2 = u * u
  return 0.75 * u2 - 0.125 * u2 * u2
}

// ── 2x oversampling for the drive ──────────────────────────────────────────
// A 31-tap halfband (Kaiser-windowed sinc, beta 8 : flat to ~0.33 fs, -80 dB
// from ~0.67 fs), the same taps for up and down. Up : the even output is the
// input 8 samples late, the odd one the 16 odd taps (x2). Down : the centre
// tap plus the 16 odd taps over the last 31 samples at 2x. 15.5 samples late
// in all.
const HB = new Float64Array(16)
{
  const bes = (x) => { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t } return s }
  const beta = 8
  let sum = 0
  for (let i = 0; i < 16; i++) {
    const j = 2 * i - 15
    const w = bes(beta * Math.sqrt(1 - (j / 16) * (j / 16))) / bes(beta)
    HB[i] = (0.5 * Math.sin((Math.PI * j) / 2)) / ((Math.PI * j) / 2) * w
    sum += HB[i]
  }
  for (let i = 0; i < 16; i++) HB[i] *= 0.5 / sum
}

// ── the jx-move DCO ────────────────────────────────────────────────────────
// After jx-move (Vincent Fillion, MIT) : one DCO = a counter phase c (the
// rectangular) + an integrator r (the ramp), every discontinuity (wrap, the
// rectangular's edge, a sync / metal reset) given a step residual and every
// slope corner (the fixed-time pulse ramp reaching the rail) a ramp residual at
// its true sub-sample time, the output two samples late. Extended here : four
// shapes summed with weights (so the timbre crossfades through one event list),
// each DC-free by construction.
//   P : the fixed-time pulse (the ramp reaches the rail in 0.18 ms, holds)
//   Q : the square     S : the saw     N : a 25 % pulse (for the pulse-saw)
const PULSE_T = 0.00018
// a unit : [c, r, y1, y2, carry] in a Float64Array (written every sample)
function DcoUnit() { return new Float64Array(5) }
// The shape weights of the unit being ticked, and the four residuals it owes
// (typed arrays : a module-level number reassigned per sample would be boxed
// anew each time and fill the heap).
const G = new Float64Array(6)
const AP = 0, AQ = 1, AS = 2, AN = 3, GW = 4, PDC = 5
const ACC = new Float64Array(4)
function accStep(h, f) {
  ACC[0] += h * blep4(f - 2); ACC[1] += h * blep4(f - 1); ACC[2] += h * blep4(f); ACC[3] += h * blep4(f + 1)
}
function accKink(dm, f) {
  ACC[0] += dm * blamp4(f - 2); ACC[1] += dm * blamp4(f - 1); ACC[2] += dm * blamp4(f); ACC[3] += dm * blamp4(f + 1)
}
function dNaive(c, r) {
  let y = G[AS] * (2 * r - 1)
  const aP = G[AP], aQ = G[AQ], aN = G[AN]
  if (aP !== 0) { const x = r / G[GW]; y += aP * ((x < 1 ? 2 * x - 1 : 1) - G[PDC]) }
  if (aQ !== 0) y += c < 0.5 ? -aQ : aQ
  if (aN !== 0) y += aN * (c < 0.75 ? -0.5 : 1.5)
  return y
}
function dSlope(r, dt) {
  let m = G[AS] * 2 * dt
  const aP = G[AP], w = G[GW]
  if (aP !== 0 && (w >= 1 || r < w)) m += (aP * 2 * dt) / w
  return m
}
function dReset(d, dt, resetCounter, f) {
  const v0 = dNaive(d[0], d[1]), m0 = dSlope(d[1], dt)
  if (resetCounter) d[0] = 0
  d[1] = 0
  accStep(dNaive(d[0], d[1]) - v0, f)
  accKink(dSlope(d[1], dt) - m0, f)
}
function dAdvance(d, dt, len, t0) {
  let t = 0
  const aP = G[AP], aQ = G[AQ], aN = G[AN], w = G[GW]
  for (let guard = 0; guard < 8; guard++) {
    const rem = len - t
    const c = d[0], r = d[1]
    let thr = 1
    if (aQ !== 0 && c < 0.5) thr = 0.5
    else if (aN !== 0 && c < 0.75) thr = 0.75
    const kink = aP !== 0 && w < 1 && r < w
    const adv = dt * rem
    if (c + adv < thr && (!kink || r + adv < w)) { d[0] = c + adv; d[1] = r + adv; return }
    const idt = 1 / dt
    let tn = (1 - c) * idt, ev = 0
    if (aQ !== 0 && c < 0.5) { const te = (0.5 - c) * idt; if (te < tn) { tn = te; ev = 1 } }
    if (aN !== 0 && c < 0.75) { const te = (0.75 - c) * idt; if (te < tn) { tn = te; ev = 3 } }
    if (kink) { const tk = (w - r) * idt; if (tk < tn) { tn = tk; ev = 2 } }
    if (tn > rem) { d[0] = c + adv; d[1] = r + adv; return }
    d[0] = c + dt * tn
    d[1] = r + dt * tn
    t += tn
    const f = clamp(1 - (t0 + t), 0, 1)
    if (ev === 0) { d[0] = 1; dReset(d, dt, true, f) }
    else if (ev === 1) { d[0] = 0.5; accStep(2 * aQ, f) }
    else if (ev === 3) { d[0] = 0.75; accStep(2 * aN, f) }
    else { d[1] = w; accKink((-aP * 2 * dt) / w, f) }
  }
}
/** One sample (two late). DP[0] = dt; DP[1] = ext in [0,1], an external
 *  reset this sample (the master's wrap), else -1; resetCounter : sync
 *  (counter + ramp) or metal (ramp only). The sample comes back in DP[2]
 *  (dTick is too big to inline : a number passed or returned would be boxed
 *  on every call). */
const DP = new Float64Array(3)
function dTick(d, resetCounter) {
  const dt = DP[0], ext = DP[1]
  if (ext < 0) {
    // most samples cross no event : no residuals to place
    const c = d[0], r = d[1], cn = c + dt, rn = r + dt
    const w = G[GW]
    let thr = 1
    if (G[AQ] !== 0 && c < 0.5) thr = 0.5
    else if (G[AN] !== 0 && c < 0.75) thr = 0.75
    if (cn < thr && (G[AP] === 0 || w >= 1 || r >= w || rn < w)) {
      d[0] = cn; d[1] = rn
      DP[2] = d[3]
      d[3] = d[2]
      d[2] = dNaive(cn, rn) + d[4]
      d[4] = 0
      return
    }
  }
  ACC[0] = 0; ACC[1] = 0; ACC[2] = 0; ACC[3] = 0
  if (ext >= 0) {
    dAdvance(d, dt, ext, 0)
    dReset(d, dt, resetCounter, 1 - ext)
    dAdvance(d, dt, 1 - ext, ext)
  } else dAdvance(d, dt, 1, 0)
  DP[2] = d[3] + ACC[0]
  d[3] = d[2] + ACC[1]
  d[2] = dNaive(d[0], d[1]) + d[4] + ACC[2]
  d[4] = ACC[3]
}
function setPulse(dt, kW) {
  const w = dt * kW
  G[GW] = w
  G[PDC] = w < 1 ? 1 - w : 1 / w - 1
}

// Ramps live in a Float64Array : [cur, inc] pairs. A control tick sets the
// increment that lands on the target CTL samples later (or snaps on a fresh
// note); the sample loops only add.
function setR(R, j, tgt, snap) {
  if (snap) { R[2 * j] = tgt; R[2 * j + 1] = 0 } else R[2 * j + 1] = (tgt - R[2 * j]) * INV_CTL
}
/** A soft staircase : plateaus on each step, a smooth riser between. */
function stair(steps, x) {
  const m = steps.length - 1
  const y = clamp(x, 0, 1) * m
  const i = Math.min(m - 1, y | 0)
  const s = sstep((y - i - 0.3) / 0.4)
  return steps[i] + (steps[i + 1] - steps[i]) * s
}
// Each voice's xorshift state lives in an Int32Array : under pointer
// compression (the worklet's) a full 32-bit integer in a field is boxed.
function rnd01(v) {
  const st = v.rs
  let r = st[0]
  r ^= r << 13; r ^= r >>> 17; r ^= r << 5
  st[0] = r
  return (r >>> 0) * 2.3283064365386963e-10
}

// ═══ 1 · dco ════════════════════════════════════════════════════════════════
// timbre : pulse → square → saw → pulse-saw (crossfaded through one event list)
// harmonics : density (detuned copies of DCO-1, power-normalized, klaine/crest)
//   over the first 40 %, then the 2nd DCO's interval up a soft staircase
//   (unison, fifth, octave, twelfth, two octaves)
// morph : free → hard sync sweeping DCO-2 up two octaves → metal (DCO-2's ramp
//   reset by both counters), each mode its own unit, crossfaded
const DCO_STEPS = [0, 7, 12, 19, 24]
class DcoSt {
  constructor() {
    this.d1 = DcoUnit()
    this.k1 = DcoUnit(); this.k2 = DcoUnit(); this.k3 = DcoUnit()
    this.uf = DcoUnit(); this.us = DcoUnit(); this.um = DcoUnit()
    this.R = new Float64Array(2 * 16)
    this.r1 = 1; this.r2 = 1; this.r3 = 1
    this.copies = false; this.fOn = false; this.sOn = false; this.mOn = false
  }
}
function unitSeed(dst, src) { dst.set(src) }
const dco = {
  start(v, s, fresh) {
    const st = v.dco
    if (fresh) {
      const us = [st.d1, st.k1, st.k2, st.k3, st.uf, st.us, st.um]
      for (let i = 0; i < us.length; i++) {
        const u = us[i]
        u[0] = u[1] = rnd01(v) * 0.999
        u[2] = u[3] = u[4] = 0
      }
    }
  },
  ctl(v, s, snap) {
    const st = v.dco, R = st.R, T = v.T, H = v.H, M = v.M
    // shapes
    const x = T * 3, i = Math.min(2, x | 0), fr = x - i
    let wP = 0, wQ = 0, wS = 0, wX = 0
    const a = 1 - fr
    if (i === 0) { wP = a; wQ = fr } else if (i === 1) { wQ = a; wS = fr } else { wS = a; wX = fr }
    const w = clamp(v.dt * s.sr * PULSE_T, 1e-4, 0.999)
    const gP = Math.min(2.2, 0.577 / Math.sqrt(Math.max(1e-6, (4 * w) / 3 - w * w)))
    setR(R, 4, wP * gP, snap)
    setR(R, 5, wQ * 0.577, snap)
    setR(R, 6, wS + wX * 0.62, snap)
    setR(R, 7, wX * 0.42, snap)
    // harmonics : density then the interval
    const dens = clamp(H / 0.4, 0, 1)
    setR(R, 8, clamp(dens * 3, 0, 1), snap)
    setR(R, 9, clamp(dens * 3 - 1, 0, 1), snap)
    setR(R, 10, clamp(dens * 3 - 2, 0, 1), snap)
    st.copies = dens > 0 || R[16] > 1e-6
    const dd = (5 + 13 * dens * dens) / 1200
    st.r1 = exp2(-dd); st.r2 = exp2(dd); st.r3 = exp2(-0.5 * dd)
    const semis2 = stair(DCO_STEPS, (H - 0.4) / 0.6) + 0.03 * clamp(H * 8, 0, 1) + v.p2off
    const base = v.dt * exp2(semis2 / 12)
    // morph : free / sync / metal
    const wsy = sstep((M - 0.06) / 0.08), wme = sstep((M - 0.74) / 0.08)
    const wf = 1 - wsy, ws = wsy * (1 - wme), wm = wme
    const syncSemis = 24 * Math.pow(clamp((M - 0.06) / 0.72, 0, 1), 1.5)
    const metalSemis = 3 + 16 * clamp((M - 0.74) / 0.26, 0, 1)
    setR(R, 0, v.dt, snap)
    setR(R, 1, Math.min(0.45, base), snap)
    setR(R, 2, Math.min(0.45, base * exp2(syncSemis / 12)), snap)
    setR(R, 3, Math.min(0.45, base * exp2(metalSemis / 12)), snap)
    // a unit waking up starts from the phase of the one sounding (coherent fade)
    const wasF = R[22] > 1e-6, wasS = R[24] > 1e-6, wasM = R[26] > 1e-6
    if (!snap) {
      const lead = wasS ? st.us : wasM ? st.um : st.uf
      if (wf > 0 && !wasF) unitSeed(st.uf, lead)
      if (ws > 0 && !wasS) unitSeed(st.us, lead)
      if (wm > 0 && !wasM) unitSeed(st.um, lead)
    }
    setR(R, 11, wf, snap)
    setR(R, 12, ws, snap)
    setR(R, 13, wm, snap)
    st.fOn = wf > 0 || R[22] > 1e-6
    st.sOn = ws > 0 || R[24] > 1e-6
    st.mOn = wm > 0 || R[26] > 1e-6
    setR(R, 14, 0.5 * (1 - 0.45 * ws), snap)
    setR(R, 15, 0.5 * (1 + 0.4 * ws), snap)
  },
  run(v, s, buf, n) {
    const st = v.dco, R = st.R, kW = s.sr * PULSE_T
    const d1 = st.d1, k1 = st.k1, k2 = st.k2, k3 = st.k3, uf = st.uf, us = st.us, um = st.um
    let dt1 = R[0], dtf = R[2], dts = R[4], dtm = R[6]
    const dt1i = R[1], dtfi = R[3], dtsi = R[5], dtmi = R[7]
    let aP = R[8], aQ = R[10], aS = R[12], aN = R[14]
    const aPi = R[9], aQi = R[11], aSi = R[13], aNi = R[15]
    let l1 = R[16], l2 = R[18], l3 = R[20]
    const l1i = R[17], l2i = R[19], l3i = R[21]
    let wf = R[22], ws = R[24], wm = R[26]
    const wfi = R[23], wsi = R[25], wmi = R[27]
    let g1 = R[28], g2 = R[30]
    const g1i = R[29], g2i = R[31]
    const r1 = st.r1, r2 = st.r2, r3 = st.r3
    const copies = st.copies, fOn = st.fOn, sOn = st.sOn, mOn = st.mOn
    for (let i = 0; i < n; i++) {
      dt1 += dt1i; dtf += dtfi; dts += dtsi; dtm += dtmi
      aP += aPi; aQ += aQi; aS += aSi; aN += aNi
      G[AP] = aP; G[AQ] = aQ; G[AS] = aS; G[AN] = aN
      setPulse(dt1, kW)
      const t1 = (1 - d1[0]) / dt1
      const ext = t1 <= 1 ? t1 : -1
      DP[0] = dt1; DP[1] = -1; dTick(d1, false)
      let o1 = DP[2]
      if (copies) {
        l1 += l1i; l2 += l2i; l3 += l3i
        let nrm = 1
        if (l1 > 1e-6) { const d = dt1 * r1; setPulse(d, kW); DP[0] = d; dTick(k1, false); o1 += l1 * DP[2]; nrm += l1 * l1 }
        if (l2 > 1e-6) { const d = dt1 * r2; setPulse(d, kW); DP[0] = d; dTick(k2, false); o1 += l2 * DP[2]; nrm += l2 * l2 }
        if (l3 > 1e-6) { const d = dt1 * r3; setPulse(d, kW); DP[0] = d; dTick(k3, false); o1 += l3 * DP[2]; nrm += l3 * l3 }
        o1 /= Math.sqrt(nrm)
      }
      let o2 = 0
      wf += wfi; ws += wsi; wm += wmi
      if (fOn && wf > 1e-6) { setPulse(dtf, kW); DP[0] = dtf; DP[1] = -1; dTick(uf, false); o2 += wf * DP[2] }
      if (sOn && ws > 1e-6) { setPulse(dts, kW); DP[0] = dts; DP[1] = ext; dTick(us, true); o2 += ws * DP[2] }
      if (mOn && wm > 1e-6) {
        // metal : the rectangular path is gated off, DCO-2 speaks through its ramp
        G[AQ] = 0; G[AN] = 0; G[AS] = aS + aQ + aN
        setPulse(dtm, kW)
        DP[0] = dtm; DP[1] = ext; dTick(um, false)
        o2 += wm * DP[2]
      }
      g1 += g1i; g2 += g2i
      buf[i] = o1 * g1 + o2 * g2
    }
    R[0] = dt1; R[2] = dtf; R[4] = dts; R[6] = dtm
    R[8] = aP; R[10] = aQ; R[12] = aS; R[14] = aN
    R[16] = l1; R[18] = l2; R[20] = l3
    R[22] = wf; R[24] = ws; R[26] = wm
    R[28] = g1; R[30] = g2
  },
}

// ═══ 2 · ms ═════════════════════════════════════════════════════════════════
// After aphex-move (Vincent Fillion, MIT) : VCO-1 + VCO-2 + ring + pink noise
// into the drive, the filter after (the shared section; pick 'ms' for the
// Korg-35 style pair).
// timbre : triangle → saw → square → narrowing pulse (50 % → 10 %)
// harmonics : VCO-2 up a soft staircase (unison, fifth, octave, twelfth) over
//   the first 60 %, then the ring modulator (VCO-1 × a VCO-2 triangle) takes
//   over while VCO-2 keeps climbing into clangorous ratios
// morph : pink noise + drive into the filter (an ADAA soft saturator)
const MS_STEPS = [0, 7, 12, 19]
class MsSt {
  constructor() {
    this.ph1 = 0; this.ph2 = 0
    this.R = new Float64Array(2 * 12)
    this.pk = new Float64Array(7)
    this.xp = 0; this.Fp = 0
  }
}
// One ms oscillator : MSW holds [phase, dt, wT, wS, wP, pw, pg, out, tri]
// (a helper too big to inline : numbers through a typed array, never as
// arguments). The triangle comes back too (the ring modulator's partner).
const MSW = new Float64Array(9)
function msOsc() {
  const t = MSW[0], dt = MSW[1]
  if (dt > 0.2) { const y = sin1(t); MSW[7] = y; MSW[8] = y; return }
  const wT = MSW[2], wS = MSW[3], wP = MSW[4]
  // the shared residuals : the edge at 0, the triangle's two corners
  const r0 = pblep(t, dt)
  let tri = t < 0.5 ? 4 * t - 1 : 3 - 4 * t
  const D = 8 * dt
  if (t < 2 * dt) tri += D * blamp4(t / dt)
  else if (t > 1 - 2 * dt) tri += D * blamp4((t - 1) / dt)
  const dm = t - 0.5
  if (dm > -2 * dt && dm < 2 * dt) tri -= D * blamp4(dm / dt)
  let y = wT * tri + wS * (2 * t - 1 - 2 * r0)
  if (wP > 1e-6) {
    // the pulse is high for its last pw of the cycle (in phase with the saw)
    const pq = Math.max(MSW[5], 3 * dt)
    let u = t < 1 - pq ? -1 : 1
    u -= 2 * r0
    let tp = t - (1 - pq)
    if (tp < 0) tp += 1
    u += 2 * pblep(tp, dt)
    y += wP * MSW[6] * (u - (2 * pq - 1))
  }
  const sm = (dt - 0.12) * 12.5
  if (sm > 0) { const sn = sin1(t); y += sm * (sn - y); tri += sm * (sn - tri) }
  MSW[7] = y
  MSW[8] = tri
}
const OpsiaSynthTest = { noNoise: false, noBite: false }
const ms = {
  start(v, s, fresh) {
    const st = v.ms
    if (fresh) {
      st.ph1 = rnd01(v); st.ph2 = rnd01(v)
      st.xp = 0; st.Fp = 1
      st.pk.fill(0)
    }
  },
  ctl(v, s, snap) {
    const st = v.ms, R = st.R, T = v.T, H = v.H, M = v.M
    const x = T * 3, i = Math.min(2, x | 0), fr = x - i
    let wT = 0, wS = 0, wP = 0, pw = 0.5
    if (i === 0) {
      // triangle and saw are uncorrelated : keep their sum's power
      const c = 1 / Math.sqrt((1 - fr) * (1 - fr) + fr * fr)
      wT = (1 - fr) * c; wS = fr * c
    } else if (i === 1) { wS = 1 - fr; wP = fr } else { wP = 1; pw = 0.5 - 0.4 * fr }
    const pg = 0.577 / Math.sqrt(Math.max(1e-6, 4 * pw * (1 - pw)))
    setR(R, 2, wT * 1.0, snap)
    setR(R, 3, wS, snap)
    setR(R, 4, wP * 0.577, snap)
    setR(R, 5, pw, snap)
    setR(R, 6, Math.min(pg / 0.577, 1.7), snap)
    const ring = sstep((H - 0.6) / 0.25)
    const semis2 = stair(MS_STEPS, H / 0.6) + 7.3 * clamp((H - 0.6) / 0.4, 0, 1) + v.p2off
    setR(R, 0, v.dt, snap)
    setR(R, 1, Math.min(0.4, v.dt * exp2(semis2 / 12)), snap)
    setR(R, 7, ring, snap)
    setR(R, 8, 0.55, snap)
    // morph : pink noise here, the drive in the voice's drive stage (the
    // voice adds 0.8 M^1.2 to it while this engine plays)
    const nz = OpsiaSynthTest.noNoise ? 0 : 0.55 * Math.pow(M, 1.6)
    setR(R, 9, nz, snap)
    setR(R, 10, 1, snap)
    setR(R, 11, 1, snap)
  },
  run(v, s, buf, n) {
    const st = v.ms, R = st.R, pk = st.pk
    let ph1 = st.ph1, ph2 = st.ph2
    let dt1 = R[0], dt2 = R[2], wT = R[4], wS = R[6], wP = R[8], pw = R[10], pg = R[12]
    let ring = R[14], g2 = R[16], nz = R[18], dg = R[20], mk = R[22]
    const dt1i = R[1], dt2i = R[3], wTi = R[5], wSi = R[7], wPi = R[9], pwi = R[11], pgi = R[13]
    const ringi = R[15], g2i = R[17], nzi = R[19], dgi = R[21], mki = R[23]
    let xp = st.xp, Fp = st.Fp
    for (let i = 0; i < n; i++) {
      dt1 += dt1i; dt2 += dt2i; wT += wTi; wS += wSi; wP += wPi; pw += pwi; pg += pgi
      ring += ringi; g2 += g2i; nz += nzi; dg += dgi; mk += mki
      MSW[2] = wT; MSW[3] = wS; MSW[4] = wP; MSW[5] = pw; MSW[6] = pg
      MSW[0] = ph1; MSW[1] = dt1; msOsc()
      const o1 = MSW[7]
      MSW[0] = ph2; MSW[1] = dt2; msOsc()
      let o2 = MSW[7]
      if (ring > 1e-6) o2 += ring * (o1 * MSW[8] * 1.5 - o2)
      ph1 += dt1; if (ph1 >= 1) ph1 -= 1
      ph2 += dt2; if (ph2 >= 1) ph2 -= 1
      let x = o1 * 0.62 + o2 * g2
      if (nz > 1e-6) {
        // pink noise, Voss-McCartney style (aphex-move)
        const wht = rnd01(v) * 2 - 1
        pk[0] = 0.99886 * pk[0] + wht * 0.0555179
        pk[1] = 0.99332 * pk[1] + wht * 0.0750759
        pk[2] = 0.969 * pk[2] + wht * 0.153852
        pk[3] = 0.8665 * pk[3] + wht * 0.3104856
        pk[4] = 0.55 * pk[4] + wht * 0.5329522
        pk[5] = -0.7616 * pk[5] - wht * 0.016898
        const pink = pk[0] + pk[1] + pk[2] + pk[3] + pk[4] + pk[5] + pk[6] + wht * 0.5362
        pk[6] = wht * 0.115926
        x += pink * 0.11 * nz * 2.4
      }
      buf[i] = x * 0.8
    }
    st.ph1 = ph1; st.ph2 = ph2; st.xp = xp; st.Fp = Fp
    R[0] = dt1; R[2] = dt2; R[4] = wT; R[6] = wS; R[8] = wP; R[10] = pw; R[12] = pg
    R[14] = ring; R[16] = g2; R[18] = nz; R[20] = dg; R[22] = mk
  },
}

// ═══ 3 · swarm ══════════════════════════════════════════════════════════════
// After essaim-move (Vincent Fillion, MIT) : every note is a small swarm of
// self-retriggering oscillators, each with its own pulse clock, its own pitch
// blip (envelope → FM) and its own state-variable filter (low, band or high
// pass, drawn per note : 50 / 30 / 20 %, as Essaim draws its voices).
// timbre : sine → triangle → saw → square (band-limited, crossfaded)
// harmonics : spread : 2 members at unison, then 4 detuned, then 6 with two
//   scattered by an octave or a fifth; the detune grows with it
// morph : the pulse rate, from a drone (0) to ~40 Hz chatter, with the blips'
//   envelope → FM growing with it
const SW_N = 6
const SW_OCT = [-12, 12, 7, 19, -5, 24]
class SwarmSt {
  constructor() {
    this.ph = new Float64Array(SW_N)
    this.dt = new Float64Array(SW_N); this.dti = new Float64Array(SW_N)
    this.am = new Float64Array(SW_N); this.ami = new Float64Array(SW_N)
    this.ga = new Float64Array(SW_N); this.gai = new Float64Array(SW_N) // SVF g
    this.ic1 = new Float64Array(SW_N); this.ic2 = new Float64Array(SW_N)
    this.k = new Float64Array(SW_N)
    this.mode = new Int32Array(SW_N)
    this.det = new Float64Array(SW_N)
    this.oct = new Float64Array(SW_N)
    this.lph = new Float64Array(SW_N)
    this.lrate = new Float64Array(SW_N)
    this.cr = new Float64Array(SW_N)
    this.R = new Float64Array(2 * 5)
    this.nAct = 2
  }
}
function swEnv(ph) {
  // a blip : 2 % attack, then an exponential fall to e^-5 at the cycle's end
  return ph < 0.02 ? ph * 50 : Math.exp(-5.1 * (ph - 0.02))
}
/** One swarm member for n samples, added into buf (its own function : the
 *  shape helpers stay inlined, no number is boxed). */
function swMember(st, k, buf, n) {
  const R = st.R
  const ph = st.ph, dtA = st.dt, am = st.am, ga = st.ga, ic1 = st.ic1, ic2 = st.ic2
  let p = ph[k], dt = dtA[k], a = am[k], g = ga[k], z1 = ic1[k], z2 = ic2[k]
  const dti = st.dti[k], ai = st.ami[k], gi = st.gai[k], kq = st.k[k], md = st.mode[k]
  let w0 = R[0], w1 = R[2], w2 = R[4], w3 = R[6]
  const w0i = R[1], w1i = R[3], w2i = R[5], w3i = R[7]
  for (let i = 0; i < n; i++) {
    dt += dti; a += ai; g += gi
    w0 += w0i; w1 += w1i; w2 += w2i; w3 += w3i
    let y
    if (dt > 0.2) y = sin1(p)
    else {
      // sine, triangle, saw, square from one phase : two step residuals (the
      // edges at 0 and 0.5) and the triangle's two corners
      const r0 = pblep(p, dt)
      let t5 = p - 0.5
      if (t5 < 0) t5 += 1
      const r5 = pblep(t5, dt)
      let tri = p < 0.5 ? 4 * p - 1 : 3 - 4 * p
      const D = 8 * dt
      if (p < 2 * dt) tri += D * blamp4(p / dt)
      else if (p > 1 - 2 * dt) tri += D * blamp4((p - 1) / dt)
      const dm = p - 0.5
      if (dm > -2 * dt && dm < 2 * dt) tri -= D * blamp4(dm / dt)
      const sn = sin1(p)
      y = w0 * sn + w1 * tri + w2 * (2 * p - 1 - 2 * r0) + w3 * ((p < 0.5 ? -1 : 1) - 2 * r0 + 2 * r5)
      const sm = (dt - 0.12) * 12.5
      if (sm > 0) y += sm * (sn - y)
    }
    p += dt; if (p >= 1) p -= 1
    // the member's own SVF (TPT, Simper's form)
    const a1 = 1 / (1 + g * (g + kq)), a2 = g * a1, a3 = g * a2
    const v3 = y - z2, v1 = a1 * z1 + a2 * v3, v2 = z2 + a2 * z1 + a3 * v3
    z1 = 2 * v1 - z1; z2 = 2 * v2 - z2
    const f = md === 0 ? v2 : md === 1 ? kq * v1 * 1.4 : y - kq * v1 - v2
    buf[i] += f * a
  }
  if (z1 < 1e-25 && z1 > -1e-25) z1 = 0
  if (z2 < 1e-25 && z2 > -1e-25) z2 = 0
  ph[k] = p; dtA[k] = dt; am[k] = a; ga[k] = g; ic1[k] = z1; ic2[k] = z2
}
const swarm = {
  start(v, s, fresh) {
    const st = v.sw
    if (!fresh) {
      // a re-strike : the swarm fires together again
      for (let k = 0; k < SW_N; k++) st.lph[k] = rnd01(v) * 0.05
      return
    }
    const p0 = rnd01(v)
    for (let k = 0; k < SW_N; k++) {
      st.ph[k] = (p0 + (rnd01(v) - 0.5) * 0.2 + 1) % 1
      st.det[k] = k === 0 ? -1 : k === 1 ? 1 : rnd01(v) * 2 - 1
      st.oct[k] = SW_OCT[(rnd01(v) * SW_OCT.length) | 0]
      st.lph[k] = rnd01(v) * 0.05
      st.lrate[k] = 0.7 + rnd01(v) * 0.75
      const r = rnd01(v)
      st.mode[k] = r < 0.5 ? 0 : r < 0.8 ? 1 : 2
      st.k[k] = 2 - 1.5 * (0.3 + rnd01(v) * 0.6)
      st.cr[k] = st.mode[k] === 0 ? 3 + rnd01(v) * 6 : st.mode[k] === 1 ? 1 + rnd01(v) * 3 : 0.5 + rnd01(v) * 1.2
      st.ic1[k] = 0; st.ic2[k] = 0
    }
  },
  ctl(v, s, snap) {
    const st = v.sw, R = st.R, T = v.T, H = v.H, M = v.M, sr = s.sr
    const x = T * 3, i = Math.min(2, x | 0), fr = x - i
    let w0 = 0, w1 = 0, w2 = 0, w3 = 0
    if (i === 0) { w0 = 1 - fr; w1 = fr } else if (i === 1) {
      const c = 1 / Math.sqrt((1 - fr) * (1 - fr) + fr * fr)
      w1 = (1 - fr) * c; w2 = fr * c
    } else { w2 = 1 - fr; w3 = fr }
    setR(R, 0, w0 * 0.82, snap); setR(R, 1, w1, snap); setR(R, 2, w2, snap); setR(R, 3, w3 * 0.62, snap)
    const uni = v.s.voiceMode === 1
    const spread = (34 * H * H) / 1200
    const depth = clamp(M * 5, 0, 1)
    const rate = 0.4 * exp2(M * 6.6)
    const fmSemis = depth * M * 9
    const tick = CTL / sr
    let nrm = 0, nAct = 0
    for (let k = 0; k < SW_N; k++) {
      let lv = k < 2 ? 1 : k < 4 ? clamp((H - 0.1) / 0.25, 0, 1) : clamp((H - 0.55) / 0.3, 0, 1)
      if (uni && k >= 3) lv = 0
      if (lv > 0 || st.am[k] > 1e-6) nAct = k + 1
      nrm += lv * lv
      // the member's pulse
      let lph = st.lph[k] + tick * rate * st.lrate[k]
      if (lph >= 1) lph -= Math.floor(lph)
      st.lph[k] = lph
      const env = depth > 0 ? swEnv(lph) : 0
      // the blips average far under a drone : give back most of it
      const amp = lv * (1 - depth + depth * env) * (1 + 1.3 * depth)
      const semis = (k >= 4 ? st.oct[k] : 0) + st.det[k] * (k >= 2 ? 1.6 : 1) * spread * 1200 / 100 + fmSemis * env
      const dt = Math.min(0.42, v.dt * exp2(semis / 12))
      if (snap) { st.dt[k] = dt; st.dti[k] = 0; st.am[k] = amp; st.ami[k] = 0 } else {
        st.dti[k] = (dt - st.dt[k]) * INV_CTL
        st.ami[k] = (amp - st.am[k]) * INV_CTL
      }
      const fc = clamp(dt * sr * st.cr[k] * (depth > 0 ? 0.4 + 0.6 * env : 1), 20, 0.45 * sr)
      const g = Math.tan((Math.PI * fc) / sr)
      if (snap) { st.ga[k] = g; st.gai[k] = 0 } else st.gai[k] = (g - st.ga[k]) * INV_CTL
    }
    st.nAct = nAct
    setR(R, 4, 1 / Math.sqrt(Math.max(1, nrm)), snap)
  },
  run(v, s, buf, n) {
    const st = v.sw, R = st.R
    const ph = st.ph, dtA = st.dt, dtI = st.dti, am = st.am, amI = st.ami, ga = st.ga, gaI = st.gai
    const ic1 = st.ic1, ic2 = st.ic2, kk = st.k, mode = st.mode
    for (let i = 0; i < n; i++) buf[i] = 0
    const w0s = R[0], w1s = R[2], w2s = R[4], w3s = R[6]
    const w0i = R[1], w1i = R[3], w2i = R[5], w3i = R[7]
    for (let k = 0; k < st.nAct; k++) swMember(st, k, buf, n)
    let nr = R[8]
    const nri = R[9]
    for (let i = 0; i < n; i++) { nr += nri; buf[i] *= nr }
    R[0] = w0s + w0i * n; R[2] = w1s + w1i * n; R[4] = w2s + w2i * n; R[6] = w3s + w3i * n; R[8] = nr
  },
}

// ═══ 4 · fm ═════════════════════════════════════════════════════════════════
// After schwung-hank (Charles Vestal, MIT) : two operators, phase modulation,
// the macro layer that cannot be set wrong. Kept from it : the ratio list, the
// index law (squared), the modulator's envelope coupled to the carrier's (2.2x
// shorter decay, opens 30 % sooner, a 0.30 sustain floor), its self-feedback
// averaged over two samples and enveloped, the index faded out as the
// modulator climbs past 7 kHz, and the bite shaper (asymmetric rails, an octave
// blended in, makeup, mixed in by its own amount so 0 is dry).
// timbre : brightness (the index)
// harmonics : the ratio, in its listed steps; between two steps the two
//   modulators crossfade (never a sweep through the dissonant ratios between)
// morph : bite : self-feedback first, then the shaper (the shaper runs in the
//   voice's oversampled drive stage, ahead of the filter)
// The index fades out as the modulator climbs past 7 kHz (Hank's raised
// cosine, here to the real Nyquist), and is capped so the sidebands stay under
// it (Carson's rule).
function fmRoll(hz, sr) {
  const ny = sr * 0.5
  if (hz <= 7000) return 1
  if (hz >= ny) return 0
  return 0.5 * (1 + Math.cos((Math.PI * (hz - 7000)) / (ny - 7000)))
}
function fmCap(f, r, sr) { return Math.max(0, (0.42 * sr - f) / Math.max(1, f * r) - 2) }
// The self-feedback makes the modulator saw-like and unbounded in band : it is
// rolled off as the modulator climbs (no change under ~500 Hz, a third left at
// 2 kHz), so the top of the keyboard keeps its grit without the whistle.
function fbRoll(hz) { const x = hz / 1500; return 1 / (1 + x * x) }
const FM_RATIOS = [0.5, 1, 1.5, 2, 2.5, 3, 3.7, 4, 5, 5.4, 6, 7, 8, 9.2, 11, 14]
class FmSt {
  constructor() {
    this.pc = 0; this.pa = 0; this.pb = 0; this.fa = 0; this.fb = 0
    this.me = 0; this.mStage = 0
    this.R = new Float64Array(2 * 10)
    this.xp = 0; this.Fp = 0; this.dcx = 0; this.dcy = 0
    this.slotA = 0
    this.bite = 0
  }
}
const fm = {
  start(v, s, fresh) {
    const st = v.fm
    if (fresh) {
      st.pc = 0; st.pa = 0; st.pb = 0; st.fa = 0; st.fb = 0
      st.xp = 0; st.Fp = 0; st.dcx = 0; st.dcy = 0; st.me = 0
    }
    st.mStage = 1
  },
  ctl(v, s, snap) {
    const st = v.fm, R = st.R, T = v.T, H = v.H, M = v.M, sr = s.sr
    // the modulator's envelope : Hank's coupling, at control rate
    const tick = CTL / sr
    const sus = 0.3 + 0.55 * v.s.cs.sustain
    if (st.mStage === 1) {
      const ta = Math.max(0.0005, v.atkS * 0.7) / 1.466
      st.me += (1.3 - st.me) * (1 - Math.exp(-tick / ta))
      if (st.me >= 1) { st.me = 1; st.mStage = 2 }
    } else if (st.mStage === 2) {
      st.me = sus + (st.me - sus) * Math.exp((-tick * 3) / Math.max(0.002, v.decS * 0.45))
    }
    if (!v.gate && st.mStage !== 0) st.mStage = 3
    if (st.mStage === 3) st.me *= Math.exp((-tick * 3) / Math.max(0.003, v.relS * 0.6))
    const me = st.me
    // the ratio pair
    const nr = FM_RATIOS.length
    const xr = clamp(H, 0, 1) * (nr - 1)
    const ir = Math.min(nr - 2, xr | 0)
    const xb = sstep((xr - ir - 0.3) / 0.4)
    // each ratio keeps its own oscillator : slot = index parity
    const ra = FM_RATIOS[ir], rb = FM_RATIOS[ir + 1]
    const slotOfA = ir & 1
    const rS0 = slotOfA === 0 ? ra : rb, rS1 = slotOfA === 0 ? rb : ra
    const w1 = slotOfA === 0 ? xb : 1 - xb
    const f = v.dt * sr
    // index : bright², velocity, the coupled envelope, and a cap that keeps the
    // sidebands under Nyquist (Carson's rule)
    const I0 = T * T * 11 * (0.65 + 0.35 * v.vel) * me
    const I_0 = Math.min(I0, fmCap(f, rS0, sr)) * fmRoll(f * rS0, sr)
    const I_1 = Math.min(I0, fmCap(f, rS1, sr)) * fmRoll(f * rS1, sr)
    // bite : Hank's feedback-then-shaper split, the feedback enveloped too
    const fbn = M < 0.6 ? M / 0.6 : 1
    const top = clamp((T - 0.66) / 0.34, 0, 1)
    const fx = fbn * 0.75 + top * 0.25
    const fbk = fx * fx * 6 * me
    const d = M < 0.35 ? 0 : (M - 0.35) / 0.65
    setR(R, 0, v.dt, snap)
    setR(R, 1, Math.min(0.49, v.dt * rS0), snap)
    setR(R, 2, Math.min(0.49, v.dt * rS1), snap)
    setR(R, 3, w1, snap)
    setR(R, 4, I_0 / TAU, snap)
    setR(R, 5, I_1 / TAU, snap)
    setR(R, 6, (fbk * fmRoll(f * rS0, sr) * fbRoll(f * rS0)) / TAU, snap)
    setR(R, 7, (fbk * fmRoll(f * rS1, sr) * fbRoll(f * rS1)) / TAU, snap)
    st.bite = d
  },
  run(v, s, buf, n) {
    const st = v.fm, R = st.R
    let pc = st.pc, pa = st.pa, pb = st.pb, fa = st.fa, fb = st.fb
    let dtc = R[0], dta = R[2], dtb = R[4], w1 = R[6], ia = R[8], ib = R[10], fka = R[12], fkb = R[14]
    const dtci = R[1], dtai = R[3], dtbi = R[5], w1i = R[7], iai = R[9], ibi = R[11], fkai = R[13], fkbi = R[15]
    for (let i = 0; i < n; i++) {
      dtc += dtci; dta += dtai; dtb += dtbi; w1 += w1i; ia += iai; ib += ibi; fka += fkai; fkb += fkbi
      pc += dtc; if (pc >= 1) pc -= 1
      pa += dta; if (pa >= 1) pa -= 1
      pb += dtb; if (pb >= 1) pb -= 1
      let y = 0
      if (w1 < 1 - 1e-6) {
        const m = sin1(pa + fa * fka)
        fa = 0.5 * (fa + m)
        y += (1 - w1) * sin1(pc + ia * m)
      }
      if (w1 > 1e-6) {
        const m = sin1(pb + fb * fkb)
        fb = 0.5 * (fb + m)
        y += w1 * sin1(pc + ib * m)
      }
      buf[i] = y
    }
    st.pc = pc; st.pa = pa; st.pb = pb; st.fa = fa; st.fb = fb
    R[0] = dtc; R[2] = dta; R[4] = dtb; R[6] = w1; R[8] = ia; R[10] = ib; R[12] = fka; R[14] = fkb
  },
}

// ═══ 5 · modal ══════════════════════════════════════════════════════════════
// Struck resonators : a bank of complex one-pole modes (Mathews and Smith's
// phasor filter : y = r·e^{iω}·y + x, the output its imaginary part), so a mode
// keeps its phase and amplitude while its frequency or damping moves.
// timbre : the strike : a Hann mallet from 1.5 periods (soft, only the low
//   modes) to an eighth of one (hard), with noise in the hardest strikes
// harmonics : inharmonicity : string (harmonic) → bar (free-free beam) →
//   bell, the ratios interpolated in log frequency
// morph : damping : the fundamental's ring from ~12 s down to ~60 ms, the high
//   modes dying faster as it rises (metal → wood)
// While a note is held with sustain up, the modes are also bowed (noise scaled
// to each damping), so a held note keeps singing.
const MO_N = 14
const MO_STRING = [], MO_BAR = [], MO_BELL = [1, 1.19, 1.5, 2.0, 2.52, 2.67, 3.01, 3.35, 4.0, 4.24, 5.04, 5.43, 6.02, 6.78]
const MO_BETA = [4.73004, 7.8532, 10.99561, 14.13717, 17.27876, 20.42035, 23.56194, 26.70354, 29.84513, 32.98672, 36.12832, 39.26991, 42.4115, 45.55309]
const MO_ASTR = [], MO_ABAR = [], MO_ABELL = [1, 0.85, 0.7, 0.95, 0.55, 0.5, 0.55, 0.38, 0.5, 0.32, 0.3, 0.28, 0.24, 0.2]
for (let k = 0; k < MO_N; k++) {
  MO_STRING.push(k + 1)
  MO_BAR.push((MO_BETA[k] / MO_BETA[0]) ** 2)
  MO_ASTR.push((1 / Math.sqrt(k + 1)) * (0.3 + 0.7 * Math.abs(Math.sin(Math.PI * (k + 1) * 0.21))))
  MO_ABAR.push(1 / Math.pow(k + 1, 0.6))
}
class ModalSt {
  constructor() {
    this.re = new Float64Array(MO_N); this.im = new Float64Array(MO_N)
    this.cr = new Float64Array(MO_N); this.cri = new Float64Array(MO_N)
    this.ci = new Float64Array(MO_N); this.cii = new Float64Array(MO_N)
    this.gk = new Float64Array(MO_N)
    this.ak = new Float64Array(MO_N); this.aki = new Float64Array(MO_N)
    this.ex = 0; this.exL = 0; this.exA = 0; this.exH = 0
    this.bow = 0; this.bowi = 0; this.blp = 0
    this.nAct = MO_N
    this.key = -1
    this.r1 = 0.999
  }
}
const modal = {
  start(v, s, fresh) {
    const st = v.mo
    if (fresh) { st.re.fill(0); st.im.fill(0); st.key = -1; st.blp = 0 }
    // a strike : the mallet's length in periods, from timbre
    const T = v.T
    const period = s.sr / Math.max(20, v.dt * s.sr)
    st.exL = Math.max(2, Math.min(0.012 * s.sr, period * 1.5 * Math.pow(0.08, T)))
    st.ex = 0
    // a soft mallet excites fewer modes and a damped bar rings shorter : most
    // of that level is given back, so the knobs change the tone more than the
    // loudness
    const tc = T < 0.5 ? 1.8 - 1.6 * T : 1 - 0.42 * (T - 0.5)
    const mc = Math.pow(200, 0.22 * v.M)
    st.exA = (2 / st.exL) * (0.35 + 0.65 * v.velG) * tc * mc
    st.exH = T > 0.65 ? (T - 0.65) * 1.6 : 0
  },
  ctl(v, s, snap) {
    const st = v.mo, T = v.T, H = v.H, M = v.M, sr = s.sr
    const f0 = v.dt * sr
    const T60 = 12 * Math.pow(0.005, M)
    const alpha = 0.3 + 1.3 * M
    const key = f0 * 7.13 + H * 1001.7 + M * 77.7 + T * 3.1
    const same = Math.abs(key - st.key) < 1e-7
    st.key = key
    let nAct = 0
    if (!same || snap) {
      const ny = 0.47 * sr
      for (let k = 0; k < MO_N; k++) {
        let ratio, amp
        if (H < 0.5) {
          const w = sstep(H / 0.5)
          ratio = Math.exp(Math.log(MO_STRING[k]) * (1 - w) + Math.log(MO_BAR[k]) * w)
          amp = MO_ASTR[k] * (1 - w) + MO_ABAR[k] * w
        } else {
          const w = sstep((H - 0.5) / 0.5)
          ratio = Math.exp(Math.log(MO_BAR[k]) * (1 - w) + Math.log(MO_BELL[k]) * w)
          amp = MO_ABAR[k] * (1 - w) + MO_ABELL[k] * w
        }
        const f = f0 * ratio
        const fade = clamp((ny - f) / (0.04 * sr), 0, 1)
        const t60k = Math.max(0.01, T60 / Math.pow(ratio, alpha))
        const r = Math.exp(-LN1000 / (t60k * sr))
        if (k === 0) st.r1 = r
        const om = (TAU * Math.min(f, ny)) / sr
        const cr = r * Math.cos(om), ci = r * Math.sin(om)
        const a = amp * fade
        if (snap) { st.cr[k] = cr; st.ci[k] = ci; st.cri[k] = 0; st.cii[k] = 0; st.ak[k] = a; st.aki[k] = 0 } else {
          st.cri[k] = (cr - st.cr[k]) * INV_CTL
          st.cii[k] = (ci - st.ci[k]) * INV_CTL
          st.aki[k] = (a - st.ak[k]) * INV_CTL
        }
        st.gk[k] = a > 0 ? 1 : 0
        if (a > 0 || st.ak[k] > 0) nAct = k + 1
      }
      st.nAct = Math.max(1, nAct)
    } else {
      for (let k = 0; k < MO_N; k++) { st.cri[k] = 0; st.cii[k] = 0; st.aki[k] = 0 }
    }
    // the bow : held notes sing, at a level that the damping does not change
    const bow = v.gate && v.stage !== 4 ? 0.22 * v.s.cs.sustain * Math.sqrt(1 - st.r1 * st.r1) * (0.4 + 0.6 * v.velG) * (1 + 0.8 * M) : 0
    if (snap) { st.bow = bow; st.bowi = 0 } else st.bowi = (bow - st.bow) * INV_CTL
  },
  run(v, s, buf, n) {
    const st = v.mo
    const re = st.re, im = st.im, cr = st.cr, cri = st.cri, ci = st.ci, cii = st.cii, ak = st.ak, aki = st.aki
    const N = st.nAct
    // the excitation for these n samples
    const ex = EXBUF
    let bow = st.bow, blp = st.blp
    const bowi = st.bowi
    let excited = false
    let exn = st.ex
    const exL = st.exL, exA = st.exA, exH = st.exH
    for (let i = 0; i < n; i++) {
      let x = 0
      if (exn < exL) {
        x = exA * (0.5 - 0.5 * Math.cos((TAU * exn) / exL))
        if (exH > 0) x += exH * exA * (rnd01(v) * 2 - 1) * 2
        exn++
      }
      bow += bowi
      if (bow > 1e-9) { blp += 0.5 * (rnd01(v) * 2 - 1 - blp); x += bow * blp * 2.4 }
      ex[i] = x
      if (x !== 0) excited = true
    }
    st.bow = bow; st.blp = blp; st.ex = exn
    for (let i = 0; i < n; i++) buf[i] = 0
    for (let k = 0; k < N; k++) {
      let yr = re[k], yi = im[k], c = cr[k], d = ci[k], a = ak[k]
      const ciI = cri[k], diI = cii[k], aI = aki[k]
      if (excited) {
        for (let i = 0; i < n; i++) {
          c += ciI; d += diI; a += aI
          const nr = c * yr - d * yi + ex[i]
          yi = d * yr + c * yi
          yr = nr
          buf[i] += a * yi
        }
      } else {
        for (let i = 0; i < n; i++) {
          c += ciI; d += diI; a += aI
          const nr = c * yr - d * yi
          yi = d * yr + c * yi
          yr = nr
          buf[i] += a * yi
        }
      }
      if (yr < 1e-15 && yr > -1e-15 && yi < 1e-15 && yi > -1e-15) { yr = 0; yi = 0 }
      re[k] = yr; im[k] = yi; cr[k] = c; ci[k] = d; ak[k] = a
    }
  },
}
const EXBUF = new Float64Array(CTL)

// ═══ 6 · voice ══════════════════════════════════════════════════════════════
// A formant voice : a band-limited glottal buzz (saw through a glottal
// low-pass) and breath noise into five parallel band-passes (TPT SVF, unity
// peak) set from Peterson and Barney's average vowel formants (F1-F3, men),
// with F4 / F5 placed where voices carry them.
// timbre : the vowel, a → e → i → o → u (frequencies in log, gains in dB)
// harmonics : the throat : every formant scaled from 0.72x (a big dark throat)
//   through 1.0 (the middle) to 1.39x (a small one)
// morph : breath : voiced → breathy (noise pulsed by the glottis) → whispered
const VO_F = [
  [730, 1090, 2440, 3400, 4200],
  [530, 1840, 2480, 3450, 4250],
  [270, 2290, 3010, 3600, 4300],
  [570, 840, 2410, 3300, 4100],
  [300, 870, 2240, 3300, 4100],
]
const VO_DB = [
  [0, -4, -20, -26, -34],
  [0, -9, -16, -24, -32],
  [0, -14, -12, -22, -30],
  [0, -2, -24, -30, -38],
  [0, -10, -28, -34, -42],
]
const VO_BW = [80, 90, 120, 140, 160]
// per-vowel level (dB) : an open vowel's high F1 misses the low harmonics, so
// it is lifted to sing as loud as the closed ones (measured, standard phrase)
const VO_LIFT = [5, 3, -2, 2.5, -2.5]
class VoxSt {
  constructor() {
    this.ph = 0; this.lp = 0; this.lp2 = 0
    this.z1 = new Float64Array(5); this.z2 = new Float64Array(5)
    this.c = new Float64Array(5 * 8) // per formant : a1, a1i, a2, a2i, a3, a3i, k·gain, inc
    this.R = new Float64Array(2 * 4)
  }
}
const voice = {
  start(v, s, fresh) {
    const st = v.vo
    if (fresh) { st.ph = rnd01(v); st.lp = 0; st.lp2 = 0; st.z1.fill(0); st.z2.fill(0) }
  },
  ctl(v, s, snap) {
    const st = v.vo, R = st.R, T = v.T, H = v.H, M = v.M, sr = s.sr
    const x = clamp(T, 0, 1) * 4, i = Math.min(3, x | 0), fr = x - i
    const throat = 0.72 * exp2(H * 0.95)
    const c = st.c
    for (let j = 0; j < 5; j++) {
      const fz = Math.min(0.45 * sr, Math.exp(Math.log(VO_F[i][j]) * (1 - fr) + Math.log(VO_F[i + 1][j]) * fr) * throat)
      const db = VO_DB[i][j] * (1 - fr) + VO_DB[i + 1][j] * fr + VO_LIFT[i] * (1 - fr) + VO_LIFT[i + 1] * fr
      const bw = VO_BW[j] * (0.75 + 0.35 * throat)
      const g = Math.tan((Math.PI * fz) / sr)
      const k = bw / fz
      const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2
      const kg = k * Math.pow(10, db / 20)
      const o = j * 8
      if (snap) { c[o] = a1; c[o + 1] = 0; c[o + 2] = a2; c[o + 3] = 0; c[o + 4] = a3; c[o + 5] = 0; c[o + 6] = kg; c[o + 7] = 0 } else {
        c[o + 1] = (a1 - c[o]) * INV_CTL; c[o + 3] = (a2 - c[o + 2]) * INV_CTL
        c[o + 5] = (a3 - c[o + 4]) * INV_CTL; c[o + 7] = (kg - c[o + 6]) * INV_CTL
      }
    }
    setR(R, 0, Math.min(0.45, v.dt), snap)
    // the glottal tilt opens with velocity (vocal effort)
    const fg = Math.min(0.4 * sr, v.dt * sr * 1.6 + 350 + 900 * v.velG)
    setR(R, 1, 1 - Math.exp((-TAU * fg) / sr), snap)
    setR(R, 2, Math.pow(1 - M, 0.6), snap)
    setR(R, 3, Math.pow(M, 0.6) * (1 + 5.5 * M * M), snap)
  },
  run(v, s, buf, n) {
    const st = v.vo, R = st.R, c = st.c, z1 = st.z1, z2 = st.z2
    let ph = st.ph, lp = st.lp, lp2 = st.lp2
    let dt = R[0], ga = R[2], av = R[4], an = R[6]
    const dti = R[1], gai = R[3], avi = R[5], ani = R[7]
    for (let i = 0; i < n; i++) {
      dt += dti; ga += gai; av += avi; an += ani
      // the glottal buzz : a falling saw (the closure is the sharp edge)
      const saw = 1 - 2 * ph + 2 * pblep(ph, dt)
      lp += ga * (saw - lp)
      lp2 += ga * (lp - lp2)
      const open = ph < 0.6 ? 1 : 0.25
      const nz = rnd01(v) * 2 - 1
      const exc = lp2 * av * 2.2 + nz * an * (0.35 + 0.65 * (av > 0.05 ? open : 1))
      ph += dt; if (ph >= 1) ph -= 1
      let y = 0
      for (let j = 0, o = 0; j < 5; j++, o += 8) {
        const a1 = (c[o] += c[o + 1]), a2 = (c[o + 2] += c[o + 3]), a3 = (c[o + 4] += c[o + 5]), kg = (c[o + 6] += c[o + 7])
        const zz1 = z1[j], zz2 = z2[j]
        const v3 = exc - zz2, v1 = a1 * zz1 + a2 * v3, v2 = zz2 + a2 * zz1 + a3 * v3
        z1[j] = 2 * v1 - zz1; z2[j] = 2 * v2 - zz2
        y += kg * v1
      }
      buf[i] = y
    }
    st.ph = ph; st.lp = lp; st.lp2 = lp2
    for (let j = 0; j < 5; j++) { if (z1[j] < 1e-25 && z1[j] > -1e-25) z1[j] = 0; if (z2[j] < 1e-25 && z2[j] > -1e-25) z2[j] = 0 }
    R[0] = dt; R[2] = ga; R[4] = av; R[6] = an
  },
}

// ═══ 7 · fold ═══════════════════════════════════════════════════════════════
// A west-coast voice : a sine (or triangle) through a sine wavefolder with
// first-order antiderivative anti-aliasing (y = Δ(-cos u) / Δu), the fold
// index held under the band the pitch leaves, then a low-pass gate.
// timbre : the fold (from a nearly pure sine to about five folds)
// harmonics : symmetry (a bias into the folder : even harmonics), the source
//   moving from sine to triangle in its top 45 %
// morph : the low-pass gate : 0 = open (the ADSR alone), 1 = a vactrol ping on
//   every strike (fast rise, a decay that slows as it falls, the cutoff and the
//   level closing together : the plucked west-coast sound)
class FoldSt {
  constructor() {
    this.ph = 0; this.up = 0; this.Fp = -1; this.z1 = 0; this.z2 = 0
    this.lv = 0; this.hold = 0; this.lvT = 1
    this.R = new Float64Array(2 * 7)
  }
}
const fold = {
  start(v, s, fresh) {
    const st = v.fo
    if (fresh) { st.ph = rnd01(v); st.up = 0; st.Fp = -1; st.z1 = 0; st.z2 = 0; st.lv = 0 }
    st.hold = Math.ceil((0.004 * s.sr) / CTL)
    st.lvT = 0.45 + 0.55 * v.velG
  },
  ctl(v, s, snap) {
    const st = v.fo, R = st.R, T = v.T, H = v.H, M = v.M, sr = s.sr
    const f0 = v.dt * sr
    const bias = 0.55 * clamp(H / 0.55, 0, 1) * (H < 0.55 ? 1 : 1 - 0.3 * (H - 0.55) / 0.45)
    const tri = clamp((H - 0.55) / 0.45, 0, 1)
    let G = (Math.PI / 2) * (0.5 + 9.5 * Math.pow(T, 1.6))
    const cap = Math.max(0.3, (0.38 * sr) / (f0 * (1 + 1.5 * tri)) - 2)
    G = G / Math.pow(1 + Math.pow(G / cap, 4), 0.25)
    const peak = G * (1 + bias)
    const norm = 1 / Math.sin(Math.min(Math.PI / 2, peak))
    // the vactrol
    const tick = CTL / sr
    if (st.hold > 0) { st.hold--; st.lv += (st.lvT - st.lv) * (1 - Math.exp(-tick / 0.0025)) } else {
      const tau = (0.05 + 0.6 * v.decS) * (0.5 + 1.5 * (1 - st.lv))
      st.lv *= Math.exp(-tick / tau)
    }
    const cc = 1 - M + M * st.lv
    const fc = Math.min(0.45 * sr, 45 * exp2(cc * 8.8))
    setR(R, 0, Math.min(0.45, v.dt), snap)
    setR(R, 1, tri, snap)
    setR(R, 2, bias, snap)
    setR(R, 3, G, snap)
    setR(R, 4, norm, snap)
    setR(R, 5, 1 - Math.exp((-TAU * fc) / sr), snap)
    setR(R, 6, Math.pow(cc, 1.3) * (1 + 1.8 * M), snap)
  },
  run(v, s, buf, n) {
    const st = v.fo, R = st.R
    let ph = st.ph, up = st.up, Fp = st.Fp, z1 = st.z1, z2 = st.z2
    let dt = R[0], tr = R[2], b = R[4], G = R[6], nm = R[8], ca = R[10], lg = R[12]
    const dti = R[1], tri = R[3], bi = R[5], Gi = R[7], nmi = R[9], cai = R[11], lgi = R[13]
    for (let i = 0; i < n; i++) {
      dt += dti; tr += tri; b += bi; G += Gi; nm += nmi; ca += cai; lg += lgi
      let x = sin1(ph)
      if (tr > 1e-6) x += tr * (triBL(ph, dt) - x)
      ph += dt; if (ph >= 1) ph -= 1
      const u = G * (x + b)
      const F = -Math.cos(u)
      const du = u - up
      const y = du > 1e-5 || du < -1e-5 ? (F - Fp) / du : Math.sin(0.5 * (u + up))
      up = u; Fp = F
      z1 += ca * (y * nm - z1)
      z2 += ca * (z1 - z2)
      buf[i] = z2 * lg
    }
    st.ph = ph; st.up = up; st.Fp = Fp; st.z1 = z1; st.z2 = z2
    R[0] = dt; R[2] = tr; R[4] = b; R[6] = G; R[8] = nm; R[10] = ca; R[12] = lg
  },
}

// ═══ 8 · pluck ══════════════════════════════════════════════════════════════
// Karplus-Strong : a delay line read with a 3rd-order Lagrange interpolator
// (kept in its flat [1, 2] region), a one-pole loop low-pass, four first-order
// allpasses for dispersion, the loop gain from a T60. The loop's whole phase
// delay at the fundamental (low-pass + allpasses) is taken out of the line, so
// the string tunes exactly; every loop element has a gain of at most 1 and the
// loop gain is clamped under it, so it cannot run away.
// timbre : the excitation : a hashed noise burst through a low-pass and a
//   pluck-position comb, from a dark thumb near the middle to a bright pick
//   near the bridge
// harmonics : stiffness (the allpasses : plain string → piano-like stretch →
//   a metal-bar shimmer), limited by pitch so the line can still be tuned
// morph : damping : steel (long and bright) → nylon → muted (short and dark);
//   a released note is damped like a lifted finger
class PluckSt {
  constructor(size) {
    this.buf = new Float32Array(size)
    this.mask = size - 1
    this.w = 0
    this.lp = 0
    this.ap = new Float64Array(4)
    this.R = new Float64Array(2 * 4)
    this.ex = 0; this.exL = 0; this.exTap = 1; this.exSeed = 0; this.exLp = 0; this.exC = 0.5; this.exA = 0
    this.damp = 0
  }
}
function hashN(n) {
  let x = Math.imul(n | 0, 0x9e3779b9) + 0x7f4a7c15
  x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16
  return (x >>> 0) * 4.656612873077393e-10 - 1
}
const pluck = {
  start(v, s, fresh) {
    const st = v.ks
    if (fresh) { st.buf.fill(0); st.lp = 0; st.ap.fill(0); st.w = 0 } else st.damp = Math.ceil(s.sr / Math.max(30, v.dt * s.sr))
    const T = v.T, f0 = Math.max(20, v.dt * s.sr), P = s.sr / f0
    st.ex = 0
    st.exL = Math.max(4, Math.round(P))
    st.exTap = Math.max(1, Math.round(P * (0.45 - 0.39 * T)))
    st.exSeed = (rnd01(v) * 1e6) | 0
    st.exC = 1 - Math.exp((-TAU * Math.min(0.45 * s.sr, f0 * exp2(1.5 + 6 * T))) / s.sr)
    const tc = T < 0.5 ? 1.8 - 1.6 * T : 1 - 0.42 * (T - 0.5)
    const mc = Math.pow(150, 0.18 * v.M)
    st.exA = 0.75 * (0.4 + 0.6 * v.velG) * tc * mc
    st.exLp = 0
  },
  ctl(v, s, snap) {
    const st = v.ks, R = st.R, H = v.H, M = v.M, sr = s.sr
    const f0 = Math.max(20, v.dt * sr), P = sr / f0, om = (TAU * f0) / sr
    // damping
    let T60 = 12 * Math.pow(0.08 / 12, M)
    if (!v.gate) T60 = Math.min(T60, 0.06 + v.relS * 0.5)
    const fcLoop = Math.min(0.45 * sr, f0 * exp2(6 - 4.8 * M))
    const a = 1 - Math.exp((-TAU * fcLoop) / sr)
    const bq = 1 - a
    // stiffness, limited so the allpasses take at most 60 % of the period
    const q = 0.15 * P
    let c = -0.82 * Math.pow(clamp(H, 0, 1), 1.3)
    c = Math.max(c, (1 - q) / (1 + q))
    // phase delays at the fundamental
    const lpDelay = Math.atan2(bq * Math.sin(om), 1 - bq * Math.cos(om)) / om
    const apDelay = 1 - (2 * Math.atan2(c * Math.sin(om), 1 + c * Math.cos(om))) / om
    const D = clamp(P - lpDelay - 4 * apDelay, 2.5, st.mask - 4)
    const lpMag = a / Math.sqrt(1 - 2 * bq * Math.cos(om) + bq * bq)
    const tgt = Math.pow(10, -3 / (T60 * f0))
    let g = Math.min(0.99995, tgt / lpMag)
    if (st.damp > 0) g *= 0.35
    setR(R, 0, D, snap)
    setR(R, 1, g, snap)
    setR(R, 2, a, snap)
    setR(R, 3, c, snap)
  },
  run(v, s, buf, n) {
    const st = v.ks, R = st.R, b = st.buf, mask = st.mask, ap = st.ap
    let w = st.w, lp = st.lp, a0 = ap[0], a1 = ap[1], a2 = ap[2], a3 = ap[3]
    let D = R[0], g = R[2], a = R[4], c = R[6]
    const Di = R[1], gi = R[3], ai = R[5], ci = R[7]
    let exn = st.ex, exLp = st.exLp
    const exL = st.exL, exSeed = st.exSeed, exTap = st.exTap, exC = st.exC, exA = st.exA
    for (let i = 0; i < n; i++) {
      D += Di; g += gi; a += ai; c += ci
      // Lagrange, 3rd order : taps at delays iD-1 .. iD+2, position t in [1, 2)
      const iD = Math.floor(D), t = 1 + (D - iD)
      const x0 = b[(w - iD + 1) & mask], x1 = b[(w - iD) & mask], x2 = b[(w - iD - 1) & mask], x3 = b[(w - iD - 2) & mask]
      const t1 = t - 1, t2 = t - 2, t3 = t - 3
      const y = -x0 * (t1 * t2 * t3) / 6 + x1 * (t * t2 * t3) / 2 - x2 * (t * t1 * t3) / 2 + x3 * (t * t1 * t2) / 6
      // loop : low-pass, four allpasses, gain
      lp += a * (y - lp)
      let u = lp
      let o = c * u + a0; a0 = u - c * o; u = o
      o = c * u + a1; a1 = u - c * o; u = o
      o = c * u + a2; a2 = u - c * o; u = o
      o = c * u + a3; a3 = u - c * o; u = o
      let x = u * g
      if (exn < exL) {
        const k = exn + exSeed
        const raw = hashN(k) - hashN(k - exTap)
        exLp += exC * (raw - exLp)
        x += exLp * exA
        exn++
      }
      b[w] = x < 1e-30 && x > -1e-30 ? 0 : x
      w = (w + 1) & mask
      buf[i] = y
    }
    st.ex = exn; st.exLp = exLp
    if (st.damp > 0) st.damp = Math.max(0, st.damp - n)
    if (lp < 1e-18 && lp > -1e-18) lp = 0
    st.w = w; st.lp = lp; ap[0] = a0; ap[1] = a1; ap[2] = a2; ap[3] = a3
    R[0] = D; R[2] = g; R[4] = a; R[6] = c
  },
}

const ENGINES = [dco, ms, swarm, fm, modal, voice, fold, pluck]
const ENGINE_IDS = ['dco', 'ms', 'swarm', 'fm', 'modal', 'voice', 'fold', 'pluck']
// Loudness trims, measured (tools/synth-render.cjs : the standard phrase, LUFS).
const ENGINE_TRIM = [0.628, 0.639, 0.534, 0.535, 0.748, 0.851, 0.398, 1.88]
const FILTER_IDS = ['ladder', 'ms', 'morph']

// ═══ the tone filters ═══════════════════════════════════════════════════════
// ladder : after jx-move (Vincent Fillion, MIT) : the IR3109-style 4-pole OTA
//   cascade, four TPT one-poles with the feedback solved zero-delay and a
//   differential pair's tanh in it (bounded self-oscillation above k ≈ 4); the
//   bass thins as resonance rises, a little of it given back.
// ms : after aphex-move (Vincent Fillion, MIT) : the Korg-35 style HP → LP
//   cascade (TPT predictor-corrector, the saturation only in the feedback);
//   the HP stage takes `hpf` as its cutoff, the LP stage cutoff / reso.
// morph : a TPT SVF swept LP → BP → HP (schwung-quark's weights) with
//   klaine/crest's saturating band-pass state, so it self-oscillates bounded.
// Seeding (TinyPro5, MIT) : near self-oscillation a whisper of noise and a
// small key click let an ideal filter start singing on its own.
class FiltSt {
  constructor() {
    this.s0 = 0; this.s1 = 0; this.s2 = 0; this.s3 = 0
    this.hz1 = 0; this.hz2 = 0; this.hz3 = 0; this.lz1 = 0; this.lz2 = 0; this.lz3 = 0
    this.ic1 = 0; this.ic2 = 0
    this.R = new Float64Array(2 * 8)
    this.seed = 0; this.kick = 0
  }
  reset() {
    this.s0 = this.s1 = this.s2 = this.s3 = 0
    this.hz1 = this.hz2 = this.hz3 = this.lz1 = this.lz2 = this.lz3 = 0
    this.ic1 = this.ic2 = 0
  }
  /** Tiny states go to 0 (a long silence never reaches subnormals). */
  flush() {
    this.s0 = flz(this.s0); this.s1 = flz(this.s1); this.s2 = flz(this.s2); this.s3 = flz(this.s3)
    this.hz1 = flz(this.hz1); this.hz2 = flz(this.hz2); this.hz3 = flz(this.hz3)
    this.lz1 = flz(this.lz1); this.lz2 = flz(this.lz2); this.lz3 = flz(this.lz3)
    this.ic1 = flz(this.ic1); this.ic2 = flz(this.ic2)
  }
}
function flz(x) { return x < 1e-25 && x > -1e-25 ? 0 : x }
function k35t(x) { const xs = x * 0.7, x2 = xs * xs; return ((xs * (27 + x2)) / (27 + 9 * x2)) / 0.7 }
function filterCtl(type, f, v, s, snap) {
  const R = f.R, sr = s.sr
  const fc = v.fc
  if (type === 0) {
    const g = Math.tan((Math.PI * Math.min(fc, 0.45 * sr)) / sr)
    const k = 4.25 * v.Rz
    setR(R, 0, g / (1 + g), snap)
    setR(R, 1, k, snap)
    setR(R, 2, 1 + 0.35 * k, snap)
    f.seed = k > 3.7 ? 4e-4 : 0
  } else if (type === 1) {
    const gl = Math.tan((Math.PI * Math.min(fc, 0.47 * sr)) / sr)
    const fh = Math.min(0.45 * sr, 20 * exp2(s.cs.hpf * 7))
    const gh = Math.tan((Math.PI * fh) / sr)
    setR(R, 0, gl / (1 + gl), snap)
    setR(R, 1, 2.06 * Math.pow(v.Rz, 1.1), snap)
    setR(R, 2, gh / (1 + gh), snap)
    setR(R, 3, 1.99 * 0.55 * v.Rz, snap)
    f.seed = v.Rz > 0.94 ? 4e-4 : 0
  } else {
    const g = Math.tan((Math.PI * Math.min(fc, 0.45 * sr)) / sr)
    const k = 2 - 2.08 * Math.pow(v.Rz, 0.9)
    const mo = s.cs.fmode
    setR(R, 0, g, snap)
    setR(R, 1, k, snap)
    setR(R, 2, mo < 0.5 ? 1 - 2 * mo : 0, snap)
    setR(R, 3, (mo < 0.5 ? 2 * mo : 2 - 2 * mo) * 1.35, snap)
    setR(R, 4, mo < 0.5 ? 0 : 2 * mo - 1, snap)
    f.seed = k < 0.2 ? 2e-5 : 0
  }
}
function filterRun(type, f, v, buf, n) {
  const R = f.R
  const seed = f.seed
  let kick = f.kick > 0 && seed > 0
  if (seed > 0 || f.kick > 0) f.kick = 0
  if (type === 0) {
    let a = R[0], k = R[2], cp = R[4]
    const ai = R[1], ki = R[3], cpi = R[5]
    let s0 = f.s0, s1 = f.s1, s2 = f.s2, s3 = f.s3
    for (let i = 0; i < n; i++) {
      a += ai; k += ki; cp += cpi
      let x = buf[i] * cp
      if (seed > 0) { x += seed * (rnd01(v) * 2 - 1); if (kick) { x += 0.012; kick = false } }
      const b = 1 - a, a2 = a * a, a4 = a2 * a2
      const S = b * (a2 * a * s0 + a2 * s1 + a * s2 + s3)
      const y4 = (a4 * x + S) / (1 + k * a4)
      let u = x - k * 0.8 * ftanh(y4 * 1.25)
      let d = (u - s0) * a; let y = d + s0; s0 = y + d; u = y
      d = (u - s1) * a; y = d + s1; s1 = y + d; u = y
      d = (u - s2) * a; y = d + s2; s2 = y + d; u = y
      d = (u - s3) * a; y = d + s3; s3 = y + d
      buf[i] = y
    }
    f.s0 = s0; f.s1 = s1; f.s2 = s2; f.s3 = s3
    R[0] = a; R[2] = k; R[4] = cp
  } else if (type === 1) {
    let G = R[0], K = R[2], Gh = R[4], Kh = R[6]
    const Gi = R[1], Ki = R[3], Ghi = R[5], Khi = R[7]
    let hz1 = f.hz1, hz2 = f.hz2, hz3 = f.hz3, lz1 = f.lz1, lz2 = f.lz2, lz3 = f.lz3
    for (let i = 0; i < n; i++) {
      G += Gi; K += Ki; Gh += Ghi; Kh += Khi
      let x = buf[i]
      if (seed > 0) { x += seed * (rnd01(v) * 2 - 1); if (kick) { x += 0.012; kick = false } }
      // K35 HP (predictor-corrector, saturation in the feedback)
      let H = 1 - Gh
      let u = (x + Kh * H * (H * hz2 - hz3 - H * Gh * hz1)) / (1 - Kh * H * H * Gh)
      let yp = H * (u - hz1)
      let ap = Gh * yp + hz2 * H
      let bp = H * (ap - hz3)
      u = x + Kh * k35t(bp)
      const yh = H * (u - hz1)
      let vv = (u - hz1) * Gh; let y1 = vv + hz1; hz1 = y1 + vv
      vv = (yh - hz2) * Gh; let y2 = vv + hz2; hz2 = y2 + vv
      vv = (y2 - hz3) * Gh; let y3 = vv + hz3; hz3 = y3 + vv
      // K35 LP
      H = 1 - G
      const S1 = lz1 * H
      u = (yh + K * H * (S1 - lz3)) / (1 - K * H * G)
      const yl1 = G * u + S1
      const yhp = H * (yl1 - lz3)
      u = yh + K * k35t(yhp)
      vv = (u - lz1) * G; y1 = vv + lz1; lz1 = y1 + vv
      vv = (y1 - lz2) * G; y2 = vv + lz2; lz2 = y2 + vv
      vv = (y1 - lz3) * G; y3 = vv + lz3; lz3 = y3 + vv
      buf[i] = y2
    }
    f.hz1 = hz1; f.hz2 = hz2; f.hz3 = hz3; f.lz1 = lz1; f.lz2 = lz2; f.lz3 = lz3
    R[0] = G; R[2] = K; R[4] = Gh; R[6] = Kh
  } else {
    let g = R[0], k = R[2], wl = R[4], wb = R[6], wh = R[8]
    const gi = R[1], ki = R[3], wli = R[5], wbi = R[7], whi = R[9]
    let ic1 = f.ic1, ic2 = f.ic2
    for (let i = 0; i < n; i++) {
      g += gi; k += ki; wl += wli; wb += wbi; wh += whi
      let x = buf[i]
      if (seed > 0) x += seed * (rnd01(v) * 2 - 1)
      const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2
      const v3 = x - ic2
      const v1 = a1 * ic1 + a2 * v3
      const v2 = ic2 + a2 * ic1 + a3 * v3
      ic1 = ftanh((2 * v1 - ic1) * 0.5) * 2
      ic2 = clamp(2 * v2 - ic2, -8, 8)
      const kb = k > 0.5 ? k : 0.5
      buf[i] = wl * v2 + wb * kb * v1 + wh * (x - k * v1 - v2)
    }
    f.ic1 = ic1; f.ic2 = ic2
    R[0] = g; R[2] = k; R[4] = wl; R[6] = wb; R[8] = wh
  }
}
// R stride : the morph filter uses 5 ramps, room for 8
FiltSt.prototype.size = 8

// ═══ the voice ══════════════════════════════════════════════════════════════
class Voice {
  constructor(s, i) {
    this.s = s
    this.i = i
    this.rs = new Int32Array(1)
    this.rs[0] = ((0x9e3779b9 * (i + 1)) ^ 0x2545f491) | 0 || 1
    this.id = -1; this.gate = false; this.age = 0
    this.stage = 0; this.env = 0
    this.vel = 0.8; this.velG = 0.8
    this.p = 69; this.pT = 69; this.slide = false
    this.dt = 440 / s.sr; this.p2off = 0
    this.atkS = 0.01; this.decS = 0.3; this.relS = 0.3
    // the picture's mods : targets and smoothed
    this.tT = 0; this.tH = 0; this.tM = 0; this.tC = 0; this.tR = 0; this.tD = 0; this.tBend = 0; this.tPan = 0; this.tExp = 0; this.tEnv = 0
    this.mT = 0; this.mH = 0; this.mM = 0; this.mC = 0; this.mR = 0; this.mD = 0; this.mBend = 0; this.mPan = 0; this.mExp = 0
    this.T = 0.5; this.H = 0.5; this.M = 0.5; this.Rz = 0.2; this.fc = 1000
    // unison place
    this.uniC = 0; this.uniPan = 0; this.uniG = 1
    // stealing
    this.stealing = false; this.fade = 1; this.fadeI = 0
    this.pendId = -1; this.pendP = 69; this.pendVel = 0.8
    // drift (TinyPro5's three-band walk) and this voice's tolerances
    this.dx = new Float64Array(9)
    this.dr0 = 0; this.dr1 = 0; this.dr2 = 0
    this.tolC = 0; this.tolC2 = 0; this.tolF = 0; this.noteC = 0
    // output
    this.R = new Float64Array(2 * 7) // gL, gR, drive pre, bias, comp, wet, bite
    this.bx = 0; this.bF = 0; this.bdx = 0; this.bdy = 0
    this.dcx = 0; this.dcy = 0
    this.dvx = 0; this.dvF = 0; this.dvLp = 0
    this.osU = new Float64Array(16); this.osUp = 0
    this.osD = new Float64Array(32); this.osDp = 0
    this.osX = 0; this.osXi = 0; this.osHold = 0
    this.drvAdd = 0
    // engines and filters
    this.dco = new DcoSt(); this.ms = new MsSt(); this.sw = new SwarmSt(); this.fm = new FmSt()
    this.mo = new ModalSt(); this.vo = new VoxSt(); this.fo = new FoldSt(); this.ks = new PluckSt(s.ksSize)
    this.f0 = new FiltSt(); this.f1 = new FiltSt(); this.f2 = new FiltSt()
    this.filts = [this.f0, this.f1, this.f2]
    this.fresh = true
    // tolerances : fixed per voice, scaled by drift
    this.tolC = (rnd01(this) * 2 - 1) * 2.2
    this.tolC2 = (rnd01(this) * 2 - 1) * 2.2
    this.tolF = (rnd01(this) * 2 - 1) * 0.1
  }
}

// ═══ the synth ══════════════════════════════════════════════════════════════
class OpsiaSynth {
  constructor(sampleRate) {
    const sr = (this.sr = sampleRate > 0 ? sampleRate : 48000)
    let ks = 1
    while (ks < sr / 14 + 16) ks <<= 1
    this.ksSize = ks
    this.cfg = {
      engine: 0, timbre: 0.5, harmonics: 0.3, morph: 0.2, voices: 0, filter: 0,
      cutoff: 0.62, reso: 0.2, drive: 0.1, hpf: 0.05, fmode: 0, envAmt: 0.3,
      attack: 0.12, decay: 0.45, sustain: 0.7, release: 0.35, glide: 0, drift: 0.3,
      chorus: 1, level: 0.7,
    }
    this.cs = { ...this.cfg }
    this.voiceMode = 0
    this.v = []
    for (let i = 0; i < NV; i++) this.v.push(new Voice(this, i))
    this.clock = 0
    this.ctlLeft = 0
    this.primed = false
    // engine / filter crossfades
    this.eng = 0; this.engPrev = -1; this.engPend = -1; this.exf = 1; this.exfI = 0
    this.flt = 0; this.fltPrev = -1; this.fltPend = -1; this.fxf = 1; this.fxfI = 0
    // mono / unison note stack
    this.stId = new Int32Array(32); this.stP = new Float64Array(32); this.stVel = new Float64Array(32); this.stN = 0
    this.topId = -1
    // buffers
    this.bufA = new Float64Array(CTL); this.bufB = new Float64Array(CTL)
    this.busL = new Float64Array(BLOCK); this.busR = new Float64Array(BLOCK)
    // bus : HPF, chorus, level
    this.hpL = 0; this.hpR = 0; this.hpG = 0
    this.lvl = 0; this.cwet = 0; this.cmix = 0
    this.choN = 1
    while (this.choN < sr * 0.012) this.choN <<= 1
    this.choBuf = new Float32Array(this.choN); this.choW = 0; this.choLp = 0; this.choPh = 0
    this.choRate = 0.41; this.choC = 50500; this.choDev = 26600
    this.cpre = [this.bq(9690, 0.549), this.bq(10380, 1.29)]
    this.cpost = [[this.bq(9690, 0.549), this.bq(10380, 1.29)], [this.bq(9690, 0.549), this.bq(10380, 1.29)]]
    this.choLpC = 1 - Math.exp((-TAU * 7200) / sr)
    this.grs = new Int32Array(1)
    this.grs[0] = 0x1234567
    this.diag = { resets: 0 }
    // smoothing coefficients (per control tick)
    this.cfgC = 1 - Math.exp(-CTL / (0.015 * sr))
    this.modC = 1 - Math.exp(-CTL / (0.022 * sr))
    // drift walk bands
    const dtw = CTL / sr
    this.drC = [0.05, 0.35, 1.8].map((hz) => 1 - Math.exp(-TAU * hz * dtw))
    this.drG = this.drC.map((c) => 1 / (0.57735 * Math.sqrt(c / (2 - c))))
  }
  bq(fc, Q) {
    const w = (TAU * Math.min(fc, 0.45 * this.sr)) / this.sr, cs = Math.cos(w), al = Math.sin(w) / (2 * Q), a0 = 1 + al
    return { b0: (1 - cs) * 0.5 / a0, b1: (1 - cs) / a0, b2: (1 - cs) * 0.5 / a0, a1: (-2 * cs) / a0, a2: (1 - al) / a0, z1: 0, z2: 0 }
  }

  // ── config ──
  setConfig(c) {
    if (!c || typeof c !== 'object') return
    const t = this.cfg
    const num = (k, lo, hi) => { const x = c[k]; if (typeof x === 'number' && isFinite(x)) t[k] = clamp(x, lo, hi) }
    num('timbre', 0, 1); num('harmonics', 0, 1); num('morph', 0, 1)
    num('cutoff', 0, 1); num('reso', 0, 1); num('drive', 0, 1); num('hpf', 0, 1); num('fmode', 0, 1)
    num('envAmt', -1, 1); num('attack', 0, 1); num('decay', 0, 1); num('sustain', 0, 1); num('release', 0, 1)
    num('glide', 0, 1); num('drift', 0, 1); num('level', 0, 1)
    if (c.chorus === 0 || c.chorus === 1 || c.chorus === 2) t.chorus = c.chorus
    if (typeof c.engine === 'string') {
      const e = ENGINE_IDS.indexOf(c.engine)
      if (e >= 0) t.engine = e
    }
    if (typeof c.filter === 'string') {
      const f = FILTER_IDS.indexOf(c.filter)
      if (f >= 0) t.filter = f
    }
    if (typeof c.voices === 'string') {
      const m = c.voices === 'unison' ? 1 : c.voices === 'mono' ? 2 : c.voices === 'poly' ? 0 : -1
      if (m >= 0 && m !== this.voiceMode) {
        // a new voice mode : everything releases, the held notes are forgotten
        for (const v of this.v) if (v.gate) this.release(v)
        this.stN = 0; this.topId = -1
        this.voiceMode = m
        for (const v of this.v) { v.uniC = 0; v.uniPan = 0; v.uniG = 1 }
      }
    }
    if (!this.primed) {
      Object.assign(this.cs, t)
      this.eng = t.engine; this.flt = t.filter
      this.primed = true
    }
  }

  // ── notes ──
  midi(hz) { return 69 + 12 * Math.log2(hz / 440) }
  findVoice(id) {
    for (const v of this.v) if (v.id === id && (v.stage !== 0 || v.stealing)) return v
    return null
  }
  noteOn(id, hz, vel) {
    if (!(hz > 0) || !isFinite(hz)) return
    id = id | 0
    vel = typeof vel === 'number' && isFinite(vel) ? clamp(vel, 0, 1) : 0.8
    const p = this.midi(clamp(hz, 8, 20000))
    if (this.voiceMode === 0) {
      let v = this.findVoice(id)
      if (v) { if (v.stealing) { v.pendP = p; v.pendVel = vel } else this.strike(v, p, vel, false); return }
      for (const x of this.v) if (x.stage === 0 && !x.stealing) { v = x; break }
      if (v) { v.id = id; this.strike(v, p, vel, true); return }
      // steal : the quietest released voice, else the oldest
      let best = null
      for (const x of this.v) if (!x.gate && !x.stealing && (!best || x.env < best.env)) best = x
      if (!best) for (const x of this.v) if (!x.stealing && (!best || x.age < best.age)) best = x
      if (!best) best = this.v[0]
      best.stealing = true
      best.fadeI = -1 / ((0.005 * this.sr) / CTL)
      best.pendId = id; best.pendP = p; best.pendVel = vel
      best.id = id
      return
    }
    // mono / unison
    const legato = this.stN > 0
    const same = this.topId === id
    this.stackRemove(id)
    if (this.stN === 32) { this.stId.copyWithin(0, 1); this.stP.copyWithin(0, 1); this.stVel.copyWithin(0, 1); this.stN = 31 }
    this.stId[this.stN] = id; this.stP[this.stN] = p; this.stVel[this.stN] = vel; this.stN++
    this.topId = id
    this.monoPlay(p, vel, !legato || same)
  }
  stackRemove(id) {
    let j = 0
    for (let i = 0; i < this.stN; i++) if (this.stId[i] !== id) { this.stId[j] = this.stId[i]; this.stP[j] = this.stP[i]; this.stVel[j] = this.stVel[i]; j++ }
    this.stN = j
  }
  monoPlay(p, vel, retrig) {
    const n = this.voiceMode === 1 ? NV : 1
    for (let i = 0; i < n; i++) {
      const v = this.v[i]
      v.id = this.topId
      if (this.voiceMode === 1) {
        v.uniC = ((i - (NV - 1) / 2) / ((NV - 1) / 2)) * 15
        v.uniPan = (i & 1 ? 1 : -1) * (0.25 + 0.6 * ((i >> 1) / 3))
        v.uniG = 0.42
      } else { v.uniC = 0; v.uniPan = 0; v.uniG = 1 }
      if (retrig || v.stage === 0 || !v.gate) this.strike(v, p, vel, v.stage === 0 && !v.stealing, !retrig && v.stage !== 0)
      else {
        // legato : the pitch moves, the envelope does not restart; struck
        // engines strike anyway (a new note on a string is a new pluck)
        v.pT = p; v.slide = false
        if (this.cs.glide <= 0) v.p = p
        const e = this.eng
        if (e === 4 || e === 6 || e === 7) ENGINES[e].start(v, this, false)
      }
    }
  }
  strike(v, p, vel, fresh, legatoOnly) {
    const s = this
    if (fresh) {
      v.fresh = true
      v.p = p
      v.env = 0
      v.mT = v.tT; v.mH = v.tH; v.mM = v.tM; v.mC = v.tC; v.mR = v.tR; v.mD = v.tD
      v.mBend = v.tBend; v.mPan = v.tPan; v.mExp = 0; v.tExp = 0
      v.dcx = 0; v.dcy = 0; v.dvx = 0; v.dvF = 0; v.dvLp = 0
      v.osU.fill(0); v.osD.fill(0); v.osX = 0; v.osXi = 0; v.osHold = 0
      v.bx = 0; v.bF = 0; v.bdx = 0; v.bdy = 0
      for (const f of v.filts) f.reset()
    } else if (s.cs.glide <= 0) v.p = p
    v.pT = p; v.slide = false
    v.vel = vel
    v.velG = Math.pow(10, (vel - 1) * 0.8)
    v.gate = true
    if (!legatoOnly) v.stage = 1
    else if (v.stage === 0 || v.stage === 4) v.stage = 1
    v.age = ++s.clock
    // the envelope's times, scaled by the picture's env at the strike
    const ef = clamp(v.tEnv, -1, 1)
    const cs = s.cfg
    v.atkS = 0.001 * Math.pow(6000, cs.attack) * exp2(3 * ef)
    v.decS = 0.003 * Math.pow(2667, cs.decay) * exp2(2 * ef)
    v.relS = 0.004 * Math.pow(2500, cs.release) * exp2(2 * ef)
    v.noteC = (rnd01(v) * 2 - 1) * 2
    // the engine(s)
    this.prepVoice(v)
    ENGINES[s.eng].start(v, s, fresh)
    if (s.engPrev >= 0) ENGINES[s.engPrev].start(v, s, fresh)
    for (const f of v.filts) f.kick = 1
    if (fresh) this.voiceCtl(v, true)
  }
  release(v) {
    v.gate = false
    if (v.stage !== 0) v.stage = 4
  }
  noteOff(id) {
    id = id | 0
    if (this.voiceMode === 0) {
      for (const v of this.v) if (v.id === id && v.gate) this.release(v)
      for (const v of this.v) if (v.stealing && v.pendId === id) v.pendVel = -1
      return
    }
    const wasTop = this.topId === id
    this.stackRemove(id)
    if (!wasTop) return
    if (this.stN > 0) {
      const k = this.stN - 1
      this.topId = this.stId[k]
      this.monoPlay(this.stP[k], this.stVel[k], false)
    } else {
      this.topId = -1
      for (const v of this.v) if (v.gate) this.release(v)
    }
  }
  setPitch(id, hz) {
    if (!(hz > 0) || !isFinite(hz)) return
    id = id | 0
    const p = this.midi(clamp(hz, 8, 20000))
    if (this.voiceMode === 0) {
      for (const v of this.v) if (v.id === id && v.stage !== 0) { v.pT = p; v.slide = true }
      for (const v of this.v) if (v.stealing && v.pendId === id) v.pendP = p
      return
    }
    for (let i = 0; i < this.stN; i++) if (this.stId[i] === id) this.stP[i] = p
    if (this.topId === id) for (const v of this.v) if (v.id === id && v.stage !== 0) { v.pT = p; v.slide = true }
  }
  setMods(id, m) {
    if (!m || typeof m !== 'object') return
    id = id | 0
    for (const v of this.v) {
      if (v.id !== id) continue
      const g = (k, lo, hi) => { const x = m[k]; return typeof x === 'number' && isFinite(x) ? clamp(x, lo, hi) : null }
      let x
      if ((x = g('timbre', -1, 1)) !== null) v.tT = x
      if ((x = g('harmonics', -1, 1)) !== null) v.tH = x
      if ((x = g('morph', -1, 1)) !== null) v.tM = x
      if ((x = g('cutoff', -1, 1)) !== null) v.tC = x
      if ((x = g('reso', -1, 1)) !== null) v.tR = x
      if ((x = g('drive', -1, 1)) !== null) v.tD = x
      if ((x = g('env', -1, 1)) !== null) v.tEnv = x
      if ((x = g('pan', -1, 1)) !== null) v.tPan = x
      if ((x = g('bend', -1, 1)) !== null) v.tBend = x
      if ((x = g('vel', 0, 1)) !== null) v.tExp = clamp(12 * (x - v.vel), -6, 6)
    }
  }
  allOff() {
    for (const v of this.v) {
      if (v.gate) this.release(v)
      if (v.stealing) v.pendVel = -1
    }
    this.stN = 0; this.topId = -1
  }
  activeVoices() {
    let n = 0
    for (const v of this.v) if (v.stage !== 0 || v.stealing) n++
    return n
  }

  // ── control ──
  prepVoice(v) {
    const cs = this.cs
    v.T = clamp(cs.timbre + v.mT, 0, 1)
    v.H = clamp(cs.harmonics + v.mH, 0, 1)
    v.M = clamp(cs.morph + v.mM, 0, 1)
    const dr = cs.drift
    const cents = dr * (2.2 * v.dr0 + v.tolC + v.noteC) + v.uniC
    v.dt = Math.min(0.45, (440 * exp2((v.p + 2 * v.mBend + cents / 100 - 69) / 12)) / this.sr)
    v.p2off = (dr * (2.2 * v.dr1 + v.tolC2 - v.tolC)) / 100
  }
  voiceCtl(v, snap) {
    const s = this, cs = this.cs, sr = this.sr, tick = CTL / sr
    // the picture's mods
    const mc = snap ? 1 : this.modC
    v.mT += (v.tT - v.mT) * mc; v.mH += (v.tH - v.mH) * mc; v.mM += (v.tM - v.mM) * mc
    v.mC += (v.tC - v.mC) * mc; v.mR += (v.tR - v.mR) * mc; v.mD += (v.tD - v.mD) * mc
    v.mBend += (v.tBend - v.mBend) * mc; v.mPan += (v.tPan - v.mPan) * mc; v.mExp += (v.tExp - v.mExp) * mc
    // pitch : glide, or a slide (setPitch) at least 12 ms
    const gt = cs.glide * cs.glide * 0.7
    const tau = v.slide ? Math.max(gt, 0.012) : gt
    if (tau <= 0.0004) v.p = v.pT
    else v.p += (v.pT - v.p) * (1 - Math.exp(-tick / tau))
    // drift : a 1/f walk per voice (three bands) on pitch, the 2nd oscillator
    // and the cutoff
    const dx = v.dx, drC = this.drC, drG = this.drG
    for (let ch = 0; ch < 3; ch++) {
      let sum = 0
      for (let b = 0; b < 3; b++) {
        const j = ch * 3 + b
        dx[j] += drC[b] * (rnd01(v) * 2 - 1 - dx[j])
        sum += dx[j] * drG[b]
      }
      const d = clamp(sum * 0.57735, -3, 3)
      if (ch === 0) v.dr0 = d; else if (ch === 1) v.dr1 = d; else v.dr2 = d
    }
    this.prepVoice(v)
    // the envelope
    if (v.stage === 1) {
      const ta = Math.max(0.001, v.atkS) / 1.466
      v.env += (1.3 - v.env) * (1 - Math.exp(-tick / ta))
      if (v.env >= 1) { v.env = 1; v.stage = 2 }
    } else if (v.stage === 2) {
      const sus = cs.sustain
      v.env = sus + (v.env - sus) * Math.exp((-tick * 3) / Math.max(0.002, v.decS))
      if (Math.abs(v.env - sus) < 1e-3) { v.env = sus; v.stage = 3 }
    } else if (v.stage === 3) {
      v.env = cs.sustain
      // a held note at sustain 0 has ended : free the voice (the id forgets it)
      if (v.env < 1e-5) v.stage = 4
    }
    else if (v.stage === 4) {
      // the release is linear in level (aphex-move : an exponential release of
      // 1.5 s sounds like ten)
      v.env -= tick / Math.max(0.003, v.relS)
      if (v.env <= 0) v.env = 0
    }
    // the cutoff
    v.Rz = clamp(cs.reso + v.mR, 0, 1)
    const C = clamp(cs.cutoff + v.mC, 0, 1)
    const oct = C * 9.55 + cs.envAmt * v.env * 7 + 0.5 * ((v.p - 60) / 12) +
      cs.drift * (0.16 * v.dr2 + v.tolF) + (v.vel - 0.6) * 0.7 + v.mExp * 0.04
    v.fc = clamp(28 * exp2(oct), 16, 0.45 * sr)
    // the engine(s) and the filter(s)
    ENGINES[this.eng].ctl(v, s, snap)
    if (this.engPrev >= 0) ENGINES[this.engPrev].ctl(v, s, snap)
    filterCtl(this.flt, v.filts[this.flt], v, s, snap)
    if (this.fltPrev >= 0) filterCtl(this.fltPrev, v.filts[this.fltPrev], v, s, snap)
    // drive (schwung-quark's law); the ms engine's morph drives into the
    // filter through this same stage
    const xw = this.engPrev >= 0 ? this.exf : 1
    const add = (this.eng === 1 ? 0.8 * Math.pow(v.M, 1.2) * xw : 0) + (this.engPrev === 1 ? 0.8 * Math.pow(v.M, 1.2) * (1 - xw) : 0)
    const D = clamp(cs.drive + v.mD + add, 0, 1)
    // the top two octaves get a little less gain (a coupling capacitor's
    // way), so the clipper's harmonics there stay under the oversampled band
    const fx = (v.dt * sr) / 1700
    const pre = 1 + (16 * D * D) / (1 + fx * fx)
    const bias = 0.15 * D
    const ref = 0.6
    const pk = sclip(ref * pre + bias) - sclip(bias)
    const comp = (pk > 1e-4 ? ref / pk : 1) / (1 + 0.6 * D)
    const R = v.R
    setR(R, 2, pre, snap)
    setR(R, 3, bias, snap)
    setR(R, 4, comp, snap)
    setR(R, 5, Math.min(1, D * 6), snap)
    // the oversampled path runs while any drive is asked, and a second after;
    // it fades in and out over 10 ms (it is 15.5 samples late)
    // the FM bite (schwung-hank's shaper) shares the stage
    const bite = OpsiaSynthTest.noBite ? 0 : (this.eng === 3 ? v.fm.bite * xw : 0) + (this.engPrev === 3 ? v.fm.bite * (1 - xw) : 0)
    setR(R, 6, bite, snap)
    if (D > 0 || bite > 0) v.osHold = Math.ceil((1 * sr) / CTL)
    else if (v.osHold > 0) v.osHold--
    const osT = v.osHold > 0 ? 1 : 0
    if (snap) { v.osX = osT; v.osXi = 0 } else v.osXi = osT > v.osX ? 1 / (0.01 * sr) : osT < v.osX ? -1 / (0.01 * sr) : 0
    // the VCA and the place
    let fade = 1
    if (v.stealing) { v.fade = Math.max(0, v.fade + v.fadeI); fade = v.fade }
    const g = v.env * v.velG * exp2(v.mExp / 6) * v.uniG * fade
    const pan = clamp(v.mPan + v.uniPan, -1, 1)
    const th = (pan + 1) * 0.7853981633974483
    setR(R, 0, g * Math.cos(th) * 1.41421356, snap)
    setR(R, 1, g * Math.sin(th) * 1.41421356, snap)
  }
  control() {
    const cs = this.cs, t = this.cfg
    let any = false
    for (const v of this.v) if (v.stage !== 0 || v.stealing) { any = true; break }
    // config smoothing (snap while nothing sounds)
    const c = any ? this.cfgC : 1
    cs.timbre += (t.timbre - cs.timbre) * c; cs.harmonics += (t.harmonics - cs.harmonics) * c; cs.morph += (t.morph - cs.morph) * c
    cs.cutoff += (t.cutoff - cs.cutoff) * c; cs.reso += (t.reso - cs.reso) * c; cs.drive += (t.drive - cs.drive) * c
    cs.hpf += (t.hpf - cs.hpf) * c; cs.fmode += (t.fmode - cs.fmode) * c; cs.envAmt += (t.envAmt - cs.envAmt) * c
    cs.sustain += (t.sustain - cs.sustain) * c; cs.glide = t.glide; cs.drift += (t.drift - cs.drift) * c
    cs.level += (t.level - cs.level) * this.cfgC
    cs.attack = t.attack; cs.decay = t.decay; cs.release = t.release
    // engine and filter switches : one crossfade at a time (30 ms / 25 ms)
    if (t.engine !== this.eng && this.engPrev < 0) {
      if (!any) this.eng = t.engine
      else {
        this.engPrev = this.eng; this.eng = t.engine
        this.exf = 0; this.exfI = 1 / (0.03 * this.sr)
        for (const v of this.v) if (v.stage !== 0) ENGINES[this.eng].start(v, this, true)
        for (const v of this.v) if (v.stage !== 0) ENGINES[this.eng].ctl(v, this, true)
      }
    }
    if (t.filter !== this.flt && this.fltPrev < 0) {
      if (!any) this.flt = t.filter
      else {
        this.fltPrev = this.flt; this.flt = t.filter
        this.fxf = 0; this.fxfI = 1 / (0.025 * this.sr)
        for (const v of this.v) if (v.stage !== 0) { v.filts[this.flt].reset(); filterCtl(this.flt, v.filts[this.flt], v, this, true) }
      }
    }
    for (const v of this.v) {
      if (v.stage === 0 && !v.stealing) continue
      this.voiceCtl(v, false)
    }
  }

  // ── render ──
  runVoice(v, pos, n) {
    const a = this.bufA, b = this.bufB
    const e = ENGINES[this.eng]
    e.run(v, this, a, n)
    const tc = ENGINE_TRIM[this.eng]
    if (this.engPrev >= 0) {
      ENGINES[this.engPrev].run(v, this, b, n)
      const tp = ENGINE_TRIM[this.engPrev]
      let w = this.exf
      const wi = this.exfI
      for (let i = 0; i < n; i++) { w = Math.min(1, w + wi); const y0 = b[i] * tp; a[i] = y0 + (a[i] * tc - y0) * w }
    } else for (let i = 0; i < n; i++) a[i] *= tc
    // DC blocker (8 Hz)
    let dcx = v.dcx, dcy = v.dcy
    const dcR = this.dcR
    for (let i = 0; i < n; i++) { const x = a[i]; const y = x - dcx + dcR * dcy; dcx = x; dcy = y; a[i] = y }
    v.dcx = dcx; v.dcy = dcy < 1e-20 && dcy > -1e-20 ? 0 : dcy
    // drive : first-order ADAA cubic clip (schwung-quark), run at 2x
    const R = v.R
    let pre = R[4], bias = R[6], comp = R[8], wet = R[10]
    const prei = R[5], biasi = R[7], compi = R[9], weti = R[11]
    let osX = v.osX, bd = R[12]
    const osXi = v.osXi, bdi = R[13]
    if (osX > 0 || osXi > 0) {
      let xp = v.dvx, Fp = v.dvF, lp = v.dvLp
      let bx = v.bx, bF = v.bF, bdx = v.bdx, bdy = v.bdy
      const bR = this.biteR
      const lpc = this.drvLpC
      const U = v.osU, Dn = v.osD
      let up = v.osUp, dp = v.osDp
      for (let i = 0; i < n; i++) {
        pre += prei; bias += biasi; comp += compi; wet += weti; bd += bdi
        osX = clamp(osX + osXi, 0, 1)
        const x = a[i]
        U[up] = x
        let ue = U[(up - 8) & 15]
        let uo = 0
        for (let k = 0; k < 16; k++) uo += HB[k] * U[(up - k) & 15]
        uo *= 2
        up = (up + 1) & 15
        if (bd > 1e-5) {
          // the bite : an octave (2x² - 1, the exact frequency doubler, where
          // Hank uses |x|) into an asymmetric soft clip (rails 1 and 0.62),
          // first-order ADAA, its DC removed, mixed in by its own amount
          const o = 0.42 * bd, g = 1 + 5 * bd, bn = 1.6 / (1 + 0.6 * bd)
          for (let h = 0; h < 2; h++) {
            const sx = h === 0 ? ue : uo
            const q0 = g * ((1 - o) * sx + o * (2 * sx * sx - 1))
            const q = Math.sqrt(1 + q0 * q0) - 1
            const F = q0 >= 0 ? q : 0.62 * q
            const du = q0 - bx
            let sh
            if (du > 1e-5 || du < -1e-5) sh = (F - bF) / du
            else { const um = 0.5 * (q0 + bx); sh = (um / Math.sqrt(1 + um * um)) * (um < 0 ? 0.62 : 1) }
            bx = q0; bF = F
            const bb = sh - bdx + bR * bdy
            bdx = sh; bdy = bb
            const yb = sx + bd * (bb * bn - sx)
            if (h === 0) ue = yb; else uo = yb
          }
        }
        const off = sclip(bias)
        // the two samples at 2x
        let u = ue * pre + bias
        let F = sclipF(u), dd = u - xp
        let y = dd > 1e-3 || dd < -1e-3 ? (F - Fp) / dd : sclip(0.5 * (u + xp))
        xp = u; Fp = F
        lp += ((y - off) * comp - lp) * lpc
        Dn[dp] = ue + (lp - ue) * wet
        dp = (dp + 1) & 31
        u = uo * pre + bias
        F = sclipF(u); dd = u - xp
        y = dd > 1e-3 || dd < -1e-3 ? (F - Fp) / dd : sclip(0.5 * (u + xp))
        xp = u; Fp = F
        lp += ((y - off) * comp - lp) * lpc
        Dn[dp] = uo + (lp - uo) * wet
        // back down : the centre tap and the odd ones (the latest sample is dp)
        let z = 0.5 * Dn[(dp - 15) & 31]
        for (let k = 0; k < 16; k++) z += HB[k] * Dn[(dp - 2 * k) & 31]
        dp = (dp + 1) & 31
        a[i] = x + (z - x) * osX
      }
      v.dvx = xp; v.dvF = Fp; v.dvLp = lp < 1e-20 && lp > -1e-20 ? 0 : lp
      v.bx = bx; v.bF = bF; v.bdx = bdx; v.bdy = bdy < 1e-20 && bdy > -1e-20 ? 0 : bdy
      v.osUp = up; v.osDp = dp
      if (osX <= 0 && osXi <= 0) { U.fill(0); Dn.fill(0); v.dvx = 0; v.dvF = 0; v.dvLp = 0; v.bx = 0; v.bF = 0; v.bdx = 0; v.bdy = 0 }
    } else { pre += prei * n; bias += biasi * n; comp += compi * n; wet += weti * n; bd += bdi * n }
    v.osX = osX
    R[4] = pre; R[6] = bias; R[8] = comp; R[10] = wet; R[12] = bd
    // the filter(s)
    if (this.fltPrev >= 0) {
      for (let i = 0; i < n; i++) b[i] = a[i]
      filterRun(this.flt, v.filts[this.flt], v, a, n)
      filterRun(this.fltPrev, v.filts[this.fltPrev], v, b, n)
      let w = this.fxf
      const wi = this.fxfI
      for (let i = 0; i < n; i++) { w = Math.min(1, w + wi); a[i] = b[i] + (a[i] - b[i]) * w }
    } else filterRun(this.flt, v.filts[this.flt], v, a, n)
    // VCA and pan into the bus
    let gL = R[0], gR = R[2]
    const gLi = R[1], gRi = R[3]
    const bl = this.busL, br = this.busR
    for (let i = 0; i < n; i++) {
      gL += gLi; gR += gRi
      const y = a[i]
      bl[pos + i] += y * gL
      br[pos + i] += y * gR
    }
    R[0] = gL; R[2] = gR
  }
  endTick(v) {
    // a stolen voice whose fade is done takes its new note
    if (v.stealing && v.fade <= 0) {
      v.stealing = false
      v.fade = 1
      v.stage = 0
      v.env = 0
      if (v.pendVel >= 0) { v.id = v.pendId; this.strike(v, v.pendP, v.pendVel, true) } else { v.id = -1; v.R[0] = v.R[1] = v.R[2] = v.R[3] = 0 }
      return
    }
    if (v.stage === 4 && v.env <= 0 && Math.abs(v.R[0]) < 1e-9 && Math.abs(v.R[2]) < 1e-9) {
      v.stage = 0
      v.gate = false
      v.R[0] = v.R[1] = v.R[2] = v.R[3] = 0
    }
    // safety net : a filter state gone bad is reset (counted : tests assert 0)
    for (const g of v.filts) g.flush()
    const f = v.filts[this.flt]
    if (!(Math.abs(f.s3) < 1e3 && Math.abs(f.lz2) < 1e3 && Math.abs(f.ic2) < 1e3)) { f.reset(); this.diag.resets++ }
  }
  render(outL, outR, n) {
    if (!(n > 0)) return
    let off = 0
    while (off < n) {
      const m = Math.min(BLOCK, n - off)
      this.renderBlock(outL, outR, off, m)
      off += m
    }
  }
  renderBlock(outL, outR, off, n) {
    if (!this.dcR) {
      this.dcR = 1 - (TAU * 8) / this.sr
      this.drvLpC = 1 - Math.exp((-TAU * 12000) / (2 * this.sr))
      this.biteR = 1 - (TAU * 20) / (2 * this.sr)
    }
    const bl = this.busL, br = this.busR
    for (let i = 0; i < n; i++) { bl[i] = 0; br[i] = 0 }
    let pos = 0
    while (pos < n) {
      if (this.ctlLeft === 0) {
        this.control()
        this.ctlLeft = CTL
      }
      const m = Math.min(this.ctlLeft, n - pos)
      for (const v of this.v) if (v.stage !== 0 || v.stealing) this.runVoice(v, pos, m)
      if (this.engPrev >= 0) { this.exf += this.exfI * m; if (this.exf >= 1) { this.exf = 1; this.engPrev = -1 } }
      if (this.fltPrev >= 0) { this.fxf += this.fxfI * m; if (this.fxf >= 1) { this.fxf = 1; this.fltPrev = -1 } }
      pos += m
      this.ctlLeft -= m
      if (this.ctlLeft === 0) for (const v of this.v) if (v.stage !== 0 || v.stealing) this.endTick(v)
    }
    this.post(outL, outR, off, n)
  }
  post(outL, outR, off, n) {
    const sr = this.sr, cs = this.cs, t = this.cfg
    const bl = this.busL, br = this.busR
    // the HPF (jx-move's, non-resonant, 20 → 800 Hz); under the ms filter its
    // HP stage takes the knob and this one rests at 20 Hz
    const hz = this.flt === 1 && this.fltPrev < 0 ? 20 : 20 * Math.pow(40, cs.hpf)
    const hgT = 1 - Math.exp((-TAU * hz) / sr)
    const sm = 1 - Math.exp(-1 / (0.012 * sr))
    // chorus : the BBD (jx-move) : I = 0.41 Hz, 23.9..76.1 kHz clocks; II = 0.83 Hz, wider and lower
    const cmode = t.chorus
    const rateT = cmode === 2 ? 0.83 : 0.41, cT = cmode === 2 ? 45000 : 50500, devT = cmode === 2 ? 30000 : 26600
    const wetT = cmode === 0 ? 0 : 1
    const csm = 1 - Math.exp(-1 / (0.05 * sr))
    // the line is always written (as the hardware's : switching on reads a
    // line that already holds the sound, never a step out of silence); the
    // taps and their post-filters run while the chorus is heard
    const choOn = wetT > 0 || this.cwet > 1e-5
    if (choOn && this.cwet <= 1e-5) for (const c of this.cpost) for (const q of c) { q.z1 = 0; q.z2 = 0 }
    const lvlT = cs.level * OUT_GAIN
    let hg = this.hpG || hgT, hpL = this.hpL, hpR = this.hpR, lvl = this.lvl, cw = this.cwet
    let rate = this.choRate, cc = this.choC, dev = this.choDev, ph = this.choPh
    const cb = this.choBuf, cmask = this.choN - 1, grs = this.grs, choN = this.choN, choLpC = this.choLpC
    let choLp = this.choLp, choW = this.choW
    const p0 = this.cpre[0], p1 = this.cpre[1], q00 = this.cpost[0][0], q01 = this.cpost[0][1], q10 = this.cpost[1][0], q11 = this.cpost[1][1]
    for (let i = 0; i < n; i++) {
      hg += (hgT - hg) * sm
      lvl += (lvlT - lvl) * sm
      let L = bl[i], R = br[i]
      hpL += hg * (L - hpL); L -= hpL
      hpR += hg * (R - hpR); R -= hpR
      const mono = 0.5 * (L + R)
      let x = bqRun(p0, mono); x = bqRun(p1, x)
      choLp += choLpC * (x - choLp)
      let gr = grs[0]
      gr ^= gr << 13; gr ^= gr >>> 17; gr ^= gr << 5
      grs[0] = gr
      cb[choW] = 2 * ftanh(0.5 * choLp) + 0.00008 * (gr * 4.656612873077393e-10)
      rate += (rateT - rate) * csm; cc += (cT - cc) * csm; dev += (devT - dev) * csm
      ph += rate / sr
      if (ph >= 1) ph -= 1
      if (choOn) {
        cw += (wetT - cw) * csm
        const tri = 2 * Math.abs(2 * ph - 1) - 1
        // channel 2's clock runs ~15 % slower (the once-per-sweep swell)
        const f1 = cc + dev * tri, f2 = (cc - dev * tri) * 0.85
        const d1 = (sr * 128) / f1, d2 = (sr * 128) / f2
        let r1 = choW - d1; if (r1 < 0) r1 += choN
        let r2 = choW - d2; if (r2 < 0) r2 += choN
        const i1 = r1 | 0, i2 = r2 | 0, fr1 = r1 - i1, fr2 = r2 - i2
        const t1 = cb[i1] + (cb[(i1 + 1) & cmask] - cb[i1]) * fr1
        const t2 = cb[i2] + (cb[(i2 + 1) & cmask] - cb[i2]) * fr2
        const w1 = bqRun(q01, bqRun(q00, t1)), w2 = bqRun(q11, bqRun(q10, t2))
        // dry 0.6 + wet 0.723 at full (the jx-move output mixer)
        L = L * (1 - 0.4 * cw) + w1 * 0.723 * cw
        R = R * (1 - 0.4 * cw) + w2 * 0.723 * cw
      }
      choW = (choW + 1) & cmask
      L *= lvl; R *= lvl
      // nothing under 1e-30 leaves (a float32 subnormal costs whoever reads it)
      outL[off + i] += L < 1e-30 && L > -1e-30 ? 0 : softlim(L)
      outR[off + i] += R < 1e-30 && R > -1e-30 ? 0 : softlim(R)
    }
    if (Math.abs(hpL) < 1e-20) hpL = 0
    if (Math.abs(hpR) < 1e-20) hpR = 0
    this.hpG = hg; this.hpL = hpL; this.hpR = hpR; this.lvl = lvl; this.cwet = cw
    this.choRate = rate; this.choC = cc; this.choDev = dev; this.choPh = ph
    this.choLp = Math.abs(choLp) < 1e-20 ? 0 : choLp; this.choW = choW
  }
}
const OUT_GAIN = 1.0
function bqRun(q, x) {
  const y = q.b0 * x + q.z1
  q.z1 = q.b1 * x - q.a1 * y + q.z2
  q.z2 = q.b2 * x - q.a2 * y
  return y
}
// jx-move's output knee : transparent below 0.8, then a soft fold toward ±1
function softlim(x) {
  const a = x < 0 ? -x : x
  if (a <= 0.8) return x
  const o = 0.8 + 0.2 * (1 - Math.exp(-(a - 0.8) / 0.2))
  return x < 0 ? -o : o
}

OpsiaSynth.ENGINES = ENGINE_IDS
// test hooks for tools/synth-render.cjs (never used by the app)
OpsiaSynth.test = OpsiaSynthTest
globalThis.OpsiaSynth = OpsiaSynth
})()
