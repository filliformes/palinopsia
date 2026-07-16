// MIDI Learn overlay — dataFLOU's visual language, verbatim : while learn
// mode is armed, every learnable control grows a blue film (bright pulsing
// blue = selected as the learn target, green = already bound). Unlike
// dataFLOU's (whose targets are buttons that check learn mode themselves),
// this overlay CAPTURES the click : most Palinopsia targets are sliders and
// knobs, and a click meant to arm a binding must not also drag the value.
// Right-click clears an existing binding.
//
// Render it inside any relatively-positioned wrapper. It renders nothing at
// all when learn mode is off — zero cost in play mode.

import type { MouseEvent } from 'react'
import { describeBinding, isContinuousTarget, midiTargetLabel } from '../midi'
import { useStore } from '../store'

export function MidiLearnOverlay({ id }: { id: string }): JSX.Element | null {
  const mode = useStore((s) => s.midiLearnMode)
  const selected = useStore((s) => s.midiLearnTarget === id)
  // Meta knobs keep their CC on the knob itself (session data); everything
  // else lives in the machine-local map. Selected as a STRING so the zustand
  // selector returns a stable primitive (no re-render churn).
  const bound = useStore((s) => {
    if (id.startsWith('meta:')) {
      const cc = s.composition.metaKnobs[Number(id.slice(5))]?.midiCc
      return cc ? `CC${cc.number} ch${cc.channel + 1}` : null
    }
    const b = s.midiMap[id]
    return b ? describeBinding(b) : null
  })
  const setTarget = useStore((s) => s.setMidiLearnTarget)
  const setBinding = useStore((s) => s.setMidiBinding)
  const updateMetaKnob = useStore((s) => s.updateMetaKnob)
  if (!mode) return null

  const cls = selected ? 'midi-learn-selected' : bound ? 'midi-learn-green' : 'midi-learn-blue'
  const hint = isContinuousTarget(id) ? 'move a knob/fader' : 'hit a pad / press a button'
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
        if (id.startsWith('meta:')) updateMetaKnob(Number(id.slice(5)), { midiCc: null })
        else setBinding(id, null)
        if (selected) setTarget(null)
      }}
      title={
        selected
          ? `${midiTargetLabel(id)} : waiting — ${hint}. Click to deselect.`
          : bound
            ? `${midiTargetLabel(id)} : bound to ${bound}. Click + move a control to rebind · right-click to clear.`
            : `${midiTargetLabel(id)} : click, then ${hint} to bind.`
      }
    />
  )
}
