// Fulldome viewer, the drawing : the live domemaster wrapped back onto a dome of
// real size, seen from inside (anywhere an audience can stand) or orbiting
// outside, modelled on the fulldome simulator Vincent used for his dome shows
// (equiazimuth sphere cap, dome tilt, camera FOV, sweet-spot patch, alignment
// template after Paul Bourke at low opacity, the rim ring). components/DomeViewer
// is its frame : the hands, the numbers, the floor plan.
//
// It runs in its OWN WebGL2 context and takes the finished master straight off
// the engine's canvas, graphics card to graphics card (texSubImage2D of the
// canvas) : the full 4096 pixels, mipmapped and anisotropic, no readback. (It used
// to read 1024 of them back through the processor, 30 times a second.) A governor
// takes fewer frames as soon as the show slows (engine/domeView.ts), and nothing
// is taken or drawn while the viewer is hidden, covered or still.
//
// Every pixel works out its own direction from the sphere's center and looks the
// master up with it : the same direction <-> master mapping as engine/dome.ts, so
// what reads correctly here reads correctly under a real dome.

import { useEffect, useRef } from 'react'
import { domeRoom, type DomeConfig } from '@shared/dome'
import { outputCanvas } from '../engine/outputCanvas'
import { currentFps } from '../perf'
import { domeCam, domeFrame, lookDir, RotationMeter, STRIP_H, STRIP_W, ViewerGovernor } from '../engine/domeView'

const VS = `#version 300 es
in vec3 aPos;
uniform mat4 uMVP; uniform mat3 uTilt; uniform float uR; uniform float uCy;
out vec3 vDir;
void main(){ vDir = aPos; gl_Position = uMVP * vec4(uTilt * aPos * uR + vec3(0.0, uCy, 0.0), 1.0); }`

// Master lookup shared by every program : uv of a direction (theta from the
// zenith, azimuth as a unit vector (sin, -cos) so nothing jumps behind you). The
// canvas comes in top row first : v is turned over here.
const LOOK = `
vec2 masterUv(float theta, vec2 n, float halfAp){
  vec2 uv = (theta / halfAp) * n * 0.5 + 0.5;
  return vec2(uv.x, 1.0 - uv.y);
}`

const FS = `#version 300 es
precision highp float;
in vec3 vDir; out vec4 o;
uniform sampler2D uTex;
uniform sampler2D uMean;   // 1x1 : the dome's mean light, linear (the wash)
uniform int uHasTex;
uniform float uHalfAp;     // the screen's own half opening
uniform float uMasterHalf; // the master's
uniform float uTemplate;
uniform float uWash;       // how much light the screen sends back on itself
uniform int uMarks;
uniform int uSweet;
uniform vec3 uSweetBox;    // half width (az), low, high (elevation), radians
const float PI = 3.14159265359;
${LOOK}
float gridLine(float x, float w, float period){
  float t = x / period;
  float d = abs(fract(t + 0.5) - 0.5) / max(w / period, 1e-5);
  return 1.0 - clamp(d, 0.0, 1.0);
}
void main(){
  vec3 d = normalize(vDir);
  float h = length(d.xz);
  float theta = atan(h, d.y);
  vec2 n = h > 1e-6 ? vec2(d.x, d.z) / h : vec2(0.0);   // (sin az, -cos az)
  float az = atan(d.x, -d.z);
  vec2 uv = masterUv(theta, n, uMasterHalf);
  vec3 col = uHasTex == 1 ? texture(uTex, uv).rgb : vec3(0.06);
  if (theta > uMasterHalf + 1e-4) col = vec3(0.0);      // a screen that opens past the master
  if (uWash > 0.001) {
    vec3 mean = texelFetch(uMean, ivec2(0), 0).rgb * uWash;
    vec3 lin = pow(max(col, 0.0), vec3(2.2)) + mean;
    col = pow(lin / (1.0 + dot(mean, vec3(0.2126, 0.7152, 0.0722))), vec3(1.0 / 2.2));
  }
  float el = 0.5 * PI - theta;
  float wEl = fwidth(el);
  float wAz = length(fwidth(n));                        // the azimuth's, without its jump behind you
  if (uTemplate > 0.001) {
    float g = max(gridLine(el, wEl, radians(10.0)), gridLine(az, wAz, radians(30.0)) * step(0.05, theta));
    col = mix(col, vec3(0.92), g * uTemplate);
    float hor = gridLine(el, wEl, radians(360.0));      // only the 0 deg line survives the period
    col = mix(col, vec3(0.1, 0.85, 1.0), hor * min(1.0, uTemplate * 2.5));
    float front = (1.0 - clamp(abs(az) / max(wAz * 1.5, 1e-5), 0.0, 1.0)) * step(0.0, el + 0.3);
    col = mix(col, vec3(1.0, 0.2, 0.1), front * min(1.0, uTemplate * 2.5));
  }
  if (uMarks == 1) {
    // the seam behind the audience, and the zenith : a ring of 5 deg and a cross
    float seam = 1.0 - clamp((PI - abs(az)) / max(wAz * 2.0, 1e-5), 0.0, 1.0);
    col = mix(col, vec3(1.0, 0.25, 0.95), seam * step(0.02, theta));
    float ring = 1.0 - clamp(abs(theta - radians(5.0)) / max(wEl * 1.6, 1e-5), 0.0, 1.0);
    vec2 pz = theta * n;
    vec2 wz = max(fwidth(pz), vec2(1e-5));
    vec2 ln = 1.0 - clamp(abs(pz) / (wz * 1.2), 0.0, 1.0);
    float cross_ = max(ln.x, ln.y) * step(theta, radians(5.0));
    col = mix(col, vec3(1.0, 0.9, 0.2), max(ring, cross_));
  }
  if (uSweet == 1) {
    float inAz = step(abs(az), uSweetBox.x);
    float inEl = step(uSweetBox.y, el) * step(el, uSweetBox.z);
    float inside = inAz * inEl;
    col = mix(col, vec3(1.0, 0.18, 0.12), inside * 0.12);
    float bx = 1.0 - clamp(abs(abs(az) - uSweetBox.x) / max(wAz * 1.2, 1e-5), 0.0, 1.0);
    float by = max(1.0 - clamp(abs(el - uSweetBox.y) / max(wEl * 1.2, 1e-5), 0.0, 1.0),
                   1.0 - clamp(abs(el - uSweetBox.z) / max(wEl * 1.2, 1e-5), 0.0, 1.0));
    float edge = max(bx * inEl, by * inAz);
    col = mix(col, vec3(1.0, 0.2, 0.12), edge * 0.9);
  }
  // The rim : a thin ring where the projection surface ends.
  float rim = smoothstep(0.985, 1.0, theta / uHalfAp);
  col = mix(col, vec3(0.9, 0.2, 0.15), rim * 0.8);
  o = vec4(col, 1.0);
}`

// The floor, the wall under the rim and the figure where you stand.
const ROOM_VS = `#version 300 es
in vec3 aPos; uniform mat4 uMVP; uniform vec3 uScale; uniform vec3 uAt;
out vec3 vP;
void main(){ vP = aPos * uScale + uAt; gl_Position = uMVP * vec4(vP, 1.0); }`
const ROOM_FS = `#version 300 es
precision highp float;
in vec3 vP; out vec4 o;
uniform int uKind;        // 0 floor, 1 wall, 2 figure
uniform float uRim;
float lines(vec2 p, float period){
  vec2 t = p / period;
  vec2 w = max(fwidth(t), vec2(1e-5));
  vec2 d = abs(fract(t + 0.5) - 0.5) / w;
  // faded where the lines crowd together, far away
  return (1.0 - clamp(min(d.x, d.y), 0.0, 1.0)) * (1.0 - smoothstep(0.15, 0.5, max(w.x, w.y)));
}
void main(){
  if (uKind == 2) { o = vec4(1.0, 0.62, 0.2, 1.0); return; }
  if (uKind == 1) { o = vec4(vec3(0.022), 1.0); return; }
  vec3 c = vec3(0.03);
  c += 0.035 * lines(vP.xz, 1.0) + 0.05 * lines(vP.xz, 5.0);   // a meter, five meters
  float w = max(fwidth(vP.x), 1e-5);
  float front = (1.0 - clamp(abs(vP.x) / (w * 1.5), 0.0, 1.0)) * step(vP.z, -uRim * 0.8);
  c = mix(c, vec3(0.8, 0.16, 0.1), front);
  o = vec4(c, 1.0);
}`

// The flat views : the square master, or the whole dome laid out flat with the
// azimuth across and the elevation down (equirectangular, the front in the
// middle), letterboxed into the canvas.
const FLAT_VS = `#version 300 es
in vec2 p; uniform vec2 uScale; out vec2 vUv;
void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p * uScale, 0.0, 1.0); }`
const FLAT_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o; uniform sampler2D uTex;
uniform int uEqui; uniform float uMasterHalf; uniform float uTemplate;
const float PI = 3.14159265359;
${LOOK}
void main(){
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float az = (vUv.x - 0.5) * 2.0 * PI;
  float theta = (1.0 - vUv.y) * PI;
  if (uEqui == 1) uv = masterUv(theta, vec2(sin(az), -cos(az)), uMasterHalf);
  vec3 col = texture(uTex, uv).rgb;
  if (uEqui == 1) {
    if (theta > uMasterHalf) col = vec3(0.03);
    float a = min(1.0, uTemplate * 2.5);
    float hz = 1.0 - clamp(abs(theta - 0.5 * PI) / (fwidth(theta) * 1.2), 0.0, 1.0);
    float fr = 1.0 - clamp(abs(az) / (fwidth(az) * 1.2), 0.0, 1.0);
    col = mix(col, vec3(0.1, 0.85, 1.0), hz * a);
    col = mix(col, vec3(1.0, 0.2, 0.1), fr * a * step(theta, 0.5 * PI + 0.3));
  }
  o = vec4(col, 1.0);
}`

// The dome's mean light, linear : 160 looks over the cap, each weighed by the
// piece of sky it stands for, through a small mip level.
const MEAN_FS = `#version 300 es
precision highp float;
out vec4 o; uniform sampler2D uTex; uniform float uHalfAp; uniform float uMasterHalf; uniform float uLod;
${LOOK}
void main(){
  vec3 sum = vec3(0.0); float w = 0.0;
  for (int i = 0; i < 10; i++) {
    float th = (float(i) + 0.5) / 10.0 * uHalfAp;
    float k = sin(th);
    for (int j = 0; j < 16; j++) {
      float a = (float(j) + 0.5) / 16.0 * 6.28318530718;
      vec3 c = th > uMasterHalf ? vec3(0.0) : textureLod(uTex, masterUv(th, vec2(sin(a), -cos(a)), uMasterHalf), uLod).rgb;
      sum += pow(c, vec3(2.2)) * k; w += k;
    }
  }
  o = vec4(sum / w, 1.0);
}`

// The turning speed's strip : azimuth across (the back at the two ends), eight
// elevations from 5 to 75 degrees.
const STRIP_FS = `#version 300 es
precision highp float;
out vec4 o; uniform sampler2D uTex; uniform float uMasterHalf; uniform float uLod;
const float PI = 3.14159265359;
${LOOK}
void main(){
  float az = (gl_FragCoord.x / ${STRIP_W}.0 - 0.5) * 2.0 * PI;
  float el = radians(mix(5.0, 75.0, gl_FragCoord.y / ${STRIP_H}.0));
  o = vec4(textureLod(uTex, masterUv(0.5 * PI - el, vec2(sin(az), -cos(az)), uMasterHalf), uLod).rgb, 1.0);
}`

/** What the viewer says about itself, a few times a second. */
export interface DomeSimInfo {
  size: number // the picture taken, pixels a side (0 = none yet)
  takes: number // pictures taken a second
  takeMs: number // what one costs this thread
  turning: number | null // the picture's turning speed, degrees a second
}

type M4 = Float32Array
function persp(fovy: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far)
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0])
}
function lookAt(e: number[], c: number[], up: number[]): M4 {
  let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2]
  let l = Math.hypot(zx, zy, zz) || 1
  zx /= l; zy /= l; zz /= l
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx
  l = Math.hypot(xx, xy, xz) || 1
  xx /= l; xy /= l; xz /= l
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx
  return new Float32Array([
    xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
    -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1
  ])
}
function mul(a: M4, b: M4): M4 {
  const o = new Float32Array(16)
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]
      o[i * 4 + j] = s
    }
  return o
}

/** The cap as directions from the sphere's center : rings from the zenith to half
 *  the aperture. Only its outline matters : each pixel works its own direction out. */
function buildCap(halfAp: number): { pos: Float32Array; idx: Uint32Array } {
  const NT = 72, NP = 160
  const pos: number[] = [], idx: number[] = []
  for (let i = 0; i <= NT; i++) {
    const th = (i / NT) * halfAp
    for (let j = 0; j <= NP; j++) {
      const az = -Math.PI + (j / NP) * Math.PI * 2
      pos.push(Math.sin(th) * Math.sin(az), Math.cos(th), -Math.sin(th) * Math.cos(az))
    }
  }
  const row = NP + 1
  for (let i = 0; i < NT; i++)
    for (let j = 0; j < NP; j++) {
      const a = i * row + j, b = a + row
      idx.push(a, b, a + 1, a + 1, b, b + 1)
    }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) }
}

/** The room's shapes, unit sized : a disc (the floor, seen from above only), an
 *  open cylinder (the wall, seen from inside only), a figure in lines. */
function buildRoom(): { pos: Float32Array; floor: [number, number]; wall: [number, number]; figure: [number, number] } {
  const N = 96
  const v: number[] = []
  const at = (i: number): [number, number] => [Math.sin((i / N) * 2 * Math.PI), Math.cos((i / N) * 2 * Math.PI)]
  for (let i = 0; i < N; i++) {
    const [x0, z0] = at(i), [x1, z1] = at(i + 1)
    v.push(0, 0, 0, x0, 0, z0, x1, 0, z1)
  }
  const floor: [number, number] = [0, N * 3]
  for (let i = 0; i < N; i++) {
    const [x0, z0] = at(i), [x1, z1] = at(i + 1)
    v.push(x0, 0, z0, x0, 1, z0, x1, 0, z1, x1, 0, z1, x0, 1, z0, x1, 1, z1)
  }
  const wall: [number, number] = [N * 3, N * 6]
  // a post up to the eye, a head, a ring on the floor
  v.push(0, 0, 0, 0, 1, 0)
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * 2 * Math.PI, b = ((i + 1) / 24) * 2 * Math.PI
    v.push(0.4 * Math.sin(a), 0.01, 0.4 * Math.cos(a), 0.4 * Math.sin(b), 0.01, 0.4 * Math.cos(b))
    v.push(0.12 * Math.sin(a), 1, 0.12 * Math.cos(a), 0.12 * Math.sin(b), 1, 0.12 * Math.cos(b))
  }
  return { pos: new Float32Array(v), floor, wall, figure: [N * 9, 2 + 24 * 4] }
}

export function DomeSim({ cfg, view = '3d', covered = false, onStep, onInfo }: {
  cfg: DomeConfig
  view?: '3d' | 'master' | 'equirect'
  /** Another page lies over it : take and draw nothing. */
  covered?: boolean
  /** Each frame, before drawing : move the camera. */
  onStep?: (dt: number) => void
  onInfo?: (i: DomeSimInfo) => void
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const live = useRef({ cfg, view, covered, onStep, onInfo })
  live.current = { cfg, view, covered, onStep, onInfo }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' })
    if (!gl) return
    const mk = (t: number, s: string): WebGLShader => {
      const sh = gl.createShader(t)!
      gl.shaderSource(sh, s)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) console.error('[domeSim]', gl.getShaderInfoLog(sh))
      return sh
    }
    const build = (vs: string, fs: string): { p: WebGLProgram; u: (n: string) => WebGLUniformLocation | null } => {
      const p = gl.createProgram()!
      gl.attachShader(p, mk(gl.VERTEX_SHADER, vs))
      gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs))
      gl.bindAttribLocation(p, 0, vs === FLAT_VS ? 'p' : 'aPos')
      gl.linkProgram(p)
      const at = new Map<string, WebGLUniformLocation | null>()
      return {
        p,
        u: (n) => {
          if (!at.has(n)) at.set(n, gl.getUniformLocation(p, n))
          return at.get(n)!
        }
      }
    }
    const vaoOf = (data: Float32Array, size: number): { vao: WebGLVertexArrayObject; buf: WebGLBuffer } => {
      const vao = gl.createVertexArray()!
      const buf = gl.createBuffer()!
      gl.bindVertexArray(vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, size, gl.FLOAT, false, 0, 0)
      gl.bindVertexArray(null)
      return { vao, buf }
    }
    // The clock and the pixel ratio of the window the canvas is in : the page can
    // sit in a window of its own, on another screen (another DPI), and keep
    // painting while the controls are minimized (their rAF stalls).
    const win = canvas.ownerDocument.defaultView ?? window
    let dead = false
    const teardown: Array<() => void> = []
    let raf = 0

    const start = (): void => {
      const dome = build(VS, FS)
      const room3 = build(ROOM_VS, ROOM_FS)
      const flat = build(FLAT_VS, FLAT_FS)
      const mean = build(FLAT_VS, MEAN_FS)
      const strip = build(FLAT_VS, STRIP_FS)
      const quad = vaoOf(new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), 2)
      const shapes = buildRoom()
      const roomVao = vaoOf(shapes.pos, 3)
      const capVao = vaoOf(new Float32Array(9), 3)
      const capIdx = gl.createBuffer()!
      let nIdx = 0
      let meshAp = -1
      const rebuild = (halfAp: number): void => {
        const m = buildCap(halfAp)
        gl.bindVertexArray(capVao.vao)
        gl.bindBuffer(gl.ARRAY_BUFFER, capVao.buf)
        gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, capIdx)
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW)
        gl.bindVertexArray(null)
        nIdx = m.idx.length
      }
      const target = (w: number, h: number, f: number): { tex: WebGLTexture; fbo: WebGLFramebuffer } => {
        const t = gl.createTexture()!
        gl.bindTexture(gl.TEXTURE_2D, t)
        gl.texStorage2D(gl.TEXTURE_2D, 1, f, w, h)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        const fbo = gl.createFramebuffer()!
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        return { tex: t, fbo }
      }
      const hdr = gl.getExtension('EXT_color_buffer_float')
      const meanT = target(1, 1, hdr ? gl.RGBA16F : gl.RGBA8)
      const stripT = target(STRIP_W, STRIP_H, gl.RGBA8)
      const aniso = gl.getExtension('EXT_texture_filter_anisotropic')

      // The master, its mip chain with it, rebuilt when the master's size changes.
      let tex: WebGLTexture | null = null
      let size = 0
      let seen = -1
      let skipped = 0
      let hasTex = false
      const gov = new ViewerGovernor()
      let takeMs = 0
      let takes = 0
      let takenAt = 0
      const take = (src: HTMLCanvasElement): void => {
        const n = src.width
        if (!tex || size !== n) {
          if (tex) gl.deleteTexture(tex)
          tex = gl.createTexture()!
          gl.bindTexture(gl.TEXTURE_2D, tex)
          gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(n)) + 1, gl.RGBA8, n, n)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
          if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, Number(gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) || 1))
          size = n
        }
        const t0 = performance.now()
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src)
        gl.generateMipmap(gl.TEXTURE_2D)
        takeMs += (performance.now() - t0 - takeMs) * 0.1
        takes++
        takenAt = t0
        hasTex = true
      }

      // The turning speed : an 8 KB strip, read back without waiting, ten times a second.
      const meter = new RotationMeter()
      const pbo = gl.createBuffer()!
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo)
      gl.bufferData(gl.PIXEL_PACK_BUFFER, STRIP_W * STRIP_H * 4, gl.STREAM_COPY)
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
      const stripPx = new Uint8Array(STRIP_W * STRIP_H * 4)
      let fence: WebGLSync | null = null
      let stripAt = 0
      const readStrip = (now: number, masterHalf: number): void => {
        if (fence) {
          const st = gl.clientWaitSync(fence, 0, 0)
          if (st !== gl.ALREADY_SIGNALED && st !== gl.CONDITION_SATISFIED) {
            if (now - stripAt < 2000) return
          } else {
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo)
            gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, stripPx)
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
            meter.push(stripPx, stripAt)
          }
          gl.deleteSync(fence)
          fence = null
        }
        // a picture taken since, and timed by when it was taken
        if (takenAt - stripAt < 95) return
        stripAt = takenAt
        gl.disable(gl.DEPTH_TEST)
        gl.disable(gl.CULL_FACE)
        gl.bindFramebuffer(gl.FRAMEBUFFER, stripT.fbo)
        gl.viewport(0, 0, STRIP_W, STRIP_H)
        gl.useProgram(strip.p)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.uniform1i(strip.u('uTex'), 0)
        gl.uniform2f(strip.u('uScale'), 1, 1)
        gl.uniform1f(strip.u('uMasterHalf'), masterHalf)
        gl.uniform1f(strip.u('uLod'), Math.max(0, Math.log2(size / 512)))
        gl.bindVertexArray(quad.vao)
        gl.drawArrays(gl.TRIANGLES, 0, 6)
        gl.bindVertexArray(null)
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo)
        gl.readPixels(0, 0, STRIP_W, STRIP_H, gl.RGBA, gl.UNSIGNED_BYTE, 0)
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
      }

      let onScreen = true
      const IO = (win as unknown as typeof globalThis).IntersectionObserver
      const io = IO ? new IO((es) => { onScreen = es[es.length - 1].isIntersecting }) : null
      io?.observe(canvas)
      let last = 0
      let lastCfg: unknown = null
      let lastCam = ''
      let govAt = 0
      let infoAt = 0
      let rate = 0
      const draw = (now: number): void => {
        if (dead || gl.isContextLost()) return
        raf = win.requestAnimationFrame(draw)
        const dt = last ? Math.min(0.1, (now - last) / 1000) : 0
        last = now
        const { cfg: c, view: vw, covered: cov, onStep: step, onInfo: tell } = live.current
        if (!onScreen || cov || canvas.ownerDocument.hidden || canvas.clientWidth === 0) { meter.reset(); return }
        step?.(dt)
        if (now - govAt >= 1000) {
          rate = govAt ? (takes * 1000) / (now - govAt) : 0
          takes = 0
          govAt = now
          gov.tick(currentFps(), takeMs)
        }
        // A new master on the canvas : take it, or let it pass.
        let dirty = false
        const src = outputCanvas()
        if (src && domeFrame.serial !== seen && src.width === src.height && src.width === c.res) {
          seen = domeFrame.serial
          if (!hasTex || size !== src.width || ++skipped >= gov.every()) {
            skipped = 0
            take(src)
            dirty = true
          }
        }
        const masterHalf = (c.aperture * Math.PI) / 360
        if (hasTex && c.sim.readings && vw === '3d') readStrip(now, masterHalf)
        if (now - infoAt > 200) {
          infoAt = now
          tell?.({ size: hasTex ? size : 0, takes: rate, takeMs, turning: meter.value })
        }
        const dpr = Math.min(2, win.devicePixelRatio || 1)
        const box = canvas.getBoundingClientRect()
        const W = Math.max(2, Math.round(box.width * dpr)), H = Math.max(2, Math.round(box.height * dpr))
        if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; dirty = true }
        const cam = domeCam
        const camKey = `${cam.yaw},${cam.pitch},${cam.dist},${cam.x},${cam.y},${cam.z},${vw}`
        if (camKey !== lastCam || lastCfg !== c) { lastCam = camKey; lastCfg = c; dirty = true }
        if (!dirty) return // the same picture from the same place

        const room = domeRoom(c)
        if (Math.abs(room.halfAp - meshAp) > 1e-6) { rebuild(room.halfAp); meshAp = room.halfAp }
        const wash = c.sim.wash
        if (hasTex && wash > 0.001 && vw === '3d') {
          gl.disable(gl.DEPTH_TEST)
          gl.disable(gl.CULL_FACE)
          gl.bindFramebuffer(gl.FRAMEBUFFER, meanT.fbo)
          gl.viewport(0, 0, 1, 1)
          gl.useProgram(mean.p)
          gl.activeTexture(gl.TEXTURE0)
          gl.bindTexture(gl.TEXTURE_2D, tex)
          gl.uniform1i(mean.u('uTex'), 0)
          gl.uniform2f(mean.u('uScale'), 1, 1)
          gl.uniform1f(mean.u('uHalfAp'), room.halfAp)
          gl.uniform1f(mean.u('uMasterHalf'), masterHalf)
          gl.uniform1f(mean.u('uLod'), Math.max(0, Math.log2(size / 16)))
          gl.bindVertexArray(quad.vao)
          gl.drawArrays(gl.TRIANGLES, 0, 6)
          gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        }
        gl.viewport(0, 0, W, H)
        gl.clearColor(0.02, 0.02, 0.025, 1)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, tex)
        if (vw !== '3d') {
          gl.disable(gl.DEPTH_TEST)
          gl.disable(gl.CULL_FACE)
          gl.useProgram(flat.p)
          const ratio = vw === 'equirect' ? 2 : 1
          const fit = Math.min(W / ratio, H)
          gl.uniform2f(flat.u('uScale'), (fit * ratio) / W, fit / H)
          gl.uniform1i(flat.u('uTex'), 0)
          gl.uniform1i(flat.u('uEqui'), vw === 'equirect' ? 1 : 0)
          gl.uniform1f(flat.u('uMasterHalf'), masterHalf)
          gl.uniform1f(flat.u('uTemplate'), c.sim.template)
          gl.bindVertexArray(quad.vao)
          if (hasTex) gl.drawArrays(gl.TRIANGLES, 0, 6)
          gl.bindVertexArray(null)
          return
        }
        gl.enable(gl.DEPTH_TEST)
        const inside = c.sim.view === 'inside'
        // Outside : a CUTAWAY. Seen from outside, the dome's outer shell winds
        // clockwise (back-facing); culling it leaves the far half's INNER surface,
        // so the content reads the right way round instead of mirrored through the shell.
        // Inside, the inner surface faces the camera, so culling changes nothing at
        // the seat; once the camera BACKS OFF through the wall, the wall between
        // it and the dome is culled too and the whole inside stays in view. The floor
        // and the wall under the rim follow the same rule.
        gl.enable(gl.CULL_FACE)
        gl.cullFace(gl.BACK)
        const fov = ((inside ? c.sim.fov : 50) * Math.PI) / 180
        const P = persp(fov, W / H, 0.05, 400)
        const d = lookDir(cam.yaw, cam.pitch)
        const headY = cam.best ? room.cy : cam.y
        let V: M4
        if (inside) {
          // `back` slides the eye backwards along the look (in radii), so backing
          // off turns the seat into an orbit that keeps the middle framed.
          const b = c.sim.back * room.R
          const e = [cam.x - d[0] * b, headY - d[1] * b, cam.z - d[2] * b]
          V = lookAt(e, [e[0] + d[0], e[1] + d[1], e[2] + d[2]], [0, 1, 0])
        } else {
          const r = cam.dist * room.R
          V = lookAt([r * d[0], room.cy + r * d[1], r * d[2]], [0, room.cy + 0.25 * room.R, 0], [0, 1, 0])
        }
        const t = (c.sim.tilt * Math.PI) / 180
        const ct = Math.cos(t), st = Math.sin(t)
        const mvp = mul(P, V)
        gl.useProgram(dome.p)
        gl.uniformMatrix4fv(dome.u('uMVP'), false, mvp)
        gl.uniformMatrix3fv(dome.u('uTilt'), false, new Float32Array([1, 0, 0, 0, ct, st, 0, -st, ct]))
        gl.uniform1f(dome.u('uR'), room.R)
        gl.uniform1f(dome.u('uCy'), room.cy)
        gl.uniform1i(dome.u('uTex'), 0)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, meanT.tex)
        gl.uniform1i(dome.u('uMean'), 1)
        gl.activeTexture(gl.TEXTURE0)
        gl.uniform1i(dome.u('uHasTex'), hasTex ? 1 : 0)
        gl.uniform1f(dome.u('uHalfAp'), room.halfAp)
        gl.uniform1f(dome.u('uMasterHalf'), masterHalf)
        gl.uniform1f(dome.u('uTemplate'), c.sim.template)
        // In a closed matte sphere, light bounced off one place lands evenly
        // everywhere (the integrating sphere) : a cap holding the share f of it,
        // white by rho, sends back rho f / (1 - rho f) of its own mean light.
        const f = (1 - Math.cos(room.halfAp)) / 2
        gl.uniform1f(dome.u('uWash'), wash > 0.001 ? (wash * f) / (1 - wash * f) : 0)
        gl.uniform1i(dome.u('uMarks'), c.sim.marks ? 1 : 0)
        gl.uniform1i(dome.u('uSweet'), c.sim.sweet ? 1 : 0)
        const rad = Math.PI / 180
        gl.uniform3f(dome.u('uSweetBox'), (c.sim.sweetW / 2) * rad, Math.min(c.sim.sweetLo, c.sim.sweetHi) * rad, Math.max(c.sim.sweetLo, c.sim.sweetHi) * rad)
        gl.bindVertexArray(capVao.vao)
        gl.drawElements(gl.TRIANGLES, nIdx, gl.UNSIGNED_INT, 0)
        // The floor (under a tilted or a low dome's rim, never through the screen),
        // the wall between the rim and the floor, you.
        gl.useProgram(room3.p)
        gl.uniformMatrix4fv(room3.u('uMVP'), false, mvp)
        gl.uniform1f(room3.u('uRim'), room.rimR)
        const low = room.cy + room.R * Math.cos(Math.min(Math.PI, room.halfAp + Math.abs(t)))
        const floorY = Math.min(0, low - 0.02)
        gl.bindVertexArray(roomVao.vao)
        const part = (kind: number, r: [number, number], sx: number, sy: number, x: number, y: number, z: number, mode: number): void => {
          gl.uniform1i(room3.u('uKind'), kind)
          gl.uniform3f(room3.u('uScale'), sx, sy, sx)
          gl.uniform3f(room3.u('uAt'), x, y, z)
          gl.drawArrays(mode, r[0], r[1])
        }
        part(0, shapes.floor, room.rimR, 1, 0, floorY, 0, gl.TRIANGLES)
        if (t === 0 && room.rimY - floorY > 0.03) part(1, shapes.wall, room.rimR, room.rimY - floorY, 0, floorY, 0, gl.TRIANGLES)
        if (!inside || c.sim.back > 0.15) part(2, shapes.figure, 1, Math.max(0.1, headY - floorY), cam.x, floorY, cam.z, gl.LINES)
        gl.bindVertexArray(null)
      }
      raf = win.requestAnimationFrame(draw)
      teardown.push(() => {
        win.cancelAnimationFrame(raf)
        io?.disconnect()
        if (fence) gl.deleteSync(fence)
        gl.deleteBuffer(pbo)
        if (tex) gl.deleteTexture(tex)
        for (const x of [meanT, stripT]) { gl.deleteTexture(x.tex); gl.deleteFramebuffer(x.fbo) }
        for (const x of [quad, roomVao, capVao]) { gl.deleteBuffer(x.buf); gl.deleteVertexArray(x.vao) }
        gl.deleteBuffer(capIdx)
        for (const x of [dome, room3, flat, mean, strip]) gl.deleteProgram(x.p)
      })
    }
    start()
    // A graphics reset : everything built here is gone, build it again.
    const lost = (e: Event): void => { e.preventDefault(); win.cancelAnimationFrame(raf) }
    const back = (): void => { teardown.splice(0).forEach((f) => f()); if (!dead) start() }
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', back)
    return () => {
      dead = true
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', back)
      teardown.splice(0).forEach((f) => f())
    }
  }, [])

  return <canvas ref={canvasRef} className="block h-full w-full" />
}
