// DevicePicker : a modal list of the machine's video input devices (built-in
// camera, USB cameras, capture cards, a DJI Osmo in webcam mode, …) for the
// "Live Input" source. Labels only show once camera permission is granted, so
// we prime it with a throwaway getUserMedia before enumerating.

import { useEffect, useState } from 'react'

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

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        // Prime permission so enumerateDevices returns real labels.
        const prime = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }).catch(() => null)
        const all = await navigator.mediaDevices.enumerateDevices()
        prime?.getTracks().forEach((t) => t.stop())
        if (!alive) return
        setDevices(
          all
            .filter((d) => d.kind === 'videoinput')
            .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }))
        )
      } catch {
        if (alive) setDevices([])
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onCancel}>
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="text-[13px] font-semibold">Choose a live input</span>
          <button
            onClick={onCancel}
            className="rounded border border-border px-2 py-0.5 font-mono text-[11px] text-muted hover:text-text"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {devices === null ? (
            <div className="p-6 text-center text-[12px] text-muted">Looking for devices…</div>
          ) : devices.length === 0 ? (
            <div className="p-6 text-center text-[12px] text-muted">
              No video input devices found. Plug in the camera and try again.
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
