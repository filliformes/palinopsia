// Projector relay : posts each frame to the output window, OFF the render thread.
//
// The output window is another process, so posting a frame to it copies it
// (a 3170×1783 frame : ~19 ms on the posting thread, measured). Done from the
// render loop, that copy came out of every frame's budget. The page transfers
// the frame here instead (no copy, same process) and this worker pays the copy.
// Messages from the output window (its drawing-buffer size) go back to the page.

let port: MessagePort | null = null

self.onmessage = (e: MessageEvent): void => {
  const d = e.data as { t: string; port?: MessagePort; w?: number; h?: number; buf?: ArrayBuffer }
  if (d.t === 'port' && d.port) {
    try { port?.close() } catch { /* ignore */ }
    port = d.port
    port.onmessage = (m: MessageEvent): void => (self as unknown as Worker).postMessage({ t: 'out', data: m.data })
    port.start()
    return
  }
  if (d.t === 'frame' && d.buf) {
    if (port) port.postMessage({ w: d.w, h: d.h, buf: d.buf }, [d.buf])
    ;(self as unknown as Worker).postMessage({ t: 'sent' })
  }
}
