// DevicePicker : a modal list of the machine's video input devices (built-in
// camera, USB cameras, capture cards, a DJI Osmo in webcam mode, …) for the
// "Live Input" source. Labels only show once camera permission is granted, so
// we prime it with a throwaway getUserMedia before enumerating.

import { useCallback, useEffect, useState } from 'react'

interface Device {
  id: string
  label: string
}

export function DevicePicker({
  onPick,
  onCancel
}: {
  onPick: (deviceId: string, label: string) => void
  onCancel: () => void
}): JSX.Element {
  const [devices, setDevices] = useState<Device[] | null>(null)
  // 'denied' distinguishes a refused permission from a genuinely absent camera,
  // so the empty state gives the right advice (settings vs. plug one in).
  const [err, setErr] = useState<'denied' | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setDevices(null)
    setErr(null)
    let prime: MediaStream | null = null
    try {
      // Prime permission so enumerateDevices returns real labels.
      prime = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    } catch (e) {
      const name = (e as Error)?.name
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setErr('denied')
        setDevices([])
        return
      }
      // NotFoundError / other : fall through — enumerate will just come back empty.
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      prime?.getTracks().forEach((t) => t.stop())
      setDevices(
        all
          .filter((d) => d.kind === 'videoinput')
          .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }))
      )
    } catch {
      setDevices([])
    }
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])

  // Esc closes, matching every other modal in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onCancel}>
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="text-[13px] font-semibold">Choose a live input</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void refresh()}
              className="rounded border border-border px-2 py-0.5 font-mono text-[11px] text-muted hover:text-accent"
              title="Rescan for input devices"
            >
              ⟳ rescan
            </button>
            <button
              onClick={onCancel}
              className="rounded border border-border px-2 py-0.5 font-mono text-[11px] text-muted hover:text-text"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {devices === null ? (
            <div className="p-6 text-center text-[12px] text-muted">Looking for devices…</div>
          ) : devices.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-6 text-center text-[12px] text-muted">
              {err === 'denied'
                ? 'Camera permission denied — allow camera access in your system settings, then rescan.'
                : 'No video input devices found — plug in a camera and rescan.'}
              <button
                onClick={() => void refresh()}
                className="rounded border border-accent/50 bg-accent/10 px-2 py-0.5 font-mono text-[11px] text-accent hover:bg-accent/20"
              >
                ⟳ rescan
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {devices.map((d) => (
                <button
                  key={d.id}
                  onClick={() => onPick(d.id, d.label)}
                  className="flex items-center gap-2 rounded border border-border bg-panel2 px-3 py-2 text-left text-[12px] transition-colors hover:border-accent hover:text-accent"
                  title={d.label}
                >
                  <span className="text-[14px]">🎥</span>
                  <span className="truncate">{d.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
