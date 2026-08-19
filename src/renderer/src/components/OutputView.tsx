// OutputView : the fullscreen output window's entire content. It no longer
// re-renders the composition (which diverged on every stochastic source —
// Collage, video, feedback — because it ran its own Compositor with its own
// decoders and seeds). Instead the control window STREAMS its finished RGBA8
// frame each tick over a zero-copy MessagePort, and this blits it through the
// projection warp. The projector now shows the control window's EXACT pixels.
//
// The small `output:frame` push is still received — but only for the warp
// corners + alignment grid, which are applied on this side to the streamed
// texture (warp is post-composite, so it belongs here).

import { useEffect, useRef, useState } from 'react'
import type { OutputFrame } from '@shared/types'
import { OutputPresenter } from '../engine/OutputPresenter'

export function OutputView(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Re-keys the whole effect after a GPU driver reset (same recovery as the
  // control window : preventDefault on `lost`, rebuild on `restored`).
  const [glEpoch, setGlEpoch] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let restoreFallback: number | null = null
    const onLost = (e: Event): void => {
      e.preventDefault()
      console.warn('[output gl] context LOST — awaiting restore')
      restoreFallback = window.setTimeout(() => setGlEpoch((n) => n + 1), 6000)
    }
    const onRestored = (): void => {
      console.warn('[output gl] context restored — rebuilding')
      if (restoreFallback) window.clearTimeout(restoreFallback)
      setGlEpoch((n) => n + 1)
    }
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)
    const offGl = (): void => {
      if (restoreFallback) window.clearTimeout(restoreFallback)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
    }

    let presenter: OutputPresenter | null = null
    try {
      presenter = new OutputPresenter(canvas)
    } catch (e) {
      console.error('[output presenter]', (e as Error).message)
      offGl()
      return
    }

    // The streamed frame arrives over the MessagePort the preload relays here.
    // The port is two-way : we report our native drawing-buffer size back so the
    // control streams at exactly our resolution (no 4K over-read, no soft upscale).
    let port: MessagePort | null = null
    let reportedW = 0
    let reportedH = 0
    const onPort = (e: MessageEvent): void => {
      if (e.data !== 'opsia:pixelport' || !e.ports[0]) return
      port = e.ports[0]
      port.onmessage = (m: MessageEvent): void => {
        const d = m.data as { w: number; h: number; buf: ArrayBuffer }
        if (!d || !d.buf) return
        presenter?.present(d.w, d.h, new Uint8Array(d.buf))
        // present() sized the canvas to the physical output; report it upstream.
        if (canvas.width !== reportedW || canvas.height !== reportedH) {
          reportedW = canvas.width
          reportedH = canvas.height
          port?.postMessage({ type: 'outsize', w: reportedW, h: reportedH })
        }
      }
      port.start()
    }
    window.addEventListener('message', onPort)
    window.postMessage('opsia:want-pixelport', '*')

    // Warp corners + grid ride the small composition push (cheap metadata).
    const off = window.api.onOutputFrame((f: OutputFrame) => {
      presenter?.setWarp(f.warpEnabled ? f.warpCorners : null, !!f.warpGrid)
    })

    return () => {
      offGl()
      off()
      window.removeEventListener('message', onPort)
      if (port) port.onmessage = null
      try {
        presenter?.dispose()
      } catch {
        /* context already gone after a GPU reset */
      }
    }
  }, [glEpoch])

  return (
    <div className="fixed inset-0 bg-black">
      <canvas ref={canvasRef} className="h-full w-full bg-black" />
    </div>
  )
}
