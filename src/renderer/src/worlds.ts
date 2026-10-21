// Worlds (diegesis) : editable, saveable presets. A World biases the whole
// composition when selected: every layer's A/B coupling character, a Context
// mood nudge, and an optional audio-routing default (an audio modulator in the
// first free slot from M8 down → a Context input). Vibe (the user's palette) is
// left alone.
//
// Context nudges stay inside the FINISHING-safe bands (bloom ≤ .35, haze ≤ .28,
// depth ≤ .5) so a World can never crush/blow the output. Built-ins ship here;
// user worlds live in the store (persisted to localStorage). Every World read
// from outside (storage, a session, a scene, the live code) goes through
// sanitizeWorld first.

import type {
  AudioFeature, CompositionState, CouplingMode, FxInstance, ModAssignment, ModulatorConfig, SceneClimate,
  SceneEntry, SceneTags, World, WorldAudioTarget
} from '@shared/types'
import { MAX_MOD_ASSIGNMENTS, WORLD_AUDIO_TARGETS, WORLD_AUTOMOD_SLOT } from '@shared/types'
import { makeDefaultModulator } from './engine/modulation'
import { AUDIO_FEATURES } from './engine/audioIn'
import { inputsForShader, type IsfInputDesc } from './shaders/isf/inputs'

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Auto-derive a scene's relation tags from its composition (editable after).
 *  Diégèse = saved World · Synchrèse = its layers' coupling modes · Espace-temps
 *  from mean visible opacity + Context haze/depth · Climat neutral (release). */
export function deriveSceneTags(scene: SceneEntry): SceneTags {
  const c = scene.composition
  const modes = Array.from(
    new Set(
      c.layers
        .map((l) => l.coupling?.mode)
        .filter((m): m is CouplingMode => !!m && m !== 'off')
    )
  )
  const vis = c.layers.filter((l) => !l.mute)
  const meanOpac = vis.length ? vis.reduce((a, l) => a + (l.opacity ?? 0), 0) / vis.length : 0.5
  const ctx = c.master.find((f) => f.shaderId === 'fx-context')?.inputs ?? {}
  const haze = typeof ctx.haze === 'number' ? ctx.haze : 0
  const depth = typeof ctx.depth === 'number' ? ctx.depth : 0
  // Fuller (low spaceTime) = high opacity + low haze; void (high) = sparse + hazy/deep.
  const spaceTime = clamp01(0.5 + (haze * 0.6 + depth * 0.4) * 0.5 - (meanOpac - 0.5) * 0.6)
  return {
    world: scene.world?.id ?? 'synthetic',
    synchresis: modes.length ? modes : ['lean'],
    spaceTime,
    climate: 'release'
  }
}

/** Suggest a Climat from a picture's palette (crossmodal colour→affect, after the
 *  colour-psychology results distilled in the NIME reading : warm+saturated reads
 *  aroused/unresolved, cool+muted reads eased, cool+bright+calm reads settled).
 *  warmth 0 cool..1 warm, saturation 0 grey..1 vivid, brightness 0 dark..1 light. */
export function climateFromColour(warmth: number, saturation: number, brightness: number): SceneClimate {
  if (saturation < 0.22) return 'release' // muted / grey : easing off, neutral
  if (warmth > 0.55) return brightness < 0.5 ? 'tension' : 'expectation' // warm+dark tense, warm+bright anticipating
  return brightness > 0.5 ? 'resolution' : 'release' // cool+bright settled, cool+dark eased
}

const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

export const BUILTIN_WORLDS: World[] = [
  {
    id: 'synthetic',
    name: 'Synthetic',
    builtin: true,
    blurb: 'Abstract concordance : audio leans the A/B texture (default).',
    coupling: { mode: 'lean', amount: 0.5, tightness: 0.7, feature: 'flux' },
    context: { trails: 0.22, bloom: 0.18, depth: 0.28, haze: 0.16 },
    autoMod: { feature: 'flux', target: 'haze', depth: 0.4 }
  },
  {
    id: 'parametric',
    name: 'Parametric',
    builtin: true,
    blurb: 'Data-mapped : transient cut, crisp and digital.',
    coupling: { mode: 'cut', amount: 0.8, tightness: 0.9, feature: 'transient' },
    context: { trails: 0.05, bloom: 0.05, depth: 0.15, haze: 0.03 },
    autoMod: { feature: 'transient', target: 'bloom', depth: 0.5 }
  },
  {
    id: 'musical',
    name: 'Musical',
    builtin: true,
    blurb: 'Visual reading of the music : pitch drifts the balance.',
    coupling: { mode: 'drift', amount: 0.6, tightness: 0.6, feature: 'pitch' },
    context: { trails: 0.2, bloom: 0.22, depth: 0.25, haze: 0.1 },
    autoMod: { feature: 'centroid', target: 'bloom', depth: 0.35 }
  },
  {
    id: 'incongruent',
    name: 'Incongruent',
    builtin: true,
    blurb: 'Independent voices : coupling off, detached.',
    coupling: { mode: 'off', amount: 0.5, tightness: 0.7, feature: 'level' },
    context: { trails: 0.15, bloom: 0.1, depth: 0.3, haze: 0.06 },
    autoMod: null
  },
  {
    id: 'sublimated',
    name: 'Sublimated',
    builtin: true,
    blurb: 'Mood over sync : warm, dreamy, gently level-led.',
    coupling: { mode: 'lean', amount: 0.3, tightness: 0.4, feature: 'level' },
    context: { trails: 0.35, bloom: 0.28, depth: 0.4, haze: 0.28 },
    autoMod: { feature: 'level', target: 'trails', depth: 0.45 }
  },
  {
    id: 'monomedia',
    name: 'Monomedia',
    builtin: true,
    blurb: 'Absence as tension : stark, near-black, uncoupled.',
    coupling: { mode: 'off', amount: 0.5, tightness: 0.7, feature: 'level' },
    context: { trails: 0.1, bloom: 0.0, depth: 0.5, haze: 0.0 },
    autoMod: null
  },
  // ── Cameraless / direct-film modes (spec §6). These bias the whole comp toward
  //    a hand-made-film reading; pick the sources to match (Op-Art marks for
  //    Griffé, an organic/feedback source for Peint, a scanned clip for Pressé).
  {
    id: 'griffe',
    name: 'Griffé',
    builtin: true,
    blurb: 'Graphic, rhythmic, tightly synced. Marks on the beat.',
    coupling: { mode: 'cut', amount: 0.85, tightness: 0.9, feature: 'transient' },
    context: { trails: 0.04, bloom: 0.06, depth: 0.12, haze: 0.02 },
    finalizer: {
      filmHold: 1, filmRate: 10, filmJitter: 0.2, filmBoil: 0.15, filmFlutter: 0.12,
      filmBlank: 0.35, filmBlankMode: 0, filmDust: 0.2, filmScratch: 0.3,
      filmGauge: 0, filmDirt: 0, filmGranule: 0, filmSplice: 0.05
    },
    autoMod: { feature: 'transient', target: 'bloom', depth: 0.4 }
  },
  {
    id: 'peint',
    name: 'Peint',
    builtin: true,
    blurb: 'Dense, gestural, silent. Dye, boil, granulation.',
    coupling: { mode: 'drift', amount: 0.6, tightness: 0.35, feature: 'level' },
    context: { trails: 0.2, bloom: 0.18, depth: 0.28, haze: 0.1 },
    finalizer: {
      filmHold: 1, filmRate: 6, filmJitter: 0.4, filmBoil: 0.6, filmFlutter: 0.4,
      filmBlank: 0.05, filmBlankMode: 2, filmDust: 0.3, filmScratch: 0.15,
      filmGauge: 1, filmDirt: 1, filmGranule: 0.6, filmSplice: 0.03
    },
    autoMod: null // "silent by conviction" : audio decoupled
  },
  {
    id: 'presse',
    name: 'Pressé',
    builtin: true,
    blurb: 'Pressed material. Heavy handling, scratch, dust.',
    coupling: { mode: 'drift', amount: 0.5, tightness: 0.5, feature: 'level' },
    context: { trails: 0.12, bloom: 0.1, depth: 0.35, haze: 0.08 },
    finalizer: {
      filmHold: 1, filmRate: 8, filmJitter: 0.35, filmBoil: 0.4, filmFlutter: 0.25,
      filmBlank: 0.08, filmBlankMode: 0, filmDust: 0.55, filmScratch: 0.6,
      filmGauge: 1, filmDirt: 0, filmGranule: 0.35, filmSplice: 0.08
    },
    autoMod: { feature: 'level', target: 'haze', depth: 0.3 }
  }
]

/** Context's blur is the user's alone : no World, theme or New sets it (a world
 *  saved before carried one). Every automatic Context write goes through this. */
export function sansBlur(ctx: Record<string, number | number[]>): Record<string, number | number[]> {
  const out = { ...ctx }
  delete out.blur
  return out
}

/** A fresh user world, cloned from an existing one (defaults to Synthetic). */
export function cloneWorld(src: World, name: string): World {
  return {
    id: uid(),
    name,
    builtin: false,
    blurb: src.blurb,
    coupling: { ...src.coupling },
    context: { ...src.context },
    finalizer: src.finalizer ? { ...src.finalizer } : undefined,
    autoMod: src.autoMod ? { ...src.autoMod } : null,
    layers: src.layers ? [...src.layers] : undefined
  }
}

/** The Context keys a World sets (its mood), in the editor's order, with what
 *  each does. Blur is never one (sansBlur). */
export const WORLD_CONTEXT_KEYS: Array<{ k: string; label: string; hint: string }> = [
  { k: 'trails', label: 'trails', hint: 'Temporal color bleed : past frames linger and drift into the distance.' },
  { k: 'bloom', label: 'bloom', hint: 'Highlights glow / bleed light : dreamier, more luminous.' },
  { k: 'depth', label: 'depth', hint: 'Vignette + aerial recession that seats the image in a volume.' },
  { k: 'haze', label: 'haze', hint: 'Atmospheric veil toward the atmosphere color : distance, air.' },
  { k: 'lightGlow', label: 'light', hint: 'The key light : a soft glow and its volumetric bloom.' },
  { k: 'voidEdge', label: 'void', hint: 'The frame\u2019s edges eaten toward black, ragged and breathing.' },
  { k: 'pbrAmount', label: 'material', hint: 'How much the picture lies on the surface material picked in Context.' }
]

/** The film character a World can carry (the Finalizer's film inputs) : what the
 *  editor shows, with their ranges. Absent from a World = film off. */
export const WORLD_FILM_KEYS: Array<{ k: string; label: string; min: number; max: number; step?: number; labels?: string[] }> = [
  { k: 'filmHold', label: 'hold', min: 0, max: 2, step: 1, labels: ['off', 'film-hold', 'freeze'] },
  { k: 'filmRate', label: 'draw fps', min: 1, max: 60, step: 1 },
  { k: 'filmJitter', label: 'timing', min: 0, max: 1 },
  { k: 'filmBoil', label: 'boil', min: 0, max: 1 },
  { k: 'filmFlutter', label: 'flutter', min: 0, max: 1 },
  { k: 'filmBlank', label: 'blanks', min: 0, max: 1 },
  { k: 'filmDust', label: 'dust', min: 0, max: 1 },
  { k: 'filmScratch', label: 'scratch', min: 0, max: 1 },
  { k: 'filmGranule', label: 'granulation', min: 0, max: 1 },
  { k: 'filmSplice', label: 'splice', min: 0, max: 1 }
]
// The film menus a World carries too (the built-ins do), outside the editor's rows.
const WORLD_FILM_MENUS = ['filmBlankMode', 'filmGauge', 'filmDirt']
// What a World without film puts back : the hold and the damage off.
const FILM_OFF: Record<string, number> = { filmHold: 0, filmDust: 0, filmScratch: 0 }
// A film is on in a composition when any of these marks it (the rest have
// non-zero defaults and say nothing by themselves).
const FILM_MARKS = ['filmHold', 'filmBlank', 'filmDust', 'filmScratch', 'filmGranule', 'filmSplice']

export const WORLD_COUPLING_MODES: CouplingMode[] = ['off', 'lean', 'hocket', 'cut', 'gate', 'drift']

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const num = (v: unknown, d: number): number => (finite(v) ? v : d)
const CONTEXT_DEFAULTS: Record<string, number> = { trails: 0.2, bloom: 0.3, depth: 0.35, haze: 0.15, lightGlow: 0.1, voidEdge: 0, pbrAmount: 0 }

// The inputs a World may set on its two stages, read from their ISF headers :
// every number on Context, the film* ones on the Finalizer (momentary triggers
// never). Read lazily (the shader table may still be loading when this module
// is), and kept once both are there.
type StageInputs = { ctx: Map<string, IsfInputDesc>; fin: Map<string, IsfInputDesc> }
let stageCache: StageInputs | null = null
function stageInputs(): StageInputs {
  if (stageCache) return stageCache
  const pick = (id: string, keep: (d: IsfInputDesc) => boolean): Map<string, IsfInputDesc> =>
    new Map(
      inputsForShader(id)
        .filter((d) => (d.type === 'float' || d.type === 'long' || d.type === 'bool') && keep(d))
        .map((d) => [d.name, d])
    )
  const got = { ctx: pick('fx-context', () => true), fin: pick('fx-finalizer', (d) => d.name.startsWith('film')) }
  if (got.ctx.size && got.fin.size) stageCache = got
  return got
}

/** How a World key reads on its stage (its range, whether it is a switch). */
export function worldKeyInput(shaderId: string | null, k: string): IsfInputDesc | undefined {
  const s = stageInputs()
  return shaderId === 'fx-context' ? s.ctx.get(k) : shaderId === 'fx-finalizer' ? s.fin.get(k) : undefined
}
/** A switch or a menu (film hold, gauge, dirt, blank leader) : it steps, never blends. */
export const isSwitchInput = (d: IsfInputDesc | undefined): boolean => !!d && (d.type === 'long' || d.type === 'bool')
/** A value brought inside what its input takes (a menu to one of its entries). */
export function fitToInput(d: IsfInputDesc | undefined, v: number): number {
  if (!d) return v
  if (d.type === 'bool') return v >= 0.5 ? 1 : 0
  if (d.type === 'long') {
    const r = Math.round(v)
    if (!d.values?.length) return r
    return Math.max(Math.min(...d.values), Math.min(Math.max(...d.values), r))
  }
  const lo = typeof d.min === 'number' ? d.min : -Infinity
  const hi = typeof d.max === 'number' ? d.max : Infinity
  return Math.max(lo, Math.min(hi, v))
}

/** A Context or Finalizer key as its stage reads it when the session holds
 *  none (the Finalizer's film defaults are its own : gauge 16 mm, 8 fps...). */
export function stageDefault(shaderId: string | null, k: string): number {
  if (shaderId === 'fx-context' && k in CONTEXT_DEFAULTS) return CONTEXT_DEFAULTS[k]
  const d = worldKeyInput(shaderId, k)
  return typeof d?.def === 'number' ? d.def : 0
}

/** The Context values a World writes when applied (blur never). */
export function worldContextValues(w: World): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(w.context ?? {})) if (k !== 'blur' && finite(v)) out[k] = v
  return out
}
/** The Finalizer values a World writes : the hold and the damage off as a
 *  baseline (so a non-film World clears drawn-film), then its film character. */
export function worldFilmValues(w: World): Record<string, number> {
  const out: Record<string, number> = { ...FILM_OFF }
  for (const [k, v] of Object.entries(w.finalizer ?? {})) if (finite(v)) out[k] = v
  return out
}

/** Which stage a World key is on (the mood on Context, the film on the
 *  Finalizer : the two never share a name). */
export function worldStageOf(k: string): 'fx-context' | 'fx-finalizer' | null {
  const s = stageInputs()
  return s.ctx.has(k) ? 'fx-context' : s.fin.has(k) ? 'fx-finalizer' : null
}

/** The change the World amount fades on `c` : what Apply stored, or (a
 *  composition from before it stored one) the World's values against the mood
 *  it found. */
export function worldShiftOf(c: CompositionState, world: World): Record<string, number> {
  if (c.worldShift) return c.worldShift
  const wb = c.worldBase ?? {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries({ ...worldContextValues(world), ...worldFilmValues(world) }))
    if (k in wb && Math.abs(v - wb[k]) > 1e-6) out[k] = v - wb[k]
  return out
}

/** These keys are no longer the World's (the film New strips, a theme's own
 *  Context) : nothing of them is left for the World amount to fade. */
export function dropWorldKeys(c: CompositionState, keys: Iterable<string>): CompositionState {
  if (!c.worldBase && !c.worldShift) return c
  const drop = new Set(keys)
  const keep = (r: Record<string, number> | undefined, keepEmpty: boolean): Record<string, number> | undefined =>
    r && sanitizeWorldBase(Object.fromEntries(Object.entries(r).filter(([k]) => !drop.has(k))), keepEmpty)
  return { ...c, worldBase: keep(c.worldBase, false), worldShift: keep(c.worldShift, true) }
}

/** A World made safe to use, wherever it was read from (the bank in storage, a
 *  session, a scene, the live code) : every number finite and inside what its
 *  input takes, the coupling and the audio routing well formed, the mood and the
 *  film only inputs their stages have. Null when it is not a World at all (no
 *  id). `fixed` collects what had to change, for the live-code editor. */
export function sanitizeWorld(raw: unknown, fixed?: string[]): World | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id) return null
  const note = (what: string): void => {
    if (fixed && !fixed.includes(what)) fixed.push(what)
  }
  const unit = (v: unknown, d: number, what: string, lo = 0, hi = 1): number => {
    if (!finite(v)) {
      note(what)
      return d
    }
    const c = Math.max(lo, Math.min(hi, v))
    if (c !== v) note(what)
    return c
  }
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

  // (an empty name stays : the name field is cleared while a new one is typed)
  let name = 'World'
  if (typeof o.name === 'string') name = o.name.slice(0, 80)
  else note('name')
  const blurb = typeof o.blurb === 'string' ? o.blurb.slice(0, 400) : ''

  if (!isObj(o.coupling)) note('coupling')
  const cp = isObj(o.coupling) ? o.coupling : {}
  let mode: CouplingMode = 'off'
  if (WORLD_COUPLING_MODES.includes(cp.mode as CouplingMode)) mode = cp.mode as CouplingMode
  else note('coupling.mode')
  let feature: AudioFeature = 'level'
  if (AUDIO_FEATURES.includes(cp.feature as AudioFeature)) feature = cp.feature as AudioFeature
  else note('coupling.feature')
  const coupling = {
    mode,
    amount: unit(cp.amount, 0.5, 'coupling.amount'),
    tightness: unit(cp.tightness, 0.7, 'coupling.tightness'),
    feature
  }

  // The mood and the film : only what the stage has, inside its range.
  const st = stageInputs()
  const stageValues = (v: unknown, inputs: Map<string, IsfInputDesc>, what: string): Record<string, number> => {
    const out: Record<string, number> = {}
    if (!isObj(v)) {
      if (v !== undefined && v !== null) note(what)
      return out
    }
    for (const [k, x] of Object.entries(v)) {
      const d = inputs.get(k)
      if (!finite(x) || (inputs.size && !d)) {
        note(`${what}.${k}`)
        continue
      }
      const f = fitToInput(d, x)
      if (f !== x) note(`${what}.${k}`)
      out[k] = f
    }
    return out
  }
  const context = stageValues(o.context, st.ctx, 'context')
  const film = stageValues(o.finalizer, st.fin, 'finalizer')
  const finalizer = Object.keys(film).length ? film : undefined

  let autoMod: World['autoMod'] = null
  if (isObj(o.autoMod)) {
    const am = o.autoMod
    if (!WORLD_AUDIO_TARGETS.includes(am.target as WorldAudioTarget)) note('autoMod.target')
    else {
      let f: AudioFeature = 'level'
      if (AUDIO_FEATURES.includes(am.feature as AudioFeature)) f = am.feature as AudioFeature
      else note('autoMod.feature')
      autoMod = { feature: f, target: am.target as WorldAudioTarget, depth: unit(am.depth, 0.4, 'autoMod.depth', -1, 1) }
    }
  } else if (o.autoMod !== null && o.autoMod !== undefined) note('autoMod')

  let layers: boolean[] | undefined
  if (Array.isArray(o.layers)) layers = [0, 1, 2, 3].map((i) => (o.layers as unknown[])[i] !== false)
  else if (o.layers !== undefined && o.layers !== null) note('layers')

  return {
    id: o.id,
    name,
    // Only a World this install ships is a built-in (one read from elsewhere is yours).
    builtin: o.builtin === true && BUILTIN_WORLDS.some((b) => b.id === o.id),
    blurb,
    coupling,
    context,
    finalizer,
    autoMod,
    layers
  }
}

/** A composition's `worldBase` / `worldShift` kept only as numbers (a session
 *  file can carry anything). Empty : dropped, unless `keepEmpty` (a shift with
 *  nothing in it still says the World changed nothing). */
export function sanitizeWorldBase(v: unknown, keepEmpty = false): Record<string, number> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: Record<string, number> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (finite(x)) out[k] = x
  return keepEmpty || Object.keys(out).length ? out : undefined
}

/** Which layers a World couples (L1..L4). */
export const worldLayers = (w: World): boolean[] => [0, 1, 2, 3].map((i) => w.layers?.[i] ?? true)

/** The modulator a World installed (its flag), -1 = none. */
export function worldModIndex(c: CompositionState): number {
  return c.modulators.findIndex((m) => m?.fromWorld)
}

/** The bindings a World installed with its modulator `i` : the ids it kept, or
 *  (flagged before it kept them) its rows on Context. */
function worldRowIds(c: CompositionState, i: number): Set<string> {
  const ids = c.modulators[i]?.worldRows
  if (Array.isArray(ids)) return new Set(ids.filter((x): x is string => typeof x === 'string'))
  const ctx = c.master.find((f) => f.shaderId === 'fx-context')
  return new Set(c.modMatrix.filter((a) => a.mod === i && a.target.kind === 'fx' && a.target.instId === ctx?.id).map((a) => a.id))
}

/** A binding the World installed (and the user has not made theirs since). */
export function isWorldRow(c: CompositionState, a: ModAssignment): boolean {
  return !!c.modulators[a.mod]?.fromWorld && worldRowIds(c, a.mod).has(a.id)
}

/** A session saved before a World flagged its modulator : slot 8 is the World's
 *  when it looks like one (on, audio, one binding, on a Context input a World
 *  routes to). Run once, when the session loads, and marked as read (an empty
 *  worldShift, which a session saved since carries); from then on only the flag
 *  counts, so a modulator of yours is never taken for the World's. */
export function adoptLegacyWorldMod(c: CompositionState): CompositionState {
  if (c.worldBase || c.worldShift || worldModIndex(c) >= 0) return c
  const read: CompositionState = { ...c, worldShift: {} }
  const i = WORLD_AUTOMOD_SLOT
  const m = c.modulators[i]
  const rows = c.modMatrix.filter((a) => a.mod === i)
  const ctx = c.master.find((f) => f.shaderId === 'fx-context')
  const row = rows[0]
  if (
    !m || !m.enabled || m.type !== 'audio' || rows.length !== 1 || !ctx ||
    row.target.kind !== 'fx' || row.target.instId !== ctx.id ||
    !WORLD_AUDIO_TARGETS.includes(row.target.input as WorldAudioTarget)
  )
    return read
  return { ...read, modulators: c.modulators.map((x, j) => (j === i ? { ...x, fromWorld: true, worldRows: [row.id] } : x)) }
}

/** Where a World's audio routing goes in `c` : the modulators and bindings once
 *  the World's earlier modulator is let go (only its own bindings removed; one
 *  that others still ride stays, as yours), the slot its modulator lands in
 *  (that same one when free, else the first free from M8 down; free = off and
 *  driving nothing), or why it can't. Apply and the editor's line share it, so
 *  what the line says is what Apply does. */
interface WorldRoute {
  modulators: ModulatorConfig[]
  modMatrix: ModAssignment[]
  slot: number // where the World's modulator goes, -1 = none
  old: number // the World's modulator before, -1 = none
  skip: string | null // why its routing could not go in
}
function routeWorld(c: CompositionState, world: World): WorldRoute {
  const old = worldModIndex(c)
  let matrix = c.modMatrix
  const modulators = c.modulators.slice()
  if (old >= 0) {
    const own = worldRowIds(c, old)
    matrix = matrix.filter((a) => !(a.mod === old && own.has(a.id)))
    const { worldRows: _rows, ...rest } = modulators[old]
    modulators[old] = matrix.some((a) => a.mod === old)
      ? { ...rest, fromWorld: false }
      : { ...makeDefaultModulator(), ...rest, enabled: false, fromWorld: false }
  }
  const out = (slot: number, skip: string | null): WorldRoute => ({ modulators, modMatrix: matrix, slot, old, skip })
  const am = world.autoMod
  if (!am || am.target === 'none') return out(-1, null)
  const ctx = c.master.find((f) => f.shaderId === 'fx-context')
  if (!ctx) return out(-1, 'no Context')
  const free = (i: number): boolean => !modulators[i]?.enabled && !matrix.some((a) => a.mod === i)
  let slot = old >= 0 && free(old) ? old : -1
  for (let i = WORLD_AUTOMOD_SLOT; slot < 0 && i >= 0; i--) if (free(i)) slot = i
  if (slot < 0) return out(-1, 'no free modulator (all 8 are yours)')
  // Never past the cap : a full matrix says so (the editor's line, a toast on apply).
  if (matrix.length >= MAX_MOD_ASSIGNMENTS)
    return out(-1, `the modulation is full (${MAX_MOD_ASSIGNMENTS} of ${MAX_MOD_ASSIGNMENTS} bindings), clear one and apply again`)
  const id = uid()
  modulators[slot] = {
    ...makeDefaultModulator(),
    type: 'audio',
    enabled: true,
    fromWorld: true,
    worldRows: [id],
    audio: { feature: am.feature, band: 0, smooth: 0.2 }
  }
  matrix = [
    ...matrix,
    { id, mod: slot, target: { kind: 'fx', scope: { kind: 'master' }, instId: ctx.id, input: am.target }, depth: num(am.depth, 0.4) }
  ]
  return out(slot, null)
}

/** Why applying `world` to `c` leaves its audio routing out (null = it goes in,
 *  or it has none). */
export function worldRouteSkip(c: CompositionState, world: World): string | null {
  return routeWorld(c, world).skip
}

/** Apply a World's bias to a composition : the coupling of the layers it picks,
 *  the Context mood, the film character, and its audio modulator in a free slot
 *  (replacing only what a World installed). The mood it finds is kept as
 *  `worldBase`, which the World amount blends from : for each key it sets, the
 *  value there now, unless that is still what the World before wrote, then the
 *  mood found before that one stays (so stepping through Worlds never forgets
 *  yours, and a key you moved since is found as you left it). What the World
 *  wrote is read from the composition itself (worldBase + worldShift); `prev`
 *  (the World it replaces) stands in for a composition from before the shift
 *  was kept. `worldShift` keeps what this World changes. Returns a new
 *  composition. */
export function applyWorldToComposition(c: CompositionState, world: World, prev?: World | null): CompositionState {
  const contextInst = c.master.find((f) => f.shaderId === 'fx-context')
  const finInst = c.master.find((f) => f.shaderId === 'fx-finalizer')
  const use = worldLayers(world)
  const ctxVals = worldContextValues(world)
  const filmVals = worldFilmValues(world)
  const was = c.worldBase ?? {}
  const prevVals = prev ? { ...worldContextValues(prev), ...worldFilmValues(prev) } : {}
  const wrote = (k: string): number | undefined =>
    !(k in was) ? undefined : c.worldShift ? was[k] + (c.worldShift[k] ?? 0) : prevVals[k]
  const base: Record<string, number> = {}
  const shift: Record<string, number> = {}
  const find = (inst: FxInstance, k: string, v: number): void => {
    const cur = num(inst.inputs[k], stageDefault(inst.shaderId, k))
    const before = wrote(k)
    base[k] = before !== undefined && Math.abs(cur - before) < 1e-6 ? was[k] : cur
    if (Math.abs(v - base[k]) > 1e-6) shift[k] = v - base[k]
  }
  if (contextInst) for (const k in ctxVals) find(contextInst, k, ctxVals[k])
  if (finInst) for (const k in filmVals) find(finInst, k, filmVals[k])
  const next: CompositionState = {
    ...c,
    worldBase: base,
    worldShift: shift,
    layers: c.layers.map((l, i) => (use[i] ? { ...l, coupling: { ...world.coupling } } : l)),
    master: c.master.map((f) => {
      if (f.shaderId === 'fx-context') return { ...f, inputs: { ...f.inputs, ...ctxVals } }
      if (f.shaderId === 'fx-finalizer') return { ...f, inputs: { ...f.inputs, ...filmVals } }
      return f
    })
  }
  // Audio routing : a World only ever replaces what a World installed.
  const route = routeWorld(next, world)
  return { ...next, modulators: route.modulators, modMatrix: route.modMatrix }
}

/** What applying `world` to `c` changes, line by line (the editor shows it
 *  under Apply). */
export function worldEffects(world: World, c: CompositionState): string[] {
  const out: string[] = []
  const use = worldLayers(world)
  const ls = use.map((u, i) => (u ? `L${i + 1}` : '')).filter(Boolean)
  const cp = world.coupling
  out.push(
    ls.length
      ? `coupling ${cp.mode}${cp.mode === 'off' ? '' : ` ${num(cp.amount, 0).toFixed(2)} on ${cp.feature}`} → ${ls.join(' ')}`
      : 'coupling : no layer'
  )
  const ctx = Object.entries(worldContextValues(world))
  if (ctx.length) {
    const label = (k: string): string => WORLD_CONTEXT_KEYS.find((x) => x.k === k)?.label ?? k
    out.push('Context ' + ctx.map(([k, v]) => `${label(k)} ${v.toFixed(2)}`).join(' · '))
  }
  const film = world.finalizer
  if (film && Object.keys(film).length) {
    const gran = num(film.filmGranule, 0)
    out.push(
      `film : hold ${['off', 'on', 'freeze'][Math.round(num(film.filmHold, 0))] ?? 'off'} · dust ${num(film.filmDust, 0).toFixed(2)} · scratch ${num(film.filmScratch, 0).toFixed(2)}` +
        (gran > 0 ? ` · granulation ${gran.toFixed(2)}` : '')
    )
  } else out.push('film off')
  const am = world.autoMod
  const r = routeWorld(c, world)
  if (am && am.target !== 'none') {
    if (r.skip) out.push(`audio routing skipped : ${r.skip}`)
    else
      out.push(
        `audio : M${r.slot + 1} ← ${am.feature} → ${am.target} ${num(am.depth, 0).toFixed(2)}` +
          (r.old < 0 ? ' (a free slot)' : r.old === r.slot ? ' (replaces the World\u2019s own)' : ` (a free slot; M${r.old + 1} stays yours)`)
      )
  } else out.push(r.old >= 0 ? 'no audio routing (the World\u2019s earlier one is removed)' : 'no audio routing')
  return out
}

/** A World's settings read back from a composition : the coupling of the first
 *  coupled layer (and which layers share it), the Context mood, the film
 *  character, the audio routing a World installed. The reverse of Apply. */
export function worldFromComposition(c: CompositionState): Pick<World, 'coupling' | 'context' | 'finalizer' | 'autoMod' | 'layers'> {
  const first = c.layers.find((l) => l.coupling && l.coupling.mode !== 'off') ?? c.layers[0]
  const coupling = { ...(first?.coupling ?? { mode: 'off' as const, amount: 0.5, tightness: 0.7, feature: 'level' as const }) }
  const layers = c.layers.slice(0, 4).map((l) => !!l.coupling && JSON.stringify(l.coupling) === JSON.stringify(coupling))
  const round = (v: number): number => Math.round(v * 1000) / 1000
  const ctxInst = c.master.find((f) => f.shaderId === 'fx-context')
  const context: Record<string, number> = {}
  for (const { k } of WORLD_CONTEXT_KEYS) context[k] = round(num(ctxInst?.inputs[k], CONTEXT_DEFAULTS[k] ?? 0))
  // The film, when anything marks it (a granulated film counts),
  // read whole : a key the session lacks is what the stage plays without it.
  const finInst = c.master.find((f) => f.shaderId === 'fx-finalizer')
  let finalizer: Record<string, number> | undefined
  if (finInst && FILM_MARKS.some((k) => num(finInst.inputs[k], 0) > 0)) {
    finalizer = {}
    for (const k of [...WORLD_FILM_KEYS.map((f) => f.k), ...WORLD_FILM_MENUS])
      finalizer[k] = round(num(finInst.inputs[k], stageDefault('fx-finalizer', k)))
  }
  // The routing a World installed, while it still is one : an audio modulator
  // driving a Context input a World can route to.
  let autoMod: World['autoMod'] = null
  const slot = worldModIndex(c)
  const m = slot >= 0 ? c.modulators[slot] : undefined
  if (m && m.type === 'audio' && m.audio && ctxInst) {
    const row = c.modMatrix.find(
      (a) =>
        a.mod === slot && a.target.kind === 'fx' && a.target.instId === ctxInst.id &&
        a.target.input !== 'none' && WORLD_AUDIO_TARGETS.includes(a.target.input as WorldAudioTarget)
    )
    if (row && row.target.kind === 'fx')
      autoMod = { feature: m.audio.feature, target: row.target.input as WorldAudioTarget, depth: Math.max(-1, Math.min(1, num(row.depth, 0.4))) }
  }
  return { coupling, layers, context, finalizer, autoMod }
}

/** A built-in edited this session differs from how it ships. */
export function builtinChanged(w: World): boolean {
  const o = BUILTIN_WORLDS.find((x) => x.id === w.id)
  if (!o) return false
  const pick = (x: World): string => JSON.stringify([x.name, x.blurb, x.coupling, x.context, x.finalizer ?? null, x.autoMod, worldLayers(x)])
  return pick(o) !== pick(w)
}
