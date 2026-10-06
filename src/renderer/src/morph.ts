// Global Morph : scene recalls and Randomize crossfade instead of snapping.
//
// The store holds the TARGET composition (so the UI shows the destination
// immediately). During a morph, the App render loop feeds the ENGINE an
// interpolated composition built from the pre-change state → the target, over
// `morphMs`. Structure (shader ids, counts, enums, bools, modulators) snaps to
// the target; only numeric params (inputs, opacities, layer opacity/speed/mix,
// bpm, meta-knob values) are eased. Zero React churn, one undo entry per change.

import type { CompositionState, FxInstance, LayerState, SourceSlot } from '@shared/types'

let state: { from: CompositionState; startMs: number; ms: number } | null = null

// A pending framebuffer crossfade the render loop should pick up. Set whenever
// a morph begins; the loop reads it once and tells the Compositor to dissolve
// the frozen old frame into the new scene : the only way a STRUCTURAL change
// (Randomize All swaps shaders) can visibly morph, since params snap.
let pendingCrossfadeMs: number | null = null

// The framebuffer crossfade FREEZES the outgoing frame as a snapshot, so it must
// stay SHORT : it only needs to cover the instant the new structure appears (~1
// frame), not the whole morph. Capping it here (numeric params still ease over the
// full `morphMs`) is what stops a scene recall / Randomize from looking like the old
// scene freezes for a beat before it changes — the structure quick-dissolves, then
// the params morph live. (Matches the Metasurface's short jump-crossfade.)
const STRUCT_XFADE_MS = 320

// A WHOLE-composition replacement (a session loaded) : the engine holds the
// last frame still until every new shader has compiled, then dissolves. Without
// it, layers whose new shader was still waiting its turn in the per-frame compile
// budget kept playing the OLD session for seconds, popping over one by one.
let pendingSceneChange: number | null = null

/** A session load (or New / Generate at Morph 0) : the render loop holds, then
 *  dissolves over `dissolveMs` (see above). */
export function requestSceneChange(dissolveMs = 500): void {
  pendingSceneChange = dissolveMs
}

/** The render loop calls this once per frame : the dissolve ms of a scene change
 *  requested since (and clears it), else null. */
export function consumeSceneChange(): number | null {
  const v = pendingSceneChange
  pendingSceneChange = null
  return v
}

/** The render loop calls this once per frame; returns the ms for a crossfade
 *  that just began (and clears it), else null. */
export function consumeCrossfade(): number | null {
  const v = pendingCrossfadeMs
  pendingCrossfadeMs = null
  return v
}

/** Start easing FROM `from` toward whatever the store holds, over `ms`. */
export function beginMorph(from: CompositionState, ms: number, now: number): void {
  // A plain morph (scene recall, Randomize) takes over from a relay, starting
  // from what the relay is showing.
  const src = relay && lastRendered ? lastRendered : from
  relay = null
  envelopes = null
  pendingSwaps = []
  if (ms <= 20) {
    state = null // effectively instant : don't bother interpolating
    return
  }
  state = { from: structuredClone(src), startMs: now, ms }
  pendingCrossfadeMs = Math.min(ms, STRUCT_XFADE_MS)
}

/** Abort any in-flight morph (and drop a not-yet-consumed crossfade). Call when
 *  the composition is REPLACED out from under the morph : New, Load, Undo, Redo
 *  : so the engine stops easing toward a target that no longer exists. */
export function cancelMorph(): void {
  state = null
  relay = null
  envelopes = null
  pendingSwaps = []
  pendingCrossfadeMs = null
}

const easeInOut = (k: number): number => k * k * (3 - 2 * k)

function lerpN(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

function lerpVal(av: unknown, bv: unknown, k: number): number | number[] | unknown {
  if (typeof av === 'number' && typeof bv === 'number') return lerpN(av, bv, k)
  if (Array.isArray(av) && Array.isArray(bv) && av.length === bv.length) {
    return bv.map((v, i) =>
      typeof av[i] === 'number' && typeof v === 'number' ? lerpN(av[i] as number, v, k) : v
    )
  }
  return bv // strings/bools/mismatch → snap to target
}

function lerpInputs(
  a: Record<string, number | number[]>,
  b: Record<string, number | number[]>,
  k: number
): Record<string, number | number[]> {
  const out: Record<string, number | number[]> = {}
  for (const key of Object.keys(b)) out[key] = lerpVal(a[key], b[key], k) as number | number[]
  return out
}

function lerpSlot(a: SourceSlot | null, b: SourceSlot | null, k: number): SourceSlot | null {
  if (!a || !b || a.shaderId !== b.shaderId) return b
  return { ...b, inputs: lerpInputs(a.inputs, b.inputs, k) }
}

// Match FX by position + shader id : same shader ⇒ ease its inputs + opacity.
function lerpFx(a: FxInstance[], b: FxInstance[], k: number): FxInstance[] {
  return b.map((bf, i) => {
    const af = a[i]
    if (!af || af.shaderId !== bf.shaderId) return bf
    return {
      ...bf,
      inputs: lerpInputs(af.inputs, bf.inputs, k),
      opacity: lerpN(af.opacity ?? 1, bf.opacity ?? 1, k)
    }
  })
}

function lerpComposition(a: CompositionState, b: CompositionState, k: number): CompositionState {
  return {
    ...b,
    bpm: lerpN(a.bpm, b.bpm, k),
    layers: b.layers.map((bl: LayerState, i: number) => {
      const al = a.layers[i]
      if (!al) return bl
      return {
        ...bl,
        opacity: lerpN(al.opacity, bl.opacity, k),
        feedbackAmount: lerpN(al.feedbackAmount, bl.feedbackAmount, k),
        sourceMix: lerpN(al.sourceMix, bl.sourceMix, k),
        speed: lerpN(al.speed, bl.speed, k),
        sourceA: lerpSlot(al.sourceA, bl.sourceA, k) as SourceSlot,
        sourceB: bl.sourceB ? lerpSlot(al.sourceB, bl.sourceB, k) : bl.sourceB,
        sourceAFx: lerpFx(al.sourceAFx, bl.sourceAFx, k),
        sourceBFx: lerpFx(al.sourceBFx, bl.sourceBFx, k),
        fx: lerpFx(al.fx, bl.fx, k)
      }
    }),
    background:
      b.background && a.background
        ? {
            ...b.background,
            opacity: lerpN(a.background.opacity, b.background.opacity, k),
            speed: lerpN(a.background.speed, b.background.speed, k),
            depth: lerpN(a.background.depth ?? 0, b.background.depth ?? 0, k),
            source: lerpSlot(a.background.source, b.background.source, k) as SourceSlot,
            fx: lerpFx(a.background.fx, b.background.fx, k)
          }
        : b.background,
    master: lerpFx(a.master, b.master, k),
    metaKnobs: b.metaKnobs.map((bk, i) => {
      const ak = a.metaKnobs[i]
      return ak ? { ...bk, value: lerpN(ak.value, bk.value, k) } : bk
    })
  }
}

/** What the engine should render THIS frame: the eased composition, or the
 *  target unchanged once the morph completes. */
export function morphedComposition(now: number, target: CompositionState): CompositionState {
  if (relay) {
    const c = relayedComposition(now, target)
    lastRendered = shown(c)
    return c
  }
  if (!state) return target
  const k = (now - state.startMs) / state.ms
  if (k >= 1) {
    state = null
    return target
  }
  return (lastRendered = lerpComposition(state.from, target, easeInOut(Math.max(0, k))))
}

// ── Relay morph : New and Generate ──────────────────────────────────────────
// A whole new composition shares almost no structure with the old one, so the
// plain morph above could only snap it (and a framebuffer dissolve would freeze
// the outgoing picture). The relay hands the picture over LAYER BY LAYER, live,
// over `ms`, each layer slot in its own staggered window (top first) :
//   · same structure on both sides : its params ease;
//   · old content and new content, and a slot EMPTY in both compositions free :
//     the new content plays in that free slot while the old fades, a true live
//     crossfade; at the end the engine swaps the two slots' Layer objects
//     (Compositor.swapLayerSlots), so nothing reloads;
//   · no free slot : the old fades out, then the new fades in (through empty);
//   · only old, or only new : it fades out, or in.
// New content only starts fading in once the engine has compiled it (a shader
// waiting its turn in the compile budget would else flash the OLD shader). The
// fades are opacity envelopes the render loop applies AFTER every modulator and
// macro (relayEnvelopes), so nothing overrides them. The finishing trio (Vibe,
// Context, Finalizer) eases over the whole morph; other master units fade out
// over the first half and the new ones in over the second.

type RelayKind = 'same' | 'borrow' | 'through' | 'in' | 'out'

interface RelaySlot {
  kind: RelayKind
  start: number // 0..1 of the morph : the slot's window opens
  mid: number // 'through' : where it switches from old to new
  end: number
  host: number // the engine slot the NEW content plays in until the end (borrow : the free slot)
  switchSync: number | null // the sync count when the new content was first requested
  readyAt: number | null // when the engine first had it loaded (ms)
  swapped: boolean // borrow : the engine slots were swapped (the hand-over is done)
}

let relay: {
  from: CompositionState
  startMs: number
  ms: number
  slots: RelaySlot[] // one per layer
  bg: { kind: 'same' | 'through' | 'in' | 'out'; start: number; mid: number; end: number }
} | null = null
let syncCount = 0
let lastRendered: CompositionState | null = null // what the engine was fed (opacities as SHOWN)
let envelopes: number[] | null = null
let pendingSwaps: Array<[number, number]> = []

const RELAY_WINDOW = 0.55 // each slot's share of the morph
const RELAY_READY_MAX_MS = 3000 // never wait longer than this for a compile

const slotKey = (s: SourceSlot | null | undefined): string =>
  !s || s.kind === 'none' ? 'none' : `${s.kind}|${s.shaderId ?? ''}|${s.mediaId ?? ''}`
const fxKey = (fx: FxInstance[] | undefined): string => (fx ?? []).map((f) => f.shaderId).join(',')
const layerEmpty = (l: LayerState | undefined): boolean => !l || (slotKey(l.sourceA) === 'none' && slotKey(l.sourceB) === 'none')
const layerDark = (l: LayerState | undefined): boolean => layerEmpty(l) || !!l!.mute || l!.opacity <= 0.001
const sameLayer = (a: LayerState, b: LayerState): boolean =>
  slotKey(a.sourceA) === slotKey(b.sourceA) &&
  slotKey(a.sourceB) === slotKey(b.sourceB) &&
  fxKey(a.sourceAFx) === fxKey(b.sourceAFx) &&
  fxKey(a.sourceBFx) === fxKey(b.sourceBFx) &&
  fxKey(a.fx) === fxKey(b.fx)

/** New / Generate : relay from what is on screen now to `target` (the store's
 *  new composition) over `ms`, the Morph time. */
export function beginRelayMorph(from: CompositionState, target: CompositionState, ms: number, now: number): void {
  // Mid-morph, start from what is actually showing (and as bright), so nothing
  // jumps. Its slot layout is the engine's own.
  const src = structuredClone(state || relay ? (lastRendered ?? from) : from)
  state = null
  pendingCrossfadeMs = null
  pendingSwaps = []
  const n = Math.min(src.layers.length, target.layers.length)
  // Free slots : empty in both, so they can host a new layer while the old fades.
  const free = new Set<number>()
  for (let i = 0; i < n; i++) if (layerEmpty(src.layers[i]) && layerEmpty(target.layers[i])) free.add(i)
  const slots: RelaySlot[] = []
  for (let i = 0; i < n; i++) {
    const a = src.layers[i]
    const b = target.layers[i]
    const order = n - 1 - i // top layer first
    const start = n > 1 ? (order * (1 - RELAY_WINDOW)) / (n - 1) : 0
    const end = start + RELAY_WINDOW
    let kind: RelayKind
    let host = i
    if (sameLayer(a, b)) kind = 'same'
    else if (layerDark(a)) kind = 'in'
    else if (layerEmpty(b)) kind = 'out'
    else {
      // The free slot with the fewest visible layers between it and this one
      // (so the stacking barely changes at the hand-over), then the nearest.
      let best = -1
      let bestScore = Infinity
      for (const f of free) {
        let between = 0
        for (let j = Math.min(i, f) + 1; j < Math.max(i, f); j++) if (!layerEmpty(src.layers[j]) || !layerEmpty(target.layers[j])) between++
        const score = between * 10 + Math.abs(f - i)
        if (score < bestScore) {
          bestScore = score
          best = f
        }
      }
      if (best >= 0) {
        free.delete(best)
        kind = 'borrow'
        host = best
      } else kind = 'through'
    }
    slots[i] = { kind, start, mid: start + RELAY_WINDOW / 2, end, host, switchSync: null, readyAt: null, swapped: false }
  }
  const sb = src.background
  const tb = target.background
  const bgFromDark = !sb || slotKey(sb.source) === 'none' || sb.opacity <= 0.001
  const bgToEmpty = !tb || slotKey(tb.source) === 'none'
  relay = {
    from: src,
    startMs: now,
    ms,
    slots,
    bg: {
      kind:
        !!sb && !!tb && slotKey(sb.source) === slotKey(tb.source) && fxKey(sb.fx) === fxKey(tb.fx)
          ? 'same'
          : bgFromDark
            ? 'in'
            : bgToEmpty
              ? 'out'
              : 'through',
      start: 0.2,
      mid: 0.5,
      end: 0.8
    }
  }
}

/** The render loop, right after each syncFromState : whether the engine has
 *  everything that composition asked for loaded (no compile deferred). */
export function noteMorphSync(settled: boolean, now: number): void {
  syncCount++
  if (!relay) return
  for (const s of relay.slots) {
    if (s.switchSync !== null && s.readyAt === null && syncCount > s.switchSync) {
      if (settled || now - relay.startMs > relay.ms * s.start + RELAY_READY_MAX_MS) s.readyAt = now
    }
  }
}

/** Engine slot swaps a relay asks for (borrow hand-overs) : the render loop
 *  applies them BEFORE this frame's syncFromState. */
export function consumeLayerSwaps(): Array<[number, number]> {
  const v = pendingSwaps
  pendingSwaps = []
  return v
}

/** Per engine slot opacity factors for this frame (null when no relay) : the
 *  render loop multiplies them in after every modulator and macro. */
export function relayEnvelopes(): number[] | null {
  return envelopes
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))

function relayedComposition(now: number, target: CompositionState): CompositionState {
  const r = relay!
  const u = Math.max(0, (now - r.startMs) / r.ms)
  const a = r.from
  const k = easeInOut(Math.min(1, u))
  const layers: LayerState[] = target.layers.map((l) => l)
  const env = target.layers.map(() => 1)
  let allDone = true
  // Ask for a slot's new content : note the sync it was first requested on.
  const request = (s: RelaySlot): void => {
    if (s.switchSync === null) s.switchSync = syncCount
  }
  // Fade-in progress of a slot's new content, from when it was ready.
  const fadeIn = (s: RelaySlot, span: number): number =>
    s.readyAt === null ? 0 : easeInOut(clamp01((now - s.readyAt) / Math.max(1, span * r.ms)))
  r.slots.forEach((s, i) => {
    const al = a.layers[i]
    const bl = target.layers[i]
    if (!al || !bl) return
    switch (s.kind) {
      case 'same': {
        const ks = easeInOut(clamp01((u - s.start) / (s.end - s.start)))
        layers[i] = lerpComposition({ ...a, layers: [al] }, { ...target, layers: [bl] }, ks).layers[0]
        if (u < s.end) allDone = false
        break
      }
      case 'in': {
        if (u < s.start) {
          layers[i] = al
          allDone = false
          break
        }
        request(s)
        const kin = fadeIn(s, s.end - s.start)
        env[i] = kin
        if (kin < 1) allDone = false
        break
      }
      case 'out': {
        const ko = easeInOut(clamp01((u - s.start) / (s.end - s.start)))
        if (ko < 1) {
          layers[i] = al
          env[i] = 1 - ko
          allDone = false
        }
        break
      }
      case 'through': {
        if (u < s.mid) {
          layers[i] = al
          env[i] = 1 - easeInOut(clamp01((u - s.start) / (s.mid - s.start)))
          allDone = false
          break
        }
        request(s)
        const kin = fadeIn(s, s.end - s.mid)
        env[i] = kin
        if (kin < 1) allDone = false
        break
      }
      case 'borrow': {
        if (s.swapped) break // handed over : the target's own layout from here
        if (u < s.start) {
          layers[i] = al
          allDone = false
          break
        }
        // Old in its slot, new in the free host slot, crossfading live.
        request(s)
        const kx = fadeIn(s, s.end - s.start)
        layers[i] = al
        layers[s.host] = bl
        // New above the old : the old holds longer (no dip toward the background);
        // new below : the new comes up faster. Same idea either way.
        const above = s.host > i
        env[s.host] = above ? kx : 1 - (1 - kx) * (1 - kx)
        env[i] = above ? 1 - kx * kx : 1 - kx
        if (kx >= 1) {
          // Hand over : the engine swaps the two slots' Layer objects before the
          // next sync, so slot i now holds the new content, already loaded.
          s.swapped = true
          pendingSwaps.push([i, s.host])
          layers[i] = bl
          layers[s.host] = target.layers[s.host]
          env[i] = 1
          env[s.host] = 1
        } else allDone = false
        break
      }
    }
  })
  // Background (one slot, no host to borrow) : fade out, swap, fade in.
  let background = target.background
  const bg = r.bg
  if (a.background && target.background) {
    if (bg.kind === 'same') background = lerpComposition({ ...a, layers: [] }, { ...target, layers: [] }, easeInOut(clamp01((u - bg.start) / (bg.end - bg.start)))).background
    else if (bg.kind === 'out' || (bg.kind === 'through' && u < bg.mid)) {
      const stop = bg.kind === 'out' ? bg.end : bg.mid
      background = { ...a.background, opacity: a.background.opacity * (1 - easeInOut(clamp01((u - bg.start) / (stop - bg.start)))) }
    } else {
      const from0 = bg.kind === 'in' ? bg.start : bg.mid
      background = { ...target.background, opacity: target.background.opacity * easeInOut(clamp01((u - from0) / (bg.end - from0))) }
    }
    if (u < bg.end) allDone = false
  }
  // Master : the locked finishing trio eases all along; the rest relays at 0.5.
  const lockedA = a.master.filter((f) => f.locked)
  const lockedB = target.master.filter((f) => f.locked)
  const restA = a.master.filter((f) => !f.locked)
  const restB = target.master.filter((f) => !f.locked)
  let rest: FxInstance[]
  if (fxKey(restA) === fxKey(restB)) rest = lerpFx(restA, restB, k)
  else if (u < 0.5) rest = restA.map((f) => ({ ...f, opacity: (f.opacity ?? 1) * (1 - easeInOut(Math.min(1, u * 2))) }))
  else rest = restB.map((f) => ({ ...f, opacity: (f.opacity ?? 1) * easeInOut(Math.min(1, (u - 0.5) * 2)) }))
  if (u < 1) allDone = false
  if (allDone) {
    relay = null
    envelopes = null
    return target
  }
  envelopes = env
  return {
    ...target,
    bpm: lerpN(a.bpm, target.bpm, k),
    layers,
    background,
    master: [...rest, ...lerpFx(lockedA, lockedB, k)],
    metaKnobs: target.metaKnobs.map((bk, i) => {
      const ak = a.metaKnobs[i]
      return ak ? { ...bk, value: lerpN(ak.value, bk.value, k) } : bk
    })
  }
}

/** The composition as SHOWN (envelopes folded into the opacities) : where a
 *  morph that starts mid-relay begins from. */
function shown(c: CompositionState): CompositionState {
  if (!envelopes) return c
  const e = envelopes
  return { ...c, layers: c.layers.map((l, i) => (e[i] !== undefined && e[i] < 1 ? { ...l, opacity: l.opacity * e[i] } : l)) }
}
