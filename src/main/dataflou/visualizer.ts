// The mesh visualizer : the dataflou project's own page (the colored circle of
// nodes and their parameters, the wires between them), served by Palinopsia the
// way the reference node's VisServer serves it. Its files come from
// resources/dataflou-visualizer (built by scripts/build-dataflou-visualizer.mjs
// from a dataflou checkout); its /ws socket gets a snapshot of the mesh as our
// node sees it, ten times a second, and its gestures (wire, unwire, set a value,
// forget a node) go to the node. Only on this computer : 127.0.0.1, since the
// page can rewire the whole mesh.

import http from 'http'
import { existsSync, readFile } from 'fs'
import { extname, join, normalize, resolve, sep } from 'path'
import { app, shell } from 'electron'
import { WebSocketServer, WebSocket } from 'ws'
import type { DataflouNode } from './node'
import type { DfValue } from '@shared/dataflou'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
}
const SNAPSHOT_MS = 100 // ten a second, like the reference
const SNAPSHOT_SLOW_MS = 2000 // in the page's high performance mode

export function visualizerDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'dataflou-visualizer') : join(app.getAppPath(), 'resources', 'dataflou-visualizer')
}

/** Does this build carry the page ? (it is built from a dataflou checkout) */
export function visualizerAvailable(): boolean {
  const d = visualizerDir()
  return existsSync(join(d, 'index.html')) && existsSync(join(d, 'js', 'app.js'))
}

let server: http.Server | null = null
let wss: WebSocketServer | null = null
let port = 0
let timer: ReturnType<typeof setTimeout> | null = null
let perf = false
let nodeOf: () => DataflouNode | null = () => null
let onClients: (n: number) => void = () => {}

const clients = (): WebSocket[] => (wss ? [...wss.clients].filter((c) => c.readyState === WebSocket.OPEN) : [])

function broadcast(msg: unknown): void {
  const s = JSON.stringify(msg)
  for (const c of clients()) c.send(s)
}

function snapshot(): string {
  const node = nodeOf()
  return JSON.stringify({
    type: 'snapshot',
    nodes: node ? node.visNodes() : [],
    clients: clients().length,
    core_version: '8 (Palinopsia)',
    perf_mode: perf
  })
}

function tick(): void {
  timer = null
  if (!clients().length) return
  const s = snapshot()
  for (const c of clients()) c.send(s)
  timer = setTimeout(tick, perf ? SNAPSHOT_SLOW_MS : SNAPSHOT_MS)
}

function countChanged(): void {
  const n = clients().length
  nodeOf()?.setMonitoring(n > 0 && !perf)
  onClients(n)
  if (n && !timer) tick()
}

/** Only this machine's own page : another site in the browser (or a name rebound to
 *  127.0.0.1) must not reach the mesh through it. */
const ownHost = (h: string | undefined): boolean => h === `127.0.0.1:${port}` || h === `localhost:${port}`
const ownOrigin = (o: string | undefined): boolean => o === `http://127.0.0.1:${port}` || o === `http://localhost:${port}`

function serveFile(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (!ownHost(req.headers.host)) {
    res.writeHead(403).end()
    return
  }
  const root = resolve(visualizerDir())
  let p = '/'
  try {
    p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  } catch {
    /* a malformed path : the index */
  }
  if (p.includes('\0')) {
    res.writeHead(400).end()
    return
  }
  if (p.endsWith('/')) p += 'index.html'
  const file = resolve(join(root, normalize(p)))
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end()
    return
  }
  readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found')
      return
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
    res.end(data)
  })
}

function onMessage(ws: WebSocket, raw: string): void {
  let m: Record<string, unknown>
  try {
    m = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return
  }
  const node = nodeOf()
  const str = (k: string): string => (typeof m[k] === 'string' ? (m[k] as string) : '')
  const toast = (msg: string): void => ws.send(JSON.stringify({ type: 'toast', msg }))
  switch (m.type) {
    case 'subscribe':
    case 'unsubscribe':
      if (!node || !node.subscribeRemote(str('dest_sku'), str('dest_path'), str('source_sku'), str('source_path'), m.type === 'subscribe'))
        toast('Could not reach that node')
      return
    case 'flush_node':
      node?.flush(str('sku'))
      return
    case 'set_value':
      if (!node || !node.setFromVisualizer(str('sku'), str('path'), m.value as DfValue)) toast('That parameter does not take a value')
      return
    case 'identify':
      broadcast({ type: 'identify', sku: str('sku') })
      return
    case 'perf_mode':
      perf = m.enabled === true
      broadcast({ type: 'perf_mode', enabled: perf })
      countChanged()
      return
    case 'update_param':
    case 'add_param':
    case 'delete_param':
      toast(str('sku') === node?.sku() ? "Palinopsia's parameters are its own : they change in Palinopsia" : 'Editing parameters is not done from Palinopsia')
      return
  }
}

async function start(): Promise<void> {
  const s = http.createServer(serveFile)
  await new Promise<void>((res, rej) => {
    s.once('error', rej)
    s.listen(0, '127.0.0.1', () => res())
  })
  port = (s.address() as { port: number }).port
  server = s
  wss = new WebSocketServer({ server: s, path: '/ws', verifyClient: (info: { origin: string; req: http.IncomingMessage }) => ownOrigin(info.origin) && ownHost(info.req.headers.host) })
  wss.on('connection', (ws) => {
    ws.on('message', (d) => onMessage(ws, String(d)))
    ws.on('close', () => countChanged())
    ws.send(snapshot())
    countChanged()
  })
}

/** Open the page in the browser (starting its server the first time); `open`
 *  false only starts it and gives its address. */
export async function openVisualizer(getNode: () => DataflouNode | null, clientsChanged: (n: number) => void, open = true): Promise<{ ok: boolean; url?: string; error?: string }> {
  nodeOf = getNode
  onClients = clientsChanged
  if (!visualizerAvailable()) return { ok: false, error: 'This build of Palinopsia does not carry the mesh visualizer' }
  try {
    if (!server) await start()
  } catch (e) {
    return { ok: false, error: `The visualizer could not start : ${(e as Error).message}` }
  }
  const url = `http://127.0.0.1:${port}/`
  if (open) await shell.openExternal(url)
  return { ok: true, url }
}

/** The node changed (started, stopped, renamed) : the page follows it. */
export function visualizerNodeChanged(): void {
  nodeOf()?.setMonitoring(clients().length > 0 && !perf)
}

export function stopVisualizer(): void {
  if (timer) clearTimeout(timer)
  timer = null
  for (const c of wss?.clients ?? []) c.terminate()
  wss?.close()
  server?.close()
  wss = null
  server = null
}
