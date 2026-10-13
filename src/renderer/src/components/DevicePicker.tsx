// DevicePicker : a modal list of the machine's video input devices (built-in
// camera, USB cameras, capture cards, a DJI Osmo in webcam mode, …) for the
// "Live Input" source. Labels only show once camera permission is granted, so
// we prime it with a throwaway getUserMedia before enumerating.
//
// On a Mac it also lists what Chromium cannot see, through the USB input
// (src/preload/avcapture.ts) : an iPhone or iPad plugged in by USB (its screen,
// as QuickTime shows it) and other muxed devices, as `avf:<id>`.

import { useCallback, useEffect, useState } from 'react'
import type { AvfStatus } from '@shared/avf'
import { AVF_PREFIX } from '../engine/avfIn'

interface Device {
  id: string
  label: string
  /** Captured natively (macOS USB input), not by Chromium. */
  usb?: boolean
}

/** The USB input's state under the Inspector : what it captures, or what it waits for. */
export function AvfReadout({ id }: { id: string }): JSX.Element {
  const [s, setS] = useState<AvfStatus | null>(null)
  useEffect(() => {
    const tick = (): void => {
      try {
        setS(window.api.avfStatus(id))
      } catch {
        setS(null)
      }
    }
    tick()
    const t = setInterval(tick, 500)
    return () => clearInterval(t)
  }, [id])
  const text = !s
    ? 'starting…'
    : s.state === 'running'
      ? s.fps === 0
        ? `${s.w}×${s.h} · no new frames : is the device's screen asleep?`
        : `${s.w}×${s.h}${s.srcW && (s.srcW !== s.w || s.srcH !== s.h) ? ` (from ${s.srcW}×${s.srcH})` : ''} · ${s.fps} fps`
      : s.state === 'missing'
        ? 'not connected : looking for it every 2 s (an iPhone : plugged in, unlocked once, this computer trusted)'
        : s.state === 'gone'
          ? 'went away : looking for it again'
          : s.state === 'denied'
            ? 'camera access denied : allow Palinopsia under Privacy & Security, Camera'
            : s.state === 'unavailable'
              ? `not available : ${s.error || 'macOS only'}`
              : s.state === 'failed'
                ? `would not open (${s.error}) : trying again`
                : 'starting…'
  return (
    <div
      className="px-3 pb-2 font-mono text-[10px] text-muted"
      title="Captured by macOS itself, not by the browser engine : picture size (and the device's own, when scaled down), frames per second, or what the input is waiting for. It keeps looking for a device that is missing, so an iPhone that powers up after the computer joins by itself."
    >
      📱 {text}
    </div>
  )
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
      // NotFoundError / other : fall through : enumerate will just come back empty.
    }
    // The Mac's USB input in parallel (its first look waits a second for an
    // iPhone to appear).
    const usb = window.api.platform === 'darwin' ? window.api.avfList().catch(() => null) : Promise.resolve(null)
    let list: Device[] = []
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      prime?.getTracks().forEach((t) => t.stop())
      list = all
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }))
    } catch {
      list = []
    }
    // What Chromium already lists stays Chromium's; the rest (an iPhone by USB,
    // a muxed camera) comes through the USB input.
    const native = await usb
    if (native?.ok) {
      // Chromium on macOS adds " (vid:pid)" to a USB camera's name : compare without it.
      const bare = (s: string): string => s.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim()
      const seen = new Set(list.map((d) => bare(d.label)))
      for (const d of native.devices) {
        if (d.muxed || !seen.has(bare(d.name))) list.push({ id: AVF_PREFIX + d.id, label: d.name, usb: true })
      }
    }
    setDevices(list)
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
                ? 'Camera permission denied : allow camera access in your system settings, then rescan.'
                : window.api.platform === 'darwin'
                  ? 'No video input devices found : plug in a camera (or an iPhone by USB, unlocked, this computer trusted) and rescan.'
                  : 'No video input devices found : plug in a camera and rescan.'}
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
                  title={
                    d.usb
                      ? `${d.label} : captured by macOS (an iPhone or iPad by USB shows its screen : open the Camera app on it)`
                      : d.label
                  }
                >
                  <span className="text-[14px]">{d.usb ? '📱' : '🎥'}</span>
                  <span className="truncate">{d.label}</span>
                  {d.usb && <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-wide text-muted">usb</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
