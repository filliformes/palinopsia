// World Visualizer — shows what a World *does*, on REAL Opsia material. It runs
// two actual ISF generators (slot A + slot B) into textures, crossfades them by
// a mix that a SIMULATED audio signal drives through the World's coupling (so you
// see cut flash / gate / drift behave), then lays the Context mood (bloom · haze ·
// depth vignette · feedback trails) on top. Pick a source PAIR to read the World
// on different material; drive it with a synthetic audio shape.
//
// The generators render through the same redirect-proxy the compositor uses, on
// this widget's own WebGL2 context — a self-contained preview needing no audio
// input and no live layers.

import { useEffect, useRef } from 'react'
import type { LayerCoupling } from '@shared/types'
import { Renderer as ISFRenderer } from 'interactive-shader-format'
import { makeRedirectableGL } from '../engine/Compositor'
import { SHADER_BY_ID } from '../shaders/isf'

export interface SimAudio {
  shape: 'pulse' | 'sine' | 'ramp' | 'noise'
  freqHz: number // 0.2 .. 8
  rhythmic: boolean
  gain: number // 0..1
}

// Five source PAIRS of real generators, each chosen to read DISTINCTLY so the
// A↔B coupling crossfade is legible.
export const WORLD_SOURCE_PAIRS: Array<{ name: string; a: string; b: string }> = [
  { name: 'Filaments × Slabs', a: 'filaments', b: 'slabs' },
  { name: 'Murmuration × Membrane', a: 'murmuration', b: 'membrane' },
  { name: 'Grid Drift × Interference', a: 'grid-drift', b: 'interference' },
  { name: 'Contour × Mycelium', a: 'contour', b: 'mycelium' },
  { name: 'Swell × Ramps', a: 'swell', b: 'ramps' }
]

const hashN = (n: number): number => {
  const x = Math.sin(n * 127.1) * 43758.5453
  return x - Math.floor(x)
}

/** Simulated audio features from the config at time t (seconds). Deterministic,
 *  so the visualizer loop and the VU meter compute the same value each instant. */
export function simAudio(
  cfg: SimAudio,
  t: number
): { level: number; transient: number; flux: number; centroid: number; pitch: number } {
  const ph = (t * cfg.freqHz) % 1
  let env: number
  if (cfg.shape === 'sine') env = 0.5 + 0.5 * Math.sin(ph * Math.PI * 2)
  else if (cfg.shape === 'ramp') env = 1 - ph
  else if (cfg.shape === 'noise') {
    const i = Math.floor(t * cfg.freqHz)
    env = hashN(i) * (1 - ph) + hashN(i + 1) * ph
  } else env = Math.exp(-ph * 7) // pulse — percussive decay
  const g = cfg.gain
  const level = cfg.rhythmic ? env * g : (0.35 + 0.5 * env) * g
  const transient = cfg.rhythmic ? Math.exp(-ph * 12) * g : Math.max(0, env - 0.6) * g
  return {
    level: Math.min(1, level),
    transient: Math.min(1, transient),
    flux: Math.min(1, transient * 0.9),
    centroid: 0.5 + 0.4 * Math.sin(t * 0.7),
    pitch: 0.5 + 0.45 * Math.sin(t * 0.31)
  }
}

// Replicated coupling maths (mirror of engine/coupling.ts) against a supplied
// feature value + local state — so the preview behaves like the real engine.
function couplingMix(cp: LayerCoupling, raw: number, base: number, st: { held: number }): number {
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

const VS = `#version 300 es
in vec2 p; out vec2 v_uv;
void main(){ v_uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`

// Composite: crossfade the two real generators by the coupled mix, then the
// Context mood on top (bloom · haze wash · depth vignette · feedback trails).
const FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 frag;
uniform sampler2D uA, uB, uPrev;
uniform float uMix, uHaze, uBloom, uDepth, uTrails;
void main(){
  vec2 uv = v_uv;
  vec3 a = texture(uA, uv).rgb;
  vec3 b = texture(uB, uv).rgb;
  vec3 col = mix(a, b, clamp(uMix, 0.0, 1.0));
  float l = max(col.r, max(col.g, col.b));
  col += uBloom * pow(smoothstep(0.55, 1.0, l), 2.0) * vec3(1.0, 0.9, 0.7);
  col = mix(col, vec3(0.52, 0.58, 0.7), uHaze * 0.5);
  float d = distance(uv, vec2(0.5));
  col *= 1.0 - uDepth * smoothstep(0.2, 0.78, d);
  vec3 prev = texture(uPrev, uv).rgb;
  col = mix(col, prev, clamp(uTrails, 0.0, 0.92));
  frag = vec4(col, 1.0);
}`

interface Params {
  coupling: LayerCoupling
  context: Record<string, number>
  audio: SimAudio
}

export function WorldVisualizer({
  coupling,
  context,
  audio,
  sourceIdx
}: {
  coupling: LayerCoupling
  context: Record<string, number>
  audio: SimAudio
  sourceIdx: number
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const paramsRef = useRef<Params>({ coupling, context, audio })
  paramsRef.current = { coupling, context, audio }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl2', { antialias: false })
    if (!gl) return
    const W = 480
    const H = 270
    canvas.width = W
    canvas.height = H

    // ── Composite program (real gl) ───────────────────────────────────
    const compile = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        console.error('[world-viz] shader compile:', gl.getShaderInfoLog(s))
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS))
    gl.bindAttribLocation(prog, 0, 'p')
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
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
    const u = (n: string): WebGLUniformLocation | null => gl.getUniformLocation(prog, n)
    const uMix = u('uMix'), uHaze = u('uHaze'), uBloom = u('uBloom')
    const uDepth = u('uDepth'), uTrails = u('uTrails')
    gl.uniform1i(u('uA'), 0)
    gl.uniform1i(u('uB'), 1)
    gl.uniform1i(u('uPrev'), 2)

    // ── Targets ───────────────────────────────────────────────────────
    const makeTarget = (): { fbo: WebGLFramebuffer; tex: WebGLTexture } => {
      const tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const fbo = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      return { fbo, tex }
    }
    const genA = makeTarget() // generator A output
    const genB = makeTarget() // generator B output
    let ppRead = makeTarget() // composite trails ping-pong
    let ppWrite = makeTarget()
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    // ── Two real ISF generators through the redirect proxy ────────────
    const { gl: rgl, state } = makeRedirectableGL(gl)
    const pair = WORLD_SOURCE_PAIRS[sourceIdx % WORLD_SOURCE_PAIRS.length]
    const loadGen = (id: string): ISFRenderer | null => {
      const src = SHADER_BY_ID[id]?.source
      if (!src) return null
      try {
        const r = new ISFRenderer(rgl)
        r.loadSource(src)
        if (!r.valid) {
          console.error('[world-viz] ISF load failed', id, r.error)
          return null
        }
        return r
      } catch (e) {
        console.error('[world-viz] ISF threw', id, e)
        return null
      }
    }
    const isfA = loadGen(pair.a)
    const isfB = loadGen(pair.b)

    const st = { held: 0.5 }
    let mix = 0.5
    let raf = 0
    const t0 = performance.now()

    const onLost = (e: Event): void => {
      e.preventDefault()
      cancelAnimationFrame(raf)
    }
    canvas.addEventListener('webglcontextlost', onLost)

    const drawGen = (isf: ISFRenderer | null, target: { fbo: WebGLFramebuffer }): void => {
      if (!isf) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
        gl.viewport(0, 0, W, H)
        gl.clearColor(0.02, 0.03, 0.05, 1)
        gl.clear(gl.COLOR_BUFFER_BIT)
        return
      }
      state.redirect = target.fbo
      try {
        isf.draw({ width: W, height: H })
      } catch {
        /* a bad generator must not kill the loop */
      }
      state.redirect = null
    }

    const loop = (): void => {
      const time = (performance.now() - t0) / 1000
      const { coupling: cp, context: ctx, audio: aud } = paramsRef.current

      // Simulated audio → the coupling feature → the A/B mix.
      const feat = simAudio(aud, time)
      const raw = (feat as Record<string, number>)[cp.feature] ?? feat.level
      mix = couplingMix(cp, raw, 0.5, st)

      // 1) render the two real generators into their targets.
      drawGen(isfA, genA)
      drawGen(isfB, genB)

      // 2) composite (own program + quad; ISF draws clobbered GL state).
      gl.useProgram(prog)
      gl.bindVertexArray(null)
      gl.bindBuffer(gl.ARRAY_BUFFER, quad)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, ppWrite.fbo)
      gl.viewport(0, 0, W, H)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, genA.tex)
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, genB.tex)
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, ppRead.tex)
      gl.uniform1f(uMix, mix)
      gl.uniform1f(uHaze, ctx.haze ?? 0)
      gl.uniform1f(uBloom, ctx.bloom ?? 0)
      gl.uniform1f(uDepth, ctx.depth ?? 0)
      gl.uniform1f(uTrails, ctx.trails ?? 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      // 3) blit the composite to the visible canvas.
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, ppWrite.fbo)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)

      const tmp = ppRead
      ppRead = ppWrite
      ppWrite = tmp
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('webglcontextlost', onLost)
      try { isfA?.cleanup() } catch { /* already gone */ }
      try { isfB?.cleanup() } catch { /* already gone */ }
      gl.deleteProgram(prog)
      gl.deleteBuffer(quad)
      for (const t of [genA, genB, ppRead, ppWrite]) {
        gl.deleteTexture(t.tex)
        gl.deleteFramebuffer(t.fbo)
      }
    }
  }, [sourceIdx])

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded border border-border bg-black"
      style={{ aspectRatio: '16 / 9', imageRendering: 'auto' }}
      title="World preview — simulated audio driving A/B coupling + Context mood, on real generators"
    />
  )
}
