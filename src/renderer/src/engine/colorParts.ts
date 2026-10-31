// A color input by its parts, in the color picker's own space : HSV, what the
// picker shows (its slider is the hue, its pad the saturation across and the
// brightness up), plus alpha. Modulation, the Meta knobs and OSC move ONE part
// and hold the others, so a hue swept round keeps the color's saturation and
// brightness, and a brightness pulse keeps its hue.
//
// Pure : no store, no engine (tested headless with esbuild).

import type { ColorChannel } from '@shared/types'

export const COLOR_PARTS: ColorChannel[] = ['h', 's', 'v', 'a']
export const PART_INDEX: Record<ColorChannel, number> = { h: 0, s: 1, v: 2, a: 3 }
/** Each part's name, in the app and in OSC (/…/tint/hue). */
export const PART_WORD: Record<ColorChannel, string> = { h: 'hue', s: 'saturation', v: 'brightness', a: 'alpha' }
/** Where each part sits in the color picker. */
export const PART_WHERE: Record<ColorChannel, string> = {
  h: "the picker's color slider",
  s: "the picker's pad, left to right",
  v: "the picker's pad, bottom to top",
  a: 'the transparency slider'
}
/** OSC word → part. */
export const PART_OF_WORD: Record<string, ColorChannel> = { hue: 'h', saturation: 's', brightness: 'v', alpha: 'a' }

/** A stored color (or its default) as four numbers : r, g, b, a. */
export function colorOf(raw: unknown, def?: unknown): number[] {
  const pick = (x: unknown): number[] | null =>
    Array.isArray(x) && x.length >= 3 && x.every((n) => typeof n === 'number') ? (x as number[]) : null
  const c = pick(raw) ?? pick(def) ?? [1, 1, 1, 1]
  return [c[0], c[1], c[2], c[3] ?? 1]
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d > 0) {
    if (max === r) h = (g - b) / d
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
    if (h < 0) h += 1
  }
  return [h, max > 0 ? d / max : 0, max]
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hh = (h - Math.floor(h)) * 6
  const i = Math.floor(hh) % 6
  const f = hh - Math.floor(hh)
  const p = v * (1 - s)
  const q = v * (1 - s * f)
  const t = v * (1 - s * (1 - f))
  return i === 0 ? [v, t, p] : i === 1 ? [q, v, p] : i === 2 ? [p, v, t] : i === 3 ? [p, q, v] : i === 4 ? [t, p, v] : [v, p, q]
}

/** r, g, b, a → h, s, v, a. */
export function hsvaOf(rgba: number[]): number[] {
  return [...rgbToHsv(rgba[0], rgba[1], rgba[2]), rgba[3] ?? 1]
}

/** h, s, v, a → r, g, b, a. */
export function rgbaOf(hsva: number[]): number[] {
  return [...hsvToRgb(hsva[0], hsva[1], hsva[2]), hsva[3]]
}

/** A part's value clamped to where it can go : the hue goes round, the others
 *  stop at their ends (a brightness stored above 1 may stay up there). */
export function fitPart(ch: ColorChannel, x: number, base: number): number {
  if (ch === 'h') return x - Math.floor(x)
  const hi = ch === 'v' ? Math.max(1, base) : 1
  return x < 0 ? 0 : x > hi ? hi : x
}

// What a STORED color keeps of the parts that black or grey would erase : a
// color written at brightness 0 (or saturation 0) holds its hue this far above
// it, so a knob that went to black and comes back finds the color it left
// (1/4096 : far under one 8-bit step, still exact in the stored floats).
const KEEP = 1 / 4096

/** The color with one part set to `x` (0..1; the hue wraps), the others as they
 *  are : what the Meta knobs commit and what OSC sets. */
export function withPart(rgba: number[], ch: ColorChannel, x: number): number[] {
  const hsva = hsvaOf(rgba)
  const i = PART_INDEX[ch]
  hsva[i] = fitPart(ch, x, hsva[i])
  if (ch === 's' || ch === 'v') hsva[i] = Math.max(KEEP, hsva[i])
  return rgbaOf(hsva)
}
