// MIDI Learn overlay (dataFLOU's visual language, verbatim) : while learn
// mode is armed, every learnable control grows a blue film (bright pulsing
// blue = selected as the learn target, green = already bound). Unlike
// dataFLOU's (whose targets are buttons that check learn mode themselves),
// this overlay CAPTURES the click : most Palinopsia targets are sliders and
// knobs, and a click meant to arm a binding must not also drag the value.
// Right-click clears everything learned on the control.
//
// The same overlay learns OSC (oscLearn.ts) : an armed control binds to the
// first MIDI or OSC message. Green = bound where Learn into points (this
// computer or this session); a dashed green = bound only in the other one.
//
// Render it inside any relatively-positioned wrapper. It renders nothing at
// all when learn mode is off : zero cost in play mode.

import type { MouseEvent } from 'react'
import { isContinuousTarget, midiTargetLabel } from '../midi'
import { describeAnyBinding } from '../mappingModel'
import { useStore } from '../store'

export function MidiLearnOverlay({ id }: { id: string }): JSX.Element | null {
  const mode = useStore((s) => s.midiLearnMode)
  const selected = useStore((s) => s.midiLearnTarget === id)
  // What is learned on it, both scopes. Selected as a STRING so the zustand
  // selector returns a stable primitive (no re-render churn) :
  // "<here>|<other>|<description>".
  const state = useStore((s) => {
    if (!s.midiLearnMode) return ''
    const here: string[] = []
    const other: string[] = []
    // Meta knobs keep their CC on the knob itself (session data)
    if (id.startsWith('meta:')) {
      const cc = s.composition.metaKnobs[Number(id.slice(5))]?.midiCc
      if (cc) here.push(`CC${cc.number} ch${cc.channel + 1} (on the knob)`)
    }
    const put = (b: Parameters<typeof describeAnyBinding>[0] | undefined, scope: 'computer' | 'session'): void => {
      if (!b) return
      const text = `${describeAnyBinding(b)} (${scope === 'computer' ? 'this computer' : 'this session'})`
      ;(scope === s.learnScope ? here : other).push(text)
    }
    put(s.sessionMidiMap[id], 'session')
    put(s.sessionOscMap[id], 'session')
    put(s.midiMap[id], 'computer')
    put(s.oscMap[id], 'computer')
    return `${here.length ? 1 : 0}|${other.length ? 1 : 0}|${[...here, ...other].join(' · ')}`
  })
  const setTarget = useStore((s) => s.setMidiLearnTarget)
  const clearMappings = useStore((s) => s.clearMappings)
  if (!mode) return null

  const [hereS, otherS, bound] = state.split('|')
  const cls = selected
    ? 'midi-learn-selected'
    : hereS === '1'
      ? 'midi-learn-green'
      : otherS === '1'
        ? 'midi-learn-green midi-learn-other'
        : 'midi-learn-blue'
  const hint = isContinuousTarget(id)
    ? 'move a knob / fader, or a fader sending OSC'
    : id.startsWith('rule:')
      ? 'hit a pad (each hit : on or off), move a knob (on from half way) or press an OSC button (each press : on or off)'
      : 'hit a pad / press a button, or send an OSC message'
  return (
    <div
      className={`midi-learn-overlay ${cls}`}
      style={{ pointerEvents: 'auto', cursor: 'pointer' }}
      // Knob tiles start their drag on pointerdown (and it bubbles) : the
      // overlay must swallow it or arming a binding also grabs the knob.
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setTarget(selected ? null : id)
      }}
      onContextMenu={(e: MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        clearMappings(id)
        if (selected) setTarget(null)
      }}
      title={
        selected
          ? `${midiTargetLabel(id)} : waiting (${hint}). Click to deselect.`
          : bound
            ? `${midiTargetLabel(id)} : ${bound}. Click + move a control to rebind (a MIDI and an OSC mapping each, per scope) · right-click to clear them all.`
            : `${midiTargetLabel(id)} : click, then ${hint} to bind.`
      }
    />
  )
}
