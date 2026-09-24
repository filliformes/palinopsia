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
import { DomeSim } from './DomeSim'
import { DOME_RES, type DomeConfig, type DomeMode } from '@shared/dome'

const CORNER_LABELS = ['TL', 'TR', 'BR', 'BL']

export function OutputPage({
  canvasRef
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>
}): JSX.Element {
  const setOutputPageOpen = useStore((s) => s.setOutputPageOpen)
  // Fulldome : the master mapping + the simulator's camera (a ref, so orbiting
  // never re-renders the page).
  const dome = useStore((s) => s.dome)
  const setDome = useStore((s) => s.setDome)
  const setDomeSim = useStore((s) => s.setDomeSim)
  const [domeView, setDomeView] = useState<'3d' | 'master'>('3d')
  const simCam = useRef({ yaw: 0, pitch: 0.45, dist: 2.6, fov: dome.sim.fov })
  simCam.current.fov = dome.sim.fov
  const simDrag = useRef<{ x: number; y: number } | null>(null)
  // Inside : from the seat, facing front, eyes a little up. Outside : behind the
  // dome and above, looking at the front half's inner surface (the cutaway).
  const resetSimCam = (view: 'inside' | 'outside' = dome.sim.view): void => {
    Object.assign(simCam.current, view === 'inside' ? { yaw: 0, pitch: 0.45 } : { yaw: Math.PI, pitch: 0.35, dist: 2.6 })
    if (view === 'inside') setDomeSim({ back: 0, fov: 100 })
  }
  // The whole inside at once : backed off below the dome's opening, looking up.
  const wholeDome = (): void => {
    Object.assign(simCam.current, { yaw: 0, pitch: 1.25 })
    setDomeSim({ view: 'inside', back: 1.7, fov: 78 })
  }

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
  const lights = useStore((s) => s.lights)
  const setLights = useStore((s) => s.setLights)
  // Installation mode : a persisted "enable on next restart" launch config (main
  // owns kiosk.json). Load it once; toggling writes it back.
  const sessionPath = useStore((s) => s.sessionPath)
  const sessionName = useStore((s) => s.name)
  const [kioskLaunch, setKioskLaunch] = useState<{ enabled: boolean; sessionPath?: string; display?: number }>({
    enabled: false
  })
  useEffect(() => {
    window.api
      .kioskGetLaunch()
      .then((k) => setKioskLaunch({ enabled: !!k.enabled, sessionPath: k.sessionPath, display: k.display }))
      .catch(() => {})
  }, [])
  const saveKiosk = (partial: Partial<typeof kioskLaunch>): void => {
    const next = { ...kioskLaunch, ...partial }
    setKioskLaunch(next)
    window.api.kioskSetLaunch(next).catch(() => {})
  }
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
  const compW = useStore((s) => s.compW)
  const compH = useStore((s) => s.compH)
  const setCompSize = useStore((s) => s.setCompSize)
  // Resizable inspector width (persisted). A drag handle on its left edge; the
  // panel clips horizontally (overflow-x-hidden) so nothing ever spawns a
  // horizontal scrollbar — widen it instead.
  const [inspW, setInspW] = useState(() => {
    const v = Number(localStorage.getItem('opsia.outInspectorW'))
    return Number.isFinite(v) && v >= 240 && v <= 560 ? v : 300
  })
  const dragW = useRef<{ x: number; w: number } | null>(null)
  const strobeSafe = useStore((s) => s.strobeSafe)
  const setStrobeSafe = useStore((s) => s.setStrobeSafe)
  // Composition-size draft fields : editing them must NOT rebuild the engine on
  // every keystroke, so they're local and commit on apply / Enter / blur.
  const [draftW, setDraftW] = useState(String(compW))
  const [draftH, setDraftH] = useState(String(compH))
  useEffect(() => { setDraftW(String(compW)); setDraftH(String(compH)) }, [compW, compH])
  const applyCompSize = (): void => {
    const w = Number(draftW), h = Number(draftH)
    if (Number.isFinite(w) && Number.isFinite(h)) setCompSize(w, h)
  }
  const resW = Math.round(compW * renderScale)
  const resH = Math.round(compH * renderScale)
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  const arDiv = gcd(compW, compH) || 1
  const aspectLabel = `${compW / arDiv}:${compH / arDiv}`

  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [displayId, setDisplayId] = useState<number | null>(null)
  const [spanSel, setSpanSel] = useState<number[]>([])

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
      if (dome.enabled && dome.res > 4096) {
        showToast('Video encoders stop at 4K : record the dome at 4096 (8K is for stills)', 'warn', 6000)
        return
      }
      const ok = await outputRecorder.start(canvas, formatId)
      if (!ok) flashSaved('failed', 'recording could not start')
    }
  }

  const takeScreenshot = async (): Promise<void> => {
    const canvas = canvasRef.current
    if (!canvas) return
    flashSaved(await captureScreenshot(canvas), 'screenshot')
  }

  // Live mirror of the composite into the editor via canvas.captureStream. Not in
  // dome mode : capturing a 4K master cost ~40 fps; the simulator reads a small
  // copy of it straight from the engine instead (engine/domePreview).
  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video || dome.enabled) return
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
  }, [canvasRef, dome.enabled])

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
  const openSpan = async (): Promise<void> => {
    const ids = spanSel.length > 0 ? spanSel : displays.map((d) => d.id)
    if (ids.length === 0) return
    await window.api.outputOpenSpan(ids)
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
        0 // sticky : an install instruction shouldn't vanish on a timer
      )
    }
  }

  const btn = (on: boolean): string =>
    `rounded border px-3 py-1 font-mono text-[11px] transition-colors ${
      on
        ? 'border-accent bg-accent/15 text-accent'
        : 'border-border bg-panel3/70 text-muted hover:bg-panel3 hover:text-text'
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
            className={`relative w-full select-none rounded border border-border bg-black ${
              dome.enabled && domeView === 'master' ? 'aspect-square max-w-3xl' : 'aspect-video max-w-5xl'
            }`}
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
            {/* The mirror : the canvas stream. In dome mode it IS the master, and the
                3D simulator textures itself from it, so it stays mounted (just
                invisible) behind the simulator. */}
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className={`h-full w-full bg-black object-contain ${dome.enabled ? 'hidden' : ''}`}
            />
            {dome.enabled && domeView === 'master' && (
              <div className="absolute inset-0">
                <DomeSim cfg={dome} cam={simCam} flat />
              </div>
            )}
            {dome.enabled && domeView === '3d' && (
              <div
                className="absolute inset-0 cursor-grab active:cursor-grabbing"
                onPointerDown={(e) => {
                  simDrag.current = { x: e.clientX, y: e.clientY }
                  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                }}
                onPointerMove={(e) => {
                  const d = simDrag.current
                  if (!d) return
                  const c = simCam.current
                  const k = dome.sim.view === 'inside' ? -0.005 : 0.008
                  c.yaw += (e.clientX - d.x) * k
                  c.pitch = Math.max(-1.45, Math.min(1.5, c.pitch + (e.clientY - d.y) * (dome.sim.view === 'inside' ? 0.005 : -0.008)))
                  simDrag.current = { x: e.clientX, y: e.clientY }
                }}
                onPointerUp={() => { simDrag.current = null }}
                onWheel={(e) => {
                  if (dome.sim.view === 'inside') {
                    // Zoom out : widen the lens to 120°, then keep going by backing
                    // the camera away. Zoom in retraces : come forward, then narrow.
                    const s = dome.sim
                    if (e.deltaY > 0) {
                      if (s.fov < 120) setDomeSim({ fov: Math.min(120, s.fov + 4) })
                      else setDomeSim({ back: Math.min(3, Math.round((s.back + 0.1) * 100) / 100) })
                    } else if (s.back > 0) setDomeSim({ back: Math.max(0, Math.round((s.back - 0.1) * 100) / 100) })
                    else setDomeSim({ fov: Math.max(30, s.fov - 4) })
                  }
                  else simCam.current.dist = Math.max(1.2, Math.min(8, simCam.current.dist * (e.deltaY > 0 ? 1.08 : 0.93)))
                }}
                onDoubleClick={() => resetSimCam()}
                title={dome.sim.view === 'inside' ? 'Drag to look around · wheel out widens, then backs away (wheel in comes back) · double-click resets to the seat' : 'Drag to orbit · wheel = distance · double-click resets'}
              >
                <DomeSim cfg={dome} cam={simCam} />
                <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/55 px-2 py-1 font-mono text-[10px] text-muted">
                  {dome.aperture}° dome · {dome.res}² master · {dome.sim.view} view
                </div>
              </div>
            )}
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
            {!dome.enabled && (<>
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
            </>)}
          </div>
         </div>
         {/* Resource HUD : one line, spaced across, just under the output. */}
         <ResourceHud />
        </div>

        {/* Drag handle : resize the inspector. */}
        <div
          onPointerDown={(e) => {
            dragW.current = { x: e.clientX, w: inspW }
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            if (!dragW.current) return
            setInspW(Math.max(240, Math.min(560, dragW.current.w + (dragW.current.x - e.clientX))))
          }}
          onPointerUp={() => {
            if (dragW.current) localStorage.setItem('opsia.outInspectorW', String(inspW))
            dragW.current = null
          }}
          className="w-1.5 shrink-0 cursor-col-resize bg-border/50 transition-colors hover:bg-accent/50"
          title="Drag to resize"
        />
        {/* Controls */}
        <aside
          style={{ width: inspW }}
          className="flex shrink-0 flex-col gap-2 overflow-y-auto overflow-x-hidden border-l border-border bg-panel p-2"
        >
          <DomeSection dome={dome} setDome={setDome} setDomeSim={setDomeSim} btn={btn} view={domeView} setView={setDomeView} onResetCam={resetSimCam} onWholeDome={wholeDome} />

          <Section title="Mapping" info="Drag the corners over the live preview to keystone the image onto a projector. Turn grid on to align, off for the show. (Off in dome mode : a domemaster is mapped by the dome's own server.)">

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
          </Section>

          <Section
            title="Composition size"
            info="The composition's native pixel size and aspect : the whole engine renders at this shape (not just a crop). Widen it to span several projectors (e.g. 7680×2160 = two 4K projectors side by side). It is machine-local, not saved in the session, so a show file stays resolution-independent. Changing it rebuilds the engine (a brief flicker). Render scale below is a quality multiplier on top."
          >
            <div className="flex flex-wrap gap-1.5">
              {[
                ['1080p', 1920, 1080],
                ['1440p', 2560, 1440],
                ['4K UHD', 3840, 2160],
                ['2×1 · 3840×1080', 3840, 1080],
                ['3×1 · 5760×1080', 5760, 1080],
                ['2×1 · 7680×2160', 7680, 2160]
              ].map(([lbl, w, h]) => (
                <button
                  key={lbl as string}
                  onClick={() => setCompSize(w as number, h as number)}
                  className={btn(compW === w && compH === h)}
                  title={`${w}×${h}`}
                >
                  {lbl}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="number" min={320} max={15360} step={1} value={draftW}
                onChange={(e) => setDraftW(e.target.value)}
                onBlur={applyCompSize}
                onKeyDown={(e) => { if (e.key === 'Enter') applyCompSize() }}
                className="input w-20 text-right text-[11px]"
                title="Composition width in pixels"
              />
              <span className="font-mono text-[11px] text-muted">×</span>
              <input
                type="number" min={240} max={8640} step={1} value={draftH}
                onChange={(e) => setDraftH(e.target.value)}
                onBlur={applyCompSize}
                onKeyDown={(e) => { if (e.key === 'Enter') applyCompSize() }}
                className="input w-20 text-right text-[11px]"
                title="Composition height in pixels"
              />
              <button onClick={applyCompSize} className={btn(false)} title="Apply the custom size (rebuilds the engine)">apply</button>
              <span className="ml-auto font-mono text-[10px] text-muted">{aspectLabel}</span>
            </div>
          </Section>

          <Section title="Render scale" info="A quality multiplier on the composition size : below 1× the engine renders coarser and upscales (a genuine lo-fi look, lighter on the GPU); above 1× it supersamples (heavier). The readout is the actual render resolution. Changing it rebuilds the engine.">

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
                ['1×', 1],
                ['1⅓×', 1.3333],
                ['2×', 2]
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
          </Section>

          <Section title="Flash safety" info="A safety net on the final image: it measures whole-frame brightness each frame and damps big full-field flashes (Shutter, Superimposition, Frame-Weave, datamosh, hard cuts…) so no seizure-inducing strobe reaches the screen. Normal motion is untouched. Mild is on by default and barely affects ordinary content.">

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
            {!outputActive && displays.length >= 2 && (
              <div className="mt-1 flex flex-col gap-1 rounded border border-border/60 bg-panel3/30 p-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[9px] uppercase tracking-wide text-muted">span projectors</span>
                  <InfoDot text="One borderless window across several adjacent displays (each projector a separate monitor). Pick the displays to span, or span all. Set the composition size to the total pixels, e.g. two 4K projectors side by side → 7680×2160. Per-projector keystone / edge-blend is a later phase; this shows one wide composition across the row." />
                </div>
                <div className="flex flex-wrap gap-1">
                  {displays.map((d) => {
                    const on = spanSel.includes(d.id)
                    return (
                      <button
                        key={d.id}
                        onClick={() => setSpanSel((s) => (on ? s.filter((x) => x !== d.id) : [...s, d.id]))}
                        className={btn(on)}
                        title={`${d.width}×${d.height}${d.isPrimary ? ' · primary' : ''}`}
                      >
                        {d.label}
                      </button>
                    )
                  })}
                </div>
                <button
                  onClick={() => void openSpan()}
                  className="w-full rounded border border-accent bg-accent/15 px-2 py-1 font-mono text-[11px] text-accent hover:bg-accent/25"
                  title="Open one borderless output window across the selected displays (or all if none picked)"
                >
                  span {spanSel.length > 0 ? `${spanSel.length} display${spanSel.length > 1 ? 's' : ''}` : 'all displays'} ▶
                </button>
              </div>
            )}
          </Section>

          <Section title="Record" info="Clips + screenshots land in the Recorded folder, at the current output resolution. Captured as a high-bitrate hardware H.264 master, then ffmpeg delivers the chosen format (ProRes / FFV1 / uncompressed included).">

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
          </Section>

          <Section
            title="Send (NDI / Spout)"
            info="NDI / Spout need an optional native sender installed. Spout is the zero-copy path on Windows."
            defaultCollapsed={!ndiActive && !spoutActive}
          >

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
          </Section>

          <Section
            title="HIVE (open network output)"
            info="HEVC over TCP, advertised on the LAN via mDNS: the open NDI alternative. Receive in OBS (HIVE plugin) or any HIVE client. Experimental: needs a hardware HEVC encoder."
            defaultCollapsed={!hiveOutActive}
          >

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
          </Section>

          <Section
            title="Lights (ArtNet / WLED)"
            info="Samples the composite into a cols×rows zone grid and streams it as ArtNet/DMX (any console or LED controller) or WLED (DNRGB, port 21324). Set the fixture's IP; ArtNet spills across universes automatically. Machine-local (travels with the venue, not the session)."
            defaultCollapsed={!lights.enabled}
          >

            <div className="flex gap-1.5">
              <button
                onClick={() => setLights({ enabled: !lights.enabled })}
                className={`flex-1 ${btn(lights.enabled)}`}
              >
                Lights {lights.enabled ? 'on' : 'off'}
              </button>
              <button onClick={() => setLights({ protocol: 'artnet' })} className={btn(lights.protocol === 'artnet')}>
                ArtNet
              </button>
              <button onClick={() => setLights({ protocol: 'wled' })} className={btn(lights.protocol === 'wled')}>
                WLED
              </button>
            </div>
            <label className="flex items-center justify-between gap-1 text-[11px] text-muted">
              host
              <input
                value={lights.host}
                onChange={(e) => setLights({ host: e.target.value })}
                placeholder="192.168.1.50"
                className="w-36 rounded bg-panel px-1 py-0.5 text-right font-mono text-[11px] text-fg"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
              <label className="flex items-center gap-1">cols
                <input type="number" min={1} max={64} value={lights.cols}
                  onChange={(e) => setLights({ cols: Math.max(1, Math.min(64, Number(e.target.value) || 1)) })}
                  className="w-12 rounded bg-panel px-1 py-0.5 text-right font-mono text-fg" />
              </label>
              <label className="flex items-center gap-1">rows
                <input type="number" min={1} max={64} value={lights.rows}
                  onChange={(e) => setLights({ rows: Math.max(1, Math.min(64, Number(e.target.value) || 1)) })}
                  className="w-12 rounded bg-panel px-1 py-0.5 text-right font-mono text-fg" />
              </label>
              <label className="flex items-center gap-1">fps
                <input type="number" min={1} max={60} value={lights.fps}
                  onChange={(e) => setLights({ fps: Math.max(1, Math.min(60, Number(e.target.value) || 40)) })}
                  className="w-12 rounded bg-panel px-1 py-0.5 text-right font-mono text-fg" />
              </label>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-muted">
              bright
              <input type="range" min={0} max={1} step={0.01} value={lights.brightness}
                onChange={(e) => setLights({ brightness: Number(e.target.value) })} className="flex-1" />
              <span className="w-8 text-right font-mono">{lights.brightness.toFixed(2)}</span>
            </label>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
              <label className="flex items-center gap-1">gamma
                <input type="number" min={0.5} max={3} step={0.1} value={lights.gamma}
                  onChange={(e) => setLights({ gamma: Math.max(0.5, Math.min(3, Number(e.target.value) || 1)) })}
                  className="w-12 rounded bg-panel px-1 py-0.5 text-right font-mono text-fg" />
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={lights.serpentine}
                  onChange={(e) => setLights({ serpentine: e.target.checked })} />
                serpentine
              </label>
            </div>
            {lights.protocol === 'artnet' && (
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
                <label className="flex items-center gap-1">universe
                  <input type="number" min={0} max={32767} value={lights.universe}
                    onChange={(e) => setLights({ universe: Math.max(0, Number(e.target.value) || 0) })}
                    className="w-14 rounded bg-panel px-1 py-0.5 text-right font-mono text-fg" />
                </label>
                <label className="flex items-center gap-1">ch
                  <input type="number" min={1} max={512} value={lights.startChannel}
                    onChange={(e) => setLights({ startChannel: Math.max(1, Math.min(512, Number(e.target.value) || 1)) })}
                    className="w-12 rounded bg-panel px-1 py-0.5 text-right font-mono text-fg" />
                </label>
                <label className="flex items-center gap-1">order
                  <select value={lights.order}
                    onChange={(e) => setLights({ order: e.target.value as 'rgb' | 'grb' | 'brg' | 'bgr' })}
                    className="rounded bg-panel px-1 py-0.5 font-mono text-fg">
                    <option value="rgb">RGB</option>
                    <option value="grb">GRB</option>
                    <option value="brg">BRG</option>
                    <option value="bgr">BGR</option>
                  </select>
                </label>
              </div>
            )}
          </Section>

          <Section
            title="Installation mode"
            info="Boot straight into a session, fullscreen on the chosen display (which covers the operator UI on a single screen), and self-heal if the renderer crashes — for unattended installs. The projector mapping (keystone) is machine-local, so it is applied automatically. Exit a running install with Esc / O on the output or Ctrl+Shift+O anywhere. Takes effect on the NEXT app launch."
            defaultCollapsed={!kioskLaunch.enabled}
          >
            <button
              onClick={() =>
                saveKiosk({
                  enabled: !kioskLaunch.enabled,
                  // Capture the current session + display when arming.
                  sessionPath: kioskLaunch.enabled ? kioskLaunch.sessionPath : sessionPath ?? undefined,
                  display: kioskLaunch.display ?? displayId ?? undefined
                })
              }
              className={`w-full ${btn(kioskLaunch.enabled)}`}
            >
              {kioskLaunch.enabled ? 'ON at next restart' : 'Enable on next restart'}
            </button>
            <label className="flex items-center justify-between gap-2 text-[11px] text-muted">
              session
              <span
                className="min-w-0 truncate font-mono text-text"
                title={kioskLaunch.sessionPath ?? sessionPath ?? 'no session saved'}
              >
                {kioskLaunch.sessionPath
                  ? kioskLaunch.sessionPath.split(/[\\/]/).pop()
                  : sessionPath
                    ? sessionName || 'current'
                    : 'save the session first'}
              </span>
            </label>
            <label className="flex items-center gap-2 text-[11px] text-muted">
              display
              <select
                value={kioskLaunch.display ?? ''}
                onChange={(e) => saveKiosk({ display: e.target.value === '' ? undefined : Number(e.target.value) })}
                className="input select-compact min-w-0 flex-1 text-[11px]"
              >
                <option value="">primary</option>
                {displays.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                    {d.isPrimary ? ' (primary)' : ''}
                  </option>
                ))}
              </select>
            </label>
            {kioskLaunch.enabled && (
              <button
                onClick={() => saveKiosk({ sessionPath: sessionPath ?? undefined })}
                disabled={!sessionPath}
                className="rounded border border-border bg-panel3/70 px-2 py-0.5 font-mono text-[10px] text-muted hover:text-accent disabled:opacity-40"
                title="Point Installation mode at the currently-open session file"
              >
                use current session ({sessionName || 'unsaved'})
              </button>
            )}
            <p className="mt-1 font-mono text-[10px] leading-snug text-muted">
              To exit a running install : press{' '}
              <span className="text-text">Esc</span> or <span className="text-text">O</span> on the
              output, or <span className="text-text">Ctrl+Shift+O</span> anywhere. That returns to
              the operator UI, it does not disarm this toggle.
            </p>
          </Section>
        </aside>
      </div>
    </div>
  )
}

// A small "i" that reveals its explanation on hover (native title : never clips,
// never forces the inspector to scroll horizontally). Replaces the inline
// paragraphs that used to bulk up the panel.
function InfoDot({ text }: { text: string }): JSX.Element {
  return (
    <span
      title={text}
      className="flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-border font-mono text-[8px] text-muted hover:border-accent hover:text-accent"
    >
      i
    </span>
  )
}

function DomeSlider({ label, value, min, max, step, onChange, reset, unit = '', title }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; reset?: number; unit?: string; title?: string
}): JSX.Element {
  return (
    <label className="flex items-center gap-2" title={title}>
      <span className="w-16 shrink-0 font-mono text-[10px] text-muted">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => reset !== undefined && onChange(reset)}
        className="min-w-0 flex-1 accent-accent"
      />
      <span className="w-12 shrink-0 text-right font-mono text-[10px] text-text">{Math.round(value * 100) / 100}{unit}</span>
    </label>
  )
}

// Fulldome : master on/off + resolution + aperture, the mapping mode and its
// controls, and the simulator's view. Port of the TD FulldomeSimulator's
// DomeConfig page, plus the mapping it never had.
function DomeSection({ dome, setDome, setDomeSim, btn, view, setView, onResetCam, onWholeDome }: {
  dome: DomeConfig
  setDome: (p: Partial<DomeConfig>) => void
  setDomeSim: (p: Partial<DomeConfig['sim']>) => void
  btn: (on: boolean) => string
  view: '3d' | 'master'
  setView: (v: '3d' | 'master') => void
  onResetCam: (view: 'inside' | 'outside') => void
  onWholeDome: () => void
}): JSX.Element {
  const MODES: Array<[DomeMode, string, string]> = [
    ['fisheye', 'full dome', 'The whole Palinopsia frame over the whole dome : its centre at the zenith, its edges all around the rim. Fill uses every pixel and leaves no black inside the dome.'],
    ['wrap', 'panorama', 'The picture wraps around the room like a panorama : its width runs around you (repeated by turns), its height climbs from the rim to the zenith. Made for 360° rooms (the Satosphère).'],
    ['screen', 'screen', 'The picture hangs on the dome as a flat virtual screen, re-projected so it reads undistorted from the centre : a giant cinema screen. Surround wraps it dimly behind so the dome is never black.']
  ]
  return (
    <Section
      title="Fulldome"
      defaultCollapsed
      info="Renders a square domemaster (equidistant fisheye, front at the bottom, the fulldome standard) from the flat composition. The master replaces the frame everywhere : the preview, the projector window, NDI, Spout, recording and stills. The SAT Satosphère takes 210°, 4096×4096 max, live over NDI. 8K is for stills (video encoders stop at 4K)."
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => setDome({ enabled: !dome.enabled })} className={btn(dome.enabled)}>
          dome {dome.enabled ? 'on' : 'off'}
        </button>
        {DOME_RES.map((r) => (
          <button key={r} onClick={() => setDome({ res: r })} className={btn(dome.res === r)} title={`${r}×${r} master${r === 4096 ? ' (Satosphère max)' : r === 8192 ? ' : stills only, heavy' : ''}`}>
            {r === 2048 ? '2K' : r === 4096 ? '4K' : '8K'}
          </button>
        ))}
      </div>
      <DomeSlider label="aperture" value={dome.aperture} min={180} max={230} step={1} unit="°" reset={210} onChange={(v) => setDome({ aperture: v })} title="The dome's field of view : 180° a hemisphere, 210° the Satosphère (the rim 15° below the horizon)" />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] text-muted">mapping</span>
        {MODES.map(([m, l, t]) => (
          <button key={m} onClick={() => setDome({ mode: m })} className={btn(dome.mode === m)} title={t}>{l}</button>
        ))}
      </div>
      {(dome.mode === 'wrap' || dome.mode === 'screen') && (
        <>
          <DomeSlider label="turns" value={dome.turns} min={1} max={6} step={0.25} reset={2} onChange={(v) => setDome({ turns: v })} title="How many times the picture goes around the dome (fewer = more horizontal stretch)" />
          <DomeSlider label="top" value={dome.top} min={0} max={90} step={1} unit="°" reset={70} onChange={(v) => setDome({ top: v })} title="Elevation the picture's top edge reaches (90° = the zenith)" />
          <DomeSlider label="bottom" value={dome.bottom} min={-25} max={80} step={1} unit="°" reset={-15} onChange={(v) => setDome({ bottom: v })} title="Elevation of the picture's bottom edge (−15° = the rim of a 210° dome)" />
          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={() => setDome({ mirrorSeams: !dome.mirrorSeams })} className={btn(dome.mirrorSeams)} title="Alternate copies mirror, so repeats join without a seam">mirror seams</button>
            <span className="font-mono text-[10px] text-muted">zenith</span>
            {(['fade', 'stretch', 'black'] as const).map((c) => (
              <button key={c} onClick={() => setDome({ cap: c })} className={btn(dome.cap === c)} title="What fills the dome above the picture's top edge">{c}</button>
            ))}
          </div>
        </>
      )}
      {dome.mode === 'screen' && (
        <>
          <DomeSlider label="azimuth" value={dome.azimuth} min={-180} max={180} step={1} unit="°" reset={0} onChange={(v) => setDome({ azimuth: v })} title="Where the screen hangs around the room (0 = front)" />
          <DomeSlider label="elevation" value={dome.elevation} min={-20} max={90} step={1} unit="°" reset={25} onChange={(v) => setDome({ elevation: v })} title="How high the screen's centre sits" />
          <DomeSlider label="width" value={dome.width} min={20} max={170} step={1} unit="°" reset={100} onChange={(v) => setDome({ width: v })} title="How much of the view the screen covers, horizontally" />
          <DomeSlider label="roll" value={dome.roll} min={-180} max={180} step={1} unit="°" reset={0} onChange={(v) => setDome({ roll: v })} />
          <DomeSlider label="surround" value={dome.surround} min={0} max={1} step={0.01} reset={0.25} onChange={(v) => setDome({ surround: v })} title="The picture wrapped dimly behind the screen" />
        </>
      )}
      {dome.mode === 'fisheye' && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[10px] text-muted">fit</span>
            {([
              ['fill', 'fill', 'The whole frame over the whole dome : nothing cropped, no black inside the circle (the frame is curved to the circle)'],
              ['cover', 'cover', 'The frame\'s height spans the dome; its sides are cropped'],
              ['contain', 'contain', 'The whole frame inside the dome, black around it']
            ] as const).map(([f, l, t]) => (
              <button key={f} onClick={() => setDome({ fit: f })} className={btn(dome.fit === f)} title={t}>{l}</button>
            ))}
          </div>
          <DomeSlider label="scale" value={dome.scale} min={0.2} max={3} step={0.01} reset={1} onChange={(v) => setDome({ scale: v })} />
          <DomeSlider label="offset x" value={dome.offsetX} min={-1} max={1} step={0.01} reset={0} onChange={(v) => setDome({ offsetX: v })} />
          <DomeSlider label="offset y" value={dome.offsetY} min={-1} max={1} step={0.01} reset={0} onChange={(v) => setDome({ offsetY: v })} />
        </>
      )}
      <DomeSlider label="rotate" value={dome.rotate} min={-180} max={180} step={1} unit="°" reset={0} onChange={(v) => setDome({ rotate: v })} title="Turn the whole mapping around the dome" />
      <DomeSlider label="spin" value={dome.spin} min={-30} max={30} step={0.5} unit="°/s" reset={0} onChange={(v) => setDome({ spin: v })} title="Keep turning, degrees per second" />
      <DomeSlider label="feather" value={dome.feather} min={0} max={0.2} step={0.005} reset={0.01} onChange={(v) => setDome({ feather: v })} title="Soft edge at the rim" />
      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => setDome({ grid: !dome.grid })} className={btn(dome.grid)} title="Burn an alignment grid into the OUTPUT (10° rings, 30° spokes, the horizon in cyan, the front in red) for projector setup">grid on output</button>
        <button onClick={() => setDome({ flipX: !dome.flipX })} className={btn(dome.flipX)} title="Mirror the master (some media servers expect it)">flip</button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2">
        <span className="font-mono text-[10px] text-muted">preview</span>
        <button onClick={() => setView('3d')} className={btn(view === '3d')}>3D dome</button>
        <button onClick={() => setView('master')} className={btn(view === 'master')}>master</button>
        {view === '3d' && (
          <>
            <button onClick={() => { setDomeSim({ view: 'inside' }); onResetCam('inside') }} className={btn(dome.sim.view === 'inside')} title="From the centre of the room, looking around">inside</button>
            <button onClick={() => { setDomeSim({ view: 'outside' }); onResetCam('outside') }} className={btn(dome.sim.view === 'outside')} title="Orbit the dome from outside">outside</button>
            <button onClick={onWholeDome} className={btn(dome.sim.view === 'inside' && dome.sim.back > 1.5)} title="See the whole inside at once : the camera backs off below the dome's opening and looks up">whole dome</button>
          </>
        )}
      </div>
      {view === '3d' && (
        <>
          <DomeSlider label="tilt" value={dome.sim.tilt} min={-30} max={30} step={1} unit="°" reset={0} onChange={(v) => setDomeSim({ tilt: v })} title="Dome tilt (the TD simulator's default is −15° for a tilted planetarium; the Satosphère is level)" />
          {dome.sim.view === 'inside' && (
            <>
              <DomeSlider label="camera" value={dome.sim.fov} min={30} max={150} step={1} unit="°" reset={100} onChange={(v) => setDomeSim({ fov: v })} title="Camera field of view" />
              <DomeSlider label="back off" value={dome.sim.back} min={0} max={3} step={0.05} reset={0} onChange={(v) => setDomeSim({ back: v })} title="Back the camera away from the seat (0) until the whole inside of the dome is in view : the wall it passes through is hidden" />
            </>
          )}
          <DomeSlider label="template" value={dome.sim.template} min={0} max={1} step={0.01} reset={0.19} onChange={(v) => setDomeSim({ template: v })} title="Alignment template over the dome (preview only)" />
          <div className="flex items-center gap-1.5">
            <button onClick={() => setDomeSim({ sweet: !dome.sim.sweet })} className={btn(dome.sim.sweet)} title="The sweet spot : where an audience facing front naturally looks">sweet spot</button>
          </div>
          {dome.sim.sweet && (
            <>
              <DomeSlider label="sweet w" value={dome.sim.sweetW} min={10} max={360} step={1} unit="°" reset={90} onChange={(v) => setDomeSim({ sweetW: v })} />
              <DomeSlider label="sweet low" value={dome.sim.sweetLo} min={-20} max={90} step={1} unit="°" reset={10} onChange={(v) => setDomeSim({ sweetLo: v })} />
              <DomeSlider label="sweet high" value={dome.sim.sweetHi} min={-20} max={90} step={1} unit="°" reset={55} onChange={(v) => setDomeSim({ sweetHi: v })} />
            </>
          )}
        </>
      )}
    </Section>
  )
}

// A collapsible card. Distinct from the panel (its own border + bg-panel2), an
// optional info dot, and a `defaultCollapsed` so feature sections that are off
// by default open collapsed.
function Section({
  title,
  info,
  defaultCollapsed = false,
  children
}: {
  title: string
  info?: string
  defaultCollapsed?: boolean
  children: ReactNode
}): JSX.Element {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  return (
    <div className="rounded-md border border-border bg-panel2">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          title={collapsed ? `Expand ${title}` : `Collapse ${title}`}
        >
          <span className={`font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>
          <span className="truncate font-mono text-[9px] uppercase tracking-wide text-muted">{title}</span>
        </button>
        {info && <InfoDot text={info} />}
      </div>
      {!collapsed && <div className="flex min-w-0 flex-col gap-2 px-2 pb-2">{children}</div>}
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
