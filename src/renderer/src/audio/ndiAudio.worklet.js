// NDI® audio in : one Audio Layer slot's NDI source, played on the audio thread
// (plain JS : loaded via Vite ?url as a module asset, added with
// audioContext.audioWorklet.addModule). NDI® is a registered trademark of Vizrt
// NDI AB.
//
// The receiver runs in the preload (src/preload/ndi.ts), on NDI's frame sync,
// which resamples the source to this context's rate and to the pace it is
// pulled at. The page hands this processor a port straight to the preload (the
// sound never passes through the page) : the preload pulls steadily, every
// ~5 ms, what the time is worth (planar float, every channel of the source),
// and every ~6 ms this processor tells it how much it holds and the last chunk
// it got, so the preload trims its pace (at most 300 ppm) toward the target : in
// the long run the pulls follow THIS sound card's clock, and the frame sync
// absorbs the sender's. No resampling here.
//
// The jitter buffer only has to cover the window's main thread, where the pulls
// run (its timers, a heavy frame) : a 50 ms target. An underrun (the main thread
// held up longer) fades out, waits for the buffer to fill again, fades back in,
// and raises the target by 20 ms (up to 120 ms); 20 s without one lowers it by
// 10 ms again. More than the target + 25 ms (what arrives after a hold-up) : the
// oldest is skipped under a short crossfade. The latency never grows past it.
//
// Messages on the node's own port : in { t: 'port', port } (the preload's),
// { t: 'ch', l, r } (the channels played, r < 0 : l on both sides), { t: 'close' };
// out every ~250 ms { t: 'st', ch, conn, fillMs, targetMs, under }.

const MAXCH = 16;
const XF = 64; // a skip's crossfade, in frames

class NdiAudioIn extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = Math.ceil(sampleRate * 0.5); // the ring : half a second per channel
    this.ring = []; // Float32Array per channel, added as a source shows more
    this.chIn = 0; // channels in the ring
    this.nch = 0; // the source's channels (0 : no sound yet)
    this.w = 0; // write index
    this.fill = 0; // frames buffered
    this.base = Math.round(sampleRate * 0.05);
    this.top = Math.round(sampleRate * 0.12);
    this.target = this.base;
    this.slack = Math.round(sampleRate * 0.025);
    this.calm = 0; // frames since the last underrun (or the last target step down)
    this.run = false; // playing (else filling up to the target, silent)
    this.g = 0; // the fade gain
    this.gStep = 1 / Math.max(1, Math.round(sampleRate * 0.005));
    this.l = 0; this.r = 1; this.pl = 0; this.pr = 1;
    this.xf = 0; // channel change crossfade, frames left
    this.xfN = Math.max(1, Math.round(sampleRate * 0.01));
    this.seq = 0; // the last chunk received
    this.conn = 0;
    this.under = 0;
    this.k = 0;
    this.every = Math.max(1, Math.round((sampleRate * 0.006) / 128)); // report every ~6 ms
    this.stK = 0;
    this.stEvery = Math.max(1, Math.round((sampleRate * 0.25) / 128));
    this.src = null;
    this.closed = false;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (!m) return;
      if (m.t === 'port' && m.port) this.attach(m.port);
      else if (m.t === 'ch') this.pick(m.l | 0, m.r | 0);
      else if (m.t === 'close') {
        this.closed = true;
        try { if (this.src) this.src.close(); } catch (_) { /* gone */ }
        this.src = null;
      }
    };
  }

  attach(p) {
    try { if (this.src) this.src.close(); } catch (_) { /* gone */ }
    this.src = p;
    this.seq = 0;
    p.onmessage = (e) => this.onChunk(e.data);
    this.report();
  }

  pick(l, r) {
    if (l === this.l && r === this.r) return;
    this.pl = this.l; this.pr = this.r;
    this.l = Math.max(0, l); this.r = r;
    this.xf = this.xfN;
  }

  report() {
    if (!this.src) return;
    this.src.postMessage({ t: 'want', fill: this.fill, ack: this.seq, target: this.target });
  }

  onChunk(d) {
    if (!d || d.t !== 'a') return;
    this.conn = d.conn | 0;
    const n = d.n | 0;
    if (n <= 0 || !d.buf) return; // a status : the connection only
    this.seq = d.seq | 0;
    this.nch = d.ch | 0;
    const ch = Math.min(MAXCH, this.nch);
    if (ch <= 0) return;
    while (this.ring.length < ch) this.ring.push(new Float32Array(this.cap));
    this.chIn = ch;
    const data = new Float32Array(d.buf);
    // more than the ring holds : the newest
    const off = n > this.cap ? n - this.cap : 0;
    const m = n - off;
    const first = Math.min(m, this.cap - this.w);
    for (let c = 0; c < ch; c++) {
      const dst = this.ring[c];
      const s0 = c * n + off;
      dst.set(data.subarray(s0, s0 + first), this.w);
      if (m > first) dst.set(data.subarray(s0 + first, s0 + m), 0);
    }
    this.w = (this.w + m) % this.cap;
    this.fill = Math.min(this.cap, this.fill + m);
  }

  process(_inputs, outputs) {
    if (this.closed) return false;
    const out = outputs[0];
    const L = out[0], R = out.length > 1 ? out[1] : null;
    const N = L.length;
    if (++this.k >= this.every) { this.k = 0; this.report(); }
    if (++this.stK >= this.stEvery) {
      this.stK = 0;
      this.port.postMessage({
        t: 'st', ch: this.nch, conn: this.conn, under: this.under,
        fillMs: Math.round((this.fill * 1000) / sampleRate), targetMs: Math.round((this.target * 1000) / sampleRate)
      });
    }
    this.calm += N;
    if (this.calm > sampleRate * 20) {
      this.calm = 0;
      if (this.target > this.base) this.target = Math.max(this.base, this.target - Math.round(sampleRate * 0.01));
    }
    const nch = this.chIn;
    if (!nch) return true;
    if (!this.run) {
      if (this.fill < this.target) return true; // filling up : silence
      this.run = true; // (from g 0 : it fades in)
    }
    const cap = this.cap;
    // too much buffered (a burst after a hold-up, a lowered target) : skip to the target
    const skip = this.fill > this.target + this.slack ? this.fill - this.target : 0;
    const avail = this.fill - skip;
    const n = avail < N ? avail : N;
    const starving = avail < N;
    const rd = (this.w - this.fill + cap) % cap;
    // the channels played, within what the source has (a mono pick : both sides)
    const last = nch - 1;
    const lc = this.l > last ? last : this.l;
    const rc = this.r < 0 ? lc : this.r > last ? last : this.r;
    const plc = this.pl > last ? last : this.pl;
    const prc = this.pr < 0 ? plc : this.pr > last ? last : this.pr;
    const ring = this.ring;
    // underrun : what is there fades out
    const down = starving && n > 0 ? this.g / n : 0;
    for (let i = 0; i < n; i++) {
      let p = rd + skip + i; if (p >= cap) p -= cap; if (p >= cap) p -= cap;
      let a = ring[lc][p], b = ring[rc][p];
      if (this.xf > 0) {
        const t = this.xf / this.xfN;
        a = a + (ring[plc][p] - a) * t;
        b = b + (ring[prc][p] - b) * t;
        this.xf--;
      }
      if (skip && i < XF) {
        let q = rd + i; if (q >= cap) q -= cap;
        const t = 1 - i / XF;
        a = a + (ring[lc][q] - a) * t;
        b = b + (ring[rc][q] - b) * t;
      }
      if (starving) this.g = Math.max(0, this.g - down);
      else if (this.g < 1) this.g = Math.min(1, this.g + this.gStep);
      L[i] = a * this.g;
      if (R) R[i] = b * this.g;
    }
    this.fill -= skip + n;
    if (starving) {
      // the rest of this quantum stays silent (the outputs start zeroed)
      this.run = false;
      this.g = 0;
      this.under++;
      this.calm = 0;
      this.target = Math.min(this.top, this.target + Math.round(sampleRate * 0.02));
    }
    return true;
  }
}
registerProcessor('ndi-audio-in', NdiAudioIn);
