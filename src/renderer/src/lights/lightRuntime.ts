// The Lights at run time : called from the render loop every frame. It collects
// the light readback the frame it lands (so its slots free up), and at the rig's
// fps it queues the next one, runs the engine and sends : the Enttec Pros from
// here (Web Serial), the network universes through main. While the page is open
// it runs even with the output off, so the fixtures show what they would send.

import type { Compositor } from '../engine/Compositor'
import { useStore } from '../store'
import { audioBus } from '../engine/audioIn'
import { soniBeats } from '../audio/soniClock'
import { LightEngine, paletteOf, type LightFrame, type LightGrid } from './lightEngine'
import { enttec } from './enttec'
import type { LightOutput, LightTune } from '@shared/lights'
import { setLightBaseOf } from './lightMods'
import { lightBaseValue } from './lightStore'
import { setPaletteSource } from './lightShows'
import { bodyTracker } from '../engine/bodyTracker'

/** The people the Body page tracks, on the picture (x, y 0..1, y down; r their
 *  height in frame heights) : the Room tracker's everyone, or the one pose. */
function peopleNow(): Array<{ x: number; y: number; r: number }> {
  if (!bodyTracker.status().running) return []
  const p = bodyTracker.preview()
  const mx = (x: number): number => (p.mirror ? 1 - x : x)
  const out: Array<{ x: number; y: number; r: number }> = []
  if (p.people.length) {
    for (const q of p.people) out.push({ x: mx((q.box[0] + q.box[2]) / 2), y: (q.box[1] + q.box[3]) / 2, r: Math.max(0.05, q.box[3] - q.box[1]) })
  } else if (p.pose) {
    let x0 = 1, x1 = 0, y0 = 1, y1 = 0, n = 0
    for (const l of p.pose) {
      if ((l.visibility ?? 1) < 0.5) continue
      x0 = Math.min(x0, l.x); x1 = Math.max(x1, l.x); y0 = Math.min(y0, l.y); y1 = Math.max(y1, l.y); n++
    }
    if (n > 4) out.push({ x: mx((x0 + x1) / 2), y: (y0 + y1) / 2, r: Math.max(0.05, y1 - y0) })
  }
  return out
}

setLightBaseOf((fixture, field) => {
  const st = useStore.getState()
  return lightBaseValue(st.lightRig, st.lightsSession, fixture, field)
})
// (the Picture colors show, and the gradient's "from the picture" : the master's colors)
setPaletteSource(() => paletteOf(lightRuntime.grid(-1), 4))

/** Now, or `ms` later (an output's delay); dropped if the lights went off meanwhile. */
function later(ms: number, out: string, fn: () => void): void {
  if (ms <= 0) { fn(); return }
  window.setTimeout(() => {
    const r = useStore.getState().lightRig
    if (r.on && r.outputs.some((o) => o.id === out && o.enabled)) fn()
  }, ms)
}

type Dest = { kind: 'enttec'; index: number } | { kind: 'artnet' | 'sacn' | 'wled'; host: string; universe: number }

const W = 192
const H = 108

class LightRuntime {
  readonly engine = new LightEngine()
  /** The last frame (the page draws its colors). */
  last: LightFrame | null = null
  lastAt = 0
  /** Frames sent in the last second, and what went out. */
  stats = { fps: 0, universes: 0, enttec: 0, net: 0 }
  private grids = new Map<number, LightGrid>()
  private nextAt = 0
  private sentTimes: number[] = []
  private fadeEpoch = -1
  private wasActive = false
  // Where the last frame went : a place that stops being fed gets one dark frame
  // (an Enttec repeats its last frame for ever, most nodes hold theirs : without
  // it the room stays lit in its last look when the lights go off or the app quits).
  private fed = new Map<string, Dest>()

  constructor() {
    if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => this.darkAll())
  }

  private dark(d: Dest): void {
    if (d.kind === 'enttec') enttec.dark(d.index)
    else { try { window.api.lightDmx([{ kind: d.kind, host: d.host, universe: d.universe, data: new Uint8Array(512) }]) } catch { /* main gone */ } }
  }

  /** Every place fed so far goes dark (the lights off, the page closed, quitting). */
  darkAll(): void {
    for (const d of this.fed.values()) this.dark(d)
    this.fed.clear()
  }

  private keepGrid(src: number, w: number, h: number, px: Uint8Array): void {
    let g = this.grids.get(src)
    if (!g || g.px.length !== px.length) { g = { w, h, px: new Uint8Array(px.length) }; this.grids.set(src, g) }
    g.px.set(px)
  }

  tick(comp: Compositor, now: number): void {
    const st = useStore.getState()
    const rig = st.lightRig
    // (the page open, or lights that can reach an output : a rig with nothing
    // patched costs no readback while the page is closed)
    const reach = rig.on && rig.fixtures.some((f) => rig.outputs.some((o) => o.id === f.out && o.enabled))
    const active = rig.fixtures.length > 0 && (reach || st.lightsPageOpen)
    if (!active) {
      if (this.wasActive) { this.darkAll(); comp.dropLights(); enttec.keepOnly(new Set()); this.last = null }
      this.stats = { fps: 0, universes: 0, enttec: 0, net: 0 }
      this.wasActive = false
      return
    }
    this.wasActive = true
    // collected the frame it lands
    const got = comp.takeLights()
    if (got) got.srcs.forEach((s, i) => this.keepGrid(s, got.w, got.h, got.grids[i]))
    if (now < this.nextAt) return
    // (the deadline advances by the interval, so a 60 Hz loop still averages the
    // rig's fps : now + interval sent every other frame, 30 for a 40 Hz rig)
    const interval = 1000 / Math.max(10, Math.min(44, rig.fps))
    this.nextAt = Math.max(this.nextAt + interval, now - interval)
    // the sources in use : the master (always : its colors make the palettes), the
    // layers the looks read
    const L = st.lightsSession
    const srcs = new Set<number>([-1])
    for (const f of rig.fixtures) {
      const look = L.looks[f.id]
      const s = look?.source ?? 'master'
      if (s === 'master') srcs.add(-1)
      else if (s === 'layer') srcs.add(look!.layer)
    }
    // (the page's backdrop for a fixture reading a layer)
    if (st.lightsPageOpen && st.lightSel) {
      const look = L.looks[st.lightSel]
      if (look?.source === 'layer') srcs.add(look.layer)
    }
    const list = [...srcs].sort((a, b) => a - b)
    if (list.length) comp.kickLights(list, W, H)
    // (a source nobody reads any more : its picture goes, never shown stale later)
    for (const k of [...this.grids.keys()]) if (!srcs.has(k)) this.grids.delete(k)
    if (st.lightFadeEpoch !== this.fadeEpoch) {
      if (this.fadeEpoch >= 0) this.engine.beginFade(st.lightFadeSec ?? L.master.fadeSec)
      this.fadeEpoch = st.lightFadeEpoch
    }
    // the cues following on : the next one goes its follow time after this one is in
    if (st.lightCueRun && st.lightCue) {
      const sc = L.scenes.find((x) => x.id === st.lightCue)
      if (sc?.follow && sc.follow > 0 && now - st.lightCueAt >= ((sc.fade ?? L.master.fadeSec) + sc.follow) * 1000) st.goLightCue(1)
    }
    const wantPeople = rig.fixtures.some((f) => L.looks[f.id]?.effect === 'presence')
    const band = (i: number): number => Math.max(audioBus.feature('band', i * 2), audioBus.feature('band', i * 2 + 1))
    const tunes: Record<string, LightTune> = {}
    if (rig.tuneScope === 'look' && L.tunes) for (const f of rig.fixtures) if (L.tunes[f.id]) tunes[f.id] = L.tunes[f.id]
    const frame = this.engine.frame({
      rig,
      looks: L.looks,
      tunes,
      master: L.master,
      // (the top bar's Black takes the whole show down, the lights with it)
      black: st.lightsBlack || st.black,
      grids: {
        master: this.grids.get(-1) ?? null,
        layers: [0, 1, 2, 3].map((i) => this.grids.get(i) ?? null)
      },
      nowMs: now,
      beats: soniBeats(),
      bpm: st.composition.bpm,
      audio: audioBus.feature('level'),
      bands: [band(0), band(1), band(2)],
      people: wantPeople ? peopleNow() : undefined,
      aspect: st.compW / Math.max(1, st.compH),
      identify: st.lightIdentify,
      groupLevels: L.groups,
      test: st.lightTest !== null ? Math.max(0, now - st.lightTest) / 1000 : null
    })
    this.last = frame
    this.lastAt = now
    // out
    const used = new Set<number>()
    if (rig.on) {
      // each output on its own delay (a projector's lag); an Art-Net one with sync
      // closes its frame with an ArtSync
      const byOut = new Map<string, LightOutput>(rig.outputs.map((o) => [o.id, o]))
      for (const o of rig.outputs) {
        if (o.kind !== 'enttec' || !o.enabled) continue
        const data = frame.enttec.get(o.index)
        if (!data || used.has(o.index)) continue
        used.add(o.index)
        later(o.delay, o.id, () => enttec.send(o.index, data))
      }
      const groups = new Map<string, typeof frame.net>()
      for (const p of frame.net) {
        let g = groups.get(p.out)
        if (!g) { g = []; groups.set(p.out, g) }
        g.push(p)
      }
      for (const [id, packets] of groups) {
        const o = byOut.get(id)
        if (!o) continue
        const list: Array<{ kind: 'artnet' | 'sacn' | 'wled' | 'artsync'; host: string; universe: number; data?: Uint8Array }> = packets
        if (o.kind === 'artnet' && o.sync && o.host) list.push({ kind: 'artsync', host: o.host, universe: 0 })
        later(o.delay, o.id, () => {
          try { window.api.lightDmx(list) } catch { /* main not ready yet */ }
        })
      }
      this.sentTimes.push(now)
      // what was fed and no longer is : one dark frame
      const fedNow = new Map<string, Dest>()
      for (const o of rig.outputs) if (o.kind === 'enttec' && o.enabled && frame.enttec.has(o.index)) fedNow.set(`e|${o.index}`, { kind: 'enttec', index: o.index })
      for (const p of frame.net) fedNow.set(`${p.kind}|${p.host}|${p.universe}`, { kind: p.kind, host: p.host, universe: p.universe })
      for (const [k, d] of this.fed) if (!fedNow.has(k)) this.dark(d)
      this.fed = fedNow
    } else if (this.fed.size) this.darkAll()
    enttec.keepOnly(used)
    while (this.sentTimes.length && now - this.sentTimes[0] > 1000) this.sentTimes.shift()
    this.stats = { fps: this.sentTimes.length, universes: frame.enttec.size + frame.net.length, enttec: frame.enttec.size, net: frame.net.length }
  }

  /** The picture a source showed last (the page's backdrop for a layer). */
  grid(src: number): LightGrid | null {
    return this.grids.get(src) ?? null
  }
}

/** One for the app : hot updates must not leave a second one sending. */
const G = globalThis as unknown as { __opsiaLights?: LightRuntime }
export const lightRuntime: LightRuntime = G.__opsiaLights ?? (G.__opsiaLights = new LightRuntime())
