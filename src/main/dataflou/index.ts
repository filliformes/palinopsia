// The dataflou node's life in the main process : the renderer turns it on or off
// (the dataflou section, persisted there like OSC), main keeps the node, its
// identity (one SKU per install, kept in userData) and each universe's bindings,
// relays values both ways, and pushes a status for the monitor.
//
// ONE node only : it declares what the dataflou section chose to publish (whole
// groups or single parameters, the Body rule list's actions included). One
// DECLARE frame holds at most 32 KB : the section shows how full it is, and the
// actions past it are left out (named in the status), never put on a second node.

import { app, type BrowserWindow, ipcMain, powerMonitor } from 'electron'
import { createHash, randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DataflouNode } from './node'
import { primaryIPv4 } from './mdns'
import { encodeDeclare } from './protocol'
import { openVisualizer, stopVisualizer, visualizerAvailable, visualizerNodeChanged, visualizerScene } from './visualizer'
import type { SceneFile } from './node'
import {
  DF_DECLARE_MAX, DF_SELF, DF_SESSION_WIRES_MAX, cleanPublish, cleanSessionWires, cleanWireOpt, dfCppHidden, dfGroupOf, dfPublished, dfWireKey, palinopsiaTree,
  type DfAction, type DfConfig, type DfParam, type DfSessionWire, type DfStatus, type DfSub, type DfValue
} from '@shared/dataflou'
import type { MappingScope } from '@shared/types'
import { log } from '../log'

let node: DataflouNode | null = null
let config: DfConfig | null = null
let lastError: string | null = null
let win: () => BrowserWindow | null = () => null
let inBuffer: Array<{ path: string; value: DfValue }> = []
// remote values a modulator plays (its mesh input), for the renderer once a frame
let remoteBuffer = new Map<string, { sku: string; path: string; v: number }>()
let listens: DfSub[] = []
let statusDirty = false
let lastStatusAt = 0
// The Body rule picker's actions, as the renderer last listed them; how many of
// the published ones the tree carries now, and how many it had to leave out.
let actions: DfAction[] = []
let actionsOn = 0
let actionsDropped = 0
let publishedCount = 0
let cppHidden = 0
let watches: DfSub[] = []

const dir = (): string => {
  const d = join(app.getPath('userData'), 'dataflou')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

/** One SKU per install : how every other node knows this Palinopsia. */
function sku(): string {
  const f = join(dir(), 'identity.json')
  try {
    const j = JSON.parse(readFileSync(f, 'utf8')) as { sku?: string }
    if (j.sku && /^[0-9a-f-]{36}$/i.test(j.sku)) return j.sku
  } catch { /* first run */ }
  const s = randomUUID()
  writeFileSync(f, JSON.stringify({ sku: s }, null, 2))
  return s
}

/** The SKU the second node (`<name>-session`, gone since v1.3.4) had : made from
 *  ours. A peer that still remembers it is asked to forget it. */
function oldSessionSku(): string {
  const h = createHash('sha1').update(`${sku()}:session`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const subsFile = (universe: string, which = ''): string => join(dir(), `bindings-${universe.replace(/[^\w.-]+/g, '_')}${which}.json`)

// Scenes : each node's slots and cue state, per universe (changing universe
// changes scenes, as on the reference).
const scenesFile = (universe: string, which = ''): string => join(dir(), `scenes-${universe.replace(/[^\w.-]+/g, '_')}${which}.json`)

function loadScenes(universe: string, which = ''): SceneFile | null {
  try {
    const j = JSON.parse(readFileSync(scenesFile(universe, which), 'utf8')) as SceneFile
    return j && j.v === 1 ? j : null
  } catch {
    return null // none yet
  }
}

function saveScenesTo(universe: string, which: string, s: SceneFile): void {
  try {
    writeFileSync(scenesFile(universe, which), JSON.stringify(s))
  } catch (e) {
    log('warn', `[dataflou] could not save the scenes : ${(e as Error).message}`)
  }
}

function loadSubs(universe: string, which = ''): Record<string, DfSub[]> {
  try {
    return JSON.parse(readFileSync(subsFile(universe, which), 'utf8')) as Record<string, DfSub[]>
  } catch {
    return {}
  }
}

function saveSubsTo(universe: string, which: string, subs: Record<string, DfSub[]>): void {
  try {
    writeFileSync(subsFile(universe, which), JSON.stringify(subs, null, 2))
  } catch (e) {
    log('warn', `[dataflou] could not save the bindings : ${(e as Error).message}`)
  }
}

/** The second node's wires and scene slots (up to v1.3.3) join the one node's :
 *  its actions are on this node now, at the same paths. Done once per universe
 *  (the old files are renamed, never deleted). */
export function adoptSessionFiles(universe: string): void {
  const oldSubs = subsFile(universe, '-session')
  if (existsSync(oldSubs)) {
    try {
      const mine = loadSubs(universe)
      const theirs = loadSubs(universe, '-session')
      for (const [dest, list] of Object.entries(theirs)) {
        if (!Array.isArray(list)) continue
        const into = Array.isArray(mine[dest]) ? mine[dest] : (mine[dest] = [])
        for (const s of list) if (s && !into.some((x) => x.sku === s.sku && x.path === s.path)) into.push(s)
      }
      saveSubsTo(universe, '', mine)
      renameSync(oldSubs, `${oldSubs}.v133`)
      log('info', `[dataflou] the second node's wires (${Object.keys(theirs).length} destinations) joined this node's`)
    } catch (e) {
      log('warn', `[dataflou] could not take the second node's wires : ${(e as Error).message}`)
    }
  }
  const oldScenes = scenesFile(universe, '-session')
  if (existsSync(oldScenes)) {
    try {
      const mine = loadScenes(universe)
      const theirs = loadScenes(universe, '-session')
      // into the slots this node has (a slot it lacks stays lacking : a recall
      // of it keeps this node's wires, as it did)
      if (mine && theirs) {
        for (const [slot, links] of Object.entries(theirs.slots)) if (mine.slots[slot]) mine.slots[slot] = [...mine.slots[slot], ...links]
        saveScenesTo(universe, '', mine)
      }
      renameSync(oldScenes, `${oldScenes}.v133`)
    } catch (e) {
      log('warn', `[dataflou] could not take the second node's scenes : ${(e as Error).message}`)
    }
  }
}

// ── the session's wires ─────────────────────────────────────────────────────
// A wire into Palinopsia lives on this computer (bindings-<universe>.json, every
// session, as before) or in the session (its file's mappings.dataflou, the
// renderer's to keep : it hands main the list whenever it changes). The node
// plays the session's wires of its universe, and this computer's except the ones
// on a destination or a source the session wires : those are set aside (kept in
// the file, silenced) until the session lets go of that input, as a session's
// MIDI and OSC mappings stand in for the computer's on their inputs. A wire made
// from the mesh (another node, the visualizer, a scene) is this computer's; one
// of the session's unwired or reshaped from anywhere leaves or changes in the
// session too (the renderer hears it).
let sessionWires: DfSessionWire[] = []
// this computer's wires set aside now (the node's universe)
let silenced: Record<string, DfSub[]> = {}
let applying = false
let applyQueued = false

const own = (s: string): string => (s === DF_SELF ? sku() : s)
const subKey = (dest: string, s: { sku: string; path: string }): string => dfWireKey(dest, s.sku, s.path)
const sessionOf = (universe: string): DfSessionWire[] => sessionWires.filter((w) => w.universe === universe)

/** What the node plays in this universe : the session's wires, then this
 *  computer's on the inputs the session leaves free (the rest set aside). */
function effectiveWires(universe: string): Record<string, DfSub[]> {
  const sess = sessionOf(universe)
  const dests = new Set(sess.map((w) => w.dest))
  const srcs = new Set(sess.map((w) => `${own(w.sku)}\n${w.path}`))
  const want: Record<string, DfSub[]> = {}
  const add = (into: Record<string, DfSub[]>, dest: string, s: DfSub): void => {
    const list = (into[dest] ??= [])
    if (!list.some((x) => x.sku === s.sku && x.path === s.path)) list.push(s)
  }
  for (const w of sess) add(want, w.dest, { sku: own(w.sku), path: w.path, ...(w.opt ? { opt: { ...w.opt } } : {}) })
  silenced = {}
  for (const [dest, list] of Object.entries(loadSubs(universe))) {
    if (!Array.isArray(list)) continue
    for (const s of list) {
      if (!s || typeof s.sku !== 'string' || typeof s.path !== 'string') continue
      if (dests.has(dest) || srcs.has(`${s.sku}\n${s.path}`)) add(silenced, dest, s)
      else add(want, dest, s)
    }
  }
  return want
}

/** Make the node's wires what the session and this computer say (after the
 *  session's list changed, a wire moved, or a computer wire landed on the
 *  session's input). */
function applySessionWires(): void {
  applyQueued = false
  if (!node || !config) return
  applying = true
  try {
    const r = node.replaceWires(effectiveWires(config.universe))
    if (r.added || r.removed) log('info', `[dataflou] wires : +${r.added} -${r.removed} (${sessionOf(config.universe).length} of the session's)`)
  } finally {
    applying = false
  }
  statusDirty = true
}
const queueApply = (): void => {
  if (applyQueued) return
  applyQueued = true
  setImmediate(applySessionWires)
}

const pushSessionWires = (): void => {
  win()?.webContents.send('dataflou:sessionWires', sessionWires)
}

/** The node saved its wires (any change : ours, the mesh's, a scene's) : this
 *  computer's go to its file (the session's never do), the session's list
 *  follows what became of its wires. */
function nodeSaved(universe: string, all: Record<string, DfSub[]>): void {
  if (applying) return // (the computer's file is what the apply read)
  const sess = sessionOf(universe)
  const sessKeys = new Set(sess.map((w) => dfWireKey(w.dest, own(w.sku), w.path)))
  const dests = new Set(sess.map((w) => w.dest))
  const srcs = new Set(sess.map((w) => `${own(w.sku)}\n${w.path}`))
  const pc: Record<string, DfSub[]> = {}
  let clash = false
  for (const [dest, list] of Object.entries(all)) {
    for (const s of list) {
      if (sessKeys.has(subKey(dest, s))) continue
      ;(pc[dest] ??= []).push(s)
      // a computer wire on the session's input (made from the mesh) : set aside
      if (dests.has(dest) || srcs.has(`${s.sku}\n${s.path}`)) clash = true
    }
  }
  for (const [dest, list] of Object.entries(silenced)) {
    for (const s of list) {
      const into = (pc[dest] ??= [])
      if (!into.some((x) => x.sku === s.sku && x.path === s.path)) into.push(s)
    }
  }
  saveSubsTo(universe, '', pc)
  // the session's wires : gone (unwired), or reshaped, wherever it happened
  let changed = false
  const next: DfSessionWire[] = []
  for (const w of sessionWires) {
    if (w.universe !== universe) {
      next.push(w)
      continue
    }
    const live = all[w.dest]?.find((x) => x.sku === own(w.sku) && x.path === w.path)
    if (!live) {
      changed = true
      continue
    }
    const opt = cleanWireOpt(live.opt)
    if (JSON.stringify(opt ?? null) !== JSON.stringify(w.opt ?? null)) {
      changed = true
      next.push({ universe: w.universe, dest: w.dest, sku: w.sku, path: w.path, ...(opt ? { opt } : {}) })
    } else next.push(w)
  }
  if (changed) {
    sessionWires = next
    pushSessionWires()
  }
  // a session wire gone gives its input back to this computer's (and a clash is set aside)
  if (changed || clash) queueApply()
}

/** One wire into Palinopsia moved : to the session (out of this computer's file),
 *  to this computer (out of the session), or (null) a silenced computer wire removed. */
function moveWire(dest: string, srcSku: string, srcPath: string, to: MappingScope | null): boolean {
  if (!config) return false
  const universe = config.universe
  const me = sku()
  const live = node ? (node.status().nodes.find((n) => n.local)?.subs[dest] ?? []).find((x) => x.sku === srcSku && x.path === srcPath) : undefined
  const file = loadSubs(universe)
  const inFile = (file[dest] ?? []).find((x) => x.sku === srcSku && x.path === srcPath)
  const sessSku = srcSku === me ? DF_SELF : srcSku
  const isSess = (w: DfSessionWire): boolean => w.universe === universe && w.dest === dest && own(w.sku) === srcSku && w.path === srcPath
  const inSess = sessionWires.find(isSess)
  const dropFromFile = (): void => {
    if (!file[dest]) return
    file[dest] = file[dest].filter((x) => !(x.sku === srcSku && x.path === srcPath))
    if (!file[dest].length) delete file[dest]
    saveSubsTo(universe, '', file)
  }
  if (to === 'session') {
    if (inSess) return true
    if (!live && !inFile) return false
    if (sessionOf(universe).filter((w) => w.dest === dest).length >= 4) return false
    // (a full list would drop the new wire after it left this computer's file)
    if (sessionWires.length >= DF_SESSION_WIRES_MAX) return false
    const opt = cleanWireOpt((live ?? inFile)?.opt)
    sessionWires = cleanSessionWires([...sessionWires, { universe, dest, sku: sessSku, path: srcPath, ...(opt ? { opt } : {}) }])
    dropFromFile()
  } else if (to === 'computer') {
    if (!inSess) return !!inFile
    const opt = cleanWireOpt(live?.opt ?? inSess.opt)
    sessionWires = sessionWires.filter((w) => !isSess(w))
    const list = (file[dest] ??= [])
    if (!list.some((x) => x.sku === srcSku && x.path === srcPath)) list.push({ sku: srcSku, path: srcPath, ...(opt ? { opt } : {}) })
    saveSubsTo(universe, '', file)
  } else {
    if (!inFile) return false
    dropFromFile()
  }
  pushSessionWires()
  applySessionWires()
  return true
}

/** The session's wires in a status : the ones playing, the computer's set aside,
 *  the ones waiting for another universe. */
function sessionStatus(universe: string): Pick<DfStatus, 'session' | 'silenced' | 'sessionElsewhere'> {
  const elsewhere = new Map<string, number>()
  for (const w of sessionWires) if (w.universe !== universe) elsewhere.set(w.universe, (elsewhere.get(w.universe) ?? 0) + 1)
  return {
    session: sessionOf(universe).map((w) => dfWireKey(w.dest, own(w.sku), w.path)),
    silenced: node ? Object.entries(silenced).flatMap(([dest, list]) => list.map((s) => ({ dest, sku: s.sku, path: s.path }))) : [],
    sessionElsewhere: [...elsewhere].map(([u, count]) => ({ universe: u, count }))
  }
}

let visClients = 0

function status(): DfStatus {
  if (node) {
    return {
      ...node.status(), published: publishedCount, actions: actionsOn, actionsDropped, cppHidden,
      visualizer: visClients, visualizerAvailable: visualizerAvailable(), ...sessionStatus(config?.universe ?? '')
    }
  }
  return {
    running: false, error: lastError, sku: '', label: config?.label ?? '', universe: config?.universe ?? '',
    address: '', tcpPort: 0, udpPort: 0, nodes: [], listeners: {}, rxPerSec: 0, txPerSec: 0,
    declareBytes: 0, published: 0, actions: 0, actionsDropped: 0, cppHidden: 0, parked: [], visualizer: visClients, visualizerAvailable: visualizerAvailable(),
    ...sessionStatus(config?.universe ?? '')
  }
}

/** The published actions, in the picker's order. */
function publishedActions(): DfAction[] {
  const pub = new Set(config?.publish ?? [])
  return actions.filter((a) => dfPublished(pub, dfGroupOf(a.path, a.group), a.path))
}

/** The tree : everything published, with as many of the published actions (in the
 *  picker's order) as fit in one frame a desktop node takes. */
function tree(): DfParam[] {
  const publish = config?.publish ?? []
  const want = publishedActions()
  const label = config?.label ?? 'palinopsia'
  const id = { sku: '00000000-0000-0000-0000-000000000000', label, product: 'Palinopsia', version: 1, state: 'active' }
  const size = (n: number): number => encodeDeclare(0, id.sku, id.sku, 2 ** 31, id, palinopsiaTree(want.slice(0, n), publish)).length
  let n = want.length
  if (n && size(n) > DF_DECLARE_MAX) {
    let lo = 0
    let hi = n
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (size(mid) <= DF_DECLARE_MAX) lo = mid
      else hi = mid - 1
    }
    n = lo
  }
  if (n < want.length) log('warn', `[dataflou] ${label} : ${want.length - n} published actions left out, the tree would pass ${DF_DECLARE_MAX} bytes`)
  actionsOn = n
  actionsDropped = want.length - n
  const params = palinopsiaTree(want.slice(0, n), publish)
  publishedCount = params.filter((p) => p.kind !== 'group').length
  cppHidden = dfCppHidden(params)
  return params
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

async function configureNow(next: DfConfig): Promise<DfStatus> {
  const label = (next.label || 'palinopsia').trim().replace(/\s+/g, '-').slice(0, 32) || 'palinopsia'
  const universe = (next.universe || 'default').trim().slice(0, 32) || 'default'
  const want: DfConfig = { enabled: !!next.enabled, label, universe, publish: cleanPublish(next.publish) }
  const same = config && config.enabled === want.enabled && config.label === want.label && config.universe === want.universe
  const publishChanged = !!config && JSON.stringify(config.publish) !== JSON.stringify(want.publish)
  config = want
  if (same && node) {
    // only what is published changed : a new tree, no new connection
    if (publishChanged) {
      node.setParams(tree())
      log('info', `[dataflou] ${publishedCount} parameters published, DECLARE ${node.declareBytes()} bytes`)
    }
    pushStatus()
    return status()
  }
  if (same && !want.enabled) return status()
  node?.stop()
  node = null
  lastError = null
  if (want.enabled) {
    adoptSessionFiles(universe)
    const n = new DataflouNode(
      {
        sku: sku(), label, universe, product: 'Palinopsia', version: 1, params: tree(), subs: effectiveWires(universe), scenes: loadScenes(universe),
        retired: [oldSessionSku()]
      },
      {
        log: (m) => console.log(`[dataflou] ${m}`),
        onValues: (vs) => {
          if (inBuffer.length < 4000) for (const v of vs) inBuffer.push({ path: v.path, value: v.value })
        },
        onChange: () => {
          statusDirty = true
        },
        saveSubs: (subs) => nodeSaved(universe, subs),
        saveScenes: (s) => saveScenesTo(universe, '', s),
        // (the newest of each a frame : a modulator plays the latest)
        onRemote: (sku, path, v) => {
          if (remoteBuffer.size < 512 || remoteBuffer.has(`${sku}\n${path}`)) remoteBuffer.set(`${sku}\n${path}`, { sku, path, v })
        },
        // the page this node serves hears every cue it applies
        onScene: (op, slot, st) => {
          log('info', `[dataflou] scene ${op} ${slot} : ${st.state}${st.skipped ? `, ${st.skipped} skipped` : ''}`)
          visualizerScene(op, slot, st.state, st.skipped)
        }
      }
    )
    try {
      await n.start()
      node = n
      n.visualizerClients = visClients
      n.setWatches(watches)
      n.setListens(listens)
      visualizerNodeChanged()
      log('info', `[dataflou] on the mesh as ${label} (universe ${universe}), DECLARE ${n.declareBytes()} bytes`)
    } catch (e) {
      lastError = (e as Error).message
      log('warn', `[dataflou] could not start : ${lastError}`)
      n.stop()
    }
  }
  pushStatus()
  return status()
}

export function initDataflou(getWindow: () => BrowserWindow | null): void {
  win = getWindow
  ipcMain.handle('dataflou:configure', (_e, cfg: DfConfig) => configure(cfg).catch((e: Error) => ({ ...status(), error: e.message })))
  ipcMain.handle('dataflou:status', () => status())
  // The mesh visualizer, in the browser (its server starts on the first click).
  ipcMain.handle('dataflou:visualizer', (_e, open?: boolean) =>
    openVisualizer(
      () => node,
      (n) => {
        visClients = n
        if (node) node.visualizerClients = n
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
    const str = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length < 200
    const before = JSON.stringify(publishedActions())
    actions = list
      .filter((a): a is DfAction => !!a && str(a.id) && str(a.path) && str(a.label) && str(a.group) && a.path.startsWith('act/'))
      .slice(0, 1000)
    if (node && JSON.stringify(publishedActions()) !== before) {
      node.setParams(tree())
      log('info', `[dataflou] ${actionsOn} actions on ${config?.label}, DECLARE ${node.declareBytes()} bytes`)
    }
  })
  // Our sources' values, sampled by the renderer (only the ones someone listens to).
  ipcMain.on('dataflou:values', (_e, values: Record<string, DfValue>) => {
    if (node && values && typeof values === 'object') node.setValues(values)
  })
  ipcMain.handle('dataflou:bind', (_e, a: { destSku: string; destPath: string; srcSku: string; srcPath: string; on: boolean; scope?: MappingScope }) => {
    if (!node || !config) return false
    // a new wire into Palinopsia saved with the session : straight into its list
    if (a.on && a.scope === 'session' && a.destSku === sku() && typeof a.destPath === 'string' && typeof a.srcSku === 'string' && typeof a.srcPath === 'string') {
      const universe = config.universe
      const w: DfSessionWire = { universe, dest: a.destPath, sku: a.srcSku === sku() ? DF_SELF : a.srcSku, path: a.srcPath }
      if (sessionOf(universe).some((x) => x.dest === w.dest && own(x.sku) === a.srcSku && x.path === w.path)) return true
      // the same wire already on this computer : moved into the session, not doubled
      if ((loadSubs(universe)[a.destPath] ?? []).some((x) => x.sku === a.srcSku && x.path === a.srcPath)) return moveWire(a.destPath, a.srcSku, a.srcPath, 'session')
      if (sessionOf(universe).filter((x) => x.dest === w.dest).length >= 4) return false
      if (sessionWires.length >= DF_SESSION_WIRES_MAX) return false
      sessionWires = cleanSessionWires([...sessionWires, w])
      pushSessionWires()
      applySessionWires()
      return true
    }
    return node.subscribeRemote(a.destSku, a.destPath, a.srcSku, a.srcPath, !!a.on)
  })
  // the session's wires (all universes) : whenever the renderer's list changes
  // (a session loaded, New, a wire made or moved)
  ipcMain.on('dataflou:session', (_e, list: unknown) => {
    const next = cleanSessionWires(list)
    if (JSON.stringify(next) === JSON.stringify(sessionWires)) return
    sessionWires = next
    applySessionWires()
    statusDirty = true
  })
  ipcMain.handle('dataflou:wireScope', (_e, a: { dest?: unknown; sku?: unknown; path?: unknown; to?: unknown }) =>
    typeof a?.dest === 'string' && typeof a.sku === 'string' && typeof a.path === 'string' && (a.to === 'computer' || a.to === 'session' || a.to === null)
      ? moveWire(a.dest, a.sku, a.path, a.to)
      : false
  )
  ipcMain.handle('dataflou:io', () => (node ? [node.io()] : []))
  // the outside values watched in the data view (the renderer keeps the list)
  ipcMain.on('dataflou:watch', (_e, list: unknown) => {
    if (!Array.isArray(list)) return
    watches = list
      .filter((m): m is DfSub => !!m && typeof m.sku === 'string' && typeof m.path === 'string' && m.path.length < 200)
      .slice(0, 64)
      .map((m) => ({ sku: m.sku, path: m.path }))
    node?.setWatches(watches)
  })
  // the remote values the modulators play (their mesh inputs)
  ipcMain.on('dataflou:listen', (_e, list: unknown) => {
    if (!Array.isArray(list)) return
    listens = list
      .filter((m): m is DfSub => !!m && typeof m.sku === 'string' && typeof m.path === 'string' && m.path.length < 200)
      .slice(0, 64)
      .map((m) => ({ sku: m.sku, path: m.path }))
    node?.setListens(listens)
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
    !!node && typeof a?.dest === 'string' && typeof a.sku === 'string' && typeof a.path === 'string' && node.setWireOpt(a.dest, a.sku, a.path, a.opt)
  )
  // Back from sleep, or the network changed under us : each node looks for the
  // mesh again (its lost peers dialled at once, mDNS from the address we have now).
  const wakeAll = (why: string): void => {
    void node?.wake(why)
  }
  powerMonitor.on('resume', () => wakeAll('the computer woke up'))
  powerMonitor.on('unlock-screen', () => wakeAll('the session was unlocked'))
  let addrBusy = false
  const watch = setInterval(() => {
    if (!node || addrBusy) return
    addrBusy = true
    void primaryIPv4()
      .then((a) => { if (node && a !== node.announcedAddress) wakeAll(`the network changed (${a})`) })
      .finally(() => { addrBusy = false })
  }, 10_000)
  app.on('will-quit', () => clearInterval(watch))
  ipcMain.handle('dataflou:forget', (_e, s: string) => {
    node?.flush(s)
    return true
  })
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
    clearInterval(t)
    stopVisualizer()
    node?.stop()
    node = null
  })
}
