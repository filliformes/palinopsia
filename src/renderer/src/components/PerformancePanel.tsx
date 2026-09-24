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
const CPU_ROWS: Array<{ key: string; label: string; desc: string }> = [
  { key: 'render', label: 'Render (GPU dispatch)', desc: 'CPU time spent issuing the whole composition’s GPU draw calls this frame — every layer, source, FX rack, feedback, master + finishing, warp. This is the dispatch cost; the GPU then executes the work (its share shows in the whole-GPU % up top).' },
  { key: 'output', label: 'Output stream', desc: 'Reading the finished frame back and posting it to the output / projector window. Only non-zero while an output window is open ; grows with resolution.' },
  { key: 'vision', label: 'Vision return', desc: 'Downsampling the composited image and reducing it to features (brightness, motion, edges…) that drive `vision` / `homeostat` modulators and stream out over OSC. Only runs when something reads them.' },
  { key: 'depth', label: 'Depth engine', desc: 'Running the monocular depth estimate on a low-res readback (~11 Hz). Only in Depth : estimate mode (used by anaglyph / parallax / depth-shadow).' },
  { key: 'lights', label: 'Light output', desc: 'Mip-averaging the image into a zone grid and shipping it to the ArtNet/DMX · WLED sender. Only when Lights are on ; throttled to the light fps.' },
  { key: 'sonify', label: 'Sonify', desc: 'Sampling the image taps that feed the Sonify sound engine (image → sound). The voices themselves run on the audio thread.' },
  { key: 'audio', label: 'Audio ingest', desc: 'Analysing the audio input into level / flux / transient / bands / pitch for audio-reactivity (plus the denoiser + monitor graph).' },
  { key: 'modulation', label: 'Modulation', desc: 'Ticking the 8 modulator slots + Meta knobs and applying the mod-matrix onto the composition. Cheap, but always running — this is the row you saw flicker before.' },
  { key: 'mediapipe', label: 'Embodied (MediaPipe)', desc: 'Hand / Pose / Face landmark detection on the embodied-control camera. Runs on its own loop ; Face is the heaviest.' }
]
const VRAM_DESC: Record<string, string> = {
  'Composition core': 'The base render buffers at the current resolution : ping-pong, present, background and master. Scales directly with composition size × render scale — the biggest single driver.',
  'Layer buffers': 'Per-active-layer intermediate framebuffers at render resolution (source composite + FX scratch).',
  'Feedback buffers': 'Full-resolution 16-bit ping-pong buffers for each layer with feedback (trails). The heaviest per-layer cost — ~2× a normal buffer, per feedback layer.',
  'Source textures': 'Decoded textures for video / capture / HIVE / Assemble sources. Nominal estimate (the app can’t always read a clip’s exact resolution).',
  'Collage pool': 'The pool of clips a Collage source decodes simultaneously. Nominal estimate ; a big 4K pool is the heaviest item.',
  'Embodied (MediaPipe)': 'GPU memory for the active hand / pose / face models.'
}

interface SlotLike { kind: string; shaderId: string | null }
interface LayerLike { sourceA: SlotLike; sourceB: SlotLike | null; feedback: boolean; fx: unknown[] }

// Always returns the SAME groups in the SAME order (0 bytes when absent), so the
// panel never reflows as sources/feedback come and go — only the values move.
function estimateVram(renderPx: number, layers: LayerLike[], hands: boolean, pose: boolean, face: boolean): Array<{ name: string; bytes: number }> {
  const rgba8 = renderPx * 4, rgba16 = renderPx * 8
  const NOMINAL = 1920 * 1080 * 4 // an unmeasured source texture's rough footprint
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
  const nT = (hands ? 1 : 0) + (pose ? 1 : 0) + (face ? 1 : 0)
  return [
    { name: 'Composition core', bytes: 6 * rgba8 }, // base ping-pong + present + bg + master
    { name: 'Layer buffers', bytes: layerBytes },
    { name: 'Feedback buffers', bytes: fbBytes },
    { name: 'Source textures', bytes: srcBytes },
    { name: 'Collage pool', bytes: collage },
    { name: 'Embodied (MediaPipe)', bytes: nT ? (20 + 15 * nT) * MB : 0 }
  ]
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
  const spout = useStore((s) => s.shareActive)
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

  const chip = (on: boolean, label: string, title: string): JSX.Element => (
    <span
      title={`${title}${on ? '' : ' — off'}`}
      className={`cursor-help rounded px-1.5 py-0.5 font-mono text-[9px] ${on ? 'bg-accent/20 text-accent' : 'bg-panel2/60 text-muted/60'}`}
    >
      {label}
    </span>
  )
  const pct = (v: number | null): string => (v == null ? '—' : `${Math.round(v)}%`)

  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-t border-border bg-panel px-3 py-1.5 text-[11px]">
      <div className="flex min-w-0 items-center gap-2">
        <button onClick={() => toggleSection('perf')} className="flex shrink-0 items-center gap-1.5" title="Live processing load, per section. Click to expand / collapse. Hover any row, number or chip inside for what it measures.">
          <span className={`font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted">Performance</span>
        </button>
        <div className="flex-1" />
        <span className={`cursor-help font-mono text-[9px] ${fps > 0 && fps < 40 ? 'text-danger' : 'text-accent'}`} title="Frames per second of the composition render (rolling average). Red below 40.">{fps ? `${fps} fps` : '—'}</span>
      </div>

      {!collapsed && (
        <>
          {/* Top line : host totals. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded bg-panel2/40 px-2 py-1 font-mono text-[9px] text-muted">
            <span className="cursor-help" title="Milliseconds per rendered frame (1000 ÷ FPS). Under 16.7 ms = 60 fps ; above it you are dropping frames.">frame <span className="text-text">{fps ? (1000 / fps).toFixed(1) : '—'}</span> ms</span>
            <span className="cursor-help" title="Whole-GPU utilisation, percent. Read from the graphics driver (NVIDIA only, via nvidia-smi) — shows “—” on other GPUs.">GPU <span className="text-text">{pct(stats.gpu)}</span></span>
            <span className="cursor-help" title="Whole-GPU video memory in use, percent of the card’s total (NVIDIA only). This is the real number the estimated VRAM breakdown below approximates.">VRAM <span className="text-text">{pct(stats.vram)}</span></span>
            <span className="cursor-help" title="Palinopsia’s own CPU usage across all its processes, as a percent of one core (so it can exceed 100% on multi-core work).">CPU <span className="text-text">{pct(stats.cpu)}</span></span>
            <span className="cursor-help" title="Palinopsia’s RAM footprint as a percent of total system memory.">RAM <span className="text-text">{pct(stats.ram)}</span></span>
          </div>

          {/* CPU frame budget : measured ms/frame per section. */}
          <div className="flex flex-col gap-0.5">
            <div className="flex cursor-help items-baseline justify-between font-mono text-[8px] uppercase tracking-wide text-muted" title="CPU milliseconds spent per frame, measured per section (JS dispatch + readbacks + audio / MediaPipe work). The right-hand figure is the sum of the measured sections against the 16.7 ms = 60 fps budget. Hover any row for what it covers.">
              <span>CPU per frame (ms)</span>
              <span>measured {cpuMeasured.toFixed(1)} / {budget.toFixed(1)} ms</span>
            </div>
            {CPU_ROWS.map((r) => {
              const ms = cpu[r.key] ?? 0
              // Always rendered (fixed layout : idle rows show 0.00, never vanish).
              return (
                <div key={r.key} className="flex cursor-help items-center gap-1.5" title={`${r.label} — ${r.desc}`}>
                  <span className="w-32 shrink-0 truncate font-mono text-[9px] text-muted">{r.label}</span>
                  <Bar frac={ms / budget} danger={ms > budget} />
                  <span className="w-14 shrink-0 text-right font-mono text-[9px] text-text">{ms.toFixed(2)} ms</span>
                </div>
              )
            })}
          </div>

          {/* Memory : estimated VRAM per group. */}
          <div className="flex flex-col gap-0.5">
            <div className="flex cursor-help items-baseline justify-between font-mono text-[8px] uppercase tracking-wide text-muted" title="Estimated GPU video memory, in megabytes, computed from the app’s own allocations (render size dominates and is accurate ; source textures are nominal). The right-hand figure is the total and the current render resolution. Hover any row for what it covers.">
              <span>VRAM (estimated)</span>
              <span>~{(vramTotal / MB).toFixed(0)} MB · {renderW}×{renderH}</span>
            </div>
            {vram.map((g) => (
              <div key={g.name} className="flex cursor-help items-center gap-1.5" title={`${g.name} — ${VRAM_DESC[g.name] ?? ''}`}>
                <span className="w-32 shrink-0 truncate font-mono text-[9px] text-muted">{g.name}</span>
                <Bar frac={g.bytes / vramMax} />
                <span className="w-14 shrink-0 text-right font-mono text-[9px] text-text">{(g.bytes / MB).toFixed(0)} MB</span>
              </div>
            ))}
          </div>

          {/* Active subsystems. */}
          {/* Fixed chip set : every chip always rendered (greyed when off), so the
              grid never reflows — only the highlight state changes. */}
          <div className="cursor-help font-mono text-[8px] uppercase tracking-wide text-muted" title="Status of every subsystem : highlighted = on, grey = off. These are indicators, not buttons — hover one for what it is and its footprint.">Active subsystems</div>
          <div className="flex flex-wrap gap-1 pt-0.5">
            {layers.map((L, i) => chip(Boolean(L && ((L.sourceA?.kind && L.sourceA.kind !== 'none') || (L.sourceB?.kind && L.sourceB.kind !== 'none'))), `L${i + 1}${L?.feedback ? '↺' : ''}`, `Layer ${i + 1} : lit when it carries a source. ↺ = feedback (trails) on, which adds a full-res buffer + extra passes.`))}
            {chip(nFeedback > 0, `feedback ${nFeedback}`, 'How many layers have feedback (trails) enabled. Each one is the heaviest per-layer VRAM + GPU cost.')}
            {chip(srcCount('video') > 0, `video ${srcCount('video')}`, 'Active video-clip sources across all layers. Each is a decoder + a texture ; several 4K clips is a top RAM cost.')}
            {chip(collageCount > 0, `collage ${collageCount}`, 'Collage sources active. A Collage decodes a POOL of clips simultaneously — the heaviest single memory item.')}
            {chip(srcCount('capture') > 0, `capture ${srcCount('capture')}`, 'Webcam / screen-capture sources active (a MediaStream → texture each).')}
            {chip(srcCount('hive') > 0, 'HIVE in', 'A HIVE live-in source is active (HEVC network stream decoded into a layer).')}
            {chip(fxCount > 0, `master FX ${fxCount}`, 'Effects in the master FX rack (stacked full-frame passes applied to the whole composition).')}
            {chip(depthMode !== 'off', 'depth', 'The Depth engine is on (estimate = the monocular model runs ~11 Hz ; feeds anaglyph / parallax / depth-shadow).')}
            {chip(surfaceActive, 'metasurface', 'The Metasurface is active : it renders a live blend of the placed scenes at the cursor, multiplying render cost by the blended count.')}
            {chip(ndi, 'NDI', 'NDI output is on : the full frame is read back and sent over the network each frame.')}
            {chip(spout, window.api.platform === 'darwin' ? 'Syphon' : 'Spout', 'Texture sharing is on : the frame is shared with other apps on this computer each frame.')}
            {chip(hiveOut, 'HIVE out', 'HIVE output is on : the frame is HEVC-encoded and fanned out over TCP.')}
            {chip(lights.enabled, 'lights', 'Light output (ArtNet/DMX · WLED) is on : the image is reduced to a zone grid and sent over UDP.')}
            {chip(sonify.on, `Sonify ${soniVoices}v`, 'The Sonify sound engine (image → sound) is on. The number is how many voices are active.')}
            {chip(audioEnabled, 'audio', 'Audio ingest is on (analysing an input for reactivity).')}
            {chip(audioMonitor, 'monitor', 'Input monitoring / passthrough is on (you hear the input through the output).')}
            {chip(audioDenoise, 'denoise', 'The USB-noise denoiser is on (the learned notch filter).')}
            {chip(body.enabled, `body ${[body.hands && 'H', body.pose && 'P', body.face && 'F'].filter(Boolean).join('') || '—'}`, 'Embodied control is on. H / P / F = which trackers run (Hands / Pose / Face). Face is the heaviest.')}
            {chip(!!midiOut && midiClock, 'MIDI clock', 'Opsia is sending MIDI clock + transport to the selected output device (e.g. the Move).')}
            {chip(recording, 'REC', 'A recording is in progress (the output is being encoded to disk — heavy CPU in the main process).')}
          </div>
          <p className="font-mono text-[8px] leading-tight text-muted">
            Hover any label, number or chip for what it measures. CPU is measured per section (ms/frame) ; VRAM is estimated from the app’s allocations (render size dominates) ; whole-GPU % needs an NVIDIA card, else “—”. The chips are status indicators, not buttons.
          </p>
        </>
      )}
    </div>
  )
}
