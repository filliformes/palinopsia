// The session's media, on screen : a banner under the top bar while files are
// missing (Relink… · Details · ✕), and the "Session media" window : every file
// the session plays with its state, Relink missing…, Make converted copies
// again, and Collect into the session's folder.

import { useEffect, useState } from 'react'
import { baseOf, sessionMedia, type MediaEntry } from '../sessionMedia'
import { useStore } from '../store'

let dialogOpen = false
const dialogListeners = new Set<() => void>()
/** Open the Session media window (the banner's Details, the Open ▾ menu). */
export function openSessionMedia(): void {
  dialogOpen = true
  for (const fn of dialogListeners) fn()
  void sessionMedia.check()
}

function useMediaStatus(): ReturnType<typeof sessionMedia.status> {
  const [, bump] = useState(0)
  useEffect(() => sessionMedia.subscribe(() => bump((n) => n + 1)), [])
  return sessionMedia.status()
}

export function MediaBanner(): JSX.Element | null {
  const st = useMediaStatus()
  if (!sessionMedia.bannerShown()) return null
  const names = st.missing.map((m) => baseOf(m.path))
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-border bg-[rgb(217_164_65/0.16)] px-4 py-1 text-[11px]">
      <span className="shrink-0 font-semibold text-[rgb(217_164_65)]">⚠ {st.missing.length} media file{st.missing.length === 1 ? ' is' : 's are'} missing</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted" title={st.missing.map((m) => m.path).join('\n')}>{names.join(' · ')}</span>
      <button className="btn shrink-0 text-[11px]" onClick={() => void sessionMedia.relink()} title="Choose a folder : the missing files are found in it by name (the folders under it too)">Relink…</button>
      <button className="btn shrink-0 text-[11px]" onClick={openSessionMedia} title="Every file this session uses, and what to do about the missing ones">Details</button>
      <button className="shrink-0 px-1 text-muted hover:text-text" onClick={() => sessionMedia.dismiss()} title="Hide (it comes back if other files go missing)">✕</button>
    </div>
  )
}

export function SessionMediaDialog(): JSX.Element | null {
  const [open, setOpen] = useState(dialogOpen)
  useEffect(() => {
    const fn = (): void => setOpen(dialogOpen)
    dialogListeners.add(fn)
    return () => { dialogListeners.delete(fn) }
  }, [])
  const st = useMediaStatus()
  const sessionPath = useStore((s) => s.sessionPath)
  const [busy, setBusy] = useState<string | null>(null)
  if (!open) return null
  const close = (): void => { dialogOpen = false; setOpen(false) }
  const originals = st.entries.filter((e) => !e.cache)
  const run = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(label)
    try { await fn() } finally { setBusy(null) }
  }
  const dot = (e: MediaEntry): JSX.Element => (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${e.kind === 'none' ? 'bg-danger' : 'bg-success'}`}
      title={e.kind === 'none' ? 'Missing' : e.kind === 'dir' ? 'Folder found' : 'Found'}
    />
  )
  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) close() }}
    >
      <div className="flex max-h-full w-full max-w-[760px] flex-col gap-2 rounded-md border border-border bg-panel p-3">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold">Session media</span>
          <span className="font-mono text-[10px] text-muted">
            {st.checking ? 'checking…' : `${originals.length} file${originals.length === 1 ? '' : 's'} · ${st.missing.length} missing${st.cacheMissing.length ? ` · ${st.cacheMissing.length} converted cop${st.cacheMissing.length === 1 ? 'y' : 'ies'} to make again` : ''}`}
          </span>
          <span className="flex-1" />
          <button className="px-1 text-muted hover:text-text" onClick={close} disabled={!!busy} title="Close">✕</button>
        </div>
        <div className="min-h-[120px] overflow-y-auto rounded border border-border bg-panel2/40">
          {originals.length === 0 && <div className="p-3 text-[11px] text-muted">This session plays no files (only generators).</div>}
          {originals.map((e) => (
            <div key={e.path} className="flex min-w-0 items-center gap-2 border-b border-border/40 px-2 py-1 last:border-b-0" title={e.path}>
              {dot(e)}
              <span className={`w-48 shrink-0 truncate text-[11px] ${e.kind === 'none' ? 'text-danger' : ''}`}>{e.kind === 'dir' ? '▸ ' : ''}{baseOf(e.path)}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted">{e.path}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn text-[11px]"
            disabled={!st.missing.length || !!busy}
            onClick={() => void run('relink', () => sessionMedia.relink())}
            title="Choose a folder : the missing files are found in it by name (the folders under it too); what was beside them follows"
          >
            Relink missing…
          </button>
          <button
            className="btn text-[11px]"
            disabled={!st.cacheMissing.length || !!busy}
            onClick={() => void run('rebuild', () => sessionMedia.rebuild())}
            title="Converted copies (of films the player can't read, of a Collage's clips) missing on this computer : made again from their originals"
          >
            Make converted copies again
          </button>
          <button
            className="btn text-[11px]"
            disabled={!originals.length || !!busy}
            onClick={() => void run('collect', () => sessionMedia.collect((d, t) => setBusy(`collect ${d}/${t}`)))}
            title={sessionPath
              ? 'Copy every file into a "<session> media" folder beside the session file and point the session at the copies : it then opens on any computer with that folder. Save afterwards to keep the new paths.'
              : 'Save the session first : its media are collected beside its file'}
          >
            Collect into the session&apos;s folder
          </button>
          <span className="flex-1" />
          {busy && <span className="font-mono text-[10px] text-accent">{busy.startsWith('collect') ? `copying ${busy.slice(8) || '…'}` : `${busy}…`}</span>}
        </div>
      </div>
    </div>
  )
}
