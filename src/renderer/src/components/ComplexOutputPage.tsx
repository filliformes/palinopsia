// Complex Output : the page (in its own window, PageWindow 'complex'; Shift+O, or
// the Output page's button). Two steps : Screens (what goes to which projector) and
// Map (which part of the picture goes where on it). The two views are drawn outside
// React (complex/cxEditor.ts); this is the lists, the numbers and the buttons.

import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ModTarget } from '@shared/types'
import {
  CX_COLOR, CX_EDGES, CX_MAX_CELLS, CX_MAX_SCREENS, CX_MAX_SLICES, CX_SOURCES, CX_SOURCE_LABEL, copyScreen, cxColorAt, findSlice, newScreen, newSlice, patchScreen, patchSlice, rectPts, sanitizeSetup, sliceNumber,
  type CxColor, type CxEdges, type CxMask, type CxScreen, type CxSetup, type CxSlice, type CxSource, type CxTarget, type CxWarpType
} from '@shared/complexOut'
import { autoBlend, findOverlaps } from '../complex/cxBlend'
import { addMask, commit, CxView, deleteInHand, duplicateInHand } from '../complex/cxEditor'
import { importAdvancedOutput } from '../complex/cxImport'
import { bounds, evalWarp, mapPoints, rectWarp, resampleWarp, warpOutline } from '../complex/cxMath'
import { findProblems, matchDisplay, type CxDisplay, type CxProblem, type CxState } from '../complex/cxProblems'
import { deletePreset, loadPresets, savePreset } from '../complex/cxSaved'
import { cxSelection, pickScreen, pickSlice, useCxUi } from '../complex/cxUi'
import { cxRuntime } from '../complex/cxWindows'
import { outputCanvas } from '../engine/outputCanvas'
import { modTargetKey, useStore } from '../store'
import { redo, undo, useUndoState } from '../undo'
import { AssignRow } from './AutoControls'
import { BoundedNumberInput } from './BoundedNumberInput'
import { ContextMenu, menuHostOf, type MenuItem } from './ContextMenu'
import { registerLiveOverlay } from './liveOverlay'
import { MidiLearnOverlay } from './MidiLearnOverlay'
import { ownerWindow } from './ownerWindow'
import { PromptModal } from './PromptModal'
import { showToast } from './Toast'

const B = 'rounded border px-2 py-0.5 font-mono text-[10px] transition-colors disabled:opacity-35'
const IDLE = `${B} border-border bg-panel2 text-muted hover:border-accent/50 hover:text-accent`
const LIT = `${B} border-accent bg-accent/20 text-accent`
const btn = (on = false): string => (on ? LIT : IDLE)
const CAP = 'font-mono text-[9px] uppercase tracking-[0.14em] text-muted'

// ── Small parts ─────────────────────────────────────────────────────────
function Group({ title, children, right, open = true }: { title: string; children: ReactNode; right?: ReactNode; open?: boolean }): JSX.Element {
  const key = `opsia.cx.fold.${title}`
  const [on, setOn] = useState(() => { try { return (localStorage.getItem(key) ?? (open ? '1' : '0')) === '1' } catch { return open } })
  return (
    <section className="border-b border-border/60 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <button className={`${CAP} flex flex-1 items-center gap-1 text-left hover:text-accent`} onClick={() => { setOn(!on); try { localStorage.setItem(key, on ? '0' : '1') } catch { /* not kept */ } }}>
          <span className={`inline-block text-[8px] transition-transform ${on ? 'rotate-90' : ''}`}>▶</span>{title}
        </button>
        {right}
      </div>
      {on && <div className="mt-1.5 flex flex-col gap-1">{children}</div>}
    </section>
  )
}

/** A slider with its number; `target` : it takes modulation, `midi` : MIDI / OSC Learn. */
function Ctl({ label, value, min, max, step = 0.01, onChange, reset, unit = '', title, target, midi, k = 1 }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; reset?: number; unit?: string; title?: string
  target?: ModTarget; midi?: string
  /** what is shown and typed, times this (percent : 100) */
  k?: number
}): JSX.Element {
  const matrix = useStore((s) => s.composition.modMatrix)
  const knobs = useStore((s) => s.composition.metaKnobs)
  const key = target ? modTargetKey(target) : ''
  const bound = target ? matrix.filter((a) => modTargetKey(a.target) === key) : []
  const onMeta = target ? knobs.some((m) => m.destinations.some((d) => modTargetKey(d) === key)) : false
  const modulated = bound.length > 0 || onMeta
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !key || !modulated) return
    return registerLiveOverlay({ el, key, format: (x) => String(x * k) })
  }, [key, modulated, k])
  return (
    <>
      <div className="relative flex items-center gap-1.5" title={title}>
        {midi && <MidiLearnOverlay id={midi} />}
        <span className="w-[4.4rem] shrink-0 truncate font-mono text-[10px] text-muted">{label}</span>
        <input
          ref={ref} type="range" min={min * k} max={max * k} step={step * k} value={value * k}
          onChange={(e) => onChange(Number(e.target.value) / k)}
          onDoubleClick={() => reset !== undefined && onChange(reset)}
          className={`min-w-0 flex-1 ${modulated ? 'accent-accent2' : 'accent-accent'}`}
        />
        <BoundedNumberInput value={Math.round(value * k * 1000) / 1000} min={min * k} max={max * k} onCommit={(v) => onChange(v / k)} maxFrac={k === 100 || step >= 1 ? 1 : 2} className="input !px-0.5 text-right text-[10px] tabular-nums" />
        {unit && <span className="w-3 shrink-0 font-mono text-[9px] text-muted">{unit}</span>}
        {target && (
          <button
            onClick={() => setOpen(!open)}
            onContextMenu={(e) => {
              e.preventDefault()
              const st = useStore.getState()
              bound.forEach((a) => st.removeAssignment(a.id))
              knobs.forEach((m, i) => { if (m.destinations.some((d) => modTargetKey(d) === key)) st.toggleMetaDest(i, target) })
            }}
            className={`shrink-0 rounded px-1 font-mono text-[9px] leading-4 ${modulated ? 'bg-accent/20 text-accent ring-1 ring-accent' : open ? 'bg-accent2/25 text-accent2 ring-1 ring-accent2' : 'bg-panel3/60 text-muted hover:text-text'}`}
            title="Modulate : a modulator or a Macro knob moves it. Right-click clears."
          >
            M{bound.length ? bound.map((b) => b.mod + 1).join('·') : ''}
          </button>
        )}
      </div>
      {open && target && <AssignRow target={target} bound={bound} />}
    </>
  )
}

/** An M chip alone (an on / off). */
function ModChip({ target, label }: { target: ModTarget; label: string }): JSX.Element {
  const matrix = useStore((s) => s.composition.modMatrix)
  const key = modTargetKey(target)
  const bound = matrix.filter((a) => modTargetKey(a.target) === key)
  const [open, setOpen] = useState(false)
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <button onClick={() => setOpen(!open)} className={`self-start rounded px-1 font-mono text-[9px] leading-4 ${bound.length ? 'bg-accent/20 text-accent ring-1 ring-accent' : open ? 'bg-accent2/25 text-accent2 ring-1 ring-accent2' : 'bg-panel3/60 text-muted hover:text-text'}`} title={`Modulate ${label} : it follows the modulator's upper half`}>
        {label} M{bound.map((b) => b.mod + 1).join('·')}
      </button>
      {open && <AssignRow target={target} bound={bound} />}
    </div>
  )
}

function Num({ label, value, onCommit, min = -32768, max = 32768, frac = 1, title }: { label: string; value: number; onCommit: (v: number) => void; min?: number; max?: number; frac?: number; title?: string }): JSX.Element {
  return (
    <label className="flex min-w-0 items-center gap-1" title={title}>
      <span className="w-2 shrink-0 font-mono text-[9px] uppercase text-muted">{label}</span>
      <BoundedNumberInput value={Math.round(value * 10 ** frac) / 10 ** frac} min={min} max={max} maxFrac={frac} onCommit={onCommit} fixedWidth className="input w-full min-w-0 !px-0.5 text-right text-[10px] tabular-nums" />
    </label>
  )
}

function Seg<T extends string>({ options, value, onChange }: { options: Array<[T, string, string?]>; value: T; onChange: (v: T) => void }): JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap gap-0.5">
      {options.map(([v, t, tip]) => (
        <button key={v} className={btn(v === value)} onClick={() => onChange(v)} title={tip}>{t}</button>
      ))}
    </div>
  )
}

/** A name : written when it settles (Enter, or leaving the box). */
function NameInput({ value, other, onChange }: { value: string; other: string; onChange: (v: string) => void }): JSX.Element {
  const [t, setT] = useState<string | null>(null)
  const done = (): void => {
    if (t !== null && t.trim() !== value) onChange(t.trim().slice(0, 60) || other)
    setT(null)
  }
  return <input className="input w-full min-w-0 flex-1 text-[11px]" value={t ?? value} maxLength={60} onChange={(e) => setT(e.target.value)} onBlur={done} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') setT(null) }} />
}

function Dot({ n, color }: { n: number | string; color: string }): JSX.Element {
  return <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-sm px-1 font-mono text-[9px] font-bold text-black" style={{ background: color }}>{n}</span>
}

const STATE_WORD: Record<CxState, [string, string]> = {
  closed: ['closed', 'text-muted'], open: ['on its display', 'text-emerald-400'], missing: ['display missing', 'text-danger'], held: ['waits : over the controls', 'text-amber-400'], failed: ['could not open', 'text-danger']
}

const displayTarget = (d: CxDisplay): CxTarget => ({ kind: 'display', displayId: d.id, label: d.label, dw: d.width, dh: d.height })

function ColorCtls({ c, set }: { c: CxColor; set: (p: Partial<CxColor>) => void }): JSX.Element {
  return (
    <>
      <Ctl label="contrast" value={c.contrast} min={0} max={2} reset={1} onChange={(v) => set({ contrast: v })} />
      <Ctl label="gamma" value={c.gamma} min={0.2} max={4} reset={1} onChange={(v) => set({ gamma: v })} title="Above 1 lifts the middle grays, below 1 sinks them" />
      <Ctl label="red" value={c.r} min={0} max={2} reset={1} onChange={(v) => set({ r: v })} />
      <Ctl label="green" value={c.g} min={0} max={2} reset={1} onChange={(v) => set({ g: v })} />
      <Ctl label="blue" value={c.b} min={0} max={2} reset={1} onChange={(v) => set({ b: v })} />
    </>
  )
}
const colorEdited = (c: CxColor): boolean => (Object.keys(CX_COLOR) as Array<keyof CxColor>).some((k) => Math.abs(c[k] - CX_COLOR[k]) > 1e-6)

// ── The page ────────────────────────────────────────────────────────────
export function ComplexOutputPage({ inWindow = false }: { inWindow?: boolean }): JSX.Element {
  const setup = useStore((s) => s.complexOut)
  const live = useStore((s) => s.complexLive)
  const ui = useCxUi()
  useSyncExternalStore(cxRuntime.subscribe, cxRuntime.snapshot)
  const layers = useStore((s) => s.composition.layers)
  const displays = cxRuntime.displays
  const on = layers.map((l) => !l.mute && l.opacity > 0.001 && (l.sourceA.kind !== 'none' || (!!l.sourceB && l.sourceB.kind !== 'none')))
  const onKey = on.join()
  const problems = useMemo(() => findProblems(setup, displays, { live, states: cxRuntime.states, allowOwn: cxRuntime.allowOwn || cxRuntime.unattended, layers: on }), [setup, live, cxRuntime.version, onKey])
  const open = setup.screens.filter((s) => cxRuntime.states[s.id] === 'open').length
  const slices = setup.screens.reduce((a, s) => a + s.slices.length, 0)
  const canvas = outputCanvas()
  useEffect(() => { void cxRuntime.refreshDisplays() }, [])
  return (
    <div className={`${inWindow ? 'h-full' : 'fixed inset-0 z-40'} flex min-h-0 flex-col bg-bg text-text`} data-complex-page>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-panel px-3 py-1.5">
        <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.2em]">Complex Output</span>
        <nav className="flex items-center gap-1 font-mono text-[10px]">
          <span className="rounded border border-border/60 px-2 py-0.5 text-muted" title="The picture the slices take from : the engine's own frame">{`picture ${canvas ? `${canvas.width}×${canvas.height}` : ''}`}</span>
          <span className="text-muted">→</span>
          <button className={btn(ui.step === 1)} onClick={() => ui.set({ step: 1, draw: null })}>{`1 Screens · ${setup.screens.length}`}</button>
          <span className="text-muted">→</span>
          <button className={btn(ui.step === 2)} disabled={!setup.screens.length} onClick={() => ui.set({ step: 2 })}>{`2 Map · ${slices}`}</button>
          <span className="text-muted">→</span>
          <span className={`rounded border px-2 py-0.5 ${open ? 'border-emerald-500/60 text-emerald-400' : 'border-border/60 text-muted'}`}>{open ? `${open} on` : 'nothing on'}</span>
        </nav>
        <div className="min-w-0 flex-1" />
        <SetupButtons setup={setup} />
        <span className="relative">
          <MidiLearnOverlay id="fire:cxlive" />
          <button
            onClick={() => useStore.getState().setComplexLive(!live)}
            disabled={!setup.screens.length && !live}
            className={`rounded border px-3 py-1 font-mono text-[11px] font-semibold tracking-[0.15em] transition-colors disabled:opacity-35 ${live ? 'border-accent bg-accent/25 text-accent' : 'border-border text-muted hover:text-accent'}`}
            title={live ? 'The screens are on : click to close them all' : 'Open every screen where it goes'}
          >
            {live ? '◉ LIVE' : '○ LIVE'}
          </button>
        </span>
        <button onClick={() => useStore.getState().setComplexPageOpen(false)} className={btn()} title="Close this page (the screens stay as they are)">close</button>
      </header>
      {ui.step === 1 || !setup.screens.length ? <ScreensStep setup={setup} displays={displays} live={live} /> : <MapStep setup={setup} />}
      <Problems list={problems} setup={setup} />
    </div>
  )
}

/** Undo, presets, files, with the session. */
function SetupButtons({ setup }: { setup: CxSetup }): JSX.Element {
  const history = useUndoState()
  const inSession = useStore((s) => s.complexInSession)
  const fromSession = useStore((s) => s.complexFromSession)
  const [menu, setMenu] = useState<{ el: Element; kind: 'presets' | 'files' } | null>(null)
  const [naming, setNaming] = useState(false)
  const [mark, setMark] = useState<HTMLElement | null>(null)
  const take = (s: CxSetup, what: string): void => {
    useStore.getState().setComplexOut(s)
    useCxUi.setState({ screen: null, slice: null, mask: null, pts: [], draw: null })
    showToast(what)
  }
  const openFile = async (kind: 'setup' | 'xml'): Promise<void> => {
    const r = await window.api.complexOpen(kind)
    if (!r?.ok || r.text === undefined) { if (r?.error) showToast(`Could not read it : ${r.error}`, 'warn', 5000); return }
    if (kind === 'xml') {
      const got = importAdvancedOutput(r.text)
      if (!got) { showToast('That file is not an AdvancedOutput.xml', 'warn', 5000); return }
      const n = got.setup.screens.reduce((a, s) => a + s.slices.length, 0)
      take(got.setup, `Imported ${got.setup.screens.length} screens, ${n} slices${got.skipped ? ` · ${got.skipped} things not read (polygons, masks)` : ''}. Check the warps (Ctrl+Z goes back)`)
      return
    }
    try {
      const j = JSON.parse(r.text) as { complexOut?: unknown }
      if (!j || typeof j !== 'object' || !('complexOut' in j)) throw new Error('no setup in it')
      take(sanitizeSetup(j.complexOut), `Setup “${r.name}” opened (Ctrl+Z goes back)`)
    } catch (e) {
      showToast(`That file is not a Complex Output setup (${(e as Error).message})`, 'warn', 5000)
    }
  }
  const items = (): MenuItem[] => {
    if (menu?.kind === 'presets') {
      const list = loadPresets()
      return [
        { label: 'Save as a preset…', onClick: () => setNaming(true), disabled: !setup.screens.length },
        { label: '', divider: true },
        ...(list.length
          ? list.map((p): MenuItem => ({ label: p.name, hint: `${p.setup.screens.length} screens`, onClick: () => take(p.setup, `Preset “${p.name}” (Ctrl+Z goes back)`), onDelete: () => deletePreset(p.name), deleteTitle: `Delete “${p.name}”` }))
          : [{ label: 'no preset yet', disabled: true }])
      ]
    }
    return [
      { label: 'Import a setup…', onClick: () => void openFile('setup') },
      { label: 'Import an AdvancedOutput.xml…', onClick: () => void openFile('xml'), title: 'Its screens, slices, sizes and warps. The format is not documented : check the warped slices after' },
      { label: 'Export the setup…', disabled: !setup.screens.length, onClick: () => void window.api.complexSave(JSON.stringify({ palinopsia: 'complex output', complexOut: setup }, null, 1), 'complex output').then((r) => { if (r?.ok) showToast(`Saved ${r.path}`); else if (r?.error) showToast(`Not saved : ${r.error}`, 'warn') }) },
      { label: '', divider: true },
      { label: 'Start over (no screen)', danger: true, disabled: !setup.screens.length, onClick: () => take({ v: 1, screens: [] }, 'The setup is empty (Ctrl+Z goes back)') }
    ]
  }
  const modal = naming ? (
    <PromptModal title="Save the setup as a preset" placeholder="name" confirmLabel="Save" onCancel={() => setNaming(false)} onConfirm={(v) => { setNaming(false); if (savePreset(v, setup)) showToast(`Preset “${v}” saved on this computer`); else showToast('The preset could not be saved : this computer’s storage is full', 'warn') }} />
  ) : null
  const host = mark ? menuHostOf(mark.ownerDocument) : null
  return (
    <div className="flex items-center gap-1" ref={setMark}>
      <button className={btn()} disabled={!history.undo} onClick={() => undo()} title="Undo (Ctrl+Z)">↶</button>
      <button className={btn()} disabled={!history.redo} onClick={() => redo()} title="Redo">↷</button>
      <button className={btn()} onClick={(e) => setMenu({ el: e.currentTarget, kind: 'presets' })}>presets ▾</button>
      <button className={btn()} onClick={(e) => setMenu({ el: e.currentTarget, kind: 'files' })}>file ▾</button>
      <button
        className={btn(inSession)}
        onClick={() => useStore.getState().setComplexInSession(!inSession)}
        title={inSession ? `The setup is saved with the session, and a session brings its own${fromSession ? ' (this one came with the session : its edits stay in it)' : ''}. Click : it stays this computer’s` : 'Save the setup with the session (and let sessions bring theirs). Off : it stays this computer’s, whatever session is open'}
      >
        {fromSession ? 'session’s own' : 'with session'}
      </button>
      {menu && <ContextMenu x={0} y={0} anchor={menu.el} items={items()} onClose={() => setMenu(null)} />}
      {modal && (host ? createPortal(modal, host) : modal)}
    </div>
  )
}

function Problems({ list, setup }: { list: CxProblem[]; setup: CxSetup }): JSX.Element {
  const [open, setOpen] = useState(true)
  const hard = list.filter((p) => p.level !== 'note').length
  const go = (p: CxProblem): void => {
    if (p.slice) { useCxUi.setState({ step: 2 }); pickSlice(p.slice) }
    else if (p.screen) { pickScreen(p.screen); useCxUi.setState({ step: p.kind === 'empty' || p.kind === 'bypassed' ? 2 : 1 }) }
  }
  const seams = useMemo(() => list.some((p) => p.kind === 'noblend'), [list])
  return (
    <footer className="shrink-0 border-t border-border bg-panel px-3 py-1">
      <div className="flex items-center gap-2">
        <button className={`${CAP} hover:text-accent`} onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} problems</button>
        <span className={`font-mono text-[10px] ${hard ? 'text-amber-400' : 'text-emerald-400'}`}>{list.length ? `${list.length}` : setup.screens.length ? 'none' : 'no screen yet'}</span>
        {seams && <button className={btn()} onClick={() => commit(autoBlend)} title="Give every seam its soft edges, as wide as what the two slices share">blend the seams</button>}
        {list.some((p) => p.kind === 'own') && <button className={btn()} onClick={() => cxRuntime.acceptOwn()} title="Esc on that screen closes it again. Until the app closes">cover the controls’ display</button>}
      </div>
      {open && list.length > 0 && (
        <div className="mt-1 flex max-h-[4.6rem] flex-col overflow-y-auto">
          {list.map((p, i) => (
            <button key={i} onClick={() => go(p)} className="flex items-center gap-1.5 text-left font-mono text-[10px] leading-[1.15rem] text-muted hover:text-text">
              <span className={p.level === 'stop' ? 'text-danger' : p.level === 'warn' ? 'text-amber-400' : 'text-muted'}>{p.level === 'stop' ? '■' : p.level === 'warn' ? '▲' : '·'}</span>
              <span className="truncate">{p.text}</span>
            </button>
          ))}
        </div>
      )}
    </footer>
  )
}

// ── Step 1 : Screens ────────────────────────────────────────────────────
function addScreen(over: Partial<CxScreen>): void {
  const n = useStore.getState().complexOut.screens.length
  if (n >= CX_MAX_SCREENS) { showToast(`${CX_MAX_SCREENS} screens at most`, 'warn'); return }
  const sc = newScreen(`Screen ${n + 1}`, over)
  commit((s) => ({ ...s, screens: [...s.screens, sc] }))
  pickScreen(sc.id)
}

function ScreensStep({ setup, displays, live }: { setup: CxSetup; displays: CxDisplay[]; live: boolean }): JSX.Element {
  const ui = useCxUi()
  const { screen } = cxSelection(setup, ui)
  return (
    <div className="flex min-h-0 flex-1 max-[900px]:flex-col max-[900px]:overflow-y-auto">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <section>
          <div className="mb-1.5 flex items-center gap-2">
            <span className={CAP}>displays</span>
            <button className={btn()} onClick={() => cxRuntime.identify()} title="A big number on every display, and on every open screen, for three seconds">identify</button>
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(13rem, 1fr))' }}>
            {displays.map((d, i) => {
              const here = setup.screens.filter((s) => matchDisplay(s, displays)?.id === d.id)
              return (
                <div key={d.id} className="flex flex-col gap-1 rounded border border-border bg-panel2/60 p-2">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[20px] leading-none text-accent">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-semibold">{d.label}</span>
                  </div>
                  <div className="font-mono text-[10px] text-muted">{`${d.width}×${d.height}${d.hz ? ` · ${d.hz} Hz` : ''}${d.isControl ? ' · the controls are here' : ''}`}</div>
                  <div className="flex min-h-[1.3rem] flex-wrap items-center gap-1">
                    {here.map((s) => <button key={s.id} className={btn(s.id === screen?.id)} onClick={() => pickScreen(s.id)}>{s.name}</button>)}
                    {!here.length && <button className={btn()} onClick={() => addScreen({ target: displayTarget(d), w: d.width, h: d.height })}>+ a screen here</button>}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
        <section>
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className={CAP}>screens</span>
            <button className={btn()} onClick={() => addScreen({ target: { kind: 'window' } })} title="A screen in a plain window">+ window</button>
            <button className={btn()} onClick={() => addScreen({})}>+ screen</button>
            <SplitButton />
          </div>
          {!setup.screens.length && (
            <p className="max-w-[46rem] text-[12px] leading-relaxed text-muted">
              No screen yet : the Output works as always. Add a screen for each projector (or a plain window to try), then go to <b className="text-text">2 Map</b> to choose which part of the picture, or which layer, goes where on it. Nothing opens until <b className="text-text">LIVE</b>.
            </p>
          )}
          <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))' }}>
            {setup.screens.map((s, i) => <ScreenCard key={s.id} s={s} i={i} n={setup.screens.length} displays={displays} live={live} picked={s.id === screen?.id} />)}
          </div>
        </section>
        {screen && <div className="flex min-h-[14rem] flex-1 flex-col overflow-hidden rounded border border-border"><View side="out" title={`${screen.name} : what it shows`} /></div>}
      </main>
      {screen && <ScreenPanel s={screen} displays={displays} />}
    </div>
  )
}

/** The picture cut side by side over as many projectors as there are displays. */
function SplitButton(): JSX.Element {
  const [n, setN] = useState(2)
  const [over, setOver] = useState(10)
  return (
    <span className="flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 font-mono text-[10px] text-muted" title="New screens side by side, each with its share of the picture, overlapping by this much, blended">
      <BoundedNumberInput value={n} min={2} max={8} integer onCommit={setN} className="input !px-0.5 text-right text-[10px]" /> across, overlap
      <BoundedNumberInput value={over} min={0} max={45} integer onCommit={setOver} className="input !px-0.5 text-right text-[10px]" />%
      <button
        className={btn()}
        onClick={() => {
          // each takes w of the picture, n of them overlapping by o of w : n w - (n - 1) o w = 1
          const o = over / 100, w = 1 / (n - (n - 1) * o)
          const have = useStore.getState().complexOut.screens.length
          if (have + n > CX_MAX_SCREENS) { showToast(`${CX_MAX_SCREENS} screens at most`, 'warn'); return }
          const free = cxRuntime.displays.filter((d) => !d.isControl && !useStore.getState().complexOut.screens.some((s) => matchDisplay(s, cxRuntime.displays)?.id === d.id))
          const list = Array.from({ length: n }, (_, i) => {
            const d = free[i]
            return newScreen(`Screen ${have + i + 1}`, { ...(d ? { target: displayTarget(d), w: d.width, h: d.height } : { target: { kind: 'window' as const } }), slices: [newSlice(`Slice ${i + 1}`, { input: rectPts(i * w * (1 - o), 0, w, 1) })] })
          })
          commit((s) => autoBlend({ ...s, screens: [...s.screens, ...list] }))
          pickScreen(list[0].id)
        }}
      >
        split
      </button>
    </span>
  )
}

function ScreenCard({ s, i, n, displays, live, picked }: { s: CxScreen; i: number; n: number; displays: CxDisplay[]; live: boolean; picked: boolean }): JSX.Element {
  const state = cxRuntime.states[s.id] ?? 'closed'
  const d = matchDisplay(s, displays)
  const [word, tone] = STATE_WORD[state]
  const where = s.target.kind === 'none' ? 'nowhere yet' : s.target.kind === 'window' ? 'a window' : d ? d.label : `${s.target.label ?? 'a display'} (not connected)`
  return (
    <div onClick={() => pickScreen(s.id)} className={`flex cursor-pointer flex-col gap-1 rounded border p-2 ${picked ? 'border-accent/70 bg-panel2' : 'border-border bg-panel2/40 hover:border-accent/40'} ${s.on ? '' : 'opacity-60'}`}>
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[18px] leading-none text-accent">{i + 1}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{s.name}</span>
        <button className={btn(s.on)} onClick={(e) => { e.stopPropagation(); commit((q) => patchScreen(q, s.id, { on: !s.on })) }} title="On / off">{s.on ? 'on' : 'off'}</button>
        <button className={btn(s.card)} onClick={(e) => { e.stopPropagation(); commit((q) => patchScreen(q, s.id, { card: !s.card })) }} title="Test card : the screen's frame, its slices numbered">card</button>
      </div>
      <div className="font-mono text-[10px] text-muted">{`${s.w}×${s.h} → ${where}`}</div>
      <div className="flex items-center gap-1">
        {s.slices.slice(0, 8).map((l) => <Dot key={l.id} n={sliceNumber(useStore.getState().complexOut, l.id)} color={cxColorAt(sliceNumber(useStore.getState().complexOut, l.id) - 1)} />)}
        <span className="min-w-0 flex-1" />
        <span className={`font-mono text-[9px] ${live && s.on ? tone : 'text-muted'}`}>{live && s.on ? (s.target.kind === 'window' && state === 'open' ? 'in its window' : word) : ''}</span>
        {live && s.on && state === 'closed' && s.target.kind !== 'none' && <button className={btn()} onClick={(e) => { e.stopPropagation(); cxRuntime.reopen(s.id) }}>open again</button>}
        <button className={btn()} disabled={i === 0} onClick={(e) => { e.stopPropagation(); moveScreen(s.id, -1) }} title="Earlier">‹</button>
        <button className={btn()} disabled={i === n - 1} onClick={(e) => { e.stopPropagation(); moveScreen(s.id, 1) }} title="Later">›</button>
      </div>
    </div>
  )
}
function moveScreen(id: string, by: number): void {
  commit((s) => {
    const i = s.screens.findIndex((x) => x.id === id), j = i + by
    if (i < 0 || j < 0 || j >= s.screens.length) return s
    const a = [...s.screens]
    ;[a[i], a[j]] = [a[j], a[i]]
    return { ...s, screens: a }
  })
}

function ScreenPanel({ s, displays }: { s: CxScreen; displays: CxDisplay[] }): JSX.Element {
  const set = (p: Partial<CxScreen>): void => commit((q) => patchScreen(q, s.id, p))
  const d = matchDisplay(s, displays)
  const val = s.target.kind === 'display' ? (d ? `d${d.id}` : 'gone') : s.target.kind
  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-border bg-panel max-[900px]:w-full max-[900px]:border-l-0 max-[900px]:border-t">
      <Group title="screen">
        <NameInput value={s.name} other="Screen" onChange={(name) => set({ name })} />
        <div className="flex items-center gap-1.5">
          <span className="w-[4.4rem] shrink-0 font-mono text-[10px] text-muted">goes to</span>
          <select
            className="input select-compact min-w-0 flex-1 text-[10px]" value={val}
            onChange={(e) => {
              const v = e.target.value
              if (v === 'none' || v === 'window') set({ target: { kind: v } })
              else {
                const t = displays.find((x) => `d${x.id}` === v)
                if (t) set({ target: displayTarget(t), w: t.width, h: t.height })
              }
              cxRuntime.reopen(s.id)
            }}
          >
            <option value="none">nowhere</option>
            <option value="window">a window</option>
            {displays.map((x, i) => <option key={x.id} value={`d${x.id}`}>{`${i + 1} ${x.label} ${x.width}×${x.height}${x.isControl ? ' (the controls)' : ''}`}</option>)}
            {val === 'gone' && <option value="gone">{`${s.target.label ?? 'display'} (not connected)`}</option>}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-1">
          <Num label="w" value={s.w} min={16} max={8192} frac={0} onCommit={(v) => set({ w: Math.round(v) })} />
          <Num label="h" value={s.h} min={16} max={8192} frac={0} onCommit={(v) => set({ h: Math.round(v) })} />
        </div>
        <div className="flex flex-wrap gap-1">
          {d && (d.width !== s.w || d.height !== s.h) && <button className={btn()} onClick={() => set({ w: d.width, h: d.height })}>{`as its display ${d.width}×${d.height}`}</button>}
          {([[1280, 800], [1920, 1080], [1920, 1200], [3840, 2160]] as const).filter(([w, h]) => w !== s.w || h !== s.h).map(([w, h]) => <button key={`${w}x${h}`} className={btn()} onClick={() => set({ w, h })}>{`${w}×${h}`}</button>)}
        </div>
        <div className="flex flex-wrap gap-1">
          <button className={btn()} onClick={() => { useCxUi.setState({ step: 2, slice: s.slices[0]?.id ?? null }) }}>map its slices →</button>
          <button className={btn()} onClick={() => { const c = { ...copyScreen(s), name: `${s.name} copy`.slice(0, 60) }; commit((q) => (q.screens.length < CX_MAX_SCREENS ? { ...q, screens: [...q.screens, c] } : q)); pickScreen(c.id) }}>duplicate</button>
          <button className={`${btn()} hover:!border-danger hover:!text-danger`} onClick={() => { commit((q) => ({ ...q, screens: q.screens.filter((x) => x.id !== s.id) })); useCxUi.setState({ screen: null, slice: null }) }}>delete</button>
          <span className="relative"><MidiLearnOverlay id={`cx:on:${s.id}`} /><ModChip target={{ kind: 'cx', who: s.id, field: 'on' }} label="on/off" /></span>
        </div>
      </Group>
      <Group title="screen color" right={colorEdited(s) ? <button className={btn()} onClick={() => set({ ...CX_COLOR })}>↺</button> : undefined}>
        <Ctl label="brightness" value={s.brightness} min={0} max={2} reset={1} onChange={(v) => set({ brightness: v })} target={{ kind: 'cx', who: s.id, field: 'brightness' }} midi={`cx:brightness:${s.id}`} />
        <ColorCtls c={s} set={set} />
      </Group>
    </aside>
  )
}

// ── Step 2 : Map ────────────────────────────────────────────────────────
function View({ side, title }: { side: 'in' | 'out'; title: string }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const view = useRef<CxView | null>(null)
  useEffect(() => {
    if (!ref.current) return
    const v = new CxView(ref.current, side)
    view.current = v
    return () => { v.dispose(); view.current = null }
  }, [side])
  return (
    <div className="flex min-h-[12rem] min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-2 py-1">
        <span className={CAP}>{title}</span>
        <span className="flex-1" />
        <button className={btn()} onClick={() => view.current?.fit()} title="The whole picture (also a double click on nothing)">fit</button>
      </div>
      <div ref={ref} className="relative min-h-0 flex-1 overflow-hidden bg-[#101013]" />
    </div>
  )
}

function MapStep({ setup }: { setup: CxSetup }): JSX.Element {
  const ui = useCxUi()
  const { screen, slice, mask, maskOf } = cxSelection(setup, ui)
  const [, tick] = useReducer((n: number) => n + 1, 0)
  const root = useRef<HTMLDivElement | null>(null)
  const [narrow, setNarrow] = useState(false)
  // a small window : the two views one above the other, or one at a time
  useEffect(() => {
    const el = root.current
    if (!el) return
    const ro = new (ownerWindow(el) as unknown as typeof globalThis).ResizeObserver(() => setNarrow(el.clientWidth < 1180))
    ro.observe(el)
    tick()
    return () => ro.disconnect()
  }, [])
  const two = ui.show === 'both' || ui.show === 'stack'
  const stacked = two && (narrow || ui.show === 'stack')
  if (!screen) return <div className="flex-1" />
  return (
    <div ref={root} className="flex min-h-0 flex-1">
      <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-panel">
        <div className="flex flex-wrap gap-1 border-b border-border/60 p-2">
          {setup.screens.map((s, i) => <button key={s.id} className={btn(s.id === screen.id)} onClick={() => pickScreen(s.id)} title={`${s.name} ${s.w}×${s.h}`}>{`${i + 1} ${s.name}`}</button>)}
        </div>
        <SliceList setup={setup} screen={screen} picked={slice?.id ?? null} />
        <MaskList title={slice ? `masks of ${slice.name}` : 'masks of the screen'} list={slice ? slice.masks : screen.masks} picked={mask?.id ?? null} />
        {slice && screen.masks.length > 0 && <p className="px-2 pb-2 font-mono text-[9px] text-muted">{`${screen.masks.length} on the screen too : deselect the slice to see them`}</p>}
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-1 border-b border-border/60 bg-panel px-2 py-1">
          <Seg options={[['points', 'points', 'Drag the corners and points'], ['transform', 'transform', 'A box around it : scale from its sides (Alt from the middle, Shift keeps proportions), turn with the knob (Shift : 15°)']]} value={ui.tool} onChange={(tool) => ui.set({ tool })} />
          <button className={btn(ui.snap)} onClick={() => ui.set({ snap: !ui.snap })} title="Snap to the edges, the middle and the other slices (Ctrl while dragging : off)">snap</button>
          <span className="w-2" />
          <Seg options={[['both', '▯▯', 'Input and output side by side'], ['stack', '⊟', 'One above the other : larger in a wide window'], ['in', 'input'], ['out', 'output']]} value={ui.show} onChange={(show) => ui.set({ show })} />
          <span className="min-w-0 flex-1" />
          <span className="cursor-help rounded-full px-1 text-[11px] text-muted/70 hover:text-accent" title={'Drag a slice, or its points. Shift locks an axis, Ctrl drops the snap, Alt frees a corner of the input (or one Bezier handle).\nA drag on nothing picks several points; Shift adds to them.\nArrows : 1 pixel (Shift 10, Alt 0.1). Ctrl+D duplicates, Del deletes, Esc lets go.\nA double click on the line of a polygon or a mask adds a point.\nThe wheel zooms, Space or the middle button pans, a double click on nothing shows it whole.'}>ⓘ</span>
          <button className={btn(screen.card)} onClick={() => commit((s) => patchScreen(s, screen.id, { card: !screen.card }))} title="Test card on this screen">card</button>
          <button className={btn()} onClick={() => cxRuntime.identify()}>identify</button>
        </div>
        <div className={`flex min-h-0 flex-1 ${stacked ? 'flex-col' : ''}`}>
          {ui.show !== 'out' && <View side="in" title="input : what it takes" />}
          {two && <div className={stacked ? 'h-px bg-border' : 'w-px bg-border'} />}
          {ui.show !== 'in' && <View side="out" title={`output : ${screen.name} ${screen.w}×${screen.h}`} />}
        </div>
      </div>
      <aside className="w-72 shrink-0 overflow-y-auto border-l border-border bg-panel">
        {mask && <MaskPanel m={mask} of={maskOf === 'slice' ? slice : null} screen={screen} />}
        {slice ? <SlicePanel s={slice} screen={screen} /> : !mask && <p className="p-3 text-[11px] leading-relaxed text-muted">Pick a slice : in the list, or on either view. A slice is a part of the picture (input) and the place it goes on this screen (output).</p>}
      </aside>
    </div>
  )
}

function SliceList({ setup, screen, picked }: { setup: CxSetup; screen: CxScreen; picked: string | null }): JSX.Element {
  const full = screen.slices.length >= CX_MAX_SLICES
  const add = (l: CxSlice): void => { commit((s) => patchScreen(s, screen.id, { slices: [...screen.slices, l] })); pickSlice(l.id) }
  const move = (i: number, by: number): void => {
    const a = [...screen.slices], j = i + by
    if (j < 0 || j >= a.length) return
    ;[a[i], a[j]] = [a[j], a[i]]
    commit((s) => patchScreen(s, screen.id, { slices: a }))
  }
  const ngon = (n: number): number[] => Array.from({ length: n }, (_, i) => [0.5 + 0.3 * (screen.h / screen.w) * Math.cos((i / n) * Math.PI * 2 - Math.PI / 2), 0.5 + 0.3 * Math.sin((i / n) * Math.PI * 2 - Math.PI / 2)]).flat()
  const ui = useCxUi()
  return (
    <section className="border-b border-border/60 p-2">
      <div className="mb-1 flex flex-wrap items-center gap-1">
        <span className={`${CAP} flex-1`}>slices</span>
        <button className={btn()} disabled={full} title="A rectangle" onClick={() => { const k = screen.slices.length % 5; add(newSlice(`Slice ${sliceCount(setup) + 1}`, { warp: { type: 'corners', cols: 1, rows: 1, pts: rectPts(0.2 + k * 0.04, 0.2 + k * 0.04, 0.5, 0.5) } })) }}>+ slice</button>
        <button className={btn()} disabled={full} title="A polygon, its points pinned one for one" onClick={() => add(newSlice(`Polygon ${screen.slices.filter((l) => l.warp.type === 'poly').length + 1}`, { inKind: 'poly', input: ngon(6), warp: { type: 'poly', cols: 1, rows: 1, pts: ngon(6) } }))}>+ poly</button>
        <button className={btn(ui.draw?.kind === 'poly')} disabled={full} title="Click its points on the output, one by one" onClick={() => ui.set({ draw: ui.draw ? null : { kind: 'poly', pts: [] }, mask: null, step: 2, show: ui.show === 'in' ? 'both' : ui.show })}>draw</button>
      </div>
      <div className="flex flex-col gap-0.5">
        {[...screen.slices].reverse().map((l) => {
          const i = screen.slices.indexOf(l), n = sliceNumber(setup, l.id)
          return (
            <div key={l.id} onClick={() => pickSlice(l.id)} className={`group flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 ${l.id === picked ? 'bg-accent/15' : 'hover:bg-panel2'} ${l.on ? '' : 'opacity-50'}`}>
              <Dot n={n} color={cxColorAt(n - 1)} />
              <span className="min-w-0 flex-1 truncate text-[11px]">{l.name}</span>
              <span className="hidden gap-0.5 group-hover:flex">
                <button className="font-mono text-[10px] text-muted hover:text-accent" onClick={(e) => { e.stopPropagation(); move(i, 1) }} title="Over the next one">▲</button>
                <button className="font-mono text-[10px] text-muted hover:text-accent" onClick={(e) => { e.stopPropagation(); move(i, -1) }} title="Under the one before">▼</button>
              </span>
              <button className={`px-1 font-mono text-[9px] ${l.solo ? 'rounded bg-accent2/25 text-accent2' : 'text-muted hover:text-text'}`} onClick={(e) => { e.stopPropagation(); commit((s) => patchSlice(s, l.id, { solo: !l.solo })) }} title="Solo : only the soloed slices show, on every screen">S</button>
              <button className={`px-1 font-mono text-[9px] ${l.on ? 'text-accent' : 'text-muted'}`} onClick={(e) => { e.stopPropagation(); commit((s) => patchSlice(s, l.id, { on: !l.on })) }} title="On / off">{l.on ? '●' : '○'}</button>
            </div>
          )
        })}
        {!screen.slices.length && <span className="font-mono text-[10px] text-muted">none : this screen stays black</span>}
      </div>
    </section>
  )
}
const sliceCount = (s: CxSetup): number => s.screens.reduce((a, x) => a + x.slices.length, 0)

function MaskList({ title, list, picked }: { title: string; list: CxMask[]; picked: string | null }): JSX.Element {
  const ui = useCxUi()
  const circle = (): number[] => Array.from({ length: 8 }, (_, i) => [0.5 + 0.28 * Math.cos((i / 8) * Math.PI * 2), 0.5 + 0.28 * Math.sin((i / 8) * Math.PI * 2)]).flat()
  return (
    <section className="p-2">
      <div className="mb-1 flex flex-wrap items-center gap-1">
        <span className={`${CAP} w-full truncate`}>{title}</span>
        <button className={btn()} onClick={() => addMask()} title="A four-sided mask">+ box</button>
        <button className={btn()} onClick={() => addMask(circle(), { smooth: true })} title="A round mask">+ round</button>
        <button className={btn(ui.draw?.kind === 'mask')} onClick={() => ui.set({ draw: ui.draw ? null : { kind: 'mask', pts: [] }, show: ui.show === 'in' ? 'both' : ui.show })} title="Click its points on the output, one by one">draw</button>
      </div>
      {list.map((m) => (
        <div key={m.id} onClick={() => ui.set({ mask: m.id === picked ? null : m.id, pts: [], tool: 'points' })} className={`flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 ${m.id === picked ? 'bg-accent/15' : 'hover:bg-panel2'} ${m.on ? '' : 'opacity-50'}`}>
          <span className="font-mono text-[10px]" style={{ color: m.mode === 'add' ? '#7dff9a' : '#fff' }}>{m.mode === 'add' ? '◧ show' : '◨ hide'}</span>
          <span className="min-w-0 flex-1 truncate text-[11px]">{m.name}</span>
        </div>
      ))}
    </section>
  )
}

function MaskPanel({ m, of, screen }: { m: CxMask; of: CxSlice | null; screen: CxScreen }): JSX.Element {
  const set = (p: Partial<CxMask>): void =>
    commit((s) => {
      const f = (l: CxMask[]): CxMask[] => l.map((x) => (x.id === m.id ? { ...x, ...p } : x))
      return of ? patchSlice(s, of.id, { masks: f(of.masks) }) : patchScreen(s, screen.id, { masks: f(screen.masks) })
    })
  return (
    <Group title={of ? 'mask of the slice' : 'mask of the screen'}>
      <NameInput value={m.name} other="Mask" onChange={(name) => set({ name })} />
      <div className="flex flex-wrap items-center gap-1">
        <Seg options={[['cut', 'hide inside'], ['add', 'show inside']]} value={m.mode} onChange={(mode) => set({ mode })} />
        <button className={btn(m.on)} onClick={() => set({ on: !m.on })}>{m.on ? 'on' : 'off'}</button>
        <button className={btn(m.smooth)} onClick={() => set({ smooth: !m.smooth })} title="Round the outline through its points">smooth</button>
      </div>
      <Ctl label="soft edge" value={m.soft} min={0} max={400} step={1} reset={0} unit="px" onChange={(v) => set({ soft: v })} />
      <div className="flex flex-wrap gap-1">
        <button className={btn()} onClick={() => { const ui = useCxUi.getState(); ui.set({ pts: [] }); deleteInHand() }}>delete the mask</button>
      </div>
      <p className="font-mono text-[9px] leading-snug text-muted">drag its points on the output · a double click on its line adds one · Del takes the picked ones away. The list is read from the top : “show” adds, “hide” takes away.</p>
    </Group>
  )
}

// ── The slice in hand ───────────────────────────────────────────────────
function SlicePanel({ s, screen }: { s: CxSlice; screen: CxScreen }): JSX.Element {
  const ui = useCxUi()
  const setup = useStore((q) => q.complexOut)
  const set = (p: Partial<CxSlice>): void => commit((q) => patchSlice(q, s.id, p))
  const canvas = outputCanvas()
  const SW = canvas?.width || 1920, SH = canvas?.height || 1080
  const ib = bounds(s.input), ob = bounds(warpOutline(s.warp))
  const inBox = (p: Partial<{ x: number; y: number; w: number; h: number }>): void => {
    const q = { ...ib, ...p }
    if (q.w < 1e-4 || q.h < 1e-4) return
    set({ input: s.inKind === 'rect' ? rectPts(q.x, q.y, q.w, q.h) : mapPoints(s.input, (x, y) => [q.x + ((x - ib.x) / Math.max(1e-9, ib.w)) * q.w, q.y + ((y - ib.y) / Math.max(1e-9, ib.h)) * q.h]) })
  }
  const outBox = (p: Partial<{ x: number; y: number; w: number; h: number }>): void => {
    const q = { ...ob, ...p }
    if (q.w < 1e-4 || q.h < 1e-4) return
    set({ warp: { ...s.warp, pts: mapPoints(s.warp.pts, (x, y) => [q.x + ((x - ob.x) / Math.max(1e-9, ob.w)) * q.w, q.y + ((y - ob.y) / Math.max(1e-9, ob.h)) * q.h]) } })
  }
  const w = s.warp
  const poly = w.type === 'poly'
  const kind = (t: CxWarpType): void => {
    if (t === w.type) return
    const n = t === 'corners' ? 1 : w.type === 'corners' ? (t === 'bezier' ? 1 : 3) : w.cols, m = t === 'corners' ? 1 : w.type === 'corners' ? (t === 'bezier' ? 1 : 3) : w.rows
    set({ warp: resampleWarp(w, t, n, m) })
    ui.set({ pts: [] })
  }
  const cells = (c: number, r: number): void => {
    const C = Math.max(1, Math.min(CX_MAX_CELLS, c)), R = Math.max(1, Math.min(CX_MAX_CELLS, r))
    if (C === w.cols && R === w.rows) return
    set({ warp: resampleWarp(w, w.type, C, R) })
    ui.set({ pts: [] })
  }
  const e = s.edges
  const edge = (p: Partial<CxEdges>): void => set({ edges: { ...e, ...p } })
  const seam = useMemo(() => findOverlaps(setup).some((o) => o.a.slice.id === s.id || o.b.slice.id === s.id), [setup, s.id])
  // the point in hand, typed
  const pt = ui.pts.length === 1 && !ui.mask ? ui.pts[0] : -1
  const P = ui.side === 'in' ? s.input : w.pts
  const PW = ui.side === 'in' ? SW : screen.w, PH = ui.side === 'in' ? SH : screen.h
  const putPt = (x: number, y: number): void => {
    const q = [...P]
    q[pt * 2] = x
    q[pt * 2 + 1] = y
    if (ui.side === 'in') set(s.inKind === 'rect' ? { input: q, inKind: 'quad' } : { input: q })
    else set({ warp: { ...w, pts: q } })
  }
  const n = sliceNumber(setup, s.id)
  return (
    <>
      <Group title="slice">
        <div className="flex items-center gap-1.5">
          <Dot n={n} color={cxColorAt(n - 1)} />
          <NameInput value={s.name} other="Slice" onChange={(name) => set({ name })} />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="relative"><MidiLearnOverlay id={`cx:on:${s.id}`} /><button className={btn(s.on)} onClick={() => set({ on: !s.on })}>{s.on ? 'on' : 'off'}</button></span>
          <button className={btn(s.solo)} onClick={() => set({ solo: !s.solo })}>solo</button>
          <button className={btn(s.locked)} onClick={() => set({ locked: !s.locked })} title="Nothing dragged by accident">lock</button>
          <button className={btn()} onClick={duplicateInHand} title="Ctrl+D on a view">duplicate</button>
          <button className={`${btn()} hover:!border-danger hover:!text-danger`} onClick={() => { useCxUi.setState({ pts: [], mask: null }); deleteInHand() }} disabled={s.locked}>delete</button>
          <ModChip target={{ kind: 'cx', who: s.id, field: 'on' }} label="on/off" />
        </div>
        <Ctl label="opacity" value={s.opacity} min={0} max={1} reset={1} k={100} unit="%" onChange={(v) => set({ opacity: v })} target={{ kind: 'cx', who: s.id, field: 'opacity' }} midi={`cx:opacity:${s.id}`} />
      </Group>
      <Group title="input" right={<button className={btn()} onClick={() => set(poly ? {} : { input: rectPts(0, 0, 1, 1), inKind: 'rect' })} disabled={poly} title="The whole picture">whole</button>}>
        <select className="input select-compact w-full text-[10px]" value={s.source} onChange={(ev) => set({ source: ev.target.value as CxSource })} title="What this slice takes from : the picture as the output shows it (the domemaster in dome mode), the flat picture even then, or one layer alone, before the Master FX (Black and Flash safety still rule it)">
          {CX_SOURCES.map((k) => <option key={k} value={k}>{CX_SOURCE_LABEL[k]}</option>)}
        </select>
        <div className="grid grid-cols-4 gap-1">
          <Num label="x" value={ib.x * SW} onCommit={(v) => inBox({ x: v / SW })} />
          <Num label="y" value={ib.y * SH} onCommit={(v) => inBox({ y: v / SH })} />
          <Num label="w" value={ib.w * SW} min={1} onCommit={(v) => inBox({ w: v / SW })} />
          <Num label="h" value={ib.h * SH} min={1} onCommit={(v) => inBox({ h: v / SH })} />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button className={btn(s.flipX)} onClick={() => set({ flipX: !s.flipX })}>flip ↔</button>
          <button className={btn(s.flipY)} onClick={() => set({ flipY: !s.flipY })}>flip ↕</button>
          <button className={btn(s.turn !== 0)} onClick={() => set({ turn: (s.turn + 1) % 4 })} title="A quarter turn clockwise">{`↻ ${s.turn * 90}°`}</button>
          {!poly && <Seg options={[['rect', 'rectangle'], ['quad', 'free corners']]} value={s.inKind} onChange={(k) => set(k === 'rect' ? { inKind: 'rect', input: rectPts(ib.x, ib.y, ib.w, ib.h) } : { inKind: 'quad' })} />}
        </div>
      </Group>
      <Group title="output">
        <div className="grid grid-cols-4 gap-1">
          <Num label="x" value={ob.x * screen.w} onCommit={(v) => outBox({ x: v / screen.w })} />
          <Num label="y" value={ob.y * screen.h} onCommit={(v) => outBox({ y: v / screen.h })} />
          <Num label="w" value={ob.w * screen.w} min={1} onCommit={(v) => outBox({ w: v / screen.w })} />
          <Num label="h" value={ob.h * screen.h} min={1} onCommit={(v) => outBox({ h: v / screen.h })} />
        </div>
        <div className="flex flex-wrap gap-1">
          <button className={btn()} onClick={() => set({ warp: rectWarp(w, 0, 0, 1, 1) })}>fill the screen</button>
          <button className={btn()} onClick={() => set({ warp: rectWarp(w, ib.x, ib.y, ib.w, ib.h) })} title="The same place it has in the picture">as the input</button>
          <button className={btn()} onClick={() => { const aw = (ib.w * SW) / screen.w, ah = (ib.h * SH) / screen.h, f = Math.min(1 / aw, 1 / ah); set({ warp: rectWarp(w, 0.5 - (aw * f) / 2, 0.5 - (ah * f) / 2, aw * f, ah * f) }) }} title="As large as it fits with the picture's own proportions">keep its shape</button>
        </div>
        {poly ? (
          <p className="font-mono text-[9px] leading-snug text-muted">{`${w.pts.length / 2} points, each pinned on both sides · a double click on the line adds one (on either view) · Del takes the picked ones away`}</p>
        ) : (
          <>
            <Seg
              options={[['corners', 'corners', 'Four corners, true perspective'], ['grid', 'grid', 'Points joined by straight lines'], ['curve', 'curved', 'The same points joined by smooth curves'], ['bezier', 'bezier', 'Patches with handles']]}
              value={w.type} onChange={kind}
            />
            {w.type !== 'corners' && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] text-muted">
                <span className="flex items-center gap-1">columns <button className={btn()} disabled={w.cols <= 1} onClick={() => cells(w.cols - 1, w.rows)}>−</button><b className="w-4 text-center text-text">{w.cols}</b><button className={btn()} disabled={w.cols >= CX_MAX_CELLS} onClick={() => cells(w.cols + 1, w.rows)}>+</button></span>
                <span className="flex items-center gap-1">rows <button className={btn()} disabled={w.rows <= 1} onClick={() => cells(w.cols, w.rows - 1)}>−</button><b className="w-4 text-center text-text">{w.rows}</b><button className={btn()} disabled={w.rows >= CX_MAX_CELLS} onClick={() => cells(w.cols, w.rows + 1)}>+</button></span>
              </div>
            )}
            <div className="flex flex-wrap gap-1">
              <button className={btn()} onClick={() => set({ warp: rectWarp(w, ob.x, ob.y, ob.w, ob.h) })} title="Flat again, in the same place">reset warp</button>
              <button className={btn()} onClick={() => { const c = [evalWarp(w, 0, 0), evalWarp(w, 1, 0), evalWarp(w, 1, 1), evalWarp(w, 0, 1)].flat(); set({ warp: resampleWarp({ type: 'corners', cols: 1, rows: 1, pts: c }, w.type, w.cols, w.rows) }) }} disabled={w.type === 'corners'} title="Keeps the four corners, straightens what is between them">straighten</button>
              <button className={btn()} onClick={() => { ui.set({ clip: w }); showToast('Warp copied') }}>copy warp</button>
              <button className={btn()} disabled={!ui.clip || s.locked} onClick={() => ui.clip && set({ warp: { ...ui.clip, pts: [...ui.clip.pts] } })}>paste warp</button>
            </div>
          </>
        )}
        {pt >= 0 && pt * 2 + 1 < P.length && (
          <div className="grid grid-cols-2 gap-1" title="The point in hand">
            <Num label="x" value={P[pt * 2] * PW} frac={2} onCommit={(v) => putPt(v / PW, P[pt * 2 + 1])} />
            <Num label="y" value={P[pt * 2 + 1] * PH} frac={2} onCommit={(v) => putPt(P[pt * 2], v / PH)} />
          </div>
        )}
      </Group>
      <Group title="soft edges" right={<button className={btn(e.on)} disabled={poly} onClick={() => edge({ on: !e.on })}>{e.on ? 'on' : 'off'}</button>} open={e.on || seam}>
        {poly ? <p className="font-mono text-[9px] text-muted">a polygon has none : give it a soft mask</p> : (
          <>
            {seam && <button className={btn()} onClick={() => commit(autoBlend)} title="As wide as what this slice shares with its neighbours on the other screens">from the overlaps</button>}
            {(['l', 'r', 't', 'b'] as const).map((k) => (
              <Ctl key={k} label={{ l: 'left', r: 'right', t: 'top', b: 'bottom' }[k]} value={e[k]} min={0} max={0.95} step={0.001} k={100} unit="%" reset={0} onChange={(v) => edge({ [k]: v, on: v > 0 ? true : e.on })} />
            ))}
            <Ctl label="power" value={e.power} min={0.5} max={8} reset={CX_EDGES.power} onChange={(v) => edge({ power: v })} title="How steep the ramp is around its middle" />
            <Ctl label="gamma" value={e.gamma} min={0.5} max={4} reset={CX_EDGES.gamma} onChange={(v) => edge({ gamma: v })} title="The projector's own gamma : the two halves add up to one light when it is right" />
            <Ctl label="luminance" value={e.lum} min={0} max={1} reset={0.5} onChange={(v) => edge({ lum: v })} title="The light in the middle of the seam (0.5 : as computed)" />
            <Ctl label="black level" value={e.black} min={0} max={0.3} step={0.001} k={100} unit="%" reset={0} onChange={(v) => edge({ black: v })} title="Raises the black outside the seam, to meet the two projectors' blacks adding up inside it. Set it on a black picture, in the dark" />
            <button className={btn()} onClick={() => edge({ ...CX_EDGES })}>no soft edge</button>
          </>
        )}
      </Group>
      <Group title="slice color" right={colorEdited(s) ? <button className={btn()} onClick={() => set({ ...CX_COLOR })}>↺</button> : undefined} open={false}>
        <Ctl label="brightness" value={s.brightness} min={0} max={2} reset={1} onChange={(v) => set({ brightness: v })} />
        <ColorCtls c={s} set={set} />
      </Group>
      <MoveTo s={s} setup={setup} screen={screen} />
    </>
  )
}

/** The slice on another screen. */
function MoveTo({ s, setup, screen }: { s: CxSlice; setup: CxSetup; screen: CxScreen }): JSX.Element | null {
  if (setup.screens.length < 2) return null
  return (
    <Group title="on another screen" open={false}>
      <div className="flex flex-wrap gap-1">
        {setup.screens.filter((x) => x.id !== screen.id).map((x) => (
          <button key={x.id} className={btn()} onClick={() => {
            commit((q) => {
              const f = findSlice(q, s.id)
              const to = q.screens.find((y) => y.id === x.id)
              if (!f || !to || to.slices.length >= CX_MAX_SLICES) return q
              return patchScreen(patchScreen(q, f.screen.id, { slices: f.screen.slices.filter((l) => l.id !== s.id) }), x.id, { slices: [...to.slices, f.slice] })
            })
            pickSlice(s.id)
          }}>{`move to ${x.name}`}</button>
        ))}
      </div>
    </Group>
  )
}
