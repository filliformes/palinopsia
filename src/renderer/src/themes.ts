// Generate : the "visual themes", each a RECIPE the generator obeys so every
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

import type { BlendMode, LfoShape, ModulatorType } from '@shared/types'

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
  /** Flow ↔ Interruption (bipolar, 0.5 = neutral) : liquid ↔ stutter. */
  flow: number
  superFlicker: number
  /** Context finalizer overrides applied AFTER the World (theme wins). */
  context?: Record<string, number | number[]>
  /** Finalizer overrides (grain character / grade leanings). */
  finalizer?: Record<string, number | number[]>
  /** Per-layer source pools, bottom layer first, overriding `sources` on those
   *  layers (rock under lichen, paper under the burn). */
  stack?: string[][]
  /** Value draws per source, effect or node : one of the listed values (a single
   *  value is fixed). */
  pickInputs?: Record<string, Record<string, number[]>>
  /** Lines a Text source draws from (one to three, stepped with `next line`). */
  words?: string[]
  /** A/B source-mix modes (default normal / screen / difference / multiply). */
  mixBlends?: BlendMode[]
  /** Lowest layer a native node lands on (1 = never the bottom : the node reads
   *  the layers under it). */
  nativeFrom?: number
  /** Plays the user's clips (Collage) : stands in with painted sources, and says
   *  so, until a Collage folder has been picked on this computer. */
  needsClips?: boolean
  /** How the scene moves : overrides the family's motion recipe. */
  motion?: Partial<MotionRecipe>
}

/** How a generated scene moves : the modulators Generate enables and binds. */
export interface MotionRecipe {
  /** How many modulators [min, max] (0 = a still scene, the sources move alone). */
  mods: [number, number]
  /** Modulator types drawn from. */
  types: ModulatorType[]
  /** LFO shapes drawn from. */
  shapes: LfoShape[]
  /** Free-running rate range, Hz. */
  rate: [number, number]
  /** Chance a modulator locks to the tempo instead. */
  bpm: number
  /** Depth range of each binding. */
  depth: [number, number]
}

// Each family's way of moving : slow breathing for living matter and cinema,
// stepped and on the beat for glitch and data, drawn cadences for film.
const MOTION_DEFAULT: MotionRecipe = {
  mods: [2, 3], types: ['lfo', 'sh', 'chaos'], shapes: ['sine', 'triangle', 'rndSmooth'],
  rate: [0.05, 1], bpm: 0.4, depth: [0.25, 0.55]
}
const SLOW: MotionRecipe = {
  mods: [1, 2], types: ['lfo', 'slew'], shapes: ['sine', 'rndSmooth'],
  rate: [0.01, 0.06], bpm: 0, depth: [0.15, 0.35]
}
const STEPPED: MotionRecipe = {
  mods: [2, 4], types: ['sh', 'euclid', 'turing', 'arp', 'random', 'lfo'], shapes: ['square', 'rndStep', 'spastic'],
  rate: [0.3, 3], bpm: 0.7, depth: [0.3, 0.7]
}
const FAMILY_MOTION: Record<string, MotionRecipe> = {
  'Analog Video Synthesis': {
    mods: [2, 4], types: ['lfo', 'lfo', 'slew', 'chaos'], shapes: ['sine', 'triangle', 'sawtooth', 'rndSmooth'],
    rate: [0.04, 0.5], bpm: 0.25, depth: [0.25, 0.6]
  },
  'Glitch / Datamosh': STEPPED,
  'Datamosh & Compression': { ...STEPPED, rate: [0.15, 2], bpm: 0.5 },
  'Cameraless / Direct Film': {
    mods: [2, 3], types: ['sh', 'euclid', 'random', 'lfo'], shapes: ['rndStep', 'square', 'triangle'],
    rate: [0.2, 2], bpm: 0.5, depth: [0.3, 0.65]
  },
  'Optical / Op-Art': {
    mods: [2, 3], types: ['lfo', 'lfo', 'turing'], shapes: ['sine', 'triangle'],
    rate: [0.03, 0.3], bpm: 0.35, depth: [0.2, 0.5]
  },
  'Organic / Reaction-Diffusion': {
    mods: [1, 3], types: ['lfo', 'slew', 'chaos'], shapes: ['sine', 'rndSmooth'],
    rate: [0.01, 0.12], bpm: 0, depth: [0.2, 0.45]
  },
  'Living Surfaces': { ...SLOW, rate: [0.005, 0.05] },
  'Data / Parametric': {
    mods: [2, 4], types: ['arp', 'euclid', 'turing', 'sh'], shapes: ['square', 'rndStep'],
    rate: [0.25, 2], bpm: 0.8, depth: [0.3, 0.65]
  },
  'Feedback / Afterimage': {
    mods: [1, 3], types: ['lfo', 'chaos', 'slew'], shapes: ['sine', 'triangle', 'rndSmooth'],
    rate: [0.02, 0.25], bpm: 0.2, depth: [0.2, 0.5]
  },
  'Cinematic / Atmospheric': SLOW,
  'Retro Screen': {
    mods: [2, 3], types: ['sh', 'lfo', 'turing'], shapes: ['square', 'triangle', 'rndStep'],
    rate: [0.1, 1.2], bpm: 0.5, depth: [0.25, 0.55]
  },
  'Minimal / Structural': {
    mods: [1, 2], types: ['lfo', 'euclid'], shapes: ['sine', 'triangle'],
    rate: [0.02, 0.15], bpm: 0.3, depth: [0.15, 0.4]
  },
  Dome: { ...SLOW, rate: [0.008, 0.05] },
  'Film Wall': {
    mods: [2, 3], types: ['sh', 'euclid', 'lfo'], shapes: ['rndStep', 'square', 'triangle'],
    rate: [0.1, 1], bpm: 0.5, depth: [0.25, 0.55]
  },
  'Node Workshop': { ...MOTION_DEFAULT, rate: [0.03, 0.6], bpm: 0.35 },
  // Each study isolates one Feel macro : nothing else may move.
  'Feel Studies': { ...MOTION_DEFAULT, mods: [0, 0] }
}

/** The motion recipe a theme generates with : its family's, bent by the theme. */
export function motionFor(t: Theme): MotionRecipe {
  return { ...(FAMILY_MOTION[t.family] ?? MOTION_DEFAULT), ...(t.motion ?? {}) }
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
  flow: 0.5,
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
    sources: ['rgb-osc', 'sync-osc', 'ramps', 'slit-scan', 'interference'],
    layerFx: ['fx-rutt', 'fx-crt-screen', 'fx-scanlines', 'fx-colorizer'],
    blends: ['add', 'screen'], layers: [2, 3], drift: 0.2, coalesce: 0.4,
    finalizer: { grain: 0.12, character: 2 }
  }),
  mk({
    id: 'scan-processor', name: 'Scan Processor', family: 'Analog Video Synthesis',
    blurb: 'Voltage ramps coloured by a CV colorizer and pushed into relief.',
    world: 'parametric',
    palette: [K, [0.4, 0.1, 0.5, 1], [1.0, 0.5, 0.1, 1], [0.9, 0.95, 0.4, 1]],
    sources: ['ramps', 'sync-osc', 'differential', 'column-scan', 'slit-scan'],
    layerFx: ['fx-colorizer', 'fx-rutt', 'fx-posterize', 'fx-wavefold'],
    blends: ['screen', 'add'], gestureTexture: 0.35, coalesce: 0.4
  }),
  mk({
    id: 'wobbulator', name: 'Wobbulator', family: 'Analog Video Synthesis',
    blurb: 'One oscillator folded back through a wandering feedback loop.',
    world: 'musical',
    palette: [K, [0.1, 0.2, 0.45, 1], [0.7, 0.85, 1.0, 1]],
    sources: ['sync-osc', 'rgb-osc', 'slit-scan'],
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
    sources: ['organic', 'solid-color', 'dye-field', 'congeal'],
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
    blends: ['screen', 'lighten'], coalesce: 0.35, drift: 0.3,
    nativeNodes: ['node-faultline']
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
    shutter: 0.35, flow: 0.3, density: 0.5,
    nativeNodes: ['node-decimate']
  }),
  mk({
    id: 'dropout', name: 'Dropout', family: 'Glitch / Datamosh',
    blurb: 'A worn tape dub : generation-loss chroma bleed, jitter and dropout lines.',
    world: 'presse',
    palette: [K, [0.28, 0.2, 0.12, 1], [0.82, 0.72, 0.55, 1]],
    sources: ['organic', 'drift-field', 'swell'],
    layerFx: ['fx-decay', 'fx-tracking', 'fx-grain', 'fx-granular'],
    blends: ['screen', 'lighten'], coalesce: 0.45, drift: 0.3
  }),
  mk({
    id: 'p-frame', name: 'P-Frame', family: 'Glitch / Datamosh',
    blurb: 'The real codec mosh : motion smears forward, I-frames bloom and reset.',
    world: 'parametric',
    palette: [K, [0.18, 0.06, 0.26, 1], [0.85, 0.35, 0.5, 1], [0.9, 0.9, 0.85, 1]],
    sources: ['drift-field', 'slabs', 'grid-drift'],
    layerFx: ['fx-pixelate'],
    nativeNodes: ['node-datamosh'], nativeChance: 0.9,
    blends: ['screen', 'difference'], gestureTexture: 0.6, coalesce: 0.3, density: 0.6
  }),
  mk({
    id: 'slit-scan', name: 'Slit-Scan', family: 'Glitch / Datamosh',
    blurb: 'A moving read-head smears time along one axis : the scanner’s streak.',
    world: 'synthetic',
    palette: [K, [0.1, 0.14, 0.2, 1], [0.68, 0.78, 0.82, 1]],
    sources: ['column-scan', 'contour', 'drift-field'],
    layerFx: ['fx-scanlines', 'fx-slit-buffer'],
    nativeNodes: ['node-scanner'], nativeChance: 0.9,
    blends: ['screen', 'lighten'], drift: 0.35, coalesce: 0.3
  }),
  mk({
    id: 'cut-up', name: 'Cut-Up', family: 'Glitch / Datamosh',
    blurb: 'The frame diced into cells that jump and re-shuffle on the beat : a live collage.',
    world: 'incongruent',
    palette: [INK, [0.14, 0.16, 0.2, 1], [0.9, 0.9, 0.88, 1]],
    sources: ['slabs', 'shapes', 'op-art'],
    layerFx: ['fx-slice-shuffle', 'fx-threshold'],
    nativeNodes: ['node-autocutter'], nativeChance: 0.9,
    blends: ['difference', 'exclusion'], shutter: 0.35, gestureTexture: 0.6, coalesce: 0.25
  }),
  mk({
    id: 'chronoscan', name: 'Chronoscan', family: 'Glitch / Datamosh',
    blurb: 'Every pixel reads from its own moment : the picture drips through a time-map.',
    world: 'synthetic',
    palette: [K, [0.12, 0.1, 0.2, 1], [0.7, 0.72, 0.85, 1]],
    sources: ['interference', 'contour', 'organic'],
    layerFx: ['fx-wide-time', 'fx-slit-buffer'],
    nativeNodes: ['node-chronoscan'], nativeChance: 0.9,
    blends: ['screen', 'add'], drift: 0.4, coalesce: 0.3
  }),

  // ── Cameraless / Direct Film ──────────────────────────────────────────
  mk({
    id: 'hand-painted', name: 'Hand-Painted', family: 'Cameraless / Direct Film',
    blurb: 'Dye painted straight onto the emulsion : subtractive pigment, boiling.',
    world: 'peint',
    palette: [K, [0.5, 0.1, 0.35, 1], [0.1, 0.4, 0.55, 1], [0.9, 0.85, 0.5, 1]],
    sources: ['dye-field', 'organic', 'membrane'],
    layerFx: ['fx-grain', 'fx-hue-rotate', 'fx-wide-time', 'fx-abstraction'],
    blends: ['multiply', 'screen', 'darken'], density: 0.6, gestureTexture: 0.6, drift: 0.25,
    finalizer: { grain: 0.18, character: 1 },
    nativeNodes: ['node-toile', 'node-lookup']
  }),
  mk({
    id: 'scratch-film', name: 'Scratch Film', family: 'Cameraless / Direct Film',
    blurb: 'Ink and scratches on black leader : hard-edged marks on the beat.',
    world: 'griffe',
    palette: [INK, [0.9, 0.9, 0.86, 1]],
    sources: ['direct-marks', 'shapes'],
    layerFx: ['fx-grain', 'fx-decay', 'fx-streak', 'fx-aperture', 'fx-triangle-flicker'],
    blends: ['screen', 'lighten', 'lumakey'], useB: 0.15, coalesce: 0.3, superFlicker: 0.3
  }),
  mk({
    id: 'emulsion', name: 'Emulsion', family: 'Cameraless / Direct Film',
    blurb: 'Warm film stock : clumped photochemical grain over drifting dye.',
    world: 'peint',
    palette: [K, [0.3, 0.14, 0.06, 1], [0.9, 0.78, 0.55, 1]],
    sources: ['dye-field', 'organic', 'swell'],
    layerFx: ['fx-grain', 'fx-light-trails', 'fx-grade', 'fx-solarize', 'fx-aperture'],
    blends: ['screen', 'lighten'], feedback: 0.3, drift: 0.3,
    finalizer: { grain: 0.2, grainSize: 2, character: 0 }
  }),
  mk({
    id: 'frame-by-frame', name: 'Frame by Frame', family: 'Cameraless / Direct Film',
    blurb: 'Stop-motion animation : marks that jump on a drawn cadence.',
    world: 'griffe',
    palette: [INK, [0.85, 0.2, 0.15, 1], [0.92, 0.9, 0.82, 1]],
    sources: ['direct-marks', 'shapes', 'op-art'],
    layerFx: ['fx-grain', 'fx-stutter', 'fx-aperture', 'fx-triangle-flicker'],
    blends: ['screen', 'difference'], shutter: 0.45, superFlicker: 0.4, coalesce: 0.3,
    nativeNodes: ['node-decimate']
  }),
  mk({
    id: 'boiling-line', name: 'Boiling Line', family: 'Cameraless / Direct Film',
    blurb: 'A trembling hand-drawn line : marks that boil and smear over time.',
    world: 'peint',
    palette: [K, [0.1, 0.35, 0.4, 1], [0.85, 0.88, 0.8, 1]],
    sources: ['direct-marks', 'filaments', 'contour'],
    layerFx: ['fx-wide-time', 'fx-displace', 'fx-grain', 'fx-force-lines'],
    blends: ['screen', 'lighten'], drift: 0.4, gestureTexture: 0.6,
    nativeNodes: ['node-toile']
  }),

  // ── Optical / Op-Art ──────────────────────────────────────────────────
  mk({
    id: 'moire', name: 'Moiré', family: 'Optical / Op-Art',
    blurb: 'Two line fields beating : black-and-white vibration, matte not op-art soup.',
    world: 'parametric',
    palette: [INK, WHITE],
    sources: ['interference', 'op-art', 'differential'],
    layerFx: ['fx-sharpen', 'fx-posterize'],
    blends: ['difference', 'screen', 'weave', 'lightercolor'], useB: 0.4, gestureTexture: 0.55, coalesce: 0.35,
    nativeNodes: ['node-remap'], mixBlends: ['difference', 'weave']
  }),
  mk({
    id: 'op-field', name: 'Op Field', family: 'Optical / Op-Art',
    blurb: 'Hard monochrome geometry with illusory motion.',
    world: 'parametric',
    palette: [INK, [0.95, 0.93, 0.88, 1]],
    sources: ['op-art', 'grid-drift', 'shapes', 'ten-print'],
    layerFx: ['fx-fold', 'fx-sharpen', 'fx-edge', 'fx-motif'],
    blends: ['difference', 'screen', 'lightercolor'], useB: 0.3, gestureTexture: 0.5
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
    layerFx: ['fx-posterize', 'fx-sharpen', 'fx-hue-rotate', 'fx-force-lines'],
    blends: ['screen', 'add'], gestureTexture: 0.45
  }),
  mk({
    id: 'herringbone', name: 'Herringbone', family: 'Optical / Op-Art',
    blurb: 'Tight woven greys haunted by ringing echoes.',
    world: 'parametric',
    palette: [INK, [0.2, 0.2, 0.22, 1], [0.8, 0.8, 0.78, 1]],
    sources: ['op-art', 'interference'],
    layerFx: ['fx-ringing', 'fx-sharpen', 'fx-posterize'],
    blends: ['difference', 'overlay', 'weave'], useB: 0.35,
    mixBlends: ['weave', 'difference']
  }),

  // ── Organic / Reaction-Diffusion ──────────────────────────────────────
  mk({
    id: 'critters', name: 'Critters', family: 'Organic / Reaction-Diffusion',
    blurb: 'Gray-Scott spots split and crawl : matte biological texture.',
    world: 'sublimated',
    palette: [K, [0.06, 0.2, 0.18, 1], [0.7, 0.85, 0.7, 1]],
    sources: ['reaction', 'membrane', 'mycelium'],
    layerFx: ['fx-sharpen', 'fx-hue-rotate', 'fx-grade'],
    blends: ['screen', 'lighten', 'consume'], density: 0.6, coalesce: 0.6, drift: 0.2,
    nativeNodes: ['node-gooey'], mixBlends: ['consume', 'screen']
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
    layerFx: ['fx-light-trails', 'fx-streak', 'fx-difference-bloom'],
    blends: ['screen', 'add'], density: 0.55, feedback: 0.3, drift: 0.25,
    nativeNodes: ['node-ibfv', 'node-gooey', 'node-convolve']
  }),
  mk({
    id: 'tide', name: 'Tide', family: 'Organic / Reaction-Diffusion',
    blurb: 'Cold open water : wave trains beating, dye pooling, smeared over time.',
    world: 'sublimated',
    palette: [K, [0.05, 0.16, 0.24, 1], [0.6, 0.78, 0.82, 1]],
    sources: ['swell', 'dye-field', 'membrane'],
    layerFx: ['fx-wide-time', 'fx-grade', 'fx-hue-rotate'],
    blends: ['screen', 'lighten'], feedback: 0.4, drift: 0.35, density: 0.45,
    nativeNodes: ['node-ibfv']
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
    blends: ['normal', 'screen'], useB: 0.2, coalesce: 0.35, gestureTexture: 0.4,
    nativeNodes: ['node-matte'], nativeChance: 0.3
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
    layerFx: ['fx-phosphene', 'fx-wide-time', 'fx-feedback-zoom', 'fx-difference-bloom'],
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
    layerFx: ['fx-wide-time', 'fx-light-trails', 'fx-granular'],
    nativeNodes: ['node-reponse'], blends: ['screen', 'add'], feedback: 0.4, drift: 0.3
  }),
  mk({
    id: 'persistence', name: 'Persistence', family: 'Feedback / Afterimage',
    blurb: 'Long-exposure light painting : the brightest pixels smear and decay.',
    world: 'sublimated',
    palette: [K, [0.3, 0.16, 0.04, 1], [1.0, 0.85, 0.5, 1]],
    sources: ['particle-drift', 'ash', 'filaments', 'congeal'],
    layerFx: ['fx-light-trails', 'fx-decay', 'fx-phosphene', 'fx-smear'],
    blends: ['screen', 'lighten'], feedback: 0.5, drift: 0.3, flow: 0.66, density: 0.4
  }),
  mk({
    id: 'recursion', name: 'Recursion', family: 'Feedback / Afterimage',
    blurb: 'A shape cascading inward through an off-centre zoom : a spiral, not a kaleidoscope.',
    world: 'musical',
    palette: [K, [0.16, 0.06, 0.2, 1], [0.8, 0.75, 0.9, 1]],
    sources: ['recurse', 'shapes', 'op-art'],
    layerFx: ['fx-feedback-zoom', 'fx-hue-rotate', 'fx-sharpen', 'fx-motif'],
    blends: ['screen', 'add'], feedback: 0.4, drift: 0.35
  }),
  mk({
    id: 'eternalism', name: 'Eternalism', family: 'Feedback / Afterimage',
    blurb: 'An unfrozen slice of time : two frames a gap apart, held across a black shutter.',
    world: 'sublimated',
    palette: [K, [0.1, 0.12, 0.16, 1], [0.8, 0.82, 0.85, 1]],
    sources: ['organic', 'shapes', 'op-art'],
    layerFx: ['fx-wide-time'],
    nativeNodes: ['node-eternalism'], nativeChance: 0.85,
    blends: ['screen', 'lighten'], superFlicker: 0.4, drift: 0.2, density: 0.4
  }),
  mk({
    id: 'phase-drift', name: 'Phase Drift', family: 'Feedback / Afterimage',
    blurb: 'Two delayed twins beating in and out of lock : coherent, doubled, coherent.',
    world: 'musical',
    palette: [K, [0.22, 0.14, 0.06, 1], [0.9, 0.78, 0.55, 1]],
    sources: ['particle-drift', 'organic', 'murmuration'],
    layerFx: ['fx-wide-time', 'fx-light-trails'],
    nativeNodes: ['node-eternalism'], nativeChance: 0.85,
    blends: ['screen', 'add'], drift: 0.4, density: 0.4
  }),
  mk({
    id: 'complement', name: 'Complement', family: 'Feedback / Afterimage',
    blurb: 'A bright form, once removed, leaves its complementary ghost : Goethe’s afterimage.',
    world: 'sublimated',
    palette: [K, [0.24, 0.05, 0.14, 1], [0.4, 0.85, 0.82, 1]],
    sources: ['shapes', 'op-art', 'dye-field', 'metamorph'],
    layerFx: ['fx-phosphene', 'fx-decay', 'fx-solarize'],
    nativeNodes: ['node-afterimage'], nativeChance: 0.85,
    blends: ['screen', 'lighten'], drift: 0.25, density: 0.35
  }),
  mk({
    id: 'sediment', name: 'Sediment', family: 'Feedback / Afterimage',
    blurb: 'Long mineral memory : the image settles in layers that never quite wash out.',
    world: 'sublimated',
    palette: [K, [0.16, 0.14, 0.1, 1], [0.72, 0.66, 0.52, 1]],
    sources: ['contour', 'drift-field', 'organic'],
    layerFx: ['fx-decay', 'fx-grain'],
    nativeNodes: ['node-sediment'], nativeChance: 0.85,
    blends: ['screen', 'darken'], feedback: 0.4, drift: 0.2, gestureTexture: 0.55
  }),
  mk({
    id: 'pulfrich', name: 'Pulfrich', family: 'Feedback / Afterimage',
    blurb: 'Lateral motion tips into depth : a red/cyan stereo pair born from a temporal eye-delay.',
    world: 'sublimated',
    palette: [K, [0.24, 0.06, 0.1, 1], [0.3, 0.72, 0.78, 1]],
    sources: ['murmuration', 'particle-drift', 'drift-field'],
    layerFx: ['fx-wide-time'],
    nativeNodes: ['node-pulfrich'], nativeChance: 0.85,
    blends: ['screen', 'add'], drift: 0.45, density: 0.4
  }),

  // ── Cinematic / Atmospheric ───────────────────────────────────────────
  mk({
    id: 'noir', name: 'Noir', family: 'Cinematic / Atmospheric',
    blurb: 'Deep-black high-contrast monochrome with heavy grain.',
    world: 'monomedia',
    palette: [INK, [0.5, 0.5, 0.52, 1], [0.95, 0.95, 0.95, 1]],
    sources: ['organic', 'membrane', 'solid-color'],
    layerFx: ['fx-grade', 'fx-grain', 'fx-threshold', 'fx-solarize'],
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
    context: { haze: 0.24, depth: 0.42, bloom: 0.2 },
    nativeNodes: ['node-lumablur']
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
    context: { haze: 0.26, depth: 0.4 },
    nativeNodes: ['node-lumablur']
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
    layerFx: ['fx-pixelate', 'fx-posterize', 'fx-pixelmask', 'fx-crt-screen', 'fx-mosaic'],
    blends: ['screen', 'add', 'lightercolor'], useB: 0.2, coalesce: 0.3, gestureTexture: 0.4
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
    sources: ['gen-parametric', 'column-scan', 'ramps', 'ten-print', 'gen-text'],
    bgSources: ['grid-drift', 'ramps'],
    layerFx: ['fx-scanlines', 'fx-crt-screen', 'fx-posterize'],
    blends: ['screen', 'add', 'lumakey'], tonicity: 0.4, coalesce: 0.35, gestureTexture: 0.4,
    words: ['READY.', 'NO CARRIER', 'SIGNAL', 'RUN', 'CONNECT', 'LOAD', '> _'], mixBlends: ['lumakey', 'screen']
  }),
  mk({
    id: 'teletext', name: 'Teletext', family: 'Retro Screen',
    blurb: 'Blocky primaries on black : the limited-palette information screen.',
    world: 'parametric',
    palette: [INK, [0.9, 0.2, 0.2, 1], [0.2, 0.8, 0.4, 1], [0.95, 0.9, 0.3, 1]],
    sources: ['shapes', 'slabs', 'grid-drift', 'gen-text'],
    layerFx: ['fx-posterize', 'fx-palette', 'fx-pixelate', 'fx-mosaic'],
    blends: ['normal', 'screen', 'lumakey'], useB: 0.15, coalesce: 0.3,
    words: ['P100', 'INDEX', 'NEWS', 'WEATHER', 'SUBTITLES', 'PAGE 888']
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
    sources: ['shapes', 'slabs', 'differential', 'gen-text'],
    layerFx: ['fx-transform', 'fx-posterize', 'fx-sharpen', 'fx-motif'],
    blends: ['normal', 'multiply', 'screen', 'lightercolor'], useB: 0.3, layers: [2, 3],
    density: 0.4, coalesce: 0.35, gestureTexture: 0.4, drift: 0.12,
    vibe: { saturation: 1.2, contrast: 1.15, mixSrc: 0.15 },
    words: ['FORM', 'LINE', 'MASS', 'WORK', 'BUILD', 'SIGNAL'], nativeNodes: ['node-matte'], nativeChance: 0.35
  }),
  mk({
    id: 'grid', name: 'Grid', family: 'Minimal / Structural',
    blurb: 'Architectural greys : a breathing grid, quantised.',
    world: 'parametric',
    palette: [K, [0.2, 0.22, 0.24, 1], [0.78, 0.8, 0.82, 1]],
    sources: ['grid-drift', 'column-scan', 'contour', 'ten-print'],
    layerFx: ['fx-pixelate', 'fx-posterize', 'fx-sharpen', 'fx-mosaic'],
    blends: ['screen', 'normal'], density: 0.4, coalesce: 0.4
  }),
  mk({
    id: 'contour-map', name: 'Contour Map', family: 'Minimal / Structural',
    blurb: 'Topographic line-work : marching contours and beating rhythms.',
    world: 'musical',
    palette: [K, [0.12, 0.2, 0.18, 1], [0.7, 0.82, 0.72, 1]],
    sources: ['contour', 'differential', 'erosion'],
    layerFx: ['fx-sharpen', 'fx-edge', 'fx-posterize', 'fx-force-lines'],
    blends: ['screen', 'add'], density: 0.4, drift: 0.2
  }),
  mk({
    id: 'monolith', name: 'Monolith', family: 'Minimal / Structural',
    blurb: 'A single form standing in graded space : one lit silhouette against the dark.',
    // Textured sources (never a flat solid) so the form always reads : a lit mass
    // clipped into a silhouette, seated by the depth vignette.
    world: 'monomedia',
    palette: [INK, [0.16, 0.16, 0.19, 1], [0.72, 0.72, 0.78, 1]],
    sources: ['membrane', 'organic', 'shapes', 'metamorph'],
    layerFx: ['fx-transform', 'fx-grade', 'fx-abstraction'],
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
    layerFx: ['fx-grade', 'fx-chroma-shift', 'fx-smear'],
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
    blends: ['screen', 'difference'], gestureTexture: 0.55, coalesce: 0.3, density: 0.55,
    nativeNodes: ['node-mosaique'], nativeChance: 0.45
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
    blends: ['screen', 'lighten'], coalesce: 0.35, drift: 0.3,
    nativeNodes: ['node-faultline']
  }),
  mk({
    id: 'pixel-sort', name: 'Pixel Sort', family: 'Datamosh & Compression',
    blurb: 'Brightness pulled into clean monotone streaks : the sorted-pixel light-leak.',
    world: 'sublimated',
    palette: [K, [0.3, 0.12, 0.28, 1], [1.0, 0.75, 0.55, 1]],
    sources: ['organic', 'dye-field', 'drift-field', 'swell'],
    layerFx: ['fx-pixelsort', 'fx-grade', 'fx-hue-rotate', 'fx-smear'],
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
    nativeNodes: ['node-datamosh', 'node-transfert'], nativeChance: 0.7,
    blends: ['screen', 'difference', 'consume'], layers: [2, 2], useB: 0.4, feedback: 0.25, drift: 0.3,
    mixBlends: ['consume', 'screen', 'difference']
  }),

  // ── Living Surfaces : the surfaces that grow, crack and rust ──────────
  // Real photographed materials and grown matter keep their own color : the Vibe
  // only tints them (a high source mix), the palette sets the mood of the light.
  mk({
    id: 'lichen', name: 'Lichen', family: 'Living Surfaces',
    blurb: 'Lichen spreading over rock and concrete, crusts cracking as they age.',
    world: 'sublimated',
    palette: [K, [0.16, 0.2, 0.14, 1], [0.7, 0.74, 0.6, 1]],
    sources: ['scan', 'colony'],
    stack: [['scan', 'ground'], ['colony']],
    pickInputs: { scan: { material: [11, 12, 18, 19] }, ground: { kind: [2] }, colony: { kind: [0] } },
    layerFx: ['fx-grade', 'fx-grain'],
    blends: ['normal'], layers: [2, 2], useB: 0, feedback: 0, density: 0.5, drift: 0.15,
    vibe: { mixSrc: 0.8 }
  }),
  mk({
    id: 'rust', name: 'Rust', family: 'Living Surfaces',
    blurb: 'Rust blooming over worn steel : pits, flakes and a slow corrosion eating the picture.',
    world: 'sublimated',
    palette: [K, [0.3, 0.12, 0.05, 1], [0.8, 0.52, 0.32, 1]],
    sources: ['scan', 'colony'],
    stack: [['scan'], ['colony']],
    pickInputs: { scan: { material: [23, 24] }, colony: { kind: [3] } },
    layerFx: ['fx-grade', 'fx-grain'],
    nativeNodes: ['node-corrode'], nativeChance: 0.45,
    blends: ['normal'], layers: [2, 2], useB: 0, feedback: 0, drift: 0.15,
    vibe: { mixSrc: 0.8 }
  }),
  mk({
    id: 'mold-culture', name: 'Mold Culture', family: 'Living Surfaces',
    blurb: 'Colonies of mold on agar, sporulating in rings and stopping short of each other.',
    world: 'sublimated',
    palette: [K, [0.2, 0.22, 0.16, 1], [0.82, 0.8, 0.68, 1]],
    sources: ['colony'],
    pickInputs: { colony: { kind: [1] } },
    layerFx: ['fx-grade', 'fx-sharpen'],
    nativeNodes: ['node-lumablur'],
    blends: ['normal', 'multiply'], layers: [1, 2], useB: 0, feedback: 0, density: 0.45,
    vibe: { mixSrc: 0.75 }
  }),
  mk({
    id: 'burning-paper', name: 'Burning Paper', family: 'Living Surfaces',
    blurb: 'Paper catching and charring from its edges : the burn front glows, then turns to ash.',
    world: 'sublimated',
    palette: [K, [0.35, 0.1, 0.03, 1], [0.95, 0.72, 0.4, 1]],
    sources: ['scan', 'colony'],
    stack: [['scan'], ['colony']],
    pickInputs: { scan: { material: [1, 2, 3, 4] }, colony: { kind: [2] } },
    layerFx: ['fx-grade', 'fx-grain', 'fx-light-trails'],
    blends: ['normal'], layers: [2, 2], useB: 0, feedback: 0, drift: 0.2,
    vibe: { mixSrc: 0.65 }
  }),
  mk({
    id: 'dry-earth', name: 'Dry Earth', family: 'Living Surfaces',
    blurb: 'Mud cracking as it dries, sand ripples migrating with the wind, lit low from the side.',
    world: 'sublimated',
    palette: [K, [0.24, 0.17, 0.1, 1], [0.8, 0.7, 0.54, 1]],
    sources: ['ground'],
    pickInputs: { ground: { kind: [0, 1] } },
    layerFx: ['fx-grade', 'fx-grain'],
    nativeNodes: ['node-lumablur'], nativeChance: 0.3,
    blends: ['normal', 'multiply'], layers: [1, 1], useB: 0.25, feedback: 0, drift: 0.15,
    mixBlends: ['multiply', 'lumakey'],
    vibe: { mixSrc: 0.75 }
  }),
  mk({
    id: 'grown', name: 'Grown', family: 'Living Surfaces',
    blurb: 'A texture that grows itself from nothing and heals where it is damaged : lava, moss, bark.',
    world: 'sublimated',
    palette: [K, [0.22, 0.14, 0.08, 1], [0.85, 0.72, 0.52, 1]],
    sources: ['gen-nca'],
    stack: [['gen-nca'], ['colony']],
    pickInputs: { colony: { kind: [0, 1] } },
    layerFx: ['fx-grade', 'fx-grain'],
    blends: ['normal'], layers: [1, 2], useB: 0, feedback: 0, drift: 0.15,
    vibe: { mixSrc: 0.8 }
  }),

  // ── Dome : made for a fulldome. No vignette (it darkens the rim, where a dome
  // audience looks), nothing that frames the edges, slow motion overhead. ──
  mk({
    id: 'dome-aurora', name: 'Aurora', family: 'Dome',
    blurb: 'Slow curtains of colored light across the whole sky.',
    world: 'sublimated',
    palette: [K, [0.04, 0.18, 0.14, 1], [0.3, 0.75, 0.55, 1], [0.7, 0.55, 0.85, 1]],
    sources: ['dye-field', 'swell', 'membrane'],
    layerFx: ['fx-light-trails', 'fx-grade', 'fx-hue-rotate'],
    blends: ['screen', 'lighten'], layers: [1, 2], useB: 0.2, feedback: 0.3, drift: 0.2, density: 0.4,
    context: { depth: 0, haze: 0.1, bloom: 0.18 }
  }),
  mk({
    id: 'dome-canopy', name: 'Canopy', family: 'Dome',
    blurb: 'Branching threads growing overhead, like looking up through a forest.',
    world: 'musical',
    palette: [K, [0.08, 0.14, 0.08, 1], [0.6, 0.72, 0.5, 1]],
    sources: ['mycelium', 'filaments'],
    layerFx: ['fx-grade', 'fx-light-trails'],
    blends: ['screen', 'lighten'], layers: [1, 2], useB: 0, drift: 0.2, density: 0.45,
    context: { depth: 0, haze: 0.12 }
  }),
  mk({
    id: 'dome-flock', name: 'Flock Overhead', family: 'Dome',
    blurb: 'A murmuration wheeling across the whole sky, its trails fading behind it.',
    world: 'musical',
    palette: [K, [0.1, 0.12, 0.18, 1], [0.78, 0.8, 0.86, 1]],
    sources: ['murmuration', 'particle-drift'],
    layerFx: ['fx-light-trails', 'fx-grade'],
    nativeNodes: ['node-ibfv'], nativeChance: 0.3,
    blends: ['screen', 'add'], layers: [1, 2], useB: 0, feedback: 0.3, density: 0.45,
    context: { depth: 0 }
  }),
  mk({
    id: 'dome-strata', name: 'Strata', family: 'Dome',
    blurb: 'A ceiling of layered rock lit low from one side : the dome as a cave.',
    world: 'sublimated',
    palette: [K, [0.2, 0.16, 0.12, 1], [0.76, 0.68, 0.56, 1]],
    sources: ['scan', 'ground'],
    stack: [['scan']],
    pickInputs: { ground: { kind: [2] }, scan: { material: [11, 12, 19] } },
    layerFx: ['fx-grade', 'fx-grain'],
    blends: ['normal', 'multiply'], layers: [1, 1], useB: 0.3, mixBlends: ['multiply', 'lumakey'], feedback: 0,
    vibe: { mixSrc: 0.55 },
    context: { depth: 0 }
  }),
  mk({
    id: 'dome-deep-water', name: 'Deep Water', family: 'Dome',
    blurb: 'Looking up at the surface from below : caustics and swell over the whole dome.',
    world: 'sublimated',
    palette: [K, [0.03, 0.1, 0.18, 1], [0.35, 0.7, 0.8, 1]],
    sources: ['organic', 'swell'],
    pickInputs: { organic: { mode: [1] } },
    layerFx: ['fx-grade', 'fx-light-trails'],
    blends: ['screen', 'lighten'], layers: [1, 2], useB: 0.2, drift: 0.2, density: 0.4,
    context: { depth: 0, haze: 0.08 }
  }),

  // ── Film Wall : your own films (a Collage folder), cut, graded, damaged ──
  mk({
    id: 'film-wall', name: 'Film Wall', family: 'Film Wall',
    blurb: 'A wall of your films cut up like torn paper, every piece its own clip, graded and grained.',
    world: 'monomedia',
    palette: [K, [0.2, 0.18, 0.16, 1], [0.86, 0.82, 0.74, 1]],
    sources: ['gen-collage'], needsClips: true,
    pickInputs: { 'gen-collage': { feed: [0], shape: [0, 1] } },
    layerFx: ['fx-grade', 'fx-grain'],
    blends: ['normal'], layers: [1, 1], useB: 0, feedback: 0,
    vibe: { mixSrc: 0.8 },
    finalizer: { grain: 0.1, filmDust: 0.2, filmScratch: 0.15, filmGauge: 1 }
  }),
  mk({
    id: 'contact-sheet', name: 'Contact Sheet', family: 'Film Wall',
    blurb: 'Many small films at once, cut into a tight grid of frames, nearly gray.',
    world: 'monomedia',
    palette: [INK, [0.3, 0.3, 0.3, 1], [0.9, 0.9, 0.88, 1]],
    sources: ['gen-collage'], needsClips: true,
    pickInputs: { 'gen-collage': { feed: [0], shape: [0], cuts: [24, 32, 40], films: [16, 24] } },
    layerFx: ['fx-grade', 'fx-sharpen'],
    blends: ['normal'], layers: [1, 1], useB: 0, feedback: 0,
    vibe: { mixSrc: 0.7, saturation: 0.6 }
  }),
  mk({
    id: 'nitrate', name: 'Nitrate', family: 'Film Wall',
    blurb: 'Old nitrate stock decomposing : amber, scratched, slowly eaten by corrosion.',
    world: 'monomedia',
    palette: [K, [0.28, 0.16, 0.06, 1], [0.9, 0.74, 0.46, 1]],
    sources: ['gen-collage'], needsClips: true,
    pickInputs: { 'gen-collage': { feed: [0] } },
    layerFx: ['fx-grain', 'fx-solarize', 'fx-grade'],
    nativeNodes: ['node-corrode'], nativeChance: 0.6,
    blends: ['normal'], layers: [1, 1], useB: 0, feedback: 0,
    vibe: { mixSrc: 0.45 },
    finalizer: { grain: 0.18, filmDust: 0.45, filmScratch: 0.45, filmHair: 0.3, filmGauge: 0, filmDirt: 1 }
  }),
  mk({
    id: 'projection-booth', name: 'Projection Booth', family: 'Film Wall',
    blurb: 'Your films through a projector gate : the iris breathes, dust and a hair ride the frame.',
    world: 'monomedia',
    palette: [K, [0.22, 0.18, 0.12, 1], [0.92, 0.86, 0.72, 1]],
    sources: ['gen-collage'], needsClips: true,
    pickInputs: { 'gen-collage': { feed: [0], cuts: [2, 3, 4] } },
    layerFx: ['fx-aperture', 'fx-grain'],
    blends: ['normal'], layers: [1, 1], useB: 0, feedback: 0,
    vibe: { mixSrc: 0.75 },
    finalizer: { filmDust: 0.3, filmScratch: 0.25, filmHair: 0.4, filmGauge: 1 }
  }),

  // ── Node Workshop : one recipe node per theme, placed where it reads the
  // layers it needs ──
  mk({
    id: 'workshop-gooey', name: 'Gooey Blobs', family: 'Node Workshop',
    blurb: 'Blur, then cut : shapes that come close melt into soft single blobs.',
    world: 'synthetic',
    palette: [K, [0.18, 0.1, 0.28, 1], [0.85, 0.78, 0.9, 1]],
    // Solid forms lit from the first frame : sparse points (or a reaction still
    // seeding) blur away below the cut and leave black, and so does inverted goo.
    sources: ['shapes', 'metamorph', 'dye-field'],
    stack: [['shapes', 'dye-field']],
    pickInputs: { 'node-gooey': { threshold: [0.18, 0.24, 0.3], blur: [0.4, 0.5], fill: [1, 2], outside: [0.2, 0.3], invert: [0], mix: [1] } },
    layerFx: ['fx-grade'],
    nativeNodes: ['node-gooey'], nativeChance: 0.95,
    blends: ['screen', 'lighten'], layers: [1, 2], useB: 0.2
  }),
  mk({
    id: 'workshop-palette', name: 'Borrowed Palette', family: 'Node Workshop',
    blurb: 'Line-work recolored through a live palette read off the moving layer below it.',
    world: 'parametric',
    palette: [K, [0.14, 0.16, 0.2, 1], [0.82, 0.84, 0.86, 1]],
    sources: ['contour', 'op-art', 'differential'],
    stack: [['dye-field', 'organic', 'swell'], ['contour', 'op-art', 'differential']],
    layerFx: ['fx-grade'],
    nativeNodes: ['node-lookup'], nativeChance: 0.95, nativeFrom: 1,
    blends: ['normal', 'screen', 'lightercolor'], layers: [2, 2], useB: 0
  }),
  mk({
    id: 'workshop-matte', name: 'Layer Matte', family: 'Node Workshop',
    blurb: 'Three layers keyed into one : a matte decides where each picture shows.',
    world: 'incongruent',
    palette: [K, [0.24, 0.1, 0.12, 1], [0.12, 0.4, 0.46, 1], [0.9, 0.86, 0.78, 1]],
    sources: ['shapes', 'op-art', 'organic'],
    stack: [['organic', 'dye-field', 'swell'], ['op-art', 'interference', 'ramps'], ['shapes', 'gen-text']],
    words: ['HERE', 'THERE', 'NOW', 'AFTER'],
    layerFx: ['fx-grade'],
    nativeNodes: ['node-matte'], nativeChance: 0.95, nativeFrom: 2,
    blends: ['normal'], layers: [3, 3], useB: 0
  }),
  mk({
    id: 'workshop-remap', name: 'Displaced', family: 'Node Workshop',
    blurb: 'A picture pushed around by the brightness of another : one layer remaps the other.',
    world: 'parametric',
    palette: [K, [0.16, 0.08, 0.2, 1], [0.8, 0.6, 0.4, 1]],
    sources: ['dye-field', 'organic'],
    stack: [['op-art', 'interference', 'ramps'], ['dye-field', 'organic', 'swell']],
    layerFx: ['fx-grade'],
    nativeNodes: ['node-remap'], nativeChance: 0.95, nativeFrom: 1,
    blends: ['normal', 'screen'], layers: [2, 2], useB: 0
  }),
  mk({
    id: 'workshop-focus', name: 'Focus Pull', family: 'Node Workshop',
    blurb: 'A blur that follows the light : bright parts soften, dark detail stays sharp.',
    world: 'sublimated',
    palette: [K, [0.1, 0.12, 0.16, 1], [0.8, 0.8, 0.76, 1]],
    sources: ['particle-drift', 'shapes', 'ash', 'murmuration'],
    layerFx: ['fx-grade'],
    nativeNodes: ['node-lumablur'], nativeChance: 0.95,
    blends: ['screen', 'lighten'], layers: [1, 2], useB: 0.2
  }),
  mk({
    id: 'workshop-fault', name: 'Fault Line', family: 'Node Workshop',
    blurb: 'A dirty vision mixer : a clean picture, then a sudden fault on the beat (a dropout, a held cut, a torn line).',
    world: 'incongruent',
    palette: [K, [0.14, 0.14, 0.16, 1], [0.8, 0.78, 0.72, 1]],
    sources: ['slabs', 'column-scan', 'contour'],
    layerFx: ['fx-grade', 'fx-scanlines'],
    nativeNodes: ['node-faultline'], nativeChance: 0.95,
    blends: ['screen', 'lighten'], layers: [1, 2], useB: 0.2
  }),

  // ── New effect showcases (borrowed ideas) ──────────────────────────────
  mk({
    id: 'composite-signal', name: 'Composite Signal', family: 'Retro Screen',
    blurb: 'One crowded composite line : colour crawls off the edges and the two scan fields shiver apart.',
    world: 'incongruent',
    palette: [K, [0.1, 0.14, 0.18, 1], [0.7, 0.55, 0.4, 1], [0.85, 0.88, 0.82, 1]],
    sources: ['slabs', 'column-scan', 'rgb-osc'],
    layerFx: ['fx-ntsc', 'fx-scanlines', 'fx-tracking'],
    blends: ['screen', 'add'], layers: [2, 3], coalesce: 0.4, drift: 0.2,
    finalizer: { grain: 0.14, character: 2 }
  }),
  mk({
    id: 'meltwater', name: 'Meltwater', family: 'Feedback / Afterimage',
    blurb: 'The picture softens only at its own edges and the seams slowly walk : contours dissolving in place.',
    world: 'sublimated',
    palette: [K, [0.08, 0.14, 0.16, 1], [0.5, 0.68, 0.66, 1]],
    sources: ['organic', 'dye-field', 'membrane'],
    layerFx: ['fx-grade'],
    nativeNodes: ['node-melt'], nativeChance: 0.7,
    blends: ['screen', 'lighten'], layers: [1, 2], feedback: 0.3, density: 0.4, coalesce: 0.55, drift: 0.2
  }),
  mk({
    id: 'liquid-mosh', name: 'Liquid Mosh', family: 'Datamosh & Compression',
    blurb: 'Motion advects the frame like a fluid : the gate holds the movers, edges repel the smear into swirls.',
    world: 'parametric',
    palette: [K, [0.16, 0.06, 0.24, 1], [0.7, 0.35, 0.5, 1], [0.9, 0.88, 0.85, 1]],
    sources: ['slabs', 'grid-drift', 'drift-field'],
    layerFx: ['fx-grade'],
    nativeNodes: ['node-datamosh'], nativeChance: 0.7,
    blends: ['screen', 'difference'], layers: [2, 3], gestureTexture: 0.6, coalesce: 0.35, density: 0.55
  }),

  // ── Feel Studies : one theme per macro (open Feel · G, then sweep the named
  // macro). Each isolates ONE macro : clean content, every OTHER macro neutral.
  mk({
    id: 'test-density', name: 'Density', family: 'Feel Studies',
    blurb: 'STUDY · Four stacked layers. Sweep DENSITY in Feel (G) : left fades the upper layers out (sparse), right fills them in (dense).',
    world: 'synthetic',
    palette: [K, [0.5, 0.3, 0.6, 1], [0.3, 0.6, 0.55, 1], [0.85, 0.8, 0.4, 1]],
    sources: ['shapes', 'op-art', 'grid-drift', 'contour', 'murmuration'],
    layerFx: ['fx-grade'],
    blends: ['screen', 'lighten'], layers: [4, 4], useB: 0
  }),
  mk({
    id: 'test-gesture', name: 'Gesture ⇄ Texture', family: 'Feel Studies',
    blurb: 'STUDY · A moving, textured field. Sweep G↔T : left = gesture (crisp, sharpened motion), right = texture (internalised churn / trails).',
    world: 'musical',
    palette: [K, [0.14, 0.16, 0.2, 1], [0.75, 0.8, 0.85, 1]],
    sources: ['murmuration', 'particle-drift'],
    layerFx: ['fx-grade'],
    blends: ['screen'], layers: [2, 2], useB: 0
  }),
  mk({
    id: 'test-coalesce', name: 'Coalesce', family: 'Feel Studies',
    blurb: 'STUDY · A detailed field. Sweep COALESCE : left breaks it into grain / dither, right pulls it into smooth mass (blur).',
    world: 'synthetic',
    palette: [K, [0.2, 0.22, 0.26, 1], [0.85, 0.85, 0.8, 1]],
    sources: ['op-art', 'interference', 'contour'],
    layerFx: ['fx-grade'],
    blends: ['screen'], layers: [1, 2], useB: 0
  }),
  mk({
    id: 'test-tonicity', name: 'Tonicity', family: 'Feel Studies',
    blurb: 'STUDY · NEEDS Audio on. A colourful field. Sweep TONICITY : tonal/harmonic audio pulls colour in, noise pulls toward black-and-white.',
    world: 'peint',
    palette: [K, [0.7, 0.15, 0.4, 1], [0.15, 0.55, 0.7, 1], [0.9, 0.8, 0.3, 1]],
    sources: ['dye-field', 'organic'],
    layerFx: ['fx-grade'],
    blends: ['screen', 'lighten'], layers: [2, 2], useB: 0, tonicity: 0.7
  }),
  mk({
    id: 'test-shutter', name: 'Shutter', family: 'Feel Studies',
    blurb: 'STUDY · Fast motion. Sweep SHUTTER : the whole frame stop-motion-steps. Low = chunky (~2fps), high = fluid.',
    world: 'synthetic',
    palette: [K, [0.16, 0.18, 0.22, 1], [0.8, 0.82, 0.86, 1]],
    sources: ['murmuration', 'particle-drift', 'swell'],
    layerFx: ['fx-grade'],
    blends: ['screen'], layers: [2, 2], useB: 0, shutter: 0.4
  }),
  mk({
    id: 'test-drift', name: 'Drift', family: 'Feel Studies',
    blurb: 'STUDY · A calm graded image. Sweep DRIFT : the grade slowly wanders (gamma / RGB) with rare analog accidents. Watch over ~10s.',
    world: 'sublimated',
    palette: [K, [0.3, 0.16, 0.12, 1], [0.85, 0.75, 0.6, 1]],
    sources: ['organic', 'membrane'],
    layerFx: ['fx-grade'],
    blends: ['screen'], layers: [1, 1], useB: 0, drift: 0.6
  }),
  mk({
    id: 'test-flow', name: 'Flow ⇄ Interruption', family: 'Feel Studies',
    blurb: 'STUDY · Moving content. Sweep FLOW : left (interruption) stutters (frame-holds, breakup, blank stabs); right (flow) softens to a liquid image.',
    world: 'incongruent',
    palette: [K, [0.18, 0.14, 0.24, 1], [0.75, 0.78, 0.85, 1]],
    sources: ['particle-drift', 'murmuration'],
    layerFx: ['fx-grade'],
    blends: ['screen'], layers: [2, 2], useB: 0
  }),
  mk({
    id: 'test-super', name: 'Superimposition', family: 'Feel Studies',
    blurb: 'STUDY · Three distinct layers. Sweep SUPERIMPOSITION : a hypnagogic strobe cross-cuts which single layer shows each drawn frame.',
    world: 'synthetic',
    palette: [K, [0.5, 0.3, 0.2, 1], [0.2, 0.5, 0.6, 1], [0.85, 0.85, 0.5, 1]],
    sources: ['shapes', 'op-art', 'contour', 'grid-drift'],
    layerFx: ['fx-grade'],
    blends: ['screen', 'lighten'], layers: [3, 3], useB: 0, superFlicker: 0.4
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
