// Coupling engine (Slab 1 spine + Slab 2 mode catalogue). Binds a layer's two
// voices (source A + B) with an audio feature, writing the effective sourceMix
// onto the compositor each frame (post-modulation), and publishing it
// (liveCoupledMix) so the Mixer can show where the sound pushes each mix.
//
// Modes = the synchresis catalogue as A/B-balance behaviours:
//   lean   : audio leans the balance toward B (continuous, additive)
//   hocket : audio SETS the balance A↔B (interpolate; pumps at amount 1)
//   cut    : transient FLASHES to B, then releases (on-cut; percussive)
//   gate   : B while loud, A while quiet (sustained threshold)
//   drift  : slow momentum follow (congruent-movement; shares direction)
//
// `tightness` is the universal response-sharpness: for cut it's the release
// tail, for gate the edge hardness, for drift the follow speed, and for
// lean/hocket the vestigial↔obvious exponent.
//
// The Mixer's master switch (store couplingOn) pauses every layer's coupling at
// once : each mix then sits where its slider is.

import type { CompositionState } from '@shared/types'
import { audioBus } from './audioIn'

// NaN-safe : a partial/malformed coupling block could feed NaN through here,
// and `v < 0 ? … : v` would pass NaN straight to layer.sourceMix, blanking the
// layer's crossfade. Coerce a non-finite input to 0.
const clamp01 = (v: number): number => (v > 0 ? (v > 1 ? 1 : v) : 0)
const smoothstep = (a: number, b: number, x: number): number => {
  if (a === b) return x < a ? 0 : 1
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

// Per-layer runtime state (cut's decaying flash and whether the feature is
// still above its threshold, gate's side of its edge, drift's integrator, the
// mode it last ran in). Fixed to the four layers; index-keyed, lazily created.
const state: Array<{ held: number; up: boolean; open: boolean; mode: string }> = []

/** Each layer's mix as the coupling leaves it this frame, or null where no
 *  coupling runs (off, no B, the audio input off, the master switch off). The
 *  Mixer reads it to draw where the sound pushes the crossfader. */
export const liveCoupledMix: Array<number | null> = [null, null, null, null]
// Wall-clock of the previous applyCoupling(), so the cut release + drift follow
// run at a fixed rate regardless of frame rate.
let lastNow = 0

/** Clear the per-layer coupling state : call when the composition is replaced
 *  (scene recall / New / session load) so a stale cut value can't seed the
 *  next scene's coupling. `keepDrift` (a scene recall, which eases) keeps a
 *  drifting layer's momentum : zeroing it snapped that mix back at once while
 *  everything else was still easing. */
export function resetCouplingState(keepDrift = false): void {
  if (keepDrift) {
    for (const s of state) if (s && s.mode !== 'drift') { s.held = 0; s.up = false; s.open = false }
  } else state.length = 0
  lastNow = 0
}

/**
 * Apply A/B coupling to every layer with a live B voice. Writes the coupled
 * sourceMix onto `comp.layers[i]` and returns the per-layer mixes (or null if
 * nothing is coupled). Inert until audio ingest is on.
 */
export function applyCoupling(
  comp: { layers: Array<{ sourceMix: number }> },
  c: CompositionState,
  now: number,
  enabled = true
): number[] | null {
  // Inert until audio ingest is on : otherwise a silent bus reads as "all A".
  // And paused by the master switch.
  if (audioBus.mode === 'off' || !enabled) {
    liveCoupledMix.fill(null)
    lastNow = 0
    return null
  }
  // Frame-rate normalizer: 1 at 60fps, larger when frames are longer.
  const fk = lastNow ? Math.min(6, Math.max(0.1, ((now - lastNow) / 1000) * 60)) : 1
  lastNow = now
  let any = false
  const out = c.layers.map((l, i) => {
    const layer = comp.layers[i]
    const base = layer ? layer.sourceMix : (l.sourceMix ?? 0.5)
    const cp = l.coupling
    liveCoupledMix[i] = null
    if (!layer || !cp || cp.mode === 'off') return base
    // Needs a real second voice : the crossfade is inert without B.
    if (!l.sourceB || l.sourceB.kind === 'none') return base
    if (!state[i]) state[i] = { held: 0, up: false, open: false, mode: cp.mode }
    const s = state[i]
    s.mode = cp.mode

    // the band feature listens to the band the layer picked (0 : the lowest)
    const raw = clamp01(audioBus.feature(cp.feature, Math.max(0, Math.round(cp.band ?? 0))))
    const tight = clamp01(cp.tightness)
    const amt = clamp01(cp.amount)
    const shaped = Math.pow(raw, 1 + (1 - tight) * 3)
    const toB = (g: number): number => base + g * amt * (1 - base) // lean base→B by g

    let eff = base
    switch (cp.mode) {
      case 'lean':
        eff = toB(shaped)
        break
      case 'hocket':
        eff = base * (1 - amt) + shaped * amt
        break
      case 'cut':
        // Flash to B as the feature RISES past the threshold, then release.
        // It fires again only once the feature has fallen back under 0.3, so a
        // held level or a sustained pitch flashes once instead of parking the
        // layer on B. Tight = snappy short flash; loose = a longer tail
        // (release factor 0.60 … 0.98 per 60fps frame).
        if (raw > 0.4 && !s.up) {
          s.held = 1
          s.up = true
        } else {
          if (raw < 0.3) s.up = false
          s.held *= Math.pow(0.6 + tight * 0.38, fk)
        }
        eff = toB(s.held)
        break
      case 'gate': {
        // B while loud, A while quiet; tightness hardens the edge (a soft
        // swell at 0, a switch at 1), round the same threshold. The harder the
        // edge, the more it holds the side it is on (a Schmitt edge : the band
        // moves down once crossed upward, up once crossed back) : a feature
        // hovering on the line no longer flips the whole layer A / B at frame
        // rate. It flips past the band's far end, so the mix never jumps.
        const w = 0.03 + (1 - tight) * 0.3
        const hy = 0.03 * tight * tight
        if (!s.open && raw >= 0.426 + hy + w / 2) s.open = true
        else if (s.open && raw <= 0.426 - hy - w / 2) s.open = false
        const edge = 0.426 + (s.open ? -hy : hy)
        eff = toB(smoothstep(edge - w / 2, edge + w / 2, raw))
        break
      }
      case 'drift': {
        // Slow one-pole follow : momentum, not morphology (congruent movement).
        const a = 1 - Math.pow(1 - (0.01 + tight * 0.06), fk)
        s.held += (raw - s.held) * a
        eff = toB(s.held)
        break
      }
    }
    eff = clamp01(eff)
    layer.sourceMix = eff
    liveCoupledMix[i] = eff
    any = true
    return eff
  })
  return any ? out : null
}
