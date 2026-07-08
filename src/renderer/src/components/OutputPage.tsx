// OutputPage — a full-screen "Output / Mapping" page that takes over the UI
// (opened from the toolbar). It carries a LIVE keystone editor (a mirror of the
// composite with draggable corner handles, so you warp and watch it move), the
// alignment grid, projector/2nd-display output, and NDI / Spout senders.

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { DisplayInfo } from '@shared/types'
import { useStore } from '../store'

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
  const renderScale = useStore((s) => s.renderScale)
  const setRenderScale = useStore((s) => s.setRenderScale)
  const resW = Math.round(1920 * renderScale)
  const resH = Math.round(1080 * renderScale)

  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [displayId, setDisplayId] = useState<number | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const padRef = useRef<HTMLDivElement | null>(null)
  const dragging = useRef<number | null>(null)

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
      /* captureStream unsupported — the editor still works without the preview */
    }
    return () => {
      stream?.getTracks().forEach((t) => t.stop())
      if (video) video.srcObject = null
    }
  }, [canvasRef])

  useEffect(() => {
    window.api
      .outputDisplays()
      .then((ds) => {
        setDisplays(ds)
        const target = ds.find((d) => !d.isPrimary) ?? ds[0]
        setDisplayId((cur) => cur ?? target?.id ?? null)
      })
      .catch(() => setDisplays([]))
  }, [])

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
      // eslint-disable-next-line no-alert
      alert(
        kind === 'ndi'
          ? 'NDI sender not available. Install the optional native module (grandiose) + NDI runtime.'
          : 'Spout sender not available. Add a Spout sender addon (leadedge SDK) for Windows.'
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
        {/* Live keystone editor */}
        <div className="flex min-w-0 flex-1 items-center justify-center bg-black/40 p-6">
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
          >
            <video ref={videoRef} autoPlay muted playsInline className="h-full w-full bg-black object-contain" />
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
                title={`${CORNER_LABELS[i]} — drag to keystone · double-click to reset`}
              />
            ))}
          </div>
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
                title={`Render resolution ${resW}×${resH} — the whole engine renders here, then scales to the display`}
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
              with crisp pixels — a genuine lo-fi look; push to{' '}
              <span className="text-text">4K</span> for hi-fi (heavier on the GPU).
              Changing it rebuilds the engine — a brief flicker is normal.
            </p>
          </Section>

          <Section title="Fullscreen output">
            <select
              className="input select-compact w-full text-[11px]"
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
                  title="A normal 1280×720 window — easy to Window-Capture in OBS/Resolume"
                >
                  window ▶
                </button>
              </div>
            )}
          </Section>

          <Section title="Send (Resolume / OBS)">
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
                  value={hiveOutPort}
                  disabled={hiveOutActive}
                  onChange={(e) => setHiveOutPort(Number(e.target.value) || 51842)}
                  className="w-16 rounded bg-panel px-1 py-0.5 text-right font-mono text-[11px] text-fg disabled:opacity-50"
                />
              </label>
            </div>
            <p className="text-[11px] leading-tight text-muted">
              HEVC over TCP, advertised on the LAN via mDNS — the open NDI
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
