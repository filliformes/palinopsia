// The Lights page (key T) : DMX fixtures mapped onto the picture. The room on the
// left (fixtures, outputs, shows, light scenes), the map in the middle (each
// fixture drawn over the picture it takes its light from : drag it, and it takes
// its pixels elsewhere), the selected fixture's inspector on the right (its patch,
// what it shows, its tuning) and a lighting console along the bottom (the grand
// master, the speed, the fades, Black). The model is shared/lights.ts, the engine
// lights/lightEngine.ts.

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent as RMouseEvent, type ReactNode, type RefObject, type PointerEvent as RPointerEvent } from 'react'
import { useStore, modTargetKey } from '../store'
import type { ModTarget } from '@shared/types'
import {
  dipOf,
  BANDS,
  CLASSIC_EFFECTS,
  DIGITAL_EFFECTS,
  ORDERS,
  fixtureChannels,
  fixturePixels,
  fixtureSpans,
  LAYOUTS,
  layoutTokens,
  tokenLabel,
  tokenWidth,
  TUNE_DEFAULT,
  GROUP_TUNE_DEFAULT,
  LIGHT_MASTER_FIELDS,
  LIGHT_MOD_RANGE,
  LOOK_DEFAULT,
  SAMPLES,
  type LightCorner,
  type LightBand,
  type LightEffect,
  type LightOrder,
  type LightOutput,
  type LightSample,
  type LightFixture,
  type LightKind,
  type LightLook,
  type LightModField,
  type LightOutputKind,
  type LightSourceKind,
  type LightTune
} from '@shared/lights'
import { lightRuntime } from '../lights/lightRuntime'
import { fixturePoints, matrixCells, paletteOf, stripPath } from '../lights/lightEngine'
import { middleOf, readSetup, setupText, shifted } from '../lights/lightStore'
import { readOfl } from '../lights/ofl'
import { RULES } from '../lights/lightFx'
import { BUILTIN_PROFILES } from '@shared/lightProfiles'
import { enttec } from '../lights/enttec'
import { addressesInRow, RdmController, uidText, type RdmDevice } from '../lights/rdm'
import { profileForFootprint } from '../lights/lightStore'
import { LIGHT_SHOWS } from '../lights/lightShows'
import { AssignRow } from './AutoControls'
import { LightCueButtons, LightCueList } from './LightCues'
import { registerLiveOverlay } from './liveOverlay'
import { MidiLearnOverlay } from './MidiLearnOverlay'

const KIND_LABEL: Record<LightKind, string> = { strip: 'bar', ring: 'ring', spot: 'spot', matrix: 'matrix' }
const OUT_LABEL: Record<LightOutputKind, string> = { enttec: 'Enttec USB Pro', artnet: 'Art-Net', sacn: 'sACN', wled: 'WLED' }
const EFFECT_LABEL: Record<LightEffect, string> = {
  none: 'none', chase: 'chase', wave: 'wave', pulse: 'pulse', sparkle: 'sparkle', audio: 'sound', beat: 'beat', presence: 'presence',
  automaton: 'automaton', life: 'game of life', fireflies: 'fireflies', noise: 'clouds', hold: 'sample and hold', glitch: 'glitch',
  binary: 'binary count', echo: 'echo', afterimage: 'afterimage', scan: 'tape head', bits: 'eight colors'
}
/** What each effect's sliders are called (none : it has no such slider). */
const FX_UI: Record<LightEffect, { rate?: string; width?: string; travels?: boolean; dir?: boolean; secs?: boolean }> = {
  none: {}, chase: { rate: 'rate', width: 'width', travels: true, dir: true }, wave: { rate: 'rate', width: 'width', travels: true, dir: true },
  pulse: { rate: 'rate', travels: true }, sparkle: { rate: 'rate', travels: true }, audio: {}, beat: { rate: 'per beat', travels: true },
  presence: { width: 'near' },
  automaton: { rate: 'steps', width: 'cell', travels: true, dir: true }, life: { rate: 'steps', width: 'cell' },
  fireflies: { rate: 'tempo', travels: true }, noise: { rate: 'drift', width: 'size' }, hold: { rate: 'looks', travels: true },
  glitch: { rate: 'breaks' }, binary: { rate: 'per beat', travels: true, dir: true }, echo: { width: 'delay', secs: true },
  afterimage: { width: 'lasts', secs: true }, scan: { rate: 'speed', dir: true }, bits: {}
}
const ORDER_LABEL: Record<LightOrder, string> = {
  room: 'through the room', ltr: 'light by light, left to right', center: 'light by light, from the center', random: 'light by light, at random', oddeven: 'odd and even'
}
const BAND_LABEL: Record<LightBand, string> = { level: 'all', low: 'lows', mid: 'mids', high: 'highs' }
const EFFECT_HINT: Record<LightEffect, string> = {
  none: 'No effect : the light as its source gives it.',
  chase: 'A band of light running across the room (angle : its direction, width : the band).',
  wave: 'Waves of light passing through the room (width : their length).',
  pulse: 'The whole light breathing.',
  sparkle: 'Pixels twinkling at random (rate : how often).',
  audio: 'As bright as the sound is loud (all of it, or its lows, mids or highs).',
  beat: 'A flash on the beat (rate : flashes a beat). Light by light : a step chase, one place of the order on each flash.',
  presence: 'Lit near the people the Body page tracks (near : how near), dim away from them. The camera must be on (Body page).',
  automaton: 'A cellular automaton : a row of cells across the room, each living or dying by its two neighbors (the rule), its past trailing behind it. Light by light, each light is a cell.',
  life: 'The Game of Life on a grid over the room : cells are born, crowd and die; new ones land when it settles.',
  fireflies: 'Each pixel blinks at its own tempo; little by little they fall into step, then drift apart again.',
  noise: 'Slow clouds of light drifting through the room (size : how large).',
  hold: 'Each pixel freezes the color it saw, then looks again now and then (looks : how often).',
  glitch: 'Blocks of wrong colors breaking in : pure primaries, negatives, pieces read from the wrong place.',
  binary: 'The lights count the beats in binary : each light a bit (light by light), or eight bits across the room.',
  echo: 'The source as it was a moment ago (delay : how long ago).',
  afterimage: 'When the picture changes, the light flares the complement of what was there, fading (lasts : how long).',
  scan: 'The light reads the picture at a place that slides across it, like a tape head (a picture or layer source).',
  bits: 'One bit a channel : red, green and blue each fully on or off.'
}

const SAMPLE_HINT: Record<LightSample, string> = {
  average: 'The average of its patch of picture : calm, but a busy picture can go beige',
  vivid: 'The most colorful part of its patch : the lights keep the picture\u2019s colors',
  bright: 'The brightest part of its patch : the highlights carry, the dark stays dark'
}

const btn = (on: boolean): string =>
  `rounded border px-2 py-1 font-mono text-[10px] transition-colors ${
    on ? 'border-accent bg-accent/15 text-accent' : 'border-border bg-panel3/70 text-muted hover:bg-panel3 hover:text-text'
  }`

// A small "i" that reveals its explanation on hover (as on the Output page).
function InfoDot({ text }: { text: string }): JSX.Element {
  return (
    <span
      title={text}
      className="flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-border font-mono text-[8px] text-muted hover:border-accent hover:text-accent"
    >
      i
    </span>
  )
}

/** An LED value back to how it looks (the LEDs are linear, a screen is not). */
const show = (c: number): number => Math.round(Math.pow(Math.max(0, Math.min(1, c)), 1 / 2.2) * 255)

export function LightsPage({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null> }): JSX.Element {
  const rig = useStore((s) => s.lightRig)
  const sel = useStore((s) => s.lightSel)
  const picked = useStore((s) => s.lightPicked)
  const setOpen = useStore((s) => s.setLightsPageOpen)
  const backToOutput = useStore((s) => s.outputPageOpen && !s.outputPageWindow)
  const selected = rig.fixtures.find((f) => f.id === sel) ?? null

  // Keys while the page is up : Delete removes the picked fixtures, the arrows
  // move them (Shift : farther), Ctrl+D duplicates the selected one, Esc closes the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const st = useStore.getState()
      // (a page opened over this one, or MIDI Learn : the keys are theirs)
      if ((st.sonifyPageOpen && !st.sonifyPageWindow) || st.worldPageOpen || (st.sequencePageOpen && !st.sequencePageWindow) || (st.bodyPageOpen && !st.bodyPageWindow) || st.resolumePageOpen || st.sourceEditorOpen || st.midiLearn !== null) return
      const f = st.lightRig.fixtures.find((x) => x.id === st.lightSel)
      if (!f) return
      const ids = st.lightPicked.length ? st.lightPicked : [f.id]
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); ids.forEach((id) => st.removeLightFixture(id)); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); e.stopPropagation(); st.duplicateLightFixture(f.id); return }
      const step = e.shiftKey ? 0.05 : 0.005
      const d = e.key === 'ArrowLeft' ? [-step, 0] : e.key === 'ArrowRight' ? [step, 0] : e.key === 'ArrowUp' ? [0, -step] : e.key === 'ArrowDown' ? [0, step] : null
      if (!d) return
      e.preventDefault()
      e.stopPropagation()
      st.updateLightFixtures(st.lightRig.fixtures.filter((q) => ids.includes(q.id)).map((q) => [q.id, shifted(q, d[0], d[1])]))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      <header className="flex items-center gap-4 border-b border-border bg-panel px-4 py-2">
        <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.2em]">Lights</span>
        <Status />
        <div className="flex-1" />
        <button
          onClick={() => { setOpen(false); if (!backToOutput && !useStore.getState().outputPageWindow) useStore.getState().setOutputPageOpen(true) }}
          className="rounded border border-border px-3 py-1 font-mono text-[11px] text-muted hover:text-accent"
          title="Back to the Output page (where the LIGHTS button is)"
        >
          ← back to Output
        </button>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto border-r border-border bg-panel p-2">
          <SetupList />
          <FixtureList />
          <OutputList />
          <GroupList />
          <ShowList />
          <SceneList />
          <Settings />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col bg-black/40">
          <MapView canvasRef={canvasRef} />
        </main>
        <aside className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto border-l border-border bg-panel p-2">
          {picked.length > 1 ? <ManyInspector ids={picked} /> : selected ? <Inspector key={selected.id} f={selected} /> : <SetupGuide />}
        </aside>
      </div>
      <Console />
    </div>
  )
}

// ── the status line ──────────────────────────────────────────────────────────
function Status(): JSX.Element {
  const rig = useStore((s) => s.lightRig)
  const setRig = useStore((s) => s.setLightRig)
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 500)
    return () => window.clearInterval(id)
  }, [])
  const st = lightRuntime.stats
  return (
    <div className="flex items-center gap-2 font-mono text-[10px] text-muted">
      <button
        onClick={() => setRig({ on: !rig.on })}
        className={btn(rig.on)}
        title="Send to the lights. Off : nothing goes out (they get one last dark frame), and the page still shows what they would do"
      >
        {rig.on ? '◉ sending' : 'not sending'}
      </button>
      <IfaceStatus />
      <span title="DMX frames sent in the last second, and the universes going out">
        {!rig.fixtures.length ? 'no lights yet' : `${rig.on ? `${st.fps} frames a second · ` : ''}${rig.fixtures.length} light${rig.fixtures.length === 1 ? '' : 's'}`}
      </span>
    </div>
  )
}

/** The first interface, in words : found or not (an Enttec), or where it sends. */
function IfaceStatus(): JSX.Element | null {
  const outputs = useStore((s) => s.lightRig.outputs)
  const o = outputs.find((x) => x.enabled) ?? outputs[0]
  if (!o) return <span className="text-muted">no interface yet</span>
  if (o.kind !== 'enttec') return <span title="Where the DMX goes"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-400 align-middle" />{OUT_LABEL[o.kind]}{o.host ? ` to ${o.host}` : ''}</span>
  const s = enttec.status(o.index)
  const ok = s.status === 'open'
  return (
    <span title={ok ? 'The Enttec DMX USB Pro is connected' : s.status === 'unsupported' ? 'This build has no serial ports' : 'Plug the Enttec DMX USB Pro into a USB port : it is found by itself, within two seconds'}>
      <span className={`mr-1 inline-block h-2 w-2 rounded-full align-middle ${ok ? 'bg-emerald-400' : s.status === 'error' ? 'bg-red-400' : 'bg-yellow-400'}`} />
      {ok ? 'Enttec connected' : s.status === 'error' ? `Enttec : ${s.error}` : 'Enttec not found : plug it in'}
    </span>
  )
}

// ── a section ────────────────────────────────────────────────────────────────
function Section({ title, info, actions, children, defaultCollapsed = false }: { title: string; info?: string; actions?: ReactNode; children: ReactNode; defaultCollapsed?: boolean }): JSX.Element {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  return (
    <div className="rounded-md border border-border bg-panel2">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button onClick={() => setCollapsed((c) => !c)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" title={collapsed ? `Expand ${title}` : `Collapse ${title}`}>
          <span className={`font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>
          <span className="truncate font-mono text-[9px] uppercase tracking-wide text-muted">{title}</span>
        </button>
        {actions}
        {info && <InfoDot text={info} />}
      </div>
      {!collapsed && <div className="flex min-w-0 flex-col gap-1.5 px-2 pb-2">{children}</div>}
    </div>
  )
}

// ── the setups : the whole page by name, to switch rooms under one project ──
function SetupList(): JSX.Element {
  const setups = useStore((s) => s.lightSetups)
  const cur = useStore((s) => s.lightSetupName)
  const [name, setName] = useState(cur)
  const [note, setNote] = useState('')
  useEffect(() => setName(cur), [cur])
  const st = useStore.getState
  const toFile = async (): Promise<void> => {
    const one = st().currentLightSetup(name.trim() || undefined)
    const r = await window.api.lightSetupSave(setupText(one), one.name)
    setNote(r.ok ? 'saved to a file' : r.error ? `not saved : ${r.error}` : '')
  }
  const fromFile = async (): Promise<void> => {
    const r = await window.api.lightSetupOpen()
    if (!r.ok || !r.text) { if (r.error) setNote(r.error); return }
    let raw: unknown = null
    try { raw = JSON.parse(r.text) } catch { /* not JSON */ }
    const one = readSetup(raw, r.name || 'Setup')
    if (!one) { setNote('that file is not a light setup'); return }
    st().applyLightSetup(one)
    setNote(`${one.name} : ${one.rig.fixtures.length} light${one.rig.fixtures.length === 1 ? '' : 's'}`)
  }
  return (
    <Section
      title={cur ? `Setup · ${cur}` : 'Setups'}
      defaultCollapsed={setups.length === 0}
      info="A light setup is this whole page : the lights and where they are, the outputs, the groups, and what they show (looks, cues, masters). Keep several by name and switch between them without touching the picture : one project's visuals, another room's lights. Loading one keeps the one it replaces under its own name first, so nothing is lost. As files too, to carry to another computer."
    >
      <div className="flex gap-1">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="a name for these lights" className="min-w-0 flex-1 rounded border border-border bg-panel px-1.5 py-1 font-mono text-[10px]" />
        <button className={btn(false)} onClick={() => { st().saveLightSetup(name); setNote('') }} title="Keep the lights as they are now under this name (a name already there : replaced)">save</button>
      </div>
      {setups.map((x) => (
        <div key={x.name} className="flex items-center gap-1">
          <button
            onClick={() => { st().loadLightSetup(x.name); setNote('') }}
            className={`min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left font-mono text-[10px] ${x.name === cur ? 'bg-accent/15 text-accent' : 'text-text hover:bg-panel3/60'}`}
            title="Switch to this setup (the picture stays; the lights you leave are kept under their name)"
          >
            {x.name} <span className="text-muted">{x.rig.fixtures.length}</span>
          </button>
          <button className="px-1 font-mono text-[11px] text-muted hover:text-red-400" onClick={() => st().deleteLightSetup(x.name)} title="Forget this setup (the lights on the page stay)">×</button>
        </div>
      ))}
      <div className="flex gap-1">
        <button className={`flex-1 ${btn(false)}`} onClick={() => void fromFile()} title="Open a light setup file">open a file…</button>
        <button className={`flex-1 ${btn(false)}`} onClick={() => void toFile()} title="Save these lights to a file (to carry to another computer)">save to a file…</button>
      </div>
      {note && <p className="font-mono text-[9px] leading-snug text-muted">{note}</p>}
    </Section>
  )
}

// ── the room : lights, outputs, shows, cues, settings ────────────────────
function FixtureList(): JSX.Element {
  const rig = useStore((s) => s.lightRig)
  const sel = useStore((s) => s.lightSel)
  const picked = useStore((s) => s.lightPicked)
  const add = useStore((s) => s.addLightFixture)
  const setSel = useStore((s) => s.setLightSel)
  const toggle = useStore((s) => s.toggleLightPick)
  return (
    <Section title="Lights" info="Every light in the room. Add one, then place it on the map over the part of the picture it should take its light from. Shift or Ctrl + click picks several : a look, a tuning or a show then goes to all of them.">
      <div className="grid grid-cols-2 gap-1">
        <button className={btn(false)} onClick={() => add('strip')} title="An LED bar : a row of pixels along a line on the picture">+ bar</button>
        <button className={btn(false)} onClick={() => add('spot')} title="A single light : a small RGB spot, a PAR, a wash">+ spot</button>
        <button className={btn(false)} onClick={() => add('ring')} title="An LED ring : pixels around a circle">+ ring</button>
        <button className={btn(false)} onClick={() => add('matrix')} title="An LED matrix : a grid of pixels over a rectangle of the picture">+ matrix</button>
      </div>
      {rig.fixtures.length === 0 && <p className="font-mono text-[10px] leading-snug text-muted">No lights yet. The Set up guide on the right adds a whole chain in one go; or add them here one by one.</p>}
      <div className="flex flex-col gap-0.5">
        {rig.fixtures.map((f) => (
          <FixtureRow
            key={f.id}
            f={f}
            on={f.id === sel}
            also={f.id !== sel && picked.includes(f.id)}
            onClick={(e) => (e.shiftKey || e.ctrlKey || e.metaKey ? toggle(f.id) : setSel(f.id === sel && picked.length <= 1 ? null : f.id))}
          />
        ))}
      </div>
    </Section>
  )
}

function GroupList(): JSX.Element {
  const groups = useStore((s) => s.lightRig.groups)
  const picked = useStore((s) => s.lightPicked)
  const levels = useStore((s) => s.lightsSession.groups)
  const [editing, setEditing] = useState<string | null>(null)
  const [openMod, setOpenMod] = useState<string | null>(null)
  const st = useStore.getState
  return (
    <Section
      title="Groups"
      info="Lights that play together. Pick lights (Shift or Ctrl + click on the map or in the list), then + group. Click a group to pick its lights : a look, a tuning or a show then goes to all of them. Its fader (here, and on the console) dims them together, after their own level; it takes a modulator, MIDI and OSC. The groups are this computer's, their faders the session's."
      actions={<button className={`${btn(false)} disabled:opacity-40`} disabled={!picked.length} onClick={() => st().addLightGroup(picked)} title="A group of the lights picked now">+ group</button>}
    >
      {groups.length === 0 && <p className="font-mono text-[10px] leading-snug text-muted">None yet. Pick some lights, then + group.</p>}
      {groups.map((g) => {
        const on = g.members.length > 0 && g.members.length === picked.length && g.members.every((m) => picked.includes(m))
        return (
          <div key={g.id} className="flex flex-col gap-0.5 rounded border border-border p-1">
            <div className="flex items-center gap-1">
              {editing === g.id ? (
                <input
                  autoFocus
                  defaultValue={g.name}
                  onBlur={(e) => { st().updateLightGroup(g.id, { name: e.target.value }); setEditing(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  className="min-w-0 flex-1 rounded border border-border bg-panel px-1 py-0.5 font-mono text-[10px]"
                />
              ) : (
                <button
                  onClick={() => st().setLightPicked(g.members)}
                  onDoubleClick={() => setEditing(g.id)}
                  className={`min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left font-mono text-[10px] ${on ? 'bg-accent/15 text-accent' : 'text-text hover:bg-panel3/60'}`}
                  title="Click : pick its lights · double-click : rename"
                >
                  {g.name} <span className="text-muted">{g.members.length}</span>
                </button>
              )}
              <button
                disabled={!picked.length || on}
                onClick={() => st().updateLightGroup(g.id, { members: picked })}
                className="px-1 font-mono text-[9px] text-muted hover:text-accent disabled:opacity-30"
                title="Its lights become the ones picked now"
              >
                set
              </button>
              <button className="px-1 font-mono text-[11px] text-muted hover:text-red-400" onClick={() => st().removeLightGroup(g.id)} title="Remove this group (its lights stay)">×</button>
            </div>
            <LightSlider
              label="fader"
              fixture={`grp:${g.id}`}
              field="level"
              value={levels?.[g.id] ?? 1}
              min={0} max={1} step={0.01}
              onChange={(v) => st().setLightGroupLevel(g.id, v)}
              reset={1}
              openMod={openMod}
              setOpenMod={setOpenMod}
              title={`The ${g.name} group's fader : its lights, after their own level`}
            />
          </div>
        )
      })}
    </Section>
  )
}

function FixtureRow({ f, on, also, onClick }: { f: LightFixture; on: boolean; also: boolean; onClick: (e: RMouseEvent) => void }): JSX.Element {
  const swatch = useRef<HTMLSpanElement | null>(null)
  const outputs = useStore((s) => s.lightRig.outputs)
  // the swatch : its first pixel's color now
  useEffect(() => {
    let raf = 0
    const draw = (): void => {
      const c = lightRuntime.last?.colors.get(f.id)
      if (swatch.current) swatch.current.style.background = c ? `rgb(${show(c[0])},${show(c[1])},${show(c[2])})` : 'transparent'
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [f.id])
  const out = outputs.find((o) => o.id === f.out)
  const ch = fixtureChannels(f)
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-left font-mono text-[10px] ${on ? 'bg-accent/15 text-accent' : also ? 'bg-accent/[0.07] text-accent/80' : 'text-text hover:bg-panel3/60'}`}
      title={`${KIND_LABEL[f.kind]} · ${ch} channels${out ? ` on ${out.name}` : ' (not patched)'}`}
    >
      <span ref={swatch} className="h-2.5 w-2.5 shrink-0 rounded-sm border border-border" />
      <span className="min-w-0 flex-1 truncate">{f.name}</span>
      <span className="shrink-0 text-[9px] text-muted">{out ? `${out.kind === 'enttec' ? '' : `u${f.universe} `}${f.address}` : '—'}</span>
    </button>
  )
}

function OutputList(): JSX.Element {
  const outputs = useStore((s) => s.lightRig.outputs)
  const add = useStore((s) => s.addLightOutput)
  const update = useStore((s) => s.updateLightOutput)
  const remove = useStore((s) => s.removeLightOutput)
  const [found, setFound] = useState<Record<string, { busy: boolean; list: Array<{ ip: string; label: string }> } | undefined>>({})
  const [sure, setSure] = useState<string | null>(null)
  const patched = useStore((s) => s.lightRig.fixtures)
  const find = async (o: LightOutput): Promise<void> => {
    setFound((x) => ({ ...x, [o.id]: { busy: true, list: x[o.id]?.list ?? [] } }))
    let list: Array<{ ip: string; label: string }> = []
    try {
      const r = await window.api.lightDiscover()
      list = o.kind === 'wled'
        ? r.wled.map((w) => ({ ip: w.ip, label: w.name }))
        : r.artnet.map((n) => ({ ip: n.ip, label: `${n.name || n.long || 'node'}${n.universes.length ? ` · universe ${n.universes.join(', ')}` : ''}` }))
    } catch { /* main busy : nothing found */ }
    setFound((x) => ({ ...x, [o.id]: { busy: false, list } }))
  }
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 700)
    return () => window.clearInterval(id)
  }, [])
  return (
    <Section title="Outputs" info="Where the DMX goes : an Enttec DMX USB Pro plugged into this computer (one universe each), or the network (Art-Net, sACN, WLED). The patch is this computer's : it stays when you open another session.">
      <div className="grid grid-cols-2 gap-1">
        <button className={btn(false)} onClick={() => add('enttec')} title="An Enttec DMX USB Pro (or compatible) plugged in by USB : one DMX universe">+ Enttec USB</button>
        <button className={btn(false)} onClick={() => add('artnet')} title="Art-Net : a DMX node or a pixel controller on the network">+ Art-Net</button>
        <button className={btn(false)} onClick={() => add('sacn')} title="sACN (E1.31) : a node, a pixel controller or a console on the network">+ sACN</button>
        <button className={btn(false)} onClick={() => add('wled')} title="WLED : LED strips on an ESP32, over Wi-Fi (170 LEDs a universe)">+ WLED</button>
      </div>
      {outputs.map((o) => {
        const s = o.kind === 'enttec' ? enttec.status(o.index) : null
        const dot = !o.enabled ? 'bg-panel3' : s ? (s.status === 'open' ? 'bg-emerald-400' : s.status === 'error' ? 'bg-red-400' : 'bg-yellow-400') : 'bg-emerald-400'
        return (
          <div key={o.id} className="flex flex-col gap-1 rounded border border-border p-1.5">
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
              <input
                value={o.name}
                onChange={(e) => update(o.id, { name: e.target.value })}
                className="min-w-0 flex-1 rounded border border-border bg-panel px-1 py-0.5 font-mono text-[10px]"
              />
              <button className={btn(o.enabled)} onClick={() => update(o.id, { enabled: !o.enabled })} title="Send to this output">{o.enabled ? 'on' : 'off'}</button>
              <button
                className={`px-1 font-mono text-[11px] hover:text-red-400 ${sure === o.id ? 'text-red-400' : 'text-muted'}`}
                onClick={() => { if (sure !== o.id && patched.some((f) => f.out === o.id)) setSure(o.id); else { remove(o.id); setSure(null) } }}
                onBlur={() => setSure(null)}
                title="Remove this output (its lights wait, unpatched). With lights on it : a second click"
              >
                {sure === o.id ? 'sure ?' : '×'}
              </button>
            </div>
            <div className="flex items-center gap-1.5 font-mono text-[9px] text-muted">
              <label
                className="flex items-center gap-1"
                title="Held back this long before it goes out. The lights answer at once and a projector shows the picture two or three frames late : about 40 ms keeps them together (0 for lights alone)"
              >
                delay
                <NumBox value={o.delay} min={0} max={1000} onCommit={(v) => update(o.id, { delay: v })} className="w-12" />
                ms
              </label>
              {o.kind === 'artnet' && (
                <button
                  className={btn(o.sync)}
                  onClick={() => update(o.id, { sync: !o.sync })}
                  title="An ArtSync after each frame : the nodes that know it show all their universes at the same moment (leave it off if a node stops or flickers)"
                >
                  sync
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 font-mono text-[9px] text-muted">
              <span className="shrink-0">{OUT_LABEL[o.kind]}</span>
              {o.kind === 'enttec' ? (
                <>
                  <label className="flex items-center gap-1" title="With several Pros plugged in : which one (in the order the computer lists them)">
                    #
                    <input
                      type="number" min={1} max={8} value={o.index + 1}
                      onChange={(e) => update(o.id, { index: Math.max(0, Math.min(7, (Number(e.target.value) || 1) - 1)) })}
                      className="w-9 rounded border border-border bg-panel px-1 py-0.5 text-[10px] text-text"
                    />
                  </label>
                  <div className="flex-1" />
                  <button className={btn(false)} onClick={() => enttec.rescan()} title="Look for the Pro again now (it is looked for every two seconds anyway)">scan</button>
                </>
              ) : (
                <>
                  <TextBox
                    value={o.host}
                    placeholder={o.kind === 'sacn' ? 'multicast (or an IP)' : 'IP address'}
                    onCommit={(v) => update(o.id, { host: v })}
                    className="min-w-0 flex-1 rounded border border-border bg-panel px-1 py-0.5 text-[10px] text-text"
                    title={o.kind === 'sacn' ? 'Empty : multicast to each universe\'s group (239.255.x.y). An IP : sent to that device only.' : 'The device\'s IP address on this network'}
                  />
                  <button
                    className={btn(!!found[o.id]?.busy)}
                    onClick={() => void find(o)}
                    title={o.kind === 'wled' ? 'Look for WLED controllers on the network (they answer by name)' : 'Ask the network which Art-Net nodes are there (most sACN nodes answer too) : pick one instead of typing its address'}
                  >
                    {found[o.id]?.busy ? '…' : 'find'}
                  </button>
                </>
              )}
            </div>
            {o.kind === 'enttec' && (
              <span className={`font-mono text-[9px] leading-snug ${s?.status === 'open' ? 'text-emerald-400' : s?.status === 'error' ? 'text-red-400' : 'text-muted'}`}>
                {s?.status === 'open' ? `connected · ${s.frames} frames sent`
                  : s?.status === 'unsupported' ? 'this build has no serial ports'
                    : s?.status === 'error' ? `it would not open : ${s.error} (is another program using it ?)`
                      : !o.enabled ? 'off'
                        : s?.error === 'none plugged in' || !s?.error ? 'not found yet : plug it into a USB port' : `looking : ${s.error}`}
              </span>
            )}
            {found[o.id] && !found[o.id]!.busy && (
              <div className="flex flex-col gap-0.5">
                {found[o.id]!.list.length === 0 && <span className="font-mono text-[9px] text-muted">nothing answered (on this computer's networks)</span>}
                {found[o.id]!.list.map((n) => (
                  <button
                    key={n.ip}
                    onClick={() => { update(o.id, { host: n.ip }); setFound((x) => ({ ...x, [o.id]: undefined })) }}
                    className={`truncate rounded px-1 py-0.5 text-left font-mono text-[9px] ${o.host === n.ip ? 'text-accent' : 'text-text hover:bg-panel3/60'}`}
                    title="Send to this one"
                  >
                    {n.ip} · {n.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </Section>
  )
}

function ShowList(): JSX.Element {
  const apply = useStore((s) => s.applyLightShow)
  const n = useStore((s) => s.lightRig.fixtures.length)
  const picked = useStore((s) => s.lightPicked)
  const some = picked.length > 1 && picked.length < n
  return (
    <Section
      title={some ? `Shows · to the ${picked.length} picked` : 'Shows'}
      info="A look for every light at once, fading in over the cue fade time. Each one fits your room : its patterns run across the space, so every light takes its part from where it stands. With several lights picked (or a group), the show goes to them alone."
    >
      {([false, true] as const).map((dig) => (
        <div key={String(dig)} className="flex flex-col gap-1">
          <span className="font-mono text-[9px] uppercase tracking-wide text-muted" title={dig ? 'Memory, automata and errors : the lights as a small computer of their own' : 'Colors, gradients and movements across the room'}>{dig ? 'digital' : 'classic'}</span>
          <div className="grid grid-cols-2 gap-1">
            {LIGHT_SHOWS.filter((x) => !!x.digital === dig).map((x) => (
              <button key={x.id} disabled={!n} className={`${btn(false)} flex items-center gap-1.5 text-left disabled:opacity-40`} onClick={() => apply(x.id, some ? picked : undefined)} title={x.blurb}>
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full border border-border"
                  style={{ background: x.tint ? (x.tint.length > 1 ? `linear-gradient(90deg, ${x.tint.join(', ')})` : x.tint[0]) : 'conic-gradient(#e33, #ec3, #3c6, #36e, #c3c, #e33)' }}
                />
                <span className="min-w-0 flex-1 truncate">{x.label ?? x.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </Section>
  )
}

function SceneList(): JSX.Element {
  const save = useStore((s) => s.saveLightScene)
  return (
    <Section
      title="Light cues"
      info="Looks for the lights, apart from Palinopsia's scenes, played as cues : save what they show now, click a cue to bring it (over its fade), GO for the next, back for the one before. ⚙ : its own fade, a follow time (while the cues follow on, the next one goes by itself) and the Palinopsia scene it goes with (recalling that scene brings it). Double-click to rename. Saved with the session; the Seq page has them as a lane."
      actions={<button className={btn(false)} onClick={save} title="Save what the lights show now as a new cue">+ save</button>}
    >
      <LightCueButtons />
      <LightCueList />
    </Section>
  )
}

function Settings(): JSX.Element {
  const rig = useStore((s) => s.lightRig)
  const setRig = useStore((s) => s.setLightRig)
  return (
    <Section title="Settings" defaultCollapsed>
      <label className="flex items-center gap-2 font-mono text-[10px] text-muted" title="DMX frames a second (DMX itself tops out around 44)">
        <span className="w-16">frame rate</span>
        <input type="range" min={10} max={44} step={1} value={rig.fps} onChange={(e) => setRig({ fps: Number(e.target.value) })} className="min-w-0 flex-1 accent-accent" />
        <span className="w-8 text-right text-text">{rig.fps}</span>
      </label>
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[9px] uppercase tracking-wide text-muted">tuning is kept</span>
        <div className="flex gap-1">
          <button
            className={`flex-1 ${btn(rig.tuneScope === 'rig')}`}
            onClick={() => setRig({ tuneScope: 'rig' })}
            title="The tuning belongs to the lights themselves : it stays whatever session or cue you open"
          >
            on this computer
          </button>
          <button
            className={`flex-1 ${btn(rig.tuneScope === 'look')}`}
            onClick={() => setRig({ tuneScope: 'look' })}
            title="The tuning travels with the session and the cues : each look brings its own"
          >
            with the look
          </button>
        </div>
      </div>
    </Section>
  )
}

// ── RDM : the lights on the line answer back ─────────────────────────────────
// (kept while the page lives : found once, still there when the guide comes back)
let rdmFound: RdmDevice[] = []

function RdmSection(): JSX.Element {
  const outputs = useStore((s) => s.lightRig.outputs)
  const rigLights = useStore((s) => s.lightRig.fixtures)
  const pros = outputs.filter((o) => o.kind === 'enttec')
  const [outId, setOutId] = useState(pros[0]?.id ?? '')
  const out = pros.find((o) => o.id === outId) ?? pros[0]
  const [devs, setDevs] = useState<RdmDevice[]>(rdmFound)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const [blink, setBlink] = useState<number | null>(null)
  const ctl = useRef<RdmController | null>(null)
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => tick((x) => x + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  useEffect(() => { rdmFound = devs }, [devs])
  const open = !!out && enttec.status(out.index).status === 'open'
  const controller = async (): Promise<RdmController | null> => {
    if (!out) return null
    const t = enttec.rdm(out.index)
    if (!t) return null
    if (!ctl.current) ctl.current = new RdmController(t, await t.self())
    return ctl.current
  }
  // a blinking light stops when the panel goes
  const blinkRef = useRef<number | null>(null)
  blinkRef.current = blink
  useEffect(() => () => { const b = blinkRef.current; if (b !== null) void ctl.current?.identify(b, false) }, [])
  const run = async (label: string, job: (c: RdmController) => Promise<string>): Promise<void> => {
    const c = await controller()
    if (!c) { setNote('The Enttec is not connected.'); return }
    setBusy(label); setNote('')
    try { setNote(await job(c)) } catch (e) { setNote(`It stopped : ${(e as Error).message}`) } finally { setBusy('') }
  }
  const find = (): Promise<void> => run('looking', async (c) => {
    let n = 0
    const uids = await c.discover(() => { n++; setBusy(`found ${n}`) })
    const list: RdmDevice[] = []
    for (const u of uids) {
      setBusy(`asking ${list.length + 1} of ${uids.length}`)
      const d = await c.describe(u)
      if (d) list.push(d)
    }
    // in address order : as they would be patched
    list.sort((a, b) => a.address - b.address || a.uid - b.uid)
    setDevs(list)
    return uids.length === 0
      ? 'Nothing answered. Lights that do not speak RDM never answer : set those on their own menu. Check that the cable runs from the Pro to the first light, and that the last light has nothing after it (or a terminator).'
      : `${uids.length} answered${list.length < uids.length ? `, ${uids.length - list.length} would not say what it is` : ''}.`
  })
  const name = (d: RdmDevice): string => d.label || d.modelName || d.manufacturer || uidText(d.uid)
  const modeName = (d: RdmDevice): string => d.personalities.find((p) => p.n === d.personality)?.name ?? `mode ${d.personality}`
  const update = (uid: number, p: Partial<RdmDevice>): void => setDevs((l) => l.map((d) => (d.uid === uid ? { ...d, ...p } : d)))
  const setAddr = (d: RdmDevice, a: number): Promise<void> => run('setting', async (c) => {
    const okA = await c.setAddress(d.uid, a)
    if (okA) update(d.uid, { address: a })
    return okA ? `${name(d)} : address ${a}.` : `${name(d)} did not take the address.`
  })
  const setMode = (d: RdmDevice, n: number): Promise<void> => run('setting', async (c) => {
    const okM = await c.setPersonality(d.uid, n)
    const fp = d.personalities.find((p) => p.n === n)?.footprint || d.footprint
    if (okM) update(d.uid, { personality: n, footprint: fp })
    return okM ? `${name(d)} : ${d.personalities.find((p) => p.n === n)?.name ?? `mode ${n}`} (${fp} channels).` : `${name(d)} did not take the mode.`
  })
  const toggleBlink = (d: RdmDevice): Promise<void> => run('', async (c) => {
    const prev = blink
    if (prev !== null) await c.identify(prev, false)
    if (prev === d.uid) { setBlink(null); return '' }
    const okI = await c.identify(d.uid, true)
    setBlink(okI ? d.uid : null)
    return okI ? `${name(d)} is blinking.` : `${name(d)} does not blink on request.`
  })
  const inRow = (): Promise<void> => run('setting', async (c) => {
    const want = addressesInRow(devs)
    let done = 0
    for (let i = 0; i < devs.length; i++) {
      const a = want[i]
      if (a === null || devs[i].address === a) { if (a !== null) done++; continue }
      setBusy(`setting ${i + 1} of ${devs.length}`)
      if (await c.setAddress(devs[i].uid, a)) { done++; update(devs[i].uid, { address: a }) }
    }
    return `${done} of ${devs.length} addressed one after the other from 1${want.includes(null) ? ' (the rest would pass 512)' : ''}.`
  })
  const toMap = (): void => {
    if (!out) return
    const all = [...BUILTIN_PROFILES, ...useStore.getState().lightRig.profiles]
    useStore.getState().addLightsFromLine(out.id, devs.map((d) => {
      const pid = profileForFootprint(d.footprint)
      const p = all.find((x) => x.id === pid) ?? { id: '', name: '', kind: 'spot' as const, head: '', layout: Array.from({ length: Math.max(1, d.footprint) }, () => '0').join(' '), tail: '' }
      return { name: name(d), address: d.address, profile: p }
    }))
    setNote(`${devs.length} light${devs.length === 1 ? '' : 's'} on the map, at their own addresses. A kind it could not guess holds its channels at 0 : pick its kind.`)
  }
  const onMap = (d: RdmDevice): boolean => rigLights.some((f) => f.out === out?.id && f.address === d.address)
  const move = (i: number, dir: -1 | 1): void => setDevs((l) => { const c = l.slice(); const j = i + dir; if (j < 0 || j >= c.length) return l; [c[i], c[j]] = [c[j], c[i]]; return c })
  return (
    <Section
      title="Ask the lights (RDM)"
      defaultCollapsed={devs.length === 0}
      info="Lights that speak RDM answer back over the DMX cable : the Enttec asks who is on the line, and each says what it is, its mode (how many channels) and its address. From here : make one blink to find it in the room, change its mode, set its address, address them all one after the other, put them on the map. Lights that do not speak RDM do not answer : set those on their own menu."
    >
      {pros.length > 1 && (
        <select value={out?.id ?? ''} onChange={(e) => { setOutId(e.target.value); ctl.current = null; setDevs([]) }} className="rounded border border-border bg-panel px-1 py-0.5 font-mono text-[10px] text-text">
          {pros.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}
      {!out && <p className="font-mono text-[10px] text-muted">RDM goes through an Enttec DMX USB Pro : add it first (step 1).</p>}
      {out && (
        <button className={`${btn(!!busy)} disabled:opacity-40`} disabled={!open || !!busy} onClick={() => void find()} title={open ? 'Ask every light on the line what it is (a few seconds)' : 'Plug the Enttec in first'}>
          {busy || (devs.length ? 'ask again' : 'ask the lights on the line')}
        </button>
      )}
      {devs.length > 0 && (
        <div className="flex flex-col gap-1">
          {devs.map((d, i) => (
            <div key={d.uid} className={`flex flex-col gap-1 rounded border p-1 ${blink === d.uid ? 'border-accent/70 bg-accent/10' : 'border-border'}`}>
              <div className="flex items-center gap-1 font-mono text-[10px]">
                <span className="min-w-0 flex-1 truncate text-text" title={`${d.manufacturer} ${d.modelName} · ${uidText(d.uid)}`}>{name(d)}</span>
                {onMap(d) && <span className="shrink-0 text-[9px] text-muted" title="A light on the map is at this address">on the map</span>}
                <button className="px-0.5 text-muted hover:text-text disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} title="Earlier in the row">↑</button>
                <button className="px-0.5 text-muted hover:text-text disabled:opacity-30" disabled={i === devs.length - 1} onClick={() => move(i, 1)} title="Later in the row">↓</button>
                <button className={btn(blink === d.uid)} disabled={!!busy} onClick={() => void toggleBlink(d)} title="Make it blink, to see which one it is in the room">{blink === d.uid ? '◉ blinking' : 'blink'}</button>
              </div>
              <div className="flex items-center gap-1 font-mono text-[10px] text-muted">
                <select
                  value={d.personality}
                  disabled={!!busy || d.personalities.length < 2}
                  onChange={(e) => void setMode(d, Number(e.target.value))}
                  className="min-w-0 flex-1 rounded border border-border bg-panel px-1 py-0.5 text-[10px] text-text"
                  title="Its mode : how many channels it takes, and what they do"
                >
                  {d.personalities.length ? d.personalities.map((p) => <option key={p.n} value={p.n}>{p.name}{p.footprint ? ` · ${p.footprint} ch` : ''}</option>) : <option value={d.personality}>{modeName(d)} · {d.footprint} ch</option>}
                </select>
                <span className="shrink-0">address</span>
                <NumBox value={d.address} min={1} max={512} onCommit={(v) => void setAddr(d, v)} className="w-12" />
              </div>
            </div>
          ))}
          <div className="flex gap-1">
            <button className={`flex-1 ${btn(false)} disabled:opacity-40`} disabled={!!busy} onClick={() => void inRow()} title="Give them addresses one after the other from 1, in this order (each mode's channels counted) : arrange the order with the arrows, blink to see which is which">address in a row</button>
            <button className={`flex-1 ${btn(false)} disabled:opacity-40`} disabled={!!busy} onClick={toMap} title="Put them on the map at their own addresses, each of the kind its mode suggests">put on the map</button>
          </div>
        </div>
      )}
      {note && <p className="font-mono text-[9px] leading-snug text-muted">{note}</p>}
    </Section>
  )
}

/** A step of the guide : its number, done or not, what to do. */
function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex gap-2">
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] ${done ? 'border-accent bg-accent/20 text-accent' : 'border-border text-muted'}`}>{done ? '✓' : n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-mono text-[10px] font-semibold text-text">{title}</span>
        {children}
      </div>
    </div>
  )
}

/** Nothing selected : how to set a rig up, from the interface to a show. Every
 *  step works on the rig as it is, so it also reads as a checklist later. */
function SetupGuide(): JSX.Element {
  const rig = useStore((s) => s.lightRig)
  const test = useStore((s) => s.lightTest)
  const imported = rig.profiles
  const [kind, setKind] = useState('b:drgb')
  const [count, setCount] = useState(4)
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => tick((x) => x + 1), 700)
    return () => window.clearInterval(id)
  }, [])
  const st = useStore.getState
  const all = [...BUILTIN_PROFILES, ...imported]
  const out = rig.outputs.find((o) => o.enabled) ?? rig.outputs[0]
  const ifaceOk = !!out && (out.kind !== 'enttec' || enttec.status(out.index).status === 'open')
  const mine = out ? rig.fixtures.filter((f) => f.out === out.id).sort((a, b) => a.universe - b.universe || a.address - b.address) : []
  // channels two lights share, or past what the interface carries
  const used = new Map<string, number>()
  let clash = false
  for (const f of mine) {
    const spans = fixtureSpans(f, out?.kind === 'enttec', out?.kind === 'sacn')
    if (out?.kind === 'enttec' && f.address - 1 + fixtureChannels(f) > 512) clash = true
    for (const sp of spans) for (let c = sp.from; c <= sp.to; c++) { const k = `${sp.universe}|${c}`; if (used.has(k)) clash = true; used.set(k, 1) }
  }
  const p = all.find((x) => x.id === kind) ?? BUILTIN_PROFILES[0]
  return (
    <>
      <Section title="Set up" info="From nothing to light, in five steps. It works on the rig as it is : come back to it any time (click an empty part of the map), it also reads as a checklist.">
        <Step n={1} done={ifaceOk} title="Plug in the interface">
          <p className="font-mono text-[10px] leading-snug text-muted">
            An Enttec DMX USB Pro on a USB port. Then one DMX cable from it to the first light (its DMX IN), another from that light (DMX OUT) to the next, and so on : a chain. Every light hears everything, and takes its own channels from its address.
          </p>
          {!rig.outputs.length ? (
            <button className={btn(false)} onClick={() => st().addLightOutput('enttec')} title="Add the Enttec DMX USB Pro as the output (the network ones are in Outputs, on the left)">+ my Enttec USB Pro</button>
          ) : (
            <span className="font-mono text-[10px]"><IfaceStatus /></span>
          )}
        </Step>
        <Step n={2} done={rig.fixtures.length > 0} title="Add your lights">
          <label className="flex items-center gap-2 font-mono text-[10px] text-muted" title="The kind of light : how many channels it has and what each does. Its manual or its menu names its mode (4 channels : dimmer, red, green, blue...). A light that is not here : add one, then import its file in its Patch panel">
            <span className="w-12 shrink-0">kind</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="min-w-0 flex-1 rounded border border-border bg-panel px-1 py-0.5 text-[10px] text-text">
              {BUILTIN_PROFILES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              {imported.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-2 font-mono text-[10px] text-muted">
            <span className="w-12 shrink-0">how many</span>
            <NumBox value={count} min={1} max={32} onCommit={setCount} className="w-12" />
            <button className={`flex-1 ${btn(false)}`} onClick={() => st().addLightChain(p, count)} title="Add them in a row across the picture, addressed one after the other on the interface">add them</button>
          </div>
        </Step>
        <Step n={3} done={mine.length > 0 && !clash} title="Give each light its address">
          <p className="font-mono text-[10px] leading-snug text-muted">
            Set these on the lights themselves : in their menu (often A001, d001), or with their DIP switches (up where filled). Lights that speak RDM can be set from here : Ask the lights, below.
          </p>
          {mine.length === 0 && <span className="font-mono text-[10px] text-muted">No lights on the interface yet.</span>}
          <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
            {mine.map((f) => (
              <button key={f.id} onClick={() => st().setLightSel(f.id)} className="flex items-center gap-2 rounded px-1 py-0.5 text-left font-mono text-[10px] hover:bg-panel3/60" title={`${f.name} : ${fixtureChannels(f)} channels from ${f.address}. Click to open it`}>
                <span className="min-w-0 flex-1 truncate text-text">{f.name}</span>
                <span className="shrink-0 text-accent">{out?.kind !== 'enttec' && f.universe ? `u${f.universe} · ` : ''}{String(f.address).padStart(3, '0')}</span>
                <span className="flex shrink-0 items-end gap-px">
                  {dipOf(f.address).map((on, i) => <span key={i} className={`h-2.5 w-1.5 rounded-[1px] border ${on ? 'border-accent bg-accent' : 'border-border'}`} />)}
                </span>
              </button>
            ))}
          </div>
          {clash && (
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 font-mono text-[10px] text-red-400">Two lights share channels, or one runs past 512.</span>
              {out && <button className={btn(false)} onClick={() => st().autoAddressLights(out.id)} title="Readdress them one after the other from channel 1">fix</button>}
            </div>
          )}
        </Step>
        <Step n={4} done={false} title="Check them">
          <div className="flex items-center gap-2">
            <button className={btn(test !== null)} onClick={() => st().setLightTest(test === null)} title="A line sweeps the room : red, then green, blue, white">{test !== null ? '◉ testing' : 'test'}</button>
            <span className="min-w-0 flex-1 font-mono text-[10px] leading-snug text-muted">Each light should go red, green, blue, then white, from left to right. A wrong color : its kind is another one. Dark : its address.</span>
          </div>
        </Step>
        <Step n={5} done={false} title="Play">
          <p className="font-mono text-[10px] leading-snug text-muted">
            Pick a show on the left. Or drag a light on the map : it takes the picture's colors from where it sits.
          </p>
        </Step>
      </Section>
      <RdmSection />
      <Section title="On the map" defaultCollapsed info="How the map is played.">
        <p className="font-mono text-[10px] leading-snug text-muted">Click a light to set it up : where it is patched, what it shows, how it is tuned. Drag it to move it, drag the ends of a bar or the corners of a matrix to reshape it, double-click a bar to bend it. The arrows nudge it (Shift : farther), Delete removes it, Ctrl+D duplicates it.</p>
        <p className="font-mono text-[10px] leading-snug text-muted">Shift or Ctrl + click picks several lights, a drag on an empty part draws a rubber band around them : they move together, and a look, a tuning, a kind or a show goes to all of them. Make them a group to give them a fader.</p>
      </Section>
    </>
  )
}

// ── the map ──────────────────────────────────────────────────────────────────
type DragMode = 'move' | 'p0' | 'p1' | 'c01' | 'c10' | 'bend' | 'band'
type Drag = {
  id: string; mode: DragMode; sx: number; sy: number; f: LightFixture | null; pid: number
  moved?: boolean // past the first three pixels : a click with a wobble moves nothing
  group?: LightFixture[] // several picked : they move together
  bend?: number // which bend
  band?: { x1: number; y1: number; add: boolean; base: string[] } // a rubber band from (sx, sy)
}
type Rect = { x: number; y: number; w: number; h: number }

const PHOTO_KEY = 'opsia.lightPhoto'
const loadPhoto = (): string | null => { try { return localStorage.getItem(PHOTO_KEY) } catch { return null } }

function MapView({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null> }): JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const compW = useStore((s) => s.compW)
  const compH = useStore((s) => s.compH)
  const test = useStore((s) => s.lightTest)
  const [view, setView] = useState<'map' | 'patch'>('map')
  const [backdrop, setBackdrop] = useState<'auto' | 'master' | 'room' | 'photo'>('auto')
  const [photoMix, setPhotoMix] = useState(0.35)
  const [photo, setPhoto] = useState<string | null>(loadPhoto)
  const [labels, setLabels] = useState(true)
  const drag = useRef<Drag | null>(null)
  const photoImg = useMemo(() => { if (!photo) return null; const im = new Image(); im.src = photo; return im }, [photo])
  const photoFile = useRef<HTMLInputElement | null>(null)
  const layerCanvas = useMemo(() => document.createElement('canvas'), [])
  const aspect = compW / Math.max(1, compH)

  // the map's rect inside the canvas (the picture's proportions, centered)
  const rectOf = (cw: number, ch: number): Rect => {
    const pad = 24
    let w = cw - pad * 2, h = w / aspect
    if (h > ch - pad * 2) { h = ch - pad * 2; w = h * aspect }
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h }
  }

  // a photo of the room, kept small on this computer
  const onPhoto = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const url = URL.createObjectURL(file)
    const im = new Image()
    im.onload = () => {
      const k = Math.min(1, 1280 / Math.max(im.width, im.height))
      const c = document.createElement('canvas')
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k)
      c.getContext('2d')?.drawImage(im, 0, 0, c.width, c.height)
      const data = c.toDataURL('image/jpeg', 0.82)
      URL.revokeObjectURL(url)
      try { localStorage.setItem(PHOTO_KEY, data) } catch { /* too big : for this run only */ }
      setPhoto(data)
      setBackdrop('photo')
    }
    im.src = url
  }

  useEffect(() => {
    if (view !== 'map') return
    let raf = 0
    const draw = (): void => {
      raf = requestAnimationFrame(draw)
      const cv = ref.current, box = boxRef.current
      if (!cv || !box) return
      const dpr = window.devicePixelRatio || 1
      const cw = box.clientWidth, chh = box.clientHeight
      if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(chh * dpr)) {
        cv.width = Math.round(cw * dpr); cv.height = Math.round(chh * dpr)
        cv.style.width = `${cw}px`; cv.style.height = `${chh}px`
      }
      const g = cv.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, cw, chh)
      const R = rectOf(cw, chh)
      const st = useStore.getState()
      const selF = st.lightRig.fixtures.find((f) => f.id === st.lightSel) ?? null
      const selLook = selF ? st.lightsSession.looks[selF.id] ?? LOOK_DEFAULT : null
      // the backdrop : the picture the selected fixture reads (a layer's own), the master, the room's photo
      g.fillStyle = '#000'
      g.fillRect(R.x, R.y, R.w, R.h)
      const drawPicture = (alpha: number): void => {
        const wantLayer = backdrop === 'auto' && selLook?.source === 'layer' ? selLook.layer : -1
        const grid = wantLayer >= 0 ? lightRuntime.grid(wantLayer) : null
        g.globalAlpha = alpha
        if (grid) {
          if (layerCanvas.width !== grid.w || layerCanvas.height !== grid.h) { layerCanvas.width = grid.w; layerCanvas.height = grid.h }
          const lg = layerCanvas.getContext('2d')
          if (lg) {
            const img = lg.createImageData(grid.w, grid.h)
            for (let y = 0; y < grid.h; y++) {
              const src = (grid.h - 1 - y) * grid.w * 4
              img.data.set(grid.px.subarray(src, src + grid.w * 4), y * grid.w * 4)
            }
            for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255
            lg.putImageData(img, 0, 0)
            g.imageSmoothingEnabled = true
            g.drawImage(layerCanvas, R.x, R.y, R.w, R.h)
          }
        } else if (canvasRef.current) {
          try { g.drawImage(canvasRef.current, R.x, R.y, R.w, R.h) } catch { /* not ready */ }
        }
        g.globalAlpha = 1
      }
      if (backdrop === 'photo') {
        if (photoImg?.complete && photoImg.naturalWidth) { try { g.drawImage(photoImg, R.x, R.y, R.w, R.h) } catch { /* not ready */ } }
        if (photoMix > 0.01) drawPicture(photoMix)
      } else if (backdrop !== 'room') drawPicture(0.85)
      // a light grid over it (the room)
      g.strokeStyle = backdrop === 'room' ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)'
      g.lineWidth = 1
      for (let i = 1; i < 10; i++) {
        const x = R.x + (R.w * i) / 10, y = R.y + (R.h * i) / 10
        g.beginPath(); g.moveTo(x, R.y); g.lineTo(x, R.y + R.h); g.stroke()
        g.beginPath(); g.moveTo(R.x, y); g.lineTo(R.x + R.w, y); g.stroke()
      }
      g.strokeStyle = 'rgba(255,255,255,0.25)'
      g.strokeRect(R.x + 0.5, R.y + 0.5, R.w - 1, R.h - 1)
      // the fixtures
      const P = (x: number, y: number): [number, number] => [R.x + x * R.w, R.y + y * R.h]
      const ORANGE = 'rgb(255,170,60)'
      for (const f of st.lightRig.fixtures) {
        const on = f.id === st.lightSel
        const also = !on && st.lightPicked.includes(f.id)
        const colors = lightRuntime.last?.colors.get(f.id)
        const col = (i: number): string => (colors && colors.length >= i * 3 + 3 ? `rgb(${show(colors[i * 3])},${show(colors[i * 3 + 1])},${show(colors[i * 3 + 2])})` : '#333')
        g.lineWidth = on || also ? 2 : 1
        g.strokeStyle = on ? ORANGE : also ? 'rgba(255,170,60,0.6)' : 'rgba(255,255,255,0.55)'
        if (f.kind === 'spot') {
          const [cx, cy] = P(f.x0, f.y0)
          const r = Math.max(7, f.size * R.h * 1.2)
          g.fillStyle = col(0)
          g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); g.stroke()
        } else {
          const pts = fixturePoints(f, aspect)
          const n = pts.length / 2
          if (f.kind === 'matrix') {
            const [ax, ay] = P(f.x0, f.y0), [bx, by] = P(f.x1, f.y1)
            const cwid = Math.abs(bx - ax) / f.cols, chei = Math.abs(by - ay) / f.rows
            for (let k = 0; k < n; k++) {
              const [px, py] = P(pts[k * 2], pts[k * 2 + 1])
              g.fillStyle = col(k)
              g.fillRect(px - cwid / 2 + 1, py - chei / 2 + 1, Math.max(1, cwid - 2), Math.max(1, chei - 2))
            }
            g.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay))
          } else {
            // the line (a strip through its bends, a ring around)
            g.beginPath()
            if (f.kind === 'ring') {
              const [cx, cy] = P(f.x0, f.y0)
              const r = Math.hypot((f.x1 - f.x0) * aspect, f.y1 - f.y0) * R.h
              g.arc(cx, cy, Math.max(2, r), 0, Math.PI * 2)
            } else {
              const p = stripPath(f)
              for (let i = 0; i < p.length; i += 2) { const [x, y] = P(p[i], p[i + 1]); if (i) g.lineTo(x, y); else g.moveTo(x, y) }
            }
            g.stroke()
            let len = 0
            for (let k = 1; k < n; k++) len += Math.hypot((pts[k * 2] - pts[k * 2 - 2]) * R.w, (pts[k * 2 + 1] - pts[k * 2 - 1]) * R.h)
            const dot = Math.max(2, Math.min(9, (len / Math.max(1, n)) * 0.8))
            const step = Math.max(1, Math.ceil(n / Math.max(1, len / 2.5)))
            for (let k = 0; k < n; k += step) {
              const [px, py] = P(pts[k * 2], pts[k * 2 + 1])
              g.fillStyle = col(k)
              g.fillRect(px - dot / 2, py - dot / 2, dot, dot)
            }
          }
          // its first LED, marked (where the wire comes in)
          const [fx, fy] = P(pts[0], pts[1])
          g.fillStyle = on ? ORANGE : 'rgba(255,255,255,0.8)'
          g.beginPath(); g.arc(fx, fy, 3, 0, Math.PI * 2); g.fill()
        }
        if (on) {
          g.fillStyle = ORANGE
          const hs: Array<[number, number]> =
            f.kind === 'spot' ? [] :
              f.kind === 'matrix' ? [P(f.x0, f.y0), P(f.x1, f.y1), P(f.x1, f.y0), P(f.x0, f.y1)] :
                f.kind === 'ring' ? [P(f.x0, f.y0), P(f.x1, f.y1)] :
                  [P(f.x0, f.y0), P(f.x1, f.y1)]
          for (const [hx, hy] of hs) g.fillRect(hx - 4, hy - 4, 8, 8)
          if (f.kind === 'strip') {
            g.strokeStyle = ORANGE
            g.lineWidth = 1.5
            for (let i = 0; i < f.bends.length; i += 2) { const [hx, hy] = P(f.bends[i], f.bends[i + 1]); g.beginPath(); g.arc(hx, hy, 4.5, 0, Math.PI * 2); g.stroke() }
          }
        }
        if (labels) {
          const [lx, ly] = f.kind === 'spot' || f.kind === 'ring' ? P(f.x0, f.y0) : P(Math.min(f.x0, f.x1), Math.min(f.y0, f.y1))
          g.font = '10px ui-monospace, monospace'
          g.fillStyle = on ? ORANGE : 'rgba(255,255,255,0.75)'
          g.fillText(f.name, lx + 2, ly - 8)
        }
      }
      // a rubber band being drawn
      const d = drag.current
      if (d?.mode === 'band' && d.band) {
        const [ax, ay] = P(d.sx, d.sy), [bx, by] = P(d.band.x1, d.band.y1)
        g.setLineDash([4, 3])
        g.strokeStyle = ORANGE
        g.lineWidth = 1
        g.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay))
        g.setLineDash([])
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [view, backdrop, photoMix, photoImg, labels, aspect, canvasRef, layerCanvas])

  // pointer : select, move, reshape, bend, a rubber band
  const toMap = (e: { clientX: number; clientY: number }): [number, number, Rect] => {
    // (the UI zoom scales the canvas on screen : the pointer back in its own pixels,
    // where the map was drawn)
    const cv = ref.current!
    const b = cv.getBoundingClientRect()
    const k = b.width > 0 ? cv.clientWidth / b.width : 1
    const R = rectOf(cv.clientWidth, cv.clientHeight)
    return [((e.clientX - b.left) * k - R.x) / R.w, ((e.clientY - b.top) * k - R.y) / R.h, R]
  }
  /** The nearest segment of a strip to a point : which, where along it, how far (px). */
  const nearSeg = (f: LightFixture, x: number, y: number, R: Rect): { seg: number; t: number; d: number } => {
    const p = stripPath(f)
    let best = { seg: 0, t: 0, d: Infinity }
    for (let s = 0; s < p.length / 2 - 1; s++) {
      const ax = p[s * 2] * R.w, ay = p[s * 2 + 1] * R.h, bx = p[s * 2 + 2] * R.w, by = p[s * 2 + 3] * R.h, qx = x * R.w, qy = y * R.h
      const vx = bx - ax, vy = by - ay
      const t = Math.max(0, Math.min(1, ((qx - ax) * vx + (qy - ay) * vy) / Math.max(1e-6, vx * vx + vy * vy)))
      const d = Math.hypot(qx - (ax + t * vx), qy - (ay + t * vy))
      if (d < best.d) best = { seg: s, t, d }
    }
    return best
  }
  const hit = (x: number, y: number, R: Rect): { f: LightFixture; mode: DragMode; bend?: number } | null => {
    const st = useStore.getState()
    const px = (dx: number, dy: number): number => Math.hypot(dx * R.w, dy * R.h)
    const selF = st.lightRig.fixtures.find((f) => f.id === st.lightSel)
    if (selF && selF.kind !== 'spot') {
      if (selF.kind === 'strip') for (let i = 0; i < selF.bends.length; i += 2) if (px(x - selF.bends[i], y - selF.bends[i + 1]) < 8) return { f: selF, mode: 'bend', bend: i / 2 }
      if (selF.kind !== 'ring' && px(x - selF.x0, y - selF.y0) < 9) return { f: selF, mode: 'p0' }
      if (px(x - selF.x1, y - selF.y1) < 9) return { f: selF, mode: 'p1' }
      if (selF.kind === 'matrix') {
        if (px(x - selF.x1, y - selF.y0) < 9) return { f: selF, mode: 'c10' }
        if (px(x - selF.x0, y - selF.y1) < 9) return { f: selF, mode: 'c01' }
      }
    }
    const list = st.lightRig.fixtures
    for (let i = list.length - 1; i >= 0; i--) {
      const f = list[i]
      if (f.kind === 'spot') {
        if (px(x - f.x0, y - f.y0) < Math.max(9, f.size * R.h * 1.2)) return { f, mode: 'move' }
      } else if (f.kind === 'matrix') {
        if (x >= Math.min(f.x0, f.x1) && x <= Math.max(f.x0, f.x1) && y >= Math.min(f.y0, f.y1) && y <= Math.max(f.y0, f.y1)) return { f, mode: 'move' }
      } else if (f.kind === 'ring') {
        const r = Math.hypot((f.x1 - f.x0) * aspect, f.y1 - f.y0) * R.h
        const d = px(x - f.x0, y - f.y0)
        if (d < 9 || Math.abs(d - r) < 8) return { f, mode: 'move' }
      } else if (nearSeg(f, x, y, R).d < 8) return { f, mode: 'move' }
    }
    return null
  }
  const onDown = (e: RPointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return
    const [x, y, R] = toMap(e)
    const h = hit(x, y, R)
    const st = useStore.getState()
    const mod = e.shiftKey || e.ctrlKey || e.metaKey
    e.currentTarget.setPointerCapture(e.pointerId)
    if (!h) {
      // a rubber band : the lights inside are picked (Shift / Ctrl : added)
      if (!mod) st.setLightSel(null)
      drag.current = { id: '', mode: 'band', sx: x, sy: y, f: null, pid: e.pointerId, band: { x1: x, y1: y, add: mod, base: mod ? st.lightPicked : [] } }
      return
    }
    // Shift / Ctrl + click : one more picked (or one less)
    if (mod && h.mode === 'move') { st.toggleLightPick(h.f.id); return }
    // one of several picked : they all move with it
    const many = h.mode === 'move' && st.lightPicked.length > 1 && st.lightPicked.includes(h.f.id)
    if (many) useStore.setState({ lightSel: h.f.id })
    else st.setLightSel(h.f.id)
    drag.current = {
      id: h.f.id, mode: h.mode, sx: x, sy: y, f: h.f, pid: e.pointerId, bend: h.bend,
      group: many ? st.lightRig.fixtures.filter((q) => st.lightPicked.includes(q.id)) : undefined
    }
  }
  const onMove = (e: RPointerEvent<HTMLCanvasElement>): void => {
    const d = drag.current
    if (!d || e.pointerId !== d.pid) return
    let [x, y, R] = toMap(e)
    const st = useStore.getState()
    if (d.mode === 'band' && d.band) {
      d.band.x1 = x; d.band.y1 = y
      const x0 = Math.min(d.sx, x), x1 = Math.max(d.sx, x), y0 = Math.min(d.sy, y), y1 = Math.max(d.sy, y)
      if (x1 - x0 < 0.005 && y1 - y0 < 0.005) return
      const inside = st.lightRig.fixtures.filter((f) => { const [cx, cy] = middleOf(f); return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1 }).map((f) => f.id)
      st.setLightPicked([...new Set([...d.band.base, ...inside])])
      return
    }
    const f = d.f
    if (!f) return
    let dx = x - d.sx, dy = y - d.sy
    if (!d.moved) { if (Math.hypot(dx * R.w, dy * R.h) < 3) return; d.moved = true }
    if (d.mode === 'move') {
      // (its middle never leaves the picture by much : it can always be caught again)
      const [mx, my] = middleOf(f)
      dx = Math.max(-0.03, Math.min(1.03, mx + dx)) - mx
      dy = Math.max(-0.03, Math.min(1.03, my + dy)) - my
      st.updateLightFixtures((d.group ?? [f]).map((q) => [q.id, shifted(q, dx, dy)]))
      return
    }
    if (d.mode === 'bend' && d.bend !== undefined) {
      const bends = f.bends.slice()
      bends[d.bend * 2] = x; bends[d.bend * 2 + 1] = y
      st.updateLightFixture(d.id, { bends })
      return
    }
    // Shift : a bar's end kept level or upright (against its neighbor point)
    if (e.shiftKey && f.kind === 'strip') {
      const p = stripPath(f)
      const ox = d.mode === 'p0' ? p[2] : p[p.length - 4], oy = d.mode === 'p0' ? p[3] : p[p.length - 3]
      if (Math.abs(x - ox) * aspect > Math.abs(y - oy)) y = oy
      else x = ox
    }
    if (d.mode === 'p0') st.updateLightFixture(d.id, { x0: x, y0: y })
    else if (d.mode === 'p1') st.updateLightFixture(d.id, { x1: x, y1: y })
    else if (d.mode === 'c10') st.updateLightFixture(d.id, { x1: x, y0: y })
    else st.updateLightFixture(d.id, { x0: x, y1: y })
  }
  const onUp = (e: RPointerEvent<HTMLCanvasElement>): void => {
    if (drag.current?.pid === e.pointerId) drag.current = null
  }
  // double-click a bar : a bend there; double-click a bend : gone
  const onDouble = (e: RMouseEvent<HTMLCanvasElement>): void => {
    const [x, y, R] = toMap(e)
    const st = useStore.getState()
    const h = hit(x, y, R)
    if (!h || h.f.kind !== 'strip') return
    if (h.mode === 'bend' && h.bend !== undefined) {
      const bends = h.f.bends.slice()
      bends.splice(h.bend * 2, 2)
      st.updateLightFixture(h.f.id, { bends })
      return
    }
    if (h.mode !== 'move' || h.f.bends.length >= 64) return
    const s = nearSeg(h.f, x, y, R)
    const bends = h.f.bends.slice()
    bends.splice(s.seg * 2, 0, x, y)
    st.setLightSel(h.f.id)
    st.updateLightFixture(h.f.id, { bends })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5 font-mono text-[10px] text-muted">
        {(['map', 'patch'] as const).map((v) => (
          <button key={v} className={btn(view === v)} onClick={() => setView(v)} title={v === 'map' ? 'The lights on the picture' : 'The channels : every universe, each light where it is patched'}>
            {v}
          </button>
        ))}
        {view === 'map' && (
          <>
            <span className="ml-2">under the lights</span>
            {(['auto', 'master', 'room', 'photo'] as const).map((b) => (
              <button
                key={b}
                className={`${btn(backdrop === b)} disabled:opacity-40`}
                disabled={b === 'photo' && !photo}
                onClick={() => setBackdrop(b)}
                title={b === 'auto' ? "The picture the selected light reads (a layer's own, or the master)" : b === 'master' ? 'The master picture, always' : b === 'room' ? 'Only the room : a grid, no picture' : 'A photo of the room : place each light where it really is'}
              >
                {b === 'auto' ? 'its source' : b === 'master' ? 'picture' : b}
              </button>
            ))}
            <button className={btn(false)} onClick={() => photoFile.current?.click()} title="A photo of the room (or a plan of the stage) under the map, to place each light where it is : kept on this computer">photo…</button>
            <input ref={photoFile} type="file" accept="image/*" className="hidden" onChange={onPhoto} />
            {backdrop === 'photo' && (
              <label className="flex items-center gap-1" title="The picture over the photo">
                picture
                <input type="range" min={0} max={1} step={0.01} value={photoMix} onChange={(e) => setPhotoMix(Number(e.target.value))} className="w-20 accent-accent" />
              </label>
            )}
          </>
        )}
        <div className="flex-1" />
        <button
          className={btn(test !== null)}
          onClick={() => useStore.getState().setLightTest(test === null)}
          title="The test pattern : a line sweeps the room, red, then green, blue and white. Every light shows whether it is where the map says, and whether its colors come in the right order. It ignores the masters and Black"
        >
          {test !== null ? '◉ testing' : 'test'}
        </button>
        {view === 'map' && <button className={btn(labels)} onClick={() => setLabels((v) => !v)}>names</button>}
      </div>
      {view === 'map' ? (
        <div ref={boxRef} className="relative min-h-0 flex-1">
          <canvas
            ref={ref}
            className="absolute inset-0 cursor-crosshair"
            style={{ touchAction: 'none' }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onDoubleClick={onDouble}
          />
        </div>
      ) : (
        <PatchView />
      )}
    </div>
  )
}

// ── the patch : every universe in use, each light where its channels land ────
const hueOf = (id: string): number => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360; return h }

function PatchView(): JSX.Element {
  const rig = useStore((s) => s.lightRig)
  const sel = useStore((s) => s.lightSel)
  const picked = useStore((s) => s.lightPicked)
  const st = useStore.getState
  const drag = useRef<{ id: string; off: number; uni: number; out: string; at: number } | null>(null)
  const [hover, setHover] = useState<{ out: string; uni: number; ch: number } | null>(null)
  // a drag let go anywhere ends (after a grid's own drop has read it)
  useEffect(() => {
    const up = (): void => { window.setTimeout(() => { drag.current = null }, 0) }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [])
  // each output's universes : per channel, who is there
  const blocks: Array<{ out: LightOutput; uni: number; cells: Array<string[]> }> = []
  for (const o of rig.outputs) {
    const by = new Map<number, Array<string[]>>()
    for (const f of rig.fixtures) {
      if (f.out !== o.id) continue
      for (const sp of fixtureSpans(f, o.kind === 'enttec', o.kind === 'sacn')) {
        let cells = by.get(sp.universe)
        if (!cells) { cells = Array.from({ length: 512 }, () => []); by.set(sp.universe, cells) }
        for (let c = sp.from; c <= sp.to; c++) cells[c - 1].push(f.id)
      }
    }
    if (!by.size) by.set(o.kind === 'enttec' ? 0 : 0, Array.from({ length: 512 }, () => []))
    for (const [uni, cells] of [...by].sort((a, b) => a[0] - b[0])) blocks.push({ out: o, uni, cells })
  }
  const unpatched = rig.fixtures.filter((f) => !rig.outputs.some((o) => o.id === f.out))
  // lights whose channels do not all fit (past an Enttec's 512)
  const cut = rig.fixtures.filter((f) => {
    const o = rig.outputs.find((x) => x.id === f.out)
    return !!o && fixtureSpans(f, o.kind === 'enttec', o.kind === 'sacn').reduce((n, sp) => n + sp.to - sp.from + 1, 0) < fixtureChannels(f)
  })
  const name = (id: string): string => rig.fixtures.find((f) => f.id === id)?.name ?? '?'
  const overlaps = blocks.reduce((n, b) => n + b.cells.filter((c) => c.length > 1).length, 0)
  const drop = (out: LightOutput, uni: number, ch: number): void => {
    const d = drag.current
    drag.current = null
    if (!d || d.out !== out.id || (uni === d.uni && ch === d.at)) return // (let go where it was pressed : a click)
    const address = Math.max(1, Math.min(512, ch + 1 - d.off))
    st().updateLightFixture(d.id, out.kind === 'enttec' ? { address } : { address, universe: uni })
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 font-mono text-[10px]">
      <p className="text-muted">
        Every universe in use, 512 channels each, every light in its color : click one to select it, drag it to another channel to readdress it (on an Enttec, within its one universe).
        {overlaps > 0 ? <span className="text-red-400"> {overlaps} channel{overlaps === 1 ? '' : 's'} used by two lights (in red).</span> : ' No two lights share a channel.'}
      </p>
      {rig.outputs.length === 0 && <p className="text-muted">No outputs yet : add one on the left.</p>}
      {blocks.map(({ out, uni, cells }) => (
        <div key={`${out.id}|${uni}`} className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-text">{out.name}</span>
            <span className="text-muted">{out.kind === 'enttec' ? 'its universe' : `universe ${uni}`} · {cells.filter((c) => c.length).length} of 512 used</span>
            <div className="flex-1" />
            <button
              className={btn(false)}
              onClick={() => st().autoAddressLights(out.id)}
              title="Readdress every light on this output one after the other from channel 1, in their order now, none sharing a channel (a light that would cross a universe starts the next one)"
            >
              address in order
            </button>
          </div>
          <div className="grid gap-px" style={{ gridTemplateColumns: 'repeat(32, minmax(0, 1fr))' }} onPointerUp={() => { if (drag.current && hover) drop(out, uni, hover.ch) }}>
            {cells.map((who, i) => {
              const id = who[0]
              const first = id && (i === 0 || cells[i - 1][0] !== id)
              const isSel = id === sel || (id && picked.includes(id))
              const hot = hover && hover.out === out.id && hover.uni === uni && hover.ch === i
              return (
                <div
                  key={i}
                  onPointerDown={(e) => {
                    if (!id) return
                    e.preventDefault()
                    st().setLightSel(id)
                    // (dragged by its first universe's part only : the rest follows)
                    const fx = rig.fixtures.find((q) => q.id === id)
                    const first = fx ? fixtureSpans(fx, out.kind === 'enttec', out.kind === 'sacn')[0] : undefined
                    drag.current = first && first.universe === uni && i + 1 >= first.from && i + 1 <= first.to ? { id, off: i + 1 - first.from, uni, out: out.id, at: i } : null
                  }}
                  onPointerEnter={() => setHover({ out: out.id, uni, ch: i })}
                  title={`${i + 1}${who.length ? ` : ${who.map(name).join(', ')}` : ''}`}
                  className={`relative h-4 overflow-hidden rounded-[2px] text-[8px] leading-4 ${id ? 'cursor-grab' : ''} ${hot && drag.current ? 'ring-1 ring-accent' : ''}`}
                  style={{
                    background: who.length > 1 ? 'rgba(239,68,68,0.85)' : id ? `hsla(${hueOf(id)}, 55%, ${isSel ? 55 : 38}%, 0.9)` : 'rgb(var(--c-panel2))',
                    outline: isSel ? '1px solid rgb(255,170,60)' : undefined
                  }}
                >
                  {first ? <span className="absolute left-0.5 top-0 whitespace-nowrap text-white">{name(id)}</span> : i % 32 === 0 ? <span className="absolute left-0.5 top-0 text-muted">{i + 1}</span> : null}
                </div>
              )
            })}
          </div>
        </div>
      ))}
      {cut.length > 0 && <p className="text-red-400">Past the 512 channels of the output, not (all) sent : {cut.map((f) => f.name).join(', ')}</p>}
      {unpatched.length > 0 && <p className="text-muted">Not patched (no output) : {unpatched.map((f) => f.name).join(', ')}</p>}
    </div>
  )
}

// ── the inspector ────────────────────────────────────────────────────────────
type SliderFn = (label: string, field: LightModField | null, value: number, min: number, max: number, step: number, set: (v: number) => void, reset?: number, unit?: string, title?: string, fmt?: (v: number) => string) => JSX.Element

function Inspector({ f }: { f: LightFixture }): JSX.Element {
  const st = useStore.getState
  const outputs = useStore((s) => s.lightRig.outputs)
  const look = useStore((s) => s.lightsSession.looks[f.id]) ?? LOOK_DEFAULT
  const tune = useStore((s) => (s.lightRig.tuneScope === 'look' ? s.lightsSession.tunes?.[f.id] : null)) ?? f.tune
  const upd = (p: Partial<LightFixture>): void => st().updateLightFixture(f.id, p)
  const out = outputs.find((o) => o.id === f.out)
  const ch = fixtureChannels(f)
  const overflow = out?.kind === 'enttec' && f.address - 1 + ch > 512
  const [customOpen, setCustomOpen] = useState(false)
  const custom = customOpen || !(LAYOUTS as readonly string[]).includes(f.layout)
  const [openMod, setOpenMod] = useState<string | null>(null)
  const S: SliderFn = (label, field, value, min, max, step, set, reset, unit = '', title, fmt) => (
    <LightSlider key={label} label={label} fixture={f.id} field={field} value={value} min={min} max={max} step={step} onChange={set} reset={reset} unit={unit} title={title} fmt={fmt} openMod={openMod} setOpenMod={setOpenMod} />
  )
  return (
    <>
      <Section
        title="Light"
        actions={
          <div className="flex gap-1">
            <button className={btn(false)} onClick={() => st().duplicateLightFixture(f.id)} title="Duplicate (Ctrl+D)">dup</button>
            <button className="rounded border border-border px-2 py-1 font-mono text-[10px] text-muted hover:text-red-400" onClick={() => st().removeLightFixture(f.id)} title="Remove (Delete)">×</button>
          </div>
        }
      >
        <input value={f.name} onChange={(e) => upd({ name: e.target.value })} className="rounded border border-border bg-panel px-1.5 py-1 font-mono text-[11px]" />
        <div className="flex gap-1">
          {(['strip', 'ring', 'spot', 'matrix'] as const).map((k) => (
            <button key={k} className={`flex-1 ${btn(f.kind === k)}`} onClick={() => st().setLightKind(f.id, k)}>{KIND_LABEL[k]}</button>
          ))}
        </div>
        {(f.kind === 'strip' || f.kind === 'ring') && (
          <Num label="LEDs" value={f.pixels} min={1} max={2048} onChange={(v) => upd({ pixels: v })} title={f.kind === 'ring' ? 'How many pixels around the ring' : 'How many pixels the bar has (each takes the picture at its place along the line)'} />
        )}
        {f.kind === 'strip' && (
          <div className="flex items-center gap-1 font-mono text-[10px] text-muted">
            <span className="min-w-0 flex-1 truncate" title="Double-click the bar on the map to bend it there; drag a bend to move it, double-click it to take it away">
              {f.bends.length ? `${f.bends.length / 2} bend${f.bends.length > 2 ? 's' : ''}` : 'straight'} · double-click to bend
            </span>
            {f.bends.length > 0 && <button className={btn(false)} onClick={() => upd({ bends: [] })} title="Back to a straight line">straighten</button>}
            <button className={btn(f.reverse)} onClick={() => upd({ reverse: !f.reverse })} title="The first LED at the other end">reversed</button>
          </div>
        )}
        {f.kind === 'ring' && (
          <button className={btn(f.reverse)} onClick={() => upd({ reverse: !f.reverse })} title="The LEDs run the other way round (its first LED stays at the handle : drag it to turn the ring)">
            {f.reverse ? 'counterclockwise' : 'clockwise'}
          </button>
        )}
        {f.kind === 'matrix' && (
          <>
            <div className="flex gap-1.5">
              <Num label="columns" value={f.cols} min={1} max={128} onChange={(v) => upd({ cols: v })} />
              <Num label="rows" value={f.rows} min={1} max={128} onChange={(v) => upd({ rows: v })} />
            </div>
            <MatrixWiring f={f} upd={upd} />
          </>
        )}
        {f.kind !== 'matrix' && <RowMaker f={f} />}
        {S('area', 'area', f.size, 0, 0.3, 0.005, (v) => upd({ size: v }), 0.03, '', 'How wide a patch of the picture each pixel reads (larger : calmer, less detail)')}
        <IdentifyButton id={f.id} />
      </Section>

      <Section title="Patch" info="Where its channels go, and what they are. Pick the kind of light it is (a profile : its channels in the right order, the ones it does not use held where they do nothing), import a fixture file for a real light, or write its channels yourself.">
        <label className="flex items-center gap-2 font-mono text-[10px] text-muted">
          <span className="w-14">output</span>
          <select value={f.out} onChange={(e) => upd({ out: e.target.value })} className="min-w-0 flex-1 rounded border border-border bg-panel px-1 py-0.5 text-[10px] text-text">
            <option value="">none</option>
            {outputs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <div className="flex gap-1.5">
          {out && out.kind !== 'enttec' && <Num label="universe" value={out.kind === 'sacn' ? Math.max(1, f.universe) : f.universe} min={out.kind === 'sacn' ? 1 : 0} max={32767} onChange={(v) => upd({ universe: v })} title="A universe is one DMX line of 512 channels. A network output carries many, by number (Art-Net and WLED from 0, sACN from 1) : the number set on the node's port" />}
          <Num label="address" value={f.address} min={1} max={512} onChange={(v) => upd({ address: v })} title="Its first DMX channel (1..512) : the light's own address (its menu or DIP switches)" />
        </div>
        <Dip address={f.address} />
        <ProfilePicker ids={[f.id]} current={f.profile} />
        {!f.profile && (
          <>
            <label className="flex items-center gap-2 font-mono text-[10px] text-muted">
              <span className="w-14">channels</span>
              <select
                value={custom ? '__custom' : f.layout}
                onChange={(e) => { if (e.target.value === '__custom') setCustomOpen(true); else { setCustomOpen(false); upd({ layout: e.target.value }) } }}
                className="min-w-0 flex-1 rounded border border-border bg-panel px-1 py-0.5 text-[10px] text-text"
                title="The channels of one pixel. With a dimmer (D, D16 in 16 bits) the dimmer takes the level and the color stays full : smoother fades down low"
              >
                {LAYOUTS.map((l) => <option key={l} value={l}>{l}</option>)}
                <option value="__custom">your own…</option>
              </select>
            </label>
            {custom && (
              <TextBox
                value={f.layout}
                onCommit={(v) => upd({ layout: v })}
                className="rounded border border-border bg-panel px-1.5 py-1 font-mono text-[10px]"
                title="The channels of one pixel, in order : R G B W A U, C M Y (a subtractive mix), L (one channel of white), D (a dimmer : it takes the level), S (strobe, off), X (unused), a letter followed by 16 for 16 bits (D16), or a number (0..255) for a channel held at that value"
              />
            )}
            {f.kind !== 'spot' && (
              <label className="flex items-center gap-2 font-mono text-[10px] text-muted" title="Channels sent once before the pixels (a bar's own dimmer and strobe : D S). A dimmer here is the whole bar's : it takes its brightest pixel, and the pixels go out relative to it">
                <span className="w-14 shrink-0">before</span>
                <TextBox
                  value={f.head}
                  placeholder="none"
                  onCommit={(v) => upd({ head: v })}
                  className="min-w-0 flex-1 rounded border border-border bg-panel px-1.5 py-0.5 font-mono text-[10px] text-text"
                />
              </label>
            )}
          </>
        )}
        {out?.kind === 'wled' && <p className="font-mono text-[9px] leading-snug text-muted">WLED takes red, green and blue for each LED, whatever the channels above say.</p>}
        <ChannelMap f={f} />
        <p className={`font-mono text-[9px] ${overflow ? 'text-red-400' : 'text-muted'}`}>
          {ch} channels · {out ? `ch ${f.address} to ${f.address + ch - 1}${out.kind !== 'enttec' && f.address - 1 + ch > 512 ? ' (continues in the next universes)' : ''}` : 'not patched : pick an output'}
          {overflow ? ' : past the 512 an Enttec carries, the rest is not sent' : ''}
        </p>
      </Section>

      <LookSection ids={[f.id]} look={look} slider={S} />
      <TuneSection ids={[f.id]} tune={tune} slider={S} />
    </>
  )
}

/** Several lights picked : what they show and their tuning, given to all of them
 *  at once (the values shown are the selected one's). */
function ManyInspector({ ids }: { ids: string[] }): JSX.Element {
  const st = useStore.getState
  const sel = useStore((s) => s.lightSel)
  const first = sel && ids.includes(sel) ? sel : ids[0]
  const f = useStore((s) => s.lightRig.fixtures.find((x) => x.id === first))
  const look = useStore((s) => s.lightsSession.looks[first]) ?? LOOK_DEFAULT
  const tune = useStore((s) => (s.lightRig.tuneScope === 'look' ? s.lightsSession.tunes?.[first] : null)) ?? f?.tune ?? TUNE_DEFAULT
  const groups = useStore((s) => s.lightRig.groups)
  const outputs = useStore((s) => s.lightRig.outputs)
  const same = groups.find((g) => g.members.length === ids.length && g.members.every((m) => ids.includes(m)))
  // (many lights : the sliders take no modulation here, one light's or a group's do)
  const S: SliderFn = (label, _field, value, min, max, step, set, reset, unit = '', title, fmt) => (
    <LightSlider key={label} label={label} fixture="" field={null} value={value} min={min} max={max} step={step} onChange={set} reset={reset} unit={unit} title={title} fmt={fmt} openMod={null} setOpenMod={() => {}} />
  )
  return (
    <>
      <Section
        title={`${ids.length} lights`}
        info="Several lights picked (Shift or Ctrl + click on the map or in the list) : what you set here goes to all of them, and a show goes to them alone. The values shown are the selected light's."
        actions={
          <button className="rounded border border-border px-2 py-1 font-mono text-[10px] text-muted hover:text-red-400" onClick={() => ids.forEach((id) => st().removeLightFixture(id))} title="Remove them all (Delete)">×</button>
        }
      >
        <div className="flex gap-1">
          {same ? (
            <span className="flex-1 font-mono text-[10px] text-accent">the group {same.name}</span>
          ) : (
            <button className={`flex-1 ${btn(false)}`} onClick={() => st().addLightGroup(ids)} title="Make these lights a group : a fader of their own on the console, picked again in one click">make a group</button>
          )}
          <button className={btn(false)} onClick={() => st().setLightSel(first)} title="Back to the one selected">just this one</button>
        </div>
        <label className="flex items-center gap-2 font-mono text-[10px] text-muted" title="Patch them all to this output (their addresses stay : the patch view puts them in order)">
          <span className="w-14 shrink-0">output</span>
          <select value={f?.out ?? ''} onChange={(e) => st().updateLightFixtures(ids.map((id) => [id, { out: e.target.value }]))} className="min-w-0 flex-1 rounded border border-border bg-panel px-1 py-0.5 text-[10px] text-text">
            <option value="">none</option>
            {outputs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <ProfilePicker ids={ids} current={f?.profile ?? ''} />
      </Section>
      {same && <GroupTuneSection id={same.id} name={same.name} />}
      <PlaceSection ids={ids} />
      <LookSection ids={ids} look={look} slider={S} />
      <TuneSection ids={ids} tune={tune} slider={S} />
    </>
  )
}

function LookSection({ ids, look, slider: S }: { ids: string[]; look: LightLook; slider: SliderFn }): JSX.Element {
  const st = useStore.getState
  const setLook = (p: Partial<LightLook>): void => st().setLightLooks(ids, p)
  const ui = FX_UI[look.effect]
  return (
    <Section title="Look" info="What it shows : the picture (the master or a layer) where it sits, a color, a gradient running across the room, or nothing; an effect over it, and its own level. Saved with the session and the cues.">
      <div className="flex flex-wrap gap-1">
        {(['master', 'layer', 'color', 'gradient', 'off'] as LightSourceKind[]).map((s) => (
          <button key={s} className={btn(look.source === s)} onClick={() => setLook({ source: s })}>
            {s === 'master' ? 'picture' : s}
          </button>
        ))}
        <button
          className="ml-auto rounded border border-border px-2 py-1 font-mono text-[10px] text-muted hover:text-accent"
          onClick={() => { const s = st(); s.setLightLooks(s.lightRig.fixtures.map((x) => x.id), { ...look }) }}
          title="Give every light this look (Ctrl+Z brings the others back)"
        >
          to all
        </button>
      </div>
      {look.source === 'layer' && (
        <div className="flex gap-1">
          {[0, 1, 2, 3].map((i) => <button key={i} className={`flex-1 ${btn(look.layer === i)}`} onClick={() => setLook({ layer: i })}>L{i + 1}</button>)}
        </div>
      )}
      {(look.source === 'master' || look.source === 'layer') && (
        <div className="flex items-center gap-1" title="How each pixel reads the picture around it">
          <span className="w-14 shrink-0 font-mono text-[10px] text-muted">reads</span>
          {SAMPLES.map((m) => (
            <button key={m} className={`flex-1 ${btn(look.sample === m)}`} onClick={() => setLook({ sample: m })} title={SAMPLE_HINT[m]}>
              {m}
            </button>
          ))}
        </div>
      )}
      {look.source === 'color' && (
        <>
          <div className="h-4 rounded border border-border" style={{ background: `hsl(${look.hue} ${look.sat * 100}% ${look.val * 50 * (2 - look.sat)}%)` }} />
          {S('hue', 'hue', look.hue, 0, 360, 1, (v) => setLook({ hue: v }), 30)}
          {S('saturation', 'sat', look.sat, 0, 1, 0.01, (v) => setLook({ sat: v }), 0.6)}
          {S('brightness', 'val', look.val, 0, 1, 0.01, (v) => setLook({ val: v }), 1)}
        </>
      )}
      {look.source === 'gradient' && <GradientEditor look={look} setLook={setLook} slider={S} />}
      <label className="flex items-center gap-2 font-mono text-[10px] text-muted">
        <span className="w-14">effect</span>
        <select value={look.effect} onChange={(e) => setLook({ effect: e.target.value as LightEffect })} className="min-w-0 flex-1 rounded border border-border bg-panel px-1 py-0.5 text-[10px] text-text" title={EFFECT_HINT[look.effect]}>
          <optgroup label="classic">
            {CLASSIC_EFFECTS.map((x) => <option key={x} value={x}>{EFFECT_LABEL[x]}</option>)}
          </optgroup>
          <optgroup label="digital">
            {DIGITAL_EFFECTS.map((x) => <option key={x} value={x}>{EFFECT_LABEL[x]}</option>)}
          </optgroup>
        </select>
        <InfoDot text={EFFECT_HINT[look.effect]} />
      </label>
      {look.effect === 'audio' && (
        <div className="flex items-center gap-1" title="What it follows : the whole sound, or its lows, mids or highs">
          <span className="w-14 shrink-0 font-mono text-[10px] text-muted">follows</span>
          {BANDS.map((b) => <button key={b} className={`flex-1 ${btn(look.band === b)}`} onClick={() => setLook({ band: b })}>{BAND_LABEL[b]}</button>)}
        </div>
      )}
      {look.effect === 'automaton' && (
        <label className="flex items-center gap-2 font-mono text-[10px] text-muted" title="The rule : which of the eight neighborhoods give a living cell. A few of the 256, each with a character of its own">
          <span className="w-14 shrink-0">rule</span>
          <select value={look.rule} onChange={(e) => setLook({ rule: Number(e.target.value) })} className="min-w-0 flex-1 rounded border border-border bg-panel px-1 py-0.5 text-[10px] text-text">
            {RULES.map((r) => <option key={r.rule} value={r.rule}>{r.name}</option>)}
            {!RULES.some((r) => r.rule === look.rule) && <option value={look.rule}>{look.rule}</option>}
          </select>
        </label>
      )}
      {look.effect !== 'none' && (
        <>
          {ui.rate && S(ui.rate, 'rate', look.rate, 0, 4, 0.01, (v) => setLook({ rate: v }), 0.5, ui.rate === 'per beat' ? '' : ' Hz', 'How fast (times the master speed). Never more than three changes a second, whatever you set.')}
          {S('depth', 'depth', look.depth, 0, 1, 0.01, (v) => setLook({ depth: v }), 0.6, '', 'How much of the effect : 0 leaves the light as its source gives it')}
          {ui.width && S(ui.width, 'width', look.width, 0.02, 1, 0.01, (v) => setLook({ width: v }), 0.25, '', ui.secs ? 'From a third of a second to eight seconds' : 'As a part of the room (or of the order, light by light)', ui.secs ? (v) => `${(0.3 + (v - 0.02) * 7.85).toFixed(1)} s` : undefined)}
        </>
      )}
      {ui.travels || look.fan !== 0 ? (
        <>
          <label className="flex items-center gap-2 font-mono text-[10px] text-muted" title="How it travels : through the room (by where each pixel is, at an angle), or light by light in an order (each light a step, as a lighting console spreads a phase over a group). The lights with the same order make one set">
            <span className="w-14 shrink-0">travels</span>
            <select value={look.order} onChange={(e) => setLook({ order: e.target.value as LightOrder })} className="min-w-0 flex-1 rounded border border-border bg-panel px-1 py-0.5 text-[10px] text-text">
              {ORDERS.map((o) => <option key={o} value={o}>{ORDER_LABEL[o]}</option>)}
            </select>
          </label>
          {look.order !== 'room' && look.order !== 'oddeven' && (
            <div className="flex items-center gap-1" title="Wings : the order folded into mirrored parts (2 : from both ends to the middle and back, as a console's wings)">
              <span className="w-14 shrink-0 font-mono text-[10px] text-muted">wings</span>
              {[1, 2, 3, 4].map((w) => <button key={w} className={`flex-1 ${btn(look.wings === w)}`} onClick={() => setLook({ wings: w })}>{w}</button>)}
            </div>
          )}
        </>
      ) : null}
      {(ui.dir || look.fan !== 0) && look.order === 'room' && S('direction', 'angle', look.angle, -180, 180, 1, (v) => setLook({ angle: v }), 0, '°', 'The direction it travels across the room')}
      {S('fan', 'fan', look.fan, -180, 180, 1, (v) => setLook({ fan: v }), 0, '°', 'A fan : the hue spread across the room (or along the order), from one end to the other')}
      {S('level', 'level', look.level, 0, 1, 0.01, (v) => setLook({ level: v }), 1, '', "This light's own fader")}
    </Section>
  )
}

/** A group's own grade, over its lights' tuning : every slider takes a modulator
 *  or a Macro knob (the whole group breathes, warms, drains of color together). */
function GroupTuneSection({ id, name }: { id: string; name: string }): JSX.Element {
  const t = useStore((s) => s.lightsSession.groupTunes?.[id]) ?? GROUP_TUNE_DEFAULT
  const level = useStore((s) => s.lightsSession.groups?.[id]) ?? 1
  const [openMod, setOpenMod] = useState<string | null>(null)
  const st = useStore.getState
  const set = (p: Partial<typeof t>): void => st().setLightGroupTune(id, p)
  const G = (label: string, field: LightModField, value: number, min: number, max: number, step: number, on: (v: number) => void, reset: number, unit = '', title?: string): JSX.Element => (
    <LightSlider key={label} label={label} fixture={`grp:${id}`} field={field} value={value} min={min} max={max} step={step} onChange={on} reset={reset} unit={unit} title={title} openMod={openMod} setOpenMod={setOpenMod} />
  )
  return (
    <Section
      title={`Group · ${name}`}
      info="The group's own fader and grade, over each of its lights' tuning : brightness, contrast and saturation multiply, hue and warmth add. Every slider has an M : a modulator or a Macro knob moves the whole group together. Saved with the session and the cues."
      actions={<button className={btn(false)} onClick={() => set({ ...GROUP_TUNE_DEFAULT })} title="Back to neutral">reset</button>}
    >
      {G('fader', 'level', level, 0, 1, 0.01, (v) => st().setLightGroupLevel(id, v), 1)}
      {G('brightness', 'tuneBrightness', t.brightness, 0, 2, 0.01, (v) => set({ brightness: v }), 1)}
      {G('contrast', 'tuneContrast', t.contrast, 0, 2, 0.01, (v) => set({ contrast: v }), 1)}
      {G('saturation', 'tuneSaturation', t.saturation, 0, 2, 0.01, (v) => set({ saturation: v }), 1)}
      {G('hue', 'tuneHue', t.hue, -180, 180, 1, (v) => set({ hue: v }), 0, '°')}
      {G('warmth', 'tuneWarmth', t.warmth, -1, 1, 0.01, (v) => set({ warmth: v }), 0)}
    </Section>
  )
}

function TuneSection({ ids, tune, slider: S }: { ids: string[]; tune: LightTune; slider: SliderFn }): JSX.Element {
  const tuneScope = useStore((s) => s.lightRig.tuneScope)
  const setTune = (p: Partial<LightTune>): void => useStore.getState().setLightTunes(ids, p)
  return (
    <Section
      title="Tuning"
      info={`How this physical light renders what it is sent : a grade to match it to the room and to the other lights. ${tuneScope === 'rig' ? 'Kept on this computer (Settings : or with the look).' : 'Travels with the look : the session and the cues (Settings).'}`}
      actions={<button className={btn(false)} onClick={() => setTune({ ...TUNE_DEFAULT })} title="Back to neutral">reset</button>}
    >
      {S('brightness', 'tuneBrightness', tune.brightness, 0, 2, 0.01, (v) => setTune({ brightness: v }), 1)}
      {S('contrast', 'tuneContrast', tune.contrast, 0, 2, 0.01, (v) => setTune({ contrast: v }), 1)}
      {S('gamma', 'tuneGamma', tune.gamma, 0.5, 3, 0.01, (v) => setTune({ gamma: v }), 2, '', 'LEDs are linear and the picture is not : 2 or so looks like the screen, lower is brighter in the shadows')}
      {S('saturation', 'tuneSaturation', tune.saturation, 0, 2, 0.01, (v) => setTune({ saturation: v }), 1)}
      {S('hue', 'tuneHue', tune.hue, -180, 180, 1, (v) => setTune({ hue: v }), 0, '°')}
      {S('warmth', 'tuneWarmth', tune.warmth, -1, 1, 0.01, (v) => setTune({ warmth: v }), 0, '', 'A white balance : cooler to warmer')}
      {S('black', 'tuneBlack', tune.black, 0, 0.3, 0.005, (v) => setTune({ black: v }), 0, '', 'A floor under the light (some LEDs flicker when almost off)')}
      {S('smooth', 'tuneSmooth', tune.smooth, 0, 2, 0.01, (v) => setTune({ smooth: v }), 0.08, ' s', 'How slowly it follows (calms the flicker of a busy picture)')}
    </Section>
  )
}

/** The kind of light it is : a built-in profile, an imported one, or its own
 *  channels; an Open Fixture Library file imports every mode of a real light. */
function ProfilePicker({ ids, current }: { ids: string[]; current: string }): JSX.Element {
  const imported = useStore((s) => s.lightRig.profiles)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [note, setNote] = useState('')
  const all = [...BUILTIN_PROFILES, ...imported]
  const known = !current || all.some((p) => p.id === current)
  const pick = (v: string): void => {
    const st = useStore.getState()
    if (v === '__import') { fileRef.current?.click(); return }
    if (v === '') { ids.forEach((id) => st.updateLightFixture(id, { profile: '' })); return }
    const p = all.find((x) => x.id === v)
    if (p) st.applyLightProfile(ids, p)
  }
  const onFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const r = readOfl(await file.text(), file.name)
    if (!r.profiles.length) { setNote(`${file.name} : nothing it can use${r.skipped.length ? ` (${r.skipped.join('; ')})` : ''}`); return }
    const st = useStore.getState()
    st.addLightProfiles(r.profiles)
    st.applyLightProfile(ids, r.profiles[0])
    setNote(`${r.name} : ${r.profiles.length} mode${r.profiles.length === 1 ? '' : 's'} added${r.skipped.length ? `, ${r.skipped.length} left out (${r.skipped.join('; ')})` : ''}. Pick the mode the light is set to.`)
  }
  const cur = imported.find((p) => p.id === current)
  return (
    <>
      <label className="flex items-center gap-2 font-mono text-[10px] text-muted" title="The kind of light it is : its channels in the right order, the ones it does not use held where they do nothing">
        <span className="w-14 shrink-0">light</span>
        <select value={known ? current : ''} onChange={(e) => pick(e.target.value)} className="min-w-0 flex-1 rounded border border-border bg-panel px-1 py-0.5 text-[10px] text-text">
          <option value="">its own channels</option>
          <optgroup label="Common lights">
            {BUILTIN_PROFILES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </optgroup>
          {imported.length > 0 && (
            <optgroup label="Imported">
              {imported.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>
          )}
          <option value="__import">import a fixture file (OFL .json)…</option>
        </select>
        {cur && (
          <button
            className="px-1 font-mono text-[10px] text-muted hover:text-red-400"
            onClick={() => { useStore.getState().removeLightProfile(cur.id); pick('') }}
            title="Forget this imported profile (the lights keep their channels)"
          >
            ×
          </button>
        )}
      </label>
      <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void onFile(e)} />
      {note && <p className="font-mono text-[9px] leading-snug text-muted">{note}</p>}
      {!note && current === '' && (
        <p className="font-mono text-[9px] leading-snug text-muted" title="open-fixture-library.org : find the light, Download, OFL JSON">
          A real light : download its file from the Open Fixture Library (OFL JSON) and import it.
        </p>
      )}
    </>
  )
}

/** How a matrix is wired : the corner its first LED is in, row by row or column
 *  by column, zigzag or not (16 ways), with its path drawn small. */
function MatrixWiring({ f, upd }: { f: LightFixture; upd: (p: Partial<LightFixture>) => void }): JSX.Element {
  const cells = matrixCells({ ...f, reverse: false })
  const W = 84, H = 56
  const n = Math.min(cells.length / 2, 400)
  const pts: string[] = []
  for (let k = 0; k < n; k++) pts.push(`${((cells[k * 2] + 0.5) / f.cols) * W},${((cells[k * 2 + 1] + 0.5) / f.rows) * H}`)
  const CORNER: Record<LightCorner, string> = { tl: '↖', tr: '↗', bl: '↙', br: '↘' }
  return (
    <div className="flex items-start gap-2" title="How the matrix is wired : where its first LED is, then row by row or column by column, zigzag (back and forth) or not">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[9px] text-muted">first LED</span>
        <div className="grid grid-cols-2 gap-0.5">
          {(['tl', 'tr', 'bl', 'br'] as LightCorner[]).map((c) => (
            <button key={c} className={btn(f.start === c && !f.reverse)} onClick={() => upd({ start: c, reverse: false })}>{CORNER[c]}</button>
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex gap-0.5">
          <button className={`flex-1 ${btn(!f.byCols)}`} onClick={() => upd({ byCols: false })}>rows</button>
          <button className={`flex-1 ${btn(f.byCols)}`} onClick={() => upd({ byCols: true })}>columns</button>
        </div>
        <button className={btn(f.serpentine)} onClick={() => upd({ serpentine: !f.serpentine })} title="Wired back and forth : every other row (or column) the other way">zigzag</button>
      </div>
      <svg width={W} height={H} className="shrink-0 rounded border border-border bg-panel">
        <polyline points={pts.join(' ')} fill="none" stroke="rgb(var(--c-accent))" strokeWidth={1} strokeOpacity={0.8} />
        {pts.length > 0 && <circle cx={Number(pts[0].split(',')[0])} cy={Number(pts[0].split(',')[1])} r={2.5} fill="rgb(var(--c-accent))" />}
      </svg>
    </div>
  )
}

/** A row of this light : n of them across the picture (or down), addressed in turn. */
function RowMaker({ f }: { f: LightFixture }): JSX.Element {
  const [n, setN] = useState(4)
  const add = useStore((s) => s.addLightRow)
  return (
    <div className="flex items-center gap-1 font-mono text-[10px] text-muted" title="A row of this light : it and its copies spread evenly across the picture (or down it), addressed one after the other, all picked (ready to be a group)">
      <span className="shrink-0">a row of</span>
      <NumBox value={n} min={2} max={32} onCommit={setN} className="w-10" />
      <button className={`flex-1 ${btn(false)}`} onClick={() => add(f.id, n, 'across')}>across</button>
      <button className={`flex-1 ${btn(false)}`} onClick={() => add(f.id, n, 'down')}>down</button>
    </div>
  )
}

/** The DIP switches that set its address (on a light that has them). */
function Dip({ address }: { address: number }): JSX.Element {
  return (
    <div className="flex items-end gap-1 font-mono text-[9px] text-muted" title="The DIP switches that set this address on a light that has them : 1 to 9, on (filled) = up. Its menu shows the address itself on most lights">
      <span className="w-14 shrink-0">DIP</span>
      {dipOf(address).map((on, i) => (
        <span key={i} className="flex flex-col items-center gap-px">
          <span className={`h-3 w-2 rounded-[1px] border ${on ? 'border-accent bg-accent' : 'border-border'}`} />
          <span className="text-[7px] leading-none">{i + 1}</span>
        </span>
      ))}
    </div>
  )
}

/** Several lights : put them in a row, a column, spread them, mirror them. */
function PlaceSection({ ids }: { ids: string[] }): JSX.Element {
  const place = (how: 'row' | 'col' | 'spreadx' | 'spready' | 'mirx' | 'miry'): void => {
    const st = useStore.getState()
    const list = st.lightRig.fixtures.filter((f) => ids.includes(f.id))
    if (list.length < 2) return
    const mids = list.map(middleOf)
    if (how === 'row' || how === 'col') {
      const k = how === 'row' ? 1 : 0
      const avg = mids.reduce((a, m) => a + m[k], 0) / mids.length
      list.forEach((f, i) => st.updateLightFixture(f.id, shifted(f, k ? 0 : avg - mids[i][0], k ? avg - mids[i][1] : 0)))
    } else if (how === 'spreadx' || how === 'spready') {
      const k = how === 'spreadx' ? 0 : 1
      const order = list.map((f, i) => ({ f, m: mids[i][k] })).sort((p, q) => p.m - q.m)
      const lo = order[0].m, hi = order[order.length - 1].m
      order.forEach((o, i) => {
        const want = lo + ((hi - lo) * i) / (order.length - 1)
        st.updateLightFixture(o.f.id, shifted(o.f, k ? 0 : want - o.m, k ? want - o.m : 0))
      })
    } else {
      const k = how === 'mirx' ? 0 : 1
      const c = (Math.min(...mids.map((m) => m[k])) + Math.max(...mids.map((m) => m[k]))) / 2
      const fl = (v: number): number => 2 * c - v
      list.forEach((f) => st.updateLightFixture(f.id, k === 0
        ? { x0: fl(f.x0), x1: fl(f.x1), bends: f.bends.map((v, i) => (i % 2 ? v : fl(v))) }
        : { y0: fl(f.y0), y1: fl(f.y1), bends: f.bends.map((v, i) => (i % 2 ? fl(v) : v)) }))
    }
  }
  return (
    <Section title="Place" info="The picked lights on the map : all at one height (a row) or in one column, spread evenly between the two outermost, or mirrored around their middle (a bar's first LED goes to the other side, as a mirrored rig would be wired). Each takes its light from where it lands.">
      <div className="grid grid-cols-2 gap-1">
        <button className={btn(false)} onClick={() => place('row')} title="All at the same height">in a row</button>
        <button className={btn(false)} onClick={() => place('col')} title="All in the same column">in a column</button>
        <button className={btn(false)} onClick={() => place('spreadx')} title="Evenly from the leftmost to the rightmost">spread across</button>
        <button className={btn(false)} onClick={() => place('spready')} title="Evenly from the highest to the lowest">spread down</button>
        <button className={btn(false)} onClick={() => place('mirx')} title="Mirrored left to right around their middle">mirror ↔</button>
        <button className={btn(false)} onClick={() => place('miry')} title="Mirrored top to bottom around their middle">mirror ↕</button>
      </div>
    </Section>
  )
}

/** Each of its channels, numbered from its address : what the light receives. */
function ChannelMap({ f }: { f: LightFixture }): JSX.Element {
  const imported = useStore((s) => s.lightRig.profiles)
  const p = imported.find((x) => x.id === f.profile && x.head === f.head && x.layout === f.layout && x.tail === f.tail)
  const lab = (tokens: string[]): string[] => tokens.flatMap((t) => (tokenWidth(t) === 2 ? [tokenLabel(t), `${tokenLabel(t).replace(' (16-bit)', '')} fine`] : [tokenLabel(t)]))
  const head = lab(layoutTokens(f.head, false)), pix = lab(layoutTokens(f.layout)), tail = lab(layoutTokens(f.tail, false))
  // an imported profile names its channels better (a wheel, a shutter held open...)
  if (p?.labels && p.labels.length === head.length + pix.length + tail.length) {
    const L = p.labels
    head.splice(0, head.length, ...L.slice(0, head.length))
    pix.splice(0, pix.length, ...L.slice(head.length, head.length + pix.length).map((x) => x.replace(/^pixel : /, '')))
    tail.splice(0, tail.length, ...L.slice(head.length + pix.length))
  }
  const n = fixturePixels(f)
  const rows: Array<[string, string]> = []
  let c = f.address
  head.forEach((l) => rows.push([String(c++), l]))
  if (n === 1) pix.forEach((l) => rows.push([String(c++), l]))
  else {
    rows.push([`${c}-${c + n * pix.length - 1}`, `${n} pixels × ${pix.join(' · ')}`])
    c += n * pix.length
  }
  tail.forEach((l) => rows.push([String(c++), l]))
  return (
    <div className="max-h-32 overflow-y-auto rounded border border-border/60 bg-panel/40 px-1.5 py-1 font-mono text-[9px] leading-snug" title="What each of its channels carries, from its address">
      {rows.map(([k, l], i) => (
        <div key={i} className="flex gap-2">
          <span className="w-14 shrink-0 text-right text-muted">{k}</span>
          <span className="min-w-0 flex-1 truncate text-text">{l}</span>
        </div>
      ))}
    </div>
  )
}

function GradientEditor({ look, setLook, slider }: { look: LightLook; setLook: (p: Partial<LightLook>) => void; slider: SliderFn }): JSX.Element {
  const g = look.gradient
  const hex = (c: number[]): string => `#${c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')}`
  const fromHex = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const setG = (p: Partial<LightLook['gradient']>): void => setLook({ gradient: { ...g, ...p } })
  return (
    <>
      <div className="h-4 rounded border border-border" style={{ background: `linear-gradient(90deg, ${g.stops.map(hex).join(', ')})` }} />
      <div className="flex items-center gap-1">
        {g.stops.map((c, i) => (
          <input key={i} type="color" value={hex(c)} onChange={(e) => setG({ stops: g.stops.map((s, j) => (j === i ? fromHex(e.target.value) : s)) })} className="h-6 w-7 cursor-pointer rounded border border-border bg-transparent" />
        ))}
        {g.stops.length < 5 && <button className={btn(false)} onClick={() => setG({ stops: [...g.stops, g.stops[g.stops.length - 1].slice()] })}>+</button>}
        {g.stops.length > 2 && <button className={btn(false)} onClick={() => setG({ stops: g.stops.slice(0, -1) })}>−</button>}
        <button
          className={btn(false)}
          onClick={() => { const pal = paletteOf(lightRuntime.grid(-1), Math.max(3, g.stops.length)); if (pal) setG({ stops: pal }) }}
          title="The picture's main colors now, left to right as they sit in it"
        >
          from the picture
        </button>
        <button className={`ml-auto ${btn(g.along)}`} onClick={() => setG({ along: !g.along })} title="Along each fixture, from its first pixel to its last, instead of across the room">along</button>
      </div>
      {!g.along && slider('angle', 'gradAngle', g.angle, -180, 180, 1, (v) => setG({ angle: v }), 0, '°', 'The direction it runs across the room')}
      {slider('scale', 'gradScale', g.scale, 0.1, 4, 0.01, (v) => setG({ scale: v }), 1, '', 'How many times it fits across')}
      {slider('offset', 'gradOffset', g.offset, 0, 1, 0.01, (v) => setG({ offset: v }), 0)}
      {slider('drift', 'gradSpeed', g.speed, -2, 2, 0.01, (v) => setG({ speed: v }), 0.05, '', 'It slides by itself (times the master speed)')}
    </>
  )
}

function IdentifyButton({ id }: { id: string }): JSX.Element {
  const ident = useStore((s) => s.lightIdentify)
  const set = useStore((s) => s.identifyLight)
  const on = ident === id
  return (
    <button
      className={btn(on)}
      onPointerDown={() => set(id)}
      onPointerUp={() => set(null)}
      onPointerLeave={() => on && set(null)}
      title="Hold : this light full white, to find it in the room (it ignores the masters and Black)"
    >
      {on ? '◉ identifying' : 'hold to identify'}
    </button>
  )
}

/** A number typed whole : taken on Enter or when the box is left (clamped then),
 *  Esc gives it back. Never while it is being typed ("12" passes through "1"). */
function NumBox({ value, min, max, onCommit, className = '', step }: { value: number; min: number; max: number; onCommit: (v: number) => void; className?: string; step?: number }): JSX.Element {
  const [txt, setTxt] = useState<string | null>(null)
  const commit = (): void => {
    if (txt === null) return
    const n = Number(txt)
    if (txt.trim() !== '' && Number.isFinite(n)) onCommit(Math.max(min, Math.min(max, step && step < 1 ? n : Math.round(n))))
    setTxt(null)
  }
  return (
    <input
      type="text" inputMode="numeric"
      value={txt ?? String(value)}
      onChange={(e) => setTxt(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { setTxt(null); e.stopPropagation() } }}
      className={`rounded border border-border bg-panel px-1 py-0.5 text-[10px] text-text ${className}`}
    />
  )
}

/** A text taken on Enter or when the box is left (an address is never sent half typed). */
function TextBox({ value, onCommit, className, placeholder, title }: { value: string; onCommit: (v: string) => void; className?: string; placeholder?: string; title?: string }): JSX.Element {
  const [txt, setTxt] = useState<string | null>(null)
  return (
    <input
      value={txt ?? value}
      placeholder={placeholder}
      title={title}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => { if (txt !== null && txt !== value) onCommit(txt); setTxt(null) }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { setTxt(null); e.stopPropagation() } }}
      className={className}
    />
  )
}

function Num({ label, value, min, max, onChange, title }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; title?: string }): JSX.Element {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-[10px] text-muted" title={title}>
      <span className="shrink-0">{label}</span>
      <NumBox value={value} min={min} max={max} onCommit={onChange} className="min-w-0 flex-1" />
    </label>
  )
}

// A slider; with a field it takes modulation (an M button opens the assign row :
// a modulator or a Macro knob; right-click clears), and while bound its thumb
// follows the live value.
function LightSlider({
  label, fixture, field, value, min, max, step, onChange, reset, unit = '', title, fmt, openMod, setOpenMod
}: {
  label: string; fixture: string; field: LightModField | null; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; reset?: number; unit?: string; title?: string; fmt?: (v: number) => string; openMod: string | null; setOpenMod: (s: string | null) => void
}): JSX.Element {
  const modMatrix = useStore((s) => s.composition.modMatrix)
  const metaKnobs = useStore((s) => s.composition.metaKnobs)
  const target: ModTarget | null = field ? { kind: 'light', fixture: LIGHT_MASTER_FIELDS.includes(field) ? '' : fixture, field } : null
  const key = target ? modTargetKey(target) : ''
  const bound = target ? modMatrix.filter((a) => modTargetKey(a.target) === key) : []
  const onMeta = target ? metaKnobs.some((k) => k.destinations.some((d) => modTargetKey(d) === key)) : false
  const modulated = bound.length > 0 || onMeta
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    const el = inputRef.current
    if (!key || !el || !modulated) return
    return registerLiveOverlay({ el, key, format: (x) => String(x) })
  }, [key, modulated])
  const open = !!field && openMod === key
  const shown = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100
  return (
    <>
      <div className="flex items-center gap-1.5" title={title}>
        <span className="w-16 shrink-0 truncate font-mono text-[10px] text-muted">{label}</span>
        <input
          ref={inputRef}
          type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerUp={(e) => e.currentTarget.blur()}
          onDoubleClick={() => reset !== undefined && onChange(reset)}
          className={`min-w-0 flex-1 ${modulated ? 'accent-accent2' : 'accent-accent'}`}
        />
        <span className={`w-11 shrink-0 text-right font-mono text-[10px] ${modulated ? 'text-accent2' : 'text-text'}`}>{fmt ? fmt(value) : `${shown}${unit}`}</span>
        {target ? (
          <button
            onClick={() => setOpenMod(open ? null : key)}
            onContextMenu={(e) => {
              e.preventDefault()
              const st = useStore.getState()
              st.composition.modMatrix.filter((a) => modTargetKey(a.target) === key).forEach((a) => st.removeAssignment(a.id))
              st.composition.metaKnobs.forEach((k, i) => { if (k.destinations.some((d) => modTargetKey(d) === key)) st.toggleMetaDest(i, target) })
            }}
            className={`shrink-0 rounded px-1 font-mono text-[9px] leading-4 ${modulated ? 'bg-accent/20 text-accent ring-1 ring-accent' : open ? 'bg-accent2/25 text-accent2 ring-1 ring-accent2' : 'bg-panel3/60 text-muted hover:text-text'}`}
            title={`Modulate the ${label} : a modulator or a Macro knob moves it. Right-click clears its modulation.`}
          >
            M{bound.length ? bound.map((b) => b.mod + 1).join('·') : ''}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
      </div>
      {open && target && <div className="pb-0.5"><AssignRow target={target} bound={bound} /></div>}
    </>
  )
}

// ── the console ──────────────────────────────────────────────────────────────
function Console(): JSX.Element {
  const m = useStore((s) => s.lightsSession.master)
  const set = useStore((s) => s.setLightsMaster)
  const black = useStore((s) => s.lightsBlack)
  const topBlack = useStore((s) => s.black)
  const setBlack = useStore((s) => s.setLightsBlack)
  const [openMod, setOpenMod] = useState<string | null>(null)
  const modMatrix = useStore((s) => s.composition.modMatrix)
  const masterBound = modMatrix.some((a) => a.target.kind === 'light' && a.target.field === 'masterBrightness')
  const groups = useStore((s) => s.lightRig.groups)
  const levels = useStore((s) => s.lightsSession.groups)
  const setGroup = useStore((s) => s.setLightGroupLevel)
  return (
    <footer className="flex flex-col border-t border-border bg-panel">
      <div className="flex items-end gap-6 px-6 py-3">
        <Knob id="lights:master" label="MASTER" value={m.brightness} text={`${Math.round(m.brightness * 100)}%`} onChange={(v) => set({ brightness: v })} big def={1} title="The grand master : every light, after its own level" />
        <Knob id="lights:speed" label="SPEED" value={m.speed / 4} text={`${m.speed.toFixed(2)}×`} onChange={(v) => set({ speed: v * 4 })} def={0.25} title="Every effect's and gradient's clock (1× at a quarter turn)" />
        <Knob id="lights:gain" label="BRIGHT" value={(m.gain ?? 1) / 2} text={`${Math.round((m.gain ?? 1) * 100)}%`} onChange={(v) => set({ gain: v * 2 })} def={0.5} title="Every light's brightness, as a grade (100% : as it is; over it, the dim parts come up). The MASTER is the fader" />
        <Knob id="lights:sat" label="SATURATION" value={(m.saturation ?? 1) / 2} text={`${Math.round((m.saturation ?? 1) * 100)}%`} onChange={(v) => set({ saturation: v * 2 })} def={0.5} title="Every light's saturation (0 : white light, 100% : as it is, over it : more vivid)" />
        <Knob id="lights:contrast" label="CONTRAST" value={(m.contrast ?? 1) / 2} text={`${Math.round((m.contrast ?? 1) * 100)}%`} onChange={(v) => set({ contrast: v * 2 })} def={0.5} title="Every light's contrast (100% : as it is)" />
        <Knob id="lights:fade" label="CUE FADE" value={m.fadeSec / 20} text={`${m.fadeSec.toFixed(1)} s`} onChange={(v) => set({ fadeSec: v * 20 })} def={0.075} title="How long a cue or a show takes to come in (a cue can have its own)" />
        <Knob id="lights:blacksec" label="BLACK TIME" value={m.blackSec / 20} text={`${m.blackSec.toFixed(1)} s`} onChange={(v) => set({ blackSec: v * 20 })} def={0.1} title="How long Black takes to go down (and to come back)" />
        <div className="flex flex-col items-center gap-1">
          <span className="relative">
            <MidiLearnOverlay id="fire:lightsblack" />
            <button
              onClick={() => setBlack(!black)}
              className={`h-14 w-24 rounded-md border font-mono text-[12px] font-semibold tracking-wide ${black ? 'border-red-400 bg-red-500/20 text-red-300' : 'border-border bg-panel2 text-text hover:border-accent'}`}
              title={`Every light down to black over the black time, and back up on a second press${topBlack ? ' (the top bar\'s Black is on : the lights are down with the whole show)' : ''}`}
            >
              {black ? '■ BLACK' : 'BLACK'}
            </button>
          </span>
          <span className="font-mono text-[9px] text-muted">{topBlack ? 'show black on' : `in ${m.blackSec.toFixed(1)} s`}</span>
        </div>
        {groups.length > 0 && (
          <div className="flex max-w-[45%] shrink-0 items-end gap-3 overflow-x-auto border-l border-border pl-4" title="The groups' faders (Groups, on the left)">
            {groups.map((g) => {
              const v = levels?.[g.id] ?? 1
              return (
                <Knob
                  key={g.id}
                  id={`lights:group:${g.id}`}
                  label={g.name.length > 10 ? `${g.name.slice(0, 9)}…` : g.name}
                  value={v}
                  text={`${Math.round(v * 100)}%`}
                  onChange={(x) => setGroup(g.id, x)}
                  def={1}
                  title={`The ${g.name} group's fader : its ${g.members.length} light${g.members.length === 1 ? '' : 's'}, after their own level`}
                />
              )
            })}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <LightSlider label="master" fixture="" field="masterBrightness" value={m.brightness} min={0} max={1} step={0.01} onChange={(v) => set({ brightness: v })} reset={1} openMod={openMod} setOpenMod={setOpenMod} title="The grand master, for a modulator or a Macro knob" />
          <LightSlider label="speed" fixture="" field="masterSpeed" value={m.speed} min={0} max={4} step={0.01} onChange={(v) => set({ speed: v })} reset={1} unit="×" openMod={openMod} setOpenMod={setOpenMod} title="The speed, for a modulator or a Macro knob" />
          <LightSlider label="brightness" fixture="" field="masterGain" value={m.gain ?? 1} min={0} max={2} step={0.01} onChange={(v) => set({ gain: v })} reset={1} openMod={openMod} setOpenMod={setOpenMod} title="Every light's brightness, for a modulator or a Macro knob" />
          <LightSlider label="saturation" fixture="" field="masterSaturation" value={m.saturation ?? 1} min={0} max={2} step={0.01} onChange={(v) => set({ saturation: v })} reset={1} openMod={openMod} setOpenMod={setOpenMod} title="Every light's saturation, for a modulator or a Macro knob" />
          <LightSlider label="contrast" fixture="" field="masterContrast" value={m.contrast ?? 1} min={0} max={2} step={0.01} onChange={(v) => set({ contrast: v })} reset={1} openMod={openMod} setOpenMod={setOpenMod} title="Every light's contrast, for a modulator or a Macro knob" />
          {masterBound && <span className="font-mono text-[9px] text-accent2">the master is modulated</span>}
        </div>
      </div>
    </footer>
  )
}

// A console knob : drag up and down (Shift : finer), double-click resets; MIDI
// Learn takes it like any control.
function Knob({ id, label, value, text, onChange, def, big = false, title }: { id: string; label: string; value: number; text: string; onChange: (v: number) => void; def: number; big?: boolean; title: string }): JSX.Element {
  const drag = useRef<{ y: number; v: number; id: number } | null>(null)
  const PX = big ? 64 : 48
  const r = PX / 2 - 5, c = PX / 2
  const rad = (deg: number): number => ((deg - 90) * Math.PI) / 180
  const a0 = 225, a = a0 + Math.max(0, Math.min(1, value)) * 270
  const pt = (deg: number): string => `${c + r * Math.cos(rad(deg))} ${c + r * Math.sin(rad(deg))}`
  return (
    <div className="relative flex flex-col items-center gap-1" title={`${title} (drag up/down, Shift finer, double-click resets)`}>
      <MidiLearnOverlay id={id} />
      <span className="font-mono text-[9px] tracking-wide text-muted">{label}</span>
      <div
        className="cursor-ns-resize"
        style={{ width: PX, height: PX, touchAction: 'none' }}
        onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { y: e.clientY, v: value, id: e.pointerId } }}
        onPointerMove={(e) => { const d = drag.current; if (!d || d.id !== e.pointerId) return; onChange(Math.max(0, Math.min(1, d.v + (d.y - e.clientY) / (e.shiftKey ? 800 : 200)))) }}
        onPointerUp={(e) => { if (drag.current?.id === e.pointerId) drag.current = null }}
        onPointerCancel={() => { drag.current = null }}
        onDoubleClick={() => onChange(def)}
      >
        <svg width={PX} height={PX}>
          <path d={`M ${pt(a0)} A ${r} ${r} 0 1 1 ${pt(a0 + 270)}`} fill="none" stroke="rgb(var(--c-panel3))" strokeWidth={big ? 5 : 4} strokeLinecap="round" />
          {value > 0.003 && <path d={`M ${pt(a0)} A ${r} ${r} 0 ${a - a0 > 180 ? 1 : 0} 1 ${pt(a)}`} fill="none" stroke="rgb(var(--c-accent))" strokeWidth={big ? 5 : 4} strokeLinecap="round" />}
        </svg>
      </div>
      <span className="font-mono text-[10px] text-text">{text}</span>
    </div>
  )
}
