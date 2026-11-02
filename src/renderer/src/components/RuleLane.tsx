// The Seq page's Body rules lane : a timeline in bars, one row per Body rule
// (as the Body page lists them), a block = "this rule is on from here to here".
// Drag a rule's name onto the timeline (its own row), or draw on a row; drag a
// block to move it, its ends to resize it (bars; Shift : beats), Alt-drag to
// copy it; Delete or a right-click removes it. Every edit is one undo step (a
// drag writes once, on release). While it runs, a rule with blocks is on inside
// them and off outside; a rule switched by hand keeps it until the next edge on
// its row (the "held" mark). Engine : engine/ruleSeq.ts, model
// engine/ruleSeqModel.ts.
//
// The playhead, the live blocks and the readout are written from the window's
// own frames, never through a React render.

import { useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react'
import type { RuleBlock } from '@shared/types'
import { useStore } from '../store'
import { soniBar } from '../audio/soniClock'
import { ruleSeqPlayhead, setRuleByHand, useRuleSeqHeld } from '../engine/ruleSeq'
import { RULE_LENGTHS, RULE_MIN_LEN, meltRow, newBlockId, q48, ruleHue } from '../engine/ruleSeqModel'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { ownerWindow } from './ownerWindow'
import { chip } from './sonifyUi'

const ROW_H = 24
const RULER_H = 20
const HEAD_W = 196
const MAX_ROWS = 12
const ZOOMS = [1, 2, 4, 8]

const beatsPerBar = (): number => Math.max(1, soniBar())
/** A position as bar.beat (from 1). */
function fmtPos(x: number): string {
  const bpb = beatsPerBar()
  const bar = Math.floor(x + 1e-6)
  const beat = Math.floor((x - bar) * bpb + 1e-6)
  return `${bar + 1}.${beat + 1}`
}
function fmtLen(len: number): string {
  if (Math.abs(len - Math.round(len)) < 1e-6) {
    const n = Math.round(len)
    return `${n} bar${n === 1 ? '' : 's'}`
  }
  const bpb = beatsPerBar()
  const bars = Math.floor(len + 1e-6)
  const beats = Math.round((len - bars) * bpb * 100) / 100
  const b = `${beats} beat${beats === 1 ? '' : 's'}`
  return bars ? `${bars} bar${bars === 1 ? '' : 's'} ${b}` : b
}

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
  const [zoom, setZoom] = useState(() => {
    const z = Number(localStorage.getItem('opsia.ruleSeqZoom'))
    return ZOOMS.includes(z) ? z : 1
  })
  const setZ = (z: number): void => {
    setZoom(z)
    try { localStorage.setItem('opsia.ruleSeqZoom', String(z)) } catch { /* full */ }
  }

  const rootRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const headListRef = useRef<HTMLDivElement | null>(null)
  const playRef = useRef<HTMLDivElement | null>(null)
  const markRef = useRef<HTMLDivElement | null>(null)

  // the timeline's width on screen (how many bar numbers and beat lines fit)
  const [gridW, setGridW] = useState(900)
  useEffect(() => {
    const g = gridRef.current
    if (!g) return
    const ro = new ResizeObserver(() => setGridW(g.clientWidth || 900))
    ro.observe(g)
    return () => ro.disconnect()
  }, [rules.length > 0])

  const L = t.length
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
  const defLen = Math.max(1, Math.min(4, L / 4))

  // ── geometry : the pointer in bars, through the box (UI zoom safe) ────────
  const barAt = (clientX: number): number => {
    const r = innerRef.current?.getBoundingClientRect()
    if (!r || r.width <= 0) return 0
    return ((clientX - r.left) / r.width) * L
  }
  const step = (fine: boolean): number => (fine ? 1 / beatsPerBar() : 1)
  const snapFloor = (x: number, s: number): number => q48(Math.floor(x / s + 1e-6) * s)
  const snapRound = (x: number, s: number): number => q48(Math.round(x / s) * s)
  const clampStart = (start: number, len: number): number => Math.max(0, Math.min(L - len, start))

  // ── writing (one store write per edit : one undo step) ─────────────────
  const commit = (blocks: RuleBlock[], rule: string, keep?: string): void => {
    setRuleSeq({ blocks: meltRow(blocks, rule, keep) })
  }
  const addBlock = (rule: string, start: number, len: number): void => {
    const id = newBlockId()
    commit([...t.blocks, { id, rule, start: q48(start), len: q48(len) }], rule, id)
    setSel(id)
  }
  const removeBlock = (id: string): void => {
    setRuleSeq({ blocks: t.blocks.filter((b) => b.id !== id) })
    if (sel === id) setSel(null)
  }
  const clearRow = (rule: string): void => setRuleSeq({ blocks: t.blocks.filter((b) => b.rule !== rule) })

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
      const end = x >= a ? Math.min(L, Math.max(a + s, q48(Math.ceil(x / s - 1e-6) * s))) : a + s
      setDrag({ ...d, start, len: q48(end - start), moved })
      return
    }
    const blk = t.blocks.find((b) => b.id === d.id)
    if (!blk) return
    const end0 = Math.min(L, blk.start + blk.len)
    if (d.kind === 'move') {
      const start = clampStart(snapRound(x - d.grab, s), d.len)
      if (start !== d.start || moved !== d.moved) setDrag({ ...d, start, moved })
    } else if (d.kind === 'left') {
      const start = Math.max(0, Math.min(end0 - Math.max(s, RULE_MIN_LEN), snapRound(x, s)))
      setDrag({ ...d, start, len: q48(end0 - start), moved })
    } else {
      const end = Math.min(L, Math.max(blk.start + Math.max(s, RULE_MIN_LEN), snapRound(x, s)))
      setDrag({ ...d, len: q48(end - blk.start), moved })
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

  // Delete / Backspace removes the chosen block (in the window the page is in)
  useEffect(() => {
    if (!sel) return
    const view = ownerWindow(rootRef.current)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      e.preventDefault()
      const st = useStore.getState()
      if (!st.ruleSeq.blocks.some((b) => b.id === sel)) return
      st.setRuleSeq({ blocks: st.ruleSeq.blocks.filter((b) => b.id !== sel) })
      setSel(null)
    }
    view.addEventListener('keydown', onKey)
    return () => view.removeEventListener('keydown', onKey)
  }, [sel])

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
      const on = st.ruleSeqOn && ph.started && !ph.waiting
      const x = `${(Math.max(0, Math.min(L, ph.pos)) / L) * 100}%`
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
        ? st.ruleSeq.blocks.filter((b) => ph.pos >= b.start && ph.pos < Math.min(L, b.start + b.len)).map((b) => b.id).join(',')
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
  }, [L, t.blocks])

  // Ctrl + wheel over the timeline : zoom in or out around the pointer
  useEffect(() => {
    const g = gridRef.current
    if (!g) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      e.stopPropagation()
      const i = ZOOMS.indexOf(zoom)
      const ni = Math.max(0, Math.min(ZOOMS.length - 1, i + (e.deltaY < 0 ? 1 : -1)))
      if (ni === i) return
      const r = g.getBoundingClientRect()
      const at = (g.scrollLeft + (e.clientX - r.left) / (r.width / g.clientWidth)) / Math.max(1, g.scrollWidth)
      setZ(ZOOMS[ni])
      requestAnimationFrame(() => {
        g.scrollLeft = at * g.scrollWidth - (e.clientX - r.left) / (r.width / g.clientWidth)
      })
    }
    g.addEventListener('wheel', onWheel, { passive: false })
    return () => g.removeEventListener('wheel', onWheel)
  }, [zoom])

  // ── what is drawn ─────────────────────────────────────────────────────────
  const barPct = 100 / L
  const pxPerBar = (gridW * zoom) / L
  const bpb = beatsPerBar()
  const grid = {
    backgroundImage: [
      'linear-gradient(to right, rgb(var(--c-border) / 0.75) 1px, transparent 1px)',
      'linear-gradient(to right, rgb(var(--c-border) / 0.35) 1px, transparent 1px)',
      ...(pxPerBar >= 40 ? ['linear-gradient(to right, rgb(var(--c-border) / 0.15) 1px, transparent 1px)'] : [])
    ].join(', '),
    backgroundSize: [`${barPct * 4}% 100%`, `${barPct}% 100%`, ...(pxPerBar >= 40 ? [`${barPct / bpb}% 100%`] : [])].join(', ')
  }
  const labelEvery = pxPerBar >= 22 ? 1 : pxPerBar >= 11 ? 2 : pxPerBar >= 6 ? 4 : 8
  const rowsH = Math.min(rules.length, MAX_ROWS) * ROW_H

  const blockMenu = (e: RMouseEvent, b: RuleBlock): void => {
    e.preventDefault()
    e.stopPropagation()
    setSel(b.id)
    const name = ruleById.get(b.rule)?.name ?? 'this rule'
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
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
      items.push({ label: `Add a block here (${fmtLen(defLen)})`, onClick: () => addBlock(rule, s, defLen) })
    }
    items.push(
      { label: 'On for the whole loop', title: 'One block from the first bar to the last', onClick: () => commit([...t.blocks.filter((b) => b.rule !== rule), { id: newBlockId(), rule, start: 0, len: L }], rule) },
      { label: `Clear the row of ${name}`, disabled: !byRule.get(rule)?.length, onClick: () => clearRow(rule) }
    )
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  if (!rules.length) {
    return (
      <p className="px-1 py-2 text-[11px] text-muted">
        No Body rules yet. Make some on the Body page (B), then come back : each rule gets a row here,
        and its blocks switch it on and off over the bars.
      </p>
    )
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-1.5" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => setDrag(null)}>
      {/* the loop, the zoom, how to play it */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-[9px] uppercase text-muted" title="The loop's length in bars (of the tempo, or of Ableton Link's bar while Link is on)">length</span>
        <div className="flex gap-1">
          {RULE_LENGTHS.map((n) => (
            <button key={n} onClick={() => setRuleSeq({ length: n })} className={`${chip(L === n)} w-7 px-0 text-center`} title={`A loop of ${n} bars`}>{n}</button>
          ))}
        </div>
        <button
          onClick={() => setRuleSeq({ loop: !t.loop })}
          className={chip(t.loop)}
          title={t.loop ? 'Loops : after the last bar it starts again from the first. Click : play it once, then stop' : 'Plays once, then stops (the rules stay as the end leaves them). Click : loop'}
        >{t.loop ? '⟳ loop' : '→ once'}</button>
        <span className="flex items-center gap-1" title="Zoom the timeline (Ctrl + wheel over it too)">
          <span className="font-mono text-[9px] uppercase text-muted">zoom</span>
          <button className={chip(false)} onClick={() => setZ(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])} disabled={zoom === 1}>−</button>
          <span className="w-6 text-center font-mono text-[9px] text-muted">{zoom}×</span>
          <button className={chip(false)} onClick={() => setZ(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])} disabled={zoom === ZOOMS[ZOOMS.length - 1]}>+</button>
        </span>
        {pastEnd > 0 && (
          <span className="font-mono text-[9px] text-accent2" title="Blocks that start after the end of this loop : kept, they play again with a longer loop">
            {pastEnd} past the end
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-muted/80" title="Drag a rule's name onto the timeline, or draw on its row, to switch it on for those bars. Drag a block to move it, its ends to resize it. Shift : by beats instead of bars. Alt-drag : a copy. Delete or right-click : remove. Double-click a row : a block there.">
          drag a name onto its row or draw · Shift : beats · Alt : copy · Delete : remove
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
                    title={`${r.name}${r.osc ? ` (/body/${r.osc})` : ''} : drag onto the timeline for a block of ${fmtLen(defLen)}. ${has ? 'While the timeline runs it is on inside its blocks, off outside them.' : 'No blocks : the timeline leaves it alone.'} Right-click : more`}
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
          className="relative min-w-0 flex-1 overflow-x-auto overflow-y-auto"
          style={{ height: RULER_H + rowsH + (zoom > 1 ? 10 : 0) }}
          onScroll={(e) => { if (headListRef.current) headListRef.current.scrollTop = e.currentTarget.scrollTop }}
        >
          <div ref={innerRef} className="relative" style={{ width: `${zoom * 100}%`, minHeight: RULER_H + rules.length * ROW_H }}>
            {/* the ruler : bar numbers, the playhead's mark */}
            <div className="sticky top-0 z-20 border-b border-border/70 bg-panel" style={{ height: RULER_H }}>
              <div className="absolute inset-0" style={grid} />
              {Array.from({ length: L }, (_, i) => i).filter((i) => i % labelEvery === 0).map((i) => (
                <span key={i} className="absolute top-[3px] pl-1 font-mono text-[9px] text-muted" style={{ left: `${i * barPct}%` }}>{i + 1}</span>
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
                        onDoubleClick={(e) => e.stopPropagation()}
                        onContextMenu={(e) => blockMenu(e, b)}
                        className={`absolute top-[2px] bottom-[2px] flex cursor-grab items-center overflow-hidden rounded-sm ${isSel ? 'z-10 ring-1 ring-text/70' : ''} ${b.start >= L ? 'hidden' : ''}`}
                        style={{
                          left: `${start * barPct}%`,
                          width: `${len * barPct}%`,
                          background: color(r.id, 0.34),
                          borderLeft: `3px solid ${color(r.id)}`,
                          touchAction: 'none'
                        }}
                        title={`${r.name} : on for ${fmtLen(len)}, from ${fmtPos(start)} until ${fmtPos(start + len)}. Drag to move, its ends to resize (Shift : beats), Alt-drag to copy, Delete or right-click to remove`}
                      >
                        <span className="pointer-events-none min-w-0 flex-1 truncate px-1 font-mono text-[9px] text-text/90">{r.name}</span>
                        <span className="pointer-events-none shrink-0 pr-1 font-mono text-[8px] text-text/60">{fmtLen(len)}</span>
                        {/* the ends : resize */}
                        <span className="absolute inset-y-0 left-0 w-[6px] cursor-ew-resize" />
                        <span className="absolute inset-y-0 right-0 w-[6px] cursor-ew-resize" />
                      </div>
                    )
                  })}
                  {ghost && (
                    <div
                      className="pointer-events-none absolute top-[2px] bottom-[2px] rounded-sm border border-dashed"
                      style={{ left: `${ghost.start * barPct}%`, width: `${ghost.len * barPct}%`, borderColor: color(r.id), background: color(r.id, 0.18) }}
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
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  )
}

/** The lane header's readout : where the timeline is (bar.beat of the loop). */
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
      const ph = ruleSeqPlayhead()
      const txt = !st.ruleSeqOn
        ? (st.ruleSeq.blocks.length ? 'stopped' : 'no blocks yet')
        : ph.waiting || !ph.started ? 'waits for the bar' : `bar ${fmtPos(ph.pos)} of ${st.ruleSeq.length}`
      if (txt !== shown) {
        shown = txt
        ref.current.textContent = txt
      }
    }
    id = view.requestAnimationFrame(f)
    return () => view.cancelAnimationFrame(id)
  }, [])
  return <span ref={ref} className="w-[120px] shrink-0 font-mono text-[10px] tabular-nums text-muted" title="Where the timeline is : bar and beat of its loop" />
}
