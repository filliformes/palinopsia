// Zustand store : the renderer's single source of truth.
// Holds the theme (design system lifted from dataFLOU) and the live
// CompositionState (four layers + master rack + transport). The Compositor
// engine reads this on each frame; OSC / modulators mutate it through the
// same actions the UI uses, so there's one path for every parameter change.

import { create } from 'zustand'
import type {
  BackgroundState,
  BlendMode,
  CompositionState,
  FxInstance,
  FxScope,
  LayerCoupling,
  LayerMask,
  LayerState,
  ModAssignment,
  ModMode,
  ModTarget,
  ModulatorConfig,
  SceneEntry,
  SceneTags,
  SequenceState,
  Session,
  SidechainRef,
  SourceSlot,
  World
} from '@shared/types'
import type { MetaKnobState, MidiBinding } from '@shared/types'
import type { Assemblage, AssembleCorpus, AssembleParams } from '@shared/assemble'
import { defaultAssembleParams } from '@shared/assemble'
import { corpusMap } from './assemble/match'
import { MAX_MOD_ASSIGNMENTS, META_KNOB_COUNT, META_MAX_DESTS } from '@shared/types'
import { makeDefaultModulator, makeDefaultModulators } from './engine/modulation'
import { beginMorph, cancelMorph } from './morph'
import { defaultSoniConfig, sonifyEngine, type SoniConfig } from './audio/sonify'
import { resetCouplingState } from './engine/coupling'
import { applyWorldToComposition, BUILTIN_WORLDS, cloneWorld, deriveSceneTags } from './worlds'

// User worlds (builtin === false) persist to localStorage; built-ins ship in code.
function saveUserWorlds(worlds: World[]): void {
  try {
    localStorage.setItem('opsia.userWorlds', JSON.stringify(worlds.filter((w) => !w.builtin)))
  } catch {
    /* quota / serialization : non-fatal */
  }
}
function loadWorlds(): World[] {
  try {
    const u = JSON.parse(localStorage.getItem('opsia.userWorlds') || '[]')
    return [...BUILTIN_WORLDS, ...(Array.isArray(u) ? (u as World[]) : [])]
  } catch {
    return [...BUILTIN_WORLDS]
  }
}
// Add a World to the bank if its id isn't already present (session/scene
// restore of a world this install doesn't have). Persists user worlds.
function ensureWorld(worlds: World[], w: World | null | undefined): World[] {
  if (!w || worlds.some((x) => x.id === w.id)) return worlds
  const merged = [...worlds, w]
  saveUserWorlds(merged)
  return merged
}
function uniqueWorldName(worlds: World[], base: string): string {
  const names = new Set(worlds.map((w) => w.name))
  if (!names.has(base)) return base
  for (let i = 2; i < 999; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`
  return `${base} ${Date.now()}`
}
import {
  collectFloatTargets,
  randomizeBackground,
  randomizeComposition,
  randomizeInputs,
  randomizeSingleLayer,
  seedRandomStart,
  varyComposition,
  type RandomizeScope
} from './randomize'
import { BG_DEFAULT_SPEED, BG_SOURCES } from './bgPresets'
import { THEME_BY_ID, type Theme } from './themes'

export type { FxScope }

// ── Themes (lifted from dataFLOU; palettes live in styles.css) ────────
export type ThemeName =
  | 'nature'
  | 'studio-dark'
  | 'warm-charcoal'
  | 'graphite'
  | 'cream'
  | 'paper-light'
  | 'dark'
  | 'light'
  | 'pastel'
  | 'reaper'
  | 'smooth'
  | 'hydra'
  | 'darkside'
  | 'solaris'
  | 'flame'
  | 'analog'

export const THEME_ORDER: ThemeName[] = [
  'studio-dark',
  'warm-charcoal',
  'graphite',
  'nature',
  'cream',
  'paper-light',
  'dark',
  'hydra',
  'darkside',
  'solaris',
  'flame',
  'analog',
  'smooth',
  'reaper',
  'pastel',
  'light'
]

// Themes that opt into the bespoke "rich" UI surface (console-readout
// numerics, etc.). Consumed by BoundedNumberInput.
export const RICH_THEMES: ReadonlySet<ThemeName> = new Set<ThemeName>(['nature', 'cream'])
export function isRichTheme(t: ThemeName): boolean {
  return RICH_THEMES.has(t)
}

// Palinopsia's default: near-black canvas, one accent : restraint as
// identity (brief §1). Studio-dark is the neutral matte surface the
// instrument ships on out of the box.
const DEFAULT_THEME: ThemeName = 'studio-dark'

function loadTheme(): ThemeName {
  const saved = localStorage.getItem('opsia.theme') as ThemeName | null
  return saved && THEME_ORDER.includes(saved) ? saved : DEFAULT_THEME
}

function applyTheme(t: ThemeName): void {
  document.documentElement.setAttribute('data-theme', t)
}

// ── Composition factory ───────────────────────────────────────────────
const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

function emptySlot(): SourceSlot {
  return { kind: 'none', shaderId: null, inputs: {} }
}

function makeLayer(sourceShaderId: string | null = null): LayerState {
  return {
    id: uid(),
    sourceA: sourceShaderId
      ? { kind: 'generator', shaderId: sourceShaderId, inputs: {} }
      : emptySlot(),
    sourceB: null,
    sourceAFx: [],
    sourceBFx: [],
    fx: [],
    blend: 'add',
    opacity: 1,
    mute: false,
    solo: false,
    feedback: false,
    feedbackAmount: 0.6,
    sourceMix: 0.5,
    sourceBlend: 'normal',
    harmony: 0,
    speed: 1,
    coupling: { mode: 'off', amount: 0.5, tightness: 0.7, feature: 'transient' },
    mask: makeDefaultMask()
  }
}

/** Default per-layer mask : off (mode 0). */
export function makeDefaultMask(): LayerMask {
  return {
    mode: 0, invert: false, soft: 0.1,
    lumaLo: 0.2, lumaHi: 1.0,
    angle: 0, pos: 0.5,
    cx: 0.5, cy: 0.5, size: 0.4, aspect: 1, round: 1
  }
}

// The always-on master Vibe Palette (pinned last in the master rack): the
// color-MASTERING stage : palette map + built-in saturation / contrast /
// gamma / sharpen. Default: black background, white recoloring, neutral tone.
export function makeVibePalette(): FxInstance {
  return {
    id: uid(),
    shaderId: 'fx-vibe',
    enabled: true,
    locked: true,
    inputs: {
      stops: 2,
      blend: 1,
      dither: 0,
      mixSrc: 0.5,
      autoLevel: 0,
      saturation: 1,
      contrast: 1,
      gamma: 1,
      sharpen: 0,
      splitTone: 0,
      colorA: [0.0, 0.0, 0.0, 1],
      colorB: [1.0, 1.0, 1.0, 1]
    }
  }
}

// The always-on Context depth finalizer : pinned AFTER the Vibe Palette at the
// very end of the master rack. Adds trails, bloom, a key light, haze and a
// depth vignette. Defaults are a gentle, lifelike amount (not a passthrough).
export function makeContext(): FxInstance {
  return {
    id: uid(),
    shaderId: 'fx-context',
    enabled: true,
    locked: true,
    // Loads on the "Clean" preset : a near-passthrough whisper of depth, not
    // an intense default (turn it up or pick a preset via C / Shift+C).
    inputs: {
      trails: 0,
      blur: 0,
      bloom: 0.1,
      depth: 0.12,
      haze: 0,
      atmosphere: [0.5, 0.58, 0.72, 1],
      lightGlow: 0,
      lightSize: 0.5,
      lightColor: [1.0, 0.92, 0.8, 1],
      light: [0.5, 0.55]
    }
  }
}

// The always-on Finalizer : the last master stage after Context. A final
// grade (levels) + sharpen + physically-modelled grain over the whole output.
// Neutral at defaults (a whisper of film grain, everything else identity).
export function makeFinalizer(): FxInstance {
  return {
    id: uid(),
    shaderId: 'fx-finalizer',
    enabled: true,
    locked: true,
    inputs: {
      black: 0,
      white: 1,
      gamma: 1,
      rGain: 1,
      gGain: 1,
      bGain: 1,
      alpha: 1,
      sharpen: 0,
      character: 1,
      grain: 0.06,
      grainSize: 1.5,
      chroma: 0,
      parasites: 0.1
    }
  }
}

export function makeDefaultMetaKnobs(): MetaKnobState[] {
  return Array.from({ length: META_KNOB_COUNT }, (_, i) => ({
    name: `Knob ${i + 1}`,
    value: 0,
    smoothMs: 10, // masks MIDI's 1/127 steps without perceptible lag
    curve: 'linear' as const,
    midiCc: null,
    destinations: []
  }))
}

// A random NON-WHITE solid ground : varied hue, moderate saturation/value so a
// fresh session always opens on a different tinted backdrop (never pure white).
function randomBgColor(): [number, number, number, number] {
  const h = Math.random()
  const s = 0.35 + Math.random() * 0.5 // 0.35..0.85
  const v = 0.28 + Math.random() * 0.44 // 0.28..0.72 : never washes to white
  const i = Math.floor(h * 6), f = h * 6 - i
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s)
  const rgb =
    i % 6 === 0 ? [v, t, p] :
    i % 6 === 1 ? [q, v, p] :
    i % 6 === 2 ? [p, v, t] :
    i % 6 === 3 ? [p, q, v] :
    i % 6 === 4 ? [t, p, v] : [v, p, q]
  return [rgb[0], rgb[1], rgb[2], 1]
}

// The Background slab's default : a solid ground (a canvas to build on / key
// against), a RANDOM non-white colour each new session. Old sessions with no
// background normalize to the BLANK (off) one so loading them isn't washed out.
export function makeDefaultBackground(): BackgroundState {
  return {
    source: { kind: 'generator', shaderId: 'solid-color', inputs: { gradient: 0, color: randomBgColor() } },
    fx: [],
    opacity: 1,
    speed: BG_DEFAULT_SPEED,
    depth: 0
  }
}
export function makeBlankBackground(): BackgroundState {
  return { source: emptySlot(), fx: [], opacity: 1, speed: BG_DEFAULT_SPEED, depth: 0 }
}

// A persisted field-macro value (0.5 neutral default).
// Debounced macro persistence : OSC streams the field/temperament macros at
// message rate, and a synchronous localStorage write per message blocks the
// renderer thread. The live value hits the store immediately; the disk write
// trails by 250ms of quiet.
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()
let sonifyPersistTimer: ReturnType<typeof setTimeout> | null = null
function persistSonify(cfg: SoniConfig): void {
  if (sonifyPersistTimer) clearTimeout(sonifyPersistTimer)
  sonifyPersistTimer = setTimeout(() => {
    sonifyPersistTimer = null
    localStorage.setItem('opsia.sonify', JSON.stringify({ ...cfg, on: false }))
  }, 250)
}

// Machine-local MIDI Learn bindings (everything except the Meta knobs' CCs,
// which travel with the session). Malformed entries are dropped, not fatal.
function loadMidiMap(): Record<string, MidiBinding> {
  try {
    const raw = JSON.parse(localStorage.getItem('opsia.midiMap') || '{}') as Record<
      string,
      MidiBinding
    >
    const out: Record<string, MidiBinding> = {}
    for (const [id, b] of Object.entries(raw)) {
      if (
        b &&
        (b.kind === 'cc' || b.kind === 'note') &&
        Number.isInteger(b.channel) &&
        Number.isInteger(b.number)
      ) {
        out[id] = { kind: b.kind, channel: b.channel, number: b.number }
      }
    }
    return out
  } catch {
    return {}
  }
}

function persistAssemblages(list: Assemblage[]): void {
  try {
    localStorage.setItem('opsia.assemblages', JSON.stringify(list))
  } catch {
    // Quota : an edit list is small, but a long bank of them isn't. The
    // assemblage still works this session, it just won't survive a restart.
    console.warn('[assemble] could not persist the assemblage bank (quota)')
  }
}

function persistMacro(key: string, v: number): void {
  const t = persistTimers.get(key)
  if (t) clearTimeout(t)
  persistTimers.set(key, setTimeout(() => localStorage.setItem(key, String(v)), 250))
}

function readMacro(key: string): number {
  const v = localStorage.getItem(key)
  return v !== null && Number.isFinite(Number(v)) ? Number(v) : 0.5
}

// Default macro-form sequencer: off, seconds clock, gentle dwell, subtle
// variation. S3/S4 fields ship inert (see docs/opsia-sequencer-spec.md).
export function makeDefaultSequence(): SequenceState {
  return {
    enabled: false,
    running: false,
    dwell: 8,
    dwellJitter: 0.2,
    transition: 'morph',
    crossfadeMs: 1200,
    mode: 'weighted',
    noRepeat: 2,
    variation: 0.15,
    breathe: { amount: 0, periodSec: 30 },
    arc: { enabled: false, lengthSec: 120 },
    burial: { enabled: false, lengthSec: 180, depth: 0.7 },
    longTake: { enabled: false, lengthSec: 240, depth: 0.5 },
    frameWeave: { enabled: false, rate: 24, cells: [0, 1, 2, 3] },
    cadenceEvery: 0,
    ruptureChance: 0,
    monomediaChance: 0,
    monomediaStyle: 'black',
    audioAdvance: 'off'
  }
}

export function makeDefaultComposition(): CompositionState {
  return {
    // Blank baseline : a fresh open is randomized on top via seedRandomStart().
    layers: [makeLayer(), makeLayer(), makeLayer(), makeLayer()],
    background: makeDefaultBackground(),
    master: [makeVibePalette(), makeContext(), makeFinalizer()],
    bpm: 120,
    modulators: makeDefaultModulators(),
    modMatrix: [],
    metaKnobs: makeDefaultMetaKnobs()
  }
}

// Migrate a composition loaded from disk (or a recalled scene) up to the current
// schema : backfill new layer/background/master/modulator/metaKnob fields so an
// older session — or a scene inside one — can never hand the engine an undefined
// slab or a locked-tail that's missing the Vibe → Context → Finalizer stages.
// Idempotent : safe to run on an already-current composition.
export function normalizeComposition(c: CompositionState): CompositionState {
  return {
    ...c,
    // Older sessions have no Background slab : normalize to the blank (off) one.
    background: c.background ?? makeBlankBackground(),
    // Normalize layers from older session files : new fields get defaults.
    layers: c.layers.map((l) => ({
      ...l,
      feedbackAmount: l.feedbackAmount ?? 0.6,
      sourceMix: l.sourceMix ?? 0.5,
      sourceBlend: l.sourceBlend ?? 'normal',
      harmony: l.harmony ?? 0,
      speed: l.speed ?? 1,
      sourceAFx: l.sourceAFx ?? [],
      sourceBFx: l.sourceBFx ?? [],
      fx: l.fx ?? [],
      coupling: l.coupling ?? { mode: 'off', amount: 0.5, tightness: 0.7, feature: 'transient' },
      mask: { ...makeDefaultMask(), ...(l.mask ?? {}) }
    })),
    // The Vibe Palette then the Context finalizer must exist and sit last, in
    // that order. Older sessions get them appended; a session whose locked unit
    // was the plain Palette migrates to fx-vibe (colors carry, mastering neutral).
    master: (() => {
      const m = (c.master ?? []).map((f) =>
        f.locked && f.shaderId === 'fx-palette'
          ? { ...makeVibePalette(), id: f.id, inputs: { ...makeVibePalette().inputs, ...f.inputs } }
          : f
      )
      const find = (id: string): FxInstance | undefined => m.find((f) => f.shaderId === id)
      const vibe = find('fx-vibe') ?? makeVibePalette()
      const context = find('fx-context') ?? makeContext()
      const finalizer = find('fx-finalizer') ?? makeFinalizer()
      const rest = m.filter(
        (f) => f.shaderId !== 'fx-vibe' && f.shaderId !== 'fx-context' && f.shaderId !== 'fx-finalizer'
      )
      return [...rest, vibe, context, finalizer]
    })(),
    // Backfill new modulator blocks (e.g. `audio`) so switching a slot to a new
    // type can't read undefined.
    modulators: (c.modulators ?? makeDefaultModulators()).map((m) => ({
      ...makeDefaultModulator(),
      ...m
    })),
    modMatrix: c.modMatrix ?? [],
    // 16 knobs now : older 32-knob sessions truncate; short arrays pad. Field-
    // MERGE each stored knob onto the default so a knob predating a field (e.g.
    // `destinations`) can't leave it undefined.
    metaKnobs: (() => {
      const k = c.metaKnobs ?? []
      return makeDefaultMetaKnobs().map((d, i) => ({ ...d, ...(k[i] ?? {}) }))
    })()
  }
}

// ── Generate : build a whole composition from a theme recipe (themes.ts) ──
// Draws WITHIN the theme's pools so the result reads unmistakably as the theme,
// with variety from which sources/FX land and their curated params. The World +
// macros + temperament are applied by the generateTheme action on top of this.
function buildThemeComposition(theme: Theme): CompositionState {
  const R = Math.random
  const rr = (lo: number, hi: number): number => lo + R() * (hi - lo)
  const pickOf = <T>(a: readonly T[]): T => a[Math.floor(R() * a.length)]
  const themeFx = (id: string): FxInstance => ({
    id: uid(),
    shaderId: id,
    enabled: true,
    inputs: randomizeInputs(id, {})
    // node-feedback / node-reponse (the only native nodes themes use) feed on the
    // layer itself, so they need no sidechain.
  })
  const buildRack = (pool: string[], max: number, layerIdx: number): FxInstance[] => {
    if (!pool.length || max <= 0) return []
    const n = 1 + Math.floor(R() * max)
    const avail = [...pool]
    const out: FxInstance[] = []
    for (let i = 0; i < n && avail.length; i++) {
      out.push(themeFx(avail.splice(Math.floor(R() * avail.length), 1)[0]))
    }
    return out
  }

  const nActive = theme.layers[0] + Math.floor(R() * (theme.layers[1] - theme.layers[0] + 1))
  const layers: LayerState[] = Array.from({ length: 4 }, (_, i) => {
    const l = makeLayer()
    if (i >= nActive) {
      l.sourceA = emptySlot()
      return l // an inactive (empty) upper layer
    }
    const srcId = pickOf(theme.sources)
    l.sourceA = { kind: 'generator', shaderId: srcId, inputs: randomizeInputs(srcId, {}) }
    if (R() < theme.useB) {
      const bId = pickOf(theme.sources)
      l.sourceB = { kind: 'generator', shaderId: bId, inputs: randomizeInputs(bId, {}) }
      l.sourceMix = rr(0.3, 0.7)
      l.sourceBlend = pickOf(['normal', 'screen', 'difference', 'multiply'] as BlendMode[])
      l.harmony = rr(0, 0.5)
    }
    l.sourceAFx = R() < 0.4 ? buildRack(theme.layerFx, 1, i) : []
    l.fx = buildRack(theme.layerFx, 2, i)
    if (theme.nativeNodes?.length && R() < (theme.nativeChance ?? 0.4)) l.fx.push(themeFx(pickOf(theme.nativeNodes)))
    l.blend = i === 0 ? 'normal' : pickOf(theme.blends)
    l.opacity = i === 0 ? 1 : rr(0.65, 1)
    l.feedback = R() < theme.feedback
    l.feedbackAmount = rr(0.4, 0.75)
    l.speed = rr(0.6, 1.6)
    return l
  })

  // Background : a legal bg source from the theme's pool (falls back to a drift).
  const bgPool = (theme.bgSources?.length ? theme.bgSources : theme.sources).filter((id) =>
    BG_SOURCES.some((g) => g.id === id)
  )
  const bgId = bgPool.length ? pickOf(bgPool) : 'drift-field'
  const background: BackgroundState = {
    source: { kind: 'generator', shaderId: bgId, inputs: randomizeInputs(bgId, {}) },
    fx: [],
    opacity: 1,
    speed: BG_DEFAULT_SPEED,
    depth: rr(0, 0.35)
  }

  // Vibe palette carries the theme's colours (the strongest theme signal).
  // BRIGHTNESS SAFETY : force a near-black darkest stop AND a legible brightest
  // stop so the palette always spans a full tonal range : no generated session
  // can crush to black or wash out, while the theme's hue + sparseness (its mood)
  // are untouched. A mild auto-levels stretch is the net for dark/flat sources.
  const lum = (c: number[]): number => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
  const pcols = theme.palette.slice(0, 5).map((c) => c.slice())
  if (pcols.length) {
    let di = 0, bi = 0
    for (let i = 1; i < pcols.length; i++) {
      if (lum(pcols[i]) < lum(pcols[di])) di = i
      if (lum(pcols[i]) > lum(pcols[bi])) bi = i
    }
    const dL = lum(pcols[di])
    if (dL > 0.14) {
      const s = 0.06 / Math.max(dL, 0.05)
      pcols[di] = [pcols[di][0] * s, pcols[di][1] * s, pcols[di][2] * s, pcols[di][3] ?? 1]
    }
    const bL = lum(pcols[bi])
    if (bL < 0.6) {
      const s = 0.6 / Math.max(bL, 0.05)
      pcols[bi] = [
        Math.min(1, pcols[bi][0] * s),
        Math.min(1, pcols[bi][1] * s),
        Math.min(1, pcols[bi][2] * s),
        pcols[bi][3] ?? 1
      ]
    }
  }
  const pkeys = ['colorA', 'colorB', 'colorC', 'colorD', 'colorE']
  const vibeInputs: Record<string, number | number[]> = {
    stops: Math.min(5, Math.max(2, pcols.length)),
    blend: 1,
    dither: rr(0, 0.25),
    mixSrc: rr(0.12, 0.4),
    autoLevel: 0.4, // mild dynamic-range normalise : never a dead-black frame
    saturation: rr(0.85, 1.15),
    contrast: rr(0.95, 1.2),
    gamma: rr(0.9, 1.1)
  }
  pcols.forEach((c, i) => (vibeInputs[pkeys[i]] = c))
  if (theme.vibe) Object.assign(vibeInputs, theme.vibe)
  const vibe = makeVibePalette()
  vibe.inputs = { ...vibe.inputs, ...vibeInputs }
  const context = makeContext()
  const finalizer = makeFinalizer()
  if (theme.finalizer) finalizer.inputs = { ...finalizer.inputs, ...theme.finalizer }

  return {
    layers,
    background,
    master: [vibe, context, finalizer],
    bpm: 120,
    modulators: makeDefaultModulators(),
    modMatrix: [],
    metaKnobs: makeDefaultMetaKnobs()
  }
}

// What the Inspector's auto-UI is pointed at: a source slot or an FX unit
// (brief §10.3 : "selecting any source or FX renders its ISF INPUTS").
export type Selection =
  | { type: 'source'; layer: number; slot: 'A' | 'B' }
  | { type: 'fx'; scope: FxScope; instId: string }
  | { type: 'background' } // the Background slab's source params
  | null

/** Stable identity for a mod target : used to find existing assignments. */
export function modTargetKey(t: ModTarget): string {
  if (t.kind === 'source') return `src:${t.layer}:${t.slot}:${t.input}`
  if (t.kind === 'bgSource') return `bgsrc:${t.input}`
  if (t.kind === 'meta') return `meta:${t.knob}`
  if (t.kind === 'sonify') return `soni:${t.param}`
  const s = t.scope
  const scopeKey =
    s.kind === 'master' || s.kind === 'background' ? s.kind : `${s.kind}:${s.layer}`
  return `fx:${scopeKey}:${t.instId}:${t.input}`
}

// ── Store ─────────────────────────────────────────────────────────────
interface StoreState {
  theme: ThemeName
  setTheme: (t: ThemeName) => void

  name: string
  setName: (n: string) => void

  composition: CompositionState
  // Layer parameter actions : the Compositor reads composition each frame,
  // so these double as the OSC / modulator write path.
  setBlend: (layer: number, mode: BlendMode) => void
  setOpacity: (layer: number, v: number) => void
  toggleMute: (layer: number) => void
  toggleSolo: (layer: number) => void
  toggleFeedback: (layer: number) => void
  setFeedbackAmount: (layer: number, v: number) => void
  setSourceMix: (layer: number, v: number) => void
  setHarmony: (layer: number, v: number) => void
  setCoupling: (layer: number, partial: Partial<LayerCoupling>) => void
  setSourceBlend: (layer: number, mode: BlendMode) => void
  setLayerMask: (layer: number, partial: Partial<LayerMask>) => void
  setSourceShader: (layer: number, slot: 'A' | 'B', shaderId: string | null) => void
  // Point a slot at an imported video clip (kind:'video'). mediaId is the clip's
  // object URL; mediaName is shown in the picker.
  setSourceVideo: (layer: number, slot: 'A' | 'B', mediaId: string, mediaName: string) => void
  // Point a slot at a live capture source. `spec` is 'webcam', 'screen', or
  // 'desktop:<sourceId>' for a specific window/screen; `name` labels it.
  setSourceCapture: (layer: number, slot: 'A' | 'B', spec: string, name: string) => void
  // Point a slot at a live HIVE stream (host:port).
  setSourceHive: (layer: number, slot: 'A' | 'B', host: string, port: number) => void
  // Native Text source (gen-text): the string + the glyph-fill sidechain.
  setSourceText: (layer: number, slot: 'A' | 'B', text: string) => void
  setSourceSidechain: (layer: number, slot: 'A' | 'B', ref: SidechainRef | null) => void

  // ── Background slab : the ground under the four layers ───────────────
  setBackgroundSource: (shaderId: string | null) => void
  setBackgroundInput: (name: string, value: number | number[]) => void
  setBackgroundOpacity: (v: number) => void
  setBackgroundSpeed: (v: number) => void
  setBackgroundDepth: (v: number) => void
  setBackgroundBlendMode: (m: 'blend' | 'isolate') => void
  randomizeBg: () => void // the background's own dice (global Randomize skips it)
  // Apply a materialized background (built-in preset via bgPresetToState, or a
  // user preset's saved state). FX get fresh instance ids.
  applyBgPreset: (bg: BackgroundState) => void
  // User background presets : app-persistent, like layer presets.
  bgPresets: Array<{ id: string; name: string; bg: BackgroundState }>
  saveBgPreset: (name: string) => void
  deleteBgPreset: (id: string) => void
  // Patch a video slot's transport (play/speed/reverse/loop/in/out).
  setVideoPlayback: (
    layer: number,
    slot: 'A' | 'B',
    patch: Partial<
      Pick<
        SourceSlot,
        | 'videoPlaying' | 'videoSpeed' | 'videoDirection' | 'videoLoop' | 'videoIn' | 'videoOut'
        | 'grainOn' | 'grainSize' | 'grainSpray' | 'grainReverse' | 'grainJitter' | 'grainSync'
      >
    >
  ) => void
  // Framing (zoom/pan/crop) for a video OR capture slot.
  setSourceTransform: (
    layer: number,
    slot: 'A' | 'B',
    patch: Partial<
      Pick<SourceSlot, 'zoom' | 'panX' | 'panY' | 'cropL' | 'cropR' | 'cropT' | 'cropB'>
    >
  ) => void
  setLayerSpeed: (layer: number, v: number) => void
  // Replace the master chain; the chain's vibe settings merge onto the
  // pinned Vibe Palette (which stays pinned, keeps identity + enable state).
  applyMasterPreset: (
    fx: Array<{ shaderId: string; inputs: Record<string, number | number[]> }>,
    vibe?: Record<string, number | number[]>
  ) => void
  // Layer lifecycle (context menu): reset to factory / structural randomize.
  initLayer: (layer: number) => void
  randomizeLayer: (layer: number) => void
  // Layer presets : whole-layer states (sources + all racks), app-persistent.
  layerPresets: Array<{ id: string; name: string; layer: LayerState }>
  saveLayerPreset: (layer: number, name: string) => void
  applyLayerPreset: (layer: number, presetId: string) => void
  deleteLayerPreset: (presetId: string) => void
  // Volatile layer clipboard : copy one layer's whole state, paste onto another.
  copiedLayer: LayerState | null
  copyLayer: (layer: number) => void
  pasteLayer: (layer: number) => void
  // Right-side panel view : Layers strips, the compact Mixer (M key), or the
  // Finishing Touches (Vibe/Context/Finalizer) stack. All three occupy the same
  // column; a small tab row switches between them.
  rightView: 'layers' | 'mixer' | 'finishing' | 'feel' | 'io' | 'assemble'
  setRightView: (v: 'layers' | 'mixer' | 'finishing' | 'feel' | 'io' | 'assemble') => void
  // Back-compat: the M key still toggles the Mixer on/off against Layers.
  mixerView: boolean
  toggleMixerView: () => void
  mixerPresets: Array<{
    id: string
    name: string
    layers: Array<{ opacity: number; speed: number; blend: BlendMode }>
  }>
  saveMixerPreset: (name: string) => void
  applyMixerPreset: (presetId: string) => void
  deleteMixerPreset: (presetId: string) => void
  setSourceInput: (
    layer: number,
    slot: 'A' | 'B',
    name: string,
    value: number | number[]
  ) => void
  patchLayer: (layer: number, partial: Partial<LayerState>) => void
  setMasterFx: (fx: FxInstance[]) => void

  // FX racks (Phase 3) : one action surface for all four rack scopes.
  addFx: (scope: FxScope, shaderId: string) => void
  removeFx: (scope: FxScope, instId: string) => void
  toggleFx: (scope: FxScope, instId: string) => void
  // On/Off for the whole master chain : all non-locked master FX at once.
  toggleMasterChain: () => void
  setFxOpacity: (scope: FxScope, instId: string, v: number) => void
  moveFx: (scope: FxScope, instId: string, dir: -1 | 1) => void
  // Drag-and-drop reorder: place instId before beforeId (null = end of chain).
  reorderFx: (scope: FxScope, instId: string, beforeId: string | null) => void
  setFxInput: (scope: FxScope, instId: string, name: string, value: number | number[]) => void
  // Native convolution nodes: choose the sidechain (impulse) source.
  setFxSidechain: (scope: FxScope, instId: string, ref: SidechainRef | null) => void

  // Randomize (brief §7) : scoped draws from curated aesthetic ranges.
  // `intensity` 1 = full structural re-roll; <1 = a walk from the current scene.
  randomize: (scope: RandomizeScope, intensity?: number) => void
  // Variation : a baseline-anchored variant of the whole scene (structure fixed,
  // continuous values nudged by `amount` 0..1). Baseline captured on first press.
  variationBaseline: CompositionState | null
  applyVariation: (amount: number) => void
  // Re-roll each Meta knob's destinations (up to 8) + value : a fresh macro
  // surface (fired by 'Randomize Meta Knobs'; the smoother applies it).
  randomizeMetaBank: () => void
  // Randomize the master chain's FX PARAMETERS in place (keep the chain,
  // keep the Vibe) : the ⚄ next to the Master title.
  randomizeMasterParams: () => void

  // Name of the Vibe palette currently applied (P/Shift+P + the picker share
  // it so the Inspector always shows what's on). Transient UI, not persisted.
  vibePresetName: string | null
  setVibePresetName: (n: string | null) => void

  // Meta Controller (Phase 5) : 16 macro knobs.
  midiLearn: number | null // knob index armed for CC learn
  setMidiLearn: (i: number | null) => void

  // Global MIDI Learn (dataFLOU's Ableton-style mode) : the toolbar button
  // arms it, blue overlays appear on every learnable control, click one and
  // move a MIDI control to bind (green = already bound). Bindings other than
  // the Meta knobs' CCs (those live in the session's metaKnobs) are machine-
  // local : they persist in localStorage, keyed by a stable target id
  // ('scene:0', 'transport:morph', 'fire:vary', …).
  midiLearnMode: boolean
  midiLearnTarget: string | null
  setMidiLearnMode: (on: boolean) => void
  setMidiLearnTarget: (t: string | null) => void
  midiMap: Record<string, MidiBinding>
  setMidiBinding: (id: string, b: MidiBinding | null) => void
  // Which MIDI input feeds the app ('' = all inputs). Machine-local.
  midiInputName: string
  setMidiInputName: (name: string) => void
  updateMetaKnob: (i: number, partial: Partial<MetaKnobState>) => void
  setMetaValue: (i: number, v: number) => void
  // Toggle a destination on a knob (capped at META_MAX_DESTS).
  toggleMetaDest: (i: number, target: ModTarget) => void

  // Modulation (Phase 5) : the 8-slot bank + the capped matrix.
  updateModulator: (i: number, partial: Partial<ModulatorConfig>) => void
  // Upserts by (mod, target): re-assigning the same pair updates its depth.
  // Returns false when the cap would be exceeded (legibility = simplexité).
  assignMod: (mod: number, target: ModTarget, depth: number, mode?: ModMode) => boolean
  removeAssignment: (id: string) => void
  setAssignmentDepth: (id: string, depth: number) => void
  setAssignmentMode: (id: string, mode: ModMode) => void

  // The currently-selected source/FX whose ISF INPUTS the auto-UI renders.
  selection: Selection
  setSelection: (s: Selection) => void

  // UI chrome (persisted to localStorage, not to sessions).
  uiZoom: number
  setUiZoom: (z: number) => void
  // Projection warp (keystone / corner-pin) : per-machine output alignment,
  // persisted to localStorage (not part of a scene). Corners are 8 normalized
  // numbers: TL, TR, BR, BL (x,y each), 0..1 in output space.
  warpEnabled: boolean
  warpGrid: boolean
  warpCorners: number[]
  setWarpEnabled: (on: boolean) => void
  setWarpGrid: (on: boolean) => void
  setWarpCorner: (corner: number, x: number, y: number) => void
  resetWarp: () => void
  // Fullscreen output window (projector) is open + mirroring. Transient.
  outputActive: boolean
  setOutputActive: (on: boolean) => void
  // NDI / Spout output on (need the optional native senders). Transient.
  ndiActive: boolean
  setNdiActive: (on: boolean) => void
  spoutActive: boolean
  setSpoutActive: (on: boolean) => void
  // HIVE output (open NDI-alternative). hiveOutActive is transient; port persists.
  hiveOutActive: boolean
  setHiveOutActive: (on: boolean) => void
  hiveOutPort: number
  setHiveOutPort: (p: number) => void
  // Audio ingest (Slab 1) : enable is transient; source/device persist.
  audioEnabled: boolean
  setAudioEnabled: (on: boolean) => void
  audioSource: 'both' | 'osc' | 'local'
  setAudioSource: (s: 'both' | 'osc' | 'local') => void
  audioDeviceId: string | null
  setAudioDeviceId: (id: string | null) => void
  // Show the per-layer A/B coupling (CPL) row. Off by default : a visuals-only
  // user never sees the audio-relations control. Persisted.
  showCoupling: boolean
  setShowCoupling: (on: boolean) => void
  // Proximity (Field macro) : 0 far/vista · 0.5 neutral · 1 close/personal.
  // Pushes the Context mood; optional audio (brightness) drive. Persisted.
  proximity: number
  setProximity: (v: number) => void
  proximityAudio: boolean
  setProximityAudio: (on: boolean) => void
  // Field macros : global spatial-material controls (0.5 = neutral deadzone).
  density: number
  setDensity: (v: number) => void
  gestureTexture: number
  setGestureTexture: (v: number) => void
  coalesce: number
  setCoalesce: (v: number) => void
  // Temperament controls (0 = off). Tonicity: tonal audio → colour,
  // noise → mono (§3.10). Shutter: stop-motion frame-stepping (§1.7). Drift: slow
  // analog-instability wander + rare accidents over the grade (§1.8).
  tonicity: number
  setTonicity: (v: number) => void
  shutter: number
  setShutter: (v: number) => void
  drift: number
  setDrift: (v: number) => void
  // Flow ↔ Interruption (bipolar, 0.5 = neutral) : Flow softens toward a liquid,
  // continuous image; Interruption stutters (frame-holds / breakup / blank stabs).
  flow: number
  setFlow: (v: number) => void
  // Superimposition flicker (Cameraless §5.2 : 0 = off) + animated-sound loop
  // (§4.4 : samples a scanline of the output and sends it to Pandore over OSC).
  superFlicker: number
  setSuperFlicker: (v: number) => void
  markSignalEnabled: boolean
  markSignalY: number
  setMarkSignal: (partial: Partial<{ enabled: boolean; y: number }>) => void
  // World / diegesis : a bank of editable presets (built-ins + user worlds).
  // Selecting one biases the composition; the World page (W) edits/creates them.
  worlds: World[]
  world: string // active world id
  setWorld: (id: string) => void
  addWorld: (fromId?: string) => string // clone → new user world; returns its id
  updateWorld: (id: string, partial: Partial<World>) => void
  deleteWorld: (id: string) => void
  renameWorld: (id: string, name: string) => void
  worldPageOpen: boolean
  setWorldPageOpen: (on: boolean) => void
  // The full-page Output / Mapping view is showing. Transient.
  outputPageOpen: boolean
  setOutputPageOpen: (on: boolean) => void
  // Global modulation mute (transient) : freezes every modulator output.
  modBypass: boolean
  toggleModBypass: () => void
  // Meta: show the last four knobs (13–16) as two XY performance pads (default on).
  metaXYPads: boolean
  toggleMetaXYPads: () => void
  renderScale: number
  setRenderScale: (v: number) => void
  // Strobe-safety limiter (photosensitive) : 0 = off, higher = tighter flash cap.
  strobeSafe: number
  setStrobeSafe: (v: number) => void
  // Sonify (the S page) : the image-to-sound engine's whole config. Persisted
  // to localStorage (per-machine, like OSC config), pushed to the engine on
  // every write : one write path, same as everything else.
  sonifyPageOpen: boolean
  setSonifyPageOpen: (on: boolean) => void
  // Live recording state (set by the global recorder) : drives the REC pill.
  recording: boolean
  recordingSince: number
  setRecording: (on: boolean) => void
  sonify: SoniConfig
  setSonify: (next: SoniConfig) => void

  // ── Assemble : the corpus-based automatic editor ──────────────────────
  // The corpus is machine-local and derived (re-analysing is near-instant from
  // the on-disk cache), so only the FOLDER, the recipe and the saved
  // assemblages persist. `map` holds the PCA layout, recomputed with the corpus.
  assembleFolder: string
  assembleCorpus: AssembleCorpus | null
  assembleMap: Array<[number, number]>
  assembleParams: AssembleParams
  assemblages: Assemblage[]
  /** Non-null while a sweep or an export is running (drives the progress bar). */
  assembleBusy: { label: string; pct: number } | null
  setAssembleCorpus: (folder: string, c: AssembleCorpus | null) => void
  setAssembleParams: (p: Partial<AssembleParams>) => void
  setAssembleBusy: (b: { label: string; pct: number } | null) => void
  saveAssemblage: (a: Assemblage) => void
  deleteAssemblage: (id: string) => void
  renameAssemblage: (id: string, name: string) => void
  /** Put an assemblage on a layer as a source (the edit rides on the slot). */
  setSourceAssemble: (layer: number, slot: 'A' | 'B', a: Assemblage) => void

  // Depth engine mode (2.5D) : off · synthetic test bowl · AI monocular estimate.
  depthMode: 'off' | 'synth' | 'estimate'
  setDepthMode: (m: 'off' | 'synth' | 'estimate') => void
  collapsed: Record<string, boolean>
  toggleSection: (key: string) => void
  // Finishing view: exclusively open one finalizer sub-section (Vibe / Context /
  // Finalizer), collapsing the other two : or collapse it if already open.
  showFinishingSub: (shaderId: string) => void

  // Global tempo : drives BPM-synced modulator clocks; OSC-controllable.
  setBpm: (bpm: number) => void
  // Global time multiplier (1/64×…64×, 1 = realtime) : scales every visual clock.
  globalSpeed: number
  setGlobalSpeed: (x: number) => void
  // Scene/Randomize morph time in ms (0…30000, 100 = quick) : crossfade, not snap.
  morphMs: number
  setMorphMs: (ms: number) => void

  // OSC input config (persisted to localStorage). `enabled`/`port` are the
  // user's intent; `listening`/`addresses` reflect the main-process result.
  oscEnabled: boolean
  oscPort: number
  oscListening: boolean
  oscAddresses: string[]
  setOscConfig: (partial: Partial<{ enabled: boolean; port: number; listening: boolean; addresses: string[] }>) => void

  // Outbound OSC feedback (state mirror → Pandore). `enabled`/`host`/`port` are
  // the user's intent; the loop lives in oscInput.ts (applyOscOutput).
  oscOutEnabled: boolean
  oscOutHost: string
  oscOutPort: number
  oscOutIntervalMs: number
  setOscOutConfig: (partial: Partial<{ enabled: boolean; host: string; port: number; intervalMs: number }>) => void

  // User shader presets : app-persistent (localStorage), per shader id.
  userShaderPresets: Record<string, Array<{ name: string; values: Record<string, number | number[]> }>>
  addUserShaderPreset: (shaderId: string, name: string, values: Record<string, number | number[]>) => void
  deleteUserShaderPreset: (shaderId: string, name: string) => void

  // Scenes (Phase 6) : recallable full-instrument states, drag-arranged.
  scenes: SceneEntry[]
  activeSceneId: string | null
  saveScene: () => void
  // Overwrite an existing scene with the current live state.
  updateSceneFromLive: (id: string) => void
  duplicateScene: (id: string) => void
  // Save a Randomize-All result as a scene WITHOUT touching the live state
  // (the brief's randomize-into-scene).
  randomSceneIntoBank: () => void
  recallScene: (id: string) => void
  renameScene: (id: string, name: string) => void
  deleteScene: (id: string) => void
  reorderScene: (id: string, beforeId: string | null) => void
  // Scene relation tags (macro-form sequencer). ensureSceneTags fills derived
  // defaults if a scene has none; setSceneTags edits them.
  ensureSceneTags: (id: string) => void
  setSceneTags: (id: string, patch: Partial<SceneTags>) => void

  // Generative scene / relation sequencer (macro-form). Session-scoped.
  sequence: SequenceState
  setSequence: (patch: Partial<SequenceState>) => void
  toggleSequenceRunning: () => void
  // Recall a scene the SEQUENCER way: morph over `crossfadeMs` (0 = cut), with an
  // optional per-recall variation. Used by engine/sequencer.ts (wrapped silently
  // so auto-advances don't flood undo). Not for manual use.
  sequenceTo: (id: string, variation: number, crossfadeMs: number) => void
  sequencePageOpen: boolean
  setSequencePageOpen: (on: boolean) => void

  // Session round-tripping
  newSession: () => void
  /** Generate : replace the live session with a fresh one built from a theme. */
  generateTheme: (themeId: string) => void
  loadSession: (s: Session) => void
  exportSession: () => Session
  // Path of the file this session is saved to (from Save As / Open) : enables a
  // plain Save that overwrites in place. Null after New (never saved yet).
  sessionPath: string | null
  setSessionPath: (p: string | null) => void

  // Finishing Touches : the three pinned finalizers (Vibe · Context · Finalizer)
  // as one bank: toggle bypasses/enables all three at once.
  toggleFinishing: () => void
}

function updateLayer(
  layers: LayerState[],
  i: number,
  fn: (l: LayerState) => LayerState
): LayerState[] {
  return layers.map((l, idx) => (idx === i ? fn(l) : l))
}

// Rewrite the FX array addressed by `scope` through `fn`, immutably.
function updateFxArray(
  c: CompositionState,
  scope: FxScope,
  fn: (fx: FxInstance[]) => FxInstance[]
): CompositionState {
  if (scope.kind === 'master') return { ...c, master: fn(c.master) }
  if (scope.kind === 'background') {
    const bg = c.background ?? makeDefaultBackground()
    return { ...c, background: { ...bg, fx: fn(bg.fx) } }
  }
  return {
    ...c,
    layers: updateLayer(c.layers, scope.layer, (l) => {
      if (scope.kind === 'layer') return { ...l, fx: fn(l.fx) }
      if (scope.kind === 'sourceA') return { ...l, sourceAFx: fn(l.sourceAFx) }
      return { ...l, sourceBFx: fn(l.sourceBFx) }
    })
  }
}

// Startup: seed a random one-layer scene, then apply the active World so the
// composition matches the World selector on a cold launch (else it'd say e.g.
// "Musical" while the layers are uncoupled).
const startWorlds = loadWorlds()
const startWorld =
  startWorlds.find((w) => w.id === (localStorage.getItem('opsia.world') || 'synthetic')) ??
  startWorlds[0]
const startComposition = applyWorldToComposition(
  seedRandomStart(makeDefaultComposition()),
  startWorld
)

export const useStore = create<StoreState>((set, get) => ({
  theme: loadTheme(),
  setTheme: (t) => {
    applyTheme(t)
    localStorage.setItem('opsia.theme', t)
    set({ theme: t })
  },

  name: 'Untitled',
  setName: (n) => set({ name: n }),

  sessionPath: null,
  setSessionPath: (p) => set({ sessionPath: p }),

  // A cold launch opens on a fresh random one-layer scene with the active World
  // applied (overridden if an autosave/session loads over it in App).
  composition: startComposition,

  setBlend: (layer, mode) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => ({ ...l, blend: mode }))
      }
    })),
  setOpacity: (layer, v) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => ({
          ...l,
          opacity: Math.max(0, Math.min(1, v))
        }))
      }
    })),
  toggleMute: (layer) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => ({ ...l, mute: !l.mute }))
      }
    })),
  toggleSolo: (layer) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => ({ ...l, solo: !l.solo }))
      }
    })),
  toggleFeedback: (layer) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => ({
          ...l,
          feedback: !l.feedback
        }))
      }
    })),
  setSourceBlend: (layer, mode) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => ({
          ...l,
          sourceBlend: mode
        }))
      }
    })),
  setLayerMask: (layer, partial) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => ({
          ...l,
          mask: { ...(l.mask ?? makeDefaultMask()), ...partial }
        }))
      }
    })),

  initLayer: (layer) =>
    set((s) => ({
      composition: {
        ...s.composition,
        // Fresh factory layer : keeps its identity (id) so mod-matrix
        // source targets pointing at this layer index stay coherent.
        layers: updateLayer(s.composition.layers, layer, (l) => ({
          ...makeLayer(),
          id: l.id
        }))
      }
    })),
  randomizeLayer: (layer) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => randomizeSingleLayer(l))
      }
    })),

  layerPresets: (() => {
    try {
      return JSON.parse(localStorage.getItem('opsia.layerPresets') ?? '[]')
    } catch {
      return []
    }
  })(),
  saveLayerPreset: (layer, name) =>
    set((s) => {
      const l = s.composition.layers[layer]
      if (!l) return s
      const layerPresets = [
        ...s.layerPresets,
        { id: uid(), name: name.trim() || `Layer preset ${s.layerPresets.length + 1}`, layer: l }
      ]
      localStorage.setItem('opsia.layerPresets', JSON.stringify(layerPresets))
      return { layerPresets }
    }),
  applyLayerPreset: (layer, presetId) =>
    set((s) => {
      const p = s.layerPresets.find((x) => x.id === presetId)
      if (!p) return s
      return {
        composition: {
          ...s.composition,
          layers: updateLayer(s.composition.layers, layer, (l) => ({
            ...p.layer,
            // Fresh FX instance ids so mod-matrix entries from another life
            // of this preset can't alias; keep the target layer's identity.
            id: l.id,
            sourceAFx: p.layer.sourceAFx.map((f) => ({ ...f, id: uid() })),
            sourceBFx: p.layer.sourceBFx.map((f) => ({ ...f, id: uid() })),
            fx: p.layer.fx.map((f) => ({ ...f, id: uid() }))
          }))
        }
      }
    }),
  deleteLayerPreset: (presetId) =>
    set((s) => {
      const layerPresets = s.layerPresets.filter((x) => x.id !== presetId)
      localStorage.setItem('opsia.layerPresets', JSON.stringify(layerPresets))
      return { layerPresets }
    }),

  copiedLayer: null,
  copyLayer: (layer) =>
    set((s) => {
      const l = s.composition.layers[layer]
      if (!l) return s
      // Deep snapshot so later edits to the source layer don't mutate the copy.
      return { copiedLayer: structuredClone(l) }
    }),
  pasteLayer: (layer) =>
    set((s) => {
      const src = s.copiedLayer
      if (!src) return s
      return {
        composition: {
          ...s.composition,
          layers: updateLayer(s.composition.layers, layer, (l) => ({
            ...structuredClone(src),
            // Keep the target's identity; fresh FX ids so the mod-matrix can't
            // alias between the copied layer and this one (same as presets).
            id: l.id,
            sourceAFx: src.sourceAFx.map((f) => ({ ...f, id: uid() })),
            sourceBFx: src.sourceBFx.map((f) => ({ ...f, id: uid() })),
            fx: src.fx.map((f) => ({ ...f, id: uid() }))
          }))
        }
      }
    }),

  rightView: 'layers',
  setRightView: (v) => set({ rightView: v, mixerView: v === 'mixer' }),
  mixerView: false,
  toggleMixerView: () =>
    set((s) => {
      const next = s.rightView === 'mixer' ? 'layers' : 'mixer'
      return { rightView: next, mixerView: next === 'mixer' }
    }),
  mixerPresets: (() => {
    try {
      return JSON.parse(localStorage.getItem('opsia.mixerPresets') ?? '[]')
    } catch {
      return []
    }
  })(),
  saveMixerPreset: (name) =>
    set((s) => {
      const layers = s.composition.layers.map((l) => ({
        opacity: l.opacity,
        speed: l.speed,
        blend: l.blend
      }))
      const mixerPresets = [
        ...s.mixerPresets,
        { id: uid(), name: name.trim() || `Mix ${s.mixerPresets.length + 1}`, layers }
      ]
      localStorage.setItem('opsia.mixerPresets', JSON.stringify(mixerPresets))
      return { mixerPresets }
    }),
  applyMixerPreset: (presetId) =>
    set((s) => {
      const p = s.mixerPresets.find((x) => x.id === presetId)
      if (!p) return s
      return {
        composition: {
          ...s.composition,
          layers: s.composition.layers.map((l, i) => {
            const m = p.layers[i]
            return m ? { ...l, opacity: m.opacity, speed: m.speed, blend: m.blend } : l
          })
        }
      }
    }),
  deleteMixerPreset: (presetId) =>
    set((s) => {
      const mixerPresets = s.mixerPresets.filter((x) => x.id !== presetId)
      localStorage.setItem('opsia.mixerPresets', JSON.stringify(mixerPresets))
      return { mixerPresets }
    }),

  setFeedbackAmount: (layer, v) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => ({
          ...l,
          feedbackAmount: Math.max(0, Math.min(1, v))
        }))
      }
    })),
  setSourceShader: (layer, slot, shaderId) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => {
          // null shader ⇒ the slot goes back to 'none' (empty layer). A clean
          // slot : no stale mediaId/mediaName carried over from a prior video.
          const kind = shaderId ? ('generator' as const) : ('none' as const)
          const next = { kind, shaderId, inputs: {} }
          if (slot === 'A') return { ...l, sourceA: next }
          return { ...l, sourceB: next }
        })
      },
      // Picking a source lands its controls in the Inspector immediately.
      selection: shaderId ? { type: 'source', layer, slot } : s.selection
    })),
  setSourceVideo: (layer, slot, mediaId, mediaName) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => {
          const vid = {
            kind: 'video' as const,
            shaderId: null,
            inputs: {},
            mediaId,
            mediaName,
            videoPlaying: true,
            videoSpeed: 1,
            videoDirection: 'forward' as const,
            videoLoop: true,
            videoIn: 0,
            videoOut: 1
          }
          // Clear the slot's inherited source FX : a freshly imported clip must
          // not land under a random-scene's hold/freeze/key rack (which would
          // read as "the video won't play"). The user adds FX deliberately after.
          if (slot === 'A') return { ...l, sourceA: vid, sourceAFx: [] }
          return { ...l, sourceB: vid, sourceBFx: [] }
        })
      },
      selection: { type: 'source', layer, slot }
    })),
  setSourceCapture: (layer, slot, spec, name) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => {
          const cap = {
            kind: 'capture' as const,
            shaderId: null,
            inputs: {},
            mediaId: spec,
            mediaName: name
          }
          if (slot === 'A') return { ...l, sourceA: cap, sourceAFx: [] }
          return { ...l, sourceB: cap, sourceBFx: [] }
        })
      },
      selection: { type: 'source', layer, slot }
    })),
  setSourceHive: (layer, slot, host, port) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => {
          const hv = {
            kind: 'hive' as const,
            shaderId: null,
            inputs: {},
            mediaId: `${host}:${port}`,
            mediaName: `HIVE ${host}:${port}`
          }
          if (slot === 'A') return { ...l, sourceA: hv, sourceAFx: [] }
          return { ...l, sourceB: hv, sourceBFx: [] }
        })
      },
      selection: { type: 'source', layer, slot }
    })),
  setSourceText: (layer, slot, text) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => {
          const cur = slot === 'A' ? l.sourceA : l.sourceB
          if (!cur || cur.shaderId !== 'gen-text') return l
          const next = { ...cur, text }
          return slot === 'A' ? { ...l, sourceA: next } : { ...l, sourceB: next }
        })
      }
    })),
  setSourceSidechain: (layer, slot, ref) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => {
          const cur = slot === 'A' ? l.sourceA : l.sourceB
          if (!cur) return l
          const next = { ...cur, sidechain: ref }
          return slot === 'A' ? { ...l, sourceA: next } : { ...l, sourceB: next }
        })
      }
    })),
  // ── Background slab ────────────────────────────────────────────────
  setBackgroundSource: (shaderId) =>
    set((s) => {
      const bg = s.composition.background ?? makeDefaultBackground()
      const source: SourceSlot = shaderId
        ? { kind: 'generator', shaderId, inputs: {} }
        : emptySlot()
      return {
        composition: { ...s.composition, background: { ...bg, source } },
        selection: shaderId ? { type: 'background' } : s.selection
      }
    }),
  setBackgroundInput: (name, value) =>
    set((s) => {
      const bg = s.composition.background ?? makeDefaultBackground()
      return {
        composition: {
          ...s.composition,
          background: { ...bg, source: { ...bg.source, inputs: { ...bg.source.inputs, [name]: value } } }
        }
      }
    }),
  setBackgroundOpacity: (v) =>
    set((s) => {
      const bg = s.composition.background ?? makeDefaultBackground()
      return { composition: { ...s.composition, background: { ...bg, opacity: Math.max(0, Math.min(1, v)) } } }
    }),
  setBackgroundSpeed: (v) =>
    set((s) => {
      const bg = s.composition.background ?? makeDefaultBackground()
      return { composition: { ...s.composition, background: { ...bg, speed: Math.max(0, Math.min(4, v)) } } }
    }),
  setBackgroundDepth: (v) =>
    set((s) => {
      const bg = s.composition.background ?? makeDefaultBackground()
      return { composition: { ...s.composition, background: { ...bg, depth: Math.max(0, Math.min(1, v)) } } }
    }),
  setBackgroundBlendMode: (m) =>
    set((s) => {
      const bg = s.composition.background ?? makeDefaultBackground()
      return { composition: { ...s.composition, background: { ...bg, blendMode: m } } }
    }),
  randomizeBg: () =>
    set((s) => ({
      composition: { ...s.composition, background: randomizeBackground(s.composition.background) }
    })),
  applyBgPreset: (bg) =>
    set((s) => ({
      composition: {
        ...s.composition,
        background: {
          ...bg,
          source: { ...bg.source, inputs: { ...bg.source.inputs } },
          fx: bg.fx.map((f) => ({ ...f, id: uid(), inputs: { ...f.inputs } }))
        }
      },
      selection: { type: 'background' }
    })),
  bgPresets: (() => {
    try {
      return JSON.parse(localStorage.getItem('opsia.bgPresets') ?? '[]')
    } catch {
      return []
    }
  })(),
  saveBgPreset: (name) =>
    set((s) => {
      const bg = s.composition.background
      if (!bg || !bg.source.shaderId) return s
      const bgPresets = [
        ...s.bgPresets,
        { id: uid(), name: name.trim() || `Background ${s.bgPresets.length + 1}`, bg: structuredClone(bg) }
      ]
      localStorage.setItem('opsia.bgPresets', JSON.stringify(bgPresets))
      return { bgPresets }
    }),
  deleteBgPreset: (id) =>
    set((s) => {
      const bgPresets = s.bgPresets.filter((x) => x.id !== id)
      localStorage.setItem('opsia.bgPresets', JSON.stringify(bgPresets))
      return { bgPresets }
    }),

  setVideoPlayback: (layer, slot, patch) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => {
          const cur = slot === 'A' ? l.sourceA : l.sourceB
          // Assemble slots share the play/loop/speed fields with video.
          if (!cur || (cur.kind !== 'video' && cur.kind !== 'assemble')) return l
          const next = { ...cur, ...patch }
          return slot === 'A' ? { ...l, sourceA: next } : { ...l, sourceB: next }
        })
      }
    })),
  setSourceTransform: (layer, slot, patch) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => {
          const cur = slot === 'A' ? l.sourceA : l.sourceB
          if (!cur || (cur.kind !== 'video' && cur.kind !== 'capture')) return l
          const next = { ...cur, ...patch }
          return slot === 'A' ? { ...l, sourceA: next } : { ...l, sourceB: next }
        })
      }
    })),
  setLayerSpeed: (layer, v) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => ({
          ...l,
          speed: Math.max(0, Math.min(20, v))
        }))
      }
    })),
  setBpm: (bpm) =>
    set((s) => ({
      composition: { ...s.composition, bpm: Math.max(20, Math.min(800, bpm)) }
    })),
  globalSpeed: 1,
  setGlobalSpeed: (x) => set({ globalSpeed: Math.max(1 / 64, Math.min(64, x)) }),
  morphMs: 1000,
  setMorphMs: (ms) => set({ morphMs: Math.max(0, Math.min(30000, ms)) }),
  applyMasterPreset: (fx, vibe) =>
    set((s) => {
      // Locked finalizers (Vibe, then Context) survive a chain preset; the
      // preset's vibe values land ONLY on the Vibe unit, never on Context.
      const locked = s.composition.master
        .filter((f) => f.locked)
        .map((f) => (vibe && f.shaderId === 'fx-vibe' ? { ...f, inputs: { ...f.inputs, ...vibe } } : f))
      const units: FxInstance[] = fx.map((f) => ({
        id: uid(),
        shaderId: f.shaderId,
        enabled: true,
        inputs: { ...f.inputs }
      }))
      // A chain preset sets its own vibe : no longer a named palette.
      return { composition: { ...s.composition, master: [...units, ...locked] }, vibePresetName: vibe ? null : s.vibePresetName }
    }),
  setSourceInput: (layer, slot, name, value) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => {
          if (slot === 'A')
            return {
              ...l,
              sourceA: { ...l.sourceA, inputs: { ...l.sourceA.inputs, [name]: value } }
            }
          if (!l.sourceB) return l
          return {
            ...l,
            sourceB: { ...l.sourceB, inputs: { ...l.sourceB.inputs, [name]: value } }
          }
        })
      }
    })),
  patchLayer: (layer, partial) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => ({ ...l, ...partial }))
      }
    })),
  setMasterFx: (fx) =>
    set((s) => ({ composition: { ...s.composition, master: fx } })),

  setSourceMix: (layer, v) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => ({
          ...l,
          sourceMix: Math.max(0, Math.min(1, v))
        }))
      }
    })),

  setHarmony: (layer, v) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => ({
          ...l,
          harmony: Math.max(0, Math.min(1, v))
        }))
      }
    })),

  setCoupling: (layer, partial) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => ({
          ...l,
          coupling: { ...l.coupling, ...partial }
        }))
      }
    })),

  addFx: (scope, shaderId) =>
    set((s) => {
      const instId = uid()
      return {
        composition: updateFxArray(s.composition, scope, (fx) => {
          // Locked units (the Vibe Palette) stay last : insert before them.
          const lockedAt = fx.findIndex((f) => f.locked)
          const unit = { id: instId, shaderId, enabled: true, inputs: {} }
          if (lockedAt < 0) return [...fx, unit]
          const next = [...fx]
          next.splice(lockedAt, 0, unit)
          return next
        }),
        // Land the Inspector on the fresh unit : its controls are the next
        // thing the player reaches for.
        selection: { type: 'fx', scope, instId }
      }
    }),
  removeFx: (scope, instId) =>
    set((s) => ({
      composition: updateFxArray(s.composition, scope, (fx) =>
        fx.filter((f) => f.id !== instId || f.locked)
      )
    })),
  toggleFx: (scope, instId) =>
    set((s) => ({
      // Locked units stay pinned and unremovable, but CAN be bypassed —
      // turning the Vibe off is a legitimate look.
      composition: updateFxArray(s.composition, scope, (fx) =>
        fx.map((f) => (f.id === instId ? { ...f, enabled: !f.enabled } : f))
      )
    })),
  toggleMasterChain: () =>
    set((s) => {
      // The "chain" On/Off : flips ALL user-added master FX (never the pinned
      // Finishing Touches finalizers). On if every non-locked unit is enabled;
      // one click turns them all off, another turns them all back on.
      const regular = s.composition.master.filter((f) => !f.locked)
      const target = !(regular.length > 0 && regular.every((f) => f.enabled))
      return {
        composition: {
          ...s.composition,
          master: s.composition.master.map((f) => (f.locked ? f : { ...f, enabled: target }))
        }
      }
    }),
  toggleFinishing: () =>
    set((s) => {
      // Bypass / enable the three pinned finalizers as one bank. Off if ANY is on
      // (so a single click always turns the whole thing off).
      const finalizers = s.composition.master.filter((f) => f.locked)
      const target = !finalizers.some((f) => f.enabled)
      return {
        composition: {
          ...s.composition,
          master: s.composition.master.map((f) => (f.locked ? { ...f, enabled: target } : f))
        }
      }
    }),
  setFxOpacity: (scope, instId, v) =>
    set((s) => ({
      composition: updateFxArray(s.composition, scope, (fx) =>
        fx.map((f) => (f.id === instId ? { ...f, opacity: Math.max(0, Math.min(1, v)) } : f))
      )
    })),
  moveFx: (scope, instId, dir) =>
    set((s) => ({
      composition: updateFxArray(s.composition, scope, (fx) => {
        const i = fx.findIndex((f) => f.id === instId)
        const j = i + dir
        if (i < 0 || j < 0 || j >= fx.length) return fx
        if (fx[i].locked || fx[j].locked) return fx // pinned stays pinned
        const next = [...fx]
        ;[next[i], next[j]] = [next[j], next[i]]
        return next
      })
    })),
  reorderFx: (scope, instId, beforeId) =>
    set((s) => ({
      composition: updateFxArray(s.composition, scope, (fx) => {
        const moving = fx.find((f) => f.id === instId)
        if (!moving || moving.locked || instId === beforeId) return fx
        const rest = fx.filter((f) => f.id !== instId)
        // null target = end of chain, but always before any locked unit.
        let idx = beforeId ? rest.findIndex((f) => f.id === beforeId) : rest.length
        if (idx < 0) return fx
        const lockedAt = rest.findIndex((f) => f.locked)
        if (lockedAt >= 0 && idx > lockedAt) idx = lockedAt
        const next = [...rest]
        next.splice(idx, 0, moving)
        return next
      })
    })),
  setFxInput: (scope, instId, name, value) =>
    set((s) => ({
      composition: updateFxArray(s.composition, scope, (fx) =>
        fx.map((f) =>
          f.id === instId ? { ...f, inputs: { ...f.inputs, [name]: value } } : f
        )
      )
    })),
  setFxSidechain: (scope, instId, ref) =>
    set((s) => ({
      composition: updateFxArray(s.composition, scope, (fx) =>
        fx.map((f) => (f.id === instId ? { ...f, sidechain: ref } : f))
      )
    })),

  randomize: (scope, intensity = 1) =>
    set((s) => {
      const composition = randomizeComposition(s.composition, scope, intensity)
      beginMorph(s.composition, s.morphMs, performance.now()) // crossfade to the new draw
      // A structural randomize is a fresh starting point : drop the Variation
      // baseline so the next Variation press anchors on this new scene.
      return { composition, variationBaseline: null }
    }),

  // ── Variation (baseline-anchored) ─────────────────────────────────────
  // The first press captures the current scene as a baseline; every press
  // yields a fresh variant at the slider's distance FROM that baseline (same
  // structure, continuous values nudged). recall / randomize / new / load reset
  // the baseline so it re-anchors on whatever scene you land on next.
  variationBaseline: null,
  applyVariation: (amount) =>
    set((s) => {
      const base = s.variationBaseline ?? s.composition
      const composition = varyComposition(base, amount)
      beginMorph(s.composition, s.morphMs, performance.now())
      return { composition, variationBaseline: base }
    }),

  randomizeMetaBank: () =>
    set((s) => {
      const targets = collectFloatTargets(s.composition)
      const metaKnobs = s.composition.metaKnobs.map((k) => {
        const value = Math.random()
        if (targets.length === 0) return { ...k, value }
        // 1..8 distinct destinations per knob (8 is META_MAX_DESTS).
        const maxN = Math.min(META_MAX_DESTS, targets.length)
        const n = 1 + Math.floor(Math.random() * maxN)
        const pool = targets.slice()
        const destinations: typeof k.destinations = []
        for (let j = 0; j < n && pool.length > 0; j++) {
          const idx = Math.floor(Math.random() * pool.length)
          destinations.push(pool[idx])
          pool.splice(idx, 1)
        }
        return { ...k, destinations, value }
      })
      return { composition: { ...s.composition, metaKnobs } }
    }),
  vibePresetName: null,
  setVibePresetName: (n) => set({ vibePresetName: n }),

  randomizeMasterParams: () =>
    set((s) => ({
      composition: {
        ...s.composition,
        // Keep the chain and the pinned Vibe; re-roll every other unit's
        // inputs within curated ranges.
        master: s.composition.master.map((f) =>
          f.shaderId && !f.locked
            ? { ...f, inputs: randomizeInputs(f.shaderId, f.inputs) }
            : f
        )
      }
    })),

  midiLearn: null,
  setMidiLearn: (i) => set({ midiLearn: i }),

  midiLearnMode: false,
  midiLearnTarget: null,
  // Turning OFF also drops the pending target (cancelling); turning ON never
  // clears bindings — it's a browse/bind mode, not a reset.
  setMidiLearnMode: (on) =>
    set(on ? { midiLearnMode: true } : { midiLearnMode: false, midiLearnTarget: null }),
  setMidiLearnTarget: (t) => set({ midiLearnTarget: t }),
  midiMap: loadMidiMap(),
  setMidiBinding: (id, b) =>
    set((s) => {
      const midiMap = { ...s.midiMap }
      if (b) midiMap[id] = b
      else delete midiMap[id]
      try {
        localStorage.setItem('opsia.midiMap', JSON.stringify(midiMap))
      } catch {
        /* quota — bindings just won't survive the restart */
      }
      return { midiMap }
    }),
  midiInputName: localStorage.getItem('opsia.midiInput') ?? '',
  setMidiInputName: (name) => {
    localStorage.setItem('opsia.midiInput', name)
    set({ midiInputName: name })
  },
  updateMetaKnob: (i, partial) =>
    set((s) => ({
      composition: {
        ...s.composition,
        metaKnobs: s.composition.metaKnobs.map((k, idx) =>
          idx === i ? { ...k, ...partial } : k
        )
      }
    })),
  setMetaValue: (i, v) =>
    set((s) => ({
      composition: {
        ...s.composition,
        metaKnobs: s.composition.metaKnobs.map((k, idx) =>
          idx === i ? { ...k, value: Math.max(0, Math.min(1, v)) } : k
        )
      }
    })),
  toggleMetaDest: (i, target) =>
    set((s) => {
      const key = modTargetKey(target)
      return {
        composition: {
          ...s.composition,
          metaKnobs: s.composition.metaKnobs.map((k, idx) => {
            if (idx !== i) return k
            const has = k.destinations.some((d) => modTargetKey(d) === key)
            if (has) {
              return {
                ...k,
                destinations: k.destinations.filter((d) => modTargetKey(d) !== key)
              }
            }
            if (k.destinations.length >= META_MAX_DESTS) return k // capped
            return { ...k, destinations: [...k.destinations, target] }
          })
        }
      }
    }),

  updateModulator: (i, partial) =>
    set((s) => ({
      composition: {
        ...s.composition,
        modulators: s.composition.modulators.map((m, idx) =>
          idx === i ? { ...m, ...partial } : m
        )
      }
    })),
  assignMod: (mod, target, depth, mode = 'multiply') => {
    const key = modTargetKey(target)
    // Check existence + cap AND append inside ONE set() updater : otherwise two
    // assignMod calls in the same tick (an OSC burst) both pass a stale cap
    // check and exceed MAX_MOD_ASSIGNMENTS.
    let result = true
    set((st) => {
      const existing = st.composition.modMatrix.find(
        (a) => a.mod === mod && modTargetKey(a.target) === key
      )
      if (existing) {
        return {
          composition: {
            ...st.composition,
            modMatrix: st.composition.modMatrix.map((a) =>
              a.id === existing.id ? { ...a, depth } : a
            )
          }
        }
      }
      if (st.composition.modMatrix.length >= MAX_MOD_ASSIGNMENTS) {
        result = false
        return {}
      }
      // New bindings default to Multiply (VCA scaling of the base).
      const entry: ModAssignment = { id: uid(), mod, target, depth, mode }
      return {
        composition: { ...st.composition, modMatrix: [...st.composition.modMatrix, entry] }
      }
    })
    return result
  },
  removeAssignment: (id) =>
    set((s) => ({
      composition: {
        ...s.composition,
        modMatrix: s.composition.modMatrix.filter((a) => a.id !== id)
      }
    })),
  setAssignmentDepth: (id, depth) =>
    set((s) => ({
      composition: {
        ...s.composition,
        modMatrix: s.composition.modMatrix.map((a) =>
          a.id === id ? { ...a, depth: Math.max(-1, Math.min(1, depth)) } : a
        )
      }
    })),
  setAssignmentMode: (id, mode) =>
    set((s) => ({
      composition: {
        ...s.composition,
        modMatrix: s.composition.modMatrix.map((a) => (a.id === id ? { ...a, mode } : a))
      }
    })),

  selection: null,
  setSelection: (sel) =>
    set((s) => {
      // Selecting anything (source / FX / Vibe / Context) opens the Inspector
      // so its controls are immediately visible.
      if (!sel || !s.collapsed['inspector']) return { selection: sel }
      const collapsed = { ...s.collapsed, inspector: false }
      localStorage.setItem('opsia.collapsed', JSON.stringify(collapsed))
      return { selection: sel, collapsed }
    }),

  uiZoom: (() => {
    const z = Number(localStorage.getItem('opsia.uiZoom'))
    return Number.isFinite(z) && z >= 0.6 && z <= 1.6 ? z : 1
  })(),
  setUiZoom: (z) => {
    const clamped = Math.max(0.6, Math.min(1.6, Math.round(z * 20) / 20))
    localStorage.setItem('opsia.uiZoom', String(clamped))
    set({ uiZoom: clamped })
  },

  warpEnabled: localStorage.getItem('opsia.warpEnabled') === '1',
  warpGrid: false,
  warpCorners: (() => {
    try {
      const s = JSON.parse(localStorage.getItem('opsia.warpCorners') ?? '')
      if (Array.isArray(s) && s.length === 8 && s.every((n) => typeof n === 'number')) return s
    } catch {
      /* fall through */
    }
    return [0, 0, 1, 0, 1, 1, 0, 1] // identity: TL, TR, BR, BL
  })(),
  setWarpEnabled: (on) => {
    localStorage.setItem('opsia.warpEnabled', on ? '1' : '0')
    set({ warpEnabled: on })
  },
  setWarpGrid: (on) => set({ warpGrid: on }),
  setWarpCorner: (corner, x, y) =>
    set((s) => {
      const c = [...s.warpCorners]
      c[corner * 2] = Math.max(-0.5, Math.min(1.5, x))
      c[corner * 2 + 1] = Math.max(-0.5, Math.min(1.5, y))
      localStorage.setItem('opsia.warpCorners', JSON.stringify(c))
      return { warpCorners: c }
    }),
  resetWarp: () => {
    const c = [0, 0, 1, 0, 1, 1, 0, 1]
    localStorage.setItem('opsia.warpCorners', JSON.stringify(c))
    set({ warpCorners: c })
  },
  outputActive: false,
  setOutputActive: (on) => set({ outputActive: on }),
  audioEnabled: false,
  setAudioEnabled: (on) => set({ audioEnabled: on }),
  audioSource: (localStorage.getItem('opsia.audioSource') as 'both' | 'osc' | 'local') || 'both',
  setAudioSource: (s) => {
    localStorage.setItem('opsia.audioSource', s)
    set({ audioSource: s })
  },
  audioDeviceId: localStorage.getItem('opsia.audioDeviceId') || null,
  setAudioDeviceId: (id) => {
    if (id) localStorage.setItem('opsia.audioDeviceId', id)
    else localStorage.removeItem('opsia.audioDeviceId')
    set({ audioDeviceId: id })
  },
  showCoupling: localStorage.getItem('opsia.showCoupling') === '1',
  setShowCoupling: (on) => {
    localStorage.setItem('opsia.showCoupling', on ? '1' : '0')
    set({ showCoupling: on })
  },
  proximity: (() => {
    const p = localStorage.getItem('opsia.proximity')
    return p !== null && Number.isFinite(Number(p)) ? Number(p) : 0.5
  })(),
  setProximity: (v) => {
    persistMacro('opsia.proximity', v)
    set({ proximity: v })
  },
  proximityAudio: localStorage.getItem('opsia.proximityAudio') === '1',
  setProximityAudio: (on) => {
    localStorage.setItem('opsia.proximityAudio', on ? '1' : '0')
    set({ proximityAudio: on })
  },
  // Field macros (Slab 2c): each 0.5 = neutral deadzone. density (sparse↔dense),
  // gestureTexture (gesture↔texture motion character), coalesce (grain↔mass).
  density: readMacro('opsia.density'),
  setDensity: (v) => { persistMacro('opsia.density', v); set({ density: v }) },
  gestureTexture: readMacro('opsia.gestureTexture'),
  setGestureTexture: (v) => { persistMacro('opsia.gestureTexture', v); set({ gestureTexture: v }) },
  coalesce: readMacro('opsia.coalesce'),
  setCoalesce: (v) => { persistMacro('opsia.coalesce', v); set({ coalesce: v }) },
  // Temperament controls rest at 0 (off), not the 0.5 deadzone of the field macros.
  tonicity: (() => { const v = Number(localStorage.getItem('opsia.tonicity')); return Number.isFinite(v) ? v : 0 })(),
  setTonicity: (v) => { persistMacro('opsia.tonicity', v); set({ tonicity: v }) },
  // Shutter + Superimposition are strobe-like performance effects : always start
  // at 0 on load (they never persist a lingering strobe across sessions/reloads).
  shutter: 0,
  setShutter: (v) => set({ shutter: v }),
  drift: (() => { const v = Number(localStorage.getItem('opsia.drift')); return Number.isFinite(v) ? v : 0 })(),
  setDrift: (v) => { persistMacro('opsia.drift', v); set({ drift: v }) },
  // Flow ↔ Interruption is bipolar : rests at 0.5 (neutral) and persists like drift.
  flow: (() => { const v = Number(localStorage.getItem('opsia.flow')); return Number.isFinite(v) ? v : 0.5 })(),
  setFlow: (v) => { persistMacro('opsia.flow', v); set({ flow: v }) },
  superFlicker: 0,
  setSuperFlicker: (v) => set({ superFlicker: v }),
  markSignalEnabled: localStorage.getItem('opsia.markSignalEnabled') === '1',
  markSignalY: (() => { const v = Number(localStorage.getItem('opsia.markSignalY')); return Number.isFinite(v) ? v : 0.5 })(),
  setMarkSignal: (partial) =>
    set((s) => {
      if (partial.enabled !== undefined) localStorage.setItem('opsia.markSignalEnabled', partial.enabled ? '1' : '0')
      if (partial.y !== undefined) localStorage.setItem('opsia.markSignalY', String(partial.y))
      return { markSignalEnabled: partial.enabled ?? s.markSignalEnabled, markSignalY: partial.y ?? s.markSignalY }
    }),
  worlds: startWorlds,
  world: startWorld.id,
  setWorld: (id) =>
    set((s) => {
      const w = s.worlds.find((x) => x.id === id) ?? s.worlds[0]
      localStorage.setItem('opsia.world', w.id)
      // Applying a World biases the current composition (undoable).
      return { world: w.id, composition: applyWorldToComposition(s.composition, w) }
    }),
  addWorld: (fromId) => {
    const s = get()
    const src = s.worlds.find((x) => x.id === (fromId ?? s.world)) ?? BUILTIN_WORLDS[0]
    const nw = cloneWorld(src, uniqueWorldName(s.worlds, `${src.name} copy`))
    const worlds = [...s.worlds, nw]
    saveUserWorlds(worlds)
    set({ worlds })
    return nw.id
  },
  updateWorld: (id, partial) =>
    set((s) => {
      const worlds = s.worlds.map((w) => (w.id === id ? { ...w, ...partial } : w))
      saveUserWorlds(worlds)
      // If the edited world is the active one, re-apply it live.
      const active = worlds.find((w) => w.id === s.world)
      return active && s.world === id
        ? { worlds, composition: applyWorldToComposition(s.composition, active) }
        : { worlds }
    }),
  deleteWorld: (id) =>
    set((s) => {
      const w = s.worlds.find((x) => x.id === id)
      if (!w || w.builtin) return {} // built-ins can't be deleted
      const worlds = s.worlds.filter((x) => x.id !== id)
      saveUserWorlds(worlds)
      if (s.world !== id) return { worlds }
      // Deleting the ACTIVE world → fall back to Synthetic and apply it so the
      // composition matches the selector (else it'd keep the deleted bias).
      localStorage.setItem('opsia.world', 'synthetic')
      const syn = worlds.find((x) => x.id === 'synthetic') ?? worlds[0]
      return { worlds, world: 'synthetic', composition: applyWorldToComposition(s.composition, syn) }
    }),
  renameWorld: (id, name) => get().updateWorld(id, { name }),
  worldPageOpen: false,
  setWorldPageOpen: (on) => set({ worldPageOpen: on }),
  ndiActive: false,
  setNdiActive: (on) => set({ ndiActive: on }),
  spoutActive: false,
  setSpoutActive: (on) => set({ spoutActive: on }),
  hiveOutActive: false,
  setHiveOutActive: (on) => set({ hiveOutActive: on }),
  hiveOutPort: Number(localStorage.getItem('opsia.hiveOutPort')) || 51842,
  setHiveOutPort: (p) => {
    localStorage.setItem('opsia.hiveOutPort', String(p))
    set({ hiveOutPort: p })
  },
  outputPageOpen: false,
  setOutputPageOpen: (on) => set({ outputPageOpen: on }),

  // Global modulation mute (transient) : one click freezes every modulator's
  // output so all sliders revert to their base values. Not persisted — a live
  // "hold everything still" that the render loop honours (and mirrors to output).
  modBypass: false,
  toggleModBypass: () => set((s) => ({ modBypass: !s.modBypass })),
  metaXYPads: localStorage.getItem('opsia.metaXYPads') !== '0', // default on
  toggleMetaXYPads: () =>
    set((s) => {
      const v = !s.metaXYPads
      localStorage.setItem('opsia.metaXYPads', v ? '1' : '0')
      return { metaXYPads: v }
    }),

  // Internal render scale: multiplies the 1920×1080 base. <1 = lo-fi (coarser
  // everything, upscaled to the display); 1 = 1080p; 2 = 4K (3840×2160). The App
  // engine recreates the compositor at this resolution when it changes.
  renderScale: (() => {
    const n = Number(localStorage.getItem('opsia.renderScale'))
    return Number.isFinite(n) && n >= 0.1 && n <= 2 ? n : 1
  })(),
  setRenderScale: (v) => {
    const s = Math.max(0.1, Math.min(2, v))
    localStorage.setItem('opsia.renderScale', String(s))
    set({ renderScale: s })
  },
  // Flash safety : mild ON by default (0.35) — it barely touches normal content
  // (only >~17% full-field mean-luminance jumps get damped) but nets real strobes.
  strobeSafe: (() => {
    const n = Number(localStorage.getItem('opsia.strobeSafe'))
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.35
  })(),
  setStrobeSafe: (v) => {
    const s = Math.max(0, Math.min(1, v))
    localStorage.setItem('opsia.strobeSafe', String(s))
    set({ strobeSafe: s })
  },
  sonifyPageOpen: false,
  setSonifyPageOpen: (on) => set({ sonifyPageOpen: on }),
  recording: false,
  recordingSince: 0,
  setRecording: (on) => set({ recording: on, recordingSince: on ? performance.now() : 0 }),
  sonify: (() => {
    try {
      const raw = localStorage.getItem('opsia.sonify')
      if (raw) return { ...defaultSoniConfig(), ...JSON.parse(raw), on: false } as SoniConfig
    } catch { /* fall through to defaults */ }
    return defaultSoniConfig()
  })(),
  setSonify: (next) => {
    persistSonify(next)
    if (next.on && !sonifyEngine.isRunning()) void sonifyEngine.start().then(() => sonifyEngine.pushConfig(useStore.getState().sonify))
    else if (!next.on && sonifyEngine.isRunning()) sonifyEngine.stop()
    else sonifyEngine.pushConfig(next)
    set({ sonify: next })
  },

  // ── Assemble ──────────────────────────────────────────────────────────
  assembleFolder: localStorage.getItem('opsia.assembleFolder') ?? '',
  assembleCorpus: null,
  assembleMap: [],
  assembleParams: (() => {
    try {
      const raw = localStorage.getItem('opsia.assembleParams')
      if (raw) return { ...defaultAssembleParams(), ...JSON.parse(raw) } as AssembleParams
    } catch {
      /* fall through to defaults */
    }
    return defaultAssembleParams()
  })(),
  assemblages: (() => {
    try {
      return JSON.parse(localStorage.getItem('opsia.assemblages') || '[]') as Assemblage[]
    } catch {
      return []
    }
  })(),
  assembleBusy: null,
  setAssembleCorpus: (folder, c) => {
    localStorage.setItem('opsia.assembleFolder', folder)
    // The map is derived from the corpus : compute it once here rather than in
    // every render of the scatter plot.
    const map = c && c.units.length ? corpusMap(c.units, c.mean, c.std).pos : []
    set({ assembleFolder: folder, assembleCorpus: c, assembleMap: map })
  },
  setAssembleParams: (p) =>
    set((s) => {
      const assembleParams = { ...s.assembleParams, ...p }
      try {
        localStorage.setItem('opsia.assembleParams', JSON.stringify(assembleParams))
      } catch {
        /* quota : the recipe just won't survive a restart */
      }
      return { assembleParams }
    }),
  setAssembleBusy: (b) => set({ assembleBusy: b }),
  saveAssemblage: (a) =>
    set((s) => {
      const assemblages = [a, ...s.assemblages.filter((x) => x.id !== a.id)].slice(0, 60)
      persistAssemblages(assemblages)
      return { assemblages }
    }),
  deleteAssemblage: (id) =>
    set((s) => {
      const assemblages = s.assemblages.filter((x) => x.id !== id)
      persistAssemblages(assemblages)
      return { assemblages }
    }),
  renameAssemblage: (id, name) =>
    set((s) => {
      const assemblages = s.assemblages.map((x) => (x.id === id ? { ...x, name } : x))
      persistAssemblages(assemblages)
      return { assemblages }
    }),
  setSourceAssemble: (layer, slot, a) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: s.composition.layers.map((l, i) =>
          i !== layer
            ? l
            : {
                ...l,
                [slot === 'A' ? 'sourceA' : 'sourceB']: {
                  kind: 'assemble' as const,
                  shaderId: null,
                  inputs: {},
                  mediaId: a.id,
                  mediaName: a.name,
                  edl: a.clips,
                  videoPlaying: true,
                  videoLoop: a.params.loop
                },
                // A source swap clears that slot's FX rack, matching video/capture.
                [slot === 'A' ? 'sourceAFx' : 'sourceBFx']: []
              }
        )
      },
      selection: { type: 'source', layer, slot }
    })),

  depthMode: ((): 'off' | 'synth' | 'estimate' => {
    const m = localStorage.getItem('opsia.depthMode')
    return m === 'synth' || m === 'estimate' ? m : 'off'
  })(),
  setDepthMode: (m) => {
    localStorage.setItem('opsia.depthMode', m)
    set({ depthMode: m })
  },

  oscEnabled: localStorage.getItem('opsia.oscEnabled') === '1',
  oscPort: (() => {
    const p = Number(localStorage.getItem('opsia.oscPort'))
    return Number.isInteger(p) && p >= 1 && p <= 65535 ? p : 9000
  })(),
  oscListening: false,
  oscAddresses: [],
  setOscConfig: (partial) =>
    set((s) => {
      if (partial.enabled !== undefined)
        localStorage.setItem('opsia.oscEnabled', partial.enabled ? '1' : '0')
      if (partial.port !== undefined) localStorage.setItem('opsia.oscPort', String(partial.port))
      return {
        oscEnabled: partial.enabled ?? s.oscEnabled,
        oscPort: partial.port ?? s.oscPort,
        oscListening: partial.listening ?? s.oscListening,
        oscAddresses: partial.addresses ?? s.oscAddresses
      }
    }),

  oscOutEnabled: localStorage.getItem('opsia.oscOutEnabled') === '1',
  oscOutHost: localStorage.getItem('opsia.oscOutHost') || '127.0.0.1',
  oscOutPort: (() => {
    const p = Number(localStorage.getItem('opsia.oscOutPort'))
    return Number.isInteger(p) && p >= 1 && p <= 65535 ? p : 9001
  })(),
  oscOutIntervalMs: (() => {
    const m = Number(localStorage.getItem('opsia.oscOutIntervalMs'))
    return Number.isFinite(m) && m >= 40 && m <= 1000 ? m : 100
  })(),
  setOscOutConfig: (partial) =>
    set((s) => {
      if (partial.enabled !== undefined)
        localStorage.setItem('opsia.oscOutEnabled', partial.enabled ? '1' : '0')
      if (partial.host !== undefined) localStorage.setItem('opsia.oscOutHost', partial.host)
      if (partial.port !== undefined) localStorage.setItem('opsia.oscOutPort', String(partial.port))
      if (partial.intervalMs !== undefined)
        localStorage.setItem('opsia.oscOutIntervalMs', String(partial.intervalMs))
      return {
        oscOutEnabled: partial.enabled ?? s.oscOutEnabled,
        oscOutHost: partial.host ?? s.oscOutHost,
        oscOutPort: partial.port ?? s.oscOutPort,
        oscOutIntervalMs: partial.intervalMs ?? s.oscOutIntervalMs
      }
    }),
  collapsed: (() => {
    // Fresh-load layout: Meta and Modulation start collapsed (deep controls,
    // opened on demand); Master FX and Inspector stay open (always in play).
    // The three Finishing-Touches sub-sections start collapsed too : seeded so
    // toggleSection works from a defined value (and existing sessions inherit it).
    const FT: Record<string, boolean> = { 'ft-vibe': true, 'ft-context': true, 'ft-finalizer': true }
    const DEFAULT_COLLAPSED: Record<string, boolean> = {
      meta: true,
      modulation: true,
      output: true,
      ...FT
    }
    try {
      const saved = localStorage.getItem('opsia.collapsed')
      if (saved) return { output: true, ...FT, ...(JSON.parse(saved) as Record<string, boolean>) }
      return DEFAULT_COLLAPSED
    } catch {
      return DEFAULT_COLLAPSED
    }
  })(),
  toggleSection: (key) =>
    set((s) => {
      const collapsed = { ...s.collapsed, [key]: !s.collapsed[key] }
      localStorage.setItem('opsia.collapsed', JSON.stringify(collapsed))
      return { collapsed }
    }),

  showFinishingSub: (shaderId) =>
    set((s) => {
      const sub = `ft-${shaderId.replace('fx-', '')}`
      // Second click on an already-open sub (while Finishing is showing) closes it.
      const isOpen = s.rightView === 'finishing' && !(s.collapsed[sub] ?? true)
      const collapsed = {
        ...s.collapsed,
        'ft-vibe': true,
        'ft-context': true,
        'ft-finalizer': true,
        [sub]: isOpen // open ⇒ collapse; closed ⇒ expand (the others stay collapsed)
      }
      localStorage.setItem('opsia.collapsed', JSON.stringify(collapsed))
      return { collapsed, rightView: 'finishing', mixerView: false }
    }),

  userShaderPresets: (() => {
    try {
      return JSON.parse(localStorage.getItem('opsia.userShaderPresets') ?? '{}')
    } catch {
      return {}
    }
  })(),
  addUserShaderPreset: (shaderId, name, values) =>
    set((s) => {
      const list = s.userShaderPresets[shaderId] ?? []
      const clean = name.trim()
      if (!clean) return s
      // Same name replaces (update-in-place semantics).
      const userShaderPresets = {
        ...s.userShaderPresets,
        [shaderId]: [...list.filter((p) => p.name !== clean), { name: clean, values }]
      }
      localStorage.setItem('opsia.userShaderPresets', JSON.stringify(userShaderPresets))
      return { userShaderPresets }
    }),
  deleteUserShaderPreset: (shaderId, name) =>
    set((s) => {
      const userShaderPresets = {
        ...s.userShaderPresets,
        [shaderId]: (s.userShaderPresets[shaderId] ?? []).filter((p) => p.name !== name)
      }
      localStorage.setItem('opsia.userShaderPresets', JSON.stringify(userShaderPresets))
      return { userShaderPresets }
    }),

  scenes: [],
  activeSceneId: null,
  updateSceneFromLive: (id) =>
    set((s) => ({
      scenes: s.scenes.map((x) => (x.id === id ? { ...x, composition: s.composition } : x))
    })),
  duplicateScene: (id) =>
    set((s) => {
      const i = s.scenes.findIndex((x) => x.id === id)
      if (i < 0) return s
      const copy = { ...s.scenes[i], id: uid(), name: `${s.scenes[i].name} copy` }
      const scenes = [...s.scenes]
      scenes.splice(i + 1, 0, copy)
      return { scenes }
    }),
  saveScene: () =>
    set((s) => ({
      scenes: [
        ...s.scenes,
        {
          id: uid(),
          name: `Scene ${s.scenes.length + 1}`,
          // Compositions are immutable : the snapshot is a reference.
          composition: s.composition,
          world: s.worlds.find((w) => w.id === s.world) ?? null,
          // The sound patch travels with the scene (on/sink stay machine-local).
          sonify: { ...s.sonify, on: false, sinkId: '' }
        }
      ]
    })),
  randomSceneIntoBank: () =>
    set((s) => ({
      scenes: [
        ...s.scenes,
        {
          id: uid(),
          name: `Random ${s.scenes.length + 1}`,
          composition: randomizeComposition(s.composition, 'all')
        }
      ]
    })),
  recallScene: (id) =>
    set((s) => {
      const scene = s.scenes.find((x) => x.id === id)
      if (!scene) return s
      // Goes through the composition write path: undoable, hot-swap-safe
      // (the engine reconciles; feedback buffers survive the recall). The
      // engine crossfades to it over morphMs (App loop reads morph.ts).
      beginMorph(s.composition, s.morphMs, performance.now())
      resetCouplingState() // stale cut/drift state mustn't seed the recalled scene
      // Restore the scene's World for the selector label (composition already
      // carries its baked effect); add it to the bank if this install lacks it.
      const worlds = ensureWorld(s.worlds, scene.world)
      const world = scene.world ? scene.world.id : s.world
      if (scene.world) localStorage.setItem('opsia.world', world)
      // Normalize defensively (idempotent) : a scene may predate a schema field.
      // Recall the scene's sound patch too (keep the local on-state + device).
      if (scene.sonify) {
        const cur = s.sonify
        const next = { ...defaultSoniConfig(), ...(scene.sonify as Partial<SoniConfig>), on: cur.on, sinkId: cur.sinkId } as SoniConfig
        queueMicrotask(() => useStore.getState().setSonify(next))
      }
      return { composition: normalizeComposition(scene.composition), activeSceneId: id, worlds, world, variationBaseline: null }
    }),
  renameScene: (id, name) =>
    set((s) => ({
      scenes: s.scenes.map((x) => (x.id === id ? { ...x, name: name.trim() || x.name } : x))
    })),
  deleteScene: (id) =>
    set((s) => ({
      scenes: s.scenes.filter((x) => x.id !== id),
      activeSceneId: s.activeSceneId === id ? null : s.activeSceneId
    })),
  reorderScene: (id, beforeId) =>
    set((s) => {
      const moving = s.scenes.find((x) => x.id === id)
      if (!moving || id === beforeId) return s
      const rest = s.scenes.filter((x) => x.id !== id)
      const idx = beforeId ? rest.findIndex((x) => x.id === beforeId) : rest.length
      if (idx < 0) return s
      const next = [...rest]
      next.splice(idx, 0, moving)
      return { scenes: next }
    }),
  ensureSceneTags: (id) =>
    set((s) => {
      const scene = s.scenes.find((x) => x.id === id)
      if (!scene || scene.tags) return s
      const tags = deriveSceneTags(scene)
      return { scenes: s.scenes.map((x) => (x.id === id ? { ...x, tags } : x)) }
    }),
  setSceneTags: (id, patch) =>
    set((s) => ({
      scenes: s.scenes.map((x) =>
        x.id === id ? { ...x, tags: { ...(x.tags ?? deriveSceneTags(x)), ...patch } } : x
      )
    })),

  sequence: makeDefaultSequence(),
  setSequence: (patch) => set((s) => ({ sequence: { ...s.sequence, ...patch } })),
  toggleSequenceRunning: () =>
    set((s) => ({ sequence: { ...s.sequence, enabled: true, running: !s.sequence.running } })),
  sequenceTo: (id, variation, crossfadeMs) =>
    set((s) => {
      const scene = s.scenes.find((x) => x.id === id)
      if (!scene) return s
      beginMorph(s.composition, Math.max(0, crossfadeMs), performance.now())
      resetCouplingState()
      // Subtle per-recall variation → long sets never loop verbatim. Normalized
      // like recallScene (idempotent) so an old-shape scene can't skip migration.
      const composition = normalizeComposition(
        variation > 0 ? varyComposition(scene.composition, variation) : scene.composition
      )
      const worlds = ensureWorld(s.worlds, scene.world)
      const world = scene.world ? scene.world.id : s.world
      if (scene.world) localStorage.setItem('opsia.world', world)
      return { composition, activeSceneId: id, worlds, world, variationBaseline: null }
    }),
  sequencePageOpen: false,
  setSequencePageOpen: (on) => set({ sequencePageOpen: on }),

  newSession: () =>
    // A blank slate. Goes through the normal composition write path, so it
    // lands in undo history : an accidental New is one Ctrl+Z away.
    set((s) => {
      cancelMorph() // the composition is being replaced : stop any in-flight ease
      resetCouplingState()
      // New session resets the section layout too: Meta/Modulation collapsed,
      // Master FX/Inspector open. Persist so it survives the next reload.
      const collapsed = { ...s.collapsed, meta: true, modulation: true, master: false, inspector: false }
      localStorage.setItem('opsia.collapsed', JSON.stringify(collapsed))
      return {
        name: 'Untitled',
        // New = a fresh random one-layer scene (not a blank canvas).
        composition: seedRandomStart(makeDefaultComposition()),
        selection: { type: 'source', layer: 0, slot: 'A' },
        scenes: [],
        activeSceneId: null,
        vibePresetName: null,
        variationBaseline: null,
        sequence: makeDefaultSequence(), // empty bank → stop the auto-pilot
        sessionPath: null, // New = no file yet; next Save prompts for one.
        collapsed
      }
    }),
  generateTheme: (themeId) =>
    // Generate : a fresh, unsaved session built to a theme recipe (themes.ts).
    // Full diegetic scene : visuals + the theme's World (coupling + Context mood +
    // audio routing) + field-macro / temperament biases. Undoable (morph write path).
    set((s) => {
      const theme = THEME_BY_ID[themeId]
      if (!theme) return s
      beginMorph(s.composition, s.morphMs, performance.now()) // crossfade the reveal
      resetCouplingState()
      let comp = buildThemeComposition(theme)
      const world = s.worlds.find((w) => w.id === theme.world) ?? null
      const worlds = ensureWorld(s.worlds, world)
      if (world) comp = applyWorldToComposition(comp, world)
      // The theme's Context overrides win over the World's mood nudge.
      if (theme.context) {
        comp = {
          ...comp,
          master: comp.master.map((f) =>
            f.shaderId === 'fx-context' ? { ...f, inputs: { ...f.inputs, ...theme.context } } : f
          )
        }
      }
      // Field macros + persisted temperament (shutter/superFlicker stay state-only :
      // strobes never persist across a reload).
      localStorage.setItem('opsia.density', String(theme.density))
      localStorage.setItem('opsia.gestureTexture', String(theme.gestureTexture))
      localStorage.setItem('opsia.coalesce', String(theme.coalesce))
      localStorage.setItem('opsia.tonicity', String(theme.tonicity))
      localStorage.setItem('opsia.drift', String(theme.drift))
      localStorage.setItem('opsia.flow', String(theme.flow))
      if (world) localStorage.setItem('opsia.world', theme.world)
      return {
        name: theme.name,
        composition: comp,
        world: world ? theme.world : s.world,
        worlds,
        selection: { type: 'source', layer: 0, slot: 'A' },
        scenes: [],
        activeSceneId: null,
        vibePresetName: null,
        variationBaseline: null,
        sequence: makeDefaultSequence(),
        sessionPath: null, // Generate = unsaved; Ctrl+S keeps it.
        density: theme.density,
        gestureTexture: theme.gestureTexture,
        coalesce: theme.coalesce,
        tonicity: theme.tonicity,
        shutter: theme.shutter,
        drift: theme.drift,
        flow: theme.flow,
        superFlicker: theme.superFlicker
      }
    }),
  loadSession: (s) => {
    cancelMorph() // replacing the whole composition : abort any in-flight morph
    resetCouplingState()
    // Restore the session's World (self-contained → add to bank if missing).
    const cur = get()
    const worlds = ensureWorld(cur.worlds, s.world)
    const world = s.world ? s.world.id : cur.world
    if (s.world) localStorage.setItem('opsia.world', world)
    // Theme travels with the self-contained session (like world + sequencer).
    // Older files without a saved theme keep the current one.
    const savedTheme = (s.ui as { theme?: ThemeName } | undefined)?.theme
    if (savedTheme) {
      applyTheme(savedTheme)
      localStorage.setItem('opsia.theme', savedTheme)
    }
    return set({
      name: s.name,
      theme: savedTheme ?? cur.theme,
      worlds,
      world,
      // Scenes migrate too : recalling one must never push an un-normalized
      // composition (missing Background slab / finalizer tail) live.
      scenes: (s.scenes ?? []).map((sc) => ({ ...sc, composition: normalizeComposition(sc.composition) })),
      activeSceneId: null,
      variationBaseline: null,
      // Sequencer travels with the session; auto-resumes if it was running.
      sequence: { ...makeDefaultSequence(), ...(s.sequence ?? {}) },
      composition: normalizeComposition(s.composition)
    })
    // The session's sound patch (post-set so setSonify's engine push sees it).
    if (s.sonify) {
      const curSoni = get().sonify
      get().setSonify({
        ...defaultSoniConfig(),
        ...(s.sonify as Partial<SoniConfig>),
        on: curSoni.on,
        sinkId: curSoni.sinkId
      } as SoniConfig)
    }
  },
  exportSession: () => {
    const s = get()
    return {
      version: 1,
      name: s.name,
      composition: s.composition,
      scenes: s.scenes,
      world: s.worlds.find((w) => w.id === s.world) ?? null,
      sequence: s.sequence,
      sonify: { ...s.sonify, on: false, sinkId: '' },
      ui: { theme: s.theme }
    }
  }
}))

// Apply the persisted theme on module load so first paint is themed.
applyTheme(useStore.getState().theme)
