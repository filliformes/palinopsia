// What Feel is doing now : the dials away from their rest, for the feel tab's
// dot, its ↺ and anywhere else that must say why the picture changed.

type FeelSt = {
  density: number; proximity: number; proximityAudio: boolean; gestureTexture: number; coalesce: number
  flow: number; tonicity: number; shutter: number; drift: number; superFlicker: number
}

const OFF = 0.02

/** The dials off rest, each "Name 0.40" (empty : Feel adds nothing). */
export function feelOffRest(st: FeelSt): string[] {
  const out: string[] = []
  const mid = (name: string, v: number): void => { if (Math.abs(v - 0.5) > OFF) out.push(`${name} ${v.toFixed(2)}`) }
  const zero = (name: string, v: number): void => { if (v > OFF) out.push(`${name} ${v.toFixed(2)}`) }
  mid('Density', st.density)
  mid('Proximity', st.proximity)
  if (st.proximityAudio) out.push('Proximity follows the sound')
  mid('Gesture ⇄ Texture', st.gestureTexture)
  mid('Coalesce', st.coalesce)
  mid('Interruption ⇄ Flow', st.flow)
  zero('Tonicity', st.tonicity)
  zero('Shutter', st.shutter)
  zero('Wander', st.drift)
  zero('Superimposition', st.superFlicker)
  return out
}

/** What Density leaves of each layer's fader (the engine's own law, field.ts) :
 *  1 at rest. */
export function densityFactors(density: number, layers: number): number[] {
  const t = (density - 0.5) * 2
  const n = Math.max(1, layers - 1)
  return Array.from({ length: layers }, (_, i) =>
    Math.abs(density - 0.5) <= OFF ? 1 : t > 0 ? NaN : Math.max(0, 1 + t * (0.25 + 0.75 * (i / n)))
  )
}
