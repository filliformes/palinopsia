// The audio output picker, one for the whole app : the Sonify page's header,
// Sonify's row in the audio/midi/osc tab (both drive the same setting, Sonify's
// sinkId, so they always agree) and the input monitor's row. The device list
// follows plugging and unplugging (devicechange).

import { useEffect, useState } from 'react'

export interface AudioOutput {
  id: string
  label: string
}

/** The machine's audio outputs, kept current. */
export function useAudioOutputs(): AudioOutput[] {
  const [outs, setOuts] = useState<AudioOutput[]>([])
  useEffect(() => {
    let alive = true
    const md = navigator.mediaDevices
    const read = (): void => {
      md?.enumerateDevices?.()
        .then((ds) => {
          if (!alive) return
          setOuts(
            ds
              .filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default')
              .map((d, i) => ({ id: d.deviceId, label: d.label || `output ${i + 1}` }))
          )
        })
        .catch(() => {})
    }
    read()
    md?.addEventListener?.('devicechange', read)
    return () => {
      alive = false
      md?.removeEventListener?.('devicechange', read)
    }
  }, [])
  return outs
}

export function AudioOutputSelect({ value, onChange, title, className, defaultLabel = 'default output' }: {
  value: string
  onChange: (deviceId: string) => void
  title: string
  className?: string
  defaultLabel?: string
}): JSX.Element {
  const outs = useAudioOutputs()
  // The system's own "default" entry is the first option ('') here.
  const v = value === 'default' ? '' : value
  // A device saved in a session but not plugged in here : still shown, so the
  // menu says what is chosen instead of silently reading "default".
  const missing = v && !outs.some((o) => o.id === v)
  return (
    <select className={className ?? 'input select-compact min-w-0 flex-1 text-[10px]'} value={v} onChange={(e) => onChange(e.target.value)} title={title}>
      <option value="">{defaultLabel}</option>
      {outs.map((o) => (
        <option key={o.id} value={o.id}>{o.label}</option>
      ))}
      {missing && <option value={v}>(not connected)</option>}
    </select>
  )
}
