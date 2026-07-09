// Web MIDI : CC input for the Meta Controller (brief §6/§8: every control
// MIDI-learnable via the Meta layer). Main grants the 'midi' permission;
// this module listens on every input (hot-plug included) and routes CCs:
//
// - LEARN: when a knob is armed (store.midiLearn = knob index), the next CC
//   received binds to it and disarms.
// - PLAY: a CC bound to knobs drives them through the smoother, so hardware
//   moves get the same per-knob smoothing as mouse drags.

import { setKnobTarget } from './metaSmooth'
import { useStore } from './store'

let started = false

export function initMidi(): void {
  if (started) return
  started = true
  if (!('requestMIDIAccess' in navigator)) {
    console.warn('[midi] Web MIDI unavailable')
    return
  }
  navigator
    .requestMIDIAccess({ sysex: false })
    .then((access) => {
      const attach = (): void => {
        access.inputs.forEach((input) => {
          input.onmidimessage = onMessage
        })
      }
      attach()
      access.onstatechange = attach // hot-plugged controllers join live
    })
    .catch((e) => console.warn('[midi] access denied:', (e as Error).message))
}

function onMessage(e: MIDIMessageEvent): void {
  const data = e.data
  if (!data || data.length < 3) return
  const status = data[0]
  if ((status & 0xf0) !== 0xb0) return // CC only
  const channel = status & 0x0f
  const number = data[1]
  const value = data[2] / 127

  const st = useStore.getState()

  // Learn mode: first CC binds the armed knob.
  if (st.midiLearn !== null) {
    const idx = st.midiLearn
    st.updateMetaKnob(idx, { midiCc: { channel, number } })
    st.setMidiLearn(null)
    return
  }

  // Route to every knob bound to this (channel, number).
  st.composition.metaKnobs.forEach((k, i) => {
    if (k.midiCc && k.midiCc.channel === channel && k.midiCc.number === number) {
      setKnobTarget(i, value, k.smoothMs)
    }
  })
}
