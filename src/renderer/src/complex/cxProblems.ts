// Complex Output : what is wrong with a setup, in plain words, worst first. Pure.

import { CX_SOURCE_LABEL, type CxScreen, type CxSetup } from '@shared/complexOut'
import { bounds, polyArea, warpFolded, warpOutline } from './cxMath'
import { findOverlaps } from './cxBlend'

export interface CxDisplay {
  id: number
  label: string
  width: number
  height: number
  isPrimary: boolean
  /** the control window is on it */
  isControl: boolean
  hz?: number
}

/** A screen's window now. */
export type CxState = 'closed' | 'open' | 'missing' | 'held' | 'failed'

export interface CxProblem {
  kind: 'nowhere' | 'missing' | 'own' | 'shared' | 'size' | 'empty' | 'offscreen' | 'partly' | 'tiny' | 'folded' | 'noblend' | 'covered' | 'source' | 'bypassed' | 'failed'
  level: 'stop' | 'warn' | 'note'
  text: string
  screen?: string
  slice?: string
}

export interface CxWorld {
  live: boolean
  states: Record<string, CxState>
  /** covering the control window's display was accepted */
  allowOwn: boolean
  /** each layer plays something */
  layers: boolean[]
}

/** The display a screen asks for : by its id, else the only one of that name and
 *  size, else of that name. */
export function matchDisplay(sc: Pick<CxScreen, 'target'>, displays: CxDisplay[]): CxDisplay | null {
  const t = sc.target
  if (t.kind !== 'display') return null
  const byId = displays.find((d) => d.id === t.displayId)
  // (the id AND the name : ids move when displays are plugged in another order)
  if (byId && (!t.label || byId.label === t.label)) return byId
  const same = displays.filter((d) => d.label === t.label && d.width === t.dw && d.height === t.dh)
  if (same.length === 1) return same[0]
  const named = displays.filter((d) => d.label === t.label)
  if (named.length === 1) return named[0]
  return null
}

export function findProblems(s: CxSetup, displays: CxDisplay[], w: CxWorld): CxProblem[] {
  const out: CxProblem[] = []
  const add = (kind: CxProblem['kind'], level: CxProblem['level'], text: string, screen?: string, slice?: string): void => {
    out.push({ kind, level, text, screen, slice })
  }
  const used = new Map<number, string>()
  const solo = s.screens.some((x) => x.on && x.slices.some((l) => l.on && l.solo))
  for (const sc of s.screens) {
    if (!sc.on) continue
    const d = matchDisplay(sc, displays)
    if (sc.target.kind === 'none') add('nowhere', 'stop', `${sc.name} goes nowhere : pick a display or a window`, sc.id)
    else if (sc.target.kind === 'display' && !d) add('missing', 'stop', `${sc.name} : its display${sc.target.label ? ` (${sc.target.label})` : ''} is not connected. It opens by itself when it is back`, sc.id)
    else if (w.states[sc.id] === 'failed') add('failed', 'stop', `${sc.name} : its window could not open or draw`, sc.id)
    if (d) {
      const before = used.get(d.id)
      if (before) add('shared', 'stop', `${sc.name} and ${before} go to the same display (${d.label})`, sc.id)
      else used.set(d.id, sc.name)
      if (d.isControl && !w.allowOwn) add('own', 'warn', `${sc.name} would cover the display the controls are on. It waits until you allow it`, sc.id)
      if (d.width !== sc.w || d.height !== sc.h) add('size', 'warn', `${sc.name} is ${sc.w}×${sc.h}, its display ${d.width}×${d.height} : the picture is rescaled`, sc.id)
    }
    const shown = sc.slices.filter((l) => l.on && (!solo || l.solo))
    if (!sc.slices.length) add('empty', 'warn', `${sc.name} has no slice : it stays black`, sc.id)
    else if (!shown.length) {
      const why = solo && sc.slices.some((l) => l.on) ? 'a slice on another screen is soloed' : 'all its slices are off'
      add('bypassed', 'warn', `${sc.name} is black : ${why}`, sc.id)
    }
    for (const l of shown) {
      const line = warpOutline(l.warp)
      const b = bounds(line)
      const ox = Math.min(1, b.x + b.w) - Math.max(0, b.x), oy = Math.min(1, b.y + b.h) - Math.max(0, b.y)
      if (ox <= 0 || oy <= 0) add('offscreen', 'stop', `${l.name} is off ${sc.name}`, sc.id, l.id)
      else {
        if ((ox * oy) / Math.max(1e-9, b.w * b.h) < 0.75) add('partly', 'note', `${l.name} : a good part of it is off ${sc.name}`, sc.id, l.id)
        if (polyArea(line) * sc.w * sc.h < 64) add('tiny', 'warn', `${l.name} is too small to see on ${sc.name}`, sc.id, l.id)
      }
      if (warpFolded(l.warp)) add('folded', 'warn', `${l.name} is folded over itself : a point has crossed its neighbours`, sc.id, l.id)
      const ib = bounds(l.input)
      if (ib.x + ib.w <= 0 || ib.y + ib.h <= 0 || ib.x >= 1 || ib.y >= 1) add('source', 'warn', `${l.name} takes from outside the picture`, sc.id, l.id)
      if (l.source.startsWith('layer:') && !w.layers[Number(l.source.slice(6))]) add('source', 'warn', `${l.name} takes ${CX_SOURCE_LABEL[l.source]}, which shows nothing now`, sc.id, l.id)
      if (l.opacity <= 0.001) add('bypassed', 'note', `${l.name} has no opacity`, sc.id, l.id)
    }
    // a slice fully under a plain rectangle drawn after it
    shown.forEach((l, i) => {
      const b = bounds(warpOutline(l.warp))
      for (let j = i + 1; j < shown.length; j++) {
        const q = shown[j]
        if (q.opacity < 1 || q.masks.some((m) => m.on) || q.edges.on || q.warp.type !== 'corners') continue
        const p = q.warp.pts
        const rect = Math.abs(p[0] - p[6]) + Math.abs(p[2] - p[4]) + Math.abs(p[1] - p[3]) + Math.abs(p[5] - p[7]) < 1e-3
        const c = bounds(p)
        if (rect && c.x <= b.x + 1e-4 && c.y <= b.y + 1e-4 && c.x + c.w >= b.x + b.w - 1e-4 && c.y + c.h >= b.y + b.h - 1e-4) {
          add('covered', 'note', `${l.name} is hidden under ${q.name}`, sc.id, l.id)
          break
        }
      }
    })
  }
  for (const o of findOverlaps(s)) {
    const open = [o.a, o.b].filter((e) => !e.slice.edges.on || e.slice.edges[e.side] < e.width * 0.2)
    if (open.length) add('noblend', 'warn', `${o.a.slice.name} (${o.a.screen.name}) and ${o.b.slice.name} (${o.b.screen.name}) show the same strip with no soft edge between them`, open[0].screen.id, open[0].slice.id)
  }
  const rank = { stop: 0, warn: 1, note: 2 }
  return out.sort((a, b) => rank[a.level] - rank[b.level])
}
