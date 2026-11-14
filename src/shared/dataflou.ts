// dataflou : the decentralized parameter mesh (mDNS discovery, a CBOR topology
// protocol over TCP, a UDP data plane). Palinopsia joins it as a node : it
// declares a small tree of parameters (what it senses as SOURCES, what can play
// it as DESTINATIONS), and every other node on the same universe sees them and
// can wire them to its own. Shared between main (the node) and the renderer
// (the section in the Connect tab, the value bridge).

export type DfType = 'bool' | 'number' | 'string' | 'v2' | 'v3' | 'v4' | 'blob' | 'colour'
export type DfMode = 'streaming' | 'discrete' | 'polling'
export type DfFlow = 'source' | 'destination' | 'bidir'
export type DfAccess = 'read' | 'write' | 'readwrite'
export type DfNature = 'lin' | 'log' | 'exp'
export type DfTopology = 'span' | 'centered' | 'cyclic' | 'free'
export type DfValue = boolean | number | string | number[]

/** One entry of a node's parameter tree (dataflou's ParamMeta, as declared). */
export interface DfParam {
  path: string // 'meta/1' : no leading slash, '/'-separated
  kind: 'group' | 'param'
  type: DfType
  mode: DfMode
  flow: DfFlow
  access: DfAccess
  rate: number // Hz, 0 = unspecified
  ground: boolean
  hardware: boolean
  min: number
  max: number
  init: number
  smooth: [number, number]
  unit: string
  label: string
  desc: string
  nature: DfNature
  topology: DfTopology
}

export interface DfSub {
  sku: string
  path: string
  /** How a wire into Palinopsia plays (ours only : the connections list's ⚙). */
  opt?: DfWireOpt
}

/** A wire into Palinopsia, shaped : the part of the destination's range it covers
 *  (lo..hi, 0..1 of that range), turned the other way, smoothed (a slew in ms,
 *  the renderer's), and what happens when its source goes quiet : hold the last
 *  value, or glide back over returnSec to where the control was before the wire
 *  began to play it. */
export interface DfWireOpt {
  lo?: number
  hi?: number
  invert?: boolean
  slewMs?: number
  onLoss?: 'hold' | 'return'
  returnSec?: number
}

/** Clean a wire's options : only what differs from the plain wire is kept
 *  (null : a plain wire). */
export function cleanWireOpt(o: unknown): DfWireOpt | null {
  if (!o || typeof o !== 'object') return null
  const x = o as Record<string, unknown>
  const num = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined)
  const out: DfWireOpt = {}
  const lo = num(x.lo, 0, 1), hi = num(x.hi, 0, 1)
  if (lo !== undefined && lo !== 0) out.lo = lo
  if (hi !== undefined && hi !== 1) out.hi = hi
  if (x.invert === true) out.invert = true
  const slew = num(x.slewMs, 0, 10_000)
  if (slew) out.slewMs = Math.round(slew)
  if (x.onLoss === 'return') {
    out.onLoss = 'return'
    out.returnSec = num(x.returnSec, 0.1, 60) ?? 2
  }
  return Object.keys(out).length ? out : null
}

/** A value of a remote parameter as 0..1 of its declared range (a vector : its
 *  first part; a colour : its brightness). */
export function remote01(v: DfValue, p: { type: DfType; min: number; max: number } | null | undefined): number | null {
  let n: number
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number') n = v
  else if (Array.isArray(v)) {
    if (p?.type === 'colour') return v.length >= 3 ? (0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2]) / 255 : null
    n = typeof v[0] === 'number' ? v[0] : NaN
  } else return null
  if (!Number.isFinite(n)) return null
  const lo = p ? p.min : 0, hi = p ? p.max : 1
  if (!(hi > lo)) return Math.max(0, Math.min(1, n))
  return Math.max(0, Math.min(1, (n - lo) / (hi - lo)))
}

/** Another node as Palinopsia sees it (the monitor). */
export interface DfNodeView {
  sku: string
  label: string
  product: string
  version: number
  state: string
  online: boolean
  local: boolean
  connected: boolean // a direct TCP link (a node can be known only through gossip)
  address: string
  lastSeenMs: number // ms since epoch
  params: DfParam[]
  // bindings ending on this node's params : dest path → its sources
  subs: Record<string, DfSub[]>
}

/** One row of the Connect tab's data view : a destination of ours and what feeds
 *  it (in), or one of our sources and where it goes (out). */
export interface DfIoRow {
  path: string
  label: string
  value: DfValue | null // the last that arrived (in) / ours now (out)
  peers: string[] // node/path : its sources (in) or its destination (out)
  ageMs: number | null // since the last value (null : none yet)
  perSec: number
  live: boolean // connected to the node(s) it talks with
  sku?: string // a watched row : the node it belongs to
}
export interface DfIo {
  sku: string
  label: string
  in: DfIoRow[]
  out: DfIoRow[]
  /** Outside values watched (◉ in the node list) : streamed here only to be seen. */
  watched: DfIoRow[]
  /** The nodes that monitor ours (a visualizer page on them asks for every value) :
   *  how many of our values each takes. Not wires : shown as one line. */
  watchedBy: Array<{ label: string; count: number }>
  rxPerSec: number
  txPerSec: number
}

export interface DfStatus {
  running: boolean
  error: string | null
  sku: string
  label: string
  universe: string
  address: string // the address the others reach us on
  tcpPort: number
  udpPort: number
  nodes: DfNodeView[] // every node of the world, ourselves first
  // our sources someone streams from : local path → destinations (node label + path)
  listeners: Record<string, string[]>
  rxPerSec: number // UDP values received per second
  txPerSec: number // UDP values sent per second
  declareBytes: number // our whole tree, as one DECLARE frame
  published: number // the parameters on the mesh now (groups aside)
  actions: number // of which actions (Body rule list triggers)
  actionsDropped: number // published actions left out : the tree would pass one frame
  visualizer: number // visualizer pages open on this node now
  visualizerAvailable: boolean // does this build carry the visualizer page ?
}

export interface DfConfig {
  enabled: boolean
  label: string
  universe: string
  // What this node shows the mesh, chosen in the dataflou section : one node
  // only, carrying just these. Each entry is a whole group, `g:<group>` (it
  // follows the group : a new scene's action appears by itself), or one
  // parameter, `p:<path>`. Groups : the first segment of a fixed path (meta,
  // layer, feel, scene, bg, randomize, output, bpm, audio, vision, body, mod),
  // or `act:<heading>` for a heading of the Body rule list's actions.
  publish: string[]
}

export const DF_DEFAULT_CONFIG: DfConfig = { enabled: false, label: 'palinopsia', universe: 'default', publish: ['g:meta'] }

/** A publish list as it may be stored : strings of the two forms, deduplicated. */
export function cleanPublish(x: unknown): string[] {
  if (!Array.isArray(x)) return [...DF_DEFAULT_CONFIG.publish]
  const out = new Set<string>()
  for (const e of x) if (typeof e === 'string' && e.length < 200 && /^(g|p):\S/.test(e)) out.add(e)
  return [...out].slice(0, 4000)
}

/** The publish group of a fixed path (its first segment) or of an action. */
export const dfGroupOf = (path: string, actionGroup?: string): string =>
  actionGroup !== undefined ? `act:${actionGroup}` : path.split('/')[0]

/** Is this parameter on the mesh ? */
export const dfPublished = (publish: ReadonlySet<string>, group: string, path: string): boolean =>
  publish.has(`g:${group}`) || publish.has(`p:${path}`)

/** One action of the Body rule picker, as the renderer hands it to the node. */
export interface DfAction {
  id: string // the trigger id (midi.ts fireTrigger)
  path: string // act/<group>/<name>
  label: string
  group: string // the picker's heading
}

// A desktop node takes frames up to 32 KB (32 768 bytes); the actions stop short.
export const DF_DECLARE_MAX = 31_500
// What the smallest boards take (their receive buffer is 8 KB, the length in it).
export const DF_DECLARE_SMALL = 8_000

const segOf = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'x'

function hash6(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36).slice(0, 6)
}

/** A path segment : dataflou names are at most 32 characters, with no spaces. */
function seg32(s: string, from: string): string {
  const t = segOf(s)
  return t.length <= 32 ? t : `${t.slice(0, 25)}-${hash6(from)}`
}

// Each heading's short path, and the start of an id it makes redundant (layer-1
// under l1, meta under macro...) : the whole tree must fit in one frame.
const ACT_GROUPS: Record<string, { seg: string; strip?: RegExp }> = {
  Randomize: { seg: 'rand', strip: /^(rand|fire)-/ },
  'Layer 1': { seg: 'l1', strip: /^layer-1-/ },
  'Layer 2': { seg: 'l2', strip: /^layer-2-/ },
  'Layer 3': { seg: 'l3', strip: /^layer-3-/ },
  'Layer 4': { seg: 'l4', strip: /^layer-4-/ },
  Background: { seg: 'bg', strip: /^bg-/ },
  'Triggers (what is loaded)': { seg: 'trig' },
  Effects: { seg: 'fx' },
  Scenes: { seg: 'scene', strip: /^scene-/ },
  Worlds: { seg: 'world', strip: /^world-/ },
  Generate: { seg: 'gen', strip: /^gen-/ },
  Macro: { seg: 'macro', strip: /^meta-/ },
  Modulators: { seg: 'mod', strip: /^mod-/ },
  'Body rules': { seg: 'rule', strip: /^rule-/ },
  Feel: { seg: 'feel', strip: /^feel-/ },
  'Tempo and sound': { seg: 'tempo' },
  Sonify: { seg: 'sonify', strip: /^sonify-/ },
  Transport: { seg: 'transport', strip: /^fire-/ },
  Output: { seg: 'out', strip: /^out-/ },
  Session: { seg: 'session', strip: /^session-/ }
}

/** Where an action lives on the mesh : act/<its heading>/<its id>, short. Built
 *  from the id, never the label : renaming a scene or a rule must not cut a wire.
 *  `taken` (the paths given so far) keeps a stripped name from landing on another. */
export function dfActionPath(id: string, group: string, taken?: Set<string>): string {
  const g = ACT_GROUPS[group]
  const gseg = g?.seg ?? seg32(group, group)
  const full = segOf(
    id
      .replace(/^act:/, '')
      // 1-based like the interface (the ids count layers, scenes, voices from 0)
      .replace(/^(layer|rand:layer|src|scene|sonify:voice|mod|meta):(\d+)/, (_m, a: string, n: string) => `${a}:${Number(n) + 1}`)
  )
  const short = g?.strip ? full.replace(g.strip, '') : full
  const pick = (n: string): string => `act/${gseg}/${n.length <= 32 ? n : `${n.slice(0, 25)}-${hash6(id)}`}`
  const p = short ? pick(short) : pick(full)
  return taken?.has(p) ? pick(full) : p
}

// ── Palinopsia's tree ─────────────────────────────────────────────────────
// Kept small on purpose : the whole DECLARE must stay well under 8 KB, since
// microcontroller nodes (and every node relaying it to them by gossip) drop a
// frame bigger than their receive buffer. Every value is normalized 0..1 (bpm
// excepted) : dataflou maps a source's range onto a destination's, so 0..1 here
// meets any other node's range.

/** A destination : where an incoming value goes, as a /opsia OSC address (the
 *  same routes OSC input uses, so a dataflou value plays exactly like OSC). */
export interface DfDest {
  path: string
  label: string
  osc: string
  type: 'number' | 'bool'
  min?: number
  max?: number
  init?: number
  bidir?: string // also a source : the signal it reads (see DfSource.signal)
  // a number that picks one thing (a scene) : played once per whole step, never
  // smoothed nor glided back (each step on the way would recall another one)
  discrete?: boolean
}

/** A source : a signal Palinopsia publishes (read like the Resolume mapper's rows). */
export interface DfSource {
  path: string
  label: string
  signal: string // 'audio:level' · 'vision:motion' · 'body:bodyMotion' · 'mod:1'
}

const range = (n: number, from = 1): number[] => Array.from({ length: n }, (_, i) => i + from)

export const DF_DESTS: DfDest[] = [
  ...range(16).map((i) => ({ path: `meta/${i}`, label: `Macro ${i}`, osc: `/opsia/meta/${i}`, type: 'number' as const, bidir: `meta:${i}` })),
  ...range(4).flatMap((l) => [
    { path: `layer/${l}/opacity`, label: `L${l} opacity`, osc: `/opsia/layer${l}/opacity`, type: 'number' as const },
    { path: `layer/${l}/speed`, label: `L${l} speed`, osc: `/opsia/layer${l}/speed`, type: 'number' as const },
    { path: `layer/${l}/mix`, label: `L${l} A/B mix`, osc: `/opsia/layer${l}/mix`, type: 'number' as const },
    { path: `layer/${l}/vary`, label: `L${l} vary`, osc: `/opsia/layer${l}/vary`, type: 'bool' as const },
    { path: `layer/${l}/mute`, label: `L${l} mute`, osc: `/opsia/layer${l}/mute`, type: 'bool' as const }
  ]),
  { path: 'bg/opacity', label: 'background opacity', osc: '/opsia/bg/opacity', type: 'number' },
  { path: 'feel/density', label: 'density', osc: '/opsia/density', type: 'number', init: 0.5 },
  { path: 'feel/proximity', label: 'proximity', osc: '/opsia/proximity', type: 'number', init: 0.5 },
  { path: 'feel/gesture', label: 'gesture / texture', osc: '/opsia/gesture', type: 'number', init: 0.5 },
  { path: 'feel/coalesce', label: 'dispersal / coalescence', osc: '/opsia/coalesce', type: 'number', init: 0.5 },
  { path: 'feel/flow', label: 'flow / interruption', osc: '/opsia/flow', type: 'number', init: 0.5 },
  { path: 'feel/drift', label: 'drift', osc: '/opsia/drift', type: 'number' },
  { path: 'scene/recall', label: 'scene (1-9)', osc: '/opsia/scene', type: 'number', min: 0, max: 9, discrete: true },
  { path: 'scene/next', label: 'next scene', osc: '/opsia/seq/skip', type: 'bool' },
  { path: 'scene/randomize', label: 'randomize', osc: '/opsia/randomize', type: 'bool' },
  { path: 'scene/vary', label: 'vary (global)', osc: '/opsia/vary', type: 'bool' },
  { path: 'bpm', label: 'BPM', osc: '/opsia/bpm', type: 'number', min: 20, max: 800, init: 120 },
  // Every other randomize (scene/randomize is the whole thing) : the Transport's
  // scopes, then the ones only MIDI Learn fired before.
  ...(['sources', 'sourceparams', 'sourcefx', 'sourcefxonly', 'layerfxonly', 'layer', 'master', 'finishing', 'modulators', 'masterparams', 'meta', 'inspector', 'sonify', 'resolume', 'background'] as const).map((sc) => ({
    path: `randomize/${sc}`, label: `randomize ${sc}`, osc: `/opsia/randomize/${sc}`, type: 'bool' as const
  })),
  // The output transform : the whole frame moved as one picture (0.5 = none for
  // offset, scale, rotate and spin).
  { path: 'output/x', label: 'output offset x', osc: '/opsia/output/x', type: 'number', init: 0.5 },
  { path: 'output/y', label: 'output offset y', osc: '/opsia/output/y', type: 'number', init: 0.5 },
  { path: 'output/scale', label: 'output scale', osc: '/opsia/output/scale', type: 'number', init: 0.5 },
  { path: 'output/rotate', label: 'output rotate', osc: '/opsia/output/rotate', type: 'number', init: 0.5 },
  { path: 'output/spin', label: 'output spin', osc: '/opsia/output/spin', type: 'number', init: 0.5 },
  { path: 'output/feather', label: 'output feather', osc: '/opsia/output/feather', type: 'number' },
  { path: 'output/flipx', label: 'output flip x', osc: '/opsia/output/flipx', type: 'bool' },
  { path: 'output/flipy', label: 'output flip y', osc: '/opsia/output/flipy', type: 'bool' },
  { path: 'output/edge', label: 'output edge', osc: '/opsia/output/edge', type: 'number' },
  { path: 'output/reset', label: 'output reset', osc: '/opsia/output/reset', type: 'bool' }
]

export const DF_SOURCES: DfSource[] = [
  ...(['level', 'flux', 'transient', 'centroid', 'pitch', 'noisiness'] as const).map((f) => ({ path: `audio/${f}`, label: `audio ${f}`, signal: `audio:${f}` })),
  ...(['brightness', 'contrast', 'motion', 'edges', 'warmth', 'saturation', 'hue', 'centroidX', 'centroidY'] as const).map((f) => ({
    path: `vision/${f}`, label: `picture ${f}`, signal: `vision:${f}`
  })),
  ...(['bodyPresent', 'bodyMotion', 'handLeftHeight', 'handRightHeight', 'handLeftX', 'handRightX', 'handsApart', 'moveEnergy'] as const).map((f) => ({
    path: `body/${f}`, label: `body ${f}`, signal: `body:${f}`
  })),
  ...range(8).map((i) => ({ path: `mod/${i}`, label: `Mod ${i}`, signal: `mod:${i}` }))
]

const GROUP_LABELS: Record<string, string> = {
  meta: 'Macro knobs', layer: 'Layers', feel: 'Feel', scene: 'Scenes',
  bg: 'Background', randomize: 'Randomize', output: 'Output transform',
  audio: 'Audio in', vision: 'Picture', body: 'Body', mod: 'Modulators',
  act: 'Actions (the Body rule list)'
}

/** The fixed groups the dataflou section offers to publish, in tree order, with
 *  their parameters (destinations, then sources). */
export const DF_PUBLISH_GROUPS: Array<{ key: string; label: string; items: Array<{ path: string; label: string; source: boolean }> }> = (() => {
  const out: Array<{ key: string; label: string; items: Array<{ path: string; label: string; source: boolean }> }> = []
  const at = new Map<string, number>()
  const push = (path: string, label: string, source: boolean): void => {
    const key = dfGroupOf(path)
    if (!at.has(key)) {
      at.set(key, out.length)
      out.push({ key, label: GROUP_LABELS[key] ?? (key === 'bpm' ? 'Tempo' : key), items: [] })
    }
    out[at.get(key)!].items.push({ path, label, source })
  }
  for (const d of DF_DESTS) push(d.path, d.label, !!d.bidir)
  for (const s of DF_SOURCES) push(s.path, s.label, true)
  return out
})()

function param(path: string, label: string, p: Partial<DfParam>): DfParam {
  return {
    path, kind: 'param', type: 'number', mode: 'streaming', flow: 'destination', access: 'readwrite',
    rate: 60, ground: false, hardware: false, min: 0, max: 1, init: 0, smooth: [0, 0],
    unit: '', label, desc: '', nature: 'lin', topology: 'span', ...p
  }
}

/** The tree Palinopsia declares : what `publish` names, groups before their
 *  children, depth first. The actions come last : a reference node keeps the
 *  first 128 entries of a tree, so it still sees the whole of the rest. The
 *  actions given are the ones to declare (already chosen and fitted). */
export function palinopsiaTree(actions: DfAction[] = [], publish: readonly string[] = DF_DEFAULT_CONFIG.publish): DfParam[] {
  const pub = new Set(publish)
  const out: DfParam[] = []
  const groups = new Set<string>()
  const groupLabel = new Map<string, string>()
  for (const a of actions) groupLabel.set(a.path.slice(0, a.path.lastIndexOf('/')), a.group)
  const addGroups = (path: string): void => {
    const segs = path.split('/')
    for (let i = 1; i < segs.length; i++) {
      const g = segs.slice(0, i).join('/')
      if (groups.has(g)) continue
      groups.add(g)
      const label = GROUP_LABELS[g] ?? groupLabel.get(g) ?? (/^layer\/\d$/.test(g) ? `Layer ${g.slice(6)}` : g)
      out.push(param(g, label, { kind: 'group', rate: 0, flow: 'source', access: 'read', mode: 'discrete' }))
    }
  }
  for (const d of DF_DESTS.filter((x) => dfPublished(pub, dfGroupOf(x.path), x.path))) {
    addGroups(d.path)
    out.push(param(d.path, d.label, {
      type: d.type,
      mode: d.type === 'bool' || d.discrete ? 'discrete' : 'streaming',
      flow: d.bidir ? 'bidir' : 'destination',
      min: d.min ?? 0, max: d.max ?? (d.type === 'bool' ? 1 : 1), init: d.init ?? 0,
      rate: d.type === 'bool' ? 0 : 60
    }))
  }
  for (const s of DF_SOURCES.filter((x) => dfPublished(pub, dfGroupOf(x.path), x.path))) {
    addGroups(s.path)
    out.push(param(s.path, s.label, { flow: 'source', access: 'read', rate: 30 }))
  }
  // a trigger each : fires once when it goes on (>= 0.5), like OSC's triggers
  for (const a of actions) {
    addGroups(a.path)
    out.push(param(a.path, a.label, { type: 'bool', mode: 'discrete', flow: 'destination', access: 'write', rate: 0, min: 0, max: 1 }))
  }
  return out
}
