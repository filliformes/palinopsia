// Audio panel (Slab 1) — the ingest surface for the audiovisual-reactivity
// chapter. Enable, choose the source (Pandore-over-OSC / local Web Audio /
// both), pick a local device, and watch the live features. Assign audio to
// parameters via the `audio` modulator type in the Modulation panel.
//
// Meters read the audio bus directly each rAF (never through React) — same
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

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const showDevice = source === 'local' || source === 'both'

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

            {/* local device */}
            {showDevice && (
              <select
                className="input select-compact min-w-0 max-w-[180px] flex-1 text-[10px]"
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

            <div className="flex-1" />
            <Meters />
          </>
        )}
      </div>
      {enabled && (
        <p className="font-mono text-[9px] leading-tight text-muted">
          Assign to parameters via the <span className="text-accent">audio</span> modulator type
          (Modulation ▸ M· ▸ audio). Prefer transient / flux over level.
        </p>
      )}
    </div>
  )
}

// ── Live meters — one rAF, direct style writes off the audio bus ────────
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
