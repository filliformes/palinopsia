// A binding's shaping (engine/modShape.ts), opened under its row in the
// Modulate panel : COMBINE it with one or two other modulators, a THRESHOLD
// line, INTEGRATE into a position that holds. A live meter shows what the
// modulator gives and what comes out of the shaping (before depth and mode).
// On bars (Bar.tsx) since v1.3.2 : names and numbers inside, a click on the
// number types it, a double-click resets, the switches ride the bars' ends.

import { useEffect, useRef } from 'react'
import type { ModCombineOp, ModShape } from '@shared/types'
import { useStore } from '../store'
import { MOD_SLOTS, resetIntegrator, shapeActive, shapedLive } from '../engine/modShape'
import { modEngine } from '../engine/modulation'
import { BarCell, DropBar, FloatBar, SegBar } from './Bar'

const OPS: Array<{ v: ModCombineOp | ''; label: string; title: string }> = [
  { v: '', label: 'off', title: 'Only this modulator' },
  { v: 'add', label: '+', title: 'Added : either one pushes it up (capped at full)' },
  { v: 'sub', label: '−', title: 'Minus the others : an LFO minus the kick ducks on the kick' },
  { v: 'mul', label: '×', title: 'Times the others : the LFO swings only while there is bass' },
  { v: 'min', label: 'min', title: 'The lowest : it moves only when all of them do' },
  { v: 'max', label: 'max', title: 'The highest : any one of them can drive it' }
]

const LABEL = 'w-[52px] shrink-0 font-mono text-[9px] uppercase text-muted'
const INTEGRATE = ['off', 'flow', 'step'] as const

/** Two bars : the modulator as it comes (with the threshold's line) and what the
 *  shaping gives. One rAF, direct style writes, only while the editor is open. */
function ShapeMeter({ id, mod, threshold }: { id: string; mod: number; threshold: number }): JSX.Element {
  const rawRef = useRef<HTMLDivElement | null>(null)
  const outRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    // the clock of the window it is in (the Output page can have its own)
    const view = rawRef.current?.ownerDocument.defaultView ?? window
    let raf = 0
    const paint = (): void => {
      const live = shapedLive.get(id)
      const raw = live ? live.raw : (modEngine.values[mod] ?? 0)
      const out = live ? live.out : raw
      if (rawRef.current) rawRef.current.style.width = `${Math.round(raw * 100)}%`
      if (outRef.current) outRef.current.style.width = `${Math.round(out * 100)}%`
      raf = view.requestAnimationFrame(paint)
    }
    raf = view.requestAnimationFrame(paint)
    return () => view.cancelAnimationFrame(raf)
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
      {/* combine : six choices, a menu bar */}
      <DropBar
        label="combine"
        title="Combine this modulator with one or two others"
        options={OPS.map((o, i) => ({ value: i, label: o.label, title: o.title }))}
        value={Math.max(0, OPS.findIndex((o) => o.v === (s.op ?? '')))}
        onChange={(i) => setOp(OPS[i]?.v ?? '')}
      />
      {s.op && (
        <div className="flex min-w-0 gap-1">
          <DropBar
            className="min-w-0 flex-1"
            label={`M${a.mod + 1} ${OPS.find((o) => o.v === s.op)?.label ?? ''}`}
            title="The second modulator"
            options={others.map((i) => ({ value: i, label: `M${i + 1}` }))}
            value={w0 ?? others[0]}
            onChange={(v) => setShape(id, { with: [v, ...(w1 !== undefined && w1 !== v ? [w1] : [])] })}
          />
          <DropBar
            className="min-w-0 flex-1"
            label={OPS.find((o) => o.v === s.op)?.label ?? ''}
            title="A third modulator, or none"
            options={[{ value: -1, label: 'none' }, ...others.filter((i) => i !== (w0 ?? others[0])).map((i) => ({ value: i, label: `M${i + 1}` }))]}
            value={w1 ?? -1}
            onChange={(v) => setShape(id, { with: v < 0 ? [w0 ?? others[0]] : [w0 ?? others[0], v] })}
          />
        </div>
      )}
      {/* threshold : its line, gate / cut at its end */}
      <FloatBar
        label="threshold"
        title={
          (t > 0
            ? `Line at ${t.toFixed(2)} : under it, nothing moves.`
            : 'Off. Drag right : only what passes the line moves the parameter (room noise, a quiet passage do nothing).') +
          ' Drag (Shift : finer), double-click : off, click the number to type'
        }
        value={t}
        min={0}
        max={0.95}
        def={0}
        frac={2}
        format={(v) => (v > 0 ? String(parseFloat(v.toFixed(2))) : 'off')}
        onChange={(v) => setShape(id, { threshold: v > 0 ? v : undefined })}
        chip={
          <BarCell
            tone={t <= 0 ? 'dim' : s.thresholdMode === 'gate' ? 'on' : 'off'}
            onClick={() => setShape(id, { thresholdMode: s.thresholdMode === 'gate' ? undefined : 'gate' })}
            title={
              s.thresholdMode === 'gate'
                ? 'Gate : fully on above the line, off under it. Click : cut'
                : 'Cut : the part above the line, opened back to the whole range. Click : gate (on or off)'
            }
          >
            {s.thresholdMode === 'gate' ? 'gate' : 'cut'}
          </BarCell>
        }
      />
      {/* integrate : three choices, segments */}
      <SegBar
        label="integrate"
        title="The value pushes a position that stays where it got to. Off : the value as it is (it falls back to the base when the modulator does). Flow : the value drives the position, louder = faster, nothing = it holds where it got to. Step : each hit pushes the position one notch (the kick turning a rotation or a hue per beat)"
        options={INTEGRATE.map((m, i) => ({ value: i, label: m }))}
        value={INTEGRATE.indexOf(integ)}
        onChange={(i) => setShape(id, { integrate: i === 0 ? undefined : INTEGRATE[i] })}
      />
      {integ !== 'off' && (
        <FloatBar
          label={flow ? 'rate' : 'notch'}
          title={
            (flow
              ? `${amount.toFixed(2)} turns a second at full value (a turn = the whole swing).`
              : `One notch = ${amount.toFixed(2)} of a turn (${Math.round(amount * 360)}° on an angle).`) +
            ` Drag (Shift : finer), double-click : ${flow ? '0.25' : '0.125'}, click the number to type`
          }
          value={amount}
          min={0.01}
          max={flow ? 4 : 0.5}
          def={flow ? 0.25 : 0.125}
          frac={flow ? 2 : 3}
          onChange={(v) => setShape(id, flow ? { rate: v } : { step: v })}
          chip={
            <>
              <BarCell
                tone={s.ends === 'wrap' ? 'on' : 'off'}
                onClick={() => setShape(id, { ends: s.ends === 'wrap' ? undefined : 'wrap' })}
                title={
                  s.ends === 'wrap'
                    ? 'Wrap : past the end it comes round again (an angle, a hue). Click : bounce'
                    : 'Bounce : at an end it comes back (anything that is not round). Click : wrap'
                }
              >
                {s.ends === 'wrap' ? 'wrap' : 'bounce'}
              </BarCell>
              <BarCell onClick={() => resetIntegrator(id)} title="Back to the middle : the parameter at its base">
                ⟲
              </BarCell>
            </>
          }
        />
      )}
    </div>
  )
}

/** The binding bar's end cell : lit while its binding is shaped. */
export function ShapeToggle({ id, open, onToggle }: { id: string; open: boolean; onToggle: () => void }): JSX.Element {
  const active = useStore((s) => shapeActive(s.composition.modMatrix.find((x) => x.id === id)?.shape))
  return (
    <BarCell
      onClick={onToggle}
      tone={active ? 'on' : open ? 'open' : 'off'}
      className="text-[10px]"
      title={active ? 'Shaped (combine, threshold or integrate) : click to see it' : 'Shape : combine with other modulators, a threshold, integrate'}
    >
      ⌇
    </BarCell>
  )
}
