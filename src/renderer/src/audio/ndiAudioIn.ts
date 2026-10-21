// NDI® audio in, page side : an Audio Layer slot's NDI source as an AudioNode.
// NDI® is a registered trademark of Vizrt NDI AB.
//
// The receiver runs in the preload (src/preload/ndi.ts, the same NDI runtime as
// the video input); its sound goes STRAIGHT to the slot's AudioWorklet processor
// (ndiAudio.worklet.js) over a private port the page only hands on : no audio
// on this thread (how it is pulled and buffered : the preload's and the
// worklet's headers). Here : the module on the context, the node, the port
// handshake, and the processor's status for the slot.

import workletUrl from './ndiAudio.worklet.js?url'

/** What a slot's NDI source is delivering (the processor, every 250 ms). */
export interface NdiAudioStatus {
  /** the source's channels (0 : no sound from it yet) */
  channels: number
  connected: boolean
  /** the jitter buffer : what it holds now, and its target */
  fillMs: number
  targetMs: number
  /** times it ran dry (the window's main thread held up past the target) */
  underruns: number
}

// The module, once per audio context (a context rebuilt after a device error
// loads it again).
const modules = new WeakMap<BaseAudioContext, Promise<void>>()
function ensureModule(ctx: AudioContext): Promise<void> {
  let p = modules.get(ctx)
  if (!p) {
    p = ctx.audioWorklet.addModule(workletUrl)
    p.catch(() => modules.delete(ctx))
    modules.set(ctx, p)
  }
  return p
}

let opens = 0

/** One slot's NDI source playing. `node` : its sound, stereo (the channels picked). */
export class NdiAudioTap {
  private closed = false
  constructor(readonly node: AudioWorkletNode, private readonly id: string, private readonly token: string) {}

  /** The channels played, 0-based (r < 0 : l on both sides). Crossfaded. */
  channels(l: number, r: number): void {
    try { this.node.port.postMessage({ t: 'ch', l, r }) } catch { /* closed */ }
  }

  /** Silenced and let go (the receiver lingers a moment in the preload). */
  close(): void {
    if (this.closed) return
    this.closed = true
    try { this.node.port.postMessage({ t: 'close' }) } catch { /* gone */ }
    this.node.port.onmessage = null
    try { this.node.disconnect() } catch { /* gone */ }
    try { window.api.ndiAudioClose(this.id, this.token) } catch { /* gone */ }
  }
}

/** Open slot `id`'s NDI source `name` on `ctx`, playing channels `l` / `r`.
 *  `onStatus` hears the processor while it runs. Rejects when NDI cannot (no
 *  runtime, the receiver refused). */
export async function openNdiAudio(
  ctx: AudioContext,
  id: string,
  name: string,
  l: number,
  r: number,
  onStatus: (st: NdiAudioStatus) => void
): Promise<NdiAudioTap> {
  await ensureModule(ctx)
  const node = new AudioWorkletNode(ctx, 'ndi-audio-in', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] })
  node.port.postMessage({ t: 'ch', l, r })
  node.port.onmessage = (e): void => {
    const d = e.data as { t?: string; ch?: number; conn?: number; fillMs?: number; targetMs?: number; under?: number } | null
    if (!d || d.t !== 'st') return
    onStatus({
      channels: d.ch ?? 0, connected: (d.conn ?? 0) > 0,
      fillMs: d.fillMs ?? 0, targetMs: d.targetMs ?? 0, underruns: d.under ?? 0
    })
  }
  const token = `${id}:${++opens}:${Date.now()}`
  const tap = new NdiAudioTap(node, id, token)
  // The preload answers on the window with the port (a private channel : the
  // sound never goes through window messages).
  let off = (): void => {}
  let settle: (p: MessagePort | null) => void = () => {}
  const port = new Promise<MessagePort | null>((res) => {
    settle = res
    const onMsg = (ev: MessageEvent): void => {
      const d = ev.data as { t?: string; token?: string } | null
      if (!d || typeof d !== 'object' || d.t !== 'opsia:ndiaudioport' || d.token !== token || !ev.ports?.[0]) return
      off()
      res(ev.ports[0])
    }
    const t = window.setTimeout(() => { off(); res(null) }, 5000)
    off = () => { window.clearTimeout(t); window.removeEventListener('message', onMsg) }
    window.addEventListener('message', onMsg)
  })
  let ok = false
  try {
    ok = await window.api.ndiAudioOpen(id, name, ctx.sampleRate, token)
  } catch {
    ok = false
  }
  // (no runtime : no port is coming)
  if (!ok) { off(); settle(null) }
  const p = await port
  if (!ok || !p) {
    off()
    try { p?.close() } catch { /* ignore */ }
    tap.close()
    throw new Error('NDI could not open it (is the NDI runtime installed? Output → NDI)')
  }
  node.port.postMessage({ t: 'port', port: p }, [p])
  return tap
}
