// MarbleSource : the native Marbling generator (id 'gen-marble'). Paint dropped
// on water, pushed into rings and lobes by the drops after it, combed, swirled
// and carried by slow currents (the model : engine/marbleModel.ts, stepped in a
// worker : workers/marbleWorker.ts). Clicking the preview drops paint, pours,
// trails, combs or swirls (pointerInput.ts routes the pointer here).
//
// How it draws : every drop is a closed outline (hundreds of points), painted
// flat, oldest first. A drop never crosses another (a younger one is always
// inside an older one or apart from it), so each pixel shows the youngest drop
// whose outline holds it :
// 1. a STENCIL FAN per outline (triangles from its first point, INVERT) leaves
//    1 exactly inside it, whatever its shape;
// 2. its box is COVERED where the stencil says inside, with the drop's depth
//    (younger nearer) : the depth test keeps the youngest, in any order, and the
//    stencil is zeroed for the next outlines.
// Drops whose boxes are apart share one fan draw and one cover draw (the worker
// groups them), so 500 drops take a few dozen draws, not a thousand. All of it
// into one 4x multisampled buffer (shared by every Marbling slot), resolved into
// this slot's own picture, which is reused while nothing moves. Straight alpha
// out; the water's alpha lets the layers below through.

import { EngineGL, SlotClock, num, col, Edge, type Prog, type Target } from './organicGL'
import type { NativeGenerator, SourcePointer } from './nativeGenerators'
import { domeFill } from './domeSignal'
import { tempoBpm } from './tempoSignal'
import { audioBus } from './audioIn'
import { glGeneration } from './glGeneration'
import type { FromWorker, MarbleSettings, ToWorker } from '../workers/marbleWorker'
import type { HandGestureLog } from '@shared/types'
import MarbleWorker from '../workers/marbleWorker?worker&inline'

const FAN_VS = `#version 300 es
layout(location = 0) in vec2 p;
uniform vec2 uScale;
void main() { gl_Position = vec4(p * uScale, 0.0, 1.0); }`

const FAN_FS = `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(0.0); }`

const COV_VS = `#version 300 es
layout(location = 0) in vec2 p;
layout(location = 1) in float depth;
layout(location = 2) in float slot;
layout(location = 3) in float fade;
uniform vec2 uScale;
uniform vec4 uPal[6];   // premultiplied (a color's alpha : the layers below show through that paint)
uniform vec4 uWater;    // premultiplied
flat out vec4 vCol;
void main() {
  int s = clamp(int(slot + 0.5), 0, 5);
  // a dissolving drop melts into the water (the oldest drops dissolve first, and
  // under the oldest drop there is only water)
  vCol = mix(uWater, uPal[s], fade);
  gl_Position = vec4(p * uScale, depth * 2.0 - 1.0, 1.0);
}`

const COV_FS = `#version 300 es
precision mediump float;
flat in vec4 vCol;
out vec4 o;
void main() { o = vCol; }`

const SHOW_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uPic;
out vec4 o;
void main() {
  vec4 c = texelFetch(uPic, ivec2(gl_FragCoord.xy), 0);
  // premultiplied (the resolve averages it) back to straight alpha
  o = c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : vec4(0.0);
}`

// ── The multisampled buffer, one per GL context and size (sources draw one after
// another, so every Marbling slot shares it : 4K at 4x is 265 MB) ──
interface Msaa { gl: WebGL2RenderingContext; gen: number; w: number; h: number; fbo: WebGLFramebuffer; rb: WebGLRenderbuffer[]; samples: number }
let msaa: Msaa | null = null
let users = 0 // Marbling slots alive : the buffer goes with the last one

function sharedMsaa(gl: WebGL2RenderingContext, w: number, h: number): Msaa {
  if (msaa && msaa.gl === gl && msaa.gen === glGeneration() && msaa.w === w && msaa.h === h) return msaa
  if (msaa && msaa.gl === gl && msaa.gen === glGeneration()) {
    gl.deleteFramebuffer(msaa.fbo)
    for (const r of msaa.rb) gl.deleteRenderbuffer(r)
  }
  const samples = Math.max(1, Math.min(4, (gl.getParameter(gl.MAX_SAMPLES) as number) || 4))
  const fbo = gl.createFramebuffer()!
  const c = gl.createRenderbuffer()!
  const ds = gl.createRenderbuffer()!
  gl.bindRenderbuffer(gl.RENDERBUFFER, c)
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h)
  gl.bindRenderbuffer(gl.RENDERBUFFER, ds)
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH24_STENCIL8, w, h)
  gl.bindRenderbuffer(gl.RENDERBUFFER, null)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, c)
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, ds)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  msaa = { gl, gen: glGeneration(), w, h, fbo, rb: [c, ds], samples }
  return msaa
}

// The declared defaults (shaders/isf/index.ts) : a slot whose colors were never
// touched sends none, and must paint the same palette the Inspector shows.
const DEFAULT_PAL: Array<[number, number, number]> = [
  [0.12, 0.17, 0.37], [0.82, 0.58, 0.2], [0.72, 0.27, 0.36], [0.94, 0.9, 0.81], [0.1, 0.1, 0.11], [0.37, 0.43, 0.28]
]
const DEFAULT_WATER = [0.95, 0.94, 0.91, 1]

const TOOL_HINTS = [
  'click : a drop · hold : pour · drag : a trail',
  'drag : a stylus through the paint · shift-drag : a comb',
  'press, then circle round the point : a swirl'
]

export class MarbleSource implements NativeGenerator {
  private g: EngineGL
  private fan: Prog
  private cov: Prog
  private show: Prog
  private pic: Target | null = null
  private fanVao: WebGLVertexArrayObject
  private covVao: WebGLVertexArrayObject
  private posBuf: WebGLBuffer
  private idxBuf: WebGLBuffer
  private covBuf: WebGLBuffer
  private posCap = 0
  private idxCap = 0
  private covCap = 0
  private groups = new Int32Array(0)
  private nGroups = 0
  private clock = new SlotClock()
  private inputs: Record<string, number | number[]> = {}
  private worker: Worker
  private waiting = false
  private sentAt = 0
  private pendDt = 0
  private ret: ArrayBuffer[] = []
  private frame: Extract<FromWorker, { t: 'frame' }> | null = null
  private dirty = true
  private drawnKey = ''
  private hw = 16 / 18
  private evDrop = new Edge()
  private evSprinkle = new Edge()
  private evClear = new Edge()
  private log: readonly HandGestureLog[] | undefined = undefined
  private commits = new Map<number, (e: HandGestureLog) => void>()
  private prevT = 0
  private stat = { drops: 0, points: 0, spreading: false, replaying: false }
  private rand = Math.random
  // the worker's last frame changed nothing (still water : it is ticked slowly, or not at all)
  private idle = false
  // something for the worker this frame (an event, a pointer, the log) : tick now
  private kick = true
  private sentKey = ''
  private pendAudio = 0

  constructor(gl: WebGL2RenderingContext, private w: number, private h: number) {
    this.g = new EngineGL(gl, 'marble')
    this.fan = this.g.prog(FAN_FS, FAN_VS)
    this.cov = this.g.prog(COV_FS, COV_VS)
    this.show = this.g.prog(SHOW_FS)
    this.posBuf = gl.createBuffer()!
    this.idxBuf = gl.createBuffer()!
    this.covBuf = gl.createBuffer()!
    // own vertex arrays (never the default one : the ISF runtime's)
    this.fanVao = gl.createVertexArray()!
    gl.bindVertexArray(this.fanVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf)
    this.covVao = gl.createVertexArray()!
    gl.bindVertexArray(this.covVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.covBuf)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 8)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 20, 12)
    gl.enableVertexAttribArray(3)
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 20, 16)
    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
    this.worker = new MarbleWorker()
    this.worker.onmessage = (e: MessageEvent<FromWorker>): void => this.onWorker(e.data)
    this.send({ t: 'seed', seed: Math.floor(Math.random() * 1e6) + 1 })
    users++
  }

  private send(m: ToWorker, tr?: Transferable[]): void {
    this.worker.postMessage(m, tr ?? [])
  }

  private onWorker(m: FromWorker): void {
    if (m.t === 'gesture') {
      const c = this.commits.get(m.pid)
      this.commits.delete(m.pid)
      c?.(m.entry)
      return
    }
    this.waiting = false
    this.stat = { drops: m.drops, points: m.points, spreading: m.spreading, replaying: m.replaying }
    this.idle = !m.changed && !m.spreading && !m.replaying
    if (m.changed) {
      // a frame not drawn yet hands its buffers straight back
      if (this.frame) this.ret.push(this.frame.pos.buffer as ArrayBuffer, this.frame.idx.buffer as ArrayBuffer, this.frame.cov.buffer as ArrayBuffer, this.frame.grp.buffer as ArrayBuffer)
      this.frame = m
    }
  }

  update(inputs: Record<string, number | number[]>): void {
    this.inputs = { ...inputs }
  }

  setInput(name: string, value: number | number[]): void {
    this.inputs[name] = value
  }

  handOps(ops: readonly HandGestureLog[] | undefined): void {
    if (ops === this.log) return
    this.log = ops
    // after the events of this frame (a clear and its emptied log arrive together)
    this.logDirty = true
  }
  private logDirty = false

  pointer(ev: SourcePointer): void {
    const x = (Math.max(-0.5, Math.min(1.5, ev.u)) - 0.5) * 2 * this.hw
    const y = Math.max(-1, Math.min(1, ev.v - 0.5))
    if (ev.phase === 'down' && ev.commit) this.commits.set(ev.pid, ev.commit)
    if (ev.phase === 'cancel') this.commits.delete(ev.pid)
    this.send({ t: 'ptr', phase: ev.phase, pid: ev.pid, x, y, shift: !!ev.shift, log: !!ev.commit, s: this.settings() })
    this.kick = true
  }

  pointerHint(): string {
    const tool = Math.max(0, Math.min(2, Math.round(num(this.inputs, 'tool', 0))))
    return TOOL_HINTS[tool]
  }

  status(): string {
    const s = this.stat
    const pts = s.points >= 1000 ? `${Math.round(s.points / 1000)}K` : `${s.points}`
    const st = s.replaying ? 'pouring the log back' : s.spreading ? 'spreading' : num(this.inputs, 'evolve', 0.3) > 0 ? 'moving' : 'still water'
    return `${s.drops} drop${s.drops === 1 ? '' : 's'} · ${pts} points · ${st}`
  }

  event(name: string, args: number[]): void {
    if (name === 'drop') {
      if (args.length >= 2 && Number.isFinite(args[0]) && Number.isFinite(args[1])) {
        const size = Number.isFinite(args[2]) ? Math.max(0.05, Math.min(4, args[2])) : 1
        this.send({ t: 'ev', name: 'drop', x: (args[0] - 0.5) * 2 * this.hw, y: args[1] - 0.5, size })
      } else this.send({ t: 'ev', name: 'drop' })
    } else if (name === 'sprinkle') this.send({ t: 'ev', name: 'sprinkle', n: Number.isFinite(args[0]) ? args[0] : undefined })
    else if (name === 'clear') this.send({ t: 'ev', name: 'clear' })
    this.kick = true
  }

  private settings(): MarbleSettings {
    const I = this.inputs
    return {
      hw: this.hw,
      size: Math.max(0.02, Math.min(1, num(I, 'size', 0.45))),
      vary: Math.max(0, Math.min(1, num(I, 'vary', 0.4))),
      crowding: Math.max(0, Math.min(1, num(I, 'crowding', 0.6))),
      spreadSec: Math.max(0.05, Math.min(5, num(I, 'spreadTime', 0.6))),
      count: Math.round(num(I, 'count', 6)),
      order: Math.round(num(I, 'order', 0)),
      tool: Math.round(num(I, 'tool', 0)),
      combSpacing: Math.max(0.01, num(I, 'spacing', 0.08)),
      budget: Math.max(5, Math.min(200, num(I, 'budget', 60))) * 1000,
      // the picture's pixels a frame height (under the dome's fill the view is
      // square, spread over the frame's longer side too)
      px: domeFill() > 0 ? Math.max(this.w, this.h) : this.h,
      auto: Math.max(0, num(I, 'auto', 0.5)),
      sync: Math.round(num(I, 'sync', 0)),
      bpm: tempoBpm(),
      sprinkleN: Math.round(num(I, 'sprinkleN', 24))
    }
  }

  render(targetFbo: WebGLFramebuffer, clockSec: number): void {
    const g = this.g
    const gl = g.gl
    if (!g.ok) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo)
      gl.viewport(0, 0, this.w, this.h)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      return
    }
    const I = this.inputs
    const dt = this.clock.tick(clockSec)
    // Under full-dome fill the dome spreads the frame's width and height over one
    // circle : the view is kept square there, so a drop stays round on the dome.
    const hw = domeFill() > 0 ? 0.5 : this.w / Math.max(1, this.h) / 2
    if (hw !== this.hw) { this.hw = hw; this.dirty = true }

    // the trigger buttons (rising edges, read now : modulation lands between update and render)
    if (this.evClear.fired(num(I, 'clear', 0))) { this.send({ t: 'ev', name: 'clear' }); this.kick = true }
    if (this.evSprinkle.fired(num(I, 'sprinkle', 0))) { this.send({ t: 'ev', name: 'sprinkle' }); this.kick = true }
    if (this.evDrop.fired(num(I, 'drop', 0))) { this.send({ t: 'ev', name: 'drop' }); this.kick = true }
    if (this.logDirty) {
      this.logDirty = false
      this.send({ t: 'log', log: this.log ?? [] })
      this.kick = true
    }

    // the sound : an onset (the shared bus's transient) lands a drop, by chance AUDIO
    let audio = 0
    const amt = Math.max(0, Math.min(1, num(I, 'audio', 0)))
    if (amt > 0) {
      const t = audioBus.feature('transient')
      if (t > 0.95 && this.prevT <= 0.95 && this.rand() < amt) audio = Math.max(0.01, audioBus.feature('level'))
      this.prevT = t
    }

    // a tick to the worker when it is ready (the clock that passed meanwhile goes
    // with it), at most ~70 a second : an uncapped renderer drove the water at
    // its own 150-200 Hz, every tick a full step of every point (the picture is
    // drawn every frame, from the last water). On still water (nothing moving or
    // spreading, no beat to keep, no setting changed) 10 a second carry the clock
    // to the auto drops, none when nothing can land by itself : the worker rests.
    this.pendDt += dt
    if (audio > this.pendAudio) this.pendAudio = audio
    const now = performance.now()
    const cur = {
      evolve: Math.max(0, Math.min(1, num(I, 'evolve', 0.3))),
      scale: Math.max(0.2, num(I, 'currents', 1)),
      comb: Math.max(0, Math.min(1, num(I, 'comb', 0.25))),
      combSpacing: Math.max(0.01, num(I, 'spacing', 0.08)),
      combAngle: num(I, 'angle', 0),
      swirl: Math.max(0, Math.min(1, num(I, 'swirl', 0.2)))
    }
    const s = this.settings()
    let gap = 14
    if (this.idle && !this.kick && this.pendAudio === 0 && cur.evolve === 0 && s.sync === 0) {
      const key = JSON.stringify(s) + JSON.stringify(cur)
      if (key === this.sentKey) gap = s.auto > 0 ? 100 : Infinity
    }
    // (the worker answers every tick; 2 s without an answer is a last resort, never
    // a pace : a resend after 300 ms piled ticks onto a worker that was only slow)
    if (this.waiting ? now - this.sentAt > 2000 : now - this.sentAt >= gap) {
      const ret = this.ret
      this.ret = []
      this.send({ t: 'tick', dt: this.pendDt, cur, s, audio: this.pendAudio, ret }, ret)
      this.pendDt = 0
      this.pendAudio = 0
      this.kick = false
      this.waiting = true
      this.sentAt = now
      if (this.idle) this.sentKey = JSON.stringify(s) + JSON.stringify(cur)
    }

    if (!this.pic) this.pic = g.target(this.w, this.h, { float: false })
    if (this.frame) this.upload(this.frame)

    // the colors : redrawn when they change (a modulated palette), not otherwise
    const pal: number[] = []
    for (let i = 1; i <= 6; i++) {
      const c = col(I, `color${i}`, DEFAULT_PAL[i - 1])
      const cv = I[`color${i}`]
      const a = Array.isArray(cv) && cv.length >= 4 && Number.isFinite(cv[3]) ? Math.max(0, Math.min(1, cv[3])) : 1
      pal.push(c[0] * a, c[1] * a, c[2] * a, a)
    }
    const wv = I.water
    const water = Array.isArray(wv) && wv.length >= 3 ? [wv[0], wv[1], wv[2], wv.length >= 4 ? wv[3] : 1] : DEFAULT_WATER
    const wa = Math.max(0, Math.min(1, water[3]))
    const key = pal.join(',') + '|' + water.join(',')
    if (key !== this.drawnKey) { this.drawnKey = key; this.dirty = true }
    if (this.dirty) {
      this.dirty = false
      this.draw(pal, [water[0] * wa, water[1] * wa, water[2] * wa, wa])
    }
    this.show.use().i1('uPic', 0)
    g.bind(0, this.pic.tex)
    g.draw(targetFbo, this.w, this.h)
    g.done(1)
  }

  private grow(target: number, buf: WebGLBuffer, cap: number, bytes: number, data: ArrayBufferView): number {
    const gl = this.g.gl
    gl.bindBuffer(target, buf)
    if (bytes > cap) {
      cap = Math.ceil(bytes * 1.5)
      gl.bufferData(target, cap, gl.DYNAMIC_DRAW)
    }
    if (bytes) gl.bufferSubData(target, 0, data)
    return cap
  }

  private upload(f: Extract<FromWorker, { t: 'frame' }>): void {
    const gl = this.g.gl
    this.frame = null
    gl.bindVertexArray(null)
    this.posCap = this.grow(gl.ARRAY_BUFFER, this.posBuf, this.posCap, f.pos.byteLength, f.pos)
    this.covCap = this.grow(gl.ARRAY_BUFFER, this.covBuf, this.covCap, f.cov.byteLength, f.cov)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
    // the element buffer lives in the fan's vertex array
    gl.bindVertexArray(this.fanVao)
    this.idxCap = this.grow(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf, this.idxCap, f.idx.byteLength, f.idx)
    gl.bindVertexArray(null)
    if (this.groups.length < f.grp.length) this.groups = new Int32Array(f.grp.length * 2)
    this.groups.set(f.grp)
    this.nGroups = f.groups
    this.ret.push(f.pos.buffer as ArrayBuffer, f.idx.buffer as ArrayBuffer, f.cov.buffer as ArrayBuffer, f.grp.buffer as ArrayBuffer)
    this.dirty = true
  }

  private draw(pal: number[], water: number[]): void {
    const g = this.g
    const gl = g.gl
    const ms = sharedMsaa(gl, this.w, this.h)
    gl.bindFramebuffer(gl.FRAMEBUFFER, ms.fbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.colorMask(true, true, true, true)
    gl.depthMask(true)
    gl.stencilMask(0xff)
    gl.clearColor(water[0], water[1], water[2], water[3])
    gl.clearDepth(1)
    gl.clearStencil(0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT)
    const sx = 1 / this.hw, sy = 2
    this.fan.use().f2('uScale', sx, sy)
    this.cov.use().f2('uScale', sx, sy)
    gl.uniform4fv(this.cov.u('uPal'), pal)
    gl.uniform4f(this.cov.u('uWater'), water[0], water[1], water[2], water[3])
    gl.disable(gl.BLEND)
    gl.enable(gl.STENCIL_TEST)
    gl.depthFunc(gl.LESS)
    for (let k = 0; k < this.nGroups; k++) {
      const i0 = this.groups[k * 4], ic = this.groups[k * 4 + 1], c0 = this.groups[k * 4 + 2], cc = this.groups[k * 4 + 3]
      if (ic <= 0 || cc <= 0) continue
      // 1. the outlines' fans flip the stencil : 1 inside each outline
      gl.colorMask(false, false, false, false)
      gl.depthMask(false)
      gl.disable(gl.DEPTH_TEST)
      gl.stencilFunc(gl.ALWAYS, 0, 1)
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT)
      gl.stencilMask(1)
      gl.useProgram(this.fan.p)
      gl.bindVertexArray(this.fanVao)
      gl.drawElements(gl.TRIANGLES, ic, gl.UNSIGNED_INT, i0 * 4)
      // 2. their boxes painted where inside, the youngest drop winning; the
      // stencil back to 0 under them for the next group
      gl.colorMask(true, true, true, true)
      gl.depthMask(true)
      gl.enable(gl.DEPTH_TEST)
      gl.stencilFunc(gl.EQUAL, 1, 1)
      gl.stencilOp(gl.KEEP, gl.ZERO, gl.ZERO)
      gl.useProgram(this.cov.p)
      gl.bindVertexArray(this.covVao)
      gl.drawArrays(gl.TRIANGLES, c0, cc)
    }
    gl.bindVertexArray(null)
    // the GL state as the rest of the engine expects it
    gl.disable(gl.STENCIL_TEST)
    gl.disable(gl.DEPTH_TEST)
    gl.stencilMask(0xff)
    gl.stencilFunc(gl.ALWAYS, 0, 0xff)
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)
    gl.colorMask(true, true, true, true)
    gl.depthMask(true)
    // resolve into this slot's picture
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, ms.fbo)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.pic!.fbo)
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  dispose(): void {
    this.worker.terminate()
    const gl = this.g.gl
    this.g.freeTarget(this.pic)
    this.pic = null
    // buffers deleted inside our own vertex array, never the default one's
    gl.bindVertexArray(this.fanVao)
    gl.deleteBuffer(this.posBuf)
    gl.deleteBuffer(this.covBuf)
    gl.deleteBuffer(this.idxBuf)
    gl.bindVertexArray(null)
    gl.deleteVertexArray(this.fanVao)
    gl.deleteVertexArray(this.covVao)
    this.g.dispose()
    // the shared buffer goes with the last Marbling slot
    users = Math.max(0, users - 1)
    if (!users && msaa) {
      if (msaa.gl === gl && msaa.gen === glGeneration()) {
        gl.deleteFramebuffer(msaa.fbo)
        for (const r of msaa.rb) gl.deleteRenderbuffer(r)
      }
      msaa = null
    }
  }
}
