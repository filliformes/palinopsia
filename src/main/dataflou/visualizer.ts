// The mesh visualizer : the dataflou project's own page (the colored circle of
// nodes and their parameters, the wires between them), served by Palinopsia the
// way dataflou-node serves it (its VisualizerHost, src/cli/visualizer.cpp). Its files
// come from resources/dataflou-visualizer (built by
// scripts/build-dataflou-visualizer.mjs from a dataflou checkout); its /ws socket gets
// the core's own snapshot of the world, ten times a second, and its gestures (wire,
// unwire, shape, set a value, forget, locate, scenes, the phase, halt) go to the node
// through the C interface. What that interface does not offer (editing another node's
// parameters, another node's link) the page is told. Only on this computer :
// 127.0.0.1, since the page can rewire the whole mesh.

import http from 'http'
import { existsSync, readFile } from 'fs'
import { extname, join, normalize, resolve, sep } from 'path'
import { app, shell } from 'electron'
import { WebSocketServer, WebSocket } from 'ws'
import type { DataflouNode } from './node'
import { dfAddonVersion } from './addon'
import type { DfAxis, DfValue } from '@shared/dataflou'

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
const SNAPSHOT_SLOW_MS = 2000 // in presentation : the page shows the structure, not the show's values

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
let nodeOf: () => DataflouNode | null = () => null
let onClients: (n: number) => void = () => {}
let onUniverse: (name: string) => void = () => {}

/** A universe name as the core takes it : 1 to 32 characters, none of / \ : * ? " < > | */
const validUniverse = (s: string): boolean => s.length >= 1 && s.length <= 32 && !/[/\\:*?"<>|]/.test(s)

/** Something the page shows beside the world : a cue applied, a param located, halt. */
export function visualizerSay(msg: unknown): void {
  broadcast(msg)
}

const clients = (): WebSocket[] => (wss ? [...wss.clients].filter((c) => c.readyState === WebSocket.OPEN) : [])

function broadcast(msg: unknown): void {
  const s = JSON.stringify(msg)
  for (const c of clients()) c.send(s)
}

// The world as the core says it, and what the page reads beside it.
async function snapshot(): Promise<string> {
  const node = nodeOf()
  const extra = {
    clients: clients().length,
    core_version: `${dfAddonVersion()?.core ?? ''} (Palinopsia)`,
    perf_mode: !!node?.presentation,
    phase: node?.presentation ? 'presentation' : 'preparation',
    halted: !!node?.halted,
    ...(node ? { universe: node.universe() } : {})
  }
  const json = node ? await node.worldJson() : null
  if (!json || !json.startsWith('{"type":"snapshot"') || !json.endsWith('}')) return JSON.stringify({ type: 'snapshot', nodes: [], host_ips: [], incompatible: [], ...extra })
  // (said once by the core, not parsed and written again here)
  return `${json.slice(0, -1)},${JSON.stringify(extra).slice(1)}`
}

let sending = false
async function tick(): Promise<void> {
  timer = null
  if (!clients().length || sending) return
  sending = true
  const s = await snapshot()
  sending = false
  // (a page that does not read : its next snapshot takes this one's place)
  for (const c of clients()) if (c.bufferedAmount < 4_000_000) c.send(s)
  if (!timer && clients().length) timer = setTimeout(() => void tick(), nodeOf()?.presentation ? SNAPSHOT_SLOW_MS : SNAPSHOT_MS)
}

function countChanged(): void {
  const n = clients().length
  nodeOf()?.setMonitoring(n > 0)
  onClients(n)
  if (n && !timer) void tick()
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
  const num = (k: string): number | null => (typeof m[k] === 'number' && Number.isFinite(m[k]) ? (m[k] as number) : null)
  if (!node) {
    toast('Palinopsia is not on the mesh')
    return
  }
  switch (m.type) {
    case 'subscribe': {
      // "pick" : one instance of a population (by its id, or by rank)
      const pick = m.pick as { id?: unknown; rank?: unknown } | undefined
      const by = typeof pick?.id === 'number' ? 'id' : typeof pick?.rank === 'number' ? 'rank' : null
      const done = by
        ? node.connectPick(str('dest_sku'), str('dest_path'), str('source_sku'), str('source_path'), by, (by === 'id' ? pick!.id : pick!.rank) as number)
        : node.connect(str('dest_sku'), str('dest_path'), str('source_sku'), str('source_path'))
      void done.then((ok) => ok || toast('That connection was not made : no such end, or that node is not reachable'))
      return
    }
    case 'unsubscribe':
      void node.disconnect(str('dest_sku'), str('dest_path'), str('source_sku'), str('source_path')).then((ok) => ok || toast('Could not reach that node'))
      return
    case 'unsubscribe_id': {
      // a whole connection, by its id : its ends, as the world has them
      const sku = str('dest_sku'), id = str('id')
      void connectionOf(sku, id).then((c) => {
        if (c) void node.disconnect(sku, c.dest, c.sku, c.source)
        else toast('That connection is not there any more')
      })
      return
    }
    case 'link_edit': {
      const sku = str('dest_sku'), id = str('id')
      if (sku !== node.sku()) {
        toast("Another node's links are shaped from its own page or from dataflou-node")
        return
      }
      if (!Array.isArray(m.axes) || str('source') || m.reset === true) {
        toast('Palinopsia shapes a link; which source feeds it is the wire itself')
        return
      }
      const axes = (m.axes as unknown[]).slice(0, 4).map(cleanAxis)
      void connectionOf(sku, id).then((c) => {
        // (one link of a group's connection : its two params, by their own paths)
        const rel = str('dest')
        const from = c?.links?.find((l) => l.dest === rel)?.source ?? rel
        return c ? node.transform(rel ? `${c.dest}/${rel}` : c.dest, c.sku, rel ? `${c.source}/${from}` : c.source, axes) : false
      }).then((ok) => ok || toast('That link could not be shaped'))
      return
    }
    case 'flush_node':
      node.forget(str('sku'))
      return
    case 'forget_offline':
      node.forgetOffline(m.mesh === true)
      return
    case 'set_value':
      void setValue(node, str('sku'), str('path'), m.value).then((ok) => ok || toast('That parameter does not take this value from here'))
      return
    case 'identify':
      // (a node shows itself; this one is the only one that can be asked from here)
      if (!str('sku') || str('sku') === node.sku()) node.identify()
      return
    case 'locate':
      void node.locate(str('sku'), str('path'), num('ms') ?? 1500)
      return
    case 'halt':
      if (typeof m.on === 'boolean') node.halt(m.on)
      return
    case 'perf_mode':
      if (typeof m.enabled === 'boolean') phase(node, m.enabled)
      return
    case 'phase':
      phase(node, m.phase === 'presentation')
      return
    case 'scene': {
      // cue the universe : every node applies its own slot (recall) or saves its
      // own connections in it (store); the outcome comes back as a 'scene' message
      const slot = num('slot') ?? 0
      if (Number.isInteger(slot) && slot >= 1 && slot <= 255 && (m.op === 'recall' || m.op === 'store')) node.scene(m.op, slot)
      else toast('That scene slot is not there')
      return
    }
    case 'set_universe': {
      // move the node to another universe : Palinopsia changes it in its own
      // settings (the Connect tab shows it), the node starts again there
      const name = str('universe').trim()
      if (!validUniverse(name)) {
        toast('Invalid universe name: 1-32 characters, none of / \\ : * ? " < > |')
        return
      }
      if (name !== node.universe()) onUniverse(name)
      broadcast({ type: 'universe', universe: name })
      return
    }
    case 'update_param':
    case 'add_param':
    case 'delete_param':
      toast(str('sku') === node.sku() ? "Palinopsia's parameters are its own : they change in Palinopsia" : 'Editing parameters is not done from Palinopsia')
      return
  }
}

function phase(node: DataflouNode, on: boolean): void {
  node.setPresentation(on)
  node.presentation = on // (said back at once; the next read confirms it)
  broadcast({ type: 'perf_mode', enabled: on, phase: on ? 'presentation' : 'preparation', pinned: false })
}

/** A connection of a node, by its id. */
type Conn = { id: string; dest: string; sku: string; source: string; links?: Array<{ dest: string; source: string }> }
async function connectionOf(sku: string, id: string): Promise<Conn | null> {
  try {
    const w = JSON.parse((await nodeOf()?.worldJson()) ?? '{}') as { nodes?: Array<{ sku: string; connections?: Conn[] }> }
    return w.nodes?.find((n) => n.sku === sku)?.connections?.find((c) => c.id === id) ?? null
  } catch {
    return null
  }
}

function cleanAxis(x: unknown): DfAxis {
  const a = (x ?? {}) as Record<string, unknown>
  const pair = (v: unknown): [number, number] | undefined => (Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [v[0], v[1]] : undefined)
  const curve = Array.isArray(a.curve) ? a.curve.map(pair).filter((p): p is [number, number] => !!p).slice(0, 16) : []
  const i = pair(a.in), o = pair(a.out)
  return { ...(i ? { in: i } : {}), ...(o ? { out: o } : {}), ...(curve.length ? { curve } : {}), ...(a.free === true ? { free: true } : {}) }
}

/** A value from the page, as the parameter's type takes it. */
function setValue(node: DataflouNode, sku: string, path: string, value: unknown): Promise<boolean> {
  const p = node.nodes.find((n) => n.sku === sku)?.params.find((x) => x.path === path)
  const list = Array.isArray(value) && value.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (value as number[]) : null
  const hex = typeof value === 'string' ? /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim()) : null
  let how = ''
  let v: DfValue | null = null
  if (p?.type === 'trigger') how = 'fire'
  else if (p?.type === 'array') {
    how = 'array'
    if (list) v = list
    // one value : all of them
    else if (typeof value === 'number' || typeof value === 'boolean') v = new Array<number>(p.size ?? 1).fill(Number(value))
  } else if (p?.type === 'colour' && (list || hex)) {
    how = 'colour'
    v = list ?? [1, 3, 5, 7].flatMap((i) => (i < value!.toString().trim().length ? [parseInt(value!.toString().trim().slice(i, i + 2), 16)] : []))
  } else if (list) {
    how = 'v'
    v = list
  } else if (typeof value === 'boolean') {
    how = 'bool'
    v = value
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    how = 'number'
    v = value
  } else if (typeof value === 'string') {
    how = 'string'
    v = value
  }
  if (!how || (how !== 'fire' && v === null)) return Promise.resolve(false)
  return node.setRemote(sku, path, how, v)
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
    void snapshot().then((s) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(s)
    })
    countChanged()
  })
}

/** Open the page in the browser (starting its server the first time); `open`
 *  false only starts it and gives its address. */
export async function openVisualizer(getNode: () => DataflouNode | null, clientsChanged: (n: number) => void, open = true, universeWanted?: (name: string) => void): Promise<{ ok: boolean; url?: string; error?: string }> {
  nodeOf = getNode
  onClients = clientsChanged
  if (universeWanted) onUniverse = universeWanted
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
  nodeOf()?.setMonitoring(clients().length > 0)
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
