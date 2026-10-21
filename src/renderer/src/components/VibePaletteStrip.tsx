// The Vibe Palette's colors as one strip : the gradient the picture's light is
// mapped into, drawn with the shader's own maths (Vibe.fs : its stops, bands↔
// smooth, or a color chord's colors, darks at the left, lights at the right),
// its stops as swatches at their places along it (click one to recolor it), and
// how many stops it uses as 2 · 3 · 4 · 5. A chord shows the colors it makes.
// Each stop and the count can be made persistent (right-click), as every other
// control.

import { useEffect, useRef } from 'react'
import type { ModTarget } from '@shared/types'
import { modTargetKey, useStore } from '../store'
import { ModButton, useBound } from './AutoControls'
import { PinZone } from './Pin'

type Values = Record<string, number | number[]>
type RGB = [number, number, number]

const KEYS = ['colorA', 'colorB', 'colorC', 'colorD', 'colorE']
const DEFS: RGB[] = [[0, 0, 0], [1, 1, 1], [0.5, 0.5, 0.5], [0.75, 0.75, 0.75], [1, 1, 1]]
export const HARMONIES = ['off', 'analogous', 'complementary', 'triad', 'split', 'tetrad']

const num = (v: Values, k: string, d: number): number => (typeof v[k] === 'number' ? (v[k] as number) : d)
const fract = (x: number): number => x - Math.floor(x)
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const mod = (a: number, b: number): number => a - b * Math.floor(a / b)

/** Vibe.fs's hsv2rgb. */
function hsv2rgb(h: number, s: number, v: number): RGB {
  const k = [1, 2 / 3, 1 / 3]
  return k.map((kk) => {
    const p = Math.abs(fract(h + kk) * 6 - 3)
    return v * (1 + (clamp01(p - 1) - 1) * s)
  }) as RGB
}

/** Vibe.fs's stopColor : a chord's color, or the manual stop. */
export function vibeStopColor(v: Values, idx: number): RGB {
  const n = Math.floor(num(v, 'stops', 2) + 0.5)
  const harmony = Math.round(num(v, 'harmony', 0))
  if (harmony >= 1) {
    const ii = Math.max(0, Math.min(n - 1, idx))
    const ti = n > 1.5 ? ii / (n - 1) : 0
    const spread = num(v, 'spread', 0.3)
    let off = 0
    if (harmony === 1) off = (ti - 0.5) * spread * 0.4
    else if (harmony === 2) off = mod(ii, 2) < 0.5 ? 0 : 0.5
    else if (harmony === 3) off = mod(ii, 3) / 3
    else if (harmony === 4) { const m = mod(ii, 3); off = m < 0.5 ? 0 : m < 1.5 ? 0.42 : 0.58 }
    else off = mod(ii, 4) * 0.25
    const hue = fract(num(v, 'baseHue', 0.6) + off)
    const val = 0.06 + (1 - 0.06) * ti
    const sat = num(v, 'chroma', 0.55) * (1 + (0.55 - 1) * ti)
    return hsv2rgb(hue, sat, val)
  }
  const i = Math.max(0, Math.min(4, Math.round(idx)))
  const c = v[KEYS[i]]
  return Array.isArray(c) && c.length >= 3 ? [c[0], c[1], c[2]] : DEFS[i]
}

const hex = (c: RGB): string =>
  '#' + c.map((x) => Math.round(clamp01(x) * 255).toString(16).padStart(2, '0')).join('')

export function VibePaletteStrip({
  values,
  onChange,
  modTargetFor
}: {
  values: Values
  onChange: (name: string, value: number | number[]) => void
  modTargetFor: (input: string) => ModTarget
}): JSX.Element {
  const cvRef = useRef<HTMLCanvasElement | null>(null)
  const n = Math.max(2, Math.min(5, Math.floor(num(values, 'stops', 2) + 0.5)))
  const harmony = Math.round(num(values, 'harmony', 0))
  const chord = harmony >= 1
  const blend = clamp01(num(values, 'blend', 1))
  const colors = Array.from({ length: n }, (_, i) => vibeStopColor(values, i))
  const key = colors.map(hex).join() + blend
  const uiZoom = useStore((s) => s.uiZoom) // a zoom change redraws it at the new size

  // The palette map, one column per pixel : Vibe.fs's (t, i, f, k), luma = x.
  useEffect(() => {
    const cv = cvRef.current
    if (!cv) return
    const draw = (): void => {
      // its width on screen (under the UI zoom, a CSS zoom : clientWidth is unzoomed)
      const w = Math.max(2, Math.round(cv.getBoundingClientRect().width * (window.devicePixelRatio || 1)))
      if (cv.width !== w) { cv.width = w; cv.height = 1 }
      const g = cv.getContext('2d')
      if (!g) return
      const img = g.createImageData(w, 1)
      for (let x = 0; x < w; x++) {
        const t = (x / (w - 1)) * (n - 1)
        const i = Math.min(Math.floor(t), n - 2)
        const f = t - i
        const k = (f >= 0.5 ? 1 : 0) + (f - (f >= 0.5 ? 1 : 0)) * blend
        const a = colors[i], b = colors[i + 1]
        for (let c = 0; c < 3; c++) img.data[x * 4 + c] = Math.round(clamp01(a[c] + (b[c] - a[c]) * k) * 255)
        img.data[x * 4 + 3] = 255
      }
      g.putImageData(img, 0, 0)
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(cv)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, n, uiZoom])

  const stopsTarget = modTargetFor('stops')
  const stopsBound = useBound(modTargetKey(stopsTarget))
  return (
    <div className="flex flex-col gap-1 px-2 pb-1.5 pt-1.5">
      <canvas
        ref={cvRef}
        className="h-5 w-full rounded-sm border border-border"
        style={{ imageRendering: 'pixelated' }}
        title={`The palette the picture's light is mapped into : darks at the left, lights at the right (${chord ? `a ${HARMONIES[harmony]} chord` : `${n} stops`}, ${blend >= 0.999 ? 'smooth' : blend <= 0.001 ? 'bands' : 'soft bands'})`}
      />
      {/* the stops, each at its place along the strip */}
      <div className="relative h-[18px]">
        {colors.map((c, i) => {
          const pos = n > 1 ? i / (n - 1) : 0
          const name = `stop ${i + 1}${i === 0 ? ' (darks)' : i === n - 1 ? ' (lights)' : ''}`
          return (
            <PinZone key={i} pin={modTargetKey(modTargetFor(KEYS[i]))} label={`stop ${i + 1}`}>
            <label
              className={`absolute top-0 h-[18px] w-[18px] overflow-hidden rounded border ${chord ? 'cursor-default border-border' : 'cursor-pointer border-border hover:border-accent'}`}
              style={{ left: `calc(${pos} * (100% - 18px))`, background: hex(c) }}
              title={chord
                ? `${name} : ${hex(c)}, made by the color chord (turn the chord off to pick the stops yourself)`
                : `${name} : ${hex(c)} : click to pick its color`}
            >
              {!chord && (
                <input
                  type="color"
                  value={hex(c)}
                  onChange={(e) => {
                    const h = e.target.value
                    const rgb = [1, 3, 5].map((o) => parseInt(h.slice(o, o + 2), 16) / 255)
                    onChange(KEYS[i], [...rgb, 1])
                  }}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              )}
            </label>
            </PinZone>
          )
        })}
      </div>
      {/* how many stops it uses */}
      <PinZone pin={modTargetKey(stopsTarget)} label="color stops">
      <div className="flex items-center gap-1.5">
        <span className="w-24 shrink-0 truncate font-mono text-[9px] uppercase tracking-wide text-muted" title="How many colors the picture's light is spread over">stops used</span>
        <div className="flex overflow-hidden rounded border border-border">
          {[2, 3, 4, 5].map((k) => (
            <button
              key={k}
              onClick={() => onChange('stops', k)}
              className={`px-2 py-0.5 font-mono text-[10px] transition-colors ${n === k ? 'bg-accent/20 text-accent' : 'bg-panel2 text-muted hover:text-text'}`}
              title={`${k} stops${chord ? ' (the chord makes them)' : ''}`}
            >
              {k}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {chord && <span className="truncate font-mono text-[9px] text-muted" title="A color chord sets the palette (its section below)">{HARMONIES[harmony]} chord</span>}
        <ModButton target={stopsTarget} bound={stopsBound} label="color stops" />
      </div>
      </PinZone>
    </div>
  )
}
