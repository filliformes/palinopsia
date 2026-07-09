// Field macros (Slab 2c) — global "spatial-material" controls that co-articulate
// several parameters at once. v1 ships PROXIMITY: one knob places the image in a
// depth zone (vista ↔ personal, after Cutting & Vishton via Knight-Hill) by
// pushing the Context finalizer's mood. Far = hazy, soft, vignetted, distant;
// close = sharp, present, glowing.
//
// Applied each frame AFTER modulation (so it owns the Context mood params while
// engaged). Neutral (0.5) is a deadzone — it writes nothing, leaving manual /
// World / modulation in charge. Optional audio drive: brightness = closeness.

import type { CompositionState } from '@shared/types'
import { audioBus } from './audioIn'
import { liveModValues } from './modulation'

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d)

export interface ContextProx {
  haze: number
  blur: number
  bloom: number
  depth: number
}

type MacroComp = {
  setFxInput: (scope: { kind: 'master' }, instId: string, name: string, v: number) => void
  layers: Array<{ opacity: number }>
}
const MASTER = { kind: 'master' as const }

/**
 * Apply the three named field macros — each 0.5 = neutral deadzone, applied
 * after modulation/proximity so they own their params while engaged:
 *  - **Density** (Basanta #6) — sparse↔dense: fades the upper layers out toward
 *    a single voice (sparse), or pushes every layer's opacity up (dense).
 *  - **Gesture⇄Texture** (Knight-Hill C#3) — motion character: texture adds
 *    Context trails (internalised churn/flux), gesture sharpens (externalised,
 *    clean trajectory).
 *  - **Coalesce** (Knight-Hill C#1) — grain↔mass: mass blurs/smooths, grain adds
 *    Vibe dither (discrete particles).
 */
export function applyFieldMacros(
  comp: MacroComp,
  c: CompositionState,
  density: number,
  gestureTexture: number,
  coalesce: number
): void {
  const ctx = c.master.find((f) => f.shaderId === 'fx-context')
  const vibe = c.master.find((f) => f.shaderId === 'fx-vibe')
  const fin = c.master.find((f) => f.shaderId === 'fx-finalizer')
  const liveVal = (inst: { id: string; inputs: Record<string, unknown> }, name: string, d: number): number =>
    (liveModValues.get(`fx:master:${inst.id}:${name}`) as number | undefined) ?? num(inst.inputs[name], d)

  // ── Density → layer-opacity spread (unique lever; nothing else drives it). ──
  if (Math.abs(density - 0.5) > 0.02) {
    const t = (density - 0.5) * 2 // -1 sparse .. +1 dense
    const n = Math.max(1, comp.layers.length - 1)
    comp.layers.forEach((L, i) => {
      if (!L) return
      const o = L.opacity
      L.opacity =
        t > 0
          ? clamp01(o + t * (1 - o) * 0.6) // dense: push toward full
          : clamp01(o * (1 + t * (0.25 + 0.75 * (i / n)))) // sparse: fade upper layers first
    })
  }

  // ── Gesture⇄Texture → Context trails (texture) vs Finalizer sharpen (gesture). ──
  if (Math.abs(gestureTexture - 0.5) > 0.02) {
    const t = (gestureTexture - 0.5) * 2 // -1 gesture .. +1 texture
    if (ctx) comp.setFxInput(MASTER, ctx.id, 'trails', clamp01(liveVal(ctx, 'trails', 0.2) + t * 0.4))
    if (fin) comp.setFxInput(MASTER, fin.id, 'sharpen', clamp01(liveVal(fin, 'sharpen', 0) - t * 0.8))
  }

  // ── Coalesce → Context blur (mass) vs Vibe dither (grain). ──
  if (Math.abs(coalesce - 0.5) > 0.02) {
    const t = (coalesce - 0.5) * 2 // -1 grain .. +1 mass
    if (ctx) comp.setFxInput(MASTER, ctx.id, 'blur', clamp01(liveVal(ctx, 'blur', 0.08) + t * 0.18))
    if (vibe) comp.setFxInput(MASTER, vibe.id, 'dither', clamp01(liveVal(vibe, 'dither', 0) - t * 0.5))
  }
}

/**
 * Apply Proximity to the Context finalizer. `proximity` 0 = far/vista, 1 =
 * close/personal, 0.5 = neutral (no-op). `audioAmt` adds a brightness drive
 * (centroid → closeness). Writes onto the compositor and returns the values so
 * the output window can mirror them (null when inert).
 */
export function applyProximity(
  comp: { setFxInput: (scope: { kind: 'master' }, instId: string, name: string, v: number) => void },
  c: CompositionState,
  proximity: number,
  audioAmt: number
): ContextProx | null {
  let p = proximity
  if (audioAmt > 0 && audioBus.mode !== 'off') {
    p = clamp01(p + (audioBus.feature('centroid') - 0.5) * audioAmt)
  }
  // Deadzone around neutral — don't clobber the mood params when parked.
  if (Math.abs(p - 0.5) < 0.02) return null
  const ctx = c.master.find((f) => f.shaderId === 'fx-context')
  if (!ctx) return null

  const t = (p - 0.5) * 2 // -1 (far) .. +1 (close)
  // Additive on top of the CURRENT value: prefer this frame's modulated value
  // (liveModValues, written by applyModulation) so Proximity coexists with a
  // modulator/World-autoMod on the same Context param; else the composition base.
  const cur = (name: string, dflt: number): number =>
    liveModValues.get(`fx:master:${ctx.id}:${name}`) ?? num(ctx.inputs[name], dflt)
  const out: ContextProx = {
    haze: clamp01(cur('haze', 0.15) - t * 0.22), // far → more haze
    blur: clamp01(cur('blur', 0.08) - t * 0.12), // far → softer
    depth: clamp01(cur('depth', 0.35) - t * 0.25), // far → deeper vignette
    bloom: clamp01(cur('bloom', 0.3) + t * 0.2) // close → more bloom/light
  }
  const scope = { kind: 'master' as const }
  comp.setFxInput(scope, ctx.id, 'haze', out.haze)
  comp.setFxInput(scope, ctx.id, 'blur', out.blur)
  comp.setFxInput(scope, ctx.id, 'depth', out.depth)
  comp.setFxInput(scope, ctx.id, 'bloom', out.bloom)
  return out
}
