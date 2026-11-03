#!/usr/bin/env node
// The Sonify Synth's render harness : loads src/renderer/src/audio/synth.engine.js
// into Node (it hands itself over as globalThis.OpsiaSynth, as in the
// worklet), plays scripted phrases block by block (128 frames, like the
// AudioWorklet) and writes 24-bit WAVs. No Electron, no test copy.
//
//   node tools/synth-render.cjs check [--sr 48000] [--quick] [--only aliasing,clicks,...]
//       the automatic checks, per engine : aliasing, clicks, DC, stability,
//       loudness, CPU, tuning, and the contract with the play side; prints a table, exits 1 on a failure
//   node tools/synth-render.cjs pack <dir>
//       the listening pack : a phrase per engine, per filter, per factory patch,
//       a picture-like demo, a spectrogram per engine sweep, README.txt
//   node tools/synth-render.cjs calibrate
//       per-engine trims and per-patch levels that land on the reference loudness
//   node tools/synth-render.cjs phrase <engine> <out.wav> [k=v ...]
//       one engine's standard phrase with config overrides

'use strict'
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
require(path.join(ROOT, 'src/renderer/src/audio/synth.engine.js'))
const OpsiaSynth = globalThis.OpsiaSynth
const ENGINES = ['dco', 'ms', 'swarm', 'fm', 'modal', 'voice', 'fold', 'pluck']
const FILTERS = ['ladder', 'ms', 'morph']
const BLOCK = 128

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12)
const db = (x) => 20 * Math.log10(Math.max(1e-30, x))

// ── config ─────────────────────────────────────────────────────────────────
const BASE = {
  engine: 'dco', timbre: 0.5, harmonics: 0.5, morph: 0.3, voices: 'poly', filter: 'ladder',
  cutoff: 0.7, reso: 0.2, drive: 0.1, hpf: 0.05, fmode: 0, envAmt: 0.3,
  attack: 0.08, decay: 0.5, sustain: 0.7, release: 0.35, glide: 0, drift: 0.3, chorus: 1, level: 0.7,
}
const cfgOf = (o) => ({ ...BASE, ...o })

// ── rendering ──────────────────────────────────────────────────────────────
/**
 * events : [{ t, on: [id, hz, vel] } | { t, off: id } | { t, pitch: [id, hz] } |
 *           { t, mods: [id, m] } | { t, cfg } | { t, allOff: true }]
 * applied at the start of the block holding t. onBlock(s, tSec, b) runs before
 * each block (continuous modulation).
 */
function render({ sr = 48000, seconds, cfg, events = [], onBlock = null, synth = null }) {
  const s = synth || new OpsiaSynth(sr)
  if (cfg) s.setConfig(cfg)
  const n = Math.ceil((seconds * sr) / BLOCK) * BLOCK
  const L = new Float32Array(n), R = new Float32Array(n)
  const ev = events.slice().sort((a, b) => a.t - b.t)
  let ei = 0
  const bl = new Float32Array(BLOCK), br = new Float32Array(BLOCK)
  for (let b = 0, pos = 0; pos < n; b++, pos += BLOCK) {
    const tEnd = (pos + BLOCK) / sr
    while (ei < ev.length && ev[ei].t < tEnd) {
      const e = ev[ei++]
      if (e.cfg) s.setConfig(e.cfg)
      if (e.on) s.noteOn(e.on[0], e.on[1], e.on[2])
      if (e.off !== undefined) s.noteOff(e.off)
      if (e.pitch) s.setPitch(e.pitch[0], e.pitch[1])
      if (e.mods) s.setMods(e.mods[0], e.mods[1])
      if (e.allOff) s.allOff()
    }
    if (onBlock) onBlock(s, pos / sr, b)
    bl.fill(0); br.fill(0)
    s.render(bl, br, BLOCK)
    L.set(bl, pos); R.set(br, pos)
  }
  return { L, R, sr, s }
}

function wav24(file, L, R, sr) {
  const n = L.length, data = Buffer.alloc(n * 6)
  for (let i = 0, o = 0; i < n; i++) {
    for (const x of [L[i], R[i]]) {
      let v = Math.round(Math.max(-1, Math.min(1, x)) * 8388607)
      if (v < 0) v += 16777216
      data[o++] = v & 255; data[o++] = (v >> 8) & 255; data[o++] = (v >> 16) & 255
    }
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22)
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 6, 28); h.writeUInt16LE(6, 32); h.writeUInt16LE(24, 34)
  h.write('data', 36); h.writeUInt32LE(data.length, 40)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.concat([h, data]))
}

// ── phrases ────────────────────────────────────────────────────────────────
/** The standard phrase (loudness, defaults) : a melody, a chord, a bass line. */
function standardPhrase(t0 = 0.05) {
  const ev = []
  let id = 1
  const mel = [60, 64, 67, 69, 67, 64, 62, 60]
  mel.forEach((n, i) => { const t = t0 + i * 0.25; ev.push({ t, on: [id, midi(n), 0.75] }, { t: t + 0.22, off: id }); id++ })
  const tc = t0 + 2.1
  for (const n of [48, 55, 64]) { ev.push({ t: tc, on: [id, midi(n), 0.7] }, { t: tc + 1.4, off: id }); id++ }
  const bass = [36, 36, 43, 41]
  bass.forEach((n, i) => { const t = tc + 1.9 + i * 0.3; ev.push({ t, on: [id, midi(n), 0.85] }, { t: t + 0.26, off: id }); id++ })
  return { events: ev, seconds: tc + 1.9 + 1.2 + 0.9 }
}
/** The musical phrase of the listening pack : melody, chord, then a slow sweep
 *  of each macro over a held note. */
function musicalPhrase(sweep = true) {
  const ev = []
  let id = 100
  const t0 = 0.1
  const mel = [57, 60, 64, 67, 69, 67, 64, 72, 71, 67]
  mel.forEach((n, i) => { const t = t0 + i * 0.22; ev.push({ t, on: [id, midi(n), 0.6 + 0.3 * ((i * 7) % 5) / 4] }, { t: t + 0.18, off: id }); id++ })
  const tc = t0 + 2.4
  for (const n of [45, 52, 60, 64, 67]) { ev.push({ t: tc, on: [id, midi(n), 0.7] }, { t: tc + 1.3, off: id }); id++ }
  let end = tc + 2.0
  const sweeps = []
  if (sweep) {
    const ts = end
    ev.push({ t: ts, on: [999, midi(48), 0.75] }, { t: ts + 4.8, off: 999 })
    for (const [k, i] of [['timbre', 0], ['harmonics', 1], ['morph', 2]]) sweeps.push({ k, t0: ts + i * 1.6, t1: ts + i * 1.6 + 1.6 })
    end = ts + 5.5
  }
  return { events: ev, seconds: end, sweeps }
}
/** Mods sweeping one macro around its setting on id 999 : up 0.6, down 0.6
 *  under it, back (the offset is 0 before and after its span). */
function sweepBlock(sweeps) {
  const m = {}
  return (s, t) => {
    for (const w of sweeps) {
      if (t < w.t0 - 0.05 || t > w.t1 + 0.05) continue
      const x = Math.min(1, Math.max(0, (t - w.t0) / (w.t1 - w.t0)))
      m.timbre = m.harmonics = m.morph = undefined
      m[w.k] = 0.6 * Math.sin(x * 2 * Math.PI)
      s.setMods(999, m)
    }
  }
}

// ── analysis ───────────────────────────────────────────────────────────────
function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t
      }
    }
  }
}
/** Power spectrum (Blackman-Harris 4-term) of x[start .. start+N). */
function powerSpec(x, start, N) {
  const re = new Float64Array(N), im = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const w = 0.35875 - 0.48829 * Math.cos((2 * Math.PI * i) / (N - 1)) + 0.14128 * Math.cos((4 * Math.PI * i) / (N - 1)) - 0.01168 * Math.cos((6 * Math.PI * i) / (N - 1))
    re[i] = (x[start + i] || 0) * w
  }
  fft(re, im)
  const P = new Float64Array(N / 2)
  for (let i = 0; i < N / 2; i++) P[i] = re[i] * re[i] + im[i] * im[i]
  return P
}
/** Alias-to-signal ratio : energy off the harmonic bins of f0, over the
 *  harmonic energy (dB), full band and under 10 kHz. */
function aliasRatio(x, sr, f0, { start, N = 65536, tol = 0.004, guard = 6 } = {}) {
  const P = powerSpec(x, start, N)
  const bin = sr / N, ny = sr / 2
  const isH = new Uint8Array(P.length)
  for (let h = 1; h * f0 < ny; h++) {
    const lo = Math.floor((h * f0 * (1 - tol)) / bin) - guard, hi = Math.ceil((h * f0 * (1 + tol)) / bin) + guard
    for (let k = Math.max(0, lo); k <= Math.min(P.length - 1, hi); k++) isH[k] = 1
  }
  const k0 = Math.floor((0.7 * f0) / bin), k10 = Math.floor(10000 / bin)
  let hp = 0, ip = 0, ip10 = 0
  for (let k = k0; k < P.length; k++) {
    if (isH[k]) hp += P[k]
    else { ip += P[k]; if (k < k10) ip10 += P[k] }
  }
  return { full: 10 * Math.log10((ip + 1e-30) / (hp + 1e-30)), below10k: 10 * Math.log10((ip10 + 1e-30) / (hp + 1e-30)) }
}
/** Fundamental frequency near f0 : the peak (Gaussian-interpolated) of the
 *  strongest of the first three harmonics, divided by its order. */
function pitchOf(x, sr, f0, start, N = 65536) {
  const P = powerSpec(x, start, N)
  const bin = sr / N
  let best = null
  for (const h of [1, 2, 3]) {
    const c = (h * f0) / bin
    const lo = Math.max(2, Math.floor(c * 0.97)), hi = Math.min(P.length - 3, Math.ceil(c * 1.03))
    let k = lo
    for (let i = lo; i <= hi; i++) if (P[i] > P[k]) k = i
    const a = Math.log(P[k - 1] + 1e-30), b = Math.log(P[k] + 1e-30), cc = Math.log(P[k + 1] + 1e-30)
    const d = (0.5 * (a - cc)) / (a - 2 * b + cc)
    const f = ((k + d) * bin) / h
    const pw = P[k] * (h === 1 ? 4 : 1)
    if (!best || pw > best.pw) best = { f, pw }
  }
  return best.f
}
const cents = (f, f0) => 1200 * Math.log2(f / f0)

// BS.1770 K-weighting, from its analog prototype at any rate (pre-filter
// shelf + RLB high-pass), then gated 400 ms blocks.
function kWeight(x, sr) {
  const shelf = (() => {
    const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196
    const K = Math.tan((Math.PI * f0) / sr), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416)
    const a0 = 1 + K / Q + K * K
    return [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0]
  })()
  const hp = (() => {
    const f0 = 38.13547087602444, Q = 0.5003270373238773, K = Math.tan((Math.PI * f0) / sr)
    const a0 = 1 + K / Q + K * K
    return [1 / a0, -2 / a0, 1 / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0]
  })()
  const run = (c, inp) => {
    const out = new Float64Array(inp.length)
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let i = 0; i < inp.length; i++) {
      const y = c[0] * inp[i] + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2
      x2 = x1; x1 = inp[i]; y2 = y1; y1 = y; out[i] = y
    }
    return out
  }
  return run(hp, run(shelf, x))
}
function lufs(L, R, sr) {
  const a = kWeight(L, sr), b = kWeight(R, sr)
  const blk = Math.round(0.4 * sr), hop = Math.round(0.1 * sr)
  const z = []
  for (let s = 0; s + blk <= a.length; s += hop) {
    let e = 0
    for (let i = s; i < s + blk; i++) e += a[i] * a[i] + b[i] * b[i]
    z.push(e / blk)
  }
  const ld = (e) => -0.691 + 10 * Math.log10(e + 1e-30)
  let g = z.filter((e) => ld(e) > -70)
  if (!g.length) return -99
  const rel = ld(g.reduce((p, e) => p + e, 0) / g.length) - 10
  g = g.filter((e) => ld(e) > rel)
  return ld(g.reduce((p, e) => p + e, 0) / g.length)
}
function rms(x, a = 0, b = x.length) { let e = 0; for (let i = a; i < b; i++) e += x[i] * x[i]; return Math.sqrt(e / Math.max(1, b - a)) }
function peak(x) { let p = 0; for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > p) p = v } return p }

/** A Butterworth high-pass (biquad cascade, 4th order) for the click meter. */
function hp4(x, sr, fc) {
  let y = Float64Array.from(x)
  for (const Q of [0.5411961, 1.3065630]) {
    const w = (2 * Math.PI * fc) / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * Q), a0 = 1 + al
    const b0 = (1 + cs) / 2 / a0, b1 = -(1 + cs) / a0, b2 = b0, a1 = (-2 * cs) / a0, a2 = (1 - al) / a0
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    const o = new Float64Array(y.length)
    for (let i = 0; i < y.length; i++) { const v = b0 * y[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = y[i]; y2 = y1; y1 = v; o[i] = v }
    y = o
  }
  return y
}
/**
 * Clicks : the energy above 5 kHz in 10 ms windows (longer than a period of the
 * test notes, so a waveform's own edges read as steady), hop 2.5 ms, against
 * its local median (±60 ms around, ±12 ms left out). A discontinuity sprays
 * energy up there that the sound around it does not have. Returns the worst
 * excess (dB) where the window is also above -95 dBFS, and where it happened.
 * exempt : [t0, t1] spans not judged (a struck engine's onset is the sound).
 */
function clickScore(L, R, sr, { fc = 5000, from = 0.02, exempt = [] } = {}) {
  const x = new Float64Array(L.length)
  for (let i = 0; i < L.length; i++) x[i] = 0.5 * (L[i] + R[i])
  const h = hp4(x, sr, fc)
  const w = Math.round(0.01 * sr), hop = Math.round(0.0025 * sr)
  const nw = Math.floor((h.length - w) / hop)
  const e = new Float64Array(nw)
  for (let k = 0; k < nw; k++) { let s = 0; for (let i = k * hop; i < k * hop + w; i++) s += h[i] * h[i]; e[k] = s / w }
  const span = Math.round(0.06 / 0.0025), ex = Math.round(0.012 / 0.0025)
  let worst = -99, at = 0, lev = -150
  const tmp = []
  for (let k = Math.ceil(from / 0.0025); k < nw - ex; k++) {
    const t = (k * hop) / sr
    if (exempt.some(([a, b]) => t + 0.01 > a && t < b)) continue
    // under -95 dBFS : inaudible whatever the ratio
    if (10 * Math.log10(e[k] + 1e-30) < -95) continue
    tmp.length = 0
    for (let j = k - span; j <= k + span; j++) if (j >= 0 && j < nw && Math.abs(j - k) > ex) tmp.push(e[j])
    tmp.sort((a, b) => a - b)
    const med = tmp[tmp.length >> 1] || 0
    const r = 10 * Math.log10((e[k] + 1e-14) / (med + 1e-14))
    if (r > worst) { worst = r; at = t; lev = 10 * Math.log10(e[k] + 1e-30) }
  }
  return { worst, at, lev }
}
/** The largest sample-to-sample jump, over its theoretical bound. */
function maxJump(L) { let m = 0; for (let i = 1; i < L.length; i++) { const d = Math.abs(L[i] - L[i - 1]); if (d > m) m = d } return m }

module.exports = { render, standardPhrase, musicalPhrase, lufs, aliasRatio, pitchOf, clickScore, wav24, midi, cfgOf, BASE, ENGINES }

// ── checks ─────────────────────────────────────────────────────────────────
/** Bright, strictly harmonic settings per engine (drift and chorus off). */
const BRIGHT = {
  dco: { timbre: 0.67, harmonics: 0, morph: 0 },
  ms: { timbre: 0.33, harmonics: 0, morph: 0 },
  swarm: { timbre: 0.67, harmonics: 0, morph: 0 },
  fm: { timbre: 0.85, harmonics: 1 / 15, morph: 0 },
  modal: { timbre: 0.6, harmonics: 0, morph: 0, sustain: 0 },
  voice: { timbre: 0.25, harmonics: 0.5, morph: 0 },
  fold: { timbre: 1, harmonics: 0.4, morph: 0 },
  pluck: { timbre: 1, harmonics: 0, morph: 0 },
}
const CLEAN = { drift: 0, chorus: 0, filter: 'ladder', cutoff: 1, reso: 0, drive: 0, hpf: 0, envAmt: 0, attack: 0.05, decay: 0.9, sustain: 1, release: 0.3 }

/** The riskiest harmonic settings : sync, a narrow pulse, a high FM ratio,
 *  the folder on a triangle, the full drive. */
const RISKY = {
  'dco sync': { engine: 'dco', timbre: 0.67, harmonics: 0, morph: 0.45 },
  'dco pulse': { engine: 'dco', timbre: 0, harmonics: 0, morph: 0 },
  'dco drive': { engine: 'dco', timbre: 0.67, harmonics: 0, morph: 0, drive: 1 },
  'ms pulse10': { engine: 'ms', timbre: 1, harmonics: 0, morph: 0 },
  'ms drive': { engine: 'ms', timbre: 0.67, harmonics: 0, morph: 1, _noNoise: true },
  'fm ratio3': { engine: 'fm', timbre: 1, harmonics: 5 / 15, morph: 0 },
  'fm bite': { engine: 'fm', timbre: 0.7, harmonics: 1 / 15, morph: 0.45 },
  'fm bite top': { engine: 'fm', timbre: 0.5, harmonics: 1 / 15, morph: 1, _noise: true },
  'fold tri': { engine: 'fold', timbre: 1, harmonics: 1, morph: 0 },
  'swarm sq': { engine: 'swarm', timbre: 1, harmonics: 0, morph: 0 },
}
function checkAliasing(sr, quick) {
  const out = {}
  const notes = []
  for (let m = 24; m <= 96; m += quick ? 6 : 2) notes.push(m)
  const N = 32768
  const cases = ENGINES.map((e) => [e, { engine: e, ...BRIGHT[e] }]).concat(Object.entries(RISKY))
  for (const [e, set] of cases) {
    const rows = []
    for (const m of notes) {
      const f0 = midi(m)
      const cfg = cfgOf({ ...CLEAN, ...set })
      OpsiaSynth.test.noNoise = !!set._noNoise
      const r = render({ sr, seconds: 0.3 + N / sr + 0.05, cfg, events: [{ t: 0, on: [1, f0, 0.9] }] })
      const wide = set.engine === 'pluck' || set.engine === 'modal'
      rows.push({ m, ...aliasRatio(r.L, sr, f0, { start: Math.round(0.25 * sr), N, tol: wide ? 0.02 : 0.004 }) })
    }
    OpsiaSynth.test.noNoise = false
    const worst = rows.reduce((a, b) => (b.full > a.full ? b : a))
    const worst10 = rows.reduce((a, b) => (b.below10k > a.below10k ? b : a))
    const top = rows[rows.length - 1]
    out[e] = { worst: worst.full, worstNote: worst.m, worst10: worst10.below10k, worst10Note: worst10.m, c7: top.full, c7b10: top.below10k, rows, noise: !!set._noise }
  }
  // references : an additive saw (the floor) and a naive saw
  const refs = {}
  for (const kind of ['additive', 'naive']) {
    const f0 = midi(96), n = Math.round(0.3 * sr) + N + 100
    const x = new Float32Array(n)
    let ph = 0
    for (let i = 0; i < n; i++) {
      if (kind === 'naive') x[i] = 0.3 * (2 * ph - 1)
      else { let y = 0; for (let h = 1; h * f0 < sr / 2; h++) y += Math.sin(2 * Math.PI * h * ph) / h; x[i] = 0.2 * y }
      ph += f0 / sr; ph -= Math.floor(ph)
    }
    refs[kind] = aliasRatio(x, sr, f0, { start: Math.round(0.25 * sr), N })
  }
  return { out, refs }
}

function darkCfg(e, o = {}) {
  // the swarm plays its drone : its pulses are notes of their own (the macro
  // sweep still runs morph through them)
  return cfgOf({ engine: e, ...(e === 'swarm' ? { morph: 0 } : {}), drift: 0.2, chorus: 0, filter: 'ladder', cutoff: 0.36, reso: 0.1, drive: 0, hpf: 0, envAmt: 0, attack: 0.18, decay: 0.6, sustain: 0.8, release: 0.3, ...o })
}
/** Click scenarios, each a render; the score is the worst HF excess (dB). */
function clickScenarios(e, sr) {
  const S = []
  // 1 · note on / off, overlapping chords
  {
    const ev = []
    let id = 1
    for (let k = 0; k < 10; k++) { const t = 0.1 + k * 0.18; ev.push({ t, on: [id, midi(50 + ((k * 5) % 19)), 0.8] }, { t: t + 0.33, off: id }); id++ }
    S.push({ name: 'on/off', r: render({ sr, seconds: 2.4, cfg: darkCfg(e), events: ev }), ev })
  }
  // 2 · steals : 20 notes, 8 voices
  {
    const ev = []
    for (let k = 0; k < 20; k++) ev.push({ t: 0.1 + k * 0.06, on: [k + 1, midi(45 + ((k * 7) % 24)), 0.8] })
    ev.push({ t: 1.6, allOff: true })
    S.push({ name: 'steals', r: render({ sr, seconds: 2.4, cfg: darkCfg(e, { release: 0.5 }), events: ev }), ev })
  }
  // 3 · engine switches mid-note (to every other engine and back)
  {
    const ev = [{ t: 0.05, on: [1, midi(48), 0.8] }, { t: 0.05, on: [2, midi(55), 0.8] }, { t: 0.05, on: [3, midi(64), 0.8] }]
    let t = 0.4
    for (const o of ENGINES) if (o !== e) { ev.push({ t, cfg: { engine: o } }, { t: t + 0.2, cfg: { engine: e } }); t += 0.4 }
    S.push({ name: 'engine switch', r: render({ sr, seconds: t + 0.3, cfg: darkCfg(e), events: ev }), ev })
  }
  // 4 · filter switches mid-note
  {
    const ev = [{ t: 0.05, on: [1, midi(48), 0.8] }, { t: 0.05, on: [2, midi(60), 0.8] }]
    let t = 0.4
    for (const f of ['ms', 'morph', 'ladder', 'morph', 'ms', 'ladder']) { ev.push({ t, cfg: { filter: f } }); t += 0.25 }
    S.push({ name: 'filter switch', r: render({ sr, seconds: t + 0.2, cfg: darkCfg(e, { cutoff: 0.45 }), events: ev }), ev })
  }
  // 5 · macro sweeps at full speed (config, every block) and mods jumping ±1
  {
    const ev = [{ t: 0.05, on: [1, midi(52), 0.8] }, { t: 0.05, on: [2, midi(59), 0.8] }]
    const r = render({
      sr, seconds: 3.2, cfg: darkCfg(e), events: ev,
      onBlock: (s, t) => {
        if (t > 0.3 && t < 1.5) { const x = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 2.5); s.setConfig({ timbre: x, harmonics: 1 - x, morph: x }) }
        if (t >= 1.6 && t < 3.0) { const j = Math.floor(t * 30) % 2 ? 1 : -1; s.setMods(1, { timbre: j, harmonics: -j, morph: j, cutoff: j * 0.3, drive: j > 0 ? 0.5 : 0 }); s.setMods(2, { timbre: -j, pan: j, bend: j * 0.5 }) }
      },
    })
    S.push({ name: 'macro sweeps', r, ev })
  }
  // 6 · filter sweeps : cutoff and resonance at full speed, every filter
  for (const f of FILTERS) {
    const ev = [{ t: 0.05, on: [1, midi(45), 0.8] }]
    const r = render({
      sr, seconds: 2.2, cfg: darkCfg(e, { filter: f }), events: ev,
      onBlock: (s, t) => { if (t > 0.2) { const x = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 3); s.setConfig({ cutoff: 0.15 + 0.4 * x, reso: 0.9 * (1 - x), fmode: x, hpf: 0.3 * x }) } },
    })
    S.push({ name: 'filter sweep ' + f, r, ev })
  }
  // 7 · re-strikes, pitch jumps, voice modes, chorus, glide
  {
    const ev = [{ t: 0.05, on: [1, midi(50), 0.8] }]
    for (let k = 0; k < 8; k++) ev.push({ t: 0.3 + k * 0.12, on: [1, midi(50 + (k % 4) * 3), 0.7] })
    ev.push({ t: 1.4, pitch: [1, midi(57)] }, { t: 1.5, pitch: [1, midi(45)] })
    ev.push({ t: 1.7, cfg: { chorus: 2 } }, { t: 1.9, cfg: { chorus: 0 } }, { t: 2.0, cfg: { voices: 'unison' } })
    ev.push({ t: 2.1, on: [5, midi(52), 0.8] }, { t: 2.3, on: [6, midi(55), 0.8] }, { t: 2.5, off: 6 }, { t: 2.7, off: 5 })
    ev.push({ t: 2.9, cfg: { voices: 'mono', glide: 0.4 } }, { t: 3.0, on: [7, midi(48), 0.8] }, { t: 3.2, on: [8, midi(60), 0.8] }, { t: 3.5, off: 8 }, { t: 3.8, off: 7 })
    S.push({ name: 'restrike/modes', r: render({ sr, seconds: 4.4, cfg: darkCfg(e), events: ev }), ev })
  }
  // a struck engine's onset (a note, or a switch that strikes it) is the sound
  const struck = (en) => en === 'modal' || en === 'pluck'
  return S.map((x) => {
    const exempt = []
    let cur = e
    for (const q of (x.ev || []).slice().sort((p, q) => p.t - q.t)) {
      // (an event lands at the start of the block holding it : up to 128 samples early)
      if (q.cfg && q.cfg.engine) { cur = q.cfg.engine; if (struck(cur)) exempt.push([q.t - BLOCK / sr, q.t + 0.04]) }
      if (q.on && struck(cur)) exempt.push([q.t - BLOCK / sr, q.t + 0.04])
    }
    return { name: x.name, ...clickScore(x.r.L, x.r.R, sr, { exempt }) }
  })
}
/** On the cleanest canvas (a pure sine, the filter open) the voice paths must
 *  never jump : the largest sample-to-sample step, against the band-limited
 *  bound of the notes playing (2π f A / sr summed). */
function jumpCheck(sr) {
  // a 4 ms attack : the 1 ms one (attack 0) is the fastest onset by design and
  // its own slope would be counted
  const cfg = cfgOf({ engine: 'fm', timbre: 0, harmonics: 1 / 15, morph: 0, drift: 0, chorus: 0, cutoff: 1, reso: 0, drive: 0, hpf: 0, envAmt: 0, attack: 0.16, decay: 0.8, sustain: 1, release: 0, level: 0.35 })
  const ev = []
  const f = midi(69)
  for (let k = 0; k < 24; k++) ev.push({ t: 0.05 + k * 0.05, on: [k + 1, f, 1] })
  ev.push({ t: 1.4, allOff: true })
  const r = render({ sr, seconds: 1.8, cfg, events: ev })
  const bound = (2 * Math.PI * f * peak(r.L)) / sr
  return { jump: maxJump(r.L), bound }
}

/** The meter's own proof : a small step injected into a dark render. */
function clickControl(sr) {
  const r = render({ sr, seconds: 1.2, cfg: darkCfg('dco'), events: [{ t: 0.05, on: [1, midi(48), 0.8] }] })
  const L0 = Float32Array.from(r.L), R0 = Float32Array.from(r.R)
  const at = Math.round(0.8 * sr)
  for (let i = at; i < L0.length; i++) { L0[i] += 0.003; R0[i] += 0.003 }
  return { clean: clickScore(r.L, r.R, sr).worst, step: clickScore(L0, R0, sr).worst }
}
function checkClicks(sr, quick) {
  const out = {}
  for (const e of ENGINES) {
    const sc = clickScenarios(e, sr)
    // a click : more than 12 dB over its surroundings AND louder than -85 dBFS
    // above 5 kHz (a 0.003 step, -50 dBFS, reads about -82 there)
    for (const x of sc) x.click = x.worst > 12 && x.lev > -85
    const key = (x) => (x.click ? 1e3 : 0) + x.worst
    const w = sc.reduce((a, b) => (key(b) > key(a) ? b : a))
    out[e] = { worst: w.worst, lev: w.lev, click: sc.some((x) => x.click), where: w.name + ' @' + w.at.toFixed(3), all: sc }
  }
  return out
}

function checkDC(sr) {
  const out = {}
  for (const e of ENGINES) {
    const ph = standardPhrase()
    const r = render({ sr, seconds: ph.seconds, cfg: cfgOf({ engine: e, harmonics: 0.7, morph: 0.6, drive: 0.6 }), events: ph.events })
    let m = 0
    for (let i = 0; i < r.L.length; i++) m += r.L[i] + r.R[i]
    m /= 2 * r.L.length
    // and a held note's mean (fold with bias, fm with bite : the worst cases)
    const h = render({ sr, seconds: 2, cfg: cfgOf({ engine: e, harmonics: 0.55, morph: 0.8, drive: 0.8, sustain: 1 }), events: [{ t: 0, on: [1, midi(40), 0.9] }] })
    let mh = 0
    const a = Math.round(0.8 * sr)
    for (let i = a; i < h.L.length; i++) mh += h.L[i]
    mh /= h.L.length - a
    out[e] = { phrase: db(Math.abs(m)), held: db(Math.abs(mh)) }
  }
  return out
}

function rndCfg(rand, e) {
  const c = { engine: e }
  for (const k of ['timbre', 'harmonics', 'morph', 'cutoff', 'reso', 'drive', 'hpf', 'fmode', 'attack', 'decay', 'sustain', 'release', 'glide', 'drift', 'level']) c[k] = rand()
  const pick = rand()
  if (pick < 0.15) for (const k of Object.keys(c)) if (k !== 'engine') c[k] = 0
  else if (pick < 0.3) for (const k of Object.keys(c)) if (k !== 'engine') c[k] = 1
  c.envAmt = rand() * 2 - 1
  c.filter = FILTERS[(rand() * 3) | 0]
  c.voices = ['poly', 'unison', 'mono'][(rand() * 3) | 0]
  c.chorus = (rand() * 3) | 0
  if (rand() < 0.4) c.reso = 1
  return c
}
function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
/** Stability : every param at 0 / 1 / random, reso at max, a long run of
 *  random notes and mods; NaN / Inf, the peak bound, float32 subnormals. */
function checkStability(sr, minutes) {
  const out = {}
  for (const e of ENGINES) {
    const rand = mulberry(1234 + ENGINES.indexOf(e) * 77 + sr)
    const s = new OpsiaSynth(sr)
    s.setConfig(rndCfg(rand, e))
    const n = Math.round(minutes * 60 * sr)
    const bl = new Float32Array(BLOCK), br = new Float32Array(BLOCK)
    let bad = 0, sub = 0, pk = 0, id = 1, nextCfg = 0, nextNote = 0
    const held = []
    for (let pos = 0, b = 0; pos < n; pos += BLOCK, b++) {
      const t = pos / sr
      if (t >= nextCfg) { s.setConfig(rndCfg(rand, e)); nextCfg = t + 0.2 + rand() * 1.5 }
      if (t >= nextNote) {
        nextNote = t + rand() * 0.25
        if (rand() < 0.6 || held.length === 0) { const k = id++; held.push(k); s.noteOn(k, midi(18 + rand() * 96), rand()) }
        if (held.length > 10 || rand() < 0.35) s.noteOff(held.splice((rand() * held.length) | 0, 1)[0])
        if (rand() < 0.01) { s.allOff(); held.length = 0 }
      }
      if (b % 12 === 0) for (const k of held) {
        const m = {}
        for (const q of ['timbre', 'harmonics', 'morph', 'cutoff', 'reso', 'drive', 'env', 'pan', 'bend']) m[q] = rand() * 2 - 1
        m.vel = rand()
        s.setMods(k, m)
        if (rand() < 0.05) s.setPitch(k, midi(18 + rand() * 96))
      }
      bl.fill(0); br.fill(0)
      s.render(bl, br, BLOCK)
      for (let i = 0; i < BLOCK; i++) {
        const a = bl[i], c = br[i]
        if (!Number.isFinite(a) || !Number.isFinite(c)) bad++
        const m = Math.max(Math.abs(a), Math.abs(c))
        if (m > pk) pk = m
        if ((a !== 0 && Math.abs(a) < 1.1754944e-38) || (c !== 0 && Math.abs(c) < 1.1754944e-38)) sub++
      }
    }
    // the float32 delay lines : subnormals
    for (const v of s.v) for (const x of v.ks.buf) if (x !== 0 && Math.abs(x) < 1.1754944e-38) sub++
    out[e] = { nanInf: bad, peak: pk, subnormals: sub, resets: s.diag.resets }
  }
  return out
}

/** Loudness of the standard phrase per engine (defaults), LUFS. */
function engineLoudness(sr) {
  const out = {}
  const ph = standardPhrase()
  for (const e of ENGINES) {
    const r = render({ sr, seconds: ph.seconds, cfg: cfgOf({ engine: e, drift: 0.3, chorus: 0 }), events: ph.events })
    out[e] = lufs(r.L, r.R, sr)
  }
  return out
}
/** Loudness across each macro (0, 0.5, 1) : how far the level moves. */
function macroLoudness(sr) {
  const out = {}
  const ph = standardPhrase()
  for (const e of ENGINES) {
    const v = []
    for (const k of ['timbre', 'harmonics', 'morph']) for (const x of [0, 0.5, 1]) {
      const r = render({ sr, seconds: ph.seconds, cfg: cfgOf({ engine: e, chorus: 0, [k]: x }), events: ph.events })
      v.push({ k, x, l: lufs(r.L, r.R, sr) })
    }
    const ls = v.map((q) => q.l)
    out[e] = { span: Math.max(...ls) - Math.min(...ls), v }
  }
  return out
}

/** CPU : 8 voices held across two octaves, each engine at its heaviest,
 *  chorus II, drive on; ms per 128-frame block and % of real time. */
const HEAVY = {
  dco: { timbre: 0.85, harmonics: 0.39, morph: 0.78 },
  ms: { timbre: 0.9, harmonics: 0.75, morph: 0.8 },
  swarm: { timbre: 0.5, harmonics: 1, morph: 0.8 },
  fm: { timbre: 0.9, harmonics: 0.5, morph: 0.9 },
  modal: { timbre: 1, harmonics: 0.3, morph: 0.1 },
  voice: { timbre: 0.6, harmonics: 0.5, morph: 0.5 },
  fold: { timbre: 1, harmonics: 0.8, morph: 0.5 },
  pluck: { timbre: 0.8, harmonics: 0.7, morph: 0.2 },
}
function checkCPU(sr, seconds = 6) {
  const out = {}
  for (const e of ENGINES) {
    for (const mode of ['poly', 'unison']) {
      const s = new OpsiaSynth(sr)
      s.setConfig(cfgOf({ engine: e, ...HEAVY[e], voices: mode, chorus: 2, drive: 0.6, sustain: 1, filter: 'ladder', reso: 0.5, drift: 0.5 }))
      if (mode === 'poly') for (let k = 0; k < 8; k++) s.noteOn(k + 1, midi(43 + k * 3), 0.8)
      else s.noteOn(1, midi(48), 0.8)
      const bl = new Float32Array(BLOCK), br = new Float32Array(BLOCK)
      const nb = Math.round((seconds * sr) / BLOCK)
      for (let b = 0; b < 200; b++) s.render(bl, br, BLOCK)
      const t0 = process.hrtime.bigint()
      for (let b = 0; b < nb; b++) {
        if (b % 12 === 0) for (let k = 1; k <= 8; k++) s.setMods(k, { timbre: Math.sin(b * 0.01 + k) * 0.2, cutoff: Math.sin(b * 0.013) * 0.2 })
        s.render(bl, br, BLOCK)
      }
      const ms = Number(process.hrtime.bigint() - t0) / 1e6 / nb
      const rt = (100 * ms) / ((BLOCK / sr) * 1000)
      out[e + ' ' + mode] = { msPerBlock: ms, pctRT: rt, voices: s.activeVoices() }
    }
  }
  return out
}

/** Tuning : drift and chorus off, A1 .. A6 (and C8 where it sounds). */
function checkTuning(sr) {
  const out = {}
  const notes = [33, 45, 57, 69, 81, 93]
  for (const e of ENGINES) {
    const set = { ...BRIGHT[e], timbre: e === 'modal' || e === 'pluck' ? 0.5 : e === 'fold' ? 0.3 : 0.4 }
    if (e === 'voice') set.timbre = 0
    const rows = []
    for (const m of notes) {
      const f0 = midi(m)
      const N = 65536
      const cfg = cfgOf({ ...CLEAN, engine: e, ...set, morph: 0 })
      const r = render({ sr, seconds: 0.15 + N / sr + 0.05, cfg, events: [{ t: 0, on: [1, f0, 0.8] }] })
      const f = pitchOf(r.L, sr, f0, Math.round(0.1 * sr), N)
      rows.push({ m, c: cents(f, f0) })
    }
    const a4 = rows.find((q) => q.m === 69).c
    out[e] = { a4, worst: rows.reduce((a, b) => (Math.abs(b.c) > Math.abs(a.c) ? b : a)), rows }
  }
  return out
}

// ── the contract with the play side ────────────────────────────────────────
/** Level (dBFS RMS) of a mono mix over [t0, t1). */
function levelAt(r, t0, t1) {
  const a = Math.round(t0 * r.sr), b = Math.round(t1 * r.sr)
  let e = 0
  for (let i = a; i < b; i++) { const x = 0.5 * (r.L[i] + r.R[i]); e += x * x }
  return 10 * Math.log10(e / Math.max(1, b - a) + 1e-30)
}
/** Time for a note's level to first reach 90 % of its peak (ms). */
function riseMs(r, t0, span) {
  const a = Math.round(t0 * r.sr), b = Math.round((t0 + span) * r.sr), w = Math.round(0.002 * r.sr)
  const env = []
  for (let i = a; i + w < b; i += w) { let e = 0; for (let j = i; j < i + w; j++) e += r.L[j] * r.L[j]; env.push(Math.sqrt(e / w)) }
  const pk = Math.max(...env)
  return env.findIndex((x) => x >= 0.9 * pk) * 2
}
function checkContract(sr) {
  const rows = []
  const ok = (name, pass, detail) => rows.push({ name, pass, detail })
  const base = { engine: 'dco', timbre: 0.67, harmonics: 0, morph: 0, chorus: 0, drift: 0, cutoff: 0.7, reso: 0, envAmt: 0, drive: 0 }
  // 1 · mods sent BEFORE a noteOn shape its first strike (env : the attack)
  {
    const cfg = cfgOf({ ...base, attack: 0.45, decay: 0.7, sustain: 1, release: 0.3 })
    const slow = render({ sr, seconds: 1.2, cfg, events: [{ t: 0.05, mods: [7, { env: 1 }] }, { t: 0.05, on: [7, midi(57), 0.8] }] })
    const fast = render({ sr, seconds: 1.2, cfg, events: [{ t: 0.05, mods: [7, { env: -1 }] }, { t: 0.05, on: [7, midi(57), 0.8] }] })
    const none = render({ sr, seconds: 1.2, cfg, events: [{ t: 0.05, on: [7, midi(57), 0.8] }] })
    const s = riseMs(slow, 0.05, 1.1), f = riseMs(fast, 0.05, 1.1), n0 = riseMs(none, 0.05, 1.1)
    ok('mods before noteOn : env shapes the first strike', s > 4 * n0 && f < n0 / 2, `attack to 90 % : env +1 ${s} ms, none ${n0} ms, env -1 ${f} ms`)
  }
  // 1b · pan sent before the noteOn is there from the first sample
  {
    const r = render({ sr, seconds: 0.4, cfg: cfgOf({ ...base, attack: 0 }), events: [{ t: 0.05, mods: [3, { pan: -1 }] }, { t: 0.05, on: [3, midi(57), 0.8] }] })
    const a = Math.round(0.06 * sr), b = Math.round(0.3 * sr)
    let l = 0, rr = 0
    for (let i = a; i < b; i++) { l += r.L[i] * r.L[i]; rr += r.R[i] * r.R[i] }
    ok('mods before noteOn : pan from the first strike', rr < l * 1e-4, `right / left over the note : ${(10 * Math.log10(rr / l + 1e-30)).toFixed(0)} dB`)
  }
  // 1c · a voice reused for a new id does not keep the old id's mods
  {
    const ev = [{ t: 0.02, on: [1, midi(57), 0.8] }, { t: 0.03, mods: [1, { pan: -1 }] }, { t: 0.2, off: 1 }, { t: 0.6, on: [2, midi(57), 0.8] }]
    const r = render({ sr, seconds: 1.0, cfg: cfgOf({ ...base, attack: 0, release: 0.2, voices: 'mono' }), events: ev })
    const a = Math.round(0.7 * sr), b = Math.round(0.95 * sr)
    let l = 0, rr = 0
    for (let i = a; i < b; i++) { l += r.L[i] * r.L[i]; rr += r.R[i] * r.R[i] }
    ok('a new id starts from its own mods (none : centered)', Math.abs(10 * Math.log10(rr / l)) < 0.5, `right / left of the second id : ${(10 * Math.log10(rr / l)).toFixed(2)} dB`)
  }
  // 2 · mono / unison : the handover (new noteOn, then the old noteOff, no
  // render between) strikes; an overlap stays legato; a stale noteOff never
  // releases the sounding note
  for (const mode of ['mono', 'unison']) {
    const cfg = cfgOf({ ...base, voices: mode, attack: 0.05, decay: 0.4, sustain: 0.15, release: 0.3 })
    const hand = render({ sr, seconds: 1.4, cfg, events: [{ t: 0.05, on: [1, midi(57), 0.8] }, { t: 0.6, on: [2, midi(60), 0.8] }, { t: 0.6, off: 1 }, { t: 1.2, off: 2 }] })
    const over = render({ sr, seconds: 1.4, cfg, events: [{ t: 0.05, on: [1, midi(57), 0.8] }, { t: 0.6, on: [2, midi(60), 0.8] }, { t: 1.2, off: 2 }, { t: 1.2, off: 1 }] })
    const late = render({ sr, seconds: 1.4, cfg, events: [{ t: 0.05, on: [1, midi(57), 0.8] }, { t: 0.6, on: [2, midi(60), 0.8] }, { t: 0.7, off: 1 }, { t: 1.2, off: 2 }] })
    // the control : the same pitch move with no second note (the unison's
    // beating, the same voices' phases, cancel out of the comparison)
    const move = render({ sr, seconds: 1.4, cfg, events: [{ t: 0.05, on: [1, midi(57), 0.8] }, { t: 0.6, pitch: [1, midi(60)] }, { t: 1.2, off: 1 }] })
    // (sustain 0.15 : a new attack peaks ~16 dB over it; windows long enough
    // to average the unison's beating)
    // an attack is a bump : the first 35 ms after the change over the level
    // the new note then holds (the pitch's own level change cancels out)
    const bump = (r) => levelAt(r, 0.605, 0.64) - levelAt(r, 0.8, 1.15)
    ok(`${mode} : a handover strikes`, bump(hand) > 6, `the new note's first 35 ms over its held level : ${fmt(bump(hand))} dB`)
    ok(`${mode} : an overlap stays legato`, bump(over) - bump(move) < 2, `the same after an overlapping note, over a plain pitch move : ${fmt(bump(over) - bump(move))} dB`)
    const l1 = levelAt(late, 0.66, 0.69), l2 = levelAt(late, 0.75, 1.15)
    ok(`${mode} : a noteOff for an id no longer sounding never releases`, l2 > l1 - 3 && l2 > -60, `the sounding note after the old id's noteOff : ${fmt(l2 - l1)} dB`)
  }
  return rows
}

// ── main ───────────────────────────────────────────────────────────────────
function argOf(name, def) {
  const i = process.argv.indexOf('--' + name)
  return i > 0 ? process.argv[i + 1] : def
}
function fmt(x, d = 1) { return (x >= 0 ? ' ' : '') + x.toFixed(d) }

function runChecks() {
  const sr = Number(argOf('sr', 48000))
  const quick = process.argv.includes('--quick')
  const only = (argOf('only', '') || '').split(',').filter(Boolean)
  const want = (k) => !only.length || only.includes(k)
  const res = { sr }
  let fail = false
  const T0 = Date.now()
  if (want('tuning')) {
    res.tuning = checkTuning(sr)
    console.log(`\n# tuning @ ${sr} (cents; A1 A2 A3 A4 A5 A6)`)
    for (const e of ENGINES) {
      const t = res.tuning[e]
      const ok = t.rows.every((q) => Math.abs(q.c) <= 3)
      if (!ok) fail = true
      console.log(`${e.padEnd(7)} ${t.rows.map((q) => fmt(q.c, 2)).join(' ')}  ${ok ? 'ok' : 'FAIL'}`)
    }
  }
  if (want('aliasing')) {
    const a = checkAliasing(sr, quick)
    res.aliasing = a
    console.log(`\n# aliasing @ ${sr} (dB, energy off the harmonics / on them; C1..C7 every ${quick ? 6 : 2} st)`)
    console.log(`reference at C7 : additive saw ${fmt(a.refs.additive.full)} · naive saw ${fmt(a.refs.naive.full)} (below 10 kHz ${fmt(a.refs.naive.below10k)})`)
    for (const e of Object.keys(a.out)) {
      const q = a.out[e]
      const isDrive = / drive$/.test(e)
      const ok = q.worst10 < (isDrive ? -45 : -50) || q.noise
      const warn = isDrive && q.worst10 > -50
      if (!ok) fail = true
      console.log(`${e.padEnd(10)} worst ${fmt(q.worst)} (midi ${q.worstNote}) · worst <10k ${fmt(q.worst10)} (midi ${q.worst10Note}) · C7 ${fmt(q.c7)} / <10k ${fmt(q.c7b10)}  ${q.noise ? 'noise by design (not pitch-bound : chaos, not aliasing)' : !ok ? 'FAIL' : warn ? 'WARN (full drive, top octaves)' : 'ok'}`)
    }
  }
  if (want('clicks')) {
    const c = checkClicks(sr, quick)
    res.clicks = c
    const j = jumpCheck(sr)
    res.jump = j
    console.log(`\n# clicks @ ${sr} (the worst HF burst over its surroundings, dB, at its level above 5 kHz; a click = over 12 dB AND over -85 dBFS)`)
    for (const e of ENGINES) {
      const q = c[e]
      const ok = !q.click
      if (!ok) fail = true
      console.log(`${e.padEnd(7)} ${fmt(q.worst)} dB at ${q.lev.toFixed(0)} dBFS (${q.where})  ${ok ? 'ok' : 'FAIL'}   ` + q.all.map((x) => `${x.name}:${x.worst.toFixed(0)}@${x.lev.toFixed(0)}`).join(' '))
    }
    const cc = clickControl(sr)
    res.clickControl = cc
    console.log(`meter control : the same dark note scores ${fmt(cc.clean)} clean, ${fmt(cc.step)} with a 0.003 step injected (-50 dBFS)  ${cc.step >= 12 ? 'ok' : 'FAIL'}`)
    if (cc.step < 12) fail = true
    const okj = j.jump <= j.bound * 1.5
    if (!okj) fail = true
    console.log(`sine canvas, 24 notes on 8 voices : max step ${j.jump.toExponential(2)} vs band-limited bound ${j.bound.toExponential(2)}  ${okj ? 'ok' : 'FAIL'}`)
  }
  if (want('contract')) {
    res.contract = checkContract(sr)
    console.log(`
# the contract with the play side @ ${sr}`)
    for (const q of res.contract) { if (!q.pass) fail = true; console.log(`${q.pass ? 'ok  ' : 'FAIL'} ${q.name} : ${q.detail}`) }
  }
  if (want('dc')) {
    res.dc = checkDC(sr)
    console.log(`\n# DC @ ${sr} (dBFS : phrase mean, held-note mean)`)
    for (const e of ENGINES) { const q = res.dc[e]; const ok = q.phrase < -60 && q.held < -60; if (!ok) fail = true; console.log(`${e.padEnd(7)} ${fmt(q.phrase)} ${fmt(q.held)}  ${ok ? 'ok' : 'FAIL'}`) }
  }
  if (want('loudness')) {
    res.loud = engineLoudness(sr)
    const ls = ENGINES.map((e) => res.loud[e])
    const mid = (Math.max(...ls) + Math.min(...ls)) / 2
    console.log(`\n# loudness @ ${sr} (LUFS, the standard phrase, defaults)`)
    for (const e of ENGINES) { const ok = Math.abs(res.loud[e] - mid) <= 1.5; if (!ok) fail = true; console.log(`${e.padEnd(7)} ${fmt(res.loud[e])}  ${ok ? 'ok' : 'FAIL'}`) }
    if (!quick) {
      res.macroLoud = macroLoudness(sr)
      console.log(`  level spread across each engine's macros (0 / .5 / 1 of each) :`)
      for (const e of ENGINES) console.log(`  ${e.padEnd(7)} ${res.macroLoud[e].span.toFixed(1)} dB   ` + res.macroLoud[e].v.map((q) => `${q.k[0]}${q.x}:${q.l.toFixed(1)}`).join(' '))
    }
  }
  if (want('cpu')) {
    if (only.length !== 1) {
      // timed in a fresh process : the other checks' big buffers leave the heap
      // busy and the numbers noisy
      const o = execFileSync(process.execPath, [__filename, 'check', '--only', 'cpu', '--sr', String(sr), ...(quick ? ['--quick'] : [])], { encoding: 'utf8' })
      process.stdout.write(o.replace(/\n(all checks pass|FAIL)[^\n]*\n?$/, '\n'))
      res.cpu = 'see the child run'
    } else {
    res.cpu = checkCPU(sr, quick ? 2 : 6)
    console.log(`\n# CPU @ ${sr} (ms per 128-frame block, % of one core in real time; 8 voices, chorus II, drive)`)
    for (const [k, q] of Object.entries(res.cpu)) console.log(`${k.padEnd(14)} ${q.msPerBlock.toFixed(3)} ms  ${q.pctRT.toFixed(1)} %  (${q.voices} voices)`)
    }
  }
  if (want('stability')) {
    const minutes = Number(argOf('minutes', quick ? 0.5 : 10))
    res.stab = checkStability(sr, minutes)
    console.log(`\n# stability @ ${sr} (${minutes} min of random configs, notes and mods per engine)`)
    for (const e of ENGINES) { const q = res.stab[e]; const ok = q.nanInf === 0 && q.peak <= 1 && q.subnormals === 0 && q.resets === 0; if (!ok) fail = true; console.log(`${e.padEnd(7)} NaN/Inf ${q.nanInf} · peak ${q.peak.toFixed(3)} · subnormals ${q.subnormals} · filter resets ${q.resets}  ${ok ? 'ok' : 'FAIL'}`) }
  }
  const outFile = argOf('json', '')
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(res, null, 1))
  console.log(`\n${fail ? 'FAIL' : 'all checks pass'} (${((Date.now() - T0) / 1000).toFixed(0)} s)`)
  process.exitCode = fail ? 1 : 0
}

// ── patches (read from synthPatches.ts) ────────────────────────────────────
function loadPatches() {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer/src/audio/synthPatches.ts'), 'utf8')
  const i = src.indexOf('SYNTH_PATCHES: SynthPatch[] = ')
  if (i < 0) return []
  const body = src.slice(i + 'SYNTH_PATCHES: SynthPatch[] = '.length)
  const end = body.lastIndexOf(']')
  return Function('"use strict"; return (' + body.slice(0, end + 1) + ')')()
}

function calibrate() {
  const sr = 48000
  const loud = engineLoudness(sr)
  const ls = ENGINES.map((e) => loud[e])
  const target = Number(argOf('target', -20))
  console.log('engine loudness (LUFS) and the trim that lands on', target)
  for (const e of ENGINES) console.log(`${e.padEnd(7)} ${loud[e].toFixed(2)}  x${Math.pow(10, (target - loud[e]) / 20).toFixed(3)}`)
  const ph = standardPhrase()
  const P = loadPatches()
  if (P.length) console.log('\npatch loudness, its level now, and the level for', target)
  for (const p of P) {
    const r = render({ sr, seconds: ph.seconds, cfg: { ...p.sound }, events: ph.events })
    const l = lufs(r.L, r.R, sr)
    const lv = Math.min(1, p.sound.level * Math.pow(10, (target - l) / 20))
    console.log(`${p.name.padEnd(18)} ${l.toFixed(2)}  level ${p.sound.level.toFixed(3)} -> ${lv.toFixed(3)}`)
  }
}

// ── the listening pack ─────────────────────────────────────────────────────
function ffmpegPath() { try { return require(path.join(ROOT, 'node_modules/ffmpeg-static')) } catch { return null } }
const ENGINE_DEFAULT = {
  dco: { timbre: 0.62, harmonics: 0.3, morph: 0.05, cutoff: 0.62, reso: 0.25, envAmt: 0.35, chorus: 1 },
  ms: { timbre: 0.4, harmonics: 0.35, morph: 0.3, filter: 'ms', cutoff: 0.6, reso: 0.45, envAmt: 0.35, chorus: 0 },
  swarm: { timbre: 0.4, harmonics: 0.55, morph: 0.45, cutoff: 0.72, reso: 0.15, envAmt: 0.15, chorus: 1 },
  fm: { timbre: 0.5, harmonics: 0.2, morph: 0.25, cutoff: 0.85, reso: 0.1, envAmt: 0.1, attack: 0.02, decay: 0.55, sustain: 0.5, chorus: 1 },
  modal: { timbre: 0.55, harmonics: 0.5, morph: 0.3, cutoff: 0.9, reso: 0.05, envAmt: 0, attack: 0, decay: 0.85, sustain: 0.3, release: 0.6, chorus: 0 },
  voice: { timbre: 0.3, harmonics: 0.45, morph: 0.15, cutoff: 0.85, reso: 0.05, envAmt: 0.05, attack: 0.25, chorus: 1 },
  fold: { timbre: 0.5, harmonics: 0.4, morph: 0.6, cutoff: 0.85, reso: 0.1, envAmt: 0.1, attack: 0, decay: 0.6, sustain: 0.6, chorus: 0 },
  pluck: { timbre: 0.6, harmonics: 0.15, morph: 0.3, cutoff: 0.9, reso: 0.05, envAmt: 0, attack: 0, decay: 0.8, sustain: 0.8, release: 0.45, chorus: 1 },
}
function encodeMp3(ff, wav) { try { execFileSync(ff, ['-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-q:a', '0', wav.replace(/\.wav$/, '.mp3')]) } catch (e) { console.warn('mp3 failed', e.message) } }
function spectrogram(ff, wav, png) {
  try {
    execFileSync(ff, ['-y', '-loglevel', 'error', '-i', wav, '-lavfi', 'showspectrumpic=s=1000x420:mode=combined:scale=log:fscale=log:legend=1:color=intensity', png])
  } catch (e) { console.warn('spectrogram failed', e.message) }
}
function pack(dir) {
  const sr = 48000
  const ff = ffmpegPath()
  const withMp3 = !process.argv.includes('--no-mp3')
  fs.mkdirSync(dir, { recursive: true })
  const lines = []
  const add = (f, what) => lines.push(`${f.padEnd(34)} ${what}`)
  // engines
  for (const [i, e] of ENGINES.entries()) {
    const ph = musicalPhrase(true)
    const r = render({ sr, seconds: ph.seconds, cfg: cfgOf({ engine: e, ...ENGINE_DEFAULT[e] }), events: ph.events, onBlock: sweepBlock(ph.sweeps) })
    const f = `engine-${i + 1}-${e}.wav`
    wav24(path.join(dir, f), r.L, r.R, sr)
    if (ff && withMp3) encodeMp3(ff, path.join(dir, f))
    add(f, `${e} : melody, a 5-note chord, then one held C3 with timbre, harmonics, morph each swept up and down around its setting (1.6 s each)`)
    // the sweep alone for the spectrogram
    const sw = { events: [{ t: 0.05, on: [999, midi(48), 0.75] }, { t: 6.0, off: 999 }], sweeps: ['timbre', 'harmonics', 'morph'].map((k, j) => ({ k, t0: 0.05 + j * 2, t1: 0.05 + j * 2 + 2 })) }
    const rs = render({ sr, seconds: 6.2, cfg: cfgOf({ engine: e, ...ENGINE_DEFAULT[e], cutoff: 1, reso: 0, chorus: 0 }), events: sw.events, onBlock: sweepBlock(sw.sweeps) })
    const tmp = path.join(dir, `_sweep-${e}.wav`)
    wav24(tmp, rs.L, rs.R, sr)
    if (ff) { spectrogram(ff, tmp, path.join(dir, `spectrogram-${i + 1}-${e}.png`)); add(`spectrogram-${i + 1}-${e}.png`, `${e} : timbre, harmonics, morph swept in turn (2 s each, up and down around the setting) on a C3, filter open, log frequency`) }
    fs.unlinkSync(tmp)
  }
  // filters
  for (const [i, f] of FILTERS.entries()) {
    const ev = []
    let id = 1
    for (const [k, n] of [36, 43, 48, 55, 60, 48].entries()) { const t = 0.1 + k * 0.6; ev.push({ t, on: [id, midi(n), 0.8] }, { t: t + 0.45, off: id }); id++ }
    const r = render({
      sr, seconds: 4.4, cfg: cfgOf({ engine: 'dco', timbre: 0.67, harmonics: 0.2, morph: 0, filter: f, cutoff: 0.3, reso: 0.75, envAmt: 0.55, attack: 0, decay: 0.42, sustain: 0.2, release: 0.25, chorus: 0, hpf: f === 'ms' ? 0.25 : 0.05, fmode: 0, level: 1 }), events: ev,
      onBlock: (s, t) => { s.setConfig({ cutoff: 0.26 + 0.34 * (t / 4.4), fmode: f === 'morph' ? Math.min(1, t / 3.6) : 0 }) },
    })
    const fl = `filter-${i + 1}-${f}.wav`
    wav24(path.join(dir, fl), r.L, r.R, sr)
    if (ff && withMp3) encodeMp3(ff, path.join(dir, fl))
    add(fl, `the ${f} filter on a saw bass line : reso 0.75, envelope 0.55, the cutoff rising${f === 'morph' ? ', the mode sweeping LP → BP → HP' : f === 'ms' ? ', the HP stage at hpf 0.25' : ''} (quieter than the rest : resonance thins the bass)`)
  }
  // patches
  const P = loadPatches()
  for (const [i, p] of P.entries()) {
    const ph = patchPhrase(p)
    const r = render({ sr, seconds: ph.seconds, cfg: { ...p.sound }, events: ph.events })
    const f = `patch-${String(i + 1).padStart(2, '0')}-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.wav`
    wav24(path.join(dir, f), r.L, r.R, sr)
    if (ff && withMp3) encodeMp3(ff, path.join(dir, f))
    add(f, `${p.name} (${p.sound.engine}) : ${p.blurb}`)
  }
  // the picture-like demo : four things moving, their speed / size / hue
  {
    const r = pictureDemo(sr, 20)
    wav24(path.join(dir, 'picture-demo.wav'), r.L, r.R, sr)
    if (ff && withMp3) encodeMp3(ff, path.join(dir, 'picture-demo.wav'))
    add('picture-demo.wav', 'four things moving in a picture : notes come and go, their speed, size and hue wander as random walks into vel, cutoff, timbre, morph, pan, bend (the play side will send these ~30 times a second); dco, then swarm, then fm, then modal, 5 s each')
  }
  fs.writeFileSync(path.join(dir, 'README.txt'), [
    'The Sonify Synth : listening pack (rendered by tools/synth-render.cjs pack, 48 kHz, 24-bit)',
    'Every file is the engine itself, no mastering. MP3 V0 copies sit beside the WAVs.',
    '',
    ...lines,
    '',
    'Listen for (what the numbers cannot judge) :',
    '- the ladder : how much bass it loses at high resonance (kept from jx-move, a little given back);',
    '- the drive at full on bright high notes (the top two octaves get less gain so it does not whistle);',
    '- the fold engine with morph high : the gate only opens on a strike, so a held note fades out;',
    '- the swarm pulses at full morph (each pulse rises over at least 1.5 ms) and its pitch chirps;',
    '- the release, linear in level (aphex-move) : does it end too abruptly on long pads?',
    '- unison : 8 voices at ±15 cents, about +2 dB over one voice.',
    '',
  ].join('\n'))
  console.log('pack written to', dir, `(${lines.length} items)`)
}
function patchPhrase(p) {
  const ev = []
  let id = 1
  const e = p.sound.engine
  const pad = p.sound.attack > 0.45
  const bassy = /bass/i.test(p.name)
  const base = bassy ? 36 : 57
  if (pad) {
    for (const n of [0, 7, 12, 16]) { ev.push({ t: 0.05, on: [id, midi(base - 12 + n), 0.75] }, { t: 2.6, off: id }); id++ }
    return { events: ev, seconds: 3.4 }
  }
  const mel = bassy ? [0, 0, 12, 7, 10, 0] : [0, 3, 7, 12, 10, 7, 3, 5]
  mel.forEach((n, i) => { const t = 0.05 + i * 0.22; ev.push({ t, on: [id, midi(base + n), 0.65 + 0.3 * (i % 3) / 2] }, { t: t + 0.18, off: id }); id++ })
  const tc = 0.05 + mel.length * 0.22
  if (!bassy && e !== 'swarm') for (const n of [0, 7, 15]) { ev.push({ t: tc, on: [id, midi(base - 12 + n), 0.7] }, { t: tc + 0.8, off: id }); id++ }
  return { events: ev, seconds: tc + 1.35 }
}
function pictureDemo(sr, seconds) {
  const rand = mulberry(77)
  const things = [0, 1, 2, 3].map((k) => ({ id: 500 + k, on: false, sp: rand(), sz: rand(), hu: rand(), x: rand() * 2 - 1, note: 0, next: rand() * 0.5 }))
  const scale = [0, 2, 3, 5, 7, 8, 10]
  const engines = ['dco', 'swarm', 'fm', 'modal']
  const cfgs = {
    dco: { engine: 'dco', timbre: 0.62, harmonics: 0.35, morph: 0.1, cutoff: 0.55, reso: 0.3, envAmt: 0.3, attack: 0.15, decay: 0.5, sustain: 0.7, release: 0.5, chorus: 1 },
    swarm: { engine: 'swarm', timbre: 0.35, harmonics: 0.6, morph: 0.5, cutoff: 0.7, reso: 0.15, envAmt: 0.1, attack: 0.2, decay: 0.6, sustain: 0.8, release: 0.55, chorus: 1 },
    fm: { engine: 'fm', timbre: 0.45, harmonics: 0.25, morph: 0.2, cutoff: 0.85, reso: 0.1, envAmt: 0.05, attack: 0.05, decay: 0.6, sustain: 0.5, release: 0.5, chorus: 1 },
    modal: { engine: 'modal', timbre: 0.5, harmonics: 0.6, morph: 0.35, cutoff: 0.9, reso: 0.05, envAmt: 0, attack: 0, decay: 0.85, sustain: 0.35, release: 0.6, chorus: 0 },
  }
  return render({
    sr, seconds, cfg: cfgOf(cfgs.dco),
    onBlock: (s, t, b) => {
      const seg = Math.min(3, Math.floor(t / (seconds / 4)))
      if (b === 0 || Math.floor((t - 128 / sr) / (seconds / 4)) !== seg) s.setConfig(cfgOf(cfgs[engines[seg]]))
      if (b % 12 !== 0) return
      for (const th of things) {
        th.sp = clamp01(th.sp + (rand() - 0.5) * 0.08); th.sz = clamp01(th.sz + (rand() - 0.5) * 0.05); th.hu = (th.hu + (rand() - 0.5) * 0.04 + 1) % 1
        th.x = Math.max(-1, Math.min(1, th.x + (rand() - 0.5) * 0.06))
        if (t >= th.next) {
          if (th.on && rand() < 0.4) { s.noteOff(th.id); th.on = false; th.next = t + 0.3 + rand() * 1.2 } else {
            const deg = Math.floor(th.hu * 14)
            const n = 45 + 12 * Math.floor(deg / 7) + scale[deg % 7] + (th.sz < 0.3 ? 12 : 0)
            s.noteOn(th.id, midi(n), 0.4 + 0.5 * th.sp)
            th.on = true; th.next = t + 0.2 + (1 - th.sp) * 1.4
          }
        }
        if (th.on) s.setMods(th.id, { vel: 0.4 + 0.5 * th.sp, cutoff: (th.sp - 0.5) * 0.6, timbre: (th.hu - 0.5) * 0.6, morph: (th.sz - 0.5) * 0.5, pan: th.x, bend: (th.sp - 0.5) * 0.1, env: th.sz - 0.5 })
      }
    },
  })
}
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x }

if (require.main === module) {
  const cmd = process.argv[2]
  if (cmd === 'check') runChecks()
  else if (cmd === 'pack') pack(process.argv[3] || path.join(ROOT, 'synthdemo'))
  else if (cmd === 'calibrate') calibrate()
  else if (cmd === 'phrase') {
    const e = process.argv[3], out = process.argv[4]
    const o = {}
    for (const kv of process.argv.slice(5)) { const [k, v] = kv.split('='); o[k] = isNaN(Number(v)) ? v : Number(v) }
    const ph = standardPhrase()
    const r = render({ sr: Number(o.sr || 48000), seconds: ph.seconds, cfg: cfgOf({ engine: e, ...o }), events: ph.events })
    wav24(out, r.L, r.R, r.sr)
    console.log(out, 'LUFS', lufs(r.L, r.R, r.sr).toFixed(2), 'peak', db(Math.max(peak(r.L), peak(r.R))).toFixed(1))
  } else console.log('usage : node tools/synth-render.cjs check|pack|calibrate|phrase')
}
