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

  /** Open the capture stream. Safe to call once; ignores re-entrancy. */
  async start(kind: CaptureKind): Promise<void> {
    if (this.starting || this.stream) return
    this.starting = true
    try {
      const md = navigator.mediaDevices
      this.stream =
        kind === 'screen'
          ? await md.getDisplayMedia({ video: true, audio: false })
          : await md.getUserMedia({ video: true, audio: false })
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
