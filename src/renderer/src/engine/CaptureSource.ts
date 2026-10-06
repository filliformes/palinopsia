// CaptureSource : live webcam or screen as a layer source (brief §7).
//
// A MediaStream (getUserMedia for the camera, getDisplayMedia for the screen)
// feeds an off-DOM <video>; each frame uploads to a GL texture through the same
// path as imported clips. No transport : it's live. Screen capture relies on
// the main process's setDisplayMediaRequestHandler to pick a source.

import { uploadVideoFrame } from './VideoSource'
import { ndiInAcquire, ndiInLatest, ndiInRelease, ndiInStats, type NdiInStats } from './ndiIn'

// A live-capture start can fail silently (permission denied, no device, screen
// picker cancelled) and the slot just renders transparent — the most confusing
// empty state in the app. The UI (App) registers a reporter so it can surface a
// reason. Kept framework-free : the engine never imports React.
let captureErrorReporter: ((spec: string, errorName: string) => void) | null = null
export function onCaptureError(fn: ((spec: string, errorName: string) => void) | null): void {
  captureErrorReporter = fn
}

export class CaptureSource {
  private video: HTMLVideoElement
  private tex: WebGLTexture | null = null
  private stream: MediaStream | null = null
  private starting = false
  private disposed = false
  // NDI input ('ndi:<source name>') : frames come from the preload's receiver.
  private ndiName: string | null = null
  private ndiSeq = -1
  private ndiW = 0
  private ndiH = 0
  // A camera that drops out (unplugged, or reset by USB power saving over a
  // days-long installation) ends its track : the source reconnects by itself,
  // finding the camera again by name if it comes back under another id.
  private spec = ''
  private label = ''
  private retries = 0
  private retryTimer = 0
  private readonly onDevices = (): void => {
    if (this.retryTimer && !this.stream && !this.starting && !this.disposed) {
      window.clearTimeout(this.retryTimer)
      this.retryTimer = 0
      void this.reopen()
    }
  }
  /** NDI frames arrive top row first and are uploaded as they are : the blit
   *  samples them upside down (a CPU flip on upload was the slow path). */
  get flipY(): boolean {
    return this.ndiName !== null
  }
  get ndiStats(): NdiInStats | null {
    return this.ndiName ? ndiInStats(this.ndiName) : null
  }

  constructor(private gl: WebGL2RenderingContext) {
    this.video = document.createElement('video')
    this.video.muted = true
    this.video.playsInline = true
    this.video.autoplay = true
  }

  /** Open the capture stream. `spec` is the slot's mediaId:
   *    'webcam'          → default camera (getUserMedia)
   *    'device:<id>'     → a specific video input device (Live Input : e.g. a
   *                        USB camera / capture card / DJI Osmo in webcam mode)
   *    'desktop:<id>'    → a specific screen/window (chromeMediaSourceId)
   *    'screen'          → the primary display (getDisplayMedia fallback)
   *    'ndi:<name>'      → an NDI® source on the network (src/preload/ndi.ts)
   *  Safe to call once; ignores re-entrancy. `quiet` : a reconnection attempt
   *  (no error reported to the UI each time). */
  async start(spec: string, quiet = false): Promise<void> {
    if (this.starting || this.stream || this.disposed || this.ndiName) return
    if (spec.startsWith('ndi:')) {
      this.ndiName = spec.slice('ndi:'.length)
      const ok = await ndiInAcquire(this.ndiName)
      // No runtime : say so (the receiver is kept : it starts if NDI arrives).
      if (!ok && !this.disposed) captureErrorReporter?.(spec, 'NdiUnavailable')
      return
    }
    this.starting = true
    try {
      const md = navigator.mediaDevices
      let stream: MediaStream
      if (spec.startsWith('desktop:')) {
        const id = spec.slice('desktop:'.length)
        // Legacy desktop-source constraint : still the way to grab a SPECIFIC
        // window/screen without the display-media picker.
        stream = await md.getUserMedia({
          audio: false,
          video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id } }
        } as unknown as MediaStreamConstraints)
      } else if (spec.startsWith('device:')) {
        const id = spec.slice('device:'.length)
        // A specific camera / capture device by id, at its highest resolution.
        stream = await md.getUserMedia({
          audio: false,
          video: { deviceId: { exact: id }, width: { ideal: 3840 }, height: { ideal: 2160 } }
        })
      } else if (spec === 'screen') {
        stream = await md.getDisplayMedia({ video: true, audio: false })
      } else {
        stream = await md.getUserMedia({ video: true, audio: false })
      }
      // The permission prompt / screen picker can sit open for seconds. If the
      // slot was switched or cleared in that window, dispose() already ran while
      // this.stream was still null — so stop the freshly-acquired tracks here
      // rather than leak them (camera LED stuck on) onto a dead source.
      if (this.disposed) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      this.stream = stream
      this.video.srcObject = this.stream
      const track = stream.getVideoTracks()[0]
      if (track && (spec === 'webcam' || spec.startsWith('device:'))) {
        this.spec = spec
        this.label = track.label
        this.retries = 0
        track.addEventListener('ended', () => this.lost())
      }
      await this.video.play().catch(() => {})
    } catch (e) {
      // Permission denied / no device / user cancelled the screen picker : the
      // slot renders transparent — report the reason so the UI can say why.
      const err = e as Error
      if (quiet) console.warn('[capture] reconnect failed:', err.message)
      else console.error('[capture] start failed:', err.message)
      if (!this.disposed && !quiet) captureErrorReporter?.(spec, err.name || err.message)
    } finally {
      this.starting = false
    }
  }

  /** The camera's track ended : drop the dead stream, try again (2, 4, 8… up to
   *  30 s, or at once when a device appears). The last frame stays meanwhile. */
  private lost(): void {
    if (this.disposed || !this.stream) return
    console.warn(`[capture] ${this.label || this.spec} was lost : reconnecting`)
    this.stream.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.video.srcObject = null
    navigator.mediaDevices.addEventListener('devicechange', this.onDevices)
    this.scheduleRetry()
  }

  private scheduleRetry(): void {
    if (this.disposed) return
    const delay = Math.min(30_000, 2000 * 2 ** Math.min(this.retries++, 4))
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = 0
      void this.reopen()
    }, delay)
  }

  private async reopen(): Promise<void> {
    if (this.disposed || this.stream || this.starting) return
    let spec = this.spec
    // The same camera may come back under another id (another USB port).
    if (spec.startsWith('device:') && this.label) {
      const devs = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[])
      const same = devs.find((d) => d.kind === 'videoinput' && d.label === this.label)
      if (same) spec = 'device:' + same.deviceId
    }
    await this.start(spec, true)
    if (this.disposed) return
    if (this.stream) {
      console.warn(`[capture] ${this.label || spec} is back`)
      navigator.mediaDevices.removeEventListener('devicechange', this.onDevices)
    } else {
      this.scheduleRetry()
    }
  }

  upload(): WebGLTexture | null {
    if (this.ndiName) return this.uploadNdi(this.ndiName)
    this.tex = uploadVideoFrame(this.gl, this.video, this.tex)
    return this.tex
  }

  /** The newest NDI frame (RGBX/RGBA, top row first) into the texture, as is
   *  (see flipY), allocated once per size. Nothing new : the last frame stays. */
  private uploadNdi(name: string): WebGLTexture | null {
    const f = ndiInLatest(name)
    if (!f || f.seq === this.ndiSeq) return this.tex
    const gl = this.gl
    if (!this.tex) {
      this.tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, this.tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, f.stride / 4)
    const px = new Uint8Array(f.buf, 0, f.stride * f.h)
    if (f.w !== this.ndiW || f.h !== this.ndiH) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, f.w, f.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px)
      this.ndiW = f.w
      this.ndiH = f.h
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, f.w, f.h, gl.RGBA, gl.UNSIGNED_BYTE, px)
    }
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0)
    this.ndiSeq = f.seq
    return this.tex
  }

  dispose(): void {
    this.disposed = true
    window.clearTimeout(this.retryTimer)
    navigator.mediaDevices?.removeEventListener('devicechange', this.onDevices)
    if (this.ndiName) {
      ndiInRelease(this.ndiName)
      this.ndiName = null
    }
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.video.srcObject = null
    if (this.tex) this.gl.deleteTexture(this.tex)
    this.tex = null
  }
}
