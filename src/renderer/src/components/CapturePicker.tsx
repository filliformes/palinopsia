// CapturePicker : a modal grid of the machine's screens and windows (with live
// thumbnails from the main process) for choosing a screen-capture source.

import { useCallback, useEffect, useState } from 'react'
import type { CaptureSourceInfo, ScreenAccess } from '@shared/types'

export function CapturePicker({
  onPick,
  onCancel
}: {
  onPick: (spec: string, name: string) => void
  onCancel: () => void
}): JSX.Element {
  const [sources, setSources] = useState<CaptureSourceInfo[] | null>(null)
  // macOS will not let an app read the screen without a permission granted in
  // its own settings, and no app can prompt for it. Denied, the enumeration
  // below still answers : every thumbnail comes back black and every window
  // loses its title. Without asking first, this modal is a grid of black
  // rectangles with no explanation.
  const [access, setAccess] = useState<ScreenAccess>('granted')

  // Re-enumerable : plug in a window/projector after opening and hit ⟳ rescan
  // instead of having to close and reopen the modal.
  const refresh = useCallback((): void => {
    setSources(null)
    window.api
      .captureScreenAccess()
      .then(setAccess)
      .catch(() => setAccess('granted'))
    window.api.captureListSources().then(setSources).catch(() => setSources([]))
  }, [])
  useEffect(() => refresh(), [refresh])

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
          <div className="flex items-center gap-1">
            <button
              onClick={refresh}
              className="rounded border border-border px-2 py-0.5 font-mono text-[11px] text-muted hover:text-accent"
              title="Rescan for screens / windows"
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
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {access !== 'granted' && <ScreenAccessNotice onRescan={refresh} />}
          {sources === null ? (
            <div className="p-6 text-center text-[12px] text-muted">Enumerating sources…</div>
          ) : sources.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-6 text-center text-[12px] text-muted">
              No capture sources found.
              <button
                onClick={refresh}
                className="rounded border border-accent/50 bg-accent/10 px-2 py-0.5 font-mono text-[11px] text-accent hover:bg-accent/20"
              >
                ⟳ rescan
              </button>
            </div>
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

/** Shown when the system refuses screen reading, which only macOS does. The two
 *  facts that matter are not guessable from a black thumbnail : where the switch
 *  is, and that it takes effect only on the next start, because the permission
 *  is read once when the app launches. */
function ScreenAccessNotice({ onRescan }: { onRescan: () => void }): JSX.Element {
  return (
    <div className="mb-3 rounded border border-danger/50 bg-danger/10 p-3">
      <div className="mb-1 font-mono text-[9px] uppercase tracking-wide text-danger">
        screen recording is off
      </div>
      <p className="text-[12px] leading-snug text-muted">
        This computer is not letting Palinopsia read the screen, so the pictures below are
        black and windows have no names. Turn Palinopsia on under Privacy &amp; Security,
        Screen &amp; System Audio Recording, then start Palinopsia again : the permission is
        only read at launch. A camera or a video file needs none of this.
      </p>
      <div className="mt-2 flex items-center gap-1">
        <button
          onClick={() => void window.api.captureOpenScreenSettings()}
          className="rounded border border-danger/50 bg-danger/10 px-2 py-0.5 font-mono text-[11px] text-danger hover:bg-danger/20"
        >
          open the setting
        </button>
        <button
          onClick={onRescan}
          className="rounded border border-border px-2 py-0.5 font-mono text-[11px] text-muted hover:text-accent"
          title="Already granted it and started the app again? Rescan."
        >
          ⟳ rescan
        </button>
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
