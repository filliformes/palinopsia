// The dataflou node's life in the main process : the renderer turns it on or off
// (the dataflou section, persisted there like OSC), main keeps the node, its
// identity (one SKU per install, kept in userData) and each universe's bindings,
// relays values both ways, and pushes a status for the monitor.

import { app, type BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DataflouNode } from './node'
import { encodeDeclare } from './protocol'
import { DF_DECLARE_MAX, palinopsiaTree, type DfAction, type DfConfig, type DfParam, type DfStatus, type DfSub, type DfValue } from '@shared/dataflou'
import { log } from '../log'

let node: DataflouNode | null = null
let config: DfConfig | null = null
let lastError: string | null = null
let win: () => BrowserWindow | null = () => null
let inBuffer: Array<{ path: string; value: DfValue }> = []
let statusDirty = false
let lastStatusAt = 0
// The Body rule picker's actions, as the renderer last listed them; how many of
// them the tree carries now, and how many it had to leave out.
let actions: DfAction[] = []
let actionsOn = 0
let actionsDropped = 0

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

const subsFile = (universe: string): string => join(dir(), `bindings-${universe.replace(/[^\w.-]+/g, '_')}.json`)

function loadSubs(universe: string): Record<string, DfSub[]> {
  try {
    return JSON.parse(readFileSync(subsFile(universe), 'utf8')) as Record<string, DfSub[]>
  } catch {
    return {}
  }
}

function status(): DfStatus {
  if (node) return { ...node.status(), actions: actionsOn, actionsDropped }
  return {
    running: false, error: lastError, sku: '', label: config?.label ?? '', universe: config?.universe ?? '',
    address: '', tcpPort: 0, udpPort: 0, nodes: [], listeners: {}, rxPerSec: 0, txPerSec: 0,
    declareBytes: 0, actions: 0, actionsDropped: 0
  }
}

/** The tree to declare : the fixed one, then as many of the actions (in the
 *  picker's order) as fit in one frame a desktop node takes. */
function tree(): DfParam[] {
  const want = config?.actions ? actions : []
  const id = { sku: '00000000-0000-0000-0000-000000000000', label: config?.label ?? 'palinopsia', product: 'Palinopsia', version: 1, state: 'active' }
  const size = (n: number): number => encodeDeclare(0, id.sku, id.sku, 2 ** 31, id, palinopsiaTree(want.slice(0, n))).length
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
  if (n < want.length) log('warn', `[dataflou] ${want.length - n} actions left out : the tree would pass ${DF_DECLARE_MAX} bytes`)
  actionsOn = n
  actionsDropped = want.length - n
  return palinopsiaTree(want.slice(0, n))
}

function pushStatus(): void {
  statusDirty = false
  lastStatusAt = Date.now()
  win()?.webContents.send('dataflou:status', status())
}

async function configure(next: DfConfig): Promise<DfStatus> {
  const label = (next.label || 'palinopsia').trim().replace(/\s+/g, '-').slice(0, 32) || 'palinopsia'
  const universe = (next.universe || 'default').trim().slice(0, 32) || 'default'
  const want: DfConfig = { enabled: !!next.enabled, label, universe, actions: !!next.actions }
  const same = config && config.enabled === want.enabled && config.label === want.label && config.universe === want.universe
  const actionsChanged = !!config && config.actions !== want.actions
  config = want
  if (same && node) {
    // only the actions turned on or off : a new tree, no new connection
    if (actionsChanged) node.setParams(tree())
    pushStatus()
    return status()
  }
  if (same && !want.enabled) return status()
  node?.stop()
  node = null
  lastError = null
  if (want.enabled) {
    const n = new DataflouNode(
      { sku: sku(), label, universe, product: 'Palinopsia', version: 1, params: tree(), subs: loadSubs(universe) },
      {
        log: (m) => console.log(`[dataflou] ${m}`),
        onValues: (vs) => {
          if (inBuffer.length < 4000) for (const v of vs) inBuffer.push({ path: v.path, value: v.value })
        },
        onChange: () => {
          statusDirty = true
        },
        saveSubs: (subs) => {
          try {
            writeFileSync(subsFile(universe), JSON.stringify(subs, null, 2))
          } catch (e) {
            log('warn', `[dataflou] could not save the bindings : ${(e as Error).message}`)
          }
        }
      }
    )
    try {
      await n.start()
      node = n
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
      node.setParams(tree())
      log('info', `[dataflou] ${actionsOn} actions on the mesh, DECLARE ${node.declareBytes()} bytes`)
    }
  })
  // Our sources' values, sampled by the renderer (only the ones someone listens to).
  ipcMain.on('dataflou:values', (_e, values: Record<string, DfValue>) => {
    if (node && values && typeof values === 'object') node.setValues(values)
  })
  ipcMain.handle('dataflou:bind', (_e, a: { destSku: string; destPath: string; srcSku: string; srcPath: string; on: boolean }) =>
    node ? node.subscribeRemote(a.destSku, a.destPath, a.srcSku, a.srcPath, !!a.on) : false
  )
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
    node?.stop()
    node = null
  })
}
