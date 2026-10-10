// The Sonify AudioWorklet processor (plain JS : loaded via Vite ?url as a
// module asset, added with audioContext.audioWorklet.addModule).
//
// One processor runs all nine voices (Spectra · Orbit · Flow · Events ·
// Raster · Transmission · Filter · Chord · Collage) plus the master bus with an
// always-on peak limiter. Rules: zero allocation inside
// process(); no AudioParams (control flows through port messages); image
// frames arrive as transferred Uint8Array luma grids, double-buffered and
// crossfaded so 30Hz video never steps audibly; grain onsets are pre-dithered
// by the main thread; pitch tables are computed on the main thread.

const GRID = 96; // luma grid is GRID×GRID
const NPART = 96; // Spectra partial count
const NGRAIN = 64; // Flow grain pool
const NEVENT = 24; // Events polyphony (plucked notes)
const NBAND = 48; // Image-Filter band count
const NCHORD = 16; // Chord bank max voices
const NSIG = 32; // Signal polyphony (micro-grains)
const TAU = 6.283185307179586;
// Voices are addressed BY INDEX (the DJ filters, the gates, the mixer and the
// sequencer masks a session saves), so a new voice is APPENDED : Signal is 9,
// and only the UI shows it before Chord. Inserting it at 7 would have moved
// Chord and the Collage, and every saved mixer setting with them.
const NVOICE = 10;
// Above this fraction of the sample rate a partial can't be played : it would
// fold back as an out-of-key whistle (and an Events phase would run away).
const NYQ_FRAC = 0.45;
// A switched voice fades in / out over this long instead of cutting mid-cycle
// (the sequencer toggles voices in rhythm : every step used to click).
const GATE_S = 0.005;

// NaN-safe : a NaN (say from an OSC float) lands on `lo` instead of passing
// through and latching a voice to silence.
function clampf(v, lo, hi) { return v >= lo ? (v <= hi ? v : hi) : lo; }

// Wave tables, read with a linear interpolation (error ~3e-7, far below
// hearing) instead of Math.sin / Math.tanh per sample per partial : the Flow
// grains and the oscillator banks were most of the audio thread's time.
const TAB_N = 4096;
function makeTable(f) { const t = new Float64Array(TAB_N + 1); for (let i = 0; i <= TAB_N; i++) t[i] = f(i / TAB_N); return t; }
const SIN_T = makeTable((p) => Math.sin(p * TAU));
const SH35_T = makeTable((p) => Math.tanh(3.5 * Math.sin(p * TAU))); // Flow's brightened grain
const SH3_T = makeTable((p) => Math.tanh(3 * Math.sin(p * TAU))); // Chord's tone
function tab(t, ph) {
  const x = ph * TAB_N; const i = Math.floor(x); const f = x - i; const j = i & (TAB_N - 1);
  return t[j] + (t[j + 1] - t[j]) * f;
}
function sinT(ph) { return tab(SIN_T, ph); }

// Shared white noise (rand()'s LCG). Math.imul keeps the product exact : in
// plain floating point the low bits rounded away and every seed fell into the
// same 10,466-step cycle, so the Filter voice's "wind" repeated every 218 ms.
// (That flutter is now the Filter's own `loop` knob, on purpose.)
let noiseSeed = 1;
function noise() { noiseSeed = (Math.imul(noiseSeed, 1103515245) + 12345) & 0x7fffffff; return noiseSeed / 0x40000000 - 1; }

// ── Shared FX tail : reverb + analog delay, ported from the Essaim / Res
// instruments (abl.dsp.quartz~ / abl.dsp.prism~ reverb + a BBD delay). ────────

// Dual-mode modulated 8-line Hadamard FDN reverb (Quartz : dual-band damping ·
// Prism : per-line frequency-dependent decay). Faithful port of res_reverb.c.
const RV_NL = 8, RV_NAP = 4, RV_APMAX = 1024;
const RV_BASELEN = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const RV_APLEN = [225, 341, 441, 556];
const RV_APG = [0.72, 0.70, 0.68, 0.66];
class FDNReverb {
  constructor(sr) {
    this.sr = sr > 0 ? sr : 48000;
    // Buffers sized from the sample rate : fixed 48k-sized lines clamped every
    // line to the same length at 96k (a metallic comb), and the predelay to 128 ms.
    this.lmax = Math.ceil(RV_BASELEN[RV_NL - 1] * 2 * this.sr / 44100) + 128;
    this.pdmax = Math.ceil(0.26 * this.sr);
    this.mode = 0;
    this.size = 0.6; this.decay = 0.6; this.damp = 0.3; this.mix = 0.3;
    this.predelay_ms = 20; this.mod_depth = 6; this.mod_rate = 0.5; this.width = 1;
    this.diffusion = 0.85; this.low_damp = 0.5;
    this.crossover = 0.3; this.lowmult = 1; this.highmult = 1;
    this.freeze = 0; this.locut_hz = 220;
    this.line = []; for (let i = 0; i < RV_NL; i++) this.line.push(new Float32Array(this.lmax));
    // linelen_s is float64 : in float32 the size glide stalled ~0.2 samples short
    // of its target, a fractional tap that dulled Prism's freeze after any size move.
    this.linelen = new Int32Array(RV_NL); this.linelen_s = new Float64Array(RV_NL); this.lw = new Int32Array(RV_NL);
    this.damp_z = new Float32Array(RV_NL); this.lo_z = new Float32Array(RV_NL);
    this.ls_z = new Float32Array(RV_NL); this.hs_z = new Float32Array(RV_NL);
    this.gain = new Float32Array(RV_NL); this.glow = new Float32Array(RV_NL); this.ghigh = new Float32Array(RV_NL);
    this.modph = new Float64Array(RV_NL);
    this.ap = []; for (let i = 0; i < RV_NAP; i++) this.ap.push(new Float32Array(RV_APMAX));
    this.apw = new Int32Array(RV_NAP);
    this.pd = [new Float32Array(this.pdmax), new Float32Array(this.pdmax)]; this.pdw = 0;
    this.hp_x = new Float32Array(2); this.hp_y = new Float32Array(2);
    this.ls_a = 0; this.hs_a = 0;
    this.d = new Float32Array(RV_NL); this.a = new Float32Array(RV_NL); this.fb = new Float32Array(RV_NL);
    this.wL = 0; this.wR = 0;
    for (let i = 0; i < RV_NL; i++) this.modph[i] = i / RV_NL;
    this.recompute();
    for (let i = 0; i < RV_NL; i++) this.linelen_s[i] = this.linelen[i];
  }
  recompute() {
    const scale = (0.35 + 1.65 * this.size) * (this.sr / 44100);
    const rt60 = 0.25 + this.decay * this.decay * 11.75;
    const lowsplit = clampf(400 * Math.pow(4, this.crossover - 0.3), 60, 3000);
    const highsplit = clampf(5500 * Math.pow(4, this.crossover - 0.3), 1500, 14000);
    this.ls_a = 1 - Math.exp(-TAU * lowsplit / this.sr);
    this.hs_a = 1 - Math.exp(-TAU * highsplit / this.sr);
    for (let i = 0; i < RV_NL; i++) {
      let L = (RV_BASELEN[i] * scale) | 0;
      if (L < 8) L = 8; if (L > this.lmax - 64) L = this.lmax - 64;
      this.linelen[i] = L;
      const t = L / this.sr;
      if (this.freeze) { this.gain[i] = this.glow[i] = this.ghigh[i] = 1; }
      else {
        const lm = this.lowmult > 0.02 ? this.lowmult : 0.02, hm = this.highmult > 0.02 ? this.highmult : 0.02;
        this.gain[i] = Math.pow(10, -3 * t / rt60);
        this.glow[i] = Math.pow(10, -3 * t / (rt60 * lm));
        this.ghigh[i] = Math.pow(10, -3 * t / (rt60 * hm));
      }
    }
  }
  reset() { // clear all feedback state (recover from a NaN / blow-up)
    for (let i = 0; i < RV_NL; i++) { this.line[i].fill(0); this.lw[i] = 0; this.damp_z[i] = this.lo_z[i] = this.ls_z[i] = this.hs_z[i] = 0; }
    for (let i = 0; i < RV_NAP; i++) { this.ap[i].fill(0); this.apw[i] = 0; }
    this.pd[0].fill(0); this.pd[1].fill(0); this.pdw = 0;
    this.hp_x[0] = this.hp_x[1] = this.hp_y[0] = this.hp_y[1] = 0; this.wL = this.wR = 0;
  }
  lineRead(i, delay) {
    const LM = this.lmax;
    let rp = this.lw[i] - delay; while (rp < 0) rp += LM;
    let i0 = rp | 0; const frac = rp - i0; if (i0 >= LM) i0 -= LM;
    let i1 = i0 + 1; if (i1 >= LM) i1 -= LM;
    return this.line[i][i0] * (1 - frac) + this.line[i][i1] * frac;
  }
  process(inL, inR) {
    const moddepth = this.freeze ? 0 : this.mod_depth;
    const damp_a = clampf(1 - this.damp * 0.85, 0.05, 1);
    const dscale = 0.15 + 0.85 * this.diffusion;
    const ingain = this.freeze ? 0 : 1;
    const lowkeep = clampf(1 - this.low_damp * 0.9, 0.05, 1);
    let locut_a = TAU * this.locut_hz / this.sr; if (locut_a > 0.5) locut_a = 0.5;
    const PM = this.pdmax;
    let pdlen = (this.predelay_ms * 0.001 * this.sr) | 0; if (pdlen < 1) pdlen = 1; if (pdlen > PM - 1) pdlen = PM - 1;
    let rp = this.pdw - pdlen; while (rp < 0) rp += PM;
    const pdL = this.pd[0][rp], pdR = this.pd[1][rp];
    this.pd[0][this.pdw] = inL; this.pd[1][this.pdw] = inR; this.pdw = (this.pdw + 1) % PM;
    let x = 0.5 * (pdL + pdR);
    for (let i = 0; i < RV_NAP; i++) { const r = this.apw[i], g = RV_APG[i] * dscale, buf = this.ap[i][r], y = -g * x + buf; this.ap[i][r] = x + g * y; this.apw[i] = (r + 1) % RV_APLEN[i]; x = y; }
    const d = this.d;
    for (let i = 0; i < RV_NL; i++) {
      const mod = moddepth * Math.sin(TAU * this.modph[i]);
      const dl = this.linelen[i] - this.linelen_s[i];
      this.linelen_s[i] = dl > -1e-3 && dl < 1e-3 ? this.linelen[i] : this.linelen_s[i] + dl * 0.0006;
      d[i] = this.lineRead(i, this.linelen_s[i] - 2 - mod);
      this.modph[i] += this.mod_rate * (0.7 + 0.09 * i) / this.sr;
      if (this.modph[i] >= 1) this.modph[i] -= 1;
    }
    const a = this.a; for (let i = 0; i < RV_NL; i++) a[i] = d[i];
    for (let s = 1; s < RV_NL; s <<= 1) for (let j = 0; j < RV_NL; j += s << 1) for (let k = 0; k < s; k++) { const u = a[j + k], v = a[j + k + s]; a[j + k] = u + v; a[j + k + s] = u - v; }
    const fb = this.fb; for (let i = 0; i < RV_NL; i++) fb[i] = a[i] * 0.35355339;
    for (let i = 0; i < RV_NL; i++) {
      let v = x * ingain + fb[i];
      if (this.mode === 1) {
        const low = (this.ls_z[i] += this.ls_a * (v - this.ls_z[i])); const rem = v - low;
        const mid = (this.hs_z[i] += this.hs_a * (rem - this.hs_z[i])); const high = rem - mid;
        v = low * this.glow[i] + mid * this.gain[i] + high * this.ghigh[i];
      } else {
        this.damp_z[i] += damp_a * (v - this.damp_z[i]); v = this.damp_z[i] * this.gain[i];
        this.lo_z[i] += locut_a * (v - this.lo_z[i]); v = (v - this.lo_z[i]) + this.lo_z[i] * lowkeep;
      }
      if (v > 4) v = 4; else if (v < -4) v = -4;
      this.line[i][this.lw[i]] = v; this.lw[i] = (this.lw[i] + 1) % this.lmax;
    }
    const Lo = (d[0] - d[1] + d[2] - d[3] + d[6] - d[7]) * 0.4082;
    const Ro = (d[4] - d[5] + d[6] - d[7] + d[0] - d[2]) * 0.4082;
    const mid = 0.5 * (Lo + Ro), w = this.width;
    const oL = mid * (1 - w) + Lo * w, oR = mid * (1 - w) + Ro * w;
    let ac = 1 - TAU * this.locut_hz / this.sr; if (ac < 0) ac = 0;
    this.wL = ac * (this.hp_y[0] + oL - this.hp_x[0]); this.hp_x[0] = oL; this.hp_y[0] = this.wL;
    this.wR = ac * (this.hp_y[1] + oR - this.hp_x[1]); this.hp_x[1] = oR; this.hp_y[1] = this.wR;
  }
}

// BBD (bucket-brigade / analog) delay : glided tape-morph time, dual-lowpass
// tone with wow/flutter jitter, companded soft-saturating feedback, mono /
// stereo / ping-pong. Faithful port of Essaim fx.c's delay. Returns wet echoes.
class BBDDelay {
  constructor(sr) {
    this.sr = sr > 0 ? sr : 48000; this.sri = 1 / this.sr;
    this.dlen = Math.floor(this.sr * 4);
    this.dbl = new Float32Array(this.dlen); this.dbr = new Float32Array(this.dlen); this.dw = 0;
    this.lp_l = 0; this.lp_r = 0; this.lp2_l = 0; this.lp2_r = 0; this.jit = 0;
    this.mix = 0.3; this.mixS = 0.3; this.rate = 0.3; this.rate_s = 0.3; this.fb = 0.35; this.tone = 0.5; this.mode = 1;
    this.wL = 0; this.wR = 0;
  }
  reset() {
    this.dbl.fill(0); this.dbr.fill(0); this.dw = 0; this.lp_l = this.lp_r = this.lp2_l = this.lp2_r = 0; this.wL = this.wR = 0;
    if (!Number.isFinite(this.rate_s)) this.rate_s = this.rate;
  }
  process(inL, inR) {
    this.rate_s += 0.0004 * (this.rate - this.rate_s);
    const delf = this.rate_s * this.sr; let rf = this.dw - delf; if (rf < 0) rf += this.dlen;
    let rp0 = rf | 0; const frac = rf - rp0; let rp1 = rp0 + 1;
    if (rp0 >= this.dlen) rp0 -= this.dlen; if (rp1 >= this.dlen) rp1 -= this.dlen;
    const tl = this.dbl[rp0] * (1 - frac) + this.dbl[rp1] * frac;
    const tr = this.dbr[rp0] * (1 - frac) + this.dbr[rp1] * frac;
    this.jit += 0.15 * this.sri; if (this.jit >= 1) this.jit -= 1; const jit = Math.sin(this.jit * TAU) * 0.04;
    const dt = this.tone;
    const lpc = dt < 0.49 ? clampf(0.08 + (dt / 0.49) * 0.72 + jit, 0.04, 0.92)
      : dt > 0.51 ? clampf(0.85 + jit, 0.7, 0.95) : clampf(0.88 + jit, 0.75, 0.95);
    this.lp_l += lpc * (tl - this.lp_l); this.lp_r += lpc * (tr - this.lp_r);
    this.lp2_l += lpc * (this.lp_l - this.lp2_l); this.lp2_r += lpc * (this.lp_r - this.lp2_r);
    let fbl = this.lp2_l * this.fb, fbr = this.lp2_r * this.fb;
    fbl = fbl / (1 + Math.abs(fbl * 0.8)); fbr = fbr / (1 + Math.abs(fbr * 0.8));
    if (this.mode === 0) { const m = (inL + inR) * 0.5 + fbl; this.dbl[this.dw] = m; this.dbr[this.dw] = m; }
    else if (this.mode === 2) { this.dbl[this.dw] = inR + fbr; this.dbr[this.dw] = inL + fbl; }
    else { this.dbl[this.dw] = inL + fbl; this.dbr[this.dw] = inR + fbr; }
    if (++this.dw >= this.dlen) this.dw = 0;
    this.mixS += (this.mix - this.mixS) * 0.002;
    this.wL = Math.tanh(tl * 1.2) * this.mixS; this.wR = Math.tanh(tr * 1.2) * this.mixS;
  }
}

// ── RING : a resonant filterbank on the Collage voice ──────────────────────────
// 48 bands per side, each a trapezoidal (TPT) state-variable band-pass, the filter
// core of Vincent's Loopex / Fizzik : stable up to Nyquist at any Q, where the
// Chamberlin form blows up past sr/6. The bands sit on the Sonify key / scale
// across the voice's octave range (sent from the main thread). Every band rings
// for the same time (Q = 0.455·f·T60, the ring law of res_spectra, whose 50 ms
// to 10 s span starts lower here so DECAY 0 is a plain filterbank). The spectral
// shape (cutoff, peak, slope, tone) follows an open-source (BSD-3) bank's laws.
// SUSTAIN shapes what goes INTO each band (its ring decays on its own); CHOKE
// shapes what comes out (WAVES and the cutoff chop the ring).
const RB_N = 48;
// Rhythmic divisions for synced rates, in beats (8 bars … 1/32).
const RB_DIV = [32, 16, 8, 4, 2, 1, 0.5, 0.25, 0.125];
/** A modulation rate : r 0..1; sync 0 free (0.02..20 Hz), 1 straight, 2 triplet,
 *  3 dotted (r picks the division, the tempo sets the speed). */
function lfoHz(r, sync, bpm) {
  r = clampf(r, 0, 1);
  if (!(sync >= 1)) return 0.02 * Math.pow(1000, r);
  let beats = RB_DIV[Math.round(r * (RB_DIV.length - 1))];
  if (sync === 2) beats *= 2 / 3; else if (sync === 3) beats *= 1.5;
  return (clampf(bpm, 20, 400) / 60) / beats;
}
// The voicings, Loopex's SVF family : input drive, how hard the resonance clips,
// and a damping trim (SEM is broader and rounder).
const RB_VOICE = [
  { drive: 1, sat: 0, kmul: 1 }, // Clean
  { drive: 1, sat: 0, kmul: 1.35 }, // SEM
  { drive: 1.8, sat: 1, kmul: 1 }, // MS-20 : driven, the ring itself clips
  { drive: 1.2, sat: 0.5, kmul: 1.1 }, // Steiner
  { drive: 1.5, sat: 0.8, kmul: 1 } // K35
];
// Loopex's rational tanh (exact enough, cheap enough to run per band).
function rtanh(x) { if (x < -3) return -1; if (x > 3) return 1; const x2 = x * x; return x * (27 + x2) / (27 + 9 * x2); }

class RingBank {
  constructor(sr) {
    this.sr = sr > 0 ? sr : 48000;
    this.freq = new Float64Array(RB_N);
    this.pos = new Float64Array(RB_N); // each band's place in semitones above the lowest
    for (let b = 0; b < RB_N; b++) { this.freq[b] = 110 * Math.pow(2, b / 12); this.pos[b] = b; }
    const M = RB_N * 2; // [band·2 + side]
    this.ic1 = new Float64Array(M); this.ic2 = new Float64Array(M);
    this.a1 = new Float64Array(M); this.a2 = new Float64Array(M); this.a3 = new Float64Array(M); this.kk = new Float64Array(M);
    this.g = new Float64Array(RB_N); this.gd = new Float64Array(RB_N); // band gain, and its per-sample step
    this.dph = new Float64Array(RB_N); // detune wobble phase per band
    this.drift = new Float64Array(RB_N); // res_spectra's random-walk detune (cents)
    this.nz = new Float64Array(RB_N); this.nzT = new Float64Array(RB_N); this.nzPh = new Float64Array(RB_N);
    for (let b = 0; b < RB_N; b++) {
      this.dph[b] = Math.random(); this.nzPh[b] = Math.random();
      this.nzT[b] = Math.random(); this.nz[b] = this.nzT[b];
    }
    this.wph = 0; this.dtPh = 0; this.wet = 0; this.idle = true;
    this.zero = new Float32Array(128);
    this.mk = 1; this.mkKey = ''; this.fver = 0; // make-up gain, and what it was computed for
    // level match : the make-up above is right for broadband sound, but a film's
    // tone landing on a band's note passes at full strength and was then lifted
    // by it (11 dB over the plain voice, measured). A slow follower (~0.7 s) keeps
    // the wet at the dry's level; it holds while the films are silent, so the
    // rings decay on their own.
    this.dryP = 0; this.wetP = 0; this.agc = 1;
  }
  // Make-up gain : the bank's summed response, measured. Overlapping bands (a
  // short decay) add up coherently and came out ~10 dB over the dry; sharp ones
  // pass only a sliver. Evaluated on 96 log-spaced frequencies across the bank
  // (equal weight per octave, like a film's pinkish spectrum) with unit band
  // gains, so the cutoff, peak, waves... still shape the level as they should.
  makeup(T60, tilt, kmul) {
    const key = T60.toFixed(4) + '|' + tilt.toFixed(3) + '|' + kmul + '|' + this.fver;
    if (key === this.mkKey) return this.mk;
    this.mkKey = key;
    const f0 = this.freq[0] / 1.4, f1 = Math.min(this.freq[RB_N - 1] * 1.4, NYQ_FRAC * this.sr);
    const NG = 96;
    let acc = 0;
    for (let j = 0; j < NG; j++) {
      const f = f0 * Math.pow(f1 / f0, j / (NG - 1));
      let re = 0, im = 0;
      for (let b = 0; b < RB_N; b++) {
        const side = (2 * b) / (RB_N - 1) - 1;
        const fb = this.freq[b];
        const Q = clampf(0.4547 * fb * T60 * Math.pow(2, tilt * 2 * side), 0.5, 4000) / kmul;
        // unity-peak band-pass : (j·x/Q) / (1 − x² + j·x/Q), x = f/fb
        const x = f / fb, a = 1 - x * x, c = x / Q, d = a * a + c * c;
        re += (c * c) / d; im += (c * a) / d;
      }
      acc += re * re + im * im;
    }
    // ×1.25 : measured on pink noise the wet sat ~2 dB under the dry at any decay
    this.mk = clampf(1.25 / Math.sqrt(acc / NG), 0.05, 50);
    return this.mk;
  }
  setFreqs(f, remeasure = true) {
    const n = Math.min(RB_N, f.length);
    for (let b = 0; b < n; b++) this.freq[b] = f[b] > 10 ? f[b] : 10;
    const f0 = this.freq[0];
    for (let b = 0; b < RB_N; b++) this.pos[b] = 12 * Math.log2(this.freq[b] / f0);
    if (remeasure) this.fver++;
  }
  reset() { this.ic1.fill(0); this.ic2.fill(0); this.dryP = 0; this.wetP = 0; this.agc = 1; }
  /** Add the voice (dry and bank) into L/R. `iL/iR` the Collage bus, `gL/gR`
   *  its balance. */
  process(iL, iR, L, R, n, co, bpm, gL, gR) {
    const sr = this.sr, dt = 1 / sr;
    const wetT = clampf(co.bank || 0, 0, 1);
    if (wetT <= 0.0005 && this.wet <= 0.0005) {
      for (let s = 0; s < n; s++) { L[s] += iL[s] * gL; R[s] += iR[s] * gR; }
      this.wet = 0; this.idle = true;
      return;
    }
    if (this.idle) { this.reset(); this.idle = false; for (let b = 0; b < RB_N; b++) this.g[b] = 0; }
    const w0 = this.wet, dw = (wetT - w0) / n;
    this.wet = wetT;
    const send = !!co.bankSend, choke = !!co.choke;
    const vo = RB_VOICE[clampf(co.voicing | 0, 0, RB_VOICE.length - 1)];
    // ── per block : coefficients, shape, modulation ──
    const T60 = 0.012 * Math.pow(10 / 0.012, clampf(co.decay != null ? co.decay : 0.5, 0, 1));
    const tilt = clampf(co.tilt || 0, -1, 1);
    const det = clampf(co.detune || 0, 0, 1);
    this.dtPh = (this.dtPh + 0.13 * n * dt) % 1; // DETUNE wobbles at a fixed rate
    const waves = clampf(co.waves || 0, 0, 1);
    const wA = Math.min(1, waves / 0.65), wFast = Math.max(0, (waves - 0.65) / 0.35); // past 65 % it speeds up
    this.wph = (this.wph + lfoHz(co.wavesRate != null ? co.wavesRate : 0.5, co.wavesSync | 0, bpm) * (1 + 3 * wFast) * n * dt) % 1;
    const nA = clampf(co.noise || 0, 0, 1);
    const nHz = lfoHz(co.noiseRate != null ? co.noiseRate : 0.5, co.noiseSync | 0, bpm);
    const span = this.pos[RB_N - 1] > 1 ? this.pos[RB_N - 1] : 1;
    const cn = -6 + clampf(co.cutoff != null ? co.cutoff : 1, 0, 1) * (span + 12);
    const slope = clampf(co.slope || 0, 0, 1), peak = clampf(co.peak || 0, 0, 1), tone = clampf(co.tone || 0, -1, 1);
    const nyqF = NYQ_FRAC * sr;
    const dmax = det * 30; // ± cents of random walk
    for (let b = 0; b < RB_N; b++) {
      const side = (2 * b) / (RB_N - 1) - 1; // -1 the lowest band … 1 the highest
      // detune : a slow per-band wobble + res_spectra's bounded random walk, the
      // two sides opposite (the stereo spread)
      if (dmax > 0) {
        let dr = this.drift[b] + (Math.random() - 0.5) * 0.05 * dmax;
        this.drift[b] = dr > dmax ? dmax : dr < -dmax ? -dmax : dr;
      } else this.drift[b] *= 0.9;
      const cents = det * 20 * Math.sin(TAU * (this.dtPh + this.dph[b])) + this.drift[b];
      // TILT : one side rings longer, the other is attenuated
      const T = T60 * Math.pow(2, tilt * 2 * side);
      for (let ch = 0; ch < 2; ch++) {
        let f = this.freq[b] * Math.pow(2, (ch ? -cents : cents) / 1200);
        if (f > nyqF) f = nyqF;
        const g = Math.tan(Math.PI * f / sr);
        const Q = clampf(0.4547 * f * T, 0.5, 4000);
        const k = vo.kmul / Q;
        const a1 = 1 / (1 + g * (g + k)), i = b * 2 + ch;
        this.a1[i] = a1; this.a2[i] = g * a1; this.a3[i] = g * g * a1; this.kk[i] = k;
      }
      // shape : low-pass → band-pass → high-pass around the cutoff, + the peak, × tone
      const oct = (this.pos[b] - cn) / 12;
      const lp = 1 / (1 + Math.exp(2.8 * oct)), hp = 1 / (1 + Math.exp(-2.8 * oct)), bp = Math.exp(-2.2 * oct * oct);
      let sh = slope < 0.5 ? lp + (bp - lp) * slope * 2 : bp + (hp - bp) * (slope - 0.5) * 2;
      sh += peak * 1.25 * Math.exp(-6 * oct * oct);
      sh *= clampf(1 + tone * side, 0.15, 2.2);
      sh *= tilt > 0 ? 1 - tilt * 0.8 * Math.max(0, -side) : 1 + tilt * 0.8 * Math.max(0, side);
      // WAVES : a sine across the bands, travelling
      const wv = 1 - wA * (0.5 - 0.5 * Math.cos(TAU * ((b / RB_N) * (1 + wFast) - this.wph)));
      // NOISE : a random level per band, re-drawn at the noise rate, glided
      let np = this.nzPh[b] + nHz * n * dt;
      if (np >= 1) { np -= Math.floor(np); this.nzT[b] = Math.random(); }
      this.nzPh[b] = np;
      this.nz[b] += (this.nzT[b] - this.nz[b]) * Math.min(1, nHz * 4 * n * dt);
      const tgt = sh * wv * (1 - nA * this.nz[b]);
      this.gd[b] = (tgt - this.g[b]) / n;
    }
    const M = this.makeup(T60, tilt, vo.kmul) * this.agc;
    let dryB = 0, wetB = 0;
    const sat = vo.sat;
    // The voicing's DRIVE pushes each band's own clip (kd), never a waveshaper on
    // the input : that one clipped the whole mix of pieces before the bank, and the
    // loud low centre pieces intermodulated there (sums and differences of their
    // notes, a ring-modulator rasp : 2.2 % of the MS-20 output off every note,
    // 0.09 % now, Clean 0.04 %; measured offline). Each band still clips, harder.
    const kd = 1.5 * vo.drive;
    const ic1 = this.ic1, ic2 = this.ic2, A1 = this.a1, A2 = this.a2, A3 = this.a3, K = this.kk, G = this.g, GD = this.gd;
    // (The saturations below are written out, not calls to rtanh : not inlined in
    // this hot loop, every call boxed its result, ~12,000 allocations per block,
    // and the clipping voicings cost 3.6 ms of a 2.7 ms block. Measured.)
    for (let s = 0; s < n; s++) {
      const xl = iL[s] * gL, xr = iR[s] * gR;
      const dl = xl, dr = xr;
      let accL = 0, accR = 0;
      for (let b = 0; b < RB_N; b++) {
        const gb = (G[b] += GD[b]);
        let i = b * 2;
        // left
        let v3 = (choke ? dl : dl * gb) - ic2[i];
        let v1 = A1[i] * ic1[i] + A2[i] * v3;
        let v2 = ic2[i] + A2[i] * ic1[i] + A3[i] * v3;
        let c1 = 2 * v1 - ic1[i];
        if (sat > 0) { let u = c1 * K[i] * kd; u = u > 3 ? 1 : u < -3 ? -1 : u * (27 + u * u) / (27 + 9 * u * u); c1 += (u / (kd * K[i]) - c1) * sat; }
        ic1[i] = c1; ic2[i] = 2 * v2 - ic2[i];
        accL += choke ? v1 * K[i] * gb : v1 * K[i];
        // right
        i++;
        v3 = (choke ? dr : dr * gb) - ic2[i];
        v1 = A1[i] * ic1[i] + A2[i] * v3;
        v2 = ic2[i] + A2[i] * ic1[i] + A3[i] * v3;
        c1 = 2 * v1 - ic1[i];
        if (sat > 0) { let u = c1 * K[i] * kd; u = u > 3 ? 1 : u < -3 ? -1 : u * (27 + u * u) / (27 + 9 * u * u); c1 += (u / (kd * K[i]) - c1) * sat; }
        ic1[i] = c1; ic2[i] = 2 * v2 - ic2[i];
        accR += choke ? v1 * K[i] * gb : v1 * K[i];
      }
      dryB += xl * xl + xr * xr; wetB += accL * accL + accR * accR;
      // soft ceiling on the wet (a very sharp bank on a loud film)
      let bl = accL * M * 0.5, br = accR * M * 0.5;
      bl = (bl > 3 ? 1 : bl < -3 ? -1 : bl * (27 + bl * bl) / (27 + 9 * bl * bl)) * 2;
      br = (br > 3 ? 1 : br < -3 ? -1 : br * (27 + br * br) / (27 + 9 * br * br)) * 2;
      const w = w0 + dw * (s + 1);
      L[s] += send ? xl + bl * w : xl * (1 - w) + bl * w;
      R[s] += send ? xr + br * w : xr * (1 - w) + br * w;
    }
    // the level follower (see the constructor)
    if (dryB > 1e-7 * n) {
      const a = 1 - Math.exp(-n / (0.7 * sr));
      this.dryP += (dryB - this.dryP) * a;
      this.wetP += (wetB * (M / this.agc) * (M / this.agc) - this.wetP) * a;
      if (this.wetP > 1e-12) {
        const t = clampf(Math.sqrt(this.dryP / this.wetP), 0.1, 10);
        this.agc += (t - this.agc) * a;
      }
    }
    // self-heal + flush denormals
    for (let i = 0; i < RB_N * 2; i++) {
      const a = ic1[i], c = ic2[i];
      if (!Number.isFinite(a) || !Number.isFinite(c)) { this.reset(); break; }
      if (a > -1e-25 && a < 1e-25) ic1[i] = 0;
      if (c > -1e-25 && c < 1e-25) ic2[i] = 0;
    }
  }
}

// Per-voice DJ filter (Essaim fx.c) : one knob — <0.5 sweeps a 3-stage lowpass
// down (18k→200Hz), >0.5 sweeps a 3-stage highpass up (20→8000Hz), 0.5 = bypass.
// RBJ biquads at Q=0.707, cascaded ×3, independent L/R state.
// Equal-power pan of a point source, p 0 (left) … 1 (right) : cos / sin, so a
// note keeps its loudness wherever it sits (the linear 1-p / p law it replaced
// left a 3 dB hole in the middle, measured). PAN_TRIM brings the average level
// back to where the linear law had it.
const HALF_PI = Math.PI / 2;
const PAN_TRIM = 0.85;
function panGL(p) { return Math.cos(p * HALF_PI) * PAN_TRIM; }
function panGR(p) { return Math.sin(p * HALF_PI) * PAN_TRIM; }

class DJFilter {
  constructor() {
    this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; // start at unity (bypass)
    this.x1L = new Float32Array(3); this.x2L = new Float32Array(3); this.y1L = new Float32Array(3); this.y2L = new Float32Array(3);
    this.x1R = new Float32Array(3); this.x2R = new Float32Array(3); this.y1R = new Float32Array(3); this.y2R = new Float32Array(3);
    // Smoothed control : setX() sets a TARGET, update() glides toward it once per
    // block so a fast slider sweep ramps the cutoff instead of snapping the biquad
    // coefficients (which made a loud POP). lastApplied skips recompute once settled.
    this.tx = 0.5; this.cx = 0.5; this.sr = 48000; this.lastApplied = -1;
  }
  coefsLPF(freq, sr) {
    const w0 = TAU * clampf(freq, 20, sr * 0.49) / sr, alpha = Math.sin(w0) / (2 * 0.707);
    const cw = Math.cos(w0), a0i = 1 / (1 + alpha);
    this.b0 = (1 - cw) * 0.5 * a0i; this.b1 = (1 - cw) * a0i; this.b2 = this.b0; this.a1 = -2 * cw * a0i; this.a2 = (1 - alpha) * a0i;
  }
  coefsHPF(freq, sr) {
    const w0 = TAU * clampf(freq, 20, sr * 0.49) / sr, alpha = Math.sin(w0) / (2 * 0.707);
    const cw = Math.cos(w0), a0i = 1 / (1 + alpha);
    this.b0 = (1 + cw) * 0.5 * a0i; this.b1 = -(1 + cw) * a0i; this.b2 = this.b0; this.a1 = -2 * cw * a0i; this.a2 = (1 - alpha) * a0i;
  }
  setX(x, sr) { this.tx = x; this.sr = sr || this.sr; }
  update() {
    // One-pole glide toward the target (~27ms to 90% at 128-sample blocks / 48k).
    this.cx += (this.tx - this.cx) * 0.2;
    if (Math.abs(this.cx - this.lastApplied) < 1e-4) return; // settled : keep coefficients
    this.lastApplied = this.cx;
    const x = this.cx, sr = this.sr;
    // Bypass = UNITY coefficients (not a skip). The biquad runs every sample so
    // its state stays warm : crossing in/out of bypass is then click-free. The
    // POP was a zero-state engage transient when the filter switched on from a
    // skipped bypass, NOT the coefficient value — so the glide alone didn't fix it.
    if (x < 0.49) this.coefsLPF(18000 * Math.pow(200 / 18000, (0.49 - x) / 0.49), sr);
    else if (x > 0.51) this.coefsHPF(20 * Math.pow(400, (x - 0.51) / 0.49), sr);
    else { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; }
  }
  procL(inp) {
    let v = inp;
    for (let s = 0; s < 3; s++) {
      const o = this.b0 * v + this.b1 * this.x1L[s] + this.b2 * this.x2L[s] - this.a1 * this.y1L[s] - this.a2 * this.y2L[s];
      this.x2L[s] = this.x1L[s]; this.x1L[s] = v; this.y2L[s] = this.y1L[s]; this.y1L[s] = o; v = o + 1e-20;
    }
    return v;
  }
  procR(inp) {
    let v = inp;
    for (let s = 0; s < 3; s++) {
      const o = this.b0 * v + this.b1 * this.x1R[s] + this.b2 * this.x2R[s] - this.a1 * this.y1R[s] - this.a2 * this.y2R[s];
      this.x2R[s] = this.x1R[s]; this.x1R[s] = v; this.y2R[s] = this.y1R[s]; this.y1R[s] = o; v = o + 1e-20;
    }
    return v;
  }
}

// Replace any non-finite number in an incoming config (an OSC NaN, a bad
// preset) with the value it had, else 0 : one bad field used to latch a voice
// to silence, or kill the whole FX tail, until the engine restarted.
function sanitize(o, prev) {
  for (const k in o) {
    const v = o[k];
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) { const p = prev ? prev[k] : undefined; o[k] = typeof p === 'number' && Number.isFinite(p) ? p : 0; }
    } else if (v && typeof v === 'object' && !ArrayBuffer.isView(v)) sanitize(v, prev ? prev[k] : undefined);
  }
}
// Keep only the scheduled onsets still in the future (compacted in place).
function dropStale(list, now) {
  let w = 0;
  for (let i = 0; i < list.length; i++) if (list[i].t0 >= now) list[w++] = list[i];
  list.length = w;
}
const PENDING_CAP = 512;

class SoniProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // ── taps : two image inputs, each double-buffered luma grids 0..1 ──
    this.taps = [];
    for (let t = 0; t < 2; t++) {
      this.taps.push({
        cur: new Float32Array(GRID * GRID),
        prev: new Float32Array(GRID * GRID),
        mix: 1, // 0 = prev … 1 = cur, advanced per quantum for interp
        mix0: 1, // the mix at the start of this block (Orbit ramps it per sample)
        mixStep: 0.25,
        has: false
      });
    }
    // ── voice configs (overwritten by 'cfg' messages) ──
    this.cfg = {
      master: 0.8,
      spectra: { on: false, tap: 0, gain: 0.5, pan: 0, sweepOn: true, sweepHz: 0.25, x: 0.5, gamma: 1.6, breath: 0, path: 0, pace: 0 },
      orbit:   { on: false, tap: 0, gain: 0.5, pan: 0, freq: 110, ratio: 1, cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.25, drive: 1.2, smooth: 0.6 },
      flow:    { on: false, tap: 0, gain: 0.5, pan: 0, dur: 0.09, noise: 0.15, colour: 0 },
      events:  { on: false, gain: 0.6, pan: 0, wave: 1, decay: 0.35, highs: 0.6 },
      raster:  { on: false, tap: 0, gain: 0.5, pan: 0, freq: 110, rx: 0.35, ry: 0.35, rw: 0.3, rh: 0.3, smooth: 0, tone: 0.6 },
      sstv:    { on: false, tap: 0, gain: 0.5, pan: 0, lineHz: 12, dev: 1, syncLev: 0.5 },
      filter:  { on: false, tap: 0, gain: 0.6, pan: 0, q: 0.5, noise: 0.5, loop: 0, sweepOn: false, sweepHz: 0.25, x: 0.5, gamma: 1.6, path: 0, pace: 0 },
      chord:   { on: false, tap: 0, gain: 0.6, pan: 0, gamma: 1.6, spread: 0.6, attack: 0.4, release: 0.8, tone: 0.3, waves: 0, wavesRate: 0.4, wavesSync: 0, noise: 0, air: 0.4 },
      signal:  { on: false, gain: 0.6, pan: 0, wave: 0, decay: 0.3, tone: 0.6, fm: 0.4 },
      collage: { on: false, gain: 0.7, pan: 0, bank: 0, bankSend: false, decay: 0.5, choke: false, cutoff: 1, peak: 0, slope: 0, tone: 0, tilt: 0, waves: 0, wavesRate: 0.5, wavesSync: 0, noise: 0, noiseRate: 0.5, noiseSync: 0, detune: 0, voicing: 0 },
      fx:      { send: 0, dlyMix: 0.35, dlyTime: 0.3, dlyFb: 0.35, dlyTone: 0.5, dlyMode: 1, rvMode: 0, rvMix: 0.6, rvSize: 0.6, rvDecay: 0.6, rvDamp: 0.3, rvPre: 20, rvMod: 6, rvModRate: 0.5, rvWidth: 1, rvLocut: 220, rvFreeze: false, rvDiff: 0.85, rvLowDamp: 0.5, rvCross: 0.3, rvLowMult: 1, rvHighMult: 1 }
    };
    this.spectraFreqs = new Float32Array(NPART); // filled by cfg
    for (let i = 0; i < NPART; i++) this.spectraFreqs[i] = 55 * Math.pow(2, i * 6 / NPART);
    // ── Spectra state ──
    this.sPhase = new Float32Array(NPART);
    this.sAmp = new Float32Array(NPART);
    this.sTarget = new Float32Array(NPART);
    this.sNz = new Float32Array(NPART); // per-partial lowpassed noise (breath)
    this.sweepPos = 0;
    // ── Orbit state ──
    this.oPhase = 0;
    this.oYOff = 0; // the y phase carried across the x phase's wraps (Lissajous stays locked)
    this.dcX = 0; this.dcY = 0; // DC-blocker state
    this.oSlew = 0; // slewed sample for smooth
    // ── Flow grain pool ──
    this.grains = [];
    for (let g = 0; g < NGRAIN; g++) {
      this.grains.push({ on: false, t0: 0, phase: 0, inc: 0, amp: 0, pan: 0.5, age: 0, dur: 0.1, invDur: 10, noise: 0, bright: 0, warm: 0, phase2: 0, inc2: 0 });
    }
    this.pending = []; // scheduled grain events (small, replaced per flow msg)
    // ── Events poly pool (plucked notes from edges / motion) ──
    this.notes = [];
    for (let k = 0; k < NEVENT; k++) {
      this.notes.push({ on: false, phase: 0, inc: 0, amp: 0, pan: 0.5, wave: 0, env: 0, atkInc: 1, decMul: 0.999, attacking: false, born: -1, lastL: 0, lastR: 0 });
    }
    this.evPending = []; // scheduled note onsets [{t0, freq, amp, pan}]
    // a stolen note's last sample, faded over ~3 ms so the steal doesn't click
    this.evDcL = 0; this.evDcR = 0;
    this.evDcK = Math.exp(-1 / (0.003 * sampleRate));
    // ── Signal poly pool (micro-grains fired by the scan heads) ──
    // `wait` delays a grain to its exact sample inside the block : onsets are
    // not quantized to the 128-sample quantum, so a fast grid stays a grid.
    this.sig = [];
    for (let k = 0; k < NSIG; k++) {
      this.sig.push({ on: false, wait: 0, phase: 0, inc: 0, amp: 0, pan: 0.5, env: 0, decMul: 0.999,
        age: 0, len: 1, fmPh: 0, lp: 0, seed: 1, p0: 0, p1: 0, p2: 0, p3: 0, p4: 0, p5: 0, p6: 0,
        born: -1, lastL: 0, lastR: 0 });
    }
    this.sigPending = []; // scheduled onsets [{t0, freq, amp, pan}]
    this.sgDcL = 0; this.sgDcR = 0; // stolen grains' last samples, faded like Events'
    this.block = 0; // render-quantum counter (a note born this block is never stolen)
    // ── Raster state ──
    this.rPtr = 0; // read pointer in probe pixels (row-major, wraps)
    this.rDcX = 0; this.rDcY = 0;
    this.rLow = 0; this.rBand = 0; // tone : 12dB/oct SVF lowpass state
    // ── Transmission (SSTV) state ──
    this.tPhase = 0; // FM oscillator phase
    this.tLine = 0; // current scan row 0..GRID-1
    this.tX = 0; // position within the line 0..1
    // ── Filter (image-shaped bandpass bank over noise / line-in) ──
    this.fFreqs = new Float32Array(NBAND);
    for (let i = 0; i < NBAND; i++) this.fFreqs[i] = 80 * Math.pow(100, i / (NBAND - 1)); // 80Hz..8kHz
    this.fCoef = new Float32Array(NBAND); // 2·sin(π·fc/sr), rebuilt on cfg
    this.fLow = new Float32Array(NBAND);
    this.fBand = new Float32Array(NBAND);
    this.fGain = new Float32Array(NBAND); // slewed image gains
    this.fTarget = new Float32Array(NBAND);
    this.fSweep = 0;
    // `loop` : a frozen stretch of noise replayed (0 = free noise). Short loops
    // buzz, ~200 ms flutters (the old noise's accidental cycle, now a choice).
    this.fLoopBuf = new Float32Array(Math.ceil(0.4 * sampleRate));
    for (let i = 0; i < this.fLoopBuf.length; i++) this.fLoopBuf[i] = noise();
    this.fLoopPos = 0;
    this.rebuildFilterCoefs();
    // ── Chord bank (scale-tuned oscillators following brightness bands) ──
    this.chordFreqs = new Float32Array(NCHORD);
    this.chordN = 0;
    this.cPhase = new Float32Array(NCHORD);
    this.cAmp = new Float32Array(NCHORD);
    this.cTarget = new Float32Array(NCHORD);
    this.cW = new Float32Array(NCHORD).fill(1); // each note's WAVES level (ramped per block)
    this.cwPh = 0;
    // NOISE : a pink noise per side, shared by every note's band-pass (TPT SVF
    // states per note per side), its level ramped per block.
    this.cNzL = new Float32Array(128); this.cNzR = new Float32Array(128);
    this.cPk = new Float64Array(6); this.cSeedL = 0x2545f491; this.cSeedR = 0x9e3779b9;
    this.cZ1L = new Float32Array(NCHORD); this.cZ2L = new Float32Array(NCHORD);
    this.cZ1R = new Float32Array(NCHORD); this.cZ2R = new Float32Array(NCHORD);
    this.cNzG = 0;
    // ── the Collage voice's Ring bank ──
    this.ring = new RingBank(sampleRate);
    this.ringF = new Float32Array(RB_N); // the Ring bank's band centres (glided here)
    // ── Key glide (the key sequencer's glide) : a pitch table slides to its new
    // values over `glide` seconds (eased, in log frequency) instead of jumping.
    // One entry per table : { cur, from, to, lr, t, dur }. Orbit and Raster have
    // one pitch each : `pg` slides them from where they were.
    this.glides = {};
    this.pg = null;
    this.obF = 0; this.raF = 0;
    this.bpm = 120; // the tempo, for synced modulation rates (sent with the mod overlay)
    // scratch (x,y) for the scan-path read (zero-alloc : written per partial)
    this.sxy = new Float32Array(2);
    // ── shared FX tail : reverb + analog delay (send/return) ──
    this.reverb = new FDNReverb(sampleRate);
    // Cache of the reverb params that force a full (per-line pow()) recompute, so
    // applyFx can skip it on send/mix-only changes — the mod overlay re-applies fx
    // ~30Hz. Sentinel -1 ⇒ the first applyFx always recomputes.
    this.rvRecompute = { size: -1, decay: -1, cross: -1, freeze: -1, low: -1, high: -1 };
    this.delay = new BBDDelay(sampleRate);
    this.fxSend = 0; this.fxSendS = 0; this.fxRinging = false; // global send + smoothing + tail ring-out
    this.fxQuiet = 0; // seconds the tail has been silent
    // ── mixer : per-voice DJ filter (volume = each voice's own gain) ──
    // Order matches the voice-render order below : spectra·orbit·flow·events·
    // raster·sstv·filter·chord. Voices render into vL/vR then flush through their
    // filter into the master (mixVoice).
    this.djf = []; for (let i = 0; i < NVOICE; i++) this.djf.push(new DJFilter()); // + Collage (input 1)
    this.vL = new Float32Array(128); this.vR = new Float32Array(128);
    // ── voice gates + gains : a voice switching on/off fades over GATE_S, and
    // its gain ramps across the block (both used to step : clicks, zipper) ──
    this.gate = new Float32Array(NVOICE);
    this.gateLive = new Uint8Array(NVOICE);
    this.gateStep = 1 / Math.max(1, GATE_S * sampleRate);
    this.vGain = new Float32Array(NVOICE).fill(-1); // -1 = not yet set : start at the target
    this.mgS = -1; // master gain, ramped the same way
    // ── limiter ──
    this.limEnv = 1;
    // ── metering (sent back ~10Hz) ──
    this.peak = 0; this.lastMeter = 0; this.limMin = 1;
    // per channel, after the limiter : the peak and the mean square (the meter's
    // bar is the RMS level in dB, its tick the peak)
    this.pkL = 0; this.pkR = 0; this.ssL = 0; this.ssR = 0; this.nMeter = 0;
    this.port.onmessage = (e) => this.onMsg(e.data);
  }

  onMsg(m) {
    if (m.t === 'grid') {
      const tap = this.taps[m.tap];
      if (!tap) return;
      const d = m.data; // Uint8Array luma
      const p = tap.prev, c = tap.cur;
      if (tap.mix < 1) {
        // The last crossfade hadn't finished (ticks alternate 33 / 50 ms) : start
        // the new one from what is heard now, prev↔cur at the current mix,
        // instead of jumping to cur.
        const mx = tap.mix;
        for (let i = 0; i < p.length; i++) p[i] += (c[i] - p[i]) * mx;
        for (let i = 0; i < c.length; i++) c[i] = d[i] * 0.00392156862745098;
      } else {
        // prev <- cur, cur <- new (converted)
        tap.prev = c; tap.cur = p;
        for (let i = 0; i < p.length; i++) p[i] = d[i] * 0.00392156862745098;
      }
      tap.mix = 0; tap.mix0 = 0;
      // reach mix=1 over ~one frame interval (given ~375 quanta/s)
      tap.mixStep = Math.min(1, (m.dt || 0.033) > 0 ? (128 / sampleRate) / (m.dt || 0.033) : 0.25);
      tap.has = true;
      return;
    }
    if (m.t === 'cfg') {
      sanitize(m.cfg, this.cfg);
      const prev = this.cfg;
      this.cfg = m.cfg;
      const gl = m.glide > 0 ? Math.min(8, m.glide) : 0;
      if (m.spectraFreqs) this.retune('sp', this.spectraFreqs, m.spectraFreqs, gl);
      if (m.filterFreqs && this.retune('fl', this.fFreqs, m.filterFreqs, gl)) this.rebuildFilterCoefs();
      if (m.chordFreqs) {
        const n = Math.min(NCHORD, m.chordFreqs.length);
        if (n !== this.chordN) {
          // a new voice count : a new chord, at once
          delete this.glides.ch;
          this.chordN = n; this.chordFreqs.set(m.chordFreqs.subarray(0, n));
        } else this.retune('ch', this.chordFreqs.subarray(0, n), m.chordFreqs, gl);
      }
      if (m.ringFreqs && this.retune('rg', this.ringF, m.ringFreqs, gl)) this.ring.setFreqs(this.ringF);
      // Orbit / Raster : a key change slides their pitch from where it is.
      if (gl > 0 && (m.cfg.orbit.freq !== prev.orbit.freq || m.cfg.raster.freq !== prev.raster.freq)) {
        this.pg = { t: 0, dur: gl, ob: this.obF || prev.orbit.freq, ra: this.raF || prev.raster.freq };
      }
      if (m.cfg.fx) this.applyFx(m.cfg.fx);
      if (m.cfg.mixFilter) for (let i = 0; i < NVOICE; i++) this.djf[i].setX(m.cfg.mixFilter[i] != null ? m.cfg.mixFilter[i] : 0.5, sampleRate);
      return;
    }
    if (m.t === 'mod') {
      // Per-tick probe overlay : shallow-merge effective values into the live
      // voice configs (sent every tick, so releases revert cleanly).
      const mm = m.m;
      if (typeof m.bpm === 'number' && m.bpm > 0 && Number.isFinite(m.bpm)) this.bpm = m.bpm;
      sanitize(mm, this.cfg);
      for (const k in mm) {
        const dst = this.cfg[k];
        if (dst) Object.assign(dst, mm[k]);
      }
      // fx params drive the reverb/delay objects (not read live) → re-apply.
      if (mm.fx && this.cfg.fx) this.applyFx(this.cfg.fx);
      return;
    }
    if (m.t === 'flow') {
      // events: flat Float32Array [tOffset, freq, amp, pan, bright, warm] × n
      // (already dithered + quantized by the main thread; bright/warm = colour)
      // APPENDED : grains dithered late in the last frame are still due when the
      // next batch arrives early. Capped (oldest out) in case nothing drains it.
      const ev = m.events;
      const base = currentTime;
      for (let i = 0; i + 5 < ev.length; i += 6) {
        this.pending.push({ t0: base + ev[i], freq: ev[i + 1], amp: ev[i + 2], pan: ev[i + 3], bright: ev[i + 4], warm: ev[i + 5] });
      }
      if (this.pending.length > PENDING_CAP) this.pending.splice(0, this.pending.length - PENDING_CAP);
      return;
    }
    if (m.t === 'signal') {
      // [tOffset, freq, amp, pan] × n : one scan window of onsets, timed by the
      // main thread to the step (not dithered), so the spacing is the clock's.
      const ev = m.events;
      const base = currentTime;
      for (let i = 0; i + 3 < ev.length; i += 4) {
        this.sigPending.push({ t0: base + ev[i], freq: ev[i + 1], amp: ev[i + 2], pan: ev[i + 3] });
      }
      if (this.sigPending.length > PENDING_CAP) this.sigPending.splice(0, this.sigPending.length - PENDING_CAP);
      return;
    }
    if (m.t === 'events') {
      // events: flat Float32Array [tOffset, freq, amp, pan] × n (dithered +
      // quantized by the main thread) → scheduled discrete note onsets.
      const ev = m.events;
      const base = currentTime;
      for (let i = 0; i + 3 < ev.length; i += 4) {
        this.evPending.push({ t0: base + ev[i], freq: ev[i + 1], amp: ev[i + 2], pan: ev[i + 3] });
      }
      if (this.evPending.length > PENDING_CAP) this.evPending.splice(0, this.evPending.length - PENDING_CAP);
      return;
    }
  }

  // Bilinear sample of a tap's interpolated grid at normalized (x, y).
  terrain(tap, x, y) { return this.terrainM(tap, x, y, tap.mix); }
  terrainM(tap, x, y, m) {
    if (!tap.has) return 0;
    x = x < 0 ? 0 : x > 1 ? 1 : x;
    y = y < 0 ? 0 : y > 1 ? 1 : y;
    const fx = x * (GRID - 1), fy = y * (GRID - 1);
    const x0 = fx | 0, y0 = fy | 0;
    const x1 = x0 + 1 < GRID ? x0 + 1 : x0, y1 = y0 + 1 < GRID ? y0 + 1 : y0;
    const ax = fx - x0, ay = fy - y0;
    const i00 = y0 * GRID + x0, i10 = y0 * GRID + x1, i01 = y1 * GRID + x0, i11 = y1 * GRID + x1;
    const c = tap.cur, pv = tap.prev;
    const sc = (c[i00] * (1 - ax) + c[i10] * ax) * (1 - ay) + (c[i01] * (1 - ax) + c[i11] * ax) * ay;
    const sp = (pv[i00] * (1 - ax) + pv[i10] * ax) * (1 - ay) + (pv[i01] * (1 - ax) + pv[i11] * ax) * ay;
    return sp + (sc - sp) * m;
  }

  // Breathing rubato : warp a linear sweep phase (0..1) so the read slows at the
  // edges and rushes the middle, WITHOUT changing the cycle period (BPM-sync safe :
  // warp(0)=0, warp(1)=1). pace 0 = even. Monotonic while pace < 1.
  warpPace(lin, pace) {
    if (pace < 0.005) return lin;
    return lin - pace * Math.sin(lin * TAU) / TAU;
  }

  // Where a scanning voice's partial samples the frame, by reading PATH. `pos` is
  // the (paced) sweep phase 0..1; `pp` is the partial fraction 0 (low pitch) → 1
  // (high). Writes into this.sxy. 0 horizontal (a column swept in x — the classic
  // vOICe read), 1 vertical (a row swept in y), 2 radial (a ray from centre that
  // rotates : pitch = radius), 3 spiral (the ray winds outward AND rotates).
  scanXY(path, pos, pp) {
    const s = this.sxy;
    if (path === 1) { s[0] = pp; s[1] = pos; }
    else if (path === 2) { const a = pos * TAU, r = pp * 0.48; s[0] = 0.5 + r * Math.cos(a); s[1] = 0.5 + r * Math.sin(a); }
    else if (path === 3) { const a = pos * TAU + pp * TAU * 2.5, r = pp * 0.48; s[0] = 0.5 + r * Math.cos(a); s[1] = 0.5 + r * Math.sin(a); }
    else { s[0] = pos; s[1] = 1 - pp; }
  }

  /** A pitch table's new values : at once (no glide, a first fill), or sliding
   *  over `gl` seconds. True when `cur` changed now. The tables come with every
   *  config (any slider move) : one re-sent unchanged leaves a glide alone. */
  retune(key, cur, next, gl) {
    const n = cur.length;
    if (next.length < n) return false;
    const g = this.glides[key];
    const same = (a) => { for (let i = 0; i < n; i++) if (a[i] !== next[i]) return false; return true; };
    if (g ? same(g.to) : same(cur)) return false;
    let ok = gl > 0;
    for (let i = 0; ok && i < n; i++) if (!(cur[i] > 1) || !(next[i] > 1)) ok = false;
    if (!ok) {
      delete this.glides[key];
      for (let i = 0; i < n; i++) cur[i] = next[i];
      return true;
    }
    const from = Float32Array.from(cur), to = new Float32Array(n), lr = new Float32Array(n);
    for (let i = 0; i < n; i++) { to[i] = next[i]; lr[i] = Math.log(to[i] / from[i]); }
    this.glides[key] = { cur, from, to, lr, t: 0, dur: gl };
    return false;
  }

  /** Per block : the running glides take their next step. */
  stepGlides(n) {
    const dt = n / sampleRate;
    for (const key in this.glides) {
      const g = this.glides[key];
      g.t += dt;
      const u = Math.min(1, g.t / g.dur), e = u * u * (3 - 2 * u);
      const c = g.cur, f = g.from, lr = g.lr;
      if (u >= 1) { for (let i = 0; i < c.length; i++) c[i] = g.to[i]; delete this.glides[key]; }
      else for (let i = 0; i < c.length; i++) c[i] = f[i] * Math.exp(lr[i] * e);
      if (key === 'fl') this.rebuildFilterCoefs();
      // the bank's make-up gain is measured again every 16th block and at the end
      else if (key === 'rg') this.ring.setFreqs(c, u >= 1 || (this.block & 15) === 0);
    }
    if (this.pg) { this.pg.t += dt; if (this.pg.t >= this.pg.dur) this.pg = null; }
  }

  /** Orbit / Raster's pitch this block : the config's, or sliding to it. */
  glidePitch(which, target) {
    const pg = this.pg;
    let f = target;
    if (pg && pg[which] > 1 && target > 1) {
      const u = Math.min(1, pg.t / pg.dur), e = u * u * (3 - 2 * u);
      f = pg[which] * Math.pow(target / pg[which], e);
    }
    if (which === 'ob') this.obF = f; else this.raF = f;
    return f;
  }

  rebuildFilterCoefs() {
    // The Chamberlin SVF is only stable while its centre stays below ~sr/6 (the
    // worst case is minimum resonance). Cap at sr/6.5 — the same guard the Raster
    // tone filter uses — so raising root octave / hiOct can't push a band past the
    // stable region and blow fLow/fBand to Inf→NaN. (A far-above cap of sr*0.45
    // gave no protection and latched the whole voice to silence.)
    // Bands above the cap drop by octaves (same note, lower) : clamped, they all
    // stacked on the cap's one frequency and summed into a whistle.
    const cap = sampleRate / 6.5;
    for (let i = 0; i < NBAND; i++) {
      let f = this.fFreqs[i];
      while (f > cap) f *= 0.5;
      this.fCoef[i] = 2 * Math.sin(Math.PI * f / sampleRate);
    }
  }

  // Apply the shared FX-tail params (send + delay + reverb) onto the DSP objects.
  applyFx(fx) {
    this.fxSend = clampf(fx.send || 0, 0, 1);
    const dl = this.delay;
    dl.mix = clampf(fx.dlyMix, 0, 1); dl.rate = clampf(fx.dlyTime, 0.004, 4);
    dl.fb = clampf(fx.dlyFb, 0, 0.95); dl.tone = clampf(fx.dlyTone, 0, 1); dl.mode = fx.dlyMode | 0;
    const rv = this.reverb;
    rv.mode = fx.rvMode ? 1 : 0;
    rv.size = clampf(fx.rvSize, 0, 1); rv.decay = clampf(fx.rvDecay, 0, 1); rv.damp = clampf(fx.rvDamp, 0, 1);
    rv.mix = clampf(fx.rvMix, 0, 1);
    rv.predelay_ms = clampf(fx.rvPre, 0, 255); rv.mod_depth = clampf(fx.rvMod, 0, 40);
    rv.mod_rate = clampf(fx.rvModRate, 0.01, 8); rv.width = clampf(fx.rvWidth, 0, 1);
    rv.locut_hz = clampf(fx.rvLocut, 20, 2000); rv.freeze = fx.rvFreeze ? 1 : 0;
    rv.diffusion = clampf(fx.rvDiff, 0, 1); rv.low_damp = clampf(fx.rvLowDamp, 0, 1);
    rv.crossover = clampf(fx.rvCross, 0, 1);
    rv.lowmult = clampf(fx.rvLowMult, 0.05, 8); rv.highmult = clampf(fx.rvHighMult, 0.05, 8);
    // Only size/decay/crossover/freeze/low-high-mult change the line lengths and
    // per-line decay gains; everything else applied above is read live in
    // process(). The ~30Hz mod overlay re-applies fx every tick, so skip the
    // recompute (per-line pow()) unless one of those params actually moved.
    const rc = this.rvRecompute;
    if (rv.size !== rc.size || rv.decay !== rc.decay || rv.crossover !== rc.cross ||
      rv.freeze !== rc.freeze || rv.lowmult !== rc.low || rv.highmult !== rc.high) {
      rc.size = rv.size; rc.decay = rv.decay; rc.cross = rv.crossover;
      rc.freeze = rv.freeze; rc.low = rv.lowmult; rc.high = rv.highmult;
      rv.recompute();
    }
  }

  // Whether voice `idx` renders this block : while it's on, and while its gate
  // is still fading out after it went off. A voice coming back from silence
  // starts clean (voiceStart).
  voiceLive(idx, on) {
    const live = on || this.gate[idx] > 0;
    if (live && !this.gateLive[idx]) this.voiceStart(idx);
    this.gateLive[idx] = live ? 1 : 0;
    return live;
  }
  // A voice switching back on : no old amplitudes to restart at full level, no
  // onsets queued while it was off all firing in its first block.
  voiceStart(idx) {
    const now = currentTime;
    if (idx === 0) this.sAmp.fill(0);
    else if (idx === 2) { for (let g = 0; g < NGRAIN; g++) this.grains[g].on = false; dropStale(this.pending, now); }
    else if (idx === 3) { for (let k = 0; k < NEVENT; k++) this.notes[k].on = false; dropStale(this.evPending, now); this.evDcL = this.evDcR = 0; }
    else if (idx === 7) this.cAmp.fill(0);
    else if (idx === 9) { for (let k = 0; k < NSIG; k++) this.sig[k].on = false; dropStale(this.sigPending, now); this.sgDcL = this.sgDcR = 0; }
  }

  // Flush a voice's scratch (vL/vR) through its gate, gain and DJ filter into
  // the master, then zero the scratch so the next voice starts clean.
  mixVoice(idx, on, gain, vL, vR, outL, outR, n) {
    const f = this.djf[idx];
    f.update(); // glide the DJ-filter cutoff toward its target (anti-pop)
    let g = this.gate[idx];
    const gt = on ? 1 : 0, gs = this.gateStep;
    const v1 = clampf(gain, 0, 4);
    let v0 = this.vGain[idx]; if (v0 < 0) v0 = v1;
    const dv = (v1 - v0) / n;
    // Sanitize : a bad param can make a voice go NaN/Inf; if that reached the
    // master or the FX-tail feedback it would silence everything permanently.
    for (let s = 0; s < n; s++) {
      let l = vL[s], r = vR[s];
      if (!Number.isFinite(l)) l = 0;
      if (!Number.isFinite(r)) r = 0;
      if (g !== gt) g = g < gt ? (g + gs < gt ? g + gs : gt) : (g - gs > gt ? g - gs : gt);
      const k = g * (v0 + dv * (s + 1));
      l = f.procL(l * k); r = f.procR(r * k); // always filter (unity in bypass) : keeps state warm, click-free
      outL[s] += l; outR[s] += r; vL[s] = 0; vR[s] = 0;
    }
    this.gate[idx] = g; this.vGain[idx] = v1;
  }

  // Nearest-pixel read of a tap's CURRENT grid (the Raster voice wants the
  // hard, aliased read — no interframe smoothing, that's the register).
  rawPixel(tap, ix, iy) {
    if (!tap.has) return 0;
    ix = ix < 0 ? 0 : ix >= GRID ? GRID - 1 : ix;
    iy = iy < 0 ? 0 : iy >= GRID ? GRID - 1 : iy;
    return tap.cur[iy * GRID + ix];
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const outL = out[0], outR = out[1] || out[0];
    const n = outL.length;
    outL.fill(0); if (outR !== outL) outR.fill(0);
    // Voices render into a per-voice scratch (L/R), then flush through their DJ
    // filter into the master (outL/outR) via mixVoice — see the constructor.
    const L = this.vL, R = this.vR;
    const cfg = this.cfg;
    const dt = 1 / sampleRate;
    const nyq = NYQ_FRAC * sampleRate;
    this.block++;
    this.stepGlides(n);

    // Advance each tap's frame-interpolation ramp (prev → cur crossfade) :
    // one step per quantum, sized on receipt to span one video frame.
    for (let t = 0; t < this.taps.length; t++) {
      const tap = this.taps[t];
      tap.mix0 = tap.mix;
      if (tap.mix < 1) tap.mix = Math.min(1, tap.mix + tap.mixStep);
    }

    // ── SPECTRA : partial bank riding a column of the frame ──
    const sp = cfg.spectra;
    const spLive = this.voiceLive(0, sp.on);
    if (spLive) {
      const tap = this.taps[sp.tap] || this.taps[0];
      // advance the sweep once per quantum (375Hz update is plenty)
      if (sp.sweepOn) {
        this.sweepPos = (this.sweepPos + sp.sweepHz * n * dt) % 1;
      } else {
        this.sweepPos = sp.x;
      }
      // reading path : each partial samples along the chosen trajectory (breathing
      // pace warps the sweep phase). pp 0 = low pitch … 1 = high (image top).
      const pos = sp.sweepOn ? this.warpPace(this.sweepPos, sp.pace || 0) : this.sweepPos;
      const path = sp.path | 0;
      for (let i = 0; i < NPART; i++) {
        this.scanXY(path, pos, (i + 0.5) / NPART);
        const v = this.terrain(tap, this.sxy[0], this.sxy[1]);
        // a partial past Nyquist is silent (it would fold back out of key)
        this.sTarget[i] = this.spectraFreqs[i] > nyq ? 0 : Math.pow(v, sp.gamma);
      }
      // synthesize : slewed additive bank (slew kills zipper + clicks)
      const slew = 1 - Math.exp(-n * dt / 0.02);
      const gL = (1 - Math.max(0, sp.pan)) * 0.12;
      const gR = (1 + Math.min(0, sp.pan)) * 0.12;
      for (let i = 0; i < NPART; i++) {
        let a0 = this.sAmp[i] + (this.sTarget[i] - this.sAmp[i]) * slew;
        if (!(a0 > 1e-12)) a0 = 0; // NaN and denormals → 0
        this.sAmp[i] = a0;
        if (a0 < 0.003) { // silent partial : keep phase running cheaply
          this.sPhase[i] = (this.sPhase[i] + this.spectraFreqs[i] * n * dt) % 1;
          continue;
        }
        let ph = this.sPhase[i];
        const inc = this.spectraFreqs[i] * dt;
        const br = sp.breath || 0;
        if (br > 0.005) {
          // BREATH (the Coagula blue) : lowpassed noise jitters each partial's
          // instantaneous frequency (widens the line into a narrow band) and
          // flutters its amplitude — sine → breathy band per partial.
          let nz = this.sNz[i];
          for (let s = 0; s < n; s++) {
            nz = nz * 0.985 + noise() * 0.015;
            const v = sinT(ph) * a0 * (1 + br * nz * 6);
            L[s] += v * gL; R[s] += v * gR;
            ph += inc * (1 + br * nz * 3);
          }
          this.sNz[i] = nz;
        } else {
          for (let s = 0; s < n; s++) {
            const v = sinT(ph) * a0;
            L[s] += v * gL; R[s] += v * gR;
            ph += inc;
          }
        }
        this.sPhase[i] = ph % 1;
      }
    }

    if (spLive) this.mixVoice(0, sp.on, sp.gain, L, R, outL, outR, n);

    // ── ORBIT : wave terrain — the frame IS the waveform ──
    const ob = cfg.orbit;
    const obLive = this.voiceLive(1, ob.on);
    if (obLive) {
      const tap = this.taps[ob.tap] || this.taps[0];
      const inc = this.glidePitch('ob', ob.freq) * dt;
      const gL = (1 - Math.max(0, ob.pan)) * 0.8;
      const gR = (1 + Math.min(0, ob.pan)) * 0.8;
      const sm = Math.pow(0.5, 1 / (1 + ob.smooth * 48)); // one-pole smooth
      const ratio = ob.ratio;
      // the frame crossfade, ramped per SAMPLE here (a per-block step was a
      // 375 Hz staircase in a voice that reads the image at audio rate)
      const m0 = tap.mix0, dm = (tap.mix - tap.mix0) / n;
      for (let s = 0; s < n; s++) {
        this.oPhase += inc;
        const x = ob.cx + ob.rx * Math.cos(this.oPhase * TAU);
        const y = ob.cy + ob.ry * Math.sin((this.oPhase * ratio + this.oYOff) * TAU);
        let v = this.terrainM(tap, x, y, m0 + dm * (s + 1));
        // one-pole smooth (band-limits the terrain edges a touch)
        this.oSlew = this.oSlew * sm + v * (1 - sm);
        v = this.oSlew;
        // DC-block : the image mean is a big DC offset
        const hp = v - this.dcX + 0.995 * this.dcY;
        this.dcX = v; this.dcY = hp;
        const shaped = Math.tanh(hp * ob.drive * 3);
        L[s] += shaped * gL; R[s] += shaped * gR;
      }
      // Wrap x every block and carry the whole cycles into the y phase : the old
      // `oPhase %= 1` at 1e6 dropped cycles from x but not from x·ratio, and a
      // Lissajous jumped up to half a cycle.
      const k = Math.floor(this.oPhase);
      if (k) { this.oPhase -= k; this.oYOff = (this.oYOff + k * ratio) % 1; }
    }

    if (obLive) this.mixVoice(1, ob.on, ob.gain, L, R, outL, outR, n);

    // ── FLOW : grain cloud from the motion field ──
    const fl = cfg.flow;
    const flLive = this.voiceLive(2, fl.on);
    if (flLive) {
      // activate pending events whose time has come, retaining the rest by
      // compacting in place (a write index) — Array.splice would allocate a
      // throwaway array on every removal inside this render quantum.
      const nowT = currentTime;
      let pw = 0;
      for (let i = 0; i < this.pending.length; i++) {
        const ev = this.pending[i];
        if (ev.t0 <= nowT + n * dt) {
          for (let g = 0; g < NGRAIN; g++) {
            const gr = this.grains[g];
            if (!gr.on) {
              gr.on = true; gr.age = 0; gr.phase = Math.random();
              let f = ev.freq; while (f > nyq) f *= 0.5; // past Nyquist : an octave down, same note
              gr.inc = f * dt;
              gr.amp = ev.amp; gr.pan = ev.pan;
              gr.dur = fl.dur * (0.7 + Math.random() * 0.6);
              gr.invDur = 1 / gr.dur;
              gr.noise = fl.noise;
              // colour → timbre : bright = waveshape drive, warm picks the tint
              // partial (sub-octave body when warm, octave-up shimmer when cool).
              gr.bright = ev.bright || 0;
              gr.warm = ev.warm || 0;
              gr.phase2 = Math.random();
              gr.inc2 = gr.inc * (gr.warm >= 0 ? 0.5 : 2);
              while (gr.inc2 > NYQ_FRAC) gr.inc2 *= 0.5;
              break;
            }
          }
        } else {
          this.pending[pw++] = ev; // not yet due : retain
        }
      }
      this.pending.length = pw;
      const g0 = 0.5;
      const colAmt = fl.colour || 0;
      const fpan = (fl.pan || 0) * 0.5; // the voice's pan shifts every grain, as Events does
      for (let g = 0; g < NGRAIN; g++) {
        const gr = this.grains[g];
        if (!gr.on) continue;
        let gp = gr.pan + fpan; gp = gp < 0 ? 0 : gp > 1 ? 1 : gp;
        const gL = g0 * panGL(gp);
        const gR = g0 * panGR(gp);
        // colour → timbre (0 when colour off ⇒ identical to the plain grain).
        const eb = gr.bright * colAmt; // waveshape drive : vivid colour = edgier
        const tintAmt = Math.abs(gr.warm) * colAmt * 0.5; // sub-oct / oct-up blend
        const gn = gr.noise, inv = gr.invDur;
        for (let s = 0; s < n; s++) {
          gr.age += dt;
          if (gr.age >= gr.dur) { gr.on = false; break; }
          // raised-cosine envelope : 0.5 - 0.5·cos(2πu) = sin²(πu)
          const se = sinT(gr.age * inv * 0.5);
          const e = se * se;
          let s0 = sinT(gr.phase);
          if (eb > 0.001) s0 = s0 * (1 - eb) + tab(SH35_T, gr.phase) * eb * 0.85; // brighten : tanh(3.5·sin)
          if (tintAmt > 0.001) { s0 = s0 * (1 - tintAmt) + sinT(gr.phase2) * tintAmt; gr.phase2 += gr.inc2; }
          // sine + a breath of noise
          const nz = gn > 0 ? noise() * gn : 0;
          const v = (s0 * (1 - gn) + nz) * e * gr.amp;
          gr.phase += gr.inc;
          L[s] += v * gL; R[s] += v * gR;
        }
      }
    }

    if (flLive) this.mixVoice(2, fl.on, fl.gain, L, R, outL, outR, n);

    // ── EVENTS : edges / motion → plucked notes (Aural-Mirror register) ──
    const ev = cfg.events;
    const evLive = this.voiceLive(3, ev.on);
    if (evLive) {
      // fire scheduled onsets whose time has come, retaining the rest by
      // compacting in place (a write index) — splice would allocate a throwaway
      // array on every removal inside this render quantum.
      const nowT = currentTime;
      const wave = ev.wave | 0;
      let ew = 0;
      for (let i = 0; i < this.evPending.length; i++) {
        const e = this.evPending[i];
        if (e.t0 <= nowT + n * dt) {
          // grab a free voice, else steal the quietest one NOT started in this
          // block (a note that had just begun read as the quietest, so several
          // onsets due in one block overwrote the same voice and only the last
          // sounded). The stolen note's last sample fades out over ~3 ms.
          let slot = -1;
          for (let k = 0; k < NEVENT; k++) if (!this.notes[k].on) { slot = k; break; }
          if (slot < 0) {
            let quiet = 1e9;
            for (let k = 0; k < NEVENT; k++) {
              const nt2 = this.notes[k];
              if (nt2.born !== this.block && nt2.env < quiet) { quiet = nt2.env; slot = k; }
            }
            if (slot < 0) continue; // the whole pool started this block : drop it
            this.evDcL += this.notes[slot].lastL; this.evDcR += this.notes[slot].lastR;
          }
          const nt = this.notes[slot];
          // decay time : base 0.05..2.5s, shortened for high notes when `highs`>0
          let f = e.freq < 20 ? 20 : e.freq;
          while (f > nyq) f *= 0.5; // past Nyquist : an octave down (its phase used to run away)
          const baseDecay = 0.05 + ev.decay * 2.45;
          const factor = ev.highs > 0.001 ? Math.pow(220 / f, ev.highs * 1.5) : 1;
          const decayTime = Math.max(0.03, Math.min(6, baseDecay * factor));
          nt.on = true; nt.phase = 0; nt.inc = f * dt; nt.born = this.block;
          nt.amp = e.amp; nt.pan = e.pan; nt.wave = wave;
          nt.env = 0; nt.attacking = true;
          nt.atkInc = 1 / Math.max(1, 0.004 * sampleRate); // ~4ms attack
          nt.decMul = Math.exp(-6.9077552 / (decayTime * sampleRate)); // ≈ -60dB over decayTime
        } else {
          this.evPending[ew++] = e; // not yet due : retain
        }
      }
      this.evPending.length = ew;
      const g0 = 0.5;
      const bias = ev.pan * 0.5;
      // saw / square carry more energy — trim so they don't dominate the mix.
      const wg = wave === 3 ? 0.5 : wave === 2 ? 0.7 : 1;
      for (let k = 0; k < NEVENT; k++) {
        const nt = this.notes[k];
        if (!nt.on) continue;
        let p = nt.pan + bias; p = p < 0 ? 0 : p > 1 ? 1 : p;
        const gL = g0 * panGL(p) * wg, gR = g0 * panGR(p) * wg;
        let lv = 0;
        for (let s = 0; s < n; s++) {
          if (nt.attacking) { nt.env += nt.atkInc; if (nt.env >= 1) { nt.env = 1; nt.attacking = false; } }
          else { nt.env *= nt.decMul; if (nt.env < 0.0004) { nt.on = false; break; } }
          const ph = nt.phase;
          let sig;
          if (wave === 0) sig = sinT(ph);
          else if (wave === 1) { const tr = ph < 0.5 ? ph * 2 : 2 - ph * 2; sig = tr * 2 - 1; } // triangle
          else if (wave === 2) sig = ph * 2 - 1; // saw
          else sig = ph < 0.5 ? 1 : -1; // square
          const v = sig * nt.env * nt.amp;
          nt.phase += nt.inc; if (nt.phase >= 1) nt.phase -= 1;
          L[s] += v * gL; R[s] += v * gR;
          lv = v;
        }
        nt.lastL = lv * gL; nt.lastR = lv * gR;
      }
      // the stolen notes' tails (a decaying offset from their last sample)
      if (this.evDcL !== 0 || this.evDcR !== 0) {
        let dl = this.evDcL, dr = this.evDcR;
        const k = this.evDcK;
        for (let s = 0; s < n; s++) { L[s] += dl; R[s] += dr; dl *= k; dr *= k; }
        this.evDcL = Math.abs(dl) < 1e-7 ? 0 : dl; this.evDcR = Math.abs(dr) < 1e-7 ? 0 : dr;
      }
    }

    if (evLive) this.mixVoice(3, ev.on, ev.gain, L, R, outL, outR, n);

    // ── RASTER : audification — the probe rect read row-major as samples ──
    const ra = cfg.raster;
    const raLive = this.voiceLive(4, ra.on);
    if (raLive) {
      const tap = this.taps[ra.tap] || this.taps[0];
      const px0 = Math.max(0, Math.min(GRID - 2, Math.round(ra.rx * GRID)));
      const py0 = Math.max(0, Math.min(GRID - 2, Math.round(ra.ry * GRID)));
      const pw = Math.max(2, Math.min(GRID - px0, Math.round(ra.rw * GRID)));
      const ph = Math.max(1, Math.min(GRID - py0, Math.round(ra.rh * GRID)));
      const nPix = pw * ph;
      // scan rate in pixels/sec so one full pass of the rect = the period :
      // pitch = freq, timbre = the rect's contents (Yeo/Berger geometry).
      const step = this.glidePitch('ra', ra.freq) * nPix * dt;
      const gL = (1 - Math.max(0, ra.pan)) * 0.7;
      const gR = (1 + Math.min(0, ra.pan)) * 0.7;
      // TONE : a 12dB/oct lowpass tames the read's aliased edges. Log sweep
      // 300Hz → 8kHz (the Chamberlin SVF is only stable below ~sr/6);
      // at the top of the dial the filter is BYPASSED (truly open), reached
      // by a crossfade over the last 2% (a hard switch clicked when modulated).
      const openMix = clampf((ra.tone - 0.97) / 0.02, 0, 1);
      const fc = 300 * Math.pow(8000 / 300, Math.max(0, Math.min(1, ra.tone)));
      const rc = 2 * Math.sin(Math.PI * Math.min(fc, sampleRate / 6.5) / sampleRate);
      let ptr = this.rPtr;
      for (let s = 0; s < n; s++) {
        ptr += step;
        if (ptr >= nPix) ptr -= Math.floor(ptr / nPix) * nPix;
        const i0 = ptr | 0;
        let v;
        if (ra.smooth > 0.01) {
          const i1 = (i0 + 1) % nPix;
          const fr = ptr - i0;
          const a = this.rawPixel(tap, px0 + (i0 % pw), py0 + ((i0 / pw) | 0));
          const b = this.rawPixel(tap, px0 + (i1 % pw), py0 + ((i1 / pw) | 0));
          const lin = a + (b - a) * fr;
          v = a + (lin - a) * ra.smooth;
        } else {
          v = this.rawPixel(tap, px0 + (i0 % pw), py0 + ((i0 / pw) | 0)); // hard/aliased
        }
        v = v * 2 - 1;
        // DC-block (the rect's mean brightness is pure DC)
        const hp = v - this.rDcX + 0.995 * this.rDcY;
        this.rDcX = v; this.rDcY = hp;
        // tone lowpass (SVF, ~Butterworth damping) then clip
        this.rLow += rc * this.rBand;
        const rHigh = hp - this.rLow - this.rBand;
        this.rBand += rc * rHigh;
        const shaped = Math.max(-1, Math.min(1, (this.rLow + (hp - this.rLow) * openMix) * 1.4));
        L[s] += shaped * gL; R[s] += shaped * gR;
      }
      this.rPtr = ptr;
    }

    if (raLive) this.mixVoice(4, ra.on, ra.gain, L, R, outL, outR, n);

    // ── TRANSMISSION : the SSTV register — line-sequential FM + sync tick ──
    const tv = cfg.sstv;
    const tvLive = this.voiceLive(5, tv.on);
    if (tvLive) {
      const tap = this.taps[tv.tap] || this.taps[0];
      const lineDur = 1 / Math.max(0.5, tv.lineHz); // seconds per line
      const syncFrac = Math.min(0.25, 0.005 / lineDur); // ~5ms sync pulse
      const gL = (1 - Math.max(0, tv.pan)) * 0.5;
      const gR = (1 + Math.min(0, tv.pan)) * 0.5;
      for (let s = 0; s < n; s++) {
        this.tX += dt / lineDur;
        if (this.tX >= 1) {
          this.tX -= 1;
          this.tLine = (this.tLine + 1) % GRID;
        }
        let f, amp;
        if (this.tX < syncFrac) {
          f = 1200 * tv.dev; // the horizontal-sync tick : the metronome
          amp = 0.7 + tv.syncLev * 0.3;
        } else {
          const u = (this.tX - syncFrac) / (1 - syncFrac);
          const luma = this.rawPixel(tap, (u * (GRID - 1)) | 0, this.tLine);
          f = (1500 + luma * 800) * tv.dev; // black 1500Hz → white 2300Hz
          amp = 0.55 + luma * 0.45;
        }
        this.tPhase += f * dt;
        const v = sinT(this.tPhase) * amp;
        L[s] += v * gL; R[s] += v * gR;
      }
      this.tPhase -= Math.floor(this.tPhase);
    }

    if (tvLive) this.mixVoice(5, tv.on, tv.gain, L, R, outL, outR, n);

    // ── FILTER : the image as a band-gain matrix over noise / line-in ──
    const fi = cfg.filter;
    const fiLive = this.voiceLive(6, fi.on);
    if (fiLive) {
      const tap = this.taps[fi.tap] || this.taps[0];
      const input = _inputs[0] && _inputs[0][0] ? _inputs[0][0] : null;
      if (fi.sweepOn) this.fSweep = (this.fSweep + fi.sweepHz * n * dt) % 1;
      else this.fSweep = fi.x;
      // band gains along the reading path (breathing pace warps the sweep phase),
      // pp 0 = low band … 1 = high, slewed.
      const fpos = fi.sweepOn ? this.warpPace(this.fSweep, fi.pace || 0) : this.fSweep;
      const fpath = fi.path | 0;
      for (let i = 0; i < NBAND; i++) {
        this.scanXY(fpath, fpos, (i + 0.5) / NBAND);
        this.fTarget[i] = Math.pow(this.terrain(tap, this.sxy[0], this.sxy[1]), fi.gamma);
      }
      const slew = 1 - Math.exp(-n * dt / 0.03);
      const q1 = 1.5 - fi.q * 1.35; // damping : wide/windy → narrow/flute
      const gL = (1 - Math.max(0, fi.pan)) * 0.9;
      const gR = (1 + Math.min(0, fi.pan)) * 0.9;
      for (let i = 0; i < NBAND; i++) {
        const gg = this.fGain[i] + (this.fTarget[i] - this.fGain[i]) * slew;
        this.fGain[i] = gg > 1e-12 ? gg : 0; // NaN and denormals → 0
      }
      // loop 0 = free noise; up = a frozen stretch replayed, ~400 ms down to 5 ms
      const loop = fi.loop || 0;
      const loopLen = loop > 0.001
        ? Math.max(64, Math.min(this.fLoopBuf.length, Math.round(sampleRate * 0.4 * Math.pow(0.0125, loop))))
        : 0;
      const nAmt = fi.noise * 0.5;
      for (let s = 0; s < n; s++) {
        // source : line-in when connected, plus an internal noise floor
        let w;
        if (loopLen) { if (this.fLoopPos >= loopLen) this.fLoopPos = 0; w = this.fLoopBuf[this.fLoopPos++]; }
        else w = noise();
        const x = (input ? input[s] : 0) + w * nAmt;
        let acc = 0;
        for (let i = 0; i < NBAND; i++) {
          const f = this.fCoef[i];
          this.fLow[i] += f * this.fBand[i];
          const high = x - this.fLow[i] - q1 * this.fBand[i];
          this.fBand[i] += f * high;
          acc += this.fBand[i] * this.fGain[i];
        }
        const v = Math.tanh(acc * 0.7);
        L[s] += v * gL; R[s] += v * gR;
      }
      // Self-heal : if any band state went non-finite (a NaN line-in sample, or a
      // transient past the stable region), zero the SVF state so the voice recovers
      // next block. mixVoice sanitizes the OUTPUT but never this internal state —
      // which is why an unguarded NaN here used to latch the Filter to silence.
      for (let i = 0; i < NBAND; i++) {
        const b = this.fBand[i], lo = this.fLow[i];
        if (!Number.isFinite(b) || !Number.isFinite(lo)) {
          this.fLow.fill(0); this.fBand.fill(0);
          break;
        }
        // flush denormals (a silent input decays the state into them)
        if (b > -1e-20 && b < 1e-20) this.fBand[i] = 0;
        if (lo > -1e-20 && lo < 1e-20) this.fLow[i] = 0;
      }
    }

    if (fiLive) this.mixVoice(6, fi.on, fi.gain, L, R, outL, outR, n);

    // ── CHORD : scale-tuned bank following the frame's brightness bands ──
    const ch = cfg.chord;
    const chLive = this.voiceLive(7, ch.on && this.chordN > 0);
    if (chLive) {
      const tap = this.taps[ch.tap] || this.taps[0];
      const N = this.chordN;
      // control-rate targets : voice i = avg brightness of its horizontal band
      // (voice 0 = low pitch = image bottom … N-1 = high = top), gamma-shaped.
      for (let i = 0; i < N; i++) {
        const y0 = 1 - (i + 1) / N, y1 = 1 - i / N;
        let sum = 0, cnt = 0;
        for (let yy = 0; yy < 3; yy++) {
          const y = y0 + (y1 - y0) * ((yy + 0.5) / 3);
          for (let xx = 0; xx < 5; xx++) { sum += this.terrain(tap, (xx + 0.5) / 5, y); cnt++; }
        }
        this.cTarget[i] = this.chordFreqs[i] > nyq ? 0 : Math.pow(cnt ? sum / cnt : 0, ch.gamma);
      }
      // asymmetric slew : swell in over `attack`, fade over `release`
      const up = 1 - Math.exp(-n * dt / Math.max(0.01, ch.attack || 0.4));
      const dn = 1 - Math.exp(-n * dt / Math.max(0.01, ch.release || 0.8));
      const gBase = 1.8 / Math.sqrt(N); // lift the pad into the pack (was 0.5 : ~4× too quiet vs the other voices); the master limiter catches rare bright-frame peaks
      const tone = ch.tone || 0, spread = ch.spread || 0, panBase = 0.5 + ch.pan * 0.5;
      // WAVES (as the Ring's) : a sine of level across the chord's notes,
      // travelling, so a held chord keeps moving inside
      const cwv = clampf(ch.waves || 0, 0, 1);
      const cwA = Math.min(1, cwv / 0.65), cwFast = Math.max(0, (cwv - 0.65) / 0.35);
      if (cwv > 0.001) this.cwPh = (this.cwPh + lfoHz(ch.wavesRate != null ? ch.wavesRate : 0.4, ch.wavesSync | 0, this.bpm) * (1 + 3 * cwFast) * n * dt) % 1;
      // NOISE : a smooth pink noise blended in, one band-pass per note (on the
      // note, as wide as AIR), each band riding its note's swell and its WAVES like
      // the tone does, so the noise breathes with the chord. Pink (Kellet's
      // filter) puts equal power per octave, so a band times sqrt(Q) holds one
      // level at any note and width (measured : 0.075 RMS ±8 %) : x 9.4 makes a
      // band at noise 1 as loud as its note's sine.
      const cno = clampf(ch.noise || 0, 0, 1);
      const nzG1 = cno > 0.001 ? cno * 9.4 * Math.sqrt(40 * Math.pow(0.03, clampf(ch.air != null ? ch.air : 0.4, 0, 1))) : 0;
      const nzG0 = this.cNzG;
      this.cNzG = nzG1;
      const noisy = nzG1 > 0 || nzG0 > 0;
      const cQ = 40 * Math.pow(0.03, clampf(ch.air != null ? ch.air : 0.4, 0, 1)), ck = 1 / cQ;
      if (noisy) {
        const nl = this.cNzL, nr = this.cNzR, pk = this.cPk;
        let sl = this.cSeedL, sr = this.cSeedR;
        let l0 = pk[0], l1 = pk[1], l2 = pk[2], r0 = pk[3], r1 = pk[4], r2 = pk[5];
        for (let s = 0; s < n; s++) {
          sl = (Math.imul(sl, 1664525) + 1013904223) >>> 0; sr = (Math.imul(sr, 1664525) + 1013904223) >>> 0;
          const wl = sl / 2147483648 - 1, wr = sr / 2147483648 - 1;
          l0 = 0.99765 * l0 + wl * 0.0990460; l1 = 0.96300 * l1 + wl * 0.2965164; l2 = 0.57000 * l2 + wl * 1.0526913;
          r0 = 0.99765 * r0 + wr * 0.0990460; r1 = 0.96300 * r1 + wr * 0.2965164; r2 = 0.57000 * r2 + wr * 1.0526913;
          nl[s] = (l0 + l1 + l2 + wl * 0.1848) * 0.11; nr[s] = (r0 + r1 + r2 + wr * 0.1848) * 0.11;
        }
        pk[0] = l0; pk[1] = l1; pk[2] = l2; pk[3] = r0; pk[4] = r1; pk[5] = r2;
        this.cSeedL = sl; this.cSeedR = sr;
      }
      for (let i = 0; i < N; i++) {
        const cw1 = cwv > 0.001 ? 1 - cwA * (0.5 - 0.5 * Math.cos(TAU * ((i / N) * (1 + cwFast) - this.cwPh))) : 1;
        const cw0 = this.cW[i];
        this.cW[i] = cw1;
        const tgt = this.cTarget[i], cur = this.cAmp[i];
        let a0 = cur + (tgt - cur) * (tgt > cur ? up : dn);
        if (!(a0 > 1e-12)) a0 = 0; // NaN and denormals → 0
        this.cAmp[i] = a0;
        if (a0 < 0.003) {
          this.cPhase[i] = (this.cPhase[i] + this.chordFreqs[i] * n * dt) % 1;
          this.cZ1L[i] = this.cZ2L[i] = this.cZ1R[i] = this.cZ2R[i] = 0; // a silent band starts clean
          continue;
        }
        // SPREAD : the bass stays in the middle and the notes above fan out,
        // alternating right / left, wider as they rise (the top note widest). It
        // used to fan low → left, high → right, which put the root hard LEFT.
        const off = N > 1 && i > 0 ? (i % 2 ? 1 : -1) * (i / (N - 1)) : 0;
        let pan = panBase + spread * 0.5 * off;
        pan = pan < 0 ? 0 : pan > 1 ? 1 : pan;
        const gL = gBase * panGL(pan), gR = gBase * panGR(pan);
        let ph = this.cPhase[i];
        const inc = this.chordFreqs[i] * dt;
        let wv = cw0;
        const dwv = (cw1 - cw0) / n;
        const fN = this.chordFreqs[i];
        if (noisy && fN < nyq * 0.9) {
          // the note's noise band (TPT SVF band-pass, v1 * k = unity at the note)
          const g = Math.tan(Math.PI * fN * dt), A1 = 1 / (1 + g * (g + ck)), A2 = g * A1, A3 = g * A2;
          let z1l = this.cZ1L[i], z2l = this.cZ2L[i], z1r = this.cZ1R[i], z2r = this.cZ2R[i];
          const nl = this.cNzL, nr = this.cNzR;
          let ng = nzG0 * ck;
          const dng = (nzG1 - nzG0) * ck / n;
          for (let s = 0; s < n; s++) {
            let v = sinT(ph);
            if (tone > 0.001) v = v * (1 - tone) + tab(SH3_T, ph) * tone * 0.9; // tanh(3·sin)
            wv += dwv;
            ng += dng;
            const amp = a0 * wv;
            let v3 = nl[s] - z2l; let v1 = A1 * z1l + A2 * v3; let v2 = z2l + A2 * z1l + A3 * v3; z1l = 2 * v1 - z1l; z2l = 2 * v2 - z2l;
            const bl = v1 * ng;
            v3 = nr[s] - z2r; v1 = A1 * z1r + A2 * v3; v2 = z2r + A2 * z1r + A3 * v3; z1r = 2 * v1 - z1r; z2r = 2 * v2 - z2r;
            const br = v1 * ng;
            v *= amp;
            L[s] += (v + bl * amp) * gL; R[s] += (v + br * amp) * gR;
            ph += inc;
          }
          this.cZ1L[i] = z1l; this.cZ2L[i] = z2l; this.cZ1R[i] = z1r; this.cZ2R[i] = z2r;
        } else {
          for (let s = 0; s < n; s++) {
            let v = sinT(ph);
            if (tone > 0.001) v = v * (1 - tone) + tab(SH3_T, ph) * tone * 0.9; // tanh(3·sin)
            wv += dwv;
            v *= a0 * wv;
            L[s] += v * gL; R[s] += v * gR;
            ph += inc;
          }
        }
        this.cPhase[i] = ph % 1;
      }
    }

    if (chLive) this.mixVoice(7, ch.on && this.chordN > 0, ch.gain, L, R, outL, outR, n);

    // ── COLLAGE : the Collage films' own sound, already panned piece by piece
    // and rung through their scale-tuned resonators in the native graph
    // (collageVoice.ts), arriving on input 1. Here : the voice's balance, its
    // Ring bank (the resonant filterbank; Wet 0 = straight through), then its
    // mixer channel like any other voice.
    const co = cfg.collage;
    const coOn = !!(co && co.on);
    if (this.voiceLive(8, coOn)) {
      const inp = _inputs[1];
      const has = inp && inp.length;
      const iL = has ? inp[0] : this.ring.zero, iR = has ? inp[1] || inp[0] : this.ring.zero;
      const gL = 1.6 * (1 - Math.max(0, co.pan)), gR = 1.6 * (1 + Math.min(0, co.pan));
      this.ring.process(iL, iR, L, R, n, co, this.bpm, gL, gR);
      this.mixVoice(8, coOn, co.gain, L, R, outL, outR, n);
    }

    // ── SIGNAL : the scan heads' micro-grains (the test-equipment register) ──
    // Every helper the per-sample loop needs is written INLINE : a helper called
    // per sample was once left un-inlined (boxed doubles, 3.6 ms per block).
    const sg = cfg.signal;
    if (this.voiceLive(9, sg.on)) {
      const nowT = currentTime;
      const wave = sg.wave | 0;
      // decay 0..1 -> 0.2 ms .. 500 ms, logarithmic : the whole pip-to-bell axis
      // in one knob (it is also the window length of the pip and the ping).
      const decSamp = Math.max(4, 0.0002 * Math.pow(2500, clampf(sg.decay, 0, 1)) * sampleRate);
      const decMul = Math.exp(-6.9077552 / decSamp); // -60 dB over the decay
      // tone : the noise waves' one-pole lowpass, 200 Hz .. 20 kHz
      const toneHz = 200 * Math.pow(100, clampf(sg.tone, 0, 1));
      const lpK = 1 - Math.exp(-TAU * (toneHz < nyq ? toneHz : nyq) * dt);
      const fmIdx = clampf(sg.fm, 0, 1) * 0.9; // FM depth, in turns of phase
      let sw = 0;
      for (let i = 0; i < this.sigPending.length; i++) {
        const e = this.sigPending[i];
        if (e.t0 <= nowT + n * dt) {
          // a free grain, else steal the quietest one not started this block
          let slot = -1;
          for (let k = 0; k < NSIG; k++) if (!this.sig[k].on) { slot = k; break; }
          if (slot < 0) {
            let quiet = 1e9;
            for (let k = 0; k < NSIG; k++) {
              const g2 = this.sig[k];
              if (g2.born !== this.block && g2.env < quiet) { quiet = g2.env; slot = k; }
            }
            if (slot < 0) continue; // the whole pool started this block : drop it
            this.sgDcL += this.sig[slot].lastL; this.sgDcR += this.sig[slot].lastR;
          }
          const g = this.sig[slot];
          let f = e.freq < 20 ? 20 : e.freq;
          while (f > nyq) f *= 0.5;
          let w0 = Math.round((e.t0 - nowT) / dt);
          g.wait = w0 < 0 ? 0 : w0 > n - 1 ? n - 1 : w0;
          g.on = true; g.born = this.block; g.phase = 0; g.inc = f * dt; g.amp = e.amp; g.pan = e.pan;
          g.age = 0; g.len = decSamp; g.env = 1; g.decMul = decMul; g.fmPh = 0; g.lp = 0;
          g.p0 = g.p1 = g.p2 = g.p3 = g.p4 = g.p5 = g.p6 = 0;
          g.seed = ((Math.random() * 2147483646) | 0) + 1;
        } else {
          this.sigPending[sw++] = e;
        }
      }
      this.sigPending.length = sw;
      const g0 = 0.5;
      const bias = sg.pan * 0.5;
      // energy differs a great deal between waves : trim so they sit together.
      // Measured in an offline render (decay 0.35, 880 Hz) : pink came out 13 dB
      // under the pip and square 8 dB under, so picking them sounded broken.
      // After : every wave within 5 dB of the pip (damped's -5 is its own : at a
      // short decay a struck sine has lost half its level by its first crest).
      const wg = wave === 5 ? 0.75 : wave === 7 ? 2.6 : wave === 2 ? 0.95 : wave === 4 ? 0.8 : 1;
      for (let k = 0; k < NSIG; k++) {
        const g = this.sig[k];
        if (!g.on) continue;
        let p = g.pan + bias; p = p < 0 ? 0 : p > 1 ? 1 : p;
        const gL = g0 * panGL(p) * wg, gR = g0 * panGR(p) * wg;
        let lv = 0;
        for (let s = 0; s < n; s++) {
          if (g.wait > 0) { g.wait--; continue; }
          const ph = g.phase;
          let sig;
          if (wave === 0 || wave === 8) {
            // PIP (0) : a Hann-windowed sine, symmetric, the tone pip.
            // PING (8) : a Gaussian-windowed one, softer at both ends.
            if (g.age >= g.len) { g.on = false; break; }
            const u = g.age / g.len;
            let w;
            if (wave === 0) { const h = sinT(u * 0.5); w = h * h; } // sin^2(pi u) = Hann
            else { const c = u * 2 - 1; w = Math.exp(-4.5 * c * c); }
            sig = sinT(ph) * w;
          } else {
            g.env *= g.decMul;
            if (g.env < 0.0004) { g.on = false; break; }
            if (wave === 1) {
              sig = sinT(ph); // DAMPED : struck, instant attack, the tuning fork
            } else if (wave === 2 || wave === 3 || wave === 7) {
              let x = g.seed | 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; g.seed = x;
              const wn = ((x >>> 0) / 4294967296) * 2 - 1;
              if (wave === 7) {
                // PINK : a filter-bank pink noise, colored, deeper than white
                g.p0 = 0.99886 * g.p0 + wn * 0.0555179; g.p1 = 0.99332 * g.p1 + wn * 0.0750759;
                g.p2 = 0.969 * g.p2 + wn * 0.153852; g.p3 = 0.8665 * g.p3 + wn * 0.3104856;
                g.p4 = 0.55 * g.p4 + wn * 0.5329522; g.p5 = -0.7616 * g.p5 - wn * 0.016898;
                const pk = g.p0 + g.p1 + g.p2 + g.p3 + g.p4 + g.p5 + g.p6 + wn * 0.5362;
                g.p6 = wn * 0.115926;
                g.lp += (pk * 0.11 - g.lp) * lpK;
                sig = g.lp * 1.8;
              } else {
                g.lp += (wn - g.lp) * lpK;
                // CLICK (3) : a two-sample bipolar spike over a tail of the same
                // noise, so DECAY turns a tick into a tsk. NOISE (2) : the burst.
                sig = wave === 3 ? (g.age === 0 ? 1 : g.age === 1 ? -0.7 : 0) + g.lp * 0.3 : g.lp * 1.6;
              }
            } else if (wave === 4) {
              // FM : a sine carrier, its modulator at 1.5x (inharmonic, so metal)
              g.fmPh += g.inc * 1.5; if (g.fmPh >= 1) g.fmPh -= 1;
              let q = ph + fmIdx * sinT(g.fmPh); q -= Math.floor(q);
              sig = sinT(q);
            } else if (wave === 5) {
              // SQUARE : PolyBLEP-corrected at both edges, the clean digital burst
              const t0 = g.inc;
              let sq = ph < 0.5 ? 1 : -1;
              if (ph < t0) { const t = ph / t0; sq += t + t - t * t - 1; }
              else if (ph > 1 - t0) { const t = (ph - 1) / t0; sq += t * t + t + t + 1; }
              let p2 = ph + 0.5; if (p2 >= 1) p2 -= 1;
              if (p2 < t0) { const t = p2 / t0; sq -= t + t - t * t - 1; }
              else if (p2 > 1 - t0) { const t = (p2 - 1) / t0; sq -= t * t + t + t + 1; }
              sig = sq;
            } else {
              sig = ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4; // TRI (6)
            }
            sig *= g.env;
          }
          const v = sig * g.amp;
          g.phase += g.inc; if (g.phase >= 1) g.phase -= 1;
          g.age++;
          L[s] += v * gL; R[s] += v * gR;
          lv = v;
        }
        g.lastL = lv * gL; g.lastR = lv * gR;
      }
      // the stolen grains' tails (a decaying offset from their last sample)
      if (this.sgDcL !== 0 || this.sgDcR !== 0) {
        let dl = this.sgDcL, dr = this.sgDcR;
        const kk = this.evDcK;
        for (let s = 0; s < n; s++) { L[s] += dl; R[s] += dr; dl *= kk; dr *= kk; }
        this.sgDcL = Math.abs(dl) < 1e-7 ? 0 : dl; this.sgDcR = Math.abs(dr) < 1e-7 ? 0 : dr;
      }
      this.mixVoice(9, sg.on, sg.gain, L, R, outL, outR, n);
    }

    // ── shared FX tail : send the (dry) mix into delay → reverb, return the wet ──
    // Runs while there's send OR the reverb/delay are still ringing (so cutting the
    // send lets the tail decay naturally instead of snapping off).
    const wantFx = this.fxSend > 0.0001;
    if (wantFx || this.fxRinging) {
      const rv = this.reverb, dl = this.delay;
      // the reverb's level in the tail : 0.6 (the default) is the level it
      // always had (its mix knob used to be ignored), 1 is ~4 dB wetter
      const rvG = rv.mix * 1.6666667;
      let tail = 0;
      for (let s = 0; s < n; s++) {
        const send = (this.fxSendS += (this.fxSend - this.fxSendS) * 0.002);
        const inL = outL[s] * send, inR = outR[s] * send;
        dl.process(inL, inR);
        rv.process(inL + dl.wL, inR + dl.wR); // reverb hears the send + the echoes
        let wl = dl.wL + rv.wL * rvG, wr = dl.wR + rv.wR * rvG;
        // A NaN in the tail's feedback would stick forever (permanent silence) —
        // detect it and clear the buffers so the tail self-heals.
        if (!(Number.isFinite(wl) && Number.isFinite(wr))) { dl.reset(); rv.reset(); wl = 0; wr = 0; }
        outL[s] += wl; outR[s] += wr;
        const amp = Math.abs(wl) + Math.abs(wr); if (amp > tail) tail = amp;
      }
      // Stop only after the tail has been quiet for longer than the delay line :
      // one quiet block used to end it with an echo still in the line, which
      // came back later when the send rose again. Cleared when it stops.
      this.fxQuiet = tail > 1e-4 ? 0 : this.fxQuiet + n * dt;
      if (!wantFx && this.fxQuiet > dl.rate_s + 0.5) { dl.reset(); rv.reset(); this.fxRinging = false; this.fxQuiet = 0; }
      else this.fxRinging = true;
    }

    // ── master : gain + peak limiter (always on) + meter ──
    const mg1 = clampf(cfg.master, 0, 2);
    const mg0 = this.mgS < 0 ? mg1 : this.mgS, dmg = (mg1 - mg0) / n;
    this.mgS = mg1;
    let peak = this.peak, limMin = this.limMin;
    for (let s = 0; s < n; s++) {
      const mg = mg0 + dmg * (s + 1); // ramped : a stepped master zippered
      let l = outL[s] * mg, r = outR[s] * mg;
      if (!Number.isFinite(l)) l = 0;
      if (!Number.isFinite(r)) r = 0;
      const p = Math.max(Math.abs(l), Math.abs(r));
      // fast-attack / slow-release peak limiter at -1 dBFS
      const target = p > 0.89 ? 0.89 / p : 1;
      this.limEnv = target < this.limEnv ? target : this.limEnv + (1 - this.limEnv) * 0.0004;
      l *= this.limEnv; r *= this.limEnv;
      if (this.limEnv < limMin) limMin = this.limEnv;
      outL[s] = l; outR[s] = r;
      const al = Math.abs(l), ar = Math.abs(r);
      const ap = al > ar ? al : ar;
      if (ap > peak) peak = ap;
      if (al > this.pkL) this.pkL = al;
      if (ar > this.pkR) this.pkR = ar;
      this.ssL += l * l; this.ssR += r * r;
    }
    this.nMeter += n;
    this.peak = peak; this.limMin = limMin;
    if (currentTime - this.lastMeter > 0.1) {
      // + where the scanning voices really are (and their real rates : sync and
      // modulation included), so the page's overlay draws what you hear.
      this.port.postMessage({
        t: 'meter', peak: this.peak, lim: this.limMin,
        pkL: this.pkL, pkR: this.pkR,
        rmsL: Math.sqrt(this.ssL / Math.max(1, this.nMeter)), rmsR: Math.sqrt(this.ssR / Math.max(1, this.nMeter)),
        scan: { at: currentTime, sp: this.sweepPos, spHz: sp.sweepOn ? sp.sweepHz : 0, fi: this.fSweep, fiHz: fi.sweepOn ? fi.sweepHz : 0, tv: (this.tLine + this.tX) / GRID, tvHz: tv.lineHz / GRID }
      });
      this.peak = 0; this.limMin = 1; this.lastMeter = currentTime;
      this.pkL = 0; this.pkR = 0; this.ssL = 0; this.ssR = 0; this.nMeter = 0;
    }
    return true;
  }
}
registerProcessor('soni', SoniProcessor);

// ── The recording tap : the Sonify output as 16-bit PCM for a DXV3 take (the
// file writer muxes it as the take's sound track). It hears silence while
// Sonify is off, so the take's timeline never has a hole. ~0.1 s chunks; turning
// it off sends the rest.
class SoniTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.n = Math.max(128, Math.round(sampleRate / 10));
    this.buf = new Int16Array(this.n * 2);
    this.k = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (!m || m.t !== 'tap') return;
      if (m.on) { this.on = true; this.k = 0; return; }
      if (this.on) {
        this.on = false;
        const rest = this.buf.slice(0, this.k * 2);
        this.port.postMessage({ t: 'pcm', buf: rest.buffer, last: true }, [rest.buffer]);
        this.k = 0;
      }
    };
  }
  process(inputs) {
    if (!this.on) return true;
    const inp = inputs[0];
    const L = inp && inp.length ? inp[0] : null;
    const R = inp && inp.length > 1 ? inp[1] : L;
    const n = L ? L.length : 128;
    for (let s = 0; s < n; s++) {
      let l = L ? L[s] : 0, r = R ? R[s] : 0;
      l = l > 1 ? 1 : l < -1 ? -1 : l;
      r = r > 1 ? 1 : r < -1 ? -1 : r;
      this.buf[this.k * 2] = Math.round(l * 32767);
      this.buf[this.k * 2 + 1] = Math.round(r * 32767);
      if (++this.k >= this.n) {
        const out = this.buf;
        this.port.postMessage({ t: 'pcm', buf: out.buffer }, [out.buffer]);
        this.buf = new Int16Array(this.n * 2);
        this.k = 0;
      }
    }
    return true;
  }
}
registerProcessor('soni-tap', SoniTap);
