// Field macros (Slab 2c) : global "spatial-material" controls that co-articulate
// several parameters at once. v1 ships PROXIMITY: one knob places the image in a
// depth zone (vista ↔ personal) by
// pushing the Context finalizer's mood. Far = hazy, soft, vignetted, distant;
// close = sharp, present, glowing.
//
// Applied each frame AFTER modulation (so it owns the Context mood params while
// engaged). Neutral (0.5) is a deadzone : it writes nothing, leaving manual /
// World / modulation in charge. Optional audio drive: brightness = closeness.

import type { CompositionState } from '@shared/types'
import { audioBus } from './audioIn'
import { frameVals } from './frameVals'
import { liveModValues } from './modulation'

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
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
  /** The material Context's relief draws while the session has none (0 : none). */
  setFeelMaterial?: (idx: number) => void
}
// Texture's material when the session has none of its own : "paper rough"
// (Context.fs pbrTexture VALUES), a painterly surface. Pick a material in Context
// and Texture deepens that one instead.
const FEEL_MATERIAL = 2
const MASTER = { kind: 'master' as const }

/**
 * Apply the three named field macros : each 0.5 = neutral deadzone, applied
 * after modulation/proximity so they own their params while engaged:
 *  - **Density** : sparse↔dense: fades the upper layers out toward
 *    a single voice (sparse), or pushes every layer's opacity up (dense).
 *  - **Gesture⇄Texture** : crisp sharpens (clean strokes); texture lays the
 *    picture on Context's lit material and sets it moving (relief + evolution).
 *  - **Coalesce** : grain adds Vibe dither (discrete particles); mass bands the
 *    Vibe palette (flat color masses).
 *  None of them blurs or smears : blur is set by hand (Context), trails belong to
 *  Interruption ⇄ Flow.
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
  // Read the per-frame bus first (an earlier pass's write), then the modulated
  // value, then the composition base — so co-engaged macros STACK, not clobber.
  const liveVal = (inst: { id: string; inputs: Record<string, unknown> }, name: string, d: number): number =>
    frameVals.get(`fx:master:${inst.id}:${name}`) ??
    (liveModValues.get(`fx:master:${inst.id}:${name}`) as number | undefined) ??
    num(inst.inputs[name], d)
  const setF = (inst: { id: string }, name: string, v: number): void => {
    comp.setFxInput(MASTER, inst.id, name, v)
    frameVals.set(`fx:master:${inst.id}:${name}`, v)
  }

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

  // ── Gesture⇄Texture → Finalizer sharpen (crisp) vs Context's material (texture). ──
  let feelMaterial = 0
  if (Math.abs(gestureTexture - 0.5) > 0.02) {
    const t = (gestureTexture - 0.5) * 2 // -1 crisp .. +1 texture
    if (t < 0) {
      // Finalizer sharpen spans 0..2 : clamp to the DECLARED range.
      if (fin) setF(fin, 'sharpen', clamp(liveVal(fin, 'sharpen', 0) - t * 0.8, 0, 2))
    } else if (ctx) {
      // the picture laid on a lit material that slowly moves : the session's own
      // material deepened, else paper (no material of its own : relief from 0)
      const own = Math.round(num(ctx.inputs.pbrTexture, 0)) > 0
      if (!own) feelMaterial = FEEL_MATERIAL
      setF(ctx, 'pbrAmount', clamp01((own ? liveVal(ctx, 'pbrAmount', 0.5) : 0) + t * (own ? 0.5 : 0.75)))
      setF(ctx, 'pbrEvolve', clamp01(liveVal(ctx, 'pbrEvolve', 0) + t * 0.6))
    }
  }
  comp.setFeelMaterial?.(feelMaterial)

  // ── Coalesce → Vibe dither (grain) vs Vibe palette bands (mass). ──
  if (Math.abs(coalesce - 0.5) > 0.02 && vibe) {
    const t = (coalesce - 0.5) * 2 // -1 grain .. +1 mass
    if (t < 0) setF(vibe, 'dither', clamp01(liveVal(vibe, 'dither', 0) - t * 0.5))
    // bands : the palette snaps the picture into flat fields of its colors, and
    // the original mixed back over it (source mix) withdraws so the fields read
    else {
      setF(vibe, 'blend', clamp01(liveVal(vibe, 'blend', 1) * (1 - t * 0.9)))
      setF(vibe, 'mixSrc', clamp01(liveVal(vibe, 'mixSrc', 0.5) * (1 - t * 0.85)))
    }
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
  // Deadzone around neutral : don't clobber the mood params when parked.
  if (Math.abs(p - 0.5) < 0.02) return null
  const ctx = c.master.find((f) => f.shaderId === 'fx-context')
  if (!ctx) return null

  const t = (p - 0.5) * 2 // -1 (far) .. +1 (close)
  // Additive on top of the CURRENT value: prefer this frame's modulated value
  // (liveModValues, written by applyModulation) so Proximity coexists with a
  // modulator/World-autoMod on the same Context param; else the composition base.
  const cur = (name: string, dflt: number): number =>
    frameVals.get(`fx:master:${ctx.id}:${name}`) ??
    liveModValues.get(`fx:master:${ctx.id}:${name}`) ??
    num(ctx.inputs[name], dflt)
  const out: ContextProx = {
    haze: clamp01(cur('haze', 0.15) - t * 0.22), // far → more haze
    blur: clamp01(cur('blur', 0.08) - t * 0.12), // far → softer
    depth: clamp01(cur('depth', 0.35) - t * 0.25), // far → deeper vignette
    bloom: clamp01(cur('bloom', 0.3) + t * 0.2) // close → more bloom/light
  }
  const scope = { kind: 'master' as const }
  for (const [name, v] of Object.entries(out)) {
    comp.setFxInput(scope, ctx.id, name, v)
    frameVals.set(`fx:master:${ctx.id}:${name}`, v)
  }
  return out
}
