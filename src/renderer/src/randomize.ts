// Randomize : the Rhodopsin button, done right (brief §7). STRUCTURAL:
// each scope doesn't just re-roll parameters, it (re)builds its targets —
// picks generators per layer, builds FX racks of random length, enables a
// random number of modulators and rolls a fresh mod-matrix. One press =
// a new instrument state (and one undo step).
//
// Taste guardrails: every float draw comes from the shader's CURATED
// aesthetic sub-range; colors stay matte (bounded S/V); Interference-style
// risks are pre-bounded in the registry; the mod-matrix respects its cap.

import type {
  BackgroundState,
  CompositionState,
  FxInstance,
  FxScope,
  LayerMask,
  LayerState,
  LfoShape,
  ModAssignment,
  ModCurve,
  ModTarget,
  ModulatorConfig,
  ModulatorType,
  SidechainRef,
  SourceSlot
} from '@shared/types'
import { AUTO_MOD_BUDGET, WORLD_AUTOMOD_SLOT } from '@shared/types'
import { curatedRange, FX_SHADERS, GENERATORS, NATIVE_NODES } from './shaders/isf'
import { inputsForShader, type IsfInputDesc } from './shaders/isf/inputs'
import { isWorldRow, worldModIndex } from './worlds'
import { BG_SOURCES, BG_DEFAULT_SPEED } from './bgPresets'
import type { MotionRecipe } from './themes'
import { randomSteps } from './engine/stepSeq'
import { shapeCurve } from './engine/modulation'
import { DICE_LOOP_RECIPES, type LoopRecipe } from './loopRecipes'

export type RandomizeScope =
  | 'all'
  | 'sources'
  | 'sourceparams'
  | 'sourcefx'
  | 'sourcefxonly' // rebuild ONLY the source FX racks (keep sources)
  | 'layerfxonly' // rebuild ONLY the per-layer FX racks
  | 'layer'
  | 'master'
  | 'finishing' // re-roll the three finalizers' params (Vibe/Context/Finalizer)
  | 'modulators'
  | 'meta' // handled in the UI layer (needs the knob smoother), not here
  | 'sonify' // handled in the UI layer (drives the sound engine), not here

const rnd = (): number => Math.random()
const range = (lo: number, hi: number): number => lo + rnd() * (hi - lo)

// Brightness-critical finalizer params, held to tight NEUTRAL bands during a
// Finishing randomize so the master output can't crush to black or blow out.
// Everything else on these shaders (tints, split-tone, posterize, saturation,
// dither, sharpen, blur, trails, atmosphere hue) still randomizes freely.
const FINISHING_SAFE: Record<string, Record<string, [number, number]>> = {
  'fx-finalizer': {
    black: [0.0, 0.04], // small shadow lift only : never a hard crush
    white: [0.95, 1.0], // stay near full white : never dim the highlights
    gamma: [0.9, 1.15], // gentle either way
    rGain: [0.92, 1.1], // near-unity per-channel gain (mild tint, stable luma)
    gGain: [0.92, 1.1],
    bGain: [0.92, 1.1],
    alpha: [1.0, 1.0]
  },
  'fx-vibe': {
    gamma: [0.9, 1.15],
    contrast: [0.9, 1.25],
    autoLevel: [0.0, 0.5] // auto-levels normalizes : safe, but keep it moderate
  },
  'fx-context': {
    bloom: [0.0, 0.35], // capped so highlights don't bloom to white
    lightGlow: [0.0, 0.2],
    haze: [0.0, 0.28], // haze washes toward its colour : keep it light
    depth: [0.0, 0.5], // depth vignette darkens edges : cap it
    voidEdge: [0.0, 0.35] // the void eats the frame : keep a dice-roll shallow
  }
}
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]
const chance = (p: number): boolean => rnd() < p
const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

// Restrained color register: any hue, bounded saturation/value : matte.
function randomColor(alpha: number): number[] {
  return hsv(rnd() * 360, range(0.35, 0.85), range(0.45, 0.9), alpha)
}
function hsv(h: number, s: number, v: number, alpha: number): number[] {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [r + m, g + m, b + m, alpha]
}

// ── Parameter draws (curated) ─────────────────────────────────────────
function randomizeOneInput(
  shaderId: string,
  d: IsfInputDesc,
  current: number | number[] | undefined
): number | number[] {
  switch (d.type) {
    case 'float': {
      const declared: [number, number] = [
        typeof d.min === 'number' ? d.min : 0,
        typeof d.max === 'number' ? d.max : 1
      ]
      const [lo, hi] = curatedRange(shaderId, d.name, declared)
      // A collapsed curated span means "never randomized" : keep the value.
      if (lo === hi) return typeof current === 'number' ? current : typeof d.def === 'number' ? d.def : lo
      return range(lo, hi)
    }
    case 'event':
      // Momentary triggers : never randomized (a dice must not leave one stuck ON).
      return typeof current === 'number' ? current : typeof d.def === 'number' ? d.def : 0
    case 'bool': {
      const cur = typeof current === 'number' ? current : typeof d.def === 'number' ? d.def : 0
      // Respect a curated pin (e.g. [0,0]) : a collapsed span means "never
      // randomized", so the dice leaves the value alone (it used to FORCE the
      // pinned value, e.g. switching a deliberate output shape off).
      const [blo, bhi] = curatedRange(shaderId, d.name, [0, 1])
      if (blo === bhi) return cur
      return chance(0.3) ? (cur >= 0.5 ? 0 : 1) : cur
    }
    case 'long': {
      const values = d.values ?? []
      if (values.length === 0)
        return typeof current === 'number' ? current : ((d.def as number) ?? 0)
      const cur = typeof current === 'number' ? current : ((d.def as number) ?? values[0])
      // Restrict the pickable VALUES to the curated span (e.g. fx-finalizer
      // outShape [0,0] "never randomized", fx-transform.shape, fx-wide-time.mode).
      const declared: [number, number] = [Math.min(...values), Math.max(...values)]
      const [lo, hi] = curatedRange(shaderId, d.name, declared)
      if (lo === hi) return cur // pinned : never randomized, keep the choice
      const allowed = values.filter((v) => v >= lo && v <= hi)
      const pool = allowed.length ? allowed : values
      if (pool.length === 1) return pool[0]
      return chance(0.4) ? pick(pool) : cur
    }
    case 'color': {
      const cur = Array.isArray(current) ? current : Array.isArray(d.def) ? d.def : [1, 1, 1, 1]
      return randomColor(cur[3] ?? 1)
    }
    case 'point2D': {
      const min = Array.isArray(d.min) ? d.min : [0, 0]
      const max = Array.isArray(d.max) ? d.max : [1, 1]
      return [range(min[0], max[0]), range(min[1], max[1])]
    }
    default:
      return current ?? 0
  }
}

/** Randomize every input of one shader within curated ranges : used by
 *  Randomize scopes and by the Inspector's ⚄ button. */
// Params Randomize must never touch (like the Text source): the Context PBR
// surface is a deliberate staging decision, not a texture to dice-roll. Context's
// blur is the user's alone : no dice, no Variation, no New / Generate / World
// ever sets it (it stays 0 unless moved by hand).
// Film damage is a deliberate "worn print" choice too : since it no longer waits
// for Film Hold, a dice roll would leave every Finishing randomize dirty.
const RANDOMIZE_SKIP: Record<string, RegExp> = {
  // Key : what it keys is the show's (the cloth's color, the channel, the views)
  'fx-key': /^(color|mode|channel|invert|showMatte)$/,
  'fx-context': /^(pbr|lightOrder$|blur$)/,
  // Finalizer staging intent : anaglyph 3D, the film-hold / draw clock, leader
  // blanks and splices, film damage and the output shape are deliberate show
  // decisions (a dice used to turn 3D on a quarter of the time and freeze the
  // picture). The grade, grain and character still roll.
  'fx-finalizer': /^(film|stereo|out)/,
  // Vibe : a chord REPLACES the ramped stops, so the dice leaves the harmony mode
  // where the user put it (the stops still roll as one ramp).
  'fx-vibe': /^harmony$/,
  // Text : the crawl, fitting, typewriter reveal and line-cue mode are staging
  // intent (a dice must not start a ticker or hide the words).
  'gen-text': /^(scroll|fit|reveal|lines)$/,
  // Audio : the volume and the pitch are the sound's, the view is staging.
  'gen-audio': /^(volume|keepPitch|view|window)$/,
  // Dark grounds : a mid-bright random color would lose the near-black paper.
  'direct-marks': /^paper$/,
  // Black and white with one accent : the accent rolls, the ink and the
  // ground stay the white mark on its near-black ground.
  'lowercase': /^(ink|ground)$/,
  // Points of light on a dark ground : the field stays a white dot on near-black.
  'gen-lattice': /^(ink|ground)$/,
  // Marbling : a palette and its water are chosen together (its presets), six
  // hues rolled apart would clash.
  'gen-marble': /^(color[1-6]|water)$/,
  // Sand Plate : the sand and its plate are chosen with the surface (its presets).
  'gen-sandplate': /^(sand|plate)$/,
  // Fur : a coat's colors go together (its presets).
  'gen-fur': /^(tip|root|skin|markColor)$/,
  // Relief : its colors and ground go together (its presets).
  'gen-relief': /^(color[1-5]|ground|edgeColor)$/,
  // Noise : matte, never plasma. Focus is a blur (by hand only), the map, the
  // key, the seamless repeat and the tempo lock are uses, not looks, and the
  // tint stays the preset's.
  noise: /^(focus|field|key|seamless|sync|tint)$/,
  // Morphogen : the ink goes with its preset.
  'node-reaction': /^ink$/,
  'sync-osc': /^loA$/,
  // Frame-store tricks : the tempo sync and the flip clock (a strobe if a dice
  // set it racing), Crawl's ground (clear hides the picture under it) and Store
  // Zoom's mirror and endless scroll are staging, set by hand.
  'fx-shatter': /^(sync|flip)$/,
  'fx-crawl': /^ground$/,
  'fx-store-zoom': /^(mirror|scrollX|scrollY)$/,
  // Feedback Zoom : a rolled center can land the tunnel in a corner; the dice
  // rolls `drift` instead, which lets the center wander on its own.
  'fx-feedback-zoom': /^center$/
}

// What the walk, Variation and a random modulator never move, though a full roll
// deals it : inputs that re-cut or re-wind the whole picture in one frame when
// nudged (Break's pane and its pace, Droste's winding and the center put there by
// hand). The themes' motion skips the same (Broken Glass, Endless Spiral).
const NUDGE_SKIP: Record<string, RegExp> = {
  'fx-break': /^(every|sync|after|time|shards|rings)$/,
  'fx-droste': /^(strands|arms|shape|cx|cy)$/
}

// Solid Color : one rolled hue drives the whole gradient (a dark end tinted
// with it, the hue itself mid-way, a pale end), so a dice never lands on
// three clashing hues.
function deriveGradient(out: Record<string, number | number[]>): void {
  const b = out.colB
  if (!Array.isArray(b)) return
  out.colA = [b[0] * 0.12, b[1] * 0.12, b[2] * 0.12, b[3] ?? 1]
  out.colC = [b[0] + (1 - b[0]) * 0.55, b[1] + (1 - b[1]) * 0.55, b[2] + (1 - b[2]) * 0.55, b[3] ?? 1]
}

export function randomizeInputs(
  shaderId: string,
  current: Record<string, number | number[]>
): Record<string, number | number[]> {
  const out: Record<string, number | number[]> = { ...current }
  const skip = RANDOMIZE_SKIP[shaderId]
  for (const d of inputsForShader(shaderId)) {
    if (skip?.test(d.name)) continue
    out[d.name] = randomizeOneInput(shaderId, d, current[d.name])
  }
  if (shaderId === 'solid-color') deriveGradient(out)
  const derive = DERIVED_COLORS[shaderId]
  if (derive) derive(out, skip)
  return out
}

// One rolled hue for a whole ramp : the dark end stays near-black (the house
// ground), the middle carries the accent, the top goes pale. Independent
// mid-bright hues used to lift the blacks and clash (Palette is auto-appended to
// a third of random master racks).
function ramp(out: Record<string, number | number[]>, keys: string[], skip?: RegExp): void {
  const h = rnd() * 360, sat = range(0.4, 0.8)
  const n = keys.length
  keys.forEach((k, i) => {
    if (skip?.test(k)) return
    const t = n > 1 ? i / (n - 1) : 0.5
    const a = Array.isArray(out[k]) ? (out[k] as number[])[3] ?? 1 : 1
    // value climbs from near-black to pale; saturation eases off at both ends
    const v = 0.04 + 0.9 * Math.pow(t, 0.85)
    const sv = sat * (t < 0.5 ? 0.6 + 0.8 * t : 1.4 - 0.9 * t)
    out[k] = hsv((h + (t - 0.5) * 24 + 360) % 360, Math.max(0, Math.min(1, sv)), v, a)
  })
}
const tinted = (sLo: number, sHi: number, vLo: number, vHi: number) =>
  (out: Record<string, number | number[]>, k: string): void => {
    const a = Array.isArray(out[k]) ? (out[k] as number[])[3] ?? 1 : 1
    out[k] = hsv(rnd() * 360, range(sLo, sHi), range(vLo, vHi), a)
  }
const DERIVED_COLORS: Record<string, (out: Record<string, number | number[]>, skip?: RegExp) => void> = {
  'fx-palette': (o, sk) => ramp(o, ['colorA', 'colorB', 'colorC', 'colorD', 'colorE'], sk),
  'fx-colorizer': (o, sk) => ramp(o, ['low', 'mid', 'high'], sk),
  'fx-crawl': (o, sk) => ramp(o, ['colorA', 'colorB', 'colorC', 'colorD', 'colorE'], sk),
  'fx-vibe': (o, sk) => {
    ramp(o, ['colorA', 'colorB', 'colorC', 'colorD', 'colorE'], sk)
    tinted(0.04, 0.2, 0.45, 0.58)(o, 'shadowTint') // split-tone tints roam near neutral gray
    tinted(0.04, 0.2, 0.45, 0.58)(o, 'highTint')
  },
  'fx-context': (o) => {
    tinted(0.08, 0.35, 0.3, 0.62)(o, 'atmosphere') // haze tints the air : muted, never a bright wash
    tinted(0.04, 0.3, 0.85, 1.0)(o, 'lightColor') // a warm or cool near-white
  }
}

// ── Structural builders ───────────────────────────────────────────────
// Native generators (Text) stay out of the random pool : they need user intent
// (a string, a sidechain), so a random draw would just say "OPSIA" at strangers.
// Native engines that need nothing from the user (`dice` : Reaction, the
// organic engines) stay in, as their ISF forerunners were.
// The ray-marched volumes (Oil Cloud, Cloud Study) stay out of every dice too :
// each holds 60 fps alone, but dealt on several slots at once, or as the ground
// under four layers, at 4K or on the dome they would drop frames. They stay in
// the pickers, OSC and their Generate themes.
const HEAVY_GENERATORS = new Set(['oil-cloud', 'cloud-study'])
const RANDOM_GENERATORS = GENERATORS.filter((g) => (!g.native || g.dice) && !HEAVY_GENERATORS.has(g.id))
/** The sources the dice deal from : a body rule's source steps walk the same
 *  pool (actions.ts), so a gesture never lands on a source that needs you. */
export const DICE_SOURCES = RANDOM_GENERATORS
const BG_DICE_SOURCES = BG_SOURCES.filter((g) => !HEAVY_GENERATORS.has(g.id))
function randomSlot(): SourceSlot {
  const gen = pick(RANDOM_GENERATORS)
  return { kind: 'generator', shaderId: gen.id, inputs: randomizeInputs(gen.id, {}) }
}

function emptySlot(): SourceSlot {
  return { kind: 'none', shaderId: null, inputs: {} }
}

/** Draw a count from an explicit distribution (index = count). */
// How many effects a dealt rack gets : index = count, value = weight. One
// definition per rack, because every randomizer deals them (Randomize All, a
// layer's dice, its per-rack dice, the source + FX scope) and nine copies of
// the same arrays drifted the moment one was changed. All three reach FOUR.
// The shape is kept : the layer rack runs longest, source A sits between,
// source B (the second voice) is the lightest. An empty rack stays possible,
// just no longer close to half the time.
const SOURCE_A_RACK = [0.2, 0.3, 0.25, 0.15, 0.1]
const SOURCE_B_RACK = [0.25, 0.3, 0.25, 0.12, 0.08]
const LAYER_RACK = [0.15, 0.3, 0.27, 0.18, 0.1]

function drawCount(weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rnd() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return i
  }
  return weights.length - 1
}

// The convolution nodes are LAYER-FX only (they need a sidechain layer) and
// heavy, so they join the random pool only for the per-layer FX rack, capped to
// one per rack, each handed a random sidechain layer so they actually do work.
const CONV_NODE_IDS = ['node-convolve', 'node-transfert']
const CONV_NODES = NATIVE_NODES.filter((n) => CONV_NODE_IDS.includes(n.id))
// The self-contained native nodes need no sidechain, so they join the random pool
// for EVERY rack (not just layer FX). They're `native`, so they share the "≤1
// native node per rack" cap below. (node-parallax is excluded : inert without the
// Depth engine. The effects that take the preview's clicks and pinches, Ripple,
// Touch, Drape, stay hand-placed : dealt blind into the Master FX or a layer's
// rack they would take the pointer from a source played by hand, a Marbling, a
// Sand Plate, a Relief, a Fur, with nothing to say why : pointerInput.ts.)
const SELF_NODE_IDS = [
  'node-reponse', 'node-datamosh', 'node-feedback', 'node-chronoscan', 'node-sediment',
  'node-scanner', 'node-autocutter', 'node-eternalism', 'node-afterimage',
  'node-pulfrich', 'node-corrode', 'node-decimate', 'node-melt', 'node-faultline', 'node-ibfv', 'node-toile',
  // Sidechain recipes safe to draw blind (Remap and Matte can scramble or hide the
  // whole picture with an arbitrary sidechain, so they stay hand-placed).
  'node-lumablur', 'node-gooey', 'node-lookup'
]
const SELF_NODES = NATIVE_NODES.filter((n) => SELF_NODE_IDS.includes(n.id))
/** The effects a blind rack is dealt from (the convolution nodes join the layer rack). */
// Effects a blind dice never deals (they stay in the pickers, chains, themes and
// OSC) : Key cuts holes by a color it was never shown, and Droste folds the whole
// frame into one spiral, a deliberate move rather than a texture (dealt into six
// random scenes, 11-11 : over the busy textures a dice deals it vanished into
// them, and where it showed it took the whole layer : it plays when chosen).
const HAND_FX = new Set(['fx-key', 'fx-droste'])
const DICE_FX = (): typeof FX_SHADERS => FX_SHADERS.filter((f) => !HAND_FX.has(f.id))
export const DICE_FX_IDS = (): string[] => [...DICE_FX(), ...SELF_NODES].map((f) => f.id)
const randSidechain = (): SidechainRef => ({ kind: 'layer', layer: Math.floor(rnd() * 4) })

/** Build a rack of n DISTINCT random FX, each with randomized params.
 *  `includeConv` (layer FX only) also draws the convolution nodes. */
function randomRack(
  countWeights: number[],
  endWithColor = false,
  exclude: string[] = [],
  includeConv = false
): FxInstance[] {
  const n = drawCount(countWeights)
  const pool = [...DICE_FX(), ...SELF_NODES, ...(includeConv ? CONV_NODES : [])].filter((f) => !exclude.includes(f.id))
  const picked: typeof FX_SHADERS = []
  let convUsed = 0
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(rnd() * pool.length)
    const s = pool[idx]
    pool.splice(idx, 1)
    if (s.native) {
      if (convUsed >= 1) continue // heavy : at most one convolution node per rack
      convUsed++
    }
    picked.push(s)
  }
  // Master-rack habit: often close the chain with a unifying color pass.
  // Guarded so the rack never exceeds the requested maximum length.
  if (
    endWithColor &&
    n > 0 &&
    picked.length < countWeights.length - 1 &&
    chance(0.6) &&
    !picked.some((p) => p.id === 'fx-palette' || p.id === 'fx-grade')
  ) {
    picked.push(pick(FX_SHADERS.filter((f) => f.id === 'fx-palette' || f.id === 'fx-grade')))
  }
  return picked.map((s) => ({
    id: uid(),
    shaderId: s.id,
    enabled: true,
    inputs: randomizeInputs(s.id, {}),
    // A random sidechain layer when a convolution node lands, so it isn't inert.
    // Lookup is the exception : with no sidechain the layer is its own palette,
    // while a random (often dark or empty) layer would recolor it toward black.
    ...(s.native && s.id !== 'node-lookup' ? { sidechain: randSidechain() } : {})
  }))
}

// ── Modulators (structural) ───────────────────────────────────────────
const RAND_SHAPES: LfoShape[] = [
  'sine', 'triangle', 'square', 'sawtooth', 'rndStep', 'rndSmooth', 'spastic'
]
const RAND_CURVES: ModCurve[] = [
  'linear', 'easeIn', 'easeOut', 'sigmoid', 'smoothstep', 'step', 'gamma', 'sqrt'
]
// Weighted toward the continuously interesting types.
const TYPE_POOL: ModulatorType[] = [
  'lfo', 'lfo', 'lfo', 'sh', 'sh', 'chaos', 'chaos', 'random', 'slew', 'arp', 'ramp', 'adsr',
  'euclid', 'turing', 'cellular', 'steps'
]

// What steps (holds, then jumps) : a jump 8 times a second is a flicker, not a
// rhythm, so stepped clocks run on 1/4 to 2 bars (free : at most 1.5 Hz); smooth
// shapes keep 1/8 up and 4 Hz.
const STEPPED_TYPES = new Set<ModulatorType>(['sh', 'random', 'arp', 'euclid', 'turing', 'cellular', 'steps'])
const STEPPED_SHAPES = new Set<LfoShape>(['square', 'rndStep', 'spastic', 'sawtooth'])
function diceClock(type: ModulatorType, shape: LfoShape): Pick<ModulatorConfig, 'type' | 'shape' | 'sync' | 'rateHz' | 'divisionIdx'> {
  const stepped = STEPPED_TYPES.has(type) || (type === 'lfo' && STEPPED_SHAPES.has(shape))
  return {
    type,
    shape,
    sync: chance(0.35) ? 'bpm' : 'free',
    rateHz: Math.pow(10, range(Math.log10(0.05), Math.log10(stepped ? 1.5 : 4))),
    divisionIdx: Math.floor(range(stepped ? 5 : 4, stepped ? 10 : 9))
  }
}

function freshModulator(base: ModulatorConfig, enabled: boolean): ModulatorConfig {
  return {
    ...base,
    enabled,
    ...diceClock(pick(TYPE_POOL), pick(RAND_SHAPES)),
    curve: chance(0.5) ? pick(RAND_CURVES) : 'linear',
    ramp: { ...base.ramp, rampMs: range(500, 20000), curvePct: range(-80, 80), mode: 'loop' },
    adsr: {
      ...base.adsr,
      attackMs: range(50, 4000),
      decayMs: range(100, 4000),
      sustainMs: range(200, 8000),
      releaseMs: range(100, 6000),
      sustainLevel: range(0.3, 0.9),
      loop: true
    },
    arp: {
      steps: Math.floor(range(3, 13)),
      mode: pick(['up', 'down', 'upDown', 'random', 'drunk'] as const)
    },
    random: { distribution: range(0.2, 0.8) },
    sh: { ...base.sh, probability: range(0.5, 1), distribution: range(0.2, 0.8) },
    slew: {
      ...base.slew,
      riseMs: Math.pow(10, range(Math.log10(50), Math.log10(2000))),
      fallMs: Math.pow(10, range(Math.log10(50), Math.log10(2000)))
    },
    chaos: { r: range(3.5, 4) },
    euclid: { steps: Math.floor(range(8, 17)), pulses: Math.floor(range(2, 9)), decay: range(0.1, 0.6) },
    turing: { length: Math.floor(range(4, 13)), mutate: range(0.05, 0.4) },
    cellular: { rule: pick([30, 90, 110, 150]), cells: Math.floor(range(16, 33)) },
    // a short motif repeated with changes, a few rests, now and then a step on
    // some passes, on a chance or for the fill; mostly straight
    steps: randomSteps()
  }
}

/** Every modulatable float input in the current composition (source + FX). */
export function collectFloatTargets(c: CompositionState): ModTarget[] {
  const out: ModTarget[] = []
  const addFxTargets = (fx: FxInstance[], scope: FxScope): void => {
    for (const inst of fx) {
      if (!inst.shaderId) continue
      // What Randomize leaves to the hand (RANDOMIZE_SKIP : the output shape,
      // the film stage, blur…) is not handed to a random modulator either.
      const skip = RANDOMIZE_SKIP[inst.shaderId]
      for (const d of inputsForShader(inst.shaderId)) {
        if (d.type === 'float' && !skip?.test(d.name) && !NUDGE_SKIP[inst.shaderId]?.test(d.name)) out.push({ kind: 'fx', scope, instId: inst.id, input: d.name })
      }
    }
  }
  c.layers.forEach((l, li) => {
    if (l.sourceA.shaderId) {
      for (const d of inputsForShader(l.sourceA.shaderId)) {
        if (d.type === 'float') out.push({ kind: 'source', layer: li, slot: 'A', input: d.name })
      }
    }
    if (l.sourceB?.shaderId) {
      for (const d of inputsForShader(l.sourceB.shaderId)) {
        if (d.type === 'float') out.push({ kind: 'source', layer: li, slot: 'B', input: d.name })
      }
    }
    addFxTargets(l.sourceAFx, { kind: 'sourceA', layer: li })
    addFxTargets(l.sourceBFx, { kind: 'sourceB', layer: li })
    addFxTargets(l.fx, { kind: 'layer', layer: li })
  })
  // Context is deliberately excluded from random modulation targets : it's the
  // depth finalizer and too powerful to be re-rolled by the Randomizer.
  addFxTargets(c.master.filter((f) => f.shaderId !== 'fx-context'), { kind: 'master' })
  return out
}

/** The float targets a DICE may move (the random matrix, a random Macro bank) :
 *  never a seed or a flip (every swing would reshuffle or invert the whole frame,
 *  a strobe the flash limiter then grids), never the pinned finalizers (Vibe,
 *  Finalizer : the user's look, and the Finalizer's opacity fades the show). */
export function diceTargets(c: CompositionState): ModTarget[] {
  const lockedIds = new Set(c.master.filter((f) => f.locked).map((f) => f.id))
  return collectFloatTargets(c).filter(
    (t) =>
      !MOTION_SKIP.test('input' in t ? String(t.input) : '') &&
      !(t.kind === 'fx' && t.scope.kind === 'master' && lockedIds.has(t.instId))
  )
}

/** The span a target's curated (dice) range covers inside its declared range,
 *  0..1 : what a Macro knob position puts it in its tasteful zone. */
function curated01(c: CompositionState, t: ModTarget): [number, number] {
  let shaderId: string | null = null
  if (t.kind === 'source') {
    const l = c.layers[t.layer]
    shaderId = (t.slot === 'A' ? l?.sourceA : l?.sourceB)?.shaderId ?? null
  } else if (t.kind === 'fx') {
    const s = t.scope
    const arr =
      s.kind === 'master' ? c.master
        : s.kind === 'background' ? c.background?.fx
          : s.kind === 'layer' ? c.layers[s.layer]?.fx
            : s.kind === 'sourceA' ? c.layers[s.layer]?.sourceAFx
              : s.kind === 'sourceB' ? c.layers[s.layer]?.sourceBFx
                : c.layers[s.layer]?.loopFx
    shaderId = arr?.find((f) => f.id === t.instId)?.shaderId ?? null
  }
  if (!shaderId || !('input' in t)) return [0, 1]
  const d = inputsForShader(shaderId).find((x) => x.name === t.input)
  if (!d || d.type !== 'float') return [0, 1]
  const dl = typeof d.min === 'number' ? d.min : 0, dh = typeof d.max === 'number' ? d.max : 1
  if (dh <= dl) return [0, 1]
  const [lo, hi] = curatedRange(shaderId, d.name, [dl, dh])
  return [Math.max(0, (lo - dl) / (dh - dl)), Math.min(1, (hi - dl) / (dh - dl))]
}

/** A fresh Macro bank : each knob gets one to four destinations no other knob
 *  holds (two knobs on one input fight), from what a dice may move, and a
 *  position that puts every one of them inside its curated range (a knob maps
 *  over the whole declared range : a blind position threw a dozen inputs to
 *  their extremes at once). Turning the knob is where the extremes live. */
export function randomMetaKnobs(c: CompositionState): CompositionState['metaKnobs'] {
  const pool = diceTargets(c)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return c.metaKnobs.map((k) => {
    const want = 1 + drawCount([0.3, 0.35, 0.25, 0.1]) // 1..4
    const destinations: ModTarget[] = []
    let lo = 0, hi = 1
    for (let i = 0; i < pool.length && destinations.length < want; ) {
      const [a, b] = curated01(c, pool[i])
      const nlo = Math.max(lo, a), nhi = Math.min(hi, b)
      // only while the knob still has a usable zone where all of them sit well
      if (nhi - nlo >= 0.12 || destinations.length === 0) {
        destinations.push(pool[i])
        lo = destinations.length === 1 ? a : nlo
        hi = destinations.length === 1 ? b : nhi
        pool.splice(i, 1)
      } else i++
    }
    // The knob sends knobOut = min + (max - min) * curve(value) : a re-rolled knob
    // starts on the full range (its old range was set for its old destinations),
    // and the position is one whose CURVED output sits in the zone (a flipped or
    // steep curve would throw a plain position out of it).
    const value = destinations.length ? knobPosIn(k.curve, lo, hi) : rnd()
    return { ...k, destinations, value, min: undefined, max: undefined }
  })
}

/** A knob position whose curve(position) lands in [lo, hi] (at random among them;
 *  none : the one nearest the zone's middle). */
export function knobPosIn(curve: CompositionState['metaKnobs'][number]['curve'], lo: number, hi: number): number {
  const N = 1024
  const inZone: number[] = []
  let best = 0.5, bestD = Infinity
  const mid = (lo + hi) / 2
  for (let i = 0; i <= N; i++) {
    const p = i / N
    const o = shapeCurve(p, curve)
    if (o >= lo && o <= hi) inZone.push(p)
    const d = Math.abs(o - mid)
    if (d < bestD) { bestD = d; best = p }
  }
  if (!inZone.length) return best
  return inZone[Math.floor(rnd() * inZone.length)]
}

function targetKey(t: ModTarget): string {
  if (t.kind === 'source') return `src:${t.layer}:${t.slot}:${t.input}`
  if (t.kind === 'bgSource') return `bgsrc:${t.input}`
  if (t.kind === 'meta') return `meta:${t.knob}`
  if (t.kind === 'sonify') return `soni:${t.param}`
  if (t.kind === 'layer') return `lay:${t.layer}:${t.field}`
  if (t.kind === 'bg') return `bg:${t.field}`
  if (t.kind === 'dome') return `dome:${t.field}`
  if (t.kind === 'outx') return `outx:${t.field}`
  if (t.kind === 'world') return 'world:amount'
  if (t.kind === 'au') return t.slot ? `au:${t.slot}:${t.field}` : `au:${t.field}`
  if (t.kind === 'light') return `light:${t.fixture}:${t.field}`
  const s = t.scope
  return `fx:${s.kind === 'master' || s.kind === 'background' ? s.kind : `${s.kind}:${s.layer}`}:${t.instId}:${t.input}`
}

/** Does this target land on layer `li` (its sources or any of its racks)? */
function targetOnLayer(t: ModTarget, li: number): boolean {
  if (t.kind === 'source') return t.layer === li
  if (t.kind !== 'fx') return false
  const s = t.scope
  return s.kind !== 'master' && s.kind !== 'background' && s.layer === li
}

/** A modulator played by a value from the dataflou mesh (a glove axis mapped with
 *  its ◈) : Randomize leaves it and its bindings as they are, like the World's. */
const isMeshMod = (m: ModulatorConfig): boolean => m.type === 'controller' && !!m.mesh

/** Roll a fresh matrix: 1–2 assignments per enabled mod, capped, deduped.
 *  Then GUARANTEE MOTION : every layer with an active source gets at least one
 *  assignment — a random draw that leaves a layer untargeted reads as a static,
 *  lifeless scene (the "Randomize feels dead" report). */
function randomMatrix(c: CompositionState): ModAssignment[] {
  const targets = diceTargets(c)
  if (targets.length === 0) return []
  const out: ModAssignment[] = []
  const used = new Set<string>()
  const enabledMods: number[] = []
  c.modulators.forEach((m, mi) => {
    if (!m.enabled) return
    if (m.fromWorld) return // the World's audio routing : its own, whatever its slot
    if (isMeshMod(m)) return // played by a mesh value : its bindings are the performer's
    enabledMods.push(mi)
    const n = drawCount([0.1, 0.5, 0.4]) // 0..2 assignments per mod
    for (let i = 0; i < n; i++) {
      if (out.length >= AUTO_MOD_BUDGET) return
      const t = pick(targets)
      const key = `${mi}|${targetKey(t)}`
      if (used.has(key)) continue
      used.add(key)
      const sign = chance(0.25) ? -1 : 1
      // Randomize keeps the bipolar-swing feel it's always had → 'replace'.
      out.push({ id: uid(), mod: mi, target: t, depth: sign * range(0.2, 0.75), mode: 'replace' })
    }
  })
  // Coverage pass : hand every untargeted active layer one solid assignment.
  if (enabledMods.length > 0) {
    c.layers.forEach((l, li) => {
      if (out.length >= AUTO_MOD_BUDGET) return
      if (!l.sourceA.shaderId && !l.sourceB?.shaderId) return
      if (out.some((a) => targetOnLayer(a.target, li))) return
      const local = targets.filter((t) => targetOnLayer(t, li))
      if (local.length === 0) return
      for (let tries = 0; tries < 4; tries++) {
        const t = pick(local)
        const mi = pick(enabledMods)
        const key = `${mi}|${targetKey(t)}`
        if (used.has(key)) continue
        used.add(key)
        // A guaranteed-motion bond should be FELT : solid depth, mostly positive.
        const sign = chance(0.15) ? -1 : 1
        out.push({ id: uid(), mod: mi, target: t, depth: sign * range(0.35, 0.75), mode: 'replace' })
        break
      }
    })
  }
  return out
}

// ── Motion for a generated scene (Generate) ───────────────────────────
// A theme's MotionRecipe picks how many modulators move the scene and how they
// move; the bindings stay on the layers (sources and their racks), never the
// master, so the theme's color and finish hold. Every active layer gets at least
// one moving parameter, and a row is left free for the World's audio route.
// A seed jump reshuffles the whole picture, and a swept flip (Lowercase) inverts
// the whole frame on every swing : a strobe. Never bound by a theme.
const MOTION_SKIP = /seed|^flip$/i

/** The slot a fresh composition keeps for the World's audio route : the
 *  World's modulator when one is there, else M8, where its route lands first
 *  (a composition of yours reserves nothing : randomizeStructural). */
function worldKeep(c: CompositionState): number {
  const wm = worldModIndex(c)
  return wm >= 0 ? wm : WORLD_AUTOMOD_SLOT
}

export function themedMotion(c: CompositionState, recipe: MotionRecipe): CompositionState {
  const n = recipe.mods[0] + Math.floor(rnd() * (recipe.mods[1] - recipe.mods[0] + 1))
  if (n <= 0) return c
  const own = recipe.skip ? new RegExp(recipe.skip) : null
  const targets = collectFloatTargets(c).filter((t) => {
    const name = 'input' in t ? String(t.input) : ''
    return (
      !(t.kind === 'fx' && (t.scope.kind === 'master' || t.scope.kind === 'background')) &&
      !MOTION_SKIP.test(name) &&
      !(own && own.test(name))
    )
  })
  if (!targets.length) return c
  const keep = worldKeep(c)
  const slots = [0, 1, 2, 3, 4, 5, 6, 7].filter((s) => s !== keep)
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[slots[i], slots[j]] = [slots[j], slots[i]]
  }
  const chosen = slots.slice(0, Math.min(n, slots.length))
  const logRate = (): number =>
    Math.pow(10, range(Math.log10(recipe.rate[0]), Math.log10(recipe.rate[1])))
  const modulators = c.modulators.map((m, i): ModulatorConfig => {
    if (i === keep) return m
    if (!chosen.includes(i)) return { ...m, enabled: false }
    const mm: ModulatorConfig = {
      ...freshModulator(m, true),
      type: pick(recipe.types),
      shape: pick(recipe.shapes),
      sync: chance(recipe.bpm) ? 'bpm' : 'free',
      rateHz: logRate()
    }
    // Steps change the level on EVERY step : on 1/16 a theme's draw would be a
    // hard flicker (8 a second at 120 BPM). A theme's steps run on 1/8 or
    // slower, or slide (the plain dice may keep 1/16).
    if (mm.type === 'steps' && mm.sync === 'bpm' && mm.divisionIdx < 4) {
      if (chance(0.5)) mm.divisionIdx = 4 + Math.floor(rnd() * 2)
      else mm.steps = { ...mm.steps, glide: Math.max(mm.steps.glide, Math.round(range(0.2, 0.5) * 100) / 100) }
    }
    return mm
  })
  const cap = AUTO_MOD_BUDGET - 1 // room for the World's audio route
  const out: ModAssignment[] = []
  const used = new Set<string>()
  const bind = (mi: number, t: ModTarget): boolean => {
    const key = `${mi}|${targetKey(t)}`
    if (used.has(key) || out.length >= cap) return false
    used.add(key)
    const sign = chance(0.2) ? -1 : 1
    out.push({ id: uid(), mod: mi, target: t, depth: sign * range(recipe.depth[0], recipe.depth[1]), mode: 'replace' })
    return true
  }
  // Sources move the picture most : two draws in three land on one.
  const sources = targets.filter((t) => t.kind === 'source')
  const drawTarget = (): ModTarget => (sources.length && chance(0.66) ? pick(sources) : pick(targets))
  for (const mi of chosen) {
    const k = chance(0.5) ? 2 : 1
    for (let i = 0; i < k; i++) bind(mi, drawTarget())
  }
  // Every active layer moves.
  c.layers.forEach((l, li) => {
    if (!l.sourceA.shaderId && !l.sourceB?.shaderId) return
    if (out.some((a) => targetOnLayer(a.target, li))) return
    const local = targets.filter((t) => targetOnLayer(t, li))
    for (let tries = 0; tries < 4 && local.length; tries++) if (bind(pick(chosen), pick(local))) break
  })
  return { ...c, modulators, modMatrix: out }
}

// ── The scoped randomizer ─────────────────────────────────────────────
// Tasteful subset of the 15 modes for random draws (dodge/burn stay manual —
// they blow out too easily for the matte register).
const BLENDS = [
  'normal', 'add', 'subtract', 'multiply', 'screen', 'overlay', 'softlight',
  'hardlight', 'darken', 'lighten', 'difference', 'exclusion', 'wrap', 'lightercolor', '50add'
] as const
// The A/B source mix can also use the relation modes (Weave / Lumakey / the
// stateful Consume). They work on layers too, but a blind layer draw keeps to the
// per-pixel modes : a relation mode depends on what happens to sit below.
const MIX_BLENDS = [...BLENDS, 'weave', 'lumakey', 'consume'] as const
type Blend = (typeof MIX_BLENDS)[number]

// A layer's GROUND decides which modes it can carry over the stack below it.
// Measured (11-08 : every dice source alone, four curated draws each, the median
// pixel) : most draw light on near-black, the house ground; these give a lit one
// (median above 0.3) ...
const LIT_GROUND = new Set<string>([
  'gen-marble', 'gen-physarum', 'dye-field', 'gen-veins', 'scan', 'ground', 'solid-color',
  'gen-fur', 'mycelium', 'rgb-osc', 'gen-fluid', 'membrane', 'noise'
])
// ... and these a mid one (0.15 to 0.3).
const MID_GROUND = new Set<string>([
  'sync-osc', 'slit-scan', 'op-art', 'ramps', 'swell', 'interference', 'erosion', 'colony', 'drift-field'
])
type Ground = 'dark' | 'mid' | 'lit'
const groundOf = (s: SourceSlot | null | undefined): Ground =>
  !s?.shaderId ? 'dark' : LIT_GROUND.has(s.shaderId) ? 'lit' : MID_GROUND.has(s.shaderId) ? 'mid' : 'dark'
// Effects that light a layer's ground whatever its source draws : the prints lay
// it on paper, Thin Film turns it all to film, Threshold to two tones (line art
// through a Riso under an add blend washed the stack out to white).
const GROUND_FX: Record<string, (f: FxInstance) => Ground | null> = {
  'fx-riso': () => 'lit',
  'fx-thinfilm': () => 'lit',
  'fx-halftone': (f) => (f.inputs.mode === 3 ? null : 'lit'), // (3 : dots of light on black)
  'fx-dither': (f) => (f.inputs.color === 2 ? 'mid' : null), // (ink on paper)
  'fx-threshold': () => 'mid'
}
const RANK: Record<Ground, number> = { dark: 0, mid: 1, lit: 2 }
/** A layer's own picture : both its sources together, then what its effects do. */
function layerGround(l: LayerState): Ground {
  const a = groundOf(l.sourceA)
  let g: Ground = !l.sourceB?.shaderId ? a : a === groundOf(l.sourceB) ? a : 'mid'
  for (const f of [...l.sourceAFx, ...l.sourceBFx, ...l.fx]) {
    const lit = f.enabled !== false && f.shaderId ? GROUND_FX[f.shaderId]?.(f) : null
    if (lit && RANK[lit] > RANK[g]) g = lit
  }
  return g
}
// Over a BLACK ground these leave the stack below as it was (subtract takes
// nothing away where the layer is black) ...
const DARK_OK: readonly Blend[] = ['add', 'subtract', 'screen', 'lighten', 'difference', 'exclusion', 'wrap', 'lightercolor']
// ... a LIT ground needs the modes that multiply, darken, contrast or cover (an
// additive mode over a lit ground washes the stack out to white, 50 add included :
// past half its opacity it adds the whole layer on the faded stack), ...
const LIT_OK: readonly Blend[] = ['normal', 'multiply', 'darken', 'overlay', 'softlight', 'hardlight', 'difference', 'exclusion']
// ... a MID ground the ones that hold either way.
const MID_OK: readonly Blend[] = ['screen', 'lighten', 'difference', 'exclusion', 'overlay', 'softlight', 'lightercolor']
// Blind, every other pairing blacked or bleached the stack : 11 of 120 presses
// of Randomize All came out all black, nearly each through a multiply, darken,
// overlay, normal or 50 add on an upper layer drawing lines on black.
const OK_FOR: Record<Ground, readonly Blend[]> = { dark: DARK_OK, mid: MID_OK, lit: LIT_OK }
// The A/B mix (B is the top) may also use the relation modes, which hold either way.
const RELATION: readonly Blend[] = ['weave', 'lumakey', 'consume']
/** A blend for a layer above another, the one its ground can carry. */
const stackBlend = (l: LayerState): LayerState['blend'] => pick(OK_FOR[layerGround(l)]) as LayerState['blend']
/** The A/B mix : B over A, the same rule, or a relation mode. */
const mixBlend = (b: SourceSlot | null | undefined): LayerState['sourceBlend'] =>
  pick([...OK_FOR[groundOf(b)], ...RELATION]) as LayerState['sourceBlend']

/** After a deal : the first visible layer takes a stack-safe mode at a solid
 *  opacity (it sits on the background), every layer above it a mode its ground
 *  can carry, every A/B mix the same. Only a pairing that would black or bleach
 *  the stack is changed. */
// The first visible layer sits on the background : any of these over a dark ground;
// a lit one covers it (an additive one over a lit ground, on a tinted background,
// came out white), a mid one covers or lightens.
const BOTTOM_OK: Record<Ground, readonly string[]> = {
  dark: ['normal', 'add', 'screen', 'lighten'],
  mid: ['normal', 'screen', 'lighten'],
  lit: ['normal']
}
function safeStack(layers: LayerState[]): LayerState[] {
  const on = (l: LayerState): boolean => (!!l.sourceA.shaderId || !!l.sourceB?.shaderId) && !l.mute
  const fi = layers.findIndex(on)
  return layers.map((l, i) => {
    if (!on(l)) return l
    let out = l
    if (l.sourceB?.shaderId && ![...OK_FOR[groundOf(l.sourceB)], ...RELATION].includes(l.sourceBlend as Blend)) out = { ...out, sourceBlend: mixBlend(l.sourceB) }
    if (i === fi) {
      const ok = BOTTOM_OK[layerGround(out)]
      if (!ok.includes(out.blend)) out = { ...out, blend: pick(ok) as LayerState['blend'] }
      return { ...out, opacity: Math.max(out.opacity, 0.75) }
    }
    if (!OK_FOR[layerGround(out)].includes(out.blend as Blend)) out = { ...out, blend: stackBlend(out) }
    return out
  })
}

// Occasionally give a layer a spatial mask (mostly none). Keeps the register
// matte : gentle softness, generous shape size, so it windows rather than hides.
function randomMask(): LayerMask {
  const base: LayerMask = {
    mode: 0, invert: false, soft: 0.1, lumaLo: 0.2, lumaHi: 1,
    angle: 0, pos: 0.5, cx: 0.5, cy: 0.5, size: 0.4, aspect: 1, round: 1
  }
  if (!chance(0.15)) return base
  return {
    ...base,
    mode: pick([1, 2, 3]),
    invert: chance(0.3),
    soft: range(0.06, 0.3),
    lumaLo: range(0.1, 0.4),
    lumaHi: range(0.7, 1),
    angle: range(0, 6.283),
    pos: range(0.3, 0.7),
    cx: range(0.35, 0.65),
    cy: range(0.35, 0.65),
    size: range(0.3, 0.55),
    aspect: range(0.7, 1.5),
    round: pick([0, 1])
  }
}
// Activation odds by layer index : a full stack is possible, a duo is common.
const LAYER_ACTIVE_P = [0.95, 0.7, 0.45, 0.25]

/** Structural randomize of ONE layer (the layer dice / context-menu action):
 *  fresh source(s), fresh racks, blend/feedback : always active. OPACITY is the
 *  player's mix decision and survives the dice untouched. */
/** Re-roll ONE of a layer's three racks, leaving its sources and the other two
 *  alone. The weights are the ones randomizeSingleLayer uses, so a rack dealt
 *  on its own has the same character as one dealt with the whole layer : source
 *  racks stay short, the layer rack runs longer and may draw a convolution
 *  node (it is the only one that can host them). */
export function randomizeRack(which: 'A' | 'B' | 'layer'): FxInstance[] {
  if (which === 'A') return randomRack(SOURCE_A_RACK)
  if (which === 'B') return randomRack(SOURCE_B_RACK)
  return randomRack(LAYER_RACK, false, [], true)
}

/** A layer's loop for the dice : a third of the layers that feed back get a
 *  ready loop (loopRecipes.ts), the rest the plain trail. Never random values :
 *  in a loop they compound, and a dealt zoom of 1.3 empties the layer in a
 *  second. */
export function loopFromRecipe(r: LoopRecipe): Pick<LayerState, 'loopFx' | 'loopBlend' | 'feedbackAmount' | 'loopDelay' | 'loopSync'> {
  return {
    loopDelay: r.delay ?? 0,
    loopSync: r.sync ?? 0,
    loopFx: r.fx.map((f) => ({ id: uid(), shaderId: f.shaderId, enabled: true, inputs: { ...f.inputs }, ...(f.opacity !== undefined ? { opacity: f.opacity } : {}) })),
    loopBlend: r.blend,
    feedbackAmount: r.amount
  }
}
function randomLoop(feedback: boolean, amount: number, ground: Ground = 'dark'): Pick<LayerState, 'loopFx' | 'loopBlend' | 'feedbackAmount' | 'loopDelay' | 'loopSync'> {
  // The loops that brighten (lighten, screen : 0.7 to 0.96 of each pass back) were
  // made for light on black; over a lit or mid ground they climb to white in a
  // second (a Rise on Swell over Solid Color came out white). Those layers take the
  // mixing, keying, XOR and multiplying loops. (The most destructive glitch loops,
  // `dice: false`, are never dealt : DICE_LOOP_RECIPES.)
  const pool = ground === 'dark' ? DICE_LOOP_RECIPES : DICE_LOOP_RECIPES.filter((r) => r.blend !== 'lighten' && r.blend !== 'screen')
  if (feedback && chance(0.35) && pool.length) return loopFromRecipe(pick(pool))
  return { loopFx: [], loopBlend: 'mix', feedbackAmount: amount, loopDelay: 0, loopSync: 0 }
}

export function randomizeSingleLayer(l: LayerState): LayerState {
  const withB = chance(0.25)
  const feedback = chance(0.3)
  const A = randomSlot(), B = withB ? randomSlot() : null
  return {
    ...l,
    sourceA: A,
    sourceB: B,
    sourceAFx: randomRack(SOURCE_A_RACK),
    sourceBFx: withB ? randomRack(SOURCE_B_RACK) : [],
    fx: randomRack(LAYER_RACK, false, [], true),
    sourceMix: withB ? range(0.25, 0.75) : l.sourceMix,
    sourceBlend: withB ? mixBlend(B) : l.sourceBlend,
    blend: stackBlend({ ...l, sourceA: A, sourceB: B }),
    feedback,
    ...randomLoop(feedback, range(0.3, 0.8), layerGround({ ...l, sourceA: A, sourceB: B })),
    mute: false,
    mask: randomMask()
  }
}

/** Re-roll the Background slab (its own dice : the GLOBAL Randomize never
 *  touches the background: the ground stays put while the layers churn).
 *  Draws from the curated background source set; keeps opacity + speed +
 *  depth + blendMode (the user's framing of the ground survives the dice). */
export function randomizeBackground(cur: BackgroundState | undefined): BackgroundState {
  const gen = pick(BG_DICE_SOURCES)
  return {
    ...cur,
    source: { kind: 'generator', shaderId: gen.id, inputs: randomizeInputs(gen.id, {}) },
    fx: randomRack([0.45, 0.35, 0.2]),
    opacity: cur?.opacity ?? 1,
    speed: cur?.speed ?? BG_DEFAULT_SPEED
  }
}

/** A fresh "blank open" state: layer 1 gets random source(s) + FX (guaranteed
 *  at least one FX unit), the other three stay empty. A cold launch or the New
 *  button lands on a different living one-layer scene each time.
 *
 *  This path MUST carry the same guarantees as Randomize All (it used to skip
 *  them, which is why cold launches could land on a dead or black "first
 *  frame" : a static source, a dark blend over a dark background, and
 *  no modulation = a frozen-looking boot):
 *   - the seed source is never a static-by-design generator (Solid Color);
 *   - the layer sits directly on the background, so its blend is stack-safe
 *     and its opacity solid;
 *   - 2 modulators + a small matrix guarantee visible motion. */
const SEED_STATIC_GENS = new Set(['solid-color'])
export function seedRandomStart(base: CompositionState): CompositionState {
  let l0 = randomizeSingleLayer(base.layers[0])
  // Never seed on a static source : re-draw A until it's a living generator.
  for (let tries = 0; tries < 8 && SEED_STATIC_GENS.has(l0.sourceA.shaderId ?? ''); tries++) {
    l0 = { ...l0, sourceA: randomSlot() }
  }
  // Guarantee some treatment : never open on a bare, unprocessed source.
  if (l0.sourceAFx.length + l0.sourceBFx.length + l0.fx.length === 0) {
    l0 = { ...l0, sourceAFx: randomRack([0, 1]) } // exactly one
  }
  // The seed layer composites straight onto the Background : a dark blend there
  // is the classic black-window draw, so a stack-safe one. And the ground is part
  // of the picture : with one (New's random tint), the layer lets it show (it sat
  // under an opaque 'normal' and barely read) : mostly screen / lighten / add,
  // or 'normal' at an opacity that leaves it some air. With none, solid.
  // A seed drawing on a lit ground covers the tint instead (an additive mode
  // over both came out white), at an opacity that leaves the tint some air.
  const bgShows = !!base.background?.source.shaderId && (base.background.opacity ?? 1) > 0.05
  const g0 = layerGround(l0)
  if (bgShows) {
    const blend = (g0 === 'lit' ? 'normal' : pick(g0 === 'mid' ? ['screen', 'lighten', 'normal'] : ['screen', 'screen', 'screen', 'lighten', 'lighten', 'add', 'normal'])) as LayerState['blend']
    l0 = { ...l0, blend, opacity: blend === 'normal' ? 0.6 + Math.random() * 0.2 : Math.max(l0.opacity, 0.85) }
  } else {
    const ok = BOTTOM_OK[g0]
    if (!ok.includes(l0.blend)) l0 = { ...l0, blend: pick(ok) as LayerState['blend'] }
    l0 = { ...l0, opacity: Math.max(l0.opacity, 0.85) }
  }
  let next: CompositionState = {
    ...base,
    layers: base.layers.map((l, i) =>
      i === 0
        ? l0
        : {
            ...l,
            sourceA: emptySlot(),
            sourceB: null,
            sourceAFx: [],
            sourceBFx: [],
            fx: [],
            mute: false
          }
    )
  }
  // Guaranteed motion : two fresh modulators + a small matrix over the seeded
  // layer, so the boot scene breathes even when the generator itself is slow.
  const keep = worldKeep(next)
  const slots = [0, 1, 2, 3, 4, 5, 6, 7].filter((s) => s !== keep)
  const chosen = new Set([pick(slots), pick(slots)])
  next = {
    ...next,
    modulators: next.modulators.map((m, i) => (chosen.has(i) ? freshModulator(m, true) : m))
  }
  next = { ...next, modMatrix: randomMatrix(next) }
  return next
}

// How many effects a whole draw carries, all racks together (index = count).
// Measured on 120 presses of Randomize All : the racks dealt one by one
// stacked 13.5 effects on average (up to 25), and a picture through that many
// degrading passes went to mud or black about one press in three, and three-
// and four-layer draws dropped below 50 fps half the time. Most presses now
// carry four to eight; a dense one is still possible.
const DRAW_BUDGET = [0, 0, 0, 0.04, 0.1, 0.16, 0.2, 0.18, 0.13, 0.09, 0.06, 0.04]
// The master chain when the whole instrument is dealt (index = count) : it runs
// over everything, so it stays short; alone (Randomize Master FX) it may run long.
const MASTER_IN_ALL = [0.15, 0.3, 0.3, 0.17, 0.08]
const MASTER_ALONE = [0, 0.15, 0.25, 0.25, 0.18, 0.1, 0.07]

/** Trim a dealt composition to `budget` effects : one at a time, from the
 *  fullest rack (the second voices' racks first, the master last), so no rack
 *  is emptied while another still holds several. Pinned units never go. */
function trimToBudget(c: CompositionState, budget: number): CompositionState {
  type Rack = { get: () => FxInstance[]; set: (fx: FxInstance[]) => void; weight: number }
  const layers = c.layers.map((l) => ({ ...l }))
  let master = c.master
  const racks: Rack[] = []
  layers.forEach((l) => {
    racks.push({ get: () => l.sourceBFx, set: (fx) => (l.sourceBFx = fx), weight: 1.3 })
    racks.push({ get: () => l.sourceAFx, set: (fx) => (l.sourceAFx = fx), weight: 1.1 })
    racks.push({ get: () => l.fx, set: (fx) => (l.fx = fx), weight: 1 })
  })
  racks.push({ get: () => master.filter((f) => !f.locked), set: (fx) => (master = [...fx, ...master.filter((f) => f.locked)]), weight: 0.8 })
  const count = (): number => racks.reduce((n, r) => n + r.get().length, 0)
  for (let guard = 0; count() > budget && guard < 64; guard++) {
    let best: Rack | null = null, bestScore = -1
    for (const r of racks) {
      const n = r.get().length
      if (!n) continue
      const s = n * r.weight + rnd() * 0.5
      if (s > bestScore) { bestScore = s; best = r }
    }
    if (!best) break
    const fx = best.get().slice()
    fx.splice(Math.floor(rnd() * fx.length), 1)
    best.set(fx)
  }
  return { ...c, layers, master }
}

function randomizeStructural(
  c: CompositionState,
  scope: RandomizeScope
): CompositionState {
  let next = c

  // Source PARAMETERS only : keep the chosen generators, re-roll their ISF
  // inputs within curated ranges (unlike 'sources', which picks new ones).
  // Text is never touched by a global Randomize (its string / font / layout are
  // user intent) : only its own Inspector ⚄ re-rolls it.
  const paramSlot = (s: SourceSlot | null): SourceSlot | null =>
    s && s.shaderId && s.shaderId !== 'gen-text'
      ? { ...s, inputs: randomizeInputs(s.shaderId, s.inputs) }
      : s
  if (scope === 'sourceparams') {
    return {
      ...c,
      layers: c.layers.map((l) => ({
        ...l,
        sourceA: paramSlot(l.sourceA) as SourceSlot,
        sourceB: paramSlot(l.sourceB)
      }))
    }
  }

  // A slot carries a real source (generator OR video/capture) : used to gate FX.
  const slotActive = (s: SourceSlot | null | undefined): boolean =>
    !!s && s.kind !== 'none' && (s.kind !== 'generator' || !!s.shaderId)

  // Source FX racks only : new random chains over whatever sources exist.
  if (scope === 'sourcefxonly') {
    return {
      ...c,
      // (a print or a film dealt under an additive blend : the blend made safe)
      layers: safeStack(c.layers.map((l) => ({
        ...l,
        sourceAFx: slotActive(l.sourceA) ? randomRack(SOURCE_A_RACK) : l.sourceAFx,
        sourceBFx: slotActive(l.sourceB) ? randomRack(SOURCE_B_RACK) : l.sourceBFx
      })))
    }
  }

  // Per-layer FX rack only.
  if (scope === 'layerfxonly') {
    return {
      ...c,
      layers: safeStack(c.layers.map((l) => ({
        ...l,
        fx: slotActive(l.sourceA) || slotActive(l.sourceB) ? randomRack(LAYER_RACK, false, [], true) : l.fx
      })))
    }
  }

  // Finishing : re-roll the three pinned finalizers' params (Vibe · Context ·
  // Finalizer). CONTROLLED: the brightness-critical params (levels, gamma,
  // gains, bloom, haze) are held in tight neutral bands so the result can never
  // come out crushed-black or blown-out : only the "look" params roam freely.
  if (scope === 'finishing') {
    return {
      ...c,
      master: c.master.map((f) => {
        if (!f.locked || !f.shaderId) return f
        const inputs = randomizeInputs(f.shaderId, f.inputs)
        const safe = FINISHING_SAFE[f.shaderId]
        if (safe) for (const [k, [lo, hi]] of Object.entries(safe)) inputs[k] = range(lo, hi)
        return { ...f, inputs }
      })
    }
  }

  const doSources = scope === 'all' || scope === 'sources' || scope === 'sourcefx'
  const doSourceFx = scope === 'all' || scope === 'sourcefx'
  const doLayer = scope === 'all' || scope === 'layer'
  const doMaster = scope === 'all' || scope === 'master'
  const doMods = scope === 'all' || scope === 'modulators'

  if (doSources || doSourceFx || doLayer) {
    let anyActive = false
    let layers: LayerState[] = next.layers.map((l, li) => {
      let layer = l
      if (doSources) {
        // STRUCTURAL: decide whether this layer plays at all, then pick its
        // generator(s) fresh. Feedback buffers survive either way (brief §1).
        const active = chance(LAYER_ACTIVE_P[li] ?? 0.3)
        if (active) {
          anyActive = true
          const withB = chance(0.25)
          const B = withB ? randomSlot() : null
          layer = {
            ...layer,
            sourceA: randomSlot(),
            sourceB: B,
            sourceBFx: withB ? layer.sourceBFx : [],
            sourceMix: withB ? range(0.25, 0.75) : layer.sourceMix,
            sourceBlend: withB ? mixBlend(B) : layer.sourceBlend,
            mute: false
          }
        } else {
          layer = { ...layer, sourceA: emptySlot(), sourceB: null, sourceAFx: [], sourceBFx: [] }
        }
      }
      if (doSourceFx) {
        layer = {
          ...layer,
          sourceAFx: layer.sourceA.shaderId ? randomRack(SOURCE_A_RACK) : [],
          sourceBFx: layer.sourceB?.shaderId ? randomRack(SOURCE_B_RACK) : []
        }
      }
      if (doLayer) {
        const hasSource = !!layer.sourceA.shaderId || !!layer.sourceB?.shaderId
        const feedback = hasSource ? chance(0.3) : false
        layer = {
          ...layer,
          fx: hasSource ? randomRack(LAYER_RACK, false, [], true) : [],
          blend: stackBlend(layer),
          opacity: range(0.55, 1),
          feedback,
          ...randomLoop(feedback, range(0.3, 0.8), layerGround(layer)),
          sourceMix: layer.sourceB?.shaderId ? range(0.2, 0.8) : layer.sourceMix,
          speed: range(0.5, 1.5), // gentle : extreme speeds are a manual move
          mask: hasSource ? randomMask() : layer.mask
        }
      }
      return layer
    })
    // Never randomize into a black or near-empty stage : guarantee at least
    // TWO active layers. A solo layer over the untouched background reads as
    // empty far too often (the "Randomize comes out black" report).
    if (doSources) {
      void anyActive
      const isOn = (l: LayerState): boolean => !!l.sourceA.shaderId || !!l.sourceB?.shaderId
      let need = 2 - layers.filter(isOn).length
      if (need > 0) {
        layers = layers.map((l) => {
          if (need > 0 && !isOn(l)) {
            need--
            return { ...l, sourceA: randomSlot(), sourceAFx: randomRack(SOURCE_A_RACK), mute: false }
          }
          return l
        })
      }
    }
    // The stack's FIRST visible layer sits directly on the background : a dark
    // blend there (multiply / darken / subtract...) is the classic black-window
    // draw; above it, a mode the layer's ground cannot carry blacks the stack.
    // Made safe at the end of the deal (after the effect budget : what the layer
    // ends up carrying counts too).
    next = { ...next, layers }
  }

  if (doMaster) {
    // Both pinned finalizers survive every randomize untouched : the Vibe
    // Palette is the user's look, and Context (depth) is too intense to re-roll.
    // Threshold is excluded from the MASTER pool: on a whole near-black
    // composition it can gate the entire output to black (the black-window
    // report); it stays available in layer/source racks where it carves. Edge
    // too : the edges of the whole picture are mostly black (one of the black
    // draws of the 11-08 sweep).
    const locked = next.master.filter((f) => f.locked)
    // The habit of closing the chain on a Palette or a Grade, only without the
    // Vibe : the Vibe Palette already unifies the color after it, and a second
    // ramp before it flattened the picture (the palette draws had the lowest
    // contrast of the 11-08 sweep).
    const vibeOn = locked.some((f) => f.shaderId === 'fx-vibe' && f.enabled !== false)
    next = {
      ...next,
      // Up to 8 distinct effects (index = count); peak around 3–4, long tail
      // out to a full 8-deep master chain.
      master: [
        ...randomRack(scope === 'all' ? MASTER_IN_ALL : MASTER_ALONE, !vibeOn, ['fx-threshold', 'fx-edge']),
        ...locked
      ]
    }
  }

  // The whole instrument dealt at once : a budget of effects over all its racks
  // (before the matrix, which binds what is left).
  if (scope === 'all') next = trimToBudget(next, drawCount(DRAW_BUDGET))
  // Then every blend the dealt layer cannot carry is made safe : whenever the dice
  // changed its sources, its blends or its racks (new sources under kept blends,
  // a Riso dealt under an add blend). Only those change.
  if (doSources || doSourceFx || doLayer) next = { ...next, layers: safeStack(next.layers) }

  if (doMods) {
    // STRUCTURAL: enable a random number of modulators (2–5), fully re-roll
    // them (type included), and roll a fresh capped matrix over whatever
    // sources/FX exist at this point.
    const enabledCount = 2 + drawCount([0.25, 0.35, 0.3, 0.1]) // 2..5
    // The World's audio modulator (its flag, whatever its slot) and the
    // bindings it installed are left out of the randomizer, so a World's bond
    // survives. Every other slot is yours to re-roll, M8 included.
    // A modulator played by the mesh is left too, with its bindings.
    const wm = worldModIndex(next)
    const was = next.modulators
    const keep = (i: number): boolean => i === wm || (!!was[i] && isMeshMod(was[i]))
    const slots = [0, 1, 2, 3, 4, 5, 6, 7].filter((s) => !keep(s))
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      ;[slots[i], slots[j]] = [slots[j], slots[i]]
    }
    const chosen = new Set(slots.slice(0, enabledCount))
    const worldRows = next.modMatrix.filter((a) => isWorldRow(next, a) || (a.mod !== wm && keep(a.mod)))
    const modulators = next.modulators.map((m, i) => (keep(i) ? m : freshModulator(m, chosen.has(i))))
    next = { ...next, modulators }
    next = { ...next, modMatrix: [...worldRows, ...randomMatrix(next)] }
  }

  return next
}

// ── Parameter JITTER (walk / variation) ───────────────────────────────
// Unlike the structural randomizer, jitter keeps the whole structure (which
// generators, which FX, which blends, which mod assignments) and only nudges
// CONTINUOUS values around where they already are. `amount` 0 = no change,
// 1 = a full-spread nudge (roughly the curated range). Shared by the Randomize
// intensity "walk" (low %) and the Variation button (baseline-anchored spread).
const clampN = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
const jn = (base: number, amount: number, span: number, lo: number, hi: number): number =>
  clampN(base + (rnd() * 2 - 1) * amount * span, lo, hi)

function jitterOneInput(
  shaderId: string,
  d: IsfInputDesc,
  base: number | number[] | undefined,
  amount: number,
  locked = false
): number | number[] {
  const keep = (): number | number[] => base ?? (d.def as number | number[] | undefined) ?? 0
  // The same "never touch" rules as a full Randomize : skipped inputs, pinned
  // curated spans, and on the locked finalizers their brightness-critical levels
  // and every switch (3D, film hold, output shape, surface) stay as set.
  if (RANDOMIZE_SKIP[shaderId]?.test(d.name) || NUDGE_SKIP[shaderId]?.test(d.name)) return keep()
  if (locked && (d.type === 'bool' || d.type === 'long' || FINISHING_SAFE[shaderId]?.[d.name])) return keep()
  if (d.type === 'float' || d.type === 'bool' || d.type === 'long') {
    const dl = typeof d.min === 'number' ? d.min : 0
    const dh = typeof d.max === 'number' ? d.max : d.type === 'long' && d.values?.length ? Math.max(...d.values) : 1
    const [lo, hi] = curatedRange(shaderId, d.name, [dl, dh])
    if (lo === hi) return keep()
  }
  switch (d.type) {
    case 'float': {
      const declaredLo = typeof d.min === 'number' ? d.min : 0
      const declaredHi = typeof d.max === 'number' ? d.max : 1
      const [lo, hi] = curatedRange(shaderId, d.name, [declaredLo, declaredHi])
      const b = typeof base === 'number' ? base : typeof d.def === 'number' ? d.def : lo
      return jn(b, amount, hi - lo, declaredLo, declaredHi)
    }
    case 'event':
      // Momentary triggers are never jittered (never leave one stuck ON).
      return typeof base === 'number' ? base : typeof d.def === 'number' ? d.def : 0
    case 'bool': {
      const cur = typeof base === 'number' ? base : typeof d.def === 'number' ? d.def : 0
      return chance(amount * 0.5) ? (cur >= 0.5 ? 0 : 1) : cur
    }
    case 'long': {
      const values = d.values ?? []
      const cur = typeof base === 'number' ? base : ((d.def as number) ?? values[0] ?? 0)
      return values.length && chance(amount * 0.4) ? pick(values) : cur
    }
    case 'color': {
      const c = Array.isArray(base) ? base : Array.isArray(d.def) ? d.def : [1, 1, 1, 1]
      // Nudge RGB within a matte envelope; hold alpha.
      return [
        clampN(c[0] + (rnd() * 2 - 1) * amount * 0.35, 0, 1),
        clampN(c[1] + (rnd() * 2 - 1) * amount * 0.35, 0, 1),
        clampN(c[2] + (rnd() * 2 - 1) * amount * 0.35, 0, 1),
        c[3] ?? 1
      ]
    }
    case 'point2D': {
      const min = Array.isArray(d.min) ? d.min : [0, 0]
      const max = Array.isArray(d.max) ? d.max : [1, 1]
      const b = Array.isArray(base) ? base : Array.isArray(d.def) ? d.def : [0, 0]
      return [
        jn(b[0], amount, max[0] - min[0], min[0], max[0]),
        jn(b[1], amount, max[1] - min[1], min[1], max[1])
      ]
    }
    default:
      return base ?? 0
  }
}

/** Nudge every input of one shader around its current value by `amount`. */
function jitterInputs(
  shaderId: string,
  base: Record<string, number | number[]>,
  amount: number,
  locked = false
): Record<string, number | number[]> {
  const out: Record<string, number | number[]> = { ...base }
  for (const d of inputsForShader(shaderId)) out[d.name] = jitterOneInput(shaderId, d, base[d.name], amount, locked)
  return out
}

function jitterSlot(slot: SourceSlot | null, amount: number): SourceSlot | null {
  // video/capture/hive/empty: nothing to nudge. Text: left to user intent.
  if (!slot || !slot.shaderId || slot.shaderId === 'gen-text') return slot
  return { ...slot, inputs: jitterInputs(slot.shaderId, slot.inputs, amount) }
}

function jitterFxArray(fx: FxInstance[], amount: number): FxInstance[] {
  return fx.map((f) => {
    if (!f.shaderId) return f
    // Locked finalizers (Vibe/Context) are brightness-critical : nudge gently.
    const amt = f.locked ? amount * 0.4 : amount
    return {
      ...f,
      inputs: jitterInputs(f.shaderId, f.inputs, amt, !!f.locked),
      opacity: clampN((f.opacity ?? 1) + (rnd() * 2 - 1) * amt * 0.3, 0, 1)
    }
  })
}

/** Nudge ONE layer around where it already sits : the per-layer form of
 *  Vary. Exported so a layer can be varied on its own, from its strip or
 *  from a modulator, without the whole composition moving with it. */
export function jitterLayer(l: LayerState, amount: number): LayerState {
  return {
    ...l,
    sourceA: jitterSlot(l.sourceA, amount) as SourceSlot,
    sourceB: l.sourceB ? jitterSlot(l.sourceB, amount) : l.sourceB,
    sourceAFx: jitterFxArray(l.sourceAFx, amount),
    sourceBFx: jitterFxArray(l.sourceBFx, amount),
    fx: jitterFxArray(l.fx, amount),
    opacity: clampN(l.opacity + (rnd() * 2 - 1) * amount * 0.3, 0, 1),
    sourceMix: clampN(l.sourceMix + (rnd() * 2 - 1) * amount * 0.3, 0, 1),
    harmony: clampN(l.harmony + (rnd() * 2 - 1) * amount * 0.3, -1, 1),
    feedbackAmount: clampN(l.feedbackAmount + (rnd() * 2 - 1) * amount * 0.3, 0, 1),
    speed: clampN(l.speed * (1 + (rnd() * 2 - 1) * amount * 0.4), 0, 20)
  }
}

function jitterMods(mods: ModulatorConfig[], amount: number): ModulatorConfig[] {
  return mods.map((m) => ({
    ...m,
    rateHz: clampN(m.rateHz * (1 + (rnd() * 2 - 1) * amount * 0.5), 0.01, 40)
  }))
}

// Which broad areas a scope disturbs : so the intensity walk only nudges the
// same parts the full randomize would have touched.
function scopeAreas(scope: RandomizeScope): { layers: boolean; master: boolean; mods: boolean } {
  return {
    layers:
      scope === 'all' ||
      scope === 'sources' ||
      scope === 'sourceparams' ||
      scope === 'sourcefx' ||
      scope === 'sourcefxonly' ||
      scope === 'layer' ||
      scope === 'layerfxonly',
    master: scope === 'all' || scope === 'master' || scope === 'finishing',
    mods: scope === 'all' || scope === 'modulators'
  }
}

/**
 * Randomize the composition for a scope at a given INTENSITY (0..1).
 *  - 1 (100%): the full structural randomize : new sources / FX / mods.
 *  - <1: a "random walk" : each unit keeps its structure with probability
 *    (1 − intensity) and is merely nudged (params jittered by `intensity`);
 *    otherwise it takes the fresh structural draw. Low % = a gentle drift from
 *    the current scene; high % approaches a full re-roll.
 */
export function randomizeComposition(
  c: CompositionState,
  scope: RandomizeScope,
  intensity = 1
): CompositionState {
  const target = randomizeStructural(c, scope)
  if (intensity >= 0.999) return target
  const p = Math.max(0, Math.min(1, intensity))
  const area = scopeAreas(scope)
  const mixed: CompositionState = {
    ...target,
    layers: area.layers
      ? c.layers.map((cl, i) => (chance(p) ? target.layers[i] : jitterLayer(cl, p)))
      : target.layers,
    master: area.master ? (chance(p) ? target.master : jitterFxArray(c.master, p)) : target.master,
    modulators: area.mods
      ? chance(p)
        ? target.modulators
        : jitterMods(c.modulators, p)
      : target.modulators,
    modMatrix: area.mods ? (chance(p) ? target.modMatrix : c.modMatrix) : target.modMatrix
  }
  // The per-layer coin-flip can keep a modMatrix from one structural roll while
  // the racks came from the other, leaving `fx`-kind rows pointing at instance
  // ids that aren't in the mixed comp : dead rows that eat the assignment cap
  // until modulation silently stops. Prune them, mirroring removeFx/dropTargets.
  const fxIds = new Set<string>()
  const collect = (arr?: FxInstance[]): void => arr?.forEach((f) => fxIds.add(f.id))
  collect(mixed.master)
  collect(mixed.background?.fx)
  for (const l of mixed.layers) {
    collect(l.fx)
    collect(l.sourceAFx)
    collect(l.sourceBFx)
    collect(l.loopFx)
  }
  const modMatrix = mixed.modMatrix.filter(
    (a) => a.target.kind !== 'fx' || fxIds.has(a.target.instId)
  )
  return modMatrix.length === mixed.modMatrix.length ? mixed : { ...mixed, modMatrix }
}

/**
 * VARIATION : a fresh variant of `base` at distance `amount` (0.001..1). Keeps
 * the entire structure fixed (same sources, FX, blends, mod assignments) and
 * nudges every continuous value around the baseline. Re-running with the same
 * baseline yields siblings at the same spread; larger amount = bolder variants.
 */
export function varyComposition(base: CompositionState, amount: number): CompositionState {
  const a = Math.max(0, Math.min(1, amount))
  return {
    ...base,
    bpm: Math.round(clampN(base.bpm * (1 + (rnd() * 2 - 1) * a * 0.15), 20, 800)),
    layers: base.layers.map((l) => jitterLayer(l, a)),
    master: jitterFxArray(base.master, a),
    modulators: jitterMods(base.modulators, a),
    modMatrix: base.modMatrix.map((m) => ({
      ...m,
      depth: clampN(m.depth + (rnd() * 2 - 1) * a * 0.3, -1, 1)
    })),
    metaKnobs: base.metaKnobs.map((k) => ({
      ...k,
      value: clampN(k.value + (rnd() * 2 - 1) * a * 0.25, 0, 1)
    }))
  }
}
