// NDI sender, living in the main window's PRELOAD (the renderer's own process).
//
// NDI® is a registered trademark of Vizrt NDI AB (https://ndi.video).
//
// Why here : moving a 4K frame between processes costs 30–90 ms in Electron
// (a MessagePort to a utility process, ipcRenderer, even a contextBridge call
// all COPY slowly), but the page can hand a frame to its own preload with
// a transfer in well under a millisecond (measured). So the page reads the
// frame back from the GPU (already UYVY, top-down) and TRANSFERS it here, over
// a private MessageChannel : on window.postMessage every 'message' listener in
// both JS worlds (the page's, ours) would deserialize each frame, and a second
// world's copy of a transferred 33 MB buffer is pure garbage-collector load.
//
// Zero copy from there : koffi hands NDI the ArrayBuffer's own memory as the
// frame pointer, and NDI's ASYNC send returns at once and encodes on NDI's own
// threads. NDI keeps reading that memory until the NEXT async call, so we hold
// the buffer until then, and then transfer it BACK to the page to be refilled
// (a small pool : a 4K stream would otherwise allocate 16 MB per frame).
// Not koffi.alloc + koffi.view : Electron forbids ArrayBuffers over foreign
// memory, and trying one takes the renderer down.
//
// The NDI runtime is called directly through koffi (FFI) : nothing is compiled
// against Electron.

import { ipcRenderer } from 'electron'
import { hostname } from 'os'
import type { NdiConfig, NdiStatus } from '../shared/ndi'

type Koffi = typeof import('koffi')
type Ptr = unknown

interface Lib {
  unload: () => void
  initialize: () => boolean
  destroy: () => void
  version: () => string
  send_create: (s: { p_ndi_name: string; p_groups: string | null; clock_video: boolean; clock_audio: boolean }) => Ptr
  send_destroy: (i: Ptr) => void
  send_async: (i: Ptr, f: Record<string, unknown> | null) => void
  send_conn: (i: Ptr, timeoutMs: number) => number
  send_tally: (i: Ptr, out: Record<string, unknown>, timeoutMs: number) => boolean
  // receive (NDI input)
  find_create: (s: { show_local_sources: boolean; p_groups: string | null; p_extra_ips: string | null }) => Ptr
  find_destroy: (f: Ptr) => void
  find_wait: { async: (f: Ptr, timeoutMs: number, cb: (err: unknown, res: boolean) => void) => void }
  find_sources: (f: Ptr, count: number[]) => Ptr
  recv_create: (s: Record<string, unknown>) => Ptr
  recv_destroy: (r: Ptr) => void
  recv_capture: { async: (r: Ptr, v: Record<string, unknown>, a: null, m: null, timeoutMs: number, cb: (err: unknown, res: number) => void) => void }
  recv_free_video: (r: Ptr, v: Record<string, unknown>) => void
}

interface Frame {
  t: 'frame'
  w: number
  h: number
  fourcc: 'UYVY' | 'RGBX'
  stride: number
  fpsN: number
  fpsD: number
  buf: ArrayBuffer
}

const FOURCC = (s: string): number =>
  (s.charCodeAt(0) | (s.charCodeAt(1) << 8) | (s.charCodeAt(2) << 16) | (s.charCodeAt(3) << 24)) >>> 0
const isBuf = (b: unknown): b is ArrayBuffer => Object.prototype.toString.call(b) === '[object ArrayBuffer]'

let koffi: Koffi | null = null
let lib: Lib | null = null
let sender: Ptr = null
let cfgName = ''
let cfgGroups = ''
let netKey = ''
// The frame NDI may still be reading (until the next async call or a flush).
let held: ArrayBuffer | null = null
let sent = 0
let dropped = 0
let lastW = 0
let lastH = 0
let listener: ((s: NdiStatus) => void) | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
// No runtime yet : look again every few seconds, so installing NDI (from the
// NDI section's button, or by hand) brings the source live with no restart.
let lastCfg: NdiConfig | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null

const status: NdiStatus = {
  state: 'off', message: '', source: '', runtime: '', version: '',
  connections: 0, program: false, preview: false, fps: 0, width: 0, height: 0, dropped: 0
}
const emit = (): void => { try { listener?.({ ...status }) } catch { /* page gone */ } }

// The frame pipe to the page (see the header).
let port: MessagePort | null = null

/** Hand a frame buffer back to the page's pool (transfer : no copy). */
function giveBack(buf: ArrayBuffer): void {
  try { port?.postMessage({ t: 'return', buf }, [buf]) } catch { /* detached : drop it */ }
}

function loadKoffi(): Koffi | null {
  if (koffi) return koffi
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    koffi = require('koffi') as Koffi
    koffi.struct('NDIlib_send_create_t', { p_ndi_name: 'const char *', p_groups: 'const char *', clock_video: 'bool', clock_audio: 'bool' })
    koffi.struct('NDIlib_video_frame_v2_t', {
      xres: 'int', yres: 'int', FourCC: 'uint32_t', frame_rate_N: 'int', frame_rate_D: 'int',
      picture_aspect_ratio: 'float', frame_format_type: 'int', timecode: 'int64_t',
      p_data: 'uint8_t *', line_stride_in_bytes: 'int', p_metadata: 'const char *', timestamp: 'int64_t'
    })
    koffi.struct('NDIlib_tally_t', { on_program: 'bool', on_preview: 'bool' })
    koffi.struct('NDIlib_find_create_t', { show_local_sources: 'bool', p_groups: 'const char *', p_extra_ips: 'const char *' })
    koffi.struct('NDIlib_source_t', { p_ndi_name: 'const char *', p_url_address: 'const char *' })
    koffi.struct('NDIlib_recv_create_v3_t', {
      source_to_connect_to: 'NDIlib_source_t', color_format: 'int', bandwidth: 'int',
      allow_video_fields: 'bool', p_ndi_recv_name: 'const char *'
    })
    return koffi
  } catch (e) {
    status.state = 'error'
    status.message = `the FFI module did not load (${(e as Error).message})`
    return null
  }
}

function bind(k: Koffi, path: string): Lib {
  const l = k.load(path)
  return {
    unload: () => l.unload(),
    initialize: l.func('bool NDIlib_initialize()'),
    destroy: l.func('void NDIlib_destroy()'),
    version: l.func('const char *NDIlib_version()'),
    send_create: l.func('void *NDIlib_send_create(const NDIlib_send_create_t *p_create_settings)'),
    send_destroy: l.func('void NDIlib_send_destroy(void *p_instance)'),
    send_async: l.func('void NDIlib_send_send_video_async_v2(void *p_instance, const NDIlib_video_frame_v2_t *p_video_data)'),
    send_conn: l.func('int NDIlib_send_get_no_connections(void *p_instance, uint32_t timeout_in_ms)'),
    send_tally: l.func('bool NDIlib_send_get_tally(void *p_instance, _Out_ NDIlib_tally_t *p_tally, uint32_t timeout_in_ms)'),
    find_create: l.func('void *NDIlib_find_create_v2(const NDIlib_find_create_t *p_create_settings)'),
    find_destroy: l.func('void NDIlib_find_destroy(void *p_instance)'),
    find_wait: l.func('bool NDIlib_find_wait_for_sources(void *p_instance, uint32_t timeout_in_ms)'),
    find_sources: l.func('void *NDIlib_find_get_current_sources(void *p_instance, _Out_ uint32_t *p_no_sources)'),
    recv_create: l.func('void *NDIlib_recv_create_v3(const NDIlib_recv_create_v3_t *p_create_settings)'),
    recv_destroy: l.func('void NDIlib_recv_destroy(void *p_instance)'),
    recv_capture: l.func('int NDIlib_recv_capture_v2(void *p_instance, _Out_ NDIlib_video_frame_v2_t *p_video_data, void *p_audio_data, void *p_metadata, uint32_t timeout_in_ms)'),
    recv_free_video: l.func('void NDIlib_recv_free_video_v2(void *p_instance, const NDIlib_video_frame_v2_t *p_video_data)')
  } as unknown as Lib
}

/** Make NDI let go of the frame it holds (a NULL async send is the SDK's flush),
 *  then return that buffer to the page. */
function flush(): void {
  if (lib && sender) { try { lib.send_async(sender, null) } catch { /* ignore */ } }
  if (held) { giveBack(held); held = null }
}

function destroySender(): void {
  flush()
  if (lib && sender) { try { lib.send_destroy(sender) } catch { /* ignore */ } }
  sender = null
}

function createSender(): boolean {
  if (!lib) return false
  destroySender()
  try {
    sender = lib.send_create({ p_ndi_name: cfgName, p_groups: cfgGroups || null, clock_video: false, clock_audio: false })
  } catch (e) {
    sender = null
    status.message = (e as Error).message
  }
  if (!sender) {
    status.state = 'error'
    status.message = status.message || 'NDI refused to create the sender (name or groups invalid?)'
    return false
  }
  status.state = 'live'
  status.message = ''
  status.source = `${hostname().toUpperCase()} (${cfgName})`
  return true
}

/** (Re)initialize the NDI library with the right network config. */
function initLib(candidates: Array<{ path: string; origin: string }>, configDir: string | null): boolean {
  const k = loadKoffi()
  if (!k) return false
  // NDI reads its network config (Discovery Server, adapters) through
  // NDI_CONFIG_DIR : point THIS process at Palinopsia's private file, or at the
  // machine's own. The library reads that variable only when it is LOADED (its
  // C runtime keeps its own copy of the environment), so a network change must
  // unload it and load it afresh : destroy + initialize alone silently kept the
  // old settings while reporting live (measured).
  if (configDir) process.env.NDI_CONFIG_DIR = configDir
  else delete process.env.NDI_CONFIG_DIR
  if (lib) {
    beforeUnload()
    const prev = lib
    lib = null
    try { prev.destroy() } catch { /* ignore */ }
    try { prev.unload() } catch { /* ignore */ }
  }
  const tried: string[] = []
  for (const c of candidates) {
    try {
      const l = bind(k, c.path)
      if (!l.initialize()) { tried.push(`${c.origin} : initialize failed`); continue }
      lib = l
      afterInit()
      status.runtime = `${c.origin} · ${c.path}`
      try {
        const v = String(l.version() ?? '')
        status.version = (v.match(/(\d+\.\d+\.\d+(?:\.\d+)?)\s*$/) ?? [])[1] ?? v
      } catch { status.version = '' }
      return true
    } catch (e) {
      tried.push(`${c.origin} : ${(e as Error).message}`)
    }
  }
  status.state = 'no-runtime'
  status.message = candidates.length ? `no usable NDI runtime (${tried.join(' · ')})` : 'no NDI runtime found on this machine'
  return false
}

function poll(): void {
  if (lib && sender) {
    try { status.connections = lib.send_conn(sender, 0) } catch { /* ignore */ }
    try {
      const t: Record<string, unknown> = {}
      lib.send_tally(sender, t, 0)
      status.program = !!t.on_program
      status.preview = !!t.on_preview
    } catch { /* ignore */ }
  }
  status.fps = sent
  status.dropped = dropped
  status.width = lastW
  status.height = lastH
  sent = 0
  dropped = 0
  emit()
}

function onFrame(f: Frame): void {
  const bytes = f.stride * f.h
  // A detached / short buffer can't be sent (and there is nothing to give back).
  if (!isBuf(f.buf) || f.buf.byteLength < bytes) { dropped++; return }
  if (!lib || !sender) { giveBack(f.buf); return }
  try {
    lib.send_async(sender, {
      xres: f.w, yres: f.h, FourCC: FOURCC(f.fourcc), frame_rate_N: f.fpsN, frame_rate_D: f.fpsD,
      picture_aspect_ratio: f.w / f.h, frame_format_type: 1 /* progressive */,
      timecode: 9223372036854775807n /* synthesize */, p_data: f.buf,
      line_stride_in_bytes: f.stride, p_metadata: null, timestamp: 0n
    })
  } catch (e) {
    dropped++
    status.message = `send failed : ${(e as Error).message}`
    giveBack(f.buf)
    return
  }
  // The async contract : NDI has let go of the PREVIOUS frame now.
  if (held) giveBack(held)
  held = f.buf
  sent++
  lastW = f.w
  lastH = f.h
}

/** A fresh pipe for the page (it asks on mount; a remount asks again). */
function openPort(): void {
  try { port?.close() } catch { /* ignore */ }
  const mc = new MessageChannel()
  port = mc.port1
  port.onmessage = (ev): void => {
    const d = ev.data as Frame | null
    if (d && d.t === 'frame') onFrame(d)
  }
  window.postMessage('opsia:ndiport', '*', [mc.port2])
}
window.addEventListener('message', (ev) => {
  if (ev.data === 'opsia:want-ndiport') openPort()
})
// A reload / close must take the source OFF the network (else a stale
// "Palinopsia" lingers, and the next page would publish "Palinopsia (2)").
window.addEventListener('beforeunload', () => {
  destroySender()
  beforeUnload()
  try { lib?.destroy() } catch { /* ignore */ }
})

let busy: Promise<NdiStatus> = Promise.resolve({ ...status })

/** Apply a config : on/off, name, groups, network. Serialized. `quiet` : a
 *  background retry, which must not flash "starting" every few seconds. */
export function ndiConfigure(cfg: NdiConfig, quiet = false): Promise<NdiStatus> {
  lastCfg = cfg
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  busy = busy.then(async () => {
    try {
      if (!cfg.enabled) {
        destroySender()
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
        Object.assign(status, { state: 'off', message: '', connections: 0, program: false, preview: false, fps: 0, dropped: 0 })
        emit()
        return { ...status }
      }
      const nk = `${cfg.discovery}|${cfg.adapter}|${cfg.extraIps}`
      const needInit = !lib || nk !== netKey
      const needSender = needInit || !sender || cfg.name !== cfgName || cfg.groups !== cfgGroups
      // A config that changes nothing NDI cares about (the rate, the size, a
      // repeated call) must not touch a live sender : receivers would blink.
      if (needSender) {
        if (!quiet) {
          status.state = 'starting'
          emit()
        }
        if (needInit) {
          destroySender()
          const prep = (await ipcRenderer.invoke('ndi:prepare', cfg)) as {
            candidates: Array<{ path: string; origin: string }>
            configDir: string | null
          }
          if (!initLib(prep.candidates, prep.configDir)) {
            if (status.state === 'no-runtime') {
              retryTimer = setTimeout(() => { if (lastCfg?.enabled) void ndiConfigure(lastCfg, true) }, 3000)
            }
            emit()
            return { ...status }
          }
          netKey = nk
        }
        cfgName = cfg.name
        cfgGroups = cfg.groups
        createSender()
      }
      if (!pollTimer) pollTimer = setInterval(poll, 1000)
    } catch (e) {
      status.state = 'error'
      status.message = (e as Error).message
    }
    emit()
    return { ...status }
  })
  return busy
}

export function ndiOnStatus(cb: (s: NdiStatus) => void): () => void {
  listener = cb
  cb({ ...status })
  return () => { if (listener === cb) listener = null }
}

// ── NDI INPUT : another NDI source on the network as a layer source ─────────
// Receivers live here too, on the same library instance as the sender (one
// NDI_CONFIG_DIR, one network setup). One receiver per SOURCE, shared by every
// layer that shows it. Frames arrive as RGBX/RGBA (the SDK converts), are copied
// into a pooled ArrayBuffer (memcpy : no allocation per frame) and TRANSFERRED
// to the page over a private MessageChannel; the page transfers each buffer back
// when a newer frame replaces it. Captures run on koffi's worker threads
// (.async), so a waiting receiver never blocks this thread.

interface InRecv {
  name: string
  recv: Ptr
  refs: number
  alive: boolean
  inFlight: boolean
  pool: ArrayBuffer[]
  out: number // buffers the page holds
}
const recvs = new Map<string, InRecv>()
let finder: Ptr = null
let inPort: MessagePort | null = null
let memcpy: ((dst: ArrayBuffer, src: unknown, n: number) => unknown) | null | false = null
let libReady: Promise<boolean> | null = null

const RGBX_RGBA = 2 // NDIlib_recv_color_format_RGBX_RGBA
const BANDWIDTH_HIGHEST = 100
const FRAME_VIDEO = 1

function getMemcpy(k: Koffi): typeof memcpy {
  if (memcpy !== null) return memcpy
  const libs = process.platform === 'win32' ? ['msvcrt.dll'] : process.platform === 'darwin' ? ['/usr/lib/libSystem.B.dylib'] : ['libc.so.6']
  for (const name of libs) {
    try {
      memcpy = k.load(name).func('void *memcpy(void *dst, const void *src, size_t n)') as unknown as typeof memcpy
      return memcpy
    } catch { /* try the next */ }
  }
  memcpy = false
  return memcpy
}

/** The library for receiving : the sender's if it is up, else load it with the
 *  saved (or default) network setup. */
function ensureLib(): Promise<boolean> {
  if (lib) return Promise.resolve(true)
  if (libReady) return libReady
  libReady = (async () => {
    try {
      const prep = (await ipcRenderer.invoke('ndi:prepare', lastCfg ?? {})) as {
        candidates: Array<{ path: string; origin: string }>
        configDir: string | null
      }
      const ok = initLib(prep.candidates, prep.configDir)
      if (ok && lastCfg) netKey = `${lastCfg.discovery}|${lastCfg.adapter}|${lastCfg.extraIps}`
      return ok
    } catch {
      return false
    } finally {
      libReady = null
    }
  })()
  return libReady
}

/** The library is about to go (a network change, a reload) : stop receiving. */
function beforeUnload(): void {
  for (const r of recvs.values()) {
    if (r.recv && lib && !r.inFlight) { try { lib.recv_destroy(r.recv) } catch { /* ignore */ } }
    r.recv = null
  }
  if (finder && lib) { try { lib.find_destroy(finder) } catch { /* ignore */ } }
  finder = null
}

/** A fresh library : reopen every receiver a layer still wants. */
function afterInit(): void {
  for (const r of recvs.values()) if (r.alive && !r.recv) openRecv(r)
}

function openRecv(r: InRecv): void {
  if (!lib) return
  try {
    r.recv = lib.recv_create({
      source_to_connect_to: { p_ndi_name: r.name, p_url_address: null },
      color_format: RGBX_RGBA, bandwidth: BANDWIDTH_HIGHEST, allow_video_fields: false,
      p_ndi_recv_name: 'Palinopsia'
    })
  } catch {
    r.recv = null
  }
  if (r.recv) pump(r)
}

function pump(r: InRecv): void {
  if (!lib || !r.alive || !r.recv || r.inFlight) return
  const l = lib
  const recv = r.recv
  const frame: Record<string, unknown> = {}
  r.inFlight = true
  l.recv_capture.async(recv, frame, null, null, 250, (err, type) => {
    r.inFlight = false
    if (!r.alive || lib !== l || r.recv !== recv) {
      // Closed (or the library was swapped) while it waited.
      if (type === FRAME_VIDEO) { try { l.recv_free_video(recv, frame) } catch { /* ignore */ } }
      if (!r.alive && r.recv === recv) { try { l.recv_destroy(recv) } catch { /* ignore */ } r.recv = null }
      return
    }
    if (!err && type === FRAME_VIDEO) deliver(r, l, recv, frame)
    pump(r)
  })
}

function deliver(r: InRecv, l: Lib, recv: Ptr, f: Record<string, unknown>): void {
  const w = Number(f.xres), h = Number(f.yres), stride = Number(f.line_stride_in_bytes)
  const bytes = stride * h
  try {
    // The page still holds three frames it hasn't returned : it is behind, so
    // skip this one rather than pile up memory.
    if (!inPort || r.out >= 3 || !(w > 0 && h > 0 && bytes > 0)) return
    const k = koffi!
    let buf = r.pool.pop()
    if (!buf || buf.byteLength !== bytes) buf = new ArrayBuffer(bytes)
    const mc = getMemcpy(k)
    if (mc) mc(buf, f.p_data, bytes)
    else new Uint8Array(buf).set(k.decode(f.p_data, k.array('uint8_t', bytes, 'Typed')) as Uint8Array)
    r.out++
    inPort.postMessage({ t: 'in', name: r.name, w, h, stride, buf }, [buf])
  } catch {
    /* drop this frame */
  } finally {
    try { l.recv_free_video(recv, f) } catch { /* ignore */ }
  }
}

function openInPort(): void {
  try { inPort?.close() } catch { /* ignore */ }
  const mc = new MessageChannel()
  inPort = mc.port1
  inPort.onmessage = (ev): void => {
    const d = ev.data as { t: string; name: string; buf: ArrayBuffer } | null
    if (d && d.t === 'in-return') {
      const r = recvs.get(d.name)
      if (r) {
        r.out = Math.max(0, r.out - 1)
        if (isBuf(d.buf) && r.pool.length < 3) r.pool.push(d.buf)
      }
    }
  }
  window.postMessage('opsia:ndiinport', '*', [mc.port2])
}
window.addEventListener('message', (ev) => {
  if (ev.data === 'opsia:want-ndiinport') openInPort()
})

/** NDI sources on the network (and this machine), by name. Waits up to `waitMs`
 *  for the first answers. No runtime : ok false, with the reason. */
export async function ndiInFind(waitMs = 1500): Promise<{ ok: boolean; sources: string[]; message: string }> {
  if (!(await ensureLib()) || !lib) return { ok: false, sources: [], message: status.message || 'no NDI runtime on this computer' }
  const l = lib
  try {
    if (!finder) finder = l.find_create({ show_local_sources: true, p_groups: null, p_extra_ips: null })
    if (!finder) return { ok: false, sources: [], message: 'NDI refused to look for sources' }
    const f = finder
    await new Promise<void>((res) => l.find_wait.async(f, waitMs, () => res()))
    const n = [0]
    const ptr = l.find_sources(f, n)
    const count = n[0] | 0
    if (!ptr || count <= 0) return { ok: true, sources: [], message: '' }
    const list = koffi!.decode(ptr, koffi!.array('NDIlib_source_t', count)) as Array<{ p_ndi_name: string | null }>
    const names = [...new Set(list.map((x) => x.p_ndi_name ?? '').filter(Boolean))].sort((a, b) => a.localeCompare(b))
    return { ok: true, sources: names, message: '' }
  } catch (e) {
    return { ok: false, sources: [], message: (e as Error).message }
  }
}

/** Start (or share) the receiver for one source. Frames then flow to the page. */
export async function ndiInOpen(name: string): Promise<boolean> {
  let r = recvs.get(name)
  if (r) { r.refs++; return true }
  r = { name, recv: null, refs: 1, alive: true, inFlight: false, pool: [], out: 0 }
  recvs.set(name, r)
  if (!(await ensureLib())) return false
  if (r.alive && !r.recv) openRecv(r)
  return !!r.recv
}

/** A layer let go of a source : the receiver stops when nobody shows it. */
export function ndiInClose(name: string): void {
  const r = recvs.get(name)
  if (!r) return
  r.refs--
  if (r.refs > 0) return
  r.alive = false
  recvs.delete(name)
  if (!r.inFlight && r.recv && lib) { try { lib.recv_destroy(r.recv) } catch { /* ignore */ } r.recv = null }
}
