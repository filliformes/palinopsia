// Resolume OSC mapper page (K) : Palinopsia signals × Resolume addresses.
//
// A toggle matrix like the Max `matrixctrl` it replaces : rows are Palinopsia's
// signals, columns the Resolume OSC addresses a loaded composition offers. The
// grid is drawn on ONE canvas that only paints what is on screen, so a
// composition with hundreds of addresses stays light; column groups (Layer 4,
// Group 2, Columns…) fold shut, and a folded group still shows the columns that
// carry a connection so nothing wired ever hides.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import type { ResoKind, ResoOutput } from '@shared/resolume'
import { RESO_SNAPSHOTS } from '@shared/resolume'
import {
  onResoLearned,
  resoLive,
  resoSourceCatalogue,
  resoSourceLabel,
  resoTest,
  setResoLearning
} from '../resolume'
import { SearchSelect } from './SearchSelect'
import { showToast } from './Toast'

const CELL = 18
const LABEL_W = 210
const GROUP_H = 18
const HEAD_H = 128
const METER_H = 5
const TOP = GROUP_H + HEAD_H + METER_H

type Col = { kind: 'out'; o: ResoOutput; group: string } | { kind: 'stub'; group: string; count: number }
interface Span { group: string; c0: number; c1: number; folded: boolean; count: number }
type Sel = { t: 'in'; id: string } | { t: 'out'; id: string } | { t: 'cell'; i: string; o: string } | null

const KIND_GLYPH: Record<ResoKind, string> = { float: '', toggle: '◧ ', trigger: '⏵ ' }

function layout(outputs: ResoOutput[], folded: string[], wired: Set<string>): { cols: Col[]; spans: Span[] } {
  const order: string[] = []
  const byGroup = new Map<string, ResoOutput[]>()
  for (const o of outputs) {
    let a = byGroup.get(o.group)
    if (!a) { byGroup.set(o.group, (a = [])); order.push(o.group) }
    a.push(o)
  }
  const cols: Col[] = []
  const spans: Span[] = []
  for (const g of order) {
    const outs = byGroup.get(g)!
    const isFolded = folded.includes(g)
    const c0 = cols.length
    if (isFolded) {
      cols.push({ kind: 'stub', group: g, count: outs.length })
      for (const o of outs) if (wired.has(o.id)) cols.push({ kind: 'out', o, group: g })
    } else {
      for (const o of outs) cols.push({ kind: 'out', o, group: g })
    }
    spans.push({ group: g, c0, c1: cols.length, folded: isFolded, count: outs.length })
  }
  return { cols, spans }
}

function Btn({ on, label, onClick, title, danger }: { on?: boolean; label: string; onClick: () => void; title?: string; danger?: boolean }): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded px-2 py-0.5 font-mono text-[11px] transition-colors ${
        on
          ? danger
            ? 'border border-red-500/70 bg-red-500/15 text-red-300'
            : 'border border-accent bg-accent/15 text-accent'
          : 'border border-border bg-panel3/70 text-muted hover:bg-panel3 hover:text-text'
      }`}
    >
      {label}
    </button>
  )
}

function Slider({ label, value, min, max, step, onChange, fmt, title }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string; title?: string
}): JSX.Element {
  return (
    <label className="flex items-center gap-2 font-mono text-[10px] text-muted" title={title}>
      <span className="w-14 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1" />
      <span className="w-10 shrink-0 text-right text-text">{fmt ? fmt(value) : value.toFixed(2)}</span>
    </label>
  )
}

export function ResolumePage(): JSX.Element {
  const r = useStore((s) => s.resolume)
  const setOpen = useStore((s) => s.setResolumePageOpen)
  const setR = useStore((s) => s.setResolume)
  const oscEnabled = useStore((s) => s.oscEnabled)
  const oscPort = useStore((s) => s.oscPort)
  const st = useStore.getState

  const [sel, setSel] = useState<Sel>(null)
  const [learning, setLearning] = useState(false)
  const [lastLearned, setLastLearned] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [custom, setCustom] = useState({ address: '/composition/', kind: 'float' as ResoKind })
  // A slow re-render for the msg/s readout (the canvas has its own rAF).
  const [, setBeat] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setBeat((x) => x + 1), 500)
    return () => clearInterval(t)
  }, [])

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const hover = useRef<{ col: number; row: number } | null>(null)
  const paint = useRef<{ on: boolean; seen: Set<string> } | null>(null)
  const selRef = useRef<Sel>(null)
  selRef.current = sel

  const wired = useMemo(() => new Set(r.cells.map((c) => c.o)), [r.cells])
  const lay = useMemo(() => layout(r.outputs, r.folded, wired), [r.outputs, r.folded, wired])
  const layRef = useRef(lay)
  layRef.current = lay
  const cellMap = useMemo(() => new Map(r.cells.map((c) => [`${c.i}|${c.o}`, c.amount])), [r.cells])
  const cellRef = useRef(cellMap)
  cellRef.current = cellMap
  const rRef = useRef(r)
  rRef.current = r

  const sources = useMemo(
    () => resoSourceCatalogue().map((d) => ({ value: d.source, label: d.label, group: d.group })),
    // re-list when the rows change (names of mods/knobs may have too)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [r.inputs.length]
  )

  // Learn mode lives in the engine module; mirror it here and switch it off on close.
  useEffect(() => {
    setResoLearning(learning)
    return () => setResoLearning(false)
  }, [learning])
  useEffect(() => onResoLearned((a) => setLastLearned(a)), [])

  const openAvc = async (path?: string): Promise<void> => {
    const p = path ?? (await window.api.resolumePick())
    if (!p) return
    setLoading(true)
    try {
      const res = await window.api.resolumeParse(p)
      if (!res.ok) { showToast(`Could not read that composition : ${res.error}`, 'warn'); return }
      st().resoLoadSession(res.session)
      const s = res.session
      showToast(`${s.name} : ${s.layers.length} layers · ${s.groups.length} groups · ${s.columns} columns · ${s.clips.length} clips`)
    } finally {
      setLoading(false)
    }
  }

  // ── Canvas drawing (rAF while open : the meters are live) ─────────────
  useEffect(() => {
    let raf = 0
    const clip = new Map<string, string>()
    const fit = (g: CanvasRenderingContext2D, text: string, w: number): string => {
      const k = `${text}|${w}`
      const hit = clip.get(k)
      if (hit !== undefined) return hit
      let t = text
      if (g.measureText(t).width > w) {
        while (t.length > 1 && g.measureText(t + '…').width > w) t = t.slice(0, -1)
        t += '…'
      }
      if (clip.size > 4000) clip.clear()
      clip.set(k, t)
      return t
    }
    const draw = (): void => {
      raf = requestAnimationFrame(draw)
      const sc = scrollRef.current
      const cv = canvasRef.current
      if (!sc || !cv) return
      const dpr = window.devicePixelRatio || 1
      const W = sc.clientWidth, H = sc.clientHeight
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr)
        cv.style.width = `${W}px`; cv.style.height = `${H}px`
        clip.clear()
      }
      const g = cv.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      // Theme colours resolved ONCE per frame (getComputedStyle is not free, and
      // the accent is needed per connected cell).
      const cs = getComputedStyle(document.documentElement)
      const v = (n: string): string => cs.getPropertyValue(n).trim()
      const accV = v('--c-accent'), acc2V = v('--c-accent2')
      const C = {
        bg: `rgb(${v('--c-bg')})`, panel: `rgb(${v('--c-panel')})`, panel2: `rgb(${v('--c-panel2')})`, panel3: `rgb(${v('--c-panel3')})`,
        border: `rgb(${v('--c-border')})`, text: `rgb(${v('--c-text')})`, muted: `rgb(${v('--c-muted')})`,
        acc: (a: number) => `rgb(${accV} / ${a})`, acc2: (a: number) => `rgb(${acc2V} / ${a})`
      }
      const { cols, spans } = layRef.current
      const rr = rRef.current
      const cells = cellRef.current
      const sel = selRef.current
      const hv = hover.current
      const sl = sc.scrollLeft, stp = sc.scrollTop
      const rows = rr.inputs
      g.fillStyle = C.bg
      g.fillRect(0, 0, W, H)
      g.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
      g.textBaseline = 'middle'

      const c0 = Math.max(0, Math.floor(sl / CELL))
      const c1 = Math.min(cols.length, Math.ceil((sl + W - LABEL_W) / CELL))
      const r0 = Math.max(0, Math.floor(stp / CELL))
      const r1 = Math.min(rows.length, Math.ceil((stp + H - TOP) / CELL))
      const selOut = sel?.t === 'out' ? sel.id : sel?.t === 'cell' ? sel.o : null
      const selIn = sel?.t === 'in' ? sel.id : sel?.t === 'cell' ? sel.i : null

      // ── cells ──
      g.save()
      g.beginPath(); g.rect(LABEL_W, TOP, W - LABEL_W, H - TOP); g.clip()
      for (let ri = r0; ri < r1; ri++) {
        const y = TOP + ri * CELL - stp
        const inp = rows[ri]
        const live = resoLive.inputs.get(inp.id) ?? 0
        g.fillStyle = ri % 2 ? C.panel : C.bg
        g.fillRect(LABEL_W, y, W - LABEL_W, CELL)
        for (let ci = c0; ci < c1; ci++) {
          const x = LABEL_W + ci * CELL - sl
          const cc = cols[ci]
          if (cc.kind === 'stub') {
            g.fillStyle = C.panel3
            g.fillRect(x + 1, y, CELL - 2, CELL)
            continue
          }
          const amt = cells.get(`${inp.id}|${cc.o.id}`)
          if (amt !== undefined) {
            g.fillStyle = C.acc(0.22 + 0.4 * amt)
            g.fillRect(x + 2, y + 2, CELL - 4, CELL - 4)
            const k = Math.max(0, Math.min(1, live * amt))
            const s = 2 + (CELL - 8) * k
            g.fillStyle = C.acc(0.95)
            g.fillRect(x + (CELL - s) / 2, y + (CELL - s) / 2, s, s)
          } else {
            g.fillStyle = C.border
            g.fillRect(x + CELL / 2 - 1, y + CELL / 2 - 1, 2, 2)
          }
          if (sel?.t === 'cell' && sel.i === inp.id && sel.o === cc.o.id) {
            g.strokeStyle = C.acc2(1); g.lineWidth = 1.5
            g.strokeRect(x + 1.5, y + 1.5, CELL - 3, CELL - 3)
          }
        }
      }
      // crosshair + selected row/column tint
      if (hv && hv.row >= 0 && hv.row < rows.length) {
        g.fillStyle = C.acc2(0.07)
        g.fillRect(LABEL_W, TOP + hv.row * CELL - stp, W - LABEL_W, CELL)
      }
      if (hv && hv.col >= 0 && hv.col < cols.length) {
        g.fillStyle = C.acc2(0.07)
        g.fillRect(LABEL_W + hv.col * CELL - sl, TOP, CELL, Math.min(H - TOP, rows.length * CELL - stp))
      }
      // group separators
      g.fillStyle = C.border
      for (const sp of spans) {
        const x = LABEL_W + sp.c0 * CELL - sl
        if (x > LABEL_W - 1 && x < W) g.fillRect(x, TOP, 1, H - TOP)
      }
      g.restore()

      // ── column headers ──
      g.save()
      g.beginPath(); g.rect(LABEL_W, 0, W - LABEL_W, TOP); g.clip()
      g.fillStyle = C.panel2
      g.fillRect(LABEL_W, 0, W - LABEL_W, TOP)
      spans.forEach((sp, si) => {
        const x0 = LABEL_W + sp.c0 * CELL - sl
        const x1 = LABEL_W + sp.c1 * CELL - sl
        if (x1 < LABEL_W || x0 > W) return
        g.fillStyle = si % 2 ? C.panel3 : C.panel
        g.fillRect(x0, 0, x1 - x0, GROUP_H)
        g.fillStyle = C.border
        g.fillRect(x0, 0, 1, TOP)
        g.fillStyle = sp.folded ? C.muted : C.text
        // Folded : the name already runs up the stub, the band just says "open me".
        const label = sp.folded ? '▸' : `▾ ${sp.group} (${sp.count})`
        g.textAlign = 'left'
        g.fillText(fit(g, label, Math.max(CELL, x1 - x0 - 6)), Math.max(x0, LABEL_W) + 4, GROUP_H / 2 + 1)
      })
      for (let ci = c0; ci < c1; ci++) {
        const cc = cols[ci]
        const x = LABEL_W + ci * CELL - sl
        g.save()
        g.translate(x + CELL / 2 + 1, GROUP_H + HEAD_H - 4)
        g.rotate(-Math.PI / 2)
        g.textAlign = 'left'
        if (cc.kind === 'stub') {
          // A folded group is one column wide : its NAME goes up the header.
          g.fillStyle = C.muted
          g.fillText(fit(g, `▸ ${cc.group} (${cc.count})`, HEAD_H - 8), 0, 0)
        } else {
          const isSel = selOut === cc.o.id
          const w = wired.has(cc.o.id)
          g.fillStyle = isSel ? C.acc(1) : w ? C.text : C.muted
          g.fillText(fit(g, KIND_GLYPH[cc.o.kind] + cc.o.label, HEAD_H - 8), 0, 0)
        }
        g.restore()
        if (cc.kind === 'out') {
          const v = resoLive.outputs.get(cc.o.id)
          g.fillStyle = C.panel3
          g.fillRect(x + 2, GROUP_H + HEAD_H, CELL - 4, METER_H - 1)
          if (v !== undefined) {
            g.fillStyle = C.acc2(0.9)
            g.fillRect(x + 2, GROUP_H + HEAD_H, (CELL - 4) * Math.max(0, Math.min(1, v)), METER_H - 1)
          }
        }
      }
      if (hv && hv.col >= 0 && hv.col < cols.length && hv.row < 0) {
        g.fillStyle = C.acc2(0.1)
        g.fillRect(LABEL_W + hv.col * CELL - sl, GROUP_H, CELL, HEAD_H)
      }
      g.restore()

      // ── row labels ──
      g.save()
      g.beginPath(); g.rect(0, TOP, LABEL_W, H - TOP); g.clip()
      for (let ri = r0; ri < r1; ri++) {
        const y = TOP + ri * CELL - stp
        const inp = rows[ri]
        const live = resoLive.inputs.get(inp.id) ?? 0
        g.fillStyle = selIn === inp.id ? C.acc(0.14) : ri % 2 ? C.panel : C.panel2
        g.fillRect(0, y, LABEL_W, CELL)
        g.fillStyle = C.acc2(0.28)
        g.fillRect(0, y + CELL - 3, (LABEL_W - 8) * Math.max(0, Math.min(1, live)), 2)
        g.fillStyle = selIn === inp.id ? C.acc(1) : C.text
        g.textAlign = 'left'
        g.fillText(fit(g, resoSourceLabel(inp.source), LABEL_W - 14), 6, y + CELL / 2)
      }
      g.fillStyle = C.border
      g.fillRect(LABEL_W - 1, TOP, 1, H - TOP)
      g.restore()

      // ── corner ──
      g.fillStyle = C.panel2
      g.fillRect(0, 0, LABEL_W, TOP)
      g.fillStyle = C.border
      g.fillRect(0, TOP - 1, W, 1)
      g.fillRect(LABEL_W - 1, 0, 1, TOP)
      g.textAlign = 'left'
      g.fillStyle = C.text
      g.fillText('Palinopsia ↓   Resolume →', 8, 14)
      g.fillStyle = C.muted
      g.fillText(`${rows.length} rows · ${rr.outputs.length} addresses`, 8, 32)
      g.fillText(`${rr.cells.length} connections`, 8, 46)
      g.fillText('click : connect', 8, TOP - 58)
      g.fillText('drag : paint', 8, TOP - 44)
      g.fillText('right-click : amount', 8, TOP - 30)
      g.fillText('dbl-click address : test', 8, TOP - 16)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [wired])

  // ── Hit testing ──────────────────────────────────────────────────────
  const hit = (e: React.MouseEvent): { col: number; row: number; zone: 'cell' | 'head' | 'group' | 'label' | 'corner' } => {
    const sc = scrollRef.current!
    const rect = sc.getBoundingClientRect()
    const x = e.clientX - rect.left, y = e.clientY - rect.top
    const col = x >= LABEL_W ? Math.floor((x - LABEL_W + sc.scrollLeft) / CELL) : -1
    const row = y >= TOP ? Math.floor((y - TOP + sc.scrollTop) / CELL) : -1
    const zone = x < LABEL_W ? (y < TOP ? 'corner' : 'label') : y < GROUP_H ? 'group' : y < TOP ? 'head' : 'cell'
    return { col, row, zone }
  }
  const spanAt = (col: number): Span | undefined => lay.spans.find((s) => col >= s.c0 && col < s.c1)

  const applyPaint = (row: number, col: number): void => {
    const p = paint.current
    const c = lay.cols[col]
    const inp = r.inputs[row]
    if (!p || !c || c.kind !== 'out' || !inp) return
    const k = `${inp.id}|${c.o.id}`
    if (p.seen.has(k)) return
    p.seen.add(k)
    if (cellMap.has(k) !== p.on) st().resoToggleCell(inp.id, c.o.id)
  }

  const onDown = (e: React.MouseEvent): void => {
    const h = hit(e)
    if (h.zone === 'group') {
      const sp = spanAt(h.col)
      if (sp) st().resoToggleFold(sp.group)
      return
    }
    const c = lay.cols[h.col]
    if (h.zone === 'head') {
      if (!c) return
      if (c.kind === 'stub') st().resoToggleFold(c.group)
      else setSel({ t: 'out', id: c.o.id })
      return
    }
    if (h.zone === 'label') {
      const inp = r.inputs[h.row]
      if (inp) setSel({ t: 'in', id: inp.id })
      return
    }
    if (h.zone !== 'cell' || !c || !r.inputs[h.row]) return
    if (c.kind === 'stub') { st().resoToggleFold(c.group); return }
    const inp = r.inputs[h.row]
    if (e.button === 2) { setSel({ t: 'cell', i: inp.id, o: c.o.id }); return }
    if (r.locked) { showToast('The mapping is locked : unlock it to edit', 'warn'); return }
    paint.current = { on: !cellMap.has(`${inp.id}|${c.o.id}`), seen: new Set() }
    applyPaint(h.row, h.col)
  }
  const onMove = (e: React.MouseEvent): void => {
    const h = hit(e)
    hover.current = { col: h.zone === 'label' || h.zone === 'corner' ? -1 : h.col, row: h.zone === 'head' || h.zone === 'group' || h.zone === 'corner' ? -1 : h.row }
    if (paint.current && e.buttons & 1 && h.zone === 'cell') applyPaint(h.row, h.col)
  }
  useEffect(() => {
    const up = (): void => { paint.current = null }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])
  const onDbl = (e: React.MouseEvent): void => {
    const h = hit(e)
    const c = lay.cols[h.col]
    if (h.zone === 'head' && c?.kind === 'out') resoTest(c.o)
  }

  const totalW = LABEL_W + lay.cols.length * CELL + 40
  const totalH = TOP + r.inputs.length * CELL + 40

  // ── Side panel selection ──
  const selIn = sel?.t === 'in' ? r.inputs.find((x) => x.id === sel.id) : null
  const selOut = sel?.t === 'out' ? r.outputs.find((x) => x.id === sel.id) : sel?.t === 'cell' ? r.outputs.find((x) => x.id === sel.o) : null
  const selCell = sel?.t === 'cell' ? r.cells.find((c) => c.i === sel.i && c.o === sel.o) : null
  const s = r.session
  const fxCount = s ? s.composition.effects.length + s.layers.reduce((n, l) => n + l.effects.length, 0) + s.groups.reduce((n, g) => n + g.effects.length, 0) : 0

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-3 py-2">
        <span className="text-[13px] font-semibold">Resolume</span>
        <span className="font-mono text-[10px] text-muted">OSC mapper · Palinopsia signals → any Resolume address</span>
        <div className="flex items-center gap-1.5" title={s ? `${s.path}\n${s.version} · ${s.width}×${s.height}` : 'No composition loaded yet'}>
          <span className={`h-2 w-2 rounded-full ${r.enabled ? 'animate-pulse bg-accent' : 'bg-muted'}`} />
          <span className="font-mono text-[10px] text-muted">
            {s
              ? `${s.name} · ${s.layers.length} layers · ${s.groups.length} groups · ${s.columns} columns · ${s.clips.length} clips · ${fxCount} effects`
              : 'no composition loaded'}
          </span>
        </div>
        <Btn label={loading ? 'reading…' : 'Open .avc'} onClick={() => void openAvc()} title="Read a Resolume composition (.avc) : its layers, groups, columns, clips, effects and dashboard links become the matrix columns" />
        {s && <Btn label="↻" onClick={() => void openAvc(s.path)} title="Re-read the same composition (after changing it in Resolume and saving). Connections survive wherever the address still exists." />}
        <div className="flex-1" />
        <span className="font-mono text-[9px] text-muted">K / Esc closes</span>
        <button onClick={() => setOpen(false)} className="rounded px-2 py-0.5 text-[12px] text-muted hover:text-text" title="Close (Esc)">✕</button>
      </div>

      {/* Transport : send, destination, rate, learn, scene follow, snapshots, lock */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-panel2 px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <Btn on={r.enabled} label={r.enabled ? '● sending' : '○ send'} onClick={() => setR({ enabled: !r.enabled })} title="Stream the connected columns to Resolume over OSC" />
          <input className="input w-28 text-[11px]" value={r.host} onChange={(e) => setR({ host: e.target.value.trim() })} title="Resolume's machine (127.0.0.1 when it runs here)" />
          <input className="input w-16 text-[11px]" type="number" value={r.port} onChange={(e) => setR({ port: Number(e.target.value) || 7000 })} title="Resolume's OSC INPUT port (Preferences › OSC, 7000 by default)" />
        </div>
        <label className="flex items-center gap-1.5 font-mono text-[10px] text-muted" title="How many times a second the matrix sends (the patch's speedlim)">
          rate
          <input type="range" min={5} max={60} step={1} value={r.rateHz} onChange={(e) => setR({ rateHz: Number(e.target.value) })} className="w-24" />
          <span className="w-10 text-text">{r.rateHz} Hz</span>
        </label>
        <span className="font-mono text-[10px] text-muted" title="OSC messages actually sent per second (only moved values go out)">{r.enabled ? `${resoLive.sentPerSec} msg/s` : ''}</span>
        <div className="flex items-center gap-1.5">
          <Btn
            on={learning}
            label={learning ? '◉ learning' : 'Learn'}
            onClick={() => {
              if (!learning && !oscEnabled) showToast(`Turn Palinopsia's OSC input on (osc tab) and point Resolume's OSC output at port ${oscPort}`, 'warn', 6000)
              setLearning(!learning)
            }}
            title={`Catch addresses straight from Resolume : in Resolume, Preferences › OSC › Output on, target 127.0.0.1 port ${oscPort} (Palinopsia's OSC input). Then move any control in Resolume : it becomes a column.`}
          />
          {learning && <span className="max-w-[260px] truncate font-mono text-[10px] text-accent">{lastLearned ?? 'move a control in Resolume…'}</span>}
        </div>
        <div className="flex items-center gap-1.5" title="Recalling Palinopsia scene N connects Resolume column N (+ offset) : the patch's scene trigger">
          <Btn on={r.sceneColumns} label="scene → column" onClick={() => setR({ sceneColumns: !r.sceneColumns })} />
          {r.sceneColumns && (
            <input className="input w-12 text-[11px]" type="number" value={r.columnOffset} onChange={(e) => setR({ columnOffset: Number(e.target.value) || 0 })} title="Column offset (scene 1 → column 1 + offset)" />
          )}
        </div>
        <div className="flex items-center gap-1" title="Connection snapshots : click recalls, shift+click stores the current connections">
          <span className="mr-1 font-mono text-[10px] text-muted">snap</span>
          {Array.from({ length: RESO_SNAPSHOTS }, (_, i) => (
            <button
              key={i}
              onClick={(e) => {
                st().resoSnapshot(i, e.shiftKey)
                if (e.shiftKey) showToast(r.locked ? 'Locked : unlock to store a snapshot' : `Snapshot ${i + 1} stored`, r.locked ? 'warn' : 'ok')
              }}
              className={`h-5 w-5 rounded font-mono text-[10px] ${r.snapshots[i] ? 'border border-accent2/70 bg-accent2/15 text-accent2' : 'border border-border text-muted hover:text-text'}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Btn label="Clear" onClick={() => { if (!r.locked && r.cells.length && confirm('Remove every connection?')) st().resoClearCells() }} title="Remove every connection (rows and columns stay)" />
        <Btn on={r.locked} danger label={r.locked ? '🔒 locked' : 'lock'} onClick={() => setR({ locked: !r.locked })} title="Lock the mapping : no connection, row or column can change (sending, snapshot recall and scene follow still work). Saved with the session." />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Matrix */}
        <div
          ref={scrollRef}
          className="relative min-w-0 flex-1 overflow-auto"
          onMouseDown={onDown}
          onMouseMove={onMove}
          onMouseLeave={() => { hover.current = null }}
          onDoubleClick={onDbl}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div style={{ width: totalW, height: totalH, position: 'relative' }}>
            <canvas ref={canvasRef} style={{ position: 'sticky', top: 0, left: 0, display: 'block' }} />
          </div>
          {r.outputs.length === 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-40 flex flex-col items-center gap-2 px-6 text-center font-mono text-[11px] text-muted">
              <span>Open a Resolume composition (.avc) to build the matrix from its layers, groups, columns, clips and effects,</span>
              <span>or use Learn to catch addresses by moving controls in Resolume, or add an address by hand on the right.</span>
            </div>
          )}
        </div>

        {/* Side panel */}
        <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-panel p-3 text-[11px]">
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-wide text-accent2">add a row</span>
            <SearchSelect
              value=""
              options={sources}
              onChange={(v) => { if (r.locked) showToast('Locked', 'warn'); else st().resoAddInput(v) }}
              placeholder="+ Palinopsia signal…"
              resetAfterPick
              menuWidth={280}
              title="Any modulator, Meta knob, audio / vision / body feature, or any /opsia address"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-wide text-accent2">add an address by hand</span>
            <input className="input text-[11px]" value={custom.address} onChange={(e) => setCustom({ ...custom, address: e.target.value })} placeholder="/composition/…" />
            <div className="flex gap-1.5">
              <select className="input select-compact flex-1 text-[11px]" value={custom.kind} onChange={(e) => setCustom({ ...custom, kind: e.target.value as ResoKind })}>
                <option value="float">float (0..1)</option>
                <option value="toggle">toggle (0 / 1)</option>
                <option value="trigger">trigger (1 on rise)</option>
              </select>
              <Btn
                label="add"
                onClick={() => {
                  const a = custom.address.trim()
                  if (!/^\/\S+/.test(a) || a === '/composition/') return
                  if (r.locked) { showToast('Locked', 'warn'); return }
                  st().resoAddOutput({ address: a, label: a.split('/').filter(Boolean).slice(-3).join(' '), group: 'Custom', kind: custom.kind, lo: 0, hi: 1, smooth: 0, combine: 'mean' })
                }}
              />
            </div>
          </div>

          {selIn && (
            <div className="flex flex-col gap-1.5 rounded border border-border bg-panel2 p-2">
              <span className="font-mono text-[9px] uppercase tracking-wide text-accent2">row</span>
              <span className="font-mono text-[11px] text-text">{resoSourceLabel(selIn.source)}</span>
              <Slider label="smooth" value={selIn.smooth} min={0} max={1} step={0.01} onChange={(v) => st().resoUpdateInput(selIn.id, { smooth: v })} title="Slew on the incoming signal (0 = raw)" />
              <Slider label="gain" value={selIn.gain} min={0} max={4} step={0.05} onChange={(v) => st().resoUpdateInput(selIn.id, { gain: v })} title="Scales the signal before it is clipped to 0..1" />
              <div className="flex gap-1.5">
                <Btn label="↑" onClick={() => st().resoMoveInput(selIn.id, -1)} />
                <Btn label="↓" onClick={() => st().resoMoveInput(selIn.id, 1)} />
                <div className="flex-1" />
                <Btn label="remove row" onClick={() => { st().resoRemoveInput(selIn.id); setSel(null) }} />
              </div>
            </div>
          )}

          {selOut && (
            <div className="flex flex-col gap-1.5 rounded border border-border bg-panel2 p-2">
              <span className="font-mono text-[9px] uppercase tracking-wide text-accent2">column · {selOut.group}</span>
              <input className="input text-[11px]" value={selOut.label} onChange={(e) => st().resoUpdateOutput(selOut.id, { label: e.target.value })} title="Label" />
              <input className="input font-mono text-[10px]" value={selOut.address} onChange={(e) => st().resoUpdateOutput(selOut.id, { address: e.target.value.trim() })} title="The Resolume OSC address" />
              <div className="flex gap-1.5">
                <select className="input select-compact flex-1 text-[11px]" value={selOut.kind} onChange={(e) => st().resoUpdateOutput(selOut.id, { kind: e.target.value as ResoKind })} title="float : a continuous 0..1 value · toggle : 0 / 1 around the middle · trigger : sends 1 each time the value rises past the middle">
                  <option value="float">float</option>
                  <option value="toggle">toggle</option>
                  <option value="trigger">trigger</option>
                </select>
                <select className="input select-compact flex-1 text-[11px]" value={selOut.combine} onChange={(e) => st().resoUpdateOutput(selOut.id, { combine: e.target.value as ResoOutput['combine'] })} title="How several rows feeding this column combine">
                  <option value="mean">mean</option>
                  <option value="max">max</option>
                  <option value="sum">sum</option>
                </select>
              </div>
              {selOut.kind === 'float' && (
                <>
                  <Slider label="low" value={selOut.lo} min={0} max={1} step={0.01} onChange={(v) => st().resoUpdateOutput(selOut.id, { lo: v })} title="Value sent when the combined signal is 0" />
                  <Slider label="high" value={selOut.hi} min={0} max={1} step={0.01} onChange={(v) => st().resoUpdateOutput(selOut.id, { hi: v })} title="Value sent when the combined signal is 1 (below low inverts)" />
                </>
              )}
              <Slider label="smooth" value={selOut.smooth} min={0} max={1} step={0.01} onChange={(v) => st().resoUpdateOutput(selOut.id, { smooth: v })} title="Slew on what is sent (the patch's slide)" />
              {selCell && (
                <Slider label="amount" value={selCell.amount} min={0.05} max={1} step={0.01} onChange={(v) => st().resoSetCellAmount(selCell.i, selCell.o, v)} title="How much of this row reaches this column" />
              )}
              <div className="flex gap-1.5">
                <Btn label="test" onClick={() => resoTest(selOut)} title="Send it once by hand : a float sweeps up and back, a trigger fires, a toggle flips" />
                <div className="flex-1" />
                <Btn label="remove column" onClick={() => { st().resoRemoveOutput(selOut.id); setSel(null) }} />
              </div>
            </div>
          )}

          <div className="mt-auto flex flex-col gap-1 font-mono text-[10px] leading-snug text-muted">
            <span className="text-accent2">in Resolume</span>
            <span>Preferences › OSC › Input on, port {r.port}.</span>
            <span>Dashboard links are the usual targets : link any parameter to a dashboard dial in Resolume, then drive the link from here.</span>
            <span>Learn needs Resolume's OSC Output on, pointed at 127.0.0.1 : {oscPort} (Palinopsia's OSC input{oscEnabled ? '' : ', currently off'}).</span>
          </div>
        </div>
      </div>
    </div>
  )
}
