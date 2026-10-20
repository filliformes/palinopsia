// The agent's tools (shared/mcpTools.ts lists them), run on the page through
// the same store actions as the UI : the engine, sessions, undo, OSC feedback
// all see an agent's change as they see the performer's. Each change is ONE
// undo step (commitNow before and after), and the performer's Inspector stays
// where it was. Nothing here reaches the Flash safety limiter.

import { useStore } from '../store'
import { FX_SHADERS, GENERATORS, NATIVE_NODES, SHADER_BY_ID, type IsfShader } from '../shaders/isf'
import { inputsForShader, type IsfInputDesc } from '../shaders/isf/inputs'
import { canHostFx } from '../fxScopes'
import { BLEND_MODES, type BlendMode, type FxInstance, type FxScope, type SourceSlot } from '@shared/types'
import type { McpContent, McpResult } from '@shared/mcpTools'
import { oscLeafList, resetOscEdge, routeOsc } from '../oscInput'
import { outputCanvas } from '../engine/outputCanvas'
import { commitNow, undo } from '../undo'
import { categoryOf, registerUserShader } from '../shaders/userShaders'
import { renderStill, type ShaderMark } from '../shaders/shaderCheck'

class ToolError extends Error {}
const fail = (msg: string): never => {
  throw new ToolError(msg)
}

const st = (): ReturnType<typeof useStore.getState> => useStore.getState()
const r3 = (x: number): number => Math.round(x * 1000) / 1000
const text = (x: unknown): McpContent => ({ type: 'text', text: typeof x === 'string' ? x : JSON.stringify(x) })

// ── shaders : find one, say what it is ─────────────────────────────────
const LOCKED_MASTER: Record<string, string> = { vibe: 'fx-vibe', context: 'fx-context', finalizer: 'fx-finalizer' }
const isEffect = (s: IsfShader): boolean => canHostFx({ kind: 'layer', layer: 0 }, s.id) || canHostFx({ kind: 'master' }, s.id)
const isGenerator = (s: IsfShader): boolean => s.category === 'Generator'
const norm = (x: string): string => x.toLowerCase().replace(/[^a-z0-9]/g, '')

function findShader(q: unknown, want: 'generator' | 'effect' | 'any'): IsfShader {
  const s = String(q ?? '').trim()
  if (!s) fail('Name a shader (list_shaders has them).')
  const ok = (x: IsfShader): boolean => (want === 'generator' ? isGenerator(x) : want === 'effect' ? isEffect(x) : isGenerator(x) || isEffect(x))
  const direct = SHADER_BY_ID[s]
  if (direct) {
    if (!ok(direct)) fail(`${direct.name} (${direct.id}) is not ${want === 'generator' ? 'a source' : 'an effect'}.`)
    return direct
  }
  const n = norm(s)
  const all = Object.values(SHADER_BY_ID).filter(ok)
  const hit =
    all.find((x) => norm(x.name) === n) ??
    all.find((x) => norm(x.id) === n || norm(x.id.replace(/^(gen|fx|node|user)-/, '')) === n) ??
    all.find((x) => norm(x.name).startsWith(n)) ??
    all.find((x) => norm(x.name).includes(n))
  if (!hit) fail(`No ${want === 'any' ? 'shader' : want === 'generator' ? 'source' : 'effect'} called “${s}” : list_shaders has them.`)
  return hit as IsfShader
}

const headerCache = new Map<string, { description: string }>()
function aboutOf(s: IsfShader): string {
  let h = headerCache.get(s.id)
  if (!h || s.user) {
    let description = ''
    try {
      const m = s.source.match(/\/\*\s*(\{[\s\S]*?\})\s*\*\//)
      description = m ? String((JSON.parse(m[1]) as { DESCRIPTION?: string }).DESCRIPTION ?? '') : ''
    } catch { /* none */ }
    h = { description }
    headerCache.set(s.id, h)
  }
  return h.description
}
function shortAbout(s: IsfShader): string {
  const d = aboutOf(s).replace(/\s+/g, ' ').trim()
  const first = d.split(/(?<=[.!?])\s/)[0] ?? d
  return first.length > 170 ? `${first.slice(0, 167)}...` : first
}

function controlsOf(shaderId: string): IsfInputDesc[] {
  return inputsForShader(shaderId).filter((d) => d.type !== 'image')
}
function describeControl(d: IsfInputDesc): Record<string, unknown> {
  const o: Record<string, unknown> = { name: d.name, type: d.type }
  if (d.label && d.label !== d.name) o.label = d.label
  if (d.type === 'float' || d.type === 'point2D') {
    if (d.min !== undefined) o.min = d.min
    if (d.max !== undefined) o.max = d.max
  }
  if (d.type === 'long') {
    const vals = d.values ?? []
    o.options = vals.map((v, i) => `${v}=${d.labels?.[i] ?? v}`).join(', ')
  }
  if (d.def !== undefined) o.default = d.type === 'bool' || d.type === 'event' ? !!d.def : d.def
  if (d.hint) o.about = d.hint
  return o
}

/** A unit's control values (its saved ones over the defaults), rounded. A big
 *  unit lists only what differs from its defaults. */
function valuesOf(shaderId: string | null | undefined, inputs: Record<string, number | number[]> | undefined): Record<string, unknown> | undefined {
  if (!shaderId) return undefined
  const ds = controlsOf(shaderId)
  const out: Record<string, unknown> = {}
  const show = (d: IsfInputDesc, v: number | number[] | undefined): unknown => {
    if (v === undefined) return undefined
    if (d.type === 'bool' || d.type === 'event') return (Array.isArray(v) ? v[0] : v) >= 0.5
    return Array.isArray(v) ? v.map(r3) : r3(v)
  }
  const big = ds.length > 20
  let atDefault = 0
  for (const d of ds) {
    const v = inputs?.[d.name] ?? d.def
    const same = JSON.stringify(inputs?.[d.name] ?? d.def) === JSON.stringify(d.def)
    if (big && same) { atDefault++; continue }
    const x = show(d, v)
    if (x !== undefined) out[d.name] = x
  }
  if (atDefault) out._others_at_default = atDefault
  return out
}

// ── units and racks ────────────────────────────────────────────────────
type Unit =
  | { kind: 'source'; layer: number; slot: 'A' | 'B'; addr: string }
  | { kind: 'bg'; addr: string }
  | { kind: 'fx'; scope: FxScope; inst: FxInstance; index: number; addr: string }

function rackOf(scope: FxScope): FxInstance[] {
  const c = st().composition
  switch (scope.kind) {
    case 'master':
      return c.master.filter((f) => !f.locked)
    case 'background':
      return c.background?.fx ?? []
    case 'layer':
      return c.layers[scope.layer]?.fx ?? []
    case 'sourceA':
      return c.layers[scope.layer]?.sourceAFx ?? []
    case 'sourceB':
      return c.layers[scope.layer]?.sourceBFx ?? []
  }
}
function rackName(scope: FxScope): string {
  if (scope.kind === 'master') return 'master'
  if (scope.kind === 'background') return 'bg'
  const L = `L${scope.layer + 1}`
  return scope.kind === 'layer' ? L : `${L}.${scope.kind === 'sourceA' ? 'A' : 'B'}`
}
const fxAddr = (scope: FxScope, i: number): string => `${rackName(scope)}.fx.${i + 1}`

function parseRack(q: unknown): FxScope {
  const s = String(q ?? '').trim().toLowerCase().replace(/\s+/g, '')
  let m: RegExpMatchArray | null
  if (s === 'master') return { kind: 'master' }
  if (s === 'bg' || s === 'background') return { kind: 'background' }
  if ((m = s.match(/^(?:l|layer)([1-4])$/))) return { kind: 'layer', layer: Number(m[1]) - 1 }
  if ((m = s.match(/^(?:l|layer)([1-4])\.([ab])$/))) return { kind: m[2] === 'a' ? 'sourceA' : 'sourceB', layer: Number(m[1]) - 1 }
  return fail(`“${String(q)}” is not a rack : L1, L1.A, L1.B, master or bg.`)
}

function parseUnit(q: unknown): Unit {
  const raw = String(q ?? '').trim()
  const s = raw.toLowerCase().replace(/\s+/g, '')
  let m: RegExpMatchArray | null
  if ((m = s.match(/^(?:l|layer)([1-4])\.([ab])$/))) {
    const layer = Number(m[1]) - 1
    const slot = m[2] === 'a' ? 'A' : 'B'
    return { kind: 'source', layer, slot, addr: `L${layer + 1}.${slot}` }
  }
  if (s === 'bg' || s === 'background') return { kind: 'bg', addr: 'bg' }
  if ((m = s.match(/^master\.(vibe|context|finalizer)$/))) {
    const inst = st().composition.master.find((f) => f.shaderId === LOCKED_MASTER[m![1]])
    if (!inst) fail(`There is no ${m[1]} on the master.`)
    return { kind: 'fx', scope: { kind: 'master' }, inst: inst as FxInstance, index: -1, addr: `master.${m[1]}` }
  }
  let scope: FxScope | null = null
  let n = 0
  if ((m = s.match(/^master\.fx\.(\d+)$/))) { scope = { kind: 'master' }; n = Number(m[1]) }
  else if ((m = s.match(/^(?:bg|background)\.fx\.(\d+)$/))) { scope = { kind: 'background' }; n = Number(m[1]) }
  else if ((m = s.match(/^(?:l|layer)([1-4])\.fx\.(\d+)$/))) { scope = { kind: 'layer', layer: Number(m[1]) - 1 }; n = Number(m[2]) }
  else if ((m = s.match(/^(?:l|layer)([1-4])\.([ab])\.fx\.(\d+)$/))) { scope = { kind: m[2] === 'a' ? 'sourceA' : 'sourceB', layer: Number(m[1]) - 1 }; n = Number(m[3]) }
  if (!scope) return fail(`“${raw}” is not a unit : L1.A, L1.B, L1.fx.2, L1.A.fx.1, master.fx.1, master.vibe, master.context, master.finalizer, bg, bg.fx.1.`)
  const rack = rackOf(scope)
  const inst = rack[n - 1]
  if (!inst) fail(`${rackName(scope)} has ${rack.length} effect${rack.length === 1 ? '' : 's'} : there is no #${n}.`)
  return { kind: 'fx', scope, inst: inst as FxInstance, index: n - 1, addr: fxAddr(scope, n - 1) }
}

function unitShader(u: Unit): string | null {
  const c = st().composition
  if (u.kind === 'fx') return u.inst.shaderId
  if (u.kind === 'bg') return c.background?.source.kind === 'generator' ? c.background.source.shaderId : null
  const slot = u.slot === 'A' ? c.layers[u.layer]?.sourceA : c.layers[u.layer]?.sourceB
  return slot?.kind === 'generator' ? slot.shaderId : null
}

// ── values : the agent's into the store's ──────────────────────────────
function toValue(d: IsfInputDesc, v: unknown, unitAddr: string): number | number[] {
  const where = `${unitAddr} ${d.name}`
  const num = (x: unknown): number => {
    const n = typeof x === 'boolean' ? (x ? 1 : 0) : Number(x)
    if (!Number.isFinite(n)) fail(`${where} : “${String(x)}” is not a number.`)
    return n
  }
  const lo = typeof d.min === 'number' ? d.min : undefined
  const hi = typeof d.max === 'number' ? d.max : undefined
  switch (d.type) {
    case 'bool':
    case 'event':
      return (typeof v === 'string' ? v === 'true' || v === 'on' || v === '1' : num(v) >= 0.5) ? 1 : 0
    case 'long': {
      const vals = d.values ?? []
      if (typeof v === 'string' && !/^-?\d+(\.\d+)?$/.test(v.trim())) {
        const i = (d.labels ?? []).findIndex((l) => norm(l) === norm(v))
        if (i < 0) fail(`${where} : “${v}” is not one of ${(d.labels ?? []).join(', ')}.`)
        return vals[i] ?? i
      }
      const n = num(v)
      if (!vals.length) return Math.round(Math.max(lo ?? -Infinity, Math.min(hi ?? Infinity, n)))
      return vals.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a), vals[0])
    }
    case 'color': {
      if (!Array.isArray(v) || v.length < 3) fail(`${where} : a color is [r, g, b] or [r, g, b, a], each 0-1.`)
      const c = (v as unknown[]).slice(0, 4).map(num)
      // 0-255 given : read from the color itself (an alpha of 1 stays 1)
      const rgb = c.slice(0, 3)
      const scaled = rgb.some((x) => x > 1.5) ? rgb.map((x) => x / 255) : rgb
      const a = c.length > 3 ? (c[3] > 1.5 ? c[3] / 255 : c[3]) : 1
      return [...scaled, a].map((x) => Math.max(0, Math.min(1, x)))
    }
    case 'point2D': {
      if (!Array.isArray(v) || v.length < 2) fail(`${where} : a point is [x, y].`)
      const p = (v as unknown[]).slice(0, 2).map(num)
      const mn = Array.isArray(d.min) ? d.min : [-Infinity, -Infinity]
      const mx = Array.isArray(d.max) ? d.max : [Infinity, Infinity]
      return p.map((x, i) => Math.max(mn[i] ?? -Infinity, Math.min(mx[i] ?? Infinity, x)))
    }
    default: {
      const n = num(v)
      return Math.max(lo ?? -Infinity, Math.min(hi ?? Infinity, n))
    }
  }
}

interface Resolved { shaderId: string; out: Record<string, number | number[]>; events: string[] }

/** Read `values` against a shader's controls, changing nothing : a wrong name or
 *  value fails here, before anything moves. */
function resolveValues(shaderId: string, values: unknown, addr: string): Resolved {
  if (typeof values !== 'object' || values === null || Array.isArray(values)) fail('values is an object : control name → value.')
  const ds = controlsOf(shaderId)
  const out: Record<string, number | number[]> = {}
  const events: string[] = []
  const unknown: string[] = []
  for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
    const d = ds.find((x) => x.name === k) ?? ds.find((x) => norm(x.name) === norm(k) || norm(x.label) === norm(k))
    if (!d) { unknown.push(k); continue }
    out[d.name] = toValue(d, v, addr)
    if (d.type === 'event' && out[d.name] === 1) events.push(d.name)
  }
  if (unknown.length) fail(`${addr} (${SHADER_BY_ID[shaderId]?.name ?? shaderId}) has no control ${unknown.map((x) => `“${x}”`).join(', ')}. Its controls : ${ds.map((d) => d.name).join(', ')}.`)
  return { shaderId, out, events }
}

/** Write resolved values onto a unit; the events among them fire (on for a frame). */
async function writeValues(u: Unit, r: Resolved): Promise<string[]> {
  const set = (vals: Record<string, number | number[]>): void => {
    const s = st()
    if (u.kind === 'fx') {
      // setFxInputs replaces them all : the ones not named keep their values
      const cur = (u.scope.kind === 'master' ? s.composition.master : rackOf(u.scope)).find((f) => f.id === u.inst.id)
      s.setFxInputs(u.scope, u.inst.id, { ...(cur?.inputs ?? {}), ...vals })
    }
    else if (u.kind === 'bg') for (const [k, v] of Object.entries(vals)) s.setBackgroundInput(k, v)
    else for (const [k, v] of Object.entries(vals)) s.setSourceInput(u.layer, u.slot, k, v)
  }
  if (!Object.keys(r.out).length) return []
  set(r.out)
  if (r.events.length) {
    await new Promise((res) => setTimeout(res, 80))
    set(Object.fromEntries(r.events.map((e) => [e, 0])))
  }
  return Object.keys(r.out)
}

async function applyValues(u: Unit, values: unknown): Promise<string[]> {
  if (values === undefined || values === null) return []
  const shaderId = unitShader(u)
  if (!shaderId) fail(`${u.addr} plays no shader (a film, a camera, nothing) : it has no controls.`)
  return writeValues(u, resolveValues(shaderId as string, values, u.addr))
}

// ── reading the state ──────────────────────────────────────────────────
function slotInfo(slot: SourceSlot | null | undefined, controls: boolean): Record<string, unknown> | null {
  if (!slot || slot.kind === 'none') return null
  const o: Record<string, unknown> = { kind: slot.kind }
  if (slot.shaderId) {
    o.shader = slot.shaderId
    o.name = SHADER_BY_ID[slot.shaderId]?.name ?? slot.shaderId
  }
  if (slot.mediaName) o.file = slot.mediaName
  if (controls && slot.kind === 'generator') o.controls = valuesOf(slot.shaderId, slot.inputs)
  return o
}
function rackInfo(scope: FxScope, controls: boolean): Array<Record<string, unknown>> {
  return rackOf(scope).map((f, i) => {
    const o: Record<string, unknown> = { unit: fxAddr(scope, i), shader: f.shaderId, name: SHADER_BY_ID[f.shaderId ?? '']?.name ?? f.shaderId }
    if (!f.enabled) o.enabled = false
    if (f.opacity !== undefined && f.opacity < 1) o.mix = r3(f.opacity)
    if (controls) o.controls = valuesOf(f.shaderId, f.inputs)
    return o
  })
}

function getState(args: Record<string, unknown>): McpResult {
  const controls = args.controls !== false
  const s = st()
  const c = s.composition
  const world = s.worlds.find((w) => w.id === s.world)
  const layers = c.layers.map((l, i) => {
    const scopeOf = (kind: 'layer' | 'sourceA' | 'sourceB'): FxScope => ({ kind, layer: i })
    const o: Record<string, unknown> = {
      layer: i + 1,
      opacity: r3(l.opacity),
      blend: l.blend,
      A: slotInfo(l.sourceA, controls),
      B: slotInfo(l.sourceB, controls)
    }
    if (l.sourceB) { o.mix = r3(l.sourceMix); o.source_blend = l.sourceBlend }
    if (l.mute) o.mute = true
    if (l.solo) o.solo = true
    if (l.speed !== 1) o.speed = r3(l.speed)
    if (l.feedback) { o.feedback = true; o.trail = r3(l.feedbackAmount) }
    if (l.harmony) o.harmony = r3(l.harmony)
    const fx = rackInfo(scopeOf('layer'), controls)
    const afx = rackInfo(scopeOf('sourceA'), controls)
    const bfx = rackInfo(scopeOf('sourceB'), controls)
    if (fx.length) o.fx = fx
    if (afx.length) o.A_fx = afx
    if (bfx.length) o.B_fx = bfx
    return o
  })
  const bg = c.background
  const lockedInfo = (key: string): Record<string, unknown> | undefined => {
    const f = c.master.find((x) => x.shaderId === LOCKED_MASTER[key])
    if (!f) return undefined
    const o: Record<string, unknown> = { unit: `master.${key}` }
    if (!f.enabled) o.enabled = false
    if (controls) o.controls = valuesOf(f.shaderId, f.inputs)
    return o
  }
  const out = {
    bpm: r3(c.bpm),
    world: world ? { name: world.name, amount: r3(s.worldAmount ?? 1) } : null,
    sonify: s.sonify.on ? 'playing' : 'off',
    layers,
    background: bg
      ? {
          opacity: r3(bg.opacity),
          speed: r3(bg.speed),
          depth: r3(bg.depth ?? 0),
          group: bg.blendMode === 'isolate',
          source: slotInfo(bg.source, controls),
          fx: rackInfo({ kind: 'background' }, controls)
        }
      : null,
    master: {
      fx: rackInfo({ kind: 'master' }, controls),
      vibe: lockedInfo('vibe'),
      context: lockedInfo('context'),
      finalizer: lockedInfo('finalizer')
    },
    scenes: s.scenes.map((x, i) => ({ scene: i + 1, name: x.name, ...(s.activeSceneId === x.id ? { active: true } : {}) })),
    modulators_bound: c.modMatrix.length
  }
  return { content: [text(out)] }
}

async function snapshot(args: Record<string, unknown>): Promise<McpResult> {
  const canvas = outputCanvas()
  if (!canvas || !canvas.width) fail('The output is not running.')
  const cv = canvas as HTMLCanvasElement
  const W = Math.max(128, Math.min(1280, Math.round(Number(args.width) || 640)))
  const H = Math.max(2, Math.round((W * cv.height) / cv.width))
  const c2 = document.createElement('canvas')
  c2.width = W
  c2.height = H
  const ctx = c2.getContext('2d')
  if (!ctx) fail('No 2D canvas for the snapshot.')
  ctx!.drawImage(cv, 0, 0, W, H)
  const data = c2.toDataURL('image/jpeg', 0.85).split(',')[1] ?? ''
  const dome = st().dome?.enabled
  return {
    content: [
      { type: 'image', data, mimeType: 'image/jpeg' },
      text(`The output, ${cv.width}×${cv.height} rendered${dome ? ' (fulldome : a domemaster, the front of the dome at the bottom)' : ''}.`)
    ]
  }
}

function listShaders(args: Record<string, unknown>): McpResult {
  const kind = args.kind === 'generator' || args.kind === 'effect' ? args.kind : 'all'
  const q = String(args.query ?? '').trim().toLowerCase()
  const mine = Object.values(SHADER_BY_ID).filter((s) => s.user)
  const gens = [...mine.filter(isGenerator), ...GENERATORS]
  const fxs = [...mine.filter((s) => s.category === 'FX'), ...FX_SHADERS, ...NATIVE_NODES.filter((n) => !FX_SHADERS.includes(n))].filter(isEffect)
  const row = (s: IsfShader): string => {
    const tags = [s.user ? 'yours' : '', s.native ? 'native' : ''].filter(Boolean).join(', ')
    return `${s.id} | ${s.name}${tags ? ` (${tags})` : ''} | ${shortAbout(s)}`
  }
  const keep = (s: IsfShader): boolean => !q || s.id.includes(q) || s.name.toLowerCase().includes(q) || aboutOf(s).toLowerCase().includes(q)
  const uniq = (a: IsfShader[]): IsfShader[] => a.filter((s, i) => a.findIndex((x) => x.id === s.id) === i)
  const parts: string[] = []
  if (kind !== 'effect') parts.push(`SOURCES (generators : set_source)\n${uniq(gens).filter(keep).map(row).join('\n')}`)
  if (kind !== 'generator') parts.push(`EFFECTS (add_effect)\n${uniq(fxs).filter(keep).map(row).join('\n')}`)
  return { content: [text(`id | name | about\n\n${parts.join('\n\n')}`)] }
}

function describeShader(args: Record<string, unknown>): McpResult {
  const s = findShader(args.shader, 'any')
  const o: Record<string, unknown> = {
    id: s.id,
    name: s.name,
    kind: isGenerator(s) ? 'source (generator)' : 'effect',
    about: aboutOf(s),
    controls: controlsOf(s.id).map(describeControl)
  }
  if (s.user) o.yours = true
  if (s.native) o.native = 'runs its own code : no ISF source; its controls work like any other'
  if (args.source === true && !s.native) o.source = s.source
  return { content: [text(o)] }
}

// ── changing things ────────────────────────────────────────────────────
function layerArg(v: unknown): number | 'bg' {
  if (typeof v === 'string' && /^(bg|background)$/i.test(v.trim())) return 'bg'
  const n = Number(typeof v === 'string' ? v.replace(/^l(ayer)?/i, '') : v)
  if (!(n >= 1 && n <= 4) || Math.round(n) !== n) fail('layer is 1-4 or "bg".')
  return n - 1
}

async function setSource(args: Record<string, unknown>): Promise<McpResult> {
  const layer = layerArg(args.layer)
  const none = String(args.shader ?? '').trim().toLowerCase() === 'none'
  const slot = String(args.slot ?? 'A').toUpperCase() === 'B' ? 'B' : 'A'
  const s = none ? null : findShader(args.shader, 'generator')
  const addr = layer === 'bg' ? 'bg' : `L${layer + 1}.${slot}`
  const vals = s && args.values !== undefined && args.values !== null ? resolveValues(s.id, args.values, addr) : null
  if (layer === 'bg') {
    st().setBackgroundSource(s ? s.id : null)
    if (vals) await writeValues({ kind: 'bg', addr }, vals)
    return { content: [text(s ? `bg now plays ${s.name} (${s.id}).` : 'The background is empty.')] }
  }
  st().setSourceShader(layer, slot, s ? s.id : null)
  if (vals) await writeValues({ kind: 'source', layer, slot, addr }, vals)
  const needs = s?.native && !s.dice ? ' It is native and needs its own material (text, a film folder, a camera) : set that in the app.' : ''
  return { content: [text(s ? `${addr} now plays ${s.name} (${s.id}).${needs}` : `${addr} is empty.`)] }
}

async function setControls(args: Record<string, unknown>): Promise<McpResult> {
  const u = parseUnit(args.unit)
  const names = await applyValues(u, args.values)
  return { content: [text(`${u.addr} : set ${names.join(', ') || 'nothing'}.`)] }
}

function setLayer(args: Record<string, unknown>): McpResult {
  const layer = layerArg(args.layer)
  const s = st()
  // every value read and checked first : a wrong one changes nothing
  const n = (k: string, lo: number, hi: number): number | undefined => {
    if (args[k] === undefined) return undefined
    const v = Number(args[k])
    if (!Number.isFinite(v)) fail(`${k} is a number.`)
    return Math.max(lo, Math.min(hi, v))
  }
  const blend = (k: string): BlendMode | undefined => {
    if (args[k] === undefined) return undefined
    const b = String(args[k]).toLowerCase().replace(/[^a-z]/g, '') as BlendMode
    if (!BLEND_MODES.includes(b)) fail(`${k} : “${String(args[k])}” is not a blend (${BLEND_MODES.join(' ')}).`)
    return b
  }
  const done: string[] = []
  if (layer === 'bg') {
    const o = n('opacity', 0, 1)
    const sp = n('speed', 0, 4)
    const d = n('depth', 0, 1)
    if (o !== undefined) { s.setBackgroundOpacity(o); done.push('opacity') }
    if (sp !== undefined) { s.setBackgroundSpeed(sp); done.push('speed') }
    if (d !== undefined) { s.setBackgroundDepth(d); done.push('depth') }
    if (typeof args.group === 'boolean') { s.setBackgroundBlendMode(args.group ? 'isolate' : 'blend'); done.push('group') }
    return { content: [text(`bg : set ${done.join(', ') || 'nothing'}.`)] }
  }
  const l = s.composition.layers[layer]
  const o = n('opacity', 0, 1)
  const b = blend('blend')
  const mx = n('mix', 0, 1)
  const sb = blend('source_blend')
  const sp = n('speed', 0, 4)
  const tr = n('trail', 0, 1)
  const h = n('harmony', 0, 1)
  if (o !== undefined) { s.setOpacity(layer, o); done.push('opacity') }
  if (b) { s.setBlend(layer, b); done.push('blend') }
  if (mx !== undefined) { s.setSourceMix(layer, mx); done.push('mix') }
  if (sb) { s.setSourceBlend(layer, sb); done.push('source_blend') }
  if (typeof args.mute === 'boolean' && args.mute !== l.mute) { s.toggleMute(layer); done.push('mute') }
  if (typeof args.solo === 'boolean' && args.solo !== l.solo) { s.toggleSolo(layer); done.push('solo') }
  if (sp !== undefined) { s.setLayerSpeed(layer, sp); done.push('speed') }
  if (typeof args.feedback === 'boolean' && args.feedback !== l.feedback) { s.toggleFeedback(layer); done.push('feedback') }
  if (tr !== undefined) { s.setFeedbackAmount(layer, tr); done.push('trail') }
  if (h !== undefined) { s.setHarmony(layer, h); done.push('harmony') }
  return { content: [text(`L${layer + 1} : set ${done.join(', ') || 'nothing'}.`)] }
}

async function addEffect(args: Record<string, unknown>): Promise<McpResult> {
  const scope = parseRack(args.rack)
  const fx = findShader(args.shader, 'effect')
  if (!canHostFx(scope, fx.id)) fail(`${fx.name} cannot go on ${rackName(scope)} (a node that needs a whole layer : try the layer rack).`)
  const vals = args.values !== undefined && args.values !== null ? resolveValues(fx.id, args.values, `${rackName(scope)} ${fx.name}`) : null
  const before = new Set(rackOf(scope).map((f) => f.id))
  st().addFx(scope, fx.id)
  let rack = rackOf(scope)
  const inst = rack.find((f) => !before.has(f.id))
  if (!inst) fail(`${rackName(scope)} refused ${fx.name}.`)
  const pos = Number(args.position)
  if (Number.isFinite(pos) && pos >= 1) {
    const others = rack.filter((f) => f.id !== inst!.id)
    const beforeId = others[Math.round(pos) - 1]?.id ?? null
    if (beforeId) st().moveFxTo(scope, inst!.id, scope, beforeId)
    rack = rackOf(scope)
  }
  const index = rack.findIndex((f) => f.id === inst!.id)
  const addr = fxAddr(scope, index)
  if (vals) await writeValues({ kind: 'fx', scope, inst: inst as FxInstance, index, addr }, vals)
  return { content: [text(`${fx.name} added : ${addr}.`)] }
}

function editEffect(args: Record<string, unknown>): McpResult {
  const u = parseUnit(args.unit)
  if (u.kind !== 'fx') fail(`${u.addr} is a source, not an effect.`)
  const f = u as Extract<Unit, { kind: 'fx' }>
  const s = st()
  const name = SHADER_BY_ID[f.inst.shaderId ?? '']?.name ?? f.inst.shaderId
  if (args.remove === true) {
    if (f.inst.locked) fail(`${name} is pinned to the master : it can be turned off, not removed.`)
    s.removeFx(f.scope, f.inst.id)
    return { content: [text(`${name} removed from ${rackName(f.scope)}.`)] }
  }
  const mix = args.mix === undefined ? undefined : Number(args.mix)
  if (mix !== undefined && !Number.isFinite(mix)) fail('mix is a number 0-1.')
  const pos = args.position === undefined ? undefined : Math.round(Number(args.position))
  if (pos !== undefined) {
    if (f.inst.locked) fail(`${name} is pinned : it stays where it is.`)
    if (!(pos >= 1)) fail('position counts from 1.')
  }
  const done: string[] = []
  if (typeof args.enabled === 'boolean' && args.enabled !== f.inst.enabled) { s.toggleFx(f.scope, f.inst.id); done.push(args.enabled ? 'on' : 'off') }
  if (mix !== undefined) {
    s.setFxOpacity(f.scope, f.inst.id, Math.max(0, Math.min(1, mix)))
    done.push('mix')
  }
  if (pos !== undefined) {
    const others = rackOf(f.scope).filter((x) => x.id !== f.inst.id)
    s.moveFxTo(f.scope, f.inst.id, f.scope, others[pos - 1]?.id ?? null)
    done.push(`moved to ${pos}`)
  }
  const now = rackOf(f.scope).findIndex((x) => x.id === f.inst.id)
  return { content: [text(`${name} (${now >= 0 ? fxAddr(f.scope, now) : f.addr}) : ${done.join(', ') || 'unchanged'}.`)] }
}

function marksText(marks: ShaderMark[], source: string): string {
  const lines = source.split('\n')
  return marks
    .map((m) => `${m.level === 'error' ? 'ERROR' : 'warning'}${m.line ? ` line ${m.line}` : ''} : ${m.msg}${m.line ? `\n    ${lines[m.line - 1]?.trim() ?? ''}` : ''}`)
    .join('\n')
}

async function writeShader(args: Record<string, unknown>): Promise<McpResult> {
  const name = String(args.name ?? '').trim()
  const source = String(args.source ?? '')
  if (!name) fail('Name it.')
  if (!source.trim()) fail('source is the whole ISF file.')
  if (source.length > 2_000_000) fail('That source is too big.')
  const still = renderStill(source, { width: 512, values: (args.values as Record<string, unknown>) ?? undefined })
  if (!still.ok) {
    return { content: [text(`It does not compile; nothing was saved.\n${marksText(still.marks, source)}`)], isError: true }
  }
  const r = await window.api.shadersSave(name, source)
  if (!r?.ok) fail(`It compiles, but saving failed : ${r?.error ?? 'the Shaders folder refused it'}.`)
  const info = registerUserShader(r.name, source)
  st().upsertUserShader(info)
  const lines = [`Saved as one of the performer's shaders : ${info.name} (${info.id}), ${info.category === 'FX' ? 'an effect' : 'a source'}, in the Shaders folder.`]
  if (still.marks.length) lines.push(marksText(still.marks, source))
  if (typeof args.use === 'string' && args.use.trim()) {
    const where = args.use.trim()
    try {
      if (info.category === 'FX') {
        const res = await addEffect({ rack: where, shader: info.id, values: args.values })
        lines.push(String((res.content[0] as { text?: string }).text ?? ''))
      } else {
        const m = where.toLowerCase().match(/^(?:l|layer)([1-4])(?:\.([ab]))?$|^(bg|background)$/)
        if (!m) fail(`“${where}” is not a source slot (L1.A, L2.B, bg).`)
        const res = await setSource({ layer: m![3] ? 'bg' : Number(m![1]), slot: (m![2] ?? 'a').toUpperCase(), shader: info.id, values: args.values })
        lines.push(String((res.content[0] as { text?: string }).text ?? ''))
      }
    } catch (e) {
      lines.push(`It is saved, but putting it to work failed : ${(e as Error).message}`)
    }
  }
  return {
    content: [
      text(`${lines.join('\n')}\nThe image : it running alone, ${still.width}×${still.height}${info.category === 'FX' ? ', over a stock picture' : ''}.`),
      { type: 'image', data: still.jpeg ?? '', mimeType: 'image/jpeg' }
    ]
  }
}

function previewShader(args: Record<string, unknown>): McpResult {
  const s = findShader(args.shader, 'any')
  if (s.native) fail(`${s.name} is native (its own code, not ISF) : put it on a layer and take a snapshot.`)
  const still = renderStill(s.source, { width: 512, values: (args.values as Record<string, unknown>) ?? undefined, time: Number(args.time) || 4 })
  if (!still.ok) return { content: [text(`${s.name} did not draw here.\n${marksText(still.marks, s.source)}`)], isError: true }
  return {
    content: [
      { type: 'image', data: still.jpeg ?? '', mimeType: 'image/jpeg' },
      text(`${s.name} alone, ${still.width}×${still.height}${isGenerator(s) ? '' : ', over a stock picture'}.`)
    ]
  }
}

function scenes(args: Record<string, unknown>): McpResult {
  const s = st()
  const list = s.scenes
  const pick = (): (typeof list)[number] => {
    const n = Math.round(Number(args.scene))
    const sc = list[n - 1]
    if (!sc) fail(`There are ${list.length} scenes : no scene ${String(args.scene)}.`)
    return sc as (typeof list)[number]
  }
  switch (args.action) {
    case 'list':
      return { content: [text(list.map((x, i) => ({ scene: i + 1, name: x.name, ...(s.activeSceneId === x.id ? { active: true } : {}) })))] }
    case 'recall': {
      const sc = pick()
      s.recallScene(sc.id)
      return { content: [text(`Recalling ${sc.name} (it morphs over ${(s.morphMs / 1000).toFixed(1)} s).`)] }
    }
    case 'save': {
      const before = new Set(list.map((x) => x.id))
      s.saveScene()
      const made = st().scenes.find((x) => !before.has(x.id))
      if (made && typeof args.name === 'string' && args.name.trim()) st().renameScene(made.id, args.name.trim().slice(0, 60))
      const n = st().scenes.findIndex((x) => x.id === made?.id) + 1
      return { content: [text(`Saved as scene ${n}${made ? ` : ${st().scenes[n - 1]?.name}` : ''}.`)] }
    }
    case 'rename': {
      const sc = pick()
      const nm = String(args.name ?? '').trim()
      if (!nm) fail('Give the new name.')
      s.renameScene(sc.id, nm.slice(0, 60))
      return { content: [text(`Scene ${Number(args.scene)} is now ${nm}.`)] }
    }
    case 'delete': {
      const sc = pick()
      s.deleteScene(sc.id)
      return { content: [text(`Deleted ${sc.name}.`)] }
    }
    default:
      return fail('action : list, recall, save, rename or delete.')
  }
}

function listControls(args: Record<string, unknown>): McpResult {
  const prefix = String(args.prefix ?? '').trim()
  const all = oscLeafList().filter((l) => !prefix || l.path.startsWith(prefix))
  const CAP = 500
  const lines = all.slice(0, CAP).map((l) => `${l.path} : ${l.desc}`)
  if (all.length > CAP) lines.push(`... and ${all.length - CAP} more : narrow with a prefix.`)
  return { content: [text(lines.length ? lines.join('\n') : `Nothing starts with ${prefix}.`)] }
}

function osc(args: Record<string, unknown>): McpResult {
  const address = String(args.address ?? '').trim()
  if (!address.startsWith('/opsia/')) fail('Only Palinopsia\'s own addresses (/opsia/…) : list_controls has them.')
  const raw = Array.isArray(args.args) ? args.args : args.args === undefined ? [] : [args.args]
  const oscArgs = raw.slice(0, 64).map((v) => {
    if (typeof v === 'boolean') return { type: v ? 'T' : 'F', value: v }
    if (typeof v === 'number') return { type: Number.isInteger(v) ? 'i' : 'f', value: v }
    return { type: 's', value: String(v) }
  })
  routeOsc(address, oscArgs)
  resetOscEdge(address)
  return { content: [text(`Sent ${address}${oscArgs.length ? ` ${oscArgs.map((a) => String(a.value)).join(' ')}` : ''}.`)] }
}

function undoTool(args: Record<string, unknown>): McpResult {
  const n = Math.max(1, Math.min(20, Math.round(Number(args.steps) || 1)))
  commitNow()
  for (let i = 0; i < n; i++) undo()
  return { content: [text(`Undid ${n} step${n === 1 ? '' : 's'}.`)] }
}

// ── the dispatcher ─────────────────────────────────────────────────────
type Tool = (args: Record<string, unknown>) => McpResult | Promise<McpResult>
const TOOLS: Record<string, { run: Tool; writes: boolean }> = {
  get_state: { run: getState, writes: false },
  snapshot: { run: snapshot, writes: false },
  list_shaders: { run: listShaders, writes: false },
  describe_shader: { run: describeShader, writes: false },
  set_source: { run: setSource, writes: true },
  set_controls: { run: setControls, writes: true },
  set_layer: { run: setLayer, writes: true },
  add_effect: { run: addEffect, writes: true },
  edit_effect: { run: editEffect, writes: true },
  write_shader: { run: writeShader, writes: true },
  preview_shader: { run: previewShader, writes: false },
  scenes: { run: scenes, writes: true },
  list_controls: { run: listControls, writes: false },
  osc: { run: osc, writes: true },
  undo: { run: undoTool, writes: false }
}

export function toolWrites(name: string): boolean {
  return !!TOOLS[name]?.writes
}

// Changes run one after another (two calls at once : two undo steps, in order,
// the Inspector restored to what it was before the first).
let writes: Promise<unknown> = Promise.resolve()

/** Run one tool. A change is one undo step and leaves the Inspector alone. */
export function runTool(name: string, args: Record<string, unknown>): Promise<McpResult> {
  const t = TOOLS[name]
  if (!t) return Promise.resolve({ content: [text(`Unknown tool ${name}.`)], isError: true })
  if (!t.writes) return runOne(t, args)
  const p = writes.then(() => runOne(t, args))
  writes = p.catch(() => undefined)
  return p
}

async function runOne(t: { run: Tool; writes: boolean }, args: Record<string, unknown>): Promise<McpResult> {
  const selection = st().selection
  if (t.writes) commitNow() // the performer's edit in progress : its own step
  try {
    return await t.run(args ?? {})
  } catch (e) {
    const msg = e instanceof ToolError ? e.message : `It went wrong : ${(e as Error).message}`
    return { content: [text(msg)], isError: true }
  } finally {
    if (t.writes) {
      commitNow() // the agent's change : one step
      // straight back (setSelection would also open a collapsed Inspector)
      if (st().selection !== selection) useStore.setState({ selection })
    }
  }
}
