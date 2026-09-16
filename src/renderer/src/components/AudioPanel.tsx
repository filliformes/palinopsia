// Audio panel (Slab 1) : the ingest surface for the audiovisual-reactivity
// chapter. Enable, choose the source (Pandore-over-OSC / local Web Audio /
// both), pick a local device, and watch the live features. Assign audio to
// parameters via the `audio` modulator type in the Modulation panel.
//
// Meters read the audio bus directly each rAF (never through React) : same
// discipline as the modulator meters.

import { useEffect, useRef, useState } from 'react'
import { audioBus, AUDIO_BANDS } from '../engine/audioIn'
import { useStore } from '../store'

const SOURCES: Array<{ id: 'both' | 'osc' | 'local'; label: string; title: string }> = [
  { id: 'both', label: 'Both', title: 'OSC (Pandore) primary, local input as fallback' },
  { id: 'osc', label: 'OSC', title: 'Audio features from Pandore over /opsia/audio/*' },
  { id: 'local', label: 'Local', title: 'Analyse a local mic / line / loopback input' }
]

export function AudioPanel(): JSX.Element {
  const enabled = useStore((s) => s.audioEnabled)
  const setEnabled = useStore((s) => s.setAudioEnabled)
  const source = useStore((s) => s.audioSource)
  const setSource = useStore((s) => s.setAudioSource)
  const deviceId = useStore((s) => s.audioDeviceId)
  const setDeviceId = useStore((s) => s.setAudioDeviceId)
  const showCoupling = useStore((s) => s.showCoupling)
  const setShowCoupling = useStore((s) => s.setShowCoupling)
  // Output levels : the input monitor (passthrough) and the Sonify engine, each
  // independently on/off + level, so both can sound at once from this tab.
  const monitor = useStore((s) => s.audioMonitor)
  const setMonitor = useStore((s) => s.setAudioMonitor)
  const monitorLevel = useStore((s) => s.audioMonitorLevel)
  const setMonitorLevel = useStore((s) => s.setAudioMonitorLevel)
  const monitorSink = useStore((s) => s.audioMonitorSink)
  const setMonitorSink = useStore((s) => s.setAudioMonitorSink)
  const sonify = useStore((s) => s.sonify)
  const setSonify = useStore((s) => s.setSonify)
  const denoise = useStore((s) => s.audioDenoise)
  const setDenoise = useStore((s) => s.setAudioDenoise)
  const notches = useStore((s) => s.audioDenoiseNotches)
  const setNotches = useStore((s) => s.setAudioDenoiseNotches)
  const [learning, setLearning] = useState(false)

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([])
  const showDevice = source === 'local' || source === 'both'
  const monitorReady = enabled && showDevice // the input monitor needs local input

  // Output devices for the monitor sink.
  useEffect(() => {
    let alive = true
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((ds) => { if (alive) setOutputs(ds.filter((d) => d.kind === 'audiooutput')) })
      .catch(() => {})
    return () => { alive = false }
  }, [monitor, enabled])

  // Enumerate input devices (labels populate once the input has been opened).
  useEffect(() => {
    if (!enabled || !showDevice) return
    let alive = true
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((ds) => {
        if (alive) setDevices(ds.filter((d) => d.kind === 'audioinput'))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [enabled, showDevice, deviceId])

  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-t border-border bg-panel px-3 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={() => setEnabled(!enabled)}
          className={`flex shrink-0 items-center gap-1.5`}
          title={enabled ? 'Audio ingest on' : 'Audio ingest off'}
        >
          <span
            className={`h-2.5 w-2.5 rounded-full transition-colors ${enabled ? 'bg-accent' : 'bg-panel3'}`}
          />
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted">Audio</span>
        </button>

        {enabled && (
          <>
            {/* source select */}
            <div className="flex shrink-0 overflow-hidden rounded border border-border">
              {SOURCES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSource(s.id)}
                  title={s.title}
                  className={`px-1.5 py-0.5 font-mono text-[9px] ${
                    source === s.id ? 'bg-accent/20 text-accent' : 'bg-panel2 text-muted'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Coupling toggle rides line 1, pinned right. */}
            <div className="flex-1" />
            <button
              onClick={() => setShowCoupling(!showCoupling)}
              title="Show the A/B coupling row on each layer (audio binds the two sources)"
              className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] ${
                showCoupling ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel2 text-muted'
              }`}
            >
              coupling
            </button>
          </>
        )}
      </div>
      {/* Second line : the device dropdown at full width + the meters. */}
      {enabled && (
        <div className="flex min-w-0 items-center gap-2">
          {showDevice && (
            <select
              className="input select-compact min-w-0 flex-1 text-[10px]"
              value={deviceId ?? ''}
              onChange={(e) => setDeviceId(e.target.value || null)}
              title="Local audio input device"
            >
              <option value="">Default input</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Input ${d.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
          )}
          {!showDevice && <div className="flex-1" />}
          <Meters />
        </div>
      )}
      {enabled && (
        <p className="font-mono text-[9px] leading-tight text-muted">
          Assign to parameters via the <span className="text-accent">audio</span> modulator type
          (Modulation ▸ M· ▸ audio). Prefer transient / flux over level.
        </p>
      )}

      {/* Output levels : the input MONITOR (passthrough) and the SONIFY engine,
          each on/off + level, so both can sound at once (independent faders). */}
      <div className="mt-0.5 flex flex-col gap-1 border-t border-border/50 pt-1">
        <div className="font-mono text-[9px] uppercase tracking-wide text-muted">Output levels</div>
        <LevelRow
          label="Sonify"
          on={sonify.on}
          onToggle={() => setSonify({ ...sonify, on: !sonify.on })}
          level={sonify.master}
          onLevel={(v) => setSonify({ ...sonify, master: v })}
          title="The Sonify engine's sound (image → sound). Build its voices on the Sonify page (S)."
        />
        <LevelRow
          label="Input monitor"
          on={monitor}
          onToggle={() => setMonitor(!monitor)}
          level={monitorLevel}
          onLevel={setMonitorLevel}
          disabled={!monitorReady}
          title={
            monitorReady
              ? 'Hear the local input through the output (passthrough) while it also drives reactivity — e.g. monitor a Move on the interface inputs.'
              : 'Turn Audio on with a Local (or Both) source first.'
          }
        />
        {monitor && monitorReady && (
          <label className="flex items-center gap-2 pl-[26px] font-mono text-[9px] text-muted">
            <span className="shrink-0">output</span>
            <select
              className="input select-compact min-w-0 flex-1 text-[10px]"
              value={monitorSink}
              onChange={(e) => setMonitorSink(e.target.value)}
              title="Which output device the monitor plays to (Sonify has its own on its page)"
            >
              <option value="">System default output</option>
              {outputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `Output ${d.deviceId.slice(0, 6)}`}</option>
              ))}
            </select>
          </label>
        )}

        {/* USB-noise denoiser : learn the noise, notch out the tonal peaks. */}
        <div className={`mt-0.5 flex flex-wrap items-center gap-2 border-t border-border/40 pt-1 ${!monitorReady ? 'opacity-50' : ''}`}>
          <button
            onClick={() => setDenoise(!denoise)}
            disabled={!monitorReady || notches.length === 0}
            className="flex w-[92px] shrink-0 items-center gap-1.5"
            title={notches.length === 0 ? 'Learn the noise first' : 'Notch out the measured USB noise (ground hum + digital whine) from the input, on the sound you hear AND the reactivity'}
          >
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full transition-colors ${denoise && monitorReady && notches.length ? 'bg-accent' : 'bg-panel3'}`} />
            <span className="font-mono text-[10px] text-muted">USB denoise</span>
          </button>
          <button
            onClick={async () => {
              setLearning(true)
              const freqs = await audioBus.learnNoise()
              setNotches(freqs)
              if (freqs.length) setDenoise(true)
              setLearning(false)
            }}
            disabled={!monitorReady || learning}
            className="shrink-0 rounded border border-accent/50 bg-accent/10 px-2 py-0.5 font-mono text-[9px] text-accent hover:bg-accent/20 disabled:opacity-40"
            title="Measure the noise for ~2s (Move connected but SILENT), then notch out the peaks it finds"
          >
            {learning ? 'learning…' : 'learn noise'}
          </button>
          {notches.length > 0 && (
            <span
              className="min-w-0 flex-1 truncate font-mono text-[9px] text-muted"
              title={`Notches at ${notches.map((n) => Math.round(n.f) + ' Hz').join(', ')}`}
            >
              {notches.length} notch{notches.length > 1 ? 'es' : ''} ·{' '}
              {Math.round(Math.min(...notches.map((n) => n.f)))}–{Math.round(Math.max(...notches.map((n) => n.f)))} Hz
            </span>
          )}
          {notches.length > 0 && (
            <button
              onClick={() => setNotches([])}
              className="shrink-0 font-mono text-[9px] text-muted hover:text-danger"
              title="Clear the learned notch profile"
            >
              clear
            </button>
          )}
        </div>
        {monitorReady && notches.length === 0 && (
          <p className="pl-[26px] font-mono text-[8px] leading-tight text-muted">
            Play nothing on the Move while learning, so only the noise is measured.
          </p>
        )}
      </div>
    </div>
  )
}

// One on/off + level fader (Sonify · input monitor).
function LevelRow({
  label, on, onToggle, level, onLevel, disabled, title
}: {
  label: string
  on: boolean
  onToggle: () => void
  level: number
  onLevel: (v: number) => void
  disabled?: boolean
  title?: string
}): JSX.Element {
  return (
    <div className={`flex items-center gap-2 ${disabled ? 'opacity-50' : ''}`} title={title}>
      <button onClick={onToggle} disabled={disabled} className="flex w-[92px] shrink-0 items-center gap-1.5">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full transition-colors ${on && !disabled ? 'bg-accent' : 'bg-panel3'}`} />
        <span className="font-mono text-[10px] text-muted">{label}</span>
      </button>
      <input
        type="range" min={0} max={1} step={0.01} value={level}
        onChange={(e) => onLevel(Number(e.target.value))}
        disabled={disabled}
        className="min-w-0 flex-1"
      />
      <span className="w-8 shrink-0 text-right font-mono text-[9px] text-muted">{Math.round(level * 100)}</span>
    </div>
  )
}

// ── Live meters : one rAF, direct style writes off the audio bus ────────
function Meters(): JSX.Element {
  const levelRef = useRef<HTMLDivElement | null>(null)
  const fluxRef = useRef<HTMLDivElement | null>(null)
  const transRef = useRef<HTMLDivElement | null>(null)
  const bandRefs = useRef<Array<HTMLDivElement | null>>([])

  useEffect(() => {
    let raf = 0
    const paint = (): void => {
      const c = audioBus.current
      if (levelRef.current) levelRef.current.style.height = `${Math.round(c.level * 100)}%`
      if (fluxRef.current) fluxRef.current.style.height = `${Math.round(c.flux * 100)}%`
      if (transRef.current) transRef.current.style.opacity = `${Math.min(1, c.transient)}`
      for (let i = 0; i < AUDIO_BANDS; i++) {
        const el = bandRefs.current[i]
        if (el) el.style.height = `${Math.round((c.bands[i] ?? 0) * 100)}%`
      }
      raf = requestAnimationFrame(paint)
    }
    raf = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(raf)
  }, [])

  const bar = (r: (el: HTMLDivElement | null) => void, title: string): JSX.Element => (
    <div className="flex h-5 w-1.5 items-end overflow-hidden rounded-sm bg-panel3/50" title={title}>
      <div ref={r} className="w-full bg-accent/80" style={{ height: '0%' }} />
    </div>
  )

  return (
    <div className="flex shrink-0 items-center gap-0.5" title="Live audio features">
      {bar((el) => (levelRef.current = el), 'level')}
      {bar((el) => (fluxRef.current = el), 'flux')}
      <span
        ref={transRef}
        className="mx-0.5 h-2 w-2 rounded-full bg-accent"
        style={{ opacity: 0 }}
        title="transient"
      />
      {Array.from({ length: AUDIO_BANDS }, (_, i) =>
        bar((el) => (bandRefs.current[i] = el), `band ${i + 1}`)
      )}
    </div>
  )
}
