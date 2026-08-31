// CaptureSource : live webcam or screen as a layer source (brief §7).
//
// A MediaStream (getUserMedia for the camera, getDisplayMedia for the screen)
// feeds an off-DOM <video>; each frame uploads to a GL texture through the same
// path as imported clips. No transport : it's live. Screen capture relies on
// the main process's setDisplayMediaRequestHandler to pick a source.

import { uploadVideoFrame } from './VideoSource'

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
   *  Safe to call once; ignores re-entrancy. */
  async start(spec: string): Promise<void> {
    if (this.starting || this.stream || this.disposed) return
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
      await this.video.play().catch(() => {})
    } catch (e) {
      // Permission denied / no device / user cancelled the screen picker : the
      // slot renders transparent — report the reason so the UI can say why.
      const err = e as Error
      console.error('[capture] start failed:', err.message)
      if (!this.disposed) captureErrorReporter?.(spec, err.name || err.message)
    } finally {
      this.starting = false
    }
  }

  upload(): WebGLTexture | null {
    this.tex = uploadVideoFrame(this.gl, this.video, this.tex)
    return this.tex
  }

  dispose(): void {
    this.disposed = true
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.video.srcObject = null
    if (this.tex) this.gl.deleteTexture(this.tex)
    this.tex = null
  }
}
