// Bars : the Inspector's and the Finishing's controls (v1.3.2). One filled
// rectangle per parameter, its name inside on the left, its value inside on the
// right, its M at the right end. A float fills from its start (or from 0 when
// its range crosses 0) to the value; a modulated one fills in accent2 and the
// fill follows the LIVE value while the pointer stays on the stored one. The
// pointer's look is a per-machine setting (sliderPointer.ts, the UI tab) drawn
// in CSS (styles.css, "Bars").
//
// Drag semantics are the app's : a plain drag is absolute (a click jumps there,
// like a native slider), a modulated bar's drag moves its stored value by as
// much as you move (a grab never sets it to wherever the modulator happens to
// be), and Shift drags at a tenth of the speed from where you are. Pointer x is
// mapped through getBoundingClientRect, so it holds at any UI zoom (CSS zoom).
// The live value is painted by the shared rAF (liveOverlay.ts) straight into
// CSS variables and the value's text node : a modulated bar never re-renders.
//
// Presentational only : AutoControls.tsx maps the shader inputs onto these and
// builds their M chips.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEvent as RKeyboardEvent,
  type MouseEvent,
  type PointerEvent as RPointerEvent,
  type ReactNode,
  type Ref,
  type RefObject
} from 'react'
import { registerLiveOverlay } from './liveOverlay'
import { liveModValues } from '../engine/modulation'
import './sliderPointer' // sets the root's data-pointer before the first bar draws

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

/** A bar's number : the decimals the range needs (fracFor), trailing zeros off. */
export function fmtBar(x: number, integer: boolean, frac: number): string {
  if (!Number.isFinite(x)) return ''
  if (integer) return String(Math.round(x))
  return String(parseFloat(x.toFixed(frac)))
}

/** Test builds : how many times a bar rendered (the live overlay never renders one). */
function counted(): void {
  if (import.meta.env.VITE_OPSIA_TEST) {
    const g = window as unknown as { __barRenders?: number }
    g.__barRenders = (g.__barRenders ?? 0) + 1
  }
}

/** A readout's text, written into React's own text node (replacing the node
 *  would leave React updating a detached one). */
function setText(el: HTMLElement | null, s: string): void {
  const n = el?.firstChild
  if (n && n.nodeType === 3 && n.nodeValue !== s) n.nodeValue = s
}

function setVar(el: HTMLElement, k: string, v: number): void {
  const s = String(Math.round(v * 10000) / 10000)
  if (el.style.getPropertyValue(k) !== s) el.style.setProperty(k, s)
}

const NAME = 'min-w-0 truncate text-[10px] uppercase leading-none tracking-[0.12em]'

// ── the frame every bar shares ─────────────────────────────────────────
function Shell({
  mod,
  className = '',
  style,
  title,
  rootRef,
  children
}: {
  mod?: boolean
  className?: string
  style?: CSSProperties
  title?: string
  rootRef?: Ref<HTMLDivElement>
  children: ReactNode
}): JSX.Element {
  return (
    <div
      ref={rootRef}
      data-bar=""
      data-mod={mod ? '' : undefined}
      title={title}
      className={`bar flex h-[var(--bar-h)] min-w-0 overflow-hidden rounded-[3px] border border-border bg-panel2 font-mono text-text ${className}`}
      style={style}
    >
      {children}
    </div>
  )
}

// ── the M chip (built by AutoControls : this is only its look) ─────────
export function BarChip({
  text,
  bound,
  active,
  label,
  title,
  onClick,
  onContextMenu,
  small = false
}: {
  text: string
  bound: boolean
  active: boolean
  label: string
  title: string
  onClick: () => void
  onContextMenu: (e: MouseEvent) => void
  small?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      aria-label={`Modulate ${label}`}
      title={title}
      className={`flex shrink-0 items-center justify-center border-l border-border px-[3px] font-mono leading-none transition-[filter] hover:brightness-125 ${
        small ? 'min-w-[20px] text-[9px]' : 'min-w-[26px] text-[9.5px]'
      } ${bound ? 'bg-accent2/20 text-accent2' : active ? 'bg-panel text-accent2' : 'bg-panel text-muted hover:text-text'} ${
        active ? 'shadow-[inset_0_0_0_1px_rgb(var(--c-accent2))]' : ''
      }`}
    >
      {text}
    </button>
  )
}

// ── the drag, shared by the float bars and a color's alpha ─────────────
interface DragOpts {
  min: number
  max: number
  integer: boolean
  frac: number
  modulated: boolean
  value: number
  onChange: (v: number) => void
}

/** Pointer-down handler of a bar track : absolute, relative while modulated,
 *  a tenth of the speed with Shift (from where the pointer is when Shift goes
 *  down, so pressing it mid-drag never jumps). */
function useBarDrag(opts: DragOpts, focusRef: RefObject<HTMLElement>): (e: RPointerEvent<HTMLElement>) => void {
  const cur = useRef(opts)
  cur.current = opts
  return (e) => {
    if (e.button !== 0) return
    const el = e.currentTarget
    e.preventDefault() // (no text selection; the focus goes to the bar's own input below)
    focusRef.current?.focus({ preventScroll: true })
    el.setPointerCapture(e.pointerId)
    const o0 = cur.current
    let shift = e.shiftKey
    let rel = o0.modulated || shift
    let x0 = e.clientX
    let v0 = o0.value
    let last = o0.value
    const put = (x: number, fine: boolean): void => {
      const o = cur.current
      let v = Math.max(o.min, Math.min(o.max, x))
      // the stored value keeps a decimal or two more than the bar shows
      v = o.integer ? Math.round(v) : parseFloat(v.toFixed(Math.min(8, o.frac + (fine ? 2 : 1))))
      if (v !== last) {
        last = v
        o.onChange(v)
      }
    }
    const at = (cx: number): number => {
      const r = el.getBoundingClientRect()
      const o = cur.current
      return o.min + clamp01((cx - r.left) / Math.max(1, r.width)) * (o.max - o.min)
    }
    if (!rel) put(at(e.clientX), false)
    const move = (ev: PointerEvent): void => {
      if (!(ev.buttons & 1)) {
        up()
        return
      }
      if (ev.shiftKey !== shift) {
        // Shift pressed or let go mid-drag : carry on from here, relative
        shift = ev.shiftKey
        rel = true
        x0 = ev.clientX
        v0 = last
      }
      if (!rel) {
        put(at(ev.clientX), false)
        return
      }
      const o = cur.current
      const w = Math.max(1, el.getBoundingClientRect().width)
      put(v0 + ((ev.clientX - x0) / w) * (o.max - o.min) * (shift ? 0.1 : 1), shift)
    }
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('lostpointercapture', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('lostpointercapture', up)
  }
}

/** Arrow keys step a 200th of the range (1 for a count), Shift a tenth of that;
 *  Page Up / Down a tenth of the range, Home / End its ends. */
function keyStep(e: RKeyboardEvent, o: DragOpts): number | null {
  const span = o.max - o.min
  const step = o.integer ? 1 : (span / 200) * (e.shiftKey ? 0.1 : 1)
  const v = o.value
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return v + step
    case 'ArrowLeft':
    case 'ArrowDown':
      return v - step
    case 'PageUp':
      return v + (o.integer ? Math.max(1, Math.round(span / 10)) : span / 10)
    case 'PageDown':
      return v - (o.integer ? Math.max(1, Math.round(span / 10)) : span / 10)
    case 'Home':
      return o.min
    case 'End':
      return o.max
    default:
      return null
  }
}

// ── float ─────────────────────────────────────────────────────────────
export interface FloatBarProps {
  label: string
  /** the track's tooltip (hint, how to use it, why it is greyed) */
  title?: string
  value: number
  min: number
  max: number
  def: number
  integer?: boolean
  /** decimals shown (fracFor) */
  frac: number
  onChange: (v: number) => void
  modulated?: boolean
  /** liveModValues key : the live value while modulated */
  liveKey?: string | null
  chip?: ReactNode
  /** a small control inside the bar, after its name (Context's PRE / POST) */
  extra?: ReactNode
  className?: string
}

export function FloatBar(p: FloatBarProps): JSX.Element {
  counted()
  const { min, max, frac } = p
  const integer = !!p.integer
  const modulated = !!p.modulated && !!p.liveKey
  const span = max - min || 1
  const fr = (x: number): number => clamp01((x - min) / span)
  const zf = min < 0 && max > 0 ? fr(0) : 0
  const v = integer ? Math.round(p.value) : p.value
  const f = fr(v)
  const rootRef = useRef<HTMLDivElement>(null)
  const keyRef = useRef<HTMLInputElement>(null)
  const valRef = useRef<HTMLButtonElement>(null)
  const baseRef = useRef(v)
  baseRef.current = v
  const [draft, setDraft] = useState<string | null>(null)
  // The edit ended by Enter or Escape : the blur that follows (the focus going
  // back to the bar) must not commit it again, nor commit what Escape dropped.
  const settled = useRef(false)
  const edit = (): void => {
    settled.current = false
    setDraft(shownRef.current)
  }
  const drag: DragOpts = { min, max, integer, frac, modulated, value: v, onChange: p.onChange }
  const onPointerDown = useBarDrag(drag, keyRef)

  // The live value, painted by the shared rAF : the fill's three variables, the
  // lit edge's sign and the number. The stored value's pointer (--f) stays
  // React's. Painted once right away (no frame without a fill).
  useLayoutEffect(() => {
    const root = rootRef.current
    const key = p.liveKey
    if (!modulated || !key || !root) return
    const paint = (x: number): void => {
      const lf = fr(x)
      setVar(root, '--lf', lf)
      setVar(root, '--fl', Math.min(lf, zf))
      setVar(root, '--fw', Math.abs(lf - zf))
      if (lf < zf) root.setAttribute('data-neg', '')
      else root.removeAttribute('data-neg')
      setText(valRef.current, fmtBar(x, integer, frac))
    }
    paint(liveModValues.get(key) ?? baseRef.current)
    const stop = registerLiveOverlay({
      key,
      apply: paint,
      idle: () => paint(baseRef.current),
      view: root.ownerDocument.defaultView ?? undefined
    })
    return () => {
      stop()
      paint(baseRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modulated, p.liveKey, min, max, integer, frac])

  const style: Record<string, string | number> = { '--f': f, '--z': zf }
  // (while modulated the live fill is the overlay's alone : a render never puts it back to the stored value)
  if (!modulated) Object.assign(style, { '--lf': f, '--fl': Math.min(f, zf), '--fw': Math.abs(f - zf) })
  const shown = fmtBar(v, integer, frac)
  const shownRef = useRef(shown)
  shownRef.current = shown
  // the number's room : its widest form, so a moving value never jostles the name
  const ch = Math.max(fmtBar(min, integer, frac).length, fmtBar(max, integer, frac).length, shown.length, integer ? 1 : frac + 2 + (min < 0 ? 1 : 0))

  const commit = (s: string | null): void => {
    setDraft(null)
    if (s === null) return
    const n = parseFloat(s.replace(',', '.'))
    if (!Number.isFinite(n)) return
    const c = Math.max(min, Math.min(max, integer ? Math.round(n) : n))
    if (c !== v) p.onChange(c)
  }

  return (
    <Shell
      mod={modulated}
      rootRef={rootRef}
      className={p.className}
      style={{ ...(style as CSSProperties) }}
    >
      <div
        className="relative min-w-0 flex-1 cursor-ew-resize touch-none select-none"
        onPointerDown={draft === null ? onPointerDown : undefined}
        onDoubleClick={() => p.onChange(p.def)}
        title={p.title}
      >
        <div className="bar-fill" />
        {zf > 0 && <div className="bar-zero" />}
        <div className="bar-ticks" />
        <div className="bar-edge" />
        <div className="bar-tick" />
        <div className="bar-ptr" />
        {/* The focus target : a real range input (keys, Tab, screen readers, and
            the app's shortcuts stay quiet while it has the focus, as they did for
            the classic slider). Never under the pointer : the bar takes the drag. */}
        <input
          ref={keyRef}
          type="range"
          className="bar-key pointer-events-none absolute inset-0 h-full w-full opacity-0"
          min={min}
          max={max}
          step="any"
          value={v}
          aria-label={p.label}
          tabIndex={0}
          onChange={() => undefined}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              edit()
              return
            }
            const n = keyStep(e, drag)
            if (n === null) return
            e.preventDefault()
            e.stopPropagation()
            const c = Math.max(min, Math.min(max, integer ? Math.round(n) : parseFloat(n.toFixed(Math.min(8, frac + 2)))))
            if (c !== v) p.onChange(c)
          }}
        />
        <div className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-between gap-1.5 pl-2 pr-1">
          <span className="flex min-w-0 items-center gap-1">
            <span data-bar-name="" className={NAME}>
              {p.label}
            </span>
            {p.extra && (
              <span className="pointer-events-auto flex shrink-0" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                {p.extra}
              </span>
            )}
          </span>
          {draft !== null ? (
            <input
              autoFocus
              className="pointer-events-auto relative z-[3] h-[calc(var(--bar-h)-6px)] w-16 shrink-0 rounded-sm border border-accent bg-bg px-1 text-right font-mono text-[11px] text-text outline-none"
              value={draft}
              inputMode="decimal"
              aria-label={`Type ${p.label}`}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setDraft(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') {
                  e.preventDefault()
                  settled.current = true
                  commit(e.currentTarget.value)
                  keyRef.current?.focus({ preventScroll: true })
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  settled.current = true
                  setDraft(null)
                  keyRef.current?.focus({ preventScroll: true })
                }
              }}
              onBlur={(e) => {
                if (!settled.current) commit(e.currentTarget.value)
              }}
            />
          ) : (
            <button
              ref={valRef}
              type="button"
              data-bar-val=""
              className="pointer-events-auto shrink-0 cursor-text rounded-sm px-0.5 text-right text-[11px] leading-none tabular-nums hover:bg-black/30"
              style={{ minWidth: `${ch}ch` }}
              title="Click to type a value"
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={edit}
            >
              {shown}
            </button>
          )}
        </div>
      </div>
      {p.chip}
    </Shell>
  )
}

// ── enum : a few options as segments ───────────────────────────────────
export interface EnumBarProps {
  label: string
  title?: string
  options: Array<{ value: number; label: string }>
  value: number
  onChange: (v: number) => void
  modulated?: boolean
  liveKey?: string | null
  chip?: ReactNode
  className?: string
}

/** The option a live value plays (the engine snaps enums to their values). */
function optionAt(options: Array<{ value: number }>, x: number): number {
  let best = 0
  for (let i = 1; i < options.length; i++) if (Math.abs(options[i].value - x) < Math.abs(options[best].value - x)) best = i
  return best
}

export function SegBar(p: EnumBarProps): JSX.Element {
  counted()
  const modulated = !!p.modulated && !!p.liveKey
  const rootRef = useRef<HTMLDivElement>(null)
  const on = optionAt(p.options, p.value)
  useLayoutEffect(() => {
    const root = rootRef.current
    const key = p.liveKey
    if (!modulated || !key || !root) return
    const segs = (): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>('[data-seg]'))
    const paint = (x: number): void => {
      const i = optionAt(p.options, x)
      segs().forEach((s, j) => {
        if (j === i) s.setAttribute('data-on', '')
        else s.removeAttribute('data-on')
      })
    }
    paint(liveModValues.get(key) ?? p.value)
    const stop = registerLiveOverlay({ key, apply: paint, idle: () => paint(p.value), view: root.ownerDocument.defaultView ?? undefined })
    return () => {
      stop()
      paint(p.value)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modulated, p.liveKey, p.value, p.options.length])
  return (
    <Shell mod={modulated} rootRef={rootRef} className={p.className}>
      <span
        data-bar-name=""
        className={`flex max-w-[45%] shrink-0 items-center border-r border-border px-2 text-muted ${NAME}`}
        title={p.title}
      >
        {p.label}
      </span>
      <div role="group" aria-label={p.label} className="flex min-w-0 flex-1">
        {p.options.map((o, i) => (
          <button
            key={o.value}
            type="button"
            data-seg=""
            data-on={!modulated && i === on ? '' : undefined}
            aria-pressed={i === on}
            onClick={() => p.onChange(o.value)}
            className="bar-seg min-w-0 flex-1 truncate border-r border-border px-0.5 text-[10.5px] last:border-r-0 hover:brightness-125"
            title={`${o.label}${modulated ? ' (modulated : a click sets the stored one)' : ''}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {p.chip}
    </Shell>
  )
}

// ── enum : many options, a menu ────────────────────────────────────────
export function DropBar(p: EnumBarProps & { bare?: boolean }): JSX.Element {
  counted()
  const modulated = !!p.modulated && !!p.liveKey
  const rootRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const i = optionAt(p.options, p.value)
  const shown = p.options[i]?.label ?? String(p.value)
  useLayoutEffect(() => {
    const root = rootRef.current
    const key = p.liveKey
    if (!modulated || !key || !root) return
    const paint = (x: number): void => setText(textRef.current, p.options[optionAt(p.options, x)]?.label ?? '')
    paint(liveModValues.get(key) ?? p.value)
    const stop = registerLiveOverlay({ key, apply: paint, idle: () => paint(p.value), view: root.ownerDocument.defaultView ?? undefined })
    return () => {
      stop()
      setText(textRef.current, shown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modulated, p.liveKey, p.value, p.options.length])
  return (
    <Shell mod={modulated} rootRef={rootRef} className={`${p.bare ? '!h-[18px]' : ''} ${p.className ?? ''}`}>
      <label className={`relative flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-1.5 hover:brightness-125 ${p.bare ? 'pl-1.5 pr-1' : 'pl-2 pr-1.5'}`}>
        {!p.bare && (
          <span data-bar-name="" className={`text-muted ${NAME}`}>
            {p.label}
          </span>
        )}
        <span className={`flex min-w-0 items-center gap-1 leading-none ${p.bare ? 'text-[10px]' : 'text-[11px]'}`}>
          <span ref={textRef} data-bar-val="" className={`min-w-0 truncate ${modulated ? 'text-accent2' : ''}`}>
            {shown}
          </span>
          <span className={`shrink-0 text-[9px] ${modulated ? 'text-accent2' : 'text-accent'}`}>▾</span>
        </span>
        {/* the app's own menu, as before : the native list (type to jump) */}
        <select
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          value={p.options[i]?.value ?? p.value}
          aria-label={p.label}
          title={p.title}
          onChange={(e) => p.onChange(Number(e.target.value))}
        >
          {p.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {p.chip}
    </Shell>
  )
}

// ── bool : the whole bar is the switch ─────────────────────────────────
export function BoolBar(p: {
  label: string
  title?: string
  value: boolean
  onChange: (on: boolean) => void
  modulated?: boolean
  liveKey?: string | null
  chip?: ReactNode
  className?: string
}): JSX.Element {
  counted()
  const modulated = !!p.modulated && !!p.liveKey
  const btnRef = useRef<HTMLButtonElement>(null)
  const stateRef = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const b = btnRef.current
    const key = p.liveKey
    if (!modulated || !key || !b) return
    const paint = (live: boolean): void => {
      if (live) b.setAttribute('data-on', '')
      else b.removeAttribute('data-on')
      setText(stateRef.current, live ? 'on' : 'off')
    }
    const lv = liveModValues.get(key)
    paint(lv === undefined ? p.value : lv >= 0.5)
    const stop = registerLiveOverlay({ key, apply: (x) => paint(x >= 0.5), idle: () => paint(p.value), view: b.ownerDocument.defaultView ?? undefined })
    return () => {
      stop()
      paint(p.value)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modulated, p.liveKey, p.value])
  return (
    <Shell mod={modulated} className={p.className}>
      <button
        ref={btnRef}
        type="button"
        data-on={!modulated && p.value ? '' : undefined}
        aria-pressed={p.value}
        onClick={() => p.onChange(!p.value)}
        className="bar-bool flex min-w-0 flex-1 items-center justify-between gap-1.5 pl-2 pr-1.5 hover:brightness-125"
        title={p.title}
      >
        <span data-bar-name="" className={NAME}>
          {p.label}
        </span>
        <span ref={stateRef} data-bar-val="" className="shrink-0 text-[11px] leading-none">
          {p.value ? 'on' : 'off'}
        </span>
      </button>
      {p.chip}
    </Shell>
  )
}

// ── event : a momentary button ─────────────────────────────────────────
export function EventBar(p: { label: string; title?: string; onFire: () => void; chip?: ReactNode; className?: string }): JSX.Element {
  counted()
  const [flash, setFlash] = useState(false)
  const t = useRef<number | null>(null)
  useEffect(() => () => {
    if (t.current !== null) window.clearTimeout(t.current)
  }, [])
  return (
    <div data-bar="" className={`bar flex h-[var(--bar-h)] min-w-0 overflow-hidden rounded-[3px] border font-mono ${flash ? 'border-accent' : 'border-accent/40'} ${p.className ?? ''}`}>
      <button
        type="button"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          p.onFire()
          setFlash(true)
          if (t.current !== null) window.clearTimeout(t.current)
          t.current = window.setTimeout(() => setFlash(false), 180)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            p.onFire()
          }
        }}
        className={`flex min-w-0 flex-1 items-center justify-center px-2 transition-colors ${flash ? 'bg-accent/60 text-text' : 'bg-accent/10 text-accent hover:bg-accent/20'}`}
        title={p.title}
      >
        <span data-bar-name="" className={NAME}>
          {p.label}
        </span>
      </button>
      {p.chip}
    </div>
  )
}

// ── color : the bar painted in it ──────────────────────────────────────
/** Ink that reads on a color : dark on a light one, light on a dark one. */
export function inkFor(rgb: number[]): string {
  const lum = 0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0)
  return lum > 0.55 ? 'rgb(20 20 20)' : 'rgb(242 242 242)'
}

export function ColorBar(p: {
  label: string
  title?: string
  hex: string
  rgb: number[]
  /** the hex text (the live one is written into it) */
  hexRef: Ref<HTMLSpanElement>
  zoneRef: Ref<HTMLLabelElement>
  /** the native picker's props (value, change, the stored-color guards) */
  picker: InputHTMLAttributes<HTMLInputElement> & { ref: Ref<HTMLInputElement> }
  driven: boolean
  /** React paints the zone (false : the live overlay does, while it is driven) */
  painted: boolean
  /** the alpha cell (none : the shader reads RGB only) */
  alpha?: ReactNode
  chip?: ReactNode
  className?: string
}): JSX.Element {
  counted()
  const ink = inkFor(p.rgb)
  return (
    <Shell mod={p.driven} className={`${p.driven ? 'shadow-[inset_0_0_0_1px_rgb(var(--c-accent2))]' : ''} ${p.className ?? ''}`}>
      <label
        ref={p.zoneRef}
        className="relative flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-1.5 pl-2 pr-1.5"
        style={p.painted ? { backgroundColor: p.hex, color: ink } : undefined}
        title={p.title}
      >
        <span data-bar-name="" className={NAME}>
          {p.label}
        </span>
        <span ref={p.hexRef} data-bar-val="" className="shrink-0 text-[11px] leading-none">
          {p.hex}
        </span>
        <input {...p.picker} type="color" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label={p.label} />
      </label>
      {p.alpha}
      {p.chip}
    </Shell>
  )
}

/** A color's alpha : a small bar of its own inside the color's bar (no name,
 *  the number in it). Its live value comes from `read` (the live color). */
export function AlphaCell(p: {
  value: number
  def: number
  onChange: (v: number) => void
  modulated: boolean
  read: () => number | undefined
}): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const keyRef = useRef<HTMLInputElement>(null)
  const valRef = useRef<HTMLSpanElement>(null)
  const baseRef = useRef(p.value)
  baseRef.current = p.value
  const drag: DragOpts = { min: 0, max: 1, integer: false, frac: 2, modulated: p.modulated, value: p.value, onChange: p.onChange }
  const onPointerDown = useBarDrag(drag, keyRef)
  const readRef = useRef(p.read)
  readRef.current = p.read
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!p.modulated || !root) return
    const paint = (): void => {
      const a = readRef.current() ?? baseRef.current
      setVar(root, '--fw', clamp01(a))
      setText(valRef.current, a.toFixed(2))
    }
    paint()
    const stop = registerLiveOverlay({ paint, view: root.ownerDocument.defaultView ?? undefined })
    return () => {
      stop()
      setVar(root, '--fw', clamp01(baseRef.current))
      setText(valRef.current, baseRef.current.toFixed(2))
    }
  }, [p.modulated])
  const style = p.modulated ? {} : { '--fw': clamp01(p.value) }
  return (
    <div
      ref={rootRef}
      data-mod={p.modulated ? '' : undefined}
      className="bar bar-alpha relative w-[42px] shrink-0 cursor-ew-resize touch-none select-none border-l border-border bg-panel2"
      style={{ ...(style as CSSProperties), '--fl': 0 } as CSSProperties}
      onPointerDown={onPointerDown}
      onDoubleClick={() => p.onChange(p.def)}
      title={`Alpha ${p.value.toFixed(2)}${p.modulated ? ' (modulated : a drag moves the stored alpha by as much as you move)' : ''} : drag, Shift-drag finer, double-click resets`}
    >
      <div className="bar-fill" />
      <input
        ref={keyRef}
        type="range"
        className="bar-key pointer-events-none absolute inset-0 h-full w-full opacity-0"
        min={0}
        max={1}
        step="any"
        value={p.value}
        aria-label="alpha"
        onChange={() => undefined}
        onKeyDown={(e) => {
          const n = keyStep(e, drag)
          if (n === null) return
          e.preventDefault()
          e.stopPropagation()
          p.onChange(Math.max(0, Math.min(1, parseFloat(n.toFixed(4)))))
        }}
      />
      <span ref={valRef} data-bar-val="" className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-end pr-1 text-[10px] leading-none tabular-nums">
        {p.value.toFixed(2)}
      </span>
    </div>
  )
}
