// DXV3 recording worker : builds frames off the render thread (the builder is
// engine/dxvFrame.ts). The recorder runs a few of these side by side (frames are
// independent) and puts the results back in order for the file writer. Each
// message returns the DXT buffer to the page, to be refilled.

import { buildDxvFrame } from '../engine/dxvFrame'

self.onmessage = (e: MessageEvent): void => {
  const d = e.data as { seq: number; buf: ArrayBuffer; blocksPerRow: number }
  const f = buildDxvFrame(new Uint32Array(d.buf), d.blocksPerRow)
  ;(self as unknown as Worker).postMessage({ seq: d.seq, frame: f.buf, length: f.length, dxt: d.buf }, [f.buf, d.buf])
}
