// Space : Sonify's voices placed in the room (shared/spatial.ts has the
// conventions and the panning). ~30 Hz from the App loop, after Sonify :
//
//   1. where each voice is : following the picture (what Sonify already reads
//      there : the sweep, the probes, the latest onsets, the Collage pieces),
//      through the dome mapping, or at a fixed place; plus its spin, the
//      venue's turn and mirror, and a glide so a jumping centroid moves softly;
//   2. one gain matrix for the worklet's second output : VBAP onto the speakers,
//      or each voice routed to its own object channels;
//   3. in objects mode, the positions over OSC (SpatGRIS `/spat/serv deg`, or
//      ADM-OSC), only what moved, and everything again every two seconds (a
//      renderer that restarts picks the scene back up).

import {
  SPACE_FX,
  SPACE_MAX_CH,
  SPACE_SOURCES,
  SPACE_VOICES,
  activeLayout,
  azElToVec,
  buildVbap,
  layoutChannels,
  pictureToDirection,
  spaceGains,
  vecToAzEl,
  wrap180,
  type SpaceConfig,
  type SpeakerLayout,
  type Vbap
} from '@shared/spatial'
import { sonifyEngine } from './sonify'
import { sendOscBatch } from '../oscMonitor'
import { useStore } from '../store'
import type { CollageSoundSet } from './collageVoice'

interface CompLike {
  collageSounds?: () => CollageSoundSet[]
  domeSpinDeg?: () => number
}

/** One placed source as the page draws it (and as the OSC carries it). */
export interface SpacePoint {
  az: number
  el: number
  width: number
  hspan: number
  vspan: number
  live: boolean // the voice is on
}

const NV = SPACE_VOICES.length
const FX_PLACE = { el: 30, width: 180, hspan: 0.5, vspan: 0.5 } // the reverb / delay : all around, overhead

class SpaceEngine {
  private lastTick = 0
  private on = false
  private vbap: Vbap | null = null
  private vbapKey = ''
  private layout: SpeakerLayout | null = null
  private gains = new Float32Array(SPACE_SOURCES * 2 * SPACE_MAX_CH)
  private sentGains = new Float32Array(SPACE_SOURCES * 2 * SPACE_MAX_CH)
  private sentKey = ''
  private tmp = new Float64Array(256)
  // smoothed directions (unit vectors) and the spin phases, per voice
  private dir = new Float64Array(NV * 3)
  private hasDir = new Uint8Array(NV)
  private spin = new Float64Array(NV)
  // the last followed picture point of each voice (a voice with nothing new
  // stays where it was)
  private pt = new Float64Array(NV * 2).fill(0.5)
  // OSC : what was sent per object (az, el, hs, vs) and when everything was
  private oscSent = new Float64Array(64 * 4).fill(NaN)
  private oscAll = 0
  /** The sources as placed now, for the page : the voices, then the FX return. */
  points: SpacePoint[] = []
  /** Why Space cannot play as set (shown on the page), or ''. */
  problem = ''
  /** Channels the current setup uses on the output. */
  channels = 0

  tick(comp: CompLike, nowMs: number): void {
    if (nowMs - this.lastTick < 33) return
    const dt = Math.min(0.2, this.lastTick ? (nowMs - this.lastTick) / 1000 : 0)
    this.lastTick = nowMs
    const st = useStore.getState()
    const cfg = st.space
    if (cfg.mode === 'stereo') {
      if (this.on) {
        sonifyEngine.setSpace({ t: 'space', on: false, nch: 0 })
        this.on = false
        this.sentKey = ''
      }
      this.problem = ''
      this.channels = 0
      return
    }
    this.place(comp, cfg, st, dt)
    if (cfg.mode === 'speakers') this.speakers(cfg)
    else this.objects(cfg, nowMs)
  }

  // ── 1. where every voice is ──
  private place(comp: CompLike, cfg: SpaceConfig, st: ReturnType<typeof useStore.getState>, dt: number): void {
    const soni = st.sonify
    const dome = st.dome?.enabled ? st.dome : null
    const aspect = st.compW / Math.max(1, st.compH)
    const spinDeg = dome ? comp.domeSpinDeg?.() ?? 0 : 0
    const flat = { width: cfg.flatWidth, low: cfg.flatLow, high: cfg.flatHigh }
    const k = cfg.glide > 0 ? 1 - Math.exp(-dt / cfg.glide) : 1
    this.follow(comp, soni)
    const pts: SpacePoint[] = []
    for (let v = 0; v < NV; v++) {
      const key = SPACE_VOICES[v]
      const pl = cfg.voices[key]
      this.spin[v] = (this.spin[v] + pl.spin * dt) % 360
      let az: number, el: number
      if (pl.follow) {
        const d = pictureToDirection(this.pt[v * 2], this.pt[v * 2 + 1], dome, aspect, spinDeg, flat)
        az = d.az + pl.az
        el = d.el
      } else {
        az = pl.az
        el = pl.el
      }
      az += this.spin[v]
      if (cfg.mirror) az = -az
      az = wrap180(az + cfg.rotate)
      // glide on the sphere (a vector, so it never swings the long way round)
      const t = azElToVec(az, el)
      const o = v * 3
      if (!this.hasDir[v] || k >= 1) { this.dir[o] = t[0]; this.dir[o + 1] = t[1]; this.dir[o + 2] = t[2]; this.hasDir[v] = 1 }
      else for (let i = 0; i < 3; i++) this.dir[o + i] += (t[i] - this.dir[o + i]) * k
      const g = vecToAzEl(this.dir[o], this.dir[o + 1], this.dir[o + 2])
      const vc = (soni as unknown as Record<string, { on?: boolean }>)[key]
      pts.push({ az: g.az, el: g.el, width: pl.width, hspan: pl.hspan, vspan: pl.vspan, live: !!soni.on && !!vc?.on })
    }
    pts.push({ az: wrap180(cfg.rotate), el: FX_PLACE.el, width: FX_PLACE.width, hspan: FX_PLACE.hspan, vspan: FX_PLACE.vspan, live: !!soni.on })
    this.points = pts
  }

  /** The picture point each voice plays from now (Sonify's convention : x right,
   *  y DOWN, 0..1). Kept when there is nothing new (no onset this frame). */
  private follow(comp: CompLike, soni: ReturnType<typeof useStore.getState>['sonify']): void {
    const lp = sonifyEngine.liveProbes
    const scan = sonifyEngine.scan
    const now = performance.now()
    const scanAt = (pos: number, hz: number): number => {
      if (!scan) return pos
      const p = pos + hz * Math.max(0, (now - scan.recv) / 1000)
      return p - Math.floor(p)
    }
    const set = (v: number, x: number, y: number): void => {
      if (Number.isFinite(x) && Number.isFinite(y)) { this.pt[v * 2] = clamp01(x); this.pt[v * 2 + 1] = clamp01(y) }
    }
    // a scanning voice : where its read point is on its path
    const path = (v: number, p: number, pos: number): void => {
      if (p === 1) set(v, 0.5, pos) // a row : across the whole width
      else if (p === 2 || p === 3) { const a = pos * Math.PI * 2; set(v, 0.5 + 0.3 * Math.cos(a), 0.5 + 0.3 * Math.sin(a)) }
      else set(v, pos, 0.5) // a column : the whole height
    }
    const sp = soni.spectra
    path(0, sp.path ?? 0, scan ? scanAt(scan.sp, scan.spHz) : lp.spectraX ?? sp.x)
    set(1, lp.orbitX ?? soni.orbit.cx, lp.orbitY ?? soni.orbit.cy)
    this.centroid(2, sonifyEngine.flowDots, 3)
    this.centroid(3, sonifyEngine.eventDots, 3)
    set(4, (lp.rasterX ?? soni.raster.rx) + (lp.rasterW ?? soni.raster.rw) / 2, (lp.rasterY ?? soni.raster.ry) + (lp.rasterH ?? soni.raster.rh) / 2)
    if (scan) set(5, 0.5, scanAt(scan.tv, scan.tvHz))
    const fi = soni.filter
    path(6, fi.path ?? 0, scan ? scanAt(scan.fi, scan.fiHz) : lp.filterX ?? fi.x)
    set(7, 0.5, 0.5)
    // Collage : the pieces it plays, weighted by how much each wall shows
    try {
      const sets = comp.collageSounds?.() ?? []
      let sx = 0, sy = 0, sw = 0
      for (const s of sets)
        for (const pc of s.pieces) {
          const w = s.level * pc.keep
          sx += pc.x * w; sy += (1 - pc.y) * w; sw += w // pieces are GL (y up)
        }
      if (sw > 1e-6) set(8, sx / sw, sy / sw)
    } catch { /* no wall */ }
    this.centroid(9, sonifyEngine.signalDots, 3)
  }

  private centroid(v: number, dots: Float32Array, stride: number): void {
    let sx = 0, sy = 0, sw = 0
    for (let i = 0; i + 2 < dots.length; i += stride) {
      const w = Math.max(0, dots[i + 2]) + 1e-3
      sx += dots[i] * w; sy += dots[i + 1] * w; sw += w
    }
    if (sw > 0) { this.pt[v * 2] = clamp01(sx / sw); this.pt[v * 2 + 1] = clamp01(sy / sw) }
  }

  // ── 2a. speakers : VBAP onto the layout ──
  private speakers(cfg: SpaceConfig): void {
    const layout = activeLayout(cfg)
    const key = cfg.layoutKey + ':' + JSON.stringify(layout.speakers)
    if (key !== this.vbapKey) {
      this.vbap = buildVbap(layout)
      this.vbapKey = key
      this.layout = layout
    }
    const vb = this.vbap!
    const first = cfg.firstChannel - 1
    const need = first + layoutChannels(layout)
    const max = sonifyEngine.outputChannels()
    this.channels = need
    if (need > SPACE_MAX_CH) {
      this.problem = `This layout needs ${need} channels; one audio output carries at most ${SPACE_MAX_CH}. Send it to SpatGRIS as objects instead.`
      return this.off()
    }
    this.problem = need > max ? `The output has ${max} channels; this layout needs ${need} (the rest are dropped).` : ''
    const g = this.gains
    g.fill(0)
    const tmp = this.tmp
    for (let s = 0; s < SPACE_SOURCES; s++) {
      const p = this.points[s]
      if (!p) continue
      for (let side = 0; side < 2; side++) {
        const az = wrap180(p.az + (side ? 1 : -1) * p.width * 0.5 * (cfg.mirror ? -1 : 1))
        spaceGains(vb, az, p.el, p.hspan, p.vspan, tmp)
        const base = (s * 2 + side) * SPACE_MAX_CH
        for (let i = 0; i < vb.speakers.length; i++) {
          const sp = vb.speakers[i]
          const ch = first + sp.id - 1
          if (ch < 0 || ch >= SPACE_MAX_CH || tmp[i] === 0) continue
          g[base + ch] += tmp[i] * Math.pow(10, sp.gainDb / 20)
        }
      }
    }
    const subs = layout.speakers.filter((sp) => sp.sub).map((sp) => first + sp.id - 1).filter((c) => c >= 0 && c < SPACE_MAX_CH)
    this.send(cfg, Math.min(need, SPACE_MAX_CH), subs)
  }

  // ── 2b. objects : each voice on its own channel(s), positions over OSC ──
  private objects(cfg: SpaceConfig, nowMs: number): void {
    const first = cfg.firstChannel - 1
    const per = cfg.pairs ? 2 : 1
    const need = first + SPACE_SOURCES * per
    const max = sonifyEngine.outputChannels()
    this.channels = need
    if (need > SPACE_MAX_CH) {
      this.problem = `${need} channels from channel ${cfg.firstChannel}; one audio output carries at most ${SPACE_MAX_CH}.`
      return this.off()
    }
    this.problem = need > max ? `The output has ${max} channels; the objects need ${need} (choose a multichannel output, such as a Dante Virtual Soundcard).` : ''
    const g = this.gains
    g.fill(0)
    for (let s = 0; s < SPACE_SOURCES; s++) {
      const bL = (s * 2) * SPACE_MAX_CH, bR = (s * 2 + 1) * SPACE_MAX_CH
      if (cfg.pairs) {
        g[bL + first + s * 2] = 1
        g[bR + first + s * 2 + 1] = 1
      } else {
        g[bL + first + s] = Math.SQRT1_2
        g[bR + first + s] = Math.SQRT1_2
      }
    }
    this.send(cfg, need, [])
    this.sendOsc(cfg, nowMs)
  }

  /** The source number (SpatGRIS) / object number (ADM) and direction of each
   *  object channel. */
  objectList(cfg: SpaceConfig): Array<{ id: number; az: number; el: number; hspan: number; vspan: number; label: string }> {
    const out: Array<{ id: number; az: number; el: number; hspan: number; vspan: number; label: string }> = []
    for (let s = 0; s < SPACE_SOURCES; s++) {
      const p = this.points[s]
      if (!p) continue
      const name = s === SPACE_FX ? 'FX' : SPACE_VOICES[s]
      if (cfg.pairs) {
        const h = p.width * 0.5 * (cfg.mirror ? -1 : 1)
        out.push({ id: cfg.firstSource + s * 2, az: wrap180(p.az - h), el: p.el, hspan: p.hspan, vspan: p.vspan, label: name + ' L' })
        out.push({ id: cfg.firstSource + s * 2 + 1, az: wrap180(p.az + h), el: p.el, hspan: p.hspan, vspan: p.vspan, label: name + ' R' })
      } else {
        out.push({ id: cfg.firstSource + s, az: p.az, el: p.el, hspan: Math.min(1, p.hspan + p.width / 360), vspan: p.vspan, label: name })
      }
    }
    return out
  }

  private sendOsc(cfg: SpaceConfig, nowMs: number): void {
    if (!cfg.host) return
    const all = nowMs - this.oscAll > 2000
    if (all) this.oscAll = nowMs
    const msgs: Array<{ address: string; args: Array<{ type: string; value: number | string }> }> = []
    const objs = this.objectList(cfg)
    objs.forEach((o, i) => {
      const k = i * 4
      const moved =
        !(Math.abs(wrap180(o.az - this.oscSent[k])) < 0.2) || !(Math.abs(o.el - this.oscSent[k + 1]) < 0.2) ||
        !(Math.abs(o.hspan - this.oscSent[k + 2]) < 0.002) || !(Math.abs(o.vspan - this.oscSent[k + 3]) < 0.002)
      if (!all && !moved) return
      this.oscSent[k] = o.az; this.oscSent[k + 1] = o.el; this.oscSent[k + 2] = o.hspan; this.oscSent[k + 3] = o.vspan
      if (cfg.protocol === 'spatgris') {
        // /spat/serv deg <source> <azimuth, clockwise> <elevation> <radius> <h-span> <v-span>
        msgs.push({ address: '/spat/serv', args: [
          { type: 's', value: 'deg' }, { type: 'i', value: o.id },
          { type: 'f', value: o.az }, { type: 'f', value: Math.max(0, o.el) }, { type: 'f', value: 1 },
          { type: 'f', value: o.hspan }, { type: 'f', value: o.vspan }
        ] })
      } else {
        // ADM-OSC : azimuth counter-clockwise (positive to the LEFT), elevation, distance 0..1
        msgs.push({ address: `/adm/obj/${o.id}/aed`, args: [{ type: 'f', value: wrap180(-o.az) }, { type: 'f', value: o.el }, { type: 'f', value: 1 }] })
        msgs.push({ address: `/adm/obj/${o.id}/w`, args: [{ type: 'f', value: Math.min(1, Math.max(o.hspan, o.vspan)) }] })
      }
    })
    if (msgs.length) sendOscBatch(cfg.host, cfg.port, msgs)
  }

  /** Ship the matrix when it changed (or the setup did). */
  private send(cfg: SpaceConfig, nch: number, subs: number[]): void {
    const key = `${cfg.mode}:${nch}:${subs.join(',')}:${cfg.subLevel}:${cfg.subXover}`
    let changed = key !== this.sentKey
    if (!changed) {
      const a = this.gains, b = this.sentGains
      for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-3) { changed = true; break }
    }
    if (!changed) return
    this.sentKey = key
    this.sentGains.set(this.gains)
    sonifyEngine.setSpace({ t: 'space', on: true, nch, gains: new Float32Array(this.gains), subs, subGain: cfg.subLevel, xover: cfg.subXover })
    this.on = true
  }

  private off(): void {
    if (this.on) sonifyEngine.setSpace({ t: 'space', on: false, nch: 0 })
    this.on = false
    this.sentKey = ''
  }

  /** The layout the speakers mode is using now (for the page's map). */
  currentLayout(): SpeakerLayout | null {
    return this.layout
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

export const spaceEngine = new SpaceEngine()
