// OutputPage : a full-screen "Output / Mapping" page that takes over the UI
// (opened from the toolbar). It carries a LIVE keystone editor (a mirror of the
// composite with draggable corner handles, so you warp and watch it move), the
// alignment grid, projector/2nd-display output, and NDI / Spout senders.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { DisplayInfo, PerfStats } from '@shared/types'
import { useStore } from '../store'
import { showToast } from './Toast'
import { currentFps } from '../perf'
import { captureScreenshot, outputRecorder, recordingFormats } from '../recorder'
import { MidiLearnOverlay } from './MidiLearnOverlay'

const CORNER_LABELS = ['TL', 'TR', 'BR', 'BL']

export function OutputPage({
  canvasRef
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>
}): JSX.Element {
  const setOutputPageOpen = useStore((s) => s.setOutputPageOpen)

  const warpEnabled = useStore((s) => s.warpEnabled)
  const warpGrid = useStore((s) => s.warpGrid)
  const corners = useStore(useShallow((s) => s.warpCorners))
  const setWarpEnabled = useStore((s) => s.setWarpEnabled)
  const setWarpGrid = useStore((s) => s.setWarpGrid)
  const setWarpCorner = useStore((s) => s.setWarpCorner)
  const resetWarp = useStore((s) => s.resetWarp)

  const outputActive = useStore((s) => s.outputActive)
  const setOutputActive = useStore((s) => s.setOutputActive)
  const ndiActive = useStore((s) => s.ndiActive)
  const setNdiActive = useStore((s) => s.setNdiActive)
  const spoutActive = useStore((s) => s.spoutActive)
  const setSpoutActive = useStore((s) => s.setSpoutActive)
  const hiveOutActive = useStore((s) => s.hiveOutActive)
  const setHiveOutActive = useStore((s) => s.setHiveOutActive)
  const hiveOutPort = useStore((s) => s.hiveOutPort)
  const setHiveOutPort = useStore((s) => s.setHiveOutPort)
  // HIVE port : a controlled text field with a LOCAL draft so unrelated
  // re-renders (the 250 ms recording tick, a saved-flash) can't snap the field
  // back to the stored port mid-edit. Commit the parsed, in-range value on blur /
  // Enter; resync the draft from the store while the field isn't being edited.
  const [hivePortDraft, setHivePortDraft] = useState(String(hiveOutPort))
  const hivePortEditing = useRef(false)
  useEffect(() => {
    if (!hivePortEditing.current) setHivePortDraft(String(hiveOutPort))
  }, [hiveOutPort])
  const commitHivePort = (): void => {
    const n = Number(hivePortDraft)
    if (Number.isFinite(n) && n >= 1 && n <= 65535) setHiveOutPort(Math.round(n))
    else setHivePortDraft(String(hiveOutPort)) // out of range → revert to stored
  }
  const renderScale = useStore((s) => s.renderScale)
  const setRenderScale = useStore((s) => s.setRenderScale)
  const strobeSafe = useStore((s) => s.strobeSafe)
  const setStrobeSafe = useStore((s) => s.setStrobeSafe)
  const resW = Math.round(1920 * renderScale)
  const resH = Math.round(1080 * renderScale)

  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [displayId, setDisplayId] = useState<number | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const padRef = useRef<HTMLDivElement | null>(null)
  const dragging = useRef<number | null>(null)

  // ── Recording + screenshot ──────────────────────────────────────────
  const [formats, setFormats] = useState<Array<{ id: string; label: string }>>([])
  const [formatId, setFormatId] = useState<string>('')
  useEffect(() => {
    void recordingFormats().then((fs) => {
      setFormats(fs)
      // Default to MP4/H.264 when available (fast remux, high quality), else first.
      setFormatId((cur) => cur || fs.find((f) => f.id === 'mp4-h264')?.id || fs[0]?.id || '')
    })
  }, [])
  // The GLOBAL recorder : the take survives leaving this page (tweak live in
  // the main view; the top-bar REC pill shows and stops it).
  const recording = useStore((s) => s.recording)
  const recordingSince = useStore((s) => s.recordingSince)
  const [recElapsed, setRecElapsed] = useState(0) // seconds
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const savedTimer = useRef<number | null>(null)

  // Tick the recording timer while active (elapsed from the global start).
  useEffect(() => {
    if (!recording) return
    setRecElapsed((performance.now() - recordingSince) / 1000)
    const id = window.setInterval(() => setRecElapsed((performance.now() - recordingSince) / 1000), 250)
    return () => window.clearInterval(id)
  }, [recording, recordingSince])

  // Clear a pending "saved" flash on unmount so it can't fire on a dead component.
  useEffect(() => () => { if (savedTimer.current) window.clearTimeout(savedTimer.current) }, [])

  const flashSaved = (path: string | null, kind: string): void => {
    if (!path) return
    const name = path.split(/[\\/]/).pop() ?? path
    setSavedMsg(`${kind}: ${name}`)
    if (savedTimer.current) window.clearTimeout(savedTimer.current)
    savedTimer.current = window.setTimeout(() => setSavedMsg((m) => (m?.endsWith(name) ? null : m)), 4000)
  }

  const toggleRecord = async (): Promise<void> => {
    if (outputRecorder.active) {
      const path = await outputRecorder.stop()
      flashSaved(path, 'saved')
    } else {
      const canvas = canvasRef.current
      if (!canvas || !formatId) return
      const ok = await outputRecorder.start(canvas, formatId)
      if (!ok) flashSaved('failed', 'recording could not start')
    }
  }

  const takeScreenshot = async (): Promise<void> => {
    const canvas = canvasRef.current
    if (!canvas) return
    flashSaved(await captureScreenshot(canvas), 'screenshot')
  }

  // Live mirror of the composite into the editor via canvas.captureStream.
  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    let stream: MediaStream | null = null
    try {
      stream = canvas.captureStream(30)
      video.srcObject = stream
      void video.play().catch(() => {})
    } catch {
      /* captureStream unsupported : the editor still works without the preview */
    }
    return () => {
      stream?.getTracks().forEach((t) => t.stop())
      if (video) video.srcObject = null
    }
  }, [canvasRef])

  // Re-enumerable : plug in a projector after opening the page and hit ⟳ rescan.
  const refreshDisplays = useCallback((): void => {
    window.api
      .outputDisplays()
      .then((ds) => {
        setDisplays(ds)
        const target = ds.find((d) => !d.isPrimary) ?? ds[0]
        setDisplayId((cur) => cur ?? target?.id ?? null)
      })
      .catch(() => setDisplays([]))
  }, [])
  useEffect(() => refreshDisplays(), [refreshDisplays])

  const posFromEvent = (e: ReactPointerEvent): [number, number] => {
    const el = padRef.current
    if (!el) return [0, 0]
    const r = el.getBoundingClientRect()
    return [
      Math.max(-0.5, Math.min(1.5, (e.clientX - r.left) / r.width)),
      Math.max(-0.5, Math.min(1.5, (e.clientY - r.top) / r.height))
    ]
  }

  const openOutput = async (windowed: boolean): Promise<void> => {
    if (displayId == null) return
    await window.api.outputOpen(displayId, windowed)
    setOutputActive(true)
  }
  const closeOutput = async (): Promise<void> => {
    await window.api.outputClose()
    setOutputActive(false)
  }
  const toggleSink = async (
    kind: 'ndi' | 'spout',
    active: boolean,
    setActive: (b: boolean) => void
  ): Promise<void> => {
    const next = !active
    const ok = kind === 'ndi' ? await window.api.ndiSet(next) : await window.api.spoutSet(next)
    setActive(next && ok)
    if (next && !ok) {
      showToast(
        kind === 'ndi'
          ? 'NDI sender not available — install the optional grandiose module + NDI runtime'
          : 'Spout sender not available — add a Spout addon (leadedge SDK) for Windows',
        'warn',
        7000
      )
    }
  }

  const btn = (on: boolean): string =>
    `rounded border px-3 py-1 font-mono text-[11px] transition-colors ${
      on ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted hover:text-text'
    }`
  const pts = [0, 1, 2, 3].map((i) => `${corners[i * 2] * 100},${corners[i * 2 + 1] * 100}`).join(' ')

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      {/* Header */}
      <header className="flex items-center gap-4 border-b border-border bg-panel px-4 py-2">
        <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.2em]">
          Output · Mapping
        </span>
        <div className="flex-1" />
        <button
          onClick={() => setOutputPageOpen(false)}
          className="rounded border border-border px-3 py-1 font-mono text-[11px] text-muted hover:text-accent"
        >
          ← back to instrument
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Live keystone editor + the resource HUD pinned beneath it */}
        <div className="flex min-w-0 flex-1 flex-col bg-black/40">
         <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div
            ref={padRef}
            className="relative aspect-video w-full max-w-5xl select-none rounded border border-border bg-black"
            style={{ touchAction: 'none' }}
            onPointerMove={(e) => {
              if (dragging.current === null) return
              if (!warpEnabled) setWarpEnabled(true)
              const [x, y] = posFromEvent(e)
              setWarpCorner(dragging.current, x, y)
            }}
            onPointerUp={() => {
              dragging.current = null
            }}
            onPointerCancel={() => {
              dragging.current = null
            }}
          >
            <video ref={videoRef} autoPlay muted playsInline className="h-full w-full bg-black object-contain" />
            {/* Recording indicator : top-right, pulsing red dot + elapsed. */}
            {recording && (
              <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1.5 rounded bg-black/55 px-2 py-1 font-mono text-[11px] text-danger">
                <span className="h-2 w-2 animate-pulse rounded-full bg-danger" />
                REC {fmtClock(recElapsed)}
              </div>
            )}
            {savedMsg && (
              <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/60 px-2 py-1 font-mono text-[10px] text-accent">
                {savedMsg}
              </div>
            )}
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <polygon
                points={pts}
                className="fill-none stroke-accent"
                strokeWidth={0.4}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {[0, 1, 2, 3].map((i) => (
              <button
                key={i}
                onPointerDown={(e) => {
                  dragging.current = i
                  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
                }}
                onDoubleClick={() => {
                  const id = [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 1]
                  ][i]
                  setWarpCorner(i, id[0], id[1])
                }}
                className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 border-bg bg-accent"
                style={{ left: `${corners[i * 2] * 100}%`, top: `${corners[i * 2 + 1] * 100}%` }}
                title={`${CORNER_LABELS[i]} : drag to keystone · double-click to reset`}
              />
            ))}
          </div>
         </div>
         {/* Resource HUD : one line, spaced across, just under the output. */}
         <ResourceHud />
        </div>

        {/* Controls */}
        <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-panel p-4">
          <Section title="Mapping">
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setWarpEnabled(!warpEnabled)} className={btn(warpEnabled)}>
                warp {warpEnabled ? 'on' : 'off'}
              </button>
              <button onClick={() => setWarpGrid(!warpGrid)} className={btn(warpGrid)}>
                grid
              </button>
              <button
                onClick={resetWarp}
                className="rounded border border-border px-3 py-1 font-mono text-[11px] text-muted hover:text-accent"
              >
                reset
              </button>
            </div>
            <p className="text-[11px] leading-tight text-muted">
              Drag the corners over the live preview to keystone the image onto a
              projector. Turn <span className="text-text">grid</span> on to align,
              off for the show.
            </p>
          </Section>

          <Section title="Resolution">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0.1}
                max={2}
                step={0.05}
                value={renderScale}
                onChange={(e) => setRenderScale(Number(e.target.value))}
                onDoubleClick={() => setRenderScale(1)}
                className="min-w-0 flex-1 accent-accent"
                title={`Render resolution ${resW}×${resH} : the whole engine renders here, then scales to the display`}
              />
              <span className="w-24 shrink-0 text-right font-mono text-[11px] text-muted">
                {resW}×{resH}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                ['½ (lo-fi)', 0.5],
                ['1080p', 1],
                ['1440p', 1.3333],
                ['4K', 2]
              ].map(([lbl, v]) => (
                <button
                  key={lbl as string}
                  onClick={() => setRenderScale(v as number)}
                  className={btn(Math.abs(renderScale - (v as number)) < 0.02)}
                >
                  {lbl}
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-tight text-muted">
              The whole engine renders at this resolution (every effect, not just a
              filter). Below <span className="text-text">1080p</span> it upscales
              with crisp pixels : a genuine lo-fi look; push to{' '}
              <span className="text-text">4K</span> for hi-fi (heavier on the GPU).
              Changing it rebuilds the engine : a brief flicker is normal.
            </p>
          </Section>

          <Section title="Flash safety">
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={strobeSafe}
                onChange={(e) => setStrobeSafe(Number(e.target.value))}
                onDoubleClick={() => setStrobeSafe(0.35)}
                className="min-w-0 flex-1 accent-accent"
                title="Photosensitive-safety limiter : caps how fast the whole picture can flash. Applies to the preview AND the projection."
              />
              <span className="w-24 shrink-0 text-right font-mono text-[11px] text-muted">
                {strobeSafe < 0.02 ? 'off' : `${Math.round(strobeSafe * 100)}%`}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                ['off', 0],
                ['mild', 0.35],
                ['strong', 0.7],
                ['max', 1]
              ].map(([lbl, v]) => (
                <button
                  key={lbl as string}
                  onClick={() => setStrobeSafe(v as number)}
                  className={btn(Math.abs(strobeSafe - (v as number)) < 0.02)}
                >
                  {lbl}
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-tight text-muted">
              A safety net on the final image : it measures the whole-frame brightness
              each frame and damps big full-field <span className="text-text">flashes</span>{' '}
              (from Shutter, Superimposition, Frame-Weave, datamosh, hard cuts…) so no
              seizure-inducing strobe reaches the screen. Normal motion is untouched.
              <span className="text-text"> Mild</span> is on by default and barely
              affects ordinary content.
            </p>
          </Section>

          <Section title="Fullscreen output">
            <div className="flex items-center gap-1">
              <select
                className="input select-compact min-w-0 flex-1 text-[11px]"
                value={displayId ?? ''}
                onChange={(e) => setDisplayId(Number(e.target.value))}
                disabled={outputActive}
              >
                {displays.length === 0 && <option value="">no displays</option>}
                {displays.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label} · {d.width}×{d.height}
                    {d.isPrimary ? ' (primary)' : ''}
                  </option>
                ))}
              </select>
              <button
                onClick={refreshDisplays}
                className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted hover:text-accent"
                title="Rescan for connected displays"
              >
                ⟳
              </button>
            </div>
            {outputActive ? (
              <button
                onClick={closeOutput}
                className="w-full rounded border border-danger/60 bg-danger/15 px-3 py-1 font-mono text-[11px] text-danger hover:bg-danger/25"
              >
                close output
              </button>
            ) : (
              <div className="flex gap-1.5">
                <button
                  onClick={() => openOutput(false)}
                  disabled={displayId == null}
                  className="flex-1 rounded border border-accent bg-accent/15 px-2 py-1 font-mono text-[11px] text-accent hover:bg-accent/25 disabled:opacity-40"
                  title="Borderless fullscreen on the chosen display (projector)"
                >
                  fullscreen ▶
                </button>
                <button
                  onClick={() => openOutput(true)}
                  disabled={displayId == null}
                  className="flex-1 rounded border border-accent bg-accent/15 px-2 py-1 font-mono text-[11px] text-accent hover:bg-accent/25 disabled:opacity-40"
                  title="A normal 1280×720 window : easy to Window-Capture in OBS"
                >
                  window ▶
                </button>
              </div>
            )}
          </Section>

          <Section title="Record">
            <select
              className="input select-compact w-full text-[11px]"
              value={formatId}
              onChange={(e) => setFormatId(e.target.value)}
              disabled={recording || formats.length === 0}
              title="Recording format"
            >
              {formats.length === 0 && <option value="">no encoder available</option>}
              {formats.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
            <div className="flex gap-1.5">
              <span className="relative flex flex-1">
                <MidiLearnOverlay id="fire:record" />
                <button
                  onClick={() => void toggleRecord()}
                  disabled={formats.length === 0}
                  className={`flex-1 rounded border px-2 py-1 font-mono text-[11px] transition-colors disabled:opacity-40 ${
                    recording
                      ? 'border-danger bg-danger/20 text-danger hover:bg-danger/30'
                      : 'border-accent bg-accent/15 text-accent hover:bg-accent/25'
                  }`}
                  title={recording ? 'Stop recording' : 'Record the output composition to the Recorded folder'}
                >
                  {recording ? '■ stop' : '● rec'}
                </button>
              </span>
              <button
                onClick={() => void takeScreenshot()}
                className="flex-1 rounded border border-border px-2 py-1 font-mono text-[11px] text-muted hover:text-accent"
                title="Save a PNG of the output at its current resolution → Recorded folder"
              >
                screenshot
              </button>
            </div>
            <p className="text-[11px] leading-tight text-muted">
              Clips + screenshots land in the <span className="text-text">Recorded</span>{' '}
              folder, at the current output resolution. Captured as a high-bitrate
              hardware H.264 master, then ffmpeg delivers the chosen format
              (ProRes / FFV1 / uncompressed included).
            </p>
          </Section>

          <Section title="Send (NDI / Spout)">
            <div className="flex gap-1.5">
              <button
                onClick={() => toggleSink('ndi', ndiActive, setNdiActive)}
                className={`flex-1 ${btn(ndiActive)}`}
              >
                NDI {ndiActive ? 'on' : 'off'}
              </button>
              <button
                onClick={() => toggleSink('spout', spoutActive, setSpoutActive)}
                className={`flex-1 ${btn(spoutActive)}`}
              >
                Spout {spoutActive ? 'on' : 'off'}
              </button>
            </div>
            <p className="text-[11px] leading-tight text-muted">
              NDI / Spout need an optional native sender installed. Spout is the
              zero-copy path on Windows.
            </p>
          </Section>

          <Section title="HIVE (open network output)">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setHiveOutActive(!hiveOutActive)}
                className={`flex-1 ${btn(hiveOutActive)}`}
              >
                HIVE {hiveOutActive ? 'on' : 'off'}
              </button>
              <label className="flex items-center gap-1 text-[11px] text-muted">
                port
                <input
                  type="number"
                  value={hivePortDraft}
                  disabled={hiveOutActive}
                  onFocus={() => { hivePortEditing.current = true }}
                  onChange={(e) => setHivePortDraft(e.target.value)}
                  onBlur={() => { hivePortEditing.current = false; commitHivePort() }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                  }}
                  className="w-16 rounded bg-panel px-1 py-0.5 text-right font-mono text-[11px] text-fg disabled:opacity-50"
                />
              </label>
            </div>
            <p className="text-[11px] leading-tight text-muted">
              HEVC over TCP, advertised on the LAN via mDNS : the open NDI
              alternative. Receive in OBS (HIVE plugin) or any HIVE client.
              Experimental: needs a hardware HEVC encoder.
            </p>
          </Section>
        </aside>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[9px] uppercase tracking-wide text-muted">{title}</span>
      {children}
    </div>
  )
}

function fmtClock(sec: number): string {
  const s = Math.floor(sec)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// Floating realtime resource monitor (top-left of the preview). Polls main for
// Palinopsia's CPU/RAM + the GPU's VRAM/util once a second; reads the renderer
// FPS meter every rAF. Pure DOM sampling, no store churn.
function ResourceHud(): JSX.Element {
  const [stats, setStats] = useState<PerfStats>({ cpu: null, ram: null, vram: null, gpu: null })
  const [fps, setFps] = useState(0)

  useEffect(() => {
    let alive = true
    const poll = async (): Promise<void> => {
      try {
        const s = await window.api.perfStats()
        if (alive && s) setStats(s)
      } catch {
        /* ignore */
      }
    }
    void poll()
    const id = window.setInterval(() => void poll(), 1000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  useEffect(() => {
    let raf = 0
    let last = 0
    const tick = (t: number): void => {
      if (t - last >= 250) {
        setFps(currentFps())
        last = t
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const pct = (v: number | null): string => (v == null ? '—' : `${Math.round(v)}%`)
  const cell = (label: string, value: string): JSX.Element => (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>
      <span className="tabular-nums text-[14px] text-text">{value}</span>
    </div>
  )
  return (
    <div className="flex shrink-0 items-center justify-center gap-6 border-t border-border bg-panel/60 py-2 font-mono">
      {cell('FPS', fps > 0 ? String(Math.round(fps)) : '—')}
      {cell('CPU', pct(stats.cpu))}
      {cell('RAM', pct(stats.ram))}
      {cell('VRAM', pct(stats.vram))}
      {cell('GPU', pct(stats.gpu))}
    </div>
  )
}
