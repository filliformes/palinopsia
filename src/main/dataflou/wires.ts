// The wires into Palinopsia : where each one lives, and how it plays.
//
// The core keeps this node's connections (its storage folder, one per universe) : that
// is this computer's list, every session. The session's wires (its file's
// mappings.dataflou, the renderer's to keep) are connections too while the session is
// open, made and undone here; so are the modulators' mesh inputs. A file beside the
// core's storage says which of the core's connections are NOT this computer's, so
// they never outlive their session (a crash included), and keeps what the core does
// not : the computer's wires set aside while the session wires their destination or
// their source, and each wire's smoothing and on-loss.
//
// A wire made from the mesh (another node, the visualizer, a scene) is this computer's;
// one of the session's unwired or reshaped from anywhere leaves or changes in the
// session too (the renderer hears it).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { DataflouNode, DfConn } from './node'
import {
  DF_SELF, DF_SESSION_WIRES_MAX, appOpt, axesToOpt, cleanSessionWires, cleanWireOpt, dfInputPath, dfWireKey, linkOpt, optToAxes,
  type DfAxis, type DfListen, type DfSessionWire, type DfSub, type DfWireOpt
} from '@shared/dataflou'
import type { MappingScope } from '@shared/types'

/** A wire set aside (its transform as it was, when words cannot say it). */
interface Aside extends DfSub {
  axes?: DfAxis[]
}
interface WiresFile {
  v: 1
  /** Connections of the core's that are the open session's (dfWireKey). */
  session: string[]
  /** ... and a modulator's mesh input's. */
  inputs: string[]
  /** This computer's wires set aside : destination → sources. */
  silenced: Record<string, Aside[]>
  /** A wire's smoothing and on-loss. */
  opts: Record<string, DfWireOpt>
  /** A range or invert to give a wire as soon as its destination is there. */
  pending: Record<string, DfWireOpt>
}

export interface WiresHost {
  log(level: 'info' | 'warn', msg: string): void
  /** The session's list changed here (unwired, reshaped or moved on the mesh). */
  sessionChanged(list: DfSessionWire[]): void
  /** The wires, or how they play, changed. */
  changed(): void
  /** The tree, with what the session's wires need on it (before they are made). */
  refreshTree(): void
}

const safe = (universe: string): string => universe.replace(/[^\w.-]+/g, '_') || 'default'
const keyOf = (c: { dest: string; sku: string; source: string }): string => dfWireKey(c.dest, c.sku, c.source)
/** The same options, a rounding aside. */
function sameOpt(a: DfWireOpt | null | undefined, b: DfWireOpt | null | undefined): boolean {
  const x: DfWireOpt = cleanWireOpt(a) ?? {}, y: DfWireOpt = cleanWireOpt(b) ?? {}
  const near = (p: number | undefined, q: number | undefined, d: number): boolean => Math.abs((p ?? d) - (q ?? d)) < 1e-3
  return near(x.lo, y.lo, 0) && near(x.hi, y.hi, 1) && !!x.invert === !!y.invert && near(x.slewMs, y.slewMs, 0) && (x.onLoss ?? 'hold') === (y.onLoss ?? 'hold') && near(x.returnSec, y.returnSec, 2)
}
const parse = (k: string): { dest: string; sku: string; path: string } => {
  const [dest, sku, path] = k.split('\n')
  return { dest, sku, path }
}

/** The node's own folder in this universe (the core's storage). */
export function nodeDir(base: string, universe: string): string {
  const d = join(base, `node-${safe(universe)}`)
  mkdirSync(d, { recursive: true })
  return d
}
const wiresFile = (base: string, universe: string): string => join(base, `wires-${safe(universe)}.json`)

// ── from the old files (up to v1.3.5 : bindings-<universe>.json and
// scenes-<universe>.json), once ─────────────────────────────────────────────

/** A list of connections as the core still reads it (its storage format from before
 *  9.1, kept for exactly this : docs of node_storage.cpp) : count, then for each the
 *  destination, the source's sku and the source's path, each with its length first. */
function oldRecord(list: Array<{ dest: string; sku: string; path: string }>): Buffer {
  const parts: Buffer[] = []
  let n = 0
  for (const w of list) {
    const f = [w.dest, w.sku, w.path].map((s) => Buffer.from(s, 'utf8'))
    if (f.some((b) => b.length === 0 || b.length > 255) || f[1].length > 36 || n >= 60_000) continue
    n++
    for (const b of f) parts.push(Buffer.from([b.length]), b)
  }
  const head = Buffer.alloc(2)
  head.writeUInt16LE(n)
  return Buffer.concat([head, ...parts])
}

/** This computer's saved wires and mesh scenes of v1.3.5 and before, given to the core
 *  once per universe, by name and sku as they were (the old files stay beside, renamed
 *  .v135). Wires into what is not published come too : they wait, as they did. */
export function migrateOldWires(base: string, universe: string, log: WiresHost['log']): void {
  const u = safe(universe)
  const bindings = join(base, `bindings-${u}.json`)
  const scenes = join(base, `scenes-${u}.json`)
  if (!existsSync(bindings) && !existsSync(scenes)) return
  const dir = nodeDir(base, universe)
  const file = readFile(base, universe)
  const keep = (dest: string, s: DfSub): void => {
    const k = dfWireKey(dest, s.sku, s.path)
    const a = appOpt(s.opt), l = linkOpt(s.opt)
    if (a) file.opts[k] = a
    if (l) file.pending[k] = l
  }
  const good = (s: unknown): s is DfSub => !!s && typeof (s as DfSub).sku === 'string' && typeof (s as DfSub).path === 'string'
  try {
    if (existsSync(bindings)) {
      // (a node that already has its own list keeps it : the old one only steps aside)
      if (!existsSync(join(dir, 'connections'))) {
        const j = JSON.parse(readFileSync(bindings, 'utf8')) as Record<string, DfSub[]>
        const list: Array<{ dest: string; sku: string; path: string }> = []
        for (const [dest, subs] of Object.entries(j)) {
          if (!Array.isArray(subs)) continue
          for (const s of subs) {
            if (!good(s)) continue
            list.push({ dest, sku: s.sku, path: s.path })
            keep(dest, s)
          }
        }
        writeFileSync(join(dir, 'subscriptions'), oldRecord(list))
        log('info', `[dataflou] ${list.length} saved wires of universe ${universe} given to the new node`)
      }
      renameSync(bindings, `${bindings}.v135`)
    }
    if (existsSync(scenes)) {
      const j = JSON.parse(readFileSync(scenes, 'utf8')) as { slots?: Record<string, Array<[string, string, string, DfWireOpt?]>> }
      for (const [slot, links] of Object.entries(j.slots ?? {})) {
        const n = Number(slot)
        if (!Number.isInteger(n) || n < 1 || n > 16 || !Array.isArray(links) || existsSync(join(dir, `scene_${n}`))) continue
        const list = links.filter((l) => Array.isArray(l) && l.slice(0, 3).every((x) => typeof x === 'string'))
        writeFileSync(join(dir, `scene_${n}`), oldRecord(list.map((l) => ({ dest: l[0], sku: l[1], path: l[2] }))))
        for (const l of list) if (l[3]) keep(l[0], { sku: l[1], path: l[2], opt: l[3] })
      }
      renameSync(scenes, `${scenes}.v135`)
    }
    writeFile(base, universe, file)
  } catch (e) {
    log('warn', `[dataflou] the saved wires of v1.3.5 could not be taken : ${(e as Error).message}`)
  }
}

function readFile(base: string, universe: string): WiresFile {
  const empty: WiresFile = { v: 1, session: [], inputs: [], silenced: {}, opts: {}, pending: {} }
  try {
    const j = JSON.parse(readFileSync(wiresFile(base, universe), 'utf8')) as Partial<WiresFile>
    const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [])
    const opts = (x: unknown): Record<string, DfWireOpt> => {
      const out: Record<string, DfWireOpt> = {}
      if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) {
        const o = cleanWireOpt(v)
        if (o) out[k] = o
      }
      return out
    }
    const silenced: Record<string, Aside[]> = {}
    if (j.silenced && typeof j.silenced === 'object') for (const [d, list] of Object.entries(j.silenced)) {
      if (!Array.isArray(list)) continue
      silenced[d] = list.filter((s) => s && typeof s.sku === 'string' && typeof s.path === 'string').map((s) => ({ sku: s.sku, path: s.path, ...(cleanWireOpt(s.opt) ? { opt: cleanWireOpt(s.opt)! } : {}), ...(Array.isArray(s.axes) ? { axes: s.axes } : {}) }))
    }
    return { v: 1, session: strs(j.session), inputs: strs(j.inputs), silenced, opts: opts(j.opts), pending: opts(j.pending) }
  } catch {
    return empty
  }
}

function writeFile(base: string, universe: string, f: WiresFile): void {
  const to = wiresFile(base, universe)
  writeFileSync(`${to}.part`, JSON.stringify(f, null, 1))
  renameSync(`${to}.part`, to)
}

export class Wires {
  private file: WiresFile
  private universe = ''
  private node: DataflouNode | null = null
  private session: DfSessionWire[] = []
  private listens: DfListen[] = []
  private conns: DfConn[] = []
  // a session wire seen on the node : gone later, the mesh undid it
  private seen = new Set<string>()
  private busy = 0
  private queued = false

  constructor(private base: () => string, private me: () => string, private host: WiresHost) {
    this.file = { v: 1, session: [], inputs: [], silenced: {}, opts: {}, pending: {} }
  }

  private own(sku: string): string {
    return sku === DF_SELF ? this.me() : sku
  }
  private sessKey(w: DfSessionWire): string {
    return dfWireKey(w.dest, this.own(w.sku), w.path)
  }
  /** The open session's wires of this universe. */
  sessionHere(): DfSessionWire[] {
    return this.session.filter((w) => w.universe === this.universe)
  }
  sessionAll(): DfSessionWire[] {
    return this.session
  }
  setUniverse(universe: string): void {
    this.universe = universe
  }

  private save(): void {
    try {
      writeFile(this.base(), this.universe, this.file)
    } catch (e) {
      this.host.log('warn', `[dataflou] could not save the wires : ${(e as Error).message}`)
    }
  }

  /** A node of this universe is there, not polling yet. */
  attach(node: DataflouNode, universe: string, conns: DfConn[]): void {
    this.universe = universe
    this.node = node
    this.file = readFile(this.base(), universe)
    this.seen.clear()
    this.conns = conns
    this.apply()
  }
  detach(): void {
    this.node = null
    this.conns = []
    this.seen.clear()
  }

  // ── what a wire is, with how it plays ──
  private optOf(c: DfConn): DfWireOpt | undefined {
    const k = keyOf(c)
    const o: DfWireOpt = { ...axesToOpt(c.axes, this.node?.declared(c.dest)), ...(this.file.pending[k] ?? {}), ...(this.file.opts[k] ?? {}) }
    return Object.keys(o).length ? o : undefined
  }
  /** Our connections for the section : destination → sources, the modulators' inputs aside. */
  subs(): Record<string, DfSub[]> {
    const aux = new Set(this.file.inputs)
    const out: Record<string, DfSub[]> = {}
    for (const c of this.conns) {
      if (aux.has(keyOf(c))) continue
      const opt = this.optOf(c)
      ;(out[c.dest] ??= []).push({ sku: c.sku, path: c.source, ...(opt ? { opt } : {}) })
    }
    return out
  }
  /** Destinations of ours with wires that wait : not on the mesh now. */
  parked(): string[] {
    const out = new Set<string>()
    const aux = new Set(this.file.inputs)
    for (const c of this.conns) if (!aux.has(keyOf(c)) && !this.node?.declared(c.dest)) out.add(c.dest)
    for (const w of this.sessionHere()) if (!this.node?.declared(w.dest)) out.add(w.dest)
    return [...out]
  }
  sessionKeys(): string[] {
    return this.sessionHere().map((w) => this.sessKey(w))
  }
  silenced(): Array<{ dest: string; sku: string; path: string }> {
    return Object.entries(this.file.silenced).flatMap(([dest, list]) => list.map((s) => ({ dest, sku: s.sku, path: s.path })))
  }
  inputOf(path: string): DfListen | undefined {
    return this.listens.find((l) => dfInputPath(l.slot) === path)
  }

  // ── changes ──
  setSession(list: DfSessionWire[]): boolean {
    if (JSON.stringify(list) === JSON.stringify(this.session)) return false
    this.session = list
    this.host.refreshTree()
    this.apply()
    return true
  }
  setListens(list: DfListen[]): void {
    if (JSON.stringify(list) === JSON.stringify(this.listens)) return
    this.listens = list
    this.host.refreshTree()
    this.apply()
  }
  /** The tree changed : a wire may have its destination now. */
  treeChanged(): void {
    if (!this.queued) {
      this.queued = true
      setImmediate(() => {
        this.queued = false
        this.apply()
      })
    }
  }

  /** Make the node's connections what the session, the modulators and this computer say. */
  private apply(): void {
    const node = this.node
    if (!node) return
    const me = this.me()
    const f = this.file
    const have = new Map(this.conns.map((c) => [keyOf(c), c]))
    const want = new Map(this.sessionHere().map((w) => [this.sessKey(w), w]))
    const inputs = new Map(this.listens.map((l) => [dfWireKey(dfInputPath(l.slot), l.sku, l.path), l]))
    const dests = new Set([...want.values()].map((w) => w.dest))
    const srcs = new Set([...want.values()].map((w) => `${this.own(w.sku)}\n${w.path}`))
    const clashes = (c: { dest: string; sku: string; path: string }): boolean => dests.has(c.dest) || srcs.has(`${c.sku}\n${c.path}`)
    const asked: Array<Promise<unknown>> = []
    const undo = (c: { dest: string; sku: string; path: string }): void => {
      asked.push(node.disconnect(me, c.dest, c.sku, c.path))
      // (our list follows what is asked at once : asked again before it is done, a
      // connection on its way out is not taken for this computer's)
      const k = dfWireKey(c.dest, c.sku, c.path)
      this.conns = this.conns.filter((x) => keyOf(x) !== k)
    }
    const make = (c: { dest: string; sku: string; path: string }, opt: DfWireOpt | null | undefined, axes?: DfAxis[]): void => {
      asked.push(node.connect(me, c.dest, c.sku, c.path))
      this.conns = [...this.conns, { id: '', dest: c.dest, sku: c.sku, source: c.path }]
      this.shape(c, opt, asked, axes)
    }
    const changed = { n: 0 }

    // what was the session's, or a modulator's, and is no more
    for (const k of [...f.session]) {
      if (want.has(k)) continue
      f.session = f.session.filter((x) => x !== k)
      this.seen.delete(k)
      changed.n++
      const c = parse(k)
      const mine = f.silenced[c.dest]?.find((s) => s.sku === c.sku && s.path === c.path)
      if (have.has(k) && !mine) {
        undo(c)
        delete f.opts[k]
        have.delete(k)
      } else if (mine && !clashes(c)) {
        // the same wire was this computer's too : it stays, as it was shaped there
        this.unsilence(c)
        this.shape(c, mine.opt, asked, mine.axes)
      }
    }
    for (const k of [...f.inputs]) {
      if (inputs.has(k)) continue
      f.inputs = f.inputs.filter((x) => x !== k)
      changed.n++
      if (have.has(k)) undo(parse(k))
      have.delete(k)
    }
    // this computer's on an input the session wires : set aside, kept
    for (const [k, c] of [...have]) {
      const w = { dest: c.dest, sku: c.sku, path: c.source }
      if (f.session.includes(k) || f.inputs.includes(k) || inputs.has(k)) continue
      if (!want.has(k) && !clashes(w)) continue
      const opt = this.optOf(c)
      const clean = cleanWireOpt(opt)
      const list = (f.silenced[c.dest] ??= [])
      if (!list.some((s) => s.sku === c.sku && s.path === c.source)) list.push({ sku: c.sku, path: c.source, ...(clean ? { opt: clean } : {}), ...(opt?.mesh && c.axes ? { axes: c.axes } : {}) })
      changed.n++
      if (want.has(k)) continue // (the very same wire : it plays on as the session's)
      undo(w)
      have.delete(k)
    }
    // set aside and free again
    for (const [dest, list] of Object.entries(f.silenced)) {
      for (const s of [...list]) {
        const c = { dest, sku: s.sku, path: s.path }
        const k = dfWireKey(dest, s.sku, s.path)
        if (want.has(k) || clashes(c)) continue
        // (what is not on the tree now is made when it is : it stays set aside)
        if (!node.declared(dest) && !have.has(k)) continue
        this.unsilence(c)
        changed.n++
        if (!have.has(k)) make(c, s.opt, s.axes)
        else this.shape(c, s.opt, asked, s.axes)
      }
    }
    // the session's
    for (const [k, w] of want) {
      const c = { dest: w.dest, sku: this.own(w.sku), path: w.path }
      const known = f.session.includes(k)
      if (!known) {
        f.session.push(k)
        changed.n++
      }
      const conn = have.get(k)
      if (conn) {
        // (the session's own shape : another session's, or this computer's, was on it)
        if (!known || !sameOpt(this.optOf(conn), w.opt)) this.shape(c, w.opt, asked)
        continue
      }
      if (!node.declared(w.dest) || (w.sku === DF_SELF && !node.declared(w.path))) continue // it waits for its path
      make(c, w.opt)
    }
    // the modulators'
    for (const [k, l] of inputs) {
      if (!f.inputs.includes(k)) {
        f.inputs.push(k)
        changed.n++
      }
      const p = dfInputPath(l.slot)
      if (!have.has(k) && node.declared(p)) make({ dest: p, sku: l.sku, path: l.path }, null)
    }
    // ranges and inverts that waited for their destination
    for (const [k, o] of Object.entries(f.pending)) {
      const c = parse(k)
      if (!have.has(k) || !node.declared(c.dest)) continue
      delete f.pending[k]
      changed.n++
      this.shape(c, { ...o, ...(f.opts[k] ?? {}) }, asked)
    }
    if (changed.n) this.save()
    this.inverts()
    if (!asked.length) {
      this.observe()
      return
    }
    // the world as it is once all of it is done; what is read before is not judged
    this.busy++
    void Promise.all(asked)
      .then(() => node.world())
      .then((w) => {
        this.busy--
        if (w && this.node === node) {
          this.conns = w.mine
          this.observe()
        }
        this.host.changed()
      })
  }

  private unsilence(c: { dest: string; sku: string; path: string }): void {
    const list = this.file.silenced[c.dest]?.filter((s) => !(s.sku === c.sku && s.path === c.path)) ?? []
    if (list.length) this.file.silenced[c.dest] = list
    else delete this.file.silenced[c.dest]
  }

  /** How a wire plays : its transform to the core, the rest kept here. */
  private shape(c: { dest: string; sku: string; path: string }, opt: DfWireOpt | null | undefined, asked: Array<Promise<unknown>>, axes?: DfAxis[]): void {
    const k = dfWireKey(c.dest, c.sku, c.path)
    const a = appOpt(opt)
    if (a) this.file.opts[k] = a
    else delete this.file.opts[k]
    const d = this.node?.declared(c.dest)
    if (!d || opt?.mesh) return // (shaped on the mesh : its curve stays)
    if (d.type === 'trigger') {
      // a trigger takes no transform : the other way up is its own gate's
      if (opt?.invert) this.file.opts[k] = { ...(this.file.opts[k] ?? {}), invert: true }
      return
    }
    const to = axes ?? optToAxes(opt, d)
    asked.push(this.node!.transform(c.dest, c.sku, c.path, to))
    this.conns = this.conns.map((x) => (keyOf(x) === k ? { ...x, axes: to } : x))
  }
  private inverts(): void {
    this.node?.setTriggerInverts(Object.entries(this.file.opts).filter(([k, o]) => o.invert && this.node?.declared(parse(k).dest)?.type === 'trigger').map(([k]) => k))
  }

  /** The world was read : what became of the wires (ours, the mesh's, a scene's). */
  world(conns: DfConn[]): void {
    if (this.busy) return // (read before what is being asked : judged after it)
    this.conns = conns
    this.observe()
  }

  private observe(): void {
    const have = new Map(this.conns.map((c) => [keyOf(c), c]))
    const f = this.file
    let sessionMoved = false
    let again = false
    const next: DfSessionWire[] = []
    for (const w of this.session) {
      const k = this.sessKey(w)
      if (w.universe !== this.universe || !this.node) {
        next.push(w)
        continue
      }
      const c = have.get(k)
      if (!c) {
        // seen here, gone now : undone on the mesh (unwired, a scene)
        if (this.seen.has(k)) {
          this.seen.delete(k)
          f.session = f.session.filter((x) => x !== k)
          sessionMoved = true
        } else next.push(w)
        continue
      }
      this.seen.add(k)
      const opt = cleanWireOpt(this.optOf(c))
      if (!sameOpt(opt, w.opt)) {
        sessionMoved = true
        next.push({ universe: w.universe, dest: w.dest, sku: w.sku, path: w.path, ...(opt ? { opt } : {}) })
      } else next.push(w)
    }
    if (sessionMoved) {
      this.session = next
      this.host.sessionChanged(next)
      again = true
    }
    // a computer wire on the session's input (made from the mesh) : set aside; a
    // modulator's input a scene undid : made again
    const want = new Set(this.sessionKeys())
    const dests = new Set(this.sessionHere().map((w) => w.dest))
    const srcs = new Set(this.sessionHere().map((w) => `${this.own(w.sku)}\n${w.path}`))
    for (const [k, c] of have) if (!want.has(k) && !f.inputs.includes(k) && (dests.has(c.dest) || srcs.has(`${c.sku}\n${c.source}`))) again = true
    for (const k of f.inputs) if (!have.has(k) && this.node?.declared(parse(k).dest) && !this.retried.has(k)) {
      this.retried.add(k)
      again = true
    } else if (have.has(k)) this.retried.delete(k)
    for (const k of Object.keys(f.pending)) if (have.has(k) && this.node?.declared(parse(k).dest)) again = true
    // the smoothing of a wire gone for good goes too
    let dropped = false
    const kept = new Set([...have.keys(), ...want, ...this.silenced().map((s) => dfWireKey(s.dest, s.sku, s.path))])
    const gone = Object.keys(f.opts).filter((k) => !kept.has(k))
    if (gone.length && !this.hasScenes()) {
      for (const k of gone) delete f.opts[k]
      dropped = true
    }
    if (dropped || sessionMoved) this.save()
    // (what a wire gone from the session needed published goes with it)
    if (sessionMoved) this.host.refreshTree()
    if (again) this.treeChanged()
  }
  private retried = new Set<string>()
  // (a wire a mesh scene may bring back keeps how it plays)
  private hasScenes(): boolean {
    const dir = nodeDir(this.base(), this.universe)
    for (let n = 1; n <= 16; n++) if (existsSync(join(dir, `scene_${n}`))) return true
    return false
  }

  /** A new wire into Palinopsia saved with the session. */
  addSession(dest: string, srcSku: string, srcPath: string): boolean {
    const me = this.me()
    const sku = srcSku === me ? DF_SELF : srcSku
    if (this.sessionHere().some((w) => w.dest === dest && this.own(w.sku) === srcSku && w.path === srcPath)) return true
    // the same wire already on this computer : moved into the session, not doubled
    const k = dfWireKey(dest, srcSku, srcPath)
    if (this.conns.some((c) => keyOf(c) === k)) return this.move(dest, srcSku, srcPath, 'session')
    if (this.session.length >= DF_SESSION_WIRES_MAX) return false
    this.session = cleanSessionWires([...this.session, { universe: this.universe, dest, sku, path: srcPath }])
    this.host.sessionChanged(this.session)
    this.host.refreshTree()
    this.apply()
    return true
  }

  /** One wire moved : to the session (off this computer), to this computer (off the
   *  session), or (null) a set-aside wire of this computer removed. */
  move(dest: string, srcSku: string, srcPath: string, to: MappingScope | null): boolean {
    const me = this.me()
    const k = dfWireKey(dest, srcSku, srcPath)
    const c = { dest, sku: srcSku, path: srcPath }
    const conn = this.conns.find((x) => keyOf(x) === k)
    const aside = this.file.silenced[dest]?.find((s) => s.sku === srcSku && s.path === srcPath)
    const inSess = this.sessionHere().find((w) => this.sessKey(w) === k)
    if (to === 'session') {
      if (inSess) return true
      if ((!conn && !aside) || this.session.length >= DF_SESSION_WIRES_MAX) return false
      const opt = cleanWireOpt(conn ? this.optOf(conn) : aside?.opt)
      this.session = cleanSessionWires([...this.session, { universe: this.universe, dest, sku: srcSku === me ? DF_SELF : srcSku, path: srcPath, ...(opt ? { opt } : {}) }])
      this.unsilence(c)
      if (conn && !this.file.session.includes(k)) this.file.session.push(k)
    } else if (to === 'computer') {
      if (!inSess) return !!conn || !!aside
      this.session = this.session.filter((w) => !(w.universe === this.universe && this.sessKey(w) === k))
      this.file.session = this.file.session.filter((x) => x !== k)
      this.seen.delete(k)
      this.unsilence(c)
      if (!conn) {
        const opt = cleanWireOpt(inSess.opt)
        ;(this.file.silenced[dest] ??= []).push({ sku: srcSku, path: srcPath, ...(opt ? { opt } : {}) })
      }
    } else {
      if (!aside) return false
      this.unsilence(c)
    }
    this.save()
    this.host.sessionChanged(this.session)
    this.host.refreshTree()
    this.apply()
    return true
  }

  /** How a wire into Palinopsia plays : its range, invert, smoothing, on loss. */
  async setOpt(dest: string, srcSku: string, srcPath: string, opt: DfWireOpt | null): Promise<boolean> {
    const node = this.node
    const k = dfWireKey(dest, srcSku, srcPath)
    const conn = this.conns.find((c) => keyOf(c) === k)
    if (!node || !conn) return false
    const clean = cleanWireOpt(opt)
    const c = { dest, sku: srcSku, path: srcPath }
    const asked: Array<Promise<unknown>> = []
    // (its smoothing changed only : what the mesh shaped stays)
    const was = this.optOf(conn)
    const keep = !!was?.mesh && !!clean && JSON.stringify(linkOpt(was)) === JSON.stringify(linkOpt(clean))
    delete this.file.pending[k]
    if (!node.declared(dest)) {
      const l = linkOpt(clean), a = appOpt(clean)
      if (l) this.file.pending[k] = l
      if (a) this.file.opts[k] = a
      else delete this.file.opts[k]
    } else this.shape(c, keep ? { ...clean, mesh: true } : clean, asked)
    this.save()
    this.inverts()
    this.busy++
    const done = (await Promise.all(asked)).every((r) => r !== false)
    const w = await node.world()
    this.busy--
    if (w && this.node === node) {
      this.conns = w.mine
      this.observe()
    }
    this.host.changed()
    return done
  }
}
