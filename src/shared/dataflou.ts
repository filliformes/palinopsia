// dataflou : the decentralized parameter mesh (mDNS discovery, a CBOR topology
// protocol over TCP, a UDP data plane). Palinopsia joins it as a node : it
// declares a small tree of parameters (what it senses as SOURCES, what can play
// it as DESTINATIONS), and every other node on the same universe sees them and
// can wire them to its own. Shared between main (the node) and the renderer
// (the section in the audio/midi/osc tab, the value bridge).

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
}

export interface DfConfig {
  enabled: boolean
  label: string
  universe: string
}

export const DF_DEFAULT_CONFIG: DfConfig = { enabled: false, label: 'palinopsia', universe: 'default' }

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
  ...range(16).map((i) => ({ path: `meta/${i}`, label: `Meta ${i}`, osc: `/opsia/meta/${i}`, type: 'number' as const, bidir: `meta:${i}` })),
  ...range(4).flatMap((l) => [
    { path: `layer/${l}/opacity`, label: `L${l} opacity`, osc: `/opsia/layer${l}/opacity`, type: 'number' as const },
    { path: `layer/${l}/speed`, label: `L${l} speed`, osc: `/opsia/layer${l}/speed`, type: 'number' as const },
    { path: `layer/${l}/mix`, label: `L${l} A/B mix`, osc: `/opsia/layer${l}/mix`, type: 'number' as const }
  ]),
  { path: 'feel/density', label: 'density', osc: '/opsia/density', type: 'number', init: 0.5 },
  { path: 'feel/proximity', label: 'proximity', osc: '/opsia/proximity', type: 'number', init: 0.5 },
  { path: 'feel/gesture', label: 'gesture / texture', osc: '/opsia/gesture', type: 'number', init: 0.5 },
  { path: 'feel/coalesce', label: 'dispersal / coalescence', osc: '/opsia/coalesce', type: 'number', init: 0.5 },
  { path: 'feel/flow', label: 'flow / interruption', osc: '/opsia/flow', type: 'number', init: 0.5 },
  { path: 'feel/drift', label: 'drift', osc: '/opsia/drift', type: 'number' },
  { path: 'scene/recall', label: 'scene (1-9)', osc: '/opsia/scene', type: 'number', min: 0, max: 9 },
  { path: 'scene/next', label: 'next scene', osc: '/opsia/seq/skip', type: 'bool' },
  { path: 'scene/randomize', label: 'randomize', osc: '/opsia/randomize', type: 'bool' },
  { path: 'bpm', label: 'BPM', osc: '/opsia/bpm', type: 'number', min: 20, max: 300, init: 120 }
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
  meta: 'Meta knobs', layer: 'Layers', feel: 'Feel', scene: 'Scenes',
  audio: 'Audio in', vision: 'Picture', body: 'Body', mod: 'Modulators'
}

function param(path: string, label: string, p: Partial<DfParam>): DfParam {
  return {
    path, kind: 'param', type: 'number', mode: 'streaming', flow: 'destination', access: 'readwrite',
    rate: 60, ground: false, hardware: false, min: 0, max: 1, init: 0, smooth: [0, 0],
    unit: '', label, desc: '', nature: 'lin', topology: 'span', ...p
  }
}

/** The tree Palinopsia declares : groups before their children, depth first. */
export function palinopsiaTree(): DfParam[] {
  const out: DfParam[] = []
  const groups = new Set<string>()
  const addGroups = (path: string): void => {
    const segs = path.split('/')
    for (let i = 1; i < segs.length; i++) {
      const g = segs.slice(0, i).join('/')
      if (groups.has(g)) continue
      groups.add(g)
      out.push(param(g, GROUP_LABELS[g] ?? (/^layer\/\d$/.test(g) ? `Layer ${g.slice(6)}` : g), { kind: 'group', rate: 0, flow: 'source', access: 'read', mode: 'discrete' }))
    }
  }
  for (const d of DF_DESTS) {
    addGroups(d.path)
    out.push(param(d.path, d.label, {
      type: d.type,
      mode: d.type === 'bool' || d.path === 'scene/recall' ? 'discrete' : 'streaming',
      flow: d.bidir ? 'bidir' : 'destination',
      min: d.min ?? 0, max: d.max ?? (d.type === 'bool' ? 1 : 1), init: d.init ?? 0,
      rate: d.type === 'bool' ? 0 : 60
    }))
  }
  for (const s of DF_SOURCES) {
    addGroups(s.path)
    out.push(param(s.path, s.label, { flow: 'source', access: 'read', rate: 30 }))
  }
  return out
}
