// CapturePicker : a modal grid of the machine's screens and windows (with live
// thumbnails from the main process) for choosing a screen-capture source.

import { useEffect, useState } from 'react'
import type { CaptureSourceInfo } from '@shared/types'

export function CapturePicker({
  onPick,
  onCancel
}: {
  onPick: (spec: string, name: string) => void
  onCancel: () => void
}): JSX.Element {
  const [sources, setSources] = useState<CaptureSourceInfo[] | null>(null)

  useEffect(() => {
    let alive = true
    window.api
      .captureListSources()
      .then((s) => {
        if (alive) setSources(s)
      })
      .catch(() => {
        if (alive) setSources([])
      })
    return () => {
      alive = false
    }
  }, [])

  const screens = sources?.filter((s) => s.isScreen) ?? []
  const windows = sources?.filter((s) => !s.isScreen) ?? []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onCancel}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="text-[13px] font-semibold">Choose a screen or window</span>
          <button
            onClick={onCancel}
            className="rounded border border-border px-2 py-0.5 font-mono text-[11px] text-muted hover:text-text"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {sources === null ? (
            <div className="p-6 text-center text-[12px] text-muted">Enumerating sources…</div>
          ) : sources.length === 0 ? (
            <div className="p-6 text-center text-[12px] text-muted">No capture sources found.</div>
          ) : (
            <>
              {screens.length > 0 && <Group title="Screens" items={screens} onPick={onPick} />}
              {windows.length > 0 && <Group title="Windows" items={windows} onPick={onPick} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Group({
  title,
  items,
  onPick
}: {
  title: string
  items: CaptureSourceInfo[]
  onPick: (spec: string, name: string) => void
}): JSX.Element {
  return (
    <div className="mb-3">
      <div className="mb-1.5 font-mono text-[9px] uppercase tracking-wide text-muted">{title}</div>
      <div className="grid grid-cols-3 gap-2">
        {items.map((s) => (
          <button
            key={s.id}
            onClick={() => onPick(`desktop:${s.id}`, s.name)}
            className="group flex flex-col overflow-hidden rounded border border-border bg-panel2 text-left transition-colors hover:border-accent"
            title={s.name}
          >
            <img src={s.thumbnail} alt={s.name} className="aspect-video w-full bg-black object-contain" />
            <span className="truncate px-1.5 py-1 text-[10px] text-muted group-hover:text-accent">
              {s.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
