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
import { fireSelectedRandomize, fireVariation } from './commands'
import { setKnobTarget } from './metaSmooth'
import { useStore } from './store'

export interface MidiDevice {
  id: string
  name: string
}

// ── Learnable targets ────────────────────────────────────────────────────
// meta:<i>          Meta knob i (CC only, stored on the knob itself)
// scene:<i>         scene slot i (0-based; note or button-CC recalls it)
// transport:bpm     CC → 40..240 BPM
// transport:speed   CC → global speed 1/64×..64× (log, like the slider)
// transport:morph   CC → morph time (same power curve as the slider)
// transport:prox    CC → proximity 0..1
// fire:vary         note/CC press → Variation at the current spread
// fire:randomize    note/CC press → the selected Randomize
// fire:sonify       note/CC press → Sonify on/off

/** Continuous targets take knobs/faders only : notes are ignored while one
 *  of these is the armed learn target (keep twisting until it takes). */
export function isContinuousTarget(id: string): boolean {
  return id.startsWith('meta:') || id.startsWith('transport:')
}

/** Human name for a target id (bindings list + overlay tooltips). */
export function midiTargetLabel(id: string): string {
  if (id.startsWith('meta:')) {
    const i = Number(id.slice(5))
    const name = useStore.getState().composition.metaKnobs[i]?.name
    return `META ${i + 1}${name ? ` · ${name}` : ''}`
  }
  if (id.startsWith('scene:')) return `SCENE ${Number(id.slice(6)) + 1}`
  switch (id) {
    case 'transport:bpm':
      return 'BPM'
    case 'transport:speed':
      return 'SPEED'
    case 'transport:morph':
      return 'MORPH'
    case 'transport:prox':
      return 'PROXIMITY'
    case 'fire:vary':
      return 'VARY'
    case 'fire:randomize':
      return 'RANDOMIZE'
    case 'fire:sonify':
      return 'SONIFY on/off'
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
    this.access.inputs.forEach((inp) => {
      const mine = !wanted || (inp.name ?? inp.id) === wanted
      inp.onmidimessage = mine ? (e): void => this.onMessage(e) : null
    })
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
    if (!data || data.length < 3) return
    const status = data[0] & 0xf0
    const channel = data[0] & 0x0f
    const number = data[1]
    const value = data[2] ?? 0

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

    // ── Normal routing ──────────────────────────────────────────────────
    // Meta knobs FIRST (continuous; the smoother gives hardware the same
    // feel as a mouse drag), so a knob CC never also fires a trigger bound
    // to the same number.
    if (binding.kind === 'cc') {
      const t = value / 127
      const knobs = st.composition.metaKnobs
      for (let i = 0; i < knobs.length; i++) {
        const cc = knobs[i].midiCc
        if (cc && cc.channel === channel && cc.number === number) {
          setKnobTarget(i, t, knobs[i].smoothMs)
          return
        }
      }
      // Transport continuous controls — each mirrors its slider's mapping.
      const map = st.midiMap
      if (matches(map['transport:bpm'], binding)) {
        useStore.setState((s) => ({
          composition: { ...s.composition, bpm: Math.round(40 + t * 200) }
        }))
        return
      }
      if (matches(map['transport:speed'], binding)) {
        st.setGlobalSpeed(Math.pow(2, -6 + t * 12))
        return
      }
      if (matches(map['transport:morph'], binding)) {
        st.setMorphMs(Math.round(Math.pow(t, MORPH_POW) * 30000))
        return
      }
      if (matches(map['transport:prox'], binding)) {
        st.setProximity(t)
        return
      }
    }

    // Triggers fire on the press edge only : a CC button's release (value 0)
    // or a zero-velocity note-off must not double-fire.
    if (value <= 0) return
    const map = st.midiMap
    if (matches(map['fire:vary'], binding)) {
      fireVariation()
      return
    }
    if (matches(map['fire:randomize'], binding)) {
      fireSelectedRandomize()
      return
    }
    if (matches(map['fire:sonify'], binding)) {
      st.setSonify({ ...st.sonify, on: !st.sonify.on })
      return
    }
    for (let i = 0; i < st.scenes.length; i++) {
      if (matches(map[`scene:${i}`], binding)) {
        st.recallScene(st.scenes[i].id)
        return
      }
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
