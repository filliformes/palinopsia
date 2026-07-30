// Auto-sonify : choose the sonification voices FROM the image. Reads the
// session's actual vocabulary — which generators, native nodes and FX are
// live on which layers — and scores the six voices by register affinity :
//
//   glitch / data damage        → RASTER        (audification IS that register)
//   motion / flow / video       → FLOW          (whatever moves, sings)
//   feedback / temporal alive   → ORBIT         (the mutating frame as timbre)
//   line-work / lattices        → SPECTRA       (a spectrogram wants lines)
//   scan / broadcast register   → TRANSMISSION  (line-sequential is its shape)
//   smooth atmosphere / fields  → FILTER        (the frame as a band EQ)
//
// The top 2 (3 when the third is close) voices switch on with sensible params;
// the strongest voice listens to the LAYER that earned it (tap B) when more
// than one layer is active, everything else reads the master. The quantizer
// key/scale, gains the user already set, and probe positions are preserved.

import type { CompositionState, FxInstance } from '@shared/types'
import type { SoniConfig } from './sonify'

type Voice = 'raster' | 'flow' | 'orbit' | 'spectra' | 'sstv' | 'filter'

// Register tables : shader/node id → (voice, weight). Weights are taste.
const AFFINITY: Array<[RegExp, Voice, number]> = [
  // glitch / data damage → Raster
  [/^(node-datamosh|fx-databend|fx-pixelsort|fx-compress|fx-byte-corrupt|fx-mosh-blocks)$/, 'raster', 3],
  [/^(node-decimate|node-autocutter|fx-slice-shuffle|fx-stutter|fx-sync-loss|fx-row-echo|fx-ringing)$/, 'raster', 2],
  // motion → Flow
  [/^(murmuration|particle-drift|ash|metamorph|reaction|node-transfert)$/, 'flow', 3],
  [/^(fx-difference-bloom|fx-granular|organic|mycelium)$/, 'flow', 2],
  // feedback / temporal → Orbit
  [/^(node-feedback|congeal|node-chronoscan|node-sediment)$/, 'orbit', 3],
  [/^(fx-feedback-zoom|fx-wide-time|fx-light-trails|node-eternalism|node-afterimage|fx-phosphene)$/, 'orbit', 2],
  // line-work / lattices → Spectra
  [/^(ten-print|grid-drift|slabs|contour|filaments|interference|ramps|op-art|direct-marks)$/, 'spectra', 3],
  [/^(fx-rutt|fx-scanlines|differential|rgb-osc|shapes|fx-wavefold|fx-pixelmask)$/, 'spectra', 2],
  // scan / broadcast → Transmission
  [/^(slit-scan|column-scan|node-scanner|fx-slit-buffer|fx-tracking|fx-crt-screen)$/, 'sstv', 3],
  // smooth fields / atmosphere → Filter
  [/^(swell|membrane|dye-field|drift-field|erosion)$/, 'filter', 3],
  [/^(recurse|sync-osc|fx-abstraction|fx-colorizer)$/, 'filter', 2]
]

function scoreId(id: string | null | undefined, into: Map<Voice, number>, weightMul = 1): void {
  if (!id) return
  for (const [re, voice, w] of AFFINITY) {
    if (re.test(id)) into.set(voice, (into.get(voice) ?? 0) + w * weightMul)
  }
}

/** Analyse the composition and return a re-voiced config. Pure function :
 *  taste tables above, no randomness — the same session always suggests the
 *  same setup, so it's a starting point you can trust and then bend. */
export function suggestSonify(c: CompositionState, cur: SoniConfig): SoniConfig {
  const total = new Map<Voice, number>()
  const perLayer: Array<Map<Voice, number>> = []

  const rack = (fx: FxInstance[], into: Map<Voice, number>, mul: number): void => {
    for (const f of fx) if (f.enabled) scoreId(f.shaderId, into, mul)
  }

  c.layers.forEach((l) => {
    const mine = new Map<Voice, number>()
    // A slot with no shaderId still counts when it carries live footage —
    // video, capture, HIVE or an assemblage. (Assemble was missing here, so a
    // layer whose only source was an edit read as an empty layer.)
    const footage = (k: string): boolean =>
      k === 'video' || k === 'capture' || k === 'hive' || k === 'assemble'
    const active =
      (!!l.sourceA.shaderId ||
        footage(l.sourceA.kind) ||
        !!l.sourceB?.shaderId ||
        (!!l.sourceB && footage(l.sourceB.kind))) &&
      !l.mute
    if (active) {
      scoreId(l.sourceA.shaderId, mine)
      // Footage is motion by nature — and an assemblage is footage that CUTS,
      // so it earns a little extra (hard cuts are the loudest motion there is).
      if (footage(l.sourceA.kind)) {
        mine.set('flow', (mine.get('flow') ?? 0) + (l.sourceA.kind === 'assemble' ? 4 : 3))
      }
      if (l.sourceB && footage(l.sourceB.kind)) {
        mine.set('flow', (mine.get('flow') ?? 0) + 2)
      }
      if (l.sourceB?.shaderId) scoreId(l.sourceB.shaderId, mine, 0.7)
      rack(l.sourceAFx, mine, 0.8)
      rack(l.sourceBFx, mine, 0.5)
      rack(l.fx, mine, 1)
      if (l.feedback && l.feedbackAmount > 0.2) mine.set('orbit', (mine.get('orbit') ?? 0) + 2)
    }
    perLayer.push(mine)
    for (const [v, w] of mine) total.set(v, (total.get(v) ?? 0) + w * Math.max(0.3, l.opacity))
  })
  // Master rack shapes everything : half weight.
  rack(c.master.filter((f) => !f.locked), total, 0.5)

  // Rank; always have something to say (a quiet scene defaults to Spectra+Filter).
  const ranked = (['spectra', 'orbit', 'flow', 'raster', 'sstv', 'filter'] as Voice[])
    .map((v) => ({ v, w: total.get(v) ?? 0 }))
    .sort((a, b) => b.w - a.w)
  const chosen = new Set<Voice>()
  if (ranked[0].w <= 0) {
    chosen.add('spectra').add('filter')
  } else {
    chosen.add(ranked[0].v)
    if (ranked[1].w > 0) chosen.add(ranked[1].v)
    if (ranked[2].w > 0 && ranked[2].w >= ranked[0].w * 0.5) chosen.add(ranked[2].v)
  }

  // Tap plan : the strongest voice listens to the layer that earned it when
  // several layers are alive; everything else reads the master.
  let soloLayer = -1
  const activeLayers = perLayer.filter((m) => m.size > 0).length
  if (activeLayers > 1 && ranked[0].w > 0) {
    let best = -1, bw = 0
    perLayer.forEach((m, i) => {
      const w = m.get(ranked[0].v) ?? 0
      if (w > bw) { bw = w; best = i }
    })
    soloLayer = best
  }
  const taps: SoniConfig['taps'] = [
    { kind: 'master', layer: 0 },
    soloLayer >= 0 ? { kind: 'layer', layer: soloLayer } : cur.taps[1]
  ]
  const tapFor = (v: Voice): number => (v === ranked[0].v && soloLayer >= 0 ? 1 : 0)

  // Assemble : keep the user's key/scale, gains, probes; switch the voice set
  // + taps and nudge a few character params per register.
  return {
    ...cur,
    taps,
    spectra: { ...cur.spectra, on: chosen.has('spectra'), tap: tapFor('spectra'), sweepOn: true, quantize: cur.spectra.quantize },
    orbit: { ...cur.orbit, on: chosen.has('orbit'), tap: tapFor('orbit') },
    flow: { ...cur.flow, on: chosen.has('flow'), tap: tapFor('flow') },
    raster: { ...cur.raster, on: chosen.has('raster'), tap: tapFor('raster') },
    sstv: { ...cur.sstv, on: chosen.has('sstv'), tap: tapFor('sstv') },
    filter: { ...cur.filter, on: chosen.has('filter'), tap: tapFor('filter') }
  }
}

// ── Randomize Sonification (the Randomizer's 'sonify' scope) ─────────────
const rnd = (): number => Math.random()
const rr = (lo: number, hi: number): number => lo + rnd() * (hi - lo)
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]

/** A fresh random sound patch : 2–3 voices, a new key/scale, tasteful probe +
 *  character draws. The on-state, output device and master gain are kept —
 *  the dice re-voices the instrument, it never blasts or silences it. */
export function randomSonify(cur: SoniConfig): SoniConfig {
  const voices: Voice[] = ['spectra', 'orbit', 'flow', 'raster', 'sstv', 'filter']
  for (let i = voices.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[voices[i], voices[j]] = [voices[j], voices[i]]
  }
  const chosen = new Set(voices.slice(0, rnd() < 0.4 ? 3 : 2))
  const scales = ['minor', 'major', 'pentatonic', 'dorian', 'phrygian', 'lydian', 'wholetone'] as const
  const q = rnd() < 0.8 // quantize mostly on : musical by default
  return {
    ...cur,
    root: Math.floor(rnd() * 12),
    scale: pick(scales),
    taps: [{ kind: 'master', layer: 0 }, cur.taps[1]],
    spectra: {
      ...cur.spectra, on: chosen.has('spectra'), tap: 0, quantize: q,
      sweepOn: rnd() < 0.75, sync: rnd() < 0.3, sweepHz: rr(0.06, 0.8), x: rr(0.2, 0.8),
      gamma: rr(1.2, 2.6), breath: rnd() < 0.4 ? rr(0.2, 0.7) : 0
    },
    orbit: {
      ...cur.orbit, on: chosen.has('orbit'), tap: 0, quantize: q,
      note: 33 + Math.floor(rnd() * 28), cx: rr(0.3, 0.7), cy: rr(0.3, 0.7),
      rx: rr(0.08, 0.35), ry: rr(0.08, 0.35), ratio: pick([1, 2, 1.5, 3]),
      drive: rr(0.6, 2), smooth: rr(0.2, 0.8)
    },
    flow: {
      ...cur.flow, on: chosen.has('flow'), tap: 0, quantize: q,
      sense: rr(0.3, 0.7), density: rr(0.3, 0.8), dur: rr(0.05, 0.2), noise: rr(0, 0.4)
    },
    raster: {
      ...cur.raster, on: chosen.has('raster'), tap: 0, quantize: q,
      note: 33 + Math.floor(rnd() * 24), rx: rr(0.1, 0.5), ry: rr(0.1, 0.5),
      rw: rr(0.15, 0.45), rh: rr(0.1, 0.35), smooth: rnd() < 0.5 ? 0 : rr(0.3, 1),
      tone: rr(0.35, 1)
    },
    sstv: {
      ...cur.sstv, on: chosen.has('sstv'), tap: 0,
      lineHz: rr(4, 28), sync: rnd() < 0.35, dev: rr(0.5, 1.5), syncLev: rr(0.2, 0.8)
    },
    filter: {
      ...cur.filter, on: chosen.has('filter'), tap: 0, quantize: q && rnd() < 0.5,
      sweepOn: rnd() < 0.6, sweepHz: rr(0.05, 0.6), x: rr(0.2, 0.8),
      q: rr(0.3, 0.85), noise: rr(0.3, 0.8), gamma: rr(1.2, 2.4)
    }
  }
}
