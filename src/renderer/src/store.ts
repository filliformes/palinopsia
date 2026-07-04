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
  Session,
  SourceSlot
} from '@shared/types'
import { MAX_MOD_ASSIGNMENTS } from '@shared/types'
import { makeDefaultModulators } from './engine/modulation'
import { randomizeComposition, type RandomizeScope } from './randomize'

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
// identity (brief §1). Hydra's dark palette is the closest fit for a
// glitch/digital-arts instrument out of the box.
const DEFAULT_THEME: ThemeName = 'hydra'

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

function makeLayer(): LayerState {
  return {
    id: uid(),
    sourceA: emptySlot(),
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
    sourceMix: 0.5
  }
}

export function makeDefaultComposition(): CompositionState {
  return {
    layers: [makeLayer(), makeLayer(), makeLayer(), makeLayer()],
    master: [],
    bpm: 120,
    modulators: makeDefaultModulators(),
    modMatrix: []
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
  setSourceShader: (layer: number, slot: 'A' | 'B', shaderId: string | null) => void
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
  setFxInput: (scope: FxScope, instId: string, name: string, value: number | number[]) => void

  // Randomize (brief §7) — scoped draws from curated aesthetic ranges.
  randomize: (scope: RandomizeScope) => void

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

  // Session round-tripping
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
      }
    })),
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
        composition: updateFxArray(s.composition, scope, (fx) => [
          ...fx,
          { id: instId, shaderId, enabled: true, inputs: {} }
        ]),
        // Land the Inspector on the fresh unit — its controls are the next
        // thing the player reaches for.
        selection: { type: 'fx', scope, instId }
      }
    }),
  removeFx: (scope, instId) =>
    set((s) => ({
      composition: updateFxArray(s.composition, scope, (fx) =>
        fx.filter((f) => f.id !== instId)
      )
    })),
  toggleFx: (scope, instId) =>
    set((s) => ({
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
        const next = [...fx]
        ;[next[i], next[j]] = [next[j], next[i]]
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
    try {
      return JSON.parse(localStorage.getItem('opsia.collapsed') ?? '{}') as Record<
        string,
        boolean
      >
    } catch {
      return {}
    }
  })(),
  toggleSection: (key) =>
    set((s) => {
      const collapsed = { ...s.collapsed, [key]: !s.collapsed[key] }
      localStorage.setItem('opsia.collapsed', JSON.stringify(collapsed))
      return { collapsed }
    }),

  loadSession: (s) =>
    set({
      name: s.name,
      composition: {
        ...s.composition,
        // Normalize layers from older session files — new fields get defaults.
        layers: s.composition.layers.map((l) => ({
          ...l,
          feedbackAmount: l.feedbackAmount ?? 0.6,
          sourceMix: l.sourceMix ?? 0.5,
          sourceAFx: l.sourceAFx ?? [],
          sourceBFx: l.sourceBFx ?? [],
          fx: l.fx ?? []
        })),
        modulators: s.composition.modulators ?? makeDefaultModulators(),
        modMatrix: s.composition.modMatrix ?? []
      }
    }),
  exportSession: () => {
    const s = get()
    return {
      version: 1,
      name: s.name,
      composition: s.composition,
      ui: { theme: s.theme }
    }
  }
}))

// Apply the persisted theme on module load so first paint is themed.
applyTheme(useStore.getState().theme)
