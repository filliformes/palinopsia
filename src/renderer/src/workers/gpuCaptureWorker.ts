// GPU capture worker : a picture of the canvas → the exact bytes a sender wants,
// with nothing of it on the window's own thread (engine/gpuCapture.ts drives it).
//
// NDI® is a registered trademark of Vizrt NDI AB (https://ndi.video).
//
// Reading a frame back through WebGL ends in getBufferSubData, which copies it on
// the window's thread : 62 ms (p50) for a 4096² domemaster, every frame, so the
// whole instrument fell to 15-20 fps with NDI on (measured). Here the page only
// makes a VideoFrame of the canvas (0.2 ms, the picture stays on the graphics
// card) and transfers it : WebGPU converts it in a compute pass (the same BT.709
// video-range UYVY as the WebGL path, or RGBX), the result is mapped, and the one
// CPU copy of it (33 MB) runs on this thread. It then goes STRAIGHT to the
// sender (the preload, over a private MessagePort, by transfer) and comes back
// here to be refilled : the page never touches it.
//
// Nothing queues : past RING frames on the card, or POOL buffers out, a frame is
// closed and counted as skipped. Every VideoFrame that arrives is closed.

/* eslint-disable @typescript-eslint/no-explicit-any */

const RING = 4 // readbacks in flight (a 4096² frame lands ~50 ms after its kick)
const POOL = 6 // frame buffers alive (NDI holds one, its queue two more)

export type GpuFormat = 'uyvy' | 'rgbx'
export interface GpuKick {
  t: 'frame'
  f: VideoFrame
  w: number // the frame to produce (uyvy : even)
  h: number
  format: GpuFormat
  fpsN: number
  fpsD: number
  tc: number // the frame's own time on the sender's grid, ms since the epoch
  cap: number // when it was taken, ms since the epoch
}

// `direct` : one texel per pixel, read exactly. Otherwise bilinear taps over the
// pixel's whole footprint (`taps` a side, each covering two texels), so a big
// reduction averages the picture instead of skipping through it.
const HEAD = `
struct P { w: u32, h: u32, direct: u32, taps: u32 }
@group(0) @binding(0) var t: texture_external;
@group(0) @binding(1) var<storage, read_write> o: array<u32>;
@group(0) @binding(2) var<uniform> p: P;
@group(0) @binding(3) var s: sampler;
fn px(x: u32, y: u32) -> vec3f {
  if (p.direct == 1u) { return clamp(textureLoad(t, vec2u(x, y)).rgb, vec3f(0.0), vec3f(1.0)); }
  var c = vec3f(0.0);
  let n = f32(p.taps);
  for (var j = 0u; j < p.taps; j++) {
    for (var i = 0u; i < p.taps; i++) {
      let uv = (vec2f(f32(x), f32(y)) + (vec2f(f32(i), f32(j)) + 0.5) / n) / vec2f(f32(p.w), f32(p.h));
      c += textureSampleBaseClampToEdge(t, s, uv).rgb;
    }
  }
  return clamp(c / (n * n), vec3f(0.0), vec3f(1.0));
}
`
const WGSL: Record<GpuFormat, string> = {
  // BT.709, video range (Y 16..235, C 16..240) : U Y0 V Y1 per pixel pair, the
  // same numbers as engine/frameCapture.ts.
  uyvy: HEAD + `
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) g: vec3u) {
  let x = g.x * 2u;
  if (x >= p.w || g.y >= p.h) { return; }
  let a = px(x, g.y);
  let b = px(x + 1u, g.y);
  let ya = 16.0 + 219.0 * dot(a, vec3f(0.2126, 0.7152, 0.0722));
  let yb = 16.0 + 219.0 * dot(b, vec3f(0.2126, 0.7152, 0.0722));
  let m = (a + b) * 0.5;
  let u = 128.0 + 224.0 * dot(m, vec3f(-0.114572, -0.385428, 0.5));
  let v = 128.0 + 224.0 * dot(m, vec3f(0.5, -0.454153, -0.045847));
  o[g.y * (p.w / 2u) + g.x] = pack4x8unorm(vec4f(u, ya, v, yb) / 255.0);
}`,
  rgbx: HEAD + `
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= p.w || g.y >= p.h) { return; }
  o[g.y * p.w + g.x] = pack4x8unorm(vec4f(px(g.x, g.y), 1.0));
}`
}

interface Ring {
  bytes: number
  out: any
  free: any[]
  all: any[]
}

const post = (m: unknown): void => (self as unknown as Worker).postMessage(m)
const now = (): number => performance.timeOrigin + performance.now()

let dev: any = null
let smp: any = null
let uni: any = null
const pipes = new Map<GpuFormat, any>()
const making = new Set<GpuFormat>()
let ring: Ring | null = null
let port: MessagePort | null = null
let pool: ArrayBuffer[] = []
let alive = 0 // frame buffers in existence (pool + out there)
let bufBytes = 0
let lastSeq = 0
let seq = 0

async function start(): Promise<void> {
  try {
    const gpu = (navigator as any).gpu
    if (!gpu) throw new Error('no WebGPU in this window')
    const ad = await gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!ad) throw new Error('no WebGPU graphics card')
    if (ad.info?.isFallbackAdapter || ad.isFallbackAdapter) throw new Error('WebGPU runs on the processor here')
    const d = await ad.requestDevice({
      requiredLimits: { maxBufferSize: ad.limits.maxBufferSize, maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize }
    })
    dev = d
    d.lost.then((i: any) => {
      if (dev !== d) return
      dev = null
      ring = null
      pipes.clear()
      post({ t: 'lost', message: `the graphics device was lost (${i?.message || i?.reason || 'reset'})` })
    })
    d.onuncapturederror = (e: any): void => {
      e.preventDefault?.()
      post({ t: 'failed', message: String(e.error?.message ?? 'WebGPU error').slice(0, 200) })
    }
    smp = d.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    uni = d.createBuffer({ size: 16, usage: 0x40 | 0x8 }) // UNIFORM | COPY_DST
    await makePipe('uyvy')
    if (dev === d) post({ t: 'ready', gpu: ad.info?.description || ad.info?.vendor || '' })
  } catch (e) {
    post({ t: 'failed', message: (e as Error).message })
  }
}

async function makePipe(format: GpuFormat): Promise<void> {
  if (pipes.has(format) || making.has(format) || !dev) return
  making.add(format)
  const d = dev
  try {
    const module = d.createShaderModule({ code: WGSL[format] })
    const pipe = await d.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } })
    if (dev === d) pipes.set(format, pipe)
  } finally {
    making.delete(format)
  }
}

function freeRing(): void {
  if (!ring) return
  for (const b of ring.all) { try { b.destroy() } catch { /* gone with its device */ } }
  try { ring.out.destroy() } catch { /* gone */ }
  ring = null
}

function ensureRing(bytes: number): Ring {
  if (ring && ring.bytes === bytes) return ring
  freeRing()
  const r: Ring = { bytes, out: dev.createBuffer({ size: bytes, usage: 0x80 | 0x4 }), free: [], all: [] } // STORAGE | COPY_SRC
  for (let i = 0; i < RING; i++) {
    const b = dev.createBuffer({ size: bytes, usage: 0x8 | 0x1 }) // COPY_DST | MAP_READ
    r.free.push(b)
    r.all.push(b)
  }
  ring = r
  return r
}

/** A buffer for the next frame, or null when too many are out there. */
function take(bytes: number): ArrayBuffer | null {
  if (bytes !== bufBytes) { bufBytes = bytes; alive = 0; pool = [] }
  const b = pool.pop()
  if (b) return b
  if (alive >= POOL) return null
  alive++
  return new ArrayBuffer(bytes)
}

async function kick(d: GpuKick): Promise<void> {
  const f = d.f
  const skip = (why: string): void => {
    try { f.close() } catch { /* closed */ }
    post({ t: 'done', ok: false, why })
  }
  if (!dev || !port) { skip('starting'); return }
  const pipe = pipes.get(d.format)
  if (!pipe) { void makePipe(d.format).catch((e) => post({ t: 'failed', message: (e as Error).message })); skip('starting'); return }
  const stride = d.format === 'uyvy' ? d.w * 2 : d.w * 4
  const bytes = stride * d.h
  let r: Ring | null = null
  let b: any
  const my = ++seq
  try {
    r = ensureRing(bytes)
    b = r.free.pop()
    if (!b) { skip('gpu'); return } // the card is behind
    const sw = f.displayWidth, sh = f.displayHeight
    const direct = sw === d.w && sh === d.h
    const taps = direct ? 1 : Math.max(1, Math.min(8, Math.ceil(Math.max(sw / d.w, sh / d.h) / 2)))
    dev.queue.writeBuffer(uni, 0, new Uint32Array([d.w, d.h, direct ? 1 : 0, taps]))
    const ext = dev.importExternalTexture({ source: f, colorSpace: 'srgb' })
    const bg = dev.createBindGroup({
      layout: pipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: ext },
        { binding: 1, resource: { buffer: r.out } },
        { binding: 2, resource: { buffer: uni } },
        { binding: 3, resource: smp }
      ]
    })
    const en = dev.createCommandEncoder()
    const pass = en.beginComputePass()
    pass.setPipeline(pipe)
    pass.setBindGroup(0, bg)
    pass.dispatchWorkgroups(Math.ceil((d.format === 'uyvy' ? d.w / 2 : d.w) / 8), Math.ceil(d.h / 8))
    pass.end()
    en.copyBufferToBuffer(r.out, 0, b, 0, bytes)
    dev.queue.submit([en.finish()])
    f.close()
    await b.mapAsync(0x1) // READ
    // (a resize or a lost device meanwhile rejected the map : the catch below)
    let late = my < lastSeq // never out of order
    if (!late && port) {
      const buf = take(bytes)
      if (buf) {
        new Uint8Array(buf).set(new Uint8Array(b.getMappedRange()))
        lastSeq = my
        const fourcc = d.format === 'uyvy' ? 'UYVY' : 'RGBX'
        port.postMessage({ t: 'frame', w: d.w, h: d.h, fourcc, stride, fpsN: d.fpsN, fpsD: d.fpsD, tc: d.tc, cap: d.cap, buf }, [buf])
      } else late = true
    }
    b.unmap()
    post(late ? { t: 'done', ok: false, why: 'sender' } : { t: 'done', ok: true, ms: now() - d.cap })
  } catch (e) {
    try { f.close() } catch { /* closed */ }
    if (!r || ring !== r) post({ t: 'done', ok: false, why: 'starting' }) // its ring went : a size change, or the device
    else {
      post({ t: 'done', ok: false, why: 'error' })
      post({ t: 'failed', message: String((e as Error).message ?? e).slice(0, 200) })
    }
    return
  }
  if (ring === r) r.free.push(b)
}

self.onmessage = (e: MessageEvent): void => {
  const d = e.data as { t: string; port?: MessagePort } & Partial<GpuKick>
  if (d.t === 'frame') { void kick(d as GpuKick); return }
  if (d.t === 'start') { void start(); return }
  if (d.t === 'port' && d.port) {
    try { port?.close() } catch { /* ignore */ }
    port = d.port
    pool = []
    alive = 0 // the old pipe's buffers are not coming back
    const mine = d.port
    port.onmessage = (m: MessageEvent): void => {
      const r = m.data as { t?: string; buf?: ArrayBuffer } | null
      if (port !== mine || r?.t !== 'return' || !r.buf) return
      if (r.buf.byteLength === bufBytes && pool.length < POOL) pool.push(r.buf)
    }
    return
  }
  if (d.t === 'warm' && d.format) void makePipe(d.format)
}
