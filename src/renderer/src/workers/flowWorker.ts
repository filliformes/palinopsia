// The Body camera's motion field, off the main thread (engine/bodyTracker.ts,
// the Motion toggle). Reading a camera frame back into pixels waits for the
// graphics card; on the main thread that wait landed in the picture's frames (a
// 400 ms stall measured under a heavy picture). Here it only holds this worker.
//
// Messages in  : frame {bitmap (the camera frame, already scaled to the grid),
//                dt, mirror, id} (the bitmap is transferred) · reset
// Messages out : flow {stats, id, ms}

import { FlowField } from '../engine/flowField'

export {} // a module : its names stay its own

let field: FlowField | null = null
let cv: OffscreenCanvas | null = null
let cx: OffscreenCanvasRenderingContext2D | null = null
let gray: Float32Array | null = null

self.onmessage = (e: MessageEvent): void => {
  const m = e.data
  if (m.t === 'reset') {
    field?.reset()
    return
  }
  if (m.t !== 'frame') return
  const bmp = m.bitmap as ImageBitmap
  const t0 = performance.now()
  const w = bmp.width, h = bmp.height
  if (!field || !cv || cv.width !== w || cv.height !== h) {
    field = new FlowField(w, h)
    cv = new OffscreenCanvas(w, h)
    cx = cv.getContext('2d', { willReadFrequently: true })
    gray = new Float32Array(w * h)
  }
  if (!cx || !gray) { bmp.close(); return }
  cx.drawImage(bmp, 0, 0)
  bmp.close()
  const d = cx.getImageData(0, 0, w, h).data
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) / 255
  const stats = field.push(gray, m.dt, false, !!m.mirror)
  self.postMessage({ t: 'flow', stats, id: m.id, ms: performance.now() - t0 })
}
