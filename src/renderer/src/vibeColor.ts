// Context's "Vibe Color" button : the light takes the Vibe Palette's main colour.
//
// The colours the Vibe actually paints with : only its ACTIVE stops (`stops`
// rounds to 2..5; the rest sit unused), and in a colour CHORD (harmony on) the
// chord's own stops, which Vibe.fs builds from the base hue and replace the
// manual ones. The button used to read all five manual stops whatever the mode,
// so with a chord on (or the default black→white pair) it picked a colour that
// was nowhere on screen, usually white : the light looked unchanged.

import type { FxInstance } from '@shared/types'

type Inputs = Record<string, number | number[]>

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const fract = (x: number): number => x - Math.floor(x)

/** Vibe.fs hsv2rgb, verbatim. */
function hsv2rgb(h: number, s: number, v: number): number[] {
  const k = [1, 2 / 3, 1 / 3]
  return k.map((kk) => {
    const p = Math.abs(fract(h + kk) * 6 - 3)
    return v * (1 + (Math.min(Math.max(p - 1, 0), 1) - 1) * s)
  })
}

/** Vibe.fs chordColor(idx), verbatim. */
function chordColor(inputs: Inputs, idx: number, n: number): number[] {
  const harmony = Math.round(num(inputs.harmony, 0))
  const spread = num(inputs.spread, 0.3)
  const ii = Math.min(Math.max(idx, 0), n - 1)
  const ti = n > 1.5 ? ii / (n - 1) : 0
  let off = 0
  if (harmony === 1) off = (ti - 0.5) * spread * 0.4
  else if (harmony === 2) off = ii % 2 < 0.5 ? 0 : 0.5
  else if (harmony === 3) off = (ii % 3) / 3
  else if (harmony === 4) {
    const m = ii % 3
    off = m < 0.5 ? 0 : m < 1.5 ? 0.42 : 0.58
  } else off = (ii % 4) * 0.25
  const hue = fract(num(inputs.baseHue, 0.6) + off)
  const val = 0.06 + (1 - 0.06) * ti
  const sat = num(inputs.chroma, 0.55) * (1 + (0.55 - 1) * ti)
  return hsv2rgb(hue, sat, val)
}

/** The stops the Vibe Palette is painting with right now. */
export function vibeStops(inputs: Inputs): number[][] {
  const n = Math.min(5, Math.max(2, Math.floor(num(inputs.stops, 2) + 0.5)))
  if (Math.round(num(inputs.harmony, 0)) >= 1) return Array.from({ length: n }, (_, i) => chordColor(inputs, i, n))
  return ['colorA', 'colorB', 'colorC', 'colorD', 'colorE']
    .slice(0, n)
    .map((k) => inputs[k])
    .filter((c): c is number[] => Array.isArray(c) && c.length >= 3)
    .map((c) => [c[0], c[1], c[2]])
}

/** Its most characterful active stop (chroma first, luma as a tiebreak), raised
 *  to full brightness : a light's colour is its hue and saturation, the Context
 *  light amount sets how bright it shines. An all-gray palette gives white. */
export function vibeMainColor(inputs: Inputs): number[] {
  const stops = vibeStops(inputs)
  let best: number[] | null = null
  let bestScore = -1
  for (const c of stops) {
    const mx = Math.max(c[0], c[1], c[2])
    if (mx < 0.02) continue // black : no colour to give the light
    const chroma = mx - Math.min(c[0], c[1], c[2])
    const luma = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
    const score = chroma * 2 + luma * 0.4
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  if (!best) return [1, 1, 1, 1]
  const mx = Math.max(best[0], best[1], best[2])
  return [best[0] / mx, best[1] / mx, best[2] / mx, 1]
}

/** The button : Context's light takes the Vibe's main colour. A light that is off
 *  (amount under 0.05) is turned up to 0.25, else the colour lands nowhere visible. */
export function applyVibeColor(master: FxInstance[], set: (name: string, v: number | number[]) => void): void {
  const vibe = master.find((f) => f.shaderId === 'fx-vibe')
  if (!vibe) return
  set('lightColor', vibeMainColor(vibe.inputs))
  const glow = master.find((f) => f.shaderId === 'fx-context')?.inputs.lightGlow
  if (typeof glow === 'number' && glow < 0.05) set('lightGlow', 0.25)
}
