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
// Frames come from two places, each with its own pipe : the GPU capture worker
// (engine/gpuCapture.ts, the fast path : the page never sees the frame) and the
// page itself (engine/frameCapture.ts, the WebGL path).
//
// Zero copy from there : koffi hands NDI the ArrayBuffer's own memory as the
// frame pointer, and NDI's ASYNC send encodes on NDI's own threads. NDI keeps
// reading that memory until the NEXT async call, so we hold the buffer until that
// one has RETURNED, and then transfer it BACK where it came from to be refilled
// (a small pool : a 4K stream would otherwise allocate 16 MB per frame).
// Not koffi.alloc + koffi.view : Electron forbids ArrayBuffers over foreign
// memory, and trying one takes the renderer down.
//
// "Async" is NDI's word : the call itself still waits for the frame before it to
// be out of its way, up to 12 ms (p95) and 27 ms (max) at 4096² (measured). So it
// is made on koffi's worker thread, one at a time (`sending`), and a new frame
// that finds it busy waits in a queue of QUEUE_MAX (the oldest dropped, counted).
// Nothing touches the sender while a call is in it : the status poll waits its
// turn, and a sender is flushed and destroyed only once the call is back.
//
// A receiver must never think the source died : with nothing new for half a
// second (a held frame, a stalled capture) the last frame is sent again.
//
// The NDI runtime is called directly through koffi (FFI) : nothing is compiled
// against Electron.

import { ipcRenderer } from 'electron'
import { hostname } from 'os'
import { idleNdiStatus, type NdiConfig, type NdiStatus } from '../shared/ndi'

type Koffi = typeof import('koffi')
type Ptr = unknown

interface Lib {
  unload: () => void
  initialize: () => boolean
  destroy: () => void
  version: () => string
  send_create: (s: { p_ndi_name: string; p_groups: string | null; clock_video: boolean; clock_audio: boolean }) => Ptr
  send_destroy: ((i: Ptr) => void) & { async: (i: Ptr, cb: (err: unknown) => void) => void }
  send_async: ((i: Ptr, f: Record<string, unknown> | null) => void) & {
    async: (i: Ptr, f: Record<string, unknown> | null, cb: (err: unknown) => void) => void
  }
  send_conn: (i: Ptr, timeoutMs: number) => number
  send_tally: (i: Ptr, out: Record<string, unknown>, timeoutMs: number) => boolean
  // receive (NDI input)
  find_create: (s: { show_local_sources: boolean; p_groups: string | null; p_extra_ips: string | null }) => Ptr
  find_destroy: (f: Ptr) => void
  find_wait: { async: (f: Ptr, timeoutMs: number, cb: (err: unknown, res: boolean) => void) => void }
  find_sources: (f: Ptr, count: number[]) => Ptr
  recv_create: (s: Record<string, unknown>) => Ptr
  recv_destroy: (r: Ptr) => void
  fs_create: (r: Ptr) => Ptr
  fs_destroy: (f: Ptr) => void
  fs_capture: (f: Ptr, v: Record<string, unknown>, fieldType: number) => void
  fs_free: (f: Ptr, v: Record<string, unknown>) => void
  // NDI audio in (an Audio Layer slot) : null in a runtime without them (an old
  // copy another app ships), which must not keep the rest from loading
  fs_audio: ((f: Ptr, a: Record<string, unknown>, sampleRate: number, channels: number, samples: number) => void) | null
  fs_free_audio: ((f: Ptr, a: Record<string, unknown>) => void) | null
  fs_depth: ((f: Ptr) => number) | null
  recv_conn: (r: Ptr) => number
}

interface Frame {
  t: 'frame'
  w: number
  h: number
  fourcc: 'UYVY' | 'RGBX'
  stride: number
  fpsN: number
  fpsD: number
  tc?: number // its time on the sender's grid, ms since the epoch
  buf: ArrayBuffer
  from: MessagePort | null // the pipe it came on : its buffer goes back there
}
/** A send in NDI's hands, on koffi's thread. */
interface Send {
  f: Frame
  resend: boolean
  since: number
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
let held: Frame | null = null
let sending: Send | null = null
let idleWaits: Array<() => void> = [] // who waits for `sending` to be back
let closing = false // the sender is being taken down : nothing new goes to it
let stuck = false // a call that never came back is still in the library : never unload it
let recreatedAt = 0
let queue: Frame[] = []
const QUEUE_MAX = 2
const KEEP_ALIVE_MS = 500
let lastSend = 0 // when the last send came back
let sendErrors = 0 // in a row
let pollDue = false
let aliveTimer: ReturnType<typeof setInterval> | null = null
let polledAt = 0
let sent = 0
let resent = 0
let dropped = 0
let sendMax = 0 // the longest NDI call of the second, ms
let lastW = 0
let lastH = 0
let listener: ((s: NdiStatus) => void) | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
// No runtime yet : look again every few seconds, so installing NDI (from the
// NDI section's button, or by hand) brings the source live with no restart.
let lastCfg: NdiConfig | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null

const status: NdiStatus = idleNdiStatus()
const emit = (): void => { try { listener?.({ ...status }) } catch { /* page gone */ } }

// The frame pipes (see the header) : the page's, and the GPU capture worker's.
const ports: Record<string, MessagePort | null> = { page: null, gpu: null }

/** Hand a frame buffer back to the pool it came from (transfer : no copy). */
function giveBack(f: Frame): void {
  try { f.from?.postMessage({ t: 'return', buf: f.buf }, [f.buf]) } catch { /* detached, or a pipe that closed : drop it */ }
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
    // planar float, one channel after the other (channel_stride_in_bytes apart)
    koffi.struct('NDIlib_audio_frame_v2_t', {
      sample_rate: 'int', no_channels: 'int', no_samples: 'int', timecode: 'int64_t',
      p_data: 'float *', channel_stride_in_bytes: 'int', p_metadata: 'const char *', timestamp: 'int64_t'
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
  const opt = (def: string): unknown => { try { return l.func(def) } catch { return null } }
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
    fs_create: l.func('void *NDIlib_framesync_create(void *p_receiver)'),
    fs_destroy: l.func('void NDIlib_framesync_destroy(void *p_instance)'),
    fs_capture: l.func('void NDIlib_framesync_capture_video(void *p_instance, _Out_ NDIlib_video_frame_v2_t *p_video_data, int field_type)'),
    fs_free: l.func('void NDIlib_framesync_free_video(void *p_instance, NDIlib_video_frame_v2_t *p_video_data)'),
    fs_audio: opt('void NDIlib_framesync_capture_audio(void *p_instance, _Out_ NDIlib_audio_frame_v2_t *p_audio_data, int sample_rate, int no_channels, int no_samples)'),
    fs_free_audio: opt('void NDIlib_framesync_free_audio(void *p_instance, NDIlib_audio_frame_v2_t *p_audio_data)'),
    fs_depth: opt('int NDIlib_framesync_audio_queue_depth(void *p_instance)'),
    recv_conn: l.func('int NDIlib_recv_get_no_connections(void *p_instance)')
  } as unknown as Lib
}

/** No send in NDI's hands (or `ms` over : false). */
function sendIdle(ms: number): Promise<boolean> {
  if (!sending) return Promise.resolve(true)
  return new Promise((res) => {
    const t = setTimeout(() => { idleWaits = idleWaits.filter((f) => f !== done); res(false) }, ms)
    const done = (): void => { clearTimeout(t); res(true) }
    idleWaits.push(done)
  })
}
const offThread = (call: (cb: (err: unknown) => void) => void): Promise<void> =>
  new Promise((res) => { try { call(() => res()) } catch { res() } })

/** Frames waiting for the sender go back unsent. */
function dropQueue(): void {
  for (const f of queue) giveBack(f)
  queue = []
}

/** Take the sender down : once the call in it is back, make NDI let go of the
 *  frame it holds (a NULL async send is the SDK's flush), destroy it, and return
 *  that buffer. All off the window's thread. */
async function destroySender(): Promise<void> {
  closing = true
  dropQueue()
  const l = lib, s = sender
  if (l && s) {
    if (await sendIdle(4000)) {
      await offThread((cb) => l.send_async.async(s, null, cb))
      await offThread((cb) => l.send_destroy.async(s, cb))
      if (held) giveBack(held)
    } else {
      // Stuck inside NDI : destroying it under the call would take the app down.
      // It is left to the process; so is the frame it reads.
      console.warn('[ndi] a send never came back : its sender was abandoned')
      stuck = true
      sending = null
    }
  }
  held = null
  sender = null
  closing = false
}

function createSender(): boolean {
  if (!lib) return false
  sendErrors = 0
  lastSend = performance.now()
  try {
    sender = lib.send_create({ p_ndi_name: cfgName, p_groups: cfgGroups || null, clock_video: false, clock_audio: false })
  } catch (e) {
    sender = null
    status.message = (e as Error).message
  }
  if (!sender) {
    status.state = 'error'
    status.message = status.message || 'NDI refused to create the sender (name or groups invalid?)'
    retryLater()
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
    if (!stuck) {
      try { prev.destroy() } catch { /* ignore */ }
      try { prev.unload() } catch { /* ignore */ }
    }
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

/** Not live, though it should be : try the whole thing again in a moment. */
function retryLater(): void {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = setTimeout(() => { if (lastCfg?.enabled) void ndiConfigure(lastCfg, true) }, 3000)
}

/** A live sender made again, same name and groups (it kept failing, or the
 *  network moved under it with nobody connected). */
function recreate(why: string): void {
  recreatedAt = performance.now()
  busy = busy.then(async () => {
    if (!lib || !sender || !lastCfg?.enabled) return { ...status }
    console.warn('[ndi] the sender starts again :', why)
    await destroySender()
    createSender()
    emit()
    return { ...status }
  })
}

function poll(): void {
  // While a send is in NDI's hands the questions wait for it to be back (they
  // would queue behind it inside NDI, on this thread).
  if (sending && performance.now() - sending.since < 3000) pollDue = true
  else ask()
  const now = performance.now()
  const dt = polledAt ? Math.max(0.2, (now - polledAt) / 1000) : 1
  polledAt = now
  status.fps = Math.round((sent / dt) * 10) / 10
  status.dropped = dropped
  status.resent = resent
  if (sending) sendMax = Math.max(sendMax, now - sending.since)
  status.sendMs = Math.round(sendMax * 10) / 10
  sendMax = 0
  status.width = lastW
  status.height = lastH
  sent = 0
  dropped = 0
  resent = 0
  if (netCheckUntil) netCheck(now)
  emit()
}

/** Connections and tally. Never while a send is in NDI's hands. */
function ask(): void {
  pollDue = false
  if (lib && sender && !closing && !sending) {
    try { status.connections = lib.send_conn(sender, 0) } catch { /* ignore */ }
    try {
      const t: Record<string, unknown> = {}
      lib.send_tally(sender, t, 0)
      status.program = !!t.on_program
      status.preview = !!t.on_preview
    } catch { /* ignore */ }
  }
}

function onFrame(f: Frame): void {
  const bytes = f.stride * f.h
  // A detached / short buffer can't be sent (and there is nothing to give back).
  if (!isBuf(f.buf) || f.buf.byteLength < bytes) { dropped++; return }
  if (!lib || !sender || closing) { giveBack(f); return }
  queue.push(f)
  // NDI is behind : the oldest waiting frame goes, the stream stays current.
  while (queue.length > QUEUE_MAX) { giveBack(queue.shift()!); dropped++ }
  pump()
}

/** The next waiting frame into NDI, when no call is in it. */
function pump(): void {
  if (sending || closing || !lib || !sender) return
  const f = queue.shift()
  if (f) startSend(f, false)
}

function startSend(f: Frame, resend: boolean): void {
  const l = lib!
  const job: Send = { f, resend, since: performance.now() }
  const wall = !resend && f.tc ? f.tc : performance.timeOrigin + performance.now()
  sending = job
  try {
    l.send_async.async(sender, {
      xres: f.w, yres: f.h, FourCC: FOURCC(f.fourcc), frame_rate_N: f.fpsN, frame_rate_D: f.fpsD,
      picture_aspect_ratio: f.w / f.h, frame_format_type: 1 /* progressive */,
      // Its place on the frame grid (100 ns units, the Unix epoch) : frames reach
      // NDI a few ms early or late, their own times are even.
      timecode: BigInt(Math.round(wall * 1000)) * 10n, p_data: f.buf,
      line_stride_in_bytes: f.stride, p_metadata: null, timestamp: 0n
    }, (err) => {
      if (sending !== job) return // abandoned meanwhile (see destroySender)
      sendDone(job, err)
    })
  } catch (e) {
    sendDone(job, e)
  }
}

function sendDone(job: Send, err: unknown): void {
  const now = performance.now()
  sending = null
  sendMax = Math.max(sendMax, now - job.since)
  lastSend = now
  if (err) {
    status.message = `send failed : ${(err as Error).message ?? err}`
    if (!job.resend) { dropped++; giveBack(job.f) }
    if (++sendErrors >= 5 && now - recreatedAt > 5000) recreate(status.message)
  } else {
    if (sendErrors) { sendErrors = 0; status.message = '' }
    // The async contract : NDI has let go of the PREVIOUS frame now.
    if (held && held !== job.f) giveBack(held)
    held = job.f
    if (job.resend) resent++
    else sent++
    lastW = job.f.w
    lastH = job.f.h
  }
  const waits = idleWaits
  idleWaits = []
  for (const w of waits) w()
  if (pollDue) ask()
  if (!closing) pump()
}

/** Ten times a second : the last frame again when nothing new came. */
function keepAlive(): void {
  if (!lib || !sender || closing || sending || queue.length || !held) return
  if (performance.now() - lastSend >= KEEP_ALIVE_MS) startSend(held, true)
}

// The network moved under a live sender (another address, a cable, the machine
// woke up : main/ndi/watch.ts says so). NDI follows most of it by itself, and a
// receiver still connected must not blink : only a sender nobody is connected to,
// in the half minute that follows, is made again, which announces it anew.
let netCheckUntil = 0
let netCheckFrom = 0
ipcRenderer.on('ndi:network', () => {
  netCheckFrom = performance.now() + 3000
  netCheckUntil = netCheckFrom + 27000
})
function netCheck(now: number): void {
  if (now < netCheckFrom) return
  if (now > netCheckUntil) { netCheckUntil = 0; return }
  if (status.connections > 0 || !sender) return
  netCheckUntil = 0
  recreate('the network changed')
}

/** A fresh pipe (the page asks on mount, the GPU capture with each worker). */
function openPort(kind: string): void {
  try { ports[kind]?.close() } catch { /* ignore */ }
  const mc = new MessageChannel()
  const p = mc.port1
  ports[kind] = p
  p.onmessage = (ev): void => {
    const d = ev.data as Frame | null
    if (d && d.t === 'frame') onFrame({ ...d, from: p })
  }
  window.postMessage({ t: 'opsia:ndiport', kind }, '*', [mc.port2])
}
window.addEventListener('message', (ev) => {
  const d = ev.data as { t?: string; kind?: string } | null
  if (d?.t === 'opsia:want-ndiport' && (d.kind === 'page' || d.kind === 'gpu')) openPort(d.kind)
})
// A reload / close must take the source OFF the network (else a stale
// "Palinopsia" lingers, and the next page would publish "Palinopsia (2)"). No
// waiting for a callback here : a send still in NDI's hands is waited out by the
// clock (27 ms was the longest measured at 4096²; a first reload can be slower).
window.addEventListener('beforeunload', () => {
  closing = true
  queue = []
  if (sending) {
    const until = sending.since + 250
    while (performance.now() < until) { /* the send is on another thread */ }
  }
  if (lib && sender) {
    try { lib.send_async(sender, null) } catch { /* ignore */ }
    try { lib.send_destroy(sender) } catch { /* ignore */ }
  }
  sender = null
  held = null
  beforeUnload()
  if (!stuck) { try { lib?.destroy() } catch { /* ignore */ } }
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
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
        if (aliveTimer) { clearInterval(aliveTimer); aliveTimer = null }
        await destroySender()
        Object.assign(status, { state: 'off', message: '', connections: 0, program: false, preview: false, fps: 0, dropped: 0, resent: 0, sendMs: 0, width: 0, height: 0 })
        polledAt = 0
        sent = dropped = resent = lastW = lastH = 0
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
        await destroySender()
        if (needInit) {
          const prep = (await ipcRenderer.invoke('ndi:prepare', cfg)) as {
            candidates: Array<{ path: string; origin: string }>
            configDir: string | null
          }
          if (!initLib(prep.candidates, prep.configDir)) {
            if (status.state === 'no-runtime') retryLater()
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
      if (!aliveTimer) aliveTimer = setInterval(keepAlive, 100)
    } catch (e) {
      status.state = 'error'
      status.message = (e as Error).message
      if (cfg.enabled) retryLater()
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
// layer that shows it.
//
// Each receiver goes through NDI's FRAME SYNC, which always hands over the
// NEWEST frame : a light timer asks for it and copies it only when a new one has
// arrived. (A first version pulled frames one by one from NDI's queue on
// main-thread callbacks; whenever rendering ran slower than the source, NDI
// queued the rest and the picture drifted seconds behind.) Frames arrive as
// RGBX/RGBA, top row first, and are copied once (memcpy, no allocation : pooled
// buffers) and TRANSFERRED to the page over a private MessageChannel; the page
// sends each buffer back when a newer frame replaces it. The copy runs on
// koffi's worker thread, not the window's : a 4096² frame is 67 MB and took
// 25 ms of the main thread (measured). No flip here : the GPU samples them upside
// down instead (a CPU flip was the slow path).

interface InRecv {
  name: string
  recv: Ptr
  fs: Ptr
  refs: number
  alive: boolean
  pool: ArrayBuffer[]
  out: number // buffers the page holds
  last: string // the newest frame's identity (timestamp / timecode / address)
  copy: Copy | null // the frame being copied off-thread (NDI's memory : held until done)
}
interface Copy {
  f: Record<string, unknown>
  since: number
  bytes: number
}
const recvs = new Map<string, InRecv>()
let finder: Ptr = null
let inPort: MessagePort | null = null
type Memcpy = ((dst: ArrayBuffer, src: unknown, n: number) => unknown) & {
  async: (dst: ArrayBuffer, src: unknown, n: number, cb: (err: unknown) => void) => void
}
let memcpy: Memcpy | null | false = null
let libReady: Promise<boolean> | null = null
let pullTimer: ReturnType<typeof setInterval> | null = null

const RGBX_RGBA = 2 // NDIlib_recv_color_format_RGBX_RGBA
const BANDWIDTH_HIGHEST = 100
const PROGRESSIVE = 1 // NDIlib_frame_format_type_progressive
const TS_UNDEFINED = 9223372036854775807n

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

/** Free the frame a receiver holds for an off-thread copy. NDI must not free
 *  that memory under the copy : wait it out first (a few ms, bounded by its
 *  size; only when a layer lets go of a source, or the library goes, mid-copy). */
function settleCopy(r: InRecv): void {
  const c = r.copy
  if (!c) return
  const until = c.since + 40 + c.bytes / 1e6
  while (performance.now() < until) { /* the copy is on another thread */ }
  r.copy = null
  if (lib && r.fs) { try { lib.fs_free(r.fs, c.f) } catch { /* ignore */ } }
}

function closeRecv(r: InRecv): void {
  settleCopy(r)
  if (lib) {
    if (r.fs) { try { lib.fs_destroy(r.fs) } catch { /* ignore */ } }
    if (r.recv) { try { lib.recv_destroy(r.recv) } catch { /* ignore */ } }
  }
  r.fs = null
  r.recv = null
}

/** The library is about to go (a network change, a reload) : stop receiving. */
function beforeUnload(): void {
  for (const r of recvs.values()) closeRecv(r)
  for (const t of taps.values()) closeTap(t)
  if (finder && lib) { try { lib.find_destroy(finder) } catch { /* ignore */ } }
  finder = null
}

/** A fresh library : reopen every receiver a layer still wants. */
function afterInit(): void {
  for (const r of recvs.values()) if (r.alive && !r.recv) openRecv(r)
  for (const t of taps.values()) if (t.alive && !t.recv) openTap(t)
}

function openRecv(r: InRecv): void {
  if (!lib) return
  try {
    r.recv = lib.recv_create({
      source_to_connect_to: { p_ndi_name: r.name, p_url_address: null },
      color_format: RGBX_RGBA, bandwidth: BANDWIDTH_HIGHEST, allow_video_fields: false,
      p_ndi_recv_name: 'Palinopsia'
    })
    r.fs = r.recv ? lib.fs_create(r.recv) : null
  } catch {
    closeRecv(r)
  }
  if (r.fs && !pullTimer) pullTimer = setInterval(pullAll, 4)
}

/** Every few ms : each receiver's newest frame, if it is new and the page has
 *  room for it. A frame-sync capture never waits. */
function pullAll(): void {
  if (!lib || recvs.size === 0) {
    if (pullTimer) { clearInterval(pullTimer); pullTimer = null }
    return
  }
  const k = koffi!
  for (const r of recvs.values()) {
    if (!r.alive || !r.fs || !inPort || r.out >= 2 || r.copy) continue
    const fs = r.fs
    const f: Record<string, unknown> = {}
    try {
      lib.fs_capture(fs, f, PROGRESSIVE)
    } catch {
      continue
    }
    let held = false
    try {
      const w = Number(f.xres), h = Number(f.yres), stride = Number(f.line_stride_in_bytes)
      if (!f.p_data || !(w > 0 && h > 0 && stride > 0)) continue
      const ts = typeof f.timestamp === 'bigint' ? f.timestamp : BigInt(Number(f.timestamp) || 0)
      const id = ts !== TS_UNDEFINED && ts !== 0n ? `t${ts}` : `c${String(f.timecode)}:${String(k.address(f.p_data))}`
      if (id === r.last) continue // the same frame again
      r.last = id
      const bytes = stride * h
      let buf = r.pool.pop()
      if (!buf || buf.byteLength !== bytes) buf = new ArrayBuffer(bytes)
      // NDI timestamps : 100 ns ticks since the Unix epoch (sender clock).
      const sent = ts !== TS_UNDEFINED && ts > 0n ? Number(ts / 10000n) : 0
      const ship = (b: ArrayBuffer): void => {
        r.out++
        inPort!.postMessage({ t: 'in', name: r.name, w, h, stride, buf: b, sent }, [b])
      }
      const mc = getMemcpy(k)
      if (!mc) {
        new Uint8Array(buf).set(k.decode(f.p_data, k.array('uint8_t', bytes, 'Typed')) as Uint8Array)
        ship(buf)
        continue
      }
      const c: Copy = { f, since: performance.now(), bytes }
      const b = buf
      r.copy = c
      held = true
      mc.async(b, f.p_data, bytes, (err) => {
        if (r.copy !== c) return // let go meanwhile : settleCopy freed the frame
        r.copy = null
        if (lib && r.fs === fs) { try { lib.fs_free(fs, f) } catch { /* ignore */ } }
        if (err || !r.alive || !inPort) {
          if (r.pool.length < 3) r.pool.push(b)
          return
        }
        ship(b)
      })
    } catch {
      /* drop this frame */
    } finally {
      if (!held) { try { lib.fs_free(fs, f) } catch { /* ignore */ } }
    }
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
  r = { name, recv: null, fs: null, refs: 1, alive: true, pool: [], out: 0, last: '', copy: null }
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
  closeRecv(r)
}

// ── NDI AUDIO IN : an NDI source's sound as an Audio Layer slot ─────────────
// One receiver per slot (a "tap"), AUDIO ONLY (the sender sends it no picture),
// on the same library and the same discovery as the video input. Even a source
// a layer already shows gets its own : the video one asks for the highest
// bandwidth, and each frame sync hands its audio to one reader.
//
// The sound goes through NDI's frame sync too : it resamples the source to the
// rate asked (the audio context's) and to the pace it is pulled at, so the
// sender's clock never has to match ours. Pulled HERE, and handed to the slot's
// AudioWorklet processor (audio/ndiAudio.worklet.js) over a port the page only
// passes on : planar float, every channel of the source (up to 16), transferred.
//
// How it is pulled (all measured outside the app, the processor included) :
// - STEADY and SMALL : every ~5 ms (a timer, and each report of the processor,
//   which runs on the sound card's clock), what the time since the last pull is
//   worth. The frame sync keeps only ~10-20 ms queued : pulled every 16 ms (or
//   on the processor's demand, in the sound card's bursts) it ran dry and padded
//   silence several times a minute; every 5 ms, not once in a minute.
// - TRIMMED toward the processor's buffer target by at most 300 ppm (the sound
//   card's clock against ours : any card's drift) : a faster trim looked to the
//   frame sync like a wobbling reader and it re-synced (dropouts).
// - the frame sync SHORT of it (the next packet a little late) : what it holds,
//   the rest at the next pull, up to 30 ms behind (then all of it : a source
//   gone, silence), rather than its padding of silence.
// - a hold-up of the window (a heavy frame) : the next pull takes the time it
//   lasted (the frame sync kept it), the processor skips what is too much.
// Sender clock to the sound card's output : ~49 ms (sd 1.3); a card 300 ppm
// off : still 43-56 ms after 90 s.

interface AudioTap {
  id: string // the slot ('A' / 'B')
  name: string
  rate: number
  recv: Ptr
  fs: Ptr
  port: MessagePort | null
  token: string // whose port it is (a slot's old processor letting go must not close its new one)
  alive: boolean
  seq: number
  sent: Array<[number, number]> // chunks [seq, frames] the processor has not acknowledged yet
  err: number // the processor's buffer below its target, frames (smoothed)
  reportAt: number // its last report (none for 300 ms : its context stopped, no pulls)
  lastPull: number
  acc: number // frames due, not pulled yet
  conn: number // NDI connections (0 : the source is not there)
  connAt: number
  quietAt: number // when a message last went out (it hears the connection at least every 250 ms)
  linger: ReturnType<typeof setTimeout> | null
}
const taps = new Map<string, AudioTap>()
const BANDWIDTH_AUDIO_ONLY = 10
const MAX_AUDIO_CH = 16
const AUDIO_TICK = 5 // ms
const AUDIO_TRIM = 0.0003 // 300 ppm
let audioTimer: ReturnType<typeof setInterval> | null = null

function openTap(t: AudioTap): void {
  if (!lib) return
  try {
    t.recv = lib.recv_create({
      source_to_connect_to: { p_ndi_name: t.name, p_url_address: null },
      color_format: RGBX_RGBA, bandwidth: BANDWIDTH_AUDIO_ONLY, allow_video_fields: false,
      p_ndi_recv_name: 'Palinopsia'
    })
    t.fs = t.recv ? lib.fs_create(t.recv) : null
  } catch {
    closeTap(t)
  }
}

/** Its receiver goes (the library going, or the tap). The audio copy is
 *  synchronous : nothing of NDI's is held between calls. */
function closeTap(t: AudioTap): void {
  if (lib) {
    if (t.fs) { try { lib.fs_destroy(t.fs) } catch { /* ignore */ } }
    if (t.recv) { try { lib.recv_destroy(t.recv) } catch { /* ignore */ } }
  }
  t.fs = null
  t.recv = null
  t.conn = 0
}

function dropTap(t: AudioTap): void {
  t.alive = false
  if (t.linger) { clearTimeout(t.linger); t.linger = null }
  try { t.port?.close() } catch { /* ignore */ }
  t.port = null
  closeTap(t)
}

/** The processor's report : its buffer, its target, the last chunk it got. */
function onReport(t: AudioTap, d: { t?: string; fill?: number; ack?: number; target?: number } | null): void {
  if (!d || d.t !== 'want' || !t.port) return
  const ack = Number(d.ack) || 0
  while (t.sent.length && t.sent[0][0] <= ack) t.sent.shift()
  let inflight = 0
  for (const s of t.sent) inflight += s[1]
  // smoothed (~0.3 s) : the reports jitter with the sound card's bursts
  const err = (Number(d.target) || 0) - (Number(d.fill) || 0) - inflight
  t.err += (err - t.err) * 0.02
  t.reportAt = performance.now()
  pullTap(t, t.reportAt)
}

/** What the time since the last pull is worth (see above), sent on. */
function pullTap(t: AudioTap, now: number): void {
  const port = t.port
  if (!port) return
  if (lib && t.recv && now - t.connAt > 500) {
    t.connAt = now
    try { t.conn = lib.recv_conn(t.recv) } catch { t.conn = 0 }
  }
  const status = (): void => {
    if (now - t.quietAt <= 250) return
    t.quietAt = now
    try { port.postMessage({ t: 'a', seq: t.seq, n: 0, ch: 0, conn: t.conn }) } catch { /* closed */ }
  }
  // the processor quiet (its audio context stopped) : nothing pulled (NDI drops what piles up)
  if (!t.reportAt || now - t.reportAt > 300) {
    t.lastPull = 0
    t.acc = 0
    status()
    return
  }
  const dt = t.lastPull ? Math.min(250, now - t.lastPull) : AUDIO_TICK
  if (dt * t.rate < 32000) { status(); return } // under ~0.7 ms : the next one
  t.lastPull = now
  const base = (dt / 1000) * t.rate
  t.acc = Math.min(t.rate / 4, t.acc + base + base * AUDIO_TRIM * Math.max(-1, Math.min(1, t.err / (t.rate * 0.01))))
  const fs = t.fs
  const l = lib
  if (!l || !fs || !l.fs_audio || !l.fs_free_audio) { status(); return }
  let want = Math.floor(t.acc)
  if (want >= 32 && l.fs_depth) {
    try {
      const depth = l.fs_depth(fs)
      if (depth < want && t.acc - depth < t.rate * 0.03) want = depth
    } catch { /* take it all */ }
  }
  if (want < 32) { status(); return }
  t.acc -= want
  const f: Record<string, unknown> = {}
  let got = false
  try {
    // 0 channels : the source's own; the rate asked : NDI resamples to it
    l.fs_audio(fs, f, t.rate, 0, want)
    got = true
    const n = Number(f.no_samples) | 0, all = Number(f.no_channels) | 0, stride = Number(f.channel_stride_in_bytes) | 0
    const ch = Math.min(MAX_AUDIO_CH, all)
    // (no sound yet : no data, no channels)
    if (f.p_data && n > 0 && ch > 0 && stride >= n * 4) {
      const buf = new ArrayBuffer(n * 4 * ch)
      const k = koffi!
      const mc = getMemcpy(k)
      if (mc && stride === n * 4) mc(buf, f.p_data, n * 4 * ch)
      else {
        for (let c = 0; c < ch; c++) {
          new Float32Array(buf, c * n * 4, n).set(k.decode(f.p_data, c * stride, k.array('float', n, 'Typed')) as Float32Array)
        }
      }
      t.seq++
      t.sent.push([t.seq, n])
      if (t.sent.length > 64) t.sent.shift() // a processor that stopped acknowledging
      port.postMessage({ t: 'a', seq: t.seq, n, ch: all, conn: t.conn, buf }, [buf])
      t.quietAt = now
    }
  } catch {
    /* drop this pull */
  } finally {
    if (got) { try { l.fs_free_audio(fs, f) } catch { /* ignore */ } }
  }
  status()
}

function pullTaps(): void {
  const now = performance.now()
  let any = false
  for (const t of taps.values()) {
    if (!t.port) continue
    any = true
    pullTap(t, now)
  }
  if (!any && audioTimer) { clearInterval(audioTimer); audioTimer = null }
}

/** Start (or take back) the receiver for one slot's NDI source, and hand the
 *  page a fresh port for its processor (window message 'opsia:ndiaudioport'
 *  carrying `token`). `rate` : the audio context's. False : no NDI runtime, or
 *  NDI refused the receiver. */
export async function ndiAudioOpen(id: string, name: string, rate: number, token: string): Promise<boolean> {
  let t = taps.get(id)
  if (t && (t.name !== name || t.rate !== rate)) {
    dropTap(t)
    taps.delete(id)
    t = undefined
  }
  if (!t) {
    t = {
      id, name, rate, recv: null, fs: null, port: null, token: '', alive: true, seq: 0, sent: [],
      err: 0, reportAt: 0, lastPull: 0, acc: 0, conn: 0, connAt: 0, quietAt: 0, linger: null
    }
    taps.set(id, t)
  }
  const tap = t
  if (tap.linger) { clearTimeout(tap.linger); tap.linger = null }
  tap.alive = true
  // this open's now (a close for it, even of one that failed, lets the tap go)
  tap.token = token
  if (!(await ensureLib())) return false
  if (taps.get(id) !== tap || !tap.alive || tap.token !== token) return false // let go (or opened again) meanwhile
  if (!tap.recv) openTap(tap)
  try { tap.port?.close() } catch { /* ignore */ }
  const mc = new MessageChannel()
  tap.port = mc.port1
  tap.sent = []
  tap.err = 0
  tap.reportAt = 0
  tap.lastPull = 0
  tap.acc = 0
  tap.quietAt = 0
  mc.port1.onmessage = (ev): void => onReport(tap, ev.data)
  if (!audioTimer) audioTimer = setInterval(pullTaps, AUDIO_TICK)
  window.postMessage({ t: 'opsia:ndiaudioport', token }, '*', [mc.port2])
  return !!tap.fs && !!lib?.fs_audio
}

/** A slot lets go of its NDI source (`token` : the open it was). The receiver
 *  lingers two seconds : the same slot opening it again (an audio context
 *  rebuilt after a device error, an undo) takes it back without NDI's few
 *  seconds of connecting. */
export function ndiAudioClose(id: string, token: string): void {
  const t = taps.get(id)
  if (!t || t.token !== token) return
  try { t.port?.close() } catch { /* ignore */ }
  t.port = null
  t.sent = []
  if (t.linger) clearTimeout(t.linger)
  t.linger = setTimeout(() => {
    t.linger = null
    if (taps.get(id) !== t || t.port) return
    taps.delete(id)
    dropTap(t)
  }, 2000)
}
