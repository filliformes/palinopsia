// OutputView : the fullscreen output window's entire content. It no longer
// re-renders the composition (which diverged on every stochastic source,
// like Collage, video and feedback, because it ran its own Compositor with its own
// decoders and seeds). Instead the control window STREAMS its finished RGBA8
// frame each tick over a zero-copy MessagePort, and this blits it through the
// projection warp. The projector now shows the control window's EXACT pixels.
//
// The small `output:frame` push is still received, but only for the warp
// corners + alignment grid, which are applied on this side to the streamed
// texture (warp is post-composite, so it belongs here).

import { useEffect, useRef, useState } from 'react'
import type { OutputWarp } from '@shared/types'
import { OutputPresenter } from '../engine/OutputPresenter'
import { bumpGlGeneration } from '../engine/glGeneration'

export function OutputView(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Re-keys the whole effect after a GPU driver reset (same recovery as the
  // control window : preventDefault on `lost`, rebuild on `restored`).
  const [glEpoch, setGlEpoch] = useState(0)

  // What this window says, for one second, about getting out of it. Null once
  // it has been said.
  const [hint, setHint] = useState<string | null>(null)

  // Escape hatch. The output usually holds focus, and it is borderless : no
  // titlebar, no close button, and the operator window behind it. On one display
  // it covers the only UI that could dismiss it, so this window has to answer
  // for itself. Two behaviors, because the stakes differ:
  //
  //   · an INSTALLATION (kiosk) : Esc or O HELD for 1.5 s, so a key brushed by a
  //     visitor (or a cat) cannot end the show. Ctrl/Cmd+Shift+O is the global
  //     backstop in main for when focus is elsewhere.
  //   · a plain fullscreen output that covers the control window : Esc at a tap
  //     closes it. There is no show to protect, nothing is lost by closing, and
  //     it reopens from the same button that opened it. Holding a key with no
  //     feedback reads exactly like a dead keyboard, which is how this window
  //     used to strand people : the handler was armed only for an installation,
  //     so Esc did nothing at all here.
  //   · an output the control window is NOT behind (a projector on another
  //     display, a span, a framed window) : Esc hands focus back to the control
  //     window and the show goes on. This window takes focus as it opens, so an
  //     Esc meant for the Output page landed here and closed the projector.
  //
  // Main decides which (outputEscMode), from the LIVE installation state and
  // where the two windows sit : `kioskConfig().kiosk` is the SETTING, which
  // stays on after an exit-kiosk.
  useEffect(() => {
    let armed: boolean | null = null
    let hold = 0
    window.api
      .outputEscMode()
      .then((mode) => {
        armed = mode === 'hold'
        // Said only where the operator is the one looking : an installation's
        // projector is the audience's, and "hold Esc to exit" on it is an
        // invitation. A projector across the room needs no instructions either.
        if (mode === 'close') setHint('Esc to close')
      })
      .catch(() => {
        armed = false
      })
    const isExitKey = (e: KeyboardEvent): boolean => e.key === 'Escape' || e.key === 'o' || e.key === 'O'
    const onKey = (e: KeyboardEvent): void => {
      if (armed === null || e.repeat) return
      if (!armed) {
        // Esc only : O is the one a sleeve catches, and here it would close at a touch.
        if (e.key === 'Escape') void window.api.outputEscape()
        return
      }
      if (!isExitKey(e)) return
      window.clearTimeout(hold)
      hold = window.setTimeout(() => void window.api.kioskExit(), 1500)
    }
    const onUp = (e: KeyboardEvent): void => {
      if (isExitKey(e)) window.clearTimeout(hold)
    }
    const onBlur = (): void => window.clearTimeout(hold)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.clearTimeout(hold)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // One second, then gone for the life of the window : long enough to read six
  // words, short enough that it is never part of the picture. A projector feed
  // being filmed or recorded keeps 1 s of text and no more.
  useEffect(() => {
    if (hint == null) return
    const id = window.setTimeout(() => setHint(null), 1000)
    return () => window.clearTimeout(id)
  }, [hint])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let restoreFallback: number | null = null
    const onLost = (e: Event): void => {
      e.preventDefault()
      bumpGlGeneration() // every per-context GL cache rebuilds (engine/glGeneration.ts)
      console.warn('[output gl] context LOST : awaiting restore')
      restoreFallback = window.setTimeout(() => setGlEpoch((n) => n + 1), 6000)
    }
    const onRestored = (): void => {
      bumpGlGeneration() // anything built while lost was built dead
      console.warn('[output gl] context restored : rebuilding')
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
      window.api.kioskGlFailed('output') // an installation relaunches
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
    const off = window.api.onOutputFrame((f: OutputWarp) => {
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
      {hint != null && (
        <div
          className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-black/60 px-2 py-1 font-mono text-[11px] tracking-wide text-white/70"
          aria-hidden="true"
        >
          {hint}
        </div>
      )}
    </div>
  )
}
