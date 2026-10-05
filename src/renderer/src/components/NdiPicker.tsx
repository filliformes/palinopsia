// NdiPicker : every NDI® source on the network (and this computer) for the
// "NDI Input" layer source. NDI® is a registered trademark of Vizrt NDI AB.
// Listing never touches the camera (the live-input picker has to open it once
// to read device names; NDI sources come from the network).

import { useCallback, useEffect, useState } from 'react'

export function NdiPicker({
  onPick,
  onCancel
}: {
  onPick: (name: string) => void
  onCancel: () => void
}): JSX.Element {
  const [sources, setSources] = useState<string[] | null>(null)
  const [msg, setMsg] = useState('')

  const refresh = useCallback(async (): Promise<void> => {
    setSources(null)
    setMsg('')
    try {
      const r = await window.api.ndiInFind(2000)
      setSources(r.sources)
      if (!r.ok) setMsg(r.message)
    } catch (e) {
      setSources([])
      setMsg((e as Error).message)
    }
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])

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
          <span className="text-[13px] font-semibold">Choose an NDI® source</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void refresh()}
              className="rounded border border-border px-2 py-0.5 font-mono text-[11px] text-muted hover:text-accent"
              title="Look for NDI sources on the network again"
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
          {sources === null ? (
            <div className="p-6 text-center text-[12px] text-muted">Looking for NDI sources on the network…</div>
          ) : sources.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-6 text-center text-[12px] text-muted">
              {msg
                ? `NDI is not available : ${msg}. Install it from Output → NDI, then rescan.`
                : 'No NDI sources found. Start one on this network (a camera, NDI Tools, OBS, another Palinopsia), then rescan. Sources on another subnet need a Discovery Server (Output → NDI → network).'}
              <button
                onClick={() => void refresh()}
                className="rounded border border-accent/50 bg-accent/10 px-2 py-0.5 font-mono text-[11px] text-accent hover:bg-accent/20"
              >
                ⟳ rescan
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {sources.map((name) => (
                <button
                  key={name}
                  onClick={() => onPick(name)}
                  className="flex items-center gap-2 rounded border border-border bg-panel2 px-3 py-2 text-left text-[12px] transition-colors hover:border-accent hover:text-accent"
                  title={name}
                >
                  <span className="text-[14px]">📶</span>
                  <span className="truncate">{name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="border-t border-border px-4 py-1.5 text-[10px] text-muted">
          NDI® is a registered trademark of Vizrt NDI AB ·{' '}
          <a href="https://ndi.video" target="_blank" rel="noreferrer" className="underline">
            ndi.video
          </a>
        </div>
      </div>
    </div>
  )
}
