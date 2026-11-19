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
//   scenes, Vary, Randomize and the Sonify toggle on the press edge only. The
//   pitch bend (14-bit, its middle 0.5), channel and poly aftertouch play
//   continuous targets as faders (v1.3.5). Each fader mapping jumps (as
//   always) or picks up (midiPickup.ts : waits to reach the value, then follows).
// - CLOCK IN : with "follow clock" on, the clock on the input (24 a beat) sets
//   the BPM and its Start / Continue / Stop play the Seq transport
//   (midiClockIn.ts; Ableton Link with peers wins). Realtime messages are
//   one byte : they never reached here before v1.3.5.
//
// Meta-knob CC bindings live in the session (composition.metaKnobs[i].midiCc);
// everything else is in store.midiMap, keyed by the target ids below : this
// computer's (localStorage), or the session's own (store.sessionMidiMap, its
// file) when Learn into says this session. On an input the session uses, its
// mappings silence this computer's (midiTargetsFor). OSC Learn plays the same
// targets from OSC messages outside /opsia (oscLearn.ts) : the setters below
// (applyContinuous, fireTrigger) are shared.

import type { FxScope, MidiBinding } from '@shared/types'
import { controlBus, controlKeyOf } from './engine/controlBus'
import { BG_SPEED_MAX } from '@shared/types'
import {
  fireSelectedRandomize, fireVariation, firePanic, fireFreeze, fireRecordToggle,
  fireInspectorRandomize, fireNewSession, fireLoadSession, fireOpenSession
} from './commands'
import { knobTargetValue, setKnobTarget, shuffleMetaValues } from './metaSmooth'
import { liveModValues, metaLiveValues, sonifyModValues } from './engine/modulation'
import { describeMidi, isFaderKind, sameMidiInput } from './mappingModel'
import { randomSonify } from './audio/autoSonify'
import { undo, redo, writeLinkTempo } from './undo'
import { fxArrayFor, useStore } from './store'
import { tempoEdited } from './tempoEvents'
import { linkBeats, linkPlay, linkQuantum, linkShared } from './link'
import { ClockFollower } from './midiClockIn'
import { pickupInputKey, pickupPass, pickupRecheck, pickupTrackedIds, pickupTracks, pickupWaiting, pickupWritten } from './midiPickup'
import { setTempoFollowed } from './sessionGuard'
import { modEngine } from './engine/modulation'
import { sonifyParamOf, withSonifyParam, type SoniConfig } from './audio/sonify'
import { SYNTH_PARAM_LABEL } from './audio/synthPlay'
import { SIGNAL_PARAM_LABEL } from './audio/signalPlay'
import { SONIFY_MOD_DESCS } from './engine/modulation'
import { actionLabel, fireAction } from './actions'
import { seqTransportPlay, seqTransportPlaying, seqTransportStop, seqTransportToggle } from './engine/ruleSeq'

const SONI_VOICE_KEYS = ['spectra', 'orbit', 'flow', 'events', 'raster', 'sstv', 'filter', 'chord', 'collage', 'signal', 'assemblage', 'synth'] as const
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
  'field:superFlicker': (v) => useStore.getState().setSuperFlicker(v),
  // the World amount (the Transport and the World page)
  'field:worldAmount': (v) => useStore.getState().setWorldAmount(v),
  // the Lights page's console
  'lights:master': (v) => useStore.getState().setLightsMaster({ brightness: v }),
  'lights:speed': (v) => useStore.getState().setLightsMaster({ speed: v * 4 }),
  'lights:gain': (v) => useStore.getState().setLightsMaster({ gain: v * 2 }),
  'lights:sat': (v) => useStore.getState().setLightsMaster({ saturation: v * 2 }),
  'lights:contrast': (v) => useStore.getState().setLightsMaster({ contrast: v * 2 }),
  'lights:fade': (v) => useStore.getState().setLightsMaster({ fadeSec: v * 20 }),
  'lights:blacksec': (v) => useStore.getState().setLightsMaster({ blackSec: v * 20 })
}
const FIELD_LABELS: Record<string, string> = {
  'field:density': 'DENSITY', 'field:gestureTexture': 'GESTURE↔TEXTURE', 'field:coalesce': 'COALESCE',
  'field:tonicity': 'TONICITY', 'field:drift': 'WANDER', 'field:flow': 'INTERRUPTION↔FLOW',
  'field:shutter': 'SHUTTER', 'field:superFlicker': 'SUPERIMPOSE', 'field:worldAmount': 'WORLD amount',
  'lights:master': 'LIGHTS master', 'lights:speed': 'LIGHTS speed', 'lights:gain': 'LIGHTS brightness', 'lights:sat': 'LIGHTS saturation', 'lights:contrast': 'LIGHTS contrast', 'lights:fade': 'LIGHTS scene fade', 'lights:blacksec': 'LIGHTS black time'
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
  tempoEdited(bpm)
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

// The discrete performance actions, as a shared vocabulary. A MIDI pad, a
// keyboard key AND a body gesture all route through the SAME ids, so adding one
// action here makes it available to all three at once (this is how you "create a
// new gesture action" : add a case, list its id below, and it appears in the
// Body page's per-gesture dropdown, labelled by midiTargetLabel). scene:<i> and
// sonify:voice:<i> are handled dynamically by index. The larger vocabulary that
// plays the layers, triggers, Worlds, Generate, Meta, modulators, Feel, tempo,
// key, Audio Layer and output lives in ./actions.ts (ids act:...), handed over
// below; ./triggerCatalog.ts lists them all for the pickers.
export const TRIGGER_ACTION_IDS: string[] = [
  'fire:randomize', 'fire:vary', 'fire:flush', 'fire:black', 'fire:lightsblack', 'fire:lightsgo', 'fire:lightsback', 'fire:lightscues', 'fire:freeze', 'fire:record',
  'fire:sonify', 'fire:tap', 'fire:seq', 'fire:soniseq', 'fire:keyseq', 'fire:transport', 'fire:ruleseq', 'fire:undo', 'fire:redo',
  'scene:next', 'scene:prev'
]

/** Persisted Randomize intensity (shared with the Transport's dice). */
export function randIntensity(): number {
  return useStore.getState().randIntensity
}

// ── Effect chains on / off ───────────────────────────────────────────────
// fx:chain:<layer|sourceA|sourceB|loop>:<i> : a layer rack's ⏻ (every effect
// off, or all back on), as its button. The Master FX chain keeps its older id
// master:chain, the finishing switch act:finishing (actions.ts).
const CHAIN_RE = /^fx:chain:(layer|sourceA|sourceB|loop):(\d+)$/
const CHAIN_WORD = { layer: 'FX', sourceA: 'source A FX', sourceB: 'source B FX', loop: 'loop FX' } as const

/** The rack a chain id names (null when it is not one). */
export function chainScopeOf(id: string): FxScope | null {
  const m = CHAIN_RE.exec(id)
  return m ? { kind: m[1] as keyof typeof CHAIN_WORD, layer: Number(m[2]) } : null
}

/** A chain's state as its button shows it : on while every effect in it is on
 *  (null : no such rack, or nothing in it). */
function chainOn(scope: FxScope): boolean | null {
  const fx = fxArrayFor(useStore.getState().composition, scope).filter((f) => !f.locked)
  return fx.length ? fx.every((f) => f.enabled) : null
}

/** Execute a discrete trigger action by id. The one place each action lives, so
 *  MIDI, the keyboard and gestures can never drift apart. */
export function fireTrigger(id: string): void {
  const st = useStore.getState()
  switch (id) {
    case 'fire:vary': fireVariation(); return
    case 'fire:randomize': fireSelectedRandomize(); return
    case 'fire:sonify': st.setSonify({ ...st.sonify, on: !st.sonify.on }); return
    case 'fire:flush': firePanic(); return
    case 'fire:black': st.setBlack('toggle'); return
    case 'fire:lightsblack': st.setLightsBlack(!st.lightsBlack); return
    case 'fire:lightsgo': st.goLightCue(1); return
    case 'fire:lightsback': st.goLightCue(-1); return
    case 'fire:lightscues': st.setLightCueRun(!st.lightCueRun); return
    case 'fire:freeze': fireFreeze(); return
    case 'fire:record': fireRecordToggle(); return
    case 'fire:tap': tapTempo(); return
    case 'fire:seq': st.toggleSequenceRunning(); return
    case 'fire:soniseq': st.setSoniSeqOn(!st.soniSeq.on); return
    case 'fire:keyseq': st.setSoniKeySeqOn(!st.soniKeySeq.on); return
    case 'fire:transport': seqTransportToggle(); return
    case 'fire:ruleseq': st.setRuleSeqOn(!st.ruleSeqOn); return
    case 'fire:undo': undo(); return
    case 'fire:redo': redo(); return
    case 'scene:next': recallRelativeScene(1); return
    case 'scene:prev': recallRelativeScene(-1); return
    // Randomize dice (each little ⚄ / ⚄-style button in the UI is learnable) :
    case 'rand:bg': st.randomizeBg(); return
    case 'rand:master': st.randomizeMasterParams(); return
    case 'rand:meta': shuffleMetaValues(); return
    case 'rand:inspector': fireInspectorRandomize(); return // the selected unit
    // Randomize by SCOPE (the Transport's modes, as direct targets) :
    case 'rand:all': st.randomize('all', randIntensity()); return
    case 'rand:sources': st.randomize('sources', randIntensity()); return
    case 'rand:sourcefx': st.randomize('sourcefxonly', randIntensity()); return
    case 'rand:layerfx': st.randomize('layerfxonly', randIntensity()); return
    case 'rand:mods': st.randomize('modulators', randIntensity()); return
    case 'rand:finishing': st.randomize('finishing', randIntensity()); return
    case 'rand:sonify': st.setSonify(randomSonify(st.sonify)); return
    case 'rand:resolume': st.resoRandomize(); return
    case 'master:chain': st.toggleMasterChain(); return // the master FX on/off
    case 'session:new': fireNewSession(); return
    case 'session:load': fireLoadSession(); return // load the selected saved session
    case 'session:open': fireOpenSession(); return // the Open… file dialog
  }
  const chain = chainScopeOf(id)
  if (chain) {
    if (chainOn(chain) !== null) st.toggleRackChain(chain)
    return
  }
  if (id.startsWith('rand:layer:')) {
    const i = Number(id.slice(11))
    if (Number.isFinite(i)) st.randomizeLayer(i)
  } else if (id.startsWith('scene:')) {
    const i = Number(id.slice(6))
    if (Number.isFinite(i) && st.scenes[i]) st.recallScene(st.scenes[i].id)
  } else if (id.startsWith('sonify:voice:')) {
    const i = Number(id.slice(13))
    if (Number.isFinite(i)) toggleSoniVoice(i)
  } else if (id.startsWith('act:')) {
    fireAction(id)
  }
}

export interface MidiDevice {
  id: string
  name: string
}

// ── Learnable targets ────────────────────────────────────────────────────
// meta:<i>          Macro knob i (CC only, stored on the knob itself; the id keeps its old name)
// scene:<i>         scene slot i (0-based; note or button-CC recalls it)
// scene:next/prev   note/CC press → step the scene bank (wraps)
// transport:bpm     CC → 40..240 BPM
// transport:speed   CC → global speed 1/64×..64× (log, like the slider)
// transport:morph   CC → morph time (same power curve as the slider)
// transport:prox    CC → proximity 0..1
// transport:varyAmount  CC → the Vary amount 1..100 % (the slider beside Vary)
// transport:randAmount  CC → the Randomize amount 2..100 % (AMT, beside Randomize)
// audiolayer:volume CC → the Audio Layer's volume 0..200 %
// audiolayer:mix    CC → the Audio Layer's A↔B mix
// master:chain      note/CC press → the Master FX chain on/off
// fx:chain:<rack>:<i>  note/CC press → a layer rack's ⏻ (layer, sourceA,
//                   sourceB, loop; i 0-based) : all its effects off, or all on
// act:finishing     note/CC press → the finishing switch (actions.ts)
// field:<macro>     CC → a feel dial (density/gestureTexture/coalesce/tonicity/
//                   drift/flow/shutter/superFlicker) — NOT mod-matrix targets,
//                   so MIDI is the only hardware route to them
// layer:<i>:mix     CC → layer i's A↔B source crossfade (0..1)
// layer:<i>:harmony CC → layer i's A·B hue (match ↔ clash)
// surface:x / :y    CC → the Metasurface cursor axis (drives scene-morphing;
//                   activates the surface; needs >=2 placed scenes)
// sonify:master     CC → Sonify master gain
// sonify:param:<p>  CC → a Sonify parameter over its modulation span (the Synth's and Signal's knobs)
// sonify:voice:<i>  note/CC press → toggle Sonify voice i on/off (0..8)
// fire:vary         note/CC press → Variation at the current spread
// fire:randomize    note/CC press → the selected Randomize
// fire:sonify       note/CC press → Sonify on/off
// fire:flush        note/CC press → panic flush (empty self-feeding buffers)
// fire:black        note/CC press → Black : the whole show to black over the Morph time, again back
// fire:freeze       note/CC press → toggle the global freeze / hold latch
// fire:record       note/CC press → start (fast take) / stop recording
// fire:tap          note/CC press → tap tempo
// fire:seq          note/CC press → toggle the scene sequencer
// fire:soniseq      note/CC press → toggle the Sonify step sequencer
// fire:keyseq       note/CC press → toggle the Sonify key sequencer
// rule:<id>         a Body rule's box (by its id, never its place) : a note
//                   turns it on or off, a CC sets it (64 and up on, below off)
// fire:transport    note/CC press → the Seq transport : play its lanes / stop them all
// fire:ruleseq      note/CC press → toggle the Body rule timeline
// mod:in:<i>        CC / a note → modulator slot i's controller input (the
//                   Controller type) : a CC its value, a note its envelope
// mod:take:<i>      the same, as a takeover of slot i (any other type)

/** Continuous targets take knobs/faders only : notes are ignored while one
 *  of these is the armed learn target (keep twisting until it takes). */
export function isContinuousTarget(id: string): boolean {
  return (
    id.startsWith('meta:') ||
    id.startsWith('transport:') ||
    id.startsWith('field:') ||
    id.startsWith('lights:') ||
    id === 'surface:x' ||
    id === 'surface:y' ||
    id === 'sonify:master' ||
    id.startsWith('sonify:param:') ||
    id === 'bg:opacity' ||
    id === 'bg:speed' ||
    id === 'bg:depth' ||
    id === 'audiolayer:volume' ||
    id === 'audiolayer:mix' ||
    /^layer:\d+:(mix|harmony|opacity)$/.test(id) ||
    controlKeyOf(id) !== null
  )
}

/** Human name for a target id (bindings list + overlay tooltips). */
export function midiTargetLabel(id: string): string {
  if (id.startsWith('meta:')) {
    const i = Number(id.slice(5))
    const name = useStore.getState().composition.metaKnobs[i]?.name
    return `MACRO ${i + 1}${name ? ` · ${name}` : ''}`
  }
  if (id.startsWith('rule:')) {
    const r = useStore.getState().bodyControl.rules.find((x) => x.id === id.slice(5))
    return r ? `RULE ${r.name} : on/off` : 'RULE (gone)'
  }
  const mi = /^mod:(in|take):([0-7])$/.exec(id)
  if (mi) return `M${Number(mi[2]) + 1} ${mi[1] === 'in' ? 'CONTROLLER input' : 'TAKEOVER'}`
  if (id === 'scene:next') return 'SCENE next'
  if (id === 'scene:prev') return 'SCENE prev'
  if (id.startsWith('scene:')) return `SCENE ${Number(id.slice(6)) + 1}`
  if (id in FIELD_LABELS) return FIELD_LABELS[id]
  if (id.startsWith('lights:group:')) {
    const g = useStore.getState().lightRig.groups.find((x) => x.id === id.slice(13))
    return `LIGHTS ${g ? g.name : 'group'} fader`
  }
  if (id === 'bg:opacity') return 'BACKGROUND opacity'
  if (id === 'bg:speed') return 'BACKGROUND speed'
  if (id === 'bg:depth') return 'BACKGROUND shadow'
  if (id === 'audiolayer:volume') return 'AUDIO LAYER volume'
  if (id === 'audiolayer:mix') return 'AUDIO LAYER A↔B'
  const ch = CHAIN_RE.exec(id)
  if (ch) return `LAYER ${Number(ch[2]) + 1} ${CHAIN_WORD[ch[1] as keyof typeof CHAIN_WORD]} on/off`
  const lm = /^layer:(\d+):(mix|harmony|opacity)$/.exec(id)
  if (lm) return `LAYER ${Number(lm[1]) + 1} ${lm[2] === 'mix' ? 'A↔B' : lm[2] === 'harmony' ? 'A·B hue' : 'opacity'}`
  if (id.startsWith('sonify:param:')) {
    const p = id.slice(13)
    return `SONIFY ${SYNTH_PARAM_LABEL[p] ?? SIGNAL_PARAM_LABEL[p] ?? p}`
  }
  const sv = /^sonify:voice:(\d+)$/.exec(id)
  if (sv) {
    const k = SONI_VOICE_KEYS[Number(sv[1])]
    return `SONIFY ${k === 'sstv' ? 'transmission' : k ?? sv[1]} on/off`
  }
  const rl = /^rand:layer:(\d+)$/.exec(id)
  if (rl) return `RANDOMIZE layer ${Number(rl[1]) + 1}`
  switch (id) {
    case 'rand:bg':
      return 'RANDOMIZE background'
    case 'rand:master':
      return 'RANDOMIZE master FX'
    case 'rand:meta':
      return 'RANDOMIZE Macro knobs'
    case 'rand:inspector':
      return 'RANDOMIZE inspector'
    case 'rand:all':
      return 'RANDOMIZE everything'
    case 'rand:sources':
      return 'RANDOMIZE sources'
    case 'rand:sourcefx':
      return 'RANDOMIZE source FX'
    case 'rand:layerfx':
      return 'RANDOMIZE layer FX'
    case 'rand:mods':
      return 'RANDOMIZE modulators'
    case 'rand:finishing':
      return 'RANDOMIZE finishing'
    case 'rand:sonify':
      return 'RANDOMIZE Sonify patch'
    case 'rand:resolume':
      return 'RANDOMIZE Resolume pins'
    case 'master:chain':
      return 'MASTER FX on/off'
    case 'session:new':
      return 'NEW session'
    case 'session:load':
      return 'LOAD session'
    case 'session:open':
      return 'OPEN session…'
  }
  switch (id) {
    case 'transport:bpm':
      return 'BPM'
    case 'transport:speed':
      return 'SPEED'
    case 'transport:morph':
      return 'MORPH'
    case 'transport:prox':
      return 'PROXIMITY'
    case 'transport:varyAmount':
      return 'VARY amount'
    case 'transport:randAmount':
      return 'RANDOMIZE amount'
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
    case 'fire:black':
      return 'BLACK on/off'
    case 'fire:lightsblack':
      return 'LIGHTS black on/off'
    case 'fire:lightsgo':
      return 'LIGHTS cue GO'
    case 'fire:lightsback':
      return 'LIGHTS cue back'
    case 'fire:lightscues':
      return 'LIGHTS cues follow on/off'
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
    case 'fire:keyseq':
      return 'KEY seq run'
    case 'fire:transport':
      return 'SEQ transport'
    case 'fire:ruleseq':
      return 'RULE timeline run'
    case 'fire:undo':
      return 'UNDO'
    case 'fire:redo':
      return 'REDO'
    default:
      return id.startsWith('act:') ? actionLabel(id) : id
  }
}

/** 'CC21 ch1' / 'NOTE 36 ch10' / 'bend ch1' / 'AT ch1' : one shape everywhere a binding is shown. */
export function describeBinding(b: MidiBinding): string {
  return describeMidi(b)
}

/** The pitch bend's 14 bits as 0..1, its middle (8192) at exactly 0.5. */
export function bendNorm(lsb: number, msb: number): number {
  const v = ((msb & 0x7f) << 7) | (lsb & 0x7f)
  return v <= 8192 ? v / 16384 : 0.5 + (v - 8192) / 16382
}

// Morph slider's power curve (Transport.tsx) : CC value → ms over 0..30s.
const MORPH_POW = 2.5

// With Ableton Link's start / stop sync, a play heard this many beats after
// its bar still starts the follower there (caught up); later, on the next bar.
const LATE = 0.25

class MidiManager {
  private access: MIDIAccess | null = null
  private listeners = new Set<(devs: MidiDevice[]) => void>()
  // Diagnostics : the last raw message seen + the count of inputs currently
  // wired. The MIDI panel shows these so a plugged-in-but-silent controller is
  // instantly visible (message arriving vs not; input actually attached).
  // The last message is kept as its bytes and written out only when the panel
  // reads it (150 ms) : a fader, the bend or aftertouch streaming hundreds a
  // second build no string each. The clock's pulses and active sensing never
  // land here (24 a beat : they have their own line, clockStatus).
  private last = new Uint8Array(3)
  private lastLen = 0
  private lastNote = '' // a rare system message, written out (Start, SysEx …)
  get lastMsg(): string {
    if (this.lastNote) return this.lastNote
    if (!this.lastLen) return ''
    return describeChannelMsg(this.last[0], this.last[1], this.last[2], this.lastLen)
  }
  wiredCount = 0
  // ── MIDI clock IN (follow MIDI clock, midiClockIn.ts) ─────────────────
  private clock = new ClockFollower()
  // the port the clock comes from (the first heard : a second clock on another
  // port is left alone while the first one runs)
  private clockSrc = ''
  // why the clock is not followed now ('' : it is)
  private clockWhy: '' | 'link' | 'own' = ''
  // MIDI clock scheduler state (output side).
  private clockTimer: number | null = null
  private nextPulse = 0
  // With Ableton Link : the next pulse to send, counted on Link's beat (24 a
  // beat), and the pulse the Start waits for (the top of the next Link bar).
  private linkPulse: number | null = null
  private startPulse: number | null = null
  // Link's beat line at the last schedule : a jump in its count shows against it
  private linkPrev: { b: number; at: number; perMs: number } | null = null
  // With start / stop sync : the Start waits for the bar Link's play starts on
  // (read anew each time, the count can move); and the follower was started
  // (Start sent, no Stop since).
  private startOnPlay = false
  private following = false

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

  /** The output ports the OS exposes (e.g. an Ableton Move over USB). */
  listOutputs(): MidiDevice[] {
    const out: MidiDevice[] = []
    this.access?.outputs.forEach((o) => out.push({ id: o.id, name: o.name ?? o.id }))
    return out
  }

  /** The selected output port (by name), or null. */
  private output(): MIDIOutput | null {
    const wanted = useStore.getState().midiOutputName
    if (!this.access || !wanted) return null
    let found: MIDIOutput | null = null
    this.access.outputs.forEach((o) => { if ((o.name ?? o.id) === wanted) found = o })
    return found
  }

  // ── MIDI OUTPUT : clock / transport + passthrough ─────────────────────
  // Start/stop + reschedule the clock to match the current output + clock toggle.
  // Called from App whenever midiOutputName or midiClockOut change.
  applyOutputConfig(): void {
    const st = useStore.getState()
    const wantClock = st.midiClockOut && !!this.output()
    if (wantClock && this.clockTimer == null) this.startClock()
    else if (!wantClock && this.clockTimer != null) this.stopClock()
    else if (wantClock) { this.stopClock(); this.startClock() } // device changed while running
  }

  /** Send MIDI Start + a 24-PPQN clock at the app BPM. Uses Web MIDI timestamped
   *  sends with a look-ahead so the tempo stays tight despite JS timer jitter.
   *  With Ableton Link enabled the pulses fall on Link's beat (as it sounds) and
   *  the Start waits for the top of the next Link bar, so the follower's bars
   *  land where every linked app's do. */
  private startClock(): void {
    const out = this.output()
    if (!out) return
    const now = performance.now()
    const lb = linkBeats(now, false)
    const play = linkPlay()
    this.startPulse = null
    this.startOnPlay = false
    this.following = false
    if (play) {
      // start / stop sync : the clock runs, the Start waits for Link's play
      // (playing : its bar if still to come, else the next one)
      this.startOnPlay = play.playing
    } else if (lb != null) {
      const q = linkQuantum()
      this.startPulse = Math.ceil(lb / q - 1e-6) * q * 24
    } else {
      try { out.send([0xfa]) } catch { /* port busy */ } // Start
      this.following = true
    }
    this.nextPulse = now
    this.linkPulse = null
    this.linkPrev = null
    const LOOKAHEAD = 120, TICK = 25
    const schedule = (): void => {
      const cur = performance.now()
      const o = this.output()
      if (!o) return
      const b0 = linkBeats(cur, false)
      if (b0 != null) {
        // On Link's grid : pulse k falls on beat k/24, stamped from Link's beat
        // line (its tempo is the slope).
        const perMs = ((linkBeats(cur + 1000, false) ?? b0) - b0) / 1000
        if (!(perMs > 0)) return
        // Link's count jumped (a linked app put beat 0 on the bar its play
        // starts on; alone, Palinopsia's own play put it on now) : the pulses
        // keep their times, numbered anew
        const lp = this.linkPrev
        if (lp && cur - lp.at < 1000) {
          const jump = b0 - (lp.b + (cur - lp.at) * lp.perMs)
          if (Math.abs(jump) > 0.25) {
            const d = Math.round(jump * 24)
            if (this.linkPulse != null) this.linkPulse += d
            if (this.startPulse != null) this.startPulse += d
          }
        }
        this.linkPrev = { b: b0, at: cur, perMs }
        const play = linkPlay()
        if (play && !play.playing && (this.following || this.startPulse != null || this.startOnPlay)) {
          // Link stopped : the follower stops now (the clock runs on, its tempo kept)
          if (this.following) try { o.send([0xfc]) } catch { /* port gone */ } // Stop
          this.following = false
          this.startPulse = null
          this.startOnPlay = false
        } else if (play?.playing && !this.following && this.startPulse == null && !this.startOnPlay) {
          this.startOnPlay = true // Link plays : Start on its bar
        }
        if (this.startOnPlay) {
          if (play?.playing && play.at >= b0 - LATE) this.startPulse = Math.round(play.at * 24)
          else {
            // its bar long gone (start / stop sync turned on, the clock turned
            // on while it plays) : the next bar
            const q = linkQuantum()
            this.startPulse = Math.ceil(b0 / q - 1e-6) * q * 24
            this.startOnPlay = false
          }
        }
        const due = Math.floor(b0 * 24) + 1
        let k = this.linkPulse
        // the first pulse, a stall of more than half a second, or Link's beat
        // re-counted (a new bar size) : on from the next pulse due. A shorter
        // stall sends what it missed, as the free clock does.
        if (k == null || (due - k) / 24 / perMs > 500 || (k - due) / 24 / perMs > LOOKAHEAD + 250) k = due
        for (;;) {
          const t = cur + (k / 24 - b0) / perMs
          if (t >= cur + LOOKAHEAD) break
          const at = Math.max(cur, t)
          if (this.startPulse != null && k >= this.startPulse) {
            try { o.send([0xfa], at) } catch { /* port gone */ } // Start, on the top of the bar
            // a play heard a moment after its bar : the pulses since it, at once,
            // so the follower's bars still fall on Link's
            for (let i = this.startPulse; i < k; i++) try { o.send([0xf8], at) } catch { /* port gone */ }
            this.startPulse = null
            this.startOnPlay = false
            this.following = true
          }
          try { o.send([0xf8], at) } catch { /* port gone */ }
          k++
        }
        this.linkPulse = k
        // where the free clock carries on if Link is turned off
        this.nextPulse = cur + (k / 24 - b0) / perMs
        return
      }
      this.linkPulse = null
      this.linkPrev = null
      if (this.startPulse != null || this.startOnPlay) {
        // Link turned off before its bar came : start now
        try { o.send([0xfa]) } catch { /* port gone */ }
        this.startPulse = null
        this.startOnPlay = false
        this.following = true
      }
      const bpm = useStore.getState().composition.bpm || 120
      const interval = 60000 / (bpm * 24)
      // Never let a stall dump a burst : if we've fallen far behind, resync.
      if (this.nextPulse < cur - 500) this.nextPulse = cur
      while (this.nextPulse < cur + LOOKAHEAD) {
        try { o.send([0xf8], this.nextPulse) } catch { /* port gone */ }
        this.nextPulse += interval
      }
    }
    schedule()
    this.clockTimer = window.setInterval(schedule, TICK)
  }

  private stopClock(): void {
    if (this.clockTimer != null) { clearInterval(this.clockTimer); this.clockTimer = null }
    try { this.output()?.send([0xfc]) } catch { /* port gone */ } // Stop
    this.startPulse = null
    this.startOnPlay = false
    this.following = false
  }

  /** Re-align the follower's downbeat to now (Stop then Start); with Ableton
   *  Link, to the top of the next Link bar. */
  resyncClock(): void {
    if (this.clockTimer == null) return
    this.stopClock()
    this.startClock()
  }

  /** Stop the clock (sends Stop) without touching config : app teardown. */
  haltClock(): void { this.stopClock() }
  clockRunning(): boolean { return this.clockTimer != null }
  /** The follower was sent Start (with start / stop sync, the clock runs on
   *  while Link is stopped, the follower stopped). */
  clockFollowing(): boolean { return this.clockTimer != null && this.following }

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
    if (wanted && !matched) console.warn(`[midi] input "${wanted}" not found : listening to all inputs instead`)
  }

  subscribe(cb: (devs: MidiDevice[]) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private notify(): void {
    const devs = this.listDevices()
    this.listeners.forEach((l) => l(devs))
  }

  // ── System messages : the clock IN, its transport, the rest ────────────
  private onSystem(e: MIDIMessageEvent, data: Uint8Array): void {
    const s0 = data[0]
    const st = useStore.getState()
    const src = (e.target as MIDIInput | null)?.name ?? ''
    // the clock and its transport (Song Position, Start, Continue, Stop)
    const transport = s0 === 0xf8 || s0 === 0xfa || s0 === 0xfb || s0 === 0xfc || s0 === 0xf2
    // MIDI thru : the clock and transport go through too (Opsia as a router),
    // never back to their own port, and not while Palinopsia's own clock goes
    // to that output (one clock per output : two would run the device at twice
    // the tempo). SysEx stays home (this app never asks for SysEx access).
    if (st.midiThru && s0 !== 0xf0 && s0 !== 0xf7 && s0 !== 0xfe) {
      const out = this.output()
      if (out && src !== out.name && !(transport && this.clockTimer != null)) {
        try { out.send(data) } catch { /* port gone */ }
      }
    }
    if (s0 === 0xf8) {
      this.clockPulse(e, src, st)
      return
    }
    if (s0 === 0xfe) return // active sensing : three a second, nothing to show
    this.lastNote =
      s0 === 0xf0 ? `SysEx ${data.length} bytes (ignored)`
      : s0 === 0xfa ? 'clock Start'
      : s0 === 0xfb ? 'clock Continue'
      : s0 === 0xfc ? 'clock Stop'
      : s0 === 0xf2 ? `song position ${(data[1] ?? 0) | ((data[2] ?? 0) << 7)}`
      : s0 === 0xf1 ? 'time code'
      : s0 === 0xf3 ? `song select ${data[1] ?? 0}`
      : s0 === 0xff ? 'reset'
      : '0x' + s0.toString(16)
    if (transport) this.clockTransport(s0, data, src, st)
  }

  /** Why the clock IN is not followed now ('' : it is). Ableton Link with
   *  other apps linked wins : their tempo is the session's. And a clock coming
   *  back on the port Palinopsia's own clock goes out to is its own clock,
   *  looped (a device echoing it, a loopback port) : following it would feed
   *  the tempo back into itself. */
  private clockIgnored(src: string): '' | 'link' | 'own' {
    if (linkShared()) return 'link'
    if (this.clockTimer != null) {
      const out = this.output()
      if (out && (out.name ?? out.id) === src) return 'own'
    }
    return ''
  }

  /** A pulse from the port the clock is followed on (else ignored). */
  private clockFrom(src: string, now: number): boolean {
    if (this.clockSrc === src) return true
    // a second clock while the first runs : left alone
    if (this.clockSrc && this.clock.alive(now)) return false
    this.clock.reset()
    this.clockSrc = src
    return true
  }

  private clockPulse(e: MIDIMessageEvent, src: string, st: ReturnType<typeof useStore.getState>): void {
    if (!st.midiClockIn) return
    const now = performance.now()
    if (!this.clockFrom(src, now)) return
    // the time the message came in (the browser's stamp, on performance.now()'s
    // clock : a busy main thread does not shift it); else now
    const ts = e.timeStamp
    const t = ts > 0 && ts <= now + 50 ? ts : now
    this.clock.pulse(t)
    this.clockWhy = this.clockIgnored(src)
    if (this.clockWhy) return
    const cur = st.composition.bpm
    const bpm = this.clock.bpmToWrite(now, cur)
    // the BPM box's range; no undo step and no Save changes? (as Link's tempo)
    if (bpm != null) writeLinkTempo(Math.max(20, Math.min(800, bpm)))
  }

  private clockTransport(s0: number, data: Uint8Array, src: string, st: ReturnType<typeof useStore.getState>): void {
    if (!st.midiClockIn) return
    const now = performance.now()
    if (!this.clockFrom(src, now)) return
    this.clockWhy = this.clockIgnored(src)
    if (this.clockWhy) return
    if (s0 === 0xf2) {
      this.clock.songPosition((data[1] ?? 0) | ((data[2] ?? 0) << 7))
      return
    }
    // The Seq transport, as its play and stop (the fire:transport pad's) : Start
    // plays from the top (bar 1 on the first pulse), Continue goes on, Stop stops
    // every lane. With Ableton Link's start / stop sync (Link alone), the play
    // reaches Link as any play here does.
    if (s0 === 0xfa) {
      this.clock.start()
      // BPM-synced steps cards start their run on the downbeat (as Link's play)
      if (linkBeats(now) == null) modEngine.restartRunsAt(0)
      if (seqTransportPlaying()) seqTransportStop()
      seqTransportPlay()
      this.followerTransport('start')
    } else if (s0 === 0xfb) {
      this.clock.resume()
      if (!seqTransportPlaying()) seqTransportPlay()
      this.followerTransport('continue')
    } else if (s0 === 0xfc) {
      this.clock.stop()
      seqTransportStop()
      this.followerTransport('stop')
    }
  }

  /** The device Palinopsia's own clock drives follows the transport heard
   *  (a drum machine → Palinopsia → the Move) : Start re-aligns it on the
   *  downbeat, Continue and Stop pass on. Not with Ableton Link : its bars
   *  start and stop it (startClock). */
  private followerTransport(what: 'start' | 'continue' | 'stop'): void {
    if (this.clockTimer == null || linkBeats(performance.now(), false) != null) return
    const o = this.output()
    if (!o) return
    if (what === 'start') {
      this.resyncClock()
      return
    }
    try { o.send([what === 'stop' ? 0xfc : 0xfb]) } catch { /* port gone */ }
    this.following = what !== 'stop'
  }

  /** The beat the followed clock is on (from its Start), for the modulators
   *  and the sequencers to lock to while Ableton Link is off; null while it is
   *  not followed or not started. */
  clockBeats(now: number): number | null {
    if (!useStore.getState().midiClockIn || this.clockWhy || !this.clock.alive(now)) return null
    return this.clock.beats(now)
  }

  /** The BPM follows a MIDI clock now. */
  clockInFollowing(): boolean {
    const now = performance.now()
    return useStore.getState().midiClockIn && !this.clockWhy && this.clock.alive(now) && this.clock.bpm > 0
  }

  /** What the MIDI panel shows of the clock IN. */
  clockStatus(): { on: boolean; heard: boolean; bpm: number; why: '' | 'link' | 'own'; playing: boolean; src: string } {
    const now = performance.now()
    const heard = this.clock.alive(now)
    return {
      on: useStore.getState().midiClockIn,
      heard,
      bpm: heard ? this.clock.bpm : 0,
      why: heard ? this.clockWhy : '',
      playing: heard && this.clock.running,
      src: this.clockSrc
    }
  }

  /** Forget the clock heard (follow turned off or on again). */
  resetClockIn(): void {
    this.clock.reset()
    this.clockSrc = ''
    this.clockWhy = ''
  }

  private onMessage(e: MIDIMessageEvent): void {
    const data = e.data
    if (!data || data.length < 1) return
    // System messages (0xF0 and up) : the clock and its transport, SysEx, the
    // rest. One byte for most : they never reached here before (v1.3.5).
    if (data[0] >= 0xf0) {
      this.onSystem(e, data)
      return
    }
    if (data.length < 2) return // a lone data byte (the browser undoes running status)
    const status = data[0] & 0xf0
    const channel = data[0] & 0x0f
    const number = data[1]
    const value = data[2] ?? 0

    // Activity readout : record EVERY message (even ones we don't route, like
    // a program change) so the panel shows a controller is alive. Set before any
    // return; written out only when the panel reads it.
    this.last[0] = data[0]
    this.last[1] = number
    this.last[2] = value
    this.lastLen = data.length
    this.lastNote = ''

    // MIDI thru : forward this message to the output (Opsia as a router in the
    // middle), so e.g. a Launch Control XL reaches the Move through Opsia. Guard
    // against a loop : never echo a message back to the port it came from.
    if (useStore.getState().midiThru) {
      const out = this.output()
      const srcName = (e.target as MIDIInput | null)?.name ?? ''
      if (out && srcName !== out.name) { try { out.send(data) } catch { /* port gone */ } }
    }

    // A binding candidate from any CC or Note-On, and (as faders) the pitch
    // bend, the channel pressure and a key's pressure. CC value 0 still counts
    // (a knob turned fully down must keep driving its target). `t` : the value
    // a fader plays, 0..1.
    let binding: MidiBinding | null = null
    let t = 0
    if (status === 0x90 && value > 0) binding = { kind: 'note', channel, number }
    else if (status === 0xb0) { binding = { kind: 'cc', channel, number }; t = value / 127 }
    else if (status === 0xe0) { binding = { kind: 'bend', channel, number: 0 }; t = bendNorm(number, value) }
    else if (status === 0xd0) { binding = { kind: 'pressure', channel, number: 0 }; t = number / 127 }
    else if (status === 0xa0) { binding = { kind: 'polypressure', channel, number }; t = value / 127 }
    // A note's release, for a modulator input playing it as an envelope (its
    // attack came with the note on)
    // (always, Learn or not : a release lost while learning would hold the envelope open)
    if (!binding && (status === 0x80 || status === 0x90)) {
      for (const id of midiTargetsFor({ kind: 'note', channel, number })) {
        const ck = controlKeyOf(id)
        if (ck) controlBus.note(ck, false)
      }
      return
    }
    if (!binding) return

    const st = useStore.getState()

    // A fader or knob learned now starts as this computer's default : pickup
    // or jump (absent : jump, as before).
    const pick = st.midiPickupDefault

    // Legacy per-knob learn (the CC button on a Meta knob) wins first.
    if (st.midiLearn !== null && binding.kind === 'cc') {
      const idx = st.midiLearn
      st.updateMetaKnob(idx, { midiCc: { channel, number, ...(pick ? { pickup: true } : {}) } })
      st.setMidiLearn(null)
      return
    }

    // Global MIDI Learn : bind the selected target, stay in learn mode so
    // the next control can be mapped straight away (dataFLOU behaviour). The
    // mapping goes where Learn into says (this computer or this session); a
    // Macro knob's CC stays on the knob itself, as it always did.
    if (st.midiLearnMode && st.midiLearnTarget) {
      const target = st.midiLearnTarget
      const mod = !!controlKeyOf(target)
      const cont = isContinuousTarget(target)
      const fader = isFaderKind(binding.kind)
      // Continuous targets take faders only (a CC, the bend, pressure) : ignore
      // pad hits so the user can keep trying with a knob/fader. (A modulator
      // input takes a pad too : it plays the note as an envelope.)
      if (cont && !fader && !mod) return
      // ... and a press target takes a pad or a button (a note, a CC) : the bend
      // or aftertouch of a key just hit never binds over it
      if (!cont && !mod && binding.kind !== 'cc' && binding.kind !== 'note') return
      if (target.startsWith('meta:') && binding.kind === 'cc') {
        st.updateMetaKnob(Number(target.slice(5)), { midiCc: { channel, number, ...(pick ? { pickup: true } : {}) } })
      } else {
        st.setMidiBinding(target, cont && fader && pick && !mod ? { ...binding, pickup: true } : binding, st.learnScope)
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
    // The targets : the session's mappings on this input when it has any (a
    // piece's own setup wins for the inputs it uses), else this computer's.
    const found = midiMatches(binding)
    const ids = found.map(([id]) => id)
    if (binding.kind !== 'note') {
      let ccHandled = false
      const input = pickupInputKey(binding.kind, channel, binding.number)
      if (binding.kind === 'cc') {
        const knobs = st.composition.metaKnobs
        for (let i = 0; i < knobs.length; i++) {
          const cc = knobs[i].midiCc
          if (cc && cc.channel === channel && cc.number === number) {
            ccHandled = true
            const id = `meta:${i}`
            if (cc.pickup && !pickupPass(input, id, t, knobTargetValue(i))) continue
            setKnobTarget(i, t, knobs[i].smoothMs)
            if (cc.pickup) pickupWritten(id, knobTargetValue(i))
          }
        }
      }
      for (const [id, b] of found) {
        // A Body rule's box on a knob or a latching button : on from 64, off below
        // (the release of a momentary button turns it off again)
        if (id.startsWith('rule:')) {
          if (binding.kind === 'cc') { st.setBodyRuleActive(id.slice(5), value >= 64, 'midi'); ccHandled = true }
          continue
        }
        if (isContinuousTarget(id)) {
          ccHandled = true
          // pickup : nothing until the control reaches the value it drives
          if (b.pickup && !controlKeyOf(id) && !pickupPass(input, id, t, readContinuous(id, true))) continue
          queueContinuous(id, t)
        }
      }
      // A CC used as a continuous control never also fires a trigger bound to
      // the same number. (The bend and pressure fire nothing.)
      if (ccHandled || binding.kind !== 'cc') return
    }

    // Triggers fire on the press edge only : a CC button's release (value 0)
    // or a zero-velocity note-off must not double-fire. Every matching trigger
    // fires — one pad can drive several actions.
    if (value <= 0) return
    // a fader still waiting for its frame lands first : a pad recalling a scene
    // must not be overwritten a frame later by a fader moved just before it
    flushContinuous()
    // One pad can drive several actions : every matching DISCRETE binding fires,
    // through the shared fireTrigger (same path as a body gesture). Any
    // learnable trigger — fire:*, scene:*, sonify:voice:*, and every rand:*
    // dice — works without being listed here.
    for (const id of ids) {
      // a modulator input on a pad : the note's attack (its release : above)
      const ck = controlKeyOf(id)
      if (ck) { if (binding.kind === 'note') controlBus.note(ck, true, value / 127); continue }
      if (isContinuousTarget(id)) continue
      // a Body rule's box on a pad : each hit turns it on or off (its CC above)
      if (id.startsWith('rule:')) { if (binding.kind === 'note') st.setBodyRuleActive(id.slice(5), 'toggle', 'midi'); continue }
      fireTrigger(id)
    }
  }
}

// ── Faders and knobs : the latest value, once a frame ───────────────────
// A controller sends a message for every step of a fader (the Launch Control
// XL : 128 steps, up to 800 a second for one fader moved fast). Written one by
// one, each was a whole store write, a redraw of the interface and a sync of
// the composition : at a few hundred a second the picture fell from 60 to 5 fps
// (measured 11-19). Now each target keeps only its latest value and they all
// land together once a frame (one React render for every fader moved), whatever
// the controller sends. A timer stands in when the window draws no frames
// (minimized : the output still plays). Pads and triggers stay immediate.
const ccPending = new Map<string, number>()
let ccRaf = 0
let ccTimer: ReturnType<typeof setTimeout> | null = null

function queueContinuous(id: string, t: number): void {
  ccPending.set(id, t)
  if (ccRaf || ccTimer) return
  ccRaf = requestAnimationFrame(flushContinuous)
  ccTimer = setTimeout(flushContinuous, 34)
}

/** Write the faders waiting for their frame (now). */
export function flushContinuous(): void {
  if (ccRaf) cancelAnimationFrame(ccRaf)
  if (ccTimer) clearTimeout(ccTimer)
  ccRaf = 0
  ccTimer = null
  if (!ccPending.size) return
  const p = [...ccPending]
  ccPending.clear()
  for (const [id, t] of p) {
    applyContinuous(id, t)
    // what a pickup control left there : a value found different at its next
    // message was moved by something else (a scene, undo, the mouse)
    if (pickupTracks(id)) pickupWritten(id, readContinuous(id, true))
  }
}

/** The targets a MIDI input plays : the session's mappings on it when it has
 *  any (they silence this computer's on THAT input only), else this
 *  computer's. (A Macro knob's CC, on the knob, is not in either map.) */
export function midiTargetsFor(b: MidiBinding): string[] {
  return midiMatches(b).map(([id]) => id)
}

/** The same, with each mapping (its pickup choice). */
function midiMatches(b: MidiBinding): Array<[string, MidiBinding]> {
  const st = useStore.getState()
  const pick = (map: Record<string, MidiBinding>): Array<[string, MidiBinding]> => {
    const out: Array<[string, MidiBinding]> = []
    for (const id in map) if (sameMidiInput(map[id], b)) out.push([id, map[id]])
    return out
  }
  const own = pick(st.sessionMidiMap)
  return own.length ? own : pick(st.midiMap)
}

/** The pickup controls still waiting to reach their value, keyed
 *  `<input>><target id>` (the MIDI panel's hint) : where the control is and
 *  where the value is, 0..1. A target moved since (a scene) shows at once. */
export function pickupHints(): Map<string, { at: number; value: number }> {
  const out = new Map<string, { at: number; value: number }>()
  const seen = new Set<string>()
  for (const w of pickupWaiting()) seen.add(w.id)
  // (engaged controls whose value moved meanwhile : waiting now)
  for (const id of pickupTrackedIds()) if (!seen.has(id)) pickupRecheck(id, readContinuous(id, true))
  for (const w of pickupWaiting()) {
    const v = readContinuous(w.id, true)
    if (v != null) out.set(`${w.input}>${w.id}`, { at: w.at, value: v })
  }
  return out
}

/** A computer mapping a session mapping silences (the same input). */
export function midiSilenced(b: MidiBinding): boolean {
  const map = useStore.getState().sessionMidiMap
  for (const id in map) if (sameMidiInput(map[id], b)) return true
  return false
}

// ── Continuous targets : one place sets them, one place reads them ──────
// MIDI (a CC, 0..127 as 0..1) and OSC Learn (the controller's range as 0..1)
// both land here, so a learned control and its /opsia twin write the same
// store action (last message wins, like MIDI and the mouse).

/** Set a continuous target from a 0..1 position (each mirrors its slider's
 *  mapping). False when the id is not one (or its thing is gone). */
export function applyContinuous(id: string, t: number): boolean {
  // a modulator slot's controller input (engine/controlBus.ts)
  const ck = controlKeyOf(id)
  if (ck) {
    controlBus.set(ck, t)
    return true
  }
  const st = useStore.getState()
  if (id.startsWith('meta:')) {
    const i = Number(id.slice(5))
    const knob = st.composition.metaKnobs[i]
    if (!knob) return false
    setKnobTarget(i, t, knob.smoothMs)
    return true
  }
  if (id in FIELD_SETTERS) { FIELD_SETTERS[id](t); return true }
  // a Lights group's fader (its id after the prefix)
  if (id.startsWith('lights:group:')) { st.setLightGroupLevel(id.slice(13), t); return true }
  // a Sonify parameter (a Synth knob, a patchbay depth) : over the span its modulation uses
  if (id.startsWith('sonify:param:')) {
    const p = id.slice(13), d = SONIFY_MOD_DESCS[p]
    if (!d) return false
    const so = useStore.getState().sonify
    const max = p === 'signalRate' && so.signal?.sync ? Math.min(16, d.max) : d.max // synced, the rate stops at 16
    st.setSonify(withSonifyParam(so, p, d.min + t * (max - d.min)))
    return true
  }
  const lm = /^layer:(\d+):(mix|harmony|opacity)$/.exec(id)
  if (lm) {
    const i = Number(lm[1])
    if (!st.composition.layers[i]) return false
    if (lm[2] === 'mix') st.setSourceMix(i, t)
    else if (lm[2] === 'harmony') st.setHarmony(i, t * 2 - 1)
    else st.setOpacity(i, t)
    return true
  }
  switch (id) {
    case 'transport:bpm': {
      const bpm = Math.round(40 + t * 200)
      useStore.setState((s) => ({ composition: { ...s.composition, bpm } }))
      tempoEdited(bpm)
      return true
    }
    case 'transport:speed': st.setGlobalSpeed(Math.pow(2, -6 + t * 12)); return true
    case 'transport:morph': st.setMorphMs(Math.round(Math.pow(t, MORPH_POW) * 30000)); return true
    case 'transport:prox': st.setProximity(t); return true
    // the sliders' own ranges and steps (Transport.tsx)
    case 'transport:varyAmount': st.setVaryAmt(Math.round((0.01 + t * 0.99) * 100) / 100); return true
    case 'transport:randAmount': st.setRandIntensity(Math.round((0.02 + t * 0.98) * 100) / 100); return true
    case 'audiolayer:volume': st.patchAudioLayer({ volume: Math.round(t * 200) / 100 }); return true
    case 'audiolayer:mix': st.patchAudioLayer({ mix: t }); return true
    case 'bg:opacity': st.setBackgroundOpacity(t); return true
    case 'bg:speed': st.setBackgroundSpeed(t * BG_SPEED_MAX); return true
    case 'bg:depth': st.setBackgroundDepth(t); return true
    // Metasurface cursor (activates the surface; needs ≥2 placed scenes).
    case 'surface:x':
      st.setSurfaceXY(t, st.surface.y)
      if (!st.surface.active) st.setSurfaceActive(true)
      return true
    case 'surface:y':
      st.setSurfaceXY(st.surface.x, t)
      if (!st.surface.active) st.setSurfaceActive(true)
      return true
    case 'sonify:master': st.setSonify({ ...st.sonify, master: t }); return true
  }
  return false
}

const FIELD_KEYS: Record<string, 'density' | 'gestureTexture' | 'coalesce' | 'tonicity' | 'drift' | 'flow' | 'shutter' | 'superFlicker' | 'worldAmount'> = {
  'field:density': 'density', 'field:gestureTexture': 'gestureTexture', 'field:coalesce': 'coalesce',
  'field:tonicity': 'tonicity', 'field:drift': 'drift', 'field:flow': 'flow',
  'field:shutter': 'shutter', 'field:superFlicker': 'superFlicker', 'field:worldAmount': 'worldAmount'
}
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0)
const NO_LIVE: ReadonlyMap<string, number> = new Map()

/** Where a continuous target is now, 0..1 (the inverse of applyContinuous) :
 *  the value playing (a modulator's, a Macro knob gliding to its target), so
 *  what a learned control answers follows modulators, scenes and Generate.
 *  A Body rule's box reads 1 on, 0 off. Null for anything without a value.
 *  `base` : the value set, without what modulators play over it (MIDI pickup
 *  waits for that one). */
export function readContinuous(id: string, base = false): number | null {
  // (a modulator's input is the hand itself : nothing to answer)
  if (controlKeyOf(id)) return null
  const st = useStore.getState()
  const liveMods = base ? NO_LIVE : liveModValues
  if (id.startsWith('meta:')) {
    const i = Number(id.slice(5))
    if (!st.composition.metaKnobs[i]) return null
    return clamp01((base ? undefined : metaLiveValues.get(i)) ?? knobTargetValue(i))
  }
  if (id.startsWith('rule:')) {
    const r = st.bodyControl.rules.find((x) => x.id === id.slice(5))
    return r ? (r.enabled ? 1 : 0) : null
  }
  const chain = chainScopeOf(id)
  if (chain) {
    const on = chainOn(chain)
    return on === null ? null : on ? 1 : 0
  }
  // (the World amount has a modulator target : answer what it plays)
  if (id === 'field:worldAmount') return clamp01(liveMods.get('world:amount') ?? st.worldAmount)
  const fk = FIELD_KEYS[id]
  if (fk) return clamp01(st[fk])
  if (id.startsWith('sonify:param:')) {
    const p = id.slice(13), d = SONIFY_MOD_DESCS[p]
    const v = d ? (base ? undefined : sonifyModValues.get(p)) ?? sonifyParamOf(st.sonify, p) : undefined
    return d && typeof v === 'number' && d.max > d.min ? clamp01((v - d.min) / (d.max - d.min)) : null
  }
  const lm = /^layer:(\d+):(mix|harmony|opacity)$/.exec(id)
  if (lm) {
    const i = Number(lm[1])
    const l = st.composition.layers[i]
    if (!l) return null
    const live = liveMods.get(`lay:${i}:${lm[2]}`)
    if (lm[2] === 'mix') return clamp01(live ?? l.sourceMix)
    if (lm[2] === 'harmony') return clamp01(((live ?? l.harmony ?? 0) + 1) / 2)
    return clamp01(live ?? l.opacity)
  }
  switch (id) {
    case 'transport:bpm': return clamp01((st.composition.bpm - 40) / 200)
    case 'transport:speed': return clamp01((Math.log2(Math.max(1e-6, st.globalSpeed)) + 6) / 12)
    case 'transport:morph': return clamp01(Math.pow(st.morphMs / 30000, 1 / MORPH_POW))
    case 'transport:prox': return clamp01(st.proximity)
    case 'transport:varyAmount': return clamp01((st.varyAmt - 0.01) / 0.99)
    case 'transport:randAmount': return clamp01((st.randIntensity - 0.02) / 0.98)
    case 'audiolayer:volume': return clamp01((liveMods.get('au:volume') ?? st.audioLayer.volume) / 2)
    case 'audiolayer:mix': return clamp01(liveMods.get('au:mix') ?? st.audioLayer.mix)
    // a chain's switch answers as a Body rule's box does : 1 on, 0 off
    case 'master:chain': {
      const on = chainOn({ kind: 'master' })
      return on === null ? null : on ? 1 : 0
    }
    case 'bg:opacity': return clamp01(liveMods.get('bg:opacity') ?? st.composition.background?.opacity ?? 0)
    case 'bg:speed': return clamp01((liveMods.get('bg:speed') ?? st.composition.background?.speed ?? 0) / BG_SPEED_MAX)
    case 'bg:depth': return clamp01(liveMods.get('bg:depth') ?? st.composition.background?.depth ?? 0)
    case 'surface:x': return clamp01(st.surface.x)
    case 'surface:y': return clamp01(st.surface.y)
    case 'sonify:master': return clamp01(st.sonify.master)
  }
  return null
}

export const midi = new MidiManager()

// While the BPM follows a MIDI clock, the tempo is the clock's, not the piece's :
// the Save changes? question leaves it out (as with Ableton Link).
setTempoFollowed(() => midi.clockInFollowing())

/** A channel message as the MIDI panel shows it ('CC 21 ch1 = 64', 'bend ch1 = 8192'). */
function describeChannelMsg(b0: number, b1: number, b2: number, len: number): string {
  const status = b0 & 0xf0
  const ch = `ch${(b0 & 0x0f) + 1}`
  switch (status) {
    case 0x90: return b2 > 0 ? `NOTE ${b1} ${ch} = ${b2}` : `note-off ${b1} ${ch}`
    case 0x80: return `note-off ${b1} ${ch}`
    case 0xb0: return `CC ${b1} ${ch} = ${b2}`
    case 0xe0: return `bend ${ch} = ${((b2 & 0x7f) << 7) | (b1 & 0x7f)}`
    case 0xd0: return `AT ${ch} = ${b1}`
    case 0xa0: return `AT ${b1} ${ch} = ${b2}`
    case 0xc0: return `prog-change ${b1} ${ch}`
    default: return `0x${status.toString(16)} ${len > 1 ? b1 : ''} ${ch}`
  }
}

let started = false

/** Idempotent app-start hook (App.tsx). */
export function initMidi(): void {
  if (started) return
  started = true
  void midi.init()
}
