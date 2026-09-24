// Output recorder. Two kinds of take :
//
// · DXV3 (Resolume's GPU codec), REAL TIME : the engine compresses each frame to
//   DXT1 on the GPU (engine/frameCapture 'dxt1', read back asynchronously), a
//   few workers turn the blocks into DXV3 frames (workers/dxvWorker.ts), and the
//   preload writes the QuickTime file as it goes (src/preload/recWriter.ts). No
//   video encoder in the path, so no size limit : the 4096² dome master records
//   at full size (bigger masters are scaled to 4096). Constant frame rate : when
//   the engine falls behind the record rate, the next frame is written again for
//   the ticks it missed, so the clip always runs in real time. It records the
//   CLEAN picture (before keystone). No sound.
//
// · ENCODER formats : MediaRecorder captures the output canvas into a HIGH-bitrate,
//   hardware-accelerated intermediate (H.264 where the platform offers it),
//   streams the chunks to main, and ffmpeg turns that into the chosen delivery
//   format on stop (fast stream-copy remux when codecs match; a real transcode
//   for ProRes / FFV1 / uncompressed / H.265 / VP9). The hardware encoder has a
//   size limit (3840×2160 on this Windows/Chromium, measured : 4096×2304 and the
//   4096² dome are refused), checked up front by encoderAccepts().

import { sonifyEngine } from './audio/sonify'
import { useStore } from './store'
import { showToast } from './components/Toast'
import { ndiRate } from '@shared/ndi'
import type { Compositor } from './engine/Compositor'
import DxvWorker from './workers/dxvWorker?worker&inline'

/** The longest edge a DXV3 take records at (a bigger dome master is scaled). */
export const DXV_MAX_EDGE = 4096

/** Would this machine's video encoder take a w×h canvas ? (the encoder formats
 *  go through it; MediaRecorder uses the same hardware encoder as WebCodecs, so
 *  WebCodecs answers for it.) Cached per size. */
const acceptCache = new Map<string, Promise<boolean>>()
export function encoderAccepts(w: number, h: number): Promise<boolean> {
  const key = `${w}x${h}`
  let p = acceptCache.get(key)
  if (!p) {
    p = (async () => {
      try {
        if (typeof VideoEncoder === 'undefined') return w * h <= 3840 * 2160
        // Size only : adding framerate 60 made Windows' encoder say no even at
        // sizes it records fine (measured), so asking for it would grey out
        // formats that work.
        const r = await VideoEncoder.isConfigSupported({
          codec: 'avc1.640034', width: w, height: h, hardwareAcceleration: 'prefer-hardware'
        })
        return !!r.supported
      } catch {
        return false
      }
    })()
    acceptCache.set(key, p)
  }
  return p
}

// Intermediate codec preference: H.264 first (hardware-encoded on Windows/macOS
// Chromium → smooth + cheap), then VP9, then VP8. Each maps to what we tell main.
const INTERMEDIATES: Array<{ mime: string; ext: string; codec: string }> = [
  { mime: 'video/x-matroska;codecs=avc1', ext: 'mkv', codec: 'h264' },
  { mime: 'video/mp4;codecs=avc1', ext: 'mp4', codec: 'h264' },
  { mime: 'video/webm;codecs=vp9', ext: 'webm', codec: 'vp9' },
  { mime: 'video/webm;codecs=vp8', ext: 'webm', codec: 'vp8' }
]

function pickIntermediate(withAudio: boolean): { mime: string; ext: string; codec: string } | null {
  if (typeof MediaRecorder === 'undefined') return null
  return (
    INTERMEDIATES.find((i) => {
      try {
        // With sonification running the intermediate must mux an Opus track :
        // test the combined mime (Chromium's mp4 muxer may refuse audio, in
        // which case we fall through to webm, which always takes vp9+opus).
        return MediaRecorder.isTypeSupported(withAudio ? `${i.mime},opus` : i.mime)
      } catch {
        return false
      }
    }) ?? null
  )
}

export type RecordingFormat = { id: string; label: string; kind: 'realtime' | 'encoder' }

/** Delivery formats offered to the UI : comes from main (ffmpeg-gated). */
export async function recordingFormats(): Promise<RecordingFormat[]> {
  try {
    return await window.api.recordingFormats()
  } catch {
    return [{ id: 'dxv3', label: 'DXV3 · Resolume (real time, full size)', kind: 'realtime' }]
  }
}

// Near-transparent capture bitrate: ~0.22 bits/pixel/frame, clamped so a 4K take
// doesn't overwhelm the hardware encoder. This is the intermediate only —
// ffmpeg re-encodes to the final format afterward.
function captureBitrate(w: number, h: number, fps: number): number {
  return Math.min(150_000_000, Math.max(25_000_000, Math.round(w * h * fps * 0.22)))
}

/** Get the preload's DXV writer port (it answers 'opsia:want-recport'). */
function recPort(): Promise<MessagePort | null> {
  return new Promise((res) => {
    const on = (e: MessageEvent): void => {
      if (e.data !== 'opsia:recport' || !e.ports[0]) return
      window.clearTimeout(t)
      window.removeEventListener('message', on)
      res(e.ports[0])
    }
    const t = window.setTimeout(() => {
      window.removeEventListener('message', on)
      res(null)
    }, 2000)
    window.addEventListener('message', on)
    window.postMessage('opsia:want-recport', '*')
  })
}

/** One real-time DXV3 take (see the header). The render loop drives it through
 *  tick() : it captures on the record rate's grid, hands finished frames to the
 *  workers, and forwards their results to the writer strictly in order. */
class DxvTake {
  private workers: Worker[] = []
  private seq = 0 // frames handed to the workers
  private next = 0 // the next frame the writer should get
  private built = new Map<number, { frame: ArrayBuffer; length: number; repeat: number }>()
  private repeats: number[] = [] // per queued capture : the record ticks it covers, oldest first
  private pendingRepeats = new Map<number, number>()
  private ticksDone = 0
  private t0 = 0
  private interval: number
  private kicking = true
  private waiters = new Map<string, (d: Record<string, unknown>) => void>()
  path = ''
  w = 0
  h = 0

  constructor(private comp: () => Compositor | null, private port: MessagePort, readonly fps: number) {
    this.interval = 1000 / fps
    // Frames are independent : a few workers side by side (one DXV3 frame at
    // 4096² takes ~28 ms to build, a 30 fps take has 33).
    const k = Math.max(2, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 4)))
    for (let i = 0; i < k; i++) {
      const wk = new DxvWorker()
      wk.onmessage = (e: MessageEvent): void => this.onBuilt(e.data)
      this.workers.push(wk)
    }
    port.onmessage = (e: MessageEvent): void => {
      const d = e.data as { t: string }
      if (d.t === 'error') this.waiters.forEach((w) => w(e.data))
      else this.waiters.get(d.t)?.(e.data)
    }
  }

  private wait(t: string, ms: number): Promise<Record<string, unknown>> {
    return new Promise((res) => {
      const timer = window.setTimeout(() => {
        this.waiters.delete(t)
        res({ t: 'error', message: `the writer did not answer (${t})` })
      }, ms)
      this.waiters.set(t, (d) => {
        window.clearTimeout(timer)
        this.waiters.delete(t)
        res(d)
      })
    })
  }

  /** Create the file. Returns an error message, or null when rolling. */
  async open(): Promise<string | null> {
    const c = this.comp()
    if (!c) return 'the engine is not running'
    const { w, h } = c.captureSizeFor('dxt1', DXV_MAX_EDGE)
    this.w = w
    this.h = h
    const [fpsN, fpsD] = ndiRate(this.fps)
    this.port.postMessage({ t: 'open', w, h, fpsN, fpsD })
    const r = await this.wait('opened', 5000)
    if (r.t !== 'opened') return String(r.message ?? 'the file could not be created')
    this.path = String(r.path)
    this.t0 = performance.now()
    return null
  }

  private onBuilt(d: { seq: number; frame: ArrayBuffer; length: number; dxt: ArrayBuffer }): void {
    this.comp()?.captureRecycle('rec', d.dxt)
    const repeat = this.pendingRepeats.get(d.seq) ?? 1
    this.pendingRepeats.delete(d.seq)
    this.built.set(d.seq, { frame: d.frame, length: d.length, repeat })
    // Deliver in order : the workers finish in any order.
    for (let f = this.built.get(this.next); f; f = this.built.get(this.next)) {
      this.built.delete(this.next)
      this.port.postMessage({ t: 'frame', buf: f.frame, length: f.length, repeat: f.repeat }, [f.frame])
      this.next++
    }
  }

  /** Every render-loop frame, right after the render. */
  tick(now: number): void {
    const c = this.comp()
    if (!c) return
    // Finished captures first, oldest first, round-robin to the workers.
    for (let fr = c.captureHarvest('rec'); fr; fr = c.captureHarvest('rec')) {
      const n = this.seq++
      this.pendingRepeats.set(n, this.repeats.shift() ?? 1)
      this.workers[n % this.workers.length].postMessage({ seq: n, buf: fr.buf, blocksPerRow: fr.blocksPerRow }, [fr.buf])
    }
    if (!this.kicking) return
    // Record ticks elapsed since the start; capture when at least one is due.
    // A capture that finds the GPU behind (no free slot) is skipped : the next
    // one then covers the missed ticks (written again), so the clip keeps time.
    const due = Math.floor((now - this.t0) / this.interval) + 1 - this.ticksDone
    if (due >= 1 && c.captureKick('rec', 'dxt1', DXV_MAX_EDGE)) {
      this.repeats.push(due)
      this.ticksDone += due
    }
  }

  /** Stop capturing, wait for the frames in flight, close the file. */
  async finish(): Promise<{ path: string | null; frames: number; dropped: number; error?: string }> {
    this.kicking = false
    const c = this.comp()
    const until = performance.now() + 4000
    while (performance.now() < until && ((c?.capturePending('rec') ?? 0) > 0 || this.next < this.seq)) {
      await new Promise((r) => window.setTimeout(r, 30))
    }
    this.port.postMessage({ t: 'end' })
    const r = await this.wait('done', 60000)
    this.workers.forEach((w) => w.terminate())
    c?.captureRelease('rec')
    try { this.port.close() } catch { /* ignore */ }
    if (r.t !== 'done') return { path: this.path || null, frames: 0, dropped: 0, error: String(r.message ?? 'the file could not be finished') }
    return { path: (r.path as string) ?? null, frames: Number(r.frames ?? 0), dropped: Number(r.dropped ?? 0) }
  }
}

export class OutputRecorder {
  private dxv: DxvTake | null = null
  private engine: () => Compositor | null = () => null
  private rec: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private formatId = 'source'
  // Serialize chunk sends: arrayBuffer() is async and the byte stream must reach
  // disk strictly in order or the container is corrupt.
  private queue: Promise<void> = Promise.resolve()
  // Bytes actually handed to main this take (0 = the encoder never produced video).
  private bytes = 0
  // Why the last take ended badly, for the stop toast (null = fine).
  lastError: string | null = null
  // One stop in flight at a time : a second click joins it instead of stealing
  // its resolver (which used to leave the first caller waiting forever).
  private stopping: Promise<string | null> | null = null
  private watchdog: number | null = null

  get active(): boolean {
    return this.rec !== null || this.dxv !== null
  }

  /** Where the render engine is (a DXV take captures from it). */
  setEngine(get: () => Compositor | null): void {
    this.engine = get
  }

  /** Called by the render loop every frame (does nothing unless a DXV take runs). */
  tick(now: number): void {
    this.dxv?.tick(now)
  }

  /** The size a take in `formatId` would record at, right now. */
  recordSize(canvas: HTMLCanvasElement | null, formatId: string): { w: number; h: number } | null {
    if (formatId === 'dxv3') return this.engine()?.captureSizeFor('dxt1', DXV_MAX_EDGE) ?? null
    return canvas ? { w: canvas.width, h: canvas.height } : null
  }

  private async startDxv(): Promise<boolean> {
    const port = await recPort()
    if (!port) {
      this.lastError = 'the recording writer did not answer'
      return false
    }
    const take = new DxvTake(() => this.engine(), port, useStore.getState().recordPrefs.fps)
    const err = await take.open()
    if (err) {
      this.lastError = err
      try { port.close() } catch { /* ignore */ }
      return false
    }
    this.dxv = take
    this.formatId = 'dxv3'
    useStore.getState().setRecording(true)
    return true
  }

  private async stopDxv(): Promise<string | null> {
    const take = this.dxv!
    this.dxv = null
    try {
      const r = await take.finish()
      if (r.error) this.lastError = r.error
      else if (r.dropped > 0) this.lastError = `${r.dropped} frames dropped : the disk could not keep up at ${take.w}×${take.h}`
      else if (r.frames === 0) this.lastError = 'no frame was captured'
      return r.path
    } finally {
      useStore.getState().setRecording(false)
    }
  }

  async start(canvas: HTMLCanvasElement, formatId: string): Promise<boolean> {
    if (this.active) return false
    this.lastError = null
    if (formatId === 'dxv3') return this.startDxv()
    // Sonification running → mix its audio into the capture (a true
    // audiovisual take). The audio track belongs to the sound engine's
    // MediaStreamDestination : it is merged, never stopped by us.
    const soniStream = sonifyEngine.recordStream()
    const audioTracks = soniStream && sonifyEngine.isRunning() ? soniStream.getAudioTracks() : []
    const inter = pickIntermediate(audioTracks.length > 0)
    if (!inter) return false
    this.formatId = formatId
    this.bytes = 0
    this.lastError = null
    const ok = await window.api.recordingStart(inter.ext, inter.codec)
    if (!ok) return false
    try {
      const fps = 60
      const canvasStream = canvas.captureStream(fps)
      this.stream = audioTracks.length
        ? new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks])
        : canvasStream
      this.rec = new MediaRecorder(this.stream, {
        mimeType: audioTracks.length ? `${inter.mime},opus` : inter.mime,
        videoBitsPerSecond: captureBitrate(canvas.width, canvas.height, fps),
        ...(audioTracks.length ? { audioBitsPerSecond: 256_000 } : {})
      })
    } catch {
      this.stream?.getVideoTracks().forEach((t) => t.stop())
      this.stream = null
      await window.api.recordingStop(formatId)
      return false
    }
    const rec = this.rec
    rec.ondataavailable = (e): void => {
      if (!e.data || e.data.size === 0) return
      this.bytes += e.data.size
      // A failed chunk must never poison the chain : every later chunk (and
      // stop's final flush) would otherwise wait on a rejected promise forever.
      this.queue = this.queue
        .then(async () => {
          const buf = new Uint8Array(await e.data.arrayBuffer())
          window.api.recordingChunk(buf)
        })
        .catch((err) => console.error('[recorder] chunk lost:', err))
    }
    // The encoder can die on its own (a frame size it refuses, e.g. a 4096² dome
    // master; a GPU reset; the canvas track ending). Finalize instead of leaving
    // the take "recording" with nothing behind it.
    rec.onerror = (ev): void => {
      const err = (ev as unknown as { error?: DOMException }).error
      this.lastError = `the video encoder stopped${err?.message ? ` (${err.message})` : ''}`
      console.error('[recorder] MediaRecorder error:', err)
      this.autoStop()
    }
    for (const t of this.stream.getVideoTracks()) {
      t.addEventListener('ended', () => {
        if (this.rec === rec) {
          this.lastError = 'the output stopped feeding the recorder'
          this.autoStop()
        }
      })
    }
    // Small timeslice → frequent flushes → lower memory + tighter stop latency.
    rec.start(500)
    // Nothing after 4 s = the encoder refused this output : say so and stop.
    this.watchdog = window.setTimeout(() => {
      this.watchdog = null
      if (this.rec === rec && this.bytes === 0) {
        this.lastError = `the encoder produced no video at ${canvas.width}×${canvas.height}${
          canvas.width > 4096 || canvas.height > 2304 ? ' (too large for it : try a smaller dome master or render size)' : ''
        }`
        this.autoStop()
      }
    }, 4000)
    useStore.getState().setRecording(true)
    return true
  }

  /** The take ended on its own (encoder error, lost track, nothing captured) :
   *  finalize it and tell the player why, without waiting for a click. */
  private autoStop(): void {
    void this.stop().then((path) => {
      const why = this.lastError ?? 'the recorder stopped'
      showToast(
        path
          ? `Recording stopped : ${why}. Kept what was captured · ${path.split(/[\\/]/).pop() ?? path}`
          : `Recording stopped : ${why}. Nothing was saved.`,
        'warn',
        8000
      )
    })
  }

  /** Stop, flush all chunks, then let main produce the delivery file. Never
   *  hangs and never throws : whatever happens, the take ends and the REC state
   *  clears. Returns the saved path, or null (see `lastError` for why). */
  stop(): Promise<string | null> {
    if (this.stopping) return this.stopping
    this.stopping = (this.dxv ? this.stopDxv() : this.doStop()).finally(() => {
      this.stopping = null
    })
    return this.stopping
  }

  private async doStop(): Promise<string | null> {
    if (this.watchdog !== null) { window.clearTimeout(this.watchdog); this.watchdog = null }
    const rec = this.rec
    try {
      if (rec) {
        // Wait for the final chunk, but only if the recorder is still running :
        // one that already stopped (error, lost track) will never fire 'stop'
        // again, and waiting on it was the hang. 3 s cap regardless.
        if (rec.state !== 'inactive') {
          await new Promise<void>((res) => {
            const done = (): void => { window.clearTimeout(t); res() }
            const t = window.setTimeout(done, 3000)
            rec.addEventListener('stop', done, { once: true })
            try { rec.stop() } catch { done() }
          })
        }
        // Stop only the canvas video tracks : the audio track is the LIVE sound
        // engine's output and must keep running for the performance.
        this.stream?.getVideoTracks().forEach((t) => t.stop())
        this.rec = null
        this.stream = null
        await this.queue.catch(() => {}) // every chunk reached main before we finalize
      }
    } finally {
      useStore.getState().setRecording(false)
    }
    if (!rec) return null
    if (this.bytes === 0 && !this.lastError) this.lastError = 'the encoder produced no video'
    try {
      return await window.api.recordingStop(this.formatId)
    } catch (e) {
      this.lastError = this.lastError ?? `saving failed (${(e as Error).message})`
      return null
    }
  }
}

// The ONE recorder : recording is a global take, not an Output-page visit.
// Starting happens from the Output page; the take keeps rolling when you
// return to the main view (a REC pill in the top bar shows it + stops it).
export const outputRecorder = new OutputRecorder()

/** One-shot PNG of the current output frame at its native resolution. */
export async function captureScreenshot(canvas: HTMLCanvasElement): Promise<string | null> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (!blob) return null
  const buf = new Uint8Array(await blob.arrayBuffer())
  return window.api.saveScreenshot(buf)
}
