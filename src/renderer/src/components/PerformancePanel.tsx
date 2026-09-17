// Performance sub-tab (osc/audio/midi tab) : the whole instrument's load at a
// glance. Three readings :
//   · Top line — host totals from main's sampler (FPS, frame ms, whole-GPU
//     util/VRAM, app CPU/RAM). GPU fields are NVIDIA-only, else "—".
//   · CPU frame budget — measured ms/frame per section (engine/perfMeter). This
//     is the CPU-side toll (dispatch + readbacks + audio / MediaPipe work) ;
//     WebGL doesn't expose per-section GPU time, so that's not claimed here.
//   · Memory (estimated) — VRAM per group computed from the app's own
//     allocations (render size, feedback buffers, source textures, trackers).
//   · Active subsystems — what's on and its count.

import { useEffect, useState } from 'react'
import type { PerfStats } from '@shared/types'
import { perfMeter } from '../engine/perfMeter'
import { currentFps } from '../perf'
import { useStore } from '../store'

const MB = 1024 * 1024

// CPU stages measured in the render loop + the MediaPipe loop, in display order.
const CPU_ROWS: Array<{ key: string; label: string }> = [
  { key: 'render', label: 'Render (GPU dispatch)' },
  { key: 'output', label: 'Output stream' },
  { key: 'vision', label: 'Vision return' },
  { key: 'depth', label: 'Depth engine' },
  { key: 'lights', label: 'Light output' },
  { key: 'sonify', label: 'Sonify' },
  { key: 'audio', label: 'Audio ingest' },
  { key: 'modulation', label: 'Modulation' },
  { key: 'mediapipe', label: 'Embodied (MediaPipe)' }
]

interface SlotLike { kind: string; shaderId: string | null }
interface LayerLike { sourceA: SlotLike; sourceB: SlotLike | null; feedback: boolean; fx: unknown[] }

function estimateVram(renderPx: number, layers: LayerLike[], hands: boolean, pose: boolean, face: boolean): Array<{ name: string; bytes: number }> {
  const rgba8 = renderPx * 4, rgba16 = renderPx * 8
  const NOMINAL = 1920 * 1080 * 4 // an unmeasured source texture's rough footprint
  const groups: Array<{ name: string; bytes: number }> = []
  groups.push({ name: 'Composition core', bytes: 6 * rgba8 }) // base ping-pong + present + bg + master
  let layerBytes = 0, fbBytes = 0, srcBytes = 0, collage = 0
  for (const L of layers) {
    if (!L) continue
    const a = L.sourceA?.kind, b = L.sourceB?.kind
    const active = (a && a !== 'none') || (b && b !== 'none')
    if (!active) continue
    layerBytes += 2 * rgba8
    if (L.feedback) fbBytes += 2 * rgba16
    for (const slot of [L.sourceA, L.sourceB]) {
      if (!slot) continue
      if (slot.kind === 'video' || slot.kind === 'capture' || slot.kind === 'hive' || slot.kind === 'assemble') srcBytes += NOMINAL
      else if (slot.kind === 'generator' && slot.shaderId === 'gen-collage') collage += 8 * NOMINAL // a decoded pool
    }
  }
  groups.push({ name: 'Layer buffers', bytes: layerBytes })
  if (fbBytes) groups.push({ name: 'Feedback buffers', bytes: fbBytes })
  if (srcBytes) groups.push({ name: 'Source textures', bytes: srcBytes })
  if (collage) groups.push({ name: 'Collage pool', bytes: collage })
  const nT = (hands ? 1 : 0) + (pose ? 1 : 0) + (face ? 1 : 0)
  if (nT) groups.push({ name: 'Embodied (MediaPipe)', bytes: (20 + 15 * nT) * MB })
  return groups
}

function Bar({ frac, danger }: { frac: number; danger?: boolean }): JSX.Element {
  return (
    <div className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-panel3/60">
      <div className={`absolute inset-y-0 left-0 rounded-full ${danger ? 'bg-danger' : 'bg-accent'}`} style={{ width: `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%` }} />
    </div>
  )
}

export function PerformancePanel(): JSX.Element {
  const collapsed = useStore((s) => !!s.collapsed['perf'])
  const toggleSection = useStore((s) => s.toggleSection)
  // Reactive state for the VRAM estimate + active list.
  const compW = useStore((s) => s.compW)
  const compH = useStore((s) => s.compH)
  const renderScale = useStore((s) => s.renderScale)
  const layers = useStore((s) => s.composition.layers) as unknown as LayerLike[]
  const master = useStore((s) => s.composition.master)
  const lights = useStore((s) => s.lights)
  const body = useStore((s) => s.bodyControl)
  const ndi = useStore((s) => s.ndiActive)
  const spout = useStore((s) => s.spoutActive)
  const hiveOut = useStore((s) => s.hiveOutActive)
  const sonify = useStore((s) => s.sonify)
  const audioEnabled = useStore((s) => s.audioEnabled)
  const audioMonitor = useStore((s) => s.audioMonitor)
  const audioDenoise = useStore((s) => s.audioDenoise)
  const midiOut = useStore((s) => s.midiOutputName)
  const midiClock = useStore((s) => s.midiClockOut)
  const surfaceActive = useStore((s) => s.surface.active)
  const depthMode = useStore((s) => s.depthMode)
  const recording = useStore((s) => s.recording)

  const [stats, setStats] = useState<PerfStats>({ cpu: null, ram: null, vram: null, gpu: null })
  const [fps, setFps] = useState(0)
  const [cpu, setCpu] = useState<Record<string, number>>({})

  useEffect(() => {
    if (collapsed) return
    const fast = window.setInterval(() => { setFps(currentFps()); setCpu(perfMeter.read()) }, 250)
    const slow = window.setInterval(() => { window.api.perfStats().then(setStats).catch(() => {}) }, 800)
    window.api.perfStats().then(setStats).catch(() => {})
    return () => { window.clearInterval(fast); window.clearInterval(slow) }
  }, [collapsed])

  const renderW = Math.round(compW * renderScale)
  const renderH = Math.round(compH * renderScale)
  const vram = estimateVram(renderW * renderH, layers, body.hands && body.enabled, body.pose && body.enabled, body.face && body.enabled)
  const vramTotal = vram.reduce((s, g) => s + g.bytes, 0)
  const vramMax = Math.max(vramTotal, ...vram.map((g) => g.bytes), 1)
  const cpuMeasured = CPU_ROWS.reduce((s, r) => s + (cpu[r.key] ?? 0), 0)
  const budget = 1000 / 60 // 16.7ms/frame reference

  const fxCount = (Array.isArray(master) ? master.length : 0)
  const nFeedback = layers.filter((L) => L?.feedback).length
  const srcCount = (kind: string): number => layers.reduce((n, L) => n + (L?.sourceA?.kind === kind ? 1 : 0) + (L?.sourceB?.kind === kind ? 1 : 0), 0)
  const collageCount = layers.reduce((n, L) => n + ([L?.sourceA, L?.sourceB].filter((s) => s?.kind === 'generator' && s?.shaderId === 'gen-collage').length), 0)
  const soniVoices = ['spectra', 'orbit', 'flow', 'events', 'raster', 'sstv', 'filter', 'chord'].filter((k) => (sonify as unknown as Record<string, { on?: boolean }>)[k]?.on).length

  const chip = (on: boolean, label: string): JSX.Element => (
    <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${on ? 'bg-accent/20 text-accent' : 'bg-panel2/60 text-muted/60'}`}>{label}</span>
  )
  const pct = (v: number | null): string => (v == null ? '—' : `${Math.round(v)}%`)

  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-t border-border bg-panel px-3 py-1.5 text-[11px]">
      <div className="flex min-w-0 items-center gap-2">
        <button onClick={() => toggleSection('perf')} className="flex shrink-0 items-center gap-1.5" title={collapsed ? 'Expand Performance' : 'Collapse Performance'}>
          <span className={`font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted">Performance</span>
        </button>
        <div className="flex-1" />
        <span className={`font-mono text-[9px] ${fps > 0 && fps < 40 ? 'text-danger' : 'text-accent'}`}>{fps ? `${fps} fps` : '—'}</span>
      </div>

      {!collapsed && (
        <>
          {/* Top line : host totals. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded bg-panel2/40 px-2 py-1 font-mono text-[9px] text-muted">
            <span>frame <span className="text-text">{fps ? (1000 / fps).toFixed(1) : '—'}</span> ms</span>
            <span>GPU <span className="text-text">{pct(stats.gpu)}</span></span>
            <span>VRAM <span className="text-text">{pct(stats.vram)}</span></span>
            <span>CPU <span className="text-text">{pct(stats.cpu)}</span></span>
            <span>RAM <span className="text-text">{pct(stats.ram)}</span></span>
          </div>

          {/* CPU frame budget : measured ms/frame per section. */}
          <div className="flex flex-col gap-0.5">
            <div className="flex items-baseline justify-between font-mono text-[8px] uppercase tracking-wide text-muted">
              <span>CPU per frame (ms)</span>
              <span>measured {cpuMeasured.toFixed(1)} / {budget.toFixed(1)} ms</span>
            </div>
            {CPU_ROWS.map((r) => {
              const ms = cpu[r.key] ?? 0
              if (ms < 0.02) return null
              return (
                <div key={r.key} className="flex items-center gap-1.5">
                  <span className="w-32 shrink-0 truncate font-mono text-[9px] text-muted" title={r.label}>{r.label}</span>
                  <Bar frac={ms / budget} danger={ms > budget} />
                  <span className="w-10 shrink-0 text-right font-mono text-[9px] text-text">{ms.toFixed(2)}</span>
                </div>
              )
            })}
          </div>

          {/* Memory : estimated VRAM per group. */}
          <div className="flex flex-col gap-0.5">
            <div className="flex items-baseline justify-between font-mono text-[8px] uppercase tracking-wide text-muted">
              <span>VRAM (estimated)</span>
              <span>~{(vramTotal / MB).toFixed(0)} MB · {renderW}×{renderH}</span>
            </div>
            {vram.map((g) => (
              <div key={g.name} className="flex items-center gap-1.5">
                <span className="w-32 shrink-0 truncate font-mono text-[9px] text-muted" title={g.name}>{g.name}</span>
                <Bar frac={g.bytes / vramMax} />
                <span className="w-10 shrink-0 text-right font-mono text-[9px] text-text">{(g.bytes / MB).toFixed(0)}</span>
              </div>
            ))}
          </div>

          {/* Active subsystems. */}
          <div className="flex flex-wrap gap-1 pt-0.5">
            {layers.map((L, i) => chip(Boolean(L && ((L.sourceA?.kind && L.sourceA.kind !== 'none') || (L.sourceB?.kind && L.sourceB.kind !== 'none'))), `L${i + 1}${L?.feedback ? '↺' : ''}`))}
            {nFeedback > 0 && chip(true, `${nFeedback} feedback`)}
            {srcCount('video') > 0 && chip(true, `${srcCount('video')} video`)}
            {collageCount > 0 && chip(true, `${collageCount} collage`)}
            {srcCount('capture') > 0 && chip(true, `${srcCount('capture')} capture`)}
            {srcCount('hive') > 0 && chip(true, 'HIVE in')
            }
            {fxCount > 0 && chip(true, `${fxCount} master FX`)}
            {chip(depthMode !== 'off', 'depth')}
            {chip(surfaceActive, 'metasurface')}
            {chip(ndi, 'NDI')}
            {chip(spout, 'Spout')}
            {chip(hiveOut, 'HIVE out')}
            {chip(lights.enabled, 'lights')}
            {chip(sonify.on, `Sonify ${soniVoices || 0}v`)}
            {chip(audioEnabled, 'audio')}
            {chip(audioMonitor, 'monitor')}
            {chip(audioDenoise, 'denoise')}
            {chip(body.enabled, `body ${[body.hands && 'H', body.pose && 'P', body.face && 'F'].filter(Boolean).join('') || '—'}`)}
            {chip(!!midiOut && midiClock, 'MIDI clock')}
            {chip(recording, 'REC')}
          </div>
          <p className="font-mono text-[8px] leading-tight text-muted">
            CPU is measured per section ; VRAM is estimated from the app’s allocations (render size dominates). Whole-GPU % needs an NVIDIA card, else “—”.
          </p>
        </>
      )}
    </div>
  )
}
