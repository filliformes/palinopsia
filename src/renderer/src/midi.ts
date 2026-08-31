// Web MIDI : hardware control, dataFLOU's model ported whole.
//
// - DEVICES : every input is listed; the io tab's dropdown picks ONE (or all).
//   Hot-plug handled via onstatechange. The chosen input name is machine-local.
// - LEARN (global, Ableton-style) : the MIDI LEARN toolbar button arms the
//   mode; blue overlays appear on every learnable control. Click one (it
//   pulses), move a knob / hit a pad, and it's bound (green). The mode stays
//   on so the next control can be mapped immediately. While armed, normal
//   routing is muted so the controller doesn't fire scenes by accident.
// - LEARN (legacy, per-knob) : a Meta knob's CC button still arms that one
//   knob directly (store.midiLearn = index); the first CC wins.
// - PLAY : CCs drive Meta knobs through the smoother (same feel as a mouse
//   drag) and the transport's continuous controls; notes / button-CCs fire
//   scenes, Vary, Randomize and the Sonify toggle on the press edge only.
//
// Meta-knob CC bindings live in the session (composition.metaKnobs[i].midiCc);
// everything else is machine-local in store.midiMap (localStorage), keyed by
// the target ids below.

import type { MidiBinding } from '@shared/types'
import { fireSelectedRandomize, fireVariation, firePanic, fireFreeze, fireRecordToggle } from './commands'
import { setKnobTarget } from './metaSmooth'
import { useStore } from './store'
import type { SoniConfig } from './audio/sonify'

const SONI_VOICE_KEYS = ['spectra', 'orbit', 'flow', 'events', 'raster', 'sstv', 'filter', 'chord'] as const
// Field-macro CC targets → their store setters. These "feel" dials aren't
// mod-matrix destinations, so the Meta knobs can't reach them : MIDI is the
// only way to bind hardware to them.
const FIELD_SETTERS: Record<string, (v: number) => void> = {
  'field:density': (v) => useStore.getState().setDensity(v),
  'field:gestureTexture': (v) => useStore.getState().setGestureTexture(v),
  'field:coalesce': (v) => useStore.getState().setCoalesce(v),
  'field:tonicity': (v) => useStore.getState().setTonicity(v),
  'field:drift': (v) => useStore.getState().setDrift(v),
  'field:flow': (v) => useStore.getState().setFlow(v),
  'field:shutter': (v) => useStore.getState().setShutter(v),
  'field:superFlicker': (v) => useStore.getState().setSuperFlicker(v)
}
const FIELD_LABELS: Record<string, string> = {
  'field:density': 'DENSITY', 'field:gestureTexture': 'GESTURE↔TEXTURE', 'field:coalesce': 'COALESCE',
  'field:tonicity': 'TONICITY', 'field:drift': 'DRIFT', 'field:flow': 'FLOW↔INTERRUPT',
  'field:shutter': 'SHUTTER', 'field:superFlicker': 'SUPERIMPOSE'
}

// Tap tempo from a pad : a rolling window of hit times → BPM (like the Transport).
const tapTimes: number[] = []
function tapTempo(): void {
  const now = performance.now()
  if (tapTimes.length && now - tapTimes[tapTimes.length - 1] > 2000) tapTimes.length = 0
  tapTimes.push(now)
  if (tapTimes.length > 6) tapTimes.shift()
  if (tapTimes.length < 2) return
  let sum = 0
  for (let i = 1; i < tapTimes.length; i++) sum += tapTimes[i] - tapTimes[i - 1]
  const bpm = Math.max(20, Math.min(800, Math.round(60000 / (sum / (tapTimes.length - 1)))))
  useStore.setState((s) => ({ composition: { ...s.composition, bpm } }))
}

/** Recall the scene `dir` steps from the active one (wraps); no active → scene 0. */
function recallRelativeScene(dir: number): void {
  const st = useStore.getState()
  const scenes = st.scenes
  if (!scenes.length) return
  const cur = scenes.findIndex((s) => s.id === st.activeSceneId)
  const next = cur < 0 ? 0 : ((cur + dir) % scenes.length + scenes.length) % scenes.length
  st.recallScene(scenes[next].id)
}

function toggleSoniVoice(i: number): void {
  const k = SONI_VOICE_KEYS[i]
  const cur = useStore.getState().sonify
  const rec = cur as unknown as Record<string, { on: boolean }>
  useStore.getState().setSonify({ ...cur, [k]: { ...rec[k], on: !rec[k].on } } as SoniConfig)
}

export interface MidiDevice {
  id: string
  name: string
}

// ── Learnable targets ────────────────────────────────────────────────────
// meta:<i>          Meta knob i (CC only, stored on the knob itself)
// scene:<i>         scene slot i (0-based; note or button-CC recalls it)
// scene:next/prev   note/CC press → step the scene bank (wraps)
// transport:bpm     CC → 40..240 BPM
// transport:speed   CC → global speed 1/64×..64× (log, like the slider)
// transport:morph   CC → morph time (same power curve as the slider)
// transport:prox    CC → proximity 0..1
// field:<macro>     CC → a feel dial (density/gestureTexture/coalesce/tonicity/
//                   drift/flow/shutter/superFlicker) — NOT mod-matrix targets,
//                   so MIDI is the only hardware route to them
// layer:<i>:mix     CC → layer i's A↔B source crossfade (0..1)
// surface:x / :y    CC → the Metasurface cursor axis (drives scene-morphing;
//                   activates the surface; needs >=2 placed scenes)
// sonify:master     CC → Sonify master gain
// sonify:voice:<i>  note/CC press → toggle Sonify voice i on/off (0..7)
// fire:vary         note/CC press → Variation at the current spread
// fire:randomize    note/CC press → the selected Randomize
// fire:sonify       note/CC press → Sonify on/off
// fire:flush        note/CC press → panic flush (empty self-feeding buffers)
// fire:freeze       note/CC press → toggle the global freeze / hold latch
// fire:record       note/CC press → start (fast take) / stop recording
// fire:tap          note/CC press → tap tempo
// fire:seq          note/CC press → toggle the scene sequencer
// fire:soniseq      note/CC press → toggle the Sonify step sequencer

/** Continuous targets take knobs/faders only : notes are ignored while one
 *  of these is the armed learn target (keep twisting until it takes). */
export function isContinuousTarget(id: string): boolean {
  return (
    id.startsWith('meta:') ||
    id.startsWith('transport:') ||
    id.startsWith('field:') ||
    id === 'surface:x' ||
    id === 'surface:y' ||
    id === 'sonify:master' ||
    id === 'bg:opacity' ||
    /^layer:\d+:(mix|opacity)$/.test(id)
  )
}

/** Human name for a target id (bindings list + overlay tooltips). */
export function midiTargetLabel(id: string): string {
  if (id.startsWith('meta:')) {
    const i = Number(id.slice(5))
    const name = useStore.getState().composition.metaKnobs[i]?.name
    return `META ${i + 1}${name ? ` · ${name}` : ''}`
  }
  if (id === 'scene:next') return 'SCENE next'
  if (id === 'scene:prev') return 'SCENE prev'
  if (id.startsWith('scene:')) return `SCENE ${Number(id.slice(6)) + 1}`
  if (id in FIELD_LABELS) return FIELD_LABELS[id]
  if (id === 'bg:opacity') return 'BACKGROUND opacity'
  const lm = /^layer:(\d+):(mix|opacity)$/.exec(id)
  if (lm) return `LAYER ${Number(lm[1]) + 1} ${lm[2] === 'mix' ? 'A↔B' : 'opacity'}`
  const sv = /^sonify:voice:(\d+)$/.exec(id)
  if (sv) return `SONIFY ${SONI_VOICE_KEYS[Number(sv[1])] ?? sv[1]} on/off`
  switch (id) {
    case 'transport:bpm':
      return 'BPM'
    case 'transport:speed':
      return 'SPEED'
    case 'transport:morph':
      return 'MORPH'
    case 'transport:prox':
      return 'PROXIMITY'
    case 'surface:x':
      return 'SURFACE X'
    case 'surface:y':
      return 'SURFACE Y'
    case 'sonify:master':
      return 'SONIFY master'
    case 'fire:vary':
      return 'VARY'
    case 'fire:randomize':
      return 'RANDOMIZE'
    case 'fire:sonify':
      return 'SONIFY on/off'
    case 'fire:flush':
      return 'FLUSH'
    case 'fire:freeze':
      return 'FREEZE / hold'
    case 'fire:record':
      return 'RECORD toggle'
    case 'fire:tap':
      return 'TAP tempo'
    case 'fire:seq':
      return 'SEQUENCER run'
    case 'fire:soniseq':
      return 'SONIFY seq run'
    default:
      return id
  }
}

/** 'CC21 ch1' / 'NOTE 36 ch10' — one shape everywhere a binding is shown. */
export function describeBinding(b: MidiBinding): string {
  return `${b.kind === 'cc' ? 'CC' : 'NOTE '}${b.number} ch${b.channel + 1}`
}

// Morph slider's power curve (Transport.tsx) : CC value → ms over 0..30s.
const MORPH_POW = 2.5

class MidiManager {
  private access: MIDIAccess | null = null
  private listeners = new Set<(devs: MidiDevice[]) => void>()
  // Diagnostics : the last raw message seen + the count of inputs currently
  // wired. The MIDI panel shows these so a plugged-in-but-silent controller is
  // instantly visible (message arriving vs not; input actually attached).
  lastMsg = ''
  wiredCount = 0

  async init(): Promise<boolean> {
    if (!('requestMIDIAccess' in navigator)) {
      console.warn('[midi] Web MIDI unavailable')
      return false
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false })
    } catch (e) {
      console.warn('[midi] access denied:', (e as Error).message)
      return false
    }
    this.access.onstatechange = (): void => {
      this.attach() // hot-plugged controllers join (or leave) live
      this.notify()
    }
    this.attach()
    this.notify()
    return true
  }

  listDevices(): MidiDevice[] {
    const out: MidiDevice[] = []
    this.access?.inputs.forEach((inp) => out.push({ id: inp.id, name: inp.name ?? inp.id }))
    return out
  }

  /** (Re)wire message handlers to the selected input — or all of them when
   *  no name is chosen. Called on init, hot-plug, and dropdown change. */
  attach(): void {
    if (!this.access) return
    const wanted = useStore.getState().midiInputName
    // If a named device is selected but NO connected port matches it (a stale /
    // renamed port), fall back to listening on ALL inputs rather than silently
    // wiring zero and dropping every message.
    let matched = false
    if (wanted) this.access.inputs.forEach((inp) => { if ((inp.name ?? inp.id) === wanted) matched = true })
    const useAll = !wanted || !matched
    let wired = 0
    this.access.inputs.forEach((inp) => {
      const mine = useAll || (inp.name ?? inp.id) === wanted
      inp.onmidimessage = mine ? (e): void => this.onMessage(e) : null
      if (mine) wired++
    })
    this.wiredCount = wired
    if (wanted && !matched) console.warn(`[midi] input "${wanted}" not found — listening to all inputs instead`)
  }

  subscribe(cb: (devs: MidiDevice[]) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private notify(): void {
    const devs = this.listDevices()
    this.listeners.forEach((l) => l(devs))
  }

  private onMessage(e: MIDIMessageEvent): void {
    const data = e.data
    if (!data || data.length < 2) return
    const status = data[0] & 0xf0
    const channel = data[0] & 0x0f
    const number = data[1]
    const value = data[2] ?? 0

    // Activity readout : record EVERY message (even ones we don't route, like
    // pitch-bend) so the panel shows a controller is alive. Set before any return.
    const kind =
      status === 0x90 ? (value > 0 ? 'NOTE' : 'note-off')
      : status === 0x80 ? 'note-off'
      : status === 0xb0 ? 'CC'
      : status === 0xe0 ? 'pitch-bend'
      : status === 0xd0 ? 'aftertouch'
      : status === 0xc0 ? 'prog-change'
      : '0x' + status.toString(16)
    this.lastMsg = `${kind} ${number} ch${channel + 1}${status === 0xb0 || status === 0x90 ? ' = ' + value : ''}`

    // A binding candidate from any CC or Note-On. CC value 0 still counts
    // (a knob turned fully down must keep driving its target).
    let binding: MidiBinding | null = null
    if (status === 0x90 && value > 0) binding = { kind: 'note', channel, number }
    else if (status === 0xb0) binding = { kind: 'cc', channel, number }
    if (!binding) return

    const st = useStore.getState()

    // Legacy per-knob learn (the CC button on a Meta knob) wins first.
    if (st.midiLearn !== null && binding.kind === 'cc') {
      const idx = st.midiLearn
      st.updateMetaKnob(idx, { midiCc: { channel, number } })
      st.setMidiLearn(null)
      return
    }

    // Global MIDI Learn : bind the selected target, stay in learn mode so
    // the next control can be mapped straight away (dataFLOU behaviour).
    if (st.midiLearnMode && st.midiLearnTarget) {
      const target = st.midiLearnTarget
      // Continuous targets are CC-only — ignore pad hits so the user can
      // keep trying with a knob/fader.
      if (isContinuousTarget(target) && binding.kind !== 'cc') return
      if (target.startsWith('meta:')) {
        st.updateMetaKnob(Number(target.slice(5)), { midiCc: { channel, number } })
      } else {
        st.setMidiBinding(target, binding)
      }
      st.setMidiLearnTarget(null)
      return
    }
    // Learn mode with nothing selected : swallow everything so browsing the
    // controller doesn't fire scenes underneath the overlays.
    if (st.midiLearnMode) return

    // ── Normal routing (ONE-TO-MANY) ────────────────────────────────────
    // The SAME binding may drive several targets at once, so every match is
    // applied — no early return per hit. Meta knobs go through the smoother.
    if (binding.kind === 'cc') {
      const t = value / 127
      let ccHandled = false
      const knobs = st.composition.metaKnobs
      for (let i = 0; i < knobs.length; i++) {
        const cc = knobs[i].midiCc
        if (cc && cc.channel === channel && cc.number === number) {
          setKnobTarget(i, t, knobs[i].smoothMs)
          ccHandled = true
        }
      }
      // Transport continuous controls — each mirrors its slider's mapping.
      const map = st.midiMap
      if (matches(map['transport:bpm'], binding)) {
        useStore.setState((s) => ({ composition: { ...s.composition, bpm: Math.round(40 + t * 200) } }))
        ccHandled = true
      }
      if (matches(map['transport:speed'], binding)) { st.setGlobalSpeed(Math.pow(2, -6 + t * 12)); ccHandled = true }
      if (matches(map['transport:morph'], binding)) { st.setMorphMs(Math.round(Math.pow(t, MORPH_POW) * 30000)); ccHandled = true }
      if (matches(map['transport:prox'], binding)) { st.setProximity(t); ccHandled = true }
      // Field macros / temperament (the "feel" dials — not mod-matrix targets).
      for (const fid in FIELD_SETTERS) {
        if (matches(map[fid], binding)) { FIELD_SETTERS[fid](t); ccHandled = true }
      }
      // Per-layer A↔B crossfade (source mix) + layer opacity.
      for (let i = 0; i < st.composition.layers.length; i++) {
        if (matches(map[`layer:${i}:mix`], binding)) { st.setSourceMix(i, t); ccHandled = true }
        if (matches(map[`layer:${i}:opacity`], binding)) { st.setOpacity(i, t); ccHandled = true }
      }
      if (matches(map['bg:opacity'], binding)) { st.setBackgroundOpacity(t); ccHandled = true }
      // Metasurface cursor (activates the surface; needs ≥2 placed scenes).
      if (matches(map['surface:x'], binding)) {
        st.setSurfaceXY(t, st.surface.y)
        if (!st.surface.active) st.setSurfaceActive(true)
        ccHandled = true
      }
      if (matches(map['surface:y'], binding)) {
        st.setSurfaceXY(st.surface.x, t)
        if (!st.surface.active) st.setSurfaceActive(true)
        ccHandled = true
      }
      if (matches(map['sonify:master'], binding)) { st.setSonify({ ...st.sonify, master: t }); ccHandled = true }
      // A CC used as a continuous control never also fires a trigger bound to
      // the same number.
      if (ccHandled) return
    }

    // Triggers fire on the press edge only : a CC button's release (value 0)
    // or a zero-velocity note-off must not double-fire. Every matching trigger
    // fires — one pad can drive several actions.
    if (value <= 0) return
    const map = st.midiMap
    if (matches(map['fire:vary'], binding)) fireVariation()
    if (matches(map['fire:randomize'], binding)) fireSelectedRandomize()
    if (matches(map['fire:sonify'], binding)) {
      const s = useStore.getState().sonify
      useStore.getState().setSonify({ ...s, on: !s.on })
    }
    if (matches(map['fire:flush'], binding)) firePanic()
    if (matches(map['fire:freeze'], binding)) fireFreeze()
    if (matches(map['fire:record'], binding)) fireRecordToggle()
    if (matches(map['fire:tap'], binding)) tapTempo()
    if (matches(map['fire:seq'], binding)) st.toggleSequenceRunning()
    if (matches(map['fire:soniseq'], binding)) st.setSoniSeqOn(!useStore.getState().soniSeq.on)
    if (matches(map['scene:next'], binding)) recallRelativeScene(1)
    if (matches(map['scene:prev'], binding)) recallRelativeScene(-1)
    for (let i = 0; i < SONI_VOICE_KEYS.length; i++) {
      if (matches(map[`sonify:voice:${i}`], binding)) toggleSoniVoice(i)
    }
    for (let i = 0; i < st.scenes.length; i++) {
      if (matches(map[`scene:${i}`], binding)) st.recallScene(st.scenes[i].id)
    }
  }
}

function matches(a: MidiBinding | undefined, b: MidiBinding): boolean {
  if (!a) return false
  return a.kind === b.kind && a.channel === b.channel && a.number === b.number
}

export const midi = new MidiManager()

let started = false

/** Idempotent app-start hook (App.tsx). */
export function initMidi(): void {
  if (started) return
  started = true
  void midi.init()
}
