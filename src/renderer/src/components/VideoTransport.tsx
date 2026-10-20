// VideoTransport : play/pause/stop, direction, loop, speed, a scrub timeline
// (click or drag to move the playhead) with draggable in/out points + a live
// playhead, and a clip row that steps through the videos beside the file.
// The playhead is painted straight from the engine's videoPlayheads map in a
// rAF loop (no React re-renders), like the modulated sliders.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { ModTarget, SourceSlot } from '@shared/types'
import { useShallow } from 'zustand/react/shallow'
import { videoKey, videoPlayheads, videoSeekRequests } from '../engine/videoState'
import { showToast } from './Toast'
import { pathFromMediaUrl, playableVideoUrl } from './videoImport'
import { clipAudio } from '../engine/clipAudio'
import { modTargetKey, useStore } from '../store'
import { AssignRow } from './AutoControls'

const SMIN = 1 / 64
const SMAX = 128
const tFromSpeed = (s: number): number => Math.log(s / SMIN) / Math.log(SMAX / SMIN)
const speedFromT = (t: number): number => SMIN * Math.pow(SMAX / SMIN, t)

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtSpeed(s: number): string {
  if (s >= 1) return `${s.toFixed(s < 10 ? 2 : s < 100 ? 1 : 0)}×`
  return `1/${(1 / s).toFixed(s > 0.1 ? 1 : 0)}×`
}

// The all-intra cache dir, fetched once and memoised across all transports.
let cacheDirCache: string | null = null
let cacheDirPromise: Promise<string> | null = null
function loadCacheDir(): Promise<string> {
  return (cacheDirPromise ??= window.api.videoCacheDir().then((d) => (cacheDirCache = d)))
}

/** The Audio Layer's file slots : the same transport on their own state (their
 *  own store actions; their playhead under layer -1). No modulation row yet. */
export interface TransportOps {
  patch: (p: TransportPatch) => void
  swap: (url: string, name: string, path: string) => void
  volume: number
  setVolume: (v: number) => void
  /** more buttons at the end of the transport row */
  extra?: ReactNode
}
type TransportPatch = Parameters<ReturnType<typeof useStore.getState>['setVideoPlayback']>[2]

export function VideoTransport({
  layer,
  slot,
  state,
  audio = false,
  ops
}: {
  layer: number
  slot: 'A' | 'B'
  state: SourceSlot
  /** An Import Audio slot : no direction, smooth copy or grain (an <audio> plays
   *  forward only); its folder lists sound files; its timeline shows the wave. */
  audio?: boolean
  ops?: TransportOps
}): JSX.Element {
  const setVideoPlayback = useStore((s) => s.setVideoPlayback)
  const swapVideoSource = useStore((s) => s.swapVideoSource)
  const set = (patch: TransportPatch): void =>
    ops ? ops.patch(patch) : setVideoPlayback(layer, slot, patch)

  // Smooth-scrub : native H.264/VP9/AV1 seek only to keyframes, so reverse /
  // pendulum / high-speed jump keyframe-to-keyframe. Transcoding the clip once to
  // the all-intra cache (every frame a keyframe) makes those scrub smoothly. We
  // detect whether the loaded clip already lives in that cache and, if not, offer
  // a one-press convert-and-swap (reusing the exact import pipeline).
  const [cacheDir, setCacheDir] = useState<string | null>(cacheDirCache)
  const [smoothPct, setSmoothPct] = useState<number | null>(null)
  useEffect(() => {
    if (cacheDir === null) loadCacheDir().then(setCacheDir)
  }, [cacheDir])
  const vidPath = pathFromMediaUrl(state.mediaId)
  const isSmooth = !!(vidPath && cacheDir && vidPath.startsWith(cacheDir))
  // The clip's folder : the ORIGINAL file (a converted clip plays from the cache),
  // else the played file itself when it isn't a cache copy.
  const origPath = state.mediaPath ?? (vidPath && cacheDir !== null && !vidPath.startsWith(cacheDir) ? vidPath : null)
  const folder = origPath ? origPath.replace(/[\\/][^\\/]*$/, '') : null
  const [files, setFiles] = useState<Array<{ name: string; path: string }>>([])
  const relist = (): void => {
    if (!folder) return
    void window.api.videoListFolder(folder, audio ? 'audio' : undefined).then((r) => setFiles(r.ok ? r.files : []))
  }
  useEffect(() => {
    if (!folder) {
      setFiles([])
      return
    }
    let alive = true
    void window.api.videoListFolder(folder, audio ? 'audio' : undefined).then((r) => alive && setFiles(r.ok ? r.files : []))
    return () => {
      alive = false
    }
  }, [folder, audio])
  const same = (a: string, b: string): boolean => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
  const clipIdx = origPath ? files.findIndex((f) => same(f.path, origPath)) : -1
  const [switchPct, setSwitchPct] = useState<number | null>(null)
  const switching = useRef(false)
  async function switchTo(f: { name: string; path: string }): Promise<void> {
    if (switching.current) return
    switching.current = true
    try {
      const url = audio ? `opsia-media://local/${encodeURIComponent(f.path)}` : await playableVideoUrl(f.path, f.name, setSwitchPct)
      if (url) {
        if (ops) ops.swap(url, f.name, f.path)
        else swapVideoSource(layer, slot, url, f.name, { mediaPath: f.path, resetTrim: true })
      }
    } finally {
      switching.current = false
    }
  }
  const step = (d: number): void => {
    if (!files.length) return
    const i = clipIdx < 0 ? (d > 0 ? 0 : files.length - 1) : (clipIdx + d + files.length) % files.length
    void switchTo(files[i])
  }
  async function makeSmooth(): Promise<void> {
    if (!vidPath) return
    setSmoothPct(0)
    const off = window.api.onVideoConvertProgress((p) => {
      if (p.path === vidPath) setSmoothPct(p.pct)
    })
    try {
      const res = await window.api.videoConvert(vidPath)
      if (res.ok && res.path) {
        swapVideoSource(layer, slot, `opsia-media://local/${encodeURIComponent(res.path)}`, state.mediaName ?? 'video')
      } else if (res.error) {
        showToast(`Couldn't make a smooth-scrub copy : ${res.error}`, 'warn', 6000)
      }
    } finally {
      off()
      setSmoothPct(null)
    }
  }

  const playing = state.videoPlaying ?? true
  const direction = state.videoDirection ?? (state.videoReverse ? 'reverse' : 'forward')
  const loop = state.videoLoop ?? true
  const speed = state.videoSpeed ?? 1
  const inN = state.videoIn ?? 0
  const outN = state.videoOut ?? 1
  const needsSmooth = speed > 6 || direction !== 'forward' || !!state.grainOn

  const key = videoKey(layer, slot)
  const barRef = useRef<HTMLDivElement | null>(null)
  const playheadRef = useRef<HTMLDivElement | null>(null)
  const timeRef = useRef<HTMLSpanElement | null>(null)
  const durRef = useRef<HTMLSpanElement | null>(null)
  const dragging = useRef<'in' | 'out' | 'seek' | null>(null)
  const [scrubbing, setScrubbing] = useState(false)
  // Move the playhead : a one-shot seek (0..1 within the trim) the render loop
  // routes through the playhead's seam : it lands paused or playing.
  const seekTo = (p: number): void => {
    const span = Math.max(1e-4, outN - inN)
    videoSeekRequests.set(key, Math.max(0, Math.min(1, (p - inN) / span)))
  }

  // Live playhead + time labels, painted from the engine each frame.
  useEffect(() => {
    let raf = 0
    const paint = (): void => {
      const ph = videoPlayheads.get(key)
      if (ph && ph.duration > 0) {
        const p = Math.max(0, Math.min(1, ph.time / ph.duration))
        if (playheadRef.current) playheadRef.current.style.left = `${p * 100}%`
        if (timeRef.current) timeRef.current.textContent = fmt(ph.time)
        if (durRef.current) durRef.current.textContent = fmt(ph.duration)
      }
      raf = requestAnimationFrame(paint)
    }
    raf = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(raf)
  }, [key])

  const posFromEvent = (e: ReactPointerEvent): number => {
    const el = barRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  }
  const startDrag = (which: 'in' | 'out') => (e: ReactPointerEvent) => {
    e.stopPropagation()
    dragging.current = which
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: ReactPointerEvent): void => {
    if (!dragging.current) return
    const p = posFromEvent(e)
    if (dragging.current === 'seek') seekTo(p)
    else if (dragging.current === 'in') set({ videoIn: Math.min(p, outN - 0.01) })
    else set({ videoOut: Math.max(p, inN + 0.01) })
  }
  const endDrag = (): void => {
    dragging.current = null
    setScrubbing(false)
  }

  const btn = (on: boolean): string =>
    `rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
      on ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted hover:text-text'
    }`

  return (
    <div className="flex flex-col gap-2 border-t border-border px-2 py-2">
      {/* Transport row */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => set({ videoPlaying: !playing })}
          className={btn(playing)}
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? '⏸ pause' : '▶ play'}
        </button>
        <button
          onClick={() => {
            set({ videoPlaying: false })
            videoSeekRequests.set(key, 0)
          }}
          className={btn(false)}
          title="Stop : pause and go back to the in point (play starts from there)"
        >
          ■
        </button>
        {!audio && <button
          onClick={() =>
            set({
              videoDirection:
                direction === 'forward' ? 'reverse' : direction === 'reverse' ? 'pendulum' : 'forward'
            })
          }
          className={btn(direction !== 'forward')}
          title={`Play mode: ${direction} : click to cycle forward → reverse → pendulum`}
        >
          {direction === 'forward' ? 'fwd ▶' : direction === 'reverse' ? '◀ rev' : '⇄ pend'}
        </button>}
        <button
          onClick={() => set({ videoLoop: !loop })}
          className={btn(loop)}
          title={loop ? 'Looping between in/out' : 'Play once, hold at end'}
        >
          ⟲ loop
        </button>
        <button
          onClick={() => set({ ignoreGlobalSpeed: !state.ignoreGlobalSpeed })}
          className={btn(!!state.ignoreGlobalSpeed)}
          title={state.ignoreGlobalSpeed
            ? 'Its own speed : the global speed (the Transport) is ignored, so it plays at its speed × the layer\'s whatever the composition does. Click to follow the global speed again'
            : 'Follows the global speed (the Transport) like the rest of the composition. Click to ignore it : a sound stays at its pitch and tempo while the picture slows or rushes'}
        >
          {state.ignoreGlobalSpeed ? '⊘ global' : 'global'}
        </button>
        {ops?.extra}
        {/* Smooth scrub : convert a native clip to all-intra so reverse / high-speed
            are smooth. Only meaningful for on-disk clips. */}
        {vidPath && !audio &&
          (smoothPct !== null ? (
            <span
              className="rounded border border-accent2 px-1.5 py-0.5 font-mono text-[10px] text-accent2"
              title="Transcoding to an all-intra copy…"
            >
              ⚙ {Math.round(smoothPct * 100)}%
            </span>
          ) : isSmooth ? (
            <span
              className="rounded border border-border/60 px-1.5 py-0.5 font-mono text-[10px] text-muted/70"
              title="This clip is all-intra : reverse, pendulum and high-speed scrub smoothly"
            >
              ◆ smooth
            </span>
          ) : (
            <button
              onClick={makeSmooth}
              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors hover:border-accent2 hover:text-accent2 ${
                needsSmooth ? 'border-accent2/70 text-accent2' : 'border-border text-muted'
              }`}
              title={
                needsSmooth
                  ? 'This clip will strobe at these settings : fast (above about 8x), reverse, pendulum and grain jump from keyframe to keyframe on an ordinary clip (about 10 pictures a second). A smooth copy (all-intra, made once) plays them at about 40. Click to make it.'
                  : 'Make a smooth-scrub copy : transcode once to an all-intra cache so reverse / pendulum / high-speed play smoothly (native clips only seek to keyframes)'
              }
            >
              ◇ smooth
            </button>
          ))}
        <div className="flex-1" />
        <span className="font-mono text-[10px] text-muted">
          <span ref={timeRef}>0:00</span> / <span ref={durRef}>0:00</span>
        </span>
      </div>

      {/* Timeline : inset with the same flanking widths as the Speed row so it
          lines up to the exact width of the Speed slider. */}
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0" />
        <div
          ref={barRef}
          className="relative h-6 min-w-0 flex-1 cursor-pointer select-none rounded bg-panel2"
          onPointerDown={(e) => {
            dragging.current = 'seek'
            setScrubbing(true)
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            seekTo(posFromEvent(e))
          }}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          title="Click or drag to move the playhead (within the in/out trim) : drag the handles to trim"
        >
        {audio && origPath && <WaveStrip path={origPath} />}
        <div
          className="absolute inset-y-0 bg-accent/15"
          style={{ left: `${inN * 100}%`, right: `${(1 - outN) * 100}%` }}
        />
        <div
          className="absolute inset-y-0 -ml-1 w-2 cursor-ew-resize rounded-l bg-accent/80 hover:bg-accent"
          style={{ left: `${inN * 100}%` }}
          onPointerDown={startDrag('in')}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => set({ videoIn: 0 })}
          title={`In point : ${(inN * 100).toFixed(0)}% : double-click resets to start`}
        />
        <div
          className="absolute inset-y-0 -ml-1 w-2 cursor-ew-resize rounded-r bg-accent/80 hover:bg-accent"
          style={{ left: `${outN * 100}%` }}
          onPointerDown={startDrag('out')}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={() => set({ videoOut: 1 })}
          title={`Out point : ${(outN * 100).toFixed(0)}% : double-click resets to end`}
        />
        <div
          ref={playheadRef}
          className={`pointer-events-none absolute transition-[width,background-color] ${
            scrubbing ? '-inset-y-0.5 -ml-[1.5px] w-[3px] rounded-full bg-accent shadow-[0_0_6px_1px] shadow-accent' : 'inset-y-0 w-px bg-text'
          }`}
          style={{ left: '0%' }}
        />
        </div>
        <span className="w-12 shrink-0" />
      </div>

      {/* Clip : step through the videos beside this file (wraps at the ends). */}
      {folder && files.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="w-10 shrink-0 font-mono text-[9px] uppercase text-muted">clip</span>
          <button
            onClick={() => step(-1)}
            disabled={files.length < 2 || switchPct !== null}
            className={btn(false)}
            title={audio ? 'Previous sound in this folder' : 'Previous video in this folder'}
          >
            ◀
          </button>
          <select
            className="input select-compact min-w-0 flex-1 text-[10px]"
            value={clipIdx >= 0 ? files[clipIdx].path : ''}
            onFocus={relist}
            onChange={(e) => {
              const f = files.find((x) => x.path === e.target.value)
              if (f) void switchTo(f)
            }}
            disabled={switchPct !== null}
            title={audio ? `Sounds in ${folder} : pick one to swap it in (speed and loop stay)` : `Videos in ${folder} : pick one to swap it in (speed, direction, loop and grain stay)`}
          >
            {clipIdx < 0 && <option value="">{state.mediaName ?? (audio ? 'pick a sound' : 'pick a video')}</option>}
            {files.map((f) => (
              <option key={f.path} value={f.path}>
                {f.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => step(1)}
            disabled={files.length < 2 || switchPct !== null}
            className={btn(false)}
            title={audio ? 'Next sound in this folder' : 'Next video in this folder'}
          >
            ▶
          </button>
          <span className="w-12 shrink-0 text-right font-mono text-[10px] text-muted">
            {switchPct !== null ? `⚙ ${Math.round(switchPct * 100)}%` : `${clipIdx + 1}/${files.length}`}
          </span>
        </div>
      )}

      {/* Speed */}
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 font-mono text-[9px] uppercase text-muted">speed</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={tFromSpeed(speed)}
          onChange={(e) => set({ videoSpeed: speedFromT(Number(e.target.value)) })}
          onDoubleClick={() => set({ videoSpeed: 1 })}
          className="min-w-0 flex-1 accent-accent"
          title={audio ? `Speed ${fmtSpeed(speed)} : like tape, the pitch moves with it (keep pitch holds it); 1/16 to 16x, slower is silent; double-click to reset (×layer ×global)` : `Clip speed ${fmtSpeed(speed)} : double-click to reset (×layer ×global)`}
        />
        <span className="w-12 shrink-0 text-right font-mono text-[10px] text-muted">
          {fmtSpeed(speed)}
        </span>
      </div>

      {/* The sound : its level at the playhead (RMS), and how loud it plays. */}
      <LevelRow
        layer={layer}
        slot={slot}
        path={origPath ?? ''}
        volume={ops ? ops.volume : audio ? (typeof state.inputs.volume === 'number' ? state.inputs.volume : 0.8) : state.videoVolume ?? 0}
        onVolume={(v) => (ops ? ops.setVolume(v) : audio ? useStore.getState().setSourceInput(layer, slot, 'volume', v) : set({ videoVolume: v }))}
        audio={audio}
      />

      {/* Granular : 3 seek-head voices scattering grains around the playhead.
          Toggle + BPM sync on one line, the 4 grain sliders in a 2×2 grid
          below so each gets a readable width. */}
      {!audio && <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <button
            onClick={() => set({ grainOn: !(state.grainOn ?? false) })}
            className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] transition-colors ${
              state.grainOn ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted hover:text-text'
            }`}
            title="Video granulation : three grain voices scatter short windows around the playhead (which keeps moving : modulate it to steer the cloud). Best on imported/converted all-intra clips."
          >
            ⌗ grain
          </button>
          {state.grainOn && (
            <>
              <span className="shrink-0 font-mono text-[9px] uppercase text-muted">sync</span>
              <select
                className="input select-compact shrink-0 text-[9px]"
                value={state.grainSync ?? 0}
                onChange={(e) => set({ grainSync: Number(e.target.value) })}
                title="BPM sync : grains retrigger on the beat grid (grain length = this division). free = grain size in seconds."
              >
                <option value={0}>free</option>
                <option value={0.25}>1/16</option>
                <option value={0.5}>1/8</option>
                <option value={1}>1/4</option>
                <option value={2}>1/2</option>
              </select>
            </>
          )}
        </div>
        {state.grainOn && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {([
              ['size', 'grainSize', 0.05, 1, state.grainSize ?? 0.25, 'Grain length (seconds)'],
              ['spray', 'grainSpray', 0, 1, state.grainSpray ?? 0.15, 'Scatter around the playhead'],
              ['rev', 'grainReverse', 0, 1, state.grainReverse ?? 0.25, 'Probability a grain plays backward'],
              ['jit', 'grainJitter', 0, 1, state.grainJitter ?? 0.2, 'Per-grain speed jitter']
            ] as Array<[string, 'grainSize' | 'grainSpray' | 'grainReverse' | 'grainJitter', number, number, number, string]>).map(
              ([lbl, key, lo, hi, val, tip]) => (
                <span key={key} className="flex min-w-0 items-center gap-1" title={tip}>
                  <span className="w-9 shrink-0 font-mono text-[9px] uppercase text-muted">{lbl}</span>
                  <input
                    type="range" min={lo} max={hi} step={0.01} value={val}
                    onChange={(e) => set({ [key]: Number(e.target.value) })}
                    className="min-w-0 flex-1 accent-accent2"
                  />
                </span>
              )
            )}
          </div>
        )}
      </div>}

      {/* Modulation : playhead / speed / grain params as mod targets. */}
      {!ops && <VideoModRow layer={layer} slot={slot} grainOn={!audio && (state.grainOn ?? false)} audio={audio} />}
    </div>
  )
}

// The clip's sound at its playhead : a meter (RMS bar, held peak, -60..0 dBFS)
// and its RMS as a number, read from the file's analysis, so it shows whether
// the clip has sound right there even while the film plays muted. A stopped
// playhead reads silence. Then its volume : 0 keeps a film silent.
const M_FLOOR = -60
function LevelRow({ layer, slot, path, volume, onVolume, audio }: {
  layer: number; slot: 'A' | 'B'; path: string; volume: number; onVolume: (v: number) => void; audio: boolean
}): JSX.Element {
  const barRef = useRef<HTMLDivElement | null>(null)
  const tickRef = useRef<HTMLDivElement | null>(null)
  const numRef = useRef<HTMLSpanElement | null>(null)
  const [, bump] = useState(0)
  useEffect(() => clipAudio.subscribe(() => bump((n) => n + 1)), [])
  const st = path ? clipAudio.state(path) : undefined
  if (path && st === undefined) clipAudio.get(path) // ask for it once
  useEffect(() => {
    let raf = 0, lastT = -1, movedAt = 0, at = performance.now()
    let rmsDb = -120, pkDb = -120, held = 0, shown = ''
    const key = videoKey(layer, slot)
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.25, (now - at) / 1000)
      at = now
      const an = path ? clipAudio.get(path) : null
      const ph = videoPlayheads.get(key)
      let rms = 0, peak = 0
      if (an && ph) {
        if (Math.abs(ph.time - lastT) > 1e-4) movedAt = now
        lastT = ph.time
        if (now - movedAt < 150) ({ rms, peak } = clipAudio.meterAt(an, ph.time))
      }
      const toDb = (x: number): number => (x > 1e-6 ? 20 * Math.log10(x) : -120)
      const r = toDb(rms), p = toDb(peak)
      rmsDb = r >= rmsDb ? r : Math.max(r, rmsDb - 24 * dt) // a meter's fall, 24 dB/s
      if (p >= pkDb) { pkDb = p; held = 1 } else if ((held -= dt) <= 0) pkDb = Math.max(p, pkDb - 24 * dt)
      const x = (db: number): number => Math.max(0, Math.min(1, (db - M_FLOOR) / -M_FLOOR))
      if (barRef.current) {
        barRef.current.style.width = `${(x(rmsDb) * 100).toFixed(1)}%`
        barRef.current.style.background = rmsDb > -9 ? 'rgb(214,196,90)' : 'rgb(120,200,140)'
      }
      if (tickRef.current) {
        tickRef.current.style.left = `calc(${(x(pkDb) * 100).toFixed(1)}% - 1px)`
        tickRef.current.style.opacity = pkDb > M_FLOOR ? '1' : '0'
        tickRef.current.style.background = pkDb > -1 ? 'rgb(230,120,60)' : 'rgb(230,230,230)'
      }
      const lin = rmsDb > -119 ? Math.pow(10, rmsDb / 20) : 0
      const txt = lin.toFixed(3)
      if (numRef.current && txt !== shown) {
        shown = txt
        numRef.current.textContent = txt
        numRef.current.title = `RMS ${txt} (${rmsDb > -119 ? rmsDb.toFixed(1) : '-∞'} dBFS) at the playhead`
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [layer, slot, path])
  const status = !path ? 'no file' : st === 'silent' ? 'no sound' : st === 'failed' ? 'unread' : st === 'pending' || st === undefined ? 'reading…' : null
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 font-mono text-[9px] uppercase text-muted">level</span>
      <div
        className="relative h-[7px] min-w-[40px] flex-1 overflow-hidden rounded-sm bg-panel3"
        title={`The clip's sound where the playhead is : the bar is its RMS, the tick its peak (${M_FLOOR} to 0 dBFS). Read from the file${audio ? '' : ', so it shows even while the film plays silent (volume 0)'}; a stopped playhead reads nothing.`}
      >
        <div ref={barRef} className="absolute inset-y-0 left-0 w-0" />
        <div ref={tickRef} className="absolute inset-y-0 w-[2px] opacity-0" />
        {[-48, -36, -24, -12, -6].map((db) => (
          <div key={db} className="pointer-events-none absolute inset-y-0 w-px bg-black/40" style={{ left: `${(((db - M_FLOOR) / -M_FLOOR) * 100).toFixed(1)}%` }} />
        ))}
      </div>
      {status ? (
        <span className="w-12 shrink-0 text-right font-mono text-[9px] text-muted">{status}</span>
      ) : (
        <span ref={numRef} className="w-12 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted">0.000</span>
      )}
      <span className="shrink-0 font-mono text-[9px] uppercase text-muted">vol</span>
      {/* (an Audio Layer slot's volume is a gain to 2, like its live inputs; an <audio>'s stops at 1) */}
      <input
        type="range" min={0} max={layer < 0 ? 2 : 1} step={0.01} value={volume}
        onChange={(e) => onVolume(Number(e.target.value))}
        onDoubleClick={() => onVolume(audio ? 0.8 : 0)}
        className="w-16 shrink-0 accent-accent"
        title={audio
          ? `Volume ${Math.round(volume * 100)} % (double-click : 80 %)${layer < 0 ? ', into the Audio Layer\'s mix' : ", on Sonify's output device"}`
          : `The film's own sound : ${volume > 0 ? `${Math.round(volume * 100)} %` : 'silent'} (double-click : silent), on Sonify's output device. Heard while it plays forward at its own pace (reverse, the grains or a modulated playhead stay silent); a muted layer is silent.`}
      />
      <span className="w-8 shrink-0 text-right font-mono text-[9px] tabular-nums text-muted">{volume > 0 ? Math.round(volume * 100) : 'off'}</span>
    </div>
  )
}

// The sound's waveform under an audio slot's timeline (its analysis's peaks,
// drawn once when they land and when the strip changes size).
function WaveStrip({ path }: { path: string }): JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const draw = (): void => {
      const an = clipAudio.get(path)
      const r = cv.getBoundingClientRect()
      const w = Math.max(1, Math.round(r.width * (window.devicePixelRatio || 1))), h = Math.max(1, Math.round(r.height * (window.devicePixelRatio || 1)))
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
      const g = cv.getContext('2d')
      if (!g) return
      g.clearRect(0, 0, w, h)
      if (!an || an.peakCount < 1) return
      g.fillStyle = 'rgba(255,255,255,0.28)'
      const n = an.peakCount
      for (let x = 0; x < w; x++) {
        const i0 = Math.floor((x / w) * n), i1 = Math.max(i0 + 1, Math.floor(((x + 1) / w) * n))
        let mn = 127, mx = -127
        for (let i = i0; i < Math.min(n, i1); i += Math.max(1, Math.floor((i1 - i0) / 64))) {
          mn = Math.min(mn, an.peaks[i * 2]); mx = Math.max(mx, an.peaks[i * 2 + 1])
        }
        if (mx < mn) continue
        const y0 = h / 2 - (mx / 127) * (h / 2), y1 = h / 2 - (mn / 127) * (h / 2)
        g.fillRect(x, y0, 1, Math.max(1, y1 - y0))
      }
    }
    draw()
    const off = clipAudio.subscribe(draw)
    const ro = new ResizeObserver(draw)
    ro.observe(cv)
    return () => { off(); ro.disconnect() }
  }, [path])
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full rounded" />
}

// Bind a modulator to the video PLAYHEAD (position 0..1 within the trim : a saw
// LFO = a loop, S&H = jump-cuts, audio = a sound-driven scrub) or to the clip
// SPEED (rate multiplier). On imported/converted all-intra clips the seeks are
// frame-accurate, so a modulated playhead reads smooth.
function VideoModRow({ layer, slot, grainOn, audio = false }: { layer: number; slot: 'A' | 'B'; grainOn: boolean; audio?: boolean }): JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  const inputs: Array<[string, string]> = [
    ['playhead', 'position'],
    ['speed', 'speed'],
    ['in', 'loopIn'],
    ['out', 'loopOut'],
    // the film's volume (an audio slot's is its `volume` control, with its own M)
    ...(audio ? [] : ([['vol', 'vol']] as Array<[string, string]>)),
    ...(grainOn ? ([['gr·size', 'grainSize'], ['gr·spray', 'grainSpray']] as Array<[string, string]>) : [])
  ]
  const targets: Record<string, ModTarget> = {}
  for (const [, input] of inputs) targets[input] = { kind: 'source', layer, slot, input }
  const matrix = useStore(useShallow((s) => s.composition.modMatrix))
  const boundFor = (input: string): typeof matrix => {
    const key = modTargetKey(targets[input])
    return matrix.filter((a) => modTargetKey(a.target) === key)
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-10 shrink-0 font-mono text-[9px] uppercase text-muted">mod</span>
        {inputs.map(([label, input]) => (
          <button
            key={input}
            onClick={() => setOpen((o) => (o === input ? null : input))}
            className={`rounded px-1.5 py-0.5 font-mono text-[9px] transition-colors ${
              boundFor(input).length > 0
                ? 'bg-accent2/20 text-accent2 ring-1 ring-accent2'
                : 'bg-panel3/60 text-muted hover:text-text'
            }`}
            title={
              input === 'position'
                ? 'Bind a modulator to the playhead : a saw LFO loops, S&H jump-cuts, audio scrubs. With grain on, this steers the cloud.'
                : `Bind a modulator to ${label}`
            }
          >
            M·{label}
          </button>
        ))}
      </div>
      {open && targets[open] && <AssignRow target={targets[open]} bound={boundFor(open)} />}
    </div>
  )
}
