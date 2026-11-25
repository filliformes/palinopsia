// Palinopsia's seat on the mesh : one node of the dataflou core (addon.ts), and what
// the rest of the app reads of it : the world (every node, its params, its
// connections), how our destinations stand, who listens to our sources, the data view,
// the values others play us with. The core does the mesh itself : discovery, the
// connections and their transforms, reconnecting, scenes, the streams.

import { DfNative, type DfEvent } from './addon'
import {
  dfTreeJson, type DfAxis, type DfDestState, type DfDestView, type DfEndOrigin, type DfIo, type DfIoRow, type DfNodeView, type DfParam, type DfSub, type DfType, type DfValue
} from '@shared/dataflou'

const STATES: DfDestState[] = ['free', 'bound', 'waiting', 'grounding']
const ORIGINS: DfEndOrigin[] = ['none', 'source', 'connection', 'destination', 'outside', 'lost']
const SCENE_OPS = ['recall', 'store', 'status'] as const
const SCENE_STATES = ['none', 'applied', 'modified', 'missing'] as const
// (a value's type, as the light read of a node's params gives it : df_type)
const TYPES: DfType[] = ['bool', 'number', 'string', 'v2', 'v3', 'v4', 'blob', 'colour', 'trigger']
const PARAM_TYPES = new Set<string>([...TYPES, 'array'])

/** One of our own connections, as the core keeps it. */
export interface DfConn {
  id: string
  dest: string
  sku: string
  source: string
  axes?: DfAxis[]
}

export interface World {
  nodes: DfNodeView[]
  mine: DfConn[]
  refused: Array<{ sku: string; label: string; product: string; core: string; address: string }>
}

export interface NodeHost {
  log(msg: string): void
  onValues(list: Array<{ path: string; value: DfValue }>): void
  onFire(path: string, times: number): void
  onDest(path: string, d: DfDestView): void
  onLocate(path: string, on: boolean): void
  onHalt(on: boolean): void
  onScene(op: 'recall' | 'store' | 'status', slot: number, state: string, skipped: number): void
  /** Something changed that the status shows. */
  onChange(): void
  /** The world was read again after it changed. */
  onWorld(w: World): void
  /** The node stopped by itself (an error on its thread). */
  onStopped(why: string): void
}

export interface NodeConfig {
  sku: string
  label: string
  universe: string
  product: string
  dir: string
  params: DfParam[]
}

interface JParam {
  name: string
  kind: string
  label?: string
  type?: string
  of?: string
  size?: number
  slots?: number
  flow?: string
  rate?: number
  mode?: string
  access?: string
  unit?: string
  nature?: string
  topology?: string
  range?: { min?: unknown; max?: unknown }
  children?: JParam[]
}
interface JConn {
  id: string
  dest: string
  sku: string
  source: string
  links?: Array<{ dest: string; source: string; axes?: DfAxis[] }>
}
interface JNode {
  sku: string
  label: string
  product: string
  online: boolean
  is_local: boolean
  address?: string
  port?: number
  params: JParam
  connections?: JConn[]
}

const num = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : Array.isArray(x) && typeof x[0] === 'number' ? x[0] : d)
const one = <T extends string>(x: unknown, list: readonly T[], d: T): T => (list.includes(x as T) ? (x as T) : d)

/** A node's tree, flat. A population is one entry : its slots are alike, and nothing
 *  here wires to one of them (the populations are a second step). */
function flatten(root: JParam): DfParam[] {
  const out: DfParam[] = []
  const walk = (g: JParam, at: string): void => {
    for (const c of g.children ?? []) {
      const path = at ? `${at}/${c.name}` : c.name
      const base = {
        path, min: 0, max: 1, init: 0, unit: c.unit ?? '', label: c.label ?? c.name, desc: '', rate: num(c.rate, 0),
        mode: one(c.mode, ['streaming', 'discrete', 'polling'] as const, 'discrete'),
        flow: one(c.flow, ['source', 'destination', 'bidir'] as const, 'source'),
        access: one(c.access, ['read', 'write', 'readwrite'] as const, 'readwrite'),
        nature: one(c.nature, ['lin', 'log', 'exp'] as const, 'lin'),
        topology: one(c.topology, ['span', 'centered', 'cyclic', 'free'] as const, 'span')
      }
      if (c.kind === 'group') {
        out.push({ ...base, kind: 'group', type: 'number', ...(c.slots ? { slots: c.slots } : {}) })
        if (!c.slots) walk(c, path)
        continue
      }
      // (a type of a later core : shown, not wired)
      const type = (PARAM_TYPES.has(c.type ?? '') ? c.type : 'blob') as DfType
      out.push({ ...base, kind: 'param', type, min: num(c.range?.min, 0), max: num(c.range?.max, 1), ...(c.size ? { size: c.size } : {}) })
    }
  }
  walk(root, '')
  return out
}

export class DataflouNode {
  private native: DfNative
  private running = false
  port = 0
  address = ''
  nodes: DfNodeView[] = []
  mine: DfConn[] = []
  refused: World['refused'] = []
  dests = new Map<string, DfDestView>()
  listeners: Record<string, string[]> = {}
  universes: string[] = []
  discovery = 'ok'
  halted = false
  presentation = false
  rxPerSec = 0
  txPerSec = 0
  private byPath = new Map<string, DfParam>()
  private offlineAt = new Map<string, number>()
  // what came in, per path
  private last = new Map<string, DfValue>()
  private inAt = new Map<string, number>()
  private inCount = new Map<string, number>()
  private inRate = new Map<string, number>()
  private rx = 0
  private tx = 0
  private own: Record<string, { value?: DfValue | null; to?: Array<[string, string, string]> }> = {}
  // outside values seen without a wire : watched in the data view, or a learn
  private watches: DfSub[] = []
  private watchVal = new Map<string, { value: DfValue | null; epoch: number; at: number; count: number; rate: number }>()
  private learning: Map<string, { lo: number; hi: number; label: string; node: string }> | null = null
  private learnUntil = 0
  private pageOpen = false
  private monitoring = false
  private timers: ReturnType<typeof setInterval>[] = []
  private worldBusy = false
  private worldStale = true
  private worldAt = 0

  constructor(private cfg: NodeConfig, private host: NodeHost) {
    this.native = new DfNative((list) => this.onEvents(list))
    this.setDeclared(cfg.params)
  }

  sku(): string {
    return this.cfg.sku
  }
  universe(): string {
    return this.cfg.universe
  }
  declared(path: string): DfParam | undefined {
    return this.byPath.get(path)
  }
  private setDeclared(params: DfParam[]): void {
    this.byPath = new Map(params.filter((p) => p.kind === 'param').map((p) => [p.path, p]))
  }
  private watchable(): string[] {
    return [...this.byPath.values()].filter((p) => p.flow !== 'source').map((p) => p.path)
  }
  private triggers(): string[] {
    return [...this.byPath.values()].filter((p) => p.type === 'trigger').map((p) => p.path)
  }

  /** On the mesh. `before` runs once the node is there and before it polls : what it
   *  changes (the session's wires) is in place before any value comes in. */
  async start(values: Map<string, DfValue>, before: (w: World) => void): Promise<void> {
    this.port = await this.native.open({
      name: this.cfg.label, sku: this.cfg.sku, product: this.cfg.product, universe: this.cfg.universe, dir: this.cfg.dir, config: dfTreeJson(this.cfg.params)
    })
    this.running = true
    this.native.post('triggers', { s: this.triggers() })
    this.native.post('set', { sets: this.valuesFor(this.byPath.values(), values) })
    this.native.post('watch', { s: this.watchable() })
    const w = await this.world()
    if (w) before(w)
    this.native.go()
    // the world (a topology event), at most four times a second
    this.timers.push(setInterval(() => void this.refresh(), 100))
    this.timers.push(setInterval(() => void this.refreshState(), 500))
    this.timers.push(setInterval(() => this.rates(), 1000))
    this.timers.push(setInterval(() => void this.sampleRemote(), 100))
  }

  stop(): void {
    this.running = false
    for (const t of this.timers) clearInterval(t)
    this.timers = []
    this.native.close() // it leaves the mesh; its params stay declared there, the node absent
  }

  // ── what the node says ──────────────────────────────────────────────────

  private onEvents(list: DfEvent[]): void {
    let values: Array<{ path: string; value: DfValue }> = []
    const flush = (): void => {
      if (values.length) this.host.onValues(values)
      values = []
    }
    const now = Date.now()
    for (const e of list) {
      switch (e.k) {
        case 'value': {
          // unknown : the source has no value now : what we had is held
          if (e.value === null || e.value === undefined) break
          this.cameIn(e.path, e.value, now)
          values.push({ path: e.path, value: e.value })
          break
        }
        case 'fire':
          flush()
          this.cameIn(e.path, true, now)
          this.host.onFire(e.path, Math.min(64, Math.round(e.times)))
          break
        case 'dest': {
          flush()
          const d: DfDestView = { state: STATES[e.state] ?? 'bound', origin: ORIGINS[e.origin] ?? 'none', connections: e.connections, live: e.live }
          // The core (9.3) leaves a destination "free" when its connection was kept
          // from the last run and its source is met for the first time in this one,
          // though it is fed : its live sources say it.
          if (d.state === 'free' && d.live > 0 && !this.halted) {
            d.state = 'bound'
            d.origin = 'none'
          } else if (d.state === 'free' && d.origin === 'none' && d.connections > 0 && this.dests.get(e.path)?.state === 'bound') d.origin = 'lost'
          this.dests.set(e.path, d)
          this.host.onDest(e.path, d)
          break
        }
        case 'locate':
          this.host.onLocate(e.path, e.on)
          break
        case 'halt':
          this.halted = e.on
          this.host.onHalt(e.on)
          break
        case 'scene':
          this.host.onScene(SCENE_OPS[e.op] ?? 'status', e.slot, SCENE_STATES[e.state] ?? 'none', e.skipped)
          this.worldStale = true
          break
        case 'peer':
          this.host.log(`${e.label} ${e.joined ? 'joined' : 'left'}`)
          this.worldStale = true
          break
        case 'topology':
          this.worldStale = true
          break
        case 'log':
          this.host.log(e.text)
          break
        case 'failed':
          if (this.running) {
            this.running = false
            this.host.onStopped(e.text)
          }
          break
      }
    }
    flush()
  }

  private cameIn(path: string, value: DfValue, now: number): void {
    this.last.set(path, value)
    this.inAt.set(path, now)
    this.inCount.set(path, (this.inCount.get(path) ?? 0) + 1)
    this.rx++
  }

  // ── the world ───────────────────────────────────────────────────────────

  /** The raw snapshot, for the visualizer page. */
  worldJson(): Promise<string | null> {
    return this.native.call<string>('world')
  }

  /** Read the world now (after everything asked so far). */
  async world(): Promise<World | null> {
    const json = await this.native.call<string>('world')
    if (!json) return null
    let j: { nodes?: JNode[]; incompatible?: Array<Record<string, unknown>> }
    try {
      j = JSON.parse(json)
    } catch {
      return null
    }
    this.worldAt = Date.now()
    const now = Date.now()
    const nodes: DfNodeView[] = []
    let mine: DfConn[] = []
    for (const n of j.nodes ?? []) {
      if (!n || typeof n.sku !== 'string') continue
      const subs: Record<string, DfSub[]> = {}
      for (const c of n.connections ?? []) (subs[c.dest] ??= []).push({ sku: c.sku, path: c.source })
      if (n.online) this.offlineAt.delete(n.sku)
      else if (!this.offlineAt.has(n.sku)) this.offlineAt.set(n.sku, now)
      if (n.is_local) {
        this.address = n.address ?? this.address
        mine = (n.connections ?? []).map((c) => ({ id: c.id, dest: c.dest, sku: c.sku, source: c.source, axes: c.links?.find((l) => l.dest === '')?.axes }))
      }
      const view: DfNodeView = {
        sku: n.sku, label: n.label, product: n.product ?? '', online: !!n.online, local: !!n.is_local, connected: !!n.address, address: n.address ?? '',
        lastSeenMs: n.online ? now : this.offlineAt.get(n.sku)!, params: flatten(n.params ?? { name: '', kind: 'group' }), subs
      }
      if (view.local) nodes.unshift(view)
      else nodes.push(view)
    }
    this.nodes = nodes
    this.mine = mine
    this.refused = (j.incompatible ?? []).map((x) => ({
      sku: String(x.sku ?? ''), label: String(x.label ?? ''), product: String(x.product ?? ''), address: String(x.address ?? ''),
      core: String(x.core_ver ?? (x.core_major ? `${x.core_major}.x` : x.proto ? `protocol ${x.proto}` : 'an older core'))
    }))
    for (const p of [...this.dests.keys()]) if (!this.byPath.has(p)) this.dests.delete(p)
    return { nodes, mine, refused: this.refused }
  }

  private async refresh(): Promise<void> {
    const now = Date.now()
    if (!this.running || this.worldBusy || !this.worldStale || now - this.worldAt < 250) return
    this.worldBusy = true
    this.worldStale = false
    try {
      const w = await this.world()
      if (w && this.running) {
        this.host.onWorld(w)
        this.host.onChange()
      }
    } finally {
      this.worldBusy = false
    }
  }
  /** Read the world again soon. */
  touch(): void {
    this.worldStale = true
  }

  private async refreshState(): Promise<void> {
    if (!this.running) return
    const [st, own] = await Promise.all([
      this.native.call<{ discovery: string; halted: boolean; presentation: boolean; universes: string[] }>('state'),
      this.native.call<typeof this.own>('own', { s: [...this.byPath.keys()] })
    ])
    if (!this.running) return
    if (st) {
      const was = `${this.discovery}|${this.halted}|${this.presentation}|${this.universes.join()}`
      this.discovery = st.discovery
      this.halted = st.halted
      this.presentation = st.presentation
      this.universes = st.universes
      if (was !== `${this.discovery}|${this.halted}|${this.presentation}|${this.universes.join()}`) this.host.onChange()
    }
    if (own) {
      this.own = own
      const l: Record<string, string[]> = {}
      for (const [p, x] of Object.entries(own)) if (x.to?.length) l[p] = x.to.map(([sku, node, path]) => `${node || sku.slice(0, 8)}/${path}`)
      if (JSON.stringify(l) !== JSON.stringify(this.listeners)) {
        this.listeners = l
        this.host.onChange()
      }
    }
  }

  private rates(): void {
    this.rxPerSec = this.rx
    this.txPerSec = this.tx
    this.rx = this.tx = 0
    this.inRate = this.inCount
    this.inCount = new Map()
    for (const w of this.watchVal.values()) {
      w.rate = w.count
      w.count = 0
    }
    if (this.refused.length) this.worldStale = true // (a refused node gone is said by no event)
  }

  // ── what we give ────────────────────────────────────────────────────────

  private valuesFor(params: Iterable<DfParam>, values: Map<string, DfValue>): Array<[string, DfValue]> {
    const out: Array<[string, DfValue]> = []
    for (const p of params) {
      if (p.type === 'trigger') continue
      const v = values.get(p.path) ?? (p.type === 'bool' ? p.init >= 0.5 : p.type === 'array' ? new Array<number>(p.size ?? 1).fill(p.init) : p.init)
      out.push([p.path, p.type === 'bool' ? !!v && v !== 0 : v])
    }
    return out
  }

  setValues(values: Record<string, DfValue>): void {
    if (!this.running) return
    const sets: Array<[string, DfValue]> = []
    for (const [path, v] of Object.entries(values)) {
      const p = this.byPath.get(path)
      if (!p || p.type === 'trigger') continue
      sets.push([path, p.type === 'bool' ? (typeof v === 'number' ? v >= 0.5 : !!v) : v])
      if (this.listeners[path]) this.tx += this.listeners[path].length
    }
    if (sets.length) this.native.post('set', { sets })
  }

  /** A new tree. A path it no longer has is removed from the node (said to every peer
   *  at once, so none keeps a ghost of it); a new one starts at its value here. */
  async setParams(params: DfParam[], values: Map<string, DfValue>): Promise<boolean> {
    const had = this.byPath
    this.cfg = { ...this.cfg, params }
    this.setDeclared(params)
    if (!this.running) return false
    const fresh = [...this.byPath.values()].filter((p) => !had.has(p.path) || had.get(p.path)!.type !== p.type)
    for (const p of [...this.last.keys()]) if (!this.byPath.has(p)) this.last.delete(p)
    this.native.post('triggers', { s: this.triggers() })
    const ok = this.native.call<boolean | string>('tree', { s: [dfTreeJson(params)], sets: this.valuesFor(fresh, values) })
    this.native.post('watch', { s: this.watchable() })
    const r = await ok
    if (r !== true) this.host.log(`the tree was refused : ${r}`)
    this.touch()
    return r === true
  }

  // ── connections ─────────────────────────────────────────────────────────

  async connect(destSku: string, dest: string, srcSku: string, src: string): Promise<boolean> {
    const ok = !!(await this.native.call('connect', { s: [destSku, dest, srcSku, src] }))
    this.touch()
    return ok
  }
  connectPick(destSku: string, dest: string, srcSku: string, src: string, by: 'id' | 'rank', value: number): Promise<boolean> {
    return this.native.call('connectPick', { s: [destSku, dest, srcSku, src], n: [by === 'id' ? 1 : 2, value] }).then((r) => !!r)
  }
  async disconnect(destSku: string, dest: string, srcSku: string, src: string): Promise<boolean> {
    const ok = !!(await this.native.call('disconnect', { s: [destSku, dest, srcSku, src] }))
    this.touch()
    return ok
  }
  async transform(dest: string, srcSku: string, src: string, axes: DfAxis[]): Promise<boolean> {
    const ok = !!(await this.native.call('transform', { s: [dest, srcSku, src], axes }))
    this.touch()
    return ok
  }
  /** Our wires into triggers whose source plays them the other way up. */
  setTriggerInverts(keys: string[]): void {
    this.native.post('gateInvert', { s: keys })
  }
  forget(sku: string): void {
    void this.native.call('forget', { s: [sku] })
    this.touch()
  }
  forgetOffline(mesh: boolean): void {
    void this.native.call('forgetOffline', { n: [mesh ? 1 : 0] })
    this.touch()
  }

  // ── the mesh as a whole ─────────────────────────────────────────────────

  scene(op: 'recall' | 'store', slot: number): void {
    void this.native.call('scene', { s: [op], n: [slot] })
  }
  setPresentation(on: boolean): void {
    this.native.post('presentation', { n: [on ? 1 : 0] })
  }
  locate(sku: string, path: string, ms: number): Promise<boolean> {
    return this.native.call('locate', { s: [sku, path], n: [ms] }).then((r) => !!r)
  }
  identify(): void {
    this.native.post('identify')
  }
  halt(on: boolean): void {
    this.native.post('halt', { n: [on ? 1 : 0] })
  }
  setRemote(sku: string, path: string, how: string, value: DfValue | null): Promise<boolean> {
    return this.native.call('setRemote', { s: [sku, path, how], value }).then((r) => !!r)
  }
  /** How the node's thread keeps its pace (tests). */
  stats(): Promise<Record<string, number> | null> {
    return this.native.call<Record<string, number>>('stats')
  }

  // ── other nodes' values, seen without a wire ────────────────────────────

  private monitor(): void {
    const on = this.pageOpen || this.watches.length > 0 || !!this.learning
    if (on === this.monitoring) return
    this.monitoring = on
    this.native.post('monitor', { n: [on ? 1 : 0] })
  }
  setMonitoring(page: boolean): void {
    this.pageOpen = page
    this.monitor()
  }
  setWatches(list: DfSub[]): void {
    this.watches = list
    const keep = new Set(list.map((w) => `${w.sku}\n${w.path}`))
    for (const k of [...this.watchVal.keys()]) if (!keep.has(k)) this.watchVal.delete(k)
    this.monitor()
  }
  learnStart(): void {
    this.learning = new Map()
    this.learnUntil = Date.now() + 25_000
    this.monitor()
  }
  learnStop(): void {
    this.learning = null
    this.monitor()
  }
  learnPeek(): { sku: string; path: string; label: string; node: string; span: number } | null {
    if (!this.learning) return null
    this.learnUntil = Date.now() + 25_000
    let best: { sku: string; path: string; label: string; node: string; span: number } | null = null
    for (const [k, r] of this.learning) {
      const span = r.hi - r.lo
      if (span < 0.25 || (best && span <= best.span)) continue
      const i = k.indexOf('\n')
      best = { sku: k.slice(0, i), path: k.slice(i + 1), label: r.label, node: r.node, span }
    }
    return best
  }

  private async sampleRemote(): Promise<void> {
    if (!this.running) return
    // (a learn whose window is gone, a reload, ends by itself)
    if (this.learning && Date.now() > this.learnUntil) this.learnStop()
    const learning = this.learning
    const others = this.nodes.filter((n) => !n.local && n.online)
    const skus = learning ? others.map((n) => n.sku) : [...new Set(this.watches.map((w) => w.sku))]
    if (!skus.length) return
    const r = await this.native.call<Record<string, Array<[string, DfValue | null, number, number, number, number]>>>('params', { s: skus })
    if (!r || !this.running) return
    const now = Date.now()
    for (const w of this.watches) {
      const p = r[w.sku]?.find((x) => x[0] === w.path)
      if (!p) continue
      const k = `${w.sku}\n${w.path}`
      const had = this.watchVal.get(k)
      const changed = !had || JSON.stringify(had.value) !== JSON.stringify(p[1])
      if (!had) this.watchVal.set(k, { value: p[1], epoch: p[5], at: p[1] === null ? 0 : now, count: 1, rate: 0 })
      else if (changed) {
        had.value = p[1]
        had.at = now
        had.count++
      }
    }
    if (!learning || learning !== this.learning) return
    for (const n of others) {
      for (const [path, v, t, min, max] of r[n.sku] ?? []) {
        const type = TYPES[t]
        let x: number | null = null
        if (type === 'bool') x = v ? 1 : 0
        else if (type === 'number' && typeof v === 'number') x = max !== min ? (v - min) / (max - min) : v
        else if ((type === 'v2' || type === 'v3' || type === 'v4') && Array.isArray(v)) x = v[0]
        else if (type === 'colour' && Array.isArray(v)) x = v[0] / 255
        if (x === null || !Number.isFinite(x)) continue
        const k = `${n.sku}\n${path}`
        const had = learning.get(k)
        if (!had) learning.set(k, { lo: x, hi: x, node: n.label, label: n.params.find((p) => p.path === path)?.label ?? path })
        else {
          had.lo = Math.min(had.lo, x)
          had.hi = Math.max(had.hi, x)
        }
      }
    }
  }

  // ── the data view ───────────────────────────────────────────────────────

  private nameOf(sku: string): string {
    return this.nodes.find((n) => n.sku === sku)?.label ?? sku.slice(0, 8)
  }

  async io(): Promise<DfIo> {
    const to = Object.keys(this.listeners)
    if (to.length && this.running) {
      const r = await this.native.call<typeof this.own>('own', { s: to })
      if (r) Object.assign(this.own, r)
    }
    const now = Date.now()
    const ins: DfIoRow[] = []
    const by = new Map<string, DfConn[]>()
    for (const c of this.mine) {
      if (!by.has(c.dest)) by.set(c.dest, [])
      by.get(c.dest)!.push(c)
    }
    for (const [dest, list] of by) {
      const p = this.byPath.get(dest)
      if (!p) continue
      const at = this.inAt.get(dest)
      ins.push({
        path: dest, label: p.label || dest, value: this.last.get(dest) ?? null, peers: list.map((c) => `${this.nameOf(c.sku)}/${c.source}`),
        ageMs: at ? now - at : null, perSec: this.inRate.get(dest) ?? 0, live: (this.dests.get(dest)?.state ?? 'free') === 'bound'
      })
    }
    const outs: DfIoRow[] = []
    for (const [path, x] of Object.entries(this.own)) {
      for (const [sku, node, dest] of x.to ?? []) {
        outs.push({
          path, label: this.byPath.get(path)?.label ?? path, value: x.value ?? null, peers: [`${node || this.nameOf(sku)}/${dest}`], ageMs: null, perSec: 0,
          live: this.nodes.find((n) => n.sku === sku)?.online ?? false
        })
      }
    }
    const watched: DfIoRow[] = this.watches.map((w) => {
      const v = this.watchVal.get(`${w.sku}\n${w.path}`)
      const n = this.nodes.find((x) => x.sku === w.sku)
      return {
        path: w.path, label: n?.params.find((p) => p.path === w.path)?.label ?? w.path, value: v?.value ?? null, peers: [`${this.nameOf(w.sku)}/${w.path}`],
        ageMs: v?.at ? now - v.at : null, perSec: v?.rate ?? 0, live: !!n?.online, sku: w.sku
      }
    })
    return { sku: this.cfg.sku, label: this.cfg.label, in: ins, out: outs, watched, rxPerSec: this.rxPerSec, txPerSec: this.txPerSec }
  }
}
