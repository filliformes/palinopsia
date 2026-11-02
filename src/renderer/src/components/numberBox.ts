// Number boxes as wide as the longest number they can show, and no wider.
//
// Every box used to get a fixed width from its caller (w-12, w-14, w-full in a
// fixed column), sized for the longest value any box might show : a "2.37" sat
// at the right of a box made for "-12.345", over a band of empty black. Now a
// box's width comes from ITS OWN range and precision : the sign, the integer
// digits of its largest magnitude, the point and the decimals it shows. Never
// from the current value, so the width holds still while a slider drags or a
// modulator moves the number (a live value stays inside the range, so it fits).

/** Decimals a number box shows for a range this wide : 100 or more none, 10 one,
 *  1 two, 0.1 three, less four. Enough to read a slider, never so many it clips. */
export function fracFor(span: number): number {
  const s = Math.abs(span)
  return s >= 100 ? 0 : s >= 10 ? 1 : s >= 1 ? 2 : s >= 0.1 ? 3 : 4
}

/** How many decimals a box shows : a count, or one per value (the Mixer's
 *  faders show one fewer from 10 up, so "12.4" fits where "12.35" would). */
export type FracRule = number | ((v: number) => number)

const fracAt = (rule: FracRule, v: number): number => (typeof rule === 'function' ? rule(v) : rule)

/** The text a number box shows for v : rounded to the rule's decimals, trailing
 *  zeros dropped (0.5 stays "0.5", not "0.500"). No rule : every digit. */
export function formatNumber(v: number, integer: boolean, frac?: FracRule): string {
  if (!Number.isFinite(v)) return ''
  if (integer) return String(Math.round(v))
  if (frac === undefined) return String(v)
  return String(parseFloat(v.toFixed(fracAt(frac, v))))
}

/** The decimals a box over [min, max] shows when its caller names none : the
 *  range's own (fracFor), so the text can never outgrow the box. Unbounded :
 *  every digit. */
export function defaultFrac(min: number, max: number, integer: boolean): FracRule | undefined {
  if (integer) return 0
  return Number.isFinite(min) && Number.isFinite(max) ? fracFor(max - min) : undefined
}

/** The narrowest box : three characters, so a one-digit box stays easy to click. */
export const NUMBER_BOX_MIN_CHARS = 3
// A box without a range (none today) : room for six characters.
const UNBOUNDED_CHARS = 6

/** The longest text a box over [min, max] can show, in characters : per side of
 *  zero (the minus counts) and per decade of magnitude (1 integer digit below
 *  10, 2 below 100 ...), the integer digits plus the point and the decimals shown
 *  there. A rule that differs across a decade is read at both ends and the middle. */
export function numberBoxChars(min: number, max: number, integer: boolean, frac?: FracRule): number {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return UNBOUNDED_CHARS
  if (!integer && frac === undefined) return UNBOUNDED_CHARS
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  // the ends themselves ("-100", "20")
  let n = Math.max(formatNumber(lo, integer, frac).length, formatNumber(hi, integer, frac).length)
  // magnitudes a..b on one side of zero
  const side = (a: number, b: number, neg: boolean): void => {
    for (let bot = 0, top = 10, d = 1; bot <= b && d <= 21; bot = top, top *= 10, d++) {
      const s = Math.max(a, bot)
      const e = Math.min(b, top)
      if (e <= s) continue // nothing in this decade but a lone end, counted above
      const at = (m: number): number => (integer ? 0 : fracAt(frac as FracRule, neg ? -m : m))
      const f = Math.max(at(s), at((s + e) / 2), at(e - (e - s) * 1e-6))
      n = Math.max(n, (neg ? 1 : 0) + d + (f > 0 ? 1 + f : 0))
    }
  }
  if (hi > 0) side(Math.max(0, lo), hi, false)
  if (lo < 0) side(Math.max(0, -hi), -lo, true)
  return Math.max(NUMBER_BOX_MIN_CHARS, n)
}

// A hair over the characters : the caret at the end of a full box, and fonts
// whose tabular digits come out a touch wider than their "0" (the ch unit).
export const NUMBER_BOX_SLACK_PX = 2

/** The CSS width of a plain input (with `box-content`, so its own padding and
 *  border add on top) that holds `chars` characters. */
export function numberBoxCh(chars: number): string {
  return `calc(${chars}ch + ${NUMBER_BOX_SLACK_PX}px)`
}
