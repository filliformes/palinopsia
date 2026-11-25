// GPU capture : the canvas → the NDI sender, off the window's thread.
//
// NDI® is a registered trademark of Vizrt NDI AB (https://ndi.video).
//
// The fast path for NDI whenever the canvas IS the clean picture being sent : in
// dome mode (the canvas is the domemaster, texel for texel, with the grid, the
// flash limiter and Black already in it), and flat with no keystone. kick() makes
// a VideoFrame of it right after the render and hands it to a worker
// (workers/gpuCaptureWorker.ts), which converts it on the graphics card, reads it
// back and passes it to the sender itself. Anything else (a keystone, no WebGPU,
// a device that keeps failing) goes through engine/frameCapture.ts as before.
//
// Never queues : past MAX_OUT frames not answered yet, kick() skips. Never
// trusted blindly : a lost device, a worker error or silence restarts the worker,
// later and later each time, and the WebGL path carries NDI meanwhile.

import GpuCaptureWorker from '../workers/gpuCaptureWorker?worker&inline'
import type { GpuFormat } from '../workers/gpuCaptureWorker'

const MAX_OUT = 4
const START_MS = 4000 // a start slower than this counts as failed
const STALL_KICKS = 150 // captures due with no answer : the worker is gone (2.5 s at 60)

export interface GpuSpec {
  w: number
  h: number
  format: GpuFormat
  fpsN: number
  fpsD: number
  tc: number
  cap: number
}

type State = 'off' | 'starting' | 'ready' | 'failed' | 'none'

/** Who a capture is for : the pipe its frames go down, and who counts them. */
interface Route {
  want: string // the window message that asks the preload for a pipe
  port: string // the one it answers with
  stats: { captured: number; skipped: number; late: number; latency: (ms: number) => void } | null
}

class GpuCapture {
  constructor(private route: () => Route) {}
  private worker: Worker | null = null
  private state: State = 'off'
  private message = ''
  private out = 0 // frames handed to the worker, not answered
  private unanswered = 0 // captures due since its last answer
  private startedAt = 0
  private fails = 0
  private retryAt = 0
  private noRoom = 0 // answers in a row saying the sender gave nothing back
  private goodAt = 0
  private msg = (e: MessageEvent): void => {
    const d = e.data as { t?: string; kind?: string } | null
    if (d?.t !== this.route().port || d.kind !== 'gpu' || !e.ports[0]) return
    if (this.worker) this.worker.postMessage({ t: 'port', port: e.ports[0] }, [e.ports[0]])
    else e.ports[0].close()
  }

  /** ready : kick away. wait : starting, skip this capture rather than run the
   *  slow path for a blink. no : use the WebGL path (why() says why). */
  want(now: number): 'ready' | 'wait' | 'no' {
    if (this.state === 'ready') {
      if (this.unanswered > STALL_KICKS) this.fail('the capture stopped answering')
      else return 'ready'
    }
    if (this.state === 'none') return 'no'
    if (this.state === 'off' || (this.state === 'failed' && now >= this.retryAt)) this.start(now)
    if (this.state === 'starting') {
      if (now - this.startedAt > START_MS) { this.fail('the graphics capture did not start'); return 'no' }
      return this.fails ? 'no' : 'wait'
    }
    return (this.state as State) === 'ready' ? 'ready' : 'no'
  }

  why(): string {
    return this.state === 'none' || this.state === 'failed' || (this.state === 'starting' && this.fails) ? this.message : ''
  }

  private start(now: number): void {
    const g = navigator as unknown as { gpu?: unknown }
    if (!g.gpu || typeof VideoFrame === 'undefined') {
      this.state = 'none'
      this.message = 'no WebGPU on this computer'
      return
    }
    this.drop()
    this.state = 'starting'
    this.startedAt = now
    try {
      const w = new GpuCaptureWorker()
      this.worker = w
      w.onmessage = (e: MessageEvent): void => { if (this.worker === w) this.onAnswer(e.data as Answer) }
      w.onerror = (e): void => { if (this.worker === w) this.fail(e.message || 'the capture worker stopped') }
      window.addEventListener('message', this.msg)
      w.postMessage({ t: 'start' })
      this.askPipe()
    } catch (e) {
      this.fail((e as Error).message)
    }
  }

  private askPipe(): void {
    window.postMessage({ t: this.route().want, kind: 'gpu' }, '*')
  }

  private onAnswer(d: Answer): void {
    const stats = this.route().stats
    if (d.t === 'ready') {
      this.state = 'ready'
      this.unanswered = 0
    } else if (d.t === 'done') {
      this.out = Math.max(0, this.out - 1)
      this.unanswered = 0
      if (d.ok) {
        if (stats) { stats.captured++; stats.latency(d.ms ?? 0) }
        this.noRoom = 0
        // ten good seconds : the next fault starts over with a short wait
        const now = performance.now()
        if (!this.goodAt) this.goodAt = now
        else if (now - this.goodAt > 10000) this.fails = 0
      } else if (d.why === 'sender') {
        if (stats) stats.late++
        // Its buffers are not coming back (a sender that went) : a fresh pipe.
        if (++this.noRoom > 120) {
          this.noRoom = 0
          this.askPipe()
        }
      } else if (d.why === 'gpu' && stats) stats.skipped++
    } else if (d.t === 'lost' || d.t === 'failed') this.fail(d.message ?? 'capture error')
  }

  private fail(message: string): void {
    console.warn('[gpuCapture]', message)
    this.drop()
    this.state = 'failed'
    this.message = message
    this.fails++
    this.goodAt = 0
    // 1 s, 2, 4 ... 60 : a driver reset is back within seconds; a machine that
    // can't do it is asked once a minute.
    this.retryAt = performance.now() + Math.min(60000, 1000 * 2 ** Math.min(6, this.fails - 1))
  }

  private drop(): void {
    window.removeEventListener('message', this.msg)
    const w = this.worker
    this.worker = null
    if (w) {
      // It gives its device and buffers back and closes; one that does not answer
      // any more is ended.
      w.onmessage = w.onerror = null
      w.postMessage({ t: 'end' })
      setTimeout(() => w.terminate(), 2000)
    }
    this.out = 0
    this.unanswered = 0
    this.noRoom = 0
  }

  /** Take the canvas as it is now. False : skipped (the card is behind). */
  kick(canvas: HTMLCanvasElement, s: GpuSpec): boolean {
    if (this.state !== 'ready' || !this.worker) return false
    this.unanswered++
    if (this.out >= MAX_OUT) return false
    let f: VideoFrame | null = null
    try {
      f = new VideoFrame(canvas, { timestamp: Math.round(s.cap * 1000) })
      this.worker.postMessage({ t: 'frame', f, ...s }, [f as unknown as Transferable])
      this.out++
      return true
    } catch (e) {
      try { f?.close() } catch { /* transferred */ }
      // (a lost context : nothing to take until the engine is rebuilt)
      this.fail((e as Error).message)
      return false
    }
  }

  /** Switched off : everything goes (the worker, its device, its buffers). */
  stop(): void {
    if (this.state === 'off') return
    this.drop()
    if (this.state === 'none') return
    this.state = 'off'
    this.fails = 0
    this.message = ''
  }

}

interface Answer { t: string; ok?: boolean; why?: string; ms?: number; message?: string }

/** What became of NDI's captures, whichever path took them. The counts of the
 *  last second are rolled with the sender's own once-a-second status (App). */
export const ndiCap = {
  captured: 0,
  skipped: 0, // not taken : the graphics card had not finished the earlier ones
  late: 0, // taken, then dropped : the sender had no room
  path: '' as '' | 'gpu' | 'slow',
  note: '', // why the slow path
  lat: 0, // smoothed ms from the picture to the sender
  latency(ms: number): void { this.lat = this.lat ? this.lat + (ms - this.lat) * 0.1 : ms },
  last: { captured: 0, skipped: 0, late: 0 },
  rolledAt: 0,
  /** NDI off : nothing of it counts any more. */
  reset(): void {
    this.captured = this.skipped = this.late = this.lat = this.rolledAt = 0
    this.last = { captured: 0, skipped: 0, late: 0 }
    this.path = ''
    this.note = ''
  },
  /** Once a second : the counts of the second that ended. */
  roll(now: number): void {
    const dt = this.rolledAt ? (now - this.rolledAt) / 1000 : 1
    if (dt < 0.5) return
    this.last = { captured: Math.round((this.captured / dt) * 10) / 10, skipped: this.skipped, late: this.late }
    this.captured = 0
    this.skipped = 0
    this.late = 0
    this.rolledAt = now
  }
}

/** Test builds only : one capture of the canvas through a worker of its own, its
 *  bytes back (compared against the WebGL path's, byte by byte). */
export async function captureOnce(canvas: HTMLCanvasElement, s: GpuSpec): Promise<ArrayBuffer> {
  const f = new VideoFrame(canvas, { timestamp: 0 }) // now, before anything draws again
  const w = new GpuCaptureWorker()
  const mc = new MessageChannel()
  try {
    return await new Promise<ArrayBuffer>((res, rej) => {
      mc.port1.onmessage = (e): void => res((e.data as { buf: ArrayBuffer }).buf)
      w.onmessage = (e: MessageEvent): void => {
        const d = e.data as Answer
        if (d.t === 'ready') {
          setTimeout(() => w.postMessage({ t: 'frame', f, ...s }, [f as unknown as Transferable]), 2500)
        } else if (d.t === 'failed' || d.t === 'lost' || (d.t === 'done' && !d.ok)) rej(new Error(d.message ?? d.why))
      }
      w.postMessage({ t: 'port', port: mc.port2 }, [mc.port2])
      w.postMessage({ t: 'start' })
    })
  } finally {
    w.terminate()
  }
}

export const gpuCapture = new GpuCapture(() => ({ want: 'opsia:want-ndiport', port: 'opsia:ndiport', stats: ndiCap }))
// A dev hot update makes a second copy of this module : the first lets go.
if (import.meta.hot) {
  const g = globalThis as { __opsiaGpuCapture?: GpuCapture[] }
  for (const c of g.__opsiaGpuCapture ?? []) c.stop()
  g.__opsiaGpuCapture = [gpuCapture]
}
