// Vision ingest bus (the RETURN PATH) : the picture plays back. Each frame the
// compositor hands us a small downsample of the PRESENTED image (Compositor
// .visionSample); we reduce it to a handful of control features. Those feed
// `vision` modulators (the image drives parameters internally) AND stream outbound
// over OSC (/opsia/vision/*), so Pandore's synths can be played by the composited
// picture : the inward half of the audiovisual loop (Rosa's Antwortverhältnis made
// two-way — the image can finally answer).
//
// Same discipline as the audio bus (engine/audioIn.ts) : never touches the React
// store, read per-frame by the modulation engine and the outbound OSC loop. The
// features are 1 frame behind the picture (you can't drive this frame's params
// from this frame's output) — the same benign latency as audio-reactivity.

import { frameStats } from '@shared/assemble'

export type VisionFeatureName =
  | 'brightness' // mean luminance 0..1
  | 'contrast' // luminance spread (max−min) 0..1
  | 'motion' // mean frame-to-frame change 0..1
  | 'edges' // mean gradient magnitude (busyness / detail) 0..1
  | 'entropy' // histogram disorder (texture complexity) 0..1
  | 'centroidX' // horizontal centre of the bright mass 0..1
  | 'centroidY' // vertical centre of the bright mass 0..1 (0 = top)
  | 'warmth' // red↔blue balance : 0 cool, 1 warm
  | 'depth' // mean scene depth (Depth engine) : 0 far, 1 near
  | 'depthSpread' // near↔far range in frame (depth relief / flatness) 0..1

export const VISION_FEATURES: VisionFeatureName[] = [
  'brightness',
  'contrast',
  'motion',
  'edges',
  'entropy',
  'centroidX',
  'centroidY',
  'warmth',
  'depth',
  'depthSpread'
]

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

class VisionBus {
  private f: Record<VisionFeatureName, number> = {
    brightness: 0,
    contrast: 0,
    motion: 0,
    edges: 0,
    entropy: 0,
    centroidX: 0.5,
    centroidY: 0.5,
    warmth: 0.5,
    depth: 0.5,
    depthSpread: 0
  }
  private gray: Float32Array | null = null
  private prev: Float32Array | null = null
  private ready = false
  // The live image expressed on the ASSEMBLE corpus's axes (the first
  // LIVE_DESC_N of DESCRIPTORS). Computed with the very same `frameStats` the
  // analyser runs, because several of these axes are NOT the same quantity as
  // the legacy feature above them — corpus `contrast` is RMS where the legacy
  // one is max−min, and corpus `warmth` is Dimopoulos–Winkler where the legacy
  // one is a raw R−B. Matching against the legacy numbers aimed the target at
  // systematically wrong coordinates.
  private desc: number[] | null = null
  private descGray: Float32Array | null = null

  /** Reduce a size×size RGBA8 grid (from Compositor.visionSample) to features. */
  ingest(grid: Uint8Array, size: number): void {
    const n = size * size
    if (!this.gray || this.gray.length !== n) {
      this.gray = new Float32Array(n)
      this.prev = new Float32Array(n)
    }
    const gray = this.gray
    const prev = this.prev as Float32Array
    let sum = 0, cx = 0, cy = 0, wsum = 0, min = 1, max = 0, rSum = 0, bSum = 0
    const hist = new Array(16).fill(0)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x
        const p = i * 4
        const r = grid[p] / 255, g = grid[p + 1] / 255, b = grid[p + 2] / 255
        const lum = r * 0.299 + g * 0.587 + b * 0.114
        gray[i] = lum
        sum += lum
        cx += lum * x; cy += lum * y; wsum += lum
        if (lum < min) min = lum
        if (lum > max) max = lum
        rSum += r; bSum += b
        hist[Math.min(15, (lum * 16) | 0)]++
      }
    }
    const mean = sum / n
    // motion : mean absolute difference from the previous grid.
    let motion = 0
    for (let i = 0; i < n; i++) motion += Math.abs(gray[i] - prev[i])
    motion /= n
    // edges : mean gradient magnitude over the interior (4-neighbour).
    let edges = 0, ec = 0
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x
        const gx = gray[i + 1] - gray[i - 1]
        const gy = gray[i + size] - gray[i - size]
        edges += Math.sqrt(gx * gx + gy * gy)
        ec++
      }
    }
    edges = ec ? edges / ec : 0
    // entropy : Shannon of the 16-bin luma histogram, normalized by log2(16)=4.
    let H = 0
    for (let k = 0; k < 16; k++) {
      const pk = hist[k] / n
      if (pk > 0) H -= pk * Math.log2(pk)
    }
    // centroid : GL grid is bottom-up, flip Y so 0 = top.
    const cX = wsum > 1e-4 ? cx / wsum / (size - 1) : 0.5
    const cY = wsum > 1e-4 ? 1 - cy / wsum / (size - 1) : 0.5

    // Gains chosen so the useful range of each feature maps to roughly 0..1.
    this.f.brightness = clamp01(mean)
    this.f.contrast = clamp01(max - min)
    this.f.motion = clamp01(motion * 5)
    this.f.edges = clamp01(edges * 2.5)
    this.f.entropy = clamp01(H / 4)
    this.f.centroidX = clamp01(cX)
    this.f.centroidY = clamp01(cY)
    this.f.warmth = clamp01(0.5 + (rSum - bSum) / n)
    this.ready = true

    // Corpus-compatible reading of the same grid, on the same code path the
    // analyser uses. `motion` has no per-frame equivalent in frameStats, so it
    // reuses the value computed above with the identical ×5 gain `aggregate`
    // applies. centroidY is flipped because the GL grid arrives bottom-up while
    // the analyser's ffmpeg frames are top-down.
    if (!this.descGray || this.descGray.length !== n) this.descGray = new Float32Array(n)
    const fs = frameStats(grid, this.descGray, size, 4)
    this.desc = [
      fs.brightness,
      fs.contrast,
      clamp01(motion * 5),
      fs.edges,
      fs.entropy,
      fs.centroidX,
      1 - fs.centroidY,
      fs.warmth
    ]

    // Ping-pong : this frame becomes the previous one.
    this.gray = prev
    this.prev = gray
  }

  /** Depth stats from the Depth engine (fed separately : depth isn't in the grid). */
  setDepth(mean: number, spread: number): void {
    this.f.depth = clamp01(mean)
    this.f.depthSpread = clamp01(spread)
  }

  feature(name: VisionFeatureName): number {
    return this.f[name] ?? 0
  }
  hasData(): boolean {
    return this.ready
  }

  /** The live image on the Assemble corpus's axes, or null before the first
   *  ingest. Assemble's target-driven mode reads this, never `feature()`. */
  descriptor(): number[] | null {
    return this.desc
  }
}

// One bus per renderer : App's loop ingests it after render; the modulation engine
// and the outbound OSC loop read it.
export const visionBus = new VisionBus()
