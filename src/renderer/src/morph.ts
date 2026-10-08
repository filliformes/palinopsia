// Global Morph : scene recalls, Randomize, Variation, the sequencer, sessions,
// New and Generate move to their new composition over the Morph time, live.
//
// The store holds the TARGET composition (so the UI shows the destination
// immediately). During a morph, the App render loop feeds the ENGINE a
// composition built from what was showing → the target. Two ways, chosen by
// beginSceneMorph :
//   · the same STRUCTURE on both sides (the same sources, racks, blend modes,
//     switches) : every number eases over the whole morph (inputs, opacities,
//     layer opacity / speed / mix, masks, bpm, Meta knobs, modulation depths);
//   · anything structural differs : the RELAY below hands the picture over
//     layer by layer, live, each changed layer crossfading old → new.
// No frozen frame : the engine keeps rendering both sides throughout (a short
// frozen dissolve used to cover every structural snap, 320 ms whatever the
// Morph time : the "flick" at each scene change). Zero React churn, one undo
// entry per change.

import type { CompositionState, FxInstance, LayerState, ModAssignment, ModulatorConfig, SourceSlot } from '@shared/types'
import { modEngine } from './engine/modulation'
import { inputsForShader } from './shaders/isf/inputs'

let state: { from: CompositionState; startMs: number; ms: number } | null = null

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

/** Move from `from` (what the store held) to `target` over `ms` : an all-live
 *  ease when the structure matches, else a relay (see the header). Starts from
 *  what is actually showing when another morph is under way. */
export function beginSceneMorph(from: CompositionState, target: CompositionState, ms: number, now: number): void {
  if (ms <= 20) {
    cancelMorph() // effectively instant : the target, at once
    return
  }
  const src = (state || relay) && lastRendered ? lastRendered : from
  if (relay || !sameStructure(src, target)) {
    beginRelayMorph(from, target, ms, now)
    return
  }
  relay = null
  envelopes = null
  pendingSwaps = []
  modEngine.forkGhosts()
  state = { from: structuredClone(src), startMs: now, ms }
}

/** Abort any in-flight morph (and drop a not-yet-consumed crossfade). Call when
 *  the composition is REPLACED out from under the morph : New, Load, Undo, Redo
 *  : so the engine stops easing toward a target that no longer exists. */
export function cancelMorph(): void {
  state = null
  relay = null
  envelopes = null
  pendingSwaps = []
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

// A Collage's film count, piece shape and feed are structural (each step builds
// or drops decoders) : a morph takes them straight to the target instead of
// sweeping through every value. `cuts` still eases : the wall splits piece by piece.
const SNAP_INPUTS: Record<string, string[]> = { 'gen-collage': ['films', 'shape', 'feed'] }

function lerpSlot(a: SourceSlot | null, b: SourceSlot | null, k: number): SourceSlot | null {
  if (!a || !b || a.shaderId !== b.shaderId) return b
  const inputs = lerpInputs(a.inputs, b.inputs, k)
  const snap = b.shaderId ? SNAP_INPUTS[b.shaderId] : undefined
  if (snap) for (const key of snap) if (key in b.inputs) inputs[key] = b.inputs[key]
  return { ...b, inputs }
}

// A layer's mask : its kind and invert are structure, its numbers ease.
function lerpMask(a: LayerState['mask'] | undefined, b: LayerState['mask'], k: number): LayerState['mask'] {
  if (!a || !b || a.mode !== b.mode || a.invert !== b.invert) return b
  const out = { ...b } as unknown as Record<string, unknown>
  const ar = a as unknown as Record<string, unknown>
  for (const key of Object.keys(out)) {
    const av = ar[key], bv = out[key]
    if (typeof av === 'number' && typeof bv === 'number') out[key] = lerpN(av, bv, k)
  }
  return out as unknown as LayerState['mask']
}

// The modulation : the old modulators keep running in the engine's ghost slots
// (8..15, forked at the morph's start), the old assignments fade out on them and
// the new ones fade in on the new modulators. An assignment both sides share, on
// a modulator whose settings did not change, simply eases its depth. So a scene
// that modulates other things, or the same things differently, morphs into it :
// no modulated parameter jumps at the first frame.
const modKey = (m: ModAssignment): string => `${m.mod}|${m.mode ?? 'replace'}|${JSON.stringify(m.target)}`
const GHOST = 8
function lerpMods(a: ModAssignment[], b: ModAssignment[], k: number, aMods: ModulatorConfig[], bMods: ModulatorConfig[]): ModAssignment[] {
  if (k >= 1) return b
  const sameMod = (i: number): boolean => JSON.stringify(aMods[i]) === JSON.stringify(bMods[i])
  const old = new Map<string, ModAssignment>()
  for (const m of a) if (!m.muted && m.mod < GHOST) old.set(modKey(m), m)
  const out: ModAssignment[] = []
  for (const m of b) {
    const key = modKey(m)
    const o = old.get(key)
    const to = m.muted ? 0 : m.depth
    if (o && sameMod(m.mod)) {
      old.delete(key)
      out.push({ ...m, muted: false, depth: lerpN(o.depth, to, k) })
    } else out.push({ ...m, muted: false, depth: lerpN(0, to, k) })
  }
  for (const o of old.values()) {
    out.push(sameMod(o.mod) ? { ...o, depth: lerpN(o.depth, 0, k) } : { ...o, id: `${o.id}~ghost`, mod: o.mod + GHOST, depth: lerpN(o.depth, 0, k) })
  }
  return out
}

/** The modulators the engine runs mid-morph : the target's, then the old ones as
 *  ghosts. */
function withGhosts(a: ModulatorConfig[], b: ModulatorConfig[], k: number): ModulatorConfig[] {
  if (k >= 1) return b
  const head = b.slice(0, GHOST)
  const ghosts = a.slice(0, GHOST)
  while (head.length < GHOST) head.push({ ...(ghosts[head.length] ?? b[0]), enabled: false })
  return [...head, ...ghosts]
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
        fx: lerpFx(al.fx, bl.fx, k),
        harmony: lerpN(al.harmony ?? 0, bl.harmony ?? 0, k),
        mask: lerpMask(al.mask, bl.mask, k),
        coupling:
          al.coupling && bl.coupling && al.coupling.mode === bl.coupling.mode
            ? { ...bl.coupling, amount: lerpN(al.coupling.amount, bl.coupling.amount, k), tightness: lerpN(al.coupling.tightness, bl.coupling.tightness, k) }
            : bl.coupling
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
    modulators: withGhosts(a.modulators, b.modulators, k),
    modMatrix: lerpMods(a.modMatrix ?? [], b.modMatrix ?? [], k, a.modulators, b.modulators),
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
  leftAt: number | null // the old content left its engine slot (borrow : swapped; out : faded) (ms)
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
// An engine slot the old content just left still holds its last frames (and
// feedback) for a moment : composited at the empty layer's full opacity, that
// flashed the outgoing picture at the hand-over (measured : one frame 60%
// brighter, fading over four). Such a slot stays dark this long first.
const RELAY_LEFT_DARK_MS = 400

const slotKey = (s: SourceSlot | null | undefined): string =>
  !s || s.kind === 'none' ? 'none' : `${s.kind}|${s.shaderId ?? ''}|${s.mediaId ?? ''}`
const fxKey = (fx: FxInstance[] | undefined): string => (fx ?? []).map((f) => f.shaderId).join(',')
// A source's or an effect's SWITCHES : its on/off and menu inputs. They cannot
// ease (a mirror is on or off), and eased as numbers they flipped mid-morph, a
// flick in an otherwise slow morph. So a layer whose switches change hands over
// by crossfade like any other structural change.
function switches(id: string | null | undefined, inputs: Record<string, number | number[]> | undefined): string {
  if (!id || !inputs) return ''
  let k = ''
  for (const d of inputsForShader(id)) {
    if (d.type !== 'bool' && d.type !== 'long') continue
    const v = Number(inputs[d.name] ?? d.def ?? 0)
    k += `${d.name}=${d.type === 'bool' ? (v >= 0.5 ? 1 : 0) : Math.round(v)},`
  }
  return k
}
const slotSwitchKey = (s: SourceSlot | null | undefined): string => `${slotKey(s)}{${s && s.kind !== 'none' ? switches(s.shaderId, s.inputs) : ''}}`
const fxSwitchKey = (fx: FxInstance[] | undefined): string => (fx ?? []).map((f) => `${f.shaderId}{${switches(f.shaderId, f.inputs)}}`).join(',')
const layerEmpty = (l: LayerState | undefined): boolean => !l || (slotKey(l.sourceA) === 'none' && slotKey(l.sourceB) === 'none')
const layerDark = (l: LayerState | undefined): boolean => layerEmpty(l) || !!l!.mute || l!.opacity <= 0.001
// What a layer IS : its sources and racks (and their switches, above), and the
// switches no ease can cross (blend modes, mute / solo / feedback, the mask's
// kind, the coupling's mode).
// Two layers alike here morph live; any other change hands over by crossfade.
const sameLayer = (a: LayerState, b: LayerState): boolean =>
  // two empty layers show nothing either way (their switches don't matter)
  (layerEmpty(a) && layerEmpty(b)) ||
  (slotSwitchKey(a.sourceA) === slotSwitchKey(b.sourceA) &&
  slotSwitchKey(a.sourceB) === slotSwitchKey(b.sourceB) &&
  fxSwitchKey(a.sourceAFx) === fxSwitchKey(b.sourceAFx) &&
  fxSwitchKey(a.sourceBFx) === fxSwitchKey(b.sourceBFx) &&
  fxSwitchKey(a.fx) === fxSwitchKey(b.fx) &&
  a.blend === b.blend &&
  a.sourceBlend === b.sourceBlend &&
  !!a.mute === !!b.mute &&
  !!a.solo === !!b.solo &&
  !!a.feedback === !!b.feedback &&
  (a.mask?.mode ?? 0) === (b.mask?.mode ?? 0) &&
  !!a.mask?.invert === !!b.mask?.invert &&
  (a.coupling?.mode ?? 'off') === (b.coupling?.mode ?? 'off'))

/** The whole composition alike in structure : every layer, the background and
 *  the master racks. Then a morph is one live ease. */
function sameStructure(a: CompositionState, b: CompositionState): boolean {
  if (a.layers.length !== b.layers.length) return false
  for (let i = 0; i < a.layers.length; i++) if (!sameLayer(a.layers[i], b.layers[i])) return false
  const ab = a.background, bb = b.background
  if (!!ab !== !!bb) return false
  if (ab && bb && (slotKey(ab.source) !== slotKey(bb.source) || fxKey(ab.fx) !== fxKey(bb.fx))) return false
  return fxKey(a.master) === fxKey(b.master)
}

/** New / Generate : relay from what is on screen now to `target` (the store's
 *  new composition) over `ms`, the Morph time. */
export function beginRelayMorph(from: CompositionState, target: CompositionState, ms: number, now: number): void {
  // Mid-morph, start from what is actually showing (and as bright), so nothing
  // jumps. Its slot layout is the engine's own.
  const src = structuredClone(state || relay ? (lastRendered ?? from) : from)
  state = null
  pendingSwaps = []
  modEngine.forkGhosts()
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
      // Only a host with NO visible layer between it and this one : the new
      // content plays there in the same stacking it will have in its own slot.
      // With a visible layer between, it would composite over (or under) that
      // layer while crossfading, then drop back under it at the hand-over, and
      // the picture changed at once (measured : a frame 3x brighter at the end).
      // Then it crossfades in place instead (out, then in).
      if (best >= 0 && bestScore < 10) {
        free.delete(best)
        kind = 'borrow'
        host = best
      } else kind = 'through'
    }
    slots[i] = { kind, start, mid: start + RELAY_WINDOW / 2, end, host, switchSync: null, readyAt: null, swapped: false, leftAt: null }
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
  // Slots lending themselves to another layer's new content : their own (empty)
  // layer must not overwrite it. (It did for a host ABOVE the borrowing layer :
  // the new content never showed while crossfading, then popped in at the
  // hand-over, the flick at the end of a New / Generate.)
  const hosting = new Set(r.slots.filter((s) => s.kind === 'borrow' && !s.swapped && u >= s.start).map((s) => s.host))
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
        if (hosting.has(i)) break // lent to a borrowing layer (see above)
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
        } else {
          if (s.leftAt === null) s.leftAt = now
          env[i] = 0
          if (now - s.leftAt < RELAY_LEFT_DARK_MS) allDone = false
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
        if (s.swapped) {
          // handed over : the target's own layout from here; the host slot (now
          // holding the old content's engine layer) stays dark a moment
          env[s.host] = 0
          if (s.leftAt !== null && now - s.leftAt < RELAY_LEFT_DARK_MS) allDone = false
          break
        }
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
          s.leftAt = now
          pendingSwaps.push([i, s.host])
          layers[i] = bl
          layers[s.host] = target.layers[s.host]
          env[i] = 1
          env[s.host] = 0
          allDone = false
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
    modulators: withGhosts(a.modulators, target.modulators, u),
    modMatrix: lerpMods(a.modMatrix ?? [], target.modMatrix ?? [], k, a.modulators, target.modulators),
    metaKnobs: target.metaKnobs.map((bk, i) => {
      const ak = a.metaKnobs[i]
      return ak ? { ...bk, value: lerpN(ak.value, bk.value, k) } : bk
    })
  }
}

/** Test builds : what the morph is doing now (the probes read it). */
export function morphDebug(now = performance.now()): unknown {
  if (relay) return { mode: 'relay', u: (now - relay.startMs) / relay.ms, slots: relay.slots.map((s) => ({ ...s })), bg: relay.bg, env: envelopes }
  if (state) return { mode: 'ease', k: (now - state.startMs) / state.ms }
  return { mode: 'none' }
}

/** The composition as SHOWN (envelopes folded into the opacities) : where a
 *  morph that starts mid-relay begins from. */
function shown(c: CompositionState): CompositionState {
  if (!envelopes) return c
  const e = envelopes
  return { ...c, layers: c.layers.map((l, i) => (e[i] !== undefined && e[i] < 1 ? { ...l, opacity: l.opacity * e[i] } : l)) }
}
