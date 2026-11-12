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
  actions: number // the actions on the mesh now, on both our nodes (0 when they are off)
  actionsDropped: number // actions left out : a tree would have been too big
  // our second node, carrying the actions that follow the session (null when off)
  companion: DfCompanion | null
  visualizer: number // visualizer pages open on this node now
  visualizerAvailable: boolean // does this build carry the visualizer page ?
}

/** Palinopsia's second node : the session's actions (see DF_SESSION_GROUPS). */
export interface DfCompanion {
  sku: string
  label: string
  running: boolean
  actions: number
  actionsDropped: number
  declareBytes: number
}

export interface DfConfig {
  enabled: boolean
  label: string
  universe: string
  // Every action of the Body rule picker as a destination too (act/...). On by
  // default; off for a mesh with a small board (Teensy, M5) : the trees then
  // outgrow what it takes.
  actions: boolean
}

export const DF_DEFAULT_CONFIG: DfConfig = { enabled: false, label: 'palinopsia', universe: 'default', actions: true }

// The Body rule picker's headings whose entries follow the session (its scenes,
// its Worlds, its modulators, its rules, the triggers of what is loaded). They
// ride on a second node, `<label>-session`, so the first keeps a tree of a steady
// size under one frame, every heading always lands on the same node, and a wire
// to an action never moves. Any heading not named here is fixed : the first node.
export const DF_SESSION_GROUPS: ReadonlySet<string> = new Set(['Scenes', 'Worlds', 'Triggers (what is loaded)', 'Modulators', 'Body rules'])
export const dfSessionLabel = (label: string): string => `${label.slice(0, 24)}-session`

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
  { path: 'scene/recall', label: 'scene (1-9)', osc: '/opsia/scene', type: 'number', min: 0, max: 9 },
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

function param(path: string, label: string, p: Partial<DfParam>): DfParam {
  return {
    path, kind: 'param', type: 'number', mode: 'streaming', flow: 'destination', access: 'readwrite',
    rate: 60, ground: false, hardware: false, min: 0, max: 1, init: 0, smooth: [0, 0],
    unit: '', label, desc: '', nature: 'lin', topology: 'span', ...p
  }
}

/** The tree Palinopsia declares : groups before their children, depth first.
 *  The actions come last : a reference node keeps the first 128 entries of a
 *  tree, so it still sees the whole of the rest. `fixed` false : the actions
 *  alone (the session node's tree). */
export function palinopsiaTree(actions: DfAction[] = [], fixed = true): DfParam[] {
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
  for (const d of fixed ? DF_DESTS : []) {
    addGroups(d.path)
    out.push(param(d.path, d.label, {
      type: d.type,
      mode: d.type === 'bool' || d.path === 'scene/recall' ? 'discrete' : 'streaming',
      flow: d.bidir ? 'bidir' : 'destination',
      min: d.min ?? 0, max: d.max ?? (d.type === 'bool' ? 1 : 1), init: d.init ?? 0,
      rate: d.type === 'bool' ? 0 : 60
    }))
  }
  for (const s of fixed ? DF_SOURCES : []) {
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
