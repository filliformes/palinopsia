// The Seq page's Body rules lane : a timeline, one row per Body rule (as the
// Body page lists them), a block = "this rule is on from here to here". It
// counts in bars of the tempo or in real time (minutes and seconds) : the
// clock switch converts the blocks at the tempo, so they keep their place.
// Drag a rule's name onto the timeline (its own row), or draw on a row; drag a
// block to move it, its ends to resize it (bars or seconds; Shift : beats or
// tenths), Alt-drag to copy it; double-click it (or Enter) to type its start
// and length exactly; Delete or a right-click removes it. Every edit is one
// undo step (a drag writes once, on release). While it runs, a rule with
// blocks is on inside them and off outside; a rule switched by hand keeps it
// until the next edge on its row (the "held" mark). Engine : engine/ruleSeq.ts,
// model engine/ruleSeqModel.ts.
//
// The playhead, the live blocks and the readout are written from the window's
// own frames, never through a React render.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as RKeyboardEvent, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react'
import type { RuleBlock, RuleUnit } from '@shared/types'
import { useStore } from '../store'
import { soniBar } from '../audio/soniClock'
import { ruleSeqPlayhead, setRuleByHand, useRuleSeqHeld } from '../engine/ruleSeq'
import {
  RULE_LENGTHS, RULE_MAX_BARS, RULE_MAX_SEC, RULE_MIN_SEC, RULE_TIME_LENGTHS,
  clampRuleLength, convertRuleTimeline, defaultBlockLen, fmtBarBeat, fmtBarBeatNow, fmtBarsBeats, fmtBarsLen, fmtClock,
  meltRow, newBlockId, parseBarBeat, parseBarsBeats, parseClock, ruleHue, ruleUnit, unitGrid
} from '../engine/ruleSeqModel'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { ownerWindow } from './ownerWindow'
import { chip } from './sonifyUi'
import { showToast } from './Toast'
import { effectiveZoom } from './uiZoom'

const ROW_H = 24
const RULER_H = 20
const HEAD_W = 196
const MAX_ROWS = 12
const EDITOR_W = 300
/** How far the zoom goes in : a bar 160 px wide (a beat 40), a second 200 px
 *  (its tenths labeled). Zoom 1 fits the whole loop to the lane. */
const MAX_PX: Record<RuleUnit, number> = { bars: 160, time: 200 }
/** The time ruler : a label step in seconds and its finer lines, the first
 *  whose labels have room (46 px : "12:30.5") wins. */
const TIME_STEPS: Array<[number, number]> = [
  [0.1, 0], [0.2, 0.1], [0.5, 0.1], [1, 0.2], [2, 0.5], [5, 1], [10, 2], [15, 5], [30, 5],
  [60, 10], [120, 30], [300, 60], [600, 120], [900, 300], [1800, 300], [3600, 600]
]
const TIME_LABEL_PX = 46
const BAR_LABEL_PX = 22
/** A quick pick's label (30 s, then minutes). */
const timePick = (s: number): string => (s < 60 ? `${s}s` : `${s / 60}m`)
const timePickTitle = (s: number): string => (s < 60 ? `${s} seconds` : `${s / 60} minute${s === 60 ? '' : 's'}`)

const beatsPerBar = (): number => Math.max(1, soniBar())
/** A position in the lane's unit : bar.beat (from 1), or m:ss. */
const fmtPosU = (unit: RuleUnit, x: number): string => (unit === 'time' ? fmtClock(x) : fmtBarBeat(x, beatsPerBar()))
/** A length in the lane's unit : `4 bars`, or `1:30`. */
const fmtLenU = (unit: RuleUnit, len: number): string => (unit === 'time' ? fmtClock(len) : fmtBarsLen(len, beatsPerBar()))

/** The ruler's steps at this zoom : where labels go, the lines under them. */
function rulerSteps(unit: RuleUnit, px: number, bpb: number): { label: number; lines: Array<[number, number]> } {
  if (unit === 'bars') {
    let label = 128
    for (const e of [1, 2, 4, 8, 16, 32, 64, 128]) if (e * px >= BAR_LABEL_PX) { label = e; break }
    // (as before down to 6 px a bar; past that, 16- and 4-bar lines only)
    const lines: Array<[number, number]> = px >= 6 ? [[4, 0.75], [1, 0.35]] : [[16, 0.75], [4, 0.35]]
    if (px >= 40) lines.push([1 / bpb, 0.15])
    return { label, lines }
  }
  let pick = TIME_STEPS[TIME_STEPS.length - 1]
  for (const s of TIME_STEPS) if (s[0] * px >= TIME_LABEL_PX) { pick = s; break }
  const lines: Array<[number, number]> = [[pick[0], 0.75]]
  if (pick[1] && pick[1] * px >= 6) lines.push([pick[1], 0.3])
  return { label: pick[0], lines }
}
const gridStyle = (lines: Array<[number, number]>, L: number): CSSProperties => ({
  backgroundImage: lines.map(([, a]) => `linear-gradient(to right, rgb(var(--c-border) / ${a}) 1px, transparent 1px)`).join(', '),
  backgroundSize: lines.map(([s]) => `${(s / L) * 100}% 100%`).join(', ')
})

/** A block being moved, resized, drawn, or a rule being dropped onto the timeline. */
type Drag =
  | { kind: 'move' | 'left' | 'right'; id: string; rule: string; copy: boolean; grab: number; start: number; len: number; x0: number; moved: boolean }
  | { kind: 'draw'; rule: string; anchor: number; start: number; len: number; x0: number; moved: boolean }
  | { kind: 'drop'; rule: string; start: number | null; len: number }

export function RuleLane(): JSX.Element {
  const rules = useStore((s) => s.bodyControl.rules)
  const camera = useStore((s) => s.bodyControl.enabled)
  const t = useStore((s) => s.ruleSeq)
  const setRuleSeq = useStore((s) => s.setRuleSeq)
  const held = useRuleSeqHeld()
  const [sel, setSel] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  dragRef.current = drag
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  /** The block whose start and length are being typed, and where its editor sits. */
  const [edit, setEdit] = useState<{ id: string; x: number; y: number } | null>(null)
  const [zoom, setZoom] = useState(() => {
    const z = Number(localStorage.getItem('opsia.ruleSeqZoom'))
    return Number.isFinite(z) && z >= 1 ? z : 1
  })
  const setZ = (z: number): void => {
    setZoom(z)
    try { localStorage.setItem('opsia.ruleSeqZoom', String(Math.round(z * 1000) / 1000)) } catch { /* full */ }
  }

  const rootRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const headListRef = useRef<HTMLDivElement | null>(null)
  const playRef = useRef<HTMLDivElement | null>(null)
  const markRef = useRef<HTMLDivElement | null>(null)

  // the timeline's width on screen (how many labels and lines fit), and where
  // it is scrolled to (only the labels in view are drawn : an hour at full
  // zoom is 18,000 of them)
  const [gridW, setGridW] = useState(900)
  const [scrollX, setScrollX] = useState(0)
  const scrollQueued = useRef(false)
  useEffect(() => {
    const g = gridRef.current
    if (!g) return
    const ro = new ResizeObserver(() => setGridW(g.clientWidth || 900))
    ro.observe(g)
    return () => ro.disconnect()
  }, [rules.length > 0])

  const unit = ruleUnit(t)
  const isTime = unit === 'time'
  const { q: qU, min: minLen } = unitGrid(unit)
  const L = t.length
  const bpb = beatsPerBar()
  const ruleById = useMemo(() => new Map(rules.map((r) => [r.id, r])), [rules])
  // each rule's color : golden-angle steps down the list, so neighbor rows never
  // share a hue (a rule no longer listed : from its id)
  const hues = useMemo(() => new Map(rules.map((r, i) => [r.id, (172 + i * 137.508) % 360])), [rules])
  const color = (id: string, a = 1): string => `hsl(${Math.round(hues.get(id) ?? ruleHue(id))} 60% 56% / ${a})`
  const byRule = useMemo(() => {
    const m = new Map<string, RuleBlock[]>()
    for (const b of t.blocks) {
      if (!ruleById.has(b.rule)) continue // (a rule gone : its blocks leave with it)
      const a = m.get(b.rule)
      if (a) a.push(b)
      else m.set(b.rule, [b])
    }
    return m
  }, [t.blocks, ruleById])
  const pastEnd = t.blocks.filter((b) => ruleById.has(b.rule) && b.start >= L).length
  const defLen = defaultBlockLen(unit, L)

  // ── zoom : 1 fits the loop to the lane; in to a beat 40 px, a second 200 px
  const maxZoom = Math.max(8, (MAX_PX[unit] * L) / Math.max(100, gridW))
  const z = Math.min(zoom, maxZoom)
  /** Zoom to `want`, keeping the point under the pointer (or the middle of the
   *  view) where it is. */
  const zoomTo = (want: number, clientX?: number): void => {
    const g = gridRef.current
    const nz = Math.max(1, Math.min(maxZoom, want))
    if (!g || Math.abs(nz - z) < 1e-6) return
    const r = g.getBoundingClientRect()
    const k = effectiveZoom(g) // (pointer in screen pixels, scroll in the page's own)
    const off = clientX != null ? (clientX - r.left) / k : g.clientWidth / 2
    // (where the pointer is, as a share of the timeline : scrolled back under it
    // once the new width is laid out; a frame's wait was not always enough)
    zoomAnchor.current = { at: (g.scrollLeft + off) / Math.max(1, g.scrollWidth), off }
    setZ(nz)
  }
  const zoomAnchor = useRef<{ at: number; off: number } | null>(null)
  useLayoutEffect(() => {
    const g = gridRef.current
    const a = zoomAnchor.current
    zoomAnchor.current = null
    if (!g || !a) return
    g.scrollLeft = a.at * g.scrollWidth - a.off
    setScrollX(g.scrollLeft)
  }, [z])
  const zoomRef = useRef(zoomTo)
  zoomRef.current = zoomTo

  // ── geometry : the pointer in the lane's unit, through the box (UI zoom safe)
  const barAt = (clientX: number): number => {
    const r = innerRef.current?.getBoundingClientRect()
    if (!r || r.width <= 0) return 0
    return ((clientX - r.left) / r.width) * L
  }
  /** The snap : a bar or a second; Shift : a beat or a tenth. */
  const step = (fine: boolean): number => (isTime ? (fine ? 0.1 : 1) : fine ? 1 / bpb : 1)
  const snapFloor = (x: number, s: number): number => qU(Math.floor(x / s + 1e-6) * s)
  const snapRound = (x: number, s: number): number => qU(Math.round(x / s) * s)
  const clampStart = (start: number, len: number): number => Math.max(0, Math.min(L - len, start))

  // ── writing (one store write per edit : one undo step) ─────────────────
  const commit = (blocks: RuleBlock[], rule: string, keep?: string): void => {
    setRuleSeq({ blocks: meltRow(blocks, rule, keep, qU) })
  }
  const addBlock = (rule: string, start: number, len: number): void => {
    const id = newBlockId()
    commit([...t.blocks, { id, rule, start: qU(start), len: qU(len) }], rule, id)
    setSel(id)
  }
  const removeBlock = (id: string): void => {
    setRuleSeq({ blocks: t.blocks.filter((b) => b.id !== id) })
    if (sel === id) setSel(null)
  }
  const clearRow = (rule: string): void => setRuleSeq({ blocks: t.blocks.filter((b) => b.rule !== rule) })
  /** A block's typed start and length, kept inside the loop. */
  const applyEdit = (id: string, start: number, len: number): void => {
    setEdit(null)
    const blk = t.blocks.find((b) => b.id === id)
    if (!blk) return
    const s = qU(Math.max(0, Math.min(L - minLen, start)))
    const l = qU(Math.max(minLen, Math.min(L - s, len)))
    if (s === blk.start && l === blk.len) return
    commit(t.blocks.map((b) => (b.id === id ? { ...b, start: s, len: l } : b)), blk.rule, id)
    setSel(id)
  }
  /** The other clock : the blocks converted at the tempo now (one undo step). */
  const switchUnit = (to: RuleUnit): void => {
    if (to === unit) return
    const st = useStore.getState()
    const { timeline, dropped } = convertRuleTimeline(st.ruleSeq, to, st.composition.bpm, bpb)
    st.setRuleSeq({ ...timeline, unit: to })
    setSel(null)
    setEdit(null)
    setZ(1)
    if (gridRef.current) gridRef.current.scrollLeft = 0
    if (dropped) showToast(`${dropped} block${dropped === 1 ? '' : 's'} past bar ${RULE_MAX_BARS} left out (Ctrl+Z brings them back)`, 'warn')
  }
  /** Open the typed editor under a block (or where the lane shows it). */
  const openEditor = (id: string, el?: HTMLElement | null): void => {
    const root = rootRef.current
    if (!root) return
    const blockEl = el ?? innerRef.current?.querySelector<HTMLElement>(`[data-block="${id}"]`)
    const k = effectiveZoom(root)
    const rr = root.getBoundingClientRect()
    const gr = gridRef.current?.getBoundingClientRect()
    const br = blockEl?.getBoundingClientRect()
    const left = br ? Math.max(br.left, gr?.left ?? br.left) : (gr?.left ?? rr.left)
    const x = Math.max(0, Math.min(root.offsetWidth - EDITOR_W, (left - rr.left) / k))
    const y = br ? (br.bottom - rr.top) / k + 4 : RULER_H + 30
    setMenu(null)
    setSel(id)
    setEdit({ id, x, y })
  }

  // ── pointer : blocks, drawing, the names dropped onto their rows ──────────
  const onBlockDown = (e: RPointerEvent<HTMLDivElement>, b: RuleBlock): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    const edge = Math.min(6, r.width / 3)
    const kind = e.clientX - r.left < edge ? 'left' : r.right - e.clientX < edge ? 'right' : 'move'
    setSel(b.id)
    el.setPointerCapture(e.pointerId)
    setDrag({ kind, id: b.id, rule: b.rule, copy: kind === 'move' && e.altKey, grab: barAt(e.clientX) - b.start, start: b.start, len: Math.min(b.len, L), x0: e.clientX, moved: false })
  }
  const onRowDown = (e: RPointerEvent<HTMLDivElement>, rule: string): void => {
    if (e.button !== 0) return
    setSel(null)
    const s = step(e.shiftKey)
    const a = Math.max(0, Math.min(L - s, snapFloor(barAt(e.clientX), s)))
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ kind: 'draw', rule, anchor: a, start: a, len: s, x0: e.clientX, moved: false })
  }
  const onNameDown = (e: RPointerEvent<HTMLSpanElement>, rule: string): void => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ kind: 'drop', rule, start: null, len: defLen })
  }
  const onMove = (e: RPointerEvent<HTMLElement>): void => {
    const d = dragRef.current
    if (!d) return
    const s = step(e.shiftKey)
    const x = barAt(e.clientX)
    if (d.kind === 'drop') {
      const g = gridRef.current?.getBoundingClientRect()
      const over = !!g && e.clientX >= g.left && e.clientX <= g.right && e.clientY >= g.top && e.clientY <= g.bottom
      const start = over ? clampStart(snapFloor(x, s), d.len) : null
      if (start !== d.start) setDrag({ ...d, start })
      return
    }
    const moved = d.moved || Math.abs(e.clientX - d.x0) > 3
    if (d.kind === 'draw') {
      const a = d.anchor
      const start = x >= a ? a : Math.max(0, snapFloor(x, s))
      const end = x >= a ? Math.min(L, Math.max(a + s, qU(Math.ceil(x / s - 1e-6) * s))) : a + s
      setDrag({ ...d, start, len: qU(end - start), moved })
      return
    }
    const blk = t.blocks.find((b) => b.id === d.id)
    if (!blk) return
    const end0 = Math.min(L, blk.start + blk.len)
    if (d.kind === 'move') {
      const start = clampStart(snapRound(x - d.grab, s), d.len)
      if (start !== d.start || moved !== d.moved) setDrag({ ...d, start, moved })
    } else if (d.kind === 'left') {
      const start = Math.max(0, Math.min(end0 - Math.max(s, minLen), snapRound(x, s)))
      setDrag({ ...d, start, len: qU(end0 - start), moved })
    } else {
      const end = Math.min(L, Math.max(blk.start + Math.max(s, minLen), snapRound(x, s)))
      setDrag({ ...d, len: qU(end - blk.start), moved })
    }
  }
  const onUp = (): void => {
    const d = dragRef.current
    setDrag(null)
    if (!d) return
    if (d.kind === 'drop') {
      if (d.start != null) addBlock(d.rule, d.start, d.len)
      return
    }
    if (d.kind === 'draw') {
      if (d.moved) addBlock(d.rule, d.start, d.len)
      return
    }
    const blk = t.blocks.find((b) => b.id === d.id)
    if (!blk || !d.moved) return
    if (d.start === blk.start && d.len === blk.len && !d.copy) return
    if (d.copy) {
      const id = newBlockId()
      commit([...t.blocks, { id, rule: d.rule, start: d.start, len: d.len }], d.rule, id)
      setSel(id)
    } else commit(t.blocks.map((b) => (b.id === d.id ? { ...b, start: d.start, len: d.len } : b)), d.rule, d.id)
  }

  // Delete / Backspace removes the chosen block, Enter types its start and
  // length (in the window the page is in)
  useEffect(() => {
    if (!sel) return
    const view = ownerWindow(rootRef.current)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Delete' && e.key !== 'Backspace' && e.key !== 'Enter') return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.tagName === 'BUTTON' || el.isContentEditable)) return
      const st = useStore.getState()
      if (!st.ruleSeq.blocks.some((b) => b.id === sel)) return
      e.preventDefault()
      if (e.key === 'Enter') {
        openEditor(sel)
        return
      }
      st.setRuleSeq({ blocks: st.ruleSeq.blocks.filter((b) => b.id !== sel) })
      setSel(null)
    }
    view.addEventListener('keydown', onKey)
    return () => view.removeEventListener('keydown', onKey)
  }, [sel])

  // a block gone (an undo, its rule deleted) : its editor goes with it
  const editBlock = edit ? t.blocks.find((b) => b.id === edit.id) ?? null : null
  useEffect(() => {
    if (edit && !editBlock) setEdit(null)
  }, [edit, editBlock])

  // The playhead, the blocks it is in, from the window's own frames
  useEffect(() => {
    const view = ownerWindow(rootRef.current)
    let id = 0
    let lastLive: string | null = null // (the first frame writes every block)
    const f = (): void => {
      id = view.requestAnimationFrame(f)
      if (view.document.hidden) return
      const st = useStore.getState()
      const ph = ruleSeqPlayhead()
      // (the frame a clock switch lands on : the playhead still counts the old one)
      const same = ph.unit === ruleUnit(st.ruleSeq)
      const on = st.ruleSeqOn && ph.started && !ph.waiting && same
      const pos = same ? ph.pos : 0
      const x = `${(Math.max(0, Math.min(L, pos)) / L) * 100}%`
      if (playRef.current) {
        playRef.current.style.left = x
        playRef.current.style.opacity = on ? '1' : st.ruleSeqOn ? '0.5' : '0.25'
      }
      if (markRef.current) {
        markRef.current.style.left = x
        markRef.current.style.opacity = on ? '1' : '0.35'
      }
      // which blocks the playhead is in (a glow) : written only when it changes
      const live = on
        ? st.ruleSeq.blocks.filter((b) => pos >= b.start && pos < Math.min(L, b.start + b.len)).map((b) => b.id).join(',')
        : ''
      if (live !== lastLive) {
        lastLive = live
        const ids = new Set(live ? live.split(',') : [])
        innerRef.current?.querySelectorAll<HTMLElement>('[data-block]').forEach((el) => {
          el.style.boxShadow = ids.has(el.dataset.block ?? '') ? 'inset 0 0 0 1px rgb(var(--c-accent)), 0 0 6px rgb(var(--c-accent) / 0.45)' : ''
        })
      }
    }
    id = view.requestAnimationFrame(f)
    return () => view.cancelAnimationFrame(id)
  }, [L, unit, t.blocks])

  // Ctrl + wheel over the timeline : zoom in or out around the pointer
  useEffect(() => {
    const g = gridRef.current
    if (!g) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      e.stopPropagation()
      zoomRef.current(z * (e.deltaY < 0 ? Math.SQRT2 : Math.SQRT1_2), e.clientX)
    }
    g.addEventListener('wheel', onWheel, { passive: false })
    return () => g.removeEventListener('wheel', onWheel)
  }, [z, rules.length > 0])

  // ── what is drawn ─────────────────────────────────────────────────────────
  const unitPct = 100 / L
  const pxPerUnit = (gridW * z) / L
  const ruler = rulerSteps(unit, pxPerUnit, bpb)
  const grid = gridStyle(ruler.lines, L)
  const rowsH = Math.min(rules.length, MAX_ROWS) * ROW_H
  // the ruler's labels in view (and one step either side)
  const labels = useMemo(() => {
    const innerW = Math.max(1, gridW * z)
    const x0 = (scrollX / innerW) * L
    const x1 = ((scrollX + gridW) / innerW) * L
    const s = ruler.label
    const out: Array<{ at: number; text: string }> = []
    for (let k = Math.max(0, Math.floor(x0 / s) - 1); k * s < Math.min(L, x1 + s) && out.length < 400; k++) {
      const at = k * s
      out.push({ at, text: isTime ? fmtClock(at, s < 1 ? 1 : 0) : String(Math.round(at) + 1) })
    }
    return out
  }, [gridW, z, scrollX, L, ruler.label, isTime])

  const blockMenu = (e: RMouseEvent, b: RuleBlock): void => {
    e.preventDefault()
    e.stopPropagation()
    setSel(b.id)
    const el = e.currentTarget as HTMLElement
    const name = ruleById.get(b.rule)?.name ?? 'this rule'
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'Start and length…',
          title: `Type where it starts and how long it lasts, exactly (${isTime ? 'm:ss, tenths too' : 'bar.beat and bars.beats'}). Double-click a block, or Enter, does the same`,
          onClick: () => openEditor(b.id, el)
        },
        { label: 'Delete this block', danger: true, onClick: () => removeBlock(b.id) },
        {
          label: 'Copy it right after',
          disabled: b.start + 2 * b.len > L + 1e-6,
          title: 'A copy of the same length, starting where this one ends (when it fits in the loop)',
          onClick: () => addBlock(b.rule, b.start + b.len, b.len)
        },
        { divider: true, label: '' },
        { label: `Clear the row of ${name}`, onClick: () => clearRow(b.rule) }
      ]
    })
  }
  const rowMenu = (e: RMouseEvent, rule: string, at: number | null): void => {
    e.preventDefault()
    const name = ruleById.get(rule)?.name ?? 'this rule'
    const items: MenuItem[] = []
    if (at != null) {
      const s = clampStart(snapFloor(at, 1), defLen)
      items.push({ label: `Add a block here (${fmtLenU(unit, defLen)})`, onClick: () => addBlock(rule, s, defLen) })
    }
    items.push(
      { label: 'On for the whole loop', title: `One block from the ${isTime ? 'start' : 'first bar'} to the ${isTime ? 'end' : 'last'}`, onClick: () => commit([...t.blocks.filter((b) => b.rule !== rule), { id: newBlockId(), rule, start: 0, len: L }], rule) },
      { label: `Clear the row of ${name}`, disabled: !byRule.get(rule)?.length, onClick: () => clearRow(rule) }
    )
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  if (!rules.length) {
    return (
      <p className="px-1 py-2 text-[11px] text-muted">
        No Body rules yet. Make some on the Body page (B), then come back : each rule gets a row here,
        and its blocks switch it on and off over the bars, or over minutes and seconds.
      </p>
    )
  }

  const zoomLabel = `${z < 10 ? Math.round(z * 10) / 10 : Math.round(z)}×`
  const fine = isTime ? 'tenths' : 'beats'
  return (
    <div ref={rootRef} className="relative flex flex-col gap-1.5" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}>
      {/* the clock, the loop, the zoom, how to play it */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className="flex items-center gap-1"
          title="The clock the timeline counts on : bars of the tempo (of Ableton Link's bar while Link is on), or time, real minutes and seconds that the tempo never moves (and that start at once on play). Switching converts every block at the tempo now, so it keeps its place in time (to the nearest beat into bars). Ctrl+Z switches back"
        >
          <span className="font-mono text-[9px] uppercase text-muted">clock</span>
          <button data-rule-unit="bars" onClick={() => switchUnit('bars')} className={chip(!isTime)}>bars</button>
          <button data-rule-unit="time" onClick={() => switchUnit('time')} className={chip(isTime)}>time</button>
        </span>
        <span className="flex items-center gap-1">
          <span
            className="font-mono text-[9px] uppercase text-muted"
            title={isTime ? `The loop's length in minutes and seconds (${RULE_MIN_SEC} s to ${RULE_MAX_SEC / 60} min)` : `The loop's length in bars (of the tempo, or of Ableton Link's bar while Link is on), 1 to ${RULE_MAX_BARS}`}
          >length</span>
          {isTime
            ? RULE_TIME_LENGTHS.map((n) => (
                <button key={n} onClick={() => setRuleSeq({ length: n })} className={`${chip(L === n)} px-1 text-center`} title={`A loop of ${timePickTitle(n)}`}>{timePick(n)}</button>
              ))
            : RULE_LENGTHS.map((n) => (
                <button key={n} onClick={() => setRuleSeq({ length: n })} className={`${chip(L === n)} w-7 px-0 text-center`} title={`A loop of ${n} bars`}>{n}</button>
              ))}
          <TypedField
            key={unit}
            data="rule-length"
            value={isTime ? fmtClock(L) : String(L)}
            parse={isTime ? parseClock : (s) => (/^\s*\d+\s*$/.test(s) ? Number(s) : null)}
            onApply={(v) => {
              const n = clampRuleLength(unit, v)
              if (n !== L) setRuleSeq({ length: n })
            }}
            className={isTime ? 'w-[60px]' : 'w-[38px]'}
            title={isTime
              ? `Type the loop's length : 90 (seconds), 1:30, 1:30.5, 45:00 or 1:30:00, from ${RULE_MIN_SEC} seconds to ${RULE_MAX_SEC / 60} minutes. Enter applies, Esc puts it back`
              : `Type the loop's length in whole bars, 1 to ${RULE_MAX_BARS}. Enter applies, Esc puts it back`}
          />
        </span>
        <button
          onClick={() => setRuleSeq({ loop: !t.loop })}
          className={chip(t.loop)}
          title={t.loop ? 'Loops : after the end it starts again from the top. Click : play it once, then stop' : 'Plays once, then stops (the rules stay as the end leaves them). Click : loop'}
        >{t.loop ? '⟳ loop' : '→ once'}</button>
        <span className="flex items-center gap-1" title="Zoom the timeline (Ctrl + wheel over it too, around the pointer). fit : the whole loop in the lane">
          <span className="font-mono text-[9px] uppercase text-muted">zoom</span>
          <button data-rule-zoom="fit" className={chip(z <= 1)} onClick={() => zoomTo(1)} disabled={z <= 1}>fit</button>
          <button className={chip(false)} onClick={() => zoomTo(z / 2)} disabled={z <= 1}>−</button>
          <span className="w-7 text-center font-mono text-[9px] text-muted">{zoomLabel}</span>
          <button className={chip(false)} onClick={() => zoomTo(z * 2)} disabled={z >= maxZoom - 1e-6}>+</button>
        </span>
        {pastEnd > 0 && (
          <span className="font-mono text-[9px] text-accent2" title="Blocks that start after the end of this loop : kept, they play again with a longer loop">
            {pastEnd} past the end
          </span>
        )}
        <span
          className="min-w-0 flex-1 truncate font-mono text-[9px] text-muted/80"
          title={`Drag a rule's name onto the timeline, or draw on its row, to switch it on for that stretch. Drag a block to move it, its ends to resize it (by ${isTime ? 'whole seconds' : 'bars'}; Shift : by ${isTime ? 'tenths of a second' : 'beats'}). Alt-drag : a copy. Double-click a block (or Enter) : type its start and length exactly. Delete or right-click : remove. Double-click a row : a block there.`}
        >
          drag a name onto its row or draw · Shift : {fine} · Alt : copy · double-click : exact · Delete : remove
        </span>
        {!camera && (
          <span className="font-mono text-[9px] text-muted" title="Body control is off (Body page) : the timeline still switches the rules on and off, but nothing fires them until the camera is on">
            camera off
          </span>
        )}
        <button
          onClick={() => { setRuleSeq({ blocks: [] }); setSel(null) }}
          disabled={!t.blocks.length}
          className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted hover:text-accent disabled:opacity-40"
          title="Remove every block (Ctrl+Z brings them back)"
        >clear</button>
      </div>

      <div className="flex overflow-hidden rounded border border-border/70 bg-bg/40">
        {/* the rules, one row each (drag a name onto the timeline) */}
        <div className="shrink-0 border-r border-border/70 bg-panel2/30" style={{ width: HEAD_W }}>
          <div className="flex items-center border-b border-border/70 px-2 font-mono text-[9px] uppercase tracking-wide text-muted" style={{ height: RULER_H }}>
            rules · {rules.length}
          </div>
          <div ref={headListRef} className="overflow-hidden" style={{ height: rowsH }}>
            {rules.map((r) => {
              const has = !!byRule.get(r.id)?.length
              const isHeld = held.has(r.id)
              return (
                <div
                  key={r.id}
                  className="flex items-center gap-1.5 border-b border-border/30 px-2"
                  style={{ height: ROW_H }}
                  onContextMenu={(e) => rowMenu(e, r.id, null)}
                >
                  <button
                    data-rule-dot={r.id}
                    onClick={() => setRuleByHand(r.id, !r.enabled)}
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${r.enabled ? '' : 'ring-1 ring-border hover:ring-accent'}`}
                    style={r.enabled ? { background: color(r.id) } : undefined}
                    title={`${r.enabled ? 'On now : it fires when its gesture comes' : 'Off now : its gesture does nothing'}. Click to switch it by hand (while the timeline runs, your hand holds until the next block edge on its row)`}
                  />
                  <span
                    data-rule-name={r.id}
                    onPointerDown={(e) => onNameDown(e, r.id)}
                    className={`min-w-0 flex-1 cursor-grab truncate rounded-sm px-1.5 py-[1px] font-mono text-[10px] ${has ? 'text-text' : 'text-muted'}`}
                    style={{ borderLeft: `3px solid ${color(r.id)}`, background: color(r.id, has ? 0.16 : 0.07), touchAction: 'none' }}
                    title={`${r.name}${r.osc ? ` (/body/${r.osc})` : ''} : drag onto the timeline for a block of ${fmtLenU(unit, defLen)}. ${has ? 'While the timeline runs it is on inside its blocks, off outside them.' : 'No blocks : the timeline leaves it alone.'} Right-click : more`}
                  >
                    {r.name}
                  </span>
                  {isHeld && (
                    <span
                      data-rule-held
                      className="shrink-0 rounded px-1 font-mono text-[8px] uppercase leading-[14px] text-accent2 ring-1 ring-accent2/60"
                      title="Held by hand : you switched it while the timeline runs. It keeps what you set until the next block edge on its row, then the timeline takes it back"
                    >held</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* the timeline */}
        <div
          ref={gridRef}
          data-rule-grid
          className="relative min-w-0 flex-1 overflow-x-auto overflow-y-auto"
          style={{ height: RULER_H + rowsH + (z > 1 ? 10 : 0) }}
          onScroll={(e) => {
            const g = e.currentTarget
            if (headListRef.current) headListRef.current.scrollTop = g.scrollTop
            if (scrollQueued.current) return
            scrollQueued.current = true
            ownerWindow(g).requestAnimationFrame(() => {
              scrollQueued.current = false
              setScrollX(g.scrollLeft)
            })
          }}
        >
          <div ref={innerRef} className="relative" style={{ width: `${z * 100}%`, minHeight: RULER_H + rules.length * ROW_H }}>
            {/* the ruler : bar numbers or m:ss, the playhead's mark */}
            <div className="sticky top-0 z-20 border-b border-border/70 bg-panel" style={{ height: RULER_H }}>
              <div className="absolute inset-0" style={grid} />
              {labels.map((l) => (
                <span key={l.at} className="absolute top-[3px] whitespace-nowrap pl-1 font-mono text-[9px] text-muted" style={{ left: `${l.at * unitPct}%` }}>{l.text}</span>
              ))}
              <div ref={markRef} className="pointer-events-none absolute bottom-0 -ml-[4px] h-0 w-0 border-x-[4px] border-t-[6px] border-x-transparent border-t-accent" style={{ left: 0 }} />
            </div>
            {rules.map((r) => {
              const bs = byRule.get(r.id) ?? []
              const ghost = drag && drag.rule === r.id && (drag.kind === 'draw' ? drag.moved : drag.kind === 'drop' ? drag.start != null : drag.copy)
                ? { start: drag.kind === 'drop' ? drag.start ?? 0 : drag.start, len: drag.len }
                : null
              return (
                <div
                  key={r.id}
                  data-rule-row={r.id}
                  className="relative border-b border-border/30"
                  style={{ height: ROW_H, ...grid }}
                  onPointerDown={(e) => onRowDown(e, r.id)}
                  onDoubleClick={(e) => {
                    const s = clampStart(snapFloor(barAt(e.clientX), 1), defLen)
                    addBlock(r.id, s, defLen)
                  }}
                  onContextMenu={(e) => rowMenu(e, r.id, barAt(e.clientX))}
                >
                  {bs.map((b) => {
                    const moving = drag && 'id' in drag && drag.id === b.id && !drag.copy
                    const start = moving ? drag.start : b.start
                    const len = moving ? drag.len : b.len
                    const isSel = sel === b.id
                    return (
                      <div
                        key={b.id}
                        data-block={b.id}
                        onPointerDown={(e) => onBlockDown(e, b)}
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          openEditor(b.id, e.currentTarget)
                        }}
                        onContextMenu={(e) => blockMenu(e, b)}
                        className={`absolute top-[2px] bottom-[2px] flex cursor-grab items-center overflow-hidden rounded-sm ${isSel ? 'z-10 ring-1 ring-text/70' : ''} ${b.start >= L ? 'hidden' : ''}`}
                        style={{
                          left: `${start * unitPct}%`,
                          width: `${len * unitPct}%`,
                          background: color(r.id, 0.34),
                          borderLeft: `3px solid ${color(r.id)}`,
                          touchAction: 'none'
                        }}
                        title={`${r.name} : on for ${fmtLenU(unit, len)}, from ${fmtPosU(unit, start)} until ${fmtPosU(unit, start + len)}. Drag to move, its ends to resize (Shift : ${fine}), Alt-drag to copy, double-click to type its start and length, Delete or right-click to remove`}
                      >
                        <span className="pointer-events-none min-w-0 flex-1 truncate px-1 font-mono text-[9px] text-text/90">{r.name}</span>
                        <span data-block-len className="pointer-events-none shrink-0 pr-1 font-mono text-[8px] text-text/60">{fmtLenU(unit, len)}</span>
                        {/* the ends : resize */}
                        <span className="absolute inset-y-0 left-0 w-[6px] cursor-ew-resize" />
                        <span className="absolute inset-y-0 right-0 w-[6px] cursor-ew-resize" />
                      </div>
                    )
                  })}
                  {ghost && (
                    <div
                      className="pointer-events-none absolute top-[2px] bottom-[2px] rounded-sm border border-dashed"
                      style={{ left: `${ghost.start * unitPct}%`, width: `${ghost.len * unitPct}%`, borderColor: color(r.id), background: color(r.id, 0.18) }}
                    />
                  )}
                </div>
              )
            })}
            {/* the playhead */}
            <div ref={playRef} className="pointer-events-none absolute bottom-0 z-10 w-px bg-accent" style={{ top: RULER_H, left: 0, opacity: 0.25 }} />
          </div>
        </div>
      </div>
      {edit && editBlock && (
        <BlockEditor
          key={edit.id}
          unit={unit}
          bpb={bpb}
          block={editBlock}
          name={ruleById.get(editBlock.rule)?.name ?? 'a rule'}
          color={color(editBlock.rule)}
          length={L}
          x={edit.x}
          y={edit.y}
          onApply={(s, l) => applyEdit(edit.id, s, l)}
          onClose={() => setEdit(null)}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  )
}

/** A box a value is typed into : Enter (or leaving it) applies when it reads,
 *  Esc puts back what it showed. */
function TypedField({ value, parse, onApply, className, title, data }: {
  value: string
  parse: (s: string) => number | null
  onApply: (v: number) => void
  className: string
  title: string
  data?: string
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const draftRef = useRef<string | null>(null)
  const done = (apply: boolean): void => {
    const d = draftRef.current
    draftRef.current = null
    setDraft(null)
    if (!apply || d == null) return
    const v = parse(d)
    if (v != null) onApply(v)
  }
  const bad = draft != null && parse(draft) == null
  return (
    <input
      data-typed={data}
      value={draft ?? value}
      spellCheck={false}
      onChange={(e) => {
        draftRef.current = e.target.value
        setDraft(e.target.value)
      }}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e: RKeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          done(true)
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          done(false)
          e.currentTarget.blur()
        }
      }}
      onBlur={() => done(true)}
      className={`rounded border bg-bg/60 px-1 py-[1px] text-center font-mono text-[9px] text-text outline-none focus:border-accent ${bad ? 'border-danger' : 'border-border'} ${className}`}
      title={title}
    />
  )
}

/** A block's start and length, typed exactly : in time m:ss (90, 1:30,
 *  1:30.5), in bars bar.beat and bars.beats. Enter applies (kept inside the
 *  loop), Esc or a press elsewhere cancels. */
function BlockEditor({ unit, bpb, block, name, color, length, x, y, onApply, onClose }: {
  unit: RuleUnit
  bpb: number
  block: RuleBlock
  name: string
  color: string
  length: number
  x: number
  y: number
  onApply: (start: number, len: number) => void
  onClose: () => void
}): JSX.Element {
  const isTime = unit === 'time'
  const [s, setS] = useState(() => (isTime ? fmtClock(block.start) : fmtBarBeat(block.start, bpb)))
  const [l, setL] = useState(() => (isTime ? fmtClock(block.len) : fmtBarsBeats(block.len, bpb)))
  const boxRef = useRef<HTMLDivElement | null>(null)
  const firstRef = useRef<HTMLInputElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    firstRef.current?.focus()
    firstRef.current?.select()
  }, [])
  // a press anywhere else puts it away, nothing applied
  useEffect(() => {
    const doc = boxRef.current?.ownerDocument
    if (!doc) return
    const down = (e: PointerEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) closeRef.current()
    }
    doc.addEventListener('pointerdown', down, true)
    return () => doc.removeEventListener('pointerdown', down, true)
  }, [])
  const ps = isTime ? parseClock(s) : parseBarBeat(s, bpb)
  const pl = isTime ? parseClock(l) : parseBarsBeats(l, bpb)
  const { q, min } = unitGrid(unit)
  const cs = ps != null ? q(Math.max(0, Math.min(length - min, ps))) : null
  const cl = cs != null && pl != null ? q(Math.max(min, Math.min(length - cs, pl))) : null
  const cut = cs != null && cl != null && ps != null && pl != null && (Math.abs(cs - q(ps)) > 1e-9 || Math.abs(cl - q(pl)) > 1e-9)
  const ok = cs != null && cl != null
  const apply = (): void => {
    if (ok) onApply(cs, cl)
  }
  const onKey = (e: RKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      apply()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }
  const fmtPos = (v: number): string => (isTime ? fmtClock(v) : fmtBarBeat(v, bpb))
  const fmtLen = (v: number): string => (isTime ? fmtClock(v) : fmtBarsLen(v, bpb))
  const field = (bad: boolean): string =>
    `w-[76px] rounded border bg-bg/60 px-1 py-[1px] font-mono text-[10px] text-text outline-none focus:border-accent ${bad ? 'border-danger' : 'border-border'}`
  return (
    <div
      ref={boxRef}
      data-rule-editor
      className="absolute z-30 flex flex-col gap-1 rounded border border-border bg-panel px-2 py-1.5 shadow-lg"
      style={{ left: x, top: y, width: EDITOR_W }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-text">{name}</span>
        <span className="shrink-0 font-mono text-[8px] uppercase text-muted">{isTime ? 'time' : 'bars'}</span>
      </div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 font-mono text-[9px] uppercase text-muted" title={isTime ? 'Where it starts : 90 (seconds), 1:30, 1:30.5, 1:02:30' : 'Where it starts : bar.beat, from 1 (5 = bar 5, 5.3 = its third beat)'}>
          start
          <input ref={firstRef} data-edit="start" value={s} spellCheck={false} onChange={(e) => setS(e.target.value)} onKeyDown={onKey} className={field(ps == null)} placeholder={isTime ? 'm:ss.s' : 'bar.beat'} />
        </label>
        <label className="flex items-center gap-1 font-mono text-[9px] uppercase text-muted" title={isTime ? 'How long it lasts : 90 (seconds), 1:30, 1:30.5, 5m' : 'How long it lasts : bars.beats (4 = four bars, 2.1 = two bars and a beat, 0.3 = three beats), or 3 beats, 2 bars'}>
          length
          <input data-edit="len" value={l} spellCheck={false} onChange={(e) => setL(e.target.value)} onKeyDown={onKey} className={field(pl == null)} placeholder={isTime ? 'm:ss.s' : 'bars.beats'} />
        </label>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={`min-w-0 flex-1 truncate font-mono text-[9px] ${ok ? (cut ? 'text-accent2' : 'text-muted') : 'text-danger'}`} data-edit-reads>
          {ok
            ? `${fmtLen(cl)}, ${fmtPos(cs)} to ${fmtPos(cs + cl)}${cut ? ' (kept in the loop)' : ''}`
            : isTime ? 'type m:ss, like 1:30.5' : 'type bar.beat, and bars.beats'}
        </span>
        <button onClick={apply} disabled={!ok} className={`${chip(true)} disabled:opacity-40`} title="Apply (Enter)">apply</button>
        <button onClick={onClose} className={chip(false)} title="Cancel (Esc)">cancel</button>
      </div>
    </div>
  )
}

/** The lane header's readout : where the timeline is (bar.beat of the loop, or
 *  m:ss of it). */
export function RulePosition(): JSX.Element {
  const ref = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    const view = ownerWindow(ref.current)
    let id = 0
    let shown = ''
    const f = (): void => {
      id = view.requestAnimationFrame(f)
      if (view.document.hidden || !ref.current) return
      const st = useStore.getState()
      const t = st.ruleSeq
      const time = ruleUnit(t) === 'time'
      const ph = ruleSeqPlayhead()
      const pos = ph.unit === ruleUnit(t) ? ph.pos : 0
      const txt = !st.ruleSeqOn
        ? (t.blocks.length ? 'stopped' : 'no blocks yet')
        : time
          ? `${fmtClock(Math.floor(ph.started ? pos : 0), 0)} of ${fmtClock(t.length)}`
          : ph.waiting || !ph.started ? 'waits for the bar' : `bar ${fmtBarBeatNow(pos, beatsPerBar())} of ${t.length}`
      if (txt !== shown) {
        shown = txt
        ref.current.textContent = txt
      }
    }
    id = view.requestAnimationFrame(f)
    return () => view.cancelAnimationFrame(id)
  }, [])
  return <span ref={ref} data-rule-pos className="w-[120px] shrink-0 font-mono text-[10px] tabular-nums text-muted" title="Where the timeline is : bar and beat of its loop, or minutes and seconds of it" />
}
