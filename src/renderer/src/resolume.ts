// Resolume OSC mapper : the live engine.
//
// Rows are Palinopsia's own signals (modulators, Meta knobs, the audio / vision /
// body buses, or any /opsia address), columns are Resolume OSC addresses read out
// of a composition. Each tick every connected column combines its rows, shapes
// the result (range, slew) and sends it to Resolume in ONE batched IPC hop. Only
// connected columns send, and a float only when it actually moved.
//
// Built after Vincent's Max patch OSC_Data_RouteToResolume (udpreceive → route
// per feature → speedlim → matrix 18 30 → udpsend), including its scene trigger
// (/scene N → /composition/columns/N/connect).

import { useStore } from './store'
import { modEngine } from './engine/modulation'
import { audioBus, type AudioFeatureName } from './engine/audioIn'
import { visionBus, VISION_FEATURES, type VisionFeatureName } from './engine/visionIn'
import { bodyBus } from './engine/bodyIn'
import { BODY_FEATURES, type BodyFeature, type OscInEvent } from '@shared/types'
import type { ResoKind, ResoOutput } from '@shared/resolume'
import { oscLeafList, oscLeafValues } from './oscInput'

// ── Input sources ─────────────────────────────────────────────────────

export interface ResoSourceDesc {
  source: string
  label: string
  group: string
}

const AUDIO_SOURCES: Array<[string, string]> = [
  ['level', 'level'], ['flux', 'flux'], ['transient', 'transient'], ['centroid', 'centroid (brightness)'],
  ['pitch', 'pitch'], ['noisiness', 'noisiness'],
  ['band1', 'band 1 (low)'], ['band2', 'band 2'], ['band3', 'band 3'], ['band4', 'band 4'], ['band5', 'band 5'], ['band6', 'band 6 (high)']
]

/** Every signal a row can carry, grouped for the picker. */
export function resoSourceCatalogue(): ResoSourceDesc[] {
  const st = useStore.getState()
  const r: ResoSourceDesc[] = []
  st.composition.modulators.forEach((m, i) => r.push({ source: `mod:${i + 1}`, label: `Mod ${i + 1} · ${m.type}`, group: 'Modulators' }))
  st.composition.metaKnobs.forEach((k, i) => r.push({ source: `meta:${i + 1}`, label: `Meta ${i + 1}${k.name ? ` · ${k.name}` : ''}`, group: 'Meta knobs' }))
  for (const [k, l] of AUDIO_SOURCES) r.push({ source: `audio:${k}`, label: `audio ${l}`, group: 'Audio' })
  for (const v of VISION_FEATURES) r.push({ source: `vision:${v}`, label: `vision ${v}`, group: 'Vision' })
  for (const b of BODY_FEATURES) r.push({ source: `body:${b}`, label: `body ${b}`, group: 'Body' })
  for (const l of oscLeafList()) r.push({ source: `osc:${l.path}`, label: l.path, group: 'Palinopsia OSC' })
  return r
}

export function resoSourceLabel(source: string): string {
  const [kind, rest] = [source.slice(0, source.indexOf(':')), source.slice(source.indexOf(':') + 1)]
  const st = useStore.getState()
  if (kind === 'mod') {
    const m = st.composition.modulators[Number(rest) - 1]
    return `Mod ${rest}${m ? ` · ${m.type}` : ''}`
  }
  if (kind === 'meta') {
    const k = st.composition.metaKnobs[Number(rest) - 1]
    return `Meta ${rest}${k?.name ? ` · ${k.name}` : ''}`
  }
  if (kind === 'audio') return `audio ${rest}`
  if (kind === 'vision') return `vision ${rest}`
  if (kind === 'body') return `body ${rest}`
  if (kind === 'osc') return rest.replace(/^\/opsia\//, '')
  return source
}

/** The default rows : 18, like the patch's 18 inputs (8 modulators, 6 picture
 *  features, 4 sound features). */
export const RESO_DEFAULT_SOURCES = [
  'mod:1', 'mod:2', 'mod:3', 'mod:4', 'mod:5', 'mod:6', 'mod:7', 'mod:8',
  'vision:brightness', 'vision:motion', 'vision:contrast', 'vision:edges', 'vision:warmth', 'vision:hue',
  'audio:level', 'audio:transient', 'audio:centroid', 'audio:noisiness'
]

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

function readSource(source: string, leaves: Map<string, number> | null): number {
  const i = source.indexOf(':')
  const kind = source.slice(0, i)
  const rest = source.slice(i + 1)
  switch (kind) {
    case 'mod':
      return modEngine.values[Number(rest) - 1] ?? 0
    case 'meta':
      return useStore.getState().composition.metaKnobs[Number(rest) - 1]?.value ?? 0
    case 'audio': {
      const b = /^band(\d)$/.exec(rest)
      return b ? audioBus.feature('band', Number(b[1]) - 1) : audioBus.feature(rest as AudioFeatureName)
    }
    case 'vision':
      return visionBus.feature(rest as VisionFeatureName)
    case 'body':
      return bodyBus.feature(rest as BodyFeature)
    case 'osc':
      return leaves?.get(rest) ?? 0
  }
  return 0
}

// ── Live state (read by the page's meters; never goes through React) ───────

export const resoLive = {
  inputs: new Map<string, number>(), // input id → smoothed value
  outputs: new Map<string, number>(), // output id → value as sent (0..1 before range)
  sentPerSec: 0,
  lastSceneId: null as string | null
}

const outState = new Map<string, { y: number; sent: number | null; on: boolean; armed: boolean }>()
let timer: ReturnType<typeof setInterval> | null = null
let lastTick = 0
let sentWindow = 0
let sentWindowAt = 0

/** Start / stop / re-rate the send loop to match the store. */
export function applyResolume(): void {
  const r = useStore.getState().resolume
  if (timer) { clearInterval(timer); timer = null }
  outState.clear()
  if (!r.enabled) { resoLive.sentPerSec = 0; return }
  lastTick = performance.now()
  timer = setInterval(tick, Math.max(10, 1000 / Math.max(1, Math.min(120, r.rateHz || 30))))
}

function slewAlpha(smooth: number, dt: number): number {
  if (smooth <= 0.001) return 1
  const tau = smooth * smooth * 2 // 0..2 s time constant, fine control near 0
  return 1 - Math.exp(-dt / tau)
}

function tick(): void {
  const st = useStore.getState()
  const r = st.resolume
  if (!r.enabled) return
  const now = performance.now()
  const dt = Math.min(0.25, (now - lastTick) / 1000)
  lastTick = now

  const leaves = r.inputs.some((i) => i.source.startsWith('osc:')) ? oscLeafValues() : null
  for (const inp of r.inputs) {
    const x = clamp01(readSource(inp.source, leaves) * (inp.gain ?? 1))
    const prev = resoLive.inputs.get(inp.id)
    const y = prev === undefined ? x : prev + (x - prev) * slewAlpha(inp.smooth ?? 0, dt)
    resoLive.inputs.set(inp.id, y)
  }

  const msgs: Array<{ address: string; args: Array<{ type: string; value: number }> }> = []
  const byOut = new Map<string, number[]>()
  for (const c of r.cells) {
    const v = resoLive.inputs.get(c.i)
    if (v === undefined) continue
    let a = byOut.get(c.o)
    if (!a) byOut.set(c.o, (a = []))
    a.push(v * c.amount)
  }
  for (const o of r.outputs) {
    const vals = byOut.get(o.id)
    if (!vals || !vals.length) { resoLive.outputs.delete(o.id); continue }
    const x = o.combine === 'max' ? Math.max(...vals) : o.combine === 'sum' ? clamp01(vals.reduce((p, q) => p + q, 0)) : vals.reduce((p, q) => p + q, 0) / vals.length
    let s = outState.get(o.id)
    if (!s) outState.set(o.id, (s = { y: x, sent: null, on: false, armed: true }))
    s.y += (x - s.y) * slewAlpha(o.smooth ?? 0, dt)
    resoLive.outputs.set(o.id, s.y)
    emit(o, s, msgs)
  }

  // Scene follow : recalling Palinopsia scene N connects Resolume column N (+ offset).
  if (r.sceneColumns && st.activeSceneId !== resoLive.lastSceneId) {
    resoLive.lastSceneId = st.activeSceneId
    const idx = st.scenes.findIndex((x) => x.id === st.activeSceneId)
    if (idx >= 0) msgs.push({ address: `/composition/columns/${idx + 1 + (r.columnOffset | 0)}/connect`, args: [{ type: 'i', value: 1 }] })
  }

  if (msgs.length) window.api.oscSendBatch(r.host, r.port, msgs)
  sentWindow += msgs.length
  if (now - sentWindowAt > 1000) {
    resoLive.sentPerSec = Math.round((sentWindow * 1000) / (now - sentWindowAt))
    sentWindow = 0
    sentWindowAt = now
  }
}

function emit(
  o: ResoOutput,
  s: { y: number; sent: number | null; on: boolean; armed: boolean },
  msgs: Array<{ address: string; args: Array<{ type: string; value: number }> }>
): void {
  if (o.kind === 'float') {
    const v = o.lo + (o.hi - o.lo) * s.y
    if (s.sent === null || Math.abs(v - s.sent) > 0.0015) {
      msgs.push({ address: o.address, args: [{ type: 'f', value: v }] })
      s.sent = v
    }
    return
  }
  // Toggle / trigger : a little hysteresis so a value hovering at 0.5 can't chatter.
  const on = s.on ? s.y > 0.45 : s.y > 0.55
  if (o.kind === 'toggle') {
    if (on !== s.on || s.sent === null) {
      msgs.push({ address: o.address, args: [{ type: 'i', value: on ? 1 : 0 }] })
      s.sent = on ? 1 : 0
    }
  } else if (on && !s.on) {
    msgs.push({ address: o.address, args: [{ type: 'i', value: 1 }] })
  }
  s.on = on
}

/** Send one output by hand (the page's "test" button) : a float sweeps up and
 *  back down so you can see WHICH control in Resolume it is; a trigger fires; a
 *  toggle flips. */
export function resoTest(o: ResoOutput): void {
  const { host, port } = useStore.getState().resolume
  const send = (v: number, type: 'f' | 'i'): void =>
    window.api.oscSendBatch(host, port, [{ address: o.address, args: [{ type, value: v }] }])
  if (o.kind === 'trigger') return send(1, 'i')
  if (o.kind === 'toggle') {
    const s = outState.get(o.id)
    const next = s?.on ? 0 : 1
    if (s) s.on = !!next
    return send(next, 'i')
  }
  const t0 = performance.now()
  const step = (): void => {
    const p = (performance.now() - t0) / 900
    if (p >= 1) return send(o.lo, 'f')
    send(o.lo + (o.hi - o.lo) * Math.sin(Math.PI * p), 'f')
    setTimeout(step, 30)
  }
  step()
}

// ── Learn : catch addresses straight off Resolume's OSC output ─────────────

let learning = false
const learnListeners = new Set<(address: string) => void>()

export function setResoLearning(on: boolean): void {
  learning = on
}
export function isResoLearning(): boolean {
  return learning
}
export function onResoLearned(cb: (address: string) => void): () => void {
  learnListeners.add(cb)
  return () => learnListeners.delete(cb)
}

function kindFor(address: string, args: OscInEvent['args']): ResoKind {
  if (/\/(connect|clear|select|trigger|resync)$/.test(address)) return 'trigger'
  if (/\/bypassed$|\/solo$/.test(address)) return 'toggle'
  const a = args[0]
  if (a && (a.type === 'T' || a.type === 'F')) return 'toggle'
  return 'float'
}

/** Called for every inbound /composition… message. While learning, a new
 *  address becomes an output column in the "Learned" group. */
export function resolumeLearn(address: string, args: OscInEvent['args']): void {
  if (!learning) return
  const st = useStore.getState()
  if (st.resolume.locked) return
  if (st.resolume.outputs.some((o) => o.address === address)) return
  // Resolume streams transport positions and meters continuously : those are
  // not controls anyone means to map, so they never auto-learn.
  if (/\/(position|elapsed|duration|audio\/meter|thumbnail)/.test(address)) return
  const segs = address.split('/').filter(Boolean)
  const label = segs.slice(-3).join(' ')
  st.resoAddOutput({ address, label, group: 'Learned', kind: kindFor(address, args), lo: 0, hi: 1, smooth: 0, combine: 'mean' })
  for (const cb of learnListeners) cb(address)
}
