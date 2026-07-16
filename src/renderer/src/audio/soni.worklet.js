// The Sonify AudioWorklet processor (plain JS : loaded via Vite ?url as a
// module asset, added with audioContext.audioWorklet.addModule).
//
// One processor runs all six voices (Spectra · Orbit · Flow · Raster ·
// Transmission · Filter) plus the master bus with an always-on peak limiter. Rules: zero allocation inside
// process(); no AudioParams (control flows through port messages); image
// frames arrive as transferred Uint8Array luma grids, double-buffered and
// crossfaded so 30Hz video never steps audibly; grain onsets are pre-dithered
// by the main thread; pitch tables are computed on the main thread.

const GRID = 96; // luma grid is GRID×GRID
const NPART = 96; // Spectra partial count
const NGRAIN = 64; // Flow grain pool
const NBAND = 48; // Image-Filter band count

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
      spectra: { on: false, tap: 0, gain: 0.5, pan: 0, sweepOn: true, sweepHz: 0.25, x: 0.5, gamma: 1.6, noise: 0 },
      orbit:   { on: false, tap: 0, gain: 0.5, pan: 0, freq: 110, ratio: 1, cx: 0.5, cy: 0.5, rx: 0.25, ry: 0.25, drive: 1.2, smooth: 0.6 },
      flow:    { on: false, tap: 0, gain: 0.5, pan: 0, dur: 0.09, noise: 0.15 },
      raster:  { on: false, tap: 0, gain: 0.5, pan: 0, freq: 110, rx: 0.35, ry: 0.35, rw: 0.3, rh: 0.3, smooth: 0 },
      sstv:    { on: false, tap: 0, gain: 0.5, pan: 0, lineHz: 12, dev: 1, syncLev: 0.5 },
      filter:  { on: false, tap: 0, gain: 0.6, pan: 0, q: 0.5, noise: 0.5, sweepOn: false, sweepHz: 0.25, x: 0.5, gamma: 1.6 }
    };
    this.spectraFreqs = new Float32Array(NPART); // filled by cfg
    for (let i = 0; i < NPART; i++) this.spectraFreqs[i] = 55 * Math.pow(2, i * 6 / NPART);
    // ── Spectra state ──
    this.sPhase = new Float32Array(NPART);
    this.sAmp = new Float32Array(NPART);
    this.sTarget = new Float32Array(NPART);
    this.sweepPos = 0;
    this.noiseState = 1;
    // ── Orbit state ──
    this.oPhase = 0;
    this.dcX = 0; this.dcY = 0; // DC-blocker state
    this.oSlew = 0; // slewed sample for smooth
    // ── Flow grain pool ──
    this.grains = [];
    for (let g = 0; g < NGRAIN; g++) {
      this.grains.push({ on: false, t0: 0, phase: 0, inc: 0, amp: 0, pan: 0.5, age: 0, dur: 0.1, noise: 0 });
    }
    this.pending = []; // scheduled grain events (small, replaced per flow msg)
    // ── Raster state ──
    this.rPtr = 0; // read pointer in probe pixels (row-major, wraps)
    this.rDcX = 0; this.rDcY = 0;
    this.rLast = 0;
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
      return;
    }
    if (m.t === 'flow') {
      // events: flat Float32Array [tOffset, freq, amp, pan] × n (already
      // dithered + quantized by the main thread)
      const ev = m.events;
      this.pending.length = 0;
      const base = currentTime;
      for (let i = 0; i + 3 < ev.length; i += 4) {
        this.pending.push({ t0: base + ev[i], freq: ev[i + 1], amp: ev[i + 2], pan: ev[i + 3] });
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

  rebuildFilterCoefs() {
    for (let i = 0; i < NBAND; i++) {
      this.fCoef[i] = 2 * Math.sin(Math.PI * Math.min(this.fFreqs[i], sampleRate * 0.45) / sampleRate);
    }
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
      // column read : row i (bottom = low pitch) → target amp
      const cx = this.sweepPos;
      for (let i = 0; i < NPART; i++) {
        const y = 1 - (i + 0.5) / NPART; // image top = high pitch
        const v = this.terrain(tap, cx, y);
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
        for (let s = 0; s < n; s++) {
          const v = Math.sin(ph * 6.283185307179586) * a0;
          L[s] += v * gL; R[s] += v * gR;
          ph += inc;
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
              break;
            }
          }
          this.pending.splice(i, 1);
        }
      }
      const g0 = fl.gain * 0.5;
      for (let g = 0; g < NGRAIN; g++) {
        const gr = this.grains[g];
        if (!gr.on) continue;
        const gL = g0 * (1 - gr.pan);
        const gR = g0 * gr.pan;
        for (let s = 0; s < n; s++) {
          gr.age += dt;
          if (gr.age >= gr.dur) { gr.on = false; break; }
          // raised-cosine envelope
          const e = 0.5 - 0.5 * Math.cos(6.283185307179586 * Math.min(1, gr.age / gr.dur));
          // sine + a breath of noise
          this.noiseState = (this.noiseState * 1103515245 + 12345) & 0x7fffffff;
          const nz = (this.noiseState / 0x40000000 - 1) * gr.noise;
          const v = (Math.sin(gr.phase * 6.283185307179586) * (1 - gr.noise) + nz) * e * gr.amp;
          gr.phase += gr.inc;
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
        const shaped = Math.max(-1, Math.min(1, hp * 1.4));
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
      // band gains from the image column : row → band (top = high), slewed
      const cx = this.fSweep;
      for (let i = 0; i < NBAND; i++) {
        const y = 1 - (i + 0.5) / NBAND;
        this.fTarget[i] = Math.pow(this.terrain(tap, cx, y), fi.gamma);
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
