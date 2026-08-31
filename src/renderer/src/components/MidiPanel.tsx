// MIDI section of the osc/audio/midi tab : pick the external controller
// (input device dropdown), see every learned binding in one list, and clear
// them. Binding happens live via the toolbar's MIDI LEARN button (dataFLOU's
// Ableton-style mode); this panel is the ledger.

import { useEffect, useState } from 'react'
import type { MidiBinding } from '@shared/types'
import { describeBinding, midi, midiTargetLabel, type MidiDevice } from '../midi'
import { useStore } from '../store'

export function MidiPanel(): JSX.Element {
  const collapsed = useStore((s) => !!s.collapsed['midi'])
  const toggleSection = useStore((s) => s.toggleSection)
  const inputName = useStore((s) => s.midiInputName)
  const setInputName = useStore((s) => s.setMidiInputName)
  const learnMode = useStore((s) => s.midiLearnMode)
  const setLearnMode = useStore((s) => s.setMidiLearnMode)
  const midiMap = useStore((s) => s.midiMap)
  const metaKnobs = useStore((s) => s.composition.metaKnobs)
  const setMidiBinding = useStore((s) => s.setMidiBinding)
  const updateMetaKnob = useStore((s) => s.updateMetaKnob)

  const [devices, setDevices] = useState<MidiDevice[]>(() => midi.listDevices())
  useEffect(() => midi.subscribe(setDevices), [])

  // Live diagnostics : the last raw message + how many inputs are actually
  // wired. Lets you confirm a controller is talking before hunting bindings.
  const [activity, setActivity] = useState('')
  const [wired, setWired] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => {
      setActivity(midi.lastMsg)
      setWired(midi.wiredCount)
    }, 150)
    return () => window.clearInterval(id)
  }, [])

  // The selected device may be unplugged right now : keep it listed (greyed
  // by the ⚠ suffix) so the choice survives replugging.
  const missing = inputName && !devices.some((d) => d.name === inputName)

  // One flat ledger : session-carried Meta-knob CCs first, then the
  // machine-local map (scenes, transport, fires), in a stable order.
  const rows: Array<{ id: string; binding: MidiBinding; clear: () => void }> = []
  metaKnobs.forEach((k, i) => {
    if (k.midiCc) {
      rows.push({
        id: `meta:${i}`,
        binding: { kind: 'cc', channel: k.midiCc.channel, number: k.midiCc.number },
        clear: () => updateMetaKnob(i, { midiCc: null })
      })
    }
  })
  Object.keys(midiMap)
    .sort()
    .forEach((id) => rows.push({ id, binding: midiMap[id], clear: () => setMidiBinding(id, null) }))

  return (
    <div className="flex min-w-0 flex-col gap-1 border-t border-border bg-panel px-3 py-1.5 text-[11px]">
      {/* Header matches the OSC / AUDIO sections : chevron + title, with the
          learn state riding the header so it reads even when collapsed. */}
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={() => toggleSection('midi')}
          className="flex shrink-0 items-center gap-1.5"
          title={collapsed ? 'Expand MIDI' : 'Collapse MIDI'}
        >
          <span
            className={`font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}
          >
            ▶
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted">MIDI</span>
        </button>
        <button
          onClick={() => setLearnMode(!learnMode)}
          className="shrink-0 rounded px-2 py-0.5 font-mono text-[10px] transition-colors"
          style={
            learnMode
              ? {
                  background: 'rgba(90, 150, 255, 0.6)',
                  color: '#fff',
                  boxShadow: '0 0 0 1px rgba(90, 150, 255, 1) inset'
                }
              : undefined
          }
          title={
            learnMode
              ? 'MIDI Learn ON — click a highlighted control, then move a MIDI control. Click to exit.'
              : 'Enter MIDI Learn mode (same as the toolbar button)'
          }
        >
          {learnMode ? 'LEARNING' : 'LEARN'}
        </button>
        <div className="flex-1" />
        <span className="font-mono text-[9px] text-muted">
          {devices.length ? `${devices.length} device${devices.length > 1 ? 's' : ''}` : 'no devices'}
        </span>
      </div>

      {!collapsed && (
        <>
          {/* Input device : which external controller feeds the app. */}
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 font-mono text-[9px] uppercase text-muted">input</span>
            <select
              className="input select-compact min-w-0 flex-1 px-1 py-0.5 text-[11px]"
              value={inputName}
              onChange={(e) => {
                setInputName(e.target.value)
                midi.attach()
              }}
              title="External MIDI input : all connected controllers, or just one"
            >
              <option value="">All inputs</option>
              {devices.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
              {missing && <option value={inputName}>{inputName} ⚠ (unplugged)</option>}
            </select>
          </div>

          {/* Live activity : if this stays "no MIDI received" while you move a
              control, the input isn't reaching the app (wiring/device); if it
              updates, the controller is talking (bind via the LEARN overlays). */}
          <div className="flex items-center gap-2 font-mono text-[9px]">
            <span className={wired > 0 ? 'text-accent' : 'text-danger'}>
              {wired > 0 ? `${wired} input${wired > 1 ? 's' : ''} wired` : 'no input wired'}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted">
              in: {activity || '— (no MIDI received yet — move a knob / press a key)'}
            </span>
          </div>

          {/* The bindings ledger. */}
          {rows.length === 0 ? (
            <div className="rounded border border-border bg-panel2/40 p-1.5 font-mono text-[9px] leading-relaxed text-muted">
              No bindings yet. Press <span className="text-text">MIDI LEARN</span> in the bottom
              toolbar, click a highlighted control (Meta knobs, transport sliders, Vary /
              Randomize / Sonify, scene chips), then move a knob or hit a pad.
            </div>
          ) : (
            <div className="flex flex-col gap-px">
              {rows.map((r) => (
                <div
                  key={r.id}
                  className="flex min-w-0 items-center gap-2 rounded bg-panel2/40 px-1.5 py-0.5"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px]">
                    {midiTargetLabel(r.id)}
                  </span>
                  <span className="shrink-0 font-mono text-[9px] text-accent2">
                    {describeBinding(r.binding)}
                  </span>
                  <button
                    onClick={r.clear}
                    className="shrink-0 font-mono text-[10px] text-muted hover:text-danger"
                    title="Clear this binding"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
