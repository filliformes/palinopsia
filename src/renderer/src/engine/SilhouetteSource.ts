// SilhouetteSource : the body silhouette as a picture (the native generator
// 'gen-silhouette'). The Body tracker's pose segmentation mask (Body page :
// Silhouette) and its camera frame are uploaded each frame and drawn in one of
// four ways : CUTOUT (the camera where the body is, transparent elsewhere :
// background removal), MATTE (white body on black, to key or feed another layer's
// node), SHADOW (a flat colored silhouette) and HOLE (the room with the body cut
// out). TRAIL leaves decaying echoes of the body behind it, the silhouette's own
// afterimage (in the matte : the white body leaves echoes in TRAIL COLOR, white by
// default, fading to black : a key that lingers).
//
// It never turns the camera on : a camera is opt-in (Body page, or the Inspector's
// button). While the camera or the silhouette is off, it draws nothing.
//
// GL : the camera (RGBA8) and the mask (R8, half size) are plain textures in the
// compositor's context (MediaPipe runs in its own), with UNPACK_FLIP_Y cleared
// before every upload (the ISF runtime leaves it on); both arrive top-down and
// the shader flips them. The trail is an RGBA8 ping-pong at output size, faded
// with stochastic rounding so its echoes fade all the way out. The four looks
// and the trail are shared with the Silhouette effect (silhouetteLook.ts).

import { bodyTracker } from './bodyTracker'
import { SIL_LOOK_GLSL, SilTrail, trailKeep } from './silhouetteLook'

const VS = `#version 300 es
in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

const FS = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o;
uniform sampler2D uCam, uMask, uTrail;
uniform int uMode, uTrailOn, uHasCam;
uniform float uThresh, uSoft, uKeep, uOutAspect, uCamAspect, uMirror, uFit;
uniform vec4 uColor;
uniform vec4 uTrailColor;
uniform float uFrame;
${SIL_LOOK_GLSL}
void main(){
  // The camera image fitted into the frame : cover crops, contain letterboxes.
  // r < 1 when the frame is wider than the camera.
  vec2 st = vUV - 0.5;
  float r = uCamAspect / uOutAspect;
  bool cover = uFit < 0.5;
  if ((uOutAspect > uCamAspect) == cover) st.y *= r;
  else st.x /= r;
  st += 0.5;
  bool inside = st.x >= 0.0 && st.x <= 1.0 && st.y >= 0.0 && st.y <= 1.0;
  if (uMirror > 0.5) st.x = 1.0 - st.x;
  vec2 tc = vec2(st.x, 1.0 - st.y); // uploads are top-down
  float raw = inside ? texture(uMask, tc).r : 0.0;
  float m = smoothstep(uThresh - uSoft, uThresh + uSoft, raw);
  vec3 cam = uHasCam == 1 && inside ? texture(uCam, tc).rgb : vec3(0.0);
  // cutout · matte · shadow · hole (the camera is there only inside its frame)
  vec4 now = silLook(uMode, vec4(cam, inside ? 1.0 : 0.0), m, uColor);
  // Echoes : the body leaves its last look behind, fading (the matte's in the
  // trail color, white : the plain grey key; the body stays white).
  o = uTrailOn == 1 ? silTrail(uMode, now, m, texture(uTrail, vUV), uKeep, uTrailColor, gl_FragCoord.xy, uFrame) : now;
}`

const COPY_FS = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o;
uniform sampler2D uTex;
uniform int uMatte;
${SIL_LOOK_GLSL}
void main(){
  o = silOut(uMatte == 1 ? 1 : 0, texture(uTex, vUV)); // matte : the kept coverage, white body, echoes in their color
}`

export class SilhouetteSource {
  private gl: WebGL2RenderingContext
  private prog: WebGLProgram
  private copy: WebGLProgram
  private u: Record<string, WebGLUniformLocation | null> = {}
  private uCopy: WebGLUniformLocation | null
  private uCopyMatte: WebGLUniformLocation | null
  private vao: WebGLVertexArrayObject
  private quad: WebGLBuffer
  private camTex: WebGLTexture
  private maskTex: WebGLTexture
  private maskVersion = -1
  private maskW = 0
  private maskH = 0
  private camW = 0
  private camH = 0
  private lastCamTime = -1
  private trail: SilTrail
  private frame = 0
  private last = 0
  private inputs: Record<string, number | number[]> = {
    mode: 0, threshold: 0.5, softness: 0.08, trail: 0, color: [0.95, 0.92, 0.85, 1], trailColor: [1, 1, 1, 1], fit: 0
  }
  /** Whether it drew a live silhouette last frame (for the Inspector's status). */
  live = false

  constructor(gl: WebGL2RenderingContext, private w: number, private h: number) {
    this.gl = gl
    const compile = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('[silhouette] compile:', gl.getShaderInfoLog(s))
      return s
    }
    const link = (fs: string): WebGLProgram => {
      const p = gl.createProgram()!
      gl.attachShader(p, compile(gl.VERTEX_SHADER, VS))
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs))
      gl.bindAttribLocation(p, 0, 'p')
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error('[silhouette] link:', gl.getProgramInfoLog(p))
      return p
    }
    this.prog = link(FS)
    this.copy = link(COPY_FS)
    for (const n of ['uCam', 'uMask', 'uTrail', 'uMode', 'uTrailOn', 'uHasCam', 'uThresh', 'uSoft', 'uKeep',
      'uOutAspect', 'uCamAspect', 'uMirror', 'uFit', 'uColor', 'uTrailColor', 'uFrame'])
      this.u[n] = gl.getUniformLocation(this.prog, n)
    this.uCopy = gl.getUniformLocation(this.copy, 'uTex')
    this.uCopyMatte = gl.getUniformLocation(this.copy, 'uMatte')
    const tex = (): WebGLTexture => {
      const t = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      return t
    }
    this.camTex = tex()
    this.maskTex = tex()
    gl.bindTexture(gl.TEXTURE_2D, null)
    // Own VAO : never touch the default one (the ISF runtime's attribute 0).
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    this.trail = new SilTrail(gl)
  }

  update(inputs: Record<string, number | number[]>): void {
    for (const k in inputs) this.setInput(k, inputs[k])
  }

  setInput(name: string, value: number | number[]): void {
    this.inputs[name] = value
  }

  private num(k: string, d: number): number {
    const v = this.inputs[k]
    return typeof v === 'number' && Number.isFinite(v) ? v : d
  }

  /** Clear the echoes (PANIC). */
  flush(): void {
    this.trail.dispose()
  }

  render(targetFbo: WebGLFramebuffer, clockSec?: number): void {
    const gl = this.gl
    const sil = bodyTracker.silhouette()
    this.live = !!sil
    if (!sil) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo)
      gl.viewport(0, 0, this.w, this.h)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      this.trail.dispose()
      return
    }
    // Uploads : top-down rows, no flip (the ISF runtime may have left it on).
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    if (sil.version !== this.maskVersion) {
      gl.bindTexture(gl.TEXTURE_2D, this.maskTex)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
      if (sil.w !== this.maskW || sil.h !== this.maskH) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, sil.w, sil.h, 0, gl.RED, gl.UNSIGNED_BYTE, sil.mask)
        this.maskW = sil.w
        this.maskH = sil.h
      } else {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, sil.w, sil.h, gl.RED, gl.UNSIGNED_BYTE, sil.mask)
      }
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
      this.maskVersion = sil.version
    }
    const video = sil.video
    let hasCam = false
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      if (video.currentTime !== this.lastCamTime || video.videoWidth !== this.camW) {
        gl.bindTexture(gl.TEXTURE_2D, this.camTex)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
        this.lastCamTime = video.currentTime
        this.camW = video.videoWidth
        this.camH = video.videoHeight
      }
      hasCam = true
    }
    gl.bindTexture(gl.TEXTURE_2D, null)

    // Trail : keep factor per frame from a half-life of up to ~3 s.
    const now = typeof clockSec === 'number' ? clockSec : performance.now() / 1000
    const dt = this.last > 0 ? Math.max(0, Math.min(0.1, now - this.last)) : 1 / 60
    this.last = now
    const trail = Math.max(0, Math.min(1, this.num('trail', 0)))
    const trailOn = trail > 0.001
    const keep = trailKeep(trail, dt)
    if (trailOn) this.trail.ensure(this.w, this.h)
    else this.trail.dispose()

    const color = Array.isArray(this.inputs.color) ? (this.inputs.color as number[]) : [0.95, 0.92, 0.85, 1]
    const trailColor = Array.isArray(this.inputs.trailColor) ? (this.inputs.trailColor as number[]) : [1, 1, 1, 1]
    const camAspect = this.camW > 0 && this.camH > 0 ? this.camW / this.camH : (this.maskW > 0 ? this.maskW / Math.max(1, this.maskH) : 4 / 3)
    const soft = Math.max(0.001, this.num('softness', 0.08))
    const mode = Math.max(0, Math.min(3, Math.round(this.num('mode', 0))))
    gl.bindVertexArray(this.vao)
    gl.useProgram(this.prog)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.camTex); gl.uniform1i(this.u.uCam, 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.maskTex); gl.uniform1i(this.u.uMask, 1)
    const read = this.trail.read() ?? this.maskTex
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, read); gl.uniform1i(this.u.uTrail, 2)
    gl.uniform1i(this.u.uMode, mode)
    gl.uniform1i(this.u.uTrailOn, trailOn ? 1 : 0)
    gl.uniform1i(this.u.uHasCam, hasCam ? 1 : 0)
    gl.uniform1f(this.u.uThresh, Math.max(0.02, Math.min(0.98, this.num('threshold', 0.5))))
    gl.uniform1f(this.u.uSoft, soft)
    gl.uniform1f(this.u.uKeep, keep)
    gl.uniform1f(this.u.uOutAspect, this.w / Math.max(1, this.h))
    gl.uniform1f(this.u.uCamAspect, camAspect)
    gl.uniform1f(this.u.uMirror, sil.mirror ? 1 : 0)
    gl.uniform1f(this.u.uFit, Math.round(this.num('fit', 0)))
    gl.uniform4f(this.u.uColor, color[0] ?? 1, color[1] ?? 1, color[2] ?? 1, color[3] ?? 1)
    gl.uniform4f(this.u.uTrailColor, trailColor[0] ?? 1, trailColor[1] ?? 1, trailColor[2] ?? 1, trailColor[3] ?? 1)
    gl.uniform1f(this.u.uFrame, this.frame++)
    const write = this.trail.write()
    if (write) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo)
      gl.viewport(0, 0, this.w, this.h)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      // Copy the new trail state out to the layer.
      gl.useProgram(this.copy)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, write.tex); gl.uniform1i(this.uCopy, 0)
      gl.uniform1i(this.uCopyMatte, mode === 1 ? 1 : 0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo)
      gl.viewport(0, 0, this.w, this.h)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      this.trail.swap()
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo)
      gl.viewport(0, 0, this.w, this.h)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    for (let i = 0; i < 3; i++) {
      gl.activeTexture(gl.TEXTURE0 + i)
      gl.bindTexture(gl.TEXTURE_2D, null)
    }
    gl.activeTexture(gl.TEXTURE0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    const gl = this.gl
    this.trail.dispose()
    gl.deleteProgram(this.prog)
    gl.deleteProgram(this.copy)
    gl.deleteTexture(this.camTex)
    gl.deleteTexture(this.maskTex)
    gl.bindVertexArray(this.vao)
    gl.deleteBuffer(this.quad)
    gl.bindVertexArray(null)
    gl.deleteVertexArray(this.vao)
  }
}
