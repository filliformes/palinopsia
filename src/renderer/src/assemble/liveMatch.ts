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
  DESCRIPTORS,
  LIVE_DESC_N,
  DESC_N,
  distance,
  zscore,
  type AssembleClip,
  type AssembleCorpus,
  type AssembleParams
} from '@shared/assemble'
import type { Compositor } from '../engine/Compositor'
import { visionBus, type VisionFeatureName } from '../engine/visionIn'
import { boltzmannPick, curveMul, joinScale, mulberry32 } from './match'
import { useStore } from '../store'

/** Read the live image as a descriptor point (the first LIVE_DESC_N axes). */
export function liveDescriptor(): number[] {
  return DESCRIPTORS.slice(0, LIVE_DESC_N).map((n) => visionBus.feature(n as VisionFeatureName))
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

// One matcher per (layer, slot), rebuilt only when the assemblage on that slot
// changes — rebuilding every frame would reset the no-repeat history at each cut.
const installed = new Map<string, string>()
const matchers = new Map<string, (prev: string | null) => AssembleClip | null>()

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
        matchers.delete(key)
        continue
      }
      const layer = st.composition.layers[li]
      const s = slot === 'A' ? layer.sourceA : layer.sourceB
      const id = s?.mediaId ?? ''
      const want = live ? id : ''
      if (installed.get(key) === want) continue
      installed.set(key, want)
      if (!live || !corpus) {
        matchers.delete(key)
        src.setLiveMatcher(null)
      } else {
        const fn = makeMatcher(corpus, params, hashSeed(id))
        matchers.set(key, fn)
        src.setLiveMatcher(fn)
      }
    }
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
