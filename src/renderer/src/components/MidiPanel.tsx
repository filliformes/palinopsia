// MIDI section of the Connect tab : pick the external controller
// (input device dropdown), see every learned binding in one list, and clear
// them. Binding happens live via the toolbar's MIDI LEARN button (dataFLOU's
// Ableton-style mode); this panel is the ledger. The ledger lists the OSC
// mappings too (OSC Learn, oscLearn.ts : the same mode learns both), grouped
// by where they live : this session (its file) or this computer; each row
// moves to the other, and each OSC controller gets its reply port here.

import { useEffect, useMemo, useState } from 'react'
import type { MappingScope, MidiBinding, OscBinding } from '@shared/types'
import { midi, type MidiDevice } from '../midi'
import { describeAnyBinding, silencedBySession } from '../mappingModel'
import { useStore } from '../store'
import { triggerLabel, triggerOptions } from '../triggerCatalog'
import { SearchSelect } from './SearchSelect'
import { showToast } from './Toast'
import { numberBoxCh, numberBoxChars } from './numberBox'

// a UDP port's box : as wide as "65535"
const PORT_W = numberBoxCh(numberBoxChars(1, 65535, true))
const LEARN_BLUE = 'rgba(90, 150, 255, 1)'

/** Learn into : where what Learn learns goes (shown beside MIDI Learn while it
 *  is on, on the top bar and in this panel). */
export function LearnScopeSwitch({ short = false }: { short?: boolean }): JSX.Element {
  const scope = useStore((s) => s.learnScope)
  const setScope = useStore((s) => s.setLearnScope)
  const seg = (v: MappingScope, label: string): JSX.Element => (
    <button
      onClick={() => setScope(v)}
      className="px-1.5 py-0.5 font-mono text-[10px] leading-none transition-colors"
      style={scope === v ? { background: 'rgba(90, 150, 255, 0.6)', color: '#fff' } : { color: 'rgba(150, 190, 255, 0.95)' }}
    >
      {label}
    </button>
  )
  return (
    <span
      className="flex shrink-0 items-center overflow-hidden rounded"
      style={{ boxShadow: `0 0 0 1px ${LEARN_BLUE} inset` }}
      title="Learn into : where what you learn now goes. This computer : every session on this computer (as before). This session : saved in this session's file, a piece's own controller setup; on an input it uses, it stands in for this computer's mappings. (A Macro knob's MIDI CC stays on the knob, in the session, whatever this says.)"
    >
      {!short && <span className="pl-1.5 pr-0.5 font-mono text-[9px] text-muted">into</span>}
      {seg('computer', 'computer')}
      {seg('session', 'session')}
    </span>
  )
}

interface Row {
  key: string
  id: string
  kind: 'midi' | 'osc'
  scope: MappingScope | 'knob'
  b: MidiBinding | OscBinding
  silenced: boolean
  clear: () => void
}

export function MidiPanel(): JSX.Element {
  const collapsed = useStore((s) => !!s.collapsed['midi'])
  const toggleSection = useStore((s) => s.toggleSection)
  const inputName = useStore((s) => s.midiInputName)
  const setInputName = useStore((s) => s.setMidiInputName)
  const outputName = useStore((s) => s.midiOutputName)
  const setOutputName = useStore((s) => s.setMidiOutputName)
  const clockOut = useStore((s) => s.midiClockOut)
  const setClockOut = useStore((s) => s.setMidiClockOut)
  const thru = useStore((s) => s.midiThru)
  const setThru = useStore((s) => s.setMidiThru)
  const learnMode = useStore((s) => s.midiLearnMode)
  const setLearnMode = useStore((s) => s.setMidiLearnMode)
  const midiMap = useStore((s) => s.midiMap)
  const oscMap = useStore((s) => s.oscMap)
  const sessionMidiMap = useStore((s) => s.sessionMidiMap)
  const sessionOscMap = useStore((s) => s.sessionOscMap)
  const metaKnobs = useStore((s) => s.composition.metaKnobs)
  const setMidiBinding = useStore((s) => s.setMidiBinding)
  const setOscBinding = useStore((s) => s.setOscBinding)
  const moveMapping = useStore((s) => s.moveMapping)
  const moveAll = useStore((s) => s.moveAllMappingsToSession)
  const copyAll = useStore((s) => s.copySessionMappingsToComputer)
  const replies = useStore((s) => s.oscReplies)
  const setReply = useStore((s) => s.setOscReply)
  const updateMetaKnob = useStore((s) => s.updateMetaKnob)
  const learnTarget = useStore((s) => s.midiLearnTarget)
  const setLearnTarget = useStore((s) => s.setMidiLearnTarget)
  // "learn an action" : the whole trigger vocabulary (the one a Body rule fires),
  // most of it with no control on screen to click in learn mode
  const composition = useStore((s) => s.composition)
  const scenes = useStore((s) => s.scenes)
  const worlds = useStore((s) => s.worlds)
  const rules = useStore((s) => s.bodyControl.rules) // (their on / off actions)
  const learnOptions = useMemo(
    () => triggerOptions(useStore.getState()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [composition, scenes, worlds, rules]
  )

  const [devices, setDevices] = useState<MidiDevice[]>(() => midi.listDevices())
  const [outputs, setOutputs] = useState<MidiDevice[]>(() => midi.listOutputs())
  useEffect(() => midi.subscribe(() => { setDevices(midi.listDevices()); setOutputs(midi.listOutputs()) }), [])

  // Live diagnostics : the last raw message + how many inputs are actually
  // wired. Lets you confirm a controller is talking before hunting bindings.
  const [activity, setActivity] = useState('')
  const [wired, setWired] = useState(0)
  const [clockRunning, setClockRunning] = useState(false)
  // the follower started (with Ableton Link's start / stop sync the clock runs
  // on while Link is stopped, the follower stopped)
  const [clockFollowing, setClockFollowing] = useState(false)
  useEffect(() => {
    const id = window.setInterval(() => {
      setActivity(midi.lastMsg)
      setWired(midi.wiredCount)
      setClockRunning(midi.clockRunning())
      setClockFollowing(midi.clockFollowing())
    }, 150)
    return () => window.clearInterval(id)
  }, [])

  // The selected device may be unplugged right now : keep it listed (greyed
  // by the ⚠ suffix) so the choice survives replugging.
  const missing = inputName && !devices.some((d) => d.name === inputName)
  const missingOut = outputName && !outputs.some((d) => d.name === outputName)
  const pillCls = (on: boolean): string =>
    `shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] transition-colors ${
      on ? 'border-accent bg-accent/15 text-accent' : 'border-border bg-panel2/60 text-muted hover:text-text'
    }`

  // The ledger, in three groups : the session's own mappings, the Macro
  // knobs' CCs (on the knob : in the session and its scenes), this computer's
  // (greyed where a session mapping on the same input stands in), each in a
  // stable order, MIDI then OSC.
  const rows: Row[] = []
  const push = (map: Record<string, MidiBinding | OscBinding>, kind: 'midi' | 'osc', scope: MappingScope): void => {
    for (const id of Object.keys(map).sort()) {
      const b = map[id]
      rows.push({
        key: `${scope}|${kind}|${id}`,
        id,
        kind,
        scope,
        b,
        silenced: scope === 'computer' && silencedBySession(b, sessionMidiMap, sessionOscMap),
        clear: () => (kind === 'midi' ? setMidiBinding(id, null, scope) : setOscBinding(id, null, scope))
      })
    }
  }
  push(sessionMidiMap, 'midi', 'session')
  push(sessionOscMap, 'osc', 'session')
  metaKnobs.forEach((k, i) => {
    if (k.midiCc) {
      rows.push({
        key: `knob|${i}`,
        id: `meta:${i}`,
        kind: 'midi',
        scope: 'knob',
        b: { kind: 'cc', channel: k.midiCc.channel, number: k.midiCc.number },
        silenced: false,
        clear: () => updateMetaKnob(i, { midiCc: null })
      })
    }
  })
  push(midiMap, 'midi', 'computer')
  push(oscMap, 'osc', 'computer')
  const sessionRows = rows.filter((r) => r.scope === 'session')
  const knobRows = rows.filter((r) => r.scope === 'knob')
  const computerRows = rows.filter((r) => r.scope === 'computer')
  // the OSC controllers (by IP) the mappings answer
  const hosts = new Map<string, number>()
  for (const r of rows) if (r.b.kind === 'osc') hosts.set(r.b.host, (hosts.get(r.b.host) ?? 0) + 1)

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
              ? 'MIDI Learn ON : click a highlighted control, then move a MIDI control. Click to exit.'
              : 'Enter MIDI Learn mode (same as the toolbar button)'
          }
        >
          {learnMode ? 'LEARNING' : 'LEARN'}
        </button>
        {learnMode && <LearnScopeSwitch short />}
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
              in: {activity || 'no MIDI received yet (move a knob / press a key)'}
            </span>
          </div>

          {/* Output device : where Opsia sends MIDI clock / transport + thru
              (e.g. an Ableton Move over USB). Opsia is otherwise input-only. */}
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 font-mono text-[9px] uppercase text-muted">output</span>
            <select
              className="input select-compact min-w-0 flex-1 px-1 py-0.5 text-[11px]"
              value={outputName}
              onChange={(e) => setOutputName(e.target.value)}
              title="MIDI output port : where clock / transport and thru are sent (pick your Ableton Move here)"
            >
              <option value="">None</option>
              {outputs.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
              {missingOut && <option value={outputName}>{outputName} ⚠ (unplugged)</option>}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setClockOut(!clockOut)}
              disabled={!outputName}
              className={`${pillCls(clockOut)} disabled:opacity-40`}
              title="Send MIDI clock (24 PPQN) + Start/Stop at the app BPM, so the device follows Opsia's tempo. With Ableton Link enabled, the clock follows Link's beat and Start waits for the next Link bar; with its start / stop sync, Start and Stop follow Link's play and stop (filled dot : the device was started), and turning the clock on plays every linked app. The device must be set to external / MIDI-clock sync."
            >
              clock {clockOut && clockRunning ? (clockFollowing ? '●' : '○') : ''}
            </button>
            <button
              onClick={() => midi.resyncClock()}
              disabled={!clockRunning}
              className="shrink-0 rounded border border-border bg-panel2/60 px-1.5 py-0.5 font-mono text-[9px] text-muted hover:text-accent disabled:opacity-40"
              title="Re-align the follower's downbeat to now (Stop + Start); with Ableton Link enabled, to the next Link bar"
            >
              resync
            </button>
            <button
              onClick={() => setThru(!thru)}
              disabled={!outputName}
              className={`${pillCls(thru)} disabled:opacity-40`}
              title="Forward incoming MIDI to the output : Opsia as a router (e.g. a Launch Control XL through to the Move). Never echoes the output back to itself."
            >
              thru
            </button>
            <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-muted">→ {outputName || 'no output'}</span>
          </div>

          {/* Learn an action : pick any trigger of the shared vocabulary (the
              layers, the loaded effects' triggers, Worlds, Generate, Macro,
              modulators, Feel, tempo, the output...), then hit a pad. */}
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 font-mono text-[9px] uppercase text-muted">learn</span>
            <SearchSelect
              value=""
              resetAfterPick
              placeholder={learnMode && learnTarget ? `waiting : ${triggerLabel(learnTarget)}` : 'an action, then hit a pad…'}
              options={learnOptions}
              menuWidth={300}
              className="min-w-0 flex-1 px-1 py-0.5 text-[11px]"
              onChange={(id) => {
                setLearnMode(true)
                setLearnTarget(id)
                showToast(`Learn : hit a pad, press a button or send an OSC message for ${triggerLabel(id)}`, 'ok', 5000)
              }}
              title="Bind a pad (or an OSC button) to any action, even one with no control on screen : the same vocabulary a Body rule fires (the layers, the loaded effects' triggers, Worlds, Generate, Macro, modulators, Feel, tempo, the key, the Audio Layer, the output). Pick it, then hit a pad, press a button or send an OSC message."
            />
          </div>

          {/* The bindings ledger : MIDI and OSC, the session's, the knobs', this computer's. */}
          {rows.length === 0 ? (
            <div className="rounded border border-border bg-panel2/40 p-1.5 font-mono text-[9px] leading-relaxed text-muted">
              No mappings yet. Press <span className="text-text">MIDI Learn</span> in the top bar,
              click a highlighted control (Macro knobs, transport sliders, Vary / Randomize /
              Sonify, scene chips), then move a knob, hit a pad or move a control on an OSC
              controller (any address outside /opsia).
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {sessionRows.length > 0 && (
                <Group
                  title="this session"
                  hint="Saved in this session's file : this piece's own controller setup. A load brings them, New clears them, Generate keeps them, scenes never touch them. On an input they use, they stand in for this computer's mappings."
                  action={{ label: 'copy to computer', title: "Copy the session's mappings to this computer (every session) : they stay in the session too", run: () => { copyAll(); showToast("The session's mappings are on this computer too", 'ok') } }}
                >
                  {sessionRows.map((r) => (
                    <MapRow key={r.key} r={r} onMove={() => moveMapping(r.kind, r.id, 'computer')} />
                  ))}
                </Group>
              )}
              {knobRows.length > 0 && (
                <Group title="macro knobs" hint="A Macro knob's MIDI CC stays on the knob itself : it travels with the session and its scenes, whatever Learn into says (as it always did). OSC learned on a knob follows Learn into.">
                  {knobRows.map((r) => (
                    <MapRow key={r.key} r={r} />
                  ))}
                </Group>
              )}
              {computerRows.length > 0 && (
                <Group
                  title="this computer"
                  hint="This computer's mappings : every session on it (kept apart from session files). Greyed : a mapping of this session on the same input stands in for it while this session is on."
                  action={{ label: 'move all to session', title: "Move every one of this computer's mappings into this session (saved with it, gone from this computer)", run: () => { moveAll(); showToast("This computer's mappings moved into the session (save it to keep them)", 'ok') } }}
                >
                  {computerRows.map((r) => (
                    <MapRow key={r.key} r={r} onMove={() => moveMapping(r.kind, r.id, 'session')} />
                  ))}
                </Group>
              )}
              {hosts.size > 0 && (
                <Group
                  title="OSC controllers"
                  hint="Learned OSC controls answer their controller in its own address and range (a fader follows scene recalls, modulators and Generate, like a motorized fader) : at the IP it sent from, on the reply port you set here. Off until a port is set; on / off per controller."
                >
                  {[...hosts].map(([host, n]) => (
                    <ReplyRow key={host || '?'} host={host} n={n} reply={replies[host]} set={(patch) => setReply(host, patch)} />
                  ))}
                </Group>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Group({ title, hint, action, children }: { title: string; hint: string; action?: { label: string; title: string; run: () => void }; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-px">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 cursor-help font-mono text-[9px] uppercase tracking-wide text-muted" title={hint}>
          {title}
        </span>
        <div className="flex-1" />
        {action && (
          <button onClick={action.run} className="shrink-0 font-mono text-[9px] text-muted hover:text-accent" title={action.title}>
            {action.label}
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

const TAG = 'w-7 shrink-0 rounded px-0.5 text-center font-mono text-[8px] leading-[14px]'

function MapRow({ r, onMove }: { r: Row; onMove?: () => void }): JSX.Element {
  const label = triggerLabel(r.id)
  const gone = label.includes('(gone)')
  const osc = r.b.kind === 'osc' ? r.b : null
  return (
    <div
      className={`flex min-w-0 flex-col rounded bg-panel2/40 px-1.5 py-0.5 ${r.silenced ? 'opacity-45' : ''}`}
      title={r.silenced ? 'Replaced by this session : a session mapping on the same input stands in for it while this session is on' : gone ? 'Its target is not here (a rule not on this computer, a scene the session has not) : it does nothing' : undefined}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={`${TAG} ${osc ? 'bg-accent2/20 text-accent2' : 'bg-accent/15 text-accent'}`}>{osc ? 'OSC' : 'MIDI'}</span>
        <span className={`min-w-0 flex-1 truncate font-mono text-[10px] ${gone ? 'text-muted line-through' : ''}`}>{label}</span>
        <span className="min-w-0 max-w-[45%] shrink truncate font-mono text-[9px] text-accent2" title={describeAnyBinding(r.b)}>
          {describeAnyBinding(r.b)}
        </span>
        {onMove && (
          <button
            onClick={onMove}
            className="shrink-0 font-mono text-[10px] text-muted hover:text-accent"
            title={r.scope === 'session' ? 'Move it to this computer (every session)' : 'Move it into this session (saved with it)'}
          >
            {r.scope === 'session' ? '↓' : '↑'}
          </button>
        )}
        <button onClick={r.clear} className="shrink-0 font-mono text-[10px] text-muted hover:text-danger" title="Clear this mapping">
          ×
        </button>
      </div>
      {r.silenced && <span className="pl-8 font-mono text-[8.5px] text-muted">replaced by this session</span>}
      {osc && <OscRange b={osc} scope={r.scope as MappingScope} id={r.id} />}
    </div>
  )
}

// An OSC mapping's range : what the controller's value moves over (calibrated
// when it was learned), typed here.
function OscRange({ b, scope, id }: { b: OscBinding; scope: MappingScope; id: string }): JSX.Element {
  const setOscBinding = useStore((s) => s.setOscBinding)
  const [lo, setLo] = useState(fmtNum(b.min))
  const [hi, setHi] = useState(fmtNum(b.max))
  useEffect(() => setLo(fmtNum(b.min)), [b.min])
  useEffect(() => setHi(fmtNum(b.max)), [b.max])
  const commit = (): void => {
    const min = Number(lo), max = Number(hi)
    if (lo.trim() === '' || hi.trim() === '' || !Number.isFinite(min) || !Number.isFinite(max) || min === max) {
      setLo(fmtNum(b.min))
      setHi(fmtNum(b.max))
      return
    }
    if (min === b.min && max === b.max) return
    setOscBinding(id, { ...b, min: Math.min(min, max), max: Math.max(min, max) }, scope)
  }
  const box = 'input box-content w-[6ch] px-1 py-0 text-right font-mono text-[9px] tabular-nums'
  const keys = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
  }
  return (
    <div className="flex min-w-0 items-center gap-1 pl-8 font-mono text-[9px] text-muted">
      <span title="Which value of the message it reads (a message with no number there is a press)">value {b.arg + 1}</span>
      <span>·</span>
      <input className={box} value={lo} onChange={(e) => setLo(e.target.value)} onBlur={commit} onKeyDown={keys} title="The controller's value for the bottom of the control" />
      <span>..</span>
      <input className={box} value={hi} onChange={(e) => setHi(e.target.value)} onBlur={commit} onKeyDown={keys} title="The controller's value for the top of the control" />
      <span title={b.bool ? 'It sends true / false : answers go back so' : b.int ? 'It sends whole numbers : answers go back as whole numbers' : 'It sends decimals'}>{b.bool ? 'T/F' : b.int ? 'int' : ''}</span>
    </div>
  )
}

function fmtNum(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000)
}

// One OSC controller : its IP, how many mappings, where its answers go.
function ReplyRow({ host, n, reply, set }: { host: string; n: number; reply?: { port: number; on: boolean }; set: (patch: Partial<{ port: number; on: boolean }>) => void }): JSX.Element {
  const [port, setPort] = useState(reply?.port ? String(reply.port) : '')
  useEffect(() => setPort(reply?.port ? String(reply.port) : ''), [reply?.port])
  const commit = (): void => {
    const p = parseInt(port, 10)
    if (port === '') {
      if (reply?.port) set({ port: 0 })
    } else if (Number.isInteger(p) && p >= 1 && p <= 65535) {
      if (p !== reply?.port) set({ port: p })
    } else setPort(reply?.port ? String(reply.port) : '')
  }
  const live = !!reply && reply.on && reply.port > 0
  if (!host)
    return (
      <div className="rounded bg-panel2/40 px-1.5 py-0.5 font-mono text-[9px] text-muted" title="Learned before Palinopsia knew who sent it : learn them again to get answers">
        sender unknown · {n} mapping{n > 1 ? 's' : ''} (learn again to answer)
      </div>
    )
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded bg-panel2/40 px-1.5 py-0.5 font-mono text-[9px]">
      <span className="min-w-0 truncate text-text" title={`The controller at ${host}`}>{host}</span>
      <span className="shrink-0 text-muted" title={`${n} mapping${n > 1 ? 's' : ''} learned from it`}>×{n}</span>
      <div className="flex-1" />
      <span className="shrink-0 uppercase text-muted">reply</span>
      <input
        value={port}
        placeholder="port"
        onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="input box-content px-1 py-0 text-right text-[10px] tabular-nums"
        style={{ width: PORT_W }}
        title="The UDP port this controller listens on (TouchOSC : its incoming port). Empty : no answers"
      />
      <button
        onClick={() => set({ on: !(reply?.on ?? true) })}
        disabled={!reply?.port}
        className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] transition-colors disabled:opacity-40 ${live ? 'bg-accent2/20 text-accent2 ring-1 ring-accent2' : 'bg-panel2 text-muted hover:text-text'}`}
        title={live ? 'Answers on : its learned controls follow Palinopsia. Click to stop' : 'Answers off : click to send them again'}
      >
        {live ? 'on' : 'off'}
      </button>
    </div>
  )
}
