// Background bank : the curated source set + 25 built-in background presets.
//
// The Background is the GROUND under the four layers: its picker offers every
// generator except the ones that read as figures or need user intent
// (Recurse, Text, Filaments, Congeal, Swell, Mycelium : per Vincent).
// A preset = source + params + FX chain + opacity/speed. Values are PARTIAL
// inputs (unset params keep their defaults). Default background speed 0.25 —
// grounds move slowly.

import type { BackgroundState, FxInstance } from '@shared/types'
import { GENERATORS } from './shaders/isf'

const BG_EXCLUDED = ['recurse', 'gen-text', 'filaments', 'congeal', 'swell', 'mycelium']
export const BG_SOURCES = GENERATORS.filter((g) => !BG_EXCLUDED.includes(g.id))

export const BG_DEFAULT_SPEED = 0.25

export interface BgPreset {
  id: string
  name: string
  shaderId: string
  inputs: Record<string, number | number[]>
  fx?: Array<{ shaderId: string; inputs: Record<string, number | number[]> }>
  opacity?: number // default 1
  speed?: number // default BG_DEFAULT_SPEED
}

const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

/** Materialize a preset into a live BackgroundState (fresh FX ids). */
export function bgPresetToState(p: BgPreset): BackgroundState {
  const fx: FxInstance[] = (p.fx ?? []).map((f) => ({
    id: uid(),
    shaderId: f.shaderId,
    enabled: true,
    inputs: { ...f.inputs }
  }))
  return {
    source: { kind: 'generator', shaderId: p.shaderId, inputs: { ...p.inputs } },
    fx,
    opacity: p.opacity ?? 1,
    speed: p.speed ?? BG_DEFAULT_SPEED
  }
}

export const BG_PRESETS: BgPreset[] = [
  // ── Solids & gradients ───────────────────────────────────────────────
  { id: 'bg-void', name: 'Void', shaderId: 'solid-color', inputs: { gradient: 0, color: [0.01, 0.01, 0.012, 1] } },
  { id: 'bg-slate', name: 'Slate', shaderId: 'solid-color', inputs: { gradient: 0, color: [0.09, 0.095, 0.11, 1] } },
  { id: 'bg-dusk', name: 'Dusk gradient', shaderId: 'solid-color', inputs: { gradient: 1, angle: 1.5708, midpoint: 0.45, dither: 0.6, colA: [0.02, 0.02, 0.05, 1], colB: [0.12, 0.08, 0.14, 1], colC: [0.45, 0.22, 0.15, 1] } },
  { id: 'bg-abyss', name: 'Abyss gradient', shaderId: 'solid-color', inputs: { gradient: 1, angle: 1.5708, midpoint: 0.6, dither: 0.6, colA: [0.0, 0.01, 0.03, 1], colB: [0.01, 0.05, 0.09, 1], colC: [0.05, 0.14, 0.18, 1] } },
  { id: 'bg-ramp-ember', name: 'Ember ramp', shaderId: 'ramps', inputs: { freq: 1, steps: 1, rate: 0.05, angle: 1.5708 }, fx: [{ shaderId: 'fx-palette', inputs: { stops: 3, blend: 1, dither: 0.4 } }] },

  // ── Organic elements ─────────────────────────────────────────────────
  { id: 'bg-hearth', name: 'Hearth', shaderId: 'organic', inputs: { mode: 0, rate: 0.4, scale: 2.2, detail: 0.55, flow: 0.5, vary: 0, contrast: 0.95 }, opacity: 0.85 },
  { id: 'bg-embers', name: 'Ember bed', shaderId: 'organic', inputs: { mode: 0, rate: 0.18, scale: 4.6, detail: 0.9, flow: 0.3, vary: 0.1, contrast: 1.6 }, fx: [{ shaderId: 'fx-grain', inputs: { amount: 0.12, size: 1.5 } }], opacity: 0.8 },
  { id: 'bg-gasglow', name: 'Gas glow', shaderId: 'organic', inputs: { mode: 0, rate: 0.5, scale: 2.6, detail: 0.5, flow: 0.45, vary: 0.9, contrast: 1.0 }, opacity: 0.7 },
  { id: 'bg-deepsea', name: 'Deep sea', shaderId: 'organic', inputs: { mode: 1, rate: 0.25, scale: 2.0, detail: 0.5, flow: 0.5, vary: 0, contrast: 0.9 } },
  { id: 'bg-caustics', name: 'Caustic floor', shaderId: 'organic', inputs: { mode: 1, rate: 0.5, scale: 3.4, detail: 0.85, flow: 0.65, vary: 0, contrast: 1.45 }, opacity: 0.85 },
  { id: 'bg-lagoon', name: 'Lagoon', shaderId: 'organic', inputs: { mode: 1, rate: 0.35, scale: 2.5, detail: 0.7, flow: 0.6, vary: 0.85, contrast: 1.05 } },
  { id: 'bg-canopy', name: 'Canopy', shaderId: 'organic', inputs: { mode: 2, rate: 0.3, scale: 2.4, detail: 0.6, flow: 0.5, vary: 0, contrast: 1.0 }, opacity: 0.9 },
  { id: 'bg-undergrowth', name: 'Undergrowth', shaderId: 'organic', inputs: { mode: 2, rate: 0.18, scale: 4.6, detail: 0.9, flow: 0.7, vary: 0.15, contrast: 1.3 }, fx: [{ shaderId: 'fx-grade', inputs: { brightness: -0.06, contrast: 1.05, saturation: 0.85 } }] },
  { id: 'bg-autumn', name: 'Autumn drift', shaderId: 'organic', inputs: { mode: 2, rate: 0.4, scale: 2.9, detail: 0.7, flow: 0.6, vary: 0.8, contrast: 1.1 }, opacity: 0.85 },

  // ── Fields, hazes & textures ─────────────────────────────────────────
  { id: 'bg-nightdrift', name: 'Night drift', shaderId: 'drift-field', inputs: { rate: 0.08, scale: 1.6, warp: 0.5, steps: 4, contrast: 1.0, split: 0.1 }, opacity: 0.8 },
  { id: 'bg-warmfog', name: 'Warm fog', shaderId: 'drift-field', inputs: { rate: 0.06, scale: 1.2, warp: 0.35, steps: 3, contrast: 0.9, split: 0 }, fx: [{ shaderId: 'fx-grade', inputs: { brightness: 0.04, saturation: 0.6 } }], opacity: 0.6 },
  { id: 'bg-concrete', name: 'Concrete', shaderId: 'drift-field', inputs: { rate: 0.04, scale: 3.5, warp: 0.25, steps: 6, contrast: 1.15, split: 0 }, fx: [{ shaderId: 'fx-grain', inputs: { amount: 0.15, size: 1.2, chroma: 0 } }], opacity: 0.7 },
  { id: 'bg-sediment', name: 'Sediment', shaderId: 'erosion', inputs: { rate: 0.15, scale: 2.5, streaks: 4, carve: 0.55, sediment: 0.4 }, opacity: 0.85 },
  { id: 'bg-breath', name: 'Breath', shaderId: 'membrane', inputs: { rate: 0.12, mass: 0.5, warp: 0.6, softness: 0.2, veins: 0.25 }, opacity: 0.8 },
  { id: 'bg-topo', name: 'Topography', shaderId: 'contour', inputs: { rate: 0.06, scale: 2, levels: 9, width: 0.12, warp: 0.5, fill: 0.35 }, opacity: 0.6 },

  // ── Particles & sparse motion ────────────────────────────────────────
  { id: 'bg-ashfall', name: 'Ashfall', shaderId: 'ash', inputs: { count: 18, speed: 0.15, physics: 0.5, size: 0.08, wander: 0.4, flicker: 0.25, accent: 0.1 }, opacity: 0.7 },
  { id: 'bg-dust', name: 'Dust motes', shaderId: 'particle-drift', inputs: { count: 12, speed: 0.2, flow: 1.6, size: 0.06, trail: 0.5, jitter: 0.3, vary: 0.6 }, opacity: 0.55 },
  { id: 'bg-distantflock', name: 'Distant flock', shaderId: 'murmuration', inputs: { count: 22, speed: 0.35, cohesion: 0.85, size: 0.045, stretch: 0.5 }, opacity: 0.5, fx: [{ shaderId: 'fx-grade', inputs: { brightness: -0.05, saturation: 0.5 } }] },

  // ── Faint structure ──────────────────────────────────────────────────
  { id: 'bg-gridghost', name: 'Grid ghost', shaderId: 'grid-drift', inputs: { cells: 9, rate: 0.08, breathe: 0.3, slip: 0.1, lineW: 0.03, density: 0.1 }, opacity: 0.35 },
  { id: 'bg-signalveil', name: 'Signal veil', shaderId: 'interference', inputs: { freq: 22, detune: 0.015, angle: 0.4, skew: 0.1, rate: 0.06, contrast: 1.0 }, opacity: 0.3, fx: [{ shaderId: 'fx-grade', inputs: { saturation: 0.4 } }] }
]
