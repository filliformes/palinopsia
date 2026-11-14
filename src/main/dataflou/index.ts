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
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DataflouNode } from './node'
import { primaryIPv4 } from './mdns'
import { encodeDeclare } from './protocol'
import { openVisualizer, stopVisualizer, visualizerAvailable, visualizerNodeChanged, visualizerScene } from './visualizer'
import type { SceneFile } from './node'
import {
  DF_DECLARE_MAX, cleanPublish, dfGroupOf, dfPublished, palinopsiaTree, type DfAction, type DfConfig, type DfParam, type DfStatus, type DfSub, type DfValue
} from '@shared/dataflou'
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
  if (node) {
    return {
      ...node.status(), published: publishedCount, actions: actionsOn, actionsDropped,
      visualizer: visClients, visualizerAvailable: visualizerAvailable()
    }
  }
  return {
    running: false, error: lastError, sku: '', label: config?.label ?? '', universe: config?.universe ?? '',
    address: '', tcpPort: 0, udpPort: 0, nodes: [], listeners: {}, rxPerSec: 0, txPerSec: 0,
    declareBytes: 0, published: 0, actions: 0, actionsDropped: 0, visualizer: visClients, visualizerAvailable: visualizerAvailable()
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
  ipcMain.handle('dataflou:bind', (_e, a: { destSku: string; destPath: string; srcSku: string; srcPath: string; on: boolean }) =>
    node ? node.subscribeRemote(a.destSku, a.destPath, a.srcSku, a.srcPath, !!a.on) : false
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
