// Inbound OSC → store. This is how Pandore (or any OSC source) PLAYS the
// instrument. Mirrors the MIDI-CC pattern in midi.ts: a message arrives, we
// parse its `/opsia/...` address and drive the matching store action.
//
// Value convention (uniform, controller-friendly): every continuous control
// takes a NORMALIZED 0..1 float, scaled to the target's declared range. Enums
// (blend) take an int index or a 0..1 float mapped across the modes. Bools
// (mute/solo/feedback) are true at >= 0.5. Triggers (scene/randomize) fire on
// the rising edge. BPM is the one raw value. Addresses are 1-based (L1, Knob 1,
// Scene 1) to match the UI and the number-key scene shortcuts.
//
// Address map:
//   /opsia/layer{1..4}/opacity|speed|mix|trail        f 0..1
//   /opsia/layer{n}/blend|sourceblend                 i index | f 0..1
//   /opsia/layer{n}/mute|solo|feedback                >= 0.5
//   /opsia/layer{n}/source/{A|B}                       s shaderId | name | "none"
//   /opsia/layer{n}/source/{A|B}/{input}              f 0..1 → range
//   /opsia/layer{n}/source/{A|B}/fx/{i}/{input}       f 0..1 → range
//   /opsia/layer{n}/fx/{i}/{input}                    f 0..1 → range
//   /opsia/layer{n}/video[/{A|B}]/play|loop|grain     >= 0.5 (slotless form: first video slot)
//   /opsia/layer{n}/video[/{A|B}]/direction            i index | f 0..1 | s forward|reverse|pendulum
//   /opsia/layer{n}/video[/{A|B}]/speed                f 0..1 (log across 1/28x..128x)
//   /opsia/layer{n}/video[/{A|B}]/position             f 0..1 (one-shot seek within trim)
//   /opsia/layer{n}/video[/{A|B}]/in|out               f 0..1 (trim points)
//   /opsia/layer{n}/video[/{A|B}]/grainsize|grainspray|grainrev|grainjit  f 0..1
//   /opsia/layer{n}/video[/{A|B}]/grainsync            i index | f 0..1 | s free|1/16|1/8|1/4|1/2
//   /opsia/layer{n}/coupling/mode                     i index | f 0..1 | s name
//   /opsia/layer{n}/coupling/amount|tightness         f 0..1
//   /opsia/layer{n}/coupling/feature                  i index | f 0..1 | s name
//   /opsia/master/fx/{i}/{input}                       f 0..1 → range
//   /opsia/master/vibe|context|finalizer/{input}       f 0..1 → range (color/point2D: N args)
//   /opsia/bg/opacity|speed|depth                      f 0..1
//   /opsia/bg/blend                                     0=blend · 1=isolate (>= 0.5)
//   /opsia/bg/source                                    s shaderId | name | "none"
//   /opsia/bg/source/{input}                           f 0..1 → range (color/point2D: N args)
//   /opsia/bg/fx/{i}/{input}                           f 0..1 → range
//   /opsia/density|proximity                            f 0..1 (field macros)
//   /opsia/gesture                                      f 0..1 (Gesture ⇄ Texture)
//   /opsia/coalesce                                     f 0..1 (Dispersal ⇄ Coalescence)
//   /opsia/tonicity|shutter|drift|superflicker          f 0..1 (temperament, 0 = off)
//   (outbound only) /opsia/av/mark-signal f×32 · mark-level|centroid|flux f  : the
//   animated-sound loop: a scanline of the output sent to Pandore (§4.4).
//   /opsia/world                                        s id | name | i (1-based index)
//   /opsia/seq/run                                      >= 0.5 toggles the sequencer
//   /opsia/seq/skip                                     trigger (advance to next scene)
//   /opsia/sonify/on|master                             >= 0.5 | f 0..1
//   /opsia/sonify/root|scale                            i index | s name
//   /opsia/sonify/{voice}/on|gain|pan + voice params    f 0..1 (see case below)
//   /opsia/meta/{1..16}                                f 0..1 (drives the knob)
//   /opsia/bpm                                          f 20..800 (raw)
//   /opsia/scene/{n}                                    trigger
//   /opsia/randomize[/{scope}]                          trigger
//   /opsia/panic                                        trigger (flush self-feeding buffers)
//   /opsia/surface x y                                  two 0..1 floats : the Metasurface cursor
//   /opsia/surface/active {0|1}                         bool : enable the Metasurface
//   /opsia/surface/play {0|1}                           bool : auto-trace the drawn path
//   /opsia/surface/time {s}                             float : draw-path loop time (s, or ms if > 120)
//   /opsia/surface/jump {0..1}                          float : draw-path jump jitter (→ 0..100 %)
//   /opsia/surface/way {0|1|2}                          fwd · back · ping-pong
//   /opsia/surface/wiggle {0..1}                         float : smooth wobble (→ 0..100 %)
//   /opsia/surface/loop {0|1}                            bool : close the path into a loop

import type { BlendMode, CouplingMode, AudioFeature, FxScope, OscInEvent, OscQueryLeaf } from '@shared/types'
import { BLEND_MODES } from '@shared/types'
import { videoKey, videoSeekRequests } from './engine/videoState'
import { SONI_SCALES, withSonifyParam, type SoniConfig } from './audio/sonify'
import { SONIFY_MOD_DESCS } from './engine/modulation'
import { useStore } from './store'
import type { RandomizeScope } from './randomize'
import { setKnobTarget } from './metaSmooth'
import { firePanic } from './commands'
import { GENERATORS, SHADER_BY_ID } from './shaders/isf'
import { inputsForShader } from './shaders/isf/inputs'
import { audioBus, type AudioFeatureName } from './engine/audioIn'
import { visionBus, VISION_FEATURES } from './engine/visionIn'
import { sequencerSkip } from './engine/sequencer'

type Args = OscInEvent['args']
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

function firstNum(args: Args): number {
  const a = args[0]
  if (!a) return 0
  if (typeof a.value === 'number') return a.value
  if (a.value === true || a.value === 'true') return 1
  if (a.value === false || a.value === 'false') return 0
  const n = Number(a.value)
  return Number.isFinite(n) ? n : 0
}
function firstStr(args: Args): string | null {
  const a = args[0]
  return a && typeof a.value === 'string' ? a.value : null
}

/** Resolve OSC args onto a shader input's declared range/type. float/long/bool
 *  take a single normalized 0..1 value; color takes 3–4 raw 0..1 args (or one =
 *  grayscale); point2D takes 2 normalized args scaled to each axis. null = skip. */
function resolveInputValue(shaderId: string, name: string, args: Args): number | number[] | null {
  const d = inputsForShader(shaderId).find((x) => x.name === name)
  if (!d) return null
  const norm = firstNum(args)
  if (d.type === 'float') {
    const min = typeof d.min === 'number' ? d.min : 0
    const max = typeof d.max === 'number' ? d.max : 1
    return min + clamp01(norm) * (max - min)
  }
  if (d.type === 'long') {
    const vals = d.values ?? []
    if (!vals.length) return null
    const i = Math.round(clamp01(norm) * (vals.length - 1))
    return vals[Math.max(0, Math.min(vals.length - 1, i))]
  }
  if (d.type === 'bool' || d.type === 'event') return norm >= 0.5 ? 1 : 0
  if (d.type === 'color') {
    const nums = args.map((a) => Number(a.value)).filter((x) => Number.isFinite(x))
    if (nums.length >= 3) return [nums[0], nums[1], nums[2], nums[3] ?? 1]
    return [norm, norm, norm, 1] // single value → grayscale
  }
  if (d.type === 'point2D') {
    const min = Array.isArray(d.min) ? d.min : [0, 0]
    const max = Array.isArray(d.max) ? d.max : [1, 1]
    const a0 = clamp01(Number(args[0]?.value) || 0)
    const a1 = clamp01(Number(args[1]?.value) || 0)
    return [min[0] + a0 * (max[0] - min[0]), min[1] + a1 * (max[1] - min[1])]
  }
  return null
}

function sourceShaderId(li: number, slot: 'A' | 'B'): string | null {
  const l = useStore.getState().composition.layers[li]
  if (!l) return null
  const s = slot === 'A' ? l.sourceA : l.sourceB
  return s?.shaderId ?? null
}

/** The FX unit at `i` (0-based) in a scope's rack : master excludes the locked
 *  finalizers (address those via /master/vibe · /master/context). */
function fxAt(scope: FxScope, i: number): { id: string; shaderId: string } | null {
  const c = useStore.getState().composition
  let arr
  if (scope.kind === 'master') arr = c.master.filter((f) => !f.locked)
  else if (scope.kind === 'background') arr = c.background?.fx ?? []
  else {
    const l = c.layers[scope.layer]
    if (!l) return null
    arr = scope.kind === 'layer' ? l.fx : scope.kind === 'sourceA' ? l.sourceAFx : l.sourceBFx
  }
  const u = arr[i]
  return u && u.shaderId ? { id: u.id, shaderId: u.shaderId } : null
}

function resolveGenerator(str: string): string | null {
  const lc = str.trim().toLowerCase()
  if (lc === 'none' || lc === 'off' || lc === '') return null
  if (SHADER_BY_ID[str]) return str
  const g = GENERATORS.find((x) => x.id === str || x.name.toLowerCase() === lc)
  return g?.id ?? null
}

function blendFrom(args: Args): BlendMode | null {
  const a = args[0]
  if (!a) return null
  if (typeof a.value === 'string') {
    return (BLEND_MODES as readonly string[]).includes(a.value) ? (a.value as BlendMode) : null
  }
  const v = Number(a.value)
  const idx = a.type === 'i' ? Math.round(v) : Math.round(clamp01(v) * (BLEND_MODES.length - 1))
  return BLEND_MODES[Math.max(0, Math.min(BLEND_MODES.length - 1, idx))] ?? null
}

const COUPLING_MODES: readonly CouplingMode[] = ['off', 'lean', 'hocket', 'cut', 'gate', 'drift']
const COUPLING_FEATURES: readonly AudioFeature[] = ['level', 'flux', 'transient', 'centroid', 'band', 'pitch']

// Video transport enums + the transport's log speed range (mirrors the UI
// slider in VideoTransport.tsx : 1/28× .. 128×).
const VIDEO_DIRECTIONS = ['forward', 'reverse', 'pendulum'] as const
const VSMIN = 1 / 28
const VSMAX = 128
const GRAIN_SYNCS = ['free', '1/16', '1/8', '1/4', '1/2'] as const
const GRAIN_SYNC_VALUES = [0, 0.25, 0.5, 1, 2] as const

/** Resolve an enum arg: a string name, an int index, or a 0..1 float mapped
 *  across the members. Returns null if nothing valid is present. */
function enumFrom<T extends string>(args: Args, members: readonly T[]): T | null {
  const a = args[0]
  if (!a) return null
  if (typeof a.value === 'string') {
    const lc = a.value.trim().toLowerCase()
    return (members as readonly string[]).includes(lc) ? (lc as T) : null
  }
  const v = Number(a.value)
  if (!Number.isFinite(v)) return null
  const idx = a.type === 'i' ? Math.round(v) : Math.round(clamp01(v) * (members.length - 1))
  return members[Math.max(0, Math.min(members.length - 1, idx))] ?? null
}

// Rising-edge tracking for trigger addresses (scene / randomize).
const edge = new Map<string, boolean>()
function rising(address: string, v: number): boolean {
  const now = v >= 0.5
  const was = edge.get(address) ?? false
  edge.set(address, now)
  return now && !was
}

function route(address: string, args: Args): void {
  let segs = address.split('/').filter(Boolean)
  if (segs[0] !== 'opsia') return
  const st = useStore.getState()
  const n = firstNum(args)

  // Layer addressing : /opsia/layer1/… (the number inside the segment). The old
  // /opsia/layer/1/… form is normalized to the same shape for back-compat.
  const lm = segs[1]?.match(/^layer([1-9])$/)
  if (lm) segs = [segs[0], 'layer', lm[1], ...segs.slice(2)]

  switch (segs[1]) {
    case 'layer': {
      const li = parseInt(segs[2], 10) - 1
      if (!(li >= 0 && li < 4)) return
      const ctl = segs[3]

      if (ctl === 'source') {
        const slot: 'A' | 'B' = segs[4] === 'B' ? 'B' : 'A'
        if (segs[5] === undefined) {
          const str = firstStr(args)
          if (str !== null) st.setSourceShader(li, slot, resolveGenerator(str))
          return
        }
        if (segs[5] === 'fx') {
          const fi = parseInt(segs[6], 10) - 1
          const input = segs[7]
          if (!input || fi < 0) return
          const scope: FxScope = { kind: slot === 'A' ? 'sourceA' : 'sourceB', layer: li }
          const u = fxAt(scope, fi)
          if (!u) return
          const v = resolveInputValue(u.shaderId, input, args)
          if (v !== null) st.setFxInput(scope, u.id, input, v)
          return
        }
        const input = segs[5]
        const sid = sourceShaderId(li, slot)
        if (!sid) return
        const v = resolveInputValue(sid, input, args)
        if (v !== null) st.setSourceInput(li, slot, input, v)
        return
      }

      if (ctl === 'fx') {
        const fi = parseInt(segs[4], 10) - 1
        const input = segs[5]
        if (!input || fi < 0) return
        const scope: FxScope = { kind: 'layer', layer: li }
        const u = fxAt(scope, fi)
        if (!u) return
        const v = resolveInputValue(u.shaderId, input, args)
        if (v !== null) st.setFxInput(scope, u.id, input, v)
        return
      }

      // Video transport : /opsia/layerN/video[/{A|B}]/{ctl}. Without an explicit
      // slot the message lands on the layer's first video slot (A, then B).
      if (ctl === 'video') {
        const layer = st.composition.layers[li]
        if (!layer) return
        let slot: 'A' | 'B' | null
        let which = segs[4]
        if (which === 'A' || which === 'B') {
          slot = which
          which = segs[5]
        } else {
          slot = layer.sourceA?.kind === 'video' ? 'A' : layer.sourceB?.kind === 'video' ? 'B' : null
        }
        if (!slot || !which) return
        const s = slot === 'A' ? layer.sourceA : layer.sourceB
        if (s?.kind !== 'video') return
        switch (which) {
          case 'play': st.setVideoPlayback(li, slot, { videoPlaying: n >= 0.5 }); return
          case 'loop': st.setVideoPlayback(li, slot, { videoLoop: n >= 0.5 }); return
          case 'direction': {
            const d = enumFrom(args, VIDEO_DIRECTIONS)
            if (d) st.setVideoPlayback(li, slot, { videoDirection: d })
            return
          }
          case 'speed':
            // 0..1 across the transport's log range (1/28× .. 128×).
            st.setVideoPlayback(li, slot, { videoSpeed: VSMIN * Math.pow(VSMAX / VSMIN, clamp01(n)) })
            return
          case 'position':
            // One-shot seek within the trim : drained by the render loop into
            // the same consumed-per-frame seam the playhead modulators use.
            videoSeekRequests.set(videoKey(li, slot), clamp01(n))
            return
          case 'in':
            st.setVideoPlayback(li, slot, { videoIn: Math.min(clamp01(n), (s.videoOut ?? 1) - 0.01) })
            return
          case 'out':
            st.setVideoPlayback(li, slot, { videoOut: Math.max(clamp01(n), (s.videoIn ?? 0) + 0.01) })
            return
          case 'grain': st.setVideoPlayback(li, slot, { grainOn: n >= 0.5 }); return
          case 'grainsize': st.setVideoPlayback(li, slot, { grainSize: 0.05 + clamp01(n) * 0.95 }); return
          case 'grainspray': st.setVideoPlayback(li, slot, { grainSpray: clamp01(n) }); return
          case 'grainrev': st.setVideoPlayback(li, slot, { grainReverse: clamp01(n) }); return
          case 'grainjit': st.setVideoPlayback(li, slot, { grainJitter: clamp01(n) }); return
          case 'grainsync': {
            const g = enumFrom(args, GRAIN_SYNCS)
            if (g) st.setVideoPlayback(li, slot, { grainSync: GRAIN_SYNC_VALUES[GRAIN_SYNCS.indexOf(g)] })
            return
          }
        }
        return
      }

      if (ctl === 'coupling') {
        const which = segs[4]
        if (which === 'mode') {
          const m = enumFrom(args, COUPLING_MODES)
          if (m) st.patchLayer(li, { coupling: { ...st.composition.layers[li].coupling, mode: m } })
        } else if (which === 'feature') {
          const feat = enumFrom(args, COUPLING_FEATURES)
          if (feat) st.patchLayer(li, { coupling: { ...st.composition.layers[li].coupling, feature: feat } })
        } else if (which === 'amount' || which === 'tightness') {
          st.patchLayer(li, { coupling: { ...st.composition.layers[li].coupling, [which]: clamp01(n) } })
        }
        return
      }

      switch (ctl) {
        case 'opacity': st.setOpacity(li, clamp01(n)); return
        case 'mix': st.setSourceMix(li, clamp01(n)); return
        case 'trail': st.setFeedbackAmount(li, clamp01(n)); return
        case 'speed': st.setLayerSpeed(li, clamp01(n) * 20); return
        case 'blend': { const b = blendFrom(args); if (b) st.setBlend(li, b); return }
        case 'sourceblend': { const b = blendFrom(args); if (b) st.setSourceBlend(li, b); return }
        case 'mute': st.patchLayer(li, { mute: n >= 0.5 }); return
        case 'solo': st.patchLayer(li, { solo: n >= 0.5 }); return
        case 'feedback': st.patchLayer(li, { feedback: n >= 0.5 }); return
        default: return
      }
    }

    case 'master': {
      if (segs[2] === 'fx') {
        const fi = parseInt(segs[3], 10) - 1
        const input = segs[4]
        if (!input || fi < 0) return
        const scope: FxScope = { kind: 'master' }
        const u = fxAt(scope, fi)
        if (!u) return
        const v = resolveInputValue(u.shaderId, input, args)
        if (v !== null) st.setFxInput(scope, u.id, input, v)
        return
      }
      if (segs[2] === 'vibe' || segs[2] === 'context' || segs[2] === 'finalizer') {
        const shaderId =
          segs[2] === 'vibe' ? 'fx-vibe' : segs[2] === 'context' ? 'fx-context' : 'fx-finalizer'
        const input = segs[3]
        if (!input) return
        const u = st.composition.master.find((f) => f.shaderId === shaderId)
        if (!u) return
        const v = resolveInputValue(shaderId, input, args)
        if (v !== null) st.setFxInput({ kind: 'master' }, u.id, input, v)
        return
      }
      return
    }

    case 'bg': {
      const ctl = segs[2]
      if (ctl === 'opacity') { st.setBackgroundOpacity(clamp01(n)); return }
      if (ctl === 'speed') { st.setBackgroundSpeed(clamp01(n)); return }
      if (ctl === 'depth') { st.setBackgroundDepth(clamp01(n)); return }
      if (ctl === 'blend') { st.setBackgroundBlendMode(n >= 0.5 ? 'isolate' : 'blend'); return }
      if (ctl === 'source') {
        if (segs[3] === undefined) {
          const str = firstStr(args)
          if (str !== null) st.setBackgroundSource(resolveGenerator(str))
          return
        }
        const sid = st.composition.background?.source?.shaderId
        if (!sid) return
        const v = resolveInputValue(sid, segs[3], args)
        if (v !== null) st.setBackgroundInput(segs[3], v)
        return
      }
      if (ctl === 'fx') {
        const fi = parseInt(segs[3], 10) - 1
        const input = segs[4]
        if (!input || fi < 0) return
        const scope: FxScope = { kind: 'background' }
        const u = fxAt(scope, fi)
        if (!u) return
        const v = resolveInputValue(u.shaderId, input, args)
        if (v !== null) st.setFxInput(scope, u.id, input, v)
        return
      }
      return
    }

    // Global field macros (0.5 = deadzone) and Proximity : each a single 0..1.
    case 'density': st.setDensity(clamp01(n)); return
    case 'gesture': st.setGestureTexture(clamp01(n)); return
    case 'coalesce': st.setCoalesce(clamp01(n)); return
    case 'proximity': st.setProximity(clamp01(n)); return
    case 'tonicity': st.setTonicity(clamp01(n)); return
    case 'shutter': st.setShutter(clamp01(n)); return
    case 'drift': st.setDrift(clamp01(n)); return
    case 'flow': st.setFlow(clamp01(n)); return
    case 'superflicker': st.setSuperFlicker(clamp01(n)); return

    case 'world': {
      const str = firstStr(args)
      if (str !== null) {
        const w = st.worlds.find((x) => x.id === str || x.name.toLowerCase() === str.trim().toLowerCase())
        if (w) st.setWorld(w.id)
        return
      }
      const idx = Math.round(n) - 1 // 1-based index into the worlds bank
      const w = st.worlds[idx]
      if (w) st.setWorld(w.id)
      return
    }

    case 'seq': {
      if (segs[2] === 'run') {
        // Level control: >= 0.5 runs, < 0.5 stops (toggle only when it differs).
        if ((n >= 0.5) !== st.sequence.running) st.toggleSequenceRunning()
        return
      }
      if (segs[2] === 'skip') {
        if (!rising(address, n)) return
        sequencerSkip() // advance now (respects transition + variation)
        return
      }
      return
    }

    case 'meta': {
      const k = parseInt(segs[2], 10) - 1
      if (!(k >= 0 && k < st.composition.metaKnobs.length)) return
      setKnobTarget(k, clamp01(n), st.composition.metaKnobs[k]?.smoothMs ?? 10)
      return
    }

    case 'bpm':
      if (Number.isFinite(n)) st.setBpm(n) // setBpm clamps 20..800; guard NaN
      return

    // Audio features from Pandore (the audio brain). These bypass the store —
    // they feed the audio bus straight, read per-frame by `audio` modulators.
    //   /opsia/audio/{level|flux|transient|centroid|pitch}   f 0..1
    //   /opsia/audio/band/{1..6}                             f 0..1
    case 'audio': {
      const feat = segs[2]
      if (feat === 'band') {
        const bi = parseInt(segs[3], 10) - 1
        if (bi >= 0) audioBus.setOscFeature('band', clamp01(n), bi)
        return
      }
      if (
        feat === 'level' ||
        feat === 'flux' ||
        feat === 'transient' ||
        feat === 'centroid' ||
        feat === 'pitch'
      ) {
        audioBus.setOscFeature(feat as AudioFeatureName, clamp01(n))
      }
      return
    }

    case 'sonify': {
      // The sound half over OSC. All continuous params take 0..1 (the usual
      // convention); probe/pitch params map over the same spans the mod-matrix
      // uses (SONIFY_MOD_DESCS), so OSC and modulation agree.
      const c = st.sonify
      const apply = (next: SoniConfig): void => st.setSonify(next)
      const probe = (param: string): void => {
        const d = SONIFY_MOD_DESCS[param]
        if (d) apply(withSonifyParam(c, param, d.min + clamp01(n) * (d.max - d.min)))
      }
      const g = segs[2]
      if (g === 'on') { apply({ ...c, on: n >= 0.5 }); return }
      if (g === 'master') { apply({ ...c, master: clamp01(n) }); return }
      if (g === 'root') {
        const names = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'] as const
        const r = enumFrom(args, names)
        if (r) apply({ ...c, root: names.indexOf(r) })
        return
      }
      if (g === 'scale') {
        const sc = enumFrom(args, SONI_SCALES)
        if (sc) apply({ ...c, scale: sc })
        return
      }
      const ctl = segs[3]
      if (!ctl) return
      const V = <K extends 'spectra' | 'orbit' | 'flow' | 'events' | 'raster' | 'sstv' | 'filter'>(
        k: K, patch: Partial<SoniConfig[K]>
      ): void => apply({ ...c, [k]: { ...c[k], ...patch } })
      switch (g) {
        case 'spectra':
          if (ctl === 'on') V('spectra', { on: n >= 0.5 })
          else if (ctl === 'gain') V('spectra', { gain: clamp01(n) })
          else if (ctl === 'pan') V('spectra', { pan: clamp01(n) * 2 - 1 })
          else if (ctl === 'sweep') V('spectra', { sweepOn: n >= 0.5 })
          else if (ctl === 'rate') V('spectra', { sweepHz: 0.02 * Math.pow(4 / 0.02, clamp01(n)), sync: false })
          else if (ctl === 'x') probe('spectraX')
          else if (ctl === 'contrast') V('spectra', { gamma: 0.5 + clamp01(n) * 3.5 })
          else if (ctl === 'breath') V('spectra', { breath: clamp01(n) })
          else if (ctl === 'path') V('spectra', { path: Math.max(0, Math.min(3, Math.round(n <= 1 ? n * 3 : n))) })
          else if (ctl === 'breathe' || ctl === 'pace') V('spectra', { pace: clamp01(n) * 0.95 })
          else if (ctl === 'quantize') V('spectra', { quantize: n >= 0.5 })
          return
        case 'orbit':
          if (ctl === 'on') V('orbit', { on: n >= 0.5 })
          else if (ctl === 'gain') V('orbit', { gain: clamp01(n) })
          else if (ctl === 'pan') V('orbit', { pan: clamp01(n) * 2 - 1 })
          else if (ctl === 'pitch') probe('orbitPitch')
          else if (ctl === 'x') probe('orbitX')
          else if (ctl === 'y') probe('orbitY')
          else if (ctl === 'r') probe('orbitR')
          else if (ctl === 'drive') V('orbit', { drive: 0.2 + clamp01(n) * 3.8 })
          else if (ctl === 'smooth') V('orbit', { smooth: clamp01(n) })
          else if (ctl === 'quantize') V('orbit', { quantize: n >= 0.5 })
          return
        case 'flow':
          if (ctl === 'on') V('flow', { on: n >= 0.5 })
          else if (ctl === 'gain') V('flow', { gain: clamp01(n) })
          else if (ctl === 'pan') V('flow', { pan: clamp01(n) * 2 - 1 })
          else if (ctl === 'sense') V('flow', { sense: clamp01(n) })
          else if (ctl === 'density') V('flow', { density: clamp01(n) })
          else if (ctl === 'grain') V('flow', { dur: 0.02 + clamp01(n) * 0.38 })
          else if (ctl === 'breath') V('flow', { noise: clamp01(n) })
          else if (ctl === 'quantize') V('flow', { quantize: n >= 0.5 })
          return
        case 'events':
          if (ctl === 'on') V('events', { on: n >= 0.5 })
          else if (ctl === 'gain') V('events', { gain: clamp01(n) })
          else if (ctl === 'pan') V('events', { pan: clamp01(n) * 2 - 1 })
          else if (ctl === 'mode') V('events', { mode: n >= 1.5 ? 'blend' : n >= 0.5 ? 'motion' : 'spatial' })
          else if (ctl === 'sense') V('events', { sense: clamp01(n) })
          else if (ctl === 'density') V('events', { density: clamp01(n) })
          else if (ctl === 'decay') V('events', { decay: clamp01(n) })
          else if (ctl === 'highs') V('events', { highs: clamp01(n) })
          else if (ctl === 'wave') V('events', { wave: Math.round(clamp01(n) * 3) })
          else if (ctl === 'quantize') V('events', { quantize: n >= 0.5 })
          return
        case 'raster':
          if (ctl === 'on') V('raster', { on: n >= 0.5 })
          else if (ctl === 'gain') V('raster', { gain: clamp01(n) })
          else if (ctl === 'pan') V('raster', { pan: clamp01(n) * 2 - 1 })
          else if (ctl === 'pitch') probe('rasterPitch')
          else if (ctl === 'x') probe('rasterX')
          else if (ctl === 'y') probe('rasterY')
          else if (ctl === 'w') probe('rasterW')
          else if (ctl === 'h') probe('rasterH')
          else if (ctl === 'smooth') V('raster', { smooth: clamp01(n) })
          else if (ctl === 'tone') V('raster', { tone: clamp01(n) })
          else if (ctl === 'quantize') V('raster', { quantize: n >= 0.5 })
          return
        case 'sstv':
          if (ctl === 'on') V('sstv', { on: n >= 0.5 })
          else if (ctl === 'gain') V('sstv', { gain: clamp01(n) })
          else if (ctl === 'pan') V('sstv', { pan: clamp01(n) * 2 - 1 })
          else if (ctl === 'lines') V('sstv', { lineHz: 1 + clamp01(n) * 59, sync: false })
          else if (ctl === 'sync') V('sstv', { sync: n >= 0.5 })
          else if (ctl === 'transpose') V('sstv', { dev: 0.25 + clamp01(n) * 1.75 })
          else if (ctl === 'tick') V('sstv', { syncLev: clamp01(n) })
          return
        case 'filter':
          if (ctl === 'on') V('filter', { on: n >= 0.5 })
          else if (ctl === 'gain') V('filter', { gain: clamp01(n) })
          else if (ctl === 'pan') V('filter', { pan: clamp01(n) * 2 - 1 })
          else if (ctl === 'sweep') V('filter', { sweepOn: n >= 0.5 })
          else if (ctl === 'rate') V('filter', { sweepHz: 0.02 * Math.pow(4 / 0.02, clamp01(n)) })
          else if (ctl === 'x') probe('filterX')
          else if (ctl === 'resonance') V('filter', { q: clamp01(n) })
          else if (ctl === 'noise') V('filter', { noise: clamp01(n) })
          else if (ctl === 'contrast') V('filter', { gamma: 0.5 + clamp01(n) * 3.5 })
          else if (ctl === 'linein') V('filter', { lineIn: n >= 0.5 })
          else if (ctl === 'path') V('filter', { path: Math.max(0, Math.min(3, Math.round(n <= 1 ? n * 3 : n))) })
          else if (ctl === 'breathe' || ctl === 'pace') V('filter', { pace: clamp01(n) * 0.95 })
          else if (ctl === 'quantize') V('filter', { quantize: n >= 0.5 })
          return
      }
      return
    }
    case 'scene': {
      const idx = segs[2] !== undefined ? parseInt(segs[2], 10) - 1 : Math.round(n) - 1
      if (idx < 0) return
      const sc = st.scenes[idx]
      if (!sc) return // validate BEFORE rising() so unknown addresses can't grow the edge map
      // A dedicated /scene/{n} address is a trigger : fire on the rising edge.
      if (segs[2] !== undefined && !rising(address, n)) return
      st.recallScene(sc.id)
      return
    }

    case 'randomize': {
      const scope = segs[2] ?? 'all'
      const valid = [
        'all',
        'sources',
        'sourceparams',
        'sourcefx',
        'sourcefxonly',
        'layerfxonly',
        'layer',
        'master',
        'finishing',
        'modulators'
      ]
      if (!valid.includes(scope)) return // ignore unknown scopes (don't track their edge)
      if (!rising(address, n)) return
      st.randomize(scope as RandomizeScope)
      return
    }

    case 'panic': {
      // The remote panic flush : drop every self-feeding buffer (same as key 0 /
      // the ⚡ Flush button). A rising-edge trigger, so a held value fires once.
      if (!rising(address, n)) return
      firePanic()
      return
    }

    case 'surface': {
      // The Metasurface cursor (Pandore's Trill Square plays it). `/opsia/surface x y`
      // are two 0..1 floats on the plane, and sending them turns the surface ON;
      // `/opsia/surface/active {0|1}` toggles it explicitly.
      if (segs[2] === 'active') {
        st.setSurfaceActive(n >= 0.5)
        return
      }
      // Draw sequencer transport (auto-trace the drawn path).
      if (segs[2] === 'play') {
        st.setSurfacePlay(n >= 0.5)
        return
      }
      if (segs[2] === 'time') {
        // Seconds if it looks like a small number, else milliseconds.
        st.setSurfaceTimeMs(n <= 120 ? n * 1000 : n)
        return
      }
      if (segs[2] === 'jump') {
        // 0..1 fraction (OSC norm) → percent.
        st.setSurfaceJump(n <= 1 ? n * 100 : n)
        return
      }
      if (segs[2] === 'wiggle') {
        st.setSurfaceWiggle(n <= 1 ? n * 100 : n)
        return
      }
      if (segs[2] === 'loop') {
        st.setSurfaceClosed(n >= 0.5)
        return
      }
      if (segs[2] === 'way') {
        st.setSurfaceWay(n >= 1.5 ? 'pingpong' : n >= 0.5 ? 'backward' : 'forward')
        return
      }
      const xa = args[0]
      const ya = args[1]
      const gx = xa && typeof xa.value === 'number' ? xa.value : n
      const gy = ya && typeof ya.value === 'number' ? ya.value : gx
      st.setSurfaceXY(clamp01(gx), clamp01(gy))
      if (!st.surface.active) st.setSurfaceActive(true)
      return
    }

    default:
      return
  }
}

/** Subscribe to inbound OSC and apply it. Returns an unsubscribe fn. */
export function initOscInput(): () => void {
  return window.api.onOscReceived((batch) => {
    for (const m of batch) {
      try {
        route(m.address, m.args)
      } catch {
        // One malformed/unmapped message must never break the rest of the batch.
      }
    }
  })
}

/** Push (start=true) or clear (start=false) the listener + OSCQuery for the
 *  current store config, then reflect the result back into the store. */
export async function applyOscListen(): Promise<void> {
  const st = useStore.getState()
  try {
    const res = await window.api.oscListen(st.oscPort, st.oscEnabled)
    st.setOscConfig({ listening: res.listening, addresses: res.addresses })
    if (res.listening) publishOscQuery()
  } catch {
    st.setOscConfig({ listening: false })
  }
}

/** Normalize a shader input's stored raw value back to the 0..1 the OSC layer
 *  speaks (inverse of resolveInputValue) : for advertisement + outbound feedback. */
function inputNorm(shaderId: string, name: string, raw: number | number[] | undefined): number {
  const d = inputsForShader(shaderId).find((x) => x.name === name)
  if (!d) return 0
  const v = typeof raw === 'number' ? raw : Array.isArray(raw) ? Number(raw[0]) : 0
  if (d.type === 'float') {
    const min = typeof d.min === 'number' ? d.min : 0
    const max = typeof d.max === 'number' ? d.max : 1
    return max > min ? clamp01((v - min) / (max - min)) : 0
  }
  if (d.type === 'long') {
    const vals = d.values ?? []
    const i = vals.indexOf(v)
    return vals.length > 1 ? Math.max(0, i) / (vals.length - 1) : 0
  }
  if (d.type === 'bool' || d.type === 'event') return v >= 0.5 ? 1 : 0
  return clamp01(v)
}

// One advertised / streamable control. `stream:false` marks inbound-only sensors
// (audio) and pure triggers (seq/skip) that outbound feedback must NOT echo.
interface Leaf {
  path: string
  min: number
  max: number
  value: number
  desc: string
  stream: boolean
}

/** Enumerate every OSC-addressable control with its CURRENT value. Shared by
 *  OSCQuery advertisement (structure) and outbound feedback (diff-and-send), so
 *  the two can never drift apart. */
function enumerateLeaves(): Leaf[] {
  const st = useStore.getState()
  const out: Leaf[] = []
  const add = (path: string, min: number, max: number, value: number, desc: string, stream = true): void => {
    out.push({ path, min, max, value, desc, stream })
  }
  const fxVal = (sid: string, name: string): number => {
    const inst = st.composition.master.find((f) => f.shaderId === sid)
    return inputNorm(sid, name, inst?.inputs?.[name])
  }
  for (let n = 1; n <= 4; n++) {
    const l = st.composition.layers[n - 1]
    add(`/opsia/layer${n}/opacity`, 0, 1, l?.opacity ?? 1, 'Layer opacity')
    add(`/opsia/layer${n}/speed`, 0, 1, (l?.speed ?? 1) / 20, 'Layer speed (0..1 → 0..20×)')
    add(`/opsia/layer${n}/mix`, 0, 1, l?.sourceMix ?? 0.5, 'A/B source mix')
    add(`/opsia/layer${n}/trail`, 0, 1, l?.feedbackAmount ?? 0, 'Feedback trail amount')
    const bi = Math.max(0, BLEND_MODES.indexOf(l?.blend ?? 'normal'))
    add(`/opsia/layer${n}/blend`, 0, 1, bi / (BLEND_MODES.length - 1), 'Layer blend mode (index)')
    const si = Math.max(0, BLEND_MODES.indexOf(l?.sourceBlend ?? 'normal'))
    add(`/opsia/layer${n}/sourceblend`, 0, 1, si / (BLEND_MODES.length - 1), 'A/B blend mode (index)')
    add(`/opsia/layer${n}/mute`, 0, 1, l?.mute ? 1 : 0, 'Mute (>= 0.5)')
    add(`/opsia/layer${n}/solo`, 0, 1, l?.solo ? 1 : 0, 'Solo (>= 0.5)')
    add(`/opsia/layer${n}/feedback`, 0, 1, l?.feedback ? 1 : 0, 'Feedback on (>= 0.5)')
    const cm = Math.max(0, COUPLING_MODES.indexOf(l?.coupling?.mode ?? 'off'))
    add(`/opsia/layer${n}/coupling/mode`, 0, 1, cm / (COUPLING_MODES.length - 1), 'A/B coupling mode (index: off·lean·hocket·cut·gate·drift)')
    add(`/opsia/layer${n}/coupling/amount`, 0, 1, l?.coupling?.amount ?? 0.5, 'A/B coupling depth')
    add(`/opsia/layer${n}/coupling/tightness`, 0, 1, l?.coupling?.tightness ?? 0.7, 'A/B coupling tightness')
    const cf = Math.max(0, COUPLING_FEATURES.indexOf(l?.coupling?.feature ?? 'transient'))
    add(`/opsia/layer${n}/coupling/feature`, 0, 1, cf / (COUPLING_FEATURES.length - 1), 'A/B coupling audio feature (index)')
    // Video transport : advertised (slot-explicit) only while the slot actually
    // holds a video. `position` is a one-shot seek — advertised for discovery
    // but never echoed outbound (the playhead flies at frame rate).
    for (const sl of ['A', 'B'] as const) {
      const s = sl === 'A' ? l?.sourceA : l?.sourceB
      if (s?.kind !== 'video') continue
      const p = `/opsia/layer${n}/video/${sl}`
      add(`${p}/play`, 0, 1, (s.videoPlaying ?? true) ? 1 : 0, 'Video play (>= 0.5) / pause')
      const di = Math.max(0, VIDEO_DIRECTIONS.indexOf((s.videoDirection ?? 'forward') as (typeof VIDEO_DIRECTIONS)[number]))
      add(`${p}/direction`, 0, 1, di / (VIDEO_DIRECTIONS.length - 1), 'Play mode (index: forward·reverse·pendulum)')
      add(`${p}/loop`, 0, 1, (s.videoLoop ?? true) ? 1 : 0, 'Loop between in/out (>= 0.5)')
      const sp = Math.max(VSMIN, Math.min(VSMAX, s.videoSpeed ?? 1))
      add(`${p}/speed`, 0, 1, Math.log(sp / VSMIN) / Math.log(VSMAX / VSMIN), 'Clip speed (0..1 log across 1/28×..128×)')
      add(`${p}/position`, 0, 1, 0, 'One-shot seek (0..1 within the in/out trim)', false)
      add(`${p}/in`, 0, 1, s.videoIn ?? 0, 'Trim in point')
      add(`${p}/out`, 0, 1, s.videoOut ?? 1, 'Trim out point')
      add(`${p}/grain`, 0, 1, (s.grainOn ?? false) ? 1 : 0, 'Granulation on (>= 0.5)')
      add(`${p}/grainsize`, 0, 1, ((s.grainSize ?? 0.25) - 0.05) / 0.95, 'Grain length')
      add(`${p}/grainspray`, 0, 1, s.grainSpray ?? 0.15, 'Grain scatter around the playhead')
      add(`${p}/grainrev`, 0, 1, s.grainReverse ?? 0.25, 'Grain reverse probability')
      add(`${p}/grainjit`, 0, 1, s.grainJitter ?? 0.2, 'Per-grain speed jitter')
      const gi = Math.max(0, (GRAIN_SYNC_VALUES as readonly number[]).indexOf(s.grainSync ?? 0))
      add(`${p}/grainsync`, 0, 1, gi / (GRAIN_SYNC_VALUES.length - 1), 'Grain BPM sync (index: free·1/16·1/8·1/4·1/2)')
    }
  }
  for (let k = 1; k <= st.composition.metaKnobs.length; k++) {
    const knob = st.composition.metaKnobs[k - 1]
    add(`/opsia/meta/${k}`, 0, 1, knob?.value ?? 0, knob?.name ?? `Meta knob ${k}`)
  }
  // Sonify (the S page) : the core streamable set. Probe params normalize over
  // the same spans the mod-matrix uses.
  {
    const so = st.sonify
    add('/opsia/sonify/on', 0, 1, so.on ? 1 : 0, 'Sonify engine on (>= 0.5)')
    add('/opsia/sonify/master', 0, 1, so.master, 'Sonify master gain')
    add('/opsia/sonify/root', 0, 1, so.root / 11, 'Quantizer root (index over C..B)')
    const si = Math.max(0, SONI_SCALES.indexOf(so.scale))
    add('/opsia/sonify/scale', 0, 1, si / (SONI_SCALES.length - 1), 'Quantizer scale (index)')
    const norm = (param: string, v: number): number => {
      const d = SONIFY_MOD_DESCS[param]
      return d ? Math.max(0, Math.min(1, (v - d.min) / (d.max - d.min))) : 0
    }
    add('/opsia/sonify/spectra/on', 0, 1, so.spectra.on ? 1 : 0, 'Spectra voice on')
    add('/opsia/sonify/spectra/gain', 0, 1, so.spectra.gain, 'Spectra gain')
    add('/opsia/sonify/spectra/x', 0, 1, norm('spectraX', so.spectra.x), 'Spectra scan column')
    add('/opsia/sonify/spectra/breath', 0, 1, so.spectra.breath ?? 0, 'Spectra sine-noise morph')
    add('/opsia/sonify/spectra/path', 0, 3, so.spectra.path ?? 0, 'Spectra reading path : 0 horizontal · 1 vertical · 2 radial · 3 spiral')
    add('/opsia/sonify/spectra/breathe', 0, 1, (so.spectra.pace ?? 0) / 0.95, 'Spectra breathing sweep pace')
    add('/opsia/sonify/orbit/on', 0, 1, so.orbit.on ? 1 : 0, 'Orbit voice on')
    add('/opsia/sonify/orbit/gain', 0, 1, so.orbit.gain, 'Orbit gain')
    add('/opsia/sonify/orbit/pitch', 0, 1, norm('orbitPitch', so.orbit.quantize ? so.orbit.note : 45), 'Orbit pitch (note span)')
    add('/opsia/sonify/orbit/x', 0, 1, norm('orbitX', so.orbit.cx), 'Orbit centre x')
    add('/opsia/sonify/orbit/y', 0, 1, norm('orbitY', so.orbit.cy), 'Orbit centre y')
    add('/opsia/sonify/orbit/r', 0, 1, norm('orbitR', so.orbit.rx), 'Orbit radius')
    add('/opsia/sonify/flow/on', 0, 1, so.flow.on ? 1 : 0, 'Flow voice on')
    add('/opsia/sonify/flow/gain', 0, 1, so.flow.gain, 'Flow gain')
    add('/opsia/sonify/events/on', 0, 1, so.events.on ? 1 : 0, 'Events voice on')
    add('/opsia/sonify/events/gain', 0, 1, so.events.gain, 'Events gain')
    add('/opsia/sonify/events/mode', 0, 2, so.events.mode === 'blend' ? 2 : so.events.mode === 'motion' ? 1 : 0, 'Events trigger : 0 spatial · 1 motion · 2 blend')
    add('/opsia/sonify/events/density', 0, 1, so.events.density, 'Events per instant')
    add('/opsia/sonify/events/decay', 0, 1, so.events.decay, 'Event note decay')
    add('/opsia/sonify/raster/on', 0, 1, so.raster.on ? 1 : 0, 'Raster voice on')
    add('/opsia/sonify/raster/gain', 0, 1, so.raster.gain, 'Raster gain')
    add('/opsia/sonify/raster/x', 0, 1, norm('rasterX', so.raster.rx), 'Raster rect x')
    add('/opsia/sonify/raster/y', 0, 1, norm('rasterY', so.raster.ry), 'Raster rect y')
    add('/opsia/sonify/raster/tone', 0, 1, so.raster.tone ?? 0.6, 'Raster tone lowpass')
    add('/opsia/sonify/sstv/on', 0, 1, so.sstv.on ? 1 : 0, 'Transmission voice on')
    add('/opsia/sonify/sstv/gain', 0, 1, so.sstv.gain, 'Transmission gain')
    add('/opsia/sonify/filter/on', 0, 1, so.filter.on ? 1 : 0, 'Filter voice on')
    add('/opsia/sonify/filter/gain', 0, 1, so.filter.gain, 'Filter gain')
    add('/opsia/sonify/filter/x', 0, 1, norm('filterX', so.filter.x), 'Filter scan column')
    add('/opsia/sonify/filter/path', 0, 3, so.filter.path ?? 0, 'Filter reading path : 0 horizontal · 1 vertical · 2 radial · 3 spiral')
    add('/opsia/sonify/filter/breathe', 0, 1, (so.filter.pace ?? 0) / 0.95, 'Filter breathing sweep pace')
  }
  add('/opsia/bpm', 20, 800, st.composition.bpm, 'Tempo (raw BPM)')
  // Audio features Pandore PUSHES (consumed by `audio` modulators) : never echoed.
  for (const feat of ['level', 'flux', 'transient', 'centroid', 'pitch'] as const) {
    add(`/opsia/audio/${feat}`, 0, 1, 0, `Audio ${feat} (0..1)`, false)
  }
  for (let b = 1; b <= 6; b++) add(`/opsia/audio/band/${b}`, 0, 1, 0, `Audio band ${b} energy (0..1)`, false)
  // Vision features the PICTURE emits (the return path) : streamed OUT to Pandore
  // so the composited image plays the synths (echoed by the outbound diff loop).
  for (const vf of VISION_FEATURES) {
    add(`/opsia/vision/${vf}`, 0, 1, visionBus.feature(vf), `Vision ${vf} (0..1) : the composited picture as control`)
  }
  for (const [key, sid] of [['vibe', 'fx-vibe'], ['context', 'fx-context'], ['finalizer', 'fx-finalizer']] as const) {
    for (const d of inputsForShader(sid)) {
      if (d.type !== 'float') continue
      const min = typeof d.min === 'number' ? d.min : 0
      const max = typeof d.max === 'number' ? d.max : 1
      add(`/opsia/master/${key}/${d.name}`, 0, 1, fxVal(sid, d.name), `${key} · ${d.label} (0..1 → ${min}..${max})`)
    }
  }
  // Background layer.
  const bg = st.composition.background
  add('/opsia/bg/opacity', 0, 1, bg?.opacity ?? 0, 'Background opacity')
  add('/opsia/bg/speed', 0, 1, bg?.speed ?? 0.5, 'Background speed')
  add('/opsia/bg/depth', 0, 1, bg?.depth ?? 0, 'Background depth push')
  add('/opsia/bg/blend', 0, 1, bg?.blendMode === 'isolate' ? 1 : 0, 'Background blend (0=blend · 1=isolate)')
  if (bg?.source?.shaderId) {
    const sid = bg.source.shaderId
    for (const d of inputsForShader(sid)) {
      if (d.type !== 'float') continue
      add(`/opsia/bg/source/${d.name}`, 0, 1, inputNorm(sid, d.name, bg.source.inputs?.[d.name]), `Background · ${d.label}`)
    }
  }
  // Global field macros + Proximity (0.5 = deadzone).
  add('/opsia/density', 0, 1, st.density ?? 0.5, 'Density macro (sparse ⇄ dense)')
  add('/opsia/gesture', 0, 1, st.gestureTexture ?? 0.5, 'Gesture ⇄ Texture macro')
  add('/opsia/coalesce', 0, 1, st.coalesce ?? 0.5, 'Dispersal ⇄ Coalescence macro')
  add('/opsia/proximity', 0, 1, st.proximity ?? 0.5, 'Proximity (near ⇄ far)')
  add('/opsia/tonicity', 0, 1, st.tonicity ?? 0, 'Tonicity : tonal audio → colour, noise → mono (0 = off)')
  add('/opsia/shutter', 0, 1, st.shutter ?? 0, 'Shutter : stop-motion frame stepping (0 = off)')
  add('/opsia/drift', 0, 1, st.drift ?? 0, 'Drift : analog-instability temperament (0 = off)')
  add('/opsia/flow', 0, 1, st.flow ?? 0.5, 'Flow ⇄ Interruption : liquid ↔ stutter/decimate/blank (0.5 = neutral)')
  add('/opsia/superflicker', 0, 1, st.superFlicker ?? 0, 'Superimposition flicker : layer cross-cut strobe (0 = off)')
  // World selection (accepts a string id/name, or a 1-based index) + transport.
  const worldIdx = Math.max(1, st.worlds.findIndex((w) => w.id === st.world) + 1)
  add('/opsia/world', 1, Math.max(1, st.worlds.length), worldIdx, 'Active World (send an id/name string, or a 1-based index)')
  add('/opsia/seq/run', 0, 1, st.sequence.running ? 1 : 0, 'Sequencer running (>= 0.5)')
  add('/opsia/seq/skip', 0, 1, 0, 'Advance to the next scene (trigger)', false)
  add('/opsia/panic', 0, 1, 0, 'Panic flush — drop every self-feeding buffer (trigger)', false)
  add('/opsia/surface', 0, 1, st.surface.x, 'Metasurface cursor X (send x y together; turns it on)')
  add('/opsia/surface/active', 0, 1, st.surface.active ? 1 : 0, 'Enable the Metasurface (>= 0.5)')
  add('/opsia/surface/play', 0, 1, st.surface.play ? 1 : 0, 'Auto-trace the drawn path (>= 0.5)')
  add('/opsia/surface/time', 0, 60, st.surface.timeMs / 1000, 'Draw-path loop time (seconds, or ms if > 120)')
  add('/opsia/surface/jump', 0, 1, st.surface.jump / 100, 'Draw-path jump jitter (0..1 → 0..100 %)')
  add('/opsia/surface/way', 0, 2, st.surface.way === 'pingpong' ? 2 : st.surface.way === 'backward' ? 1 : 0, 'Draw-path direction : 0 fwd · 1 back · 2 ping-pong')
  add('/opsia/surface/wiggle', 0, 1, st.surface.wiggle / 100, 'Draw-path smooth wobble (0..1 → 0..100 %)')
  add('/opsia/surface/loop', 0, 1, st.surface.closed ? 1 : 0, 'Close the draw path into a loop (>= 0.5)')
  return out
}

/** Enumerate the address space and hand it to the OSCQuery server. */
export function publishOscQuery(): void {
  const nodes: OscQueryLeaf[] = enumerateLeaves().map((n) => ({
    full_path: n.path,
    type: 'f',
    range: { min: n.min, max: n.max },
    value: n.value,
    description: n.desc
  }))
  window.api.oscQueryPublish(nodes)
}

// ── Outbound feedback ────────────────────────────────────────────────
// When enabled, we periodically diff the streamable leaves against what we last
// sent and push only the CHANGED ones to Pandore : so its UI mirrors ours (a
// modulator sweeping opacity, a scene recall, a hand on a slider). Symmetric
// with the inbound map: same `/opsia/...` addresses, same 0..1 convention.

const lastSent = new Map<string, number>()
let feedbackTimer: ReturnType<typeof setInterval> | null = null
const EPS = 0.0015 // ~1/650 : below the noise floor of a modulator at rest

function pushFeedback(): void {
  const st = useStore.getState()
  if (!st.oscOutEnabled || !st.oscOutHost) return
  const host = st.oscOutHost
  const port = st.oscOutPort
  let sent = 0
  for (const leaf of enumerateLeaves()) {
    if (!leaf.stream) continue
    const prev = lastSent.get(leaf.path)
    if (prev !== undefined && Math.abs(prev - leaf.value) < EPS) continue
    // Cap the burst on the very first pass (nothing cached) so we don't flood.
    // Record as "sent" only AFTER we actually transmit : otherwise capped leaves
    // get cached here and then skipped forever (prev matches value on every later
    // tick), so anything past the cap would never reach Pandore.
    if (prev === undefined && sent > 96) continue
    window.api.oscSend(host, port, leaf.path, [{ type: 'f', value: leaf.value }])
    lastSent.set(leaf.path, leaf.value)
    sent++
  }
}

/** Start/stop the outbound feedback loop to match the store's oscOut config. */
export function applyOscOutput(): void {
  const st = useStore.getState()
  if (feedbackTimer) {
    clearInterval(feedbackTimer)
    feedbackTimer = null
  }
  lastSent.clear() // force a full resend on (re)start so Pandore syncs from scratch
  if (st.oscOutEnabled && st.oscOutHost) {
    feedbackTimer = setInterval(pushFeedback, Math.max(40, st.oscOutIntervalMs || 100))
  }
}

// ── OSCQuery WebSocket value-stream ──────────────────────────────────
// Same diff-and-send idea as outbound feedback, but the transport is the
// OSCQuery WS (for web / no-UDP clients) and it runs ONLY while a client is
// attached : the main process flips wsActive via onOscQueryWsActive.

const wsLastSent = new Map<string, number>()
let wsTimer: ReturnType<typeof setInterval> | null = null

function pushWsValues(): void {
  const updates: Array<{ path: string; value: number }> = []
  for (const leaf of enumerateLeaves()) {
    if (!leaf.stream) continue
    const prev = wsLastSent.get(leaf.path)
    if (prev !== undefined && Math.abs(prev - leaf.value) < EPS) continue
    wsLastSent.set(leaf.path, leaf.value)
    updates.push({ path: leaf.path, value: leaf.value })
  }
  if (updates.length) window.api.oscQueryValues(updates)
}

/** Subscribe to WS-client presence and run the value-stream only when attached. */
export function initOscQueryStream(): () => void {
  return window.api.onOscQueryWsActive((active) => {
    if (wsTimer) {
      clearInterval(wsTimer)
      wsTimer = null
    }
    wsLastSent.clear() // a fresh client gets a full snapshot on its first tick
    if (active) wsTimer = setInterval(pushWsValues, 100)
  })
}
