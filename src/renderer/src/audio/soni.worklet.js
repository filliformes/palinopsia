// The Sonify AudioWorklet processor (plain JS : loaded via Vite ?url as a
// module asset, added with audioContext.audioWorklet.addModule).
//
// One processor runs all eight voices (Spectra · Orbit · Flow · Events ·
// Raster · Transmission · Filter · Chord) plus the master bus with an always-on peak limiter. Rules: zero allocation inside
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
const TAU = 6.283185307179586;

function clampf(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// ── Shared FX tail : reverb + analog delay, ported from the Essaim / Res
// instruments (abl.dsp.quartz~ / abl.dsp.prism~ reverb + a BBD delay). ────────

// Dual-mode modulated 8-line Hadamard FDN reverb (Quartz : dual-band damping ·
// Prism : per-line frequency-dependent decay). Faithful port of res_reverb.c.
const RV_NL = 8, RV_LMAX = 6144, RV_NAP = 4, RV_APMAX = 1024, RV_PDMAX = 12288;
const RV_BASELEN = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const RV_APLEN = [225, 341, 441, 556];
const RV_APG = [0.72, 0.70, 0.68, 0.66];
class FDNReverb {
  constructor(sr) {
    this.sr = sr > 0 ? sr : 48000;
    this.mode = 0;
    this.size = 0.6; this.decay = 0.6; this.damp = 0.3; this.mix = 0.3;
    this.predelay_ms = 20; this.mod_depth = 6; this.mod_rate = 0.5; this.width = 1;
    this.diffusion = 0.85; this.low_damp = 0.5;
    this.crossover = 0.3; this.lowmult = 1; this.highmult = 1;
    this.freeze = 0; this.locut_hz = 220;
    this.line = []; for (let i = 0; i < RV_NL; i++) this.line.push(new Float32Array(RV_LMAX));
    this.linelen = new Int32Array(RV_NL); this.linelen_s = new Float32Array(RV_NL); this.lw = new Int32Array(RV_NL);
    this.damp_z = new Float32Array(RV_NL); this.lo_z = new Float32Array(RV_NL);
    this.ls_z = new Float32Array(RV_NL); this.hs_z = new Float32Array(RV_NL);
    this.gain = new Float32Array(RV_NL); this.glow = new Float32Array(RV_NL); this.ghigh = new Float32Array(RV_NL);
    this.modph = new Float64Array(RV_NL);
    this.ap = []; for (let i = 0; i < RV_NAP; i++) this.ap.push(new Float32Array(RV_APMAX));
    this.apw = new Int32Array(RV_NAP);
    this.pd = [new Float32Array(RV_PDMAX), new Float32Array(RV_PDMAX)]; this.pdw = 0;
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
      if (L < 8) L = 8; if (L > RV_LMAX - 64) L = RV_LMAX - 64;
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
  lineRead(i, delay) {
    let rp = this.lw[i] - delay; while (rp < 0) rp += RV_LMAX;
    let i0 = rp | 0; const frac = rp - i0; if (i0 >= RV_LMAX) i0 -= RV_LMAX;
    let i1 = i0 + 1; if (i1 >= RV_LMAX) i1 -= RV_LMAX;
    return this.line[i][i0] * (1 - frac) + this.line[i][i1] * frac;
  }
  process(inL, inR) {
    const moddepth = this.freeze ? 0 : this.mod_depth;
    const damp_a = clampf(1 - this.damp * 0.85, 0.05, 1);
    const dscale = 0.15 + 0.85 * this.diffusion;
    const ingain = this.freeze ? 0 : 1;
    const lowkeep = clampf(1 - this.low_damp * 0.9, 0.05, 1);
    let locut_a = TAU * this.locut_hz / this.sr; if (locut_a > 0.5) locut_a = 0.5;
    let pdlen = (this.predelay_ms * 0.001 * this.sr) | 0; if (pdlen < 1) pdlen = 1; if (pdlen > RV_PDMAX - 1) pdlen = RV_PDMAX - 1;
    let rp = this.pdw - pdlen; while (rp < 0) rp += RV_PDMAX;
    const pdL = this.pd[0][rp], pdR = this.pd[1][rp];
    this.pd[0][this.pdw] = inL; this.pd[1][this.pdw] = inR; this.pdw = (this.pdw + 1) % RV_PDMAX;
    let x = 0.5 * (pdL + pdR);
    for (let i = 0; i < RV_NAP; i++) { const r = this.apw[i], g = RV_APG[i] * dscale, buf = this.ap[i][r], y = -g * x + buf; this.ap[i][r] = x + g * y; this.apw[i] = (r + 1) % RV_APLEN[i]; x = y; }
    const d = this.d;
    for (let i = 0; i < RV_NL; i++) {
      const mod = moddepth * Math.sin(TAU * this.modph[i]);
      this.linelen_s[i] += (this.linelen[i] - this.linelen_s[i]) * 0.0006;
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
      this.line[i][this.lw[i]] = v; this.lw[i] = (this.lw[i] + 1) % RV_LMAX;
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
    this.mix = 0.3; this.rate = 0.3; this.rate_s = 0.3; this.fb = 0.35; this.tone = 0.5; this.mode = 1;
    this.wL = 0; this.wR = 0;
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
    this.wL = Math.tanh(tl * 1.2) * this.mix; this.wR = Math.tanh(tr * 1.2) * this.mix;
  }
}

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
      filter:  { on: false, tap: 0, gain: 0.6, pan: 0, q: 0.5, noise: 0.5, sweepOn: false, sweepHz: 0.25, x: 0.5, gamma: 1.6, path: 0, pace: 0 },
      chord:   { on: false, tap: 0, gain: 0.6, pan: 0, gamma: 1.6, spread: 0.6, attack: 0.4, release: 0.8, tone: 0.3 }
    };
    this.spectraFreqs = new Float32Array(NPART); // filled by cfg
    for (let i = 0; i < NPART; i++) this.spectraFreqs[i] = 55 * Math.pow(2, i * 6 / NPART);
    // ── Spectra state ──
    this.sPhase = new Float32Array(NPART);
    this.sAmp = new Float32Array(NPART);
    this.sTarget = new Float32Array(NPART);
    this.sNz = new Float32Array(NPART); // per-partial lowpassed noise (breath)
    this.sweepPos = 0;
    this.noiseState = 1;
    // ── Orbit state ──
    this.oPhase = 0;
    this.dcX = 0; this.dcY = 0; // DC-blocker state
    this.oSlew = 0; // slewed sample for smooth
    // ── Flow grain pool ──
    this.grains = [];
    for (let g = 0; g < NGRAIN; g++) {
      this.grains.push({ on: false, t0: 0, phase: 0, inc: 0, amp: 0, pan: 0.5, age: 0, dur: 0.1, noise: 0, bright: 0, warm: 0, phase2: 0, inc2: 0 });
    }
    this.pending = []; // scheduled grain events (small, replaced per flow msg)
    // ── Events poly pool (plucked notes from edges / motion) ──
    this.notes = [];
    for (let k = 0; k < NEVENT; k++) {
      this.notes.push({ on: false, phase: 0, inc: 0, amp: 0, pan: 0.5, wave: 0, env: 0, atkInc: 1, decMul: 0.999, attacking: false });
    }
    this.evPending = []; // scheduled note onsets [{t0, freq, amp, pan}]
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
    this.rebuildFilterCoefs();
    // ── Chord bank (scale-tuned oscillators following brightness bands) ──
    this.chordFreqs = new Float32Array(NCHORD);
    this.chordN = 0;
    this.cPhase = new Float32Array(NCHORD);
    this.cAmp = new Float32Array(NCHORD);
    this.cTarget = new Float32Array(NCHORD);
    // scratch (x,y) for the scan-path read (zero-alloc : written per partial)
    this.sxy = new Float32Array(2);
    // ── shared FX tail : reverb + analog delay (send/return) ──
    this.reverb = new FDNReverb(sampleRate);
    this.delay = new BBDDelay(sampleRate);
    this.fxSend = 0; this.fxSendS = 0; this.fxRinging = false; // global send + smoothing + tail ring-out
    // ── limiter ──
    this.limEnv = 1;
    // ── metering (sent back ~10Hz) ──
    this.peak = 0; this.lastMeter = 0;
    this.port.onmessage = (e) => this.onMsg(e.data);
  }

  onMsg(m) {
    if (m.t === 'grid') {
      const tap = this.taps[m.tap];
      if (!tap) return;
      // prev <- cur, cur <- new (converted), restart the interp ramp
      const p = tap.prev; tap.prev = tap.cur; tap.cur = p;
      const d = m.data; // Uint8Array luma
      const c = tap.cur;
      for (let i = 0; i < c.length; i++) c[i] = d[i] * 0.00392156862745098;
      tap.mix = 0;
      // reach mix=1 over ~one frame interval (given ~375 quanta/s)
      tap.mixStep = Math.min(1, (m.dt || 0.033) > 0 ? (128 / sampleRate) / (m.dt || 0.033) : 0.25);
      tap.has = true;
      return;
    }
    if (m.t === 'cfg') {
      this.cfg = m.cfg;
      if (m.spectraFreqs) this.spectraFreqs.set(m.spectraFreqs);
      if (m.filterFreqs) { this.fFreqs.set(m.filterFreqs); this.rebuildFilterCoefs(); }
      if (m.chordFreqs) { this.chordN = Math.min(NCHORD, m.chordFreqs.length); this.chordFreqs.set(m.chordFreqs.subarray(0, this.chordN)); }
      if (m.cfg.fx) this.applyFx(m.cfg.fx);
      return;
    }
    if (m.t === 'mod') {
      // Per-tick probe overlay : shallow-merge effective values into the live
      // voice configs (sent every tick, so releases revert cleanly).
      const mm = m.m;
      for (const k in mm) {
        const dst = this.cfg[k];
        if (dst) Object.assign(dst, mm[k]);
      }
      return;
    }
    if (m.t === 'flow') {
      // events: flat Float32Array [tOffset, freq, amp, pan, bright, warm] × n
      // (already dithered + quantized by the main thread; bright/warm = colour)
      const ev = m.events;
      this.pending.length = 0;
      const base = currentTime;
      for (let i = 0; i + 5 < ev.length; i += 6) {
        this.pending.push({ t0: base + ev[i], freq: ev[i + 1], amp: ev[i + 2], pan: ev[i + 3], bright: ev[i + 4], warm: ev[i + 5] });
      }
      return;
    }
    if (m.t === 'events') {
      // events: flat Float32Array [tOffset, freq, amp, pan] × n (dithered +
      // quantized by the main thread) → scheduled discrete note onsets.
      const ev = m.events;
      this.evPending.length = 0;
      const base = currentTime;
      for (let i = 0; i + 3 < ev.length; i += 4) {
        this.evPending.push({ t0: base + ev[i], freq: ev[i + 1], amp: ev[i + 2], pan: ev[i + 3] });
      }
      return;
    }
  }

  // Bilinear sample of a tap's interpolated grid at normalized (x, y).
  terrain(tap, x, y) {
    if (!tap.has) return 0;
    x = x < 0 ? 0 : x > 1 ? 1 : x;
    y = y < 0 ? 0 : y > 1 ? 1 : y;
    const fx = x * (GRID - 1), fy = y * (GRID - 1);
    const x0 = fx | 0, y0 = fy | 0;
    const x1 = x0 + 1 < GRID ? x0 + 1 : x0, y1 = y0 + 1 < GRID ? y0 + 1 : y0;
    const ax = fx - x0, ay = fy - y0;
    const i00 = y0 * GRID + x0, i10 = y0 * GRID + x1, i01 = y1 * GRID + x0, i11 = y1 * GRID + x1;
    const c = tap.cur, pv = tap.prev, m = tap.mix;
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

  rebuildFilterCoefs() {
    for (let i = 0; i < NBAND; i++) {
      this.fCoef[i] = 2 * Math.sin(Math.PI * Math.min(this.fFreqs[i], sampleRate * 0.45) / sampleRate);
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
    rv.recompute();
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
    const L = out[0], R = out[1] || out[0];
    const n = L.length;
    L.fill(0); if (R !== L) R.fill(0);
    const cfg = this.cfg;
    const dt = 1 / sampleRate;

    // Advance each tap's frame-interpolation ramp (prev → cur crossfade) :
    // one step per quantum, sized on receipt to span one video frame.
    for (let t = 0; t < this.taps.length; t++) {
      const tap = this.taps[t];
      if (tap.mix < 1) tap.mix = Math.min(1, tap.mix + tap.mixStep);
    }

    // ── SPECTRA : partial bank riding a column of the frame ──
    const sp = cfg.spectra;
    if (sp.on) {
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
        this.sTarget[i] = Math.pow(v, sp.gamma);
      }
      // synthesize : slewed additive bank (slew kills zipper + clicks)
      const slew = 1 - Math.exp(-n * dt / 0.02);
      const gL = sp.gain * (1 - Math.max(0, sp.pan)) * 0.12;
      const gR = sp.gain * (1 + Math.min(0, sp.pan)) * 0.12;
      for (let i = 0; i < NPART; i++) {
        const a0 = this.sAmp[i] + (this.sTarget[i] - this.sAmp[i]) * slew;
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
            this.noiseState = (this.noiseState * 1103515245 + 12345) & 0x7fffffff;
            const w = this.noiseState / 0x40000000 - 1;
            nz = nz * 0.985 + w * 0.015;
            const v = Math.sin(ph * 6.283185307179586) * a0 * (1 + br * nz * 6);
            L[s] += v * gL; R[s] += v * gR;
            ph += inc * (1 + br * nz * 3);
          }
          this.sNz[i] = nz;
        } else {
          for (let s = 0; s < n; s++) {
            const v = Math.sin(ph * 6.283185307179586) * a0;
            L[s] += v * gL; R[s] += v * gR;
            ph += inc;
          }
        }
        this.sPhase[i] = ph % 1;
      }
    }

    // ── ORBIT : wave terrain — the frame IS the waveform ──
    const ob = cfg.orbit;
    if (ob.on) {
      const tap = this.taps[ob.tap] || this.taps[0];
      const inc = ob.freq * dt;
      const gL = ob.gain * (1 - Math.max(0, ob.pan)) * 0.8;
      const gR = ob.gain * (1 + Math.min(0, ob.pan)) * 0.8;
      const sm = Math.pow(0.5, 1 / (1 + ob.smooth * 48)); // one-pole smooth
      for (let s = 0; s < n; s++) {
        this.oPhase += inc;
        const a = this.oPhase * 6.283185307179586;
        const x = ob.cx + ob.rx * Math.cos(a);
        const y = ob.cy + ob.ry * Math.sin(a * ob.ratio);
        let v = this.terrain(tap, x, y);
        // one-pole smooth (band-limits the terrain edges a touch)
        this.oSlew = this.oSlew * sm + v * (1 - sm);
        v = this.oSlew;
        // DC-block : the image mean is a big DC offset
        const hp = v - this.dcX + 0.995 * this.dcY;
        this.dcX = v; this.dcY = hp;
        const shaped = Math.tanh(hp * ob.drive * 3);
        L[s] += shaped * gL; R[s] += shaped * gR;
      }
      if (this.oPhase > 1e6) this.oPhase %= 1;
    }

    // ── FLOW : grain cloud from the motion field ──
    const fl = cfg.flow;
    if (fl.on) {
      // activate pending events whose time has come
      const nowT = currentTime;
      for (let i = this.pending.length - 1; i >= 0; i--) {
        const ev = this.pending[i];
        if (ev.t0 <= nowT + n * dt) {
          for (let g = 0; g < NGRAIN; g++) {
            const gr = this.grains[g];
            if (!gr.on) {
              gr.on = true; gr.age = 0; gr.phase = Math.random();
              gr.inc = ev.freq * dt;
              gr.amp = ev.amp; gr.pan = ev.pan;
              gr.dur = fl.dur * (0.7 + Math.random() * 0.6);
              gr.noise = fl.noise;
              // colour → timbre : bright = waveshape drive, warm picks the tint
              // partial (sub-octave body when warm, octave-up shimmer when cool).
              gr.bright = ev.bright || 0;
              gr.warm = ev.warm || 0;
              gr.phase2 = Math.random();
              gr.inc2 = gr.inc * (gr.warm >= 0 ? 0.5 : 2);
              break;
            }
          }
          this.pending.splice(i, 1);
        }
      }
      const g0 = fl.gain * 0.5;
      const colAmt = fl.colour || 0;
      for (let g = 0; g < NGRAIN; g++) {
        const gr = this.grains[g];
        if (!gr.on) continue;
        const gL = g0 * (1 - gr.pan);
        const gR = g0 * gr.pan;
        // colour → timbre (0 when colour off ⇒ identical to the plain grain).
        const eb = gr.bright * colAmt; // waveshape drive : vivid colour = edgier
        const tintAmt = Math.abs(gr.warm) * colAmt * 0.5; // sub-oct / oct-up blend
        for (let s = 0; s < n; s++) {
          gr.age += dt;
          if (gr.age >= gr.dur) { gr.on = false; break; }
          // raised-cosine envelope
          const e = 0.5 - 0.5 * Math.cos(6.283185307179586 * Math.min(1, gr.age / gr.dur));
          let s0 = Math.sin(gr.phase * 6.283185307179586);
          if (eb > 0.001) s0 = s0 * (1 - eb) + Math.tanh(3.5 * s0) * eb * 0.85; // brighten
          if (tintAmt > 0.001) { s0 = s0 * (1 - tintAmt) + Math.sin(gr.phase2 * 6.283185307179586) * tintAmt; gr.phase2 += gr.inc2; }
          // sine + a breath of noise
          this.noiseState = (this.noiseState * 1103515245 + 12345) & 0x7fffffff;
          const nz = (this.noiseState / 0x40000000 - 1) * gr.noise;
          const v = (s0 * (1 - gr.noise) + nz) * e * gr.amp;
          gr.phase += gr.inc;
          L[s] += v * gL; R[s] += v * gR;
        }
      }
    }

    // ── EVENTS : edges / motion → plucked notes (Aural-Mirror register) ──
    const ev = cfg.events;
    if (ev.on) {
      // fire scheduled onsets whose time has come
      const nowT = currentTime;
      const wave = ev.wave | 0;
      for (let i = this.evPending.length - 1; i >= 0; i--) {
        const e = this.evPending[i];
        if (e.t0 <= nowT + n * dt) {
          // grab a free voice, else steal the quietest
          let slot = -1, quiet = 2;
          for (let k = 0; k < NEVENT; k++) {
            const nt2 = this.notes[k];
            if (!nt2.on) { slot = k; break; }
            if (nt2.env < quiet) { quiet = nt2.env; slot = k; }
          }
          const nt = this.notes[slot < 0 ? 0 : slot];
          // decay time : base 0.05..2.5s, shortened for high notes when `highs`>0
          const f = e.freq < 20 ? 20 : e.freq;
          const baseDecay = 0.05 + ev.decay * 2.45;
          const factor = ev.highs > 0.001 ? Math.pow(220 / f, ev.highs * 1.5) : 1;
          const decayTime = Math.max(0.03, Math.min(6, baseDecay * factor));
          nt.on = true; nt.phase = 0; nt.inc = e.freq * dt;
          nt.amp = e.amp; nt.pan = e.pan; nt.wave = wave;
          nt.env = 0; nt.attacking = true;
          nt.atkInc = 1 / Math.max(1, 0.004 * sampleRate); // ~4ms attack
          nt.decMul = Math.exp(-6.9077552 / (decayTime * sampleRate)); // ≈ -60dB over decayTime
          this.evPending.splice(i, 1);
        }
      }
      const g0 = ev.gain * 0.5;
      const bias = ev.pan * 0.5;
      // saw / square carry more energy — trim so they don't dominate the mix.
      const wg = wave === 3 ? 0.5 : wave === 2 ? 0.7 : 1;
      for (let k = 0; k < NEVENT; k++) {
        const nt = this.notes[k];
        if (!nt.on) continue;
        let p = nt.pan + bias; p = p < 0 ? 0 : p > 1 ? 1 : p;
        const gL = g0 * (1 - p) * wg, gR = g0 * p * wg;
        for (let s = 0; s < n; s++) {
          if (nt.attacking) { nt.env += nt.atkInc; if (nt.env >= 1) { nt.env = 1; nt.attacking = false; } }
          else { nt.env *= nt.decMul; if (nt.env < 0.0004) { nt.on = false; break; } }
          const ph = nt.phase;
          let sig;
          if (wave === 0) sig = Math.sin(ph * TAU);
          else if (wave === 1) { const tr = ph < 0.5 ? ph * 2 : 2 - ph * 2; sig = tr * 2 - 1; } // triangle
          else if (wave === 2) sig = ph * 2 - 1; // saw
          else sig = ph < 0.5 ? 1 : -1; // square
          const v = sig * nt.env * nt.amp;
          nt.phase += nt.inc; if (nt.phase >= 1) nt.phase -= 1;
          L[s] += v * gL; R[s] += v * gR;
        }
      }
    }

    // ── RASTER : audification — the probe rect read row-major as samples ──
    const ra = cfg.raster;
    if (ra.on) {
      const tap = this.taps[ra.tap] || this.taps[0];
      const px0 = Math.max(0, Math.min(GRID - 2, Math.round(ra.rx * GRID)));
      const py0 = Math.max(0, Math.min(GRID - 2, Math.round(ra.ry * GRID)));
      const pw = Math.max(2, Math.min(GRID - px0, Math.round(ra.rw * GRID)));
      const ph = Math.max(1, Math.min(GRID - py0, Math.round(ra.rh * GRID)));
      const nPix = pw * ph;
      // scan rate in pixels/sec so one full pass of the rect = the period :
      // pitch = freq, timbre = the rect's contents (Yeo/Berger geometry).
      const step = ra.freq * nPix * dt;
      const gL = ra.gain * (1 - Math.max(0, ra.pan)) * 0.7;
      const gR = ra.gain * (1 + Math.min(0, ra.pan)) * 0.7;
      // TONE : a 12dB/oct lowpass tames the read's aliased edges. Log sweep
      // 300Hz → 8kHz (the Chamberlin SVF is only stable below ~sr/6);
      // at the top of the dial the filter is BYPASSED (truly open).
      const toneOpen = ra.tone >= 0.99;
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
        const shaped = Math.max(-1, Math.min(1, (toneOpen ? hp : this.rLow) * 1.4));
        L[s] += shaped * gL; R[s] += shaped * gR;
      }
      this.rPtr = ptr;
    }

    // ── TRANSMISSION : the SSTV register — line-sequential FM + sync tick ──
    const tv = cfg.sstv;
    if (tv.on) {
      const tap = this.taps[tv.tap] || this.taps[0];
      const lineDur = 1 / Math.max(0.5, tv.lineHz); // seconds per line
      const syncFrac = Math.min(0.25, 0.005 / lineDur); // ~5ms sync pulse
      const gL = tv.gain * (1 - Math.max(0, tv.pan)) * 0.5;
      const gR = tv.gain * (1 + Math.min(0, tv.pan)) * 0.5;
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
        const v = Math.sin(this.tPhase * 6.283185307179586) * amp;
        L[s] += v * gL; R[s] += v * gR;
      }
      if (this.tPhase > 1e6) this.tPhase %= 1;
    }

    // ── FILTER : the image as a band-gain matrix over noise / line-in ──
    const fi = cfg.filter;
    if (fi.on) {
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
      const gL = fi.gain * (1 - Math.max(0, fi.pan)) * 0.9;
      const gR = fi.gain * (1 + Math.min(0, fi.pan)) * 0.9;
      for (let i = 0; i < NBAND; i++) this.fGain[i] += (this.fTarget[i] - this.fGain[i]) * slew;
      for (let s = 0; s < n; s++) {
        // source : line-in when connected, plus an internal noise floor
        this.noiseState = (this.noiseState * 1103515245 + 12345) & 0x7fffffff;
        const nz = (this.noiseState / 0x40000000 - 1) * fi.noise * 0.5;
        const x = (input ? input[s] : 0) + nz;
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
    }

    // ── CHORD : scale-tuned bank following the frame's brightness bands ──
    const ch = cfg.chord;
    if (ch.on && this.chordN > 0) {
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
        this.cTarget[i] = Math.pow(cnt ? sum / cnt : 0, ch.gamma);
      }
      // asymmetric slew : swell in over `attack`, fade over `release`
      const up = 1 - Math.exp(-n * dt / Math.max(0.01, ch.attack || 0.4));
      const dn = 1 - Math.exp(-n * dt / Math.max(0.01, ch.release || 0.8));
      const gBase = (ch.gain * 0.5) / Math.sqrt(N);
      const tone = ch.tone || 0, spread = ch.spread || 0, panBase = 0.5 + ch.pan * 0.5;
      for (let i = 0; i < N; i++) {
        const tgt = this.cTarget[i], cur = this.cAmp[i];
        const a0 = cur + (tgt - cur) * (tgt > cur ? up : dn);
        this.cAmp[i] = a0;
        if (a0 < 0.003) { this.cPhase[i] = (this.cPhase[i] + this.chordFreqs[i] * n * dt) % 1; continue; }
        let pan = N > 1 ? panBase + spread * 0.5 * (2 * i / (N - 1) - 1) : panBase;
        pan = pan < 0 ? 0 : pan > 1 ? 1 : pan;
        const gL = gBase * (1 - pan), gR = gBase * pan;
        let ph = this.cPhase[i];
        const inc = this.chordFreqs[i] * dt;
        for (let s = 0; s < n; s++) {
          let v = Math.sin(ph * TAU);
          if (tone > 0.001) v = v * (1 - tone) + Math.tanh(3 * v) * tone * 0.9;
          v *= a0;
          L[s] += v * gL; R[s] += v * gR;
          ph += inc;
        }
        this.cPhase[i] = ph % 1;
      }
    }

    // ── shared FX tail : send the (dry) mix into delay → reverb, return the wet ──
    // Runs while there's send OR the reverb/delay are still ringing (so cutting the
    // send lets the tail decay naturally instead of snapping off).
    const wantFx = this.fxSend > 0.0001;
    if (wantFx || this.fxRinging) {
      const rv = this.reverb, dl = this.delay;
      let tail = 0;
      for (let s = 0; s < n; s++) {
        const send = (this.fxSendS += (this.fxSend - this.fxSendS) * 0.002);
        const inL = L[s] * send, inR = R[s] * send;
        dl.process(inL, inR);
        rv.process(inL + dl.wL, inR + dl.wR); // reverb hears the send + the echoes
        const wl = dl.wL + rv.wL, wr = dl.wR + rv.wR;
        L[s] += wl; R[s] += wr;
        const amp = Math.abs(wl) + Math.abs(wr); if (amp > tail) tail = amp;
      }
      this.fxRinging = wantFx || tail > 1e-4;
    }

    // ── master : gain + peak limiter (always on) + meter ──
    const mg = cfg.master;
    let peak = this.peak;
    for (let s = 0; s < n; s++) {
      let l = L[s] * mg, r = R[s] * mg;
      const p = Math.max(Math.abs(l), Math.abs(r));
      // fast-attack / slow-release peak limiter at -1 dBFS
      const target = p > 0.89 ? 0.89 / p : 1;
      this.limEnv = target < this.limEnv ? target : this.limEnv + (1 - this.limEnv) * 0.0004;
      l *= this.limEnv; r *= this.limEnv;
      L[s] = l; R[s] = r;
      const ap = Math.max(Math.abs(l), Math.abs(r));
      if (ap > peak) peak = ap;
    }
    this.peak = peak;
    if (currentTime - this.lastMeter > 0.1) {
      this.port.postMessage({ t: 'meter', peak: this.peak, lim: this.limEnv });
      this.peak = 0; this.lastMeter = currentTime;
    }
    return true;
  }
}
registerProcessor('soni', SoniProcessor);
