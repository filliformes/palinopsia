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

setLightBaseOf((fixture, field) => {
  const st = useStore.getState()
  return lightBaseValue(st.lightRig, st.lightsSession, fixture, field)
})
// (the Picture colors show, and the gradient's "from the picture" : the master's colors)
setPaletteSource(() => paletteOf(lightRuntime.grid(-1), 4))

/** Now, or `ms` later (an output's delay); dropped if the lights went off meanwhile. */
function later(ms: number, fn: () => void): void {
  if (ms <= 0) { fn(); return }
  window.setTimeout(() => { if (useStore.getState().lightRig.on) fn() }, ms)
}

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

  private keepGrid(src: number, w: number, h: number, px: Uint8Array): void {
    let g = this.grids.get(src)
    if (!g || g.px.length !== px.length) { g = { w, h, px: new Uint8Array(px.length) }; this.grids.set(src, g) }
    g.px.set(px)
  }

  tick(comp: Compositor, now: number): void {
    const st = useStore.getState()
    const rig = st.lightRig
    const active = rig.fixtures.length > 0 && (rig.on || st.lightsPageOpen)
    if (!active) {
      if (this.wasActive) { comp.dropLights(); enttec.keepOnly(new Set()); this.last = null }
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
    if (st.lightFadeEpoch !== this.fadeEpoch) {
      if (this.fadeEpoch >= 0) this.engine.beginFade(L.master.fadeSec)
      this.fadeEpoch = st.lightFadeEpoch
    }
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
      aspect: st.compW / Math.max(1, st.compH),
      identify: st.lightIdentify
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
        later(o.delay, () => enttec.send(o.index, data))
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
        later(o.delay, () => {
          try { window.api.lightDmx(list) } catch { /* main not ready yet */ }
        })
      }
      this.sentTimes.push(now)
    }
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
