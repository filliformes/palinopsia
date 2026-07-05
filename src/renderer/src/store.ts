// Zustand store — the renderer's single source of truth.
// Holds the theme (design system lifted from dataFLOU) and the live
// CompositionState (four layers + master rack + transport). The Compositor
// engine reads this on each frame; OSC / modulators mutate it through the
// same actions the UI uses, so there's one path for every parameter change.

import { create } from 'zustand'
import type {
  BlendMode,
  CompositionState,
  FxInstance,
  FxScope,
  LayerState,
  ModAssignment,
  ModTarget,
  ModulatorConfig,
  SceneEntry,
  Session,
  SourceSlot
} from '@shared/types'
import type { MetaKnobState } from '@shared/types'
import { MAX_MOD_ASSIGNMENTS, META_KNOB_COUNT, META_MAX_DESTS } from '@shared/types'
import { makeDefaultModulators } from './engine/modulation'
import {
  collectFloatTargets,
  randomizeComposition,
  randomizeInputs,
  randomizeSingleLayer,
  type RandomizeScope
} from './randomize'

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

// Palinopsia's default: near-black canvas, one accent — restraint as
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
    blend: 'normal',
    opacity: 1,
    mute: false,
    solo: false,
    feedback: false,
    feedbackAmount: 0.6,
    sourceMix: 0.5,
    sourceBlend: 'normal',
    speed: 1
  }
}

// The always-on master Vibe Palette (pinned last in the master rack): the
// color-MASTERING stage — palette map + built-in saturation / contrast /
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

// The always-on Context depth finalizer — pinned AFTER the Vibe Palette at the
// very end of the master rack. Adds trails, bloom, a key light, haze and a
// depth vignette. Defaults are a gentle, lifelike amount (not a passthrough).
export function makeContext(): FxInstance {
  return {
    id: uid(),
    shaderId: 'fx-context',
    enabled: true,
    locked: true,
    inputs: {
      trails: 0.2,
      blur: 0.08,
      bloom: 0.3,
      depth: 0.35,
      haze: 0.15,
      atmosphere: [0.5, 0.58, 0.72, 1],
      lightGlow: 0.1,
      lightSize: 0.5,
      lightColor: [1.0, 0.92, 0.8, 1],
      light: [0.5, 0.55]
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

export function makeDefaultComposition(): CompositionState {
  return {
    // Layer 1 opens on Ash so a fresh session shows something living.
    layers: [makeLayer('ash'), makeLayer(), makeLayer(), makeLayer()],
    master: [makeVibePalette(), makeContext()],
    bpm: 120,
    modulators: makeDefaultModulators(),
    modMatrix: [],
    metaKnobs: makeDefaultMetaKnobs()
  }
}

// What the Inspector's auto-UI is pointed at: a source slot or an FX unit
// (brief §10.3 — "selecting any source or FX renders its ISF INPUTS").
export type Selection =
  | { type: 'source'; layer: number; slot: 'A' | 'B' }
  | { type: 'fx'; scope: FxScope; instId: string }
  | null

/** Stable identity for a mod target — used to find existing assignments. */
export function modTargetKey(t: ModTarget): string {
  if (t.kind === 'source') return `src:${t.layer}:${t.slot}:${t.input}`
  if (t.kind === 'meta') return `meta:${t.knob}`
  const s = t.scope
  const scopeKey = s.kind === 'master' ? 'master' : `${s.kind}:${s.layer}`
  return `fx:${scopeKey}:${t.instId}:${t.input}`
}

// ── Store ─────────────────────────────────────────────────────────────
interface StoreState {
  theme: ThemeName
  setTheme: (t: ThemeName) => void

  name: string
  setName: (n: string) => void

  composition: CompositionState
  // Layer parameter actions — the Compositor reads composition each frame,
  // so these double as the OSC / modulator write path.
  setBlend: (layer: number, mode: BlendMode) => void
  setOpacity: (layer: number, v: number) => void
  toggleMute: (layer: number) => void
  toggleSolo: (layer: number) => void
  toggleFeedback: (layer: number) => void
  setFeedbackAmount: (layer: number, v: number) => void
  setSourceMix: (layer: number, v: number) => void
  setSourceBlend: (layer: number, mode: BlendMode) => void
  setSourceShader: (layer: number, slot: 'A' | 'B', shaderId: string | null) => void
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
  // Layer presets — whole-layer states (sources + all racks), app-persistent.
  layerPresets: Array<{ id: string; name: string; layer: LayerState }>
  saveLayerPreset: (layer: number, name: string) => void
  applyLayerPreset: (layer: number, presetId: string) => void
  deleteLayerPreset: (presetId: string) => void
  // Volatile layer clipboard — copy one layer's whole state, paste onto another.
  copiedLayer: LayerState | null
  copyLayer: (layer: number) => void
  pasteLayer: (layer: number) => void
  // Mixer view — a compact 4-column opacity/speed/blend surface that replaces
  // the layer strips (toggle with the M key). Its own app-persistent presets.
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

  // FX racks (Phase 3) — one action surface for all four rack scopes.
  addFx: (scope: FxScope, shaderId: string) => void
  removeFx: (scope: FxScope, instId: string) => void
  toggleFx: (scope: FxScope, instId: string) => void
  moveFx: (scope: FxScope, instId: string, dir: -1 | 1) => void
  // Drag-and-drop reorder: place instId before beforeId (null = end of chain).
  reorderFx: (scope: FxScope, instId: string, beforeId: string | null) => void
  setFxInput: (scope: FxScope, instId: string, name: string, value: number | number[]) => void

  // Randomize (brief §7) — scoped draws from curated aesthetic ranges.
  randomize: (scope: RandomizeScope) => void
  // Re-roll each Meta knob's destinations (up to 8) + value — a fresh macro
  // surface (fired by 'Randomize Meta Knobs'; the smoother applies it).
  randomizeMetaBank: () => void
  // Randomize the master chain's FX PARAMETERS in place (keep the chain,
  // keep the Vibe) — the ⚄ next to the Master title.
  randomizeMasterParams: () => void

  // Name of the Vibe palette currently applied (P/Shift+P + the picker share
  // it so the Inspector always shows what's on). Transient UI, not persisted.
  vibePresetName: string | null
  setVibePresetName: (n: string | null) => void

  // Meta Controller (Phase 5) — 16 macro knobs.
  midiLearn: number | null // knob index armed for CC learn
  setMidiLearn: (i: number | null) => void
  updateMetaKnob: (i: number, partial: Partial<MetaKnobState>) => void
  setMetaValue: (i: number, v: number) => void
  // Toggle a destination on a knob (capped at META_MAX_DESTS).
  toggleMetaDest: (i: number, target: ModTarget) => void

  // Modulation (Phase 5) — the 8-slot bank + the capped matrix.
  updateModulator: (i: number, partial: Partial<ModulatorConfig>) => void
  // Upserts by (mod, target): re-assigning the same pair updates its depth.
  // Returns false when the cap would be exceeded (legibility = simplexité).
  assignMod: (mod: number, target: ModTarget, depth: number) => boolean
  removeAssignment: (id: string) => void
  setAssignmentDepth: (id: string, depth: number) => void

  // The currently-selected source/FX whose ISF INPUTS the auto-UI renders.
  selection: Selection
  setSelection: (s: Selection) => void

  // UI chrome (persisted to localStorage, not to sessions).
  uiZoom: number
  setUiZoom: (z: number) => void
  collapsed: Record<string, boolean>
  toggleSection: (key: string) => void

  // User shader presets — app-persistent (localStorage), per shader id.
  userShaderPresets: Record<string, Array<{ name: string; values: Record<string, number | number[]> }>>
  addUserShaderPreset: (shaderId: string, name: string, values: Record<string, number | number[]>) => void
  deleteUserShaderPreset: (shaderId: string, name: string) => void

  // Scenes (Phase 6) — recallable full-instrument states, drag-arranged.
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

  // Session round-tripping
  newSession: () => void
  loadSession: (s: Session) => void
  exportSession: () => Session
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
  return {
    ...c,
    layers: updateLayer(c.layers, scope.layer, (l) => {
      if (scope.kind === 'layer') return { ...l, fx: fn(l.fx) }
      if (scope.kind === 'sourceA') return { ...l, sourceAFx: fn(l.sourceAFx) }
      return { ...l, sourceBFx: fn(l.sourceBFx) }
    })
  }
}

export const useStore = create<StoreState>((set, get) => ({
  theme: loadTheme(),
  setTheme: (t) => {
    applyTheme(t)
    localStorage.setItem('opsia.theme', t)
    set({ theme: t })
  },

  name: 'Untitled',
  setName: (n) => set({ name: n }),

  composition: makeDefaultComposition(),

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

  initLayer: (layer) =>
    set((s) => ({
      composition: {
        ...s.composition,
        // Fresh factory layer — keeps its identity (id) so mod-matrix
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

  mixerView: false,
  toggleMixerView: () => set((s) => ({ mixerView: !s.mixerView })),
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
          // null shader ⇒ the slot goes back to 'none' (empty layer).
          const kind = shaderId ? ('generator' as const) : ('none' as const)
          if (slot === 'A')
            return { ...l, sourceA: { ...l.sourceA, kind, shaderId, inputs: {} } }
          const base = l.sourceB ?? emptySlot()
          return { ...l, sourceB: { ...base, kind, shaderId, inputs: {} } }
        })
      },
      // Picking a source lands its controls in the Inspector immediately.
      selection: shaderId ? { type: 'source', layer, slot } : s.selection
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
      // A chain preset sets its own vibe — no longer a named palette.
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

  addFx: (scope, shaderId) =>
    set((s) => {
      const instId = uid()
      return {
        composition: updateFxArray(s.composition, scope, (fx) => {
          // Locked units (the Vibe Palette) stay last — insert before them.
          const lockedAt = fx.findIndex((f) => f.locked)
          const unit = { id: instId, shaderId, enabled: true, inputs: {} }
          if (lockedAt < 0) return [...fx, unit]
          const next = [...fx]
          next.splice(lockedAt, 0, unit)
          return next
        }),
        // Land the Inspector on the fresh unit — its controls are the next
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

  randomize: (scope) =>
    set((s) => ({ composition: randomizeComposition(s.composition, scope) })),

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
  assignMod: (mod, target, depth) => {
    const s = get()
    const key = modTargetKey(target)
    const existing = s.composition.modMatrix.find(
      (a) => a.mod === mod && modTargetKey(a.target) === key
    )
    if (existing) {
      set((st) => ({
        composition: {
          ...st.composition,
          modMatrix: st.composition.modMatrix.map((a) =>
            a.id === existing.id ? { ...a, depth } : a
          )
        }
      }))
      return true
    }
    if (s.composition.modMatrix.length >= MAX_MOD_ASSIGNMENTS) return false
    const entry: ModAssignment = { id: uid(), mod, target, depth }
    set((st) => ({
      composition: { ...st.composition, modMatrix: [...st.composition.modMatrix, entry] }
    }))
    return true
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

  selection: null,
  setSelection: (sel) => set({ selection: sel }),

  uiZoom: (() => {
    const z = Number(localStorage.getItem('opsia.uiZoom'))
    return Number.isFinite(z) && z >= 0.6 && z <= 1.6 ? z : 1
  })(),
  setUiZoom: (z) => {
    const clamped = Math.max(0.6, Math.min(1.6, Math.round(z * 20) / 20))
    localStorage.setItem('opsia.uiZoom', String(clamped))
    set({ uiZoom: clamped })
  },
  collapsed: (() => {
    // Fresh-load layout: Meta and Modulation start collapsed (deep controls,
    // opened on demand); Master FX and Inspector stay open (always in play).
    const DEFAULT_COLLAPSED: Record<string, boolean> = { meta: true, modulation: true }
    try {
      const saved = localStorage.getItem('opsia.collapsed')
      if (saved) return JSON.parse(saved) as Record<string, boolean>
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
          // Compositions are immutable — the snapshot is a reference.
          composition: s.composition
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
      // (the engine reconciles; feedback buffers survive the recall).
      return { composition: scene.composition, activeSceneId: id }
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

  newSession: () =>
    // A blank slate. Goes through the normal composition write path, so it
    // lands in undo history — an accidental New is one Ctrl+Z away.
    set((s) => {
      // New session resets the section layout too: Meta/Modulation collapsed,
      // Master FX/Inspector open. Persist so it survives the next reload.
      const collapsed = { ...s.collapsed, meta: true, modulation: true, master: false, inspector: false }
      localStorage.setItem('opsia.collapsed', JSON.stringify(collapsed))
      return {
        name: 'Untitled',
        composition: makeDefaultComposition(),
        selection: null,
        scenes: [],
        activeSceneId: null,
        vibePresetName: null,
        collapsed
      }
    }),
  loadSession: (s) =>
    set({
      name: s.name,
      scenes: s.scenes ?? [],
      activeSceneId: null,
      composition: {
        ...s.composition,
        // Normalize layers from older session files — new fields get defaults.
        layers: s.composition.layers.map((l) => ({
          ...l,
          feedbackAmount: l.feedbackAmount ?? 0.6,
          sourceMix: l.sourceMix ?? 0.5,
          sourceBlend: l.sourceBlend ?? 'normal',
          speed: l.speed ?? 1,
          sourceAFx: l.sourceAFx ?? [],
          sourceBFx: l.sourceBFx ?? [],
          fx: l.fx ?? []
        })),
        // The Vibe Palette then the Context finalizer must exist and sit last,
        // in that order. Older sessions get them appended; sessions whose locked
        // unit was the plain Palette migrate to fx-vibe (color inputs carry
        // over; mastering params get neutral defaults).
        master: (() => {
          let m = (s.composition.master ?? []).map((f) =>
            f.locked && f.shaderId === 'fx-palette'
              ? { ...makeVibePalette(), id: f.id, inputs: { ...makeVibePalette().inputs, ...f.inputs } }
              : f
          )
          if (!m.some((f) => f.shaderId === 'fx-vibe')) m = [...m, makeVibePalette()]
          if (!m.some((f) => f.shaderId === 'fx-context')) m = [...m, makeContext()]
          return m
        })(),
        modulators: s.composition.modulators ?? makeDefaultModulators(),
        modMatrix: s.composition.modMatrix ?? [],
        // 16 knobs now — older 32-knob sessions truncate; short arrays pad.
        metaKnobs: (() => {
          const k = s.composition.metaKnobs ?? []
          const defaults = makeDefaultMetaKnobs()
          return defaults.map((d, i) => k[i] ?? d)
        })()
      }
    }),
  exportSession: () => {
    const s = get()
    return {
      version: 1,
      name: s.name,
      composition: s.composition,
      scenes: s.scenes,
      ui: { theme: s.theme }
    }
  }
}))

// Apply the persisted theme on module load so first paint is themed.
applyTheme(useStore.getState().theme)
