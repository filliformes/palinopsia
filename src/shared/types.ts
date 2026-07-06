// Shared type contract across main / preload / renderer.
// Kept framework-free so it imports cleanly on both the Node and web sides.

// ── Engine / signal model ────────────────────────────────────────────
// The 15 blend modes implemented in the Compositor's BLEND_GLSL — shared by
// the layer stack AND each layer's A/B source mix. Extend here AND in the
// Compositor's modeIndex together. 'wrap' (fract(b+t)) is the digital-native
// one: hard value wrap-around.
export type BlendMode =
  | 'normal'
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'softlight'
  | 'hardlight'
  | 'darken'
  | 'lighten'
  | 'difference'
  | 'exclusion'
  | 'dodge'
  | 'burn'
  | 'wrap'
  | 'weave'
  | 'lumakey'

export const BLEND_MODES: BlendMode[] = [
  'normal',
  'add',
  'subtract',
  'multiply',
  'screen',
  'overlay',
  'softlight',
  'hardlight',
  'darken',
  'lighten',
  'difference',
  'exclusion',
  'dodge',
  'burn',
  'wrap',
  'weave',
  'lumakey'
]

// What feeds a layer slot. ISF generator is the MVP path; the rest land
// in later phases (video + synthify → Phase 7, capture/HIVE → Phase 7,
// feedback samples another layer's previous frame → Phase 2).
export type SourceKind = 'none' | 'generator' | 'video' | 'capture' | 'hive' | 'feedback'

// A live shader instance: which ISF shader, and the current value of each
// of its declared INPUTS (float → number, color/point2D → number[]).
export interface ShaderInstance {
  shaderId: string | null
  inputs: Record<string, number | number[]>
}

export interface SourceSlot extends ShaderInstance {
  kind: SourceKind
  // For kind:'feedback' — index of the layer whose previous frame we sample.
  feedbackLayer?: number
  // For kind:'video' — the clip's object URL (or path) the engine loads.
  mediaId?: string
  // For kind:'video' — the file's display name, shown in the source picker.
  mediaName?: string
  // For kind:'video' — transport (all optional; engine applies defaults).
  videoPlaying?: boolean // default true
  videoSpeed?: number // 1/28..128, default 1 (× layer speed × global speed)
  videoReverse?: boolean // legacy; superseded by videoDirection
  videoDirection?: 'forward' | 'reverse' | 'pendulum' // default 'forward'
  videoLoop?: boolean // default true
  videoIn?: number // normalized start point 0..1, default 0
  videoOut?: number // normalized stop point 0..1, default 1
  // Source framing (video + capture): sample transform applied on upload.
  zoom?: number // scale about centre, default 1
  panX?: number // -1..1, default 0
  panY?: number // -1..1, default 0
  cropL?: number // trim left edge 0..0.9, default 0
  cropR?: number // trim right edge 0..0.9, default 0
  cropT?: number // trim top edge 0..0.9, default 0
  cropB?: number // trim bottom edge 0..0.9, default 0
}

// One FX in a rack. Every FX is an ISF shader (per brief §5).
export interface FxInstance extends ShaderInstance {
  id: string
  enabled: boolean
  // Dry/wet — the engine blends the FX output back over its input by this
  // amount (1 = fully wet). Undefined ⇒ 1 for older sessions.
  opacity?: number
  // Pinned rack units (the master Vibe Palette): always on, not removable,
  // always last in the chain.
  locked?: boolean
}

// One of the four layers.
export interface LayerState {
  id: string
  sourceA: SourceSlot
  sourceB: SourceSlot | null
  // Per-source FX (applied before the two sources are mixed) live on the
  // slot's own rack; the per-layer rack applies to the mixed layer.
  sourceAFx: FxInstance[]
  sourceBFx: FxInstance[]
  fx: FxInstance[] // finite per-layer FX rack
  blend: BlendMode // against the stack below
  opacity: number // 0..1
  mute: boolean
  solo: boolean
  feedback: boolean // does this layer sample its own previous frame
  // Trail persistence when feedback is on: 0 = none, →1 = long decay trails.
  feedbackAmount: number
  // A/B source crossfade — 0 = A only, 1 = B only. Ignored while B is empty.
  sourceMix: number
  // How B combines with A before the crossfade: out = mix(A, blend(A,B), mix).
  sourceBlend: BlendMode
  // Global time multiplier for this layer's sources + racks (1 = realtime).
  speed: number
}

// ── Modulation (brief §6 — ported from dataFLOU) ─────────────────────
export type ModulatorType =
  | 'lfo'
  | 'ramp'
  | 'adsr'
  | 'arp'
  | 'random'
  | 'sh'
  | 'slew'
  | 'chaos'

export type LfoShape =
  | 'sine'
  | 'triangle'
  | 'square'
  | 'sawtooth'
  | 'rndStep'
  | 'rndSmooth'
  | 'spastic'

// The 14 output curves (dataFLOU's scaleMetaValue vocabulary).
export type ModCurve =
  | 'linear'
  | 'log'
  | 'exp'
  | 'geom'
  | 'easeIn'
  | 'easeOut'
  | 'cubic'
  | 'sqrt'
  | 'sigmoid'
  | 'smoothstep'
  | 'db'
  | 'gamma'
  | 'step'
  | 'invert'

export type ArpMode = 'up' | 'down' | 'upDown' | 'random' | 'drunk'

// One modulator slot's configuration (runtime state lives in the engine).
export interface ModulatorConfig {
  type: ModulatorType
  enabled: boolean
  // Clock — shared vocabulary with dataFLOU: free Hz or BPM-synced division.
  sync: 'free' | 'bpm'
  rateHz: number
  divisionIdx: number
  dotted: boolean
  triplet: boolean
  // Output shaping.
  curve: ModCurve
  // Type-specific parameter blocks (only the active type's block is read).
  shape: LfoShape // lfo
  ramp: { rampMs: number; curvePct: number; mode: 'normal' | 'inverted' | 'loop' }
  adsr: {
    attackMs: number
    decayMs: number
    sustainMs: number
    releaseMs: number
    sustainLevel: number
    loop: boolean
  }
  arp: { steps: number; mode: ArpMode }
  random: { distribution: number } // 0.5 = uniform; >0.5 centre-hug, <0.5 edge-weight
  sh: { probability: number; smooth: boolean; distribution: number }
  slew: { riseMs: number; fallMs: number; randomTarget: boolean }
  chaos: { r: number } // logistic-map r in [3.4, 4.0]
}

// What an assignment modulates: float ISF inputs, or a Meta knob (the
// modulator then drives every destination the knob carries — macro motion).
export type ModTarget =
  | { kind: 'source'; layer: number; slot: 'A' | 'B'; input: string }
  | { kind: 'fx'; scope: FxScope; instId: string; input: string }
  | { kind: 'meta'; knob: number }

// Addresses one of the four FX racks (per-source, per-layer, or master).
export type FxScope =
  | { kind: 'master' }
  | { kind: 'layer' | 'sourceA' | 'sourceB'; layer: number }

export interface ModAssignment {
  id: string
  mod: number // modulator slot 0..7
  target: ModTarget
  depth: number // -1..+1 — bipolar swing around the base value
}

// The cap is deliberate (simplexité): bounded modulation stays followable.
export const MAX_MOD_ASSIGNMENTS = 12
export const MODULATOR_COUNT = 8

// ── Meta Controller (brief §6 — dataFLOU's macro surface) ─────────────
// 16 knobs, one flat bank. Each knob maps its 0..1 position through a curve
// onto up to 8 destinations (ISF float inputs), with per-knob smoothing and
// MIDI-CC learn. Modulators can drive knobs (ModTarget kind 'meta').
export const META_KNOB_COUNT = 16
export const META_MAX_DESTS = 8

export interface MetaKnobState {
  name: string
  value: number // committed 0..1 position
  smoothMs: number
  curve: ModCurve // shapes the 0..1 before mapping to each target's range
  midiCc: { channel: number; number: number } | null
  destinations: ModTarget[] // max META_MAX_DESTS
}

// The whole composition: four layers, a master FX rack, and transport.
export interface CompositionState {
  layers: LayerState[]
  master: FxInstance[] // glitch / dither / chroma / grade + warp
  bpm: number
  modulators: ModulatorConfig[]
  modMatrix: ModAssignment[]
  metaKnobs: MetaKnobState[]
}

// ── Scenes (brief §7, §10.7) — recallable full-instrument states ──────
export interface SceneEntry {
  id: string
  name: string
  composition: CompositionState
}

// ── Session persistence (brief §7) ───────────────────────────────────
export interface Session {
  version: 1
  name: string
  composition: CompositionState
  // The scene bank travels with the session. It lives OUTSIDE composition:
  // recalling a scene replaces the composition without touching the bank,
  // and undo (which snapshots composition) never rewinds the bank itself.
  scenes?: SceneEntry[]
  // Opaque renderer UI snapshot (theme, panel sizes, selection). The main
  // process never inspects it — it just round-trips it to disk.
  ui?: unknown
}

// ── OSC (mirrors main/osc.ts) ────────────────────────────────────────
export interface OscEvent {
  timestamp: number
  ip: string
  port: number
  address: string
  args: Array<{ type: string; value: number | string | boolean }>
}

export interface OscErrorEvent {
  timestamp: number
  ip: string
  port: number
  address: string
  message: string
}

// ── Inbound OSC (Pandore → instrument) ───────────────────────────────
export interface OscInEvent {
  timestamp: number
  address: string
  args: Array<{ type: string; value: number | string | boolean }>
}

export interface OscListenResult {
  ok: boolean
  listening: boolean
  port: number
  addresses: string[]
  error?: string
}

/** One leaf of the OSCQuery address tree the renderer publishes to main. */
export interface OscQueryLeaf {
  full_path: string
  type?: string
  range?: { min?: number; max?: number }
  value?: number | number[]
  description?: string
}

// ── Autosave / crash recovery ────────────────────────────────────────
export interface AutosaveEntry {
  path: string
  name: string
  savedAt: number
}

// ── Preload surface exposed on window.api ────────────────────────────
export interface CaptureSourceInfo {
  id: string
  name: string
  isScreen: boolean
  thumbnail: string // data URL
}

export interface DisplayInfo {
  id: number
  label: string
  width: number
  height: number
  isPrimary: boolean
}

// A HIVE HEVC access unit forwarded from the main process to the decoder.
export interface HiveAU {
  id: string
  key: boolean
  timestamp: number
  data: Uint8Array
}

export interface ExposedApi {
  // Session I/O
  sessionSaveAs: (s: Session) => Promise<string | null>
  sessionSave: (s: Session, path: string) => Promise<boolean>
  sessionSaveToDefault: (s: Session) => Promise<string>
  sessionOpen: () => Promise<{ session: Session; path: string } | null>

  // Autosave / crash recovery
  autosaveCrashCheck: () => Promise<{ crashed: boolean; entries: AutosaveEntry[] }>
  autosaveList: () => Promise<AutosaveEntry[]>
  autosaveLoad: (path: string) => Promise<Session>
  // Renderer pushes the current session so the 60s autosave loop has
  // something fresh to snapshot even between manual saves.
  setCurrentSession: (s: Session) => Promise<void>

  // OSC control plane
  oscSend: (
    ip: string,
    port: number,
    address: string,
    args: Array<{ type: string; value: number | string | boolean }>
  ) => Promise<void>
  onOscIn: (cb: (batch: OscEvent[]) => void) => () => void
  onOscErrors: (cb: (batch: OscErrorEvent[]) => void) => () => void

  // OSC input — start/stop the listener + OSCQuery, and subscribe to messages
  oscListen: (port: number, enabled: boolean) => Promise<OscListenResult>
  onOscReceived: (cb: (batch: OscInEvent[]) => void) => () => void
  oscQueryPublish: (nodes: OscQueryLeaf[]) => Promise<void>

  // App lifecycle — save-before-quit handshake
  appCloseProceed: () => Promise<void>
  onAppBeforeClose: (cb: () => void) => () => void
  // Absolute path for a picked File (Electron 33 removed File.path).
  getMediaPath: (file: File) => string
  // Screens + windows for the capture source picker.
  captureListSources: () => Promise<CaptureSourceInfo[]>
  // Output window (2nd display / projector) — mirror via WebRTC loopback.
  outputDisplays: () => Promise<DisplayInfo[]>
  outputOpen: (displayId: number) => Promise<boolean>
  outputClose: () => Promise<boolean>
  onOutputClosed: (cb: () => void) => () => void
  outputSignal: (data: unknown) => void
  onOutputSignal: (cb: (data: unknown) => void) => () => void
  // HIVE live-in.
  hiveConnect: (id: string, host: string, port: number) => void
  hiveDisconnect: (id: string) => void
  onHiveAU: (cb: (au: HiveAU) => void) => () => void
  // External output (NDI / Spout).
  ndiSet: (on: boolean) => Promise<boolean>
  spoutSet: (on: boolean) => Promise<boolean>
  ndiFrame: (w: number, h: number, pixels: Uint8Array) => void
}
