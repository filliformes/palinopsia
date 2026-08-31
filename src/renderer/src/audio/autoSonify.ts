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

type Voice = 'raster' | 'flow' | 'orbit' | 'spectra' | 'sstv' | 'filter' | 'events' | 'chord'

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
  [/^(recurse|sync-osc|fx-abstraction|fx-colorizer)$/, 'filter', 2],
  // edges / marks / rhythmic hits → Events (edges & motion → plucked notes, the
  // percussive register). Weight 2 : a secondary colour to the anchors above,
  // never demoting them (Events loses ties, see the ranked order below).
  [/^(direct-marks|fx-stutter|fx-slice-shuffle|node-decimate|fx-sync-loss|fx-row-echo)$/, 'events', 2],
  [/^(ten-print|op-art|contour|filaments|fx-scanlines)$/, 'events', 2],
  // sustained harmonic wash / drones / accumulation → Chord (a scale-tuned bank
  // that swells with the brightness bands — sings even on a still frame).
  [/^(swell|membrane|dye-field|drift-field|erosion)$/, 'chord', 2],
  [/^(congeal|node-sediment|node-eternalism|node-afterimage|recurse|sync-osc)$/, 'chord', 2]
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
  const ranked = (['spectra', 'orbit', 'flow', 'raster', 'sstv', 'filter', 'events', 'chord'] as Voice[])
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
    events: { ...cur.events, on: chosen.has('events'), tap: tapFor('events') },
    raster: { ...cur.raster, on: chosen.has('raster'), tap: tapFor('raster') },
    sstv: { ...cur.sstv, on: chosen.has('sstv'), tap: tapFor('sstv') },
    filter: { ...cur.filter, on: chosen.has('filter'), tap: tapFor('filter') },
    chord: { ...cur.chord, on: chosen.has('chord'), tap: tapFor('chord') }
  }
}

// ── Randomize Sonification (the Randomizer's 'sonify' scope) ─────────────
const rnd = (): number => Math.random()
const rr = (lo: number, hi: number): number => lo + rnd() * (hi - lo)
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]

/** A fresh random sound patch : 2–3 voices, a new key/scale, tasteful probe +
 *  character draws. The on-state, output device and master gain are kept —
 *  the dice re-voices the instrument, it never blasts or silences it. */
// Per-voice parameter randomizers (character only — `on`/`tap` set by the caller).
// Shared by the whole-instrument dice and the per-voice dice.
export type SoniVoiceKey = 'spectra' | 'orbit' | 'flow' | 'events' | 'raster' | 'sstv' | 'filter' | 'chord'
const R_PARAMS: Record<SoniVoiceKey, (c: SoniConfig) => Record<string, unknown>> = {
  spectra: (c) => ({ ...c.spectra, quantize: rnd() < 0.85, sweepOn: rnd() < 0.75, sync: rnd() < 0.3, sweepHz: rr(0.06, 0.8), x: rr(0.2, 0.8), path: pick([0, 0, 0, 1, 2, 3]), pace: rnd() < 0.4 ? rr(0.2, 0.8) : 0, gamma: rr(1.2, 2.6), breath: rnd() < 0.4 ? rr(0.2, 0.7) : 0, loOct: pick([1, 2, 2, 3]), hiOct: pick([6, 7, 7, 8]) }),
  orbit: (c) => ({ ...c.orbit, quantize: rnd() < 0.85, note: 33 + Math.floor(rnd() * 28), cx: rr(0.3, 0.7), cy: rr(0.3, 0.7), rx: rr(0.08, 0.35), ry: rr(0.08, 0.35), ratio: pick([1, 2, 1.5, 3]), drive: rr(0.6, 2), smooth: rr(0.2, 0.8) }),
  flow: (c) => ({ ...c.flow, quantize: rnd() < 0.85, sense: rr(0.3, 0.7), density: rr(0.3, 0.8), dur: rr(0.05, 0.2), noise: rr(0, 0.4), colour: rnd() < 0.6 ? rr(0.3, 0.9) : 0 }),
  events: (c) => ({ ...c.events, quantize: rnd() < 0.85, mode: pick(['spatial', 'motion', 'blend'] as const), sense: rr(0.3, 0.7), density: rr(0.3, 0.7), decay: rr(0.2, 0.6), highs: rr(0.3, 0.9), wave: pick([0, 1, 2, 3]) }),
  raster: (c) => ({ ...c.raster, quantize: rnd() < 0.85, note: 33 + Math.floor(rnd() * 24), rx: rr(0.1, 0.5), ry: rr(0.1, 0.5), rw: rr(0.15, 0.45), rh: rr(0.1, 0.35), smooth: rnd() < 0.5 ? 0 : rr(0.3, 1), tone: rr(0.35, 1) }),
  sstv: (c) => ({ ...c.sstv, lineHz: rr(4, 28), sync: rnd() < 0.35, dev: rr(0.5, 1.5), syncLev: rr(0.2, 0.8) }),
  filter: (c) => ({ ...c.filter, quantize: rnd() < 0.4, sweepOn: rnd() < 0.6, sweepHz: rr(0.05, 0.6), x: rr(0.2, 0.8), path: pick([0, 0, 1, 2, 3]), pace: rnd() < 0.4 ? rr(0.2, 0.8) : 0, q: rr(0.3, 0.85), noise: rr(0.3, 0.8), gamma: rr(1.2, 2.4) }),
  chord: (c) => ({ ...c.chord, voices: 3 + Math.floor(rnd() * 8), loOct: pick([1, 2, 2, 3]), hiOct: pick([5, 6, 6, 7]), gamma: rr(1.2, 2.4), spread: rr(0.3, 0.9), attack: rr(0.1, 1.2), release: rr(0.3, 2), tone: rr(0, 0.6) })
}

/** Randomize the whole Sonify instrument : pick 2–3 voices, re-roll their params,
 *  a key/scale/octave, and maybe an FX tail. `on`/`sinkId` are kept by the caller. */
export function randomSonify(cur: SoniConfig): SoniConfig {
  const all: SoniVoiceKey[] = ['spectra', 'orbit', 'flow', 'events', 'raster', 'sstv', 'filter', 'chord']
  const bag = [...all]
  for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1));[bag[i], bag[j]] = [bag[j], bag[i]] }
  const chosen = new Set(bag.slice(0, rnd() < 0.4 ? 3 : 2))
  // Guarantee at least one voice that sings on ANY frame — Flow & Events need
  // MOTION, so a dice that picks only those would be silent on a still image.
  const alwaysAudible: SoniVoiceKey[] = ['spectra', 'orbit', 'raster', 'sstv', 'filter', 'chord']
  if (![...chosen].some((v) => alwaysAudible.includes(v))) chosen.add(pick(alwaysAudible))
  const scales = ['minor', 'major', 'pentatonic', 'dorian', 'phrygian', 'lydian', 'wholetone'] as const
  const V = (k: SoniVoiceKey): Record<string, unknown> => ({ ...R_PARAMS[k](cur), on: chosen.has(k), tap: 0 })
  return {
    ...cur,
    root: Math.floor(rnd() * 12),
    rootOct: pick([2, 3, 3, 4]),
    scale: pick(scales),
    taps: [{ kind: 'master', layer: 0 }, cur.taps[1]],
    spectra: V('spectra') as SoniConfig['spectra'],
    orbit: V('orbit') as SoniConfig['orbit'],
    flow: V('flow') as SoniConfig['flow'],
    events: V('events') as SoniConfig['events'],
    raster: V('raster') as SoniConfig['raster'],
    sstv: V('sstv') as SoniConfig['sstv'],
    filter: V('filter') as SoniConfig['filter'],
    chord: V('chord') as SoniConfig['chord'],
    fx: rnd() < 0.5
      ? { ...cur.fx, send: rr(0.2, 0.5), rvMode: pick([0, 1]), rvSize: rr(0.4, 0.85), rvDecay: rr(0.4, 0.8), dlyTime: rr(0.1, 0.6), dlyFb: rr(0.2, 0.5), dlyMode: pick([0, 1, 2]) }
      : { ...cur.fx, send: 0 }
  }
}

/** Re-roll a single voice's params (leaving the rest of the mix untouched), and
 *  switch it on — for the per-voice dice. */
export function randomizeVoice(cur: SoniConfig, voice: SoniVoiceKey): SoniConfig {
  const params = { ...R_PARAMS[voice](cur), on: true, tap: cur[voice].tap }
  return { ...cur, [voice]: params } as SoniConfig
}
