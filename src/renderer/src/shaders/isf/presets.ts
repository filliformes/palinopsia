// Per-shader presets — 10 named settings per shader, hand-curated in the
// same register as the curated Randomize ranges (brief §7): these are the
// instrument's starting points, not random draws. Values are partial input
// maps applied through the store's normal write path, so presets are
// undoable and modulation overlays them like any base value.
//
// Bools follow the store's numeric convention (0/1). Angles are radians.

export interface ShaderPreset {
  name: string
  values: Record<string, number | number[]>
}

export const PRESETS_BY_ID: Record<string, ShaderPreset[]> = {
  // ── Generators ──────────────────────────────────────────────────────
  'drift-field': [
    { name: 'Slow tide', values: { rate: 0.07, scale: 1.6, warp: 0.3, steps: 4, contrast: 1.05, split: 0.08 } },
    { name: 'Topo map', values: { rate: 0.12, scale: 3.4, warp: 0.85, steps: 9, contrast: 1.3, split: 0.05 } },
    { name: 'Silt', values: { rate: 0.05, scale: 5, warp: 0.5, steps: 12, contrast: 0.95, split: 0.15 } },
    { name: 'Torn banner', values: { rate: 0.22, scale: 2.2, warp: 1.2, steps: 3, contrast: 1.5, split: 0.3 } },
    { name: 'Deep field', values: { rate: 0.1, scale: 1.2, warp: 0.6, steps: 6, contrast: 1.6, split: 0.02, tint: [0.2, 0.35, 0.8, 1] } },
    { name: 'Heat haze', values: { rate: 0.35, scale: 4, warp: 1.4, steps: 14, contrast: 1.1, split: 0.4, tint: [0.85, 0.45, 0.2, 1] } },
    { name: 'Chalk veins', values: { rate: 0.09, scale: 6.5, warp: 0.9, steps: 5, contrast: 1.4, split: 0.1, tint: [0.85, 0.85, 0.8, 1] } },
    { name: 'Signal ghost', values: { rate: 0.18, scale: 2.8, warp: 0.7, steps: 4, contrast: 1.25, split: 0.9, tint: [0.16, 0.82, 0.74, 1] } },
    { name: 'Bruise', values: { rate: 0.06, scale: 2, warp: 1.1, steps: 7, contrast: 1.35, split: 0.12, tint: [0.45, 0.2, 0.5, 1] } },
    { name: 'Static bloom', values: { rate: 0.5, scale: 7.5, warp: 1.5, steps: 16, contrast: 1.8, split: 0.6 } }
  ],
  slabs: [
    { name: 'Freight', values: { rate: 0.2, bands: 14, density: 0.3, jitter: 0.25, drift: 0.3, accent: 0.2 } },
    { name: 'Ticker', values: { rate: 0.6, bands: 30, density: 0.5, jitter: 0.15, drift: 0.7, accent: 0.1 } },
    { name: 'Dense grid', values: { rate: 0.3, bands: 60, density: 0.6, jitter: 0.4, drift: 0.2, accent: 0.35 } },
    { name: 'Sparse code', values: { rate: 0.15, bands: 10, density: 0.15, jitter: 0.1, drift: 0.1, accent: 0.5 } },
    { name: 'Broken fax', values: { rate: 0.8, bands: 44, density: 0.45, jitter: 0.9, drift: 0.4, accent: 0.15 } },
    { name: 'Amber terminal', values: { rate: 0.25, bands: 24, density: 0.4, jitter: 0.3, drift: 0.25, accent: 0.6, tint: [0.95, 0.6, 0.15, 1] } },
    { name: 'Cold storage', values: { rate: 0.1, bands: 18, density: 0.25, jitter: 0.2, drift: 0.15, accent: 0.4, tint: [0.35, 0.6, 0.85, 1] } },
    { name: 'Redline', values: { rate: 0.45, bands: 36, density: 0.35, jitter: 0.55, drift: 0.5, accent: 0.7, tint: [0.9, 0.15, 0.15, 1] } },
    { name: 'Archive', values: { rate: 0.05, bands: 50, density: 0.7, jitter: 0.05, drift: 0.05, accent: 0.1, tint: [0.8, 0.78, 0.7, 1] } },
    { name: 'Panic room', values: { rate: 1.0, bands: 26, density: 0.55, jitter: 1.0, drift: 0.9, accent: 0.45 } }
  ],

  contour: [
    { name: 'Survey map', values: { rate: 0.06, scale: 2.2, levels: 12, width: 0.1, warp: 0.4, fill: 0.1 } },
    { name: 'Dense relief', values: { rate: 0.08, scale: 3.5, levels: 20, width: 0.08, warp: 0.6, fill: 0.05 } },
    { name: 'Wide basins', values: { rate: 0.05, scale: 1.2, levels: 6, width: 0.15, warp: 0.5, fill: 0.25 } },
    { name: 'Storm chart', values: { rate: 0.25, scale: 2.8, levels: 14, width: 0.12, warp: 1.1, fill: 0.08 } },
    { name: 'Ink terraces', values: { rate: 0.04, scale: 2, levels: 9, width: 0.28, warp: 0.3, fill: 0.45 } },
    { name: 'Hairline topo', values: { rate: 0.1, scale: 4.5, levels: 26, width: 0.04, warp: 0.7, fill: 0 } },
    { name: 'Blue chart', values: { rate: 0.07, scale: 2.5, levels: 12, width: 0.1, warp: 0.5, fill: 0.15, tint: [0.35, 0.55, 0.85, 1] } },
    { name: 'Amber field', values: { rate: 0.12, scale: 3, levels: 10, width: 0.14, warp: 0.8, fill: 0.2, tint: [0.9, 0.6, 0.2, 1] } },
    { name: 'Slow melt', values: { rate: 0.02, scale: 1.8, levels: 16, width: 0.09, warp: 1.4, fill: 0.1 } },
    { name: 'Shoreline', values: { rate: 0.15, scale: 1.5, levels: 5, width: 0.2, warp: 0.9, fill: 0.35, tint: [0.5, 0.75, 0.7, 1] } }
  ],
  'grid-drift': [
    { name: 'Quiet lattice', values: { cells: 12, rate: 0.08, breathe: 0.2, slip: 0.1, lineW: 0.04, density: 0.08 } },
    { name: 'Loose weave', values: { cells: 8, rate: 0.15, breathe: 0.6, slip: 0.2, lineW: 0.06, density: 0.12 } },
    { name: 'Slipping floors', values: { cells: 14, rate: 0.2, breathe: 0.3, slip: 0.55, lineW: 0.05, density: 0.15 } },
    { name: 'Dense mesh', values: { cells: 30, rate: 0.1, breathe: 0.25, slip: 0.15, lineW: 0.03, density: 0.05 } },
    { name: 'Big rooms', values: { cells: 4, rate: 0.06, breathe: 0.4, slip: 0.3, lineW: 0.09, density: 0.3 } },
    { name: 'Filing error', values: { cells: 18, rate: 0.35, breathe: 0.5, slip: 0.7, lineW: 0.04, density: 0.2 } },
    { name: 'Blueprint', values: { cells: 16, rate: 0.05, breathe: 0.15, slip: 0.05, lineW: 0.05, density: 0.1, tint: [0.4, 0.6, 0.9, 1] } },
    { name: 'Amber ledger', values: { cells: 10, rate: 0.12, breathe: 0.35, slip: 0.25, lineW: 0.06, density: 0.22, tint: [0.9, 0.65, 0.25, 1] } },
    { name: 'Fault lines', values: { cells: 22, rate: 0.25, breathe: 0.8, slip: 0.45, lineW: 0.03, density: 0.08 } },
    { name: 'Population', values: { cells: 26, rate: 0.1, breathe: 0.2, slip: 0.2, lineW: 0.02, density: 0.5 } }
  ],
  'particle-drift': [
    { name: 'Slow field', values: { count: 12, speed: 0.25, flow: 0.4, size: 0.09, trail: 0.6, jitter: 0.5, vary: 0.6 } },
    { name: 'Dust stream', values: { count: 24, speed: 0.7, flow: 0.2, size: 0.05, trail: 1.2, jitter: 0.3, vary: 0.35 } },
    { name: 'Rising embers', values: { count: 16, speed: 0.5, flow: 1.5708, size: 0.07, trail: 0.9, jitter: 0.6, vary: 0.75, tint: [0.9, 0.55, 0.25, 1] } },
    { name: 'Sparse drifters', values: { count: 6, speed: 0.3, flow: 0.8, size: 0.16, trail: 0.4, jitter: 0.7, vary: 0.85 } },
    { name: 'Sideways rain', values: { count: 30, speed: 1.1, flow: 3.4, size: 0.04, trail: 1.6, jitter: 0.2, vary: 0.25 } },
    { name: 'Plankton', values: { count: 20, speed: 0.15, flow: 4.7, size: 0.08, trail: 0.15, jitter: 0.9, vary: 0.95, tint: [0.45, 0.8, 0.75, 1] } },
    { name: 'Falling slow', values: { count: 14, speed: 0.4, flow: 4.7124, size: 0.1, trail: 0.8, jitter: 0.4, vary: 0.5 } },
    { name: 'Comet lane', values: { count: 8, speed: 1.4, flow: 0, size: 0.12, trail: 2, jitter: 0.25, vary: 0.3 } },
    { name: 'Still swarm', values: { count: 34, speed: 0.05, flow: 2.3, size: 0.06, trail: 0.1, jitter: 1, vary: 1 } },
    { name: 'Signal blue', values: { count: 18, speed: 0.6, flow: 5.9, size: 0.07, trail: 1, jitter: 0.5, vary: 0.55, tint: [0.4, 0.6, 0.95, 1] } }
  ],
  interference: [
    { name: 'Silk beat', values: { freq: 40, detune: 0.02, angle: 0.35, skew: 0.1, rate: 0.1, contrast: 1.3 } },
    { name: 'Slow weave', values: { freq: 24, detune: 0.01, angle: 0.9, skew: 0.06, rate: 0.05, contrast: 1.1 } },
    { name: 'Tight mesh', values: { freq: 80, detune: 0.03, angle: 0.2, skew: 0.2, rate: 0.15, contrast: 1.6 } },
    { name: 'Broad bands', values: { freq: 14, detune: 0.05, angle: 1.2, skew: 0.15, rate: 0.08, contrast: 1.2 } },
    { name: 'Crawl', values: { freq: 50, detune: 0.008, angle: 0.5, skew: 0.05, rate: 0.3, contrast: 1.4 } },
    { name: 'Fabric fault', values: { freq: 60, detune: 0.07, angle: 2.1, skew: 0.35, rate: 0.2, contrast: 1.8 } },
    { name: 'Deep beat', values: { freq: 30, detune: 0.015, angle: 0.7, skew: 0.08, rate: 0.06, contrast: 2.1 } },
    { name: 'Cold screen', values: { freq: 70, detune: 0.025, angle: 0.1, skew: 0.12, rate: 0.12, contrast: 1.5, tint: [0.45, 0.6, 0.8, 1] } },
    { name: 'Warm gauze', values: { freq: 35, detune: 0.04, angle: 1.6, skew: 0.25, rate: 0.1, contrast: 1.2, tint: [0.85, 0.65, 0.4, 1] } },
    { name: 'Standing wave', values: { freq: 45, detune: 0, angle: 0.4, skew: 0.3, rate: 0.25, contrast: 1.7 } }
  ],
  'column-scan': [
    { name: 'Calm scan', values: { lines: 40, amp: 0.03, scale: 2, rate: 0.1, width: 0.12 } },
    { name: 'Deep signal', values: { lines: 30, amp: 0.09, scale: 1.5, rate: 0.12, width: 0.15 } },
    { name: 'Fine raster', values: { lines: 85, amp: 0.02, scale: 3, rate: 0.15, width: 0.08 } },
    { name: 'Slow sea', values: { lines: 25, amp: 0.06, scale: 1, rate: 0.04, width: 0.2 } },
    { name: 'Nervous trace', values: { lines: 50, amp: 0.04, scale: 6, rate: 0.45, width: 0.1 } },
    { name: 'Broad ribbon', values: { lines: 15, amp: 0.1, scale: 2.5, rate: 0.08, width: 0.4 } },
    { name: 'Green terminal', values: { lines: 45, amp: 0.05, scale: 2.2, rate: 0.18, width: 0.12, tint: [0.4, 0.85, 0.45, 1] } },
    { name: 'Hot wire', values: { lines: 35, amp: 0.07, scale: 3.5, rate: 0.3, width: 0.09, tint: [0.95, 0.5, 0.2, 1] } },
    { name: 'Whisper lines', values: { lines: 70, amp: 0.015, scale: 1.8, rate: 0.06, width: 0.06 } },
    { name: 'Signal storm', values: { lines: 55, amp: 0.13, scale: 5, rate: 0.7, width: 0.14 } }
  ],
  ash: [
    { name: 'Settling', values: { count: 24, speed: 0.2, size: 0.08, wander: 0.4, flicker: 0.3, accent: 0.25 } },
    { name: 'Slow fall', values: { count: 16, speed: 0.1, size: 0.12, wander: 0.25, flicker: 0.2, accent: 0.15 } },
    { name: 'Fine soot', values: { count: 45, speed: 0.35, size: 0.04, wander: 0.5, flicker: 0.4, accent: 0.1 } },
    { name: 'Ember drift', values: { count: 20, speed: 0.3, size: 0.09, wander: 0.6, flicker: 0.55, accent: 0.6, tint: [0.95, 0.45, 0.15, 1] } },
    { name: 'Grey weather', values: { count: 32, speed: 0.5, size: 0.06, wander: 0.7, flicker: 0.25, accent: 0.05 } },
    { name: 'Sparse flakes', values: { count: 9, speed: 0.15, size: 0.18, wander: 0.35, flicker: 0.3, accent: 0.3 } },
    { name: 'Blue static', values: { count: 40, speed: 0.7, size: 0.05, wander: 0.8, flicker: 0.6, accent: 0.4, tint: [0.4, 0.6, 0.95, 1] } },
    { name: 'Aftermath', values: { count: 28, speed: 0.08, size: 0.07, wander: 0.2, flicker: 0.15, accent: 0.2 } },
    { name: 'Updraft', values: { count: 22, speed: 0.9, size: 0.06, wander: 0.9, flicker: 0.45, accent: 0.35 } },
    { name: 'Last sparks', values: { count: 12, speed: 0.25, size: 0.1, wander: 0.5, flicker: 0.8, accent: 0.8, tint: [0.95, 0.6, 0.2, 1] } }
  ],

  // ── FX ──────────────────────────────────────────────────────────────
  'fx-posterize': [
    { name: '2-bit', values: { levels: 2, gamma: 1 } },
    { name: 'Print bands', values: { levels: 4, gamma: 1.1 } },
    { name: 'Soft six', values: { levels: 6, gamma: 0.9 } },
    { name: 'Shadow crush', values: { levels: 5, gamma: 1.6 } },
    { name: 'Highlight crush', values: { levels: 5, gamma: 0.6 } },
    { name: 'Poster eight', values: { levels: 8, gamma: 1 } },
    { name: 'Near-continuous', values: { levels: 16, gamma: 1 } },
    { name: 'Ink wash', values: { levels: 3, gamma: 1.3 } },
    { name: 'Bleached', values: { levels: 4, gamma: 0.7 } },
    { name: 'Steps 12', values: { levels: 12, gamma: 1.2 } }
  ],
  'fx-dither': [
    { name: 'Newspaper', values: { levels: 2, scale: 2, amount: 1 } },
    { name: 'Fine screen', values: { levels: 2, scale: 1, amount: 1 } },
    { name: 'Coarse screen', values: { levels: 2, scale: 5, amount: 1 } },
    { name: 'Three-tone', values: { levels: 3, scale: 2, amount: 1 } },
    { name: 'Subtle texture', values: { levels: 5, scale: 2, amount: 0.5 } },
    { name: 'Half mix', values: { levels: 3, scale: 3, amount: 0.55 } },
    { name: 'Gameboy-adjacent', values: { levels: 4, scale: 4, amount: 1 } },
    { name: 'Ghost grid', values: { levels: 6, scale: 6, amount: 0.35 } },
    { name: 'Heavy mesh', values: { levels: 2, scale: 8, amount: 0.9 } },
    { name: 'Whisper', values: { levels: 8, scale: 1, amount: 0.25 } }
  ],
  'fx-chroma-shift': [
    { name: 'Hairline', values: { amount: 0.002, angle: 0 } },
    { name: 'Subtle fringe', values: { amount: 0.005, angle: 0 } },
    { name: 'Broadcast error', values: { amount: 0.012, angle: 0 } },
    { name: 'Vertical tear', values: { amount: 0.01, angle: 1.5708 } },
    { name: 'Diagonal drift', values: { amount: 0.008, angle: 0.7854 } },
    { name: 'Heavy split', values: { amount: 0.025, angle: 0 } },
    { name: 'Extreme', values: { amount: 0.045, angle: 0 } },
    { name: 'Up-down', values: { amount: 0.018, angle: 1.5708 } },
    { name: 'Skew left', values: { amount: 0.015, angle: 2.3562 } },
    { name: 'Print misregister', values: { amount: 0.007, angle: 5.4978 } }
  ],
  'fx-pixelate': [
    { name: 'Fine mosaic', values: { cells: 320 } },
    { name: 'Standard mosaic', values: { cells: 160 } },
    { name: 'Chunky', values: { cells: 80 } },
    { name: 'Blocks', values: { cells: 48 } },
    { name: 'Big blocks', values: { cells: 28 } },
    { name: 'Brutal', values: { cells: 16 } },
    { name: 'Census', values: { cells: 10 } },
    { name: 'Micro grid', values: { cells: 400 } },
    { name: 'Mid grid', values: { cells: 120 } },
    { name: 'Nine-by', values: { cells: 8 } }
  ],
  'fx-displace': [
    { name: 'Paper warp', values: { amount: 0.015, scale: 2.5, rate: 0.08 } },
    { name: 'Water glass', values: { amount: 0.03, scale: 5, rate: 0.2 } },
    { name: 'Slow lens', values: { amount: 0.05, scale: 1.5, rate: 0.05 } },
    { name: 'Nervous', values: { amount: 0.02, scale: 9, rate: 0.6 } },
    { name: 'Deep bend', values: { amount: 0.1, scale: 2, rate: 0.1 } },
    { name: 'Shimmer', values: { amount: 0.01, scale: 11, rate: 0.4 } },
    { name: 'Molasses', values: { amount: 0.07, scale: 3.5, rate: 0.03 } },
    { name: 'Tectonic', values: { amount: 0.15, scale: 1, rate: 0.02 } },
    { name: 'Fritz', values: { amount: 0.04, scale: 7, rate: 0.9 } },
    { name: 'Breath', values: { amount: 0.025, scale: 0.8, rate: 0.12 } }
  ],
  'fx-scanlines': [
    { name: 'Faint CRT', values: { count: 500, darkness: 0.15, roll: 0 } },
    { name: 'Studio monitor', values: { count: 400, darkness: 0.3, roll: 0 } },
    { name: 'Slow roll', values: { count: 350, darkness: 0.25, roll: 0.15 } },
    { name: 'Fast roll', values: { count: 300, darkness: 0.3, roll: 0.8 } },
    { name: 'Coarse lines', values: { count: 120, darkness: 0.4, roll: 0 } },
    { name: 'Venetian', values: { count: 60, darkness: 0.55, roll: 0.05 } },
    { name: 'Hairlines', values: { count: 1100, darkness: 0.2, roll: 0 } },
    { name: 'Heavy grille', values: { count: 220, darkness: 0.7, roll: 0 } },
    { name: 'Interference', values: { count: 800, darkness: 0.35, roll: 0.5 } },
    { name: 'Whisper', values: { count: 600, darkness: 0.08, roll: 0.02 } }
  ],
  'fx-edge': [
    { name: 'Wireframe', values: { gain: 2, blend: 1 } },
    { name: 'Etch', values: { gain: 3.5, blend: 1 } },
    { name: 'Faint contour', values: { gain: 1, blend: 1 } },
    { name: 'Edge lift', values: { gain: 2, blend: 0.35 } },
    { name: 'Half ghost', values: { gain: 1.5, blend: 0.5 } },
    { name: 'Ink outline', values: { gain: 4, blend: 0.85 } },
    { name: 'Skeleton', values: { gain: 2.8, blend: 1 } },
    { name: 'Texture find', values: { gain: 0.8, blend: 0.7 } },
    { name: 'Overlay trace', values: { gain: 2.2, blend: 0.25 } },
    { name: 'Burnt line', values: { gain: 3, blend: 0.6 } }
  ],
  'fx-grade': [
    { name: 'Lift blacks', values: { brightness: 0, contrast: 1, saturation: 1, lift: 0.06 } },
    { name: 'Crush', values: { brightness: -0.08, contrast: 1.6, saturation: 0.9, lift: 0 } },
    { name: 'Matte fade', values: { brightness: 0.03, contrast: 0.85, saturation: 0.7, lift: 0.1 } },
    { name: 'Mono', values: { brightness: 0, contrast: 1.1, saturation: 0, lift: 0.02 } },
    { name: 'Half mono', values: { brightness: 0, contrast: 1.05, saturation: 0.4, lift: 0.03 } },
    { name: 'Punch', values: { brightness: 0.02, contrast: 1.45, saturation: 1.25, lift: 0 } },
    { name: 'Dim room', values: { brightness: -0.15, contrast: 1.15, saturation: 0.8, lift: 0 } },
    { name: 'Overexposed', values: { brightness: 0.2, contrast: 0.9, saturation: 0.75, lift: 0.05 } },
    { name: 'Night bus', values: { brightness: -0.1, contrast: 1.3, saturation: 0.55, lift: 0.08 } },
    { name: 'Neutral+', values: { brightness: 0.01, contrast: 1.1, saturation: 1.05, lift: 0.01 } }
  ],
  'fx-slice-shuffle': [
    { name: 'Rare jump', values: { slices: 24, amount: 0.08, chance: 0.12, rate: 0.25 } },
    { name: 'Busy tape', values: { slices: 40, amount: 0.12, chance: 0.35, rate: 0.6 } },
    { name: 'Wide tears', values: { slices: 8, amount: 0.2, chance: 0.3, rate: 0.3 } },
    { name: 'Micro jitter', values: { slices: 90, amount: 0.03, chance: 0.4, rate: 0.8 } },
    { name: 'Broken sync', values: { slices: 16, amount: 0.35, chance: 0.5, rate: 0.45 } },
    { name: 'Occasional slip', values: { slices: 30, amount: 0.05, chance: 0.08, rate: 0.15 } },
    { name: 'Shredder', values: { slices: 64, amount: 0.25, chance: 0.7, rate: 0.9 } },
    { name: 'Slow drift cut', values: { slices: 12, amount: 0.1, chance: 0.2, rate: 0.05 } },
    { name: 'Panic', values: { slices: 48, amount: 0.45, chance: 0.85, rate: 1 } },
    { name: 'Print offset', values: { slices: 20, amount: 0.02, chance: 0.6, rate: 0.1 } }
  ],
  'fx-smear': [
    { name: 'Rain down', values: { reach: 0.08, threshold: 0.45, angle: 4.7124 } },
    { name: 'Rise', values: { reach: 0.08, threshold: 0.45, angle: 1.5708 } },
    { name: 'Comet left', values: { reach: 0.15, threshold: 0.5, angle: 3.1416 } },
    { name: 'Faint drag', values: { reach: 0.03, threshold: 0.35, angle: 0 } },
    { name: 'Hard sort', values: { reach: 0.25, threshold: 0.6, angle: 1.5708 } },
    { name: 'Low gate', values: { reach: 0.1, threshold: 0.15, angle: 1.5708 } },
    { name: 'High gate', values: { reach: 0.12, threshold: 0.8, angle: 1.5708 } },
    { name: 'Diagonal fall', values: { reach: 0.1, threshold: 0.4, angle: 5.4978 } },
    { name: 'Full melt', values: { reach: 0.3, threshold: 0.25, angle: 4.7124 } },
    { name: 'Whisper streaks', values: { reach: 0.05, threshold: 0.55, angle: 0.7854 } }
  ],
  'fx-palette': [
    { name: 'Cyanotype', values: { stops: 4, blend: 1, dither: 0.15, mixSrc: 0, colorA: [0.02, 0.03, 0.08, 1], colorB: [0.05, 0.15, 0.4, 1], colorC: [0.2, 0.5, 0.75, 1], colorD: [0.85, 0.92, 0.95, 1] } },
    { name: 'Newsprint', values: { stops: 2, blend: 0, dither: 0.6, mixSrc: 0, colorA: [0.08, 0.08, 0.07, 1], colorB: [0.9, 0.88, 0.82, 1] } },
    { name: 'Rust', values: { stops: 4, blend: 1, dither: 0.1, mixSrc: 0, colorA: [0.04, 0.02, 0.02, 1], colorB: [0.35, 0.1, 0.08, 1], colorC: [0.7, 0.35, 0.15, 1], colorD: [0.9, 0.85, 0.7, 1] } },
    { name: 'Teal & Orange', values: { stops: 3, blend: 1, dither: 0, mixSrc: 0.15, colorA: [0.03, 0.1, 0.12, 1], colorB: [0.1, 0.45, 0.5, 1], colorC: [0.95, 0.6, 0.25, 1] } },
    { name: 'Moss', values: { stops: 4, blend: 1, dither: 0.05, mixSrc: 0, colorA: [0.02, 0.04, 0.02, 1], colorB: [0.1, 0.25, 0.12, 1], colorC: [0.45, 0.55, 0.3, 1], colorD: [0.9, 0.88, 0.75, 1] } },
    { name: 'Violet duotone', values: { stops: 3, blend: 1, dither: 0.2, mixSrc: 0, colorA: [0.03, 0.02, 0.05, 1], colorB: [0.4, 0.2, 0.55, 1], colorC: [0.95, 0.92, 0.98, 1] } },
    { name: 'Signal red', values: { stops: 4, blend: 0.4, dither: 0.1, mixSrc: 0, colorA: [0.04, 0.04, 0.05, 1], colorB: [0.3, 0.3, 0.32, 1], colorC: [0.85, 0.12, 0.12, 1], colorD: [0.95, 0.93, 0.9, 1] } },
    { name: 'Broadcast', values: { stops: 3, blend: 1, dither: 0, mixSrc: 0.25, colorA: [0.05, 0.05, 0.08, 1], colorB: [0.3, 0.38, 0.48, 1], colorC: [0.9, 0.7, 0.3, 1] } },
    { name: 'Bone', values: { stops: 4, blend: 1, dither: 0.08, mixSrc: 0, colorA: [0.05, 0.05, 0.04, 1], colorB: [0.35, 0.33, 0.3, 1], colorC: [0.72, 0.68, 0.6, 1], colorD: [0.96, 0.94, 0.88, 1] } },
    { name: 'Thermal (matte)', values: { stops: 5, blend: 1, dither: 0.12, mixSrc: 0, colorA: [0.02, 0.02, 0.06, 1], colorB: [0.25, 0.08, 0.3, 1], colorC: [0.65, 0.15, 0.2, 1], colorD: [0.9, 0.55, 0.2, 1], colorE: [0.95, 0.9, 0.75, 1] } }
  ],
  'fx-threshold': [
    { name: 'Half cut', values: { level: 0.5, soft: 0.05, invert: 0 } },
    { name: 'Soft key', values: { level: 0.5, soft: 0.3, invert: 0 } },
    { name: 'Hard ink', values: { level: 0.45, soft: 0.005, invert: 0 } },
    { name: 'Shadows only', values: { level: 0.3, soft: 0.08, invert: 0 } },
    { name: 'Highlights only', values: { level: 0.7, soft: 0.08, invert: 0 } },
    { name: 'Negative', values: { level: 0.5, soft: 0.05, invert: 1 } },
    { name: 'Soft negative', values: { level: 0.55, soft: 0.35, invert: 1 } },
    { name: 'Thin whites', values: { level: 0.8, soft: 0.02, invert: 0 } },
    { name: 'Fat whites', values: { level: 0.25, soft: 0.04, invert: 0 } },
    { name: 'Gradient gate', values: { level: 0.5, soft: 0.5, invert: 0 } }
  ],
  'fx-solarize': [
    { name: 'Classic fold', values: { level: 0.6, strength: 0.85 } },
    { name: 'Gentle bend', values: { level: 0.7, strength: 0.4 } },
    { name: 'Deep fold', values: { level: 0.45, strength: 1 } },
    { name: 'Highlight flip', values: { level: 0.8, strength: 1 } },
    { name: 'Mids melt', values: { level: 0.5, strength: 0.65 } },
    { name: 'Faint sabattier', values: { level: 0.65, strength: 0.25 } },
    { name: 'Low fold', values: { level: 0.3, strength: 0.8 } },
    { name: 'Full invert-ish', values: { level: 0.15, strength: 1 } },
    { name: 'Half strength', values: { level: 0.55, strength: 0.5 } },
    { name: 'Edge of light', values: { level: 0.9, strength: 0.9 } }
  ],
  'fx-mosh-blocks': [
    { name: 'Rare corrupt', values: { blocks: 24, amount: 0.1, chance: 0.12, rate: 0.3 } },
    { name: 'Busy stream', values: { blocks: 32, amount: 0.15, chance: 0.35, rate: 0.7 } },
    { name: 'Big tiles', values: { blocks: 8, amount: 0.2, chance: 0.25, rate: 0.25 } },
    { name: 'Fine crumble', values: { blocks: 80, amount: 0.08, chance: 0.4, rate: 0.6 } },
    { name: 'Deep tear', values: { blocks: 16, amount: 0.4, chance: 0.3, rate: 0.4 } },
    { name: 'Whisper mosh', values: { blocks: 40, amount: 0.04, chance: 0.15, rate: 0.2 } },
    { name: 'Keyframe lost', values: { blocks: 20, amount: 0.3, chance: 0.6, rate: 0.5 } },
    { name: 'Slow decay', values: { blocks: 28, amount: 0.12, chance: 0.2, rate: 0.05 } },
    { name: 'Full corrupt', values: { blocks: 48, amount: 0.5, chance: 0.9, rate: 0.9 } },
    { name: 'Checker slip', values: { blocks: 12, amount: 0.06, chance: 0.5, rate: 0.15 } }
  ],
  'fx-grain': [
    { name: 'Film light', values: { amount: 0.08, size: 1, mono: 1 } },
    { name: 'Film heavy', values: { amount: 0.25, size: 1.5, mono: 1 } },
    { name: 'Coarse static', values: { amount: 0.3, size: 3, mono: 1 } },
    { name: 'Color noise', values: { amount: 0.15, size: 1.5, mono: 0 } },
    { name: 'Chunky RGB', values: { amount: 0.35, size: 4, mono: 0 } },
    { name: 'Whisper', values: { amount: 0.04, size: 1, mono: 1 } },
    { name: 'Broadcast floor', values: { amount: 0.12, size: 2, mono: 1 } },
    { name: 'Sandpaper', values: { amount: 0.45, size: 2, mono: 1 } },
    { name: 'Soft color wash', values: { amount: 0.1, size: 5, mono: 0 } },
    { name: 'Blizzard', values: { amount: 0.7, size: 3, mono: 1 } }
  ],
  'fx-streak': [
    { name: 'Slight drag', values: { reach: 0.02, angle: 0 } },
    { name: 'Pan blur', values: { reach: 0.08, angle: 0 } },
    { name: 'Fall', values: { reach: 0.08, angle: 4.7124 } },
    { name: 'Long horizon', values: { reach: 0.2, angle: 0 } },
    { name: 'Diagonal rush', values: { reach: 0.12, angle: 0.7854 } },
    { name: 'Vertical soften', values: { reach: 0.04, angle: 1.5708 } },
    { name: 'Full smear', values: { reach: 0.3, angle: 0 } },
    { name: 'Rain streak', values: { reach: 0.15, angle: 4.9742 } },
    { name: 'Drift up', values: { reach: 0.06, angle: 1.5708 } },
    { name: 'Ghost pan', values: { reach: 0.25, angle: 3.1416 } }
  ],
  'fx-sharpen': [
    { name: 'Gentle', values: { amount: 0.4 } },
    { name: 'Standard', values: { amount: 0.8 } },
    { name: 'Crisp', values: { amount: 1.2 } },
    { name: 'Bite', values: { amount: 1.8 } },
    { name: 'Hard bite', values: { amount: 2.4 } },
    { name: 'Extreme ring', values: { amount: 3 } },
    { name: 'Hairline', values: { amount: 0.2 } },
    { name: 'Post-dither snap', values: { amount: 1 } },
    { name: 'Post-blur rescue', values: { amount: 1.5 } },
    { name: 'Edge scream', values: { amount: 2.8 } }
  ],
  'fx-fold': [
    { name: 'Right fold', values: { vertical: 0, seam: 0.62, offset: 0.08 } },
    { name: 'High seam', values: { vertical: 0, seam: 0.8, offset: 0.05 } },
    { name: 'Near-half', values: { vertical: 0, seam: 0.56, offset: 0.15 } },
    { name: 'Deep slide', values: { vertical: 0, seam: 0.65, offset: 0.4 } },
    { name: 'Ceiling fold', values: { vertical: 1, seam: 0.7, offset: 0.1 } },
    { name: 'Floor fold', values: { vertical: 1, seam: 0.35, offset: 0.06 } },
    { name: 'Slip mirror', values: { vertical: 0, seam: 0.7, offset: -0.25 } },
    { name: 'Thin echo', values: { vertical: 0, seam: 0.88, offset: 0.02 } },
    { name: 'Broken book', values: { vertical: 1, seam: 0.6, offset: 0.3 } },
    { name: 'Counter-slide', values: { vertical: 1, seam: 0.75, offset: -0.35 } }
  ],
  'fx-transform': [
    { name: 'Punch in', values: { zoom: 1.3, posX: 0, posY: 0, rotate: 0, wrap: 0 } },
    { name: 'Pull back tiled', values: { zoom: 0.7, posX: 0, posY: 0, rotate: 0, wrap: 1 } },
    { name: 'Off-centre', values: { zoom: 1.1, posX: 0.25, posY: -0.15, rotate: 0, wrap: 1 } },
    { name: 'Slight tilt', values: { zoom: 1.05, posX: 0, posY: 0, rotate: 0.12, wrap: 1 } },
    { name: 'Hard tilt', values: { zoom: 1.2, posX: 0, posY: 0, rotate: 0.5, wrap: 1 } },
    { name: 'Counter tilt', values: { zoom: 1.15, posX: -0.1, posY: 0.1, rotate: -0.35, wrap: 1 } },
    { name: 'Tile field', values: { zoom: 0.45, posX: 0, posY: 0, rotate: 0.08, wrap: 1 } },
    { name: 'Macro', values: { zoom: 2.4, posX: 0.1, posY: 0.1, rotate: 0, wrap: 0 } },
    { name: 'Corner peek', values: { zoom: 1.6, posX: 0.4, posY: 0.35, rotate: 0, wrap: 0 } },
    { name: 'Upside down', values: { zoom: 1, posX: 0, posY: 0, rotate: 3.1416, wrap: 1 } }
  ],
  'fx-stutter': [
    { name: 'Rare freeze', values: { rate: 4, chance: 0.2 } },
    { name: 'Half hold', values: { rate: 6, chance: 0.5 } },
    { name: 'Long holds', values: { rate: 1.5, chance: 0.5 } },
    { name: 'Fast flicker', values: { rate: 14, chance: 0.45 } },
    { name: 'Mostly frozen', values: { rate: 5, chance: 0.85 } },
    { name: 'Barely there', values: { rate: 8, chance: 0.1 } },
    { name: 'Tape jam', values: { rate: 2.5, chance: 0.7 } },
    { name: 'Strobe hold', values: { rate: 18, chance: 0.6 } },
    { name: 'Breath hold', values: { rate: 1, chance: 0.35 } },
    { name: 'Machine gun', values: { rate: 20, chance: 0.5 } }
  ]
}
