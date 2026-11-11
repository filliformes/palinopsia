// The dataflou node's life in the main process : the renderer turns it on or off
// (the dataflou section, persisted there like OSC), main keeps the node, its
// identity (one SKU per install, kept in userData) and each universe's bindings,
// relays values both ways, and pushes a status for the monitor.
//
// With the actions on, a second node runs beside it, `<label>-session` : the
// actions that follow the session (scenes, Worlds, modulators, Body rules, the
// triggers of what is loaded). One DECLARE frame holds at most 32 KB and the
// whole Body rule list does not fit in one; split by heading, every action is on
// the mesh and each always lands on the same node.

import { app, type BrowserWindow, ipcMain, powerMonitor } from 'electron'
import { createHash, randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DataflouNode } from './node'
import { primaryIPv4 } from './mdns'
import { encodeDeclare } from './protocol'
import { openVisualizer, stopVisualizer, visualizerAvailable, visualizerNodeChanged, visualizerScene } from './visualizer'
import type { SceneFile } from './node'
import {
  DF_DECLARE_MAX, DF_SESSION_GROUPS, dfSessionLabel, palinopsiaTree, type DfAction, type DfConfig, type DfParam, type DfStatus, type DfSub, type DfValue
} from '@shared/dataflou'
import { log } from '../log'

let node: DataflouNode | null = null
let config: DfConfig | null = null
let lastError: string | null = null
let win: () => BrowserWindow | null = () => null
let inBuffer: Array<{ path: string; value: DfValue }> = []
let statusDirty = false
let lastStatusAt = 0
// The Body rule picker's actions, as the renderer last listed them; how many of
// them each tree carries now, and how many it had to leave out.
let actions: DfAction[] = []
let actionsOn = 0
let actionsDropped = 0
// The session node (its actions, its fit) and the chain that starts and stops it
// one step at a time.
let node2: DataflouNode | null = null
let actions2On = 0
let actions2Dropped = 0
let companionOp: Promise<void> = Promise.resolve()

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

/** The session node's SKU : made from ours, so it is the same on every run (the
 *  wires to its actions are kept by SKU). */
function sessionSku(): string {
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

let visClients = 0

function status(): DfStatus {
  const companion = node2
    ? (() => {
        const s = node2.status()
        return { sku: s.sku, label: s.label, running: s.running, actions: actions2On, actionsDropped: actions2Dropped, declareBytes: s.declareBytes }
      })()
    : null
  if (node) {
    return {
      ...node.status(), actions: actionsOn + (node2 ? actions2On : 0), actionsDropped: actionsDropped + (node2 ? actions2Dropped : 0),
      companion, visualizer: visClients, visualizerAvailable: visualizerAvailable()
    }
  }
  return {
    running: false, error: lastError, sku: '', label: config?.label ?? '', universe: config?.universe ?? '',
    address: '', tcpPort: 0, udpPort: 0, nodes: [], listeners: {}, rxPerSec: 0, txPerSec: 0,
    declareBytes: 0, actions: 0, actionsDropped: 0, companion: null, visualizer: visClients, visualizerAvailable: visualizerAvailable()
  }
}

/** A tree with as many of `want` (in the picker's order) as fit in one frame a
 *  desktop node takes : the actions it carries, the ones left out. */
function fit(want: DfAction[], fixed: boolean, label: string): { params: DfParam[]; on: number; dropped: number } {
  const id = { sku: '00000000-0000-0000-0000-000000000000', label, product: 'Palinopsia', version: 1, state: 'active' }
  const size = (n: number): number => encodeDeclare(0, id.sku, id.sku, 2 ** 31, id, palinopsiaTree(want.slice(0, n), fixed)).length
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
  if (n < want.length) log('warn', `[dataflou] ${label} : ${want.length - n} actions left out, the tree would pass ${DF_DECLARE_MAX} bytes`)
  return { params: palinopsiaTree(want.slice(0, n), fixed), on: n, dropped: want.length - n }
}

/** The first node's tree : the fixed one, then the actions of the fixed headings. */
function tree(): DfParam[] {
  const want = config?.actions ? actions.filter((a) => !DF_SESSION_GROUPS.has(a.group)) : []
  const t = fit(want, true, config?.label ?? 'palinopsia')
  actionsOn = t.on
  actionsDropped = t.dropped
  return t.params
}

/** The session node's tree : the actions of the session's headings alone. */
function tree2(): DfParam[] {
  const want = actions.filter((a) => DF_SESSION_GROUPS.has(a.group))
  const t = fit(want, false, dfSessionLabel(config?.label ?? 'palinopsia'))
  actions2On = t.on
  actions2Dropped = t.dropped
  return t.params
}

/** Start, update or stop the session node to match : it runs while the first node
 *  runs with the actions on and the session has actions to carry. */
function syncCompanion(): Promise<void> {
  companionOp = companionOp.then(async () => {
    const want = !!node && !!config?.enabled && !!config.actions && actions.some((a) => DF_SESSION_GROUPS.has(a.group))
    if (node2 && !want) {
      const gone = node2.status().sku
      node2.stop()
      node2 = null
      // the actions turned off while the first node stays : every node forgets
      // it rather than keeping it as an offline node (its wires stay saved here
      // and come back with it)
      if (node) node.flush(gone)
      statusDirty = true
    }
    if (!want || !config) return
    if (node2) {
      node2.setParams(tree2())
      return
    }
    const universe = config.universe
    const label = dfSessionLabel(config.label)
    const n = new DataflouNode(
      { sku: sessionSku(), label, universe, product: 'Palinopsia', version: 1, params: tree2(), subs: loadSubs(universe, '-session'), scenes: loadScenes(universe, '-session') },
      {
        log: (m) => console.log(`[dataflou:session] ${m}`),
        onValues: (vs) => {
          if (inBuffer.length < 4000) for (const v of vs) inBuffer.push({ path: v.path, value: v.value })
        },
        onChange: () => {
          statusDirty = true
        },
        saveSubs: (subs) => saveSubsTo(universe, '-session', subs),
        saveScenes: (s) => saveScenesTo(universe, '-session', s)
      }
    )
    try {
      await n.start()
      // turned off (or renamed) while it started : not wanted any more
      if (!node || !config?.enabled || !config.actions || config.universe !== universe || dfSessionLabel(config.label) !== label) {
        n.stop()
        return
      }
      node2 = n
      log('info', `[dataflou] ${label} on the mesh with ${actions2On} actions, DECLARE ${n.declareBytes()} bytes`)
    } catch (e) {
      log('warn', `[dataflou] the session node could not start : ${(e as Error).message}`)
      n.stop()
    }
    statusDirty = true
  })
  return companionOp
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
  const want: DfConfig = { enabled: !!next.enabled, label, universe, actions: !!next.actions }
  const same = config && config.enabled === want.enabled && config.label === want.label && config.universe === want.universe
  const actionsChanged = !!config && config.actions !== want.actions
  config = want
  if (same && node) {
    // only the actions turned on or off : a new tree, no new connection
    if (actionsChanged) {
      node.setParams(tree())
      await syncCompanion()
    }
    pushStatus()
    return status()
  }
  if (same && !want.enabled) return status()
  node?.stop()
  node = null
  await syncCompanion()
  lastError = null
  if (want.enabled) {
    const n = new DataflouNode(
      { sku: sku(), label, universe, product: 'Palinopsia', version: 1, params: tree(), subs: loadSubs(universe), scenes: loadScenes(universe) },
      {
        log: (m) => console.log(`[dataflou] ${m}`),
        onValues: (vs) => {
          if (inBuffer.length < 4000) for (const v of vs) inBuffer.push({ path: v.path, value: v.value })
        },
        onChange: () => {
          statusDirty = true
        },
        saveSubs: (subs) => saveSubsTo(universe, '', subs),
        saveScenes: (s) => saveScenesTo(universe, '', s),
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
      visualizerNodeChanged()
      log('info', `[dataflou] on the mesh as ${label} (universe ${universe}), DECLARE ${n.declareBytes()} bytes`)
    } catch (e) {
      lastError = (e as Error).message
      log('warn', `[dataflou] could not start : ${lastError}`)
      n.stop()
    }
  }
  await syncCompanion()
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
  // effect added). The tree follows only while the actions are on.
  ipcMain.on('dataflou:actions', (_e, list: unknown) => {
    if (!Array.isArray(list)) return
    const str = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length < 200
    const next = list
      .filter((a): a is DfAction => !!a && str(a.id) && str(a.path) && str(a.label) && str(a.group) && a.path.startsWith('act/'))
      .slice(0, 1000)
    const before = JSON.stringify(actions)
    actions = next
    if (node && config?.actions && JSON.stringify(next) !== before) {
      // each node takes a new tree only when its own share changed
      const share = (l: DfAction[], s: boolean): string => JSON.stringify(l.filter((a) => DF_SESSION_GROUPS.has(a.group) === s))
      const prev = JSON.parse(before) as DfAction[]
      if (share(prev, false) !== share(next, false)) {
        node.setParams(tree())
        log('info', `[dataflou] ${actionsOn} actions on ${config.label}, DECLARE ${node.declareBytes()} bytes`)
      }
      if (!node2 || share(prev, true) !== share(next, true)) void syncCompanion()
    }
  })
  // Our sources' values, sampled by the renderer (only the ones someone listens to).
  ipcMain.on('dataflou:values', (_e, values: Record<string, DfValue>) => {
    if (node && values && typeof values === 'object') node.setValues(values)
  })
  ipcMain.handle('dataflou:bind', (_e, a: { destSku: string; destPath: string; srcSku: string; srcPath: string; on: boolean }) =>
    node ? node.subscribeRemote(a.destSku, a.destPath, a.srcSku, a.srcPath, !!a.on) : false
  )
  ipcMain.handle('dataflou:io', () => [node, node2].filter((n): n is DataflouNode => !!n).map((n) => n.io()))
  // Back from sleep, or the network changed under us : each node looks for the
  // mesh again (its lost peers dialled at once, mDNS from the address we have now).
  const wakeAll = (why: string): void => {
    void node?.wake(why)
    void node2?.wake(why)
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
    const now = Date.now()
    if ((statusDirty && now - lastStatusAt > 250) || (node && now - lastStatusAt > 1000)) pushStatus()
  }, 16)
  app.on('will-quit', () => {
    clearInterval(t)
    stopVisualizer()
    node2?.stop()
    node2 = null
    node?.stop()
    node = null
  })
}
