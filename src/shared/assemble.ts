// Assemble — the corpus model + descriptor math for the automatic editor.
//
// This is Mosaïque's model carried to video : a folder of films is segmented
// into UNITS (shots), each unit is reduced to a DESCRIPTOR VECTOR, the corpus
// becomes a point cloud where proximity = visual similarity, and an assemblage
// is a walk through that cloud. Diemo Schwarz's VIVO (the visual sibling of
// CataRT) is the closest prior art and uses the same descriptor family.
//
// This module is shared by BOTH processes on purpose :
//   · main   analyses the corpus (ffmpeg → 64² RGB strip → these functions)
//   · renderer scores candidates live and maps the vision bus onto the same axes
// so the corpus and the live image are always measured with ONE ruler.
//
// Every descriptor is normalized to roughly 0..1 over natural footage. They are
// z-scored against the corpus before matching, so the gains here only need to be
// in the right ballpark — they exist so a raw vector is human-readable in the UI.

/** The descriptor axes, in vector order. The first eight are deliberately the
 *  SAME quantities `engine/visionIn.ts` computes from the live output, so the
 *  composited image can be used as a matching target with no translation. */
// The axis set follows VIVO's table 1 (Fayet/Schwarz/Tiffon, JIM 2024) where
// it can : mean AND dispersion of the colour channels, sharpness and detail as
// SEPARATE axes (a high-detail frame can still be soft — their §3.1.6), and
// movement carrying direction, not only magnitude.
export const DESCRIPTORS = [
  'brightness', // mean luminance (VIVO LuminanceAvg)          dark ↔ bright
  'contrast', // RMS luminance spread (VIVO LuminanceVar)      flat ↔ punchy
  'motion', // mean frame-to-frame change                      still ↔ moving
  'edges', // mean Sobel magnitude (VIVO Sharpness)            soft ↔ crisp
  'entropy', // Shannon of the luma histogram (≈ Complexity)   simple ↔ complex
  'centroidX', // horizontal centre of the bright mass         left ↔ right
  'centroidY', // vertical centre of the bright mass           top ↔ bottom
  'warmth', // Dimopoulos–Winkler warmness (VIVO §3.1.4)       cool ↔ warm
  // ── below : corpus-only axes (no live counterpart in the vision bus) ──
  'green', // green↔magenta opponent balance                   magenta ↔ green
  'saturation', // mean chroma (VIVO SaturationAvg)            grey ↔ vivid
  'satVar', // chroma dispersion (VIVO SaturationVar)          even ↔ patchy
  'colorfulness', // Hasler–Süsstrunk metric                   drab ↔ colourful
  'texture', // spatial frequency (VIVO Detail)                smooth ↔ fine
  'grain', // Immerkær noise estimate                          clean ↔ noisy
  'burst', // variance of motion across the unit               steady ↔ bursty
  'flicker', // global luminance oscillation                   stable ↔ strobing
  'driftX', // signed horizontal drift of the bright mass      left ← → right
  'driftY' // signed vertical drift of the bright mass         up ← → down
] as const

export type DescriptorName = (typeof DESCRIPTORS)[number]
export const DESC_N = DESCRIPTORS.length

/** The eight axes the live vision bus can supply (a prefix of DESCRIPTORS —
 *  the ordering above is chosen so this is simply the first LIVE_DESC_N). */
export const LIVE_DESC_N = 8

/** Human labels for the weight sliders. */
export const DESC_LABELS: Record<DescriptorName, string> = {
  brightness: 'brightness',
  contrast: 'contrast',
  motion: 'motion',
  edges: 'detail',
  entropy: 'complexity',
  centroidX: 'weight ↔',
  centroidY: 'weight ↕',
  warmth: 'warmth',
  green: 'green/magenta',
  saturation: 'saturation',
  satVar: 'colour patchiness',
  colorfulness: 'colourfulness',
  texture: 'texture',
  grain: 'grain',
  burst: 'burstiness',
  flicker: 'flicker',
  driftX: 'drift ↔',
  driftY: 'drift ↕'
}

/** One analysed segment of one file : the atom the editor assembles. */
export interface AssembleUnit {
  id: string
  file: string // absolute path on disk
  fileName: string
  start: number // seconds into the file
  dur: number // seconds
  fileDur: number // the whole file's length, so in-points can be clamped
  desc: number[] // DESC_N raw descriptor values over the whole unit
  // Descriptors of the unit's first and last third. Schödl's transition rule
  // (Video Textures eq. 2) scores a cut by comparing the SUCCESSOR of the
  // outgoing frame to the incoming one — "transition from i to j whenever the
  // successor of i is similar to j". At shot scale that is tail(i) vs head(j),
  // not the two shot averages : a clip that starts dark and ends bright joins
  // very differently at its two ends, and the mean hides exactly that.
  head: number[]
  tail: number[]
  thumb: string // base64 THUMB²·RGB — drawn via ImageData, no decoder needed
}

// ── The generated edit ───────────────────────────────────────────────────

/** One entry of the edit decision list : play `file` from `inSec` for `durSec`
 *  of SCREEN time at `speed`. Screen time and source time differ whenever the
 *  speed curve is not 1 — that's the point of the two curves. */
export interface AssembleClip {
  unitId: string
  file: string
  fileName: string
  inSec: number
  durSec: number
  speed: number
}

export type CurveShape =
  | 'flat'
  | 'rise'
  | 'fall'
  | 'accel'
  | 'decel'
  | 'arch'
  | 'valley'
  | 'scurve'
  | 'step'
  | 'random'

export const CURVE_SHAPES: CurveShape[] = [
  'flat',
  'rise',
  'fall',
  'accel',
  'decel',
  'arch',
  'valley',
  'scurve',
  'step',
  'random'
]

/** How the next clip is chosen. */
export type MatchMode = 'walk' | 'trajectory' | 'live'

/** The recipe. Everything needed to regenerate an assemblage from a corpus —
 *  so a saved assemblage is a few hundred bytes, and Variation is just a
 *  re-roll of the same recipe at a new seed. */
export interface AssembleParams {
  mode: MatchMode
  contrast: number // 0 = nearest neighbour (morph), 1 = farthest (whiplash)
  weights: number[] // DESC_N per-axis matching weights
  duration: number // target output length, seconds
  loop: boolean
  lenShape: CurveShape // cut-length curve over the sequence
  lenAmount: number // 0 = even cuts, 1 = ±3 octaves
  spdShape: CurveShape // playback-speed curve over the sequence
  spdAmount: number
  trajFrom: [number, number] // trajectory endpoints, in map (PCA) space 0..1
  trajTo: [number, number]
  noRepeat: number // how many recent units are excluded from candidacy
  variety: number // 0 = always the best match, 1 = loose sampling
}

/** A generated, nameable edit. */
export interface Assemblage {
  id: string
  name: string
  clips: AssembleClip[]
  seed: number
  params: AssembleParams
  folder: string
  createdAt: number
}

export function defaultAssembleParams(): AssembleParams {
  return {
    mode: 'walk',
    contrast: 0.25,
    // Colour, brightness and motion carry most of the perceptual weight by
    // default; the finer texture axes are available but start quiet.
    weights: DESCRIPTORS.map((d) =>
      d === 'brightness' || d === 'warmth' || d === 'motion'
        ? 1
        : d === 'contrast' || d === 'saturation' || d === 'edges'
          ? 0.6
          : d === 'centroidX' || d === 'centroidY'
            ? 0.2
            : 0.35
    ),
    duration: 60,
    loop: true,
    lenShape: 'flat',
    lenAmount: 0.5,
    spdShape: 'flat',
    spdAmount: 0.4,
    trajFrom: [0.15, 0.5],
    trajTo: [0.85, 0.5],
    noRepeat: 8,
    variety: 0.3
  }
}

/** A whole analysed folder. `mean`/`std` are the z-scoring statistics. */
export interface AssembleCorpus {
  folder: string
  units: AssembleUnit[]
  mean: number[]
  std: number[]
  files: number
  analyzedAt: number
}

export interface AnalyzeProgress {
  file: string
  index: number
  total: number
  units: number
  done: boolean
}

/** Thumbnail edge, in pixels. Kept tiny : ~300 units × 32²·3 ≈ 900 KB base64. */
export const THUMB = 32

/** Analysis raster edge + sample rate. 64² @ 8 fps is enough to resolve a
 *  quarter-second shot and cheap enough to sweep a folder in seconds. */
export const GRID = 64
export const ANALYSIS_FPS = 8

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

// ── Per-frame descriptors ────────────────────────────────────────────────
// All of these read one GRID×GRID RGB frame (Uint8Array, length GRID²·3).

/** Everything a single frame contributes, before temporal aggregation. Purely
 *  scalar : the luminance raster stays in the caller's scratch buffer, so a
 *  whole film's worth of these costs a few hundred KB, not hundreds of MB. */
export interface FrameStats {
  brightness: number
  contrast: number
  edges: number
  entropy: number
  centroidX: number
  centroidY: number
  warmth: number
  green: number
  saturation: number
  satVar: number
  colorfulness: number
  texture: number
  grain: number
}

/**
 * Per-pixel warmness, after Dimopoulos & Winkler as used by VIVO (§3.1.4).
 *
 * Hue decides warm (+1) or cold (−1); the vote is then weighted by S·V, so a
 * dark or desaturated pixel barely counts. This matters : a naive red-minus-
 * blue reading calls a black frame with a faint blue cast "cold" as loudly as
 * a saturated blue sky, which is not how the image reads.
 */
function pixelWarmth(r: number, g: number, b: number, mx: number, mn: number): number {
  const delta = mx - mn
  if (delta < 1e-6 || mx < 1e-6) return 0 // grey / black : no hue, no vote
  let h: number
  if (mx === r) h = 60 * (((g - b) / delta) % 6)
  else if (mx === g) h = 60 * ((b - r) / delta + 2)
  else h = 60 * ((r - g) / delta + 4)
  if (h < 0) h += 360
  const T = h > 75 && h < 285 ? -1 : 1
  const s = delta / mx
  return T * s * mx // θ = T(H)·S·V
}

/**
 * Reduce one GRID×GRID RGB frame to its spatial descriptors.
 *
 * `gray` is written into the caller's scratch buffer so consecutive frames can
 * be differenced without allocating — this runs a few thousand times per file.
 */
export function frameStats(rgb: Uint8Array, gray: Float32Array, size = GRID): FrameStats {
  const n = size * size
  let sum = 0
  let sumSq = 0
  let cx = 0
  let cy = 0
  let wsum = 0
  let rSum = 0
  let gSum = 0
  let bSum = 0
  let satSum = 0
  let satSq = 0
  let warmSum = 0
  // Hasler–Süsstrunk works on the two opponent channels rg and yb.
  let rgSum = 0
  let rgSq = 0
  let ybSum = 0
  let ybSq = 0
  const hist = new Array<number>(16).fill(0)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const p = i * 3
      const r = rgb[p] / 255
      const g = rgb[p + 1] / 255
      const b = rgb[p + 2] / 255
      const lum = r * 0.299 + g * 0.587 + b * 0.114
      gray[i] = lum
      sum += lum
      sumSq += lum * lum
      cx += lum * x
      cy += lum * y
      wsum += lum
      rSum += r
      gSum += g
      bSum += b
      const mx = r > g ? (r > b ? r : b) : g > b ? g : b
      const mn = r < g ? (r < b ? r : b) : g < b ? g : b
      const sat = mx > 1e-4 ? (mx - mn) / mx : 0
      satSum += sat
      satSq += sat * sat
      warmSum += pixelWarmth(r, g, b, mx, mn)
      const rg = r - g
      const yb = 0.5 * (r + g) - b
      rgSum += rg
      rgSq += rg * rg
      ybSum += yb
      ybSq += yb * yb
      hist[Math.min(15, (lum * 16) | 0)]++
    }
  }

  const mean = sum / n
  // RMS contrast (Peli) : more robust on natural frames than Michelson, which a
  // single specular highlight can pin to 1.
  const variance = Math.max(0, sumSq / n - mean * mean)
  const contrast = Math.sqrt(variance)

  // Shannon entropy of the 16-bin luma histogram, normalized by log2(16) = 4.
  let H = 0
  for (let k = 0; k < 16; k++) {
    const pk = hist[k] / n
    if (pk > 0) H -= pk * Math.log2(pk)
  }

  // Sobel gradient magnitude + first-difference spatial frequency + Immerkær
  // noise, all over the interior in one sweep (three 3×3 taps on the same rows).
  let edges = 0
  let sfRow = 0
  let sfCol = 0
  let noise = 0
  let ec = 0
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x
      const tl = gray[i - size - 1]
      const tc = gray[i - size]
      const tr = gray[i - size + 1]
      const ml = gray[i - 1]
      const mc = gray[i]
      const mr = gray[i + 1]
      const bl = gray[i + size - 1]
      const bc = gray[i + size]
      const br = gray[i + size + 1]
      const gx = tr + 2 * mr + br - (tl + 2 * ml + bl)
      const gy = bl + 2 * bc + br - (tl + 2 * tc + tr)
      edges += Math.sqrt(gx * gx + gy * gy)
      const dr = mr - mc
      const dc = bc - mc
      sfRow += dr * dr
      sfCol += dc * dc
      // Immerkær's mask rejects real edges and responds to random noise.
      noise += Math.abs(tl - 2 * tc + tr - 2 * ml + 4 * mc - 2 * mr + bl - 2 * bc + br)
      ec++
    }
  }
  if (ec) {
    edges /= ec
    sfRow /= ec
    sfCol /= ec
    noise = (Math.sqrt(Math.PI / 2) * noise) / (6 * ec)
  }

  return {
    brightness: clamp01(mean),
    contrast: clamp01(contrast * 3),
    edges: clamp01(edges * 1.2),
    entropy: clamp01(H / 4),
    centroidX: wsum > 1e-4 ? clamp01(cx / wsum / (size - 1)) : 0.5,
    centroidY: wsum > 1e-4 ? clamp01(cy / wsum / (size - 1)) : 0.5,
    // Θ ∈ [−1,1] mapped onto the 0..1 the rest of the axes use. The gain of 2
    // is because natural footage rarely saturates the metric.
    warmth: clamp01(0.5 + (warmSum / n) * 2),
    green: clamp01(0.5 + (gSum - (rSum + bSum) * 0.5) / n),
    saturation: clamp01(satSum / n),
    satVar: clamp01(Math.sqrt(Math.max(0, satSq / n - (satSum / n) ** 2)) * 2.5),
    colorfulness: clamp01(
      (Math.sqrt(Math.max(0, rgSq / n - (rgSum / n) ** 2) + Math.max(0, ybSq / n - (ybSum / n) ** 2)) +
        0.3 * Math.hypot(rgSum / n, ybSum / n)) *
        2.2
    ),
    texture: clamp01(Math.sqrt(sfRow + sfCol) * 6),
    grain: clamp01(noise * 14)
  }
}

/** Mean absolute luminance difference between two frames : the motion proxy
 *  and the shot-cut signal both read this. */
export function frameDiff(a: Float32Array, b: Float32Array): number {
  let d = 0
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length
}

// ── Temporal aggregation ─────────────────────────────────────────────────

/** Fold a run of per-frame stats (plus the motion signal between them) into
 *  one unit-level descriptor vector. Spatial axes are averaged; the temporal
 *  axes (motion / burst / flicker) come from the sequence itself. */
export function aggregate(frames: FrameStats[], diffs: number[]): number[] {
  const v = new Array<number>(DESC_N).fill(0);
  if (frames.length === 0) return v
  const avg = (pick: (f: FrameStats) => number): number =>
    frames.reduce((s, f) => s + pick(f), 0) / frames.length

  const motionMean = diffs.length ? diffs.reduce((s, d) => s + d, 0) / diffs.length : 0
  const motionVar = diffs.length
    ? Math.sqrt(diffs.reduce((s, d) => s + (d - motionMean) ** 2, 0) / diffs.length)
    : 0
  // Flicker : how much GLOBAL brightness oscillates frame to frame — distinct
  // from motion, which is spatial change. A strobe scores high here and a pan
  // scores zero.
  let flicker = 0
  for (let i = 1; i < frames.length; i++) flicker += Math.abs(frames[i].brightness - frames[i - 1].brightness);
  flicker = frames.length > 1 ? flicker / (frames.length - 1) : 0

  // Signed drift of the bright mass. Motion MAGNITUDE alone cannot tell a
  // left-to-right swing from a right-to-left one — precisely the ambiguity
  // Schödl illustrates with the pendulum (Video Textures §3.1). They rejected
  // optical flow as brittle; the centroid we already compute gives the same
  // disambiguation for free, and a shot that pans one way will not now be
  // matched to one panning the other.
  let dx = 0
  let dy = 0
  for (let i = 1; i < frames.length; i++) {
    dx += frames[i].centroidX - frames[i - 1].centroidX
    dy += frames[i].centroidY - frames[i - 1].centroidY
  }
  const nd = Math.max(1, frames.length - 1)

  v[0] = avg((f) => f.brightness)
  v[1] = avg((f) => f.contrast)
  v[2] = clamp01(motionMean * 5)
  v[3] = avg((f) => f.edges)
  v[4] = avg((f) => f.entropy)
  v[5] = avg((f) => f.centroidX)
  v[6] = avg((f) => f.centroidY)
  v[7] = avg((f) => f.warmth)
  v[8] = avg((f) => f.green)
  v[9] = avg((f) => f.saturation)
  v[10] = avg((f) => f.satVar)
  v[11] = avg((f) => f.colorfulness)
  v[12] = avg((f) => f.texture)
  v[13] = avg((f) => f.grain)
  v[14] = clamp01(motionVar * 12)
  v[15] = clamp01(flicker * 14)
  v[16] = clamp01(0.5 + (dx / nd) * 12)
  v[17] = clamp01(0.5 + (dy / nd) * 12)
  return v
}

// ── Corpus statistics + scoring ──────────────────────────────────────────

/** Per-axis mean and standard deviation over the corpus. Matching runs on
 *  z-scores so a wide-ranging axis can't drown a narrow one. */
export function corpusStats(units: AssembleUnit[]): { mean: number[]; std: number[] } {
  const mean = new Array<number>(DESC_N).fill(0)
  const std = new Array<number>(DESC_N).fill(1)
  if (!units.length) return { mean, std }
  for (const u of units) for (let d = 0; d < DESC_N; d++) mean[d] += u.desc[d] ?? 0;
  for (let d = 0; d < DESC_N; d++) mean[d] /= units.length;
  for (const u of units) {
    for (let d = 0; d < DESC_N; d++) {
      const dv = (u.desc[d] ?? 0) - mean[d]
      std[d] += dv * dv
    }
  }
  // A degenerate axis (every unit identical) gets std 1 so it contributes 0
  // distance instead of dividing by ~0 and exploding.
  for (let d = 0; d < DESC_N; d++) {
    std[d] = Math.sqrt(std[d] / units.length)
    if (!(std[d] > 1e-4)) std[d] = 1
  }
  return { mean, std }
}

export function zscore(desc: number[], mean: number[], std: number[]): number[] {
  const z = new Array<number>(DESC_N)
  for (let d = 0; d < DESC_N; d++) z[d] = ((desc[d] ?? 0) - mean[d]) / std[d];
  return z
}

/** Weighted Euclidean distance in z-scored descriptor space. */
export function distance(a: number[], b: number[], w: number[]): number {
  let s = 0
  for (let d = 0; d < DESC_N; d++) {
    const wd = w[d]
    if (wd <= 0) continue
    const dv = (a[d] - b[d]) * wd
    s += dv * dv
  }
  return Math.sqrt(s)
}
