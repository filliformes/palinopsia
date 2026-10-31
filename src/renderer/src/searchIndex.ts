// Search everything (Ctrl/Cmd+K) : what can be found, and what a pick does.
// The palette (components/SearchEverything.tsx) builds this index when it
// opens, and again while the composition changes under it, straight from the
// registries, the presets, the themes and the composition : a new source,
// effect, preset or theme is found with nothing to add here.
//
// Where a pick lands follows the selection, like the hand action it stands
// for, and each row's hint says where :
//  · a source : into the selected slot (the Background when it is selected
//    and the source can be a ground); with an effect selected, its own slot
//    (a layer effect : the layer's first empty slot, else A); with nothing
//    selected, the first empty layer, else L1 A;
//  · an effect : into the selected source's rack, the selected effect's rack,
//    the Background's, or the master FX with nothing selected (canHostFx : a
//    layer-only node falls back to that layer's own rack);
//  · a preset of one shader : onto the selected unit when it plays that
//    shader, else onto one already in the composition, else it loads the
//    shader where a source or an effect would go, with the preset;
//  · a control : its unit in the Inspector (or its strip, the Mixer, the
//    Meta bar), scrolled to and flashed.

import type { FxInstance, FxScope, ModTarget, SourceSlot } from '@shared/types'
import { FX_OPACITY_INPUT } from '@shared/types'
import { useStore, type Selection } from './store'
import { modTargetKey } from './modKey'
import { layerSpeedPin, pinnedInputs } from './persist'
import { randomizeInputs } from './randomize'
import { canHostFx, hostRefusal } from './fxScopes'
import {
  FX_GROUPS,
  FX_SHADERS,
  GENERATORS,
  GENERATORS_ALPHA,
  NATIVE_NODES,
  SHADER_BY_ID,
  inPickerOrder,
  sourceSection
} from './shaders/isf'
import { PRESETS_BY_ID } from './shaders/isf/presets'
import { allChains } from './userChains'
import { keywordsFor } from './shaders/isf/keywords'
import { blurbFor } from './shaders/isf/shaderBlurbs'
import { generatorBlurb } from './shaders/isf/sourceBlurbs'
import { inputsForShader, type IsfInputDesc } from './shaders/isf/inputs'
import { SOURCE_EDITOR_KEY } from './shaders/userShaders'
import { THEME_FAMILIES } from './themes'
import { BG_PRESETS, BG_SOURCES, bgPresetToState } from './bgPresets'
import { BLEND_LABELS } from './components/abMix'
import { fracFor } from './components/AutoControls'
import { showToast } from './components/Toast'
import { searchScore } from './components/SearchSelect'
import { generateFromTheme } from './components/TopBarMenus'
import {
  fireFreeze,
  fireOpenSession,
  firePanic,
  fireRecordToggle,
  fireSelectedRandomize,
  fireShowPanels,
  fireVariation
} from './commands'
import { leaveSession, markClean } from './sessionGuard'
import { redo, undo } from './undo'

type St = ReturnType<typeof useStore.getState>
type Value = number | number[]

export type SearchKind = 'generator' | 'effect' | 'parameter' | 'preset' | 'chain' | 'theme' | 'page' | 'command'

/** The headings, and their order when two kinds match as well. */
export const KIND_ORDER: SearchKind[] = ['generator', 'effect', 'parameter', 'preset', 'chain', 'theme', 'page', 'command']
/** Their order with the field empty (under the recent picks). */
export const KIND_ORDER_IDLE: SearchKind[] = ['page', 'command', 'generator', 'effect', 'parameter', 'preset', 'chain', 'theme']
export const KIND_LABEL: Record<SearchKind, string> = {
  generator: 'Sources',
  effect: 'Effects',
  parameter: 'Parameters',
  preset: 'Presets',
  chain: 'Master chains',
  theme: 'Generate themes',
  page: 'Pages',
  command: 'Commands'
}

export interface SearchItem {
  /** Stable across openings : the recent picks remember it. */
  key: string
  kind: SearchKind
  label: string
  /** Shown at the row's end, and searched (a family name finds its members). */
  group?: string
  keywords?: string[]
  /** One line : what the pick does, or where it lands. */
  hint: string
  title?: string
  /** Why it can't apply now : the row greys, a pick says so. */
  refused?: string
  /** True : the pick shows something on the instrument (picked in the Output
   *  page's own window, the instrument's window is asked forward). */
  reveals?: boolean
  run: () => void | Promise<unknown>
}

// ── Where things go ─────────────────────────────────────────────────────

const isEmpty = (s: SourceSlot | null | undefined): boolean => !s || s.kind === 'none'

function rackWhere(scope: FxScope): string {
  if (scope.kind === 'master') return 'the master FX'
  if (scope.kind === 'background') return 'the Background FX'
  const n = scope.layer + 1
  return scope.kind === 'layer' ? `L${n} FX` : `L${n} ${scope.kind === 'sourceA' ? 'A' : 'B'} FX`
}

interface GenTarget {
  bg: boolean
  layer: number
  slot: 'A' | 'B'
  /** "L2 A" / "the Background" */
  name: string
  /** "into L2 A (selected)" */
  where: string
}

/** Where a source goes. `bgOk` : it can be a ground (BG_SOURCES). */
function genTarget(s: St, bgOk: boolean): GenTarget {
  const sel = s.selection
  const layers = s.composition.layers
  const slotTarget = (layer: number, slot: 'A' | 'B', why: string): GenTarget => {
    const cur = slot === 'A' ? layers[layer]?.sourceA : layers[layer]?.sourceB
    const name = `L${layer + 1} ${slot}`
    return { bg: false, layer, slot, name, where: `${isEmpty(cur) ? 'into' : 'replaces'} ${name} (${why})` }
  }
  if (sel?.type === 'source') return slotTarget(sel.layer, sel.slot, 'selected')
  if (sel?.type === 'background' && bgOk) {
    const where = `${isEmpty(s.composition.background?.source) ? 'into' : 'replaces'} the Background (selected)`
    return { bg: true, layer: -1, slot: 'A', name: 'the Background', where }
  }
  if (sel?.type === 'fx' && sel.scope.kind !== 'master' && sel.scope.kind !== 'background') {
    const li = sel.scope.layer
    if (sel.scope.kind !== 'layer') return slotTarget(li, sel.scope.kind === 'sourceA' ? 'A' : 'B', "the selected effect's source")
    const l = layers[li]
    if (l && !isEmpty(l.sourceA) && isEmpty(l.sourceB)) return slotTarget(li, 'B', 'the selected layer, B is free')
    return slotTarget(li, 'A', 'the selected layer')
  }
  // (the Background selected but this is no ground : a layer, as with nothing)
  const notGround = sel?.type === 'background' ? 'not a ground, ' : ''
  const free = layers.findIndex((l) => isEmpty(l.sourceA) && isEmpty(l.sourceB))
  if (free >= 0) return slotTarget(free, 'A', `${notGround}the first empty layer`)
  return slotTarget(0, 'A', `${notGround}no layer is empty`)
}

/** The rack the selection points at, before asking whether it takes the effect. */
function fxBase(s: St): { scope: FxScope; why: string } {
  const sel = s.selection
  if (sel?.type === 'source') return { scope: { kind: sel.slot === 'A' ? 'sourceA' : 'sourceB', layer: sel.layer }, why: 'the selected source' }
  if (sel?.type === 'fx') return { scope: sel.scope, why: "the selected effect's rack" }
  if (sel?.type === 'background') return { scope: { kind: 'background' }, why: 'the Background is selected' }
  return { scope: { kind: 'master' }, why: sel?.type === 'audio' ? 'the Audio Layer has no rack' : 'nothing selected' }
}

interface FxTarget {
  scope?: FxScope
  where: string
  refused?: string
}

/** Where an effect goes : the selection's rack, else (a layer-only node) that
 *  layer's own rack, else nowhere (the reason). */
function fxTarget(s: St, shaderId: string): FxTarget {
  const { scope, why } = fxBase(s)
  if (canHostFx(scope, shaderId)) return { scope, where: `into ${rackWhere(scope)} (${why})` }
  if (scope.kind !== 'master' && scope.kind !== 'background') {
    const own: FxScope = { kind: 'layer', layer: scope.layer }
    if (canHostFx(own, shaderId)) return { scope: own, where: `into ${rackWhere(own)} (${hostRefusal(scope, shaderId)})` }
  }
  return { where: '', refused: `${hostRefusal(scope, shaderId)} : select a layer's source or effect first` }
}

/** Where sources and effects go now, for the palette's foot. */
export function targetsSummary(s: St): string {
  const g = genTarget(s, true)
  return `sources → ${g.name} · effects → ${rackWhere(fxBase(s).scope)}`
}

// ── The units in the composition ────────────────────────────────────────

type Unit =
  | { kind: 'source'; layer: number; slot: 'A' | 'B' }
  | { kind: 'bg' }
  | { kind: 'fx'; scope: FxScope; instId: string }

interface UnitInfo {
  unit: Unit
  shaderId: string
  values: Record<string, Value>
  /** "L2 A", "L2 FX", "master FX", "finishing", "Background", "Background FX" */
  where: string
  layer: number | null
  /** An effect's dry/wet (a source has none). */
  opacity?: number
}

function unitSelection(u: Unit): Selection {
  if (u.kind === 'source') return { type: 'source', layer: u.layer, slot: u.slot }
  if (u.kind === 'bg') return { type: 'background' }
  return { type: 'fx', scope: u.scope, instId: u.instId }
}

/** One of a unit's inputs as a modulation target (its key is the control's). */
function unitTarget(u: Unit, input: string): ModTarget {
  if (u.kind === 'source') return { kind: 'source', layer: u.layer, slot: u.slot, input }
  if (u.kind === 'bg') return { kind: 'bgSource', input }
  return { kind: 'fx', scope: u.scope, instId: u.instId, input }
}

/** Every unit that plays a shader, in the stack's order : the layers (their
 *  sources, then the sources' racks and the layer's), the master, the Background. */
function allUnits(s: St): UnitInfo[] {
  const c = s.composition
  const out: UnitInfo[] = []
  const rack = (scope: FxScope, fx: FxInstance[], where: (f: FxInstance) => string, layer: number | null): void => {
    for (const f of fx)
      if (f.shaderId)
        out.push({ unit: { kind: 'fx', scope, instId: f.id }, shaderId: f.shaderId, values: f.inputs, where: where(f), layer, opacity: f.opacity ?? 1 })
  }
  c.layers.forEach((l, i) => {
    for (const slot of ['A', 'B'] as const) {
      const src = slot === 'A' ? l.sourceA : l.sourceB
      if (src?.shaderId) out.push({ unit: { kind: 'source', layer: i, slot }, shaderId: src.shaderId, values: src.inputs, where: `L${i + 1} ${slot}`, layer: i })
    }
    const scopes: Array<[FxScope, FxInstance[]]> = [
      [{ kind: 'sourceA', layer: i }, l.sourceAFx],
      [{ kind: 'sourceB', layer: i }, l.sourceBFx],
      [{ kind: 'layer', layer: i }, l.fx]
    ]
    for (const [scope, fx] of scopes) rack(scope, fx, () => rackWhere(scope).replace(/^the /, ''), i)
  })
  rack({ kind: 'master' }, c.master, (f) => (f.locked ? 'finishing' : 'master FX'), null)
  const bg = c.background
  if (bg?.source.shaderId) out.push({ unit: { kind: 'bg' }, shaderId: bg.source.shaderId, values: bg.source.inputs, where: 'Background', layer: null })
  if (bg) rack({ kind: 'background' }, bg.fx, () => 'Background FX', null)
  return out
}

function sameUnit(a: Unit, sel: Selection): boolean {
  if (!sel) return false
  if (a.kind === 'source') return sel.type === 'source' && sel.layer === a.layer && sel.slot === a.slot
  if (a.kind === 'bg') return sel.type === 'background'
  return sel.type === 'fx' && sel.instId === a.instId
}

/** The layer the selection belongs to, if any. */
function selectedLayer(sel: Selection): number | null {
  if (sel?.type === 'source') return sel.layer
  if (sel?.type === 'fx' && sel.scope.kind !== 'master' && sel.scope.kind !== 'background') return sel.scope.layer
  return null
}

function writeValues(u: Unit, values: Record<string, Value>): void {
  const s = useStore.getState()
  for (const [k, raw] of Object.entries(values)) {
    const v = Array.isArray(raw) ? [...raw] : raw
    if (u.kind === 'source') s.setSourceInput(u.layer, u.slot, k, v)
    else if (u.kind === 'bg') s.setBackgroundInput(k, v)
    else s.setFxInput(u.scope, u.instId, k, v)
  }
}

// ── The control a pick reveals ──────────────────────────────────────────

/** The full pages over the instrument : closed so a control under them shows
 *  (a page in its own window covers nothing : it stays). */
function uncover(): void {
  const s = useStore.getState()
  if (s.worldPageOpen) s.setWorldPageOpen(false)
  if (s.sonifyPageOpen && !s.sonifyPageWindow) s.setSonifyPageOpen(false)
  if (s.sequencePageOpen && !s.sequencePageWindow) s.setSequencePageOpen(false)
  if (s.bodyPageOpen && !s.bodyPageWindow) s.setBodyPageOpen(false)
  if (s.resolumePageOpen) s.setResolumePageOpen(false)
  if (s.outputPageOpen && !s.outputPageWindow) s.setOutputPageOpen(false)
}

/** The boxes a control is drawn in : PinZone wraps it with no box of its own
 *  (display: contents), so its children are what shows. */
function boxesOf(el: Element): HTMLElement[] {
  const own = el.getBoundingClientRect()
  if (own.width > 0 && own.height > 0) return [el as HTMLElement]
  const out: HTMLElement[] = []
  for (const c of Array.from(el.children)) {
    const r = c.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) out.push(c as HTMLElement)
    else if (getComputedStyle(c).display === 'contents') out.push(...boxesOf(c))
  }
  return out
}

function visibleBoxes(key: string): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const el of Array.from(document.querySelectorAll(`[data-ctl="${CSS.escape(key)}"]`))) out.push(...boxesOf(el))
  return out
}

/** Two quick pulses of the accent round the control, then nothing left behind
 *  (an animation, not a class : the control's own look is untouched). */
function flash(el: HTMLElement): void {
  const rgb = getComputedStyle(el).getPropertyValue('--c-accent').trim() || '255 255 255'
  const ring = (a: number): string => `2px solid rgb(${rgb} / ${a})`
  try {
    el.animate(
      [
        { outline: ring(1), outlineOffset: '2px' },
        { outline: ring(0.15), outlineOffset: '2px', offset: 0.3 },
        { outline: ring(1), outlineOffset: '2px', offset: 0.55 },
        { outline: ring(0), outlineOffset: '2px' }
      ],
      { duration: 1500, easing: 'ease-out' }
    )
  } catch {
    /* no animation : the scroll alone shows it */
  }
}

/** Run each step (opening the view the control lives in) until the control is
 *  on screen, then bring it into view and flash it. A step that shows nothing
 *  hands on to the next (the layer strip, then the Mixer). `block` 'start' puts
 *  it at the top of its column (a section's head, with the section under it). */
function reveal(key: string, label: string, steps: Array<() => void>, block: ScrollLogicalPosition = 'nearest'): void {
  let i = 0
  const next = (): void => {
    steps[i]()
    const t0 = performance.now()
    const wait = i < steps.length - 1 ? 160 : 1000
    const poll = (): void => {
      const boxes = visibleBoxes(key)
      if (boxes.length) {
        boxes[0].scrollIntoView({ block, inline: 'nearest', behavior: 'smooth' })
        for (const b of boxes) flash(b)
        return
      }
      if (performance.now() - t0 < wait) {
        setTimeout(poll, 40)
        return
      }
      if (++i < steps.length) next()
      else showToast(`${label} : not on screen right now`, 'warn')
    }
    setTimeout(poll, 0)
  }
  next()
}

// ── Values as a row shows them ──────────────────────────────────────────

function hex(v: number[]): string {
  const h = (x: number): string => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')
  return `#${h(v[0] ?? 0)}${h(v[1] ?? 0)}${h(v[2] ?? 0)}`
}

function valueText(inp: IsfInputDesc, v: Value | undefined): string {
  const x = v ?? inp.def
  if (x === undefined) return ''
  if (inp.type === 'color') return Array.isArray(x) ? hex(x) : ''
  if (inp.type === 'point2D') return Array.isArray(x) ? `${(x[0] ?? 0).toFixed(2)}, ${(x[1] ?? 0).toFixed(2)}` : ''
  if (typeof x !== 'number') return ''
  if (inp.type === 'event') return 'fire ▸'
  if (inp.type === 'bool') return x >= 0.5 ? 'on' : 'off'
  if (inp.type === 'long') {
    const i = inp.values ? inp.values.indexOf(x) : -1
    return (i >= 0 ? inp.labels?.[i] : undefined) ?? String(x)
  }
  if (inp.integer) return String(Math.round(x))
  const span = typeof inp.max === 'number' && typeof inp.min === 'number' ? inp.max - inp.min : 1
  return x.toFixed(fracFor(span))
}

const withHint = (value: string, hint?: string): string => (value && hint ? `${value} · ${hint}` : value || hint || '')
/** A level as a row shows it (nothing for a value an older session lacks). */
const n2 = (x: unknown, unit = ''): string => (typeof x === 'number' && Number.isFinite(x) ? `${x.toFixed(2)}${unit}` : '')

// ── The index ───────────────────────────────────────────────────────────

const isGenerator = (s: St, id: string): boolean =>
  GENERATORS.some((g) => g.id === id) || s.userShaders.some((u) => u.id === id && u.category === 'Generator')
const isEffect = (s: St, id: string): boolean =>
  FX_SHADERS.some((f) => f.id === id) || NATIVE_NODES.some((f) => f.id === id) || s.userShaders.some((u) => u.id === id && u.category === 'FX')
const FINISHING = new Set(['fx-vibe', 'fx-context', 'fx-finalizer'])
const nameOf = (id: string): string => SHADER_BY_ID[id]?.name ?? id

/** Load a source where a source goes (genTarget). */
function loadSource(t: GenTarget, shaderId: string): void {
  const s = useStore.getState()
  if (t.bg) s.setBackgroundSource(shaderId)
  else s.setSourceShader(t.layer, t.slot, shaderId)
}

function generatorItems(s: St): SearchItem[] {
  const mine = s.userShaders.filter((u) => u.category === 'Generator').map((u) => ({ id: u.id, name: u.name, group: 'my shaders' }))
  const all = [...mine, ...inPickerOrder(GENERATORS_ALPHA).map((g) => ({ id: g.id, name: g.name, group: sourceSection(g) }))]
  return all.map(({ id, name, group }) => {
    const t = genTarget(s, BG_SOURCES.some((g) => g.id === id))
    return {
      key: `gen:${id}`,
      kind: 'generator' as const,
      label: name,
      group,
      keywords: keywordsFor(id),
      hint: t.where,
      title: generatorBlurb(id) ?? (group === 'my shaders' ? `One of your shaders (the Source Editor, ${SOURCE_EDITOR_KEY})` : undefined),
      run: () => {
        loadSource(t, id)
        showToast(`${name} ${t.where.replace(/ \(.*\)$/, '')}`)
      }
    }
  })
}

function effectItems(s: St): SearchItem[] {
  const mine = s.userShaders.filter((u) => u.category === 'FX').map((u) => ({ id: u.id, name: u.name, group: 'my shaders' }))
  const all = [...mine, ...FX_GROUPS.flatMap((g) => g.shaders.map((f) => ({ id: f.id, name: f.name, group: g.group })))]
  return all.map(({ id, name, group }) => {
    const t = fxTarget(s, id)
    return {
      key: `fx:${id}`,
      kind: 'effect' as const,
      label: name,
      group,
      keywords: keywordsFor(id),
      hint: t.where,
      refused: t.refused,
      title: blurbFor(id) ?? (group === 'my shaders' ? `One of your shaders (the Source Editor, ${SOURCE_EDITOR_KEY})` : undefined),
      run: () => {
        if (!t.scope) return
        useStore.getState().addFx(t.scope, id)
        showToast(`${name} ${t.where.replace(/ \(.*\)$/, '')}`)
      }
    }
  })
}

/** Presets : each shader's own (built in and yours), the master chains, the
 *  layer / mix / Background presets. */
function presetItems(s: St, units: UnitInfo[]): SearchItem[] {
  const out: SearchItem[] = []
  const sel = s.selection
  const selLayer = selectedLayer(sel)
  const ids = new Set([...Object.keys(PRESETS_BY_ID), ...Object.keys(s.userShaderPresets)])
  for (const shaderId of ids) {
    if (!SHADER_BY_ID[shaderId]) continue
    const name = nameOf(shaderId)
    // Onto the selected unit, else one already playing it (the selection's
    // layer first), else the shader loaded where it would go.
    const onIt =
      units.find((u) => u.shaderId === shaderId && sameUnit(u.unit, sel)) ??
      units.find((u) => u.shaderId === shaderId && selLayer !== null && u.layer === selLayer) ??
      units.find((u) => u.shaderId === shaderId)
    let where: string
    let refused: string | undefined
    let apply: (values: Record<string, Value>) => void
    if (onIt) {
      where = `onto ${name} in ${onIt.where}${sameUnit(onIt.unit, sel) ? ' (selected)' : ''}`
      apply = (values) => {
        writeValues(onIt.unit, values)
        useStore.getState().setSelection(unitSelection(onIt.unit))
      }
    } else if (FINISHING.has(shaderId)) {
      continue // always in the master : found above
    } else if (isGenerator(s, shaderId)) {
      const t = genTarget(s, BG_SOURCES.some((g) => g.id === shaderId))
      where = `loads ${name} ${t.where}`
      apply = (values) => {
        loadSource(t, shaderId)
        writeValues(t.bg ? { kind: 'bg' } : { kind: 'source', layer: t.layer, slot: t.slot }, values)
      }
    } else if (isEffect(s, shaderId)) {
      const t = fxTarget(s, shaderId)
      where = `adds ${name} ${t.where}`
      refused = t.refused
      apply = (values) => {
        if (!t.scope) return
        useStore.getState().addFx(t.scope, shaderId)
        const now = useStore.getState().selection // addFx lands the Inspector on the new unit
        if (now?.type === 'fx') writeValues({ kind: 'fx', scope: now.scope, instId: now.instId }, values)
      }
    } else continue
    const push = (p: { name: string; values: Record<string, Value> }, yours: boolean): void => {
      out.push({
        key: `preset:${shaderId}:${yours ? 'u' : 'f'}:${p.name}`,
        kind: 'preset',
        label: p.name,
        group: yours ? `${name} (yours)` : name,
        hint: where,
        refused,
        run: () => {
          apply(p.values)
          if (shaderId === 'fx-vibe') useStore.getState().setVibePresetName(p.name)
          showToast(`${name} · ${p.name}`)
        }
      })
    }
    for (const p of PRESETS_BY_ID[shaderId] ?? []) push(p, false)
    for (const p of s.userShaderPresets[shaderId] ?? []) push(p, true)
  }
  // Whole-layer presets (yours) : onto the selection's layer, else L1.
  const li = selLayer ?? 0
  for (const p of s.layerPresets)
    out.push({
      key: `lpreset:${p.id}`,
      kind: 'preset',
      label: p.name,
      group: 'layer presets',
      hint: `onto L${li + 1}${selLayer === null ? ' (no layer selected)' : ' (the selected layer)'} : its sources and racks`,
      run: () => {
        useStore.getState().applyLayerPreset(li, p.id)
        showToast(`Layer preset · ${p.name} : L${li + 1}`)
      }
    })
  for (const p of s.mixerPresets)
    out.push({
      key: `mpreset:${p.id}`,
      kind: 'preset',
      label: p.name,
      group: 'mixer presets',
      hint: "the four layers' levels, speeds, blends and A·B mix",
      run: () => {
        useStore.getState().applyMixerPreset(p.id)
        showToast(`Mix · ${p.name}`)
      }
    })
  for (const p of BG_PRESETS)
    out.push({
      key: `bgpreset:${p.id}`,
      kind: 'preset',
      label: p.name,
      group: 'background presets',
      hint: 'replaces the Background : a ground and its rack (keeps its shadow and mode)',
      run: () => {
        const bg = useStore.getState().composition.background
        useStore.getState().applyBgPreset({ ...bgPresetToState(p), depth: bg?.depth ?? 0, blendMode: bg?.blendMode ?? 'blend' })
        showToast(`Background · ${p.name}`)
      }
    })
  for (const p of s.bgPresets)
    out.push({
      key: `ubgpreset:${p.id}`,
      kind: 'preset',
      label: p.name,
      group: 'background presets (yours)',
      hint: 'replaces the Background',
      run: () => {
        useStore.getState().applyBgPreset(p.bg)
        showToast(`Background · ${p.name}`)
      }
    })
  return out
}

// (yours first : "my chains")
function chainItems(): SearchItem[] {
  return allChains().map(({ key, preset: p }) => ({
    key: `chain:${key}`,
    kind: 'chain' as const,
    label: p.name,
    group: p.group ?? 'chains',
    hint: `replaces the master chain : ${p.fx.map((f) => nameOf(f.shaderId)).join(' · ') || 'no effects'} (the finishing stays)`,
    run: () => {
      useStore.getState().applyMasterPreset(p.fx, p.vibe, p.context)
      showToast(`Master chain · ${p.name}`)
    }
  }))
}

function themeItems(): SearchItem[] {
  return THEME_FAMILIES.flatMap((f) =>
    f.themes.map((t) => ({
      key: `theme:${t.id}`,
      kind: 'theme' as const,
      label: t.name,
      group: f.family,
      hint: `a new session : ${t.blurb}`,
      title: `Generate a “${t.name}” session (asks to save changes first) : ${t.blurb}`,
      run: () => generateFromTheme(t.id)
    }))
  )
}

/** Every control of what is loaded now : each unit's inputs (and an effect's
 *  dry/wet), the layers', the Background's, the Meta knobs. */
function parameterItems(s: St, units: UnitInfo[]): SearchItem[] {
  const out: SearchItem[] = []
  for (const u of units) {
    const unitName = nameOf(u.shaderId)
    const group = `${unitName} · ${u.where}`
    const target = (input: string): string => modTargetKey(unitTarget(u.unit, input))
    const open = (key: string, label: string) => (): void =>
      reveal(key, `${label} (${group})`, [
        () => {
          uncover()
          fireShowPanels()
          useStore.getState().setSelection(unitSelection(u.unit))
        }
      ])
    for (const inp of inputsForShader(u.shaderId)) {
      const key = target(inp.name)
      out.push({
        key: `param:${key}`,
        kind: 'parameter',
        label: inp.label,
        group,
        keywords: inp.name.toLowerCase() !== inp.label.toLowerCase() ? [inp.name] : undefined,
        hint: withHint(valueText(inp, u.values[inp.name]), inp.hint),
        title: inp.hint,
        reveals: true,
        run: open(key, inp.label)
      })
    }
    if (u.opacity !== undefined) {
      const key = target(FX_OPACITY_INPUT)
      out.push({
        key: `param:${key}`,
        kind: 'parameter',
        label: 'opacity',
        group,
        keywords: ['dry/wet', 'wet', 'mix'],
        hint: withHint(n2(u.opacity), "the effect's dry/wet"),
        reveals: true,
        run: open(key, 'opacity')
      })
    }
  }
  // The layers' own controls : on the layer strip when it shows them, else
  // in the Mixer (blend and hue are always there).
  const c = s.composition
  c.layers.forEach((l, i) => {
    const n = i + 1
    const row = (field: 'opacity' | 'mix' | 'blend' | 'speed' | 'harmony', label: string, value: string, hint: string, keywords: string[]): void => {
      const key = field === 'speed' ? layerSpeedPin(i) : modTargetKey({ kind: 'layer', layer: i, field })
      const onStrip = field === 'opacity' || field === 'mix' || field === 'speed'
      out.push({
        key: `param:${key}`,
        kind: 'parameter',
        label,
        group: `L${n} layer`,
        keywords,
        hint: withHint(value, hint),
        reveals: true,
        run: () =>
          reveal(key, `L${n} ${label}`, [
            ...(onStrip && useStore.getState().rightView === 'layers' ? [() => uncover()] : []),
            () => {
              uncover()
              useStore.getState().setRightView('mixer')
            }
          ])
      })
    }
    row('opacity', 'opacity', n2(l.opacity), 'how much of this layer shows', ['level', 'fader'])
    row('mix', 'A·B mix', Number.isFinite(l.sourceMix) ? `${Math.round(l.sourceMix * 100)}%` : '', 'how much of B joins A', ['mix', 'crossfade'])
    row('blend', 'blend', BLEND_LABELS[l.blend] ?? String(l.blend ?? ''), 'how the layer lands on the layers below', ['blend mode'])
    row('speed', 'speed', n2(l.speed, '×'), "the layer's clock", ['time', 'clock'])
    row('harmony', 'A·B hue', n2(l.harmony), "B's colors drawn onto A's (−) or onto their complement (+)", ['harmony', 'hue'])
    // The Mixer's own : how B meets A, and the sound moving the mix.
    const mixRow = (field: string, label: string, value: string, hint: string, keywords: string[]): void => {
      const key = `mix:${i}:${field}`
      out.push({
        key: `param:${key}`,
        kind: 'parameter',
        label,
        group: `L${n} layer`,
        keywords,
        hint: withHint(value, hint),
        reveals: true,
        run: () =>
          reveal(key, `L${n} ${label}`, [
            () => {
              uncover()
              useStore.getState().setRightView('mixer')
            }
          ])
      })
    }
    mixRow('sourceBlend', 'A·B mode', BLEND_LABELS[l.sourceBlend] ?? String(l.sourceBlend ?? ''), 'how B meets A', ['mix mode', 'blend'])
    const cp = l.coupling
    if (cp) {
      mixRow('coupling', 'coupling', String(cp.mode ?? ''), 'the sound moving the A·B mix', ['cpl', 'sound', 'audio'])
      mixRow('feature', 'coupling feature', cp.feature === 'band' ? `band ${(cp.band ?? 0) + 1}` : String(cp.feature ?? ''), 'what in the sound drives it', ['cpl', 'audio'])
      mixRow('amount', 'coupling amount', n2(cp.amount), 'how far the sound moves the mix', ['cpl', 'amt'])
      mixRow('tightness', 'coupling tightness', n2(cp.tightness), 'loose : only the peaks, tight : every bit of it', ['cpl', 'tight'])
    }
  })
  // The Background's : its strip (opened when folded for the inner ones).
  const bg = c.background
  if (bg) {
    const bgRow = (field: 'opacity' | 'speed' | 'depth', label: string, value: string, hint: string, keywords: string[]): void => {
      const key = modTargetKey({ kind: 'bg', field })
      out.push({
        key: `param:${key}`,
        kind: 'parameter',
        label,
        group: 'Background',
        keywords,
        hint: withHint(value, hint),
        reveals: true,
        run: () =>
          reveal(key, `Background ${label}`, [
            () => {
              uncover()
              const st = useStore.getState()
              st.setRightView('layers')
              if (field !== 'opacity' && st.collapsed['background']) st.setCollapsed('background', false)
            }
          ])
      })
    }
    bgRow('opacity', 'opacity', n2(bg.opacity), 'how much of the ground shows', ['level', 'ground'])
    bgRow('speed', 'speed', n2(bg.speed, '×'), "the ground's own clock", ['time', 'clock'])
    bgRow('depth', 'shadow', n2(bg.depth ?? 0), 'the shadow the layers cast on it', ['depth'])
  }
  // The Meta knobs : the Meta bar, unfolded.
  c.metaKnobs.forEach((k, i) => {
    const key = modTargetKey({ kind: 'meta', knob: i })
    const label = k.name || `Meta ${i + 1}`
    const dests = k.destinations.length
    out.push({
      key: `param:${key}`,
      kind: 'parameter',
      label,
      group: 'Meta',
      keywords: [`meta ${i + 1}`, 'macro', 'knob'],
      hint: withHint(n2(k.value), dests ? `${dests} destination${dests > 1 ? 's' : ''}` : 'no destination yet'),
      reveals: true,
      run: () =>
        reveal(key, label, [
          () => {
            uncover()
            const st = useStore.getState()
            if (st.collapsed['meta']) st.setCollapsed('meta', false)
          }
        ])
    })
  })
  return out
}

// The full pages, then the right column's tabs.
const PAGES: Array<{ id: string; label: string; key: string; hint: string; keywords: string[]; open: (s: St) => void }> = [
  { id: 'output', label: 'Output', key: 'O', hint: 'mapping, the dome, the fullscreen output, recording, the senders', keywords: ['mapping', 'dome', 'record', 'projector', 'keystone', 'ndi', 'spout'], open: (s) => s.setOutputPageOpen(true) },
  { id: 'world', label: 'World', key: 'W', hint: 'the World editor : the mood, the coupling, the film', keywords: ['diegesis', 'mood'], open: (s) => s.setWorldPageOpen(true) },
  { id: 'sequence', label: 'Sequence', key: 'Q', hint: 'macro-form : the scenes over time', keywords: ['macro', 'form', 'scenes', 'sequencer'], open: (s) => s.setSequencePageOpen(true) },
  { id: 'sonify', label: 'Sonify', key: 'S', hint: 'the picture as sound : voices, mixer, sequencers, Space', keywords: ['sound', 'audio', 'voices', 'synth'], open: (s) => s.setSonifyPageOpen(true) },
  { id: 'body', label: 'Body', key: 'B', hint: 'embodied control : hands, pose, gestures', keywords: ['camera', 'pose', 'hands', 'gesture', 'tracking'], open: (s) => s.setBodyPageOpen(true) },
  { id: 'resolume', label: 'Resolume mapper', key: 'K', hint: 'signals to Resolume over OSC', keywords: ['osc', 'mapper'], open: (s) => s.setResolumePageOpen(true) },
  { id: 'editor', label: 'Source Editor', key: SOURCE_EDITOR_KEY, hint: 'write a shader of your own, or a copy of any one', keywords: ['shader', 'code', 'glsl', 'isf'], open: (s) => s.setSourceEditorOpen(true) }
]
type RightView = St['rightView']
const TABS: Array<{ id: RightView; label: string; key: string; hint: string; keywords: string[] }> = [
  { id: 'layers', label: 'Layers', key: '', hint: 'the Background, the four layers, the Audio Layer', keywords: ['strips', 'stack'] },
  { id: 'mixer', label: 'Mixer', key: 'M', hint: 'levels, A·B, hue, coupling, blends', keywords: ['mix', 'coupling', 'faders'] },
  { id: 'finishing', label: 'Finishing', key: 'F', hint: 'the Vibe Palette, Context and the Finalizer', keywords: ['vibe', 'context', 'finalizer', 'grade', 'grain'] },
  { id: 'feel', label: 'Feel', key: 'G', hint: 'the global macros', keywords: ['macros', 'density', 'proximity', 'temperament'] },
  { id: 'io', label: 'Connect', key: 'A', hint: 'audio, MIDI, OSC, Resolume, dataflou, Ableton Link, the agent', keywords: ['audio', 'midi', 'osc', 'link', 'dataflou', 'agent', 'eq'] },
  { id: 'perf', label: 'Performance', key: '', hint: 'the load meter and what the picture reports', keywords: ['fps', 'cpu', 'gpu', 'meter', 'picture'] },
  { id: 'assemble', label: 'Assemble', key: 'E', hint: 'the automatic editor : a folder of films cut into an edit', keywords: ['corpus', 'films', 'edit', 'cut'] }
]

function pageItems(): SearchItem[] {
  const pages = PAGES.map((p) => ({
    key: `page:${p.id}`,
    kind: 'page' as const,
    label: p.label,
    group: 'page',
    keywords: p.keywords,
    hint: `${p.key} · ${p.hint}`,
    run: () => {
      // the page asked for is the one on top : the others close under it
      uncover()
      p.open(useStore.getState())
    }
  }))
  const tabs = TABS.map((t) => ({
    key: `tab:${t.id}`,
    kind: 'page' as const,
    label: t.label,
    group: 'tab',
    keywords: t.keywords,
    hint: t.key ? `${t.key} · ${t.hint}` : t.hint,
    reveals: true,
    run: () => {
      uncover()
      useStore.getState().setRightView(t.id)
    }
  }))
  // The depth engine's menu (it moved from the top bar in v1.3.2) : the
  // Performance tab, its picture section unfolded and at the column's top, the
  // menu flashed.
  const depth: SearchItem = {
    key: 'page:depth',
    kind: 'page',
    label: 'Depth',
    group: 'performance',
    keywords: ['depth', 'ai', 'parallax', 'pulfrich', '2.5d', 'luma blur'],
    hint: 'the depth engine : off, synth or AI, at the head of the picture section',
    reveals: true,
    run: () =>
      reveal(
        'ui:depth',
        'The depth menu',
        [
          () => {
            uncover()
            const st = useStore.getState()
            st.setRightView('perf')
            if (st.collapsed['picture']) st.setCollapsed('picture', false)
          }
        ],
        'start'
      )
  }
  return [...pages, ...tabs, depth]
}

/** The Inspector's ⚄ on the selected unit, folded Inspector or not : its
 *  inputs drawn in their curated ranges, the pinned ones left as they are. */
function diceSelected(): void {
  const s = useStore.getState()
  const u = allUnits(s).find((x) => sameUnit(x.unit, s.selection))
  if (!u) return
  const held = pinnedInputs((input) => unitTarget(u.unit, input), s.pins)
  const next = randomizeInputs(u.shaderId, u.values)
  writeValues(u.unit, Object.fromEntries(Object.entries(next).filter(([k]) => !held(k))))
  if (u.shaderId === 'fx-vibe') s.setVibePresetName(null)
  showToast(`${nameOf(u.shaderId)} randomized`)
}

function commandItems(s: St, units: UnitInfo[]): SearchItem[] {
  const selUnit = units.find((x) => sameUnit(x.unit, s.selection))
  const cmd = (id: string, label: string, hint: string, keywords: string[], run: () => void | Promise<unknown>, refused?: string): SearchItem => ({
    key: `cmd:${id}`,
    kind: 'command',
    label,
    group: 'command',
    keywords,
    hint,
    refused,
    run
  })
  return [
    cmd('randomize', 'Randomize', "R · the Transport's current mode", ['dice', 'random', 'reroll'], fireSelectedRandomize),
    cmd('vary', 'Vary', 'the whole scene nudged around where it is', ['variation', 'nudge'], fireVariation),
    cmd(
      'dice',
      selUnit ? `Randomize ${nameOf(selUnit.shaderId)}` : 'Randomize the selected unit',
      selUnit ? `${selUnit.where} : its parameters, in curated ranges (the Inspector's ⚄)` : "its parameters, in curated ranges (the Inspector's ⚄)",
      ['dice', 'random', 'selected'],
      diceSelected,
      selUnit ? undefined : 'select a source or an effect first'
    ),
    cmd('panic', 'Panic flush', '0 · empty every feedback buffer', ['flush', 'clear', 'reset', 'feedback'], () => {
      firePanic()
      showToast('Panic flush : buffers emptied', 'warn')
    }),
    cmd('freeze', 'Freeze / hold', 'H · hold the output (again : let it go)', ['hold', 'pause', 'still'], fireFreeze),
    cmd('record', 'Record', 'start a take, or stop the one rolling', ['rec', 'capture', 'take', 'video'], fireRecordToggle),
    cmd('learn', 'MIDI Learn', `L · ${s.midiLearnMode ? 'on : turn it off' : 'off : turn it on'}`, ['midi', 'map', 'controller'], () => {
      const st = useStore.getState()
      st.setMidiLearnMode(!st.midiLearnMode)
    }),
    cmd('dome', 'Fulldome', `Ctrl F · ${s.dome.enabled ? 'on : back to a flat output' : 'off : the output as a domemaster'}`, ['dome', 'fisheye', 'planetarium', 'domemaster'], () => {
      const st = useStore.getState()
      const on = !st.dome.enabled
      st.setDome({ enabled: on })
      showToast(on ? 'Fulldome on : the output is a domemaster' : 'Fulldome off : the output is flat again', 'ok', 2200)
    }),
    cmd('new', 'New session', 'a fresh session (asks to save changes first)', ['session', 'blank', 'start'], async () => {
      if (!(await leaveSession('starting a new session'))) return
      useStore.getState().newSession()
      markClean()
      showToast('New session')
    }),
    cmd('open', 'Open session…', 'a session file', ['load', 'file', 'session'], fireOpenSession),
    cmd('undo', 'Undo', 'Ctrl Z', ['back'], () => undo()),
    cmd('redo', 'Redo', 'Ctrl ⇧Z · Ctrl Y', ['again'], () => redo())
  ]
}

// ── Ranking ─────────────────────────────────────────────────────────────

/** SearchSelect's score over the whole query, else every word on its own (each
 *  must really hit : a prefix, a word, a keyword, the group; letters scattered
 *  through a name don't count). Lower is better. */
function matchScore(it: SearchItem, q: string): number | null {
  const words = q.split(/\s+/).filter(Boolean)
  const whole = searchScore(it, q)
  // (several words : a tag the query merely starts with, "mosh" in "mosh l1",
  // is not a match of the whole; each word then has to hit on its own)
  if (whole !== null && (words.length < 2 || whole < 2.5)) return whole
  if (words.length < 2) return null
  let worst = 0
  for (const w of words) {
    const s = searchScore(it, w)
    if (s === null || s >= 4) return null
    worst = Math.max(worst, s)
  }
  return 4.5 + worst / 10
}

export type SearchRow = { item: SearchItem } | { more: SearchKind; count: number }
export interface SearchSection {
  title: string
  rows: SearchRow[]
}

/** How many of a kind show before "more" (all of them, to 200, once asked). */
const CAP = 6
const CAP_PARAMS = 8
const CAP_OPEN = 200
const RECENT_SHOWN = 8

/** The palette's sections for a query : with none, the recent picks then every
 *  kind in its idle order; with one, the kinds by their best match, each item
 *  by its own (a recent pick a little higher). */
export function rankSearch(items: SearchItem[], query: string, recent: string[], expanded: Set<SearchKind>): SearchSection[] {
  const sections: SearchSection[] = []
  const capped = (kind: SearchKind, list: SearchItem[]): SearchRow[] => {
    const cap = expanded.has(kind) ? CAP_OPEN : kind === 'parameter' ? CAP_PARAMS : CAP
    const rows: SearchRow[] = list.slice(0, cap).map((item) => ({ item }))
    if (list.length > cap && cap < CAP_OPEN) rows.push({ more: kind, count: list.length - cap })
    return rows
  }
  if (!query) {
    const byKey = new Map(items.map((it) => [it.key, it]))
    const rec = recent.map((k) => byKey.get(k)).filter((x): x is SearchItem => !!x).slice(0, RECENT_SHOWN)
    if (rec.length) sections.push({ title: 'Recent', rows: rec.map((item) => ({ item })) })
    const shown = new Set(rec.map((it) => it.key))
    for (const kind of KIND_ORDER_IDLE) {
      const list = items.filter((it) => it.kind === kind && !shown.has(it.key))
      if (list.length) sections.push({ title: KIND_LABEL[kind], rows: capped(kind, list) })
    }
    return sections
  }
  const recentSet = new Set(recent)
  const byKind = new Map<SearchKind, Array<{ it: SearchItem; s: number; i: number }>>()
  items.forEach((it, i) => {
    const s = matchScore(it, query)
    if (s === null) return
    // a recent pick rises within its kind
    const x = { it, s: recentSet.has(it.key) ? s - 0.3 : s, i }
    const arr = byKind.get(it.kind)
    if (arr) arr.push(x)
    else byKind.set(it.kind, [x])
  })
  // The kinds by how well their best matches, in tiers (a name, a tag or a
  // family, loose), then in KIND_ORDER : "reverb" puts the reverb effects
  // before the presets that say "reverb" in their name. The thousands of
  // presets and the controls count a little less.
  const tier = (kind: SearchKind, s: number): number => {
    const x = s + (kind === 'preset' ? 1 : kind === 'parameter' ? 0.5 : 0)
    return x <= 1 ? 0 : x <= 2.5 ? 1 : x <= 3.5 ? 2 : 3
  }
  return [...byKind.entries()]
    .map(([kind, list]) => {
      list.sort((a, b) => a.s - b.s || a.i - b.i)
      // A page or tab named exactly what was typed comes first : "depth" lands
      // on the depth menu, not under eight depth parameters and six presets.
      const named = kind === 'page' && list[0].it.label.toLowerCase() === query
      return { kind, t: named ? -1 : tier(kind, list[0].s), list }
    })
    .sort((a, b) => a.t - b.t || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
    .map(({ kind, list }) => ({ title: KIND_LABEL[kind], rows: capped(kind, list.map((x) => x.it)) }))
}

/** Everything the palette can find, for the state the store holds now. */
export function buildSearchIndex(s: St): SearchItem[] {
  // One kind that trips on an odd session (a field it lacks) leaves the rest
  // searchable.
  const safe = (kind: string, build: () => SearchItem[]): SearchItem[] => {
    try {
      return build()
    } catch (err) {
      console.error(`[search] ${kind} :`, (err as Error).message)
      return []
    }
  }
  let units: UnitInfo[] = []
  try {
    units = allUnits(s)
  } catch (err) {
    console.error('[search] units :', (err as Error).message)
  }
  return [
    ...safe('sources', () => generatorItems(s)),
    ...safe('effects', () => effectItems(s)),
    ...safe('parameters', () => parameterItems(s, units)),
    ...safe('presets', () => presetItems(s, units)),
    ...safe('chains', chainItems),
    ...safe('themes', themeItems),
    ...safe('pages', pageItems),
    ...safe('commands', () => commandItems(s, units))
  ]
}
