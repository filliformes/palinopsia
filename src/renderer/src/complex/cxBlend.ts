// Complex Output : where two projectors show the same part of the picture, and
// the soft edges that share it between them. Reads the INPUT side (what is shown
// twice is what must be blended, wherever the projectors stand). Pure.

import type { CxEdges, CxScreen, CxSetup, CxSlice } from '@shared/complexOut'
import { bounds } from './cxMath'

export type Side = 'l' | 'r' | 't' | 'b'
interface End {
  screen: CxScreen
  slice: CxSlice
  side: Side
  width: number
}
export interface Overlap {
  a: End
  b: End
}

/** The side of the SLICE that shows this side of its input (flips and half turns
 *  swap them; a quarter turn moves them round). */
function sideOf(s: CxSlice, input: Side): Side {
  let q = input
  if (s.flipX) q = q === 'l' ? 'r' : q === 'r' ? 'l' : q
  if (s.flipY) q = q === 't' ? 'b' : q === 'b' ? 't' : q
  const ring: Side[] = ['t', 'r', 'b', 'l']
  return ring[(ring.indexOf(q) + s.turn) % 4]
}

/** Every pair of slices, on two screens, showing the same part of the same source
 *  along a side. */
export function findOverlaps(s: CxSetup): Overlap[] {
  const all: Array<{ screen: CxScreen; slice: CxSlice; b: ReturnType<typeof bounds> }> = []
  for (const screen of s.screens) {
    if (!screen.on) continue
    for (const slice of screen.slices) if (slice.on && slice.inKind !== 'poly') all.push({ screen, slice, b: bounds(slice.input) })
  }
  const out: Overlap[] = []
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const p = all[i], q = all[j]
      if (p.screen === q.screen || p.slice.source !== q.slice.source) continue
      const w = Math.min(p.b.x + p.b.w, q.b.x + q.b.w) - Math.max(p.b.x, q.b.x)
      const h = Math.min(p.b.y + p.b.h, q.b.y + q.b.h) - Math.max(p.b.y, q.b.y)
      if (w < 1e-4 || h < 1e-4) continue
      const rw = w / Math.min(p.b.w, q.b.w), rh = h / Math.min(p.b.h, q.b.h)
      if (rw > 0.9 && rh > 0.9) continue // the same part twice : two copies, not a seam
      const across = rh >= rw
      const first = across
        ? p.b.x + p.b.w / 2 <= q.b.x + q.b.w / 2 ? p : q
        : p.b.y + p.b.h / 2 <= q.b.y + q.b.h / 2 ? p : q
      const second = first === p ? q : p
      const end = (o: typeof p, side: Side): End => ({
        screen: o.screen, slice: o.slice, side: sideOf(o.slice, side), width: Math.min(0.95, across ? w / o.b.w : h / o.b.h)
      })
      out.push(across ? { a: end(first, 'r'), b: end(second, 'l') } : { a: end(first, 'b'), b: end(second, 't') })
    }
  }
  return out
}

/** Every seam given its soft edges, as wide as what the two share (power, gamma
 *  and the rest stay as they are). */
export function autoBlend(s: CxSetup): CxSetup {
  const patch = new Map<string, CxEdges>()
  for (const o of findOverlaps(s)) {
    for (const e of [o.a, o.b]) {
      const cur = patch.get(e.slice.id) ?? { ...e.slice.edges, ...(e.slice.edges.on ? {} : { l: 0, r: 0, t: 0, b: 0 }) }
      patch.set(e.slice.id, { ...cur, on: true, [e.side]: e.width })
    }
  }
  if (!patch.size) return s
  return {
    ...s,
    screens: s.screens.map((sc) =>
      sc.slices.some((l) => patch.has(l.id)) ? { ...sc, slices: sc.slices.map((l) => (patch.has(l.id) ? { ...l, edges: patch.get(l.id)! } : l)) } : sc
    )
  }
}
