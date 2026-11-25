// dataflou : the decentralized parameter mesh (core 9.3, through its C interface :
// native/dataflou). Palinopsia joins it as a node : it declares a tree of parameters
// (what it senses as SOURCES, what can play it as DESTINATIONS), and every other node
// on the same universe sees them and can wire them to its own. Shared between main
// (the node) and the renderer (the section in the Connect tab, the value bridge).

export type DfType = 'bool' | 'number' | 'string' | 'v2' | 'v3' | 'v4' | 'blob' | 'colour' | 'trigger' | 'array'
export type DfMode = 'streaming' | 'discrete' | 'polling'
export type DfFlow = 'source' | 'destination' | 'bidir'
export type DfAccess = 'read' | 'write' | 'readwrite'
export type DfNature = 'lin' | 'log' | 'exp'
export type DfTopology = 'span' | 'centered' | 'cyclic' | 'free'
export type DfValue = boolean | number | string | number[]

/** One entry of a node's parameter tree. */
export interface DfParam {
  path: string // 'meta/1' : no leading slash, '/'-separated
  kind: 'group' | 'param'
  type: DfType
  mode: DfMode
  flow: DfFlow
  access: DfAccess
  rate: number // Hz, 0 = unspecified
  min: number
  max: number
  init: number
  unit: string
  label: string
  desc: string
  nature: DfNature
  topology: DfTopology
  size?: number // an array : how many elements (floats, ours)
  slots?: number // a population : how many slots (its children are left out)
}

export interface DfSub {
  sku: string
  path: string
  /** How a wire into Palinopsia plays (ours only : the connections list's ⚙). */
  opt?: DfWireOpt
}

/** A wire into Palinopsia, shaped : the part of the destination's range it covers
 *  (lo..hi, 0..1 of that range) and turned the other way (dataflou's own link
 *  transform), smoothed (a slew in ms, the renderer's), and what happens when its
 *  source is gone : hold the last value, or glide back over returnSec to where the
 *  control was before the wire began to play it. */
export interface DfWireOpt {
  lo?: number
  hi?: number
  invert?: boolean
  slewMs?: number
  onLoss?: 'hold' | 'return'
  returnSec?: number
  /** Shaped on the mesh (the visualizer) in a way these words cannot say : a curve,
   *  a source range. Kept as it is until this wire's range or invert is set here. */
  mesh?: boolean
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

/** A wire saved with the session (the session file's `mappings.dataflou`) : one
 *  of Palinopsia's destinations and the source that plays it, in the universe it
 *  was made in. A wire of the session plays only while the node is on that
 *  universe (the others wait in the session, kept). On its destination, and on
 *  its source, it takes the place of this computer's wires (silenced, kept), as
 *  a session's MIDI and OSC mappings do on their inputs. `sku` DF_SELF : one of
 *  Palinopsia's own sources (each computer has its own SKU). */
export interface DfSessionWire {
  universe: string
  dest: string
  sku: string
  path: string
  opt?: DfWireOpt
}
export const DF_SELF = '@self'
export const DF_SESSION_WIRES_MAX = 128

/** One wire's key : its destination, its source's node and path. */
export const dfWireKey = (dest: string, sku: string, path: string): string => `${dest}\n${sku}\n${path}`

/** A session's wires, cleaned : well formed, no twice the same, at most
 *  DF_SESSION_WIRES_MAX. */
export function cleanSessionWires(raw: unknown): DfSessionWire[] {
  if (!Array.isArray(raw)) return []
  const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
  const out: DfSessionWire[] = []
  const seen = new Set<string>()
  for (const x of raw) {
    if (out.length >= DF_SESSION_WIRES_MAX) break
    const w = x as Partial<DfSessionWire> | null
    if (!w || !str(w.universe, 32) || !str(w.dest, 200) || !str(w.sku, 64) || !str(w.path, 200)) continue
    const k = `${w.universe}\n${dfWireKey(w.dest, w.sku, w.path)}`
    if (seen.has(k)) continue
    seen.add(k)
    const opt = cleanWireOpt(w.opt)
    out.push({ universe: w.universe, dest: w.dest, sku: w.sku, path: w.path, ...(opt ? { opt } : {}) })
  }
  return out
}

/** Another node as Palinopsia sees it (the monitor). */
export interface DfNodeView {
  sku: string
  label: string
  product: string
  online: boolean
  local: boolean
  connected: boolean // a direct TCP link (a node can be known only through another)
  address: string
  lastSeenMs: number // ms since epoch (offline : when it left, or when we first saw it so)
  params: DfParam[]
  // its connections : destination path → its sources
  subs: Record<string, DfSub[]>
}

/** How one of our destinations stands (the mesh's own words) : fed by a live
 *  connection, waiting (its last source just went), returning to its rest value, or
 *  free; and where its last end came from. A later core may add words. */
export type DfDestState = 'free' | 'bound' | 'waiting' | 'grounding'
export type DfEndOrigin = 'none' | 'source' | 'connection' | 'destination' | 'outside' | 'lost'
export interface DfDestView {
  state: DfDestState
  origin: DfEndOrigin
  connections: number
  live: number
}

const END_WORDS: Record<DfEndOrigin, string> = {
  none: '',
  source: 'its source finished',
  connection: 'the connection undid itself',
  destination: 'unwired here',
  outside: 'undone from the mesh',
  lost: 'its source is gone'
}
/** How a destination stands, in words ("waiting : its source is gone"). */
export function dfStateWords(d: DfDestView | undefined): string {
  if (!d) return 'free'
  if (d.state === 'bound') return d.live < d.connections ? `bound, ${d.live} of ${d.connections} sources here` : 'bound'
  const why = END_WORDS[d.origin] ?? ''
  const words = d.state === 'grounding' ? 'going back to rest' : d.state
  return why ? `${words} : ${why}` : words
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
  rxPerSec: number
  txPerSec: number
}

export interface DfStatus {
  /** Is the dataflou node in this build ? (its native module loaded) */
  available: boolean
  running: boolean
  error: string | null
  /** The core's version ('9.3'), '' when the module is missing. */
  core: string
  sku: string
  label: string
  universe: string
  address: string // the address the others reach us on
  tcpPort: number
  nodes: DfNodeView[] // every node of the world, ourselves first
  // how our destinations stand : local path → state (those never wired are left out)
  dests: Record<string, DfDestView>
  // our sources someone streams from : local path → destinations (node label + path)
  listeners: Record<string, string[]>
  // nodes on this universe that speak another protocol (8.x, 9.0) : seen, refused
  refused: Array<{ sku: string; label: string; product: string; core: string; address: string }>
  // the other universes nodes on this network were seen in
  universes: string[]
  discovery: string // 'ok', or why the network cannot be browsed
  halted: boolean // the mesh-wide stop is on : no value is taken anywhere
  presentation: boolean // the mesh's phase : preparation, or presentation (the show)
  rxPerSec: number // values that came in per second
  txPerSec: number // values given to what listens, per second
  published: number // the parameters on the mesh now (groups aside)
  actions: number // of which actions (Body rule list triggers)
  // our destinations with saved wires that wait : not published now
  parked: string[]
  // published for the open session only (its wires need them, this computer's
  // list does not have them) : on the tree while it is open, never saved
  sessionPublished?: string[]
  // the session's wires playing now (dfWireKey, with the source's SKU resolved);
  // this computer's wires set aside because the session wires their destination
  // or their source; the session's wires waiting for another universe
  session?: string[]
  silenced?: Array<{ dest: string; sku: string; path: string }>
  sessionElsewhere?: Array<{ universe: string; count: number }>
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
  // Set by the update from v1.3.3 (one node, the Macro knobs only) : the first
  // time the node runs, the destinations its saved wires play are published too,
  // so they keep playing. The renderer's alone (main ignores it).
  migrate?: boolean
  // A scene recalled on the mesh (which changes connections only) also recalls
  // Palinopsia's scene of that number. Off by default.
  sceneRecall?: boolean
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

/** A path segment, short and without spaces (the paths the wires already use). */
function seg32(s: string, from: string): string {
  const t = segOf(s)
  return t.length <= 32 ? t : `${t.slice(0, 25)}-${hash6(from)}`
}

// Each heading's short path, and the start of an id it makes redundant (layer-1
// under l1, meta under macro...).
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
// Every value is normalized 0..1 (bpm and the scene number excepted) : dataflou maps a
// source's range onto a destination's, so 0..1 here meets any other node's range.
// What fires something once (an action, vary, next, a randomize) is a trigger : sent
// over TCP, never lost nor doubled.

/** A destination : where an incoming value goes, as a /opsia OSC address (the
 *  same routes OSC input uses, so a dataflou value plays exactly like OSC). */
export interface DfDest {
  path: string
  label: string
  osc: string
  type: 'number' | 'bool' | 'trigger'
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
  /** An array of these signals, one element each (its elements are paths too : bands/3). */
  array?: string[]
}

const range = (n: number, from = 1): number[] => Array.from({ length: n }, (_, i) => i + from)

export const DF_DESTS: DfDest[] = [
  ...range(16).map((i) => ({ path: `meta/${i}`, label: `Macro ${i}`, osc: `/opsia/meta/${i}`, type: 'number' as const, bidir: `meta:${i}` })),
  ...range(4).flatMap((l) => [
    { path: `layer/${l}/opacity`, label: `L${l} opacity`, osc: `/opsia/layer${l}/opacity`, type: 'number' as const },
    { path: `layer/${l}/speed`, label: `L${l} speed`, osc: `/opsia/layer${l}/speed`, type: 'number' as const },
    { path: `layer/${l}/mix`, label: `L${l} A/B mix`, osc: `/opsia/layer${l}/mix`, type: 'number' as const },
    { path: `layer/${l}/vary`, label: `L${l} vary`, osc: `/opsia/layer${l}/vary`, type: 'trigger' as const },
    { path: `layer/${l}/mute`, label: `L${l} mute`, osc: `/opsia/layer${l}/mute`, type: 'bool' as const }
  ]),
  { path: 'bg/opacity', label: 'background opacity', osc: '/opsia/bg/opacity', type: 'number' },
  { path: 'feel/density', label: 'density', osc: '/opsia/density', type: 'number', init: 0.5 },
  { path: 'feel/proximity', label: 'proximity', osc: '/opsia/proximity', type: 'number', init: 0.5 },
  { path: 'feel/gesture', label: 'gesture / texture', osc: '/opsia/gesture', type: 'number', init: 0.5 },
  { path: 'feel/coalesce', label: 'coalesce (grain / mass)', osc: '/opsia/coalesce', type: 'number', init: 0.5 },
  { path: 'feel/flow', label: 'interruption / flow', osc: '/opsia/flow', type: 'number', init: 0.5 },
  // (its path keeps the old name : a wire to it stays)
  { path: 'feel/drift', label: 'wander', osc: '/opsia/wander', type: 'number' },
  { path: 'feel/tonicity', label: 'tonicity', osc: '/opsia/tonicity', type: 'number' },
  { path: 'feel/shutter', label: 'shutter', osc: '/opsia/shutter', type: 'number' },
  { path: 'feel/superimposition', label: 'superimposition', osc: '/opsia/superflicker', type: 'number' },
  { path: 'world/amount', label: 'World amount', osc: '/opsia/world/amount', type: 'number', init: 1 },
  { path: 'scene/recall', label: 'scene (1-9)', osc: '/opsia/scene', type: 'number', min: 0, max: 9, discrete: true },
  { path: 'scene/next', label: 'next scene', osc: '/opsia/seq/skip', type: 'trigger' },
  { path: 'scene/randomize', label: 'randomize', osc: '/opsia/randomize', type: 'trigger' },
  { path: 'scene/vary', label: 'vary (global)', osc: '/opsia/vary', type: 'trigger' },
  { path: 'bpm', label: 'BPM', osc: '/opsia/bpm', type: 'number', min: 20, max: 800, init: 120 },
  // Every other randomize (scene/randomize is the whole thing) : the Transport's
  // scopes, then the ones only MIDI Learn fired before.
  ...(['sources', 'sourceparams', 'sourcefx', 'sourcefxonly', 'layerfxonly', 'layer', 'master', 'finishing', 'modulators', 'masterparams', 'meta', 'inspector', 'sonify', 'resolume', 'background'] as const).map((sc) => ({
    path: `randomize/${sc}`, label: `randomize ${sc}`, osc: `/opsia/randomize/${sc}`, type: 'trigger' as const
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
  { path: 'output/reset', label: 'output reset', osc: '/opsia/output/reset', type: 'trigger' }
]

export const DF_SOURCES: DfSource[] = [
  ...(['level', 'flux', 'transient', 'centroid', 'pitch', 'noisiness'] as const).map((f) => ({ path: `audio/${f}`, label: `audio ${f}`, signal: `audio:${f}` })),
  { path: 'audio/bands', label: 'audio bands (6, low to high)', signal: '', array: range(6).map((i) => `audio:band${i}`) },
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
  act: 'Actions (the Body rule list)', world: 'World'
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
    rate: 60, min: 0, max: 1, init: 0, unit: '', label, desc: '', nature: 'lin', topology: 'span', ...p
  }
}

/** The tree Palinopsia declares : what `publish` names, groups before their
 *  children, depth first (the actions given are the ones to declare). A destination is
 *  readable too : its value is where the control stands in Palinopsia. */
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
      mode: 'discrete',
      flow: d.bidir ? 'bidir' : 'destination',
      min: d.min ?? 0, max: d.max ?? 1, init: d.init ?? 0,
      rate: d.type === 'number' ? 60 : 0
    }))
  }
  for (const s of DF_SOURCES.filter((x) => dfPublished(pub, dfGroupOf(x.path), x.path))) {
    addGroups(s.path)
    out.push(param(s.path, s.label, { flow: 'source', access: 'read', rate: 30, ...(s.array ? { type: 'array' as const, size: s.array.length } : {}) }))
  }
  // a trigger each
  for (const a of actions) {
    addGroups(a.path)
    out.push(param(a.path, a.label, { type: 'trigger', mode: 'discrete', flow: 'destination', rate: 0 }))
  }
  return out
}

// ── the modulators' mesh inputs ───────────────────────────────────────────
// A Controller modulator played by a value of another node : a destination of ours of
// its own, declared only while a modulator uses it, its connection made and undone
// with the modulator (the composition's, never this computer's list of wires).
export const DF_INPUT_GROUP = 'input'
export const dfInputPath = (slot: number): string => `${DF_INPUT_GROUP}/${slot + 1}`
export interface DfListen {
  sku: string
  path: string
  slot: number
}
export function inputTree(listens: readonly DfListen[]): DfParam[] {
  if (!listens.length) return []
  return [
    param(DF_INPUT_GROUP, 'Modulator inputs', { kind: 'group', rate: 0, flow: 'source', access: 'read', mode: 'discrete' }),
    ...listens.map((l) => param(dfInputPath(l.slot), `Modulator ${l.slot + 1} input`, { mode: 'discrete', desc: 'A value that plays a modulator in Palinopsia' }))
  ]
}

/** A tree as the config the core takes ({ "params": [...] }). */
export function dfTreeJson(params: readonly DfParam[]): string {
  type J = Record<string, unknown> & { children?: J[] }
  const roots: J[] = []
  const groups = new Map<string, J>()
  for (const p of params) {
    const cut = p.path.lastIndexOf('/')
    const name = p.path.slice(cut + 1)
    const into = cut < 0 ? roots : (groups.get(p.path.slice(0, cut))?.children ?? roots)
    if (p.kind === 'group') {
      const g: J = { name, kind: 'group', label: p.label, children: [] }
      groups.set(p.path, g)
      into.push(g)
      continue
    }
    const j: J = { name, kind: 'param', type: p.type, flow: p.flow, mode: p.mode, rate: p.rate, access: p.access, label: p.label }
    if (p.unit) j.unit = p.unit
    if (p.desc) j.desc = p.desc
    if (p.nature !== 'lin') j.nature = p.nature
    if (p.topology !== 'span') j.topology = p.topology
    if (p.type === 'array') {
      j.of = 'float'
      j.size = p.size ?? 1
    }
    if (p.type === 'number' || p.type === 'array') j.range = { min: p.min, max: p.max, init: p.init }
    into.push(j)
  }
  return JSON.stringify({ params: roots })
}

// ── a wire's range and invert, as the core's link transform says them ──────
export interface DfAxis {
  in?: [number, number]
  out?: [number, number]
  curve?: Array<[number, number]>
  free?: boolean
}

/** The transform of a wire onto a destination of range min..max ([] : plain). */
export function optToAxes(opt: DfWireOpt | null | undefined, d: { type: DfType; min: number; max: number }): DfAxis[] {
  if (!opt || (d.type !== 'number' && d.type !== 'bool')) return []
  const a: DfAxis = {}
  const lo = opt.lo ?? 0, hi = opt.hi ?? 1
  if (d.type === 'number' && (lo !== 0 || hi !== 1)) {
    const span = d.max - d.min
    a.out = [d.min + lo * span, d.min + hi * span]
  }
  if (opt.invert) a.curve = [[0, 1], [1, 0]]
  return Object.keys(a).length ? [a] : []
}

/** What a transform says in a wire's words; `mesh` when they cannot say it. */
export function axesToOpt(axes: readonly DfAxis[] | undefined, d: { type: DfType; min: number; max: number } | undefined): DfWireOpt {
  const a = axes?.[0]
  if (!a || (!a.in && !a.out && !a.curve?.length)) return {}
  const out: DfWireOpt = {}
  const near = (x: number, y: number): boolean => Math.abs(x - y) < 1e-4
  if (a.out && d && d.type === 'number' && d.max !== d.min) {
    const lo = (a.out[0] - d.min) / (d.max - d.min), hi = (a.out[1] - d.min) / (d.max - d.min)
    if (!near(lo, 0)) out.lo = Math.round(lo * 1e4) / 1e4
    if (!near(hi, 1)) out.hi = Math.round(hi * 1e4) / 1e4
  }
  const c = a.curve ?? []
  const inverted = c.length === 2 && near(c[0][0], 0) && near(c[0][1], 1) && near(c[1][0], 1) && near(c[1][1], 0)
  const straight = !c.length || (c.length === 2 && near(c[0][0], 0) && near(c[0][1], 0) && near(c[1][0], 1) && near(c[1][1], 1))
  if (inverted) out.invert = true
  if (a.in || !(inverted || straight)) out.mesh = true
  return out
}

/** What this app keeps of a wire beside the mesh (its smoothing, what loss does). */
export function appOpt(opt: DfWireOpt | null | undefined): DfWireOpt | null {
  const c = cleanWireOpt(opt)
  if (!c) return null
  const { slewMs, onLoss, returnSec } = c
  const out: DfWireOpt = { ...(slewMs ? { slewMs } : {}), ...(onLoss ? { onLoss, returnSec } : {}) }
  return Object.keys(out).length ? out : null
}
/** What the mesh keeps of it (the link's transform). */
export function linkOpt(opt: DfWireOpt | null | undefined): DfWireOpt | null {
  const c = cleanWireOpt(opt)
  if (!c) return null
  const { lo, hi, invert } = c
  const out: DfWireOpt = { ...(lo !== undefined ? { lo } : {}), ...(hi !== undefined ? { hi } : {}), ...(invert ? { invert } : {}) }
  return Object.keys(out).length ? out : null
}
