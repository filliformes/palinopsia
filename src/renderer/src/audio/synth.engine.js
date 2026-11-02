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
// The body here is a STAND-IN (plain sine voices with an envelope) so the
// play side can be built and heard before the real engines land.
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
//       voices:  'poly' | 'unison' | 'mono', (poly : 6 voices)
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

class OpsiaSynthStandIn {
  constructor(sampleRate) {
    this.sr = sampleRate
    this.cfg = { attack: 0.05, release: 0.3, level: 0.7, voices: 'poly' }
    this.v = []
    for (let i = 0; i < 6; i++) this.v.push({ id: -1, hz: 220, ph: 0, env: 0, gate: false, vel: 0, age: 0, pan: 0 })
    this.clock = 0
  }
  setConfig(cfg) { this.cfg = { ...this.cfg, ...cfg } }
  find(id) { return this.v.find((x) => x.id === id) }
  noteOn(id, hz, vel) {
    let x = this.find(id)
    if (!x) x = this.v.find((y) => !y.gate && y.env < 1e-4) || this.v.reduce((a, b) => (a.age < b.age ? a : b))
    x.id = id; x.hz = hz; x.vel = vel; x.gate = true; x.age = ++this.clock
  }
  setPitch(id, hz) { const x = this.find(id); if (x) x.hz = hz }
  noteOff(id) { const x = this.find(id); if (x) x.gate = false }
  setMods(id, m) { const x = this.find(id); if (x && typeof m.pan === 'number') x.pan = m.pan }
  allOff() { for (const x of this.v) x.gate = false }
  activeVoices() { return this.v.filter((x) => x.gate || x.env > 1e-4).length }
  render(outL, outR, n) {
    const a = 1 / Math.max(1, (this.cfg.attack || 0.05) * this.sr)
    const r = 1 / Math.max(1, (this.cfg.release || 0.3) * this.sr)
    const lvl = (this.cfg.level ?? 0.7) * 0.2
    for (const x of this.v) {
      if (!x.gate && x.env <= 0) continue
      const inc = (6.283185307179586 * x.hz) / this.sr
      const gl = Math.cos((x.pan + 1) * 0.7853981633974483), gr = Math.sin((x.pan + 1) * 0.7853981633974483)
      for (let i = 0; i < n; i++) {
        x.env = x.gate ? Math.min(1, x.env + a) : Math.max(0, x.env - r)
        const s = Math.sin(x.ph) * x.env * x.vel * lvl
        x.ph += inc
        if (x.ph > 6.283185307179586) x.ph -= 6.283185307179586
        outL[i] += s * gl
        outR[i] += s * gr
      }
    }
  }
}

globalThis.OpsiaSynth = OpsiaSynthStandIn
