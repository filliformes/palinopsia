// CaptureSource — live webcam or screen as a layer source (brief §7).
//
// A MediaStream (getUserMedia for the camera, getDisplayMedia for the screen)
// feeds an off-DOM <video>; each frame uploads to a GL texture through the same
// path as imported clips. No transport — it's live. Screen capture relies on
// the main process's setDisplayMediaRequestHandler to pick a source.

import { uploadVideoFrame } from './VideoSource'

export type CaptureKind = 'webcam' | 'screen'

export class CaptureSource {
  private video: HTMLVideoElement
  private tex: WebGLTexture | null = null
  private stream: MediaStream | null = null
  private starting = false

  constructor(private gl: WebGL2RenderingContext) {
    this.video = document.createElement('video')
    this.video.muted = true
    this.video.playsInline = true
    this.video.autoplay = true
  }

  /** Open the capture stream. `spec` is the slot's mediaId:
   *    'webcam'          → default camera (getUserMedia)
   *    'desktop:<id>'    → a specific screen/window (chromeMediaSourceId)
   *    'screen'          → the primary display (getDisplayMedia fallback)
   *  Safe to call once; ignores re-entrancy. */
  async start(spec: string): Promise<void> {
    if (this.starting || this.stream) return
    this.starting = true
    try {
      const md = navigator.mediaDevices
      if (spec.startsWith('desktop:')) {
        const id = spec.slice('desktop:'.length)
        // Legacy desktop-source constraint — still the way to grab a SPECIFIC
        // window/screen without the display-media picker.
        this.stream = await md.getUserMedia({
          audio: false,
          video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id } }
        } as unknown as MediaStreamConstraints)
      } else if (spec === 'screen') {
        this.stream = await md.getDisplayMedia({ video: true, audio: false })
      } else {
        this.stream = await md.getUserMedia({ video: true, audio: false })
      }
      this.video.srcObject = this.stream
      await this.video.play().catch(() => {})
    } catch (e) {
      // Permission denied / no device / user cancelled the screen picker — the
      // slot just renders transparent until re-selected.
      console.error('[capture] start failed:', (e as Error).message)
    } finally {
      this.starting = false
    }
  }

  upload(): WebGLTexture | null {
    this.tex = uploadVideoFrame(this.gl, this.video, this.tex)
    return this.tex
  }

  dispose(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.video.srcObject = null
    if (this.tex) this.gl.deleteTexture(this.tex)
    this.tex = null
  }
}
