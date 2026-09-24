// Fulldome simulator : the live domemaster wrapped back onto a dome, seen from
// inside (the audience's seat) or orbiting outside : the in-app port of the
// TouchDesigner FulldomeSimulator (equiazimuth sphere cap, dome tilt, camera
// FOV, sweet-spot patch, alignment template at low opacity, the rim ring).
//
// It runs in its OWN WebGL2 context and takes a 1024² read of the master that the
// engine's render loop leaves in engine/domePreview (a captureStream of the 4K
// canvas cost the page ~40 fps). `flat` shows that master as a square instead of
// wrapping it on the dome. The cap mesh uses the
// same direction ↔ master mapping as engine/dome.ts, so what reads correctly
// here reads correctly under a real dome.

import { useEffect, useRef, type RefObject } from 'react'
import type { DomeConfig } from '@shared/dome'
import { domePreview } from '../engine/domePreview'

const VS = `#version 300 es
in vec3 aPos; in vec2 aAng;
uniform mat4 uMVP; uniform mat3 uTilt;
out vec2 vAng;
void main(){ vAng = aAng; gl_Position = uMVP * vec4(uTilt * aPos, 1.0); }`

const FS = `#version 300 es
precision highp float;
in vec2 vAng; out vec4 o;
uniform sampler2D uTex;
uniform int uHasTex;
uniform float uHalfAp, uTemplate;
uniform int uSweet;
uniform vec3 uSweetBox;   // half width (az), low, high (elevation), radians
const float PI = 3.14159265359;
float gridLine(float x, float period){
  float t = x / period;
  float d = abs(fract(t + 0.5) - 0.5) / max(fwidth(t), 1e-5);
  return 1.0 - clamp(d, 0.0, 1.0);
}
void main(){
  float theta = vAng.x, az = vAng.y;
  float r = theta / uHalfAp;
  vec2 uv = r * vec2(sin(az), -cos(az)) * 0.5 + 0.5;
  vec3 col = uHasTex == 1 ? texture(uTex, uv).rgb : vec3(0.06);
  float el = 0.5 * PI - theta;
  if (uTemplate > 0.001) {
    float g = max(gridLine(el, radians(10.0)), gridLine(az, radians(30.0)) * step(0.05, theta));
    col = mix(col, vec3(0.92), g * uTemplate);
    float hor = gridLine(el, radians(360.0));          // only the 0° line survives the period
    col = mix(col, vec3(0.1, 0.85, 1.0), hor * min(1.0, uTemplate * 2.5));
    float front = (1.0 - clamp(abs(az) / max(fwidth(az) * 1.5, 1e-5), 0.0, 1.0)) * step(0.0, el + 0.3);
    col = mix(col, vec3(1.0, 0.2, 0.1), front * min(1.0, uTemplate * 2.5));
  }
  if (uSweet == 1) {
    float inAz = step(abs(az), uSweetBox.x);
    float inEl = step(uSweetBox.y, el) * step(el, uSweetBox.z);
    float inside = inAz * inEl;
    col = mix(col, vec3(1.0, 0.18, 0.12), inside * 0.12);
    float bx = 1.0 - clamp(abs(abs(az) - uSweetBox.x) / max(fwidth(az) * 1.2, 1e-5), 0.0, 1.0);
    float by = max(1.0 - clamp(abs(el - uSweetBox.y) / max(fwidth(el) * 1.2, 1e-5), 0.0, 1.0),
                   1.0 - clamp(abs(el - uSweetBox.z) / max(fwidth(el) * 1.2, 1e-5), 0.0, 1.0));
    float edge = max(bx * inEl, by * inAz);
    col = mix(col, vec3(1.0, 0.2, 0.12), edge * 0.9);
  }
  // The rim : a thin ring where the projection surface ends.
  float rim = smoothstep(0.985, 1.0, r);
  col = mix(col, vec3(0.9, 0.2, 0.15), rim * 0.8);
  o = vec4(col, 1.0);
}`

// The flat master view : the square master letterboxed into the canvas.
const FLAT_VS = `#version 300 es
in vec2 p; uniform vec2 uScale; out vec2 vUv;
void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p * uScale, 0.0, 1.0); }`
const FLAT_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o; uniform sampler2D uTex;
void main(){ o = vec4(texture(uTex, vUv).rgb, 1.0); }`

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

/** The cap : rings from the zenith to half the aperture, the azimuth seam at the
 *  BACK (±π) so interpolation never crosses the front. */
function buildCap(halfAp: number): { pos: Float32Array; ang: Float32Array; idx: Uint32Array } {
  const NT = 72, NP = 160
  const pos: number[] = [], ang: number[] = [], idx: number[] = []
  for (let i = 0; i <= NT; i++) {
    const th = (i / NT) * halfAp
    for (let j = 0; j <= NP; j++) {
      const az = -Math.PI + (j / NP) * Math.PI * 2
      pos.push(Math.sin(th) * Math.sin(az), Math.cos(th), -Math.sin(th) * Math.cos(az))
      ang.push(th, az)
    }
  }
  const row = NP + 1
  for (let i = 0; i < NT; i++)
    for (let j = 0; j < NP; j++) {
      const a = i * row + j, b = a + row
      idx.push(a, b, a + 1, a + 1, b, b + 1)
    }
  return { pos: new Float32Array(pos), ang: new Float32Array(ang), idx: new Uint32Array(idx) }
}

export function DomeSim({ cfg, cam, flat = false }: {
  cfg: DomeConfig
  cam: RefObject<{ yaw: number; pitch: number; dist: number; fov: number }>
  flat?: boolean
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const cfgRef = useRef(cfg)
  cfgRef.current = cfg
  const flatRef = useRef(flat)
  flatRef.current = flat

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl2', { antialias: true })
    if (!gl) return
    const mk = (t: number, s: string): WebGLShader => {
      const sh = gl.createShader(t)!
      gl.shaderSource(sh, s)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error('[domeSim]', gl.getShaderInfoLog(sh))
      return sh
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS))
    gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS))
    gl.linkProgram(prog)
    const U = (n: string): WebGLUniformLocation | null => gl.getUniformLocation(prog, n)
    const flatProg = gl.createProgram()!
    gl.attachShader(flatProg, mk(gl.VERTEX_SHADER, FLAT_VS))
    gl.attachShader(flatProg, mk(gl.FRAGMENT_SHADER, FLAT_FS))
    gl.bindAttribLocation(flatProg, 0, 'p')
    gl.linkProgram(flatProg)
    const flatVao = gl.createVertexArray()!
    const flatBuf = gl.createBuffer()!
    gl.bindVertexArray(flatVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, flatBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    const aPos = gl.getAttribLocation(prog, 'aPos'), aAng = gl.getAttribLocation(prog, 'aAng')
    const vao = gl.createVertexArray()!
    const bPos = gl.createBuffer()!, bAng = gl.createBuffer()!, bIdx = gl.createBuffer()!
    let nIdx = 0
    let meshAp = -1
    const rebuild = (halfAp: number): void => {
      const m = buildCap(halfAp)
      gl.bindVertexArray(vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, bPos); gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW)
      gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ARRAY_BUFFER, bAng); gl.bufferData(gl.ARRAY_BUFFER, m.ang, gl.STATIC_DRAW)
      gl.enableVertexAttribArray(aAng); gl.vertexAttribPointer(aAng, 2, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bIdx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW)
      gl.bindVertexArray(null)
      nIdx = m.idx.length
    }
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    let hasTex = false
    let seen = -1
    let texSize = 0

    let raf = 0
    const draw = (): void => {
      raf = requestAnimationFrame(draw)
      const c = cfgRef.current
      const cm = cam.current!
      const dpr = window.devicePixelRatio || 1
      const W = Math.max(2, Math.round(canvas.clientWidth * dpr)), H = Math.max(2, Math.round(canvas.clientHeight * dpr))
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H }
      const halfAp = (c.aperture * Math.PI) / 360
      if (Math.abs(halfAp - meshAp) > 1e-6) { rebuild(halfAp); meshAp = halfAp }
      // Upload the newest master read (bottom-up rows = the GL uv convention).
      if (domePreview.px && domePreview.serial !== seen && domePreview.size > 0) {
        seen = domePreview.serial
        const n = domePreview.size
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
        if (texSize !== n) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, domePreview.px)
          texSize = n
        } else {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, domePreview.px)
        }
        hasTex = true
      }
      gl.viewport(0, 0, W, H)
      gl.clearColor(0.02, 0.02, 0.025, 1)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      if (flatRef.current) {
        gl.disable(gl.DEPTH_TEST)
        gl.disable(gl.CULL_FACE)
        gl.useProgram(flatProg)
        const side = Math.min(W, H)
        gl.uniform2f(gl.getUniformLocation(flatProg, 'uScale'), side / W, side / H)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.uniform1i(gl.getUniformLocation(flatProg, 'uTex'), 0)
        gl.bindVertexArray(flatVao)
        if (hasTex) gl.drawArrays(gl.TRIANGLES, 0, 6)
        gl.bindVertexArray(null)
        return
      }
      gl.enable(gl.DEPTH_TEST)
      const inside = c.sim.view === 'inside'
      // Outside : a CUTAWAY. Seen from outside, the dome's outer shell winds
      // clockwise (back-facing); culling it leaves the far half's INNER surface,
      // so the content reads the right way round instead of mirrored through the shell.
      if (inside) gl.disable(gl.CULL_FACE)
      else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK) }
      const fov = ((inside ? cm.fov : 50) * Math.PI) / 180
      const P = persp(fov, W / H, 0.01, 50)
      const cy = Math.cos(cm.pitch), sy = Math.sin(cm.pitch)
      let V: M4
      if (inside) {
        const d = [cy * Math.sin(cm.yaw), sy, -cy * Math.cos(cm.yaw)]
        V = lookAt([0, 0, 0], d, [0, 1, 0])
      } else {
        const e = [cm.dist * cy * Math.sin(cm.yaw), cm.dist * sy, -cm.dist * cy * Math.cos(cm.yaw)]
        V = lookAt(e, [0, 0.25, 0], [0, 1, 0])
      }
      const t = (c.sim.tilt * Math.PI) / 180
      const ct = Math.cos(t), st = Math.sin(t)
      gl.useProgram(prog)
      gl.uniformMatrix4fv(U('uMVP'), false, mul(P, V))
      gl.uniformMatrix3fv(U('uTilt'), false, new Float32Array([1, 0, 0, 0, ct, st, 0, -st, ct]))
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.uniform1i(U('uTex'), 0)
      gl.uniform1i(U('uHasTex'), hasTex ? 1 : 0)
      gl.uniform1f(U('uHalfAp'), halfAp)
      gl.uniform1f(U('uTemplate'), c.sim.template)
      gl.uniform1i(U('uSweet'), c.sim.sweet ? 1 : 0)
      const rad = Math.PI / 180
      gl.uniform3f(U('uSweetBox'), (c.sim.sweetW / 2) * rad, Math.min(c.sim.sweetLo, c.sim.sweetHi) * rad, Math.max(c.sim.sweetLo, c.sim.sweetHi) * rad)
      gl.bindVertexArray(vao)
      gl.drawElements(gl.TRIANGLES, nIdx, gl.UNSIGNED_INT, 0)
      gl.bindVertexArray(null)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      gl.deleteTexture(tex)
      gl.deleteBuffer(flatBuf); gl.deleteVertexArray(flatVao); gl.deleteProgram(flatProg)
      gl.deleteBuffer(bPos); gl.deleteBuffer(bAng); gl.deleteBuffer(bIdx)
      gl.deleteVertexArray(vao)
      gl.deleteProgram(prog)
    }
  }, [cam])

  return <canvas ref={canvasRef} className="h-full w-full" />
}
