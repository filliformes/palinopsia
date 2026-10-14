// Output transform : the WHOLE composition moved as one picture, after
// everything (the Finalizer, its shape, the crossfade, the flash limiter), on
// the regular flat output. The fulldome mapping has its own rotate / spin /
// offset / feather; this is the same idea for a flat projector, so the finished
// frame can be played : slid, zoomed, turned, spun, softened at its edges.
// Saved with the session (a New session and an older file start at identity).

export type OutEdge = 'black' | 'repeat' | 'mirror'

export interface OutXform {
  offsetX: number // -1..1 : frame widths (+ = right)
  offsetY: number // -1..1 : frame heights (+ = up)
  scale: number // 0..2 : 1 = the frame as is (mid-range, so a centred knob leaves it alone)
  rotate: number // -180..180 degrees
  spin: number // -360..360 degrees per second : keeps turning, never jumps
  feather: number // 0..0.2 : softens the picture's edges (frame heights)
  flipX: boolean
  flipY: boolean
  edge: OutEdge // what shows where the picture no longer reaches
}

export const OUT_IDENTITY: OutXform = {
  offsetX: 0, offsetY: 0, scale: 1, rotate: 0, spin: 0, feather: 0, flipX: false, flipY: false, edge: 'black'
}

/** The sliders a modulator or a Meta knob can move (ranges = the sliders'). */
export type OutXformField = 'offsetX' | 'offsetY' | 'scale' | 'rotate' | 'spin' | 'feather'
export const OUTX_MOD_RANGE: Record<OutXformField, { min: number; max: number; label: string }> = {
  offsetX: { min: -1, max: 1, label: 'offset x' },
  offsetY: { min: -1, max: 1, label: 'offset y' },
  scale: { min: 0, max: 2, label: 'scale' },
  rotate: { min: -180, max: 180, label: 'rotate' },
  spin: { min: -360, max: 360, label: 'spin' },
  feather: { min: 0, max: 0.2, label: 'feather' }
}

export const OUT_EDGES: OutEdge[] = ['black', 'repeat', 'mirror']

export function sanitizeOutXform(raw: unknown): OutXform {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const num = (k: OutXformField): number => {
    const v = r[k]
    const { min, max } = OUTX_MOD_RANGE[k]
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : OUT_IDENTITY[k]
  }
  return {
    offsetX: num('offsetX'),
    offsetY: num('offsetY'),
    scale: num('scale'),
    rotate: num('rotate'),
    spin: num('spin'),
    feather: num('feather'),
    flipX: r.flipX === true,
    flipY: r.flipY === true,
    edge: OUT_EDGES.includes(r.edge as OutEdge) ? (r.edge as OutEdge) : 'black'
  }
}
