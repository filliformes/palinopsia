// The Sonify page's building blocks, shared by its three views (voices, mixer,
// seq) so they read as one : the voice card (Shell), the label column (Row),
// the on / play pill, the small option chips, a plain slider row with its
// readout, a −/+ stepper and the little icon buttons (dice, reset). The Voices
// view is the reference look : change it here, every view follows.

import { useRef, useState, type ReactNode } from 'react'
import { MidiLearnOverlay } from './MidiLearnOverlay'

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
  title, hint, on, onToggle, toggleText = ['● on', '○ off'], toggleTitle, midiId, lead, right, open, roomy, space, foot, children
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
  children?: ReactNode
}): JSX.Element {
  const gap = space !== undefined ? spaceGap(space) : undefined
  return (
    <section className={`rounded border transition-colors ${roomy ? 'px-3 pt-2.5 pb-1' : 'px-2 py-1.5'} ${on ? 'border-accent/40 bg-panel2' : 'border-border bg-panel2/40'}`}>
      <div className={`flex min-w-0 items-center gap-2 ${roomy ? 'mb-2.5' : 'mb-1'}`} style={gap !== undefined ? { marginBottom: Math.max(6, gap + 2) } : undefined}>
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
      {(open ?? on) && children && (
        <div data-rows className={`flex flex-col ${roomy ? 'gap-2' : 'gap-1'}`} style={gap !== undefined ? { gap } : undefined}>{children}</div>
      )}
      {foot}
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
