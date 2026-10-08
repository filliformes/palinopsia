// The Sonify page's building blocks, shared by its three views (voices, mixer,
// seq) so they read as one : the voice card (Shell), the label column (Row),
// the on / play pill, the small option chips, a plain slider row with its
// readout, a −/+ stepper and the little icon buttons (dice, reset). The Voices
// view is the reference look : change it here, every view follows.

import type { ReactNode } from 'react'
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
  title, hint, on, onToggle, toggleText = ['● on', '○ off'], toggleTitle, midiId, lead, right, open, children
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
  children?: ReactNode
}): JSX.Element {
  return (
    <section className={`rounded border px-2 py-1.5 transition-colors ${on ? 'border-accent/40 bg-panel2' : 'border-border bg-panel2/40'}`}>
      <div className="mb-1 flex min-w-0 items-center gap-2">
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
      {(open ?? on) && children && <div className="flex flex-col gap-1">{children}</div>}
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
