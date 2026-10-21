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
  ModShape,
  ModTarget,
  ModulatorConfig,
  SceneEntry,
  SceneTags,
  SequenceState,
  Session,
  SoniSeq,
  SoniSeqStep,
  SoniSeqRate,
  SoniKeySeq,
  SoniKeyStep,
  SidechainRef,
  SourceSlot,
  World, LightPath } from '@shared/types'
import type { MetaKnobState, MidiBinding, LightConfig, BodyControlConfig, AudioLayerSlot, AudioLayerState } from '@shared/types'
import type { Assemblage, AssembleCorpus, AssembleParams } from '@shared/assemble'
import type { ResolumeMap, ResoOutput, ResoInput, ResoCell, ResoSession } from '@shared/resolume'
import { DF_DEFAULT_CONFIG, type DfConfig } from '@shared/dataflou'
import { defaultResolumeMap, resoCatalogue, RESO_SNAPSHOTS } from '@shared/resolume'
import type { DomeConfig } from '@shared/dome'
import type { NdiConfig, NdiStatus } from '@shared/ndi'
import { sanitizeNdiConfig, idleNdiStatus } from '@shared/ndi'
import { DOME_MOD_RANGE, sanitizeDome } from '@shared/dome'
import { OUT_IDENTITY, OUTX_MOD_RANGE, sanitizeOutXform, type OutXform } from '@shared/outXform'
import { auBaseOf, auFileField, auSpan, auTargetAlive } from '@shared/auMod'
import { defaultVoicePlaces, sanitizeSpaceConfig, sanitizeVoicePlaces, validSpaceHost, type SpaceConfig, type SpaceVoice, type VoicePlace } from '@shared/spatial'
import { defaultInputs, inputsForShader } from './shaders/isf/inputs'
import { SHADER_BY_ID } from './shaders/isf'
import { canHostFx } from './fxScopes'
import { modTargetKey } from './modKey'
import { graftPins, isPinnedTarget, keepPersistent, keepPinnedUnits, layerPin, sameDeep } from './persist'
import { defaultAssembleParams } from '@shared/assemble'
import { corpusMap } from './assemble/match'
import { BLEND_MODES, DEFAULT_LAYER_VARY, FX_OPACITY_INPUT, MAX_MOD_ASSIGNMENTS, META_KNOB_COUNT, META_MAX_DESTS } from '@shared/types'
import { makeDefaultModulator, makeDefaultModulators } from './engine/modulation'
import { sanitizeModShape } from './engine/modShape'
import { beginSceneMorph, beginRelayMorph, cancelMorph, requestSceneChange } from './morph'
import { DEFAULT_LIGHT_PATH } from './lightPath'
import { autoSurfacePos } from './surface'
import { defaultSoniConfig, sonifyEngine, type SoniConfig } from './audio/sonify'
import { audioLayer, defaultAudioLayer, NOT_ARMED, sanitizeAudioLayer, type AudioLayerArmed } from './audio/audioLayer'
import { emitSessionLoaded } from './sessionEvents'
import { tempoEdited } from './tempoEvents'
import { playEdited } from './playEvents'
import { registerUserShader, remapShaderIds, userShaderId, userShaderIdsIn, type UserShaderInfo } from './shaders/userShaders'
import { makeDefaultKeySeq, sanitizeKeySeq } from './audio/soniKeyModel'
import { isSoniRate } from './audio/soniClock'
import { resetCouplingState } from './engine/coupling'
import {
  adoptLegacyWorldMod, applyWorldToComposition, BUILTIN_WORLDS, cloneWorld, deriveSceneTags, dropWorldKeys, isWorldRow,
  sanitizeWorld, sanitizeWorldBase, sansBlur, worldFromComposition, worldModIndex, worldRouteSkip
} from './worlds'
import { setWorldAmountBase } from './engine/worldAmount'
import { showToast } from './components/Toast'

// User worlds (builtin === false) persist to localStorage; built-ins ship in code.
export function saveUserWorlds(worlds: World[]): void {
  try {
    localStorage.setItem('opsia.userWorlds', JSON.stringify(worlds.filter((w) => !w.builtin)))
  } catch {
    /* quota / serialization : non-fatal */
  }
}
// A stored user world goes through sanitizeWorld (numbers finite and in range,
// the coupling and the audio routing well formed) : a World edited into nonsense
// can never break the page or the picture, at this launch or the next. One that
// is not a World at all (no id), or reuses a built-in's id, is dropped.
function loadWorlds(): World[] {
  try {
    const u = JSON.parse(localStorage.getItem('opsia.userWorlds') || '[]')
    const out = [...BUILTIN_WORLDS]
    for (const raw of Array.isArray(u) ? u : []) {
      const w = sanitizeWorld(raw)
      if (w && !out.some((x) => x.id === w.id)) out.push({ ...w, builtin: false })
    }
    return out
  } catch {
    return [...BUILTIN_WORLDS]
  }
}
// Add a World to the bank if its id isn't already present (session/scene
// restore of a world this install doesn't have), sanitized first. Persists
// user worlds.
function ensureWorld(worlds: World[], w: World | null | undefined): World[] {
  const clean = sanitizeWorld(w)
  if (!clean || worlds.some((x) => x.id === clean.id)) return worlds
  const merged = [...worlds, { ...clean, builtin: false }]
  saveUserWorlds(merged)
  return merged
}
// The World a session or scene names, when the bank has it (else the one active).
function worldIdIn(worlds: World[], w: World | null | undefined, cur: string): string {
  return w && typeof w.id === 'string' && worlds.some((x) => x.id === w.id) ? w.id : cur
}
// The user changes the World's modulator, or one of its bindings : from then on
// it is theirs, and no World takes it back or deletes it.
function releaseWorldMod(mods: ModulatorConfig[], i: number): ModulatorConfig[] {
  if (!mods[i]?.fromWorld) return mods
  return mods.map((m, j) => {
    if (j !== i) return m
    const { worldRows: _rows, ...rest } = m
    return { ...rest, fromWorld: false }
  })
}
// ...the modulator a binding rides, when that one is the World's.
function releaseWorldModOfRow(c: CompositionState, id: string): ModulatorConfig[] {
  const a = c.modMatrix.find((x) => x.id === id)
  return a ? releaseWorldMod(c.modulators, a.mod) : c.modulators
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
  jitterLayer,
  randomizeRack,
  randomizeSingleLayer,
  seedRandomStart,
  themedMotion,
  varyComposition,
  type RandomizeScope
} from './randomize'
import { BG_DEFAULT_SPEED, BG_SPEED_MAX, BG_SOURCES } from './bgPresets'
import { THEME_BY_ID, motionFor, type Theme } from './themes'

export type { FxScope }

// ── Themes (lifted from dataFLOU; palettes live in styles.css) ────────
export type ThemeName =
  | 'nature'
  | 'studio'
  | 'warm'
  | 'graphite'
  | 'cream'
  | 'paper'
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
  'studio',
  'warm',
  'graphite',
  'nature',
  'cream',
  'paper',
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
// identity (brief §1). Studio is the neutral matte surface the
// instrument ships on out of the box.
const DEFAULT_THEME: ThemeName = 'studio'

// Old theme ids renamed over time : migrate rather than silently dropping whoever
// had one selected back to the default. ('studio-dark'→'studio', 'paper-light'→'paper',
// 'warm-charcoal'→'warm'.)
export function migrateThemeName(raw: string | null | undefined): ThemeName | null {
  if (!raw) return null
  const map: Record<string, ThemeName> = {
    'warm-charcoal': 'warm',
    'studio-dark': 'studio',
    'paper-light': 'paper'
  }
  return (map[raw] ?? raw) as ThemeName
}

function loadTheme(): ThemeName {
  const saved = migrateThemeName(localStorage.getItem('opsia.theme'))
  return saved && THEME_ORDER.includes(saved) ? saved : DEFAULT_THEME
}

function applyTheme(t: ThemeName): void {
  document.documentElement.setAttribute('data-theme', t)
}

// ── Composition factory ───────────────────────────────────────────────
// ── Resolume mapper helpers ─────────────────────────────────────────────
// Fields that stay editable while the mapping is locked : sending on/off, the
// destination and rate, and the scene-follow switch are performance controls.
const RESO_LOCK_FREE = new Set(['enabled', 'host', 'port', 'rateHz', 'locked', 'sceneColumns', 'columnOffset'])
const RESO_DEFAULT_ROWS = (): string[] => [
  'mod:1', 'mod:2', 'mod:3', 'mod:4', 'mod:5', 'mod:6', 'mod:7', 'mod:8',
  'vision:brightness', 'vision:motion', 'vision:contrast', 'vision:edges', 'vision:warmth', 'vision:hue',
  'audio:level', 'audio:transient', 'audio:centroid', 'audio:noisiness'
]
function freshInput(source: string): ResoInput {
  return { id: Math.random().toString(36).slice(2, 10), source, smooth: 0.15, gain: 1 }
}
function sanitizeResolume(raw: unknown): ResolumeMap {
  const d = defaultResolumeMap()
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ResolumeMap>
  const arr = <T,>(v: unknown, fb: T[]): T[] => (Array.isArray(v) ? (v as T[]) : fb)
  const snaps = arr<ResoCell[] | null>(r.snapshots, d.snapshots)
  return {
    ...d,
    ...r,
    host: typeof r.host === 'string' && r.host ? r.host : d.host,
    port: Number.isFinite(r.port) ? Math.max(1, Math.min(65535, Number(r.port))) : d.port,
    rateHz: Number.isFinite(r.rateHz) ? Math.max(1, Math.min(120, Number(r.rateHz))) : d.rateHz,
    inputs: arr<ResoInput>(r.inputs, []),
    outputs: arr<ResoOutput>(r.outputs, []),
    cells: arr<ResoCell>(r.cells, []),
    folded: arr<string>(r.folded, []),
    snapshots: Array.from({ length: RESO_SNAPSHOTS }, (_, i) => snaps[i] ?? null),
    session: r.session ?? null
  }
}
// The dataflou mesh section : on/off, this node's name and universe (per
// machine, like OSC). The node itself runs in main (src/main/dataflou).
function loadDataflou(): DfConfig {
  try {
    const raw = localStorage.getItem('opsia.dataflou')
    if (raw) {
      const j = JSON.parse(raw) as Partial<DfConfig>
      return {
        enabled: !!j.enabled,
        label: typeof j.label === 'string' && j.label.trim() ? j.label.slice(0, 32) : DF_DEFAULT_CONFIG.label,
        universe: typeof j.universe === 'string' && j.universe.trim() ? j.universe.slice(0, 32) : DF_DEFAULT_CONFIG.universe
      }
    }
  } catch {
    /* fall through to the defaults */
  }
  return { ...DF_DEFAULT_CONFIG }
}
function loadResolume(): ResolumeMap {
  try {
    const raw = localStorage.getItem('opsia.resolume')
    if (raw) return sanitizeResolume(JSON.parse(raw))
  } catch {
    /* fall through to a fresh mapping */
  }
  return { ...defaultResolumeMap(), inputs: RESO_DEFAULT_ROWS().map(freshInput) }
}
/** Recording choices, per machine (like the NDI config) : the delivery format
 *  and the frame rate a real-time format records at. */
export interface RecordPrefs {
  format: string
  fps: 30 | 60
}
function loadRecordPrefs(): RecordPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem('opsia.record') ?? 'null') as Partial<RecordPrefs> | null
    return { format: typeof raw?.format === 'string' ? raw.format : 'mp4-h264', fps: raw?.fps === 60 ? 60 : 30 }
  } catch {
    return { format: 'mp4-h264', fps: 30 }
  }
}
function loadNdi(): NdiConfig {
  try {
    const raw = localStorage.getItem('opsia.ndi')
    if (raw) return sanitizeNdiConfig(JSON.parse(raw))
  } catch {
    /* defaults */
  }
  return sanitizeNdiConfig(null)
}
function loadSpace(): SpaceConfig {
  try {
    const raw = localStorage.getItem('opsia.space')
    if (raw) return sanitizeSpaceConfig(JSON.parse(raw))
  } catch {
    /* defaults */
  }
  return sanitizeSpaceConfig(null)
}
// Saved a moment after the last change : OSC and the sliders move it often.
let spaceSave = 0
function persistSpace(c: SpaceConfig): SpaceConfig {
  window.clearTimeout(spaceSave)
  spaceSave = window.setTimeout(() => {
    try { localStorage.setItem('opsia.space', JSON.stringify(c)) } catch { /* quota */ }
  }, 300)
  return c
}
function loadDome(): DomeConfig {
  try {
    const raw = localStorage.getItem('opsia.dome')
    // The mapping is remembered; the dome itself always starts OFF, and so does
    // its alignment grid (a setup aid : never left burned into a show).
    if (raw) return { ...sanitizeDome(JSON.parse(raw)), enabled: false, grid: false }
  } catch {
    /* fresh defaults */
  }
  return sanitizeDome(null)
}
function persistDome(d: DomeConfig): DomeConfig {
  try {
    localStorage.setItem('opsia.dome', JSON.stringify(d))
  } catch {
    /* ignore quota */
  }
  return d
}
function persistResolume(r: ResolumeMap): ResolumeMap {
  try {
    localStorage.setItem('opsia.resolume', JSON.stringify(r))
  } catch {
    /* a full quota must never break an edit */
  }
  return r
}

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
      parasites: 0.1,
      // Present on every finalizer made since film damage stopped needing Film
      // Hold : the marker normalizeComposition's one-time migration looks for.
      filmGauge: 1
    }
  }
}

// The Cameraless / direct-film input names on the Finalizer. Removing these keys
// drops the finalizer back to a clean grade (they fall to their neutral ISF
// defaults : hold off, no dust / scratch). Used by New to open a
// blank slate even when the active World is a direct-film mode : Griffé / Peint
// / Pressé inject filmHold + dust via applyWorldToComposition, which is what
// used to make a New session open with drawn-film "rectangles" over the picture.
const FINALIZER_FILM_KEYS = [
  'filmHold', 'filmRate', 'filmJitter', 'filmBoil', 'filmFlutter',
  'filmBlank', 'filmBlankMode', 'filmDust', 'filmScratch', 'filmGauge', 'filmDirt',
  'filmGranule', 'filmSplice'
] as const

export function clearFinalizerFilm(c: CompositionState): CompositionState {
  const film = new Set<string>(FINALIZER_FILM_KEYS)
  // The World's film goes with it : nothing of it is left for the World amount to fade.
  return {
    ...dropWorldKeys(c, film),
    master: (c.master ?? []).map((f) =>
      f.shaderId === 'fx-finalizer'
        ? { ...f, inputs: { ...Object.fromEntries(Object.entries(f.inputs).filter(([k]) => !film.has(k))), filmGauge: 1 } }
        : f
    )
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
    try {
      localStorage.setItem('opsia.sonify', JSON.stringify({ ...cfg, on: false }))
    } catch {
      // Quota : the patch still works this session, it just won't survive a restart.
      console.warn('[sonify] could not persist the config (quota)')
    }
  }, 250)
}

function makeDefaultSoniSeq(): SoniSeq {
  return {
    on: false,
    stepMs: 1000,
    len: 8,
    cur: 0,
    mode: 'forward',
    bounceDecay: 60,
    bias: 0,
    edge: 'wrap',
    steps: Array.from({ length: 16 }, () => ({
      voices: [false, false, false, false, false, false, false, false, false, false, false],
      preset: ''
    }))
  }
}
let soniSeqPersistTimer: ReturnType<typeof setTimeout> | null = null
function persistSoniSeq(sq: SoniSeq): void {
  if (soniSeqPersistTimer) clearTimeout(soniSeqPersistTimer)
  soniSeqPersistTimer = setTimeout(() => {
    soniSeqPersistTimer = null
    try {
      // Runtime toggles (on/cur) never persist : the sequence opens paused at 0.
      localStorage.setItem('opsia.soniSeq', JSON.stringify({ ...sq, on: false, cur: 0 }))
    } catch {
      console.warn('[soniSeq] could not persist (quota)')
    }
  }, 250)
}
function sanitizeSoniSeq(raw: unknown, fallback: SoniSeq): SoniSeq {
  if (!raw || typeof raw !== 'object') return fallback
  const d = makeDefaultSoniSeq()
  const s = raw as Partial<SoniSeq>
  const steps = Array.isArray(s.steps)
    ? d.steps.map((ds, i) => {
        const st = s.steps![i] as Partial<SoniSeqStep> | undefined
        return {
          // 8 = saved before the Collage voice, 9 before Signal : padded, the
          // newer voices stay off in those steps.
          // 10 before the Assemblage voice.
          voices: Array.isArray(st?.voices) && st!.voices.length >= 8 && st!.voices.length <= 11
            ? [...st!.voices.map(Boolean), false, false, false].slice(0, 11)
            : ds.voices,
          preset: typeof st?.preset === 'string' ? st!.preset : ''
        }
      })
    : fallback.steps
  return {
    on: false, // never auto-run on load
    cur: 0,
    rate: isSoniRate(s.rate) ? s.rate : 'free',
    stepMs: typeof s.stepMs === 'number' ? Math.max(30, Math.min(20000, s.stepMs)) : fallback.stepMs,
    len: typeof s.len === 'number' ? Math.max(2, Math.min(16, s.len | 0)) : fallback.len,
    mode: s.mode === 'bounce' || s.mode === 'drift' ? s.mode : 'forward',
    bounceDecay: typeof s.bounceDecay === 'number' ? Math.max(0, Math.min(100, s.bounceDecay)) : fallback.bounceDecay,
    bias: typeof s.bias === 'number' ? Math.max(-100, Math.min(100, s.bias)) : fallback.bias,
    edge: s.edge === 'reflect' ? 'reflect' : 'wrap',
    steps
  }
}
// The key sequencer (root / scale over time) : the same machine-local memory
// as the step sequence, saved stopped.
let soniKeySeqPersistTimer: ReturnType<typeof setTimeout> | null = null
function persistSoniKeySeq(ks: SoniKeySeq): void {
  if (soniKeySeqPersistTimer) clearTimeout(soniKeySeqPersistTimer)
  soniKeySeqPersistTimer = setTimeout(() => {
    soniKeySeqPersistTimer = null
    try {
      localStorage.setItem('opsia.soniKeySeq', JSON.stringify({ ...ks, on: false }))
    } catch {
      console.warn('[soniKeySeq] could not persist (quota)')
    }
  }, 250)
}
function loadSoniKeySeq(): SoniKeySeq {
  try {
    const raw = localStorage.getItem('opsia.soniKeySeq')
    return raw ? sanitizeKeySeq(JSON.parse(raw), makeDefaultKeySeq()) : makeDefaultKeySeq()
  } catch {
    return makeDefaultKeySeq()
  }
}

function loadSoniSeq(): SoniSeq {
  try {
    const raw = localStorage.getItem('opsia.soniSeq')
    return raw ? sanitizeSoniSeq(JSON.parse(raw), makeDefaultSoniSeq()) : makeDefaultSoniSeq()
  } catch {
    return makeDefaultSoniSeq()
  }
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

/** The FX chain an FX scope names. */
function fxChainOf(st: { composition: CompositionState }, s: FxScope): FxInstance[] | undefined {
  return s.kind === 'master'
    ? st.composition.master
    : s.kind === 'background'
      ? st.composition.background?.fx
      : s.kind === 'layer'
        ? st.composition.layers[s.layer]?.fx
        : s.kind === 'sourceA'
          ? st.composition.layers[s.layer]?.sourceAFx
          : st.composition.layers[s.layer]?.sourceBFx
}

/** The ISF input a mod target drives : its shader, the stored inputs and the
 *  input name. null for targets that are not an ISF input (Meta knobs, layer
 *  params, video slots, an FX's dry/wet, Sonify). */
function shaderInputOf(
  st: { composition: CompositionState },
  t: ModTarget
): { shaderId: string; inputs: Record<string, number | number[]> | undefined; input: string } | null {
  if (t.kind === 'source') {
    const l = st.composition.layers[t.layer]
    const slot = t.slot === 'A' ? l?.sourceA : l?.sourceB
    return slot?.shaderId ? { shaderId: slot.shaderId, inputs: slot.inputs, input: t.input } : null
  }
  if (t.kind === 'bgSource') {
    const src = st.composition.background?.source
    return src?.shaderId ? { shaderId: src.shaderId, inputs: src.inputs, input: t.input } : null
  }
  if (t.kind === 'fx') {
    if (t.input === FX_OPACITY_INPUT) return null
    const inst = fxChainOf(st, t.scope)?.find((f) => f.id === t.instId)
    return inst?.shaderId ? { shaderId: inst.shaderId, inputs: inst.inputs, input: t.input } : null
  }
  return null
}

/** True when a mod target is an on/off toggle (a bool or event input) : both
 *  modulation modes drive a toggle by the same law, so the mul/rep chip shows
 *  a fixed label for it. */
export function isToggleTarget(st: { composition: CompositionState }, t: ModTarget): boolean {
  try {
    const r = shaderInputOf(st, t)
    if (!r) return false
    const ty = inputsForShader(r.shaderId).find((x) => x.name === r.input)?.type
    return ty === 'bool' || ty === 'event'
  } catch {
    return false
  }
}

/** Normalized (0..1) CURRENT base of a mod target, for assignMod's automatic
 *  mode choice. 0.5 (→ multiply) wherever the base can't be resolved. */
function baseNormForTarget(st: { composition: CompositionState; dome?: DomeConfig; outXform?: OutXform; worldAmount?: number; audioLayer?: AudioLayerState }, t: ModTarget): number {
  try {
    if (t.kind === 'meta') return st.composition.metaKnobs[t.knob]?.value ?? 0.5
    if (t.kind === 'au') {
      // A pan at the center, a playhead (a place : a multiple of it means
      // little) : Replace, a swing a binding is heard at at once.
      if (t.field === 'playhead') return 0
      const al = st.audioLayer
      const b = al ? auBaseOf(al, t) : null
      if (b === null) return 0.5
      if (t.field === 'pan') return Math.abs(b)
      const r = auSpan(t.field)
      return (b - r.min) / (r.max - r.min)
    }
    if (t.kind === 'dome') {
      if (!st.dome) return 0.5
      const r = DOME_MOD_RANGE[t.field]
      return (st.dome[t.field] - r.min) / (r.max - r.min)
    }
    if (t.kind === 'world') return st.worldAmount ?? 1
    if (t.kind === 'outx') {
      if (!st.outXform) return 0.5
      const r = OUTX_MOD_RANGE[t.field]
      return (st.outXform[t.field] - r.min) / (r.max - r.min)
    }
    if (t.kind === 'bg') {
      const b = st.composition.background
      if (!b) return 0.5
      return t.field === 'opacity' ? b.opacity : t.field === 'speed' ? (b.speed ?? BG_DEFAULT_SPEED) / BG_SPEED_MAX : (b.depth ?? 0)
    }
    if (t.kind === 'layer') {
      const l = st.composition.layers[t.layer]
      if (!l) return 0.5
      if (t.field === 'opacity') return l.opacity
      if (t.field === 'mix') return l.sourceMix
      const i = BLEND_MODES.indexOf(l.blend)
      return BLEND_MODES.length > 1 ? Math.max(0, i) / (BLEND_MODES.length - 1) : 0.5
    }
    // FX dry/wet opacity is a compositor property, not an ISF input : its base
    // is the unit's opacity (default 1), so a full-wet FX defaults to Multiply.
    if (t.kind === 'fx' && t.input === FX_OPACITY_INPUT) {
      return fxChainOf(st, t.scope)?.find((f) => f.id === t.instId)?.opacity ?? 1
    }
    // video slots, Sonify etc : neutral, keep multiply (their defaults are non-zero)
    const r = shaderInputOf(st, t)
    if (!r) return 0.5
    const d = inputsForShader(r.shaderId).find((x) => x.name === r.input)
    if (!d) return 0.5
    const raw = r.inputs?.[r.input]
    // A toggle : its state. An enum : its place among its values (one sitting on
    // its FIRST value under Multiply could never leave it).
    if (d.type === 'bool' || d.type === 'event') {
      const on = typeof raw === 'number' ? raw : typeof d.def === 'number' ? d.def : 0
      return on >= 0.5 ? 1 : 0
    }
    if (d.type === 'long' && d.values && d.values.length > 1) {
      const lo = Math.min(...d.values)
      const hi = Math.max(...d.values)
      const cur = typeof raw === 'number' ? raw : typeof d.def === 'number' ? d.def : lo
      return hi > lo ? (cur - lo) / (hi - lo) : 0.5
    }
    if (d.type !== 'float' || typeof d.min !== 'number' || typeof d.max !== 'number' || d.max === d.min)
      return 0.5
    const v = typeof raw === 'number' ? raw : typeof d.def === 'number' ? d.def : d.min
    return (v - d.min) / (d.max - d.min)
  } catch {
    return 0.5
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

// Every edit put on a slot this run, saved or not (newest last, a few dozen) :
// the slot only carries the edit's clips, so an edit cut from the Inspector is
// found here again with its seed, recipe and folder (the assemble tab saves,
// varies and exports it). Not persisted : after a restart the slot's own fields
// are all there is (place.ts : assemblageOfSlot).
const placedEdits = new Map<string, Assemblage>()
function rememberPlacedEdit(a: Assemblage): void {
  placedEdits.delete(a.id)
  placedEdits.set(a.id, a)
  while (placedEdits.size > 24) placedEdits.delete(placedEdits.keys().next().value as string)
}
/** An edit placed on a slot this run (saved or not), by id. */
export function placedAssemblage(id: string | null | undefined): Assemblage | null {
  return (id && placedEdits.get(id)) || null
}

function persistMacro(key: string, v: number): void {
  const t = persistTimers.get(key)
  if (t) clearTimeout(t)
  persistTimers.set(
    key,
    setTimeout(() => {
      try {
        localStorage.setItem(key, String(v))
      } catch {
        // Quota : the live value already hit the store; only its persistence is lost.
        console.warn(`[macro] could not persist ${key} (quota)`)
      }
    }, 250)
  )
}

// The Feel macros belong to the session (Session.feel) : each starts neutral,
// New resets them, a Generate sets them for the session it makes, a session
// brings its own back. They used to live on this computer (localStorage), so a
// Generate's Density went on dimming the upper layers of every session after.
type FeelMacros = NonNullable<Session['feel']>
export const FEEL_NEUTRAL: FeelMacros = { density: 0.5, gestureTexture: 0.5, coalesce: 0.5, tonicity: 0, drift: 0, flow: 0.5 }
function sanitizeFeel(f: unknown): FeelMacros {
  const o = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>
  const v = (k: keyof FeelMacros): number => {
    const n = Number(o[k])
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : FEEL_NEUTRAL[k]
  }
  return { density: v('density'), gestureTexture: v('gestureTexture'), coalesce: v('coalesce'), tonicity: v('tonicity'), drift: v('drift'), flow: v('flow') }
}
// (the keys they were kept under on this computer : gone, so none comes back)
for (const k of ['opsia.density', 'opsia.gestureTexture', 'opsia.coalesce', 'opsia.tonicity', 'opsia.drift', 'opsia.flow']) {
  try { localStorage.removeItem(k) } catch { /* private storage */ }
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

// An Assemblage slot saved before the slot kept its corpus folder (mediaPath) :
// the bank's saved edit of that id knows it. The folder holds the clips'
// originals, with their sound (Sonify's Assemblage voice; a converted copy has
// none). The bank is machine-local : without that edit in it, the clips that
// play from a copy stay silent, as before.
function withAssembleFolder(sl: SourceSlot): SourceSlot {
  if (sl.kind !== 'assemble' || sl.mediaPath || !sl.mediaId) return sl
  let bank: Assemblage[]
  try {
    bank = useStore.getState().assemblages
  } catch {
    return sl // (called before the store exists)
  }
  const folder = bank.find((a) => a.id === sl.mediaId)?.folder
  return folder ? { ...sl, mediaPath: folder } : sl
}

// Shader ids renamed since a file could hold them : the old id plays its heir
// (Impasto became Cloud Study : what was saved in between holds 'impasto').
const SHADER_ALIASES: Record<string, string> = { impasto: 'cloud-study' }
const SHADER_ALIAS_MAP = new Map(Object.entries(SHADER_ALIASES))
function aliasSlot<T extends SourceSlot | null | undefined>(sl: T): T {
  const to = sl?.shaderId ? SHADER_ALIASES[sl.shaderId] : undefined
  return to ? ({ ...sl, shaderId: to } as T) : sl
}
/** A stored preset bank with the renamed shader ids replaced (read once). */
function aliasShaderIds<T>(v: T): T {
  const j = JSON.stringify(v) ?? ''
  return [...SHADER_ALIAS_MAP.keys()].some((id) => j.includes(`"${id}"`)) ? remapShaderIds(v, SHADER_ALIAS_MAP) : v
}
/** The per-shader preset bank (keyed by shader id) under the renamed ids. */
function aliasPresetKeys<T>(bank: Record<string, T[]>): Record<string, T[]> {
  if (!bank || typeof bank !== 'object') return bank
  for (const [from, to] of SHADER_ALIAS_MAP) {
    if (!Array.isArray(bank[from])) continue
    bank[to] = [...(Array.isArray(bank[to]) ? bank[to] : []), ...bank[from]]
    delete bank[from]
  }
  return bank
}

// Inputs a shader no longer has (Stutter's punch-in fire) : a binding on one is
// a dead row that still counts toward the caps, and the unit being there keeps
// it alive for the "drop dead rows" rescue. They go on load.
const REMOVED_INPUTS: Record<string, readonly string[]> = { 'fx-stutter': ['trig'] }
const REMOVED_NAMES = new Set(Object.values(REMOVED_INPUTS).flat())
function dropRemovedInputs(c: CompositionState): CompositionState {
  const maybe = (t: ModTarget): boolean => t.kind === 'fx' && REMOVED_NAMES.has(t.input)
  if (!c.modMatrix.some((a) => maybe(a.target)) && !c.metaKnobs.some((k) => k.destinations.some(maybe))) return c
  return dropTargets(c, (t) => {
    if (t.kind !== 'fx' || !REMOVED_NAMES.has(t.input)) return false
    const sid = fxArrayFor(c, t.scope).find((f) => f.id === t.instId)?.shaderId
    return !!sid && !!REMOVED_INPUTS[sid]?.includes(t.input)
  })
}

// The gate hair is gone (the Finalizer's filmHair) : an older session's value
// goes, and with it its modulation rows, its Meta destinations and what a World
// left of it to fade (no dead rows).
function withoutGateHair(c: CompositionState): CompositionState {
  const fin = new Set((c.master ?? []).filter((f) => f.shaderId === 'fx-finalizer').map((f) => f.id))
  const hit = (t: ModTarget | undefined): boolean => !!t && t.kind === 'fx' && t.input === 'filmHair' && fin.has(t.instId)
  const drop = <T>(r: Record<string, T> | undefined): Record<string, T> | undefined => {
    if (!r || typeof r !== 'object' || !('filmHair' in r)) return r
    const { filmHair: _gone, ...rest } = r
    return rest
  }
  return {
    ...c,
    master: c.master?.map((f) => (fin.has(f.id) && f.inputs && 'filmHair' in f.inputs ? { ...f, inputs: drop(f.inputs)! } : f)),
    modMatrix: c.modMatrix?.filter((a) => !hit(a.target)),
    metaKnobs: c.metaKnobs?.map((k) => (k?.destinations?.some(hit) ? { ...k, destinations: k.destinations.filter((t) => !hit(t)) } : k)),
    worldBase: drop(c.worldBase),
    worldShift: drop(c.worldShift)
  }
}

// Migrate a composition loaded from disk (or a recalled scene) up to the current
// schema : backfill new layer/background/master/modulator/metaKnob fields so an
// older session — or a scene inside one — can never hand the engine an undefined
// slab or a locked-tail that's missing the Vibe → Context → Finalizer stages.
// Idempotent : safe to run on an already-current composition.
export function normalizeComposition(c: CompositionState): CompositionState {
  c = withoutGateHair(c)
  return dropRemovedInputs({
    ...c,
    // a hand-edited session with no BPM (or null) : the default, not a NaN tempo
    bpm: Number.isFinite(c.bpm) ? c.bpm : 120,
    // Older sessions have no Background slab : normalize to the blank (off) one;
    // an older slab gets the fields it lacks (a missing speed ran the clock at 0).
    background: c.background
      ? {
          ...makeBlankBackground(),
          ...c.background,
          source: aliasSlot(c.background.source) ?? emptySlot(),
          fx: Array.isArray(c.background.fx) ? c.background.fx : [],
          opacity: typeof c.background.opacity === 'number' ? c.background.opacity : 1,
          speed: typeof c.background.speed === 'number' ? c.background.speed : BG_DEFAULT_SPEED,
          depth: typeof c.background.depth === 'number' ? c.background.depth : 0
        }
      : makeBlankBackground(),
    // Normalize layers from older session files : new fields get defaults.
    layers: c.layers.map((l) => ({
      ...l,
      ...(l.sourceA ? { sourceA: withAssembleFolder(aliasSlot(l.sourceA)) } : {}),
      ...(l.sourceB ? { sourceB: withAssembleFolder(aliasSlot(l.sourceB)) } : {}),
      feedbackAmount: l.feedbackAmount ?? 0.6,
      sourceMix: l.sourceMix ?? 0.5,
      sourceBlend: l.sourceBlend ?? 'normal',
      // -1 match … 0 untouched … 1 clash (sessions before 1.3 hold 0..1 : the same side)
      harmony: Number.isFinite(l.harmony) ? Math.max(-1, Math.min(1, l.harmony)) : 0,
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
      let finalizer = find('fx-finalizer') ?? makeFinalizer()
      // Film damage no longer waits for Film Hold. A finalizer saved before that
      // (no filmGauge key) with the hold off carried dust / scratch values nobody
      // could see (Randomize used to roll them) : drop those once, and stamp
      // filmGauge so a newer session is never migrated again.
      if (!('filmGauge' in finalizer.inputs)) {
        const fi = finalizer.inputs
        const holdOn = Math.round(Number(fi.filmHold) || 0) > 0
        finalizer = { ...finalizer, inputs: { ...fi, ...(holdOn ? {} : { filmDust: 0, filmScratch: 0 }), filmGauge: 1 } }
      }
      const rest = m.filter(
        (f) => f.shaderId !== 'fx-vibe' && f.shaderId !== 'fx-context' && f.shaderId !== 'fx-finalizer'
      )
      return [...rest, vibe, context, finalizer]
    })(),
    // Always 8 slots : a short array pads with disabled defaults (worlds.ts writes
    // the World's modulator slot directly, which would else punch holes), a long
    // one truncates, and each stored slot field-MERGES onto the default so a new
    // block (e.g. `audio`) can't read undefined.
    modulators: (() => {
      const m = c.modulators ?? []
      return makeDefaultModulators().map((d, i) => ({ ...d, ...(m[i] ?? {}) }))
    })(),
    // a binding's shaping, checked (a hand-edited file, an older or newer one)
    modMatrix: (c.modMatrix ?? []).map((a) => {
      if (!a.shape) return a
      const shape = sanitizeModShape(a.shape, a.mod)
      const { shape: _old, ...rest } = a
      return shape ? { ...rest, shape } : rest
    }),
    // The mood a World found and what it changed : numbers only (a session file
    // can carry anything).
    worldBase: sanitizeWorldBase(c.worldBase),
    worldShift: sanitizeWorldBase(c.worldShift, true),
    // 16 knobs now : older 32-knob sessions truncate; short arrays pad. Field-
    // MERGE each stored knob onto the default so a knob predating a field (e.g.
    // `destinations`) can't leave it undefined.
    metaKnobs: (() => {
      const k = c.metaKnobs ?? []
      return makeDefaultMetaKnobs().map((d, i) => ({ ...d, ...(k[i] ?? {}) }))
    })()
  })
}

// The Collage folder last picked on this computer : a Film Wall theme reuses it
// (a session's own collage wins). Machine-local, like the Assemble bank.
type CollageClips = { folder: string; pool: import('@shared/collage').CollageClip[] }
function rememberCollage(folder: string, pool: CollageClips['pool']): void {
  if (!pool.length) return
  try {
    localStorage.setItem('opsia.lastCollage', JSON.stringify({ folder, pool }))
  } catch {
    /* storage full or blocked : Generate just won't remember it */
  }
}
function rememberedCollage(): CollageClips | null {
  try {
    const v = JSON.parse(localStorage.getItem('opsia.lastCollage') ?? 'null')
    return v && Array.isArray(v.pool) && v.pool.length ? v : null
  } catch {
    return null
  }
}
function sessionCollage(c: CompositionState): CollageClips | null {
  const slots = [...c.layers.flatMap((l) => [l.sourceA, l.sourceB]), c.background?.source]
  for (const sl of slots) {
    if (sl?.shaderId === 'gen-collage' && sl.collagePool?.length)
      return { folder: sl.collageFolder ?? '', pool: sl.collagePool }
  }
  return null
}
/** Clips a Film Wall theme can play : the session's collage, else the last folder. */
export function collageClipsFor(c: CompositionState): CollageClips | null {
  return sessionCollage(c) ?? rememberedCollage()
}

// Native nodes that read another layer (their sidechain) : Generate hands each one
// an active layer other than its own.
const THEME_READS_LAYER = new Set([
  'node-transfert', 'node-convolve', 'node-mosaique', 'node-remap', 'node-matte', 'node-lookup'
])

// ── Generate : build a whole composition from a theme recipe (themes.ts) ──
// Draws WITHIN the theme's pools so the result reads unmistakably as the theme,
// with variety from which sources/FX land and their curated params. The World +
// macros + temperament are applied by the generateTheme action on top of this.
function buildThemeComposition(theme: Theme, clips: CollageClips | null): CompositionState {
  const R = Math.random
  const rr = (lo: number, hi: number): number => lo + R() * (hi - lo)
  const pickOf = <T>(a: readonly T[]): T => a[Math.floor(R() * a.length)]
  const nActive = theme.layers[0] + Math.floor(R() * (theme.layers[1] - theme.layers[0] + 1))
  // Another active layer than `i` (for the nodes and Text fills that read one).
  const otherLayer = (i: number): number | null => {
    const o: number[] = []
    for (let j = 0; j < nActive; j++) if (j !== i) o.push(j)
    return o.length ? pickOf(o) : null
  }
  // A shader's inputs : curated random draws, then the theme's own picks.
  const pickedInputs = (id: string): Record<string, number | number[]> => {
    const inputs = randomizeInputs(id, {})
    const picks = theme.pickInputs?.[id]
    if (picks) for (const k in picks) if (picks[k].length) inputs[k] = pickOf(picks[k])
    return inputs
  }
  // A node that reads another layer is handed one, or dropped when the scene has
  // no other layer (Lookup alone falls back to reading itself, its own palette).
  const themeFx = (id: string, layerIdx: number): FxInstance | null => {
    const fx: FxInstance = { id: uid(), shaderId: id, enabled: true, inputs: pickedInputs(id) }
    if (THEME_READS_LAYER.has(id)) {
      const j = otherLayer(layerIdx)
      if (j === null) return id === 'node-lookup' ? fx : null
      fx.sidechain = { kind: 'layer', layer: j }
      // Matte's matte is a THIRD layer when there is one (input 2 keyed by itself
      // is no key at all).
      if (id === 'node-matte') {
        const k = [...Array(nActive).keys()].filter((x) => x !== layerIdx && x !== j)
        fx.sidechain2 = { kind: 'layer', layer: k.length ? pickOf(k) : j }
      }
    }
    return fx
  }
  const buildRack = (pool: string[], max: number, layerIdx: number): FxInstance[] => {
    if (!pool.length || max <= 0) return []
    const n = 1 + Math.floor(R() * max)
    const avail = [...pool]
    const out: FxInstance[] = []
    for (let i = 0; i < n && avail.length; i++) {
      const fx = themeFx(avail.splice(Math.floor(R() * avail.length), 1)[0], layerIdx)
      if (fx) out.push(fx)
    }
    return out
  }
  // One to three lines from the theme's words (Text steps them with `next line`).
  const pickLines = (words: string[] | undefined): string => {
    const pool = words?.length ? [...words] : ['AFTER', 'IMAGE']
    const n = Math.min(pool.length, 1 + Math.floor(R() * 3))
    const out: string[] = []
    for (let k = 0; k < n; k++) out.push(pool.splice(Math.floor(R() * pool.length), 1)[0])
    return out.join('\n')
  }
  // With no clips yet, a Collage stands in with painted sources (Generate says so).
  const playable = (pool: string[]): string[] =>
    clips || !pool.includes('gen-collage')
      ? pool
      : [...pool.filter((id) => id !== 'gen-collage'), 'organic', 'dye-field', 'swell']
  const makeSlot = (i: number, pool: string[]): SourceSlot => {
    const id = pickOf(pool)
    const inputs = pickedInputs(id)
    // Colony above another layer grows on a transparent ground (lichen on the rock).
    if (id === 'colony' && i > 0) inputs.ground = 1
    const slot: SourceSlot = { kind: 'generator', shaderId: id, inputs }
    if (id === 'gen-collage' && clips) {
      slot.collageFolder = clips.folder
      slot.collagePool = clips.pool
    }
    if (id === 'gen-text') {
      slot.text = pickLines(theme.words)
      // Half the time another layer fills the letters : the type becomes a window.
      const j = otherLayer(i)
      if (j !== null && R() < 0.5) slot.sidechain = { kind: 'layer', layer: j }
    }
    return slot
  }
  const layers: LayerState[] = Array.from({ length: 4 }, (_, i) => {
    const l = makeLayer()
    if (i >= nActive) {
      l.sourceA = emptySlot()
      return l // an inactive (empty) upper layer
    }
    const pool = playable(theme.stack?.[i]?.length ? theme.stack[i] : theme.sources)
    l.sourceA = makeSlot(i, pool)
    if (R() < theme.useB) {
      l.sourceB = makeSlot(i, playable(theme.sources))
      l.sourceMix = rr(0.3, 0.7)
      l.sourceBlend = pickOf(theme.mixBlends ?? (['normal', 'screen', 'difference', 'multiply'] as BlendMode[]))
      l.harmony = rr(-0.4, 0.5) // matched … clashing (abHarmony.ts)
    }
    l.sourceAFx = R() < 0.4 ? buildRack(theme.layerFx, 1, i) : []
    l.fx = buildRack(theme.layerFx, 2, i)
    if (theme.nativeNodes?.length && i >= (theme.nativeFrom ?? 0) && R() < (theme.nativeChance ?? 0.4)) {
      const node = themeFx(pickOf(theme.nativeNodes), i)
      if (node) l.fx.push(node)
    }
    // The effect this layer cannot do without closes its rack, after everything
    // drawn by chance (a Perspective lays the whole treated picture on its plane).
    const must = theme.stackFx?.[i]
    if (must?.length) {
      const fx = themeFx(pickOf(must), i)
      if (fx) l.fx = [...l.fx.filter((f) => f.shaderId !== fx.shaderId), fx]
    }
    l.blend = i === 0 ? 'normal' : pickOf(theme.blends)
    l.opacity = i === 0 ? 1 : rr(0.65, 1)
    l.feedback = R() < theme.feedback
    l.feedbackAmount = rr(0.4, 0.75)
    l.speed = rr(0.6, 1.6)
    return l
  })

  // Background : a legal bg source from the theme's pool (falls back to a drift).
  // (never a Collage : Generate has no films for the ground, it played an empty wall)
  const bgPool = (theme.bgSources?.length ? theme.bgSources : theme.sources).filter((id) =>
    id !== 'gen-collage' && BG_SOURCES.some((g) => g.id === id)
  )
  const bgId = bgPool.length ? pickOf(bgPool) : 'drift-field'
  // In GROUP : Layer 1 lands opaque and 'normal', so in blend mode the themed
  // ground was hidden behind it; grouped, it shows through the layers' dark and
  // transparent parts and the theme's ground is part of the picture.
  const background: BackgroundState = {
    source: { kind: 'generator', shaderId: bgId, inputs: randomizeInputs(bgId, {}) },
    fx: [],
    opacity: theme.bgOpacity ?? 1,
    speed: BG_DEFAULT_SPEED,
    depth: rr(0, 0.35),
    blendMode: 'isolate'
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

  // Motion : the theme's recipe binds a few modulators across the layers, so the
  // scene moves the way the theme would (a still scene read as a dead Generate).
  return themedMotion(
    {
      layers,
      background,
      master: [vibe, context, finalizer],
      bpm: 120,
      modulators: makeDefaultModulators(),
      modMatrix: [],
      metaKnobs: makeDefaultMetaKnobs()
    },
    motionFor(theme)
  )
}

// What the Inspector's auto-UI is pointed at: a source slot or an FX unit
// (brief §10.3 : "selecting any source or FX renders its ISF INPUTS").
export type Selection =
  | { type: 'source'; layer: number; slot: 'A' | 'B' }
  | { type: 'fx'; scope: FxScope; instId: string }
  | { type: 'background' } // the Background slab's source params
  | { type: 'audio'; slot: 'A' | 'B' } // an Audio Layer slot (the layers tab, under L4)
  | null

// modTargetKey (a mod target's stable identity) lives in modKey.ts, so the
// modules the store imports (persist.ts) can use it too; the store re-exports it.
export { modTargetKey }

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
  setSourceVideo: (layer: number, slot: 'A' | 'B', mediaId: string, mediaName: string, mediaPath?: string) => void
  // Point a slot at an imported sound file (kind:'audio', its waveform drawn).
  setSourceAudio: (layer: number, slot: 'A' | 'B', mediaId: string, mediaName: string, mediaPath: string) => void
  /** Swap ONLY the clip path/name on a video slot (the smooth-scrub transcode),
   *  preserving transport (play/dir/speed/loop/in-out/grain), FX, and modulation. */
  swapVideoSource: (
    layer: number,
    slot: 'A' | 'B',
    mediaId: string,
    mediaName: string,
    opts?: { mediaPath?: string; resetTrim?: boolean }
  ) => void
  // Point a slot at a live capture source. `spec` is 'webcam', 'screen', or
  // 'desktop:<sourceId>' for a specific window/screen; `name` labels it.
  setSourceCapture: (layer: number, slot: 'A' | 'B', spec: string, name: string) => void
  // Point a slot at a live HIVE stream (host:port).
  setSourceHive: (layer: number, slot: 'A' | 'B', host: string, port: number) => void
  // Native Text source (gen-text): the string + the glyph-fill sidechain.
  setSourceText: (layer: number, slot: 'A' | 'B', text: string) => void
  setSourceSidechain: (layer: number, slot: 'A' | 'B', ref: SidechainRef | null) => void
  // Native Collage source (gen-collage): the scanned folder + its clip pool.
  setCollagePool: (
    layer: number,
    slot: 'A' | 'B',
    folder: string,
    pool: import('@shared/collage').CollageClip[]
  ) => void
  // Collage `feed: assemblages` : the saved edits used as pieces (copied out of
  // the bank, so the session no longer depends on it).
  setCollageEdls: (
    layer: number,
    slot: 'A' | 'B',
    edls: import('@shared/collage').CollageEdl[]
  ) => void
  // The same two, for a Collage sitting on the Background slab.
  setBgCollagePool: (folder: string, pool: import('@shared/collage').CollageClip[]) => void
  setBgCollageEdls: (edls: import('@shared/collage').CollageEdl[]) => void

  // ── Background slab : the ground under the four layers ───────────────
  setBackgroundSource: (shaderId: string | null) => void
  setBackgroundInput: (name: string, value: number | number[]) => void
  setBackgroundOpacity: (v: number) => void
  setBackgroundSpeed: (v: number) => void
  setBackgroundDepth: (v: number) => void
  setBackgroundBlendMode: (m: 'blend' | 'isolate') => void
  randomizeBg: () => void
  /** Empty the Background : no source, no rack, default opacity / speed / shadow / mode. */
  initBackground: () => void // the background's own dice (global Randomize skips it)
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
        | 'videoPlaying' | 'videoSpeed' | 'videoDirection' | 'videoLoop' | 'videoIn' | 'videoOut' | 'videoVolume' | 'ignoreGlobalSpeed'
        | 'grainOn' | 'grainSize' | 'grainSpray' | 'grainReverse' | 'grainJitter' | 'grainSync'
      >
    >
  ) => void
  // Framing (zoom/pan/crop) for a video OR capture slot.
  setSourceTransform: (
    layer: number,
    slot: 'A' | 'B',
    patch: Partial<
      Pick<
        SourceSlot,
        | 'zoom' | 'panX' | 'panY' | 'cropL' | 'cropR' | 'cropT' | 'cropB'
        | 'fit' | 'feather' | 'mirror' | 'person' | 'personCount' | 'personBlur' | 'personSoft'
      >
    >
  ) => void
  setLayerSpeed: (layer: number, v: number) => void
  // Replace the master chain; the chain's vibe settings merge onto the
  // pinned Vibe Palette (which stays pinned, keeps identity + enable state).
  applyMasterPreset: (
    fx: import('./shaders/isf/masterPresets').MasterPresetFx[],
    vibe?: Record<string, number | number[]>,
    context?: Record<string, number | number[]>
  ) => void
  // Layer lifecycle (context menu): reset to factory / structural randomize.
  initLayer: (layer: number) => void
  randomizeLayer: (layer: number) => void
  /** Re-roll ONE of a layer's racks (source A, source B, or the layer's own),
   *  leaving its sources and the other racks untouched. */
  randomizeLayerFx: (layer: number, which: 'A' | 'B' | 'layer') => void
  /** Nudge ONE layer around where it sits : the per-layer Vary. */
  varyLayer: (layer: number) => void
  setLayerVary: (layer: number, amount: number) => void
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
  rightView: 'layers' | 'mixer' | 'finishing' | 'feel' | 'io' | 'perf' | 'assemble'
  setRightView: (v: 'layers' | 'mixer' | 'finishing' | 'feel' | 'io' | 'perf' | 'assemble') => void
  // Back-compat: the M key still toggles the Mixer on/off against Layers.
  toggleMixerView: () => void
  mixerPresets: Array<{
    id: string
    name: string
    // the A/B part (mix, its mode, harmony, coupling) since 1.3 : older mixes
    // leave it as it is
    layers: Array<{
      opacity: number
      speed: number
      blend: BlendMode
      sourceMix?: number
      sourceBlend?: BlendMode
      harmony?: number
      coupling?: LayerCoupling
    }>
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

  // FX racks (Phase 3) : one action surface for all four rack scopes.
  addFx: (scope: FxScope, shaderId: string) => void
  removeFx: (scope: FxScope, instId: string) => void
  toggleFx: (scope: FxScope, instId: string) => void
  // On/Off for the whole master chain : all non-locked master FX at once.
  toggleMasterChain: () => void
  /** On/Off for one rack's whole chain (a source's effects) : all off if every
   *  unit is on, else all on. Locked units are left alone. */
  toggleRackChain: (scope: FxScope) => void
  setFxOpacity: (scope: FxScope, instId: string, v: number) => void
  moveFx: (scope: FxScope, instId: string, dir: -1 | 1) => void
  // Drag-and-drop reorder: place instId before beforeId (null = end of chain).
  reorderFx: (scope: FxScope, instId: string, beforeId: string | null) => void
  setFxInput: (scope: FxScope, instId: string, name: string, value: number | number[]) => void
  /** Replace every input of one FX unit at once (one undo step) : the Finishing "default". */
  setFxInputs: (scope: FxScope, instId: string, inputs: Record<string, number | number[]>) => void
  // FX clipboard : copy a unit, then either overwrite another unit of the SAME
  // shader with its settings, or drop a fresh copy into any rack that can host
  // it. Transient — like `rightView`, it is not part of a Session.
  fxClipboard: { shaderId: string; name: string; inputs: Record<string, number | number[]>; opacity: number; sidechain: SidechainRef | null; sidechain2: SidechainRef | null } | null
  /** How many times each Vary has fired : index 0..3 the layers, 4 the global
   *  one. A button keys a one-shot blink on its count, so every fire is seen,
   *  however it was fired (a click, a modulator, MIDI, OSC). Transient : not in
   *  the composition, so it never enters undo or a session. */
  varyPulse: number[]
  /** How many times the global Randomize has fired (button, R key, MIDI pad) :
   *  the button blinks on it. Transient, like varyPulse. */
  randPulse: number
  bumpRandPulse: () => void
  copyFx: (scope: FxScope, instId: string) => void
  /** Overwrite one unit's settings from the clipboard. Same shader only. */
  pasteFxSettings: (scope: FxScope, instId: string) => void
  /** Add a fresh copy to a rack, after `afterId` (null = end of chain). */
  pasteFxAsNew: (scope: FxScope, afterId: string | null) => void
  // One FX unit into ANOTHER rack : the right-click "Copy to…" rows and the
  // cross-rack drag. Copy = a fresh unit (its own id, no modulation); move = the
  // same unit, its modulation following it. Both insert before `beforeId` (else
  // at the end), never past the pinned finalizers, and refuse (false) where the
  // target rack can't host the shader (canHostFx).
  copyFxTo: (from: FxScope, instId: string, to: FxScope, beforeId?: string | null) => boolean
  moveFxTo: (from: FxScope, instId: string, to: FxScope, beforeId?: string | null) => boolean
  // Native convolution nodes: choose the sidechain (impulse) source. `which` 2
  // sets the second input of a three-input node (the Matte's matte).
  setFxSidechain: (scope: FxScope, instId: string, ref: SidechainRef | null, which?: 1 | 2) => void

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
  // MIDI OUTPUT (e.g. to an Ableton Move over USB). Machine-local, not in a session.
  //   midiOutputName : the chosen output port ('' = none)
  //   midiClockOut   : send MIDI clock (24 PPQN) + Start/Stop at the app BPM
  //   midiThru       : forward incoming MIDI to the output (Opsia as a router)
  midiOutputName: string
  setMidiOutputName: (name: string) => void
  midiClockOut: boolean
  setMidiClockOut: (on: boolean) => void
  midiThru: boolean
  setMidiThru: (on: boolean) => void
  updateMetaKnob: (i: number, partial: Partial<MetaKnobState>) => void
  setMetaValue: (i: number, v: number) => void
  // Toggle a destination on a knob (capped at META_MAX_DESTS).
  toggleMetaDest: (i: number, target: ModTarget) => void

  // Modulation (Phase 5) : the 8-slot bank + the capped matrix.
  updateModulator: (i: number, partial: Partial<ModulatorConfig>) => void
  // Upserts by (mod, target): re-assigning the same pair updates its depth.
  // Returns false when the cap would be exceeded (legibility = simplexité).
  assignMod: (mod: number, target: ModTarget, depth: number, mode?: ModMode) => boolean
  // Random modulation over a set of candidate parameter targets. Always re-rolls
  // (source + depth) any EXISTING assignment on those targets; when `addNew`, also
  // seeds random assignments onto a subset of the still-unassigned ones (respecting
  // the cap). The Inspector/rack right-click menus drive this : "Assign and
  // randomize modulation" passes addNew=true, "Randomize modulation" passes false.
  randomizeModulation: (candidates: ModTarget[], addNew: boolean) => boolean
  removeAssignment: (id: string) => void
  setAssignmentDepth: (id: string, depth: number) => void
  toggleAssignmentMuted: (id: string) => void
  setAssignmentMode: (id: string, mode: ModMode) => void
  // The binding's shaping (combine, threshold, integrate) : a patch over what it
  // has; a field set to undefined goes, and an all-off shape is none.
  setAssignmentShape: (id: string, patch: Partial<ModShape>) => void

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
  /** Output pixels the warped frame's edge fades over (0 : crisp, anti-aliased). */
  warpFeather: number
  setWarpFeather: (px: number) => void
  /** The projector window enlarges the frame through a cubic, not bilinear :
   *  per machine (it follows the render scale and the projector), off by default. */
  outSharp: boolean
  setOutSharp: (on: boolean) => void
  setWarpCorner: (corner: number, x: number, y: number) => void
  resetWarp: () => void
  // The warp travels with the session : saved into it, restored from it. A
  // per-computer choice (persisted) : off, the warp stays this computer's.
  warpInSession: boolean
  setWarpInSession: (on: boolean) => void
  // The warp on screen came from the open session (Mapping : save with session).
  // Its edits then belong to that session and never touch this computer's own
  // warp (kept in localStorage), which comes back with a session that has none,
  // with New, or when the option is turned off. Transient.
  warpFromSession: boolean
  // Fullscreen output window (projector) is open + mirroring. Transient.
  outputActive: boolean
  setOutputActive: (on: boolean) => void
  // NDI output : machine-local config (persisted, so NDI comes back on its own
  // after a restart at the venue) + the live status streamed from the NDI process.
  // `ndiActive` mirrors ndi.enabled for the places that only need on/off.
  ndi: NdiConfig
  setNdi: (patch: Partial<NdiConfig>) => void
  ndiStatus: NdiStatus
  setNdiStatus: (s: NdiStatus) => void
  ndiActive: boolean
  // Spout (Windows) / Syphon (macOS), native addons. Transient. `shareRoute` :
  // where the sender runs (the preload = fast; main = the fallback) and whether
  // it takes top-down frames (no CPU flip).
  shareActive: boolean
  shareRoute: { local: boolean; topDown: boolean }
  setShareActive: (on: boolean, route?: { local: boolean; topDown: boolean }) => void
  // Light output (ArtNet/DMX · WLED). Machine-local (venue-specific), persisted.
  lights: LightConfig
  setLights: (partial: Partial<LightConfig>) => void
  // Embodied control (MediaPipe Hands + Pose). Machine-local (a webcam is
  // machine-bound, like warp), persisted, NOT part of a session. The tracker
  // (engine/bodyTracker.ts) follows this; a `body` modulator reads the bus.
  bodyControl: BodyControlConfig
  setBodyControl: (partial: Partial<BodyControlConfig>) => void
  // The full-page Body view (B). Transient.
  bodyPageOpen: boolean
  setBodyPageOpen: (on: boolean) => void
  // Resolume OSC mapper : Palinopsia signals (rows) × Resolume addresses
  // (columns). Travels with the session; also kept in localStorage so it
  // survives a restart before the session is saved. Every edit is refused while
  // `locked` (recalling a snapshot is a performance move and still works).
  resolume: ResolumeMap
  // The dataflou mesh : Palinopsia as a node (on/off, name, universe).
  dataflou: DfConfig
  setDataflou: (patch: Partial<DfConfig>) => void
  // Fulldome output (Output page) : the domemaster mapping + the simulator view.
  // Kept in localStorage (the venue) AND saved with the session (the piece).
  dome: DomeConfig
  setDome: (patch: Partial<DomeConfig>) => void
  // The output transform : the whole frame moved as one picture (flat output).
  // Saved with the session; New and older files start at identity.
  outXform: OutXform
  setOutXform: (patch: Partial<OutXform>) => void
  // Bumped by a reset : the engine zeroes its spin angle when it changes.
  outXformReset: number
  resetOutXform: () => void
  // Space (shared/spatial.ts) : Sonify on a speaker array or as objects for a
  // renderer. The venue part is this computer's (localStorage); the voices'
  // places travel with the session.
  space: SpaceConfig
  setSpace: (patch: Partial<SpaceConfig>) => void
  setSpaceVoice: (voice: SpaceVoice, patch: Partial<VoicePlace>) => void
  setDomeSim: (patch: Partial<DomeConfig['sim']>) => void
  resolumePageOpen: boolean
  setResolumePageOpen: (on: boolean) => void
  setResolume: (patch: Partial<ResolumeMap>) => void
  /** Adopt a parsed composition : its catalogue becomes the columns. Existing
   *  connections survive wherever their address still exists. */
  resoLoadSession: (session: ResoSession) => void
  resoToggleCell: (inputId: string, outputId: string) => void
  resoSetCellAmount: (inputId: string, outputId: string, amount: number) => void
  resoAddInput: (source: string) => void
  resoRemoveInput: (id: string) => void
  resoUpdateInput: (id: string, patch: Partial<ResoInput>) => void
  resoMoveInput: (id: string, dir: -1 | 1) => void
  resoAddOutput: (o: Omit<ResoOutput, 'id'>) => void
  resoRemoveOutput: (id: string) => void
  resoUpdateOutput: (id: string, patch: Partial<ResoOutput>) => void
  resoToggleFold: (group: string) => void
  resoClearCells: () => void
  /** Roll the pins : a fresh random set of connections. Returns how many, or −1
   *  when there is nothing to wire (no rows or no eligible columns, or locked). */
  resoRandomize: () => number
  /** store = true writes the current connections into the slot; false recalls it. */
  resoSnapshot: (slot: number, store: boolean) => void
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
  /** The chosen input's name, to find it again when its id changed (another
   *  build of the app, the interface in another port). */
  audioDeviceLabel: string | null
  setAudioDeviceId: (id: string | null, label?: string | null) => void
  // Monitoring / passthrough : hear the local input through an output device
  // while it also drives reactivity. Machine-local (venue rig), persisted.
  audioMonitor: boolean
  setAudioMonitor: (on: boolean) => void
  audioMonitorLevel: number
  setAudioMonitorLevel: (v: number) => void
  audioMonitorSink: string // output device id ('' = system default)
  setAudioMonitorSink: (id: string) => void
  // USB-noise denoiser : adaptive notch filter. On/off + the learned notch
  // frequencies (Hz). Machine-local (the noise is per-rig), persisted.
  audioDenoise: boolean
  setAudioDenoise: (on: boolean) => void
  audioDenoiseNotches: Array<{ f: number; q: number }>
  setAudioDenoiseNotches: (notches: Array<{ f: number; q: number }>) => void
  // The Mixer's master switch : every layer's A/B coupling at once (the audio
  // tab's "coupling" button is the same switch). On at launch : a show that
  // paused it doesn't silently lose its coupling the next day. Transient.
  couplingOn: boolean
  setCouplingOn: (on: boolean) => void
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
  // How much of the active World's mood is on (engine/worldAmount.ts) : 0..1,
  // per machine like the field macros. Modulatable, OSC /opsia/world/amount.
  worldAmount: number
  setWorldAmount: (v: number) => void
  // A built-in edited this session back to how it ships.
  resetWorld: (id: string) => void
  // An edited built-in kept as a user World of its own (a unique name), the
  // built-in put back as it ships; the active one hands over to the copy with
  // nothing re-applied. Returns the copy's id.
  saveWorldAsMine: (id: string) => string
  // The composition's coupling / Context mood / film / audio routing into a
  // World : a built-in gets a new user World; returns the World edited.
  takeWorldFromComposition: (id: string) => string
  addWorld: (fromId?: string) => string // clone → new user world; returns its id
  updateWorld: (id: string, partial: Partial<World>) => void
  deleteWorld: (id: string) => void
  renameWorld: (id: string, name: string) => void
  worldPageOpen: boolean
  setWorldPageOpen: (on: boolean) => void
  // The full-page Output / Mapping view is showing. Transient.
  outputPageOpen: boolean
  setOutputPageOpen: (on: boolean) => void
  // ...in its own window rather than over the instrument (OutputPageWindow.tsx),
  // asked for from the Output button's right-click menu. Only while it is open :
  // the page always opens in the app otherwise.
  outputPageWindow: boolean
  setOutputPageWindow: (on: boolean) => void
  // Global modulation mute (transient) : freezes every modulator output.
  modBypass: boolean
  toggleModBypass: () => void
  // Meta: show the last four knobs (13–16) as two XY performance pads (default on).
  metaXYPads: boolean
  toggleMetaXYPads: () => void
  renderScale: number
  setRenderScale: (v: number) => void
  // The composition's native resolution (machine-local : the output rig's size,
  // NOT part of a session, so a show file stays resolution-independent). The
  // engine renders at compW × compH × renderScale. Default 1920×1080 ; set wider
  // for multi-projector spans (e.g. 7680×2160). renderScale is the quality dial.
  compW: number
  compH: number
  setCompSize: (w: number, h: number) => void
  // The Satosphère button : a w × h composition while the dome is on (now, or
  // when it goes on), this computer's own size back when it goes off.
  squareCompForDome: (w: number, h: number) => void
  // Strobe-safety limiter (photosensitive) : 0 = off, higher = tighter flash cap.
  strobeSafe: number
  setStrobeSafe: (v: number) => void
  // Sonify (the S page) : the image-to-sound engine's whole config. Persisted
  // to localStorage (per-machine, like OSC config), pushed to the engine on
  // every write : one write path, same as everything else.
  sonifyPageOpen: boolean
  setSonifyPageOpen: (on: boolean) => void
  // The Source Editor (Alt+E) : a full-page takeover. Transient.
  sourceEditorOpen: boolean
  setSourceEditorOpen: (on: boolean) => void
  // Your own shaders (the Source Editor) : what the menus list as "my shaders"
  // (the sources themselves are in SHADER_BY_ID, shaders/userShaders.ts).
  userShaders: UserShaderInfo[]
  setUserShaders: (list: UserShaderInfo[]) => void
  upsertUserShader: (info: UserShaderInfo) => void
  removeUserShader: (id: string) => void
  // Live recording state (set by the global recorder) : drives the REC pill.
  recording: boolean
  recordingSince: number
  setRecording: (on: boolean) => void
  // The chosen recording format + rate (machine-local; the MIDI record toggle
  // uses them too).
  recordPrefs: RecordPrefs
  setRecordPrefs: (patch: Partial<RecordPrefs>) => void
  sonify: SoniConfig
  setSonify: (next: SoniConfig) => void
  // The Audio Layer (the layers tab, under L4) : two slots, a sound file or a
  // live input each, mixed into Sonify's output (saved with the session).
  audioLayer: AudioLayerState
  // Which live slots are open : runtime only, never saved, so loading a session,
  // an undo or New never opens a microphone by itself (like the camera). Picking
  // an input opens it, so does its open button, and an installation's boot.
  audioLayerArmed: AudioLayerArmed
  /** Open a live slot's input (no slot : every live slot, an installation's boot). */
  armAudioLayer: (slot?: 'A' | 'B') => void
  /** A file into a slot. `keep` keeps the slot's transport, volume and pan (the
   *  clip row stepping through a folder); else a fresh slot (its volume kept). */
  setAudioLayerFile: (slot: 'A' | 'B', mediaId: string, mediaName: string, mediaPath: string, keep?: boolean) => void
  /** A live input into a slot ('' : the default device), opened : the
   *  performer's pick. Its channels stay on the same device (another one : 1+2);
   *  the same input picked again opens it anew. */
  setAudioLayerLive: (slot: 'A' | 'B', deviceId: string, deviceLabel: string) => void
  patchAudioLayerSlot: (slot: 'A' | 'B', patch: Partial<AudioLayerSlot>) => void
  clearAudioLayerSlot: (slot: 'A' | 'B') => void
  patchAudioLayer: (patch: Partial<Pick<AudioLayerState, 'mix' | 'volume' | 'mute'>>) => void
  /** Both file slots : true = from their in points, together (a synced start);
   *  false = paused. */
  playAudioLayer: (on: boolean) => void
  // Sonify step sequencer (Mixer page) : evolves the sound over time.
  soniSeq: SoniSeq
  setSoniSeqOn: (on: boolean) => void
  setSoniSeqRate: (rate: SoniSeqRate) => void
  setSoniSeqStepMs: (ms: number) => void
  setSoniSeqLen: (n: number) => void
  toggleSoniSeqVoice: (step: number, voice: number) => void
  setSoniSeqStepPreset: (step: number, preset: string) => void
  clearSoniSeqStep: (step: number) => void
  setSoniSeqCur: (i: number) => void
  setSoniSeqMode: (mode: SoniSeq['mode']) => void
  setSoniSeqBounceDecay: (v: number) => void
  setSoniSeqBias: (v: number) => void
  setSoniSeqEdge: (edge: SoniSeq['edge']) => void
  randomizeSoniSeq: () => void
  resetSoniSeq: () => void
  // The key sequencer (Sonify seq view) : root / scale over time.
  soniKeySeq: SoniKeySeq
  soniKeyCur: number // runtime : the List step playing (-1 = none)
  setSoniKeySeq: (patch: Partial<SoniKeySeq>) => void
  setSoniKeySeqOn: (on: boolean) => void
  /** A written key : List's (steps) or Picture's own (picSteps). */
  setSoniKeyStep: (i: number, patch: Partial<SoniKeyStep>, list?: 'steps' | 'picSteps') => void
  setSoniKeyCur: (i: number) => void
  randomizeSoniKeySteps: (list?: 'steps' | 'picSteps') => void
  resetSoniKeySeq: () => void

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
  /** Put an assemblage on a layer as a source (the edit rides on the slot). */
  setSourceAssemble: (layer: number, slot: 'A' | 'B', a: Assemblage) => void

  // Depth engine mode (2.5D) : off · synthetic test bowl · AI monocular estimate.
  depthMode: 'off' | 'synth' | 'estimate'
  setDepthMode: (m: 'off' | 'synth' | 'estimate') => void
  collapsed: Record<string, boolean>
  toggleSection: (key: string) => void
  setCollapsed: (key: string, collapsed: boolean) => void
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
  /** Persistence : what scenes, Randomize, Variation, Generate, a World and the
   *  mix presets leave alone (persist.ts keys : a control's mod-target key,
   *  'lay:<i>:speed', 'layer:<i>'). Saved with the session, never in a scene. */
  pins: string[]
  togglePin: (key: string) => void
  unpin: (key: string) => void
  clearPins: () => void
  /** Write what plays now for this pin into every scene (one undo step). */
  setInEveryScene: (key: string, label: string) => void
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

  // Metasurface : a continuous 2D scene-space. When active, the render loop feeds
  // the engine a Gaussian blend of the placed scenes at the cursor (surface.ts),
  // instead of the live composition. `x`/`y` are 0..1 on the plane.
  // The draw sequencer (path/timeMs/way/jump) persists with the session; the
  // live cursor (x/y), active + play toggles stay runtime. The render loop
  // advances the playhead and drives x/y along `path` when `play` is on.
  surface: {
    active: boolean
    x: number
    y: number
    path: { x: number; y: number }[]
    play: boolean
    timeMs: number
    way: 'forward' | 'backward' | 'pingpong'
    jump: number
    wiggle: number
    closed: boolean
  }
  setSurfaceActive: (active: boolean) => void
  setSurfaceXY: (x: number, y: number) => void
  setSurfacePath: (path: { x: number; y: number }[]) => void
  setSurfacePlay: (play: boolean) => void
  setSurfaceTimeMs: (ms: number) => void
  setSurfaceWay: (way: 'forward' | 'backward' | 'pingpong') => void
  setSurfaceJump: (pct: number) => void
  setSurfaceWiggle: (pct: number) => void
  setSurfaceClosed: (closed: boolean) => void
  // Context's light draw sequencer (on the Context unit : travels with sessions,
  // scenes and undo). A partial patch over the current (or default) path.
  setContextLightPath: (patch: Partial<LightPath>) => void
  setScenePos: (id: string, x: number, y: number) => void
  // Auto-place any scenes without a surface position (a sunflower spread).
  autoPlaceScenes: (force?: boolean) => void

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

/** A new pulse array with one counter advanced : a fresh array, so the one
 *  button subscribed to that index sees a change and replays its blink. */
// Each layer's Vary anchor (see varyLayer) : the layer before its first fire,
// and the variant we last made from it. Runtime only, never saved or undone.
const layerVaryBase: (LayerState | null)[] = []
const layerVaryLast: (LayerState | null)[] = []

function bumpPulse(p: number[] | undefined, i: number): number[] {
  const next = (p && p.length >= 5 ? p : [0, 0, 0, 0, 0]).slice()
  next[i] = (next[i] ?? 0) + 1
  return next
}

function updateLayer(
  layers: LayerState[],
  i: number,
  fn: (l: LayerState) => LayerState
): LayerState[] {
  return layers.map((l, idx) => (idx === i ? fn(l) : l))
}

/** Drop every modulation + Meta destination pointing at one source slot.
 *
 *  Targets address a slot by LAYER + SLOT + INPUT NAME, never by the shader that
 *  happens to occupy it. So without this, swapping a source leaves the old
 *  bindings driving whatever the NEW source declares under the same name — an
 *  LFO patched to one generator's `rate` silently seizes the next source's
 *  `rate`, and a Meta knob left on `mask` blanks a freshly-placed Collage.
 *  Invisible, and impossible to reason about. Replacing what is in a slot
 *  replaces the instrument, so its patching goes with it.
 *
 *  Only for INTERACTIVE swaps : session loads, scene recalls and Randomize write
 *  a whole composition whose matrix already matches its sources. */
function dropSlotTargets(
  c: CompositionState,
  layer: number,
  slot: 'A' | 'B',
  prev: SourceSlot | null,
  alsoDropSourceFx = false
): CompositionState {
  const next = (slot === 'A' ? c.layers[layer]?.sourceA : c.layers[layer]?.sourceB) ?? null
  if (sameSource(prev, next)) return c // re-picking what is already there
  // `alsoDropSourceFx` : the video/capture/hive/assemble swaps EMPTY the slot's
  // source-FX rack, so a modulator/Meta target pointing into that rack would be
  // left dangling (counts against MAX_MOD_ASSIGNMENTS, clutters the panel). The
  // generator swap keeps its rack, so it does not pass the flag.
  const fxKind = slot === 'A' ? 'sourceA' : 'sourceB'
  return dropTargets(
    c,
    (t) =>
      (t.kind === 'source' && t.layer === layer && t.slot === slot) ||
      (alsoDropSourceFx &&
        t.kind === 'fx' &&
        t.scope.kind === fxKind &&
        (t.scope as { layer: number }).layer === layer)
  )
}

/** A hand swap of a slot : its patching goes (dropSlotTargets), and so do its
 *  pinned inputs (persist.ts holds a slot's input by name : kept, the pin would
 *  hold the next source's input of the same name at every recall after). */
function swapSlot(
  s: { pins: string[] },
  c: CompositionState,
  layer: number,
  slot: 'A' | 'B',
  prev: SourceSlot | null,
  alsoDropSourceFx = false
): { composition: CompositionState; pins: string[] } {
  const composition = dropSlotTargets(c, layer, slot, prev, alsoDropSourceFx)
  if (!s.pins.length || sameSource(prev, slotOf(c, layer, slot))) return { composition, pins: s.pins }
  const head = `src:${layer}:${slot}:`
  const pins = s.pins.filter((k) => !k.startsWith(head))
  return { composition, pins: pins.length === s.pins.length ? s.pins : pins }
}

/** The same, for the Background slab's source (addressed by input name alone). */
function dropBgTargets(c: CompositionState, prev: SourceSlot | null): CompositionState {
  if (sameSource(prev, c.background?.source ?? null)) return c
  return dropTargets(c, (t) => t.kind === 'bgSource')
}

/** An Audio Layer slot emptied by hand, or a file turned into another source :
 *  the bindings on what it no longer has go (`fileOnly` : its transport's;
 *  volume and pan go on with the slot). Else dead rows, eating the cap. */
export function dropAuSlotTargets(c: CompositionState, slot: 'A' | 'B', fileOnly = false): CompositionState {
  return dropTargets(c, (t) => t.kind === 'au' && t.slot === slot && (!fileOnly || auFileField(t.field)))
}

/** Same instrument in the slot? Identity is kind + shader + media, not inputs. */
function sameSource(a: SourceSlot | null, b: SourceSlot | null): boolean {
  if (!a || !b) return a === b
  return a.kind === b.kind && a.shaderId === b.shaderId && (a.mediaId ?? null) === (b.mediaId ?? null)
}

/** Whether a modulation target still points at something : an effect instance
 *  that is still in its rack, a source slot that still holds a source. Anything
 *  else (layer controls, Meta, Sonify, the Background's and the dome's own
 *  controls) always exists. */
/** This computer's warp feather (localStorage), in output pixels. */
function storedWarpFeather(): number {
  const n = Number(localStorage.getItem('opsia.warpFeather'))
  return Number.isFinite(n) ? Math.max(0, Math.min(WARP_FEATHER_MAX, n)) : 0
}
const WARP_FEATHER_MAX = 200
let featherSave = 0

/** Back to this computer's own warp (localStorage) after a session's. */
function restoreMachineWarp(
  set: (p: Partial<{ warpCorners: number[]; warpEnabled: boolean; warpFeather: number; warpFromSession: boolean }>) => void,
  get: () => { warpFromSession: boolean }
): void {
  if (!get().warpFromSession) return
  let corners = [0, 0, 1, 0, 1, 1, 0, 1]
  try {
    const s = JSON.parse(localStorage.getItem('opsia.warpCorners') ?? '')
    if (Array.isArray(s) && s.length === 8 && s.every((v) => typeof v === 'number')) corners = s
  } catch {
    /* none stored : the identity */
  }
  set({ warpCorners: corners, warpEnabled: localStorage.getItem('opsia.warpEnabled') === '1', warpFeather: storedWarpFeather(), warpFromSession: false })
}

/** `al` : the Audio Layer, outside the composition (a binding on an empty slot,
 *  or on a live input's transport, is dead); without it, alive. */
export function targetAlive(c: CompositionState, t: ModTarget, al?: AudioLayerState): boolean {
  if (t.kind === 'au') return !al || auTargetAlive(al, t)
  if (t.kind === 'fx') {
    const s = t.scope
    const arr =
      s.kind === 'master'
        ? c.master
        : s.kind === 'background'
          ? c.background?.fx
          : s.kind === 'layer'
            ? c.layers[s.layer]?.fx
            : s.kind === 'sourceA'
              ? c.layers[s.layer]?.sourceAFx
              : c.layers[s.layer]?.sourceBFx
    return !!arr?.some((f) => f.id === t.instId)
  }
  if (t.kind === 'source') {
    const L = c.layers[t.layer]
    const slot = t.slot === 'A' ? L?.sourceA : L?.sourceB
    // An emptied slot is { kind: 'none' } (slot A always exists).
    return !!slot && slot.kind !== 'none'
  }
  if (t.kind === 'bgSource') return !!c.background?.source
  return true
}

function dropTargets(
  c: CompositionState,
  hits: (t: ModTarget) => boolean
): CompositionState {
  const modMatrix = c.modMatrix.filter((a) => !hits(a.target))
  const metaKnobs = c.metaKnobs.map((k) =>
    k.destinations.some(hits) ? { ...k, destinations: k.destinations.filter((t) => !hits(t)) } : k
  )
  const knobsChanged = metaKnobs.some((k, i) => k !== c.metaKnobs[i])
  if (modMatrix.length === c.modMatrix.length && !knobsChanged) return c
  return { ...c, modMatrix, metaKnobs }
}

/** Prune mod / Meta targets orphaned when a WHOLE layer is replaced (initLayer /
 *  randomizeLayer / applyLayerPreset / pasteLayer). Source-kind rows would else
 *  seize the new source's same-named inputs, and layer-scoped fx rows dangle
 *  once fresh FX instance ids are minted — dead rows that eat the assignment
 *  cap. Mirrors dropSlotTargets / removeFx for the whole-layer replace case. */
function dropLayerTargets(c: CompositionState, layer: number): CompositionState {
  return dropTargets(
    c,
    (t) =>
      (t.kind === 'source' && t.layer === layer) ||
      (t.kind === 'fx' &&
        (t.scope.kind === 'layer' || t.scope.kind === 'sourceA' || t.scope.kind === 'sourceB') &&
        t.scope.layer === layer)
  )
}

// Persistence (persist.ts) : an arriving composition with the pins held from
// the one playing now. Every bulk write goes through it.
const keep = (s: { composition: CompositionState; pins: string[] }, c: CompositionState): CompositionState =>
  keepPersistent(c, s.composition, s.pins)

// A whole-layer change by a menu (init, dice, a preset, paste) on a pinned
// layer : nothing, and it says why.
function layerHeld(s: { pins: string[] }, layer: number, quiet = false): boolean {
  if (!s.pins.includes(layerPin(layer))) return false
  if (!quiet) showToast(`L${layer + 1} is persistent : unpin it first (right-click the layer)`, 'warn', 4200)
  return true
}

/** The slot a swap is about to overwrite. */
function slotOf(c: CompositionState, layer: number, slot: 'A' | 'B'): SourceSlot | null {
  return (slot === 'A' ? c.layers[layer]?.sourceA : c.layers[layer]?.sourceB) ?? null
}

/** The same rack ? */
export function sameFxScope(a: FxScope, b: FxScope): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'master' || a.kind === 'background') return true
  return (a as { layer: number }).layer === (b as { layer: number }).layer
}

/** Insert a unit before `beforeId` (else at the end), never past the pinned
 *  finalizers, which must stay last. */
function insertFx(fx: FxInstance[], unit: FxInstance, beforeId: string | null | undefined): FxInstance[] {
  const next = [...fx]
  const lockedAt = next.findIndex((f) => f.locked)
  let at = beforeId ? next.findIndex((f) => f.id === beforeId) : -1
  if (at < 0) at = lockedAt >= 0 ? lockedAt : next.length
  if (lockedAt >= 0 && at > lockedAt) at = lockedAt
  next.splice(at, 0, unit)
  return next
}

/** Read the FX array a scope addresses. The Inspector, the copy/paste actions
 *  and anything else that needs "which rack is this" share one resolver. */
export function fxArrayFor(c: CompositionState, scope: FxScope): FxInstance[] {
  if (scope.kind === 'master') return c.master
  if (scope.kind === 'background') return c.background?.fx ?? []
  const l = c.layers[scope.layer]
  if (!l) return []
  if (scope.kind === 'layer') return l.fx
  return scope.kind === 'sourceA' ? l.sourceAFx : l.sourceBFx
}

/** updateLayer, but returns a whole CompositionState (one layer rewritten). */
function updateLayer2(
  c: CompositionState,
  i: number,
  fn: (l: LayerState) => LayerState
): CompositionState {
  return { ...c, layers: updateLayer(c.layers, i, fn) }
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
// Like New (see newSession) : a cold launch is a clean slate, so strip the
// Finalizer's film stage even when the persisted World is a direct-film mode —
// else every start under Griffé/Peint/Pressé re-installs drawn-film dust over
// the picture. A loaded/opened session keeps its own film (that path is
// user-authored work); only this fresh scaffold is forced clean.
const startComposition = clearFinalizerFilm(
  applyWorldToComposition(seedRandomStart(makeDefaultComposition()), startWorld)
)

// A persisted number, or NaN when the key was never written. Number(null) is 0,
// which passes most range checks : a fresh install then started Flow at 0
// instead of its neutral 0.5, Morph at 0 ms, the monitor muted and Flash
// safety off. Every default below relies on a missing key reading as NaN.
function lsNum(key: string): number {
  const raw = localStorage.getItem(key)
  return raw === null ? NaN : Number(raw)
}

// The Satosphère button's square composition (Output → dome). Once ARMED it
// squares the composition while the dome is on and gives this computer's own
// size back when the dome goes off, but only when the composition is still that
// square (a size picked since stays). A size picked while the dome is on disarms
// it. Machine-local like the size itself; the dome always starts off, so a
// square left from the last run is given back at launch (and comes again with
// the dome).
interface DomeSquare {
  w: number
  h: number
  prev?: [number, number] // the size it replaced, while it is in force
}
function loadDomeSquare(): DomeSquare | null {
  try {
    const r = JSON.parse(localStorage.getItem('opsia.domeSquare') ?? 'null') as DomeSquare | null
    if (r && Number.isFinite(r.w) && Number.isFinite(r.h)) {
      const p = Array.isArray(r.prev) && r.prev.length === 2 && r.prev.every(Number.isFinite) ? r.prev : undefined
      return { w: r.w, h: r.h, prev: p }
    }
  } catch {
    /* none */
  }
  return null
}
function persistDomeSquare(d: DomeSquare | null): void {
  try {
    if (d) localStorage.setItem('opsia.domeSquare', JSON.stringify(d))
    else localStorage.removeItem('opsia.domeSquare')
  } catch {
    /* quota : the size just won't come back by itself */
  }
}
type CompSizeSet = (p: { compW: number; compH: number }) => void
function writeCompSize(set: CompSizeSet, w: number, h: number): void {
  localStorage.setItem('opsia.compW', String(w))
  localStorage.setItem('opsia.compH', String(h))
  set({ compW: w, compH: h })
}
/** The dome went on (or the button was pressed with it on) : the armed square
 *  replaces the composition's size, which is kept to give back. */
function enterDomeSquare(st: { compW: number; compH: number }, set: CompSizeSet): void {
  const d = loadDomeSquare()
  if (!d || (st.compW === d.w && st.compH === d.h)) return // nothing armed, or square already
  persistDomeSquare({ w: d.w, h: d.h, prev: d.prev ?? [st.compW, st.compH] })
  writeCompSize(set, d.w, d.h)
}
/** The dome went off : the size the square replaced comes back, if the
 *  composition is still that square. It stays armed for the next time. */
function leaveDomeSquare(st: { compW: number; compH: number }, set: CompSizeSet): void {
  const d = loadDomeSquare()
  if (!d?.prev) return
  if (st.compW === d.w && st.compH === d.h) writeCompSize(set, d.prev[0], d.prev[1])
  persistDomeSquare({ w: d.w, h: d.h })
}
;(function giveBackDomeSquareAtLaunch(): void {
  // the control window only : the projector window loads this same bundle
  // (#output), and opening it mid-show must not touch the size
  if (typeof window === 'undefined' || window.location.hash.replace('#', '') === 'output') return
  const d = loadDomeSquare()
  if (!d?.prev) return
  if (lsNum('opsia.compW') === d.w && lsNum('opsia.compH') === d.h) {
    localStorage.setItem('opsia.compW', String(d.prev[0]))
    localStorage.setItem('opsia.compH', String(d.prev[1]))
  }
  persistDomeSquare({ w: d.w, h: d.h })
})()

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
    set((s) => {
      if (layerHeld(s, layer)) return {}
      // Fresh factory layer : keeps its identity (id), but its source + FX are
      // replaced, so its mod/Meta patching goes with it (dropLayerTargets).
      const composition = {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => ({
          ...makeLayer(),
          id: l.id
        }))
      }
      return { composition: keep(s, dropLayerTargets(composition, layer)) }
    }),
  randomizeLayer: (layer) =>
    set((s) => {
      if (layerHeld(s, layer)) return {}
      const composition = {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => randomizeSingleLayer(l))
      }
      // (its pinned effects stay in their racks : keepPinnedUnits)
      return {
        composition: keep(s, keepPinnedUnits(dropLayerTargets(composition, layer), s.composition, s.pins)),
        variationBaseline: null
      }
    }),

  varyLayer: (layer) =>
    set((s) => {
      const cur = s.composition.layers[layer]
      if (!cur || layerHeld(s, layer, true)) return {} // (a modulator may fire it : quietly)
      // Anchored like the global Vary : every fire is a fresh variant at the
      // amount's distance from the layer as it was BEFORE the first fire, so a
      // modulator firing it all night circles your settings. Jittering the last
      // result instead was a random walk : an hour of an LFO left the layer
      // anywhere. A layer that changed since our last variant (an edit, a recall)
      // anchors again on what it is now.
      const base = layerVaryLast[layer] === cur && layerVaryBase[layer] ? layerVaryBase[layer]! : cur
      const next = jitterLayer(base, cur.varyAmount ?? DEFAULT_LAYER_VARY)
      // the amount is the layer's own setting, never part of the variant
      next.varyAmount = cur.varyAmount
      // No target pruning : a jitter moves values, it never removes a unit, so
      // every modulation row still points at something that exists.
      const composition = keep(s, { ...s.composition, layers: updateLayer(s.composition.layers, layer, () => next) })
      layerVaryBase[layer] = base
      // the layer as it lands (a pin on it holds a value : the next fire must
      // still know this one as ours, or it anchors anew on every variant)
      layerVaryLast[layer] = composition.layers[layer]
      return { composition, varyPulse: bumpPulse(s.varyPulse, layer) }
    }),
  setLayerVary: (layer, amount) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => ({
          ...l,
          varyAmount: Math.max(0, Math.min(1, amount))
        }))
      }
    })),

  randomizeLayerFx: (layer, which) =>
    set((s) => {
      const cur = s.composition.layers[layer]
      if (!cur || layerHeld(s, layer)) return {}
      // a rack on an empty source would process nothing (OSC, a stale menu)
      const src = which === 'A' ? cur.sourceA : which === 'B' ? cur.sourceB : null
      if (which !== 'layer' && (!src || src.kind === 'none')) return {}
      const old = which === 'A' ? cur.sourceAFx : which === 'B' ? cur.sourceBFx : cur.fx
      const next = randomizeRack(which)
      // the pinned effects stay where they sit, the rest is dealt around them
      const composition = keepPinnedUnits(
        {
          ...s.composition,
          layers: updateLayer(s.composition.layers, layer, (l) =>
            which === 'A'
              ? { ...l, sourceAFx: next }
              : which === 'B'
                ? { ...l, sourceBFx: next }
                : { ...l, fx: next }
          )
        },
        s.composition,
        s.pins
      )
      const dealt = new Set(fxArrayFor(composition, which === 'A' ? { kind: 'sourceA', layer } : which === 'B' ? { kind: 'sourceB', layer } : { kind: 'layer', layer }).map((f) => f.id))
      const gone = new Set((old ?? []).filter((f) => !f.locked && !dealt.has(f.id)).map((f) => f.id))
      // Only the units that actually went : a rack dice must not clear the
      // modulation aimed at the layer's sources or at its other two racks.
      // New effects are a new starting point, as a structural randomize is :
      // the next global Vary anchors on them rather than dealing the old rack
      // back from its baseline.
      return {
        composition: keep(s, dropTargets(composition, (t) => t.kind === 'fx' && gone.has(t.instId))),
        variationBaseline: null
      }
    }),

  layerPresets: (() => {
    try {
      return aliasShaderIds(JSON.parse(localStorage.getItem('opsia.layerPresets') ?? '[]'))
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
      if (!p || layerHeld(s, layer)) return s
      const composition = {
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
      // The layer's instrument is replaced : drop its now-orphaned patching
      // (source rows would seize the preset's inputs, fx rows dangle on old ids).
      return { composition: keep(s, dropLayerTargets(composition, layer)) }
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
      if (!src || layerHeld(s, layer)) return s
      const composition = {
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
      // Pasting replaces this layer's instrument : drop its orphaned patching.
      return { composition: keep(s, dropLayerTargets(composition, layer)) }
    }),

  rightView: 'layers',
  setRightView: (v) => set({ rightView: v }),
  toggleMixerView: () =>
    set((s) => {
      const next = s.rightView === 'mixer' ? 'layers' : 'mixer'
      return { rightView: next }
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
        blend: l.blend,
        sourceMix: l.sourceMix,
        sourceBlend: l.sourceBlend,
        harmony: l.harmony,
        // auto written out : a preset carries level-matching on as well as off
        coupling: { ...l.coupling, auto: l.coupling.auto !== false }
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
        composition: keep(s, {
          ...s.composition,
          layers: s.composition.layers.map((l, i) => {
            const m = p.layers[i]
            if (!m) return l
            return {
              ...l,
              opacity: m.opacity,
              speed: m.speed,
              blend: m.blend,
              ...(typeof m.sourceMix === 'number' ? { sourceMix: m.sourceMix } : {}),
              ...(m.sourceBlend ? { sourceBlend: m.sourceBlend } : {}),
              ...(typeof m.harmony === 'number' ? { harmony: Math.max(-1, Math.min(1, m.harmony)) } : {}),
              // (auto : on is the field's absence; a mix saved before it keeps the layer's)
              ...(m.coupling ? { coupling: { ...l.coupling, ...m.coupling, auto: (m.coupling.auto ?? l.coupling.auto) === false ? false : undefined } } : {})
            }
          })
        })
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
    set((s) => {
      // Re-picking the SAME generator that is already in the slot is a no-op :
      // rebuilding it with inputs:{} would wipe a dialled-in patch and (over
      // OSC, which re-sends /source every tick) make the slot un-editable.
      const cur = slotOf(s.composition, layer, slot)
      if (shaderId && cur && cur.kind === 'generator' && cur.shaderId === shaderId) {
        return { selection: { type: 'source' as const, layer, slot } }
      }
      return {
      ...swapSlot(
        s,
        {
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
        layer,
        slot,
        slotOf(s.composition, layer, slot)
      ),
      // Picking a source lands its controls in the Inspector immediately.
      selection: shaderId ? { type: 'source', layer, slot } : s.selection
      }
    }),
  setSourceVideo: (layer, slot, mediaId, mediaName, mediaPath) =>
    set((s) => ({
      ...swapSlot(
        s,
        {
          ...s.composition,
          layers: updateLayer(s.composition.layers, layer, (l) => {
            const vid = {
              kind: 'video' as const,
              shaderId: null,
              inputs: {},
              mediaId,
              mediaName,
              ...(mediaPath ? { mediaPath } : {}),
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
        layer,
        slot,
        slotOf(s.composition, layer, slot),
        true
      ),
      selection: { type: 'source', layer, slot }
    })),
  setSourceAudio: (layer, slot, mediaId, mediaName, mediaPath) =>
    set((s) => ({
      ...swapSlot(
        s,
        {
          ...s.composition,
          layers: updateLayer(s.composition.layers, layer, (l) => {
            const au = {
              kind: 'audio' as const,
              shaderId: 'gen-audio',
              inputs: defaultInputs('gen-audio'),
              mediaId,
              mediaName,
              mediaPath,
              videoPlaying: true,
              videoSpeed: 1,
              videoLoop: true,
              videoIn: 0,
              videoOut: 1
            }
            if (slot === 'A') return { ...l, sourceA: au, sourceAFx: [] }
            return { ...l, sourceB: au, sourceBFx: [] }
          })
        },
        layer,
        slot,
        slotOf(s.composition, layer, slot),
        true
      ),
      selection: { type: 'source', layer, slot }
    })),
  swapVideoSource: (layer, slot, mediaId, mediaName, opts) =>
    set((s) => ({
      composition: {
        ...s.composition,
        layers: updateLayer(s.composition.layers, layer, (l) => {
          const cur = slot === 'A' ? l.sourceA : l.sourceB
          if (!cur || (cur.kind !== 'video' && cur.kind !== 'audio')) return l
          // Another clip keeps the transport (speed, direction, loop, grain); its
          // trim starts whole, since the old in/out belonged to another length.
          const vid = {
            ...cur,
            mediaId,
            mediaName,
            ...(opts?.mediaPath ? { mediaPath: opts.mediaPath } : {}),
            ...(opts?.resetTrim ? { videoIn: 0, videoOut: 1 } : {})
          }
          return slot === 'A' ? { ...l, sourceA: vid } : { ...l, sourceB: vid }
        })
      }
    })),
  setSourceCapture: (layer, slot, spec, name) =>
    set((s) => ({
      ...swapSlot(
        s,
        {
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
        layer,
        slot,
        slotOf(s.composition, layer, slot),
        true
      ),
      selection: { type: 'source', layer, slot }
    })),
  setSourceHive: (layer, slot, host, port) =>
    set((s) => ({
      ...swapSlot(
        s,
        {
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
        layer,
        slot,
        slotOf(s.composition, layer, slot),
        true
      ),
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
  setCollagePool: (layer, slot, folder, pool) =>
    set((s) => {
      rememberCollage(folder, pool)
      const cur = slot === 'A' ? s.composition.layers[layer]?.sourceA : s.composition.layers[layer]?.sourceB
      if (!cur || cur.shaderId !== 'gen-collage') return s
      return {
        composition: updateLayer2(s.composition, layer, (l) => {
          const c2 = slot === 'A' ? l.sourceA : l.sourceB
          const next = { ...c2!, collageFolder: folder, collagePool: pool }
          return slot === 'A' ? { ...l, sourceA: next } : { ...l, sourceB: next }
        })
      }
    }),
  setCollageEdls: (layer, slot, edls) =>
    set((s) => {
      const cur = slot === 'A' ? s.composition.layers[layer]?.sourceA : s.composition.layers[layer]?.sourceB
      if (!cur || cur.shaderId !== 'gen-collage') return s
      return {
        composition: updateLayer2(s.composition, layer, (l) => {
          const c2 = slot === 'A' ? l.sourceA : l.sourceB
          const next = { ...c2!, collageEdls: edls }
          return slot === 'A' ? { ...l, sourceA: next } : { ...l, sourceB: next }
        })
      }
    }),
  setBgCollagePool: (folder, pool) =>
    set((s) => {
      rememberCollage(folder, pool)
      const bg = s.composition.background ?? makeDefaultBackground()
      if (bg.source.shaderId !== 'gen-collage') return s
      return {
        composition: {
          ...s.composition,
          background: { ...bg, source: { ...bg.source, collageFolder: folder, collagePool: pool } }
        }
      }
    }),
  setBgCollageEdls: (edls) =>
    set((s) => {
      const bg = s.composition.background ?? makeDefaultBackground()
      if (bg.source.shaderId !== 'gen-collage') return s
      return {
        composition: {
          ...s.composition,
          background: { ...bg, source: { ...bg.source, collageEdls: edls } }
        }
      }
    }),
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
      // another source : its pinned inputs go with its patching (swapSlot)
      const pins = sameSource(bg.source ?? null, source) ? s.pins : s.pins.filter((k) => !k.startsWith('bgsrc:'))
      return {
        composition: dropBgTargets(
          { ...s.composition, background: { ...bg, source } },
          bg.source ?? null
        ),
        pins: pins.length === s.pins.length ? s.pins : pins,
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
      return { composition: { ...s.composition, background: { ...bg, speed: Math.max(0, Math.min(BG_SPEED_MAX, v)) } } }
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
    set((s) => {
      const prev = s.composition.background
      const background = randomizeBackground(prev)
      // The rack is new (fresh ids) and the source may be : drop the rows aimed at
      // the old ones (bg-fx rows dangled on dead ids and ate the 12-row cap; a
      // source row seized the new source's input of the same name).
      const c = dropBgTargets({ ...s.composition, background }, prev?.source ?? null)
      // (its pinned effects stay in the rack, with their rows : keepPinnedUnits)
      return {
        composition: keep(s, keepPinnedUnits(dropTargets(c, (t) => t.kind === 'fx' && t.scope.kind === 'background'), s.composition, s.pins))
      }
    }),
  initBackground: () =>
    set((s) => {
      // Back to an empty ground : no source, no rack, the default opacity, clock,
      // shadow and mode, and no modulation left on the old source or rack.
      // (a pinned opacity, clock or shadow stays : like Init on a layer)
      const c = { ...s.composition, background: makeBlankBackground() }
      return {
        composition: keep(s, dropTargets(c, (t) => t.kind === 'bgSource' || (t.kind === 'fx' && t.scope.kind === 'background'))),
        selection: s.selection?.type === 'background' ? null : s.selection
      }
    }),
  applyBgPreset: (bg) =>
    set((s) => {
      const composition = {
        ...s.composition,
        background: {
          ...bg,
          source: { ...bg.source, inputs: { ...bg.source.inputs } },
          fx: bg.fx.map((f) => ({ ...f, id: uid(), inputs: { ...f.inputs } }))
        }
      }
      // The background source + FX are replaced (fresh ids) : drop mod/Meta rows
      // scoped to it — bg-fx rows would dangle on old ids, a bgSource row would
      // seize the preset's inputs.
      return {
        composition: keep(
          s,
          dropTargets(composition, (t) => t.kind === 'bgSource' || (t.kind === 'fx' && t.scope.kind === 'background'))
        ),
        selection: { type: 'background' }
      }
    }),
  bgPresets: (() => {
    try {
      return aliasShaderIds(JSON.parse(localStorage.getItem('opsia.bgPresets') ?? '[]'))
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
          // Assemble and audio slots share the play/loop/speed fields with video.
          if (!cur || (cur.kind !== 'video' && cur.kind !== 'assemble' && cur.kind !== 'audio')) return l
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
          // Every source drawn through the framing blit (People itself stays
          // video / capture only : Compositor.setFraming).
          if (!cur || (cur.kind !== 'video' && cur.kind !== 'capture' && cur.kind !== 'assemble' && cur.kind !== 'hive')) return l
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
  setBpm: (bpm) => {
    set((s) => ({
      composition: { ...s.composition, bpm: Math.max(20, Math.min(800, bpm)) }
    }))
    tempoEdited(get().composition.bpm)
  },
  // Performance dials : persisted to localStorage so a plain restart (which
  // seeds a fresh session, not the last one) keeps the feel set for a show, and
  // round-tripped through the session file so saved sessions carry it too.
  globalSpeed: (() => {
    const v = lsNum('opsia.globalSpeed')
    return Number.isFinite(v) && v > 0 ? Math.max(1 / 64, Math.min(64, v)) : 1
  })(),
  setGlobalSpeed: (x) => {
    const v = Math.max(1 / 64, Math.min(64, x))
    localStorage.setItem('opsia.globalSpeed', String(v))
    set({ globalSpeed: v })
  },
  morphMs: (() => {
    const v = lsNum('opsia.morphMs')
    return Number.isFinite(v) && v >= 0 ? Math.max(0, Math.min(30000, v)) : 1000
  })(),
  setMorphMs: (ms) => {
    const v = Math.max(0, Math.min(30000, ms))
    localStorage.setItem('opsia.morphMs', String(v))
    set({ morphMs: v })
  },
  applyMasterPreset: (fx, vibe, context) =>
    set((s) => {
      // Locked finalizers (Vibe, then Context) survive a chain preset; the
      // preset's vibe values land on the Vibe unit, its context values (a
      // dome-safe chain's vignette off) on Context.
      const locked = s.composition.master
        .filter((f) => f.locked)
        .map((f) =>
          vibe && f.shaderId === 'fx-vibe'
            ? { ...f, inputs: { ...f.inputs, ...vibe } }
            : context && f.shaderId === 'fx-context'
              ? { ...f, inputs: { ...f.inputs, ...context } }
              : f
        )
      // A node that reads another layer is pointed at an active one (lowest,
      // highest or second); with no active layer it is left reading nothing.
      const active = s.composition.layers
        .map((l, i) => (l.sourceA.kind !== 'none' || (l.sourceB && l.sourceB.kind !== 'none') ? i : -1))
        .filter((i) => i >= 0 && !s.composition.layers[i].mute)
      const resolve = (p?: 'bottom' | 'top' | 'second'): SidechainRef | undefined => {
        if (!p || !active.length) return undefined
        const i = p === 'bottom' ? active[0] : p === 'top' ? active[active.length - 1] : (active[1] ?? active[active.length - 1])
        return { kind: 'layer', layer: i }
      }
      const units: FxInstance[] = fx.map((f) => ({
        id: uid(),
        shaderId: f.shaderId,
        enabled: true,
        inputs: { ...f.inputs },
        ...(f.reads && resolve(f.reads) ? { sidechain: resolve(f.reads) } : {}),
        ...(f.reads2 && resolve(f.reads2) ? { sidechain2: resolve(f.reads2) } : {})
      }))
      const master = [...units, ...locked]
      // The non-locked chain is replaced (fresh ids), so drop master-fx mod/Meta
      // rows that no longer resolve — but the locked finalizers keep their ids,
      // so a modulator on the Vibe/Context survives the preset.
      const liveIds = new Set(master.map((f) => f.id))
      const composition = dropTargets(
        { ...s.composition, master },
        (t) => t.kind === 'fx' && t.scope.kind === 'master' && !liveIds.has(t.instId)
      )
      // A chain preset sets its own vibe : no longer a named palette.
      return { composition: keep(s, composition), vibePresetName: vibe ? null : s.vibePresetName }
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
          harmony: Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0))
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
  fxClipboard: null,
  varyPulse: [0, 0, 0, 0, 0],
  randPulse: 0,
  bumpRandPulse: () => set((s) => ({ randPulse: s.randPulse + 1 })),
  copyFx: (scope, instId) => {
    const inst = fxArrayFor(get().composition, scope).find((f) => f.id === instId)
    if (!inst?.shaderId) return
    set({
      fxClipboard: {
        shaderId: inst.shaderId,
        name: SHADER_BY_ID[inst.shaderId]?.name ?? inst.shaderId,
        // A deep-enough copy : point2D/colour inputs are arrays, and sharing
        // them would make the clipboard alias the live unit.
        inputs: Object.fromEntries(
          Object.entries(inst.inputs).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v])
        ),
        opacity: inst.opacity ?? 1,
        sidechain: inst.sidechain ?? null,
        sidechain2: inst.sidechain2 ?? null
      }
    })
  },
  pasteFxSettings: (scope, instId) =>
    set((s) => {
      const clip = s.fxClipboard
      if (!clip) return s
      const target = fxArrayFor(s.composition, scope).find((f) => f.id === instId)
      // Settings are per-shader : a Blur's inputs mean nothing to a Datamosh.
      if (!target || target.shaderId !== clip.shaderId) return s
      return {
        composition: updateFxArray(s.composition, scope, (fx) =>
          fx.map((f) =>
            f.id === instId
              ? {
                  ...f,
                  inputs: Object.fromEntries(
                    Object.entries(clip.inputs).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v])
                  ),
                  opacity: clip.opacity,
                  // Every rack resolves a layer sidechain (they all get the node
                  // context), and canHostFx already kept layer-only nodes out.
                  sidechain: clip.sidechain,
                  sidechain2: clip.sidechain2
                }
              : f
          )
        )
      }
    }),
  pasteFxAsNew: (scope, afterId) =>
    set((s) => {
      const clip = s.fxClipboard
      if (!clip || !canHostFx(scope, clip.shaderId)) return s
      const instId = uid()
      return {
        composition: updateFxArray(s.composition, scope, (fx) => {
          const unit: FxInstance = {
            id: instId,
            shaderId: clip.shaderId,
            enabled: true,
            inputs: Object.fromEntries(
              Object.entries(clip.inputs).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v])
            ),
            opacity: clip.opacity,
            sidechain: clip.sidechain,
            sidechain2: clip.sidechain2
          }
          const next = [...fx]
          // Drop it right after the unit that was right-clicked, so a paste
          // lands where the player is looking — but never past the pinned
          // finalizers, which must stay last.
          const lockedAt = next.findIndex((f) => f.locked)
          const anchor = afterId ? next.findIndex((f) => f.id === afterId) : -1
          let at = anchor >= 0 ? anchor + 1 : lockedAt >= 0 ? lockedAt : next.length
          if (lockedAt >= 0 && at > lockedAt) at = lockedAt
          next.splice(at, 0, unit)
          return next
        }),
        selection: { type: 'fx', scope, instId }
      }
    }),
  removeFx: (scope, instId) =>
    set((s) => {
      const composition = updateFxArray(s.composition, scope, (fx) =>
        fx.filter((f) => f.id !== instId || f.locked)
      )
      // Drop any modulation / Meta target that pointed at the removed unit, else
      // it lingers as a dead matrix row (counting against the assignment cap)
      // that renders nothing and can't be found to delete.
      return { composition: dropTargets(composition, (t) => t.kind === 'fx' && t.instId === instId) }
    }),
  toggleFx: (scope, instId) =>
    set((s) => ({
      // Locked units stay pinned and unremovable, but CAN be bypassed —
      // turning the Vibe off is a legitimate look.
      composition: updateFxArray(s.composition, scope, (fx) =>
        fx.map((f) => (f.id === instId ? { ...f, enabled: !f.enabled } : f))
      )
    })),
  toggleRackChain: (scope) =>
    set((s) => ({
      composition: updateFxArray(s.composition, scope, (fx) => {
        const regular = fx.filter((f) => !f.locked)
        const target = !(regular.length > 0 && regular.every((f) => f.enabled))
        return fx.map((f) => (f.locked ? f : { ...f, enabled: target }))
      })
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
  copyFxTo: (from, instId, to, beforeId = null) => {
    const s = get()
    const unit = fxArrayFor(s.composition, from).find((f) => f.id === instId)
    if (!unit || unit.locked || !canHostFx(to, unit.shaderId)) return false
    const copy: FxInstance = {
      ...unit,
      id: uid(),
      inputs: Object.fromEntries(Object.entries(unit.inputs).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v])),
      lightPath: undefined
    }
    set({ composition: updateFxArray(s.composition, to, (fx) => insertFx(fx, copy, beforeId)) })
    return true
  },
  moveFxTo: (from, instId, to, beforeId = null) => {
    if (sameFxScope(from, to)) {
      get().reorderFx(from, instId, beforeId)
      return true
    }
    const s = get()
    const unit = fxArrayFor(s.composition, from).find((f) => f.id === instId)
    if (!unit || unit.locked || !canHostFx(to, unit.shaderId)) return false
    let c = updateFxArray(s.composition, from, (fx) => fx.filter((f) => f.id !== instId))
    c = updateFxArray(c, to, (fx) => insertFx(fx, unit, beforeId))
    // Its modulation and Meta destinations follow it (same id, new rack).
    const hit = (t: ModTarget): boolean => t.kind === 'fx' && t.instId === instId && sameFxScope(t.scope, from)
    const moveT = (t: ModTarget): ModTarget => (hit(t) && t.kind === 'fx' ? { ...t, scope: to } : t)
    c = {
      ...c,
      modMatrix: c.modMatrix.map((a) => (hit(a.target) ? { ...a, target: moveT(a.target) } : a)),
      metaKnobs: c.metaKnobs.map((k) => (k.destinations.some(hit) ? { ...k, destinations: k.destinations.map(moveT) } : k))
    }
    const sel = s.selection
    set({
      composition: c,
      selection: sel && sel.type === 'fx' && sel.instId === instId ? { type: 'fx', scope: to, instId } : sel
    })
    return true
  },
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
  setFxInputs: (scope, instId, inputs) =>
    set((s) => ({
      composition: updateFxArray(s.composition, scope, (fx) =>
        fx.map((f) => (f.id === instId ? { ...f, inputs: { ...inputs } } : f))
      )
    })),
  setFxSidechain: (scope, instId, ref, which = 1) =>
    set((s) => ({
      composition: updateFxArray(s.composition, scope, (fx) =>
        fx.map((f) => (f.id === instId ? (which === 2 ? { ...f, sidechain2: ref } : { ...f, sidechain: ref }) : f))
      )
    })),

  randomize: (scope, intensity = 1) =>
    set((s) => {
      // (the pinned effects stay in the racks it deals : keepPinnedUnits)
      const composition = keep(s, keepPinnedUnits(randomizeComposition(s.composition, scope, intensity), s.composition, s.pins))
      beginSceneMorph(s.composition, composition, s.morphMs, performance.now()) // morph to the new draw
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
      const composition = keep(s, varyComposition(base, amount))
      beginSceneMorph(s.composition, composition, s.morphMs, performance.now())
      return { composition, variationBaseline: base, varyPulse: bumpPulse(s.varyPulse, 4) }
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
      return { composition: keep(s, { ...s.composition, metaKnobs }) }
    }),
  vibePresetName: null,
  setVibePresetName: (n) => set({ vibePresetName: n }),

  randomizeMasterParams: () =>
    set((s) => ({
      composition: keep(s, {
        ...s.composition,
        // Keep the chain and the pinned Vibe; re-roll every other unit's
        // inputs within curated ranges.
        master: s.composition.master.map((f) =>
          f.shaderId && !f.locked
            ? { ...f, inputs: randomizeInputs(f.shaderId, f.inputs) }
            : f
        )
      })
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
  midiOutputName: localStorage.getItem('opsia.midiOutput') ?? '',
  setMidiOutputName: (name) => {
    localStorage.setItem('opsia.midiOutput', name)
    set({ midiOutputName: name })
  },
  midiClockOut: localStorage.getItem('opsia.midiClockOut') === '1',
  setMidiClockOut: (on) => {
    localStorage.setItem('opsia.midiClockOut', on ? '1' : '0')
    set({ midiClockOut: on })
    playEdited('clock', on)
  },
  midiThru: localStorage.getItem('opsia.midiThru') === '1',
  setMidiThru: (on) => {
    localStorage.setItem('opsia.midiThru', on ? '1' : '0')
    set({ midiThru: on })
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
        // a World's modulator you change is yours from then on
        modulators: releaseWorldMod(s.composition.modulators, i).map((m, idx) =>
          idx === i ? { ...m, ...partial } : m
        )
      }
    })),
  assignMod: (mod, target, depth, mode) => {
    // No explicit mode → choose from the target's CURRENT base. Multiply is the
    // right default for riding a set level (VCA), but its law base·(1−a+a·mod)
    // is a guaranteed NO-OP on a zero base — bind an LFO to a param sitting at
    // 0 (a fresh FX's torn/contour/mask, any zeroed slider) and nothing can
    // ever happen, which reads as "modulation is broken". Near-zero bases get
    // Replace (bipolar swing around base : immediately audible); the chip can
    // still flip it after. A Sonify parameter swings around its place (a probe's
    // position, a pitch, a time : a multiple of them means little, and many sit
    // at 0), as its own assign panel always bound them.
    mode = mode ?? (target.kind === 'sonify' || baseNormForTarget(get(), target) < 0.05 ? 'replace' : 'multiply')
    const key = modTargetKey(target)
    // Check existence + cap AND append inside ONE set() updater : otherwise two
    // assignMod calls in the same tick (an OSC burst) both pass a stale cap
    // check and exceed MAX_MOD_ASSIGNMENTS.
    let result = true
    set((st) => {
      const existing = st.composition.modMatrix.find(
        (a) => a.mod === mod && modTargetKey(a.target) === key
      )
      // A binding on the World's modulator, changed or added : the modulator is
      // yours from then on (a World never takes it back).
      const modulators = releaseWorldMod(st.composition.modulators, mod)
      if (existing) {
        return {
          composition: {
            ...st.composition,
            modulators,
            modMatrix: st.composition.modMatrix.map((a) =>
              a.id === existing.id ? { ...a, depth } : a
            )
          }
        }
      }
      // Full : first let go of DEAD bindings (an effect removed, a source
      // emptied) : they still count against the cap, and a matrix full of them
      // read as "modulation stopped working" (nothing happened on a click).
      let matrix = st.composition.modMatrix
      if (matrix.length >= MAX_MOD_ASSIGNMENTS) matrix = matrix.filter((a) => targetAlive(st.composition, a.target, st.audioLayer))
      if (matrix.length >= MAX_MOD_ASSIGNMENTS) {
        result = false
        return {}
      }
      // New bindings default to Multiply (VCA scaling of the base).
      const entry: ModAssignment = { id: uid(), mod, target, depth, mode }
      return {
        composition: { ...st.composition, modulators, modMatrix: [...matrix, entry] }
      }
    })
    return result
  },
  randomizeModulation: (candidatesIn, addNew) => {
    // a persistent control keeps its modulation as it is
    const pins = get().pins
    const candidates = candidatesIn.filter((t) => !isPinnedTarget(t, pins))
    if (!candidates.length) return true
    let ok = true
    set((st) => {
      const c = st.composition
      // Eligible SOURCES : the ENABLED modulators (what's actually running); fall
      // back to all 8 slots when none are enabled, so the action is never a no-op.
      // The World's own modulator and its bindings are left alone (like Randomize).
      const wm = worldModIndex(c)
      const on = c.modulators.map((m, i) => (m.enabled && i !== wm ? i : -1)).filter((i) => i >= 0)
      const mods = on.length ? on : c.modulators.map((_, i) => i).filter((i) => i !== wm)
      if (!mods.length) return {}
      const pickMod = (): number => mods[Math.floor(Math.random() * mods.length)]
      // Depth : a musical magnitude with an occasional inversion (both modes read
      // |depth| as the amount; a negative depth inverts the signal).
      const pickDepth = (): number => (0.4 + Math.random() * 0.6) * (Math.random() < 0.28 ? -1 : 1)
      const candKeys = new Set(candidates.map(modTargetKey))

      let changed = false
      // (a) re-roll every existing assignment sitting on one of these targets.
      let matrix = c.modMatrix.map((a) => {
        if (!candKeys.has(modTargetKey(a.target)) || isWorldRow(c, a)) return a
        changed = true
        return { ...a, mod: pickMod(), depth: pickDepth() }
      })

      // (b) optionally seed a random subset of the still-unassigned candidates.
      // Full : dead bindings go first (as in assignMod); still full, the caller says so.
      if (addNew && matrix.length >= MAX_MOD_ASSIGNMENTS) {
        const alive = matrix.filter((a) => targetAlive(c, a.target, st.audioLayer))
        if (alive.length < matrix.length) { matrix = alive; changed = true }
      }
      if (addNew) {
        const assigned = new Set(matrix.map((a) => modTargetKey(a.target)))
        const open = candidates.filter((t) => !assigned.has(modTargetKey(t)))
        for (let i = open.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          const tmp = open[i]; open[i] = open[j]; open[j] = tmp
        }
        const budget = MAX_MOD_ASSIGNMENTS - matrix.length
        const want = Math.max(1, Math.round(open.length * 0.6))
        const k = Math.min(open.length, Math.max(0, budget), 6, want)
        if (open.length > 0 && budget <= 0) ok = false
        for (let i = 0; i < k; i++) {
          const target = open[i]
          const mode: ModMode = baseNormForTarget(st, target) < 0.05 ? 'replace' : 'multiply'
          matrix = [...matrix, { id: uid(), mod: pickMod(), depth: pickDepth(), target, mode }]
          changed = true
        }
      }
      return changed ? { composition: { ...c, modMatrix: matrix } } : {}
    })
    return ok
  },
  // A World's binding removed by hand : the World forgets it (its modulator stays
  // the World's, to clear or re-route at the next apply). Muted, re-scaled or
  // switched : the modulator is yours from then on.
  removeAssignment: (id) =>
    set((s) => ({
      composition: {
        ...s.composition,
        modulators: s.composition.modulators.some((m) => m.fromWorld && Array.isArray(m.worldRows) && m.worldRows.includes(id))
          ? s.composition.modulators.map((m) =>
              m.fromWorld && Array.isArray(m.worldRows) && m.worldRows.includes(id) ? { ...m, worldRows: m.worldRows.filter((r) => r !== id) } : m
            )
          : s.composition.modulators,
        modMatrix: s.composition.modMatrix.filter((a) => a.id !== id)
      }
    })),
  toggleAssignmentMuted: (id) =>
    set((s) => ({
      composition: {
        ...s.composition,
        modulators: releaseWorldModOfRow(s.composition, id),
        modMatrix: s.composition.modMatrix.map((a) => (a.id === id ? { ...a, muted: !a.muted } : a))
      }
    })),
  setAssignmentDepth: (id, depth) =>
    set((s) => ({
      composition: {
        ...s.composition,
        modulators: releaseWorldModOfRow(s.composition, id),
        modMatrix: s.composition.modMatrix.map((a) =>
          a.id === id ? { ...a, depth: Math.max(-10, Math.min(10, depth)) } : a
        )
      }
    })),
  setAssignmentMode: (id, mode) =>
    set((s) => ({
      composition: {
        ...s.composition,
        modulators: releaseWorldModOfRow(s.composition, id),
        modMatrix: s.composition.modMatrix.map((a) => (a.id === id ? { ...a, mode } : a))
      }
    })),
  setAssignmentShape: (id, patch) =>
    set((s) => ({
      composition: {
        ...s.composition,
        modulators: releaseWorldModOfRow(s.composition, id),
        modMatrix: s.composition.modMatrix.map((a) => {
          if (a.id !== id) return a
          const merged: Record<string, unknown> = { ...(a.shape ?? {}), ...patch }
          for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k]
          const shape = sanitizeModShape(merged, a.mod)
          const { shape: _old, ...rest } = a
          return shape ? { ...rest, shape } : rest
        })
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
    const z = lsNum('opsia.uiZoom')
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
    if (!get().warpFromSession) localStorage.setItem('opsia.warpEnabled', on ? '1' : '0')
    set({ warpEnabled: on })
  },
  setWarpGrid: (on) => set({ warpGrid: on }),
  warpFeather: storedWarpFeather(),
  setWarpFeather: (px) => {
    const v = Math.max(0, Math.min(WARP_FEATHER_MAX, Number.isFinite(px) ? px : 0))
    // written once the slider rests, and a full storage never stops the slider
    if (!get().warpFromSession) {
      window.clearTimeout(featherSave)
      featherSave = window.setTimeout(() => {
        try { localStorage.setItem('opsia.warpFeather', String(v)) } catch { /* quota */ }
      }, 300)
    }
    set({ warpFeather: v })
  },
  outSharp: (() => { try { return localStorage.getItem('opsia.outSharp') === '1' } catch { return false } })(),
  setOutSharp: (on) => {
    try { localStorage.setItem('opsia.outSharp', on ? '1' : '0') } catch { /* quota */ }
    set({ outSharp: on })
  },
  setWarpCorner: (corner, x, y) =>
    set((s) => {
      const c = [...s.warpCorners]
      c[corner * 2] = Math.max(-0.5, Math.min(1.5, x))
      c[corner * 2 + 1] = Math.max(-0.5, Math.min(1.5, y))
      if (!s.warpFromSession) localStorage.setItem('opsia.warpCorners', JSON.stringify(c))
      return { warpCorners: c }
    }),
  resetWarp: () => {
    const c = [0, 0, 1, 0, 1, 1, 0, 1]
    if (!get().warpFromSession) localStorage.setItem('opsia.warpCorners', JSON.stringify(c))
    set({ warpCorners: c })
  },
  warpInSession: localStorage.getItem('opsia.warpInSession') === '1',
  setWarpInSession: (on) => {
    localStorage.setItem('opsia.warpInSession', on ? '1' : '0')
    set({ warpInSession: on })
    if (!on) restoreMachineWarp(set, get)
  },
  warpFromSession: false,
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
  audioDeviceLabel: localStorage.getItem('opsia.audioDeviceLabel') || null,
  setAudioDeviceId: (id, label) => {
    const name = id ? label ?? null : null
    if (id) localStorage.setItem('opsia.audioDeviceId', id)
    else localStorage.removeItem('opsia.audioDeviceId')
    if (name) localStorage.setItem('opsia.audioDeviceLabel', name)
    else localStorage.removeItem('opsia.audioDeviceLabel')
    set({ audioDeviceId: id, audioDeviceLabel: name })
  },
  audioMonitor: localStorage.getItem('opsia.audioMonitor') === '1',
  setAudioMonitor: (on) => {
    localStorage.setItem('opsia.audioMonitor', on ? '1' : '0')
    set({ audioMonitor: on })
  },
  audioMonitorLevel: (() => {
    const n = lsNum('opsia.audioMonitorLevel')
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.8
  })(),
  setAudioMonitorLevel: (v) => {
    const lvl = Math.max(0, Math.min(1, v))
    localStorage.setItem('opsia.audioMonitorLevel', String(lvl))
    set({ audioMonitorLevel: lvl })
  },
  audioMonitorSink: localStorage.getItem('opsia.audioMonitorSink') || '',
  setAudioMonitorSink: (id) => {
    localStorage.setItem('opsia.audioMonitorSink', id)
    set({ audioMonitorSink: id })
  },
  audioDenoise: localStorage.getItem('opsia.audioDenoise') === '1',
  setAudioDenoise: (on) => {
    localStorage.setItem('opsia.audioDenoise', on ? '1' : '0')
    set({ audioDenoise: on })
  },
  audioDenoiseNotches: (() => {
    try {
      const a = JSON.parse(localStorage.getItem('opsia.audioDenoiseNotches') || '[]')
      if (!Array.isArray(a)) return []
      // Migrate the pre-comb format (a bare number[] of freqs) to {f, q}.
      return a.map((x) => (typeof x === 'number' ? { f: x, q: 20 } : x)).filter((x) => x && Number.isFinite(x.f))
    } catch { return [] }
  })(),
  setAudioDenoiseNotches: (notches) => {
    localStorage.setItem('opsia.audioDenoiseNotches', JSON.stringify(notches))
    set({ audioDenoiseNotches: notches })
  },
  couplingOn: true,
  setCouplingOn: (on) => set({ couplingOn: on }),
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
  // The Feel macros are the session's (FEEL_NEUTRAL, Session.feel) : neutral at launch.
  density: FEEL_NEUTRAL.density,
  setDensity: (v) => set({ density: v }),
  gestureTexture: FEEL_NEUTRAL.gestureTexture,
  setGestureTexture: (v) => set({ gestureTexture: v }),
  coalesce: FEEL_NEUTRAL.coalesce,
  setCoalesce: (v) => set({ coalesce: v }),
  // Temperament controls rest at 0 (off), not the 0.5 deadzone of the field macros.
  tonicity: FEEL_NEUTRAL.tonicity,
  setTonicity: (v) => set({ tonicity: v }),
  // Shutter + Superimposition are strobe-like performance effects : always start
  // at 0 on load (they never persist a lingering strobe across sessions/reloads).
  shutter: 0,
  setShutter: (v) => set({ shutter: v }),
  drift: FEEL_NEUTRAL.drift,
  setDrift: (v) => set({ drift: v }),
  // Flow ↔ Interruption is bipolar : rests at 0.5 (neutral).
  flow: FEEL_NEUTRAL.flow,
  setFlow: (v) => set({ flow: v }),
  superFlicker: 0,
  setSuperFlicker: (v) => set({ superFlicker: v }),
  markSignalEnabled: localStorage.getItem('opsia.markSignalEnabled') === '1',
  markSignalY: (() => { const v = lsNum('opsia.markSignalY'); return Number.isFinite(v) ? v : 0.5 })(),
  setMarkSignal: (partial) =>
    set((s) => {
      if (partial.enabled !== undefined) localStorage.setItem('opsia.markSignalEnabled', partial.enabled ? '1' : '0')
      if (partial.y !== undefined) localStorage.setItem('opsia.markSignalY', String(partial.y))
      return { markSignalEnabled: partial.enabled ?? s.markSignalEnabled, markSignalY: partial.y ?? s.markSignalY }
    }),
  worlds: startWorlds,
  world: startWorld.id,
  setWorld: (id) => {
    const s = get()
    const w = s.worlds.find((x) => x.id === id) ?? s.worlds[0]
    localStorage.setItem('opsia.world', w.id)
    // Applying a World biases the current composition (undoable), over the
    // MORPH time like a scene recall. The coupling lands at once (its mode is a
    // switch : morphed, every layer would hand over through a crossfade), so
    // only the mood and the film ease.
    const prev = s.worlds.find((x) => x.id === s.world)
    const composition = keep(s, applyWorldToComposition(s.composition, w, prev))
    beginSceneMorph(s.composition, composition, s.morphMs, performance.now(), { couplingFromTarget: true })
    set({ world: w.id, composition })
    // A routing that could not go in says so, wherever the World was picked
    // (here, the top bar, OSC, MIDI) : a full matrix never fails silently.
    const skip = worldRouteSkip(s.composition, w)
    if (skip) showToast(`World ${w.name} : audio routing skipped, ${skip}`, 'warn', 5200)
  },
  worldAmount: (() => {
    const v = lsNum('opsia.worldAmount')
    const a = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1
    setWorldAmountBase(a)
    return a
  })(),
  setWorldAmount: (v) => {
    const a = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 1))
    try { localStorage.setItem('opsia.worldAmount', String(a)) } catch { /* private storage */ }
    setWorldAmountBase(a)
    set({ worldAmount: a })
  },
  resetWorld: (id) =>
    set((s) => {
      const o = BUILTIN_WORLDS.find((x) => x.id === id)
      if (!o) return {}
      const edited = s.worlds.find((w) => w.id === id)
      const worlds = s.worlds.map((w) => (w.id === id ? structuredClone(o) : w))
      saveUserWorlds(worlds)
      const fresh = worlds.find((w) => w.id === id)!
      // (through the gate, like any World : what you pinned stays)
      return s.world === id ? { worlds, composition: keep(s, applyWorldToComposition(s.composition, fresh, edited)) } : { worlds }
    }),
  saveWorldAsMine: (id) => {
    const s = get()
    const w = s.worlds.find((x) => x.id === id)
    const o = BUILTIN_WORLDS.find((x) => x.id === id)
    if (!w || !o) return id
    // A name of its own (OSC picks a World by name).
    const nw = cloneWorld(w, uniqueWorldName(s.worlds, `${w.name.replace(/ copy$/, '')} (mine)`))
    const worlds = [...s.worlds.map((x) => (x.id === id ? structuredClone(o) : x)), nw]
    saveUserWorlds(worlds)
    if (s.world !== id) {
      set({ worlds })
      return nw.id
    }
    // The active one : the copy takes its place as it is (nothing re-applied, so
    // the picture stays where it is) and the built-in goes back as it ships.
    localStorage.setItem('opsia.world', nw.id)
    set({ worlds, world: nw.id })
    return nw.id
  },
  takeWorldFromComposition: (id) => {
    const s = get()
    const w = s.worlds.find((x) => x.id === id)
    if (!w) return id
    const got = worldFromComposition(s.composition)
    // (through the same check as any World : a session can carry odd values)
    if (w.builtin) {
      const taken = { ...cloneWorld(w, uniqueWorldName(s.worlds, `${w.name} (taken)`)), ...got }
      const nw = sanitizeWorld(taken) ?? taken
      const worlds = [...s.worlds, nw]
      saveUserWorlds(worlds)
      set({ worlds })
      return nw.id
    }
    const worlds = s.worlds.map((x) => (x.id === id ? sanitizeWorld({ ...x, ...got }) ?? x : x))
    saveUserWorlds(worlds)
    set({ worlds })
    return id
  },
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
      const before = s.worlds.find((w) => w.id === id)
      if (!before) return {}
      // Whatever the edit, the World stays one the page and the picture can use.
      const edited = sanitizeWorld({ ...before, ...partial, id, builtin: before.builtin }) ?? before
      const worlds = s.worlds.map((w) => (w.id === id ? edited : w))
      saveUserWorlds(worlds)
      // If the edited world is the active one, re-apply it live : what it sets
      // (a new name or description changes nothing on screen).
      const sets = (['coupling', 'context', 'finalizer', 'autoMod', 'layers'] as const).some((k) => k in partial)
      return s.world === id && sets
        ? { worlds, composition: keep(s, applyWorldToComposition(s.composition, edited, before)) } // (what you pinned stays)
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
      return { worlds, world: 'synthetic', composition: keep(s, applyWorldToComposition(s.composition, syn, w)) }
    }),
  renameWorld: (id, name) => get().updateWorld(id, { name }),
  worldPageOpen: false,
  setWorldPageOpen: (on) => set({ worldPageOpen: on }),
  ndi: loadNdi(),
  setNdi: (patch) =>
    set((s) => {
      const ndi = sanitizeNdiConfig({ ...s.ndi, ...patch })
      try { localStorage.setItem('opsia.ndi', JSON.stringify(ndi)) } catch { /* quota */ }
      return { ndi, ndiActive: ndi.enabled }
    }),
  ndiStatus: idleNdiStatus(),
  setNdiStatus: (ndiStatus) => set({ ndiStatus }),
  ndiActive: loadNdi().enabled,
  shareActive: false,
  shareRoute: { local: false, topDown: false },
  setShareActive: (on, route) => set({ shareActive: on, shareRoute: on && route ? route : { local: false, topDown: false } }),
  lights: (() => {
    const def: LightConfig = {
      enabled: false, protocol: 'artnet', host: '', cols: 8, rows: 1, order: 'rgb',
      brightness: 1, gamma: 2.2, universe: 0, startChannel: 1, serpentine: false, fps: 40
    }
    try { return { ...def, ...JSON.parse(localStorage.getItem('opsia.lights') || '{}') } as LightConfig }
    catch { return def }
  })(),
  setLights: (partial) =>
    set((s) => {
      const lights = { ...s.lights, ...partial }
      localStorage.setItem('opsia.lights', JSON.stringify(lights))
      return { lights } // pushed to main by an App effect watching `lights`
    }),
  bodyControl: (() => {
    const def: BodyControlConfig = {
      enabled: false, deviceId: null, hands: true, pose: true, face: false, silhouette: false, flow: false, mirror: true, hiRes: false,
      sensitivity: 0.5, gestureSensitivity: {}, holdMs: 1200, oscOut: false,
      // Actions are shared trigger ids (engine/midi.ts). Face + hold gestures
      // default to unbound : blink / brow move involuntarily, and holds are
      // deliberate, so the performer opts each in.
      gestures: {
        pinchLeft: 'scene:prev', pinchRight: 'scene:next', clap: 'fire:randomize', cross: 'fire:flush',
        handsUp: 'fire:freeze', leanLeft: 'none', leanRight: 'none', crouch: 'none', jump: 'none',
        armsCross: 'none', tPose: 'none', raiseLeft: 'none', raiseRight: 'none',
        mouthPop: 'none', browRaise: 'none', winkLeft: 'none', winkRight: 'none',
        smile: 'none', frown: 'none', browFurrow: 'none', squint: 'none', cheekPuff: 'none', kiss: 'none',
        jawLeft: 'none', jawRight: 'none', mouthLeft: 'none', mouthRight: 'none', tongueOut: 'none', blinkBoth: 'none',
        headLeft: 'none', headRight: 'none', headUp: 'none', headDown: 'none', tiltLeft: 'none', tiltRight: 'none',
        holdHandsUp: 'none', holdPinchLeft: 'none', holdPinchRight: 'none', holdArmsWide: 'none', holdMouthOpen: 'none'
      },
      rules: []
    }
    // Migrate the pre-unification action names (before gestures shared the MIDI
    // trigger vocabulary) so an existing config keeps working.
    const LEGACY: Record<string, string> = {
      scenePrev: 'scene:prev', sceneNext: 'scene:next', randomize: 'fire:randomize', panic: 'fire:flush', freeze: 'fire:freeze'
    }
    try {
      const saved = JSON.parse(localStorage.getItem('opsia.bodyControl') || '{}')
      const savedGestures: Record<string, string> = saved.gestures || {}
      const migrated: Record<string, string> = {}
      for (const k in savedGestures) migrated[k] = LEGACY[savedGestures[k]] ?? savedGestures[k]
      // enabled is never restored : a camera must be re-armed each launch (opt-in),
      // so the app never grabs the webcam on its own at boot.
      return {
        ...def, ...saved, enabled: false,
        gestures: { ...def.gestures, ...migrated },
        rules: Array.isArray(saved.rules) ? saved.rules : []
      }
    } catch { return def }
  })(),
  setBodyControl: (partial) =>
    set((s) => {
      const bodyControl = { ...s.bodyControl, ...partial }
      localStorage.setItem('opsia.bodyControl', JSON.stringify(bodyControl))
      return { bodyControl } // pushed to the tracker by an App effect watching it
    }),
  bodyPageOpen: false,
  setBodyPageOpen: (on) => set({ bodyPageOpen: on }),
  resolume: loadResolume(),
  dataflou: loadDataflou(),
  setDataflou: (patch) =>
    set((s) => {
      const dataflou = { ...s.dataflou, ...patch }
      try {
        localStorage.setItem('opsia.dataflou', JSON.stringify(dataflou))
      } catch {
        /* a full quota must never break an edit */
      }
      return { dataflou }
    }),
  dome: loadDome(),
  setDome: (patch) => {
    const was = get().dome.enabled
    // Turning the dome off puts its alignment grid away : the next time it is
    // on, the grid is off until you ask for it.
    const off = patch.enabled === false && was
    set((s) => ({ dome: persistDome(sanitizeDome({ ...s.dome, ...patch, ...(off ? { grid: false } : {}) })) }))
    const on = get().dome.enabled
    // the Satosphère square (if armed) comes with the dome and goes with it
    if (on && !was) enterDomeSquare(get(), set)
    else if (!on && was) leaveDomeSquare(get(), set)
  },
  outXform: OUT_IDENTITY,
  setOutXform: (patch) => set((s) => ({ outXform: sanitizeOutXform({ ...s.outXform, ...patch }) })),
  outXformReset: 0,
  resetOutXform: () => set((s) => ({ outXform: OUT_IDENTITY, outXformReset: s.outXformReset + 1 })),
  space: loadSpace(),
  // (a refused host, from OSC or the page, leaves the one before : it fell back
  // to the default and the positions went to this computer)
  setSpace: (patch) =>
    set((s) => ({
      space: persistSpace(sanitizeSpaceConfig({ ...s.space, ...patch, ...('host' in patch && !validSpaceHost(patch.host) ? { host: s.space.host } : {}) }))
    })),
  setSpaceVoice: (voice, patch) =>
    set((s) => ({
      space: persistSpace(sanitizeSpaceConfig({ ...s.space, voices: { ...s.space.voices, [voice]: { ...s.space.voices[voice], ...patch } } }))
    })),
  setDomeSim: (patch) => set((s) => ({ dome: persistDome(sanitizeDome({ ...s.dome, sim: { ...s.dome.sim, ...patch } })) })),
  resolumePageOpen: false,
  setResolumePageOpen: (on) => set({ resolumePageOpen: on }),
  setResolume: (patch) =>
    set((s) => {
      // While locked only the transport-ish fields may change.
      if (s.resolume.locked && Object.keys(patch).some((k) => !RESO_LOCK_FREE.has(k))) return s
      return { resolume: persistResolume({ ...s.resolume, ...patch }) }
    }),
  resoLoadSession: (session) =>
    set((s) => {
      const r = s.resolume
      if (r.locked) return s
      // Keep hand-added / learned columns, and any column whose address the new
      // composition still has (so its connections and shaping survive a reload).
      const byAddr = new Map(r.outputs.map((o) => [o.address, o]))
      const fresh: ResoOutput[] = resoCatalogue(session).map((o) => byAddr.get(o.address) ?? { ...o, id: uid() })
      const known = new Set(fresh.map((o) => o.address))
      const kept = r.outputs.filter((o) => !known.has(o.address) && (o.group === 'Learned' || o.group === 'Custom'))
      const outputs = [...fresh, ...kept]
      const ids = new Set(outputs.map((o) => o.id))
      const inputs = r.inputs.length ? r.inputs : RESO_DEFAULT_ROWS().map(freshInput)
      // A big set folds everything but the composition, selected clip and any
      // group that already carries a connection, so the matrix opens readable.
      const busy = new Set(r.cells.map((c) => outputs.find((o) => o.id === c.o)?.group).filter(Boolean) as string[])
      const groups = [...new Set(outputs.map((o) => o.group))]
      const folded = groups.filter((g) => g !== 'Composition' && g !== 'Selected clip' && !busy.has(g))
      return {
        resolume: persistResolume({
          ...r,
          session,
          outputs,
          inputs,
          folded,
          cells: r.cells.filter((c) => ids.has(c.o)),
          snapshots: r.snapshots.map((sn) => (sn ? sn.filter((c) => ids.has(c.o)) : sn))
        })
      }
    }),
  resoRandomize: () => {
    const r = get().resolume
    if (r.locked || !r.inputs.length) return -1
    // A dice wires continuous controls and switches only : never a trigger (it
    // would launch clips and columns at random) nor the composition master (it
    // would black the whole output out). The unfolded groups first : the pins
    // land where you can see them.
    const ok = r.outputs.filter((o) => o.kind !== 'trigger' && o.address !== '/composition/master')
    const open = ok.filter((o) => !r.folded.includes(o.group))
    const pool = open.length ? open : ok
    if (!pool.length) return -1
    const cells: typeof r.cells = []
    for (const inp of r.inputs) {
      const n = Math.random() < 0.35 ? 0 : Math.random() < 0.7 ? 1 : 2
      const used = new Set<string>()
      for (let k = 0; k < n && used.size < pool.length; k++) {
        const o = pool[Math.floor(Math.random() * pool.length)]
        if (used.has(o.id)) continue
        used.add(o.id)
        cells.push({ i: inp.id, o: o.id, amount: Math.round((0.4 + Math.random() * 0.6) * 100) / 100 })
      }
    }
    set({ resolume: persistResolume({ ...r, cells }) })
    return cells.length
  },
  resoToggleCell: (i, o) =>
    set((s) => {
      const r = s.resolume
      if (r.locked) return s
      const has = r.cells.some((c) => c.i === i && c.o === o)
      const cells = has ? r.cells.filter((c) => !(c.i === i && c.o === o)) : [...r.cells, { i, o, amount: 1 }]
      return { resolume: persistResolume({ ...r, cells }) }
    }),
  resoSetCellAmount: (i, o, amount) =>
    set((s) => {
      const r = s.resolume
      if (r.locked) return s
      const a = Math.max(0.05, Math.min(1, amount))
      return { resolume: persistResolume({ ...r, cells: r.cells.map((c) => (c.i === i && c.o === o ? { ...c, amount: a } : c)) }) }
    }),
  resoAddInput: (source) =>
    set((s) => {
      const r = s.resolume
      if (r.locked) return s
      return { resolume: persistResolume({ ...r, inputs: [...r.inputs, freshInput(source)] }) }
    }),
  resoRemoveInput: (id) =>
    set((s) => {
      const r = s.resolume
      if (r.locked) return s
      return {
        resolume: persistResolume({
          ...r,
          inputs: r.inputs.filter((x) => x.id !== id),
          cells: r.cells.filter((c) => c.i !== id),
          snapshots: r.snapshots.map((sn) => (sn ? sn.filter((c) => c.i !== id) : sn))
        })
      }
    }),
  resoUpdateInput: (id, patch) =>
    set((s) => {
      const r = s.resolume
      if (r.locked) return s
      return { resolume: persistResolume({ ...r, inputs: r.inputs.map((x) => (x.id === id ? { ...x, ...patch, id } : x)) }) }
    }),
  resoMoveInput: (id, dir) =>
    set((s) => {
      const r = s.resolume
      if (r.locked) return s
      const i = r.inputs.findIndex((x) => x.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= r.inputs.length) return s
      const inputs = [...r.inputs]
      ;[inputs[i], inputs[j]] = [inputs[j], inputs[i]]
      return { resolume: persistResolume({ ...r, inputs }) }
    }),
  resoAddOutput: (o) =>
    set((s) => {
      const r = s.resolume
      if (r.locked || r.outputs.some((x) => x.address === o.address)) return s
      return {
        resolume: persistResolume({ ...r, outputs: [...r.outputs, { ...o, id: uid() }], folded: r.folded.filter((g) => g !== o.group) })
      }
    }),
  resoRemoveOutput: (id) =>
    set((s) => {
      const r = s.resolume
      if (r.locked) return s
      return {
        resolume: persistResolume({
          ...r,
          outputs: r.outputs.filter((x) => x.id !== id),
          cells: r.cells.filter((c) => c.o !== id),
          snapshots: r.snapshots.map((sn) => (sn ? sn.filter((c) => c.o !== id) : sn))
        })
      }
    }),
  resoUpdateOutput: (id, patch) =>
    set((s) => {
      const r = s.resolume
      if (r.locked) return s
      return { resolume: persistResolume({ ...r, outputs: r.outputs.map((x) => (x.id === id ? { ...x, ...patch, id } : x)) }) }
    }),
  resoToggleFold: (group) =>
    set((s) => {
      const r = s.resolume
      const folded = r.folded.includes(group) ? r.folded.filter((g) => g !== group) : [...r.folded, group]
      return { resolume: persistResolume({ ...r, folded }) }
    }),
  resoClearCells: () =>
    set((s) => {
      const r = s.resolume
      if (r.locked) return s
      return { resolume: persistResolume({ ...r, cells: [] }) }
    }),
  resoSnapshot: (slot, store) =>
    set((s) => {
      const r = s.resolume
      if (slot < 0 || slot >= RESO_SNAPSHOTS) return s
      if (store) {
        if (r.locked) return s
        const snapshots = [...r.snapshots]
        snapshots[slot] = r.cells.map((c) => ({ ...c }))
        return { resolume: persistResolume({ ...r, snapshots }) }
      }
      const sn = r.snapshots[slot]
      if (!sn) return s
      return { resolume: persistResolume({ ...r, cells: sn.map((c) => ({ ...c })) }) }
    }),
  hiveOutActive: false,
  setHiveOutActive: (on) => set({ hiveOutActive: on }),
  hiveOutPort: lsNum('opsia.hiveOutPort') || 51842,
  setHiveOutPort: (p) => {
    localStorage.setItem('opsia.hiveOutPort', String(p))
    set({ hiveOutPort: p })
  },
  outputPageOpen: false,
  setOutputPageOpen: (on) => {
    // Already open in its window : bring that window up instead.
    if (on && get().outputPageOpen && get().outputPageWindow) void window.api.outputPageFocus().catch(() => {})
    // closed (in the app or its window) : the next time, it opens in the app
    set(on ? { outputPageOpen: true } : { outputPageOpen: false, outputPageWindow: false })
  },
  outputPageWindow: false,
  setOutputPageWindow: (on) => set({ outputPageWindow: on }),

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
    const n = lsNum('opsia.renderScale')
    return Number.isFinite(n) && n >= 0.1 && n <= 2 ? n : 1
  })(),
  setRenderScale: (v) => {
    const s = Math.max(0.1, Math.min(2, v))
    localStorage.setItem('opsia.renderScale', String(s))
    set({ renderScale: s })
  },
  compW: (() => {
    const n = lsNum('opsia.compW')
    return Number.isFinite(n) && n >= 320 && n <= 15360 ? n : 1920
  })(),
  compH: (() => {
    const n = lsNum('opsia.compH')
    return Number.isFinite(n) && n >= 240 && n <= 8640 ? n : 1080
  })(),
  setCompSize: (w, h) => {
    const cw = Math.max(320, Math.min(15360, Math.round(w)))
    const ch = Math.max(240, Math.min(8640, Math.round(h)))
    // A size picked while the dome is on is the one wanted there : the armed
    // square stands down (and gives nothing back when the dome goes off).
    const sq = loadDomeSquare()
    if (sq && get().dome.enabled && (cw !== sq.w || ch !== sq.h)) persistDomeSquare(null)
    localStorage.setItem('opsia.compW', String(cw))
    localStorage.setItem('opsia.compH', String(ch))
    set({ compW: cw, compH: ch })
  },
  squareCompForDome: (w, h) => {
    const cw = Math.max(320, Math.min(15360, Math.round(w)))
    const ch = Math.max(240, Math.min(8640, Math.round(h)))
    persistDomeSquare({ w: cw, h: ch, prev: loadDomeSquare()?.prev })
    if (get().dome.enabled) enterDomeSquare(get(), set)
  },
  // Flash safety : mild ON by default (0.35) : it barely touches normal content
  // (only >~17% full-field mean-luminance jumps get damped) but nets real strobes.
  strobeSafe: (() => {
    const n = lsNum('opsia.strobeSafe')
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.35
  })(),
  setStrobeSafe: (v) => {
    const s = Math.max(0, Math.min(1, v))
    localStorage.setItem('opsia.strobeSafe', String(s))
    set({ strobeSafe: s })
  },
  sonifyPageOpen: false,
  setSonifyPageOpen: (on) => set({ sonifyPageOpen: on }),
  sourceEditorOpen: false,
  setSourceEditorOpen: (on) => set({ sourceEditorOpen: on }),
  userShaders: [],
  setUserShaders: (list) => set({ userShaders: [...list].sort((a, b) => a.name.localeCompare(b.name)) }),
  upsertUserShader: (info) =>
    set((s) => ({
      userShaders: [...s.userShaders.filter((u) => u.id !== info.id), info].sort((a, b) => a.name.localeCompare(b.name))
    })),
  removeUserShader: (id) => set((s) => ({ userShaders: s.userShaders.filter((u) => u.id !== id) })),
  recording: false,
  recordingSince: 0,
  setRecording: (on) => set({ recording: on, recordingSince: on ? performance.now() : 0 }),
  recordPrefs: loadRecordPrefs(),
  setRecordPrefs: (patch) =>
    set((st) => {
      const recordPrefs = { ...st.recordPrefs, ...patch }
      try { localStorage.setItem('opsia.record', JSON.stringify(recordPrefs)) } catch { /* quota */ }
      return { recordPrefs }
    }),
  sonify: (() => {
    try {
      const raw = localStorage.getItem('opsia.sonify')
      if (raw) return { ...defaultSoniConfig(), ...JSON.parse(raw), on: false } as SoniConfig
    } catch { /* fall through to defaults */ }
    return defaultSoniConfig()
  })(),
  setSonify: (next) => {
    // A preset / scene / session saved before a voice existed has no block for
    // it, and one saved before a field existed lacks that field : merge every
    // voice with its default, so the page and the engine never read a missing
    // voice or a missing field. The Collage once needed this on its own; with
    // Signal it is general, so the next voice needs nothing here. Arrays (the
    // taps, the mixer filters) are kept as saved : their own readers pad them.
    {
      const d = defaultSoniConfig()
      const filled = { ...d, ...next } as unknown as Record<string, unknown>
      const dd = d as unknown as Record<string, unknown>
      const nn = next as unknown as Record<string, unknown>
      for (const k of Object.keys(dd)) {
        const dv = dd[k]
        if (dv && typeof dv === 'object' && !Array.isArray(dv)) {
          const nv = nn[k]
          filled[k] = { ...(dv as object), ...(nv && typeof nv === 'object' ? (nv as object) : {}) }
        }
      }
      next = filled as unknown as SoniConfig
    }
    persistSonify(next)
    // The engine starts asynchronously : read the state again once it has, so
    // an off that arrived meanwhile (a double tap, a momentary OSC button) stops
    // it instead of leaving it running under a page that says "sound off".
    // (The Audio Layer keeps the engine running with Sonify off : its voices
    // then fall silent and the layer plays on through the same output.)
    if (next.on && !sonifyEngine.isRunning())
      void sonifyEngine.start().then(() => {
        const s = useStore.getState().sonify
        if (s.on || sonifyEngine.layerWanted()) sonifyEngine.pushConfig(s)
        else sonifyEngine.stop()
      })
    else if (!next.on && sonifyEngine.isRunning() && !sonifyEngine.layerWanted()) sonifyEngine.stop()
    else sonifyEngine.pushConfig(next)
    set({ sonify: next })
  },

  audioLayer: defaultAudioLayer(),
  audioLayerArmed: NOT_ARMED,
  armAudioLayer: (slot) =>
    set((s) => {
      const armed = { ...s.audioLayerArmed }
      for (const sl of slot ? [slot] : (['A', 'B'] as const)) if (s.audioLayer[sl]?.kind === 'live') armed[sl] = true
      return { audioLayerArmed: armed }
    }),
  setAudioLayerFile: (slot, mediaId, mediaName, mediaPath, keep) =>
    set((s) => {
      const prev = s.audioLayer[slot]
      const base: AudioLayerSlot = keep && prev?.kind === 'file'
        ? { ...prev, videoIn: 0, videoOut: 1 }
        : { kind: 'file', volume: prev?.kind === 'file' ? prev.volume : 0.8, pan: prev?.pan ?? 0, videoPlaying: true, videoLoop: true, videoSpeed: 1 }
      return {
        audioLayer: { ...s.audioLayer, [slot]: { ...base, kind: 'file', mediaId, mediaName, mediaPath } },
        audioLayerArmed: { ...s.audioLayerArmed, [slot]: false },
        selection: { type: 'audio', slot }
      }
    }),
  setAudioLayerLive: (slot, deviceId, deviceLabel) => {
    const was = get()
    const old = was.audioLayer[slot]
    const sameDevice = old?.kind === 'live' && (old.deviceId ?? '') === (deviceId || '')
    // the same input picked again (lost, or it would not open) : opened anew
    const again = sameDevice && was.audioLayerArmed[slot]
    set((s) => {
      const prev = s.audioLayer[slot]
      const next: AudioLayerSlot = prev?.kind === 'live'
        ? {
            ...prev,
            deviceId: deviceId || undefined,
            deviceLabel: deviceLabel || (sameDevice ? prev.deviceLabel : undefined),
            // another device's channels are not this one's
            ...(sameDevice ? {} : { chL: 0, chR: 1 })
          }
        : { kind: 'live', deviceId: deviceId || undefined, deviceLabel: deviceLabel || undefined, chL: 0, chR: 1, volume: 1, pan: prev?.pan ?? 0 }
      return {
        audioLayer: { ...s.audioLayer, [slot]: next },
        audioLayerArmed: { ...s.audioLayerArmed, [slot]: true },
        selection: { type: 'audio', slot },
        // (a file's transport modulation, on a live input : dead rows)
        composition: prev?.kind === 'file' ? dropAuSlotTargets(s.composition, slot, true) : s.composition
      }
    })
    if (again) audioLayer.reopen(slot)
  },
  patchAudioLayerSlot: (slot, patch) =>
    set((s) => {
      const cur = s.audioLayer[slot]
      if (!cur) return {}
      return { audioLayer: { ...s.audioLayer, [slot]: { ...cur, ...patch, kind: cur.kind } } }
    }),
  clearAudioLayerSlot: (slot) =>
    set((s) => ({
      audioLayer: { ...s.audioLayer, [slot]: null },
      audioLayerArmed: { ...s.audioLayerArmed, [slot]: false },
      // its modulation goes with it (a binding on an empty slot is a dead row)
      composition: dropAuSlotTargets(s.composition, slot),
      selection: s.selection?.type === 'audio' && s.selection.slot === slot ? null : s.selection
    })),
  patchAudioLayer: (patch) => set((s) => ({ audioLayer: { ...s.audioLayer, ...patch } })),
  playAudioLayer: (on) => {
    // cued first, so no frame starts one before the other is ready; paused, a
    // start still cueing never comes
    if (on) audioLayer.syncStart()
    else audioLayer.cancelSync()
    set((s) => {
      const al = { ...s.audioLayer }
      for (const sl of ['A', 'B'] as const) {
        const x = al[sl]
        if (x?.kind === 'file') al[sl] = { ...x, videoPlaying: on }
      }
      return { audioLayer: al }
    })
  },

  soniSeq: loadSoniSeq(),
  setSoniSeqOn: (on) => {
    set((s) => {
      const soniSeq = { ...s.soniSeq, on, cur: on ? s.soniSeq.cur : 0 }
      persistSoniSeq(soniSeq)
      return { soniSeq }
    })
    playEdited('soniSeq', on)
  },
  setSoniSeqRate: (rate) =>
    set((s) => {
      const soniSeq = { ...s.soniSeq, rate }
      persistSoniSeq(soniSeq)
      return { soniSeq }
    }),
  setSoniSeqStepMs: (ms) =>
    set((s) => {
      const soniSeq = { ...s.soniSeq, stepMs: Math.max(30, Math.min(20000, ms)) }
      persistSoniSeq(soniSeq)
      return { soniSeq }
    }),
  setSoniSeqLen: (n) =>
    set((s) => {
      const len = Math.max(2, Math.min(16, n | 0))
      const soniSeq = { ...s.soniSeq, len, cur: s.soniSeq.cur % len }
      persistSoniSeq(soniSeq)
      return { soniSeq }
    }),
  toggleSoniSeqVoice: (step, voice) =>
    set((s) => {
      const steps = s.soniSeq.steps.map((st, i) =>
        i === step ? { ...st, voices: [...st.voices, false, false, false].slice(0, 11).map((v, vi) => (vi === voice ? !v : v)) } : st
      )
      const soniSeq = { ...s.soniSeq, steps }
      persistSoniSeq(soniSeq)
      return { soniSeq }
    }),
  setSoniSeqStepPreset: (step, preset) =>
    set((s) => {
      const steps = s.soniSeq.steps.map((st, i) => (i === step ? { ...st, preset } : st))
      const soniSeq = { ...s.soniSeq, steps }
      persistSoniSeq(soniSeq)
      return { soniSeq }
    }),
  clearSoniSeqStep: (step) =>
    set((s) => {
      const steps = s.soniSeq.steps.map((st, i) =>
        i === step ? { voices: [false, false, false, false, false, false, false, false, false, false, false], preset: '' } : st
      )
      const soniSeq = { ...s.soniSeq, steps }
      persistSoniSeq(soniSeq)
      return { soniSeq }
    }),
  resetSoniSeq: () => {
    const soniSeq = makeDefaultSoniSeq()
    persistSoniSeq(soniSeq)
    set({ soniSeq })
  },
  // Runtime-only : the sequencer tick writes the current step (never persisted).
  setSoniSeqCur: (i) => set((s) => ({ soniSeq: { ...s.soniSeq, cur: i } })),
  setSoniSeqMode: (mode) =>
    set((s) => {
      const soniSeq = { ...s.soniSeq, mode }
      persistSoniSeq(soniSeq)
      return { soniSeq }
    }),
  setSoniSeqBounceDecay: (v) =>
    set((s) => {
      const soniSeq = { ...s.soniSeq, bounceDecay: Math.max(0, Math.min(100, v)) }
      persistSoniSeq(soniSeq)
      return { soniSeq }
    }),
  setSoniSeqBias: (v) =>
    set((s) => {
      const soniSeq = { ...s.soniSeq, bias: Math.max(-100, Math.min(100, v)) }
      persistSoniSeq(soniSeq)
      return { soniSeq }
    }),
  setSoniSeqEdge: (edge) =>
    set((s) => {
      const soniSeq = { ...s.soniSeq, edge }
      persistSoniSeq(soniSeq)
      return { soniSeq }
    }),
  randomizeSoniSeq: () =>
    set((s) => {
      // Re-roll each active step to 1–3 voices on (a fresh rhythmic pattern).
      // Preset steps keep their preset (its voice mask is unused there anyway).
      const steps = s.soniSeq.steps.map((st, i) => {
        if (i >= s.soniSeq.len) return st
        const voices = [false, false, false, false, false, false, false, false, false, false]
        const n = 1 + Math.floor(Math.random() * 3)
        let placed = 0
        let guard = 0
        while (placed < n && guard++ < 40) {
          const v = Math.floor(Math.random() * 10)
          if (!voices[v]) {
            voices[v] = true
            placed++
          }
        }
        return { ...st, voices }
      })
      const soniSeq = { ...s.soniSeq, steps }
      persistSoniSeq(soniSeq)
      return { soniSeq }
    }),

  soniKeySeq: loadSoniKeySeq(),
  soniKeyCur: -1,
  setSoniKeySeq: (patch) =>
    set((s) => {
      // Every patch through the same validation as a load (ranges, a pool never
      // empty), keeping the running state.
      const soniKeySeq = { ...sanitizeKeySeq({ ...s.soniKeySeq, ...patch }, s.soniKeySeq), on: s.soniKeySeq.on }
      persistSoniKeySeq(soniKeySeq)
      return { soniKeySeq }
    }),
  setSoniKeySeqOn: (on) => {
    set((s) => ({ soniKeySeq: { ...s.soniKeySeq, on } }))
    playEdited('keySeq', on)
  },
  setSoniKeyStep: (i, patch, list = 'steps') =>
    set((s) => {
      const steps = s.soniKeySeq[list].map((st, j) => (j === i ? { ...st, ...patch } : st))
      const soniKeySeq = { ...sanitizeKeySeq({ ...s.soniKeySeq, [list]: steps }, s.soniKeySeq), on: s.soniKeySeq.on }
      persistSoniKeySeq(soniKeySeq)
      return { soniKeySeq }
    }),
  setSoniKeyCur: (i) => set({ soniKeyCur: i }),
  randomizeSoniKeySteps: (list = 'steps') =>
    set((s) => {
      // Fresh keys for the List (or Picture's own keys) from the pool (roots +
      // scales), octaves kept.
      const ks = s.soniKeySeq
      const roots = ks.poolRoots.map((on, i) => (on ? i : -1)).filter((i) => i >= 0)
      const scales = ks.poolScales.length ? ks.poolScales : ['major', 'minor']
      const steps = ks[list].map((st) => ({
        ...st,
        root: roots.length ? roots[Math.floor(Math.random() * roots.length)] : Math.floor(Math.random() * 12),
        scale: scales[Math.floor(Math.random() * scales.length)]
      }))
      const soniKeySeq = { ...ks, [list]: steps }
      persistSoniKeySeq(soniKeySeq)
      return { soniKeySeq }
    }),
  resetSoniKeySeq: () => {
    const soniKeySeq = { ...makeDefaultKeySeq(), on: get().soniKeySeq.on }
    persistSoniKeySeq(soniKeySeq)
    set({ soniKeySeq })
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
  setSourceAssemble: (layer, slot, a) =>
    set((s) => {
      rememberPlacedEdit(a)
      const prev = slotOf(s.composition, layer, slot)
      const slotKey = slot === 'A' ? 'sourceA' : 'sourceB'
      // Already an assemblage here (new / vary / another edit) : only the EDIT
      // changes. The slot keeps its framing, speed and transport, its FX rack
      // and its modulation : it is the same instrument playing another cut.
      // The same edit again (saved under a name) : only its name changes, and
      // the selection stays where it is.
      if (prev?.kind === 'assemble') {
        const same = prev.mediaId === a.id
        return {
          composition: {
            ...s.composition,
            layers: s.composition.layers.map((l, i) =>
              i !== layer
                ? l
                : {
                    ...l,
                    [slotKey]: {
                      ...prev,
                      mediaId: a.id,
                      mediaName: a.name,
                      mediaPath: a.folder,
                      edl: a.clips,
                      videoLoop: same ? prev.videoLoop : a.params.loop
                    }
                  }
            )
          },
          selection: same ? s.selection : { type: 'source' as const, layer, slot }
        }
      }
      return {
        ...swapSlot(
          s,
          {
            ...s.composition,
            layers: s.composition.layers.map((l, i) =>
              i !== layer
                ? l
                : {
                    ...l,
                    [slotKey]: {
                      kind: 'assemble' as const,
                      shaderId: null,
                      inputs: {},
                      mediaId: a.id,
                      mediaName: a.name,
                      // the corpus folder : the clips' original files, with their sound
                      // (Sonify's Assemblage voice; a converted copy has none)
                      mediaPath: a.folder,
                      edl: a.clips,
                      videoPlaying: true,
                      videoLoop: a.params.loop
                    },
                    // A source swap clears that slot's FX rack, matching video/capture.
                    [slot === 'A' ? 'sourceAFx' : 'sourceBFx']: []
                  }
            )
          },
          layer,
          slot,
          prev,
          true
        ),
        selection: { type: 'source' as const, layer, slot }
      }
    }),

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
    const p = lsNum('opsia.oscPort')
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
    const p = lsNum('opsia.oscOutPort')
    return Number.isInteger(p) && p >= 1 && p <= 65535 ? p : 9001
  })(),
  oscOutIntervalMs: (() => {
    const m = lsNum('opsia.oscOutIntervalMs')
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
      surface: true,
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
  setCollapsed: (key, v) =>
    set((s) => {
      const collapsed = { ...s.collapsed, [key]: v }
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
      return { collapsed, rightView: 'finishing' }
    }),

  userShaderPresets: (() => {
    try {
      return aliasPresetKeys(JSON.parse(localStorage.getItem('opsia.userShaderPresets') ?? '{}'))
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
      // Overwrite the WHOLE live scene — composition + World + sound patch — the
      // same trio saveScene captures. Refreshing only the composition used to
      // leave the recalled scene's old World label + Sonify behind.
      scenes: s.scenes.map((x) =>
        x.id === id
          ? {
              ...x,
              composition: s.composition,
              world: s.worlds.find((w) => w.id === s.world) ?? null,
              sonify: { ...s.sonify, on: false, sinkId: '' }
            }
          : x
      )
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
      // engine morphs to it over morphMs, live (App loop reads morph.ts).
      // Normalize defensively (idempotent) : a scene may predate a schema field.
      const composition = keep(s, normalizeComposition(scene.composition))
      beginSceneMorph(s.composition, composition, s.morphMs, performance.now())
      resetCouplingState(true) // a stale cut mustn't seed the recalled scene (a drift keeps its momentum : the recall eases)
      // Restore the scene's World for the selector label (composition already
      // carries its baked effect); add it to the bank if this install lacks it.
      const worlds = ensureWorld(s.worlds, scene.world)
      const world = worldIdIn(worlds, scene.world, s.world)
      if (world !== s.world) localStorage.setItem('opsia.world', world)
      // Normalize defensively (idempotent) : a scene may predate a schema field.
      // Recall the scene's sound patch too (keep the local on-state + device).
      if (scene.sonify) {
        const cur = s.sonify
        // (and the room's EQ and glue : they tune the room, not the patch, like presets)
        const next = { ...defaultSoniConfig(), ...(scene.sonify as Partial<SoniConfig>), on: cur.on, sinkId: cur.sinkId, eq: cur.eq } as SoniConfig
        queueMicrotask(() => { sonifyEngine.loadingSound(); useStore.getState().setSonify(next) })
      }
      return { composition, activeSceneId: id, worlds, world, variationBaseline: null }
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
  pins: [],
  togglePin: (key) => set((s) => ({ pins: s.pins.includes(key) ? s.pins.filter((k) => k !== key) : [...s.pins, key] })),
  unpin: (key) => set((s) => ({ pins: s.pins.filter((k) => k !== key) })),
  clearPins: () => set({ pins: [] }),
  setInEveryScene: (key, label) => {
    const s = get()
    if (!s.scenes.length) {
      showToast('No scenes yet : save one first', 'warn', 3500)
      return
    }
    // the pin's own graft, one scene at a time : the same rule as a recall. A
    // scene whose modulation is full would lose rows of its own for good to make
    // room : it is left as it is, and the toast says so.
    let changed = 0, already = 0, lack = 0, full = 0
    const scenes = s.scenes.map((sc) => {
      const { comp, applied, cut } = graftPins(sc.composition, s.composition, [key])
      if (!applied.has(key)) { lack++; return sc }
      if (comp === sc.composition || sameDeep(comp, sc.composition)) { already++; return sc }
      if (cut) { full++; return sc }
      changed++
      return { ...sc, composition: comp }
    })
    if (changed) set({ scenes })
    const n = s.scenes.length
    const many = (k: number): string => `${k} scene${k === 1 ? '' : 's'}`
    const fullWords = `${many(full)} left as ${full === 1 ? 'it is' : 'they are'} (modulation full : free a row there first)`
    showToast(
      changed
        ? `${label} : set in ${changed} of ${many(n)}${already ? `, ${already} already had it` : ''}${lack ? `, ${lack} without it (another source or effect there)` : ''}${full ? `, ${fullWords}` : ''}. Ctrl+Z undoes.`
        : full
          ? `${label} : ${fullWords}${already ? `, ${already} already had it` : ''}`
          : lack === n
            ? `${label} : no scene has it (another source or effect there)`
            : `${label} : every scene already has it`,
      changed ? 'ok' : 'warn',
      5200
    )
  },
  surface: { active: false, x: 0.5, y: 0.5, path: [], play: false, timeMs: 8000, way: 'forward', jump: 0, wiggle: 0, closed: false },
  setSurfaceActive: (active) =>
    set((s) => {
      // On first activation, give every not-yet-placed scene a plane position.
      if (active && s.scenes.some((x) => !x.surface)) {
        const scenes = s.scenes.map((x, i) => (x.surface ? x : { ...x, surface: autoSurfacePos(i, s.scenes.length) }))
        return { surface: { ...s.surface, active }, scenes }
      }
      return { surface: { ...s.surface, active } }
    }),
  setSurfaceXY: (x, y) =>
    set((s) => ({ surface: { ...s.surface, x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) } })),
  setSurfacePath: (path) =>
    set((s) => ({ surface: { ...s.surface, path } })),
  setSurfacePlay: (play) =>
    // Playing the drawn path only makes sense with the surface live : turning
    // play on turns the surface on too (and places any un-placed scenes).
    set((s) => {
      if (play && !s.surface.active && s.scenes.some((x) => !x.surface)) {
        const scenes = s.scenes.map((x, i) => (x.surface ? x : { ...x, surface: autoSurfacePos(i, s.scenes.length) }))
        return { surface: { ...s.surface, play, active: true }, scenes }
      }
      return { surface: { ...s.surface, play, active: play ? true : s.surface.active } }
    }),
  setSurfaceTimeMs: (ms) =>
    set((s) => ({ surface: { ...s.surface, timeMs: Math.max(100, Math.min(120000, ms)) } })),
  setSurfaceWay: (way) => set((s) => ({ surface: { ...s.surface, way } })),
  setSurfaceJump: (pct) =>
    set((s) => ({ surface: { ...s.surface, jump: Math.max(0, Math.min(100, pct)) } })),
  setSurfaceWiggle: (pct) =>
    set((s) => ({ surface: { ...s.surface, wiggle: Math.max(0, Math.min(100, pct)) } })),
  setSurfaceClosed: (closed) => set((s) => ({ surface: { ...s.surface, closed } })),
  setContextLightPath: (patch) =>
    set((s) => ({
      composition: {
        ...s.composition,
        master: s.composition.master.map((f) => {
          if (f.shaderId !== 'fx-context') return f
          const cur = { ...DEFAULT_LIGHT_PATH, ...(f.lightPath ?? {}), ...patch }
          return {
            ...f,
            lightPath: {
              ...cur,
              timeMs: Math.max(200, Math.min(60000, cur.timeMs)),
              jump: Math.max(0, Math.min(100, cur.jump)),
              wiggle: Math.max(0, Math.min(100, cur.wiggle))
            }
          }
        })
      }
    })),
  setScenePos: (id, x, y) =>
    set((s) => ({
      scenes: s.scenes.map((sc) =>
        sc.id === id ? { ...sc, surface: { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) } } : sc
      )
    })),
  autoPlaceScenes: (force) =>
    set((s) => ({
      scenes: s.scenes.map((x, i) => (!force && x.surface ? x : { ...x, surface: autoSurfacePos(i, s.scenes.length) }))
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
  toggleSequenceRunning: () => {
    set((s) => ({ sequence: { ...s.sequence, enabled: true, running: !s.sequence.running } }))
    playEdited('scenes', get().sequence.running)
  },
  sequenceTo: (id, variation, crossfadeMs) => {
    let sound = null as SoniConfig | null
    set((s) => {
      const scene = s.scenes.find((x) => x.id === id)
      if (!scene) return s
      resetCouplingState(true)
      // Subtle per-recall variation → long sets never loop verbatim. Normalized
      // like recallScene (idempotent) so an old-shape scene can't skip migration.
      const composition = keep(
        s,
        normalizeComposition(variation > 0 ? varyComposition(scene.composition, variation) : scene.composition)
      )
      beginSceneMorph(s.composition, composition, Math.max(0, crossfadeMs), performance.now())
      const worlds = ensureWorld(s.worlds, scene.world)
      const world = worldIdIn(worlds, scene.world, s.world)
      if (world !== s.world) localStorage.setItem('opsia.world', world)
      // Recall the scene's sound patch too (keep the local on-state + device) —
      // a sequencer-driven set played every scene with the wrong (frozen) sound.
      if (scene.sonify) {
        const cur = s.sonify
        // (and the room's EQ and glue : they tune the room, not the patch, like presets)
        sound = { ...defaultSoniConfig(), ...(scene.sonify as Partial<SoniConfig>), on: cur.on, sinkId: cur.sinkId, eq: cur.eq } as SoniConfig
      }
      return { composition, activeSceneId: id, worlds, world, variationBaseline: null }
    })
    // The sound lands inside this same call, after the composition : the
    // sequencer runs it silently (runSilently), and a microtask landed after
    // that had closed, so every step with a sound patch was an undo step.
    if (sound) {
      sonifyEngine.loadingSound() // (a line-in closed now stays closed : sonify.ts)
      get().setSonify(sound)
    }
  },
  sequencePageOpen: false,
  setSequencePageOpen: (on) => set({ sequencePageOpen: on }),

  newSession: () => {
    // A blank slate. Goes through the normal composition write path, so it
    // lands in undo history : an accidental New is one Ctrl+Z away.
    set((s) => {
      resetCouplingState()
      // New session resets the section layout too: Meta/Modulation collapsed,
      // Master FX/Inspector open. Persist so it survives the next reload.
      const collapsed = { ...s.collapsed, meta: true, modulation: true, master: false, inspector: false }
      localStorage.setItem('opsia.collapsed', JSON.stringify(collapsed))
      // New = a fresh random one-layer scene (not a blank canvas), with the
      // active World applied so the World selector matches the layers' coupling
      // (else it'd read e.g. "Musical" over factory-uncoupled layers).
      const activeWorld = s.worlds.find((w) => w.id === s.world) ?? null
      // A New session carries no warp : this computer's own comes back.
      restoreMachineWarp(set, get)
      const fresh = seedRandomStart(makeDefaultComposition())
      // NEW is a clean slate. Even under a direct-film World (Griffé/Peint/Pressé),
      // strip the Finalizer's film stage back off so a New session never opens with
      // drawn-film artifacts — film is still one World-pick away from the selector.
      const built = clearFinalizerFilm(activeWorld ? applyWorldToComposition(fresh, activeWorld) : fresh)
      // Morph into it over the Morph time (layer by layer, live : morph.ts relay);
      // at 0, a clean cut once the new one has compiled. (The Audio Layer fades
      // out over it too.)
      if (s.morphMs > 20) { beginRelayMorph(s.composition, built, s.morphMs, performance.now()); audioLayer.releaseOver(s.morphMs) }
      else {
        cancelMorph()
        requestSceneChange(0)
      }
      return {
        name: 'Untitled',
        composition: built,
        ...FEEL_NEUTRAL, // the Feel macros start neutral (they are the session's)
        pins: [], // New is a clean slate : nothing persistent
        selection: { type: 'source', layer: 0, slot: 'A' },
        scenes: [],
        activeSceneId: null,
        vibePresetName: null,
        variationBaseline: null,
        sequence: makeDefaultSequence(), // empty bank → stop the auto-pilot
        sessionPath: null, // New = no file yet; next Save prompts for one.
        // A fresh slate : the frame where it belongs, the voices where they start.
        outXform: OUT_IDENTITY,
        outXformReset: s.outXformReset + 1,
        space: persistSpace({ ...s.space, voices: defaultVoicePlaces() }),
        // and an empty Audio Layer (a live input it had closes)
        audioLayer: defaultAudioLayer(),
        audioLayerArmed: NOT_ARMED,
        // Reset the draw-sequencer gesture (else a stale path exports into the
        // new session and reactivates once two scenes are placed).
        surface: { active: false, x: 0.5, y: 0.5, path: [], play: false, timeMs: 8000, way: 'forward', jump: 0, wiggle: 0, closed: false },
        collapsed
      }
    })
    // what wants to know (the session's media status) hears a new one came in
    emitSessionLoaded()
  },
  generateTheme: (themeId) => {
    // Generate : a fresh, unsaved session built to a theme recipe (themes.ts).
    // Full diegetic scene : visuals + the theme's World (coupling + Context mood +
    // audio routing) + field-macro / temperament biases. Undoable (morph write path).
    if (!THEME_BY_ID[themeId]) return
    set((s) => {
      const theme = THEME_BY_ID[themeId]
      if (!theme) return s
      resetCouplingState()
      let comp = buildThemeComposition(theme, collageClipsFor(s.composition))
      const world = s.worlds.find((w) => w.id === theme.world) ?? null
      const worlds = ensureWorld(s.worlds, world)
      // The theme's Context and Finalizer overrides win over the World's (a Film
      // Wall's damage survives the World resetting the film stage). They go on
      // before the World too, so the mood the World finds (the World amount at
      // 0) is the theme's own; a key the theme sets stays the theme's, out of the
      // World amount's reach.
      const ctxOver = theme.context ? sansBlur(theme.context) : {}
      const finOver = theme.finalizer ?? {}
      const withTheme = (c: CompositionState): CompositionState => ({
        ...c,
        master: c.master.map((f) =>
          f.shaderId === 'fx-context'
            ? { ...f, inputs: { ...f.inputs, ...ctxOver } }
            : f.shaderId === 'fx-finalizer'
              ? { ...f, inputs: { ...f.inputs, ...finOver } }
              : f
        )
      })
      comp = withTheme(comp)
      if (world) comp = dropWorldKeys(withTheme(applyWorldToComposition(comp, world)), [...Object.keys(ctxOver), ...Object.keys(finOver)])
      // Morph into it over the Morph time (layer by layer, live : morph.ts relay);
      // at 0, a clean cut once the new one has compiled.
      comp = keep(s, comp) // what you pinned rides through a Generate too
      // (the Audio Layer fades out over the Morph time too)
      if (s.morphMs > 20) { beginRelayMorph(s.composition, comp, s.morphMs, performance.now()); audioLayer.releaseOver(s.morphMs) }
      else {
        cancelMorph()
        requestSceneChange(0)
      }
      // (its Feel macros are set below : the generated session's own, saved with it)
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
        // An empty Audio Layer, as New (a live input it had closes); the theme
        // brings no sound of its own there.
        audioLayer: defaultAudioLayer(),
        audioLayerArmed: NOT_ARMED,
        // Reset the draw-sequencer gesture (as newSession does) so a stale path
        // can't export into the generated session and reactivate.
        surface: { active: false, x: 0.5, y: 0.5, path: [], play: false, timeMs: 8000, way: 'forward', jump: 0, wiggle: 0, closed: false },
        density: theme.density,
        gestureTexture: theme.gestureTexture,
        coalesce: theme.coalesce,
        tonicity: theme.tonicity,
        shutter: theme.shutter,
        drift: theme.drift,
        flow: theme.flow,
        superFlicker: theme.superFlicker
      }
    })
    // a new session (it may reuse the Collage films of the one before) : its
    // media status starts over
    emitSessionLoaded()
  },
  loadSession: (s) => {
    // session.ts only checks version + objectness, so a malformed-but-v1 file can
    // still reach here. normalizeComposition dereferences s.composition.layers, and
    // the savedTheme block below mutates the theme/localStorage BEFORE that throw —
    // a half-applied load. Guard the shape at the TOP and bail as a clean no-op.
    if (!s.composition || !Array.isArray(s.composition.layers)) {
      console.warn('[session] ignored a malformed session (missing composition.layers)')
      return
    }
    // Your own shaders it plays, from the session itself : entered before the
    // composition syncs. One you also have, but different : yours stays as it is
    // (your file, your menus) and the session plays its own version, entered as
    // "<name> (session)" under its own id.
    if (s.userShaders && typeof s.userShaders === 'object') {
      const remap = new Map<string, string>()
      for (const [sid, u] of Object.entries(s.userShaders)) {
        if (!u || typeof u.name !== 'string' || typeof u.source !== 'string') continue
        const id = userShaderId(u.name)
        const mine = get().userShaders.find((x) => x.id === id && !x.fromSession)
        if (mine && SHADER_BY_ID[id] && SHADER_BY_ID[id].source !== u.source) {
          // never over one of yours already called "<name> (session)" (saved
          // from an earlier load) : the next free "(session 2)", "(session 3)"…
          let alt = `${u.name} (session)`
          let same = ''
          for (let n = 2; n < 100; n++) {
            const aid = userShaderId(alt)
            if (!get().userShaders.some((x) => x.id === aid && !x.fromSession)) break
            if (SHADER_BY_ID[aid]?.source === u.source) { same = aid; break } // yours already is it
            alt = `${u.name} (session ${n})`
          }
          if (same) { remap.set(sid, same); continue }
          const info = registerUserShader(alt, u.source, true)
          get().upsertUserShader(info)
          remap.set(sid, info.id)
          continue
        }
        const info = registerUserShader(u.name, u.source, !mine)
        get().upsertUserShader(mine ? { ...info, fromSession: false } : info)
        if (info.id !== sid) remap.set(sid, info.id)
      }
      if (remap.size) s = { ...s, composition: remapShaderIds(s.composition, remap), scenes: s.scenes ? remapShaderIds(s.scenes, remap) : s.scenes }
    }
    // Another session over the Morph time, layer by layer and live (morph.ts
    // relay : each new layer fades in once compiled, the old ones out). At Morph
    // 0 : hold the last frame until the new one is ready, then dissolve.
    const before = get()
    // A session from before a World flagged its modulator : its slot 8 is
    // recognized once, here (adoptLegacyWorldMod), never again after.
    const incoming = adoptLegacyWorldMod(normalizeComposition(s.composition))
    if (before.morphMs > 20) beginRelayMorph(before.composition, incoming, before.morphMs, performance.now())
    else {
      cancelMorph()
      requestSceneChange()
    }
    resetCouplingState()
    // Restore the session's World (self-contained → add to bank if missing).
    const cur = get()
    const worlds = ensureWorld(cur.worlds, s.world)
    const world = worldIdIn(worlds, s.world, cur.world)
    if (world !== cur.world) localStorage.setItem('opsia.world', world)
    // Theme travels with the self-contained session (like world + sequencer).
    // Older files without a saved theme keep the current one.
    const savedTheme = migrateThemeName((s.ui as { theme?: ThemeName } | undefined)?.theme)
    if (savedTheme) {
      applyTheme(savedTheme)
      localStorage.setItem('opsia.theme', savedTheme)
    }
    set({
      name: s.name,
      // the session's Feel macros (an older file : neutral)
      ...sanitizeFeel(s.feel),
      theme: savedTheme ?? cur.theme,
      worlds,
      world,
      // Scenes migrate too : recalling one must never push an un-normalized
      // composition (missing Background slab / finalizer tail) live.
      scenes: (s.scenes ?? []).map((sc) => ({ ...sc, composition: adoptLegacyWorldMod(normalizeComposition(sc.composition)) })),
      activeSceneId: null,
      // what the session holds persistent (none in an older file)
      // (a pin on the gone gate hair holds nothing : dropped)
      pins: Array.isArray(s.pins) ? [...new Set(s.pins.filter((k): k is string => typeof k === 'string' && !/^fx:master:[^:]+:filmHair$/.test(k)))] : [],
      variationBaseline: null,
      // The old selection can dangle onto an FX unit the loaded session lacks, and
      // the old palette name no longer describes it : reset both (as newSession does).
      selection: { type: 'source', layer: 0, slot: 'A' },
      vibePresetName: null,
      // Sequencer travels with the session; auto-resumes if it was running.
      sequence: { ...makeDefaultSequence(), ...(s.sequence ?? {}) },
      // Performance dials travel with the session; an older file without them
      // keeps the current (localStorage-restored) values rather than resetting.
      globalSpeed: typeof s.globalSpeed === 'number' ? Math.max(1 / 64, Math.min(64, s.globalSpeed)) : cur.globalSpeed,
      morphMs: typeof s.morphMs === 'number' ? Math.max(0, Math.min(30000, s.morphMs)) : cur.morphMs,
      // The Sonify step sequence travels with the session (opens paused at 0),
      // the key sequence too (stopped); an older file keeps the current one.
      soniSeq: sanitizeSoniSeq(s.soniSeq, cur.soniSeq),
      soniKeySeq: s.soniKeySeq ? sanitizeKeySeq(s.soniKeySeq, cur.soniKeySeq) : { ...cur.soniKeySeq, on: false },
      // The drawn surface gesture + timing travel too; the live cursor / active
      // / play toggles reset (a session opens paused at the plane centre).
      surface: {
        active: false,
        x: 0.5,
        y: 0.5,
        play: false,
        path: Array.isArray(s.surface?.path) ? s.surface!.path : [],
        timeMs: typeof s.surface?.timeMs === 'number' ? s.surface!.timeMs : 8000,
        way: s.surface?.way ?? 'forward',
        jump: typeof s.surface?.jump === 'number' ? s.surface!.jump : 0,
        wiggle: typeof s.surface?.wiggle === 'number' ? s.surface!.wiggle : 0,
        closed: !!s.surface?.closed
      },
      composition: incoming
    })
    // Keep the performance-dial localStorage in sync with the loaded session so a
    // later restart preserves the loaded feel, not the previously-set one.
    localStorage.setItem('opsia.globalSpeed', String(get().globalSpeed))
    localStorage.setItem('opsia.morphMs', String(get().morphMs))
    persistSoniSeq(get().soniSeq)
    persistSoniKeySeq(get().soniKeySeq)
    // The Resolume mapping is per session : a session that carries one brings it
    // back (with its lock); an older file without one keeps the current mapping.
    if (s.resolume && typeof s.resolume === 'object') {
      set({ resolume: persistResolume(sanitizeResolume(s.resolume)) })
    }
    // A piece made for the dome brings its dome mapping back; older sessions
    // keep whatever the machine had. On/off stays yours, so does the alignment
    // grid : a setup aid of this room, never the piece's (a session saved while
    // aligning would burn it into the show).
    if (s.dome && typeof s.dome === 'object')
      set({ dome: persistDome({ ...sanitizeDome(s.dome), enabled: get().dome.enabled, grid: get().dome.grid }) })
    // The output transform is the piece's : its own, or none (an older file must
    // not open turned the way the last piece was left).
    set({ outXform: sanitizeOutXform(s.outXform ?? null), outXformReset: get().outXformReset + 1 })
    // Where the voices sit is the piece's too (an older file : where they start).
    set({ space: persistSpace({ ...get().space, voices: sanitizeVoicePlaces(s.spaceVoices ?? null) }) })
    // So is the Audio Layer's sound (an older file : none). Its live inputs come
    // back closed (their device and channels kept) : a session never opens a
    // microphone by itself (an installation's boot opens them).
    set((st) => ({
      audioLayer: sanitizeAudioLayer(s.audioLayer ?? null),
      audioLayerArmed: NOT_ARMED,
      selection: st.selection?.type === 'audio' ? null : st.selection
    }))
    // The projector warp, when the session carries one AND this computer lets
    // sessions bring theirs (Output → Mapping : save with the session). It is the
    // session's : this computer's own warp stays stored and comes back with a
    // session that carries none.
    const sw = s.warp
    if (
      get().warpInSession && sw && Array.isArray(sw.corners) && sw.corners.length === 8 &&
      sw.corners.every((v) => typeof v === 'number' && Number.isFinite(v))
    ) {
      const corners = sw.corners.map((v) => Math.max(-0.5, Math.min(1.5, v)))
      const feather = typeof sw.feather === 'number' && Number.isFinite(sw.feather) ? Math.max(0, Math.min(WARP_FEATHER_MAX, sw.feather)) : 0
      set({ warpCorners: corners, warpEnabled: !!sw.enabled, warpFeather: feather, warpFromSession: true })
    } else {
      restoreMachineWarp(set, get)
    }
    // The session's sound patch (post-set so setSonify's engine push sees it).
    if (s.sonify) {
      const curSoni = get().sonify
      // a session saved before the output EQ existed keeps this room's (it
      // brought back a flat EQ with the glue off)
      const hasEq = !!(s.sonify as Partial<SoniConfig>).eq
      sonifyEngine.loadingSound() // (a closed line-in stays closed)
      get().setSonify({
        ...defaultSoniConfig(),
        ...(s.sonify as Partial<SoniConfig>),
        on: curSoni.on,
        sinkId: curSoni.sinkId,
        ...(hasEq ? {} : { eq: curSoni.eq })
      } as SoniConfig)
    }
    // what wants to know (the session's media check) hears it loaded
    emitSessionLoaded()
  },
  exportSession: () => {
    const s = get()
    return {
      version: 1,
      name: s.name,
      composition: s.composition,
      scenes: s.scenes,
      ...(s.pins.length ? { pins: s.pins } : {}),
      feel: { density: s.density, gestureTexture: s.gestureTexture, coalesce: s.coalesce, tonicity: s.tonicity, drift: s.drift, flow: s.flow },
      world: s.worlds.find((w) => w.id === s.world) ?? null,
      sequence: s.sequence,
      sonify: { ...s.sonify, on: false, sinkId: '' },
      soniSeq: { ...s.soniSeq, on: false, cur: 0 },
      sonifyOn: s.sonify.on,
      soniSeqOn: s.soniSeq.on,
      soniKeySeq: { ...s.soniKeySeq, on: false },
      soniKeySeqOn: s.soniKeySeq.on,
      globalSpeed: s.globalSpeed,
      morphMs: s.morphMs,
      // The drawn gesture + its timing travel with the session; the live cursor,
      // active + play toggles are runtime and reset on load.
      surface: {
        path: s.surface.path,
        timeMs: s.surface.timeMs,
        way: s.surface.way,
        jump: s.surface.jump,
        wiggle: s.surface.wiggle,
        closed: s.surface.closed
      },
      resolume: s.resolume,
      dome: { ...s.dome, grid: false }, // (the alignment grid is the room's, not the piece's)
      outXform: s.outXform,
      spaceVoices: s.space.voices,
      // your own shaders it plays (the composition, the scenes), with their source
      userShaders: (() => {
        const ids = userShaderIdsIn(s.composition)
        userShaderIdsIn(s.scenes, ids)
        if (!ids.size) return undefined
        const out: Record<string, { name: string; source: string; category: 'Generator' | 'FX' }> = {}
        for (const id of ids) {
          const d = SHADER_BY_ID[id]
          if (d) out[id] = { name: d.name, source: d.source, category: d.category === 'FX' ? 'FX' : 'Generator' }
        }
        return out
      })(),
      audioLayer: s.audioLayer,
      ...(s.warpInSession ? { warp: { enabled: s.warpEnabled, corners: [...s.warpCorners], feather: s.warpFeather } } : {}),
      ui: { theme: s.theme }
    }
  }
}))

// Apply the persisted theme on module load so first paint is themed.
applyTheme(useStore.getState().theme)

// Hand the restored Sonify settings to the engine at boot (it only stores them
// while sound is off) : modulation swings around the engine's copy, which was
// the factory default until the first Sonify edit.
sonifyEngine.pushConfig(useStore.getState().sonify)
