// Flash safety for the lights : the picture's rule (engine/strobeLimit.ts) on every
// LED of every light, on the very colors that go out (after the effects, the faders,
// the cues, Black and the masters). Whatever feeds a light (the master picture, a
// layer that strobes, an effect, a modulator on its level), it never flashes more
// than three times a second.
//
// Per pixel, in linear light (the DMX value is the light's output) :
//   1) the picture's limiter : the swings of the light it is asked to show (10 % of
//      relative luminance or more, the darker state under 0.8; or of the saturated
//      red measure), counted over the last second. At the count (set by the Flash
//      safety strength) the pixel is held in a narrow band that drifts slowly after
//      the content : a strobe survives as a gentle pulse. It lets go as soon as the
//      content stops flashing.
//   2) the guarantee : the swings of what it SHOWS, counted the same way. A swing
//      that would be the seventh in a second (a fourth flash) waits, the light held
//      where it is, until a second has passed since the oldest.
// Everything slower passes untouched, bit for bit.

const SLOTS = 6 // transition ages kept (the strongest count is 6)
// per pixel : source detector E P Er Pr, its ages ×6, shown D C Dr Cr, shown rgb,
// shown detector E P Er Pr, its ages ×6, seeded
const ST = 4 + SLOTS + 4 + 3 + 4 + SLOTS + 1
const O_AGE = 4, O_D = O_AGE + SLOTS, O_RGB = O_D + 4, O_SE = O_RGB + 3, O_SAGE = O_SE + 4, O_SEED = O_SAGE + SLOTS
/** The flashes a second never passed on a light (pairs of opposing swings). */
export const LIGHT_MAX_FLASHES = 3

const lumOf = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b
const redOf = (r: number, g: number, b: number): number => {
  const s = r + g + b
  return s > 1e-4 && r >= 0.8 * s ? Math.max(r - g - b, 0) : 0
}
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
/** The red measure without its edge (it comes in from a ratio of 0.7 to 0.8 instead
 *  of at 0.8) : the hold blends colors, and a blend held at the edge would jump. */
const redSoft = (r: number, g: number, b: number): number => {
  const s = r + g + b
  return s > 1e-4 ? Math.max(r - g - b, 0) * clamp((r / s - 0.7) * 10, 0, 1) : 0
}

/** The state for `n` pixels. */
export function limitState(n: number): Float64Array {
  return new Float64Array(n * ST)
}

/** Would `L` against extreme E / previous P be a counted swing ? (the picture's detector) */
function flips(E: number, P: number, L: number, th: number, lumRule: boolean): boolean {
  const dir = E > P + 1e-5 ? 1 : E < P - 1e-5 ? -1 : 0
  const f = dir > 0 ? L < E - th : dir < 0 ? L > E + th : Math.abs(L - E) >= th
  return f && (!lumRule || Math.min(E, L) < 0.8)
}

/** Moves a detector at s[o] (E, P, Er, Pr) and its ages at s[a] on to (L, Lr);
 *  true when a counted swing landed. */
function step(s: Float64Array, o: number, a: number, L: number, Lr: number, th: number, thR: number, dt: number): boolean {
  let hit = false
  for (let k = 0; k < 2; k++) {
    const e = o + k * 2, v = k ? Lr : L, t = k ? thR : th
    const E = s[e], P = s[e + 1]
    const dir = E > P + 1e-5 ? 1 : E < P - 1e-5 ? -1 : 0
    let flip = false
    if (dir > 0) { if (v > E) s[e] = v; else if (v < E - t) flip = true }
    else if (dir < 0) { if (v < E) s[e] = v; else if (v > E + t) flip = true }
    else if (Math.abs(v - E) >= t) flip = true
    if (flip) {
      if (k === 1 || Math.min(E, v) < 0.8) hit = true
      s[e + 1] = E; s[e] = v
    }
  }
  for (let i = 0; i < SLOTS; i++) s[a + i] = Math.min(9, s[a + i] + dt)
  if (hit) { for (let i = SLOTS - 1; i > 0; i--) s[a + i] = s[a + i - 1]; s[a] = 0 }
  return hit
}
const recent = (s: Float64Array, a: number): number => { let n = 0; for (let i = 0; i < SLOTS; i++) if (s[a + i] < 0.9999) n++; return n }

/** Limit `colors` (n pixels, 0..1 RGB interleaved) in place. `strength` 0..1 : the
 *  Flash safety slider (0 : the gentlest hold, the three a second still kept);
 *  `dt` the time since the last frame (s). */
export function limitFlashes(st: Float64Array, colors: Float32Array, strength: number, dt: number): void {
  const n = Math.min(colors.length / 3, st.length / ST)
  const sg = clamp(strength, 0, 1)
  const K = Math.max(2, Math.min(SLOTS, Math.round(6 - 4 * sg)))
  const th = 0.1 - 0.03 * sg, thR = 0.0625 - 0.02 * sg
  const rateStep = (0.3 - 0.2 * sg) * clamp(dt, 0, 0.25)
  // (the band the picture's limiter holds, kept so that with its drift a held
  // light swings well under the line at the lights' 10 to 44 frames a second)
  const band = Math.max(0.005, Math.min(0.04 - 0.025 * sg, 0.35 * th - rateStep)), bandR = band * 0.6
  const d = clamp(dt, 0, 0.25)
  // the shown swings : the full rule (10 %, three flashes a second); a light held
  // back stays a little inside the line (held right at it, 8 bits could cross it)
  const TH = 0.1, THR = 0.0625, CAP = LIGHT_MAX_FLASHES * 2, HOLD = 0.085, HOLDR = 0.05
  for (let i = 0; i < n; i++) {
    const o = i * ST, c = i * 3
    let r = colors[c], g = colors[c + 1], b = colors[c + 2]
    const L = lumOf(r, g, b), Lr = redSoft(r, g, b)
    if (!st[o + O_SEED]) {
      st[o] = st[o + 1] = L; st[o + 2] = st[o + 3] = Lr
      st[o + O_SE] = st[o + O_SE + 1] = L; st[o + O_SE + 2] = st[o + O_SE + 3] = redOf(r, g, b)
      for (let k = 0; k < SLOTS; k++) { st[o + O_AGE + k] = 9; st[o + O_SAGE + k] = 9 }
      st[o + O_D + 1] = L; st[o + O_D + 3] = Lr
      st[o + O_RGB] = r; st[o + O_RGB + 1] = g; st[o + O_RGB + 2] = b
      st[o + O_SEED] = 1
      continue
    }
    // 1) the picture's limiter, on what it is asked to show
    step(st, o, o + O_AGE, L, Lr, th, thR, d)
    const pr = st[o + O_RGB], pg = st[o + O_RGB + 1], pb = st[o + O_RGB + 2]
    if (recent(st, o + O_AGE) >= K) {
      // (from what it shows now : its luminance, and its red as it really is, a
      // blend toward blue loses red twice as fast as the two measures mixed)
      const D = lumOf(pr, pg, pb), Dr = redSoft(pr, pg, pb)
      let C = st[o + O_D + 1], Cr = st[o + O_D + 3]
      C += clamp(L - C, -rateStep, rateStep)
      Cr += clamp(Lr - Cr, -rateStep, rateStep)
      const tl = clamp(L, C - band, C + band), tr = clamp(Lr, Cr - bandR, Cr + bandR)
      let alpha = Math.abs(L - D) < 1e-5 ? 1 : clamp((tl - D) / (L - D), 0, 1)
      // red : the blend's own measure never past its band's edge on the way to the live one
      const dirR = Lr > Dr + 1e-9 ? 1 : Lr < Dr - 1e-9 ? -1 : 0
      const side = (a: number): boolean => dirR === 0 || (redSoft(pr + (r - pr) * a, pg + (g - pg) * a, pb + (b - pb) * a) - tr) * dirR <= 1e-9
      if (!side(alpha)) {
        let lo = 0, hi = alpha
        for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (side(m)) lo = m; else hi = m }
        alpha = lo
      }
      r = pr + (r - pr) * alpha; g = pg + (g - pg) * alpha; b = pb + (b - pb) * alpha
      st[o + O_D + 1] = C; st[o + O_D + 3] = Cr
    } else {
      st[o + O_D + 1] = L; st[o + O_D + 3] = Lr
    }
    // 2) the guarantee, on what it shows : a fourth flash in a second waits
    if (recent(st, o + O_SAGE) >= CAP) {
      const sE = st[o + O_SE], sP = st[o + O_SE + 1], sEr = st[o + O_SE + 2], sPr = st[o + O_SE + 3]
      let lo = 0, hi = 1, alpha = 1
      const bad = (a: number): boolean => {
        const rr = pr + (r - pr) * a, gg = pg + (g - pg) * a, bb = pb + (b - pb) * a
        return flips(sE, sP, lumOf(rr, gg, bb), HOLD, true) || flips(sEr, sPr, redOf(rr, gg, bb), HOLDR, false)
      }
      if (bad(1)) {
        // (the farthest it may go toward the new color : no swing at 0, it was shown)
        for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (bad(m)) hi = m; else lo = m }
        // (a little short of it : the red measure jumps at its edge, and 8 bits
        // would take a color held right there back and forth across it)
        alpha = Math.max(0, lo - 0.04)
        r = pr + (r - pr) * alpha; g = pg + (g - pg) * alpha; b = pb + (b - pb) * alpha
      }
    }
    // (counted on the values that go out : a 32-bit float each)
    r = Math.fround(r); g = Math.fround(g); b = Math.fround(b)
    step(st, o + O_SE, o + O_SAGE, lumOf(r, g, b), redOf(r, g, b), TH, THR, d)
    st[o + O_RGB] = r; st[o + O_RGB + 1] = g; st[o + O_RGB + 2] = b
    colors[c] = r; colors[c + 1] = g; colors[c + 2] = b
  }
}
