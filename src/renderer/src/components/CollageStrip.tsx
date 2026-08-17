// The Collage source's media row : pick a folder, and every video in it joins
// the pool the wall deals its pieces from. Mirrors the Text source's strip (the
// other native generator with non-numeric state) rather than the video
// transport, because there is no single clip to scrub.

import { useEffect, useRef, useState } from 'react'
import type { CollageClip } from '@shared/collage'
import { useStore } from '../store'

export function CollageStrip({
  layer,
  slot,
  folder,
  pool
}: {
  layer: number
  slot: 'A' | 'B'
  folder: string
  pool: CollageClip[]
}): JSX.Element {
  const setCollagePool = useStore((s) => s.setCollagePool)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [note, setNote] = useState('')
  // A scan can outlive the selection that started it; don't setState after unmount.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const scan = async (dir: string): Promise<void> => {
    setBusy(true)
    setProgress('')
    setNote('')
    const off = window.api.onCollageProgress((p) => {
      if (alive.current) setProgress(`${p.done}/${p.total}`)
    })
    try {
      const res = await window.api.collageScan(dir)
      if (!alive.current) return
      if (!res.ok) {
        setNote(res.error ? 'scan failed' : 'no readable video in that folder')
        return
      }
      setCollagePool(layer, slot, dir, res.clips)
      // Conversions are silent but slow; say what was dropped rather than
      // leaving a short pool unexplained.
      setNote(
        res.clips.length
          ? res.skipped.length
            ? `${res.skipped.length} unreadable, skipped`
            : ''
          : 'no readable video in that folder'
      )
    } finally {
      off()
      if (alive.current) {
        setBusy(false)
        setProgress('')
      }
    }
  }

  const pick = async (): Promise<void> => {
    const dir = await window.api.collagePickFolder()
    if (dir) await scan(dir)
  }

  const name = folder ? folder.split(/[\\/]/).filter(Boolean).pop() : ''

  return (
    <div className="flex items-center gap-2 border-b border-border bg-panel2/40 px-2 py-1">
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-muted">films</span>
      <button
        className="btn shrink-0 text-[11px]"
        disabled={busy}
        onClick={() => void pick()}
        title="Pick a folder of videos. Every clip in it joins the pool the pieces are dealt from — any format, portrait or landscape; codecs Chromium can't play are converted once."
      >
        {busy ? `scanning ${progress}` : 'folder…'}
      </button>
      <span className="min-w-0 flex-1 truncate text-[11px] text-fg" title={folder || undefined}>
        {name || <span className="text-muted">no folder yet</span>}
      </span>
      {pool.length > 0 && (
        <span className="shrink-0 font-mono text-[10px] text-accent2">{pool.length} films</span>
      )}
      {folder && !busy && (
        <button
          className="btn shrink-0 text-[11px]"
          onClick={() => void scan(folder)}
          title="Re-scan the folder (picks up files added since)"
        >
          ↻
        </button>
      )}
      {note && <span className="shrink-0 text-[10px] text-muted">{note}</span>}
    </div>
  )
}
