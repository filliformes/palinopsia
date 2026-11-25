// The dataflou node's life in the main process : the renderer turns it on or off
// (the dataflou section, persisted there like OSC), main keeps the node (native/dataflou
// through addon.ts), its identity (one SKU per install, kept in userData), its wires
// (wires.ts), relays values both ways, and pushes a status for the monitor.
//
// ONE node only : it declares what the dataflou section chose to publish (whole
// groups or single parameters, the Body rule list's actions included).

import { app, type BrowserWindow, ipcMain, powerMonitor } from 'electron'
import { createHash, randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { primaryIPv4 } from './address'
import { dfAddonError, dfAddonVersion, loadDfAddon } from './addon'
import { DataflouNode } from './node'
import { Wires, migrateOldWires, nodeDir } from './wires'
import { openVisualizer, stopVisualizer, visualizerAvailable, visualizerNodeChanged, visualizerSay } from './visualizer'
import {
  DF_DESTS, DF_SELF, DF_SOURCES, cleanPublish, cleanSessionWires, dfGroupOf, dfPublished, inputTree, palinopsiaTree,
  type DfAction, type DfConfig, type DfListen, type DfParam, type DfStatus, type DfSub, type DfValue, type DfWireOpt
} from '@shared/dataflou'
import type { MappingScope } from '@shared/types'
import { log } from '../log'

let node: DataflouNode | null = null
let config: DfConfig | null = null
let lastError: string | null = null
let win: () => BrowserWindow | null = () => null
// what came in for the renderer, in order : values, triggers (times), and how a
// destination stands; flushed once a frame
type In = { path: string; value: DfValue } | { path: string; fire: number } | { path: string; dest: string; live: number }
let inBuffer: In[] = []
// remote values a modulator plays (its mesh input), for the renderer once a frame
let remoteBuffer = new Map<string, { sku: string; path: string; v: number }>()
let statusDirty = false
let lastStatusAt = 0
// The Body rule picker's actions, as the renderer last listed them; how many of
// the published ones the tree carries now.
let actions: DfAction[] = []
let actionsOn = 0
let publishedCount = 0
let watches: DfSub[] = []
let listens: DfListen[] = []
// what Palinopsia's parameters stand at, as the renderer last said
const values = new Map<string, DfValue>()

const dir = (): string => {
  const d = join(app.getPath('userData'), 'dataflou')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

/** Load the addon once. In dev getAppPath() is the project root; packaged builds
 *  unpack it (asarUnpack). */
function addonThere(): boolean {
  const base = app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked')
  const was = dfAddonError()
  const ok = !!loadDfAddon(join(base, 'native', 'dataflou', 'build', 'Release', 'dataflou.node'))
  if (!ok && !was) log('warn', `[dataflou] unavailable : ${dfAddonError()}`)
  return ok
}

/** One SKU per install : how every other node knows this Palinopsia. */
let skuNow = ''
function sku(): string {
  if (skuNow) return skuNow
  const f = join(dir(), 'identity.json')
  try {
    const j = JSON.parse(readFileSync(f, 'utf8')) as { sku?: string }
    if (j.sku && /^[0-9a-f-]{36}$/i.test(j.sku)) return (skuNow = j.sku)
  } catch { /* first run */ }
  const s = randomUUID()
  writeFileSync(f, JSON.stringify({ sku: s }, null, 2))
  return (skuNow = s)
}

/** The SKU the second node (`<name>-session`, gone since v1.3.4) had : made from
 *  ours. A mesh that still remembers it is asked to forget it. */
function oldSessionSku(): string {
  const h = createHash('sha1').update(`${sku()}:session`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** The second node's wires and scene slots (up to v1.3.3) join the one node's old
 *  files, which migrateOldWires then gives to the new node. Done once per universe
 *  (the old files are renamed, never deleted). */
function adoptSessionFiles(universe: string): void {
  const u = universe.replace(/[^\w.-]+/g, '_')
  const read = <T>(f: string): T | null => {
    try {
      return JSON.parse(readFileSync(f, 'utf8')) as T
    } catch {
      return null
    }
  }
  const at = (f: string): string => join(dir(), f)
  const oldSubs = at(`bindings-${u}-session.json`)
  if (existsSync(oldSubs)) {
    try {
      const mine = read<Record<string, DfSub[]>>(at(`bindings-${u}.json`)) ?? {}
      for (const [dest, list] of Object.entries(read<Record<string, DfSub[]>>(oldSubs) ?? {})) {
        if (!Array.isArray(list)) continue
        const into = Array.isArray(mine[dest]) ? mine[dest] : (mine[dest] = [])
        for (const s of list) if (s && !into.some((x) => x.sku === s.sku && x.path === s.path)) into.push(s)
      }
      writeFileSync(at(`bindings-${u}.json`), JSON.stringify(mine, null, 2))
      renameSync(oldSubs, `${oldSubs}.v133`)
    } catch (e) {
      log('warn', `[dataflou] could not take the second node's wires : ${(e as Error).message}`)
    }
  }
  const oldScenes = at(`scenes-${u}-session.json`)
  if (existsSync(oldScenes)) {
    try {
      type S = { slots: Record<string, unknown[]> }
      const mine = read<S>(at(`scenes-${u}.json`)), theirs = read<S>(oldScenes)
      if (mine?.slots && theirs?.slots) {
        for (const [slot, links] of Object.entries(theirs.slots)) if (mine.slots[slot]) mine.slots[slot] = [...mine.slots[slot], ...links]
        writeFileSync(at(`scenes-${u}.json`), JSON.stringify(mine))
      }
      renameSync(oldScenes, `${oldScenes}.v133`)
    } catch (e) {
      log('warn', `[dataflou] could not take the second node's scenes : ${(e as Error).message}`)
    }
  }
}

const wires = new Wires(dir, sku, {
  log,
  sessionChanged: (list) => {
    win()?.webContents.send('dataflou:sessionWires', list)
    statusDirty = true
  },
  changed: () => {
    statusDirty = true
  },
  refreshTree: () => refreshTree('the session changed')
})

let visClients = 0

function status(): DfStatus {
  const elsewhere = new Map<string, number>()
  const here = config?.universe ?? ''
  for (const w of wires.sessionAll()) if (w.universe !== here) elsewhere.set(w.universe, (elsewhere.get(w.universe) ?? 0) + 1)
  const off: DfStatus = {
    available: !dfAddonError(), running: false, error: dfAddonError() || lastError, core: dfAddonVersion()?.core ?? '', sku: '', label: config?.label ?? '', universe: here, address: '', tcpPort: 0,
    nodes: [], dests: {}, listeners: {}, refused: [], universes: [], discovery: 'ok', halted: false, presentation: false, rxPerSec: 0, txPerSec: 0,
    published: 0, actions: 0, parked: [], session: wires.sessionKeys(), silenced: [], sessionElsewhere: [...elsewhere].map(([universe, count]) => ({ universe, count })),
    visualizer: visClients, visualizerAvailable: visualizerAvailable()
  }
  const n = node
  if (!n) return off
  // (our own connections as the wires know them : their options, the modulators' inputs aside)
  const nodes = n.nodes.map((x) => (x.local ? { ...x, subs: wires.subs() } : x))
  return {
    ...off, error: null, running: true, sku: n.sku(), label: config?.label ?? '', address: n.address, tcpPort: n.port, nodes, dests: Object.fromEntries(n.dests),
    listeners: n.listeners, refused: n.refused, universes: n.universes, discovery: n.discovery, halted: n.halted, presentation: n.presentation,
    rxPerSec: n.rxPerSec, txPerSec: n.txPerSec, published: publishedCount, actions: actionsOn, parked: wires.parked(), sessionPublished, silenced: wires.silenced()
  }
}

/** The published actions, in the picker's order. */
function publishedActions(): DfAction[] {
  const pub = new Set(config?.publish ?? [])
  return actions.filter((a) => dfPublished(pub, dfGroupOf(a.path, a.group), a.path))
}

// What the open session's wires need on the mesh and this computer does not
// publish : on the tree only while that session is open (its wires change with a
// load, New, a wire made or removed), NEVER written to the publish list, so a
// session never makes this computer publish anything for good. Worked out here
// from the session's wires (already cleaned) and only ever Palinopsia's own
// paths : a fixed destination or source, or an action the session has now. The
// Session heading's actions (open a favorite, load, New) never : a session cannot
// expose what replaces it; this computer's publish list can.
// When the session closes they are REMOVED from the node (the core declares again
// without them) : the rare, deliberate removal, so no other node keeps a ghost of
// a parameter that answers to nothing (docs/dataflou-9.3.md).
const DEST_PATHS = new Set<string>(DF_DESTS.map((d) => d.path))
// (what a wire can read from us : a source, or a destination that also reports)
const SRC_PATHS = new Set<string>([...DF_SOURCES.map((s) => s.path), ...DF_DESTS.filter((d) => d.bidir).map((d) => d.path)])
const SESSION_NEVER_GROUP = 'Session'
function sessionExtras(): { fixed: string[]; acts: DfAction[] } {
  if (!config) return { fixed: [], acts: [] }
  const pub = new Set(config.publish)
  const byPath = new Map(actions.map((a) => [a.path, a]))
  const fixed = new Set<string>()
  const acts = new Map<string, DfAction>()
  const add = (path: string, fixedOk: Set<string>): void => {
    if (fixedOk.has(path)) {
      if (!dfPublished(pub, dfGroupOf(path), path)) fixed.add(path)
      return
    }
    const a = byPath.get(path)
    if (a && a.group !== SESSION_NEVER_GROUP && !dfPublished(pub, dfGroupOf(a.path, a.group), a.path)) acts.set(a.path, a)
  }
  for (const w of wires.sessionHere()) {
    add(w.dest, DEST_PATHS)
    if (w.sku === DF_SELF && SRC_PATHS.has(w.path)) add(w.path, SRC_PATHS)
  }
  return { fixed: [...fixed], acts: [...acts.values()] }
}
// the session-only paths on the tree now
let sessionPublished: string[] = []
// what the tree was last built from (rebuilt only when that changes)
let treeSig = ''
const treeSigNow = (): string => JSON.stringify([config?.publish ?? [], publishedActions(), sessionExtras(), listens])

/** The tree : everything published, then what the open session needs, then the
 *  modulators' mesh inputs in use. */
function tree(): DfParam[] {
  treeSig = treeSigNow()
  const ex = sessionExtras()
  sessionPublished = [...ex.fixed, ...ex.acts.map((a) => a.path)]
  const acts = [...publishedActions(), ...ex.acts]
  actionsOn = acts.length
  const params = palinopsiaTree(acts, [...(config?.publish ?? []), ...ex.fixed.map((p) => `p:${p}`)])
  publishedCount = params.filter((p) => p.kind !== 'group').length
  return [...params, ...inputTree(listens)]
}

/** A new tree if what it is built from changed (the publish list, the session's
 *  wires, the actions, the modulators' inputs). */
function refreshTree(why: string): void {
  if (!node || treeSigNow() === treeSig) return
  void node.setParams(tree(), values)
  wires.treeChanged()
  statusDirty = true
  log('info', `[dataflou] ${why} : ${publishedCount} parameters published (${sessionPublished.length} for the session only)`)
}

function pushStatus(): void {
  statusDirty = false
  lastStatusAt = Date.now()
  win()?.webContents.send('dataflou:status', status())
}

// One configure at a time : two overlapping calls (React's double effect in dev, a fast
// on / off) would each start a node, and the first would be lost still running.
let configureOp: Promise<unknown> = Promise.resolve()
function configure(next: DfConfig): Promise<DfStatus> {
  const p = configureOp.then(() => configureNow(next))
  configureOp = p.catch(() => undefined)
  return p
}

function drop(): void {
  wires.detach()
  node?.stop()
  node = null
}

let announced = '' // the address the node was started on

async function startNode(): Promise<void> {
  if (!config) return
  const { label, universe } = config
  lastError = null
  if (!addonThere()) return
  adoptSessionFiles(universe)
  migrateOldWires(dir(), universe, log)
  wires.setUniverse(universe)
  const n = new DataflouNode(
    { sku: sku(), label, universe, product: 'Palinopsia', dir: nodeDir(dir(), universe), params: tree() },
    {
      log: (m) => console.log(`[dataflou] ${m}`),
      onValues: (vs) => {
        for (const v of vs) {
          const l = wires.inputOf(v.path)
          if (l) {
            if (typeof v.value === 'number') remoteBuffer.set(`${l.sku}\n${l.path}`, { sku: l.sku, path: l.path, v: Math.max(0, Math.min(1, v.value)) })
          } else if (inBuffer.length < 4000) inBuffer.push({ path: v.path, value: v.value })
        }
      },
      onFire: (path, times) => {
        inBuffer.push({ path, fire: times })
      },
      onDest: (path, d) => {
        inBuffer.push({ path, dest: d.state, live: d.live })
        statusDirty = true
      },
      onLocate: (path, on) => {
        win()?.webContents.send('dataflou:locate', { path, on })
        visualizerSay({ type: 'locate', path, on })
      },
      onHalt: (on) => {
        log('info', `[dataflou] the mesh ${on ? 'is halted' : 'is no longer halted'}`)
        visualizerSay({ type: 'halt', on })
        statusDirty = true
      },
      // the page this node serves hears every cue it applies
      onScene: (op, slot, state, skipped) => {
        log('info', `[dataflou] scene ${op} ${slot} : ${state}${skipped ? `, ${skipped} skipped` : ''}`)
        visualizerSay({ type: 'scene', op, slot, state, skipped })
        // (connections only, unless the section says Palinopsia's scene follows)
        if (op === 'recall' && config?.sceneRecall) win()?.webContents.send('dataflou:scene', slot)
      },
      onChange: () => {
        statusDirty = true
      },
      onWorld: (w) => {
        wires.world(w.mine)
        // the second node of v1.3.3, if this mesh still remembers it
        const old = oldSessionSku()
        if (w.nodes.some((x) => x.sku === old && !x.online)) n.forget(old)
      },
      onStopped: (why) => {
        lastError = why
        log('warn', `[dataflou] stopped : ${why}`)
        if (node === n) drop()
        statusDirty = true
      }
    }
  )
  try {
    node = n
    await n.start(values, (w) => wires.attach(n, universe, w.mine))
    if (node !== n) return
    n.setWatches(watches)
    visualizerNodeChanged()
    announced = await primaryIPv4()
    log('info', `[dataflou] on the mesh as ${label} (universe ${universe}), ${publishedCount} parameters published`)
  } catch (e) {
    lastError = (e as Error).message
    log('warn', `[dataflou] could not start : ${lastError}`)
    if (node === n) drop()
    else n.stop()
  }
}

async function configureNow(next: DfConfig): Promise<DfStatus> {
  const label = (next.label || 'palinopsia').trim().replace(/\s+/g, '-').slice(0, 32) || 'palinopsia'
  // (what the core takes as a universe : none of these)
  const universe = (next.universe || 'default').replace(/[/\\:*?"<>|]/g, '').trim().slice(0, 32) || 'default'
  const want: DfConfig = { enabled: !!next.enabled, label, universe, publish: cleanPublish(next.publish), sceneRecall: next.sceneRecall === true }
  const same = config && config.enabled === want.enabled && config.label === want.label && config.universe === want.universe
  config = want
  if (same && node) {
    // only what is published changed : a new tree, no new connection
    refreshTree('the publish list changed')
    pushStatus()
    return status()
  }
  if (same && !want.enabled) return status()
  drop()
  wires.setUniverse(universe)
  lastError = null
  if (want.enabled) await startNode()
  else addonThere() // (is it in this build at all ?)
  pushStatus()
  return status()
}

/** The node again, where the network is now (a wake, an address that changed) : its
 *  sockets and its mDNS belong to the old one. Its peers see it leave and come back. */
function restart(why: string): void {
  configureOp = configureOp
    .then(async () => {
      if (!node || !config?.enabled) return
      log('info', `[dataflou] ${why} : on the mesh again`)
      drop()
      await startNode()
      pushStatus()
    })
    .catch(() => undefined)
}

/** Leave the mesh (quitting). */
export function closeDataflou(): void {
  stopVisualizer()
  drop()
}

export function initDataflou(getWindow: () => BrowserWindow | null): void {
  win = getWindow
  const str = (x: unknown, max = 200): x is string => typeof x === 'string' && x.length > 0 && x.length < max
  ipcMain.handle('dataflou:configure', (_e, cfg: DfConfig) => configure(cfg).catch((e: Error) => ({ ...status(), error: e.message })))
  ipcMain.handle('dataflou:status', () => {
    addonThere()
    return status()
  })
  // The mesh visualizer, in the browser (its server starts on the first click).
  ipcMain.handle('dataflou:visualizer', (_e, open?: boolean) =>
    openVisualizer(
      () => node,
      (n) => {
        visClients = n
        statusDirty = true
      },
      open !== false,
      // the page moves the node to another universe : the setting is the
      // renderer's (it keeps it), so it changes it there and reconfigures
      (name) => win()?.webContents.send('dataflou:universe', name)
    )
  )
  // The Body rule picker's actions (sent when they change : a scene, a rule, an
  // effect added). The tree follows when the published ones changed.
  ipcMain.on('dataflou:actions', (_e, list: unknown) => {
    if (!Array.isArray(list)) return
    actions = list
      .filter((a): a is DfAction => !!a && str(a.id) && str(a.path) && str(a.label) && str(a.group) && a.path.startsWith('act/'))
      .slice(0, 2000)
    refreshTree(`${actions.length} actions listed`)
  })
  // What Palinopsia's parameters stand at, as the renderer sees them change.
  ipcMain.on('dataflou:values', (_e, v: Record<string, DfValue>) => {
    if (!v || typeof v !== 'object') return
    for (const [k, x] of Object.entries(v)) values.set(k, x)
    node?.setValues(v)
  })
  ipcMain.handle('dataflou:bind', (_e, a: { destSku: string; destPath: string; srcSku: string; srcPath: string; on: boolean; scope?: MappingScope }) => {
    if (!node || !config || !str(a?.destSku, 64) || !str(a.destPath, 256) || !str(a.srcSku, 64) || !str(a.srcPath, 256)) return false
    // a new wire into Palinopsia saved with the session : straight into its list
    if (a.on && a.scope === 'session' && a.destSku === sku()) return wires.addSession(a.destPath, a.srcSku, a.srcPath)
    return a.on ? node.connect(a.destSku, a.destPath, a.srcSku, a.srcPath) : node.disconnect(a.destSku, a.destPath, a.srcSku, a.srcPath)
  })
  // the session's wires (all universes) : whenever the renderer's list changes
  // (a session loaded, New, a wire made or moved)
  ipcMain.on('dataflou:session', (_e, list: unknown) => {
    if (wires.setSession(cleanSessionWires(list))) statusDirty = true
  })
  ipcMain.handle('dataflou:wireScope', (_e, a: { dest?: unknown; sku?: unknown; path?: unknown; to?: unknown }) =>
    str(a?.dest, 256) && str(a.sku, 64) && str(a.path, 256) && (a.to === 'computer' || a.to === 'session' || a.to === null) ? wires.move(a.dest, a.sku, a.path, a.to) : false
  )
  ipcMain.handle('dataflou:io', async () => (node ? [await node.io()] : []))
  // the outside values watched in the data view (the renderer keeps the list)
  ipcMain.on('dataflou:watch', (_e, list: unknown) => {
    if (!Array.isArray(list)) return
    watches = list
      .filter((m): m is DfSub => !!m && str(m.sku, 64) && str(m.path, 256))
      .slice(0, 64)
      .map((m) => ({ sku: m.sku, path: m.path }))
    node?.setWatches(watches)
  })
  // the remote values the modulators play (their mesh inputs)
  ipcMain.on('dataflou:listen', (_e, list: unknown) => {
    if (!Array.isArray(list)) return
    listens = list
      .filter((m): m is DfListen => !!m && str(m.sku, 64) && str(m.path, 256) && Number.isInteger(m.slot) && m.slot >= 0 && m.slot < 64)
      .slice(0, 64)
      .map((m) => ({ sku: m.sku, path: m.path, slot: m.slot }))
    wires.setListens(listens)
  })
  // learn from the mesh : start, peek (the value that moved the most), stop
  ipcMain.handle('dataflou:learn', (_e, op: unknown) => {
    if (!node) return null
    if (op === 'start') node.learnStart()
    else if (op === 'stop') node.learnStop()
    else if (op === 'peek') return node.learnPeek()
    return null
  })
  // a wire into Palinopsia : its range, invert, smoothing, on loss
  ipcMain.handle('dataflou:wireOpt', (_e, a: { dest?: unknown; sku?: unknown; path?: unknown; opt?: unknown }) =>
    str(a?.dest, 256) && str(a.sku, 64) && str(a.path, 256) ? wires.setOpt(a.dest, a.sku, a.path, (a.opt ?? null) as DfWireOpt | null) : false
  )
  ipcMain.handle('dataflou:forget', (_e, s: unknown) => {
    if (str(s, 64)) node?.forget(s)
    return true
  })
  // show where a parameter of another node is, or this node in every page
  ipcMain.handle('dataflou:locate', (_e, a: { sku?: unknown; path?: unknown }) => (node && str(a?.sku, 64) && str(a.path, 256) ? node.locate(a.sku, a.path, 1500) : false))
  ipcMain.on('dataflou:identify', () => node?.identify())
  // Back from sleep, or the network changed under us.
  powerMonitor.on('resume', () => restart('the computer woke up'))
  let addrBusy = false
  const watch = setInterval(() => {
    if (!node || addrBusy || !announced) return
    addrBusy = true
    void primaryIPv4()
      .then((a) => {
        if (node && a !== announced) restart(`the network changed (${a})`)
      })
      .finally(() => { addrBusy = false })
  }, 10_000)
  // Values for the renderer once a frame; the status at most 4 times a second,
  // and once a second while running (the rates).
  const t = setInterval(() => {
    if (inBuffer.length) {
      const batch = inBuffer
      inBuffer = []
      win()?.webContents.send('dataflou:in', batch)
    }
    if (remoteBuffer.size) {
      const batch = [...remoteBuffer.values()]
      remoteBuffer = new Map()
      win()?.webContents.send('dataflou:remote', batch)
    }
    const now = Date.now()
    if ((statusDirty && now - lastStatusAt > 250) || (node && now - lastStatusAt > 1000)) pushStatus()
  }, 16)
  app.on('will-quit', () => {
    clearInterval(watch)
    clearInterval(t)
    closeDataflou()
  })
}
