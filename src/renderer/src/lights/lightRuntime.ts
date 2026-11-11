// The Lights at run time : called from the render loop every frame. It collects
// the light readback the frame it lands (so its slots free up), and at the rig's
// fps it queues the next one, runs the engine and sends : the Enttec Pros from
// here (Web Serial), the network universes through main. While the page is open
// it runs even with the output off, so the fixtures show what they would send.

import type { Compositor } from '../engine/Compositor'
import { useStore } from '../store'
import { audioBus } from '../engine/audioIn'
import { soniBeats } from '../audio/soniClock'
import { LightEngine, type LightFrame, type LightGrid } from './lightEngine'
import { enttec } from './enttec'
import type { LightTune } from '@shared/lights'
import { setLightBaseOf } from './lightMods'
import { lightBaseValue } from './lightStore'

setLightBaseOf((fixture, field) => {
  const st = useStore.getState()
  return lightBaseValue(st.lightRig, st.lightsSession, fixture, field)
})

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
    // the sources in use : the master, the layers the looks read
    const L = st.lightsSession
    const srcs = new Set<number>()
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
      for (const [index, data] of frame.enttec) { enttec.send(index, data); used.add(index) }
      if (frame.net.length) {
        try { window.api.lightDmx(frame.net) } catch { /* main not ready yet */ }
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
