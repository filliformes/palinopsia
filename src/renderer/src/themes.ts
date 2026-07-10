// Generate : 50 "visual themes", each a RECIPE the generator obeys so every
// result reads unmistakably as its theme (not free Randomize). A theme declares
// a tight source pool, an FX pool, a blend bias, a Vibe palette, a diegetic World
// (coupling + Context mood + audio routing), and field-macro / temperament biases.
// The builder (store.generateTheme) draws WITHIN these, so pressing Generate again
// re-rolls a fresh variation of the SAME aesthetic.
//
// Rooted in the app's inspirations : edge-of-chaos video feedback, synchresis as
// coupling, cameraless / direct film, analog video synthesis, datamosh / glitch,
// reaction-diffusion, and the afterimage. Every theme stays inside the house
// guardrails : matte / near-black, one accent, never kaleidoscope / plasma /
// psychedelia (even the "trippy"-sounding names are read in the matte register).

import type { BlendMode } from '@shared/types'

/** RGBA in 0..1. Palettes run darkest → lightest (colorA is the near-black base). */
type Rgba = [number, number, number, number]

export interface Theme {
  id: string
  name: string
  family: string
  blurb: string
  /** A built-in World id : sets coupling, Context mood, audio routing. */
  world: string
  /** 2–5 Vibe palette stops (dark → light) : the strongest theme signal. */
  palette: Rgba[]
  /** Extra Vibe input overrides (splitTone / saturation / contrast / tints…). */
  vibe?: Record<string, number | number[]>
  /** Generator ids the theme draws sources from. */
  sources: string[]
  /** Background source pool (defaults to `sources` filtered to legal bg sources). */
  bgSources?: string[]
  /** FX ids for the per-layer FX racks. */
  layerFx: string[]
  /** Native node ids occasionally added to a layer (node-feedback / node-reponse…). */
  nativeNodes?: string[]
  /** Per-layer probability the signature native node is added (default 0.4). */
  nativeChance?: number
  /** Preferred layer blend modes (the bottom layer is always `normal`). */
  blends: BlendMode[]
  /** Active layer count range [min, max]. */
  layers: [number, number]
  /** Chance a layer gets a B source (0..1). */
  useB: number
  /** Chance a layer runs its own feedback (0..1). */
  feedback: number
  // Field macros (0.5 neutral) + temperament (0 off) targets.
  density: number
  gestureTexture: number
  coalesce: number
  tonicity: number
  shutter: number
  drift: number
  superFlicker: number
  /** Context finalizer overrides applied AFTER the World (theme wins). */
  context?: Record<string, number | number[]>
  /** Finalizer overrides (grain character / grade leanings). */
  finalizer?: Record<string, number | number[]>
}

// ── Palette atoms (matte, near-black grounds + disciplined accents) ─────
const K: Rgba = [0.02, 0.02, 0.025, 1] // the near-black base almost every theme opens on
const INK: Rgba = [0.015, 0.015, 0.02, 1]
const PAPER: Rgba = [0.9, 0.88, 0.83, 1]
const WHITE: Rgba = [0.95, 0.95, 0.95, 1]

// Defaults merged into every theme so each entry only states what it bends.
type ThemeIn = Partial<Theme> &
  Pick<Theme, 'id' | 'name' | 'family' | 'blurb' | 'world' | 'palette' | 'sources' | 'layerFx'>
const DEF = {
  blends: ['screen', 'add', 'lighten'] as BlendMode[],
  layers: [2, 3] as [number, number],
  useB: 0.25,
  feedback: 0.2,
  density: 0.5,
  gestureTexture: 0.5,
  coalesce: 0.5,
  tonicity: 0,
  shutter: 0,
  drift: 0,
  superFlicker: 0
}
const mk = (t: ThemeIn): Theme => ({ ...DEF, ...t })

export const THEMES: Theme[] = [
  // ── Analog Video Synthesis ────────────────────────────────────────────
  mk({
    id: 'cathode-ray', name: 'Cathode Ray', family: 'Analog Video Synthesis',
    blurb: 'Phosphor tube : RGB oscillators run through a scan processor and a CRT surface.',
    world: 'synthetic',
    palette: [K, [0.05, 0.35, 0.12, 1], [0.6, 1.0, 0.5, 1]],
    sources: ['rgb-osc', 'sync-osc', 'ramps'],
    layerFx: ['fx-rutt', 'fx-crt-screen', 'fx-scanlines', 'fx-colorizer'],
    blends: ['add', 'screen'], layers: [2, 3], drift: 0.2, coalesce: 0.4,
    finalizer: { grain: 0.12, character: 2 }
  }),
  mk({
    id: 'scan-processor', name: 'Scan Processor', family: 'Analog Video Synthesis',
    blurb: 'Voltage ramps coloured by a CV colorizer and pushed into relief.',
    world: 'parametric',
    palette: [K, [0.4, 0.1, 0.5, 1], [1.0, 0.5, 0.1, 1], [0.9, 0.95, 0.4, 1]],
    sources: ['ramps', 'sync-osc', 'differential'],
    layerFx: ['fx-colorizer', 'fx-rutt', 'fx-posterize', 'fx-wavefold'],
    blends: ['screen', 'add'], gestureTexture: 0.35, coalesce: 0.4
  }),
  mk({
    id: 'wobbulator', name: 'Wobbulator', family: 'Analog Video Synthesis',
    blurb: 'One oscillator folded back through a wandering feedback loop.',
    world: 'musical',
    palette: [K, [0.1, 0.2, 0.45, 1], [0.7, 0.85, 1.0, 1]],
    sources: ['sync-osc', 'rgb-osc'],
    layerFx: ['fx-rgb-shift', 'fx-distort', 'fx-colorizer'],
    nativeNodes: ['node-feedback'], blends: ['add', 'screen'], feedback: 0.6, drift: 0.35
  }),
  mk({
    id: 'phosphor-burn', name: 'Phosphor Burn', family: 'Analog Video Synthesis',
    blurb: 'Amber afterglow burnt into the tube : oscillators + phosphene + trails.',
    world: 'sublimated',
    palette: [K, [0.35, 0.18, 0.02, 1], [1.0, 0.7, 0.2, 1]],
    sources: ['rgb-osc', 'organic', 'sync-osc'],
    layerFx: ['fx-phosphene', 'fx-light-trails', 'fx-scanlines'],
    blends: ['screen', 'lighten'], feedback: 0.4, density: 0.4, drift: 0.25
  }),
  mk({
    id: 'raw-feedback', name: 'Raw Feedback', family: 'Analog Video Synthesis',
    blurb: 'A camera pointed at its own monitor : the feedback engine at the edge of chaos.',
    world: 'synthetic',
    palette: [K, [0.06, 0.14, 0.16, 1], [0.55, 0.75, 0.72, 1]],
    sources: ['organic', 'solid-color', 'dye-field'],
    layerFx: ['fx-grade'],
    nativeNodes: ['node-feedback'], blends: ['screen', 'add'], feedback: 0.7,
    layers: [1, 2], drift: 0.4, coalesce: 0.55
  }),

  // ── Glitch / Datamosh ─────────────────────────────────────────────────
  mk({
    id: 'datamosh', name: 'Datamosh', family: 'Glitch / Datamosh',
    blurb: 'Macroblocks smear and bit-crush : the classic p-frame bloom, matte.',
    world: 'parametric',
    palette: [K, [0.2, 0.05, 0.28, 1], [0.85, 0.3, 0.45, 1], [0.9, 0.9, 0.85, 1]],
    sources: ['slabs', 'drift-field', 'grid-drift'],
    layerFx: ['fx-mosh-blocks', 'fx-byte-corrupt', 'fx-slice-shuffle', 'fx-pixelate'],
    blends: ['difference', 'screen'], gestureTexture: 0.65, coalesce: 0.3, density: 0.6
  }),
  mk({
    id: 'signal-loss', name: 'Signal Loss', family: 'Glitch / Datamosh',
    blurb: 'The picture climbs, catches and tears : sync roll + tracking + line holds.',
    world: 'incongruent',
    palette: [K, [0.12, 0.14, 0.16, 1], [0.75, 0.78, 0.72, 1]],
    sources: ['column-scan', 'slabs', 'contour'],
    layerFx: ['fx-sync-loss', 'fx-tracking', 'fx-row-echo', 'fx-scanlines'],
    blends: ['screen', 'lighten'], coalesce: 0.35, drift: 0.3
  }),
  mk({
    id: 'compression-ghost', name: 'Compression Ghost', family: 'Glitch / Datamosh',
    blurb: 'Structure haunted by its own edges : DCT ringing, byte crush, blocks.',
    world: 'parametric',
    palette: [K, [0.14, 0.16, 0.2, 1], [0.7, 0.72, 0.78, 1]],
    sources: ['contour', 'interference', 'grid-drift'],
    layerFx: ['fx-ringing', 'fx-byte-corrupt', 'fx-pixelate', 'fx-posterize'],
    blends: ['screen', 'difference'], gestureTexture: 0.6
  }),
  mk({
    id: 'kernel-panic', name: 'Kernel Panic', family: 'Glitch / Datamosh',
    blurb: 'Hard, high-contrast data damage : corruption + mosh + stutter.',
    world: 'incongruent',
    palette: [INK, [0.9, 0.1, 0.1, 1], [0.95, 0.95, 0.95, 1]],
    sources: ['shapes', 'slabs', 'op-art'],
    layerFx: ['fx-byte-corrupt', 'fx-mosh-blocks', 'fx-stutter', 'fx-threshold'],
    blends: ['difference', 'exclusion'], gestureTexture: 0.7, coalesce: 0.25,
    shutter: 0.35, density: 0.5
  }),
  mk({
    id: 'dropout', name: 'Dropout', family: 'Glitch / Datamosh',
    blurb: 'A worn tape dub : generation-loss chroma bleed, jitter and dropout lines.',
    world: 'presse',
    palette: [K, [0.28, 0.2, 0.12, 1], [0.82, 0.72, 0.55, 1]],
    sources: ['organic', 'drift-field', 'swell'],
    layerFx: ['fx-decay', 'fx-tracking', 'fx-grain'],
    blends: ['screen', 'lighten'], coalesce: 0.45, drift: 0.3
  }),

  // ── Cameraless / Direct Film ──────────────────────────────────────────
  mk({
    id: 'hand-painted', name: 'Hand-Painted', family: 'Cameraless / Direct Film',
    blurb: 'Dye painted straight onto the emulsion : subtractive pigment, boiling.',
    world: 'peint',
    palette: [K, [0.5, 0.1, 0.35, 1], [0.1, 0.4, 0.55, 1], [0.9, 0.85, 0.5, 1]],
    sources: ['dye-field', 'organic', 'membrane'],
    layerFx: ['fx-grain', 'fx-hue-rotate', 'fx-wide-time'],
    blends: ['multiply', 'screen', 'darken'], density: 0.6, gestureTexture: 0.6, drift: 0.25,
    finalizer: { grain: 0.18, character: 1 }
  }),
  mk({
    id: 'scratch-film', name: 'Scratch Film', family: 'Cameraless / Direct Film',
    blurb: 'Ink and scratches on black leader : hard-edged marks on the beat.',
    world: 'griffe',
    palette: [INK, [0.9, 0.9, 0.86, 1]],
    sources: ['direct-marks', 'shapes'],
    layerFx: ['fx-grain', 'fx-decay', 'fx-streak'],
    blends: ['screen', 'lighten'], useB: 0.15, coalesce: 0.3, superFlicker: 0.3
  }),
  mk({
    id: 'emulsion', name: 'Emulsion', family: 'Cameraless / Direct Film',
    blurb: 'Warm film stock : clumped photochemical grain over drifting dye.',
    world: 'peint',
    palette: [K, [0.3, 0.14, 0.06, 1], [0.9, 0.78, 0.55, 1]],
    sources: ['dye-field', 'organic', 'swell'],
    layerFx: ['fx-grain', 'fx-light-trails', 'fx-grade'],
    blends: ['screen', 'lighten'], feedback: 0.3, drift: 0.3,
    finalizer: { grain: 0.2, grainSize: 2, character: 0 }
  }),
  mk({
    id: 'frame-by-frame', name: 'Frame by Frame', family: 'Cameraless / Direct Film',
    blurb: 'Stop-motion animation : marks that jump on a drawn cadence.',
    world: 'griffe',
    palette: [INK, [0.85, 0.2, 0.15, 1], [0.92, 0.9, 0.82, 1]],
    sources: ['direct-marks', 'shapes', 'op-art'],
    layerFx: ['fx-grain', 'fx-stutter'],
    blends: ['screen', 'difference'], shutter: 0.45, superFlicker: 0.4, coalesce: 0.3
  }),
  mk({
    id: 'boiling-line', name: 'Boiling Line', family: 'Cameraless / Direct Film',
    blurb: 'A trembling hand-drawn line : marks that boil and smear over time.',
    world: 'peint',
    palette: [K, [0.1, 0.35, 0.4, 1], [0.85, 0.88, 0.8, 1]],
    sources: ['direct-marks', 'filaments', 'contour'],
    layerFx: ['fx-wide-time', 'fx-displace', 'fx-grain'],
    blends: ['screen', 'lighten'], drift: 0.4, gestureTexture: 0.6
  }),

  // ── Optical / Op-Art ──────────────────────────────────────────────────
  mk({
    id: 'moire', name: 'Moiré', family: 'Optical / Op-Art',
    blurb: 'Two line fields beating : black-and-white vibration, matte not op-art soup.',
    world: 'parametric',
    palette: [INK, WHITE],
    sources: ['interference', 'op-art', 'differential'],
    layerFx: ['fx-sharpen', 'fx-posterize'],
    blends: ['difference', 'screen'], useB: 0.4, gestureTexture: 0.55, coalesce: 0.35
  }),
  mk({
    id: 'op-field', name: 'Op Field', family: 'Optical / Op-Art',
    blurb: 'Hard monochrome geometry with illusory motion.',
    world: 'parametric',
    palette: [INK, [0.95, 0.93, 0.88, 1]],
    sources: ['op-art', 'grid-drift', 'shapes'],
    layerFx: ['fx-fold', 'fx-sharpen', 'fx-edge'],
    blends: ['difference', 'screen'], useB: 0.3, gestureTexture: 0.5
  }),
  mk({
    id: 'anaglyph', name: 'Anaglyph', family: 'Optical / Op-Art',
    blurb: 'Red/cyan depth : optical rain shattered off a stereoscopic membrane.',
    world: 'incongruent',
    palette: [K, [0.8, 0.1, 0.15, 1], [0.1, 0.7, 0.75, 1]],
    sources: ['op-art', 'interference', 'differential'],
    layerFx: ['fx-optical-rain', 'fx-rgb-shift', 'fx-edge'],
    blends: ['screen', 'add'], gestureTexture: 0.55, drift: 0.2
  }),
  mk({
    id: 'standing-wave', name: 'Standing Wave', family: 'Optical / Op-Art',
    blurb: 'Nested rhythms beating in and out of phase : pulsing topographic bands.',
    world: 'musical',
    palette: [K, [0.1, 0.25, 0.4, 1], [0.7, 0.85, 0.95, 1]],
    sources: ['differential', 'contour', 'interference'],
    layerFx: ['fx-posterize', 'fx-sharpen', 'fx-hue-rotate'],
    blends: ['screen', 'add'], gestureTexture: 0.45
  }),
  mk({
    id: 'herringbone', name: 'Herringbone', family: 'Optical / Op-Art',
    blurb: 'Tight woven greys haunted by ringing echoes.',
    world: 'parametric',
    palette: [INK, [0.2, 0.2, 0.22, 1], [0.8, 0.8, 0.78, 1]],
    sources: ['op-art', 'interference'],
    layerFx: ['fx-ringing', 'fx-sharpen', 'fx-posterize'],
    blends: ['difference', 'overlay'], useB: 0.35
  }),

  // ── Organic / Reaction-Diffusion ──────────────────────────────────────
  mk({
    id: 'critters', name: 'Critters', family: 'Organic / Reaction-Diffusion',
    blurb: 'Gray-Scott spots split and crawl : matte biological texture.',
    world: 'sublimated',
    palette: [K, [0.06, 0.2, 0.18, 1], [0.7, 0.85, 0.7, 1]],
    sources: ['reaction', 'membrane', 'mycelium'],
    layerFx: ['fx-sharpen', 'fx-hue-rotate', 'fx-grade'],
    blends: ['screen', 'lighten'], density: 0.6, coalesce: 0.6, drift: 0.2
  }),
  mk({
    id: 'mycelial', name: 'Mycelial', family: 'Organic / Reaction-Diffusion',
    blurb: 'A hair-thin branching network growing and dissolving.',
    world: 'musical',
    palette: [K, [0.24, 0.16, 0.08, 1], [0.85, 0.8, 0.62, 1]],
    sources: ['mycelium', 'filaments', 'erosion'],
    layerFx: ['fx-sharpen', 'fx-edge', 'fx-grain'],
    blends: ['screen', 'lighten'], density: 0.55, drift: 0.25
  }),
  mk({
    id: 'murmuration', name: 'Murmuration', family: 'Organic / Reaction-Diffusion',
    blurb: 'A flock of dots steered by one turning wind : density waves over black.',
    world: 'musical',
    palette: [K, [0.1, 0.12, 0.2, 1], [0.75, 0.78, 0.85, 1]],
    sources: ['murmuration', 'particle-drift', 'ash'],
    layerFx: ['fx-light-trails', 'fx-streak'],
    blends: ['screen', 'add'], density: 0.55, feedback: 0.3, drift: 0.25
  }),
  mk({
    id: 'tide', name: 'Tide', family: 'Organic / Reaction-Diffusion',
    blurb: 'Cold open water : wave trains beating, dye pooling, smeared over time.',
    world: 'sublimated',
    palette: [K, [0.05, 0.16, 0.24, 1], [0.6, 0.78, 0.82, 1]],
    sources: ['swell', 'dye-field', 'membrane'],
    layerFx: ['fx-wide-time', 'fx-grade', 'fx-hue-rotate'],
    blends: ['screen', 'lighten'], feedback: 0.4, drift: 0.35, density: 0.45
  }),
  mk({
    id: 'ember', name: 'Ember', family: 'Organic / Reaction-Diffusion',
    blurb: 'Turbulent flames licking upward through an ember→orange ramp.',
    world: 'sublimated',
    palette: [K, [0.4, 0.08, 0.02, 1], [1.0, 0.55, 0.12, 1], [1.0, 0.9, 0.5, 1]],
    sources: ['organic', 'erosion', 'dye-field'],
    layerFx: ['fx-light-trails', 'fx-grain', 'fx-grade'],
    blends: ['screen', 'lighten'], feedback: 0.45, density: 0.4, drift: 0.3
  }),

  // ── Data / Parametric ─────────────────────────────────────────────────
  mk({
    id: 'datastream', name: 'Datastream', family: 'Data / Parametric',
    blurb: 'The audio buffer read as a hard monochrome raster, crushed and pixelated.',
    world: 'parametric',
    palette: [INK, [0.7, 0.75, 0.8, 1]],
    sources: ['gen-parametric', 'slabs', 'column-scan'],
    bgSources: ['slabs', 'grid-drift', 'ramps'],
    layerFx: ['fx-pixelate', 'fx-posterize', 'fx-dither'],
    blends: ['screen', 'add'], gestureTexture: 0.4, coalesce: 0.3, tonicity: 0.4
  }),
  mk({
    id: 'spectrogram', name: 'Spectrogram', family: 'Data / Parametric',
    blurb: 'A scrolling spectral read under a scanline grille.',
    world: 'parametric',
    palette: [K, [0.15, 0.05, 0.35, 1], [0.9, 0.3, 0.4, 1], [0.95, 0.9, 0.5, 1]],
    sources: ['gen-parametric', 'slit-scan', 'column-scan'],
    bgSources: ['ramps', 'grid-drift'],
    layerFx: ['fx-scanlines', 'fx-colorizer', 'fx-posterize'],
    blends: ['screen', 'add'], tonicity: 0.5, coalesce: 0.4
  }),
  mk({
    id: 'test-pattern', name: 'Test Pattern', family: 'Data / Parametric',
    blurb: 'Calibration bars and shapes, dithered : the broadcast test card.',
    world: 'parametric',
    palette: [K, [0.85, 0.2, 0.2, 1], [0.2, 0.7, 0.8, 1], [0.92, 0.9, 0.85, 1]],
    sources: ['ramps', 'shapes', 'slabs'],
    layerFx: ['fx-dither', 'fx-posterize', 'fx-scanlines'],
    blends: ['normal', 'screen'], useB: 0.2, coalesce: 0.35, gestureTexture: 0.4
  }),
  mk({
    id: 'barcode', name: 'Barcode', family: 'Data / Parametric',
    blurb: 'Stark black-and-white bands, quantised and scanned.',
    world: 'parametric',
    palette: [INK, WHITE],
    sources: ['slabs', 'column-scan', 'grid-drift'],
    layerFx: ['fx-posterize', 'fx-threshold', 'fx-pixelate'],
    blends: ['screen', 'difference'], coalesce: 0.3, gestureTexture: 0.45, density: 0.6
  }),
  mk({
    id: 'raster-field', name: 'Raster Field', family: 'Data / Parametric',
    blurb: 'A cool data grid drifting under a raster read.',
    world: 'parametric',
    palette: [K, [0.06, 0.16, 0.22, 1], [0.55, 0.8, 0.85, 1]],
    sources: ['gen-parametric', 'grid-drift', 'drift-field'],
    bgSources: ['grid-drift', 'drift-field'],
    layerFx: ['fx-pixelate', 'fx-dither', 'fx-posterize'],
    blends: ['screen', 'add'], coalesce: 0.35, tonicity: 0.3
  }),

  // ── Feedback / Afterimage ─────────────────────────────────────────────
  mk({
    id: 'palinopsia', name: 'Palinopsia', family: 'Feedback / Afterimage',
    blurb: 'The namesake : a bright stimulus burns a complementary ghost that lingers.',
    world: 'sublimated',
    palette: [K, [0.18, 0.05, 0.28, 1], [0.5, 0.85, 0.75, 1]],
    sources: ['organic', 'shapes', 'dye-field'],
    layerFx: ['fx-phosphene', 'fx-wide-time', 'fx-feedback-zoom'],
    nativeNodes: ['node-feedback'], blends: ['screen', 'lighten'], feedback: 0.5, drift: 0.35, density: 0.4
  }),
  mk({
    id: 'tunnel', name: 'Tunnel', family: 'Feedback / Afterimage',
    blurb: 'A feedback tunnel that wanders off-centre : never a fixed mandala.',
    world: 'musical',
    palette: [K, [0.1, 0.14, 0.3, 1], [0.7, 0.8, 1.0, 1]],
    sources: ['shapes', 'op-art', 'organic'],
    layerFx: ['fx-feedback-zoom', 'fx-hue-rotate'],
    nativeNodes: ['node-feedback'], blends: ['screen', 'add'], feedback: 0.6, drift: 0.5, layers: [1, 2]
  }),
  mk({
    id: 'echo-chamber', name: 'Echo Chamber', family: 'Feedback / Afterimage',
    blurb: 'Trails that pulse with a captured rhythm : temporal convolution echoes.',
    world: 'sublimated',
    palette: [K, [0.12, 0.18, 0.22, 1], [0.7, 0.82, 0.8, 1]],
    sources: ['particle-drift', 'murmuration', 'organic'],
    layerFx: ['fx-wide-time', 'fx-light-trails'],
    nativeNodes: ['node-reponse'], blends: ['screen', 'add'], feedback: 0.4, drift: 0.3
  }),
  mk({
    id: 'persistence', name: 'Persistence', family: 'Feedback / Afterimage',
    blurb: 'Long-exposure light painting : the brightest pixels smear and decay.',
    world: 'sublimated',
    palette: [K, [0.3, 0.16, 0.04, 1], [1.0, 0.85, 0.5, 1]],
    sources: ['particle-drift', 'ash', 'filaments'],
    layerFx: ['fx-light-trails', 'fx-decay', 'fx-phosphene'],
    blends: ['screen', 'lighten'], feedback: 0.5, drift: 0.3, density: 0.4
  }),
  mk({
    id: 'recursion', name: 'Recursion', family: 'Feedback / Afterimage',
    blurb: 'A shape cascading inward through an off-centre zoom : a spiral, not a kaleidoscope.',
    world: 'musical',
    palette: [K, [0.16, 0.06, 0.2, 1], [0.8, 0.75, 0.9, 1]],
    sources: ['recurse', 'shapes', 'op-art'],
    layerFx: ['fx-feedback-zoom', 'fx-hue-rotate', 'fx-sharpen'],
    blends: ['screen', 'add'], feedback: 0.4, drift: 0.35
  }),

  // ── Cinematic / Atmospheric ───────────────────────────────────────────
  mk({
    id: 'noir', name: 'Noir', family: 'Cinematic / Atmospheric',
    blurb: 'Deep-black high-contrast monochrome with heavy grain.',
    world: 'monomedia',
    palette: [INK, [0.5, 0.5, 0.52, 1], [0.95, 0.95, 0.95, 1]],
    sources: ['organic', 'membrane', 'solid-color'],
    layerFx: ['fx-grade', 'fx-grain', 'fx-threshold'],
    blends: ['screen', 'multiply'], coalesce: 0.55, density: 0.35,
    vibe: { saturation: 0.15, contrast: 1.3 }, finalizer: { grain: 0.2, black: 0.03 }
  }),
  mk({
    id: 'aerial', name: 'Aerial', family: 'Cinematic / Atmospheric',
    blurb: 'Misty distance : drifting bands seated in atmospheric haze and depth.',
    world: 'sublimated',
    palette: [K, [0.14, 0.2, 0.26, 1], [0.72, 0.8, 0.86, 1]],
    sources: ['drift-field', 'contour', 'swell'],
    layerFx: ['fx-grade', 'fx-hue-rotate'],
    blends: ['screen', 'lighten'], density: 0.35, drift: 0.3,
    context: { haze: 0.24, depth: 0.42, blur: 0.14, bloom: 0.2 }
  }),
  mk({
    id: 'bloom', name: 'Bloom', family: 'Cinematic / Atmospheric',
    blurb: 'Soft glowing highlights over a slow organic ground.',
    world: 'sublimated',
    palette: [K, [0.3, 0.1, 0.28, 1], [1.0, 0.8, 0.7, 1]],
    sources: ['organic', 'dye-field', 'membrane'],
    layerFx: ['fx-grade', 'fx-light-trails'],
    blends: ['screen', 'lighten'], feedback: 0.3, density: 0.35,
    context: { bloom: 0.32, lightGlow: 0.18, depth: 0.3, trails: 0.2 }
  }),
  mk({
    id: 'fog', name: 'Fog', family: 'Cinematic / Atmospheric',
    blurb: 'A soft grey volume : one breathing mass under haze and blur.',
    world: 'sublimated',
    palette: [K, [0.16, 0.18, 0.2, 1], [0.66, 0.68, 0.7, 1]],
    sources: ['membrane', 'swell', 'drift-field'],
    layerFx: ['fx-grade', 'fx-streak'],
    blends: ['screen', 'lighten'], density: 0.3, drift: 0.35,
    context: { haze: 0.26, blur: 0.2, depth: 0.4 }
  }),
  mk({
    id: 'nocturne', name: 'Nocturne', family: 'Cinematic / Atmospheric',
    blurb: 'Near-black blue : dye pooling deep in space.',
    world: 'sublimated',
    palette: [INK, [0.04, 0.08, 0.2, 1], [0.4, 0.55, 0.85, 1]],
    sources: ['dye-field', 'membrane', 'organic'],
    layerFx: ['fx-grade', 'fx-wide-time'],
    blends: ['screen', 'lighten'], feedback: 0.3, density: 0.3,
    context: { depth: 0.45, trails: 0.24, bloom: 0.14 }
  }),

  // ── Retro Screen ──────────────────────────────────────────────────────
  mk({
    id: 'arcade', name: 'Arcade', family: 'Retro Screen',
    blurb: 'Chunky primaries through a shadow mask : the cabinet CRT.',
    world: 'parametric',
    palette: [INK, [0.9, 0.15, 0.2, 1], [0.15, 0.6, 0.9, 1], [0.95, 0.9, 0.3, 1]],
    sources: ['shapes', 'grid-drift', 'op-art'],
    layerFx: ['fx-pixelate', 'fx-posterize', 'fx-pixelmask', 'fx-crt-screen'],
    blends: ['screen', 'add'], useB: 0.2, coalesce: 0.3, gestureTexture: 0.4
  }),
  mk({
    id: 'broadcast', name: 'Broadcast', family: 'Retro Screen',
    blurb: 'A tuned-in TV signal : tracking wobble, tear bands, scanlines over a soft image.',
    world: 'incongruent',
    palette: [K, [0.16, 0.16, 0.18, 1], [0.78, 0.78, 0.74, 1]],
    // Softer, image-like sources : VHS treatment flatters photographic content,
    // not hard geometry (the old slabs/drift read as ugly under tracking noise).
    sources: ['organic', 'swell', 'dye-field', 'membrane'],
    layerFx: ['fx-tracking', 'fx-sync-loss', 'fx-scanlines', 'fx-chroma-shift'],
    blends: ['screen', 'lighten'], coalesce: 0.45, drift: 0.3, feedback: 0.25
  }),
  mk({
    id: 'terminal', name: 'Terminal', family: 'Retro Screen',
    blurb: 'A phosphor-green console : raster text-glow under scanlines.',
    world: 'parametric',
    palette: [INK, [0.05, 0.3, 0.1, 1], [0.4, 1.0, 0.5, 1]],
    sources: ['gen-parametric', 'column-scan', 'ramps'],
    bgSources: ['grid-drift', 'ramps'],
    layerFx: ['fx-scanlines', 'fx-crt-screen', 'fx-posterize'],
    blends: ['screen', 'add'], tonicity: 0.4, coalesce: 0.35, gestureTexture: 0.4
  }),
  mk({
    id: 'teletext', name: 'Teletext', family: 'Retro Screen',
    blurb: 'Blocky primaries on black : the limited-palette information screen.',
    world: 'parametric',
    palette: [INK, [0.9, 0.2, 0.2, 1], [0.2, 0.8, 0.4, 1], [0.95, 0.9, 0.3, 1]],
    sources: ['shapes', 'slabs', 'grid-drift'],
    layerFx: ['fx-posterize', 'fx-palette', 'fx-pixelate'],
    blends: ['normal', 'screen'], useB: 0.15, coalesce: 0.3
  }),
  mk({
    id: 'dead-channel', name: 'Dead Channel', family: 'Retro Screen',
    blurb: 'Static snow with a ghost of a signal : analog noise and tracking.',
    world: 'presse',
    palette: [INK, [0.3, 0.3, 0.32, 1], [0.85, 0.85, 0.85, 1]],
    sources: ['drift-field', 'organic', 'ash'],
    layerFx: ['fx-grain', 'fx-tracking', 'fx-scanlines'],
    blends: ['screen', 'lighten'], coalesce: 0.4, drift: 0.35,
    finalizer: { grain: 0.24, character: 3, parasites: 0.25 }
  }),

  // ── Minimal / Structural ──────────────────────────────────────────────
  mk({
    id: 'constructivist', name: 'Constructivist', family: 'Minimal / Structural',
    blurb: 'Bold geometric abstraction : diagonal bars and shapes in red, blue, black and cream.',
    world: 'monomedia',
    palette: [INK, [0.82, 0.12, 0.09, 1], [0.13, 0.28, 0.52, 1], [0.93, 0.9, 0.83, 1]],
    sources: ['shapes', 'slabs', 'differential'],
    layerFx: ['fx-transform', 'fx-posterize', 'fx-sharpen'],
    blends: ['normal', 'multiply', 'screen'], useB: 0.3, layers: [2, 3],
    density: 0.4, coalesce: 0.35, gestureTexture: 0.4, drift: 0.12,
    vibe: { saturation: 1.2, contrast: 1.15, mixSrc: 0.15 }
  }),
  mk({
    id: 'grid', name: 'Grid', family: 'Minimal / Structural',
    blurb: 'Architectural greys : a breathing grid, quantised.',
    world: 'parametric',
    palette: [K, [0.2, 0.22, 0.24, 1], [0.78, 0.8, 0.82, 1]],
    sources: ['grid-drift', 'column-scan', 'contour'],
    layerFx: ['fx-pixelate', 'fx-posterize', 'fx-sharpen'],
    blends: ['screen', 'normal'], density: 0.4, coalesce: 0.4
  }),
  mk({
    id: 'contour-map', name: 'Contour Map', family: 'Minimal / Structural',
    blurb: 'Topographic line-work : marching contours and beating rhythms.',
    world: 'musical',
    palette: [K, [0.12, 0.2, 0.18, 1], [0.7, 0.82, 0.72, 1]],
    sources: ['contour', 'differential', 'erosion'],
    layerFx: ['fx-sharpen', 'fx-edge', 'fx-posterize'],
    blends: ['screen', 'add'], density: 0.4, drift: 0.2
  }),
  mk({
    id: 'monolith', name: 'Monolith', family: 'Minimal / Structural',
    blurb: 'A single form standing in graded space : one lit silhouette against the dark.',
    // Textured sources (never a flat solid) so the form always reads : a lit mass
    // clipped into a silhouette, seated by the depth vignette.
    world: 'monomedia',
    palette: [INK, [0.16, 0.16, 0.19, 1], [0.72, 0.72, 0.78, 1]],
    sources: ['membrane', 'organic', 'shapes'],
    layerFx: ['fx-transform', 'fx-grade'],
    blends: ['normal', 'lighten'], useB: 0.15, layers: [1, 2], density: 0.35,
    context: { depth: 0.45, bloom: 0.14 }
  }),
  mk({
    id: 'silence', name: 'Silence', family: 'Minimal / Structural',
    blurb: 'Near-empty and meditative : a faint field breathing in the dark.',
    world: 'monomedia',
    palette: [INK, [0.08, 0.09, 0.11, 1], [0.4, 0.42, 0.46, 1]],
    sources: ['solid-color', 'drift-field', 'membrane'],
    layerFx: ['fx-grain', 'fx-grade'],
    blends: ['screen', 'lighten'], useB: 0.1, layers: [1, 2], density: 0.25, drift: 0.2,
    context: { depth: 0.4, haze: 0.14, trails: 0.16 }
  }),

  // ── Datamosh & Compression (from the glitch research) ─────────────────
  mk({
    id: 'melt', name: 'Melt', family: 'Datamosh & Compression',
    blurb: 'The datamosh bloom : new motion drags the old texture, figures melt into a soup of colour.',
    world: 'sublimated',
    palette: [K, [0.4, 0.08, 0.35, 1], [0.1, 0.5, 0.55, 1], [0.95, 0.8, 0.5, 1]],
    sources: ['organic', 'dye-field', 'swell', 'membrane'],
    layerFx: ['fx-grade', 'fx-chroma-shift'],
    nativeNodes: ['node-datamosh'], nativeChance: 0.9,
    blends: ['screen', 'lighten'], layers: [1, 2], feedback: 0.2, drift: 0.3, density: 0.4
  }),
  mk({
    id: 'monster-movie', name: 'Monster Movie', family: 'Datamosh & Compression',
    blurb: 'Monsters emerging from and dissolving into pixellated colour : the moshed swirl.',
    world: 'musical',
    palette: [K, [0.5, 0.12, 0.1, 1], [0.1, 0.3, 0.6, 1], [0.9, 0.85, 0.4, 1]],
    sources: ['organic', 'shapes', 'murmuration', 'dye-field'],
    layerFx: ['fx-hue-rotate', 'fx-grade'],
    nativeNodes: ['node-datamosh'], nativeChance: 0.7,
    blends: ['screen', 'difference'], layers: [2, 2], feedback: 0.3, drift: 0.3, gestureTexture: 0.6
  }),
  mk({
    id: 'pure-motion', name: 'Pure Motion', family: 'Datamosh & Compression',
    blurb: 'Movement divorced from what-is-moving : flows, streaks and cascades with no fixed image.',
    world: 'incongruent',
    palette: [INK, [0.15, 0.16, 0.2, 1], [0.7, 0.75, 0.82, 1]],
    sources: ['murmuration', 'particle-drift', 'filaments', 'swell'],
    layerFx: ['fx-streak', 'fx-grade'],
    nativeNodes: ['node-datamosh'], nativeChance: 0.9,
    blends: ['screen', 'lighten'], layers: [1, 2], feedback: 0.3, drift: 0.35, density: 0.4
  }),
  mk({
    id: 'macroblock', name: 'Macroblock', family: 'Datamosh & Compression',
    blurb: 'The quantisation aesthetic : the image crushed into blocks of averaged colour, banded and ringing.',
    world: 'parametric',
    palette: [K, [0.2, 0.06, 0.28, 1], [0.85, 0.35, 0.4, 1], [0.9, 0.9, 0.82, 1]],
    sources: ['drift-field', 'slabs', 'shapes', 'organic'],
    layerFx: ['fx-compress', 'fx-pixelate', 'fx-posterize'],
    blends: ['screen', 'difference'], gestureTexture: 0.55, coalesce: 0.3, density: 0.55
  }),
  mk({
    id: 'transcode', name: 'Transcode', family: 'Datamosh & Compression',
    blurb: 'Recompressed to death : block crush over byte-bent bands, colour out of registration.',
    world: 'parametric',
    palette: [K, [0.14, 0.15, 0.2, 1], [0.8, 0.4, 0.35, 1], [0.85, 0.85, 0.78, 1]],
    sources: ['organic', 'drift-field', 'swell'],
    layerFx: ['fx-compress', 'fx-databend', 'fx-chroma-shift'],
    blends: ['screen', 'lighten'], coalesce: 0.35, drift: 0.25
  }),
  mk({
    id: 'databent', name: 'Databent', family: 'Datamosh & Compression',
    blurb: 'Editing the stream, not the picture : bands tear and hold, channels drift, the signal breaks.',
    world: 'incongruent',
    palette: [K, [0.16, 0.16, 0.18, 1], [0.78, 0.78, 0.72, 1]],
    sources: ['slabs', 'column-scan', 'organic', 'drift-field'],
    layerFx: ['fx-databend', 'fx-sync-loss', 'fx-row-echo'],
    blends: ['screen', 'lighten'], coalesce: 0.35, drift: 0.3
  }),
  mk({
    id: 'pixel-sort', name: 'Pixel Sort', family: 'Datamosh & Compression',
    blurb: 'Brightness pulled into clean monotone streaks : the sorted-pixel light-leak.',
    world: 'sublimated',
    palette: [K, [0.3, 0.12, 0.28, 1], [1.0, 0.75, 0.55, 1]],
    sources: ['organic', 'dye-field', 'drift-field', 'swell'],
    layerFx: ['fx-pixelsort', 'fx-grade', 'fx-hue-rotate'],
    blends: ['screen', 'lighten'], feedback: 0.2, drift: 0.25, density: 0.4
  }),
  mk({
    id: 'bitrate-starve', name: 'Bitrate Starve', family: 'Datamosh & Compression',
    blurb: 'Running out of bitrate : the picture collapses into moshed, block-crushed matter.',
    world: 'presse',
    palette: [INK, [0.24, 0.14, 0.08, 1], [0.82, 0.7, 0.5, 1]],
    sources: ['organic', 'swell', 'dye-field'],
    layerFx: ['fx-compress', 'fx-grade'],
    nativeNodes: ['node-datamosh'], nativeChance: 0.9,
    blends: ['screen', 'lighten'], layers: [1, 2], feedback: 0.3, drift: 0.35, coalesce: 0.4, density: 0.4
  }),
  mk({
    id: 'discorrelated', name: 'Discorrelated', family: 'Datamosh & Compression',
    blurb: 'Two images decorrelate and smear into each other : moshed layers bleeding together.',
    world: 'incongruent',
    palette: [K, [0.4, 0.1, 0.3, 1], [0.1, 0.45, 0.55, 1], [0.9, 0.82, 0.5, 1]],
    sources: ['organic', 'shapes', 'dye-field', 'murmuration'],
    layerFx: ['fx-grade', 'fx-chroma-shift'],
    nativeNodes: ['node-datamosh'], nativeChance: 0.7,
    blends: ['screen', 'difference'], layers: [2, 2], useB: 0.4, feedback: 0.25, drift: 0.3
  })
]

/** Themes grouped by family, in declaration order : drives the dropdown's optgroups. */
export const THEME_FAMILIES: Array<{ family: string; themes: Theme[] }> = (() => {
  const order: string[] = []
  const byFamily = new Map<string, Theme[]>()
  for (const t of THEMES) {
    if (!byFamily.has(t.family)) {
      byFamily.set(t.family, [])
      order.push(t.family)
    }
    byFamily.get(t.family)!.push(t)
  }
  return order.map((family) => ({ family, themes: byFamily.get(family)! }))
})()

export const THEME_BY_ID: Record<string, Theme> = Object.fromEntries(THEMES.map((t) => [t.id, t]))
