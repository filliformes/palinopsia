// OSCQuery — self-describing OSC address space (brief §8).
//
// Serves Palinopsia's parameter tree as OSCQuery JSON over HTTP so Pandore /
// dataFLOU / TouchDesigner can auto-discover and bind every control instead of
// a hand-maintained OSC map. The renderer enumerates the address space (fixed
// controls + live shader inputs) and pushes it via `publishTree()`; this server
// nests the flat list into the OSCQuery CONTENTS tree and answers GETs.
//
// A read of any path returns the full root tree (clients traverse CONTENTS);
// `?HOST_INFO` advertises the OSC UDP port. The WebSocket value-stream (below)
// upgrades on the SAME http port: a client sends `{COMMAND:'LISTEN',DATA:path}`
// to subscribe (no LISTEN = all paths), and we push `{FULL_PATH,VALUE:[v]}`
// frames as the renderer's controls move. Per-path HTTP queries stay a refinement.

import { createServer, type Server, type IncomingMessage } from 'http'
import type { Socket } from 'net'
import { WebSocketServer, WebSocket } from 'ws'

export interface OscQueryNode {
  full_path: string
  type?: string // OSC type tag, e.g. 'f'
  range?: { min?: number; max?: number }
  value?: number | number[]
  description?: string
}

interface Container {
  full_path: string
  contents: Record<string, Container>
  leaf?: OscQueryNode
}

// A connected value-stream client + the paths it asked to LISTEN on (empty = all).
interface WsClient {
  ws: WebSocket
  listen: Set<string>
}

export class OscQueryServer {
  private tree: OscQueryNode[] = []
  private server: Server | null = null
  private oscPort = 0
  private wss: WebSocketServer | null = null
  private clients = new Set<WsClient>()
  // Fired when the connected-client count crosses 0↔1, so the renderer can start
  // or stop computing value diffs only while someone is actually listening.
  private onActive: ((active: boolean) => void) | null = null

  setOnActive(cb: (active: boolean) => void): void {
    this.onActive = cb
  }

  /** How many value-stream clients are attached (renderer gates its push loop). */
  activeClients(): number {
    return this.clients.size
  }

  /** Renderer pushes the flattened parameter tree; served on request. */
  publishTree(nodes: OscQueryNode[]): void {
    this.tree = nodes
  }

  /** Broadcast changed values to every subscribed WS client (JSON frames). */
  pushValues(updates: Array<{ path: string; value: number | number[] }>): void {
    if (!this.clients.size || !updates.length) return
    for (const c of this.clients) {
      if (c.ws.readyState !== WebSocket.OPEN) continue
      for (const u of updates) {
        if (c.listen.size && !c.listen.has(u.path)) continue
        c.ws.send(
          JSON.stringify({ FULL_PATH: u.path, VALUE: Array.isArray(u.value) ? u.value : [u.value] })
        )
      }
    }
  }

  getTree(): OscQueryNode[] {
    return this.tree
  }

  private buildRoot(): Record<string, unknown> {
    const root: Container = { full_path: '/', contents: {} }
    for (const n of this.tree) {
      const segs = n.full_path.split('/').filter(Boolean)
      let cur = root
      let path = ''
      for (let i = 0; i < segs.length; i++) {
        path += '/' + segs[i]
        if (!cur.contents[segs[i]]) cur.contents[segs[i]] = { full_path: path, contents: {} }
        cur = cur.contents[segs[i]]
        if (i === segs.length - 1) cur.leaf = n
      }
    }
    const toJson = (c: Container): Record<string, unknown> => {
      const l = c.leaf
      const o: Record<string, unknown> = { FULL_PATH: c.full_path, ACCESS: l ? 3 : 0 }
      if (l) {
        if (l.type) o.TYPE = l.type
        if (l.range) o.RANGE = [{ MIN: l.range.min, MAX: l.range.max }]
        if (l.value !== undefined) o.VALUE = Array.isArray(l.value) ? l.value : [l.value]
        if (l.description) o.DESCRIPTION = l.description
      }
      const keys = Object.keys(c.contents)
      if (keys.length) {
        const contents: Record<string, unknown> = {}
        for (const k of keys) contents[k] = toJson(c.contents[k])
        o.CONTENTS = contents
      }
      return o
    }
    return toJson(root)
  }

  /** Start the HTTP server on `httpPort`, advertising the OSC UDP `oscPort`. */
  start(httpPort: number, oscPort: number): Promise<void> {
    this.stop()
    this.oscPort = oscPort
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        // No wildcard CORS: OSCQuery clients are native, and the server is
        // localhost-bound below — we don't want arbitrary web origins reading
        // the live parameter tree.
        res.setHeader('Content-Type', 'application/json')
        const url = req.url ?? '/'
        if (url.includes('HOST_INFO')) {
          res.end(
            JSON.stringify({
              NAME: 'Palinopsia',
              OSC_PORT: this.oscPort,
              OSC_TRANSPORT: 'UDP',
              // The value-stream WebSocket upgrades on this same HTTP host:port.
              WS_IP: '127.0.0.1',
              WS_PORT: httpPort,
              EXTENSIONS: {
                ACCESS: true,
                VALUE: true,
                RANGE: true,
                TYPE: true,
                DESCRIPTION: true,
                LISTEN: true
              }
            })
          )
          return
        }
        res.end(JSON.stringify(this.buildRoot()))
      })

      // Value-stream: upgrade WS on the same server (loopback-bound like the HTTP
      // side). Clients LISTEN/IGNORE per path; we push value frames via pushValues.
      const wss = new WebSocketServer({ noServer: true })
      server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
        wss.handleUpgrade(req, socket, head, (ws) => {
          const client: WsClient = { ws, listen: new Set() }
          this.clients.add(client)
          if (this.clients.size === 1) this.onActive?.(true)
          ws.on('message', (data) => {
            try {
              const msg = JSON.parse(data.toString()) as { COMMAND?: string; DATA?: string }
              const cmd = msg.COMMAND?.toUpperCase()
              if (cmd === 'LISTEN' && msg.DATA) client.listen.add(msg.DATA)
              else if (cmd === 'IGNORE' && msg.DATA) client.listen.delete(msg.DATA)
            } catch {
              /* ignore malformed control frames */
            }
          })
          const drop = (): void => {
            if (this.clients.delete(client) && this.clients.size === 0) this.onActive?.(false)
          }
          ws.on('close', drop)
          ws.on('error', drop)
        })
      })
      this.wss = wss

      server.on('error', (e) => {
        this.server = null
        reject(e)
      })
      // Bind to loopback only — the OSCQuery tree (which advertises the OSC
      // port and serves live parameter values) should not be a LAN-visible
      // service. OSC control itself still arrives over the UDP receiver.
      server.listen(httpPort, '127.0.0.1', () => {
        this.server = server
        resolve()
      })
    })
  }

  stop(): void {
    for (const c of this.clients) {
      try {
        c.ws.close()
      } catch {
        /* ignore */
      }
    }
    const hadClients = this.clients.size > 0
    this.clients.clear()
    if (this.wss) {
      try {
        this.wss.close()
      } catch {
        /* ignore */
      }
      this.wss = null
    }
    if (hadClients) this.onActive?.(false)
    if (this.server) {
      try {
        this.server.close()
      } catch {
        /* ignore */
      }
      this.server = null
    }
  }
}
