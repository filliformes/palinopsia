// The Sonify page's building blocks, shared by its three views (voices, mixer,
// seq) so they read as one : the voice card (Shell), the label column (Row),
// the on / play pill, the small option chips, a plain slider row with its
// readout, a −/+ stepper and the little icon buttons (dice, reset). The Voices
// view is the reference look : change it here, every view follows.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../store'
import { MidiLearnOverlay } from './MidiLearnOverlay'
import { registerLiveOverlay } from './liveOverlay'
import { ownerWindow } from './ownerWindow'

/** A theme color variable ("r g b"), read once per theme : read every frame,
 *  getComputedStyle forced a style recalculation after the meters had written
 *  theirs. */
const themeVars = new Map<string, string>()
let themeKey: string | null = null
export function themeVar(name: string, fallback: string): string {
  const k = document.documentElement.getAttribute('data-theme')
  if (k !== themeKey) { themeKey = k; themeVars.clear() }
  let v = themeVars.get(name)
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
    themeVars.set(name, v)
  }
  return v
}

/** A typed frequency : "4250", "4.25k", "4.25 kHz", "250 Hz"; "off" → `off`. */
export function parseHz(text: string, off: number): number | null {
  const t = text.trim().toLowerCase().replace(',', '.')
  if (t === 'off') return off
  const m = /^([0-9]*\.?[0-9]+)\s*(k|khz)?\s*(hz)?$/.exec(t)
  if (!m) return null
  const v = Number(m[1]) * (m[2] ? 1000 : 1)
  return Number.isFinite(v) ? v : null
}
/** A typed level in dB : "-6", "+3.5 dB". */
export function parseDb(text: string): number | null {
  const m = /^([+-]?[0-9]*\.?[0-9]+)\s*(db)?$/i.exec(text.trim().replace(',', '.'))
  return m ? Number(m[1]) : null
}

/** Something hides the Sonify page (another full page over it, the Source
 *  Editor, the window minimized) : its drawing loops skip the frame and its key
 *  handlers rest (the EQ editor's took Esc and Delete from under the editor).
 *  `el` : what is drawing. In the Sonify page's own window only that window
 *  hides it (the pages over the instrument are elsewhere); a page in a window of
 *  its own (Body, Sequence) covers nothing in the instrument. */
export function sonifyCovered(el?: Element | null): boolean {
  const doc = el?.ownerDocument
  if (doc && doc !== document) return doc.hidden
  const s = useStore.getState()
  return document.hidden || s.worldPageOpen || (s.sequencePageOpen && !s.sequencePageWindow) || (s.bodyPageOpen && !s.bodyPageWindow) || s.resolumePageOpen || s.sourceEditorOpen
}

/** The on / play pill of a card's header. */
export const pill = (on: boolean): string =>
  `rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
    on ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted hover:text-text'
  }`

/** An option chip inside a card (a mode, a choice). */
export const chip = (on: boolean): string =>
  `rounded px-1.5 py-0.5 font-mono text-[9px] transition-colors ${
    on ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted hover:text-text'
  }`

/** The same chip, a bigger target (grids of roots, scales, modes). */
export const chipBig = (on: boolean): string => chip(on).replace('py-0.5', 'py-1')

/** A row of choices sharing the row's width, as the voices draw them (Events'
 *  spatial / motion / blend) : one segment per option, the chosen one lit. */
export function Seg<T extends string | number>({ options, value, onChange, label, title, disabled }: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  label?: (v: T) => ReactNode
  title?: (v: T) => string
  disabled?: boolean
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 gap-1">
      {options.map((o) => (
        <button
          key={String(o)} onClick={() => onChange(o)} disabled={disabled} title={title?.(o)}
          className={`${chip(value === o)} min-w-0 flex-1 truncate text-center disabled:opacity-40`}
        >{label ? label(o) : String(o)}</button>
      ))}
    </div>
  )
}

/** One on / off option sharing the row's width (the voices' look for a toggle). */
export function Toggle({ on, onClick, children, title, disabled }: {
  on: boolean; onClick: () => void; children: ReactNode; title?: string; disabled?: boolean
}): JSX.Element {
  return (
    <button onClick={onClick} disabled={disabled} title={title} className={`${chip(on)} min-w-0 flex-1 truncate text-center disabled:opacity-40`}>
      {children}
    </button>
  )
}

/** The grip at a sequencer card's foot : drag down / up to give its rows more or
 *  less air (the card grows or shrinks under the pointer), drag the left corner
 *  sideways to widen the column; double-click goes back to the default air. */
export function CardGrip({ space, onSpace, onWidth, onReset }: {
  space: number
  onSpace: (v: number) => void
  onWidth?: (dx: number, done: boolean) => void
  onReset: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  // How many gaps share the growth : the card's rows, and (at 3/4 weight) the
  // rows of a list inside it (the effects sequencer's steps).
  const rows = (): number => {
    const box = ref.current?.closest('section')?.querySelector('[data-rows]')
    if (!box) return 1
    let n = box.children.length - 1
    box.querySelectorAll('[data-subrows]').forEach((s) => (n += Math.max(0, s.children.length - 1) * SUB_GAP))
    return n
  }
  const start = (e: React.PointerEvent, withWidth: boolean): void => {
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const x0 = e.clientX
    const y0 = e.clientY
    const s0 = space
    const gaps = Math.max(1, rows())
    const move = (ev: PointerEvent): void => {
      // gap (px) = SPACE_MIN + space × SPACE_SPAN : dy pixels spread over every gap
      onSpace(Math.max(0, Math.min(1, s0 + (ev.clientY - y0) / gaps / SPACE_SPAN)))
      if (withWidth) onWidth?.(x0 - ev.clientX, false)
    }
    const up = (ev: PointerEvent): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (withWidth) onWidth?.(x0 - ev.clientX, true)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  return (
    <div ref={ref} className="relative -mx-1 mt-1 h-2" onDoubleClick={onReset}>
      <div
        className="group absolute inset-x-4 inset-y-0 flex cursor-ns-resize items-center justify-center"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => start(e, false)}
        title="Drag down for more air between the rows, up for less (double-click : the default)"
      >
        <span className="h-[3px] w-10 rounded-full bg-border transition-colors group-hover:bg-accent/70" />
      </div>
      {onWidth && (
        <div
          className="group absolute inset-y-0 left-0 w-3 cursor-nesw-resize"
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => start(e, true)}
          title="Drag sideways to widen or narrow the sequencers, up or down for less or more air"
        >
          <span className="absolute bottom-0 left-0 h-2 w-2 rounded-bl border-b-2 border-l-2 border-border transition-colors group-hover:border-accent/70" />
        </div>
      )}
    </div>
  )
}

/** A card's air between rows : 0..1 → px (the default sits at the old roomy gap). */
export const SPACE_MIN = 2
export const SPACE_SPAN = 18
export const SPACE_DEFAULT = 6 / 18 // 8 px, the roomy cards' gap-2
export const SUB_GAP = 0.75 // a list inside a card breathes at 3/4 of the card's gap
export const spaceGap = (space: number): number => SPACE_MIN + space * SPACE_SPAN

/** A card's air, remembered on this machine. */
export function useCardSpace(key: string): [number, (v: number) => void, () => void] {
  const storeKey = `opsia.soniSpace.${key}`
  const [space, setSpace] = useState(() => {
    const v = Number(localStorage.getItem(storeKey))
    return localStorage.getItem(storeKey) !== null && v >= 0 && v <= 1 ? v : SPACE_DEFAULT
  })
  const set = (v: number): void => {
    if (!Number.isFinite(v)) return
    setSpace(v)
    try { localStorage.setItem(storeKey, String(Math.round(v * 1000) / 1000)) } catch { /* full */ }
  }
  return [space, set, () => set(SPACE_DEFAULT)]
}

/** A thin line between a card's groups of rows. */
export function Divider(): JSX.Element {
  return <div className="my-0.5 h-px bg-border/60" />
}

/** A card's label column, then its controls. */
export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }): JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="w-14 shrink-0 font-mono text-[9px] uppercase text-muted" title={hint}>{label}</span>
      {children}
    </div>
  )
}

/** The voice card : a pill (on / off, play / stop), the title, its ⓘ, then the
 *  card's own buttons on the right. `open` shows the body (a voice hides it
 *  while off; a sequencer keeps it open to be edited while stopped). */
export function Shell({
  title, hint, on, onToggle, toggleText = ['● on', '○ off'], toggleTitle, midiId, lead, right, open, roomy, space, foot, collapsed = false, onCollapse, children
}: {
  title: string
  hint?: string
  on: boolean
  onToggle?: () => void
  toggleText?: [string, string]
  toggleTitle?: string
  midiId?: string
  lead?: ReactNode
  right?: ReactNode
  open?: boolean
  // A card with many rows (the sequencers) : more padding and air between rows.
  roomy?: boolean
  // The air between rows, 0..1 (a sequencer's grip sets it; see CardGrip).
  space?: number
  // Under the rows : the sequencer's resize grip.
  foot?: ReactNode
  // A card that folds to its header (the sequencers) : the chevron left of the pill.
  collapsed?: boolean
  onCollapse?: () => void
  children?: ReactNode
}): JSX.Element {
  const gap = space !== undefined && !collapsed ? spaceGap(space) : undefined
  return (
    <section className={`rounded border transition-colors ${roomy ? 'px-3 pt-2.5 pb-1' : 'px-2 py-1.5'} ${on ? 'border-accent/40 bg-panel2' : 'border-border bg-panel2/40'}`}>
      <div className={`flex min-w-0 items-center gap-2 ${collapsed ? (roomy ? 'mb-1.5' : '') : roomy ? 'mb-2.5' : 'mb-1'}`} style={gap !== undefined ? { marginBottom: Math.max(6, gap + 2) } : undefined}>
        {onCollapse && (
          <button onClick={onCollapse} className="-mr-1 shrink-0 px-0.5 font-mono text-[9px] text-muted hover:text-accent" title={collapsed ? `Show the ${title}` : `Fold the ${title} to its header (it keeps playing)`}>
            <span className={`inline-block transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>
          </button>
        )}
        {onToggle && (
          <span className="relative flex shrink-0">
            {midiId && <MidiLearnOverlay id={midiId} />}
            <button onClick={onToggle} className={pill(on)} title={toggleTitle ?? (on ? 'on' : 'off')}>
              {on ? toggleText[0] : toggleText[1]}
            </button>
          </span>
        )}
        {lead}
        <span className="shrink-0 text-[11px] font-semibold">{title}</span>
        {hint && <span className="cursor-help rounded-full text-[10px] text-muted/70 hover:text-accent" title={hint}>ⓘ</span>}
        <span className="min-w-0 flex-1" />
        {right}
      </div>
      {!collapsed && (open ?? on) && children && (
        <div data-rows className={`flex flex-col ${roomy ? 'gap-2' : 'gap-1'}`} style={gap !== undefined ? { gap } : undefined}>{children}</div>
      )}
      {!collapsed && foot}
    </section>
  )
}

/** The dice / reset look of a card's header. */
export function IconBtn({ onClick, title, children }: { onClick: () => void; title: string; children: ReactNode }): JSX.Element {
  return (
    <button onClick={onClick} className="rounded px-1 py-0.5 text-[11px] leading-none text-muted transition-colors hover:text-accent" title={title}>
      {children}
    </button>
  )
}

/** A slider row without modulation : label, track, readout (the voices' look). */
export function RangeRow({ label, value, min, max, step, onChange, shown, title, neutral, accent2 }: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; shown: string; title: string; neutral?: number; accent2?: boolean
}): JSX.Element {
  return (
    <Row label={label} hint={title}>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => neutral !== undefined && onChange(neutral)}
        className={`min-w-0 flex-1 ${accent2 ? 'accent-accent2' : 'accent-accent'}`}
        title={`${title} : ${shown}`}
      />
      <span className="w-12 shrink-0 text-right font-mono text-[9px] text-muted">{shown}</span>
    </Row>
  )
}

/** A compressor's gain reduction, live (rAF, no React render) : `get` returns
 *  dB, -1 while bypassed. Narrow : a number the size of a slope chip, before a
 *  slider's track. Wide : a bar over 0..12 dB and the number. */
export function GrMeter({ get, wide, title }: { get: () => number; wide?: boolean; title: string }): JSX.Element {
  const barRef = useRef<HTMLDivElement | null>(null)
  const numRef = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    // on its own window's frames (the Sonify page may have one), timed by one
    // clock (a window of its own counts its frame times from its own start)
    const view = ownerWindow(barRef.current ?? numRef.current)
    let raf = 0, shown = -2, held = 0, at = performance.now()
    const tick = (): void => {
      raf = view.requestAnimationFrame(tick)
      const now = performance.now()
      const dt = Math.min(0.25, (now - at) / 1000)
      at = now
      if (sonifyCovered(numRef.current)) return
      const g = get()
      // fast down, slow back (12 dB/s) : a reduction stays readable
      held = g < 0 ? -1 : g >= held ? g : Math.max(g, held - 12 * dt)
      if (barRef.current) barRef.current.style.width = `${Math.min(100, Math.max(0, held / 12) * 100).toFixed(1)}%`
      const v = held < 0 ? -1 : Math.round(held * 10) / 10
      if (v !== shown && numRef.current) {
        shown = v
        numRef.current.textContent = v < 0 ? 'off' : v < 0.1 ? '0' : `-${v < 10 ? v.toFixed(1) : v.toFixed(0)}`
        numRef.current.style.color = v >= 0.1 ? 'rgb(var(--c-accent2))' : ''
      }
    }
    raf = view.requestAnimationFrame(tick)
    return () => view.cancelAnimationFrame(raf)
  }, [get])
  if (!wide) {
    return <span ref={numRef} title={title} className="w-[22px] shrink-0 text-center font-mono text-[8px] tabular-nums text-muted">off</span>
  }
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5" title={title}>
      <div className="relative h-[6px] min-w-[40px] flex-1 overflow-hidden rounded-sm bg-panel3">
        <div ref={barRef} className="absolute inset-y-0 left-0 w-0 bg-accent2/80" />
      </div>
      <span ref={numRef} className="w-12 shrink-0 text-right font-mono text-[9px] tabular-nums text-muted">off</span>
    </div>
  )
}

/** A compact −/+ number. */
export function Stepper({ value, min, max, onChange, title, suffix }: {
  value: number; min: number; max: number; onChange: (v: number) => void; title: string; suffix?: string
}): JSX.Element {
  return (
    <span className="flex shrink-0 items-center gap-0.5" title={title}>
      <button onClick={() => onChange(Math.max(min, value - 1))} className="rounded bg-panel3/60 px-1 font-mono text-[10px] leading-4 text-muted hover:text-text">−</button>
      <span className="min-w-[16px] text-center font-mono text-[9px] text-text">{value}{suffix}</span>
      <button onClick={() => onChange(Math.min(max, value + 1))} className="rounded bg-panel3/60 px-1 font-mono text-[10px] leading-4 text-muted hover:text-text">+</button>
    </span>
  )
}

/** A readout that follows its parameter's live modulation (a modulator or a Meta
 *  knob : the number moves with it, as in the Inspector), and shows the stored
 *  value otherwise. `liveKey` : the parameter's key in the live map (soni:<param>).
 *  Written straight to the DOM by the shared live loop, never through React. */
export function LiveNum({ liveKey, value, fmt, className, title }: {
  liveKey?: string; value: number; fmt: (v: number) => string; className?: string; title?: string
}): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const st = useRef({ value, fmt, live: false })
  st.current.value = value
  st.current.fmt = fmt
  // the stored value, whenever it changes and nothing modulates it
  useLayoutEffect(() => {
    if (ref.current && !st.current.live) ref.current.textContent = fmt(value)
  })
  useEffect(() => {
    const el = ref.current
    if (!liveKey || !el) return
    return registerLiveOverlay({
      key: liveKey,
      view: ownerWindow(el), // (the Sonify page's own window : its own frames)
      apply: (v) => {
        st.current.live = true
        const t = st.current.fmt(v)
        if (el.textContent !== t) el.textContent = t
      },
      idle: () => {
        if (!st.current.live) return
        st.current.live = false
        el.textContent = st.current.fmt(st.current.value)
      }
    })
  }, [liveKey])
  return <span ref={ref} className={className} title={title} />
}
