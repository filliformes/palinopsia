// World Visualizer — a self-contained preview that shows what a World *does*.
// It runs its own tiny WebGL2 canvas: two drifting noise fields (the A/B voices)
// crossfaded by a mix that a SIMULATED audio pulse drives through the World's
// coupling (so you see cut flash / gate / drift behave), then the Context mood
// (bloom · haze · depth vignette · feedback trails) on top.
//
// It's a preview, not the compositor: the coupling maths are replicated here
// against a fake audio signal, so it works with no audio input and no sources.

import { useEffect, useRef } from 'react'
import type { LayerCoupling } from '@shared/types'

const VS = `#version 300 es
in vec2 p; out vec2 v_uv;
void main(){ v_uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`

const FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 frag;
uniform sampler2D uPrev;
uniform float uTime, uMix, uHaze, uBloom, uDepth, uTrails;
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
float fbm(vec2 p){ float s=0.,a=.5; for(int i=0;i<4;i++){ s+=a*vn(p); p*=2.03; a*=.5; } return s; }
void main(){
  vec2 uv=v_uv;
  float na=fbm(uv*4.0 + vec2(uTime*0.15, uTime*0.05));
  float nb=fbm(uv*6.0 + vec2(-uTime*0.10, uTime*0.13) + 20.0);
  float n=mix(na, nb, clamp(uMix,0.,1.));
  // matte digital palette — near-black lifting to a warm accent, subtle cool floor
  vec3 col = mix(vec3(0.02,0.03,0.05), vec3(0.92,0.55,0.20), smoothstep(0.35,0.82,n));
  col = mix(col, vec3(0.18,0.36,0.62), smoothstep(0.2,0.5,na)*0.28);
  col += uBloom * pow(smoothstep(0.6,1.0,n),2.0) * vec3(1.0,0.85,0.6);
  col = mix(col, vec3(0.5,0.58,0.72), uHaze*0.6);
  float d = distance(uv, vec2(0.5));
  col *= 1.0 - uDepth*smoothstep(0.2,0.75,d);
  vec3 prev = texture(uPrev, uv).rgb;
  col = mix(col, prev, clamp(uTrails,0.,0.92));
  frag = vec4(col,1.0);
}`

// Replicated coupling maths (mirror of engine/coupling.ts) against a supplied
// feature value + local state — so the preview behaves like the real engine.
function couplingMix(
  cp: LayerCoupling,
  raw: number,
  base: number,
  st: { held: number }
): number {
  if (cp.mode === 'off') return base
  const tight = Math.max(0, Math.min(1, cp.tightness))
  const amt = Math.max(0, Math.min(1, cp.amount))
  const shaped = Math.pow(Math.max(0, Math.min(1, raw)), 1 + (1 - tight) * 3)
  const toB = (g: number): number => base + g * amt * (1 - base)
  let eff = base
  switch (cp.mode) {
    case 'lean': eff = toB(shaped); break
    case 'hocket': eff = base * (1 - amt) + shaped * amt; break
    case 'cut':
      if (raw > 0.4) st.held = 1
      else st.held *= 0.6 + tight * 0.38
      eff = toB(st.held)
      break
    case 'gate': {
      const lo = 0.5 - tight * 0.22
      const t = Math.max(0, Math.min(1, (raw - lo) / 0.16))
      eff = toB(t * t * (3 - 2 * t))
      break
    }
    case 'drift':
      st.held += (raw - st.held) * (0.01 + tight * 0.06)
      eff = toB(st.held)
      break
  }
  return Math.max(0, Math.min(1, eff))
}

export function WorldVisualizer({
  coupling,
  context
}: {
  coupling: LayerCoupling
  context: Record<string, number>
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Latest world params, read by the rAF loop without re-creating the GL.
  const paramsRef = useRef({ coupling, context })
  paramsRef.current = { coupling, context }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl2', { antialias: false })
    if (!gl) return
    const W = 320
    const H = 180
    canvas.width = W
    canvas.height = H

    const compile = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('[world-viz] shader compile:', gl.getShaderInfoLog(s))
      }
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS))
    gl.bindAttribLocation(prog, 0, 'p')
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      // Driver rejected the program — log and bail rather than spin a rAF on a
      // dead program (leaves the canvas black, but no runaway loop).
      console.error('[world-viz] program link:', gl.getProgramInfoLog(prog))
      gl.deleteProgram(prog)
      return
    }
    gl.useProgram(prog)

    const quad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    // Two feedback targets (ping-pong) for the trails.
    const makeTex = (): WebGLTexture => {
      const t = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      return t
    }
    let texA = makeTex()
    let texB = makeTex()
    const fbo = gl.createFramebuffer()!

    const u = (n: string): WebGLUniformLocation | null => gl.getUniformLocation(prog, n)
    const uTime = u('uTime')
    const uMix = u('uMix')
    const uHaze = u('uHaze')
    const uBloom = u('uBloom')
    const uDepth = u('uDepth')
    const uTrails = u('uTrails')
    gl.uniform1i(u('uPrev'), 0)

    const st = { held: 0.5 }
    let mix = 0.5
    let raf = 0
    let last = performance.now()
    const t0 = last

    // A lost GL context (GPU reset / backgrounding) must stop the loop instead
    // of spinning on dead objects.
    const onLost = (e: Event): void => {
      e.preventDefault()
      cancelAnimationFrame(raf)
    }
    canvas.addEventListener('webglcontextlost', onLost)

    const loop = (): void => {
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const time = (now - t0) / 1000
      const { coupling: cp, context: ctx } = paramsRef.current

      // Simulated audio: a ~2 Hz beat with a decaying transient + envelope, plus
      // slow tonal drifts — one value per feature so any coupling feature works.
      const beat = (time * 2) % 1
      const transient = Math.exp(-beat * 9)
      const level = 0.25 + 0.6 * Math.exp(-beat * 3)
      const flux = transient * 0.9
      const centroid = 0.5 + 0.4 * Math.sin(time * 0.7)
      const pitch = 0.5 + 0.45 * Math.sin(time * 0.31)
      const feat: Record<string, number> = {
        level, transient, flux, centroid, pitch, band: level
      }
      const raw = feat[cp.feature] ?? level
      mix = couplingMix(cp, raw, 0.5, st)

      // Pass 1 — render into texB, sampling texA (previous) for trails.
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texB, 0)
      gl.viewport(0, 0, W, H)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texA)
      gl.uniform1f(uTime, time)
      gl.uniform1f(uMix, mix)
      gl.uniform1f(uHaze, ctx.haze ?? 0)
      gl.uniform1f(uBloom, ctx.bloom ?? 0)
      gl.uniform1f(uDepth, ctx.depth ?? 0)
      gl.uniform1f(uTrails, ctx.trails ?? 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      // Blit the rendered frame (texB, attached to fbo) to the visible canvas —
      // a true copy, so the shader isn't re-run without trails.
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)

      // Swap ping-pong.
      const tmp = texA
      texA = texB
      texB = tmp
      void dt
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('webglcontextlost', onLost)
      gl.deleteProgram(prog)
      gl.deleteBuffer(quad)
      gl.deleteTexture(texA)
      gl.deleteTexture(texB)
      gl.deleteFramebuffer(fbo)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full rounded border border-border bg-black"
      style={{ aspectRatio: '16 / 9', imageRendering: 'auto' }}
      title="World preview — simulated audio pulse driving A/B coupling + Context mood"
    />
  )
}
