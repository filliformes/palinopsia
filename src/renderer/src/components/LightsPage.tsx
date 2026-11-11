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
  EFFECTS,
  fixtureChannels,
  fixturePixels,
  LAYOUTS,
  layoutTokens,
  tokenLabel,
  tokenWidth,
  TUNE_DEFAULT,
  LIGHT_MOD_RANGE,
  LOOK_DEFAULT,
  SAMPLES,
  type LightEffect,
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
import { paletteOf } from '../lights/lightEngine'
import { readOfl } from '../lights/ofl'
import { BUILTIN_PROFILES } from '@shared/lightProfiles'
import { enttec } from '../lights/enttec'
import { LIGHT_SHOWS } from '../lights/lightShows'
import { AssignRow } from './AutoControls'
import { registerLiveOverlay } from './liveOverlay'
import { MidiLearnOverlay } from './MidiLearnOverlay'

const KIND_LABEL: Record<LightKind, string> = { strip: 'LED bar', spot: 'spot', matrix: 'matrix' }
const OUT_LABEL: Record<LightOutputKind, string> = { enttec: 'Enttec USB Pro', artnet: 'Art-Net', sacn: 'sACN', wled: 'WLED' }
const EFFECT_LABEL: Record<LightEffect, string> = {
  none: 'none', chase: 'chase', wave: 'wave', pulse: 'pulse', sparkle: 'sparkle', audio: 'sound', beat: 'beat'
}
const EFFECT_HINT: Record<LightEffect, string> = {
  none: 'No effect : the light as its source gives it.',
  chase: 'A band of light running across the room (angle : its direction, width : the band).',
  wave: 'Waves of light passing through the room (width : their length).',
  pulse: 'The whole fixture breathing.',
  sparkle: 'Pixels twinkling at random (rate : how often).',
  audio: 'As bright as the sound is loud.',
  beat: 'A flash on the beat (rate : flashes a beat).'
}

const SAMPLE_HINT: Record<LightSample, string> = {
  average: 'The average of its patch of picture : calm, but a busy picture can go beige',
  vivid: 'The most colorful part of its patch : the lights keep the picture\u2019s colors',
  bright: 'The brightest part of its patch : the highlights carry, the dark stays dark'
}

const btn = (on: boolean): string =>
  `rounded border px-2 py-1 font-mono text-[10px] transition-colors ${
    on ? 'border-accent/60 bg-accent/15 text-accent' : 'border-border text-muted hover:text-text'
  }`

/** An LED value back to how it looks (the LEDs are linear, a screen is not). */
const show = (c: number): number => Math.round(Math.pow(Math.max(0, Math.min(1, c)), 1 / 2.2) * 255)

export function LightsPage({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null> }): JSX.Element {
  const rig = useStore((s) => s.lightRig)
  const sel = useStore((s) => s.lightSel)
  const picked = useStore((s) => s.lightPicked)
  const setOpen = useStore((s) => s.setLightsPageOpen)
  const selected = rig.fixtures.find((f) => f.id === sel) ?? null

  // Keys while the page is up : Delete removes the picked fixtures, the arrows
  // move them (Shift : farther), Ctrl+D duplicates the selected one, Esc closes the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const st = useStore.getState()
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); st.setLightsPageOpen(false); return }
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
      for (const id of ids) {
        const x = st.lightRig.fixtures.find((q) => q.id === id)
        if (x) st.updateLightFixture(id, { x0: x.x0 + d[0], y0: x.y0 + d[1], x1: x.x1 + d[0], y1: x.y1 + d[1] })
      }
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
          onClick={() => setOpen(false)}
          className="rounded border border-border px-3 py-1 font-mono text-[11px] text-muted hover:text-accent"
        >
          ← back to instrument
        </button>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col gap-2 overflow-y-auto border-r border-border bg-panel p-2">
          <FixtureList />
          <GroupList />
          <OutputList />
          <ShowList />
          <SceneList />
          <Settings />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col bg-black/40">
          <MapView canvasRef={canvasRef} />
        </main>
        <aside className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto border-l border-border bg-panel p-2">
          {picked.length > 1 ? <ManyInspector ids={picked} /> : selected ? <Inspector f={selected} /> : <NoSelection />}
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
        title="The lights send DMX (off : nothing goes out; the page still shows what they would do)"
      >
        {rig.on ? '◉ lights on' : 'lights off'}
      </button>
      <span title="DMX frames sent in the last second, and the universes going out">
        {rig.on ? `${st.fps} fps · ${st.universes} universe${st.universes === 1 ? '' : 's'}` : 'not sending'}
      </span>
      <span>· {rig.fixtures.length} fixture{rig.fixtures.length === 1 ? '' : 's'}</span>
    </div>
  )
}

// ── a section ────────────────────────────────────────────────────────────────
function Section({ title, info, actions, children, defaultCollapsed = false }: { title: string; info?: string; actions?: ReactNode; children: ReactNode; defaultCollapsed?: boolean }): JSX.Element {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  return (
    <div className="rounded-md border border-border bg-panel2">
      <div className="flex items-center gap-1.5 px-2 py-1.5" title={info}>
        <button onClick={() => setCollapsed((c) => !c)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <span className={`font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>
          <span className="truncate font-mono text-[9px] uppercase tracking-wide text-muted">{title}</span>
        </button>
        {actions}
      </div>
      {!collapsed && <div className="flex min-w-0 flex-col gap-1.5 px-2 pb-2">{children}</div>}
    </div>
  )
}

// ── the room : fixtures, outputs, shows, scenes, settings ────────────────────
function FixtureList(): JSX.Element {
  const rig = useStore((s) => s.lightRig)
  const sel = useStore((s) => s.lightSel)
  const picked = useStore((s) => s.lightPicked)
  const add = useStore((s) => s.addLightFixture)
  const setSel = useStore((s) => s.setLightSel)
  const toggle = useStore((s) => s.toggleLightPick)
  return (
    <Section title="Fixtures" info="Every light in the room. Add one, then place it on the map over the part of the picture it should take its light from. Shift or Ctrl + click picks several : a look, a tuning or a show then goes to all of them.">
      <div className="flex gap-1">
        <button className={`flex-1 ${btn(false)}`} onClick={() => add('strip')} title="An LED bar : a row of pixels along a line on the picture">+ bar</button>
        <button className={`flex-1 ${btn(false)}`} onClick={() => add('spot')} title="A single light : a small RGB spot, a PAR, a wash">+ spot</button>
        <button className={`flex-1 ${btn(false)}`} onClick={() => add('matrix')} title="An LED matrix : a grid of pixels over a rectangle of the picture">+ matrix</button>
      </div>
      {rig.fixtures.length === 0 && <p className="font-mono text-[10px] leading-snug text-muted">No fixtures yet. Add a bar, a spot or a matrix, then an output in Outputs.</p>}
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
              <button className="px-1 font-mono text-[11px] text-muted hover:text-red-400" onClick={() => remove(o.id)} title="Remove this output (its fixtures wait, unpatched)">×</button>
            </div>
            <div className="flex items-center gap-1.5 font-mono text-[9px] text-muted">
              <label
                className="flex items-center gap-1"
                title="Held back this long before it goes out. The lights answer at once and a projector shows the picture two or three frames late : about 40 ms keeps them together (0 for lights alone)"
              >
                delay
                <input
                  type="number" min={0} max={1000} step={5} value={o.delay}
                  onChange={(e) => update(o.id, { delay: Math.max(0, Math.min(1000, Math.round(Number(e.target.value) || 0))) })}
                  className="w-12 rounded border border-border bg-panel px-1 py-0.5 text-[10px] text-text"
                />
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
                  <span className="min-w-0 flex-1 truncate" title={s?.error || ''}>
                    {s?.status === 'open' ? `connected · ${s.frames} frames` : s?.status === 'unsupported' ? 'no serial ports here' : s?.status === 'error' ? `error : ${s.error}` : o.enabled ? `looking${s?.error ? ` (${s.error})` : ''}` : 'off'}
                  </span>
                  <button className={btn(false)} onClick={() => enttec.rescan()} title="Look for the Pro again now">scan</button>
                </>
              ) : (
                <input
                  value={o.host}
                  placeholder={o.kind === 'sacn' ? 'multicast (or an IP)' : 'IP address'}
                  onChange={(e) => update(o.id, { host: e.target.value })}
                  className="min-w-0 flex-1 rounded border border-border bg-panel px-1 py-0.5 text-[10px] text-text"
                  title={o.kind === 'sacn' ? 'Empty : multicast to each universe\'s group (239.255.x.y). An IP : sent to that device only.' : 'The device\'s IP address on this network'}
                />
              )}
            </div>
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
      info="A look for every light at once, fading in over the scene fade time. Each one fits your room : its patterns run across the space, so every light takes its part from where it stands. With several lights picked (or a group), the show goes to them alone."
    >
      <div className="grid grid-cols-2 gap-1">
        {LIGHT_SHOWS.map((s) => (
          <button key={s.id} disabled={!n} className={`${btn(false)} truncate text-left disabled:opacity-40`} onClick={() => apply(s.id, some ? picked : undefined)} title={s.blurb}>
            {s.name}
          </button>
        ))}
      </div>
    </Section>
  )
}

function SceneList(): JSX.Element {
  const scenes = useStore((s) => s.lightsSession.scenes)
  const save = useStore((s) => s.saveLightScene)
  const recall = useStore((s) => s.recallLightScene)
  const rename = useStore((s) => s.renameLightScene)
  const del = useStore((s) => s.deleteLightScene)
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <Section
      title="Light scenes"
      info="Looks for the lights, apart from Palinopsia's scenes : save what they show now, click to bring one back (over the scene fade time), double-click to rename. Saved with the session."
      actions={<button className={btn(false)} onClick={save} title="Save what the lights show now as a light scene">+ save</button>}
    >
      {scenes.length === 0 && <p className="font-mono text-[10px] text-muted">None yet.</p>}
      <div className="flex flex-col gap-0.5">
        {scenes.map((sc, i) => (
          <div key={sc.id} className="flex items-center gap-1">
            {editing === sc.id ? (
              <input
                autoFocus
                defaultValue={sc.name}
                onBlur={(e) => { rename(sc.id, e.target.value); setEditing(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                className="min-w-0 flex-1 rounded border border-border bg-panel px-1 py-0.5 font-mono text-[10px]"
              />
            ) : (
              <button
                onClick={() => recall(sc.id)}
                onDoubleClick={() => setEditing(sc.id)}
                className="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left font-mono text-[10px] hover:bg-panel3/60"
                title="Click : bring it back · double-click : rename"
              >
                <span className="text-muted">{i + 1}</span> {sc.name}
              </button>
            )}
            <button className="px-1 font-mono text-[11px] text-muted hover:text-red-400" onClick={() => del(sc.id)} title="Delete this light scene">×</button>
          </div>
        ))}
      </div>
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
            title="The tuning belongs to the lights themselves : it stays whatever session or light scene you open"
          >
            on this computer
          </button>
          <button
            className={`flex-1 ${btn(rig.tuneScope === 'look')}`}
            onClick={() => setRig({ tuneScope: 'look' })}
            title="The tuning travels with the session and the light scenes : each look brings its own"
          >
            with the look
          </button>
        </div>
      </div>
    </Section>
  )
}

function NoSelection(): JSX.Element {
  return (
    <div className="flex flex-col gap-2 p-2 font-mono text-[10px] leading-relaxed text-muted">
      <p>Click a fixture on the map or in the list to set it up : where it is patched, what it shows, how it is tuned.</p>
      <p>On the map : drag a fixture to move it (it takes its light from another part of the picture), drag the ends of a bar or the corners of a matrix to reshape it. The arrows nudge it (Shift : farther), Delete removes it, Ctrl+D duplicates it.</p>
      <p>Shift or Ctrl + click picks several lights (on the map or in the list) : drag one and they all move, and a look, a tuning, a profile or a show goes to all of them. Make them a group to pick them again in one click and give them a fader.</p>
    </div>
  )
}

// ── the map ──────────────────────────────────────────────────────────────────
type Drag = { id: string; mode: 'move' | 'p0' | 'p1' | 'c01' | 'c10'; sx: number; sy: number; f: LightFixture; pid: number; group?: LightFixture[] }

function MapView({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null> }): JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const compW = useStore((s) => s.compW)
  const compH = useStore((s) => s.compH)
  const [backdrop, setBackdrop] = useState<'auto' | 'master' | 'room'>('auto')
  const [labels, setLabels] = useState(true)
  const drag = useRef<Drag | null>(null)
  const layerCanvas = useMemo(() => document.createElement('canvas'), [])
  const aspect = compW / Math.max(1, compH)

  // the map's rect inside the canvas (the picture's proportions, centered)
  const rectOf = (cw: number, ch: number): { x: number; y: number; w: number; h: number } => {
    const pad = 24
    let w = cw - pad * 2, h = w / aspect
    if (h > ch - pad * 2) { h = ch - pad * 2; w = h * aspect }
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h }
  }

  useEffect(() => {
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
      // the backdrop : the picture the selected fixture reads (a layer's own), or the master
      g.fillStyle = '#000'
      g.fillRect(R.x, R.y, R.w, R.h)
      const wantLayer = backdrop === 'auto' && selLook?.source === 'layer' ? selLook.layer : -1
      if (backdrop !== 'room') {
        const grid = wantLayer >= 0 ? lightRuntime.grid(wantLayer) : null
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
            g.globalAlpha = 0.85
            g.drawImage(layerCanvas, R.x, R.y, R.w, R.h)
            g.globalAlpha = 1
          }
        } else if (canvasRef.current) {
          g.globalAlpha = 0.85
          try { g.drawImage(canvasRef.current, R.x, R.y, R.w, R.h) } catch { /* not ready */ }
          g.globalAlpha = 1
        }
      }
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
      for (const f of st.lightRig.fixtures) {
        const on = f.id === st.lightSel
        const also = !on && st.lightPicked.includes(f.id)
        const colors = lightRuntime.last?.colors.get(f.id)
        const col = (i: number): string => (colors && colors.length >= i * 3 + 3 ? `rgb(${show(colors[i * 3])},${show(colors[i * 3 + 1])},${show(colors[i * 3 + 2])})` : '#333')
        g.lineWidth = on || also ? 2 : 1
        g.strokeStyle = on ? 'rgb(255,170,60)' : also ? 'rgba(255,170,60,0.6)' : 'rgba(255,255,255,0.55)'
        if (f.kind === 'spot') {
          const [cx, cy] = P(f.x0, f.y0)
          const r = Math.max(7, f.size * R.h * 1.2)
          g.fillStyle = col(0)
          g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); g.stroke()
        } else if (f.kind === 'matrix') {
          const [ax, ay] = P(f.x0, f.y0), [bx, by] = P(f.x1, f.y1)
          const cwid = (bx - ax) / f.cols, chei = (by - ay) / f.rows
          // the colors in channel order : back to their cells
          for (let r = 0; r < f.rows; r++) {
            for (let c = 0; c < f.cols; c++) {
              let k = r * f.cols + (f.serpentine && r % 2 === 1 ? f.cols - 1 - c : c)
              if (f.reverse) k = f.cols * f.rows - 1 - k
              g.fillStyle = col(k)
              g.fillRect(ax + c * cwid + 1, ay + r * chei + 1, Math.max(1, cwid - 2), Math.max(1, chei - 2))
            }
          }
          g.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay))
        } else {
          const [ax, ay] = P(f.x0, f.y0), [bx, by] = P(f.x1, f.y1)
          g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke()
          const n = Math.max(1, f.pixels)
          const len = Math.hypot(bx - ax, by - ay)
          const dot = Math.max(2, Math.min(9, (len / n) * 0.8))
          const step = Math.max(1, Math.ceil(n / Math.max(1, len / 2.5)))
          for (let i = 0; i < n; i += step) {
            const t = n === 1 ? 0.5 : i / (n - 1)
            const u = f.reverse ? 1 - t : t
            g.fillStyle = col(i)
            g.fillRect(ax + u * (bx - ax) - dot / 2, ay + u * (by - ay) - dot / 2, dot, dot)
          }
          // the first LED's end, marked
          const [fx, fy] = f.reverse ? [bx, by] : [ax, ay]
          g.fillStyle = on ? 'rgb(255,170,60)' : 'rgba(255,255,255,0.7)'
          g.beginPath(); g.arc(fx, fy, 3, 0, Math.PI * 2); g.fill()
        }
        if (on) {
          g.fillStyle = 'rgb(255,170,60)'
          const hs: Array<[number, number]> = f.kind === 'spot' ? [] : f.kind === 'matrix' ? [P(f.x0, f.y0), P(f.x1, f.y1), P(f.x1, f.y0), P(f.x0, f.y1)] : [P(f.x0, f.y0), P(f.x1, f.y1)]
          for (const [hx, hy] of hs) g.fillRect(hx - 4, hy - 4, 8, 8)
        }
        if (labels) {
          const [lx, ly] = f.kind === 'spot' ? P(f.x0, f.y0) : P(Math.min(f.x0, f.x1), Math.min(f.y0, f.y1))
          g.font = '10px ui-monospace, monospace'
          g.fillStyle = on ? 'rgb(255,170,60)' : 'rgba(255,255,255,0.75)'
          g.fillText(f.name, lx + 2, ly - 8)
        }
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [backdrop, labels, aspect, canvasRef, layerCanvas])

  // pointer : select, move, reshape
  const toMap = (e: RPointerEvent<HTMLCanvasElement>): [number, number, { x: number; y: number; w: number; h: number }] => {
    const cv = ref.current!
    const b = cv.getBoundingClientRect()
    const R = rectOf(b.width, b.height)
    return [(e.clientX - b.left - R.x) / R.w, (e.clientY - b.top - R.y) / R.h, R]
  }
  const hit = (x: number, y: number, R: { w: number; h: number }): { f: LightFixture; mode: Drag['mode'] } | null => {
    const st = useStore.getState()
    const px = (dx: number, dy: number): number => Math.hypot(dx * R.w, dy * R.h)
    const selF = st.lightRig.fixtures.find((f) => f.id === st.lightSel)
    if (selF && selF.kind !== 'spot') {
      if (px(x - selF.x0, y - selF.y0) < 9) return { f: selF, mode: 'p0' }
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
      } else {
        // distance to the segment, in pixels
        const ax = f.x0 * R.w, ay = f.y0 * R.h, bx = f.x1 * R.w, by = f.y1 * R.h, qx = x * R.w, qy = y * R.h
        const vx = bx - ax, vy = by - ay
        const t = Math.max(0, Math.min(1, ((qx - ax) * vx + (qy - ay) * vy) / Math.max(1e-6, vx * vx + vy * vy)))
        if (Math.hypot(qx - (ax + t * vx), qy - (ay + t * vy)) < 8) return { f, mode: 'move' }
      }
    }
    return null
  }
  const onDown = (e: RPointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return
    const [x, y, R] = toMap(e)
    const h = hit(x, y, R)
    const st = useStore.getState()
    const mod = e.shiftKey || e.ctrlKey || e.metaKey
    if (!h) { if (!mod) st.setLightSel(null); return }
    // Shift / Ctrl + click : one more picked (or one less)
    if (mod && h.mode === 'move') { st.toggleLightPick(h.f.id); return }
    // one of several picked : they all move with it
    const many = h.mode === 'move' && st.lightPicked.length > 1 && st.lightPicked.includes(h.f.id)
    if (many) useStore.setState({ lightSel: h.f.id })
    else st.setLightSel(h.f.id)
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = {
      id: h.f.id, mode: h.mode, sx: x, sy: y, f: h.f, pid: e.pointerId,
      group: many ? st.lightRig.fixtures.filter((q) => st.lightPicked.includes(q.id)) : undefined
    }
  }
  const onMove = (e: RPointerEvent<HTMLCanvasElement>): void => {
    const d = drag.current
    if (!d || e.pointerId !== d.pid) return
    let [x, y] = toMap(e)
    const st = useStore.getState()
    const f = d.f
    const dx = x - d.sx, dy = y - d.sy
    if (d.mode === 'move') {
      for (const q of d.group ?? [f]) st.updateLightFixture(q.id, { x0: q.x0 + dx, y0: q.y0 + dy, x1: q.x1 + dx, y1: q.y1 + dy })
      return
    }
    // Shift : a bar's end kept level or upright
    if (e.shiftKey && f.kind === 'strip') {
      const ox = d.mode === 'p0' ? f.x1 : f.x0, oy = d.mode === 'p0' ? f.y1 : f.y0
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 font-mono text-[10px] text-muted">
        <span>under the fixtures</span>
        {(['auto', 'master', 'room'] as const).map((b) => (
          <button
            key={b}
            className={btn(backdrop === b)}
            onClick={() => setBackdrop(b)}
            title={b === 'auto' ? "The picture the selected fixture reads (a layer's own, or the master)" : b === 'master' ? 'The master picture, always' : 'Only the room : a grid, no picture'}
          >
            {b === 'auto' ? 'its source' : b === 'master' ? 'master' : 'room'}
          </button>
        ))}
        <div className="flex-1" />
        <button className={btn(labels)} onClick={() => setLabels((v) => !v)}>names</button>
      </div>
      <div ref={boxRef} className="relative min-h-0 flex-1">
        <canvas
          ref={ref}
          className="absolute inset-0 cursor-crosshair"
          style={{ touchAction: 'none' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
      </div>
    </div>
  )
}

// ── the inspector ────────────────────────────────────────────────────────────
type SliderFn = (label: string, field: LightModField | null, value: number, min: number, max: number, step: number, set: (v: number) => void, reset?: number, unit?: string, title?: string) => JSX.Element

function Inspector({ f }: { f: LightFixture }): JSX.Element {
  const st = useStore.getState
  const outputs = useStore((s) => s.lightRig.outputs)
  const look = useStore((s) => s.lightsSession.looks[f.id]) ?? LOOK_DEFAULT
  const tune = useStore((s) => (s.lightRig.tuneScope === 'look' ? s.lightsSession.tunes?.[f.id] : null)) ?? f.tune
  const upd = (p: Partial<LightFixture>): void => st().updateLightFixture(f.id, p)
  const out = outputs.find((o) => o.id === f.out)
  const ch = fixtureChannels(f)
  const overflow = out?.kind === 'enttec' && f.address - 1 + ch > 512
  const custom = !(LAYOUTS as readonly string[]).includes(f.layout)
  const [openMod, setOpenMod] = useState<string | null>(null)
  const S: SliderFn = (label, field, value, min, max, step, set, reset, unit = '', title) => (
    <LightSlider key={label} label={label} fixture={f.id} field={field} value={value} min={min} max={max} step={step} onChange={set} reset={reset} unit={unit} title={title} openMod={openMod} setOpenMod={setOpenMod} />
  )
  return (
    <>
      <Section
        title="Fixture"
        actions={
          <div className="flex gap-1">
            <button className={btn(false)} onClick={() => st().duplicateLightFixture(f.id)} title="Duplicate (Ctrl+D)">dup</button>
            <button className="rounded border border-border px-2 py-1 font-mono text-[10px] text-muted hover:text-red-400" onClick={() => st().removeLightFixture(f.id)} title="Remove (Delete)">×</button>
          </div>
        }
      >
        <input value={f.name} onChange={(e) => upd({ name: e.target.value })} className="rounded border border-border bg-panel px-1.5 py-1 font-mono text-[11px]" />
        <div className="flex gap-1">
          {(['strip', 'spot', 'matrix'] as const).map((k) => (
            <button key={k} className={`flex-1 ${btn(f.kind === k)}`} onClick={() => upd({ kind: k })}>{KIND_LABEL[k]}</button>
          ))}
        </div>
        {f.kind === 'strip' && (
          <Num label="LEDs" value={f.pixels} min={1} max={2048} onChange={(v) => upd({ pixels: v })} title="How many pixels the bar has (each takes the picture at its place along the line)" />
        )}
        {f.kind === 'matrix' && (
          <div className="flex gap-1.5">
            <Num label="columns" value={f.cols} min={1} max={128} onChange={(v) => upd({ cols: v })} />
            <Num label="rows" value={f.rows} min={1} max={128} onChange={(v) => upd({ rows: v })} />
          </div>
        )}
        {f.kind !== 'spot' && (
          <div className="flex gap-1">
            <button className={`flex-1 ${btn(f.reverse)}`} onClick={() => upd({ reverse: !f.reverse })} title="The first LED at the other end">reversed</button>
            {f.kind === 'matrix' && <button className={`flex-1 ${btn(f.serpentine)}`} onClick={() => upd({ serpentine: !f.serpentine })} title="Wired back and forth, every other row reversed">serpentine</button>}
          </div>
        )}
        {S('sampled', null, f.size, 0, 0.3, 0.005, (v) => upd({ size: v }), 0.03, '', 'How wide a patch of the picture each pixel reads (larger : calmer, less detail)')}
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
          {out && out.kind !== 'enttec' && <Num label="universe" value={f.universe} min={0} max={32767} onChange={(v) => upd({ universe: v })} />}
          <Num label="address" value={f.address} min={1} max={512} onChange={(v) => upd({ address: v })} title="Its first DMX channel (1..512) : the light's own address (its menu or DIP switches)" />
        </div>
        <ProfilePicker ids={[f.id]} current={f.profile} />
        {!f.profile && (
          <>
            <label className="flex items-center gap-2 font-mono text-[10px] text-muted">
              <span className="w-14">channels</span>
              <select
                value={custom ? '__custom' : f.layout}
                onChange={(e) => upd({ layout: e.target.value === '__custom' ? 'D R G B S' : e.target.value })}
                className="min-w-0 flex-1 rounded border border-border bg-panel px-1 py-0.5 text-[10px] text-text"
                title="The channels of one pixel. With a dimmer (D, D16 in 16 bits) the dimmer takes the level and the color stays full : smoother fades down low"
              >
                {LAYOUTS.map((l) => <option key={l} value={l}>{l}</option>)}
                <option value="__custom">your own…</option>
              </select>
            </label>
            {custom && (
              <input
                value={f.layout}
                onChange={(e) => upd({ layout: e.target.value })}
                className="rounded border border-border bg-panel px-1.5 py-1 font-mono text-[10px]"
                title="The channels of one pixel, in order : R G B W A U, C M Y (a subtractive mix), L (one channel of white), D (a dimmer : it takes the level), S (strobe, off), X (unused), a letter followed by 16 for 16 bits (D16), or a number (0..255) for a channel held at that value"
              />
            )}
            {f.kind !== 'spot' && (
              <label className="flex items-center gap-2 font-mono text-[10px] text-muted" title="Channels sent once before the pixels (a bar's own dimmer and strobe : D S). A dimmer here is the whole bar's : it takes its brightest pixel, and the pixels go out relative to it">
                <span className="w-14 shrink-0">before</span>
                <input
                  value={f.head}
                  placeholder="none"
                  onChange={(e) => upd({ head: e.target.value })}
                  className="min-w-0 flex-1 rounded border border-border bg-panel px-1.5 py-0.5 font-mono text-[10px] text-text"
                />
              </label>
            )}
          </>
        )}
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
  const same = groups.find((g) => g.members.length === ids.length && g.members.every((m) => ids.includes(m)))
  // (many lights : the sliders take no modulation here, one light's or a group's do)
  const S: SliderFn = (label, _field, value, min, max, step, set, reset, unit = '', title) => (
    <LightSlider key={label} label={label} fixture="" field={null} value={value} min={min} max={max} step={step} onChange={set} reset={reset} unit={unit} title={title} openMod={null} setOpenMod={() => {}} />
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
        <ProfilePicker ids={ids} current={f?.profile ?? ''} />
      </Section>
      <LookSection ids={ids} look={look} slider={S} />
      <TuneSection ids={ids} tune={tune} slider={S} />
    </>
  )
}

function LookSection({ ids, look, slider: S }: { ids: string[]; look: LightLook; slider: SliderFn }): JSX.Element {
  const st = useStore.getState
  const setLook = (p: Partial<LightLook>): void => st().setLightLooks(ids, p)
  return (
    <Section title="Look" info="What it shows : the picture (the master or a layer) where it sits, a color, a gradient running across the room, or nothing; an effect over it, and its own level. Saved with the session and the light scenes.">
      <div className="flex flex-wrap gap-1">
        {(['master', 'layer', 'color', 'gradient', 'off'] as LightSourceKind[]).map((s) => (
          <button key={s} className={btn(look.source === s)} onClick={() => setLook({ source: s })}>
            {s === 'master' ? 'picture' : s}
          </button>
        ))}
        <button
          className="ml-auto rounded border border-border px-2 py-1 font-mono text-[10px] text-muted hover:text-accent"
          onClick={() => { const s = st(); s.setLightLooks(s.lightRig.fixtures.map((x) => x.id), { ...look }) }}
          title="Give every fixture this look"
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
          {EFFECTS.map((x) => <option key={x} value={x}>{EFFECT_LABEL[x]}</option>)}
        </select>
      </label>
      {look.effect !== 'none' && (
        <>
          {look.effect !== 'audio' && S(look.effect === 'beat' ? 'per beat' : 'rate', 'rate', look.rate, 0, 4, 0.01, (v) => setLook({ rate: v }), 0.5, look.effect === 'beat' ? '' : ' Hz', 'Its speed (times the master speed). Never more than three changes a second, whatever you set.')}
          {S('depth', 'depth', look.depth, 0, 1, 0.01, (v) => setLook({ depth: v }), 0.6)}
          {(look.effect === 'chase' || look.effect === 'wave') && S('width', 'width', look.width, 0.02, 1, 0.01, (v) => setLook({ width: v }), 0.25)}
          {(look.effect === 'chase' || look.effect === 'wave') && S('direction', 'angle', look.angle, -180, 180, 1, (v) => setLook({ angle: v }), 0, '°')}
        </>
      )}
      {S('level', 'level', look.level, 0, 1, 0.01, (v) => setLook({ level: v }), 1, '', "This fixture's own fader")}
    </Section>
  )
}

function TuneSection({ ids, tune, slider: S }: { ids: string[]; tune: LightTune; slider: SliderFn }): JSX.Element {
  const tuneScope = useStore((s) => s.lightRig.tuneScope)
  const setTune = (p: Partial<LightTune>): void => useStore.getState().setLightTunes(ids, p)
  return (
    <Section
      title="Tuning"
      info={`How this physical light renders what it is sent : a grade to match it to the room and to the other lights. ${tuneScope === 'rig' ? 'Kept on this computer (Settings : or with the look).' : 'Travels with the look : the session and the light scenes (Settings).'}`}
      actions={<button className={btn(false)} onClick={() => setTune({ ...TUNE_DEFAULT })} title="Back to neutral">reset</button>}
    >
      {S('brightness', 'tuneBrightness', tune.brightness, 0, 2, 0.01, (v) => setTune({ brightness: v }), 1)}
      {S('contrast', null, tune.contrast, 0, 2, 0.01, (v) => setTune({ contrast: v }), 1)}
      {S('gamma', null, tune.gamma, 0.5, 3, 0.01, (v) => setTune({ gamma: v }), 2, '', 'LEDs are linear and the picture is not : 2 or so looks like the screen, lower is brighter in the shadows')}
      {S('saturation', 'tuneSaturation', tune.saturation, 0, 2, 0.01, (v) => setTune({ saturation: v }), 1)}
      {S('hue', 'tuneHue', tune.hue, -180, 180, 1, (v) => setTune({ hue: v }), 0, '°')}
      {S('warmth', 'tuneWarmth', tune.warmth, -1, 1, 0.01, (v) => setTune({ warmth: v }), 0, '', 'A white balance : cooler to warmer')}
      {S('black', null, tune.black, 0, 0.3, 0.005, (v) => setTune({ black: v }), 0, '', 'A floor under the light (some LEDs flicker when almost off)')}
      {S('smooth', null, tune.smooth, 0, 2, 0.01, (v) => setTune({ smooth: v }), 0.08, ' s', 'How slowly it follows (calms the flicker of a busy picture)')}
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
      {slider('drift', null, g.speed, -2, 2, 0.01, (v) => setG({ speed: v }), 0.05, '', 'It slides by itself (times the master speed)')}
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
      title="Hold : this fixture full white, to find it in the room (it ignores the masters and Black)"
    >
      {on ? '◉ identifying' : 'hold to identify'}
    </button>
  )
}

function Num({ label, value, min, max, onChange, title }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; title?: string }): JSX.Element {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-[10px] text-muted" title={title}>
      <span className="shrink-0">{label}</span>
      <input
        type="number" min={min} max={max} value={value}
        onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, Math.round(n)))) }}
        className="min-w-0 flex-1 rounded border border-border bg-panel px-1 py-0.5 text-[10px] text-text"
      />
    </label>
  )
}

// A slider; with a field it takes modulation (an M button opens the assign row :
// a modulator or a Macro knob; right-click clears), and while bound its thumb
// follows the live value.
function LightSlider({
  label, fixture, field, value, min, max, step, onChange, reset, unit = '', title, openMod, setOpenMod
}: {
  label: string; fixture: string; field: LightModField | null; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; reset?: number; unit?: string; title?: string; openMod: string | null; setOpenMod: (s: string | null) => void
}): JSX.Element {
  const modMatrix = useStore((s) => s.composition.modMatrix)
  const metaKnobs = useStore((s) => s.composition.metaKnobs)
  const target: ModTarget | null = field ? { kind: 'light', fixture: field === 'masterBrightness' || field === 'masterSpeed' ? '' : fixture, field } : null
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
          onDoubleClick={() => reset !== undefined && onChange(reset)}
          className={`min-w-0 flex-1 ${modulated ? 'accent-accent2' : 'accent-accent'}`}
        />
        <span className={`w-11 shrink-0 text-right font-mono text-[10px] ${modulated ? 'text-accent2' : 'text-text'}`}>{shown}{unit}</span>
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
        <Knob id="lights:fade" label="SCENE FADE" value={m.fadeSec / 20} text={`${m.fadeSec.toFixed(1)} s`} onChange={(v) => set({ fadeSec: v * 20 })} def={0.075} title="How long a light scene or a show takes to come in" />
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
