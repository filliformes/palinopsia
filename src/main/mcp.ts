// Palinopsia as an MCP server : an agent (Claude Code, any MCP client on this
// computer) reads and plays the instrument through the tools in
// shared/mcpTools.ts. Off by default; this computer only (127.0.0.1); the
// page runs every tool on the same write path as the UI, each change one
// undo step, and nothing here reaches the Flash safety limiter.
//
// Transport : MCP's Streamable HTTP, the plain-JSON form. POST /mcp carries a
// JSON-RPC message, answered with one JSON response (notifications : 202).
// No server-sent stream (GET : 405) and no session ids : every request stands
// alone, so a client survives an app restart without re-initialising.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { app, ipcMain, type BrowserWindow } from 'electron'
import { MCP_TOOLS, type McpCall, type McpResult, type McpStatus } from '@shared/mcpTools'

const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const MAX_BODY = 4 * 1024 * 1024 // a shader source with room to spare
const CALL_TIMEOUT_MS = 30000

const INSTRUCTIONS = [
  'Palinopsia is a live visual instrument : four layers (each two sources A/B mixed, with effect racks) over a background, then master effects, played by a performer who may be on stage.',
  'Start with get_state; look with snapshot after a change, and judge what you see.',
  'Controls take values in their own units (describe_shader has the ranges). Units are addressed L1.A, L1.fx.2, master.fx.1, master.context, bg.',
  'Write new sources or effects with write_shader : it compiles, shows you the result, and saves them as the performer\'s own (never over one of theirs unless they ask).',
  'Each change you make is one undo step for the performer (Ctrl+Z), and a result says when one made none. Your undo takes back only your own last changes, never the performer\'s. Make deliberate changes, a few at a time, and say what you changed.'
].join('\n')

type GetWindow = () => BrowserWindow | null

let server: Server | null = null
// bumped on every start and stop : a request on a connection kept alive from an
// earlier server (turned off, or moved to another port) is refused
let generation = 0
let status: McpStatus = { listening: false, port: 0 }
let clientName = ''
let nextId = 1
const pending = new Map<number, { resolve: (r: McpResult) => void; timer: ReturnType<typeof setTimeout> }>()

function rpcResult(id: unknown, result: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result }
}
function rpcError(id: unknown, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

/** Only this computer, and never a web page : the Host must be this machine
 *  (DNS rebinding), an Origin, if any, a local one (a sandboxed page sends
 *  "null" : refused). JSON only (checked in handle) : a page cannot post it
 *  without a preflight this server never answers. */
function allowed(req: IncomingMessage): boolean {
  const host = String(req.headers.host ?? '').toLowerCase()
  const hostOk = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)
  const origin = req.headers.origin
  const originOk = !origin || /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(origin)
  return hostOk && originOk
}

function callPage(getWin: GetWindow, name: string, args: Record<string, unknown>): Promise<McpResult> {
  const win = getWin()
  if (!win || win.isDestroyed()) return Promise.resolve({ content: [{ type: 'text', text: 'Palinopsia has no window open.' }], isError: true })
  const id = nextId++
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve({ content: [{ type: 'text', text: `${name} took too long (no answer from the page).` }], isError: true })
    }, CALL_TIMEOUT_MS)
    pending.set(id, { resolve, timer })
    const call: McpCall = { id, name, args, client: clientName }
    win.webContents.send('mcp:call', call)
  })
}

async function handleMessage(getWin: GetWindow, msg: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const id = msg.id
  const method = typeof msg.method === 'string' ? msg.method : ''
  const isRequest = id !== undefined && id !== null
  // a response from the client (to nothing this server asked) : accepted, no answer
  if (!method && ('result' in msg || 'error' in msg)) return null
  if (!method) return isRequest ? rpcError(id, -32600, 'Invalid request') : null
  const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Record<string, unknown>
  switch (method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
      const info = params.clientInfo as { name?: string; title?: string } | undefined
      clientName = String(info?.title ?? info?.name ?? 'an agent').slice(0, 60)
      getWin()?.webContents.send('mcp:client', clientName)
      return rpcResult(id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'palinopsia', title: 'Palinopsia', version: app.getVersion() },
        instructions: INSTRUCTIONS
      })
    }
    case 'ping':
      return isRequest ? rpcResult(id, {}) : null
    case 'tools/list':
      return rpcResult(id, {
        tools: MCP_TOOLS.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { title: t.title, readOnlyHint: !!t.readOnly, destructiveHint: !!t.destructive, openWorldHint: false }
        }))
      })
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : ''
      if (!MCP_TOOLS.some((t) => t.name === name)) return rpcError(id, -32602, `Unknown tool: ${name}`)
      const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>
      return rpcResult(id, await callPage(getWin, name, args))
    }
    default:
      // notifications (initialized, cancelled…) need no answer
      if (!isRequest) return null
      return rpcError(id, -32601, `Method not found: ${method}`)
  }
}

function send(res: ServerResponse, code: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(code)
    res.end()
    return
  }
  const text = JSON.stringify(body)
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(text)
}

function handle(getWin: GetWindow, req: IncomingMessage, res: ServerResponse): void {
  if (!allowed(req)) return send(res, 403, rpcError(null, -32000, 'Only this computer may connect.'))
  const path = (req.url ?? '/').split('?')[0]
  if (path !== '/mcp' && path !== '/') return send(res, 404)
  if (req.method === 'GET') {
    // no server-sent stream : the client polls nothing and posts its requests
    res.writeHead(405, { Allow: 'POST' })
    return void res.end()
  }
  if (req.method === 'DELETE') return send(res, 200)
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST' })
    return void res.end()
  }
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    return send(res, 415, rpcError(null, -32000, 'Send JSON (Content-Type: application/json).'))
  }
  const chunks: Buffer[] = []
  let size = 0
  let dropped = false
  req.on('data', (c: Buffer) => {
    size += c.length
    if (size > MAX_BODY) {
      dropped = true
      send(res, 413, rpcError(null, -32000, 'Request too large.'))
      req.destroy()
      return
    }
    chunks.push(c)
  })
  req.on('end', () => {
    if (dropped) return
    let body: unknown
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return send(res, 400, rpcError(null, -32700, 'Parse error'))
    }
    const batch = Array.isArray(body)
    const list: unknown[] = Array.isArray(body) ? body : [body]
    const msgs = list.filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    void Promise.all(
      msgs.map((m) => handleMessage(getWin, m).catch((e: unknown) => rpcError(m.id, -32603, (e as Error).message)))
    ).then((out) => {
      const replies = out.filter((r): r is Record<string, unknown> => r !== null)
      if (!replies.length) return send(res, 202)
      send(res, 200, batch ? replies : replies[0])
    })
  })
}

function stop(): void {
  generation++
  if (server) {
    try { server.close() } catch { /* already down */ }
    // keep-alive connections would go on serving : cut them
    try { server.closeAllConnections() } catch { /* none */ }
    server = null
  }
  status = { listening: false, port: 0 }
  for (const [, p] of pending) {
    clearTimeout(p.timer)
    p.resolve({ content: [{ type: 'text', text: 'The agent connection was turned off.' }], isError: true })
  }
  pending.clear()
}

function start(getWin: GetWindow, port: number): Promise<McpStatus> {
  stop()
  const gen = ++generation
  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      if (gen !== generation) {
        res.writeHead(503, { Connection: 'close' })
        return void res.end()
      }
      try {
        handle(getWin, req, res)
      } catch (e) {
        try { send(res, 500, rpcError(null, -32603, (e as Error).message)) } catch { /* gone */ }
      }
    })
    s.once('error', (e: NodeJS.ErrnoException) => {
      status = { listening: false, port: 0, error: e.code === 'EADDRINUSE' ? `port ${port} is taken by another app` : e.message }
      resolve(status)
    })
    s.listen(port, '127.0.0.1', () => {
      server = s
      status = { listening: true, port }
      resolve(status)
    })
  })
}

export function registerMcp(getWin: GetWindow): void {
  ipcMain.handle('mcp:configure', async (_e, enabled: unknown, port: unknown) => {
    const p = Math.round(Number(port))
    if (!enabled) {
      stop()
      return status
    }
    if (!(p >= 1024 && p <= 65535)) return { listening: false, port: 0, error: 'the port must be 1024-65535' }
    if (status.listening && status.port === p) return status
    return start(getWin, p)
  })
  ipcMain.on('mcp:result', (_e, id: unknown, result: unknown) => {
    const p = pending.get(Number(id))
    if (!p) return
    pending.delete(Number(id))
    clearTimeout(p.timer)
    const r = result as McpResult | null
    p.resolve(r && Array.isArray(r.content) ? r : { content: [{ type: 'text', text: 'The page gave no answer.' }], isError: true })
  })
  app.on('will-quit', stop)
}
