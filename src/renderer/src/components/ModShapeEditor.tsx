// A binding's shaping (engine/modShape.ts), opened under its row in the
// Modulate panel : COMBINE it with one or two other modulators, a THRESHOLD
// line, INTEGRATE into a position that holds. A live meter shows what the
// modulator gives and what comes out of the shaping (before depth and mode).

import { useEffect, useRef } from 'react'
import type { ModCombineOp, ModShape } from '@shared/types'
import { useStore } from '../store'
import { MOD_SLOTS, resetIntegrator, shapeActive, shapedLive } from '../engine/modShape'
import { modEngine } from '../engine/modulation'
import { BoundedNumberInput } from './BoundedNumberInput'

const OPS: Array<{ v: ModCombineOp | ''; label: string; title: string }> = [
  { v: '', label: 'off', title: 'Only this modulator' },
  { v: 'add', label: '+', title: 'Added : either one pushes it up (capped at full)' },
  { v: 'sub', label: '−', title: 'Minus the others : an LFO minus the kick ducks on the kick' },
  { v: 'mul', label: '×', title: 'Times the others : the LFO swings only while there is bass' },
  { v: 'min', label: 'min', title: 'The lowest : it moves only when all of them do' },
  { v: 'max', label: 'max', title: 'The highest : any one of them can drive it' }
]

const LABEL = 'w-[52px] shrink-0 font-mono text-[9px] uppercase text-muted'
const CHIP = 'shrink-0 rounded px-1 py-0.5 font-mono text-[9px] transition-colors'
const chip = (on: boolean, dim = false): string =>
  `${CHIP} ${on ? 'bg-accent/20 text-accent ring-1 ring-accent' : dim ? 'bg-panel3/30 text-muted/50' : 'bg-panel3/60 text-muted hover:text-text'}`

/** Two bars : the modulator as it comes (with the threshold's line) and what the
 *  shaping gives. One rAF, direct style writes, only while the editor is open. */
function ShapeMeter({ id, mod, threshold }: { id: string; mod: number; threshold: number }): JSX.Element {
  const rawRef = useRef<HTMLDivElement | null>(null)
  const outRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    let raf = 0
    const paint = (): void => {
      const live = shapedLive.get(id)
      const raw = live ? live.raw : (modEngine.values[mod] ?? 0)
      const out = live ? live.out : raw
      if (rawRef.current) rawRef.current.style.width = `${Math.round(raw * 100)}%`
      if (outRef.current) outRef.current.style.width = `${Math.round(out * 100)}%`
      raf = requestAnimationFrame(paint)
    }
    raf = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(raf)
  }, [id, mod])
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5" title="Top : the modulator as it comes (the tick : the threshold). Bottom : what the shaping gives, before depth and mode.">
      <div className="relative h-1 w-full overflow-hidden rounded bg-panel3/50">
        <div ref={rawRef} className="h-full bg-muted/60" style={{ width: '0%' }} />
        {threshold > 0 && <div className="absolute top-0 h-full w-px bg-accent2" style={{ left: `${threshold * 100}%` }} />}
      </div>
      <div className="h-1 w-full overflow-hidden rounded bg-panel3/50">
        <div ref={outRef} className="h-full bg-accent/80" style={{ width: '0%' }} />
      </div>
    </div>
  )
}

export function ModShapeEditor({ id }: { id: string }): JSX.Element | null {
  const a = useStore((s) => s.composition.modMatrix.find((x) => x.id === id))
  const setShape = useStore((s) => s.setAssignmentShape)
  if (!a) return null
  const s: ModShape = a.shape ?? {}
  const others = Array.from({ length: MOD_SLOTS }, (_, i) => i).filter((i) => i !== a.mod)
  const w0 = s.with?.[0]
  const w1 = s.with?.[1]
  const t = s.threshold ?? 0
  const integ = s.integrate ?? 'off'
  const flow = integ === 'flow'
  const amount = flow ? (s.rate ?? 0.25) : (s.step ?? 0.125)
  const setOp = (op: ModCombineOp | ''): void => {
    if (!op) setShape(id, { op: undefined, with: undefined })
    else setShape(id, { op, with: s.with?.length ? s.with : [others[0]] })
  }
  return (
    <div className="flex flex-col gap-1 rounded border border-border/70 bg-panel3/20 p-1">
      <div className="flex min-w-0 items-center gap-1">
        <span className={LABEL}>shape</span>
        <ShapeMeter id={id} mod={a.mod} threshold={t} />
      </div>
      {/* combine */}
      <div className="flex min-w-0 items-center gap-1">
        <span className={LABEL} title="Combine this modulator with one or two others">combine</span>
        <div className="flex shrink-0 gap-0.5">
          {OPS.map((o) => (
            <button key={o.label} className={chip((s.op ?? '') === o.v)} onClick={() => setOp(o.v)} title={o.title}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {s.op && (
        <div className="flex min-w-0 items-center gap-1">
          <span className="w-3 shrink-0" />
          <span className="shrink-0 font-mono text-[9px] text-muted">M{a.mod + 1} {OPS.find((o) => o.v === s.op)?.label}</span>
            <select
              className="input select-compact min-w-0 flex-1 px-1 py-0"
              style={{ fontSize: 9, height: 18, paddingTop: 0, paddingBottom: 0, lineHeight: '16px' }}
              value={w0 ?? others[0]}
              onChange={(e) => setShape(id, { with: [Number(e.target.value), ...(w1 !== undefined && w1 !== Number(e.target.value) ? [w1] : [])] })}
              title="The second modulator"
            >
              {others.map((i) => <option key={i} value={i}>M{i + 1}</option>)}
            </select>
            <select
              className="input select-compact min-w-0 flex-1 px-1 py-0"
              style={{ fontSize: 9, height: 18, paddingTop: 0, paddingBottom: 0, lineHeight: '16px' }}
              value={w1 ?? -1}
              onChange={(e) => {
                const v = Number(e.target.value)
                setShape(id, { with: v < 0 ? [w0 ?? others[0]] : [w0 ?? others[0], v] })
              }}
              title="A third modulator, or none"
            >
              <option value={-1}>none</option>
              {others.filter((i) => i !== (w0 ?? others[0])).map((i) => <option key={i} value={i}>M{i + 1}</option>)}
            </select>
        </div>
      )}
      {/* threshold */}
      <div className="flex min-w-0 items-center gap-1">
        <span className={LABEL} title="Only what passes the line moves the parameter">threshold</span>
        <input
          type="range"
          min={0}
          max={0.95}
          step={0.01}
          value={t}
          onChange={(e) => setShape(id, { threshold: Number(e.target.value) || undefined })}
          onDoubleClick={() => setShape(id, { threshold: undefined })}
          className="min-w-0 flex-1 accent-accent"
          title={t > 0 ? `Line at ${t.toFixed(2)} : under it, nothing moves. Double-click : off` : 'Off. Drag right : only what passes the line moves the parameter (room noise, a quiet passage do nothing)'}
        />
        <BoundedNumberInput
          value={t}
          min={0}
          max={0.95}
          maxFrac={2}
          onChange={(v) => setShape(id, { threshold: v > 0 ? v : undefined })}
          className="input w-9 shrink-0 px-0.5 py-0.5 text-right text-[9px]"
        />
        <button
          className={chip(t > 0 && s.thresholdMode === 'gate', t <= 0)}
          onClick={() => setShape(id, { thresholdMode: s.thresholdMode === 'gate' ? undefined : 'gate' })}
          title={s.thresholdMode === 'gate' ? 'Gate : fully on above the line, off under it. Click : cut' : 'Cut : the part above the line, opened back to the whole range. Click : gate (on or off)'}
        >
          {s.thresholdMode === 'gate' ? 'gate' : 'cut'}
        </button>
      </div>
      {/* integrate */}
      <div className="flex min-w-0 items-center gap-1">
        <span className={LABEL} title="The value pushes a position that stays where it got to">integrate</span>
        <div className="flex shrink-0 gap-0.5">
          {(['off', 'flow', 'step'] as const).map((m) => (
            <button
              key={m}
              className={chip(integ === m)}
              onClick={() => setShape(id, { integrate: m === 'off' ? undefined : m })}
              title={
                m === 'off'
                  ? 'The value as it is : it falls back to the base when the modulator does'
                  : m === 'flow'
                    ? 'Flow : the value drives the position, louder = faster, nothing = it holds where it got to'
                    : 'Step : each hit pushes the position one notch (the kick turning a rotation or a hue per beat)'
              }
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      {integ !== 'off' && (
        <div className="flex min-w-0 items-center gap-1">
          <span className="w-3 shrink-0" />
            <input
              type="range"
              min={flow ? 0.01 : 0.01}
              max={flow ? 4 : 0.5}
              step={0.01}
              value={amount}
              onChange={(e) => setShape(id, flow ? { rate: Number(e.target.value) } : { step: Number(e.target.value) })}
              onDoubleClick={() => setShape(id, flow ? { rate: 0.25 } : { step: 0.125 })}
              className="min-w-0 flex-1 accent-accent"
              title={flow ? `${amount.toFixed(2)} turns a second at full value (a turn = the whole swing). Double-click : 0.25` : `One notch = ${amount.toFixed(2)} of a turn (${Math.round(amount * 360)}° on an angle). Double-click : 0.125`}
            />
            <BoundedNumberInput
              value={amount}
              min={0.01}
              max={flow ? 4 : 0.5}
              maxFrac={2}
              onChange={(v) => setShape(id, flow ? { rate: v } : { step: v })}
              className="input w-9 shrink-0 px-0.5 py-0.5 text-right text-[9px]"
            />
            <button
              className={chip(s.ends === 'wrap')}
              onClick={() => setShape(id, { ends: s.ends === 'wrap' ? undefined : 'wrap' })}
              title={s.ends === 'wrap' ? 'Wrap : past the end it comes round again (an angle, a hue). Click : bounce' : 'Bounce : at an end it comes back (anything that is not round). Click : wrap'}
            >
              {s.ends === 'wrap' ? 'wrap' : 'bounce'}
            </button>
            <button className={chip(false)} onClick={() => resetIntegrator(id)} title="Back to the middle : the parameter at its base">
              ⟲
            </button>
        </div>
      )}
    </div>
  )
}

/** The row's button : lit while its binding is shaped. */
export function ShapeToggle({ id, open, onToggle }: { id: string; open: boolean; onToggle: () => void }): JSX.Element {
  const active = useStore((s) => shapeActive(s.composition.modMatrix.find((x) => x.id === id)?.shape))
  return (
    <button
      onClick={onToggle}
      className={`shrink-0 rounded px-1 py-0.5 font-mono text-[9px] transition-colors ${
        active ? 'bg-accent/20 text-accent ring-1 ring-accent' : open ? 'bg-panel3 text-text' : 'bg-panel3/60 text-muted hover:text-text'
      }`}
      title={active ? 'Shaped (combine, threshold or integrate) : click to see it' : 'Shape : combine with other modulators, a threshold, integrate'}
    >
      ⌇
    </button>
  )
}
