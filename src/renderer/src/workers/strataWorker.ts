// Strata's clouds, made off the main thread (engine/strataClouds.ts asks) : a place takes
// up to a quarter second to deal, and a scan of four million points as long again to
// color, fit, shuffle and link : on the render thread the picture stopped for it.

import { drawCloud, fitCloud, placeCloud, pointColors, type DrawCloud, type MeshColors } from '../engine/strataPlaces'

export type ToStrataWorker = { t: 'place'; id: number; place: number } | { t: 'mesh'; id: number; mesh: MeshColors }
export type FromStrataWorker = { t: 'done'; id: number; cloud: DrawCloud } | { t: 'error'; id: number; message: string }

const g = self as unknown as {
  onmessage: ((e: MessageEvent<ToStrataWorker>) => void) | null
  postMessage(m: FromStrataWorker, transfer?: Transferable[]): void
}

g.onmessage = (e: MessageEvent<ToStrataWorker>): void => {
  const m = e.data
  try {
    const c = m.t === 'place'
      ? drawCloud(placeCloud(m.place))
      : drawCloud(fitCloud({ pos: m.mesh.pos, col: pointColors(m.mesh), n: m.mesh.pos.length / 3 }))
    if (m.t === 'mesh') m.mesh.texture?.close()
    g.postMessage({ t: 'done', id: m.id, cloud: c }, [c.pos.buffer, c.col.buffer, c.link.buffer])
  } catch (err) {
    g.postMessage({ t: 'error', id: m.id, message: (err as Error)?.message ?? String(err) })
  }
}
