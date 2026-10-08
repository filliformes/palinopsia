// The dataflou node's life in the main process : the renderer turns it on or off
// (the dataflou section, persisted there like OSC), main keeps the node, its
// identity (one SKU per install, kept in userData) and each universe's bindings,
// relays values both ways, and pushes a status for the monitor.

import { app, type BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DataflouNode } from './node'
import { palinopsiaTree, type DfConfig, type DfStatus, type DfSub, type DfValue } from '@shared/dataflou'
import { log } from '../log'

let node: DataflouNode | null = null
let config: DfConfig | null = null
let lastError: string | null = null
let win: () => BrowserWindow | null = () => null
let inBuffer: Array<{ path: string; value: DfValue }> = []
let statusDirty = false
let lastStatusAt = 0

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
  if (node) return node.status()
  return {
    running: false, error: lastError, sku: '', label: config?.label ?? '', universe: config?.universe ?? '',
    address: '', tcpPort: 0, udpPort: 0, nodes: [], listeners: {}, rxPerSec: 0, txPerSec: 0
  }
}

function pushStatus(): void {
  statusDirty = false
  lastStatusAt = Date.now()
  win()?.webContents.send('dataflou:status', status())
}

async function configure(next: DfConfig): Promise<DfStatus> {
  const label = (next.label || 'palinopsia').trim().replace(/\s+/g, '-').slice(0, 32) || 'palinopsia'
  const universe = (next.universe || 'default').trim().slice(0, 32) || 'default'
  const want: DfConfig = { enabled: !!next.enabled, label, universe }
  const same = config && config.enabled === want.enabled && config.label === want.label && config.universe === want.universe
  config = want
  if (same && (node || !want.enabled)) return status()
  node?.stop()
  node = null
  lastError = null
  if (want.enabled) {
    const n = new DataflouNode(
      { sku: sku(), label, universe, product: 'Palinopsia', version: 1, params: palinopsiaTree(), subs: loadSubs(universe) },
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
