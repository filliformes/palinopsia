// Target-driven assembly : the edit chases the picture.
//
// This is the concatenative move in full. The vision bus already reduces the
// COMPOSITED output to brightness / contrast / motion / edges / entropy /
// centroid / warmth — the same first eight axes the corpus was measured on — so
// "what is on screen right now" is directly a point in descriptor space. Each
// time an assemblage needs its next clip, we look up the corpus unit nearest
// that point (or farthest, per the contrast dial) and cut to it.
//
// The Compositor can't do this itself : it must not import the store. So the
// App loop calls `syncLiveMatchers` once a frame, which installs a closure on
// any assemble slot whose recipe asks for live mode and removes it otherwise.

import {
  LIVE_DESC_N,
  DESC_N,
  distance,
  zscore,
  type AssembleClip,
  type AssembleCorpus,
  type AssembleParams
} from '@shared/assemble'
import type { Compositor } from '../engine/Compositor'
import type { OutputFrame } from '@shared/types'
import { visionBus } from '../engine/visionIn'
import { boltzmannPick, curveMul, joinScale, mulberry32 } from './match'
import { useStore } from '../store'

/** Read the live image as a descriptor point (the first LIVE_DESC_N axes).
 *  The bus computes these with the analyser's own `frameStats`, so corpus and
 *  image really are on one ruler; the legacy `feature()` values are NOT
 *  interchangeable with them (different definitions of contrast and warmth). */
export function liveDescriptor(): number[] {
  return visionBus.descriptor() ?? new Array<number>(LIVE_DESC_N).fill(0.5)
}

/** Build the per-cut chooser for one assemblage. */
function makeMatcher(
  corpus: AssembleCorpus,
  params: AssembleParams,
  seed: number
): (prevUnitId: string | null) => AssembleClip | null {
  const { units, mean, std } = corpus
  const z = units.map((u) => zscore(u.desc, mean, std))
  const zTail = units.map((u) => zscore(u.tail ?? u.desc, mean, std))
  const zHead = units.map((u) => zscore(u.head ?? u.desc, mean, std))
  const w = params.weights.length === DESC_N ? params.weights : new Array<number>(DESC_N).fill(1)
  const byId = new Map(units.map((u, i) => [u.id, i]))
  const rng = mulberry32(seed)
  const recent: number[] = []
  let step = 0

  // Same join-distance scale as offline generation, so the contrast dial and σ
  // behave identically whether the edit was built ahead or is being chosen live.
  const dRef = joinScale(zTail, zHead, w, rng)

  return (prevUnitId) => {
    if (!units.length) return null
    if (!visionBus.hasData()) return null
    const live = liveDescriptor()
    const target = new Array<number>(DESC_N).fill(0)
    for (let i = 0; i < LIVE_DESC_N; i++) target[i] = (live[i] - mean[i]) / std[i];

    const pi = prevUnitId != null ? byId.get(prevUnitId) : undefined
    // Measured from how the outgoing clip ENDS, not from its average.
    const prev = pi !== undefined ? zTail[pi] : null
    const wantJoin = params.contrast * dRef

    const scored: Array<{ i: number; cost: number }> = []
    for (let i = 0; i < units.length; i++) {
      if (recent.includes(i)) continue
      const tc = distance(z[i], target, w)
      const cc = prev ? Math.abs(distance(zHead[i], prev, w) - wantJoin) : 0
      scored.push({ i, cost: tc + cc })
    }
    if (!scored.length) {
      recent.length = 0
      return null
    }
    const pick = boltzmannPick(scored, params.variety * dRef * 0.5, rng())
    if (pick < 0) {
      recent.length = 0
      return null
    }

    recent.push(pick)
    while (recent.length > Math.min(params.noRepeat, Math.max(0, units.length - 2))) recent.shift();

    // The curves still shape time; with no fixed length to run against, the
    // sequence position simply cycles so the dilation keeps breathing.
    const u = units[pick]
    const progress = (step++ % 32) / 32
    const speed = Math.min(8, Math.max(0.1, curveMul(params.spdShape, progress, params.spdAmount, rng())))
    const durSec = Math.min(20, Math.max(0.05, u.dur * curveMul(params.lenShape, progress, params.lenAmount, rng())))
    const inSec = Math.max(0, Math.min(u.start, Math.max(0, u.fileDur - durSec * speed)))
    return { unitId: u.id, file: u.file, fileName: u.fileName, inSec, durSec, speed }
  }
}

// One matcher per (layer, slot). Rebuilt only when something it CAPTURED
// changes — rebuilding every frame would reset the no-repeat history at each
// cut, but keying on the assemblage id alone meant the closure went on scoring
// against the recipe and corpus it was born with: dragging similar↔contrast, or
// re-analysing the folder, changed nothing until you regenerated.
const installed = new Map<string, string>()

/** Everything `makeMatcher` closes over, as a cheap comparable string. */
function recipeKey(corpus: AssembleCorpus | null, p: AssembleParams): string {
  return [
    corpus ? `${corpus.folder}|${corpus.units.length}|${corpus.analyzedAt}` : '-',
    p.contrast, p.variety, p.noRepeat,
    p.lenShape, p.lenAmount, p.spdShape, p.spdAmount,
    p.weights.join(',')
  ].join('~')
}

/** Called once per frame by the App loop, after syncFromState. */
export function syncLiveMatchers(comp: Compositor): void {
  const st = useStore.getState()
  const corpus = st.assembleCorpus
  const params = st.assembleParams
  const live = params.mode === 'live' && !!corpus && corpus.units.length > 0

  for (let li = 0; li < st.composition.layers.length; li++) {
    const L = comp.layers[li]
    if (!L) continue
    for (const slot of ['A', 'B'] as const) {
      const src = L.assemble(slot)
      const key = `${li}:${slot}`
      if (!src) {
        installed.delete(key)
        continue
      }
      const layer = st.composition.layers[li]
      const s = slot === 'A' ? layer.sourceA : layer.sourceB
      const id = s?.mediaId ?? ''
      const want = live ? `${id}~${recipeKey(corpus, params)}` : ''
      if (installed.get(key) === want) continue
      installed.set(key, want)
      if (!live || !corpus) src.setLiveMatcher(null)
      else src.setLiveMatcher(makeMatcher(corpus, params, hashSeed(id)))
    }
  }
}

/**
 * Gather every assemble slot's position for the output-window payload, and
 * drain any clip a live matcher chose this frame. Returns undefined when no
 * assemblage is on air, so the common case adds nothing to the frame.
 */
export function collectAssembleSync(comp: Compositor): OutputFrame['assemble'] {
  let out: NonNullable<OutputFrame['assemble']> | undefined
  for (let li = 0; li < comp.layers.length; li++) {
    const L = comp.layers[li]
    if (!L) continue
    for (const slot of ['A', 'B'] as const) {
      const src = L.assemble(slot)
      if (!src) continue
      const { idx, elapsed } = src.syncState()
      const clips = src.takeChangedList()
      ;(out ??= []).push({ key: `${li}:${slot}`, idx, elapsed, ...(clips ? { clips } : {}) })
    }
  }
  return out
}

/** Output-window side : append newly-matched clips, then follow the position. */
export function applyAssembleSync(comp: Compositor, rows: OutputFrame['assemble']): void {
  if (!rows) return
  for (const r of rows) {
    const ci = r.key.indexOf(':')
    const L = comp.layers[Number(r.key.slice(0, ci))]
    const src = L?.assemble(r.key.slice(ci + 1) === 'B' ? 'B' : 'A')
    if (!src) continue
    if (r.clips) src.replaceClips(r.clips)
    src.syncPosition(r.idx, r.elapsed)
  }
}

const hashSeed = (s: string): number => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
