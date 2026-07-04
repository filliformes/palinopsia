// Shared type contract across main / preload / renderer.
// Kept framework-free so it imports cleanly on both the Node and web sides.

// ── Engine / signal model ────────────────────────────────────────────
// The six blend modes implemented in the Compositor's BLEND_FS. Extend
// here AND in blend.glsl / Compositor's modeIndex together.
export type BlendMode =
  | 'normal'
  | 'add'
  | 'screen'
  | 'multiply'
  | 'difference'
  | 'overlay'

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
  // For kind:'video' — absolute path or media id of the imported clip.
  mediaId?: string
}

// One FX in a rack. Every FX is an ISF shader (per brief §5).
export interface FxInstance extends ShaderInstance {
  id: string
  enabled: boolean
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
}

// The whole composition: four layers, a master FX rack, and transport.
export interface CompositionState {
  layers: LayerState[]
  master: FxInstance[] // glitch / dither / chroma / grade + warp
  bpm: number
}

// ── Session persistence (brief §7) ───────────────────────────────────
export interface Session {
  version: 1
  name: string
  composition: CompositionState
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

// ── Autosave / crash recovery ────────────────────────────────────────
export interface AutosaveEntry {
  path: string
  name: string
  savedAt: number
}

// ── Preload surface exposed on window.api ────────────────────────────
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

  // App lifecycle — save-before-quit handshake
  appCloseProceed: () => Promise<void>
  onAppBeforeClose: (cb: () => void) => () => void
}
