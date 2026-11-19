// The audio tab's monitoring : what comes in (one meter per channel picked, in
// dBFS, a held peak, a clip light, a status word), what the modulators hear (the
// level, the change and the hits, and a live spectrum with the six bands as
// shaded zones) and what goes out (a meter beside each output fader, then the
// output's own channels and the limiter light). Read off the engines and drawn
// outside React : ONE requestAnimationFrame for the whole tab, direct style
// writes and one small canvas, running only while the tab shows (and the window
// is not covered by a full page). Engines : engine/audioIn.ts (the input, its
// picked channels, the monitor), audio/audioLayer.ts (its two sides),
// audio/sonify.ts (its voices, the limiter, what leaves after the output EQ).

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { audioBus, AUDIO_BANDS, bandEdgesHz } from '../engine/audioIn'
import { audioLayer } from '../audio/audioLayer'
import { sonifyEngine } from '../audio/sonify'
import { spaceEngine } from '../audio/space'
import { CH_DEFAULT, clampPick, pickFits, type ChPick } from '../audio/channelPick'
import { useStore } from '../store'
import { sonifyCovered, themeVar } from './sonifyUi'
import { effectiveZoom } from './uiZoom'

// ═══════════════════════════════════════════════════════════════════════════
// TUNE HERE : every size, color, dB range and refresh rate of the audio tab's
// monitoring, in one place. The dB scale, the colors and the ballistics are the
// Sonify page's output meter's (SonifyPage.tsx, METER_*) : change both together
// to keep them alike.
// ═══════════════════════════════════════════════════════════════════════════
export const MON = {
  // ── the dB scale (every meter : the input, the faders, the output) ──
  dbFloor: -54, // dB at a meter's left edge (0 dBFS at its right)
  dbLines: [-36, -18, -6], // the faint lines across a meter
  hotDb: -9, // the bar turns yellow above this (RMS)
  peakRedDb: -1.5, // the peak tick turns orange above this
  // ── ballistics ──
  fallDbPerS: 24, // how fast a bar and a released peak fall
  peakHoldS: 1.2, // how long a peak tick stays before it falls
  // ── the input ──
  clipDb: -0.1, // a sample at or over this lights the clip light (dBFS)
  clipHoldS: 1.5, // the clip light stays this long after the last clip
  silentDb: -60, // under this for silentAfterS, the status reads "silent"
  silentAfterS: 3,
  // ── the output ──
  limHoldS: 0.4, // the limiter light stays this long after it last worked
  // ── colors (the Sonify meter's) ──
  colLow: 'rgb(120,200,140)', // a bar under hotDb
  colHot: 'rgb(214,196,90)', // a bar over hotDb
  colOver: 'rgb(230,120,60)', // the limiter working, a peak over peakRedDb, a clip
  colTick: 'rgb(230,230,230)', // the peak tick
  colSignal: 'rgb(120,200,140)', // the status word and the top bar dot : signal
  colSilent: 'rgb(130,130,140)', // … silent
  colGone: 'rgb(225,85,70)', // … no device / gone
  // ── sizes (CSS pixels, before the UI zoom) ──
  inMeterH: 9, // an input channel's meter
  faderMeterW: 52, // the meter beside an output fader
  faderMeterH: 6,
  outMeterH: 7, // an output channel's meter
  featBarW: 40, // the level / change bars of "what the modulators hear"
  featBarH: 6,
  spectrumH: 58, // the spectrum's height
  spaceBarW: 4, // one Space channel's bar
  spaceBarH: 14,
  // ── refresh ──
  // Measured on the RTX 4070 test copy (1080p picture, the section open vs folded) :
  // 60 / 60 cost +0.69 ms of main thread a frame, 30 / 30 +0.44 ms (fps 60 both).
  paintFps: 30, // the meters' frame rate (every bar, light and word); the spectrum has its own below
  // ── the spectrum ──
  specLoHz: 20, // the axis (log) : 20 Hz to 20 kHz
  specHiHz: 20000,
  specFps: 30, // the spectrum's frame rate (at most paintFps) : 0.12-0.18 ms a draw measured
  specMaxScale: 2, // device pixels per CSS pixel at most (sharp, and bounded on a 4K screen)
  specDbLo: -100, // the spectrum's floor and top (dB, the analyser's own scale : a
  specDbHi: -10, //   full-scale sine reads about -14 here, a -12 dBFS one about -27)
  specFill: 0.3, // the spectrum's fill opacity (the accent)
  specLine: 0.95, // its outline's
  zoneA: 0.05, // the band zones' shading, alternating
  zoneB: 0.11,
  bandFill: 0.2, // each band's energy, a block in its zone (the accent2)
  bracketFill: 0.16, // the HZ band of the audio modulator under the pointer (the accent2)
  bracketFadeS: 1.2, // it fades this long after the pointer left the HZ row
  // ── the band names (low to high) ──
  bandNames: ['sub', 'bass', 'low-mid', 'mid', 'presence', 'air'],
  // ── the top bar's input dot ──
  dotHz: 4 // how often it checks the input (it runs with the tab closed too)
}
// ═══════════════════════════════════════════════════════════════════════════

const dbOf = (x: number): number => (x > 1e-6 ? 20 * Math.log10(x) : -120)
const linOf = (db: number): number => Math.pow(10, db / 20)
const meterX = (db: number): number => Math.max(0, Math.min(1, (db - MON.dbFloor) / -MON.dbFloor))
type Level = { rms: number; peak: number }
const SILENCE: Level = { rms: 0, peak: 0 }

// ── The tab's one loop ───────────────────────────────────────────────────
type Painter = (now: number, dt: number) => void
const painters = new Set<Painter>()
let raf = 0
let lastAt = 0
// test builds read the cost : frames painted, ms spent painting (all), ms in the spectrum
export const monStats = { cfg: MON, frames: 0, ms: 0, specFrames: 0, specMs: 0, reset(): void { this.frames = 0; this.ms = 0; this.specFrames = 0; this.specMs = 0 } }
function frame(now: number): void {
  raf = 0
  if (!painters.size) return
  // (at the display's rate, or slower : a frame skipped costs nothing)
  if (lastAt && now - lastAt < 1000 / MON.paintFps - 2) { raf = requestAnimationFrame(frame); return }
  const dt = lastAt ? Math.min(0.25, (now - lastAt) / 1000) : 1 / 60
  lastAt = now
  // a full page over the window (World, Sequencer…) : nothing to show, nothing drawn
  if (!sonifyCovered()) {
    const t0 = performance.now()
    for (const p of painters) p(now, dt)
    monStats.frames++
    monStats.ms += performance.now() - t0
  }
  raf = requestAnimationFrame(frame)
}
/** Paint every frame while the component shows (all painters share one rAF). */
function usePaint(fn: Painter): void {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    const p: Painter = (now, dt) => ref.current(now, dt)
    painters.add(p)
    if (!raf) { lastAt = 0; raf = requestAnimationFrame(frame) }
    return () => {
      painters.delete(p)
      if (!painters.size && raf) { cancelAnimationFrame(raf); raf = 0 }
    }
  }, [])
}

// ── One meter : a bar (RMS), a peak tick, the dB lines ───────────────────
interface Ballistic { rms: number; pk: number; held: number }
const newBallistic = (): Ballistic => ({ rms: -120, pk: -120, held: 0 })
function step(b: Ballistic, l: Level, dt: number): void {
  const rms = dbOf(l.rms), pk = dbOf(l.peak)
  b.rms = rms >= b.rms ? rms : Math.max(rms, b.rms - MON.fallDbPerS * dt)
  if (pk >= b.pk) { b.pk = pk; b.held = MON.peakHoldS }
  else if ((b.held -= dt) <= 0) b.pk = Math.max(pk, b.pk - MON.fallDbPerS * dt)
}
// what each meter shows now : a frame that changes nothing writes nothing (the
// silent meters, the held ticks), so the page has nothing to restyle
const shownBar = new WeakMap<HTMLElement, string>()
function paintBar(el: HTMLElement | null, b: Ballistic, over = false): void {
  if (!el) return
  const w = (meterX(b.rms) * 100).toFixed(1), bg = over ? MON.colOver : b.rms > MON.hotDb ? MON.colHot : MON.colLow
  const x = (meterX(b.pk) * 100).toFixed(1), on = b.pk > MON.dbFloor, tc = b.pk > MON.peakRedDb ? MON.colOver : MON.colTick
  const key = `${w}|${bg}|${on ? x : '-'}|${tc}`
  if (shownBar.get(el) === key) return
  shownBar.set(el, key)
  const bar = el.firstElementChild as HTMLElement | null
  const tick = bar?.nextElementSibling as HTMLElement | null
  if (bar) {
    bar.style.width = `${w}%`
    bar.style.background = bg
  }
  if (tick) {
    tick.style.left = `calc(${x}% - 1px)`
    tick.style.opacity = on ? '1' : '0'
    tick.style.background = tc
  }
}
/** Set a text only when it changed. */
function setText(el: HTMLElement | null | undefined, t: string): void {
  if (el && el.textContent !== t) el.textContent = t
}
const dbText = (b: Ballistic): string => (b.pk > MON.dbFloor ? `${b.pk >= 0.5 ? '+' : ''}${b.pk.toFixed(0)} dB` : '-∞')

/** A meter's box : the bar, then the tick, then the dB lines (paintBar reads
 *  them in that order). */
function MeterBox({ boxRef, w, h, title, className = '' }: { boxRef: (el: HTMLDivElement | null) => void; w?: number; h: number; title?: string; className?: string }): JSX.Element {
  return (
    <div ref={boxRef} title={title} className={`relative shrink-0 overflow-hidden rounded-sm bg-panel3 ${className}`} style={{ height: h, width: w }}>
      <div className="absolute inset-y-0 left-0 w-0" />
      <div className="absolute inset-y-0 w-[2px] opacity-0" />
      {MON.dbLines.map((db) => (
        <div key={db} className="pointer-events-none absolute inset-y-0 w-px bg-black/50" style={{ left: `${(meterX(db) * 100).toFixed(1)}%` }} />
      ))}
    </div>
  )
}

/** A value only an engine knows, read every `ms` while shown. */
export function usePolled<T>(read: () => T, ms: number): T {
  const [v, setV] = useState(read)
  const ref = useRef(read)
  ref.current = read
  useEffect(() => {
    const id = window.setInterval(() => setV(ref.current()), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return v
}

// ── The input : what it listens to, its channels' levels, its status ─────
/** The input's meters now : one per channel heard (IN n, counted from 1), the
 *  Audio Layer's two sides, or none. */
interface InRow { label: string; title: string; read: () => Level }
function inputRows(): InRow[] {
  if (audioBus.fromLayer) {
    return [0, 1].map((i) => ({
      label: i ? 'LAYER R' : 'LAYER L',
      title: `The Audio Layer's ${i ? 'right' : 'left'} side (its whole sound, after its volume and mute) : the input the modulators hear, no device opened.`,
      read: () => audioLayer.sideLevel(i)
    }))
  }
  return audioBus.heardChannels().map((ch, i) => ({
    label: `IN ${ch + 1}`,
    title: `The input device's channel ${ch + 1}, as it arrives (before the USB denoise) : the bar is the average (RMS) level, the tick the peak, on a dB scale from ${MON.dbFloor} to 0 dBFS. The light at the right lights red when a sample reaches full scale (the input clips : turn it down at the source or the interface).`,
    read: () => audioBus.channelLevel(i) ?? SILENCE
  }))
}
const rowsKey = (): string => `${audioBus.fromLayer ? 'L' : ''}|${audioBus.heardChannels().join(',')}`

export type InStatus = 'off' | 'osc' | 'no-osc' | 'gone' | 'no-device' | 'signal' | 'silent'
// the last time the input was over the silence line (shared by the tab and the top bar dot)
let loudAt = -1e9
let lastPeak = 0
let lastPeakAt = -1e9
/** Feed the input's loudest peak this frame (the input meters do, every frame). */
function notePeak(pk: number, now: number): void {
  lastPeak = pk
  lastPeakAt = now
  if (pk > linOf(MON.silentDb)) loudAt = now
}
/** What the input is doing now, in one word. */
export function inputStatus(now: number): InStatus {
  const s = useStore.getState()
  if (!s.audioEnabled) return 'off'
  if (s.audioSource === 'osc') return audioBus.oscFresh ? 'osc' : 'no-osc'
  if (audioBus.inputLost) return 'gone'
  if (!audioBus.localActive) return s.audioSource === 'both' && audioBus.oscFresh ? 'osc' : 'no-device'
  // nothing read it this frame (the tab closed) : read it here
  if (now - lastPeakAt > 100) {
    let pk = 0
    for (const r of inputRows()) pk = Math.max(pk, r.read().peak)
    notePeak(pk, now)
  }
  return now - loudAt < MON.silentAfterS * 1000 ? 'signal' : 'silent'
}
const STATUS_WORD: Record<InStatus, string> = {
  off: 'not listening', osc: 'OSC', 'no-osc': 'no OSC', gone: 'gone', 'no-device': 'no device', signal: 'signal', silent: 'silent'
}
const STATUS_HINT: Record<InStatus, string> = {
  off: 'The input analysis is off : click the dot beside Audio to listen.',
  osc: 'The features come from OSC (/opsia/audio/*) : no device is opened, so there is no channel to meter.',
  'no-osc': 'Listening to OSC only, and nothing has arrived in the last half second.',
  gone: 'The input device was unplugged : it opens again by itself when it comes back.',
  'no-device': 'No input is open (the device would not open, or it is opening).',
  signal: `Sound is coming in (over ${MON.silentDb} dBFS in the last ${MON.silentAfterS} s).`,
  silent: `The input is open but quiet : under ${MON.silentDb} dBFS for ${MON.silentAfterS} s or more (check the cable, the channels picked, the level at the source).`
}
const statusColor = (st: InStatus): string =>
  st === 'signal' || st === 'osc' ? MON.colSignal : st === 'gone' || st === 'no-device' ? MON.colGone : MON.colSilent

/** The status word beside the input's menus : ● signal / silent / no device… */
export function InputStatus(): JSX.Element {
  const dot = useRef<HTMLSpanElement>(null)
  const word = useRef<HTMLSpanElement>(null)
  const box = useRef<HTMLSpanElement>(null)
  const shown = useRef<InStatus | null>(null)
  usePaint((now) => {
    const st = inputStatus(now)
    if (st === shown.current) return
    shown.current = st
    const c = statusColor(st)
    if (dot.current) dot.current.style.background = c
    if (word.current) { word.current.textContent = STATUS_WORD[st]; word.current.style.color = c }
    if (box.current) box.current.title = STATUS_HINT[st]
  })
  return (
    <span ref={box} className="flex shrink-0 items-center gap-1">
      <span ref={dot} className="h-2 w-2 rounded-full" style={{ background: MON.colSilent }} />
      <span ref={word} className="w-[68px] truncate font-mono text-[9px]" style={{ color: MON.colSilent }}>…</span>
    </span>
  )
}

/** One meter per channel the input hears, labelled with the device's real
 *  channel numbers, its dB and its clip light. */
export function InputMeters(): JSX.Element {
  const key = usePolled(rowsKey, 400)
  const [rows, setRows] = useState<InRow[]>(inputRows)
  useEffect(() => setRows(inputRows()), [key])
  const boxes = useRef<Array<HTMLDivElement | null>>([])
  const dbs = useRef<Array<HTMLSpanElement | null>>([])
  const clips = useRef<Array<HTMLSpanElement | null>>([])
  const st = useRef<Array<Ballistic & { clipT: number }>>([])
  usePaint((now, dt) => {
    let loud = 0
    rows.forEach((r, i) => {
      const s = (st.current[i] ??= { ...newBallistic(), clipT: 0 })
      const l = r.read()
      if (l.peak > loud) loud = l.peak
      step(s, l, dt)
      paintBar(boxes.current[i], s)
      setText(dbs.current[i], dbText(s))
      if (l.peak >= linOf(MON.clipDb)) s.clipT = MON.clipHoldS
      else s.clipT = Math.max(0, s.clipT - dt)
      const c = clips.current[i]
      const cb = s.clipT > 0 ? MON.colOver : ''
      if (c && c.style.background !== cb) c.style.background = cb
    })
    if (rows.length) notePeak(loud, now)
  })
  if (!rows.length) {
    return (
      <div className="flex items-center gap-2 pl-[52px] font-mono text-[9px] text-muted/70" title="The channels show once the input is open">
        no channel open
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-[3px]">
      {rows.map((r, i) => (
        <div key={r.label} className="flex min-w-0 items-center gap-1.5" title={r.title}>
          <span className="w-[46px] shrink-0 text-right font-mono text-[9px] text-text">{r.label}</span>
          <MeterBox h={MON.inMeterH} className="min-w-0 flex-1" boxRef={(el) => (boxes.current[i] = el)} />
          <span ref={(el) => (dbs.current[i] = el)} className="w-[38px] shrink-0 text-right font-mono text-[9px] tabular-nums text-muted">-∞</span>
          <span
            ref={(el) => (clips.current[i] = el)}
            className="h-[9px] w-[9px] shrink-0 rounded-sm border border-border"
            title={`Clip : lights red for ${MON.clipHoldS} s when a sample reaches ${MON.clipDb} dBFS (full scale)`}
          />
        </div>
      ))}
    </div>
  )
}

// ── What the modulators hear : level, change, hit, and the spectrum ──────
// The HZ band of the audio modulator under the pointer (ModulationPanel's HZ
// row writes it), drawn as a bracket on the spectrum.
let hzFocus: { lo: number; hi: number; at: number; live: boolean } | null = null
/** The HZ row under the pointer (or being dragged) : its band; null : it left. */
export function setHzFocus(band: { lo: number; hi: number } | null): void {
  if (band) hzFocus = { lo: band.lo, hi: band.hi, at: performance.now(), live: true }
  else if (hzFocus) hzFocus = { ...hzFocus, at: performance.now(), live: false }
}

const logX = (hz: number): number =>
  Math.max(0, Math.min(1, Math.log(Math.max(1, hz) / MON.specLoHz) / Math.log(MON.specHiHz / MON.specLoHz)))
const hzAt = (x: number): number => MON.specLoHz * Math.pow(MON.specHiHz / MON.specLoHz, x)
const fmtHz = (hz: number): string => {
  if (hz < 1000) return String(Math.round(hz))
  const k = hz / 1000
  return `${(k < 10 ? k.toFixed(1) : k.toFixed(0)).replace(/\.0$/, '')}k`
}
const rgb = (name: string, fallback: string): string => themeVar(name, fallback).replace(/\s+/g, ',')

/** Where the modulators' sound comes from right now, in a few words. */
function hearsFrom(): string {
  const s = useStore.getState()
  if (!s.audioEnabled || s.audioSource === 'local' || (s.audioSource === 'both' && !audioBus.oscFresh)) {
    if (!s.audioEnabled) return 'nothing'
    return audioBus.fromLayer ? 'Audio Layer' : audioBus.localActive ? 'input' : 'nothing'
  }
  return 'OSC'
}

export function HearBlock(): JSX.Element {
  const levelRef = useRef<HTMLSpanElement>(null)
  const fluxRef = useRef<HTMLSpanElement>(null)
  const hitRef = useRef<HTMLSpanElement>(null)
  const fromRef = useRef<HTMLSpanElement>(null)
  const noSpecRef = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const sr = usePolled(() => Math.round(audioBus.sampleRateHz()), 1000)
  const edges = bandEdgesHz(sr || 48000)
  // the canvas : its size in device pixels, a column → bins table for it, and
  // whether it is on screen at all
  const geo = useRef<{ w: number; h: number; scale: number; sr: number; bins: number; i0: Int32Array; i1: Int32Array; fr: Float32Array } | null>(null)
  const visible = useRef(true)
  const lastSpec = useRef(0)
  const lastFrom = useRef('')
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const fit = (): void => {
      const z = effectiveZoom(c)
      const scale = Math.min(MON.specMaxScale, (window.devicePixelRatio || 1) * z)
      const w = Math.max(1, Math.round(c.clientWidth * scale)), h = Math.max(1, Math.round(c.clientHeight * scale))
      if (c.width !== w) c.width = w
      if (c.height !== h) c.height = h
      geo.current = null // the bins table follows on the next draw
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(c)
    const io = new IntersectionObserver((es) => { visible.current = es.some((e) => e.isIntersecting) })
    io.observe(c)
    return () => { ro.disconnect(); io.disconnect() }
  }, [])

  usePaint((now) => {
    const c = audioBus.current
    const set = (el: HTMLElement | null, prop: 'width' | 'opacity', v: string): void => { if (el && el.style[prop] !== v) el.style[prop] = v }
    set(levelRef.current, 'width', `${(Math.min(1, c.level) * 100).toFixed(1)}%`)
    set(fluxRef.current, 'width', `${(Math.min(1, c.flux) * 100).toFixed(1)}%`)
    set(hitRef.current, 'opacity', `${Math.min(1, c.transient).toFixed(2)}`)
    const from = hearsFrom()
    if (from !== lastFrom.current && fromRef.current) { lastFrom.current = from; fromRef.current.textContent = `from ${from}` }
    // the spectrum : at its own rate, only while on screen
    const cv = canvas.current
    if (!cv || !visible.current || now - lastSpec.current < 1000 / MON.specFps - 2) return
    lastSpec.current = now
    const t0 = performance.now()
    drawSpectrum(cv)
    monStats.specFrames++
    monStats.specMs += performance.now() - t0
  })

  function drawSpectrum(cv: HTMLCanvasElement): void {
    const g = cv.getContext('2d')
    if (!g) return
    const W = cv.width, H = cv.height
    const freq = useStore.getState().audioSource === 'osc' ? null : audioBus.spectrumDb()
    const rate = audioBus.sampleRateHz() || 48000
    const accent = rgb('--c-accent', '214 160 70'), accent2 = rgb('--c-accent2', '120 170 230'), muted = rgb('--c-muted', '130 130 140')
    g.clearRect(0, 0, W, H)
    // the six bands : shaded zones, each with its energy (what a `band` modulator reads)
    const ed = bandEdgesHz(rate)
    const bands = audioBus.current.bands
    for (let b = 0; b < AUDIO_BANDS; b++) {
      const x0 = logX(ed[b][0]) * W, x1 = logX(ed[b][1]) * W
      g.fillStyle = `rgba(${muted},${b % 2 ? MON.zoneB : MON.zoneA})`
      g.fillRect(x0, 0, x1 - x0, H)
      const e = Math.min(1, bands[b] ?? 0)
      g.fillStyle = `rgba(${accent2},${MON.bandFill})`
      g.fillRect(x0, H - e * H, x1 - x0, e * H)
      g.fillStyle = `rgba(${muted},0.45)`
      g.fillRect(Math.round(x0), 0, 1, H)
    }
    // the live spectrum, log frequency, from the bus's own analyser
    if (noSpecRef.current && noSpecRef.current.style.opacity !== (freq ? '0' : '1')) noSpecRef.current.style.opacity = freq ? '0' : '1'
    if (freq) {
      const N = freq.length
      let gm = geo.current
      if (!gm || gm.w !== W || gm.sr !== rate || gm.bins !== N) {
        // per column : the bins it covers (several : their max), or where it falls
        // between two (the lows : a bin spans several columns, interpolated)
        const binHz = rate / (2 * N)
        const i0 = new Int32Array(W), i1 = new Int32Array(W), fr = new Float32Array(W)
        for (let x = 0; x < W; x++) {
          const fa = hzAt(x / W) / binHz, fb = hzAt((x + 1) / W) / binHz
          i0[x] = Math.min(N - 1, Math.floor(fa))
          i1[x] = Math.min(N, Math.max(i0[x] + 1, Math.ceil(fb)))
          fr[x] = fb - fa < 1 ? (fa + fb) / 2 - Math.floor((fa + fb) / 2) : -1
        }
        gm = geo.current = { w: W, h: H, scale: 1, sr: rate, bins: N, i0, i1, fr }
      }
      const lo = MON.specDbLo, k = 1 / (MON.specDbHi - MON.specDbLo)
      g.beginPath()
      g.moveTo(0, H)
      for (let x = 0; x < W; x++) {
        let v: number
        const f = gm.fr[x]
        if (f >= 0) {
          const a = gm.i0[x]
          v = freq[a] + (freq[Math.min(N - 1, a + 1)] - freq[a]) * f
        } else {
          v = -1e9
          for (let i = gm.i0[x]; i < gm.i1[x]; i++) if (freq[i] > v) v = freq[i]
        }
        const y = (v - lo) * k
        g.lineTo(x, H - (y > 1 ? 1 : y > 0 ? y : 0) * H)
      }
      g.lineTo(W, H)
      g.closePath()
      g.fillStyle = `rgba(${accent},${MON.specFill})`
      g.fill()
      g.strokeStyle = `rgba(${accent},${MON.specLine})`
      g.lineWidth = Math.max(1, W / 400)
      g.stroke()
    }
    // the HZ band of the audio modulator under the pointer : a bracket
    const hf = hzFocus
    if (hf) {
      const age = (performance.now() - hf.at) / 1000
      const a = hf.live ? 1 : Math.max(0, 1 - age / MON.bracketFadeS)
      if (a <= 0) hzFocus = null
      else {
        const x0 = logX(Math.max(MON.specLoHz, hf.lo)) * W, x1 = logX(Math.max(MON.specLoHz, hf.hi)) * W
        g.fillStyle = `rgba(${accent2},${MON.bracketFill * a})`
        g.fillRect(x0, 0, Math.max(1, x1 - x0), H)
        g.strokeStyle = `rgba(${accent2},${a})`
        g.lineWidth = Math.max(1, W / 300)
        const k = Math.max(3, W / 80)
        g.beginPath()
        g.moveTo(x0 + k, 1); g.lineTo(x0 + 1, 1); g.lineTo(x0 + 1, H - 1); g.lineTo(x0 + k, H - 1)
        g.moveTo(x1 - k, 1); g.lineTo(x1 - 1, 1); g.lineTo(x1 - 1, H - 1); g.lineTo(x1 - k, H - 1)
        g.stroke()
        g.fillStyle = `rgba(${accent2},${a})`
        g.font = `${Math.round(H / 5.5)}px ui-monospace, monospace`
        g.textAlign = x1 > W * 0.8 ? 'right' : 'left'
        g.fillText(`HZ ${fmtHz(hf.lo)}–${fmtHz(hf.hi)}`, x1 > W * 0.8 ? x0 - k : x1 + k, H / 4)
      }
    }
  }

  const feat = (label: string, r: RefObject<HTMLSpanElement>, title: string): JSX.Element => (
    <span className="flex shrink-0 items-center gap-1" title={title}>
      <span className="font-mono text-[9px] uppercase text-muted">{label}</span>
      <span className="relative shrink-0 overflow-hidden rounded-sm bg-panel3" style={{ width: MON.featBarW, height: MON.featBarH }}>
        <span ref={r} className="absolute inset-y-0 left-0 block bg-accent/80" style={{ width: '0%' }} />
      </span>
    </span>
  )
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        {feat('level', levelRef, 'level : how loud the sound is (its RMS, 0 to 1) : what an audio modulator on "level" follows')}
        {feat('change', fluxRef, 'change : how much the spectrum moved since the last frame (the spectral flux) : what "flux" follows; it jumps on every new note or hit')}
        <span className="flex shrink-0 items-center gap-1" title='hit : a sudden change (an onset : a drum hit, a pluck) flashes it, then it fades : what "transient" follows'>
          <span className="font-mono text-[9px] uppercase text-muted">hit</span>
          <span ref={hitRef} className="h-2 w-2 rounded-full bg-accent" style={{ opacity: 0 }} />
        </span>
        <span ref={fromRef} className="ml-auto min-w-0 truncate font-mono text-[9px] text-muted" title="Where the sound the modulators hear comes from now (in Both, OSC while it arrives, else the input)" />
      </div>
      <div ref={wrap} className="relative min-w-0">
        <canvas
          ref={canvas}
          className="block w-full rounded-sm bg-panel3/40"
          style={{ height: MON.spectrumH }}
          title={`The live spectrum the modulators hear, ${MON.specLoHz} Hz to ${MON.specHiHz / 1000} kHz on a log scale, ${MON.specDbLo} to ${MON.specDbHi} dB bottom to top. The shaded zones are the six bands a "band" modulator reads, each filled to its level; hover an audio modulator's HZ row to see its band here.`}
        />
        <div ref={noSpecRef} className="pointer-events-none absolute inset-0 flex items-center justify-center font-mono text-[9px] text-muted" style={{ opacity: 0 }}>
          no spectrum : OSC sends the bands only
        </div>
      </div>
      {/* the bands' names and their Hz, under their zones */}
      <div className="relative h-[20px] min-w-0">
        {edges.map(([lo, hi], b) => {
          const x0 = logX(lo), x1 = logX(Math.min(hi, MON.specHiHz))
          const top = b === AUDIO_BANDS - 1
          return (
            <div
              key={b}
              className="absolute top-0 overflow-hidden text-center font-mono leading-[10px]"
              style={{ left: `${x0 * 100}%`, width: `${(x1 - x0) * 100}%` }}
              title={`Band ${b + 1}, ${MON.bandNames[b]} : ${Math.round(lo)} to ${Math.round(hi)} Hz (at ${(sr / 1000).toFixed(1)} kHz)`}
            >
              <div className="truncate text-[8px] uppercase text-text/80">{MON.bandNames[b]}</div>
              <div className="truncate text-[8px] tabular-nums text-muted">{top ? `${fmtHz(lo)}+` : `${fmtHz(lo)}–${fmtHz(hi)}`}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── The output : a meter beside each fader, the output's channels ────────
type FaderSource = 'sonify' | 'layer' | 'monitor'
const faderLevel = (k: FaderSource): Level => {
  if (k === 'sonify') return sonifyEngine.isRunning() ? sonifyEngine.meterVoices : SILENCE
  if (k === 'layer') {
    const a = audioLayer.sideLevel(0), b = audioLayer.sideLevel(1)
    return { rms: Math.max(a.rms, b.rms), peak: Math.max(a.peak, b.peak) } // (the louder side, like the monitor's)
  }
  return audioBus.monitorLevelNow()
}
const FADER_HINT: Record<FaderSource, string> = {
  sonify: "Sonify's own voices, after its master and before the Audio Layer joins and the limiter",
  layer: 'The Audio Layer, after its volume and mute',
  monitor: 'What the input monitor plays, after its level (silent while it is off)'
}
/** The small meter beside an output fader. */
export function FaderMeter({ source }: { source: FaderSource }): JSX.Element {
  const box = useRef<HTMLDivElement | null>(null)
  const b = useRef(newBallistic())
  usePaint((_now, dt) => {
    step(b.current, faderLevel(source), dt)
    paintBar(box.current, b.current)
  })
  return (
    <MeterBox
      w={MON.faderMeterW} h={MON.faderMeterH} boxRef={(el) => (box.current = el)}
      title={`${FADER_HINT[source]} : the bar is the average (RMS) level, the tick the peak, ${MON.dbFloor} to 0 dBFS.`}
    />
  )
}

/** What leaves for the output device, on its real channels : OUT n (the
 *  output's pair or its one channel), after the output EQ and glue; with Space
 *  on, every channel Space drives. And the limiter light. */
export function OutputMeters({ pick, n }: { pick: ChPick; n: number }): JSX.Element {
  const spaceOn = useStore((s) => s.space.mode !== 'stereo')
  const first = useStore((s) => s.space.firstChannel)
  const last = usePolled(() => spaceEngine.channels, 500)
  // (a pick the device does not have plays 1+2 : the meters say which)
  const eff = pickFits(pick, n) ? pick : CH_DEFAULT
  const [l, r] = clampPick(eff, n)
  const mono = eff.r < 0 || l === r
  const chans = mono ? [l] : [l, r]
  const boxes = useRef<Array<HTMLDivElement | null>>([])
  const dbs = useRef<Array<HTMLSpanElement | null>>([])
  const st = useRef<Ballistic[]>([])
  const lim = useRef<HTMLSpanElement>(null)
  const limT = useRef(0)
  const spaceBars = useRef<Array<HTMLDivElement | null>>([])
  const spaceSt = useRef<Ballistic[]>([])
  const spaceList: number[] = []
  if (spaceOn) for (let c = Math.max(1, first); c <= last && spaceList.length < 32; c++) spaceList.push(c)
  usePaint((_now, dt) => {
    const run = sonifyEngine.isRunning()
    const m = sonifyEngine.eqMeterOut
    const L: Level = run ? m.l : SILENCE, R: Level = run ? m.r : SILENCE
    const working = run && (sonifyEngine.meterLim < 0.95 || sonifyEngine.eqCeiling)
    limT.current = working ? MON.limHoldS : Math.max(0, limT.current - dt)
    const over = limT.current > 0
    const lb = over ? MON.colOver : ''
    if (lim.current && lim.current.style.background !== lb) lim.current.style.background = lb
    if (!spaceOn) {
      const lv: Level[] = mono ? [{ rms: Math.sqrt((L.rms * L.rms + R.rms * R.rms) / 2), peak: Math.max(L.peak, R.peak) }] : [L, R]
      lv.forEach((x, i) => {
        const s = (st.current[i] ??= newBallistic())
        step(s, x, dt)
        paintBar(boxes.current[i], s, over)
        setText(dbs.current[i], dbText(s))
      })
      return
    }
    // Space : each channel's peak after its own limiter
    const sm = sonifyEngine.spaceMeter
    spaceList.forEach((c, i) => {
      const s = (spaceSt.current[i] ??= newBallistic())
      const pk = run && sm && c - 1 < sm.length ? sm[c - 1] : 0
      step(s, { rms: pk * 0.7, peak: pk }, dt)
      const el = spaceBars.current[i]
      if (el) {
        const bar = el.firstElementChild as HTMLElement | null
        if (bar) {
          bar.style.height = `${(meterX(s.pk) * 100).toFixed(1)}%`
          bar.style.background = s.pk > MON.peakRedDb ? MON.colOver : s.pk > MON.hotDb ? MON.colHot : MON.colLow
        }
      }
    })
  })
  const limLight = (
    <span className="flex shrink-0 items-center gap-1" title="Limiter : lights while Sonify's limiter holds the output under -1 dBFS (or the output EQ's soft ceiling catches a boost). Everything still plays; the sound is being squeezed : bring the faders or the EQ down.">
      <span ref={lim} className="h-[9px] w-[9px] rounded-sm border border-border" />
      <span className="font-mono text-[9px] text-muted">limiter</span>
    </span>
  )
  if (spaceOn) {
    return (
      <div className="flex min-w-0 items-center gap-2" title={`Space drives the output : channels ${first} to ${last}, each its peak after Space's limiter.`}>
        <span className="w-[46px] shrink-0 text-right font-mono text-[9px] text-text">SPACE</span>
        <span className="shrink-0 font-mono text-[9px] text-muted">{spaceList.length > 1 ? `${spaceList[0]}–${spaceList[spaceList.length - 1]}` : spaceList.length ? spaceList[0] : 'none'}</span>
        <div className="flex min-w-0 flex-1 items-end gap-px overflow-hidden" style={{ height: MON.spaceBarH }}>
          {spaceList.map((c, i) => (
            <div key={c} ref={(el) => (spaceBars.current[i] = el)} title={`OUT ${c}`} className="relative h-full shrink-0 overflow-hidden rounded-[1px] bg-panel3" style={{ width: MON.spaceBarW }}>
              <div className="absolute inset-x-0 bottom-0 h-0" />
            </div>
          ))}
        </div>
        {limLight}
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-[3px]">
      {chans.map((c, i) => (
        <div
          key={`${c}-${i}`}
          className="flex min-w-0 items-center gap-1.5"
          title={`What leaves on the output device's channel ${c + 1}${mono ? ' (the two sides summed onto it)' : i ? ' (the right side)' : ' (the left side)'} : Sonify and the Audio Layer, after the limiter, the output EQ and the glue. The bar is the average (RMS) level, the tick the peak, ${MON.dbFloor} to 0 dBFS; orange while the limiter works. The input monitor plays on its own output (its meter is beside its fader).`}
        >
          <span className="w-[46px] shrink-0 text-right font-mono text-[9px] text-text">OUT {c + 1}</span>
          <MeterBox h={MON.outMeterH} className="min-w-0 flex-1" boxRef={(el) => (boxes.current[i] = el)} />
          <span ref={(el) => (dbs.current[i] = el)} className="w-[38px] shrink-0 text-right font-mono text-[9px] tabular-nums text-muted">-∞</span>
          {i === 0 ? limLight : <span className="w-[54px] shrink-0" />}
        </div>
      ))}
    </div>
  )
}

/** A block's heading in the tab's left margin : INPUT, HEARD, OUTPUT. */
export function BlockHead({ label, title, children, top }: { label: string; title: string; children?: ReactNode; top?: boolean }): JSX.Element {
  return (
    <div className={`flex min-w-0 gap-1.5 ${top ? 'items-start' : 'items-center'}`}>
      <span className={`w-[46px] shrink-0 text-right font-mono text-[9px] font-semibold uppercase tracking-wide text-accent ${top ? 'leading-[14px]' : ''}`} title={title}>{label}</span>
      {children}
    </div>
  )
}

// ── The top bar's input dot : green signal, grey silent, red gone ────────
export function InputDot(): JSX.Element | null {
  const enabled = useStore((s) => s.audioEnabled)
  const setRightView = useStore((s) => s.setRightView)
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!enabled) return
    let shown: InStatus | null = null
    const tick = (): void => {
      const st = inputStatus(performance.now())
      if (st === shown || !ref.current) return
      shown = st
      const dot = ref.current.firstElementChild as HTMLElement | null
      if (dot) dot.style.background = statusColor(st)
      ref.current.title = `Audio input : ${STATUS_WORD[st]}. ${STATUS_HINT[st]} Click : the Connect tab.`
    }
    tick()
    const id = window.setInterval(tick, 1000 / MON.dotHz)
    return () => window.clearInterval(id)
  }, [enabled])
  if (!enabled) return null
  return (
    <button ref={ref} onClick={() => setRightView('io')} className="flex h-5 w-4 shrink-0 items-center justify-center">
      <span className="h-2 w-2 rounded-full" style={{ background: MON.colSilent }} />
    </button>
  )
}
