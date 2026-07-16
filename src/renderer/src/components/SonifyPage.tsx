// Sonify (key S) : the image-to-sound page. Full-page takeover like Output —
// the live composite mirrored large with the sound PROBES drawn on it (the
// Spectra scan line, the Orbit ellipse, the Flow motion dots), because the
// probe is the instrument. Three voice strips (Spectra · Orbit · Flow) +
// master with an always-on limiter, a global note quantizer (root + scale,
// per-voice snap), two image taps (master or any layer), and an output-device
// picker. The sound engine lives in audio/sonify.ts (AudioWorklet).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import { SONI_SCALES, sonifyEngine, type SoniConfig } from '../audio/sonify'
import { useStore } from '../store'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="w-14 shrink-0 font-mono text-[9px] uppercase text-muted">{label}</span>
      {children}
    </div>
  )
}

function Slider({
  label, value, min, max, step = 0.01, neutral, fmt, onChange
}: {
  label: string; value: number; min: number; max: number; step?: number
  neutral?: number; fmt?: (v: number) => string; onChange: (v: number) => void
}): JSX.Element {
  return (
    <Row label={label}>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => neutral !== undefined && onChange(neutral)}
        className="min-w-0 flex-1 accent-accent"
        title={`${label} ${fmt ? fmt(value) : value.toFixed(2)}`}
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

  const set = (next: SoniConfig): void => setSonify(next)
  const patch = (p: Partial<SoniConfig>): void => set({ ...cfg, ...p })
  const pv = <K extends 'spectra' | 'orbit' | 'flow' | 'raster' | 'sstv' | 'filter'>(k: K, p: Partial<SoniConfig[K]>): void =>
    set({ ...cfg, [k]: { ...cfg[k], ...p } })

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
        // Spectra sweep line (mirror of the worklet's sweep : same rate)
        if (st.on && st.spectra.on) {
          if (st.spectra.sweepOn) sweepPhase = (sweepPhase + st.spectra.sweepHz * dt) % 1
          else sweepPhase = st.spectra.x
          g.strokeStyle = 'rgba(255,255,255,0.85)'
          g.lineWidth = 1.5
          g.beginPath()
          g.moveTo(sweepPhase * w, 0)
          g.lineTo(sweepPhase * w, h)
          g.stroke()
        }
        // Filter column (its own hue, mirrors the filter sweep)
        if (st.on && st.filter.on) {
          if (st.filter.sweepOn) fSweep = (fSweep + st.filter.sweepHz * dt) % 1
          else fSweep = st.filter.x
          g.strokeStyle = 'rgba(120,200,255,0.8)'
          g.lineWidth = 1.5
          g.beginPath()
          g.moveTo(fSweep * w, 0)
          g.lineTo(fSweep * w, h)
          g.stroke()
        }
        // Raster probe rect
        if (st.on && st.raster.on) {
          g.strokeStyle = 'rgba(120,255,160,0.85)'
          g.lineWidth = 1.5
          g.strokeRect(st.raster.rx * w, st.raster.ry * h, st.raster.rw * w, st.raster.rh * h)
          g.fillStyle = 'rgba(120,255,160,0.85)'
          g.fillRect((st.raster.rx + st.raster.rw) * w - 4, (st.raster.ry + st.raster.rh) * h - 4, 8, 8)
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
          g.ellipse(st.orbit.cx * w, st.orbit.cy * h, Math.max(2, st.orbit.rx * w), Math.max(2, st.orbit.ry * h), 0, 0, 6.2832)
          g.stroke()
          g.fillStyle = 'rgba(255,180,80,0.9)'
          g.beginPath()
          g.arc(st.orbit.cx * w, st.orbit.cy * h, 3, 0, 6.2832)
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
            </Row>
            {!cfg.spectra.sync && cfg.spectra.sweepOn && (
              <Slider label="rate" value={cfg.spectra.sweepHz} min={0.02} max={4} neutral={0.25} fmt={(v) => v.toFixed(2) + 'Hz'} onChange={(v) => pv('spectra', { sweepHz: v })} />
            )}
            <Slider label="contrast" value={cfg.spectra.gamma} min={0.5} max={4} neutral={1.8} onChange={(v) => pv('spectra', { gamma: v })} />
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
              {cfg.filter.sweepOn && (
                <input
                  type="range" min={0.02} max={4} step={0.01} value={cfg.filter.sweepHz}
                  onChange={(e) => pv('filter', { sweepHz: Number(e.target.value) })}
                  className="min-w-0 flex-1 accent-accent"
                  title={`Sweep rate ${cfg.filter.sweepHz.toFixed(2)}Hz`}
                />
              )}
            </Row>
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

          <p className="text-[9px] leading-tight text-muted">
            Spectra : vertical position is pitch, brightness is loudness — the sweep plays the frame like a score (ANS · Metasynth · vOICe).
            Orbit : the image itself is the oscillator — move the orbit to change timbre; the visuals mutate the waveform live (wave terrain · Oramics).
            Flow : whatever MOVES sings — each moving region fires a grain, panned where it is (Pelletier).
            Raster : the probe rect IS the waveform, read raw (Ikeda). Transmission : the image as an FM broadcast, sync tick as metronome (SSTV).
            Filter : sound played THROUGH the frame (Metasynth). Recording captures everything.
          </p>
        </aside>
      </div>
    </div>
  )
}
