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
//   /opsia/layer{n}/harmony                           f 0..1 (0 B matched to A's hue · 0.5 untouched · 1 B on A's complement)
//   /opsia/layer{n}/blend|sourceblend                 i index | f 0..1
//   /opsia/layer{n}/mute|solo|feedback                >= 0.5
//   /opsia/layer{n}/vary                               trigger (that layer's Vary, at its own amount)
//   /opsia/layer{n}/source/{A|B}                       s shaderId | name | "none"
//   /opsia/layer{n}/source/{A|B}/{input}              f 0..1 → range
//   /opsia/layer{n}/source/{A|B}/fx/{i}/{input}       f 0..1 → range
//   /opsia/layer{n}/fx/{i}/{input}                    f 0..1 → range
//   /opsia/layer{n}/video[/{A|B}]/play|loop|grain     >= 0.5 (slotless form: first video slot)
//   /opsia/layer{n}/video[/{A|B}]/direction            i index | f 0..1 | s forward|reverse|pendulum
//   /opsia/layer{n}/video[/{A|B}]/speed                f 0..1 (log across 1/64x..128x)
//   /opsia/layer{n}/video[/{A|B}]/position             f 0..1 (one-shot seek within trim)
//   /opsia/layer{n}/video[/{A|B}]/in|out               f 0..1 (trim points)
//   /opsia/layer{n}/video[/{A|B}]/grainsize|grainspray|grainrev|grainjit  f 0..1
//   /opsia/layer{n}/video[/{A|B}]/grainsync            i index | f 0..1 | s free|1/16|1/8|1/4|1/2
//   /opsia/layer{n}/coupling/mode                     i index | f 0..1 | s name
//   /opsia/layer{n}/coupling/amount|tightness         f 0..1
//   /opsia/layer{n}/coupling/feature                  i index | s name (level flux transient centroid band pitch noisiness) | f 0..1 (over the first six)
//   /opsia/layer{n}/coupling/band                     i 0..5 | f 0..1 (the band feature's band, 0 = the lowest)
//   /opsia/layer{n}/coupling/auto                     >= 0.5 (level-matching on; below : the raw feature)
//   /opsia/coupling                                    >= 0.5 (the master switch : every layer's coupling)
//   /opsia/master/fx/{i}/{input}                       f 0..1 → range
//   /opsia/master/vibe|context|finalizer/{input}       f 0..1 → range (color/point2D: N args)
//   /opsia/bg/opacity|depth (= shadow)                 f 0..1
//   /opsia/bg/speed                                     f 0..1 → 0..4× (0.0625 = the default 0.25×)
//   /opsia/bg/blend                                     0=blend · 1=group (>= 0.5)
//   /opsia/bg/randomize                                 trigger (the Background's own dice)
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
//   /opsia/sonify/keyseq/on|next                        >= 0.5 (run · a key change now)
//   /opsia/sonify/keyseq/mode                           s name | i index (list circle affinity pivot picture)
//   /opsia/sonify/keyseq/glide|chance                   f 0..1 (glide over 0..4 s)
//   /opsia/sonify/keyseq/range · hold                   f 0..1 · f seconds (Picture : how far its colors reach, the shortest a key stays)
//   /opsia/sonify/keyseq/every · vary                   f seconds (0.25..300, free time) · f 0..1 (each wait drawn around Every)
//   /opsia/sonify/keyseq/keys                           s pool|list | i 0..1 (Picture : the pool, or its own written keys)
//   /opsia/sonify/{voice}/on|gain|pan + voice params    f 0..1 (see case below)
//   /opsia/sonify/glue/on|amount                        >= 0.5 | f 0..1 (the output glue, after the EQ)
//   /opsia/sonify/glue/voice                            s name | i index (clean warm punch bite slow)
//   /opsia/sonify/eq/preset                             s name | i n (a saved output EQ, 1-based; 0 / flat)
//   /opsia/meta/{1..16}                                f 0..1 (drives the knob)
//   /opsia/bpm                                          f 20..800 (raw)
//   /opsia/scene/{n}                                    trigger
//   /opsia/randomize[/{scope}]                          trigger (at the Transport's intensity)
//   /opsia/randomize/masterparams|meta|inspector|sonify|resolume|background   trigger (MIDI Learn's own)
//   /opsia/output/x|y|scale|rotate|spin|feather         f 0..1 (the output transform; 0.5 = none for x y scale rotate spin)
//   /opsia/output/flipx|flipy                           >= 0.5
//   /opsia/output/edge                                  i index | f 0..1 | s black|repeat|mirror
//   /opsia/output/reset                                 trigger (back to the frame as it is)
//   /opsia/space/mode                                   i index | f 0..1 | s stereo|speakers|objects
//   /opsia/space/turn|glide                             f 0..1 (turn : -180..180, 0.5 = none; glide 0..2 s)
//   /opsia/space/mirror|headphones                      >= 0.5
//   /opsia/space/pieces                                 i count | f 0..1 (of 30) : Collage pieces as sources
//   /opsia/space/{voice}/az|el|width|span|spin          f 0..1 over the field's range (az 0.5 = 0)
//   /opsia/space/{voice}/follow                         >= 0.5 (follow the picture, else fixed)
//   /opsia/panic                                        trigger (flush self-feeding buffers)
//   /opsia/vary                                         trigger (the Transport's Vary, at its spread)
//   /opsia/surface x y                                  two 0..1 floats : the Metasurface cursor
//   /opsia/surface/active {0|1}                         bool : enable the Metasurface
//   /opsia/surface/play {0|1}                           bool : auto-trace the drawn path
//   /opsia/surface/time {s}                             float : draw-path loop time (s, or ms if > 120)
//   /opsia/surface/jump {0..1}                          float : draw-path jump jitter (→ 0..100 %)
//   /opsia/surface/way {0|1|2}                          fwd · back · ping-pong
//   /opsia/surface/wiggle {0..1}                         float : smooth wobble (→ 0..100 %)
//   /opsia/surface/loop {0|1}                            bool : close the path into a loop

import { resolumeLearn } from './resolume'
import type { BlendMode, CouplingMode, AudioFeature, FxScope, OscInEvent, OscQueryLeaf } from '@shared/types'
import { BLEND_MODES, BODY_FEATURES, BG_DEFAULT_SPEED, BG_SPEED_MAX } from '@shared/types'
import { BG_SOURCES } from './bgPresets'
import { bodyBus } from './engine/bodyIn'
import { videoKey, videoSeekRequests } from './engine/videoState'
import { AUDIO_LAYER } from './audio/audioLayer'
import { SONI_SCALES, scaleFromName, withSonifyParam, type SoniConfig } from './audio/sonify'
import { KEY_MODES } from './audio/soniKeyModel'
import { GLUE_VOICES, defaultEq, normalizeEq, type SoniGlue } from './audio/eqMath'
import { eqPresets, type EqPreset } from './audio/eqPresets'
import { keySeqNext } from './audio/soniKeySeq'
import { SONIFY_MOD_DESCS } from './engine/modulation'
import { useStore } from './store'
import { sendOsc } from './oscMonitor'
import type { RandomizeScope } from './randomize'
import { setKnobTarget } from './metaSmooth'
import { firePanic, fireVariation } from './commands'
import { fireTrigger, randIntensity } from './midi'
import { OUT_EDGES, OUTX_MOD_RANGE, type OutXformField } from '@shared/outXform'
import { GENERATORS, SHADER_BY_ID } from './shaders/isf'
import { inputsForShader } from './shaders/isf/inputs'
import { SPACE_FIELDS, SPACE_FIELD_RANGE, SPACE_PIECES, SPACE_VOICES, placeField, placePatch, type SpaceField, type SpaceMode, type SpaceVoice } from '@shared/spatial'
import { audioBus, type AudioFeatureName } from './engine/audioIn'
import { visionBus, VISION_FEATURES } from './engine/visionIn'
import { sequencerSkip } from './engine/sequencer'

type Args = OscInEvent['args']
// Sonify : the voices that read the picture (they have a tap), each voice's
// octave span [lo min, lo max, hi min, hi max], and the Orbit shapes in UI order.
const SONI_TAP_VOICES = { spectra: 1, orbit: 1, flow: 1, events: 1, raster: 1, sstv: 1, filter: 1, chord: 1, signal: 1 } as const
const SONI_OCT_SPAN: Record<string, [number, number, number, number] | undefined> = {
  spectra: [0, 4, 4, 8], flow: [1, 4, 4, 7], events: [1, 4, 4, 7], chord: [0, 4, 3, 8], collage: [0, 4, 3, 9], assemblage: [0, 4, 3, 9], filter: [0, 4, 4, 8],
  signal: [1, 6, 4, 9]
}
const ORBIT_RATIOS = [1, 2, 1.5, 1.3333333, 3]
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

function firstNum(args: Args): number {
  const a = args[0]
  if (!a) return 0
  // a NaN / Inf float is 0 : passed through, it latched Sonify voices to silence
  if (typeof a.value === 'number') return Number.isFinite(a.value) ? a.value : 0
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
// noisiness last : the indices before it keep their meaning
const COUPLING_FEATURES: readonly AudioFeature[] = ['level', 'flux', 'transient', 'centroid', 'band', 'pitch', 'noisiness']
// what a 0..1 float spreads over : the six before noisiness, as it always did
const COUPLING_FLOAT_FEATURES = COUPLING_FEATURES.slice(0, 6)
// The audio features Pandore pushes as /opsia/audio/<name> (the bands apart),
// noisiness included : documented, it used to be dropped on arrival.
const OSC_AUDIO_FEATURES = ['level', 'flux', 'transient', 'centroid', 'pitch', 'noisiness'] as const

// Video transport enums + the transport's log speed range (mirrors the UI
// slider in VideoTransport.tsx : 1/64× .. 128×; it was left at 1/28 when the
// slider widened, so a controller's 0..1 and the slider disagreed).
const VIDEO_DIRECTIONS = ['forward', 'reverse', 'pendulum'] as const
const VSMIN = 1 / 64
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

/** Forget a trigger's last state : a press sent from elsewhere (the agent) must
 *  not swallow the controller's next one, nor its own next one. */
export function resetOscEdge(address: string): void {
  edge.delete(address)
}

function route(address: string, args: Args): void {
  // Resolume's own OSC output (its addresses start /composition) feeds the
  // mapper's LEARN mode : wiggle a control in Resolume and it becomes a column.
  if (address.startsWith('/composition')) {
    resolumeLearn(address, args)
    return
  }
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

      // That layer's Vary button : a variant at its own amount (rising edge).
      if (ctl === 'vary') {
        if (rising(address, n)) st.varyLayer(li)
        return
      }

      if (ctl === 'source') {
        const slot: 'A' | 'B' = segs[4] === 'B' ? 'B' : 'A'
        if (segs[5] === undefined) {
          const str = firstStr(args)
          if (str === null) return
          // "none" empties it; a name it does not know leaves it as it is (it
          // used to empty the slot, a typo blanking the layer mid-show)
          const lc = str.trim().toLowerCase()
          if (lc === 'none' || lc === 'off' || lc === '') { st.setSourceShader(li, slot, null); return }
          const id = resolveGenerator(str)
          if (id) st.setSourceShader(li, slot, id)
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
          const playable = (k?: string): boolean => k === 'video' || k === 'audio'
          slot = playable(layer.sourceA?.kind) ? 'A' : playable(layer.sourceB?.kind) ? 'B' : null
        }
        if (!slot || !which) return
        const s = slot === 'A' ? layer.sourceA : layer.sourceB
        if (s?.kind !== 'video' && s?.kind !== 'audio') return
        switch (which) {
          case 'play': st.setVideoPlayback(li, slot, { videoPlaying: n >= 0.5 }); return
          case 'volume':
            // a film's own sound, or the audio file's volume (0..1)
            if (s.kind === 'audio') st.setSourceInput(li, slot, 'volume', Math.max(0, Math.min(1, n)))
            else st.setVideoPlayback(li, slot, { videoVolume: Math.max(0, Math.min(1, n)) })
            return
          case 'loop': st.setVideoPlayback(li, slot, { videoLoop: n >= 0.5 }); return
          case 'ignoreglobal': st.setVideoPlayback(li, slot, { ignoreGlobalSpeed: n >= 0.5 }); return
          case 'direction': {
            const d = enumFrom(args, VIDEO_DIRECTIONS)
            if (d) st.setVideoPlayback(li, slot, { videoDirection: d })
            return
          }
          case 'speed':
            // 0..1 across the transport's log range (1/64× .. 128×).
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
          // an index or a name reaches all seven; a 0..1 float spreads over the
          // six there were before noisiness, so the floats a controller or a
          // saved scene sends keep the feature they always chose
          const byIndex = args[0]?.type === 'i' || typeof args[0]?.value === 'string'
          const feat = enumFrom(args, byIndex ? COUPLING_FEATURES : COUPLING_FLOAT_FEATURES)
          if (feat) st.patchLayer(li, { coupling: { ...st.composition.layers[li].coupling, feature: feat } })
        } else if (which === 'amount' || which === 'tightness') {
          st.patchLayer(li, { coupling: { ...st.composition.layers[li].coupling, [which]: clamp01(n) } })
        } else if (which === 'band') {
          // an int is the band itself; a 0..1 float spreads over the six
          const band = Number.isInteger(n) && n >= 1 ? Math.min(5, n) : Math.round(clamp01(n) * 5)
          st.patchLayer(li, { coupling: { ...st.composition.layers[li].coupling, band } })
        } else if (which === 'auto') {
          // level-matching : on is the field's absence (the default)
          st.patchLayer(li, { coupling: { ...st.composition.layers[li].coupling, auto: n >= 0.5 ? undefined : false } })
        }
        return
      }

      switch (ctl) {
        case 'opacity': st.setOpacity(li, clamp01(n)); return
        case 'mix': st.setSourceMix(li, clamp01(n)); return
        case 'harmony': st.setHarmony(li, clamp01(n) * 2 - 1); return
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
      if (ctl === 'speed') { st.setBackgroundSpeed(clamp01(n) * BG_SPEED_MAX); return }
      if (ctl === 'depth' || ctl === 'shadow') { st.setBackgroundDepth(clamp01(n)); return }
      if (ctl === 'blend') { st.setBackgroundBlendMode(n >= 0.5 ? 'isolate' : 'blend'); return }
      if (ctl === 'randomize') { if (rising(address, n)) st.randomizeBg(); return }
      if (ctl === 'source') {
        if (segs[3] === undefined) {
          const str = firstStr(args)
          if (str === null) return
          // "none" empties it; otherwise only a ground the Background can play
          // (an effect, a figure or an unknown name used to clear it)
          const lc = str.trim().toLowerCase()
          if (lc === 'none' || lc === 'off' || lc === '') { st.setBackgroundSource(null); return }
          const g = BG_SOURCES.find((x) => x.id === str || x.name.toLowerCase() === lc)
          if (g) st.setBackgroundSource(g.id)
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
    case 'coupling': st.setCouplingOn(n >= 0.5); return
    case 'gesture': st.setGestureTexture(clamp01(n)); return
    case 'coalesce': st.setCoalesce(clamp01(n)); return
    case 'proximity': st.setProximity(clamp01(n)); return
    case 'tonicity': st.setTonicity(clamp01(n)); return
    case 'shutter': st.setShutter(clamp01(n)); return
    case 'drift': st.setDrift(clamp01(n)); return
    case 'flow': st.setFlow(clamp01(n)); return
    case 'superflicker': st.setSuperFlicker(clamp01(n)); return

    case 'world': {
      // /opsia/world/amount f 0..1 : how much of the World's mood is on
      if (segs[2] === 'amount') { st.setWorldAmount(clamp01(n)); return }
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
    //   /opsia/audio/{level|flux|transient|centroid|pitch|noisiness}   f 0..1
    //   /opsia/audio/band/{1..6}                                       f 0..1
    case 'audio': {
      const feat = segs[2]
      if (feat === 'band') {
        const bi = parseInt(segs[3], 10) - 1
        if (bi >= 0) audioBus.setOscFeature('band', clamp01(n), bi)
        return
      }
      if ((OSC_AUDIO_FEATURES as readonly string[]).includes(feat)) {
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
      // Index params (rootoct·path·voices·delaymode) advertise RAW ranges, so an
      // integer arg is a raw index and a float is 0..1 normalized across [lo..hi].
      // Disambiguated by the OSC type tag (like enumFrom) so a raw `1` is never
      // mistaken for a normalized 1.
      const idx = (lo: number, hi: number): number => {
        const v = args[0]?.type === 'i' ? Math.round(n) : Math.round(lo + clamp01(n) * (hi - lo))
        return Math.max(lo, Math.min(hi, v))
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
        // a name ("harmonic minor", "dimwh") or an index (the ids' order : the
        // first eight as they always were, the ten new ones after)
        const sc = typeof args[0]?.value === 'string' ? scaleFromName(String(args[0].value)) : enumFrom(args, SONI_SCALES)
        if (sc) apply({ ...c, scale: sc })
        return
      }
      if (g === 'rootoct' || g === 'octave') {
        apply({ ...c, rootOct: idx(1, 6) })
        return
      }
      const ctl = segs[3]
      if (!ctl) return
      // /opsia/sonify/keyseq/* : the key sequencer (root / scale over time)
      if (g === 'keyseq') {
        const st = useStore.getState()
        if (ctl === 'on') st.setSoniKeySeqOn(n >= 0.5)
        else if (ctl === 'next') { if (n >= 0.5) keySeqNext() }
        else if (ctl === 'mode') { const m = enumFrom(args, KEY_MODES); if (m) st.setSoniKeySeq({ mode: m }) }
        else if (ctl === 'glide') st.setSoniKeySeq({ glide: clamp01(n) * 4 })
        else if (ctl === 'chance') st.setSoniKeySeq({ chance: clamp01(n) })
        else if (ctl === 'range') st.setSoniKeySeq({ picRange: clamp01(n) })
        else if (ctl === 'hold') st.setSoniKeySeq({ picHold: Math.max(0, Math.min(60, n)) })
        else if (ctl === 'every') st.setSoniKeySeq({ freeMs: Math.round(Math.max(0.25, Math.min(300, n)) * 1000) })
        else if (ctl === 'vary') st.setSoniKeySeq({ freeVary: clamp01(n) })
        else if (ctl === 'keys') { const k = enumFrom(args, ['pool', 'list'] as const); if (k) st.setSoniKeySeq({ picKeys: k }) }
        return
      }
      // /opsia/sonify/eq/preset <name | n> : recall a saved output EQ (1-based in
      // the menu's order; 0 or "flat" : flat). The bypass switch and the glue stay.
      if (g === 'eq' && ctl === 'preset') {
        const eq = normalizeEq(c.eq)
        const a0 = args[0]
        if (!a0) return
        const list = eqPresets.list()
        let p: EqPreset | undefined
        if (typeof a0.value === 'string') {
          const nm = a0.value.trim()
          if (nm.toLowerCase() === 'flat') { apply({ ...c, eq: { ...defaultEq(), on: eq.on, glue: eq.glue } }); return }
          p = eqPresets.get(nm) ?? list.find((x) => x.name.toLowerCase() === nm.toLowerCase())
        } else {
          const i = Math.round(Number(a0.value))
          if (i === 0) { apply({ ...c, eq: { ...defaultEq(), on: eq.on, glue: eq.glue } }); return }
          p = list[i - 1]
        }
        if (p) apply({ ...c, eq: eqPresets.applied(eq, p) })
        return
      }
      // /opsia/sonify/glue/* : the compressor after the output EQ
      if (g === 'glue') {
        const eq = normalizeEq(c.eq)
        const G = (p: Partial<SoniGlue>): void => apply({ ...c, eq: { ...eq, glue: { ...eq.glue, ...p } } })
        if (ctl === 'on') G({ on: n >= 0.5 })
        else if (ctl === 'amount') G({ amount: clamp01(n) })
        else if (ctl === 'voice') { const v = enumFrom(args, GLUE_VOICES); if (v) G({ voice: v }) }
        return
      }
      // /opsia/sonify/tap/a|b : what each image tap reads (0 master · 1..4 a layer)
      if (g === 'tap') {
        const t = ctl === 'b' ? 1 : 0
        const v = idx(0, 4)
        const taps = [...c.taps] as SoniConfig['taps']
        taps[t] = v === 0 ? { kind: 'master', layer: 0 } : { kind: 'layer', layer: v - 1 }
        apply({ ...c, taps })
        return
      }
      const V = <K extends 'spectra' | 'orbit' | 'flow' | 'events' | 'raster' | 'sstv' | 'filter' | 'chord' | 'collage' | 'signal' | 'assemblage' | 'fx'>(
        k: K, patch: Partial<SoniConfig[K]>
      ): void => apply({ ...c, [k]: { ...c[k], ...patch } })
      // Every voice that reads the picture : which tap it listens to (0 A · 1 B).
      if (ctl === 'tap' && g in SONI_TAP_VOICES) { V(g as 'spectra', { tap: idx(0, 1) }); return }
      // Octave ranges : a raw octave (int) or 0..1 across the voice's span; the
      // low end always stays below the high end.
      const oct = SONI_OCT_SPAN[g]
      if (oct && (ctl === 'looct' || ctl === 'hioct')) {
        const vc = c[g as 'spectra'] as { loOct: number; hiOct: number }
        if (ctl === 'looct') V(g as 'spectra', { loOct: Math.min(idx(oct[0], oct[1]), vc.hiOct - 1) })
        else V(g as 'spectra', { hiOct: Math.max(idx(oct[2], oct[3]), vc.loOct + 1) })
        return
      }
      switch (g) {
        case 'spectra':
          if (ctl === 'on') V('spectra', { on: n >= 0.5 })
          else if (ctl === 'gain') V('spectra', { gain: clamp01(n) })
          else if (ctl === 'pan') V('spectra', { pan: clamp01(n) * 2 - 1 })
          else if (ctl === 'sweep') V('spectra', { sweepOn: n >= 0.5 })
          else if (ctl === 'rate') V('spectra', { sweepHz: 0.02 * Math.pow(4 / 0.02, clamp01(n)), sync: false })
          else if (ctl === 'sync') V('spectra', { sync: n >= 0.5 })
          else if (ctl === 'x') probe('spectraX')
          else if (ctl === 'contrast') V('spectra', { gamma: 0.5 + clamp01(n) * 3.5 })
          else if (ctl === 'breath') V('spectra', { breath: clamp01(n) })
          else if (ctl === 'path') V('spectra', { path: idx(0, 3) })
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
          else if (ctl === 'shape') V('orbit', { ratio: ORBIT_RATIOS[idx(0, ORBIT_RATIOS.length - 1)] })
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
          else if (ctl === 'colour' || ctl === 'color') V('flow', { colour: clamp01(n) })
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
        case 'signal': {
          // Same conventions as the other voices : continuous 0..1, an enum an
          // index or 0..1 across its choices, a switch on at 0.5 and above.
          // `rate` spans whatever the clock allows : steps per beat when synced
          // (0.25..16), steps per second when free (0.25..64).
          const sg = c.signal
          if (ctl === 'on') V('signal', { on: n >= 0.5 })
          else if (ctl === 'gain') V('signal', { gain: clamp01(n) })
          else if (ctl === 'pan') V('signal', { pan: clamp01(n) * 2 - 1 })
          // The enums go through idx() : an integer argument is the index, a
          // float is 0..1 across the choices. OSCQuery advertises them as
          // integers, so a controller that binds from it sends the index.
          else if (ctl === 'wave') V('signal', { wave: idx(0, 8) })
          else if (ctl === 'decay') V('signal', { decay: clamp01(n) })
          else if (ctl === 'tone') V('signal', { tone: clamp01(n) })
          else if (ctl === 'fm') V('signal', { fm: clamp01(n) })
          else if (ctl === 'heads') V('signal', { heads: idx(1, 4) })
          else if (ctl === 'rate') V('signal', { rate: 0.25 + clamp01(n) * (sg.sync ? 15.75 : 63.75) })
          else if (ctl === 'sync') {
            // as the page's button does : the rate carries over from steps a
            // second to steps a beat (and back) instead of jumping to a new pace
            const on = n >= 0.5
            if (on !== sg.sync) V('signal', { sync: on, rate: on ? Math.min(16, Math.max(1, Math.round(sg.rate / 2))) : Math.min(64, sg.rate * 2) })
          }
          else if (ctl === 'steps') V('signal', { steps: [8, 12, 16, 24, 32, 48, 64, 96][idx(0, 7)] })
          else if (ctl === 'spread') V('signal', { spread: clamp01(n) })
          else if (ctl === 'thresh') V('signal', { thresh: clamp01(n) })
          else if (ctl === 'density') V('signal', { density: clamp01(n) })
          else if (ctl === 'path') V('signal', { path: idx(0, 3) })
          else if (ctl === 'snap') V('signal', { snap: clamp01(n) })
          return
        }
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
          else if (ctl === 'loop') V('filter', { loop: clamp01(n) })
          else if (ctl === 'contrast') V('filter', { gamma: 0.5 + clamp01(n) * 3.5 })
          else if (ctl === 'linein') V('filter', { lineIn: n >= 0.5 })
          else if (ctl === 'linefrom') { const f = enumFrom(args, ['input', 'layer'] as const); if (f) V('filter', { lineFrom: f }) }
          else if (ctl === 'path') V('filter', { path: idx(0, 3) })
          else if (ctl === 'breathe' || ctl === 'pace') V('filter', { pace: clamp01(n) * 0.95 })
          else if (ctl === 'quantize') V('filter', { quantize: n >= 0.5 })
          return
        case 'chord':
          if (ctl === 'on') V('chord', { on: n >= 0.5 })
          else if (ctl === 'gain') V('chord', { gain: clamp01(n) })
          else if (ctl === 'pan') V('chord', { pan: clamp01(n) * 2 - 1 })
          else if (ctl === 'voices') V('chord', { voices: idx(2, 16) })
          else if (ctl === 'swell' || ctl === 'attack') V('chord', { attack: 0.02 + clamp01(n) * 2.98 })
          else if (ctl === 'fade' || ctl === 'release') V('chord', { release: 0.05 + clamp01(n) * 5.95 })
          else if (ctl === 'contrast') V('chord', { gamma: 0.5 + clamp01(n) * 3.5 })
          else if (ctl === 'tone') V('chord', { tone: clamp01(n) })
          else if (ctl === 'spread') V('chord', { spread: clamp01(n) })
          else if (ctl === 'waves') V('chord', { waves: clamp01(n) })
          else if (ctl === 'wavesrate') V('chord', { wavesRate: clamp01(n) })
          else if (ctl === 'wavessync') V('chord', { wavesSync: idx(0, 3) })
          else if (ctl === 'noise') V('chord', { noise: clamp01(n) })
          else if (ctl === 'air') V('chord', { air: clamp01(n) })
          return
        // the Assemblage voice takes the Collage's controls, + accent and tape
        case 'collage':
        case 'assemblage': {
          const fv = g as 'collage' | 'assemblage'
          if (fv === 'assemblage' && ctl === 'accent') { V('assemblage', { accent: clamp01(n) }); return }
          if (fv === 'assemblage' && ctl === 'tape') { V('assemblage', { tape: n >= 0.5 }); return }
          if (ctl === 'on') V(fv, { on: n >= 0.5 })
          else if (ctl === 'gain') V(fv, { gain: clamp01(n) })
          else if (ctl === 'pan') V(fv, { pan: clamp01(n) * 2 - 1 })
          else if (ctl === 'resonance' || ctl === 'reso') V(fv, { reso: clamp01(n) })
          else if (ctl === 'ring') V(fv, { ring: clamp01(n) })
          else if (ctl === 'harmonics' || ctl === 'bright') V(fv, { bright: clamp01(n) })
          else if (ctl === 'width') V(fv, { width: clamp01(n) })
          // the films in : level, high-pass, low-pass, and how hard they drive the Ring bank
          else if (ctl === 'input') V(fv, { inGain: -24 + clamp01(n) * 36 })
          else if (ctl === 'hp') V(fv, { hp: Math.round(20 * Math.pow(50, clamp01(n))) })
          else if (ctl === 'lp') V(fv, { lp: Math.round(1000 * Math.pow(20, clamp01(n))) })
          else if (ctl === 'ringin') V(fv, { ringIn: -24 + clamp01(n) * 36 })
          else if (ctl === 'comp') V(fv, { comp: clamp01(n) })
          // a filter's slope : 12 or 24 (an int as it is; a float, >= 0.5 = 24)
          else if (ctl === 'hpslope' || ctl === 'lpslope') {
            const v = args[0]?.type === 'i' ? (n >= 18 ? 24 : 12) : n >= 0.5 ? 24 : 12
            V(fv, ctl === 'hpslope' ? { hpSlope: v } : { lpSlope: v })
          }
          // the Ring bank
          else if (ctl === 'bank' || ctl === 'wet') V(fv, { bank: clamp01(n) })
          else if (ctl === 'send') V(fv, { bankSend: n >= 0.5 })
          else if (ctl === 'decay') V(fv, { decay: clamp01(n) })
          else if (ctl === 'choke') V(fv, { choke: n >= 0.5 })
          else if (ctl === 'cutoff') V(fv, { cutoff: clamp01(n) })
          else if (ctl === 'peak') V(fv, { peak: clamp01(n) })
          else if (ctl === 'slope') V(fv, { slope: clamp01(n) })
          else if (ctl === 'tone') V(fv, { tone: clamp01(n) * 2 - 1 })
          else if (ctl === 'tilt') V(fv, { tilt: clamp01(n) * 2 - 1 })
          else if (ctl === 'waves') V(fv, { waves: clamp01(n) })
          else if (ctl === 'wavesrate') V(fv, { wavesRate: clamp01(n) })
          else if (ctl === 'wavessync') V(fv, { wavesSync: idx(0, 3) })
          else if (ctl === 'noise') V(fv, { noise: clamp01(n) })
          else if (ctl === 'noiserate') V(fv, { noiseRate: clamp01(n) })
          else if (ctl === 'noisesync') V(fv, { noiseSync: idx(0, 3) })
          else if (ctl === 'detune') V(fv, { detune: clamp01(n) })
          else if (ctl === 'voicing') V(fv, { voicing: idx(0, 4) })
          return
        }
        case 'fx':
          // shared reverb / delay tail
          if (ctl === 'send') V('fx', { send: clamp01(n) })
          else if (ctl === 'delaytime' || ctl === 'dlytime') V('fx', { dlyTime: 0.02 * Math.pow(2 / 0.02, clamp01(n)) })
          else if (ctl === 'delayfb' || ctl === 'feedback') V('fx', { dlyFb: clamp01(n) * 0.95 })
          else if (ctl === 'delaytone') V('fx', { dlyTone: clamp01(n) })
          else if (ctl === 'delaymix') V('fx', { dlyMix: clamp01(n) })
          else if (ctl === 'delaymode') V('fx', { dlyMode: idx(0, 2) })
          else if (ctl === 'reverbmode' || ctl === 'rvmode') V('fx', { rvMode: n >= 0.5 ? 1 : 0 })
          else if (ctl === 'reverbmix' || ctl === 'rvmix') V('fx', { rvMix: clamp01(n) })
          else if (ctl === 'size') V('fx', { rvSize: clamp01(n) })
          else if (ctl === 'decay') V('fx', { rvDecay: clamp01(n) })
          else if (ctl === 'damp') V('fx', { rvDamp: clamp01(n) })
          else if (ctl === 'predelay') V('fx', { rvPre: clamp01(n) * 200 })
          else if (ctl === 'shimmer' || ctl === 'mod') V('fx', { rvMod: clamp01(n) * 40 })
          else if (ctl === 'modrate') V('fx', { rvModRate: 0.01 + clamp01(n) * 7.99 })
          else if (ctl === 'width') V('fx', { rvWidth: clamp01(n) })
          else if (ctl === 'locut') V('fx', { rvLocut: 20 * Math.pow(100, clamp01(n)) })
          else if (ctl === 'freeze') V('fx', { rvFreeze: n >= 0.5 })
          else if (ctl === 'diffusion') V('fx', { rvDiff: clamp01(n) })
          else if (ctl === 'lowdamp') V('fx', { rvLowDamp: clamp01(n) })
          else if (ctl === 'crossover') V('fx', { rvCross: clamp01(n) })
          else if (ctl === 'lowmult') V('fx', { rvLowMult: 0.05 + clamp01(n) * 3.95 })
          else if (ctl === 'highmult') V('fx', { rvHighMult: 0.05 + clamp01(n) * 3.95 })
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
      // The randomizes that are not scopes of the Transport's dice : MIDI Learn's
      // own triggers, so OSC, dataflou and MIDI fire exactly the same action.
      const other: Record<string, string> = {
        masterparams: 'rand:master',
        meta: 'rand:meta',
        inspector: 'rand:inspector',
        sonify: 'rand:sonify',
        resolume: 'rand:resolume',
        background: 'rand:bg'
      }
      if (other[scope]) {
        if (rising(address, n)) fireTrigger(other[scope])
        return
      }
      if (!valid.includes(scope)) return // ignore unknown scopes (don't track their edge)
      if (!rising(address, n)) return
      st.bumpRandPulse() // the Randomize button blinks however it was fired
      // at the Transport's intensity, like the dice and MIDI
      st.randomize(scope as RandomizeScope, randIntensity())
      return
    }

    case 'audiolayer': {
      // The Audio Layer : /opsia/audiolayer/{volume|mix|mute} and
      // /opsia/audiolayer/{A|B}/{ctl}. Volumes are gains (0..2, 1 = as it
      // comes), pan -1..1, the rest the video transport's conventions.
      const al = st.audioLayer
      const a = segs[2]
      if (a === 'volume') { st.patchAudioLayer({ volume: Math.max(0, Math.min(2, n)) }); return }
      if (a === 'mix') { st.patchAudioLayer({ mix: clamp01(n) }); return }
      if (a === 'mute') { st.patchAudioLayer({ mute: n >= 0.5 }); return }
      if (a === 'play') {
        // a start on the rising edge only (a held 1, a fader streaming over 0.5,
        // restarted both files every message); under 0.5 pauses, on the change
        const was = edge.get(address)
        if (rising(address, n)) st.playAudioLayer(true)
        else if (n < 0.5 && was !== false) st.playAudioLayer(false)
        return
      }
      if (a !== 'A' && a !== 'B') return
      const sl = a
      const x = al[sl]
      if (!x) return
      switch (segs[3]) {
        case 'volume': st.patchAudioLayerSlot(sl, { volume: Math.max(0, Math.min(2, n)) }); return
        case 'pan': st.patchAudioLayerSlot(sl, { pan: Math.max(-1, Math.min(1, n)) }); return
        case 'mute': st.patchAudioLayerSlot(sl, { mute: n >= 0.5 }); return
      }
      if (x.kind !== 'file') return
      switch (segs[3]) {
        case 'play': st.patchAudioLayerSlot(sl, { videoPlaying: n >= 0.5 }); return
        case 'loop': st.patchAudioLayerSlot(sl, { videoLoop: n >= 0.5 }); return
        case 'ignoreglobal': st.patchAudioLayerSlot(sl, { ignoreGlobalSpeed: n >= 0.5 }); return
        case 'keeppitch': st.patchAudioLayerSlot(sl, { keepPitch: n >= 0.5 }); return
        case 'speed': st.patchAudioLayerSlot(sl, { videoSpeed: VSMIN * Math.pow(VSMAX / VSMIN, clamp01(n)) }); return
        case 'position': videoSeekRequests.set(videoKey(AUDIO_LAYER, sl), clamp01(n)); return
        case 'in': st.patchAudioLayerSlot(sl, { videoIn: Math.min(clamp01(n), (x.videoOut ?? 1) - 0.01) }); return
        case 'out': st.patchAudioLayerSlot(sl, { videoOut: Math.max(clamp01(n), (x.videoIn ?? 0) + 0.01) }); return
      }
      return
    }

    case 'space': {
      // Space : where Sonify's voices sit in the room (shared/spatial.ts)
      const a = segs[2]
      if (a === 'mode') {
        const m = enumFrom(args, ['stereo', 'speakers', 'objects'] as readonly SpaceMode[])
        if (m) st.setSpace({ mode: m })
        return
      }
      if (a === 'turn') { st.setSpace({ rotate: -180 + clamp01(n) * 360 }); return }
      if (a === 'glide') { st.setSpace({ glide: clamp01(n) * 2 }); return }
      if (a === 'mirror') { st.setSpace({ mirror: n >= 0.5 }); return }
      if (a === 'headphones') { st.setSpace({ preview: n >= 0.5 }); return }
      if (a === 'pieces') {
        st.setSpace({ pieces: args[0]?.type === 'i' ? Math.round(n) : Math.round(clamp01(n) * SPACE_PIECES) })
        return
      }
      if ((SPACE_VOICES as readonly string[]).includes(a)) {
        const voice = a as SpaceVoice
        const f = segs[3]
        if (f === 'follow') { st.setSpaceVoice(voice, { follow: n >= 0.5 }); return }
        if ((SPACE_FIELDS as string[]).includes(f)) {
          const r = SPACE_FIELD_RANGE[f as SpaceField]
          st.setSpaceVoice(voice, placePatch(f as SpaceField, r.min + clamp01(n) * (r.max - r.min)))
        }
      }
      return
    }

    case 'output': {
      // The output transform : the whole frame moved as one picture.
      const ctl = segs[2]
      const sliders: Record<string, OutXformField> = {
        x: 'offsetX', y: 'offsetY', scale: 'scale', rotate: 'rotate', spin: 'spin', feather: 'feather'
      }
      const f = sliders[ctl]
      if (f) {
        const r = OUTX_MOD_RANGE[f]
        st.setOutXform({ [f]: r.min + clamp01(n) * (r.max - r.min) })
        return
      }
      if (ctl === 'flipx') { st.setOutXform({ flipX: n >= 0.5 }); return }
      if (ctl === 'flipy') { st.setOutXform({ flipY: n >= 0.5 }); return }
      if (ctl === 'edge') {
        const e = enumFrom(args, OUT_EDGES)
        if (e) st.setOutXform({ edge: e })
        return
      }
      if (ctl === 'reset') { if (rising(address, n)) st.resetOutXform(); return }
      return
    }

    case 'vary': {
      // The Transport's Vary : a variant of the whole scene at its spread (rising
      // edge, so a held value fires once).
      if (segs[2] !== undefined || !rising(address, n)) return
      fireVariation()
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

/** Play one /opsia address as if it came in over OSC (the dataflou bridge). */
export function routeOsc(address: string, args: Args): void {
  try {
    route(address, args)
  } catch {
    // an unmapped or malformed message must never break the caller
  }
}

/** Subscribe to inbound OSC and apply it (and keep the OSCQuery tree in step
 *  with the structure). Returns an unsubscribe fn. */
export function initOscInput(): () => void {
  const off = window.api.onOscReceived((batch) => {
    for (const m of batch) {
      try {
        route(m.address, m.args)
      } catch {
        // One malformed/unmapped message must never break the rest of the batch.
      }
    }
  })
  const offShape = watchOscQueryShape()
  return () => {
    off()
    offShape()
  }
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
  int?: boolean // an index : advertised and sent as an OSC int, read raw
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
  // An index (root octave, a path, a voice count...) : its raw range, as an int.
  // Advertised as a float, a client following the advertisement sent 4.0 for
  // octave 4, which the inbound side read as 0..1 normalized (octave 6).
  const addI = (path: string, min: number, max: number, value: number, desc: string): void => {
    out.push({ path, min, max, value: Math.round(value), desc, stream: true, int: true })
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
    add(`/opsia/layer${n}/harmony`, 0, 1, ((l?.harmony ?? 0) + 1) / 2, 'A/B harmony : 0 B matched to A, 0.5 untouched, 1 B on A\'s complement')
    add(`/opsia/layer${n}/trail`, 0, 1, l?.feedbackAmount ?? 0, 'Feedback trail amount')
    const bi = Math.max(0, BLEND_MODES.indexOf(l?.blend ?? 'normal'))
    add(`/opsia/layer${n}/blend`, 0, 1, bi / (BLEND_MODES.length - 1), 'Layer blend mode (index)')
    const si = Math.max(0, BLEND_MODES.indexOf(l?.sourceBlend ?? 'normal'))
    add(`/opsia/layer${n}/sourceblend`, 0, 1, si / (BLEND_MODES.length - 1), 'A/B blend mode (index)')
    add(`/opsia/layer${n}/mute`, 0, 1, l?.mute ? 1 : 0, 'Mute (>= 0.5)')
    add(`/opsia/layer${n}/solo`, 0, 1, l?.solo ? 1 : 0, 'Solo (>= 0.5)')
    add(`/opsia/layer${n}/feedback`, 0, 1, l?.feedback ? 1 : 0, 'Feedback on (>= 0.5)')
    add(`/opsia/layer${n}/vary`, 0, 1, 0, 'Vary this layer : a variant at its own amount (trigger)', false)
    const cm = Math.max(0, COUPLING_MODES.indexOf(l?.coupling?.mode ?? 'off'))
    add(`/opsia/layer${n}/coupling/mode`, 0, 1, cm / (COUPLING_MODES.length - 1), 'A/B coupling mode (index: off·lean·hocket·cut·gate·drift)')
    add(`/opsia/layer${n}/coupling/amount`, 0, 1, l?.coupling?.amount ?? 0.5, 'A/B coupling depth')
    add(`/opsia/layer${n}/coupling/tightness`, 0, 1, l?.coupling?.tightness ?? 0.7, 'A/B coupling tightness')
    // Feature and band are indexes, advertised and mirrored as ints : as 0..1
    // floats, a fader built from the advertisement pushed to the top sent 1.0,
    // band 1 (a whole number is the band), and the mirrored value came back as
    // another band; noisiness had no place among the floats.
    const cf = Math.max(0, COUPLING_FEATURES.indexOf(l?.coupling?.feature ?? 'transient'))
    addI(`/opsia/layer${n}/coupling/feature`, 0, COUPLING_FEATURES.length - 1, cf, 'A/B coupling audio feature : 0 level · 1 flux · 2 transient · 3 centroid · 4 band · 5 pitch · 6 noisiness')
    addI(`/opsia/layer${n}/coupling/band`, 0, 5, l?.coupling?.band ?? 0, 'A/B coupling : the band feature\'s band (0 lowest … 5 highest)')
    add(`/opsia/layer${n}/coupling/auto`, 0, 1, l?.coupling?.auto === false ? 0 : 1, 'A/B coupling level-matching : the feature heard against its recent range (>= 0.5 : on, below : the raw feature)')
    // Video transport : advertised (slot-explicit) only while the slot actually
    // holds a video. `position` is a one-shot seek — advertised for discovery
    // but never echoed outbound (the playhead flies at frame rate).
    for (const sl of ['A', 'B'] as const) {
      const s = sl === 'A' ? l?.sourceA : l?.sourceB
      if (s?.kind !== 'video' && s?.kind !== 'audio') continue
      const p = `/opsia/layer${n}/video/${sl}`
      add(`${p}/play`, 0, 1, (s.videoPlaying ?? true) ? 1 : 0, 'Video play (>= 0.5) / pause')
      add(`${p}/volume`, 0, 1, s.kind === 'audio' ? (typeof s.inputs.volume === 'number' ? s.inputs.volume : 0.8) : s.videoVolume ?? 0, 'The film\'s own sound, or the audio file\'s volume (0..1)')
      const di = Math.max(0, VIDEO_DIRECTIONS.indexOf((s.videoDirection ?? 'forward') as (typeof VIDEO_DIRECTIONS)[number]))
      add(`${p}/direction`, 0, 1, di / (VIDEO_DIRECTIONS.length - 1), 'Play mode (index: forward·reverse·pendulum)')
      add(`${p}/loop`, 0, 1, (s.videoLoop ?? true) ? 1 : 0, 'Loop between in/out (>= 0.5)')
      add(`${p}/ignoreglobal`, 0, 1, s.ignoreGlobalSpeed ? 1 : 0, 'Its own speed, whatever the global speed (>= 0.5)')
      const sp = Math.max(VSMIN, Math.min(VSMAX, s.videoSpeed ?? 1))
      add(`${p}/speed`, 0, 1, Math.log(sp / VSMIN) / Math.log(VSMAX / VSMIN), 'Clip speed (0..1 log across 1/64×..128×)')
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
    addI('/opsia/sonify/rootoct', 1, 6, so.rootOct ?? 3, 'Root octave (global transpose)')
    const ks = st.soniKeySeq
    const gl = normalizeEq(so.eq).glue
    add('/opsia/sonify/glue/on', 0, 1, gl.on ? 1 : 0, 'Output glue on (the compressor after the EQ, >= 0.5)')
    add('/opsia/sonify/glue/amount', 0, 1, gl.amount, 'Output glue amount (threshold 0..-12 dB, ratio 1.5..4:1)')
    addI('/opsia/sonify/glue/voice', 0, GLUE_VOICES.length - 1, GLUE_VOICES.indexOf(gl.voice), 'Output glue voicing : 0 clean · 1 warm · 2 punch · 3 bite · 4 slow')
    add('/opsia/sonify/keyseq/on', 0, 1, ks.on ? 1 : 0, 'Key sequencer running (>= 0.5)')
    add('/opsia/sonify/keyseq/next', 0, 1, 0, 'Key sequencer : a key change now (>= 0.5)')
    addI('/opsia/sonify/keyseq/mode', 0, KEY_MODES.length - 1, KEY_MODES.indexOf(ks.mode), 'Key sequencer mode : 0 list · 1 circle · 2 affinity · 3 pivot · 4 picture')
    add('/opsia/sonify/keyseq/glide', 0, 1, ks.glide / 4, 'Key sequencer glide (0..4 s)')
    add('/opsia/sonify/keyseq/chance', 0, 1, ks.chance, 'Key sequencer chance of a change')
    add('/opsia/sonify/keyseq/range', 0, 1, ks.picRange ?? 1, "Key sequencer, Picture : 0 the color wheel as it is · 1 the piece's own range of colors and light")
    add('/opsia/sonify/keyseq/hold', 0, 60, ks.picHold, 'Key sequencer, Picture : the shortest a key stays, in seconds')
    add('/opsia/sonify/keyseq/every', 0.25, 300, ks.freeMs / 1000, 'Key sequencer, free time : how often a change may fall, in seconds')
    add('/opsia/sonify/keyseq/vary', 0, 1, ks.freeVary, 'Key sequencer, free time : each wait drawn between Every / 4^vary and Every x 4^vary')
    addI('/opsia/sonify/keyseq/keys', 0, 1, ks.picKeys === 'list' ? 1 : 0, 'Key sequencer, Picture : 0 the pool · 1 its own written keys')
    const tapIdx = (t: SoniConfig['taps'][number]): number => (t.kind === 'master' ? 0 : t.layer + 1)
    addI('/opsia/sonify/tap/a', 0, 4, tapIdx(so.taps[0]), 'Tap A reads : 0 master · 1..4 a layer')
    addI('/opsia/sonify/tap/b', 0, 4, tapIdx(so.taps[1]), 'Tap B reads : 0 master · 1..4 a layer')
    for (const v of Object.keys(SONI_TAP_VOICES) as Array<keyof typeof SONI_TAP_VOICES>) {
      addI(`/opsia/sonify/${v}/tap`, 0, 1, so[v].tap, `${v === 'sstv' ? 'Transmission' : v[0].toUpperCase() + v.slice(1)} listens to : 0 tap A · 1 tap B`)
    }
    for (const [v, sp] of Object.entries(SONI_OCT_SPAN)) {
      const vc = (so as unknown as Record<string, { loOct: number; hiOct: number }>)[v]
      if (!vc || !sp) continue
      const name = v[0].toUpperCase() + v.slice(1)
      addI(`/opsia/sonify/${v}/looct`, sp[0], sp[1], vc.loOct, `${name} lowest octave`)
      addI(`/opsia/sonify/${v}/hioct`, sp[2], sp[3], vc.hiOct, `${name} highest octave`)
    }
    add('/opsia/sonify/spectra/sync', 0, 1, so.spectra.sync ? 1 : 0, 'Spectra sweep synced to the tempo (one per bar)')
    addI('/opsia/sonify/orbit/shape', 0, ORBIT_RATIOS.length - 1, Math.max(0, ORBIT_RATIOS.findIndex((r) => Math.abs(r - so.orbit.ratio) < 1e-3)), 'Orbit shape : 0 circle · 1 1:2 · 2 2:3 · 3 3:4 · 4 1:3')
    add('/opsia/sonify/filter/loop', 0, 1, so.filter.loop ?? 0, 'Filter noise loop : 0 free noise · up = a frozen stretch replayed (flutter, then buzz)')
    const si = Math.max(0, SONI_SCALES.indexOf(so.scale))
    add('/opsia/sonify/scale', 0, 1, si / (SONI_SCALES.length - 1), `Quantizer scale : a name, or an index ${SONI_SCALES.map((s, i) => `${i} ${s}`).join(' · ')}`)
    const norm = (param: string, v: number): number => {
      const d = SONIFY_MOD_DESCS[param]
      return d ? Math.max(0, Math.min(1, (v - d.min) / (d.max - d.min))) : 0
    }
    add('/opsia/sonify/spectra/on', 0, 1, so.spectra.on ? 1 : 0, 'Spectra voice on')
    add('/opsia/sonify/spectra/gain', 0, 1, so.spectra.gain, 'Spectra gain')
    add('/opsia/sonify/spectra/x', 0, 1, norm('spectraX', so.spectra.x), 'Spectra scan column')
    add('/opsia/sonify/spectra/breath', 0, 1, so.spectra.breath ?? 0, 'Spectra sine-noise morph')
    addI('/opsia/sonify/spectra/path', 0, 3, so.spectra.path ?? 0, 'Spectra reading path : 0 horizontal · 1 vertical · 2 radial · 3 spiral')
    add('/opsia/sonify/spectra/breathe', 0, 1, (so.spectra.pace ?? 0) / 0.95, 'Spectra breathing sweep pace')
    add('/opsia/sonify/orbit/on', 0, 1, so.orbit.on ? 1 : 0, 'Orbit voice on')
    add('/opsia/sonify/orbit/gain', 0, 1, so.orbit.gain, 'Orbit gain')
    // Free-Hz mode : advertise the ACTUAL pitch by converting the live freq to a
    // note number (mirrors sonify's freqNote), instead of a constant 45.
    add('/opsia/sonify/orbit/pitch', 0, 1, norm('orbitPitch', so.orbit.quantize ? so.orbit.note : 69 + 12 * Math.log2(Math.max(1, so.orbit.freq) / 440)), 'Orbit pitch (note span)')
    add('/opsia/sonify/orbit/x', 0, 1, norm('orbitX', so.orbit.cx), 'Orbit center x')
    add('/opsia/sonify/orbit/y', 0, 1, norm('orbitY', so.orbit.cy), 'Orbit center y')
    add('/opsia/sonify/orbit/r', 0, 1, norm('orbitR', so.orbit.rx), 'Orbit radius')
    add('/opsia/sonify/flow/on', 0, 1, so.flow.on ? 1 : 0, 'Flow voice on')
    add('/opsia/sonify/flow/gain', 0, 1, so.flow.gain, 'Flow gain')
    add('/opsia/sonify/flow/colour', 0, 1, so.flow.colour ?? 0.6, 'Flow color → grain timbre')
    add('/opsia/sonify/chord/on', 0, 1, so.chord.on ? 1 : 0, 'Chord bank on')
    add('/opsia/sonify/chord/gain', 0, 1, so.chord.gain, 'Chord gain')
    addI('/opsia/sonify/chord/voices', 2, 16, so.chord.voices, 'Chord note count')
    add('/opsia/sonify/chord/swell', 0, 1, (so.chord.attack - 0.02) / 2.98, 'Chord attack (swell)')
    add('/opsia/sonify/chord/fade', 0, 1, (so.chord.release - 0.05) / 5.95, 'Chord release (fade)')
    add('/opsia/sonify/chord/tone', 0, 1, so.chord.tone, 'Chord tone (sine → bright)')
    add('/opsia/sonify/chord/spread', 0, 1, so.chord.spread, 'Chord stereo spread')
    const co = so.collage ?? { on: false, gain: 0.7, reso: 0.5, ring: 0.5, bright: 0.5, width: 1 }
    add('/opsia/sonify/collage/on', 0, 1, co.on ? 1 : 0, 'Collage voice on (the Collage films heard)')
    add('/opsia/sonify/collage/gain', 0, 1, co.gain, 'Collage gain')
    add('/opsia/sonify/collage/resonance', 0, 1, co.reso, 'Collage resonance (plain films ↔ tuned resonances)')
    add('/opsia/sonify/collage/ring', 0, 1, co.ring, 'Collage ring (resonator sharpness)')
    add('/opsia/sonify/collage/harmonics', 0, 1, co.bright, 'Collage harmonics (2nd + 3rd)')
    add('/opsia/sonify/collage/input', 0, 1, ((co.inGain ?? 0) + 24) / 36, 'Collage : the films in, -24..+12 dB (before the resonators)')
    add('/opsia/sonify/collage/hp', 0, 1, Math.log((co.hp ?? 20) / 20) / Math.log(50), 'Collage : the films high-pass, 20 Hz (off)..1 kHz, 24 dB/oct')
    add('/opsia/sonify/collage/lp', 0, 1, Math.log((co.lp ?? 20000) / 1000) / Math.log(20), 'Collage : the films low-pass, 1 kHz..20 kHz (off), 24 dB/oct')
    add('/opsia/sonify/collage/ringin', 0, 1, ((co.ringIn ?? 0) + 24) / 36, 'Collage : how hard the films drive the Ring bank, -24..+12 dB')
    add('/opsia/sonify/collage/comp', 0, 1, co.comp ?? 0, 'Collage : one compressor on all the films (0 = off), so they hold one level')
    add('/opsia/sonify/collage/hpslope', 0, 1, co.hpSlope === 12 ? 0 : 1, 'Collage : the high-pass slope, 12 or 24 dB/oct (int 12 / 24, or >= 0.5 = 24)')
    add('/opsia/sonify/collage/lpslope', 0, 1, co.lpSlope === 12 ? 0 : 1, 'Collage : the low-pass slope, 12 or 24 dB/oct (int 12 / 24, or >= 0.5 = 24)')
    add('/opsia/sonify/collage/width', 0, 1, co.width, 'Collage stereo width')
    add('/opsia/sonify/collage/bank', 0, 1, co.bank ?? 0, 'Collage ring bank wet (0 = the plain voice)')
    add('/opsia/sonify/collage/decay', 0, 1, co.decay ?? 0.5, 'Collage ring bank decay (12 ms .. 10 s)')
    add('/opsia/sonify/collage/cutoff', 0, 1, co.cutoff ?? 1, 'Collage ring bank cutoff')
    add('/opsia/sonify/collage/peak', 0, 1, co.peak ?? 0, 'Collage ring bank peak')
    add('/opsia/sonify/collage/slope', 0, 1, co.slope ?? 0, 'Collage ring bank slope : low-pass .. band-pass .. high-pass')
    add('/opsia/sonify/collage/waves', 0, 1, co.waves ?? 0, 'Collage ring bank waves')
    add('/opsia/sonify/collage/noise', 0, 1, co.noise ?? 0, 'Collage ring bank noise')
    add('/opsia/sonify/collage/detune', 0, 1, co.detune ?? 0, 'Collage ring bank detune')
    addI('/opsia/sonify/collage/voicing', 0, 4, co.voicing ?? 0, 'Collage ring bank voicing : 0 Clean · 1 SEM · 2 MS-20 · 3 Steiner · 4 K35')
    // the Assemblage takes the Collage's controls (one route), + accent and tape
    const as = so.assemblage ?? { on: false, gain: 0.7, reso: 0.3, ring: 0.5, bright: 0.5, width: 0.8, accent: 0.4, tape: true, comp: 0, bank: 0 }
    add('/opsia/sonify/assemblage/on', 0, 1, as.on ? 1 : 0, 'Assemblage voice on (an edit’s own sound, cut with the picture)')
    add('/opsia/sonify/assemblage/gain', 0, 1, as.gain, 'Assemblage gain')
    add('/opsia/sonify/assemblage/resonance', 0, 1, as.reso, 'Assemblage resonance (plain films ↔ tuned resonances)')
    add('/opsia/sonify/assemblage/ring', 0, 1, as.ring, 'Assemblage ring (resonator sharpness)')
    add('/opsia/sonify/assemblage/harmonics', 0, 1, as.bright, 'Assemblage harmonics (2nd + 3rd)')
    add('/opsia/sonify/assemblage/input', 0, 1, ((as.inGain ?? 0) + 24) / 36, 'Assemblage : the films in, -24..+12 dB (before the resonators)')
    add('/opsia/sonify/assemblage/hp', 0, 1, Math.log((as.hp ?? 20) / 20) / Math.log(50), 'Assemblage : the films high-pass, 20 Hz (off)..1 kHz, 24 dB/oct')
    add('/opsia/sonify/assemblage/lp', 0, 1, Math.log((as.lp ?? 20000) / 1000) / Math.log(20), 'Assemblage : the films low-pass, 1 kHz..20 kHz (off), 24 dB/oct')
    add('/opsia/sonify/assemblage/ringin', 0, 1, ((as.ringIn ?? 0) + 24) / 36, 'Assemblage : how hard the films drive the Ring bank, -24..+12 dB')
    add('/opsia/sonify/assemblage/comp', 0, 1, as.comp ?? 0, 'Assemblage : one compressor on the edit’s sound (0 = off)')
    add('/opsia/sonify/assemblage/hpslope', 0, 1, as.hpSlope === 12 ? 0 : 1, 'Assemblage : the high-pass slope, 12 or 24 dB/oct (int 12 / 24, or >= 0.5 = 24)')
    add('/opsia/sonify/assemblage/lpslope', 0, 1, as.lpSlope === 12 ? 0 : 1, 'Assemblage : the low-pass slope, 12 or 24 dB/oct (int 12 / 24, or >= 0.5 = 24)')
    add('/opsia/sonify/assemblage/width', 0, 1, as.width, 'Assemblage stereo width (pan by the clip’s place on the map)')
    add('/opsia/sonify/assemblage/accent', 0, 1, as.accent ?? 0.4, 'Assemblage cut accent (a strike of the resonators at every cut)')
    add('/opsia/sonify/assemblage/tape', 0, 1, as.tape === false ? 0 : 1, 'Assemblage pitch : tape (>= 0.5, speed changes the pitch) or keep')
    add('/opsia/sonify/assemblage/bank', 0, 1, as.bank ?? 0, 'Assemblage ring bank wet (0 = the plain voice)')
    add('/opsia/sonify/assemblage/decay', 0, 1, as.decay ?? 0.5, 'Assemblage ring bank decay (12 ms .. 10 s)')
    add('/opsia/sonify/assemblage/cutoff', 0, 1, as.cutoff ?? 1, 'Assemblage ring bank cutoff')
    add('/opsia/sonify/assemblage/peak', 0, 1, as.peak ?? 0, 'Assemblage ring bank peak')
    add('/opsia/sonify/assemblage/slope', 0, 1, as.slope ?? 0, 'Assemblage ring bank slope : low-pass .. band-pass .. high-pass')
    add('/opsia/sonify/assemblage/waves', 0, 1, as.waves ?? 0, 'Assemblage ring bank waves')
    add('/opsia/sonify/assemblage/noise', 0, 1, as.noise ?? 0, 'Assemblage ring bank noise')
    add('/opsia/sonify/assemblage/detune', 0, 1, as.detune ?? 0, 'Assemblage ring bank detune')
    addI('/opsia/sonify/assemblage/voicing', 0, 4, as.voicing ?? 0, 'Assemblage ring bank voicing : 0 Clean · 1 SEM · 2 MS-20 · 3 Steiner · 4 K35')
    add('/opsia/sonify/chord/waves', 0, 1, so.chord.waves ?? 0, 'Chord waves (a travelling level across the notes)')
    add('/opsia/sonify/chord/noise', 0, 1, so.chord.noise ?? 0, 'Chord noise (a pink noise band on every note)')
    add('/opsia/sonify/chord/air', 0, 1, so.chord.air ?? 0.4, 'Chord air (the noise bands, narrow to wide)')
    // shared reverb / delay tail
    add('/opsia/sonify/fx/send', 0, 1, so.fx.send, 'FX tail send (whole mix → delay/reverb)')
    add('/opsia/sonify/fx/delaytime', 0, 1, Math.log(so.fx.dlyTime / 0.02) / Math.log(2 / 0.02), 'Delay time')
    add('/opsia/sonify/fx/feedback', 0, 1, so.fx.dlyFb / 0.95, 'Delay feedback')
    add('/opsia/sonify/fx/delaytone', 0, 1, so.fx.dlyTone, 'Delay BBD tone')
    add('/opsia/sonify/fx/delaymix', 0, 1, so.fx.dlyMix, 'Delay level in the tail')
    addI('/opsia/sonify/fx/delaymode', 0, 2, so.fx.dlyMode, 'Delay routing : 0 mono · 1 stereo · 2 ping-pong')
    add('/opsia/sonify/fx/reverbmode', 0, 1, so.fx.rvMode, 'Reverb : 0 Quartz · 1 Prism')
    add('/opsia/sonify/fx/size', 0, 1, so.fx.rvSize, 'Reverb size')
    add('/opsia/sonify/fx/decay', 0, 1, so.fx.rvDecay, 'Reverb decay (RT60)')
    add('/opsia/sonify/fx/damp', 0, 1, so.fx.rvDamp, 'Reverb HF damping')
    add('/opsia/sonify/fx/predelay', 0, 1, so.fx.rvPre / 200, 'Reverb predelay')
    add('/opsia/sonify/fx/shimmer', 0, 1, so.fx.rvMod / 40, 'Reverb tail modulation')
    add('/opsia/sonify/fx/width', 0, 1, so.fx.rvWidth, 'Reverb stereo width')
    add('/opsia/sonify/fx/locut', 0, 1, Math.log(so.fx.rvLocut / 20) / Math.log(100), 'Reverb wet low-cut')
    add('/opsia/sonify/fx/freeze', 0, 1, so.fx.rvFreeze ? 1 : 0, 'Reverb infinite freeze')
    add('/opsia/sonify/fx/reverbmix', 0, 1, so.fx.rvMix, 'Reverb level in the tail')
    add('/opsia/sonify/events/on', 0, 1, so.events.on ? 1 : 0, 'Events voice on')
    add('/opsia/sonify/events/gain', 0, 1, so.events.gain, 'Events gain')
    addI('/opsia/sonify/events/mode', 0, 2, so.events.mode === 'blend' ? 2 : so.events.mode === 'motion' ? 1 : 0, 'Events trigger : 0 spatial · 1 motion · 2 blend')
    add('/opsia/sonify/events/density', 0, 1, so.events.density, 'Events per instant')
    add('/opsia/sonify/events/decay', 0, 1, so.events.decay, 'Event note decay')
    add('/opsia/sonify/signal/on', 0, 1, so.signal.on ? 1 : 0, 'Signal voice on')
    add('/opsia/sonify/signal/gain', 0, 1, so.signal.gain, 'Signal gain')
    addI('/opsia/sonify/signal/wave', 0, 8, so.signal.wave, 'Signal grain : 0 pip · 1 damped · 2 noise · 3 click · 4 fm · 5 square · 6 tri · 7 pink · 8 ping')
    add('/opsia/sonify/signal/decay', 0, 1, so.signal.decay, 'Signal grain length, 0.2 ms to 500 ms')
    add('/opsia/sonify/signal/tone', 0, 1, so.signal.tone, 'Signal noise brightness')
    add('/opsia/sonify/signal/fm', 0, 1, so.signal.fm, 'Signal fm depth')
    addI('/opsia/sonify/signal/heads', 1, 4, so.signal.heads, 'Signal read heads')
    addI('/opsia/sonify/signal/steps', 0, 7, Math.max(0, [8, 12, 16, 24, 32, 48, 64, 96].indexOf(so.signal.steps)), 'Signal steps per sweep : 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96')
    add('/opsia/sonify/signal/rate', 0, 1, Math.max(0, Math.min(1, (so.signal.rate - 0.25) / (so.signal.sync ? 15.75 : 63.75))), 'Signal steps per second, or per beat when synced')
    add('/opsia/sonify/signal/sync', 0, 1, so.signal.sync ? 1 : 0, 'Signal clock locked to the tempo')
    add('/opsia/sonify/signal/spread', 0, 1, so.signal.spread, 'Signal polymeter between the heads')
    add('/opsia/sonify/signal/thresh', 0, 1, so.signal.thresh, 'Signal : how bright a cell must be to fire')
    add('/opsia/sonify/signal/density', 0, 1, so.signal.density, 'Signal marks per head per step')
    addI('/opsia/sonify/signal/path', 0, 3, so.signal.path, 'Signal path : 0 horizontal · 1 vertical · 2 radial · 3 spiral')
    add('/opsia/sonify/signal/snap', 0, 1, so.signal.snap, 'Signal pitch : free frequency (0) to the scale (1)')
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
    addI('/opsia/sonify/filter/path', 0, 3, so.filter.path ?? 0, 'Filter reading path : 0 horizontal · 1 vertical · 2 radial · 3 spiral')
    add('/opsia/sonify/filter/breathe', 0, 1, (so.filter.pace ?? 0) / 0.95, 'Filter breathing sweep pace')
  }
  add('/opsia/bpm', 20, 800, st.composition.bpm, 'Tempo (raw BPM)')
  // Audio features Pandore PUSHES (consumed by `audio` modulators) : never echoed.
  for (const feat of OSC_AUDIO_FEATURES) {
    add(`/opsia/audio/${feat}`, 0, 1, 0, `Audio ${feat} (0..1)`, false)
  }
  for (let b = 1; b <= 6; b++) add(`/opsia/audio/band/${b}`, 0, 1, 0, `Audio band ${b} energy (0..1)`, false)
  // Vision features the PICTURE emits (the return path) : streamed OUT to Pandore
  // so the composited image plays the synths (echoed by the outbound diff loop).
  for (const vf of VISION_FEATURES) {
    add(`/opsia/vision/${vf}`, 0, 1, visionBus.feature(vf), `Vision ${vf} (0..1) : the composited picture as control`)
  }
  // Body features (the room : hands, pose, face, silhouette zones, the camera's
  // motion field), streamed OUT while the Body camera runs, so a synth can follow a
  // gesture or a crowd's motion directly (rules still fire /body/<name>).
  if (st.bodyControl.enabled) {
    for (const bf of BODY_FEATURES) {
      add(`/opsia/body/${bf}`, 0, 1, bodyBus.feature(bf), `Body ${bf} (0..1) : the room as control`)
    }
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
  add('/opsia/bg/speed', 0, 1, (bg?.speed ?? BG_DEFAULT_SPEED) / BG_SPEED_MAX, 'Background clock speed (0..1 → 0..4×; 0.0625 = 0.25×)')
  add('/opsia/bg/depth', 0, 1, bg?.depth ?? 0, 'Background shadow : the soft shadow the layers cast on it')
  add('/opsia/bg/blend', 0, 1, bg?.blendMode === 'isolate' ? 1 : 0, 'How the layers sit on the Background (0 = blend · 1 = group)')
  if (bg?.source?.shaderId) {
    const sid = bg.source.shaderId
    for (const d of inputsForShader(sid)) {
      if (d.type !== 'float') continue
      add(`/opsia/bg/source/${d.name}`, 0, 1, inputNorm(sid, d.name, bg.source.inputs?.[d.name]), `Background · ${d.label}`)
    }
  }
  // Global field macros + Proximity (0.5 = deadzone).
  add('/opsia/density', 0, 1, st.density ?? 0.5, 'Density macro (sparse ⇄ dense)')
  add('/opsia/coupling', 0, 1, st.couplingOn ? 1 : 0, 'A/B coupling master switch (>= 0.5 : on)')
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
  add('/opsia/world/amount', 0, 1, st.worldAmount, "World amount : how much of the active World's mood is on (0 = the mood it found)")
  add('/opsia/seq/run', 0, 1, st.sequence.running ? 1 : 0, 'Sequencer running (>= 0.5)')
  add('/opsia/seq/skip', 0, 1, 0, 'Advance to the next scene (trigger)', false)
  add('/opsia/panic', 0, 1, 0, 'Panic flush : drop every self-feeding buffer (trigger)', false)
  add('/opsia/vary', 0, 1, 0, 'Vary : a variant of the whole scene at the Transport spread (trigger)', false)
  for (const sc of ['sources', 'sourceparams', 'sourcefx', 'sourcefxonly', 'layerfxonly', 'layer', 'master', 'finishing', 'modulators', 'masterparams', 'meta', 'inspector', 'sonify', 'resolume', 'background'])
    add(`/opsia/randomize/${sc}`, 0, 1, 0, `Randomize ${sc} (trigger)`, false)
  {
    const ox = st.outXform
    const n01 = (f: OutXformField): number => (ox[f] - OUTX_MOD_RANGE[f].min) / (OUTX_MOD_RANGE[f].max - OUTX_MOD_RANGE[f].min)
    add('/opsia/output/x', 0, 1, n01('offsetX'), 'Output transform : offset x (0.5 = none)')
    add('/opsia/output/y', 0, 1, n01('offsetY'), 'Output transform : offset y (0.5 = none)')
    add('/opsia/output/scale', 0, 1, n01('scale'), 'Output transform : scale (0..2, 0.5 = 1)')
    add('/opsia/output/rotate', 0, 1, n01('rotate'), 'Output transform : rotate (0.5 = none)')
    add('/opsia/output/spin', 0, 1, n01('spin'), 'Output transform : spin speed (0.5 = still)')
    add('/opsia/output/feather', 0, 1, n01('feather'), 'Output transform : feathered edges')
    add('/opsia/output/flipx', 0, 1, ox.flipX ? 1 : 0, 'Output transform : flip x (>= 0.5)')
    add('/opsia/output/flipy', 0, 1, ox.flipY ? 1 : 0, 'Output transform : flip y (>= 0.5)')
    add('/opsia/output/edge', 0, 1, OUT_EDGES.indexOf(ox.edge) / 2, 'Output transform : edge (black · repeat · mirror)')
    add('/opsia/output/reset', 0, 1, 0, 'Output transform : back to the frame as it is (trigger)', false)
  }
  {
    const al = st.audioLayer
    add('/opsia/audiolayer/volume', 0, 2, al.volume, 'The Audio Layer : its volume (a gain, 1 = as it comes)')
    add('/opsia/audiolayer/mix', 0, 1, al.mix, 'The Audio Layer : A to B (0.5 = both whole)')
    add('/opsia/audiolayer/mute', 0, 1, al.mute ? 1 : 0, 'The Audio Layer : mute (>= 0.5)')
    const filesPlay = (['A', 'B'] as const).some((sl) => al[sl]?.kind === 'file' && al[sl]?.videoPlaying !== false)
    // a start from the in points on its rising edge : never mirrored, or a
    // destination that sends its state back restarted both files mid-show
    add('/opsia/audiolayer/play', 0, 1, filesPlay ? 1 : 0, 'The Audio Layer : both files from their in points together (>= 0.5), or paused', false)
    for (const sl of ['A', 'B'] as const) {
      const x = al[sl]
      if (!x) continue
      const p = `/opsia/audiolayer/${sl}`
      add(`${p}/volume`, 0, 2, x.volume, `Audio Layer ${sl} : volume (a gain)`)
      add(`${p}/pan`, -1, 1, x.pan, `Audio Layer ${sl} : pan (-1 left .. 1 right)`)
      add(`${p}/mute`, 0, 1, x.mute ? 1 : 0, `Audio Layer ${sl} : mute (>= 0.5)`)
      if (x.kind !== 'file') continue
      add(`${p}/play`, 0, 1, (x.videoPlaying ?? true) ? 1 : 0, `Audio Layer ${sl} : play (>= 0.5) / pause`)
      add(`${p}/loop`, 0, 1, (x.videoLoop ?? true) ? 1 : 0, `Audio Layer ${sl} : loop between in/out (>= 0.5)`)
      add(`${p}/ignoreglobal`, 0, 1, x.ignoreGlobalSpeed ? 1 : 0, `Audio Layer ${sl} : its own speed, whatever the global speed (>= 0.5)`)
      add(`${p}/keeppitch`, 0, 1, x.keepPitch ? 1 : 0, `Audio Layer ${sl} : keep the pitch when the speed changes (>= 0.5)`)
      const sp = Math.max(VSMIN, Math.min(VSMAX, x.videoSpeed ?? 1))
      add(`${p}/speed`, 0, 1, Math.log(sp / VSMIN) / Math.log(VSMAX / VSMIN), `Audio Layer ${sl} : speed (0..1 log across 1/64x..128x; a sound plays 1/16x to 16x)`)
      add(`${p}/position`, 0, 1, 0, `Audio Layer ${sl} : one-shot seek (0..1 within the in/out trim)`, false)
      add(`${p}/in`, 0, 1, x.videoIn ?? 0, `Audio Layer ${sl} : trim in point`)
      add(`${p}/out`, 0, 1, x.videoOut ?? 1, `Audio Layer ${sl} : trim out point`)
    }
  }
  {
    const sp = st.space
    add('/opsia/space/mode', 0, 1, ['stereo', 'speakers', 'objects'].indexOf(sp.mode) / 2, 'Space : stereo · speakers · objects')
    add('/opsia/space/turn', 0, 1, (sp.rotate + 180) / 360, 'Space : turn the sound scene (0.5 = none)')
    add('/opsia/space/glide', 0, 1, sp.glide / 2, 'Space : glide of a following voice (0..2 s)')
    add('/opsia/space/mirror', 0, 1, sp.mirror ? 1 : 0, 'Space : swap left and right (>= 0.5)')
    add('/opsia/space/headphones', 0, 1, sp.preview ? 1 : 0, 'Space : hear the room on headphones (>= 0.5)')
    add('/opsia/space/pieces', 0, 1, sp.pieces / SPACE_PIECES, 'Space : Collage pieces as sources of their own (int count, or 0..1 of 30)')
    for (const v of SPACE_VOICES) {
      const pl = sp.voices[v]
      add(`/opsia/space/${v}/follow`, 0, 1, pl.follow ? 1 : 0, `Space : ${v} follows the picture (>= 0.5), else fixed`)
      for (const f of SPACE_FIELDS) {
        const r = SPACE_FIELD_RANGE[f]
        add(`/opsia/space/${v}/${f}`, 0, 1, (placeField(pl, f) - r.min) / (r.max - r.min), `Space : ${v} ${r.label} (${r.min}..${r.max})`)
      }
    }
  }
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

/** Every /opsia address with its live 0..1 value (the Resolume mapper's
 *  "Palinopsia OSC" inputs read these, so they speak exactly what OSC out says). */
export function oscLeafValues(): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of enumerateLeaves()) m.set(l.path, l.max > l.min ? (l.value - l.min) / (l.max - l.min) : l.value)
  return m
}

/** The advertised address list (path + description), for pickers; `int` : an
 *  index, read raw from an OSC int (the agent's osc tool sends one there only). */
export function oscLeafList(): Array<{ path: string; desc: string; int?: boolean }> {
  return enumerateLeaves().map((l) => ({ path: l.path, desc: l.desc, ...(l.int ? { int: true } : {}) }))
}

// The advertised tree follows the structure : a source or an effect loaded
// brings its own leaves, and so do a video or an Audio Layer file, the Body
// camera, a World added. Looked at again (at most twice a second) after the
// store changes while OSC in listens, and re-sent when the leaf list itself
// changed; the values travel by feedback and the WS stream. It used to be
// published only when OSC in started.
let publishedShape = ''
let shapeTimer: ReturnType<typeof setTimeout> | null = null
const shapeOf = (leaves: Leaf[]): string => leaves.map((l) => `${l.path}|${l.int ? 'i' : 'f'}|${l.min}|${l.max}`).join('\n')

function watchOscQueryShape(): () => void {
  const unsub = useStore.subscribe(() => {
    if (shapeTimer || !useStore.getState().oscListening) return
    shapeTimer = setTimeout(() => {
      shapeTimer = null
      if (useStore.getState().oscListening && shapeOf(enumerateLeaves()) !== publishedShape) publishOscQuery()
    }, 500)
  })
  return () => {
    unsub()
    if (shapeTimer) clearTimeout(shapeTimer)
    shapeTimer = null
  }
}

/** Enumerate the address space and hand it to the OSCQuery server. */
export function publishOscQuery(): void {
  const leaves = enumerateLeaves()
  publishedShape = shapeOf(leaves)
  const nodes: OscQueryLeaf[] = leaves.map((n) => ({
    full_path: n.path,
    type: n.int ? 'i' : 'f',
    range: { min: n.min, max: n.max },
    value: n.value,
    description: n.desc,
    // /opsia/vision/* is outbound-only (the picture reports it; there is no
    // inbound route), so advertise it read-only instead of as a writable float.
    // Audio leaves stay writable — Pandore PUSHES those in.
    ...(n.path.startsWith('/opsia/vision/') ? { access: 1 } : {})
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
    void sendOsc(host, port, leaf.path, [leaf.int ? { type: 'i', value: Math.round(leaf.value) } : { type: 'f', value: leaf.value }])
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
