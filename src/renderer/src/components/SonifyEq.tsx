// Sonify's output EQ, on the Mixer view : a miniature under the FX tail (its
// curve, its meters, on / off) that opens into a large editor. Twelve bands :
// low cut, low shelf, eight bells, high shelf, high cut (the maths is
// audio/eqMath.ts, the sound the worklet's 'soni-eq'). It sits after everything
// in Sonify, on the way to the speakers only : it tunes the room.
//
// In the editor : drag a point (frequency across, gain up and down), the wheel
// over it sets its Q, a double-click turns it on or off, a double-click on the
// empty curve puts the nearest free bell there, Delete turns the selected band
// off. Behind the curve, the sound's spectrum before the EQ (a line) and after
// it (filled).

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { sonifyEngine } from '../audio/sonify'
import {
  EQ_FREQ_MAX, EQ_FREQ_MIN, EQ_GAIN_MAX, EQ_IO_MAX, EQ_KINDS, EQ_Q_MAX, EQ_Q_MIN, EQ_SLOPES, GLUE_VOICES,
  bandDb, defaultEq, eqSections, normalizeEq, sectionsDb, type EqSlope, type GlueVoice, type SoniEq, type SoniEqBand, type SoniGlue
} from '../audio/eqMath'
import { GrMeter, RangeRow, Row, Seg, Shell, parseHz, sonifyCovered, themeVar } from './sonifyUi'
import { eqPresets } from '../audio/eqPresets'
import { ConfirmModal, PromptModal } from './PromptModal'

const LABEL = ['LC', 'LS', '1', '2', '3', '4', '5', '6', '7', '8', 'HS', 'HC']
const NAME = ['Low cut', 'Low shelf', 'Bell 1', 'Bell 2', 'Bell 3', 'Bell 4', 'Bell 5', 'Bell 6', 'Bell 7', 'Bell 8', 'High shelf', 'High cut']
const hue = (i: number): number => Math.round((i / 12) * 330 + 200) % 360
const bandColor = (i: number, a = 1): string => `hsla(${hue(i)}, 80%, 62%, ${a})`
const SR = 48000 // the curve's sample rate (the response is drawn, not run)
const LOG_SPAN = Math.log(EQ_FREQ_MAX / EQ_FREQ_MIN)
const fx = (f: number, w: number): number => (Math.log(f / EQ_FREQ_MIN) / LOG_SPAN) * w
const xf = (x: number, w: number): number => EQ_FREQ_MIN * Math.exp((x / w) * LOG_SPAN)
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
const fmtHz = (f: number): string => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 1 : 2)}k` : `${Math.round(f)}`)
const isCut = (i: number): boolean => EQ_KINDS[i] === 'lowcut' || EQ_KINDS[i] === 'highcut'

/** The EQ in the store, normalized (once per change : a new object every render
 *  redrew the card on every one), and a writer that keeps the rest of Sonify. */
function useEq(): [SoniEq, (next: SoniEq) => void] {
  const raw = useStore((s) => s.sonify.eq)
  const eq = useMemo(() => normalizeEq(raw), [raw])
  const set = useCallback((next: SoniEq): void => {
    const st = useStore.getState()
    st.setSonify({ ...st.sonify, eq: next })
  }, [])
  return [eq, set]
}

// ── Drawing ──────────────────────────────────────────────────────────────────

interface DrawOpts {
  selected: number
  compact: boolean
  pre?: Float32Array | null
  post?: Float32Array | null
  bins?: number
  sr?: number
}

function yOf(db: number, h: number, range: number): number {
  return h / 2 - (db / range) * (h / 2 - 6)
}

function drawSpectrum(g: CanvasRenderingContext2D, w: number, h: number, data: Float32Array, bins: number, sr: number, fill: string | null, stroke: string): void {
  // one value per column : the loudest bin the column covers, -96..0 dBFS
  g.beginPath()
  for (let x = 0; x <= w; x += 2) {
    const f0 = xf(x, w), f1 = xf(x + 2, w)
    const b0 = Math.max(1, Math.floor((f0 / (sr / 2)) * bins)), b1 = Math.min(bins - 1, Math.max(b0, Math.ceil((f1 / (sr / 2)) * bins)))
    let m = -160
    for (let b = b0; b <= b1; b++) if (data[b] > m) m = data[b]
    const y = h - clamp((m + 96) / 96, 0, 1) * h
    if (x === 0) g.moveTo(x, y)
    else g.lineTo(x, y)
  }
  if (fill) {
    g.lineTo(w, h); g.lineTo(0, h); g.closePath()
    g.fillStyle = fill
    g.fill()
  } else {
    g.strokeStyle = stroke
    g.lineWidth = 1
    g.stroke()
  }
}

/** The curves as drawn, one y per column (each band on its own, and the whole
 *  EQ), worked out once per EQ and size. Per frame, every column rebuilt every
 *  band's filters : up to 9 ms a frame with steep bands, on the thread that
 *  drives the picture. */
interface Curves { eq: SoniEq; w: number; h: number; step: number; bands: Array<Float32Array | null>; total: Float32Array }
const curveCache = new WeakMap<HTMLCanvasElement, Curves>()
function curvesFor(cv: HTMLCanvasElement, eq: SoniEq, w: number, h: number, step: number): Curves {
  const c = curveCache.get(cv)
  if (c && c.eq === eq && c.w === w && c.h === h && c.step === step) return c
  const range = EQ_GAIN_MAX, n = Math.floor(w / step) + 1
  const sum = new Float64Array(n)
  const bands = eq.bands.map((b, i) => {
    if (!b.on) return null
    const secs = eqSections(EQ_KINDS[i], b, SR)
    const ys = new Float32Array(n)
    for (let j = 0; j < n; j++) {
      const db = sectionsDb(secs, xf(j * step, w), SR)
      sum[j] += db
      ys[j] = yOf(clamp(db, -range - 6, range + 6), h, range)
    }
    return ys
  })
  const total = new Float32Array(n)
  for (let j = 0; j < n; j++) total[j] = yOf(clamp(sum[j], -range - 6, range + 6), h, range)
  const out = { eq, w, h, step, bands, total }
  curveCache.set(cv, out)
  return out
}

/** Device pixels per CSS pixel of the canvas as shown : the screen's ratio times
 *  the UI zoom (a CSS zoom : sized from clientWidth alone, it was blurry). */
function canvasScale(cv: HTMLCanvasElement): number {
  const dpr = window.devicePixelRatio || 1
  return cv.clientWidth > 0 ? (cv.getBoundingClientRect().width * dpr) / cv.clientWidth : dpr
}

function drawEq(cv: HTMLCanvasElement, eq: SoniEq, o: DrawOpts, u = canvasScale(cv)): void {
  const dpr = u
  const w = Math.max(1, Math.round(cv.clientWidth * u)), h = Math.max(1, Math.round(cv.clientHeight * u))
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
  const g = cv.getContext('2d')
  if (!g) return
  const range = EQ_GAIN_MAX
  const accent = themeVar('--c-accent', '255 140 60')
  const text = themeVar('--c-text', '230 230 230')
  g.fillStyle = 'rgb(14, 15, 18)'
  g.fillRect(0, 0, w, h)
  // grid : decades and the octave marks, the dB lines
  g.lineWidth = 1
  for (const f of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
    const x = Math.round(fx(f, w)) + 0.5
    g.strokeStyle = [100, 1000, 10000].includes(f) ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)'
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke()
    if (!o.compact && f > 20 && f < 20000) {
      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.font = `${10 * dpr}px ui-monospace, monospace`
      g.fillText(fmtHz(f), x + 3 * dpr, h - 4 * dpr)
    }
  }
  for (const db of [-18, -12, -6, 0, 6, 12, 18]) {
    const y = Math.round(yOf(db, h, range)) + 0.5
    g.strokeStyle = db === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.05)'
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke()
    if (!o.compact && db !== 0) {
      g.fillStyle = 'rgba(255,255,255,0.3)'
      g.font = `${9 * dpr}px ui-monospace, monospace`
      g.fillText(`${db > 0 ? '+' : ''}${db}`, 4 * dpr, y - 3 * dpr)
    }
  }
  // the sound, before (a line) and after (filled)
  if (o.post && o.bins && o.sr) drawSpectrum(g, w, h, o.post, o.bins, o.sr, `rgb(${accent} / 0.16)`, '')
  if (o.pre && o.bins && o.sr) drawSpectrum(g, w, h, o.pre, o.bins, o.sr, null, 'rgba(255,255,255,0.22)')
  // each band on its own, faint; the selected one filled
  const step = o.compact ? 3 : 2
  const cur = curvesFor(cv, eq, w, h, step)
  eq.bands.forEach((b, i) => {
    const ys = cur.bands[i]
    if (!b.on || !ys) return
    g.beginPath()
    for (let j = 0; j < ys.length; j++) {
      if (j === 0) g.moveTo(0, ys[0])
      else g.lineTo(j * step, ys[j])
    }
    if (i === o.selected && !o.compact) {
      const y0 = yOf(0, h, range)
      g.lineTo(w, y0); g.lineTo(0, y0); g.closePath()
      g.fillStyle = bandColor(i, 0.18)
      g.fill()
    } else {
      g.strokeStyle = bandColor(i, eq.on ? 0.45 : 0.2)
      g.lineWidth = 1 * dpr
      g.stroke()
    }
  })
  // the whole EQ
  g.beginPath()
  for (let j = 0; j < cur.total.length; j++) {
    if (j === 0) g.moveTo(0, cur.total[0])
    else g.lineTo(j * step, cur.total[j])
  }
  g.strokeStyle = eq.on ? `rgb(${text})` : 'rgba(255,255,255,0.35)'
  g.lineWidth = (o.compact ? 1.5 : 2) * dpr
  g.stroke()
  // the points
  eq.bands.forEach((b, i) => {
    const { x, y } = handleXY(eq, i, w, h)
    const r = (o.compact ? 3 : 7) * dpr
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    if (b.on) { g.fillStyle = bandColor(i, eq.on ? 1 : 0.5); g.fill() } else { g.strokeStyle = bandColor(i, 0.4); g.lineWidth = 1 * dpr; g.stroke() }
    if (i === o.selected && !o.compact) {
      g.beginPath(); g.arc(x, y, r + 3 * dpr, 0, Math.PI * 2); g.strokeStyle = `rgb(${text})`; g.lineWidth = 1.5 * dpr; g.stroke()
    }
    if (!o.compact) {
      g.fillStyle = b.on ? 'rgb(10,10,12)' : bandColor(i, 0.6)
      g.font = `bold ${8 * dpr}px ui-monospace, monospace`
      const t = LABEL[i]
      g.fillText(t, x - g.measureText(t).width / 2, y + 3 * dpr)
    }
  })
}

/** Where a band's point sits : its frequency across; its gain up and down (a
 *  cut : where its own curve passes its corner). */
function handleXY(eq: SoniEq, i: number, w: number, h: number): { x: number; y: number } {
  const b = eq.bands[i]
  const x = fx(b.freq, w)
  const db = isCut(i) ? bandDb(i, { ...b, on: true }, b.freq, SR) : b.gain
  return { x, y: yOf(clamp(db, -EQ_GAIN_MAX, EQ_GAIN_MAX), h, EQ_GAIN_MAX) }
}

// ── Meters ───────────────────────────────────────────────────────────────────

const M_FLOOR = -54
const mx = (db: number): number => clamp((db - M_FLOOR) / -M_FLOOR, 0, 1)
const toDb = (x: number): number => (x > 1e-6 ? 20 * Math.log10(x) : -120)

/** A stereo meter in the Sonify top bar's look : the bar the RMS, the tick the
 *  held peak; orange while the EQ's ceiling holds the output. */
function EqMeter({ which, label }: { which: 'in' | 'out'; label: string }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const dbRef = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    const st = { at: performance.now(), rms: [-120, -120], pk: [-120, -120], held: [0, 0] }
    let raf = 0
    const el = ref.current
    const bars = [0, 1].map((c) => el?.querySelector<HTMLElement>(`[data-m="b${c}"]`) ?? null)
    const ticks = [0, 1].map((c) => el?.querySelector<HTMLElement>(`[data-m="t${c}"]`) ?? null)
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.25, (now - st.at) / 1000)
      st.at = now
      if (sonifyCovered()) return
      const run = sonifyEngine.isRunning()
      const m = which === 'in' ? sonifyEngine.eqMeterIn : sonifyEngine.eqMeterOut
      const chans = [m.l, m.r]
      const ceil = which === 'out' && run && sonifyEngine.eqCeiling
      let read = -120
      for (let c = 0; c < 2; c++) {
        const rms = run ? toDb(chans[c].rms) : -120, pk = run ? toDb(chans[c].peak) : -120
        st.rms[c] = rms >= st.rms[c] ? rms : Math.max(rms, st.rms[c] - 24 * dt)
        if (pk >= st.pk[c]) { st.pk[c] = pk; st.held[c] = 1.2 } else if ((st.held[c] -= dt) <= 0) st.pk[c] = Math.max(pk, st.pk[c] - 24 * dt)
        read = Math.max(read, st.pk[c])
        const bar = bars[c], tk = ticks[c]
        if (bar) {
          bar.style.width = `${(mx(st.rms[c]) * 100).toFixed(1)}%`
          bar.style.background = ceil ? 'rgb(230,120,60)' : st.rms[c] > -9 ? 'rgb(214,196,90)' : 'rgb(120,200,140)'
        }
        if (tk) {
          tk.style.left = `calc(${(mx(st.pk[c]) * 100).toFixed(1)}% - 1px)`
          tk.style.opacity = st.pk[c] > M_FLOOR ? '1' : '0'
          tk.style.background = st.pk[c] > -1.5 ? 'rgb(230,120,60)' : 'rgb(230,230,230)'
        }
      }
      const txt = read > M_FLOOR ? read.toFixed(0) : '-∞'
      if (dbRef.current && dbRef.current.textContent !== txt) dbRef.current.textContent = txt
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [which])
  return (
    <div className="flex min-w-0 items-center gap-1" title={which === 'in' ? 'Into the bands, after the input gain : the bar is the RMS level, the tick the peak (-54 to 0 dB)' : 'Out to the speakers, after the output gain and the ceiling : orange while the ceiling holds the peak under 0 dB'}>
      <span className="w-6 shrink-0 font-mono text-[9px] uppercase text-muted">{label}</span>
      <div ref={ref} className="relative flex h-[9px] min-w-[60px] flex-1 flex-col justify-between overflow-hidden rounded-sm bg-panel3">
        {[0, 1].map((c) => (
          <div key={c} className="relative h-[4px] w-full">
            <div data-m={`b${c}`} className="absolute inset-y-0 left-0 w-0" />
            <div data-m={`t${c}`} className="absolute inset-y-0 w-[2px] opacity-0" />
          </div>
        ))}
        {[-36, -18, -6].map((db) => (
          <div key={db} className="pointer-events-none absolute inset-y-0 w-px bg-black/50" style={{ left: `${(mx(db) * 100).toFixed(1)}%` }} />
        ))}
      </div>
      <span ref={dbRef} className="w-6 shrink-0 text-right font-mono text-[9px] tabular-nums text-muted">-∞</span>
    </div>
  )
}

/** Input or output gain, in dB, with its meter. */
function GainRow({ which, value, onChange }: { which: 'in' | 'out'; value: number; onChange: (v: number) => void }): JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-10 shrink-0 font-mono text-[9px] uppercase text-muted">{which === 'in' ? 'input' : 'output'}</span>
      <input
        type="range" min={-EQ_IO_MAX} max={EQ_IO_MAX} step={0.1} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(0)}
        className="w-28 shrink-0 accent-accent"
        title={`${which === 'in' ? 'Input' : 'Output'} gain ${value.toFixed(1)} dB (double-click : 0)`}
      />
      <span className="w-12 shrink-0 text-right font-mono text-[10px] tabular-nums">{value > 0 ? '+' : ''}{value.toFixed(1)} dB</span>
      <EqMeter which={which} label="" />
    </div>
  )
}

// ── Saved EQs (the card's and the editor's menu) ─────────────────────────────

// A name being typed for a preset : the editor's keys (Esc closes it) wait.
let eqPromptOpen = false

/** A little menu : flat, the saved EQs (recall keeps the bypass switch and the
 *  glue), save the current one under a name, delete the one in use. */
function EqPresetMenu({ eq, setEq, className = '' }: { eq: SoniEq; setEq: (next: SoniEq) => void; className?: string }): JSX.Element {
  const [, bump] = useState(0)
  useEffect(() => eqPresets.subscribe(() => bump((n) => n + 1)), [])
  const [ask, setAsk] = useState<null | { kind: 'save' } | { kind: 'replace'; name: string } | { kind: 'delete'; name: string }>(null)
  useEffect(() => { eqPromptOpen = !!ask; return () => { eqPromptOpen = false } }, [ask])
  const list = eqPresets.list()
  const cur = eqPresets.matching(eq)
  const save = (name: string): void => {
    if (eqPresets.get(name) && name !== cur) { setAsk({ kind: 'replace', name }); return }
    eqPresets.save(name, eq)
    setAsk(null)
  }
  return (
    <>
      <select
        className={`input select-compact text-[10px] ${cur ? 'text-accent' : ''} ${className}`}
        value={cur ?? ''}
        onChange={(e) => {
          const v = e.target.value
          if (v === '__flat') setEq({ ...defaultEq(), on: eq.on, glue: eq.glue })
          else if (v === '__save') setAsk({ kind: 'save' })
          else if (v === '__delete' && cur) setAsk({ kind: 'delete', name: cur })
          else { const p = eqPresets.get(v); if (p) setEq(eqPresets.applied(eq, p)) }
        }}
        title={cur
          ? `The EQ is set to "${cur}". Recall another saved EQ, save this one under a name, or delete "${cur}". A recall brings its glue too and keeps the bypass switch. Saved on this computer.`
          : 'Saved EQs : recall one (its bands, its input and output gains and its glue; the bypass switch stays), or save this one under a name. Flat leaves the glue as it is. Saved on this computer.'}
      >
        <option value="">{list.length ? 'presets' : 'no presets'}</option>
        <option value="__flat">flat</option>
        {list.map((p) => (
          <option key={p.name} value={p.name}>{p.name}</option>
        ))}
        <option value="__save">＋ save as…</option>
        {cur && <option value="__delete">{`✕ delete "${cur}"`}</option>}
      </select>
      {ask?.kind === 'save' && (
        <PromptModal
          title="Save this EQ as"
          placeholder="e.g. Studio, the SAT, headphones"
          confirmLabel="Save"
          initial={cur ?? ''}
          onConfirm={save}
          onCancel={() => setAsk(null)}
        />
      )}
      {ask?.kind === 'replace' && (
        <ConfirmModal
          title={`Replace the saved EQ "${ask.name}" with this one?`}
          onYes={() => { eqPresets.save(ask.name, eq); setAsk(null) }}
          onNo={() => setAsk(null)}
        />
      )}
      {ask?.kind === 'delete' && (
        <ConfirmModal
          title={`Delete the saved EQ "${ask.name}"? (The EQ itself stays as it is.)`}
          onYes={() => { eqPresets.remove(ask.name); setAsk(null) }}
          onNo={() => setAsk(null)}
        />
      )}
    </>
  )
}

// ── The miniature (Mixer view) ───────────────────────────────────────────────

// (memo : the page re-renders on every Sonify change, the card only on the EQ's)
export const EqCard = memo(function EqCard(): JSX.Element {
  const [eq, setEq] = useEq()
  const [open, setOpen] = useState(false)
  const cvRef = useRef<HTMLCanvasElement | null>(null)
  const eqRef = useRef(eq)
  eqRef.current = eq
  // observed once (a new observer per change painted twice each time)
  useEffect(() => {
    const cv = cvRef.current
    if (!cv) return
    const ro = new ResizeObserver(() => drawEq(cv, eqRef.current, { selected: -1, compact: true }))
    ro.observe(cv)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (cvRef.current) drawEq(cvRef.current, eq, { selected: -1, compact: true })
  }, [eq])
  const active = eq.bands.filter((b) => b.on).length
  return (
    <>
      <Shell
        title="Output EQ"
        hint="Twelve bands after everything (Sonify and the Audio Layer), on the way to the speakers only (recordings are taken before it) : to tune the room. Low cut, low shelf, eight bells, high shelf, high cut, each with its Q and a slope of 6, 12, 24 or 36 dB per octave. Click the curve to open the editor."
        on={eq.on}
        onToggle={() => setEq({ ...eq, on: !eq.on })}
        toggleTitle={eq.on ? 'EQ on (click : bypass)' : 'EQ bypassed (click : on)'}
        open
        right={
          <span className="flex items-center gap-1.5">
            <EqPresetMenu eq={eq} setEq={setEq} className="w-[7.5rem]" />
            <button
              onClick={() => setOpen(true)}
              className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted transition-colors hover:border-accent/60 hover:text-accent"
              title="Open the EQ editor : the whole curve, every point, the spectrum"
            >
              ⤢ edit
            </button>
          </span>
        }
      >
        <canvas
          ref={cvRef}
          onClick={() => setOpen(true)}
          className="h-[64px] w-full cursor-pointer rounded-sm"
          title={`${active} band${active === 1 ? '' : 's'} on : click to edit`}
        />
        <EqMeter which="in" label="in" />
        <EqMeter which="out" label="out" />
      </Shell>
      {open && <EqEditor onClose={() => setOpen(false)} />}
    </>
  )
})

// ── The glue (Mixer view, under the EQ) ──────────────────────────────────────

const GLUE_HINT: Record<GlueVoice, string> = {
  clean: 'clean : 3 ms attack, 300 ms release, a 5 dB knee, no color',
  warm: 'warm : 3 ms / 400 ms, a 6 dB knee, and a saturation that grows as it compresses',
  punch: 'punch : 3 ms / 200 ms, the detector tilted toward the highs (the bass stops pumping the mix), a touch of odd-sided drive',
  bite: 'bite : 1 ms / 200 ms, a hard 2 dB knee, a little drive : fast and forward',
  slow: 'slow : 30 ms / 600 ms, a wide 10 dB knee : the transients through, the body held'
}
const glueGr = (): number => sonifyEngine.glueGr

export const GlueCard = memo(function GlueCard(): JSX.Element {
  const [eq, setEq] = useEq()
  const g = eq.glue
  const setGlue = (p: Partial<SoniGlue>): void => setEq({ ...eq, glue: { ...g, ...p } })
  return (
    <Shell
      title="Glue"
      hint="One compressor on everything that leaves (Sonify and the Audio Layer), after the output EQ's bands and before its output gain and the soft ceiling : it holds the voices together. It runs with the EQ bypassed too. One knob (the threshold falls to -12 dB, the ratio rises to 4:1, the makeup is automatic); the voicing sets its speed and color. Like the EQ it is on the way to the speakers : recordings are taken before it."
      on={g.on}
      onToggle={() => setGlue({ on: !g.on })}
      toggleTitle={g.on ? 'Glue on (click : off)' : 'Glue off (click : on)'}
      open
    >
      <RangeRow
        label="amount" value={g.amount} min={0} max={1} step={0.01} neutral={0.4}
        shown={`${Math.round(g.amount * 100)}%`}
        onChange={(v) => setGlue({ amount: v })}
        title={`How hard it glues : the threshold at ${(-12 * g.amount).toFixed(1)} dB, the ratio ${(1.5 + g.amount * 2.5).toFixed(1)}:1 (double-click : 40 %)`}
      />
      <Row label="voicing" hint="Its speed and color">
        <Seg options={GLUE_VOICES} value={g.voice} onChange={(v) => setGlue({ voice: v })} title={(v) => GLUE_HINT[v]} />
      </Row>
      <Row label="reduction" hint="How much it is taking off now">
        <GrMeter get={glueGr} wide title="The glue's gain reduction now (0 to 12 dB)" />
      </Row>
    </Shell>
  )
})

// ── The editor (pop-out) ─────────────────────────────────────────────────────

function EqEditor({ onClose }: { onClose: () => void }): JSX.Element {
  const [eq, setEq] = useEq()
  const [sel, setSel] = useState(2)
  const cvRef = useRef<HTMLCanvasElement | null>(null)
  const eqRef = useRef(eq)
  eqRef.current = eq
  const selRef = useRef(sel)
  selRef.current = sel
  // A drag : the band, the pointer, where it was pressed, the offset from the
  // point's centre (a grab a few pixels off jumped it), and whether it has left
  // the dead zone yet (a plain click moved the band, or switched it on).
  const drag = useRef<{ i: number; id: number; x0: number; y0: number; ox: number; oy: number; moved: boolean } | null>(null)
  // The editor sits over the whole app (a portal) : hidden while another page
  // covers Sonify.
  const covered = useStore((s) => s.worldPageOpen || s.sequencePageOpen || s.bodyPageOpen || s.resolumePageOpen || s.sourceEditorOpen)

  const setBand = (i: number, patch: Partial<SoniEqBand>): void => {
    const cur = eqRef.current
    setEq({ ...cur, bands: cur.bands.map((b, k) => (k === i ? { ...b, ...patch } : b)) })
  }

  // the curve and the spectrum, every frame while open
  useEffect(() => {
    let raf = 0
    const pre = new Float32Array(8192), post = new Float32Array(8192)
    // its scale is read when its box changes, not every frame (a layout read
    // after the meters' writes)
    let u = 0
    const ro = new ResizeObserver(() => { if (cvRef.current) u = canvasScale(cvRef.current) })
    if (cvRef.current) ro.observe(cvRef.current)
    const tick = (): void => {
      raf = requestAnimationFrame(tick)
      const cv = cvRef.current
      if (!cv || sonifyCovered()) return
      if (!u) u = canvasScale(cv)
      const a = sonifyEngine.eqSpectrum(false, pre), b = sonifyEngine.eqSpectrum(true, post)
      drawEq(cv, eqRef.current, { selected: selRef.current, compact: false, pre: a ? pre : null, post: b ? post : null, bins: a?.bins ?? b?.bins, sr: a?.sampleRate ?? b?.sampleRate }, u)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  // Esc closes; Delete turns the selected band off; every other plain key stays
  // here (the app's one-key shortcuts fired under the editor : S closed Sonify,
  // M unmounted the editor, 1 to 9 recalled scenes, 0 flushed)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (sonifyCovered() || eqPromptOpen) return
      const t = e.target as HTMLElement | null
      const field = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return }
      if (field || e.ctrlKey || e.metaKey || e.altKey) return
      e.stopPropagation()
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        setBand(selRef.current, { on: false })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // The pointer in the canvas's own pixels, through its box on screen : the UI
  // zoom is a CSS zoom, under which clientWidth (what the canvas is sized from)
  // and the pointer's coordinates disagree, so scaling by the device pixel ratio
  // put every grab beside its point (only the wheel, which falls back to the
  // selected band, kept working).
  const local = (e: { clientX: number; clientY: number }): { x: number; y: number; w: number; h: number } => {
    const cv = cvRef.current!
    const r = cv.getBoundingClientRect()
    const kx = cv.width / Math.max(1, r.width), ky = cv.height / Math.max(1, r.height)
    return { x: (e.clientX - r.left) * kx, y: (e.clientY - r.top) * ky, w: cv.width, h: cv.height }
  }
  const hit = (x: number, y: number, w: number, h: number, radius = 12): number => {
    const cv = cvRef.current
    let best = -1, bd = radius * (cv ? cv.width / Math.max(1, cv.clientWidth) : 1)
    eqRef.current.bands.forEach((_, i) => {
      const p = handleXY(eqRef.current, i, w, h)
      const d = Math.hypot(p.x - x, p.y - y)
      if (d < bd) { bd = d; best = i }
    })
    return best
  }
  const moveTo = (i: number, x: number, y: number, w: number, h: number): void => {
    const freq = clamp(xf(clamp(x, 0, w), w), EQ_FREQ_MIN, EQ_FREQ_MAX)
    const gain = clamp(((h / 2 - y) / (h / 2 - 6)) * EQ_GAIN_MAX, -EQ_GAIN_MAX, EQ_GAIN_MAX)
    setBand(i, isCut(i) ? { on: true, freq } : { on: true, freq, gain: Math.round(gain * 10) / 10 })
  }

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return
    const p = local(e)
    const i = hit(p.x, p.y, p.w, p.h)
    if (i < 0) return
    setSel(i)
    const c = handleXY(eqRef.current, i, p.w, p.h)
    drag.current = { i, id: e.pointerId, x0: p.x, y0: p.y, ox: c.x - p.x, oy: c.y - p.y, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    if (!(e.buttons & 1)) { drag.current = null; return } // released elsewhere
    const p = local(e)
    if (!d.moved) {
      const cv = cvRef.current
      const k = cv ? cv.width / Math.max(1, cv.clientWidth) : 1
      if (Math.hypot(p.x - d.x0, p.y - d.y0) < 3 * k) return
      d.moved = true
    }
    moveTo(d.i, p.x + d.ox, p.y + d.oy, p.w, p.h)
  }
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (drag.current?.id === e.pointerId) drag.current = null
  }
  const onDouble = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const p = local(e)
    const i = hit(p.x, p.y, p.w, p.h)
    if (i >= 0) { setBand(i, { on: !eqRef.current.bands[i].on }); setSel(i); return }
    // on the empty curve : the free bell nearest in frequency comes here
    const f = xf(p.x, p.w)
    let best = -1, bd = Infinity
    eqRef.current.bands.forEach((b, k) => {
      if (EQ_KINDS[k] !== 'bell' || b.on) return
      const d = Math.abs(Math.log(b.freq / f))
      if (d < bd) { bd = d; best = k }
    })
    if (best >= 0) { setSel(best); moveTo(best, p.x, p.y, p.w, p.h) }
  }
  // The wheel over a point sets its Q (elsewhere the editor scrolls, and with
  // Ctrl the UI zooms). A native listener : React's is passive, and the editor
  // scrolled while Q changed.
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {})
  wheelRef.current = (e: WheelEvent): void => {
    if (e.ctrlKey) return
    const p = local(e)
    const i = hit(p.x, p.y, p.w, p.h, 24)
    const b = i >= 0 ? eqRef.current.bands[i] : null
    if (!b) return
    e.preventDefault()
    setSel(i)
    setBand(i, { q: Math.round(clamp(b.q * Math.exp(-e.deltaY * 0.0015), EQ_Q_MIN, EQ_Q_MAX) * 100) / 100 })
  }
  useEffect(() => {
    const cv = cvRef.current
    if (!cv) return
    const on = (e: WheelEvent): void => wheelRef.current(e)
    cv.addEventListener('wheel', on, { passive: false })
    return () => cv.removeEventListener('wheel', on)
  }, [])
  // The backdrop closes it only when the press began there too (a selection
  // dragged out of a number box closed it).
  const downOnBackdrop = useRef(false)

  const b = eq.bands[sel]
  // A portal : inside the voice column it took the column's dimming (65 % while
  // the sound is off) and the page showed through.
  return createPortal(
    <div
      data-soni-modal
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 ${covered ? 'hidden' : ''}`}
      onPointerDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget }}
      onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) onClose() }}
    >
      <div className="flex max-h-full w-full max-w-[1100px] flex-col gap-2 overflow-y-auto rounded border border-border bg-panel p-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setEq({ ...eq, on: !eq.on })}
            className={`rounded px-2 py-0.5 font-mono text-[11px] ring-1 ${eq.on ? 'bg-accent/20 text-accent ring-accent' : 'text-muted ring-border'}`}
            title={eq.on ? 'EQ on (click : bypass, the gains too)' : 'EQ bypassed (click : on)'}
          >
            {eq.on ? '● on' : '○ bypass'}
          </button>
          <span className="text-[13px] font-semibold">Output EQ</span>
          <span className="font-mono text-[10px] text-muted">after everything (Sonify and the Audio Layer) · to the speakers only · drag a point · wheel over a point : Q · double-click : on / off or a new bell · Delete : off</span>
          <span className="flex-1" />
          <EqPresetMenu eq={eq} setEq={setEq} className="w-[9rem]" />
          <button
            onClick={() => setEq({ ...defaultEq(), on: eq.on, glue: eq.glue })}
            className="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-muted hover:text-accent"
            title="Every band back to off and flat, both gains to 0 dB"
          >
            flat
          </button>
          <button onClick={onClose} className="rounded border border-border px-2 py-0.5 font-mono text-[11px] text-muted hover:text-text" title="Close (Esc)">✕</button>
        </div>
        <canvas
          ref={cvRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onLostPointerCapture={onUp}
          onDoubleClick={onDouble}
          className="h-[340px] w-full cursor-crosshair touch-none rounded"
        />
        <div className="grid grid-cols-6 gap-1 lg:grid-cols-12">
          {eq.bands.map((bb, i) => (
            <button
              key={i}
              onClick={() => setSel(i)}
              onDoubleClick={() => setBand(i, { on: !bb.on })}
              className={`flex flex-col items-center rounded border px-1 py-0.5 font-mono text-[10px] ${i === sel ? 'border-text/60 bg-panel3' : 'border-border'}`}
              title={`${NAME[i]} : ${bb.on ? 'on' : 'off'} (double-click : toggle)`}
            >
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: bb.on ? bandColor(i) : 'transparent', border: `1px solid ${bandColor(i)}` }} />
                {LABEL[i]}
              </span>
              <span className={bb.on ? 'text-text' : 'text-muted'}>{fmtHz(bb.freq)}</span>
            </button>
          ))}
        </div>
        {b && (
          <div className="flex flex-wrap items-center gap-3 rounded border border-border px-2 py-1.5">
            <button
              onClick={() => setBand(sel, { on: !b.on })}
              className={`rounded px-2 py-0.5 font-mono text-[11px] ring-1 ${b.on ? 'text-text' : 'text-muted ring-border'}`}
              style={b.on ? { boxShadow: `inset 0 0 0 1px ${bandColor(sel)}`, color: bandColor(sel) } : undefined}
            >
              {b.on ? '● on' : '○ off'}
            </button>
            <span className="w-20 text-[12px] font-semibold" style={{ color: bandColor(sel) }}>{NAME[sel]}</span>
            <NumField label="freq" unit="Hz" value={b.freq} min={EQ_FREQ_MIN} max={EQ_FREQ_MAX} step={1} parse={(t) => parseHz(t, NaN)} onChange={(v) => setBand(sel, { freq: v, on: true })} />
            {!isCut(sel) && <NumField label="gain" unit="dB" value={b.gain} min={-EQ_GAIN_MAX} max={EQ_GAIN_MAX} step={0.1} onChange={(v) => setBand(sel, { gain: v, on: true })} />}
            <NumField label="Q" unit="" value={b.q} min={EQ_Q_MIN} max={EQ_Q_MAX} step={0.01} onChange={(v) => setBand(sel, { q: v })} />
            <label className="flex items-center gap-1 font-mono text-[10px] text-muted">
              slope
              <select
                className="input select-compact text-[10px]"
                value={b.slope}
                onChange={(e) => setBand(sel, { slope: Number(e.target.value) as EqSlope })}
                title="How steep : 6 dB/oct (one first-order section; a gentle bell), 12 (one section), 24 (two), 36 (three). A steeper shelf or bell keeps its gain and steepens its skirt"
              >
                {EQ_SLOPES.map((s) => <option key={s} value={s}>{s} dB/oct</option>)}
              </select>
            </label>
          </div>
        )}
        <div className="flex flex-col gap-1 rounded border border-border px-2 py-1.5">
          <GainRow which="in" value={eq.inGain} onChange={(v) => setEq({ ...eqRef.current, inGain: v })} />
          <GainRow which="out" value={eq.outGain} onChange={(v) => setEq({ ...eqRef.current, outGain: v })} />
          <div className="font-mono text-[9px] text-muted">
            The output never passes 0 dB : above -1 dB a soft ceiling holds it (the meter turns orange). Recordings are taken before the EQ.
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

/** A number box with its label, committed on Enter or on leaving it (clamped).
 *  An empty or unreadable entry goes back to the value (Number('') is 0 : a
 *  cleared frequency jumped to 20 Hz), and the box always shows what was kept. */
function NumField({ label, unit, value, min, max, step, onChange, parse }: {
  label: string; unit: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void
  parse?: (t: string) => number | null
}): JSX.Element {
  const show = (v: number): string => (step >= 1 ? String(Math.round(v)) : String(+v.toFixed(2)))
  const [text, setText] = useState(show(value))
  useEffect(() => { setText(show(value)) }, [value, step]) // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (t: string): void => {
    const tt = t.trim()
    const n = tt === '' ? NaN : parse ? parse(tt) ?? NaN : Number(tt.replace(',', '.'))
    if (Number.isFinite(n)) {
      const v = clamp(n, min, max)
      if (v !== value) onChange(v)
      setText(show(v))
    } else setText(show(value))
  }
  return (
    <label className="flex items-center gap-1 font-mono text-[10px] text-muted">
      {label}
      <input
        className="input w-16 px-1 py-0.5 text-right text-[11px]"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value) }}
      />
      {unit}
    </label>
  )
}
