// Resolume OSC mapper page (K) : Palinopsia signals × Resolume addresses.
//
// A pin matrix like the Max `matrixctrl` it replaces : rows are Palinopsia's
// signals, columns the Resolume OSC addresses a loaded composition offers, and a
// connection is a pin in the board, colored by the signal's family and glowing
// with what it carries. The grid is drawn on ONE canvas that only paints what is
// on screen, so a composition with hundreds of addresses stays light; column
// groups (Layer 4, Group 2, Columns…) fold shut, and a folded group still shows
// the columns that carry a connection so nothing wired ever hides.
//
// The canvas is laid over the scroll area, not inside it : inside, it was part of
// what scrolls, and a redraw that nudged its size could add and remove the
// scrollbars frame after frame (they flickered).
//
// The page sits inside the app's CSS zoom (the UI zoom) : mouse events and
// getBoundingClientRect() are viewport pixels while the layout (CELL, scroll
// offsets) is in the page's own pixels, so every hit test divides by the
// effective zoom (a click at 80 % used to toggle a pin far to its left).

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
import { effectiveZoom } from './uiZoom'
import { TBTN, TBTN_IDLE, TBTN_LIT } from './buttonStyles'
import { MidiLearnOverlay } from './MidiLearnOverlay'

const CELL = 20
const LABEL_W = 224
const GROUP_H = 22
const HEAD_H = 132
const METER_H = 6
const TOP = GROUP_H + HEAD_H + METER_H

// The app's type : its UI face (each theme sets --font-app) for the labels, the
// mono the other pages use for titles, headings and readouts.
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

type Col = { kind: 'out'; o: ResoOutput; group: string; gi: number } | { kind: 'stub'; group: string; count: number; gi: number }
interface Span { group: string; c0: number; c1: number; folded: boolean; count: number; gi: number }
type Sel = { t: 'in'; id: string } | { t: 'out'; id: string } | { t: 'cell'; i: string; o: string } | null

const KIND_GLYPH: Record<ResoKind, string> = { float: '', toggle: '◧ ', trigger: '⏵ ' }

// Signal families : every row's pin, dot and meter wear its family's color (a
// deeper shade on the light themes).
const FAMILY: Record<string, { name: string; dark: string; light: string }> = {
  mod: { name: 'modulator', dark: '#ff9a4d', light: '#c75a12' },
  meta: { name: 'Meta knob', dark: '#ffd25e', light: '#9a6f00' },
  audio: { name: 'audio', dark: '#52d0f5', light: '#0a7a9e' },
  vision: { name: 'vision', dark: '#b892ff', light: '#6438c0' },
  body: { name: 'body', dark: '#ff79a8', light: '#bb2a63' },
  osc: { name: 'OSC', dark: '#7fe0a0', light: '#1f7f52' }
}
const familyOf = (source: string): string => {
  const k = source.slice(0, source.indexOf(':'))
  return k in FAMILY ? k : 'osc'
}
// Column groups : each band its own hue, spread around the wheel.
const groupHue = (gi: number): number => (gi * 137.5 + 28) % 360

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
  order.forEach((g, gi) => {
    const outs = byGroup.get(g)!
    const isFolded = folded.includes(g)
    const c0 = cols.length
    if (isFolded) {
      cols.push({ kind: 'stub', group: g, count: outs.length, gi })
      for (const o of outs) if (wired.has(o.id)) cols.push({ kind: 'out', o, group: g, gi })
    } else {
      for (const o of outs) cols.push({ kind: 'out', o, group: g, gi })
    }
    spans.push({ group: g, c0, c1: cols.length, folded: isFolded, count: outs.length, gi })
  })
  return { cols, spans }
}

function Btn({ on, label, onClick, title, danger, strong }: {
  on?: boolean; label: string; onClick: () => void; title?: string; danger?: boolean; strong?: boolean
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`${TBTN} ${
        on
          ? danger
            ? 'border-red-500/70 bg-red-500/15 text-red-300'
            : TBTN_LIT
          : strong
            ? 'border-accent/60 bg-panel2 text-accent hover:bg-accent/15'
            : TBTN_IDLE
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
      <span className="w-14 shrink-0 uppercase">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1 accent-accent" />
      <span className="w-10 shrink-0 text-right text-text">{fmt ? fmt(value) : value.toFixed(2)}</span>
    </label>
  )
}

function Card({ title, color, children }: { title: string; color?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 rounded border border-border bg-panel2 p-2">
      <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wide text-accent2">
        {color && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
        {title}
      </span>
      {children}
    </div>
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
  // The pins before the last dice : ↶ puts them back (until they change again).
  const [beforeDice, setBeforeDice] = useState<typeof r.cells | null>(null)
  useEffect(() => {
    if (beforeDice && r.cells !== lastDiceCells.current) setBeforeDice(null)
  }, [r.cells, beforeDice])
  const lastDiceCells = useRef<typeof r.cells | null>(null)
  const dice = (): void => {
    if (r.locked) { showToast('The mapping is locked : unlock it to roll the pins', 'warn'); return }
    const prev = st().resolume.cells // the live pins (a render may not have caught up)
    const n = st().resoRandomize()
    if (n < 0) { showToast('Nothing to wire yet : open a composition or add an address', 'warn'); return }
    lastDiceCells.current = st().resolume.cells
    setBeforeDice(prev)
    showToast(`${n} new ${n === 1 ? 'pin' : 'pins'} · ↶ puts the old ones back`)
  }
  // A slow re-render for the msg/s readout (the canvas has its own rAF).
  const [, setBeat] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setBeat((x) => x + 1), 500)
    return () => clearInterval(t)
  }, [])

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const statusRef = useRef<HTMLDivElement | null>(null)
  const hover = useRef<{ col: number; row: number } | null>(null)
  const paint = useRef<{ on: boolean; seen: Set<string> } | null>(null)
  const selRef = useRef<Sel>(null)
  selRef.current = sel
  // Text-fitting cache, emptied when the page's faces finish loading (the canvas
  // measures with whatever face is ready).
  const clipRef = useRef(new Map<string, string>())

  const wired = useMemo(() => new Set(r.cells.map((c) => c.o)), [r.cells])
  const lay = useMemo(() => layout(r.outputs, r.folded, wired), [r.outputs, r.folded, wired])
  const layRef = useRef(lay)
  layRef.current = lay
  const cellMap = useMemo(() => new Map(r.cells.map((c) => [`${c.i}|${c.o}`, c.amount])), [r.cells])
  const cellRef = useRef(cellMap)
  cellRef.current = cellMap
  const rowPins = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of r.cells) m.set(c.i, (m.get(c.i) ?? 0) + 1)
    return m
  }, [r.cells])
  const rowPinsRef = useRef(rowPins)
  rowPinsRef.current = rowPins
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

  // ── Canvas drawing (rAF while open : the pins and meters are live) ────
  useEffect(() => {
    let raf = 0
    const TAU = Math.PI * 2
    const fit = (g: CanvasRenderingContext2D, text: string, w: number): string => {
      const clip = clipRef.current
      const k = `${g.font}|${text}|${w}`
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
      // Backing store at the real screen size : the UI zoom scales this canvas
      // too, so it is drawn at dpr × zoom to stay sharp.
      const k = (window.devicePixelRatio || 1) * effectiveZoom(sc)
      const W = sc.clientWidth, H = sc.clientHeight
      if (cv.width !== Math.round(W * k) || cv.height !== Math.round(H * k)) {
        cv.width = Math.round(W * k); cv.height = Math.round(H * k)
        cv.style.width = `${W}px`; cv.style.height = `${H}px`
      }
      const g = cv.getContext('2d')
      if (!g) return
      g.setTransform(k, 0, 0, k, 0, 0)
      // Theme colours resolved ONCE per frame (getComputedStyle is not free).
      const cs = getComputedStyle(document.documentElement)
      const v = (n: string): string => cs.getPropertyValue(n).trim()
      const FACE = v('--font-app') || 'ui-sans-serif, system-ui, sans-serif'
      const accV = v('--c-accent'), acc2V = v('--c-accent2'), bgV = v('--c-bg')
      const [br, bgg, bb] = bgV.split(/\s+/).map(Number)
      const lightTheme = 0.2126 * (br || 0) + 0.7152 * (bgg || 0) + 0.0722 * (bb || 0) > 140
      const C = {
        bg: `rgb(${bgV})`, panel: `rgb(${v('--c-panel')})`, panel2: `rgb(${v('--c-panel2')})`, panel3: `rgb(${v('--c-panel3')})`,
        border: `rgb(${v('--c-border')})`, text: `rgb(${v('--c-text')})`, muted: `rgb(${v('--c-muted')})`,
        acc: (a: number) => `rgb(${accV} / ${a})`, acc2: (a: number) => `rgb(${acc2V} / ${a})`
      }
      const fam = (source: string): string => {
        const f = FAMILY[familyOf(source)]
        return lightTheme ? f.light : f.dark
      }
      const band = (gi: number, a: number): string => `hsl(${groupHue(gi)} 62% ${lightTheme ? 42 : 64}% / ${a})`
      const { cols, spans } = layRef.current
      const rr = rRef.current
      const cells = cellRef.current
      const pins = rowPinsRef.current
      const sel = selRef.current
      const hv = hover.current
      const sl = sc.scrollLeft, stp = sc.scrollTop
      const rows = rr.inputs
      g.fillStyle = C.bg
      g.fillRect(0, 0, W, H)
      g.textBaseline = 'middle'

      const c0 = Math.max(0, Math.floor(sl / CELL))
      const c1 = Math.min(cols.length, Math.ceil((sl + W - LABEL_W) / CELL))
      const r0 = Math.max(0, Math.floor(stp / CELL))
      const r1 = Math.min(rows.length, Math.ceil((stp + H - TOP) / CELL))
      const selOut = sel?.t === 'out' ? sel.id : sel?.t === 'cell' ? sel.o : null
      const selIn = sel?.t === 'in' ? sel.id : sel?.t === 'cell' ? sel.i : null

      // ── the board ──
      g.save()
      g.beginPath(); g.rect(LABEL_W, TOP, W - LABEL_W, H - TOP); g.clip()
      for (let ri = r0; ri < r1; ri++) {
        const y = TOP + ri * CELL - stp
        g.fillStyle = ri % 2 ? C.panel : C.bg
        g.fillRect(LABEL_W, y, W - LABEL_W, CELL)
      }
      // each column group lightly tinted in its band's hue
      for (const sp of spans) {
        const x0 = LABEL_W + sp.c0 * CELL - sl, x1 = LABEL_W + sp.c1 * CELL - sl
        if (x1 < LABEL_W || x0 > W) continue
        g.fillStyle = band(sp.gi, lightTheme ? 0.06 : 0.045)
        g.fillRect(x0, TOP, x1 - x0, Math.min(H - TOP, rows.length * CELL - stp))
      }
      // crosshair under the cursor
      if (hv && hv.row >= 0 && hv.row < rows.length) {
        g.fillStyle = C.acc2(0.09)
        g.fillRect(LABEL_W, TOP + hv.row * CELL - stp, W - LABEL_W, CELL)
      }
      if (hv && hv.col >= 0 && hv.col < cols.length) {
        g.fillStyle = C.acc2(0.09)
        g.fillRect(LABEL_W + hv.col * CELL - sl, TOP, CELL, Math.min(H - TOP, rows.length * CELL - stp))
      }
      // the holes : one path for every empty cell on screen
      g.beginPath()
      for (let ri = r0; ri < r1; ri++) {
        const cy = TOP + ri * CELL - stp + CELL / 2
        const inp = rows[ri]
        for (let ci = c0; ci < c1; ci++) {
          const cc = cols[ci]
          if (cc.kind !== 'out' || cells.has(`${inp.id}|${cc.o.id}`)) continue
          const cx = LABEL_W + ci * CELL - sl + CELL / 2
          g.moveTo(cx + 1.7, cy)
          g.arc(cx, cy, 1.7, 0, TAU)
        }
      }
      g.fillStyle = C.border
      g.fill()
      // folded groups : a closed strip
      for (let ci = c0; ci < c1; ci++) {
        const cc = cols[ci]
        if (cc.kind !== 'stub') continue
        const x = LABEL_W + ci * CELL - sl
        g.fillStyle = band(cc.gi, 0.18)
        g.fillRect(x + 3, TOP, CELL - 6, Math.min(H - TOP, rows.length * CELL - stp))
      }
      // the pins : the signal family's color, sized by the amount, a halo that
      // breathes with what the connection carries right now
      for (let ri = r0; ri < r1; ri++) {
        const cy = TOP + ri * CELL - stp + CELL / 2
        const inp = rows[ri]
        const live = resoLive.inputs.get(inp.id) ?? 0
        const col = fam(inp.source)
        for (let ci = c0; ci < c1; ci++) {
          const cc = cols[ci]
          if (cc.kind !== 'out') continue
          const amt = cells.get(`${inp.id}|${cc.o.id}`)
          if (amt === undefined) continue
          const cx = LABEL_W + ci * CELL - sl + CELL / 2
          const rad = 3.4 + 3.2 * amt
          const flow = Math.max(0, Math.min(1, live * amt))
          if (flow > 0.02) {
            g.globalAlpha = 0.25 + 0.6 * flow
            g.strokeStyle = col
            g.lineWidth = 1.4
            g.beginPath(); g.arc(cx, cy, rad + 1.2 + 2.6 * flow, 0, TAU); g.stroke()
            g.globalAlpha = 1
          }
          g.fillStyle = col
          g.beginPath(); g.arc(cx, cy, rad, 0, TAU); g.fill()
          g.fillStyle = 'rgba(255,255,255,0.55)'
          g.beginPath(); g.arc(cx - rad * 0.33, cy - rad * 0.33, rad * 0.32, 0, TAU); g.fill()
          if (sel?.t === 'cell' && sel.i === inp.id && sel.o === cc.o.id) {
            g.strokeStyle = C.acc2(1); g.lineWidth = 1.6
            g.beginPath(); g.arc(cx, cy, CELL / 2 - 1, 0, TAU); g.stroke()
          }
        }
      }
      // the hole under the cursor : a ring that says "click here"
      if (hv && hv.row >= 0 && hv.row < rows.length && hv.col >= 0 && hv.col < cols.length && cols[hv.col].kind === 'out') {
        const cx = LABEL_W + hv.col * CELL - sl + CELL / 2, cy = TOP + hv.row * CELL - stp + CELL / 2
        g.strokeStyle = C.acc2(0.9); g.lineWidth = 1.3
        g.beginPath(); g.arc(cx, cy, CELL / 2 - 2, 0, TAU); g.stroke()
      }
      // group separators
      for (const sp of spans) {
        const x = LABEL_W + sp.c0 * CELL - sl
        if (x > LABEL_W - 1 && x < W) { g.fillStyle = band(sp.gi, 0.5); g.fillRect(x, TOP, 1, H - TOP) }
      }
      g.restore()

      // ── column headers ──
      g.save()
      g.beginPath(); g.rect(LABEL_W, 0, W - LABEL_W, TOP); g.clip()
      g.fillStyle = C.panel2
      g.fillRect(LABEL_W, 0, W - LABEL_W, TOP)
      g.font = `600 11px ${FACE}`
      spans.forEach((sp) => {
        const x0 = LABEL_W + sp.c0 * CELL - sl
        const x1 = LABEL_W + sp.c1 * CELL - sl
        if (x1 < LABEL_W || x0 > W) return
        g.fillStyle = band(sp.gi, 0.2)
        g.fillRect(x0 + 1, 2, x1 - x0 - 2, GROUP_H - 4)
        g.fillStyle = band(sp.gi, 1)
        g.fillRect(x0 + 1, GROUP_H - 3, x1 - x0 - 2, 2)
        g.fillStyle = band(sp.gi, 0.35)
        g.fillRect(x0, GROUP_H, 1, TOP - GROUP_H)
        g.fillStyle = sp.folded ? C.muted : C.text
        // Folded : the name already runs up the stub, the band just says "open me".
        const label = sp.folded ? '▸' : `▾ ${sp.group}  ${sp.count}`
        g.textAlign = 'left'
        g.fillText(fit(g, label, Math.max(CELL - 4, x1 - x0 - 10)), Math.max(x0, LABEL_W) + 5, GROUP_H / 2)
      })
      g.font = `450 11px ${FACE}`
      for (let ci = c0; ci < c1; ci++) {
        const cc = cols[ci]
        const x = LABEL_W + ci * CELL - sl
        g.save()
        g.translate(x + CELL / 2 + 1, GROUP_H + HEAD_H - 6)
        g.rotate(-Math.PI / 2)
        g.textAlign = 'left'
        if (cc.kind === 'stub') {
          // A folded group is one column wide : its NAME goes up the header.
          g.fillStyle = band(cc.gi, 1)
          g.fillText(fit(g, `▸ ${cc.group}  ${cc.count}`, HEAD_H - 12), 0, 0)
        } else {
          const isSel = selOut === cc.o.id
          const w = wired.has(cc.o.id)
          g.fillStyle = isSel ? C.acc(1) : w ? C.text : C.muted
          g.fillText(fit(g, KIND_GLYPH[cc.o.kind] + cc.o.label, HEAD_H - 12), 0, 0)
        }
        g.restore()
        if (cc.kind === 'out') {
          const val = resoLive.outputs.get(cc.o.id)
          g.fillStyle = C.panel3
          g.fillRect(x + 3, GROUP_H + HEAD_H, CELL - 6, METER_H - 2)
          if (val !== undefined) {
            g.fillStyle = C.acc2(0.95)
            g.fillRect(x + 3, GROUP_H + HEAD_H, (CELL - 6) * Math.max(0, Math.min(1, val)), METER_H - 2)
          }
        }
      }
      if (hv && hv.col >= 0 && hv.col < cols.length && hv.row < 0) {
        g.fillStyle = C.acc2(0.12)
        g.fillRect(LABEL_W + hv.col * CELL - sl, GROUP_H, CELL, HEAD_H)
      } else if (hv && hv.col >= 0 && hv.col < cols.length) {
        g.fillStyle = C.acc2(0.08)
        g.fillRect(LABEL_W + hv.col * CELL - sl, GROUP_H, CELL, HEAD_H)
      }
      g.restore()

      // ── row labels ──
      g.save()
      g.beginPath(); g.rect(0, TOP, LABEL_W, H - TOP); g.clip()
      g.font = `450 11.5px ${FACE}`
      for (let ri = r0; ri < r1; ri++) {
        const y = TOP + ri * CELL - stp
        const inp = rows[ri]
        const live = resoLive.inputs.get(inp.id) ?? 0
        const col = fam(inp.source)
        const isSel = selIn === inp.id
        g.fillStyle = isSel ? C.acc(0.16) : hv && hv.row === ri ? C.acc2(0.1) : ri % 2 ? C.panel : C.panel2
        g.fillRect(0, y, LABEL_W, CELL)
        // the live signal, a soft bar in the family's color
        g.globalAlpha = 0.22
        g.fillStyle = col
        g.fillRect(0, y + 2, (LABEL_W - 2) * Math.max(0, Math.min(1, live)), CELL - 4)
        g.globalAlpha = 1
        g.fillStyle = col
        g.beginPath(); g.arc(12, y + CELL / 2, 4, 0, TAU); g.fill()
        const n = pins.get(inp.id) ?? 0
        g.fillStyle = isSel ? C.acc(1) : C.text
        g.textAlign = 'left'
        g.fillText(fit(g, resoSourceLabel(inp.source), LABEL_W - (n ? 52 : 30)), 24, y + CELL / 2 + 0.5)
        if (n) {
          // how many pins this row carries
          const t = String(n)
          g.font = `600 10px ${FACE}`
          const tw = g.measureText(t).width + 10
          g.fillStyle = col
          g.globalAlpha = 0.85
          g.beginPath(); g.roundRect(LABEL_W - tw - 8, y + 4, tw, CELL - 8, 6); g.fill()
          g.globalAlpha = 1
          g.fillStyle = lightTheme ? '#fff' : '#111'
          g.textAlign = 'center'
          g.fillText(t, LABEL_W - tw / 2 - 8, y + CELL / 2 + 0.5)
          g.font = `450 11.5px ${FACE}`
        }
      }
      g.fillStyle = C.border
      g.fillRect(LABEL_W - 1, TOP, 1, H - TOP)
      g.restore()

      // ── corner : who plays whom ──
      g.fillStyle = C.panel2
      g.fillRect(0, 0, LABEL_W, TOP)
      g.strokeStyle = C.border; g.lineWidth = 1
      g.beginPath(); g.moveTo(0, 0); g.lineTo(LABEL_W, TOP); g.stroke()
      g.fillStyle = C.border
      g.fillRect(0, TOP - 1, W, 1)
      g.fillRect(LABEL_W - 1, 0, 1, TOP)
      // the page titles' look : mono, upper case, spaced out
      const gl = g as CanvasRenderingContext2D & { letterSpacing: string }
      g.font = `600 10px ${MONO}`
      gl.letterSpacing = '1.5px'
      g.textAlign = 'right'
      g.fillStyle = C.acc2(1)
      g.fillText('RESOLUME →', LABEL_W - 12, 20)
      g.textAlign = 'left'
      g.fillStyle = C.acc(1)
      g.fillText('PALINOPSIA ↓', 12, TOP - 20)
      gl.letterSpacing = '0px'
      // the counts sit above the diagonal, right-aligned under "Resolume →"
      g.font = `10px ${MONO}`
      g.textAlign = 'right'
      g.fillStyle = C.muted
      g.fillText(`${rows.length} signals`, LABEL_W - 12, 44)
      g.fillText(`${rr.outputs.length} addresses`, LABEL_W - 12, 60)
      g.fillStyle = rr.cells.length ? C.text : C.muted
      g.fillText(`${rr.cells.length} ${rr.cells.length === 1 ? 'pin' : 'pins'}`, LABEL_W - 12, 76)
      g.textAlign = 'left'
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [wired])

  // ── Hit testing ──────────────────────────────────────────────────────
  const hit = (e: React.MouseEvent): { col: number; row: number; zone: 'cell' | 'head' | 'group' | 'label' | 'corner' } => {
    const sc = scrollRef.current!
    const rect = sc.getBoundingClientRect()
    // viewport pixels → the page's own pixels (the UI zoom)
    const z = effectiveZoom(sc)
    const x = (e.clientX - rect.left) / z, y = (e.clientY - rect.top) / z
    const col = x >= LABEL_W ? Math.floor((x - LABEL_W + sc.scrollLeft) / CELL) : -1
    const row = y >= TOP ? Math.floor((y - TOP + sc.scrollTop) / CELL) : -1
    const zone = x < LABEL_W ? (y < TOP ? 'corner' : 'label') : y < GROUP_H ? 'group' : y < TOP ? 'head' : 'cell'
    return { col, row, zone }
  }
  const spanAt = (col: number): ReturnType<typeof layout>['spans'][number] | undefined => lay.spans.find((s) => col >= s.c0 && col < s.c1)

  /** The line under the board : what is under the cursor and what a click does. */
  const describe = (h: ReturnType<typeof hit>): string => {
    const c = lay.cols[h.col]
    const inp = r.inputs[h.row]
    if (h.zone === 'group') {
      const sp = spanAt(h.col)
      return sp ? `${sp.group} · ${sp.count} addresses · click : ${sp.folded ? 'unfold' : 'fold'} the group` : ''
    }
    if (h.zone === 'head') {
      if (!c) return ''
      if (c.kind === 'stub') return `${c.group} (folded) · click : unfold`
      return `${c.o.label}  ${c.o.address}  · ${c.o.kind} · click : column settings · double-click : test it in Resolume`
    }
    if (h.zone === 'label') return inp ? `${resoSourceLabel(inp.source)} · ${FAMILY[familyOf(inp.source)].name} · click : row settings` : ''
    if (h.zone === 'cell' && c && inp) {
      if (c.kind === 'stub') return `${c.group} (folded) · click : unfold`
      const amt = cellMap.get(`${inp.id}|${c.o.id}`)
      return amt === undefined
        ? `${resoSourceLabel(inp.source)}  →  ${c.o.label}   ${c.o.address}   · click : connect · drag : paint pins`
        : `${resoSourceLabel(inp.source)}  →  ${c.o.label}   ${c.o.address}   · amount ${Math.round(amt * 100)} % · click : disconnect · right-click : amount`
    }
    return ''
  }
  const IDLE = 'click a hole to connect a signal to a control · drag to paint pins · right-click a pin for its amount · double-click an address to test it'
  const setStatus = (t: string): void => {
    const el = statusRef.current
    if (el && el.textContent !== (t || IDLE)) el.textContent = t || IDLE
  }

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
    if (e.button !== 0) return
    if (r.locked) { showToast('The mapping is locked : unlock it to edit', 'warn'); return }
    paint.current = { on: !cellMap.has(`${inp.id}|${c.o.id}`), seen: new Set() }
    applyPaint(h.row, h.col)
  }
  const onMove = (e: React.MouseEvent): void => {
    const h = hit(e)
    hover.current = { col: h.zone === 'label' || h.zone === 'corner' ? -1 : h.col, row: h.zone === 'head' || h.zone === 'group' || h.zone === 'corner' ? -1 : h.row }
    setStatus(describe(h))
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
  const selCellIn = sel?.t === 'cell' ? r.inputs.find((x) => x.id === sel.i) : null
  const s = r.session
  const fxCount = s ? s.composition.effects.length + s.layers.reduce((n, l) => n + l.effects.length, 0) + s.groups.reduce((n, g) => n + g.effects.length, 0) : 0
  const lightTheme = (() => {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--c-bg').trim().split(/\s+/).map(Number)
    return 0.2126 * (bg[0] || 0) + 0.7152 * (bg[1] || 0) + 0.0722 * (bg[2] || 0) > 140
  })()
  const famColor = (source: string): string => (lightTheme ? FAMILY[familyOf(source)].light : FAMILY[familyOf(source)].dark)
  const outGroupColor = (o: ResoOutput): string => {
    const gi = lay.spans.find((sp) => sp.group === o.group)?.gi ?? 0
    return `hsl(${groupHue(gi)} 62% ${lightTheme ? 42 : 64}%)`
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      {/* Header : the other full pages' title bar */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border bg-panel px-4 py-2">
        <span
          className="cursor-help font-mono text-[13px] font-semibold uppercase tracking-[0.2em]"
          title="Wire Palinopsia's signals (the rows) to any Resolume control (the columns) : a pin where they meet sends that signal to that control, live, over OSC."
        >
          Resolume · Mapper
        </span>
        <div
          className="flex items-center gap-1.5 rounded border border-border bg-panel2 px-2 py-0.5"
          title={s ? `${s.path}\n${s.version} · ${s.width}×${s.height}` : 'No composition loaded yet'}
        >
          <span className={`h-2 w-2 rounded-full ${r.enabled ? 'animate-pulse bg-accent' : 'bg-muted'}`} />
          <span className="font-mono text-[10px] text-muted">
            {s
              ? <><span className="text-text">{s.name}</span> · {s.layers.length} layers · {s.groups.length} groups · {s.columns} columns · {s.clips.length} clips · {fxCount} effects</>
              : 'no composition yet'}
          </span>
        </div>
        <Btn strong label={loading ? 'reading…' : 'Open .avc'} onClick={() => void openAvc()} title="Read a Resolume composition (.avc) : its layers, groups, columns, clips, effects and dashboard links become the matrix columns" />
        {s && <Btn label="↻ re-read" onClick={() => void openAvc(s.path)} title="Re-read the same composition (after changing it in Resolume and saving). Connections survive wherever the address still exists." />}
        <div className="flex-1" />
        <span className="font-mono text-[9px] text-muted">K / Esc closes</span>
        <button
          onClick={() => setOpen(false)}
          className="rounded border border-border px-3 py-1 font-mono text-[11px] text-muted hover:text-accent"
          title="Close (Esc)"
        >
          ← back to instrument
        </button>
      </header>

      {/* Transport : send, destination, rate, learn, scene follow, snapshots, dice, lock */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-panel2 px-4 py-1.5">
        <div className="flex items-center gap-1.5">
          <Btn on={r.enabled} label={r.enabled ? '● sending' : '○ send'} onClick={() => setR({ enabled: !r.enabled })} title="Stream the connected columns to Resolume over OSC" />
          <input className="input w-28 text-[11px]" value={r.host} onChange={(e) => setR({ host: e.target.value.trim() })} title="Resolume's machine (127.0.0.1 when it runs here)" />
          <input className="input w-16 text-[11px]" type="number" value={r.port} onChange={(e) => setR({ port: Number(e.target.value) || 7000 })} title="Resolume's OSC INPUT port (Preferences › OSC, 7000 by default)" />
        </div>
        <label className="flex items-center gap-1.5 font-mono text-[10px] text-muted" title="How many times a second the matrix sends (the patch's speedlim)">
          rate
          <input type="range" min={5} max={60} step={1} value={r.rateHz} onChange={(e) => setR({ rateHz: Number(e.target.value) })} className="w-24 accent-accent" />
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
              title={r.snapshots[i] ? `Snapshot ${i + 1} : ${r.snapshots[i]!.length} pins (click recalls, shift+click stores)` : `Snapshot ${i + 1} : empty (shift+click stores the pins now)`}
              className={`h-5 w-5 rounded font-mono text-[10px] ${r.snapshots[i] ? 'border border-accent2/70 bg-accent2/15 text-accent2' : 'border border-border text-muted hover:text-text'}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="relative flex shrink-0">
            <MidiLearnOverlay id="rand:resolume" />
            <button
              onClick={dice}
              className={`${TBTN} ${TBTN_IDLE} px-2 text-[13px] leading-none`}
              title="Roll the pins : every row gets none, one or two new connections, at random amounts, among the unfolded groups' float and toggle columns (never a trigger : no clip or column launches; never the composition master). ↶ puts the old pins back."
            >
              🎲
            </button>
          </span>
          {beforeDice && (
            <button
              onClick={() => { if (!r.locked) { setR({ cells: beforeDice }); setBeforeDice(null) } }}
              className={`${TBTN} ${TBTN_IDLE} px-2`}
              title={`Put back the ${beforeDice.length} pins from before the dice`}
            >
              ↶
            </button>
          )}
        </div>
        <div className="flex-1" />
        <Btn label="clear pins" onClick={() => { if (!r.locked && r.cells.length && confirm('Remove every connection?')) st().resoClearCells() }} title="Remove every connection (rows and columns stay)" />
        <Btn on={r.locked} danger label={r.locked ? '🔒 locked' : 'lock'} onClick={() => setR({ locked: !r.locked })} title="Lock the mapping : no connection, row or column can change (sending, snapshot recall and scene follow still work). Saved with the session." />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Matrix + its status line */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <div
              ref={scrollRef}
              className="absolute inset-0 overflow-auto"
              onMouseDown={onDown}
              onMouseMove={onMove}
              onMouseLeave={() => { hover.current = null; setStatus('') }}
              onDoubleClick={onDbl}
              onContextMenu={(e) => e.preventDefault()}
            >
              <div style={{ width: totalW, height: totalH }} />
            </div>
            {/* drawn over the scroller's view (never its scrollbars), clicks pass through */}
            <canvas ref={canvasRef} className="pointer-events-none absolute left-0 top-0 block" />
            {r.outputs.length === 0 && (
              <div className="pointer-events-none absolute inset-x-0 top-28 flex justify-center px-6" style={{ paddingLeft: LABEL_W }}>
                <div className="pointer-events-auto flex max-w-md flex-col items-center gap-3 rounded border border-border bg-panel px-6 py-5 text-center shadow-xl">
                  <span className="font-mono text-[12px] font-semibold uppercase tracking-[0.2em]">
                    Plug Palinopsia into <span className="text-accent2">Resolume</span>
                  </span>
                  <span className="text-[12px] leading-relaxed text-muted">
                    The rows are Palinopsia's signals, the columns Resolume's controls. A pin where they meet
                    sends that signal to that control, live.
                  </span>
                  <ol className="flex flex-col gap-1 text-left text-[12px] text-text">
                    <li><span className="mr-1.5 font-mono font-semibold text-accent">1</span>open your composition (.avc), or Learn its controls</li>
                    <li><span className="mr-1.5 font-mono font-semibold text-accent">2</span>click where a signal meets a control</li>
                    <li><span className="mr-1.5 font-mono font-semibold text-accent">3</span>press send</li>
                  </ol>
                  <div className="flex gap-2">
                    <Btn strong label={loading ? 'reading…' : 'Open .avc'} onClick={() => void openAvc()} />
                    <Btn label="Learn from Resolume" onClick={() => {
                      if (!oscEnabled) showToast(`Turn Palinopsia's OSC input on (osc tab) and point Resolume's OSC output at port ${oscPort}`, 'warn', 6000)
                      setLearning(true)
                    }} />
                  </div>
                </div>
              </div>
            )}
          </div>
          <div
            ref={statusRef}
            className="shrink-0 truncate border-t border-border bg-panel2 px-4 py-1 font-mono text-[10px] text-muted"
          >
            {IDLE}
          </div>
        </div>

        {/* Side panel */}
        <div className="flex w-72 shrink-0 flex-col gap-2.5 overflow-y-auto border-l border-border bg-panel p-3 text-[11px]">
          <Card title="add a row">
            <SearchSelect
              value=""
              options={sources}
              onChange={(v) => { if (r.locked) showToast('Locked', 'warn'); else st().resoAddInput(v) }}
              placeholder="+ Palinopsia signal…"
              resetAfterPick
              menuWidth={280}
              title="Any modulator, Meta knob, audio / vision / body feature, or any /opsia address"
            />
            <div className="flex flex-wrap gap-x-2.5 gap-y-1">
              {Object.entries(FAMILY).map(([k, f]) => (
                <span key={k} className="flex items-center gap-1 font-mono text-[9px] text-muted">
                  <span className="h-2 w-2 rounded-full" style={{ background: lightTheme ? f.light : f.dark }} />
                  {f.name}
                </span>
              ))}
            </div>
          </Card>

          <Card title="add an address by hand">
            <input className="input font-mono text-[11px]" value={custom.address} onChange={(e) => setCustom({ ...custom, address: e.target.value })} placeholder="/composition/…" />
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
          </Card>

          {selIn && (
            <Card title="row" color={famColor(selIn.source)}>
              <span className="text-[12px] font-semibold text-text">{resoSourceLabel(selIn.source)}</span>
              <Slider label="smooth" value={selIn.smooth} min={0} max={1} step={0.01} onChange={(v) => st().resoUpdateInput(selIn.id, { smooth: v })} title="Slew on the incoming signal (0 = raw)" />
              <Slider label="gain" value={selIn.gain} min={0} max={4} step={0.05} onChange={(v) => st().resoUpdateInput(selIn.id, { gain: v })} title="Scales the signal before it is clipped to 0..1" />
              <div className="flex gap-1.5">
                <Btn label="↑" onClick={() => st().resoMoveInput(selIn.id, -1)} title="Move the row up" />
                <Btn label="↓" onClick={() => st().resoMoveInput(selIn.id, 1)} title="Move the row down" />
                <div className="flex-1" />
                <Btn label="remove row" onClick={() => { st().resoRemoveInput(selIn.id); setSel(null) }} />
              </div>
            </Card>
          )}

          {selOut && (
            <Card title={`column · ${selOut.group}`} color={outGroupColor(selOut)}>
              <input className="input text-[12px]" value={selOut.label} onChange={(e) => st().resoUpdateOutput(selOut.id, { label: e.target.value })} title="Label" />
              <input className="input font-mono text-[10.5px]" value={selOut.address} onChange={(e) => st().resoUpdateOutput(selOut.id, { address: e.target.value.trim() })} title="The Resolume OSC address" />
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
              {selCell && selCellIn && (
                <div className="flex flex-col gap-1.5 border-t border-border pt-2">
                  <span className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
                    <span className="h-2 w-2 rounded-full" style={{ background: famColor(selCellIn.source) }} />
                    pin from {resoSourceLabel(selCellIn.source)}
                  </span>
                  <Slider label="amount" value={selCell.amount} min={0.05} max={1} step={0.01} onChange={(v) => st().resoSetCellAmount(selCell.i, selCell.o, v)} fmt={(v) => `${Math.round(v * 100)} %`} title="How much of this row reaches this column" />
                </div>
              )}
              <div className="flex gap-1.5">
                <Btn label="test" onClick={() => resoTest(selOut)} title="Send it once by hand : a float sweeps up and back, a trigger fires, a toggle flips" />
                <div className="flex-1" />
                <Btn label="remove column" onClick={() => { st().resoRemoveOutput(selOut.id); setSel(null) }} />
              </div>
            </Card>
          )}

          <div className="mt-auto flex flex-col gap-1 font-mono text-[10px] leading-snug text-muted">
            <span className="uppercase tracking-wide text-accent2">in Resolume</span>
            <span>Preferences › OSC › Input on, port {r.port}.</span>
            <span>Dashboard links are the usual targets : link any parameter to a dashboard dial in Resolume, then drive the link from here.</span>
            <span>Learn needs Resolume's OSC Output on, pointed at 127.0.0.1 : {oscPort} (Palinopsia's OSC input{oscEnabled ? '' : ', currently off'}).</span>
          </div>
        </div>
      </div>
    </div>
  )
}
