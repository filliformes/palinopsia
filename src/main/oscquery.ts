// OSCQuery — self-describing OSC address space (brief §8).
//
// Serves Palinopsia's parameter tree as OSCQuery JSON over HTTP so Pandore /
// dataFLOU / TouchDesigner can auto-discover and bind every control instead of
// a hand-maintained OSC map. The renderer enumerates the address space (fixed
// controls + live shader inputs) and pushes it via `publishTree()`; this server
// nests the flat list into the OSCQuery CONTENTS tree and answers GETs.
//
// MVP scope: a read of any path returns the full root tree (clients traverse
// CONTENTS); `?HOST_INFO` advertises the OSC UDP port. Per-path queries and the
// WebSocket value-stream are a later refinement.

import { createServer, type Server } from 'http'

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

export class OscQueryServer {
  private tree: OscQueryNode[] = []
  private server: Server | null = null
  private oscPort = 0

  /** Renderer pushes the flattened parameter tree; served on request. */
  publishTree(nodes: OscQueryNode[]): void {
    this.tree = nodes
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
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Content-Type', 'application/json')
        const url = req.url ?? '/'
        if (url.includes('HOST_INFO')) {
          res.end(
            JSON.stringify({
              NAME: 'Palinopsia',
              OSC_PORT: this.oscPort,
              OSC_TRANSPORT: 'UDP',
              EXTENSIONS: { ACCESS: true, VALUE: true, RANGE: true, TYPE: true, DESCRIPTION: true }
            })
          )
          return
        }
        res.end(JSON.stringify(this.buildRoot()))
      })
      server.on('error', (e) => {
        this.server = null
        reject(e)
      })
      server.listen(httpPort, () => {
        this.server = server
        resolve()
      })
    })
  }

  stop(): void {
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
