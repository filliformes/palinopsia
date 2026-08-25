// Sonify (key S) : the image-to-sound page. Full-page takeover like Output —
// the live composite mirrored large with the sound PROBES drawn on it (the
// Spectra scan line, the Orbit ellipse, the Flow motion dots), because the
// probe is the instrument. Three voice strips (Spectra · Orbit · Flow) +
// master with an always-on limiter, a global note quantizer (root + scale,
// per-voice snap), two image taps (master or any layer), and an output-device
// picker. The sound engine lives in audio/sonify.ts (AudioWorklet).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import type { ModTarget, SonifyModParam } from '@shared/types'
import { suggestSonify } from '../audio/autoSonify'
import { SONI_SCALES, sonifyEngine, type SoniConfig } from '../audio/sonify'
import { modTargetKey, useStore } from '../store'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const TAU = 6.283185307179586
/** Breathing rubato warp of a linear sweep phase (mirror of the worklet's warpPace). */
function warpPace(lin: number, pace: number): number {
  return pace < 0.005 ? lin : lin - (pace * Math.sin(lin * TAU)) / TAU
}
/** Paint the reading path of a scanning voice at (paced) sweep phase `pos`. */
function drawScanPath(g: CanvasRenderingContext2D, path: number, pos: number, w: number, h: number): void {
  g.beginPath()
  if (path === 1) { g.moveTo(0, pos * h); g.lineTo(w, pos * h) } // vertical row
  else if (path === 2) { // radial ray from centre
    const a = pos * TAU
    g.moveTo(0.5 * w, 0.5 * h)
    g.lineTo((0.5 + 0.48 * Math.cos(a)) * w, (0.5 + 0.48 * Math.sin(a)) * h)
  } else if (path === 3) { // spiral arm
    for (let k = 0; k <= 48; k++) {
      const pp = k / 48, a = pos * TAU + pp * TAU * 2.5, r = pp * 0.48
      const px = (0.5 + r * Math.cos(a)) * w, py = (0.5 + r * Math.sin(a)) * h
      if (k === 0) g.moveTo(px, py); else g.lineTo(px, py)
    }
  } else { g.moveTo(pos * w, 0); g.lineTo(pos * w, h) } // horizontal column
  g.stroke()
}

function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="w-14 shrink-0 font-mono text-[9px] uppercase text-muted">{label}</span>
      {children}
    </div>
  )
}

function Slider({
  label, value, min, max, step = 0.01, neutral, fmt, onChange, title
}: {
  label: string; value: number; min: number; max: number; step?: number
  neutral?: number; fmt?: (v: number) => string; onChange: (v: number) => void; title?: string
}): JSX.Element {
  return (
    <Row label={label}>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => neutral !== undefined && onChange(neutral)}
        className="min-w-0 flex-1 accent-accent"
        title={title ?? `${label} ${fmt ? fmt(value) : value.toFixed(2)}`}
      />
      <span className="w-12 shrink-0 text-right font-mono text-[9px] text-muted">
        {fmt ? fmt(value) : value.toFixed(2)}
      </span>
    </Row>
  )
}

function TapSelect({ cfg, voice, onChange }: {
  cfg: SoniConfig; voice: { tap: number }; onChange: (tap: number) => void
}): JSX.Element {
  const name = (t: number): string => {
    const tp = cfg.taps[t]
    return tp.kind === 'master' ? 'master' : `layer ${tp.layer + 1}`
  }
  return (
    <Row label="listen">
      <select
        className="input select-compact min-w-0 flex-1 text-[10px]"
        value={voice.tap}
        onChange={(e) => onChange(Number(e.target.value))}
        title="Which image tap this voice sonifies (taps are configured below the mirror)"
      >
        <option value={0}>tap A · {name(0)}</option>
        <option value={1}>tap B · {name(1)}</option>
      </select>
    </Row>
  )
}

/** M-binding chip for a sonify probe/pitch param : shows the bound modulator
 *  (M1..M8) or a hollow M; click opens the mini assign panel below. */
function ModChip({ param, open, onOpen }: {
  param: SonifyModParam; open: boolean; onOpen: (p: SonifyModParam) => void
}): JSX.Element {
  const matrix = useStore((st) => st.composition.modMatrix)
  const key = modTargetKey({ kind: 'sonify', param })
  const a = matrix.find((x) => modTargetKey(x.target) === key)
  return (
    <button
      onClick={() => onOpen(param)}
      className={`shrink-0 rounded px-1 py-0.5 font-mono text-[9px] transition-colors ${
        a ? 'bg-accent/25 text-accent ring-1 ring-accent' : open ? 'bg-panel3 text-text ring-1 ring-border' : 'bg-panel3/60 text-muted hover:text-text'
      }`}
      title={a ? `Modulated by M${a.mod + 1} (depth ${a.depth.toFixed(2)}) : click to edit` : 'Bind a modulator to this parameter'}
    >
      {a ? `M${a.mod + 1}` : 'M'}
    </button>
  )
}

const PARAM_LABELS: Record<SonifyModParam, string> = {
  spectraX: 'Spectra scan column', filterX: 'Filter scan column',
  orbitX: 'Orbit centre x', orbitY: 'Orbit centre y', orbitR: 'Orbit radius', orbitPitch: 'Orbit pitch',
  rasterX: 'Raster rect x', rasterY: 'Raster rect y', rasterW: 'Raster rect width', rasterH: 'Raster rect height',
  rasterPitch: 'Raster pitch'
}

/** Mini assign panel : modulator select + depth + mode + clear, writing the
 *  same mod-matrix the Inspector's M buttons use. */
function AssignMini({ param, onClose }: { param: SonifyModParam; onClose: () => void }): JSX.Element {
  const matrix = useStore((st) => st.composition.modMatrix)
  const assignMod = useStore((st) => st.assignMod)
  const removeAssignment = useStore((st) => st.removeAssignment)
  const setAssignmentDepth = useStore((st) => st.setAssignmentDepth)
  const setAssignmentMode = useStore((st) => st.setAssignmentMode)
  const target: ModTarget = { kind: 'sonify', param }
  const key = modTargetKey(target)
  const a = matrix.find((x) => modTargetKey(x.target) === key)
  return (
    <section className="rounded border border-accent/40 bg-panel2 px-2 py-1.5">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[10px] font-semibold">modulate</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-muted">{PARAM_LABELS[param]}</span>
        <button onClick={onClose} className="text-[11px] text-muted hover:text-text" title="Close">x</button>
      </div>
      <div className="flex items-center gap-1.5">
        <select
          className="input select-compact text-[10px]"
          value={a ? a.mod : -1}
          onChange={(e) => {
            const mi = Number(e.target.value)
            if (a) removeAssignment(a.id)
            if (mi >= 0 && !assignMod(mi, target, a?.depth ?? 0.5, a?.mode ?? 'replace')) {
              // matrix cap reached : nothing to do, the select snaps back
            }
          }}
          title="Which modulator drives this parameter"
        >
          <option value={-1}>off</option>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((m) => <option key={m} value={m}>M{m + 1}</option>)}
        </select>
        <input
          type="range" min={-1} max={1} step={0.01} value={a?.depth ?? 0.5}
          disabled={!a}
          onChange={(e) => a && setAssignmentDepth(a.id, Number(e.target.value))}
          className="min-w-0 flex-1 accent-accent"
          title={`Depth ${(a?.depth ?? 0.5).toFixed(2)} (negative inverts)`}
        />
        <button
          disabled={!a}
          onClick={() => a && setAssignmentMode(a.id, a.mode === 'multiply' ? 'replace' : 'multiply')}
          className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${a?.mode === 'multiply' ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
          title="Replace = swing around the base value; Multiply = VCA-scale it"
        >{a?.mode === 'multiply' ? 'mult' : 'swing'}</button>
      </div>
    </section>
  )
}

function VoiceShell({ title, on, hint, onToggle, children }: {
  title: string; on: boolean; hint: string; onToggle: () => void; children: ReactNode
}): JSX.Element {
  return (
    <section className={`rounded border px-2 py-1.5 transition-colors ${on ? 'border-accent/40 bg-panel2' : 'border-border bg-panel2/40'}`}>
      <div className="mb-1 flex items-center gap-2">
        <button
          onClick={onToggle}
          className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
            on ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted hover:text-text'
          }`}
          title={hint}
        >
          {on ? '● on' : '○ off'}
        </button>
        <span className="text-[11px] font-semibold">{title}</span>
        <span className="min-w-0 flex-1 truncate text-[9px] text-muted">{hint}</span>
      </div>
      {on && <div className="flex flex-col gap-1">{children}</div>}
    </section>
  )
}

export function SonifyPage({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null> }): JSX.Element {
  const setOpen = useStore((s) => s.setSonifyPageOpen)
  const cfg = useStore((s) => s.sonify)
  const setSonify = useStore((s) => s.setSonify)
  const bpm = useStore((s) => s.composition.bpm)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const mirrorRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLCanvasElement | null>(null)
  const meterRef = useRef<HTMLDivElement | null>(null)
  const dragging = useRef<'line' | 'orbit' | 'radius' | 'rect' | 'rectsize' | 'fline' | null>(null)
  const [devices, setDevices] = useState<Array<{ id: string; label: string }>>([])
  const [assign, setAssign] = useState<SonifyModParam | null>(null)
  const chip = (p: SonifyModParam): JSX.Element => (
    <ModChip param={p} open={assign === p} onOpen={(x) => setAssign(assign === x ? null : x)} />
  )

  const set = (next: SoniConfig): void => setSonify(next)
  const patch = (p: Partial<SoniConfig>): void => set({ ...cfg, ...p })
  const pv = <K extends 'spectra' | 'orbit' | 'flow' | 'events' | 'raster' | 'sstv' | 'filter' | 'chord'>(k: K, p: Partial<SoniConfig[K]>): void =>
    set({ ...cfg, [k]: { ...cfg[k], ...p } })
  const pfx = (p: Partial<SoniConfig['fx']>): void => set({ ...cfg, fx: { ...cfg.fx, ...p } })

  // Live mirror of the composite (same pattern as the Output page).
  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    let stream: MediaStream | null = null
    try {
      stream = canvas.captureStream(30)
      video.srcObject = stream
      void video.play().catch(() => {})
    } catch { /* mirror is optional */ }
    return () => {
      stream?.getTracks().forEach((t) => t.stop())
      if (video) video.srcObject = null
    }
  }, [canvasRef])

  // Output devices for the sink picker.
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.().then((ds) => {
      setDevices(
        ds.filter((d) => d.kind === 'audiooutput')
          .map((d, i) => ({ id: d.deviceId, label: d.label || `output ${i + 1}` }))
      )
    }).catch(() => {})
  }, [])

  // Overlay painter : flow dots + live sweep line + meter, straight from the
  // engine each rAF (no React re-renders).
  useEffect(() => {
    let raf = 0
    let sweepPhase = cfg.spectra.x
    let fSweep = cfg.filter.x
    let tvRow = 0
    let last = performance.now()
    const paint = (): void => {
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      const c = overlayRef.current
      const st = useStore.getState().sonify
      const lp = sonifyEngine.isRunning() ? sonifyEngine.liveProbes : ({} as Record<string, number>)
      if (c) {
        const w = c.width, h = c.height
        const g = c.getContext('2d')!
        g.clearRect(0, 0, w, h)
        // Flow dots
        if (st.on && st.flow.on) {
          const dots = sonifyEngine.flowDots
          g.fillStyle = 'rgba(255,255,255,0.75)'
          for (let i = 0; i + 2 < dots.length; i += 3) {
            const r = 2 + dots[i + 2] * 6
            g.beginPath()
            g.arc(dots[i] * w, dots[i + 1] * h, r, 0, 6.2832)
            g.fill()
          }
        }
        // Event onsets : a ring at each note the picture just plucked
        if (st.on && st.events.on) {
          const dots = sonifyEngine.eventDots
          g.strokeStyle = 'rgba(255,210,120,0.9)'
          g.lineWidth = 1.5
          for (let i = 0; i + 2 < dots.length; i += 3) {
            const r = 3 + dots[i + 2] * 9
            g.beginPath()
            g.arc(dots[i] * w, dots[i + 1] * h, r, 0, 6.2832)
            g.stroke()
          }
        }
        // Spectra reading path (mirror of the worklet : same rate, pace + path)
        if (st.on && st.spectra.on) {
          if (st.spectra.sweepOn) sweepPhase = (sweepPhase + st.spectra.sweepHz * dt) % 1
          else sweepPhase = lp.spectraX ?? st.spectra.x
          const pos = st.spectra.sweepOn ? warpPace(sweepPhase, st.spectra.pace ?? 0) : sweepPhase
          g.strokeStyle = 'rgba(255,255,255,0.85)'
          g.lineWidth = 1.5
          drawScanPath(g, st.spectra.path ?? 0, pos, w, h)
        }
        // Filter reading path (its own hue, mirrors the filter sweep)
        if (st.on && st.filter.on) {
          if (st.filter.sweepOn) fSweep = (fSweep + st.filter.sweepHz * dt) % 1
          else fSweep = lp.filterX ?? st.filter.x
          const pos = st.filter.sweepOn ? warpPace(fSweep, st.filter.pace ?? 0) : fSweep
          g.strokeStyle = 'rgba(120,200,255,0.8)'
          g.lineWidth = 1.5
          drawScanPath(g, st.filter.path ?? 0, pos, w, h)
        }
        // Raster probe rect
        if (st.on && st.raster.on) {
          g.strokeStyle = 'rgba(120,255,160,0.85)'
          g.lineWidth = 1.5
          const rx = lp.rasterX ?? st.raster.rx, ry = lp.rasterY ?? st.raster.ry
          const rw = lp.rasterW ?? st.raster.rw, rh = lp.rasterH ?? st.raster.rh
          g.strokeRect(rx * w, ry * h, rw * w, rh * h)
          g.fillStyle = 'rgba(120,255,160,0.85)'
          g.fillRect((rx + rw) * w - 4, (ry + rh) * h - 4, 8, 8)
        }
        // Transmission scan row (animates downward at the line rate)
        if (st.on && st.sstv.on) {
          tvRow = (tvRow + st.sstv.lineHz * dt / 96) % 1
          g.strokeStyle = 'rgba(255,120,200,0.8)'
          g.lineWidth = 1.5
          g.beginPath()
          g.moveTo(0, tvRow * h)
          g.lineTo(w, tvRow * h)
          g.stroke()
        }
        // Orbit ellipse
        if (st.on && st.orbit.on) {
          g.strokeStyle = 'rgba(255,180,80,0.9)'
          g.lineWidth = 1.5
          g.beginPath()
          const ocx = lp.orbitX ?? st.orbit.cx, ocy = lp.orbitY ?? st.orbit.cy, orr = lp.orbitR ?? st.orbit.rx
          g.ellipse(ocx * w, ocy * h, Math.max(2, orr * w), Math.max(2, orr * h), 0, 0, 6.2832)
          g.stroke()
          g.fillStyle = 'rgba(255,180,80,0.9)'
          g.beginPath()
          g.arc(ocx * w, ocy * h, 3, 0, 6.2832)
          g.fill()
        }
      }
      // Meter
      if (meterRef.current) {
        const p = Math.min(1, sonifyEngine.meterPeak)
        meterRef.current.style.width = `${Math.round(p * 100)}%`
        meterRef.current.style.background = sonifyEngine.meterLim < 0.95 ? 'rgb(230,120,60)' : 'rgb(120,200,140)'
      }
      raf = requestAnimationFrame(paint)
    }
    raf = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(raf)
  }, [cfg.spectra.sweepOn, cfg.spectra.x])

  // Probe dragging on the mirror : scan line / orbit centre / orbit radius.
  const posFrom = (e: ReactPointerEvent): [number, number] => {
    const r = mirrorRef.current!.getBoundingClientRect()
    return [
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
    ]
  }
  const onPointerDown = (e: ReactPointerEvent): void => {
    const [x, y] = posFrom(e)
    // grab priority : raster corner → raster rect → orbit centre → orbit edge
    // → held scan lines. The probes are the instrument.
    if (cfg.raster.on) {
      const cx2 = cfg.raster.rx + cfg.raster.rw, cy2 = cfg.raster.ry + cfg.raster.rh
      if (Math.abs(x - cx2) < 0.02 && Math.abs(y - cy2) < 0.03) dragging.current = 'rectsize'
      else if (x > cfg.raster.rx && x < cx2 && y > cfg.raster.ry && y < cy2) dragging.current = 'rect'
    }
    if (!dragging.current && cfg.orbit.on) {
      const dc = Math.hypot(x - cfg.orbit.cx, y - cfg.orbit.cy)
      if (dc < 0.03) { dragging.current = 'orbit' }
      else if (Math.abs(dc - Math.max(cfg.orbit.rx, cfg.orbit.ry)) < 0.04) { dragging.current = 'radius' }
    }
    if (!dragging.current && cfg.filter.on && !cfg.filter.sweepOn && Math.abs(x - cfg.filter.x) < 0.02) dragging.current = 'fline'
    if (!dragging.current && cfg.spectra.on && !cfg.spectra.sweepOn) dragging.current = 'line'
    if (!dragging.current && cfg.orbit.on) dragging.current = 'orbit'
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    onPointerMove(e)
  }
  const onPointerMove = (e: ReactPointerEvent): void => {
    if (!dragging.current) return
    const [x, y] = posFrom(e)
    if (dragging.current === 'line') pv('spectra', { x })
    else if (dragging.current === 'fline') pv('filter', { x })
    else if (dragging.current === 'orbit') pv('orbit', { cx: x, cy: y })
    else if (dragging.current === 'radius') {
      const r = Math.max(0.02, Math.hypot(x - cfg.orbit.cx, y - cfg.orbit.cy))
      pv('orbit', { rx: r, ry: r })
    } else if (dragging.current === 'rect') {
      pv('raster', {
        rx: Math.max(0, Math.min(1 - cfg.raster.rw, x - cfg.raster.rw / 2)),
        ry: Math.max(0, Math.min(1 - cfg.raster.rh, y - cfg.raster.rh / 2))
      })
    } else if (dragging.current === 'rectsize') {
      pv('raster', {
        rw: Math.max(0.04, Math.min(1 - cfg.raster.rx, x - cfg.raster.rx)),
        rh: Math.max(0.03, Math.min(1 - cfg.raster.ry, y - cfg.raster.ry))
      })
    }
  }
  const endDrag = (): void => { dragging.current = null }

  const fmtHz = (v: number): string => (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + 'Hz'
  const fmtNote = (n: number): string => `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-3 py-2">
        <span className="text-[13px] font-semibold">Sonify</span>
        <button
          onClick={() => {
            const comp = useStore.getState().composition
            setSonify(suggestSonify(comp, cfg))
          }}
          className="rounded px-2 py-0.5 font-mono text-[11px] text-muted ring-1 ring-border transition-colors hover:text-accent hover:ring-accent/60"
          title="Auto-voice : read the session's registers and pick the fitting voices — glitch → Raster, motion → Flow, feedback → Orbit, line-work → Spectra, scan → Transmission, atmosphere → Filter. The strongest voice taps the layer that earned it. Your key, gains and probes are kept."
        >
          ✨ auto
        </button>
        <button
          onClick={() => patch({ on: !cfg.on })}
          className={`rounded px-2 py-0.5 font-mono text-[11px] transition-colors ${
            cfg.on ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted hover:text-text'
          }`}
          title="Sound engine on/off (the image keeps rendering either way)"
        >
          {cfg.on ? '◉ sound on' : '○ sound off'}
        </button>
        {/* Master + meter */}
        <span className="font-mono text-[9px] uppercase text-muted">master</span>
        <input
          type="range" min={0} max={1} step={0.01} value={cfg.master}
          onChange={(e) => patch({ master: Number(e.target.value) })}
          onDoubleClick={() => patch({ master: 0.8 })}
          className="w-28 accent-accent"
          title={`Master gain ${cfg.master.toFixed(2)} (a peak limiter always guards the output)`}
        />
        <div className="h-2 w-24 overflow-hidden rounded bg-panel3" title="Output level (orange = the limiter is working)">
          <div ref={meterRef} className="h-full w-0" />
        </div>
        {/* Quantizer */}
        <span className="ml-2 font-mono text-[9px] uppercase text-muted">key</span>
        <select
          className="input select-compact text-[10px]"
          value={cfg.root}
          onChange={(e) => patch({ root: Number(e.target.value) })}
          title="Quantizer root note"
        >
          {NOTE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
        </select>
        <select
          className="input select-compact text-[10px]"
          value={cfg.scale}
          onChange={(e) => patch({ scale: e.target.value as SoniConfig['scale'] })}
          title="Quantizer scale (each voice can snap to it or run free)"
        >
          {SONI_SCALES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {/* Output device */}
        <select
          className="input select-compact max-w-[180px] text-[10px]"
          value={cfg.sinkId}
          onChange={(e) => patch({ sinkId: e.target.value })}
          title="Audio output device"
        >
          <option value="">default output</option>
          {devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        <div className="flex-1" />
        <span className="font-mono text-[9px] text-muted">S / Esc closes</span>
        <button onClick={() => setOpen(false)} className="rounded px-2 py-0.5 text-[12px] text-muted hover:text-text" title="Close (Esc)">✕</button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Mirror + probes */}
        <div className="flex min-w-0 flex-1 flex-col p-3">
          <div
            ref={mirrorRef}
            className="relative min-h-0 flex-1 cursor-crosshair overflow-hidden rounded border border-border bg-black"
            style={{ touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            title="Drag the probes : the scan line (Spectra, when not sweeping), the orbit centre, or its edge (radius)"
          >
            <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-contain" />
            <canvas ref={overlayRef} width={960} height={540} className="pointer-events-none absolute inset-0 h-full w-full" />
          </div>
          {/* Taps */}
          <div className="mt-2 flex items-center gap-3">
            {([0, 1] as const).map((t) => (
              <div key={t} className="flex items-center gap-1.5">
                <span className="font-mono text-[9px] uppercase text-muted">tap {t === 0 ? 'A' : 'B'}</span>
                <select
                  className="input select-compact text-[10px]"
                  value={cfg.taps[t].kind === 'master' ? 'master' : `layer${cfg.taps[t].layer}`}
                  onChange={(e) => {
                    const v = e.target.value
                    const taps = [...cfg.taps] as SoniConfig['taps']
                    taps[t] = v === 'master' ? { kind: 'master', layer: 0 } : { kind: 'layer', layer: Number(v.slice(5)) }
                    patch({ taps })
                  }}
                  title="What this tap reads : the composited master output, or one layer's post-FX image"
                >
                  <option value="master">master output</option>
                  {[0, 1, 2, 3].map((l) => <option key={l} value={`layer${l}`}>layer {l + 1}</option>)}
                </select>
              </div>
            ))}
            <span className="min-w-0 flex-1 truncate text-[9px] text-muted">
              Voices listen to a tap; two taps keep readbacks cheap while letting voices sonify different images.
            </span>
          </div>
        </div>

        {/* Voice strips */}
        <aside className="flex w-[320px] shrink-0 flex-col gap-2 overflow-y-auto border-l border-border bg-panel px-3 py-2">
          {assign && <AssignMini param={assign} onClose={() => setAssign(null)} />}
          <VoiceShell
            title="Spectra" on={cfg.spectra.on}
            hint="the frame as a spectrogram : a column of partials sweeps or sits"
            onToggle={() => pv('spectra', { on: !cfg.spectra.on })}
          >
            <TapSelect cfg={cfg} voice={cfg.spectra} onChange={(tap) => pv('spectra', { tap })} />
            <Row label="sweep">
              <button
                onClick={() => pv('spectra', { sweepOn: !cfg.spectra.sweepOn })}
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.spectra.sweepOn ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title="Sweep the scan column (vOICe) or hold it still (drag the line on the mirror)"
              >{cfg.spectra.sweepOn ? 'sweeping' : 'held'}</button>
              <button
                onClick={() => pv('spectra', { sync: !cfg.spectra.sync })}
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.spectra.sync ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title={`Sync the sweep to the tempo (one sweep per bar @ ${bpm} BPM)`}
              >sync</button>
              <span className="ml-auto" />
              {chip('spectraX')}
            </Row>
            {!cfg.spectra.sync && cfg.spectra.sweepOn && (
              <Slider label="rate" value={cfg.spectra.sweepHz} min={0.02} max={4} neutral={0.25} fmt={(v) => v.toFixed(2) + 'Hz'} onChange={(v) => pv('spectra', { sweepHz: v })} />
            )}
            <Row label="path">
              <select
                className="input select-compact min-w-0 flex-1 text-[10px]"
                value={cfg.spectra.path ?? 0}
                onChange={(e) => pv('spectra', { path: Number(e.target.value) })}
                title="Reading path : how the scan traverses the frame (Aural Mirror) — a column swept across, a row swept down, a rotating ray, or a spiral"
              >
                <option value={0}>horizontal →</option>
                <option value={1}>vertical ↓</option>
                <option value={2}>radial ⟳</option>
                <option value={3}>spiral</option>
              </select>
            </Row>
            {cfg.spectra.sweepOn && (
              <Slider label="breathe" value={cfg.spectra.pace ?? 0} min={0} max={0.95} neutral={0} onChange={(v) => pv('spectra', { pace: v })} />
            )}
            <Slider label="contrast" value={cfg.spectra.gamma} min={0.5} max={4} neutral={1.8} onChange={(v) => pv('spectra', { gamma: v })} />
            <Slider label="breath" value={cfg.spectra.breath ?? 0} min={0} max={1} neutral={0} onChange={(v) => pv('spectra', { breath: v })} />
            <Row label="range">
              <select className="input select-compact text-[10px]" value={cfg.spectra.loOct} onChange={(e) => pv('spectra', { loOct: Math.min(Number(e.target.value), cfg.spectra.hiOct - 1) })} title="Lowest octave">
                {[0, 1, 2, 3, 4].map((o) => <option key={o} value={o}>oct {o}</option>)}
              </select>
              <span className="text-[9px] text-muted">→</span>
              <select className="input select-compact text-[10px]" value={cfg.spectra.hiOct} onChange={(e) => pv('spectra', { hiOct: Math.max(Number(e.target.value), cfg.spectra.loOct + 1) })} title="Highest octave">
                {[4, 5, 6, 7, 8].map((o) => <option key={o} value={o}>oct {o}</option>)}
              </select>
              <button
                onClick={() => pv('spectra', { quantize: !cfg.spectra.quantize })}
                className={`ml-auto rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.spectra.quantize ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title="Snap the partial rows onto the key/scale (Metasynth) or spread them freely (ANS)"
              >♪ scale</button>
            </Row>
            <Slider label="gain" value={cfg.spectra.gain} min={0} max={1} neutral={0.5} onChange={(v) => pv('spectra', { gain: v })} />
            <Slider label="pan" value={cfg.spectra.pan} min={-1} max={1} neutral={0} onChange={(v) => pv('spectra', { pan: v })} />
          </VoiceShell>

          <VoiceShell
            title="Orbit" on={cfg.orbit.on}
            hint="the frame as a waveform : an orbit reads pixels at audio rate"
            onToggle={() => pv('orbit', { on: !cfg.orbit.on })}
          >
            <TapSelect cfg={cfg} voice={cfg.orbit} onChange={(tap) => pv('orbit', { tap })} />
            <Row label="pitch">
              {cfg.orbit.quantize ? (
                <input
                  type="range" min={24} max={72} step={1} value={cfg.orbit.note}
                  onChange={(e) => pv('orbit', { note: Number(e.target.value) })}
                  className="min-w-0 flex-1 accent-accent"
                  title={`Note ${fmtNote(cfg.orbit.note)} (snapped to the key)`}
                />
              ) : (
                <input
                  type="range" min={0} max={1} step={0.001}
                  value={Math.log(cfg.orbit.freq / 30) / Math.log(2000 / 30)}
                  onChange={(e) => pv('orbit', { freq: 30 * Math.pow(2000 / 30, Number(e.target.value)) })}
                  className="min-w-0 flex-1 accent-accent"
                  title={`Free frequency ${fmtHz(cfg.orbit.freq)}`}
                />
              )}
              <span className="w-10 shrink-0 text-right font-mono text-[9px] text-muted">
                {cfg.orbit.quantize ? fmtNote(cfg.orbit.note) : fmtHz(cfg.orbit.freq)}
              </span>
              <button
                onClick={() => pv('orbit', { quantize: !cfg.orbit.quantize })}
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.orbit.quantize ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title="Snap the orbit pitch to the key/scale, or run free Hz"
              >♪</button>
            </Row>
            <Row label="shape">
              <select
                className="input select-compact min-w-0 flex-1 text-[10px]"
                value={cfg.orbit.ratio}
                onChange={(e) => pv('orbit', { ratio: Number(e.target.value) })}
                title="Orbit shape : the x:y frequency ratio (1 = ellipse, others = Lissajous)"
              >
                <option value={1}>circle 1:1</option>
                <option value={2}>lissajous 1:2</option>
                <option value={1.5}>lissajous 2:3</option>
                <option value={1.3333333}>lissajous 3:4</option>
                <option value={3}>lissajous 1:3</option>
              </select>
            </Row>
            <Slider label="radius" value={cfg.orbit.rx} min={0.02} max={0.5} neutral={0.25} onChange={(v) => pv('orbit', { rx: v, ry: v })} />
            <Slider label="drive" value={cfg.orbit.drive} min={0.2} max={4} neutral={1} onChange={(v) => pv('orbit', { drive: v })} />
            <Slider label="smooth" value={cfg.orbit.smooth} min={0} max={1} neutral={0.5} onChange={(v) => pv('orbit', { smooth: v })} />
            <Slider label="gain" value={cfg.orbit.gain} min={0} max={1} neutral={0.5} onChange={(v) => pv('orbit', { gain: v })} />
            <Slider label="pan" value={cfg.orbit.pan} min={-1} max={1} neutral={0} onChange={(v) => pv('orbit', { pan: v })} />
          </VoiceShell>

          <VoiceShell
            title="Flow" on={cfg.flow.on}
            hint="motion becomes a grain cloud : position pans, speed excites"
            onToggle={() => pv('flow', { on: !cfg.flow.on })}
          >
            <TapSelect cfg={cfg} voice={cfg.flow} onChange={(tap) => pv('flow', { tap })} />
            <Slider label="sense" value={cfg.flow.sense} min={0} max={1} neutral={0.4} onChange={(v) => pv('flow', { sense: v })} />
            <Slider label="density" value={cfg.flow.density} min={0} max={1} neutral={0.5} onChange={(v) => pv('flow', { density: v })} />
            <Slider label="grain" value={cfg.flow.dur} min={0.02} max={0.4} neutral={0.09} fmt={(v) => Math.round(v * 1000) + 'ms'} onChange={(v) => pv('flow', { dur: v })} />
            <Slider label="breath" value={cfg.flow.noise} min={0} max={1} neutral={0.15} onChange={(v) => pv('flow', { noise: v })} />
            <Slider label="colour" value={cfg.flow.colour ?? 0} min={0} max={1} neutral={0.6} onChange={(v) => pv('flow', { colour: v })} title="Colour → grain timbre : saturation brightens each grain, hue tints it (warm = rounder body, cool = shimmer)" />
            <Row label="range">
              <select className="input select-compact text-[10px]" value={cfg.flow.loOct} onChange={(e) => pv('flow', { loOct: Math.min(Number(e.target.value), cfg.flow.hiOct - 1) })} title="Lowest octave">
                {[1, 2, 3, 4].map((o) => <option key={o} value={o}>oct {o}</option>)}
              </select>
              <span className="text-[9px] text-muted">→</span>
              <select className="input select-compact text-[10px]" value={cfg.flow.hiOct} onChange={(e) => pv('flow', { hiOct: Math.max(Number(e.target.value), cfg.flow.loOct + 1) })} title="Highest octave">
                {[4, 5, 6, 7].map((o) => <option key={o} value={o}>oct {o}</option>)}
              </select>
              <button
                onClick={() => pv('flow', { quantize: !cfg.flow.quantize })}
                className={`ml-auto rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.flow.quantize ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title="Grains land on scale notes (a rain of pitches) or free frequencies"
              >♪ scale</button>
            </Row>
            <Slider label="gain" value={cfg.flow.gain} min={0} max={1} neutral={0.6} onChange={(v) => pv('flow', { gain: v })} />
          </VoiceShell>

          <VoiceShell
            title="Events" on={cfg.events.on}
            hint="edges & motion → plucked notes, pitched by height, panned by position"
            onToggle={() => pv('events', { on: !cfg.events.on })}
          >
            <TapSelect cfg={cfg} voice={cfg.events} onChange={(tap) => pv('events', { tap })} />
            <Row label="trigger">
              {(['spatial', 'motion', 'blend'] as const).map((mo) => (
                <button
                  key={mo}
                  onClick={() => pv('events', { mode: mo })}
                  className={`flex-1 rounded px-1.5 py-0.5 font-mono text-[9px] transition-colors ${
                    cfg.events.mode === mo ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted hover:text-text'
                  }`}
                  title={
                    mo === 'spatial'
                      ? 'Edges / strokes (Sobel) — fires on contours, works on a still image'
                      : mo === 'motion'
                        ? 'Frame difference — only what MOVES fires a note'
                        : 'Both — a moving edge is the strongest, so it dominates'
                  }
                >{mo}</button>
              ))}
            </Row>
            <Slider label="sense" value={cfg.events.sense} min={0} max={1} neutral={0.5} onChange={(v) => pv('events', { sense: v })} />
            <Slider label="density" value={cfg.events.density} min={0} max={1} neutral={0.4} onChange={(v) => pv('events', { density: v })} />
            <Slider label="decay" value={cfg.events.decay} min={0} max={1} neutral={0.35} fmt={(v) => Math.round((0.05 + v * 2.45) * 1000) + 'ms'} onChange={(v) => pv('events', { decay: v })} />
            <Slider label="highs↓" value={cfg.events.highs} min={0} max={1} neutral={0.6} onChange={(v) => pv('events', { highs: v })} />
            <Row label="wave">
              <select
                className="input select-compact min-w-0 flex-1 text-[10px]"
                value={cfg.events.wave}
                onChange={(e) => pv('events', { wave: Number(e.target.value) })}
                title="Oscillator shape for the notes"
              >
                <option value={0}>sine</option>
                <option value={1}>triangle</option>
                <option value={2}>saw</option>
                <option value={3}>square</option>
              </select>
            </Row>
            <Row label="range">
              <select className="input select-compact text-[10px]" value={cfg.events.loOct} onChange={(e) => pv('events', { loOct: Math.min(Number(e.target.value), cfg.events.hiOct - 1) })} title="Lowest octave">
                {[1, 2, 3, 4].map((o) => <option key={o} value={o}>oct {o}</option>)}
              </select>
              <span className="text-[9px] text-muted">→</span>
              <select className="input select-compact text-[10px]" value={cfg.events.hiOct} onChange={(e) => pv('events', { hiOct: Math.max(Number(e.target.value), cfg.events.loOct + 1) })} title="Highest octave">
                {[4, 5, 6, 7].map((o) => <option key={o} value={o}>oct {o}</option>)}
              </select>
              <button
                onClick={() => pv('events', { quantize: !cfg.events.quantize })}
                className={`ml-auto rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.events.quantize ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title="Notes land on scale degrees or free frequencies"
              >♪ scale</button>
            </Row>
            <Slider label="gain" value={cfg.events.gain} min={0} max={1} neutral={0.6} onChange={(v) => pv('events', { gain: v })} />
            <Slider label="pan" value={cfg.events.pan} min={-1} max={1} neutral={0} onChange={(v) => pv('events', { pan: v })} />
          </VoiceShell>

          <VoiceShell
            title="Raster" on={cfg.raster.on}
            hint="audification : the probe rect read raw as samples (Ikeda)"
            onToggle={() => pv('raster', { on: !cfg.raster.on })}
          >
            <TapSelect cfg={cfg} voice={cfg.raster} onChange={(tap) => pv('raster', { tap })} />
            <Row label="pitch">
              {cfg.raster.quantize ? (
                <input
                  type="range" min={24} max={72} step={1} value={cfg.raster.note}
                  onChange={(e) => pv('raster', { note: Number(e.target.value) })}
                  className="min-w-0 flex-1 accent-accent"
                  title={`Note ${fmtNote(cfg.raster.note)} : one full scan of the rect = the period`}
                />
              ) : (
                <input
                  type="range" min={0} max={1} step={0.001}
                  value={Math.log(cfg.raster.freq / 20) / Math.log(1000 / 20)}
                  onChange={(e) => pv('raster', { freq: 20 * Math.pow(1000 / 20, Number(e.target.value)) })}
                  className="min-w-0 flex-1 accent-accent"
                  title={`Free frequency ${fmtHz(cfg.raster.freq)}`}
                />
              )}
              <span className="w-10 shrink-0 text-right font-mono text-[9px] text-muted">
                {cfg.raster.quantize ? fmtNote(cfg.raster.note) : fmtHz(cfg.raster.freq)}
              </span>
              <button
                onClick={() => pv('raster', { quantize: !cfg.raster.quantize })}
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.raster.quantize ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title="Snap the scan pitch to the key/scale, or run free Hz"
              >&#9834;</button>
              {chip('rasterPitch')}
            </Row>
            <Row label="rect">
              <span className="font-mono text-[9px] text-muted">x</span>{chip('rasterX')}
              <span className="font-mono text-[9px] text-muted">y</span>{chip('rasterY')}
              <span className="font-mono text-[9px] text-muted">w</span>{chip('rasterW')}
              <span className="font-mono text-[9px] text-muted">h</span>{chip('rasterH')}
            </Row>
            <Slider label="smooth" value={cfg.raster.smooth} min={0} max={1} neutral={0} onChange={(v) => pv('raster', { smooth: v })} />
            <Slider
              label="tone" value={cfg.raster.tone ?? 0.6} min={0} max={1} neutral={0.6}
              fmt={(v) => (v >= 0.99 ? 'open' : Math.round(300 * Math.pow(8000 / 300, v)) + 'Hz')}
              onChange={(v) => pv('raster', { tone: v })}
            />
            <Slider label="gain" value={cfg.raster.gain} min={0} max={1} neutral={0.4} onChange={(v) => pv('raster', { gain: v })} />
            <Slider label="pan" value={cfg.raster.pan} min={-1} max={1} neutral={0} onChange={(v) => pv('raster', { pan: v })} />
            <p className="text-[9px] leading-tight text-muted">Drag the green rect (corner resizes). The rect IS the waveform : edges buzz, gradients hum, datamosh blocks tick. Smooth 0 = the hard aliased register.</p>
          </VoiceShell>

          <VoiceShell
            title="Transmission" on={cfg.sstv.on}
            hint="the SSTV register : line-sequential FM + a sync-pulse metronome"
            onToggle={() => pv('sstv', { on: !cfg.sstv.on })}
          >
            <TapSelect cfg={cfg} voice={cfg.sstv} onChange={(tap) => pv('sstv', { tap })} />
            <Row label="lines">
              {!cfg.sstv.sync && (
                <input
                  type="range" min={1} max={60} step={0.5} value={cfg.sstv.lineHz}
                  onChange={(e) => pv('sstv', { lineHz: Number(e.target.value) })}
                  className="min-w-0 flex-1 accent-accent"
                  title={`Scan rate ${cfg.sstv.lineHz.toFixed(1)} lines/s : the melody is the image rows`}
                />
              )}
              {!cfg.sstv.sync && (
                <span className="w-10 shrink-0 text-right font-mono text-[9px] text-muted">{cfg.sstv.lineHz.toFixed(1)}/s</span>
              )}
              <button
                onClick={() => pv('sstv', { sync: !cfg.sstv.sync })}
                className={`${cfg.sstv.sync ? 'flex-1 ' : ''}rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.sstv.sync ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title={`Sync : one scan line per 16th note @ ${bpm} BPM (the sync tick becomes the clock)`}
              >{cfg.sstv.sync ? `sync 1/16 @ ${bpm}` : 'sync'}</button>
            </Row>
            <Slider label="transpose" value={cfg.sstv.dev} min={0.25} max={2} neutral={1} fmt={(v) => v.toFixed(2) + 'x'} onChange={(v) => pv('sstv', { dev: v })} />
            <Slider label="tick" value={cfg.sstv.syncLev} min={0} max={1} neutral={0.5} onChange={(v) => pv('sstv', { syncLev: v })} />
            <Slider label="gain" value={cfg.sstv.gain} min={0} max={1} neutral={0.4} onChange={(v) => pv('sstv', { gain: v })} />
            <Slider label="pan" value={cfg.sstv.pan} min={-1} max={1} neutral={0} onChange={(v) => pv('sstv', { pan: v })} />
          </VoiceShell>

          <VoiceShell
            title="Filter" on={cfg.filter.on}
            hint="the image as a filter bank : noise or line-in played THROUGH the frame"
            onToggle={() => pv('filter', { on: !cfg.filter.on })}
          >
            <TapSelect cfg={cfg} voice={cfg.filter} onChange={(tap) => pv('filter', { tap })} />
            <Row label="source">
              <button
                onClick={() => pv('filter', { lineIn: false })}
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${!cfg.filter.lineIn ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title="Internal noise through the image's bands (wide resonance = wind, narrow = flute)"
              >noise</button>
              <button
                onClick={() => pv('filter', { lineIn: true })}
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.filter.lineIn ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title="Live line/mic input filtered by the frame (the Metasynth filter room)"
              >line-in</button>
            </Row>
            <Row label="sweep">
              <button
                onClick={() => pv('filter', { sweepOn: !cfg.filter.sweepOn })}
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.filter.sweepOn ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title="Sweep the reading column, or hold it (drag the blue line)"
              >{cfg.filter.sweepOn ? 'sweeping' : 'held'}</button>
              {chip('filterX')}
              {cfg.filter.sweepOn && (
                <input
                  type="range" min={0.02} max={4} step={0.01} value={cfg.filter.sweepHz}
                  onChange={(e) => pv('filter', { sweepHz: Number(e.target.value) })}
                  className="min-w-0 flex-1 accent-accent"
                  title={`Sweep rate ${cfg.filter.sweepHz.toFixed(2)}Hz`}
                />
              )}
            </Row>
            <Row label="path">
              <select
                className="input select-compact min-w-0 flex-1 text-[10px]"
                value={cfg.filter.path ?? 0}
                onChange={(e) => pv('filter', { path: Number(e.target.value) })}
                title="Reading path : how the band-scan traverses the frame (Aural Mirror)"
              >
                <option value={0}>horizontal →</option>
                <option value={1}>vertical ↓</option>
                <option value={2}>radial ⟳</option>
                <option value={3}>spiral</option>
              </select>
            </Row>
            {cfg.filter.sweepOn && (
              <Slider label="breathe" value={cfg.filter.pace ?? 0} min={0} max={0.95} neutral={0} onChange={(v) => pv('filter', { pace: v })} />
            )}
            <Slider label="resonance" value={cfg.filter.q} min={0} max={1} neutral={0.5} onChange={(v) => pv('filter', { q: v })} />
            <Slider label="noise" value={cfg.filter.noise} min={0} max={1} neutral={0.5} onChange={(v) => pv('filter', { noise: v })} />
            <Slider label="contrast" value={cfg.filter.gamma} min={0.5} max={4} neutral={1.6} onChange={(v) => pv('filter', { gamma: v })} />
            <Row label="bands">
              <button
                onClick={() => pv('filter', { quantize: !cfg.filter.quantize })}
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.filter.quantize ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title="Tune the 48 band centres to the key/scale (a resonant harmonic wash) or spread them freely"
              >&#9834; scale</button>
            </Row>
            <Slider label="gain" value={cfg.filter.gain} min={0} max={1} neutral={0.6} onChange={(v) => pv('filter', { gain: v })} />
            <Slider label="pan" value={cfg.filter.pan} min={-1} max={1} neutral={0} onChange={(v) => pv('filter', { pan: v })} />
          </VoiceShell>

          <VoiceShell
            title="Chord" on={cfg.chord.on}
            hint="a scale-tuned chord that follows the frame's brightness bands — sings on stills"
            onToggle={() => pv('chord', { on: !cfg.chord.on })}
          >
            <TapSelect cfg={cfg} voice={cfg.chord} onChange={(tap) => pv('chord', { tap })} />
            <Row label="voices">
              <input
                type="range" min={2} max={16} step={1} value={cfg.chord.voices}
                onChange={(e) => pv('chord', { voices: Number(e.target.value) })}
                className="min-w-0 flex-1 accent-accent"
                title="How many scale notes in the chord (spread over the range)"
              />
              <span className="w-12 shrink-0 text-right font-mono text-[9px] text-muted">{cfg.chord.voices}</span>
            </Row>
            <Row label="range">
              <select className="input select-compact text-[10px]" value={cfg.chord.loOct} onChange={(e) => pv('chord', { loOct: Math.min(Number(e.target.value), cfg.chord.hiOct - 1) })} title="Lowest octave">
                {[0, 1, 2, 3, 4].map((o) => <option key={o} value={o}>oct {o}</option>)}
              </select>
              <span className="text-[9px] text-muted">→</span>
              <select className="input select-compact text-[10px]" value={cfg.chord.hiOct} onChange={(e) => pv('chord', { hiOct: Math.max(Number(e.target.value), cfg.chord.loOct + 1) })} title="Highest octave">
                {[3, 4, 5, 6, 7, 8].map((o) => <option key={o} value={o}>oct {o}</option>)}
              </select>
            </Row>
            <Slider label="swell" value={cfg.chord.attack} min={0.02} max={3} neutral={0.4} fmt={(v) => v.toFixed(2) + 's'} onChange={(v) => pv('chord', { attack: v })} title="Attack : how slowly each note fades IN as its band brightens" />
            <Slider label="fade" value={cfg.chord.release} min={0.05} max={6} neutral={0.8} fmt={(v) => v.toFixed(2) + 's'} onChange={(v) => pv('chord', { release: v })} title="Release : how slowly each note fades OUT as its band darkens" />
            <Slider label="contrast" value={cfg.chord.gamma} min={0.5} max={4} neutral={1.6} onChange={(v) => pv('chord', { gamma: v })} />
            <Slider label="tone" value={cfg.chord.tone} min={0} max={1} neutral={0.3} onChange={(v) => pv('chord', { tone: v })} title="Sine → brighter (soft-clip harmonics)" />
            <Slider label="spread" value={cfg.chord.spread} min={0} max={1} neutral={0.6} onChange={(v) => pv('chord', { spread: v })} title="Stereo fan across the bank (low notes ↔ high notes)" />
            <Slider label="gain" value={cfg.chord.gain} min={0} max={1} neutral={0.6} onChange={(v) => pv('chord', { gain: v })} />
            <Slider label="pan" value={cfg.chord.pan} min={-1} max={1} neutral={0} onChange={(v) => pv('chord', { pan: v })} />
          </VoiceShell>

          <VoiceShell
            title="Reverb / Delay" on={cfg.fx.send > 0.0001}
            hint="a shared FX tail — the whole mix sends into an analog delay → Quartz/Prism reverb"
            onToggle={() => pfx({ send: cfg.fx.send > 0.0001 ? 0 : 0.35 })}
          >
            <Slider label="send" value={cfg.fx.send} min={0} max={1} neutral={0.35} onChange={(v) => pfx({ send: v })} title="How much of the sonify mix feeds the shared reverb / delay tail" />
            <div className="mt-1 font-mono text-[8px] uppercase tracking-wide text-muted/70">delay (BBD / analog)</div>
            <Row label="mode">
              <select className="input select-compact min-w-0 flex-1 text-[10px]" value={cfg.fx.dlyMode} onChange={(e) => pfx({ dlyMode: Number(e.target.value) })} title="Delay routing">
                <option value={0}>mono</option>
                <option value={1}>stereo</option>
                <option value={2}>ping-pong</option>
              </select>
            </Row>
            <Slider label="time" value={cfg.fx.dlyTime} min={0.02} max={2} neutral={0.3} fmt={(v) => Math.round(v * 1000) + 'ms'} onChange={(v) => pfx({ dlyTime: v })} title="Delay time (glides tape-style when moved)" />
            <Slider label="feedback" value={cfg.fx.dlyFb} min={0} max={0.95} neutral={0.35} onChange={(v) => pfx({ dlyFb: v })} title="Echo regeneration (companded, self-limiting)" />
            <Slider label="tone" value={cfg.fx.dlyTone} min={0} max={1} neutral={0.5} onChange={(v) => pfx({ dlyTone: v })} title="BBD darkness : low = dark analog repeats, high = bright" />
            <Slider label="delay mix" value={cfg.fx.dlyMix} min={0} max={1} neutral={0.35} onChange={(v) => pfx({ dlyMix: v })} title="Echo level in the tail" />
            <div className="mt-1 font-mono text-[8px] uppercase tracking-wide text-muted/70">reverb (Quartz / Prism)</div>
            <Row label="mode">
              <button onClick={() => pfx({ rvMode: 0 })} className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.fx.rvMode === 0 ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`} title="Quartz : dual-band damped pad-verb">Quartz</button>
              <button onClick={() => pfx({ rvMode: 1 })} className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.fx.rvMode === 1 ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`} title="Prism : per-band frequency-dependent decay">Prism</button>
              <button onClick={() => pfx({ rvFreeze: !cfg.fx.rvFreeze })} className={`ml-auto rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.fx.rvFreeze ? 'bg-accent2/20 text-accent2 ring-1 ring-accent2' : 'bg-panel3/60 text-muted'}`} title="Infinite freeze (hold the tail)">❄ freeze</button>
            </Row>
            <Slider label="size" value={cfg.fx.rvSize} min={0} max={1} neutral={0.6} onChange={(v) => pfx({ rvSize: v })} />
            <Slider label="decay" value={cfg.fx.rvDecay} min={0} max={1} neutral={0.6} fmt={(v) => (0.25 + v * v * 11.75).toFixed(1) + 's'} onChange={(v) => pfx({ rvDecay: v })} title="RT60 (0.25–12 s)" />
            <Slider label="damp" value={cfg.fx.rvDamp} min={0} max={1} neutral={0.3} onChange={(v) => pfx({ rvDamp: v })} title="HF absorption (darker tail)" />
            <Slider label="predelay" value={cfg.fx.rvPre} min={0} max={200} neutral={20} fmt={(v) => Math.round(v) + 'ms'} onChange={(v) => pfx({ rvPre: v })} />
            <Slider label="shimmer" value={cfg.fx.rvMod} min={0} max={40} neutral={6} fmt={(v) => v.toFixed(0)} onChange={(v) => pfx({ rvMod: v })} title="Tail modulation depth (chorusing)" />
            <Slider label="mod rate" value={cfg.fx.rvModRate} min={0.01} max={8} neutral={0.5} fmt={(v) => v.toFixed(2) + 'Hz'} onChange={(v) => pfx({ rvModRate: v })} />
            <Slider label="width" value={cfg.fx.rvWidth} min={0} max={1} neutral={1} onChange={(v) => pfx({ rvWidth: v })} title="Stereo width (0 mono … 1 wide)" />
            <Slider label="low-cut" value={cfg.fx.rvLocut} min={20} max={2000} neutral={220} fmt={(v) => Math.round(v) + 'Hz'} onChange={(v) => pfx({ rvLocut: v })} title="Wet low-cut (keeps the tail airy)" />
            {cfg.fx.rvMode === 0 ? (
              <>
                <Slider label="diffusion" value={cfg.fx.rvDiff} min={0} max={1} neutral={0.85} onChange={(v) => pfx({ rvDiff: v })} title="Quartz : input diffusion (smears transients)" />
                <Slider label="low damp" value={cfg.fx.rvLowDamp} min={0} max={1} neutral={0.5} onChange={(v) => pfx({ rvLowDamp: v })} title="Quartz : LF damping" />
              </>
            ) : (
              <>
                <Slider label="crossover" value={cfg.fx.rvCross} min={0} max={1} neutral={0.3} onChange={(v) => pfx({ rvCross: v })} title="Prism : band-split frequency" />
                <Slider label="low ×" value={cfg.fx.rvLowMult} min={0.05} max={4} neutral={1} fmt={(v) => v.toFixed(2)} onChange={(v) => pfx({ rvLowMult: v })} title="Prism : low-band decay multiplier" />
                <Slider label="high ×" value={cfg.fx.rvHighMult} min={0.05} max={4} neutral={1} fmt={(v) => v.toFixed(2)} onChange={(v) => pfx({ rvHighMult: v })} title="Prism : high-band decay multiplier" />
              </>
            )}
            <Slider label="reverb mix" value={cfg.fx.rvMix} min={0} max={1} neutral={0.6} onChange={(v) => pfx({ rvMix: v })} title="Reverb level in the tail" />
          </VoiceShell>

          <p className="text-[9px] leading-tight text-muted">
            Spectra : vertical position is pitch, brightness is loudness — the sweep plays the frame like a score (ANS · Metasynth · vOICe).
            Orbit : the image itself is the oscillator — move the orbit to change timbre; the visuals mutate the waveform live (wave terrain · Oramics).
            Flow : whatever MOVES sings — each moving region fires a grain, panned where it is (Pelletier).
            Events : edges and motion are struck as discrete notes — pitch from height, panned where they are, highs decaying sooner (after Aural Mirror).
            Raster : the probe rect IS the waveform, read raw (Ikeda). Transmission : the image as an FM broadcast, sync tick as metronome (SSTV).
            Filter : sound played THROUGH the frame (Metasynth).
            Chord : a scale-tuned bank whose notes follow the brightness of horizontal bands — a sustained chord that swells and fades, so a still image still sings (after Aural Mirror's additive layer).
            Recording captures everything.
          </p>
        </aside>
      </div>
    </div>
  )
}
