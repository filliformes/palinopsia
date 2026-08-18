// The Collage source's media row : pick a folder, and every video in it joins
// the pool the wall deals its pieces from. Mirrors the Text source's strip (the
// other native generator with non-numeric state) rather than the video
// transport, because there is no single clip to scrub.

import { useEffect, useRef, useState } from 'react'
import type { CollageClip, CollageEdl } from '@shared/collage'
import { useStore } from '../store'

export function CollageStrip({
  target,
  folder,
  pool,
  edls
}: {
  // A Collage can sit in a layer slot or on the Background slab; the strip is
  // the same, only the store action it writes through differs.
  target: { kind: 'layer'; layer: number; slot: 'A' | 'B' } | { kind: 'background' }
  folder: string
  pool: CollageClip[]
  edls: CollageEdl[]
}): JSX.Element {
  const setLayerPool = useStore((s) => s.setCollagePool)
  const setLayerEdls = useStore((s) => s.setCollageEdls)
  const setBgPool = useStore((s) => s.setBgCollagePool)
  const setBgEdls = useStore((s) => s.setBgCollageEdls)
  const setCollagePool = (
    _l: number,
    _s: 'A' | 'B',
    dir: string,
    clips: CollageClip[]
  ): void =>
    target.kind === 'background'
      ? setBgPool(dir, clips)
      : setLayerPool(target.layer, target.slot, dir, clips)
  const setCollageEdls = (_l: number, _s: 'A' | 'B', next: CollageEdl[]): void =>
    target.kind === 'background' ? setBgEdls(next) : setLayerEdls(target.layer, target.slot, next)
  const layer = target.kind === 'background' ? 0 : target.layer
  const slot: 'A' | 'B' = target.kind === 'background' ? 'A' : target.slot
  const bank = useStore((s) => s.assemblages)
  const [picking, setPicking] = useState(false)
  // The running VERB doubles as the busy flag : an optimise pass is minutes where
  // a scan is seconds, and the folder button is the only place that says so.
  const [busy, setBusy] = useState<'' | 'scanning' | 'optimising'>('')
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

  const scan = async (dir: string, optimise = false): Promise<void> => {
    setBusy(optimise ? 'optimising' : 'scanning')
    setProgress('')
    setNote('')
    const off = window.api.onCollageProgress((p) => {
      if (alive.current) setProgress(`${p.done}/${p.total}`)
    })
    try {
      const res = optimise ? await window.api.collageOptimise(dir) : await window.api.collageScan(dir)
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
        setBusy('')
        setProgress('')
      }
    }
  }

  const pick = async (): Promise<void> => {
    const dir = await window.api.collagePickFolder()
    if (dir) await scan(dir)
  }

  const name = folder ? folder.split(/[\\/]/).filter(Boolean).pop() : ''
  const chosen = new Set(edls.map((e) => e.id))
  const toggle = (id: string): void => {
    const hit = bank.find((a) => a.id === id)
    if (!hit) return
    // Copy the CLIPS in : the bank is machine-local localStorage, and a session
    // carrying a collage has to replay without it.
    setCollageEdls(
      layer,
      slot,
      chosen.has(id)
        ? edls.filter((e) => e.id !== id)
        : [...edls, { id: hit.id, name: hit.name, clips: hit.clips }]
    )
  }

  return (
    <>
    <div className="flex items-center gap-2 border-b border-border bg-panel2/40 px-2 py-1">
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-muted">films</span>
      <button
        className="btn shrink-0 text-[11px]"
        disabled={!!busy}
        onClick={() => void pick()}
        title="Pick a folder of videos. Every clip in it joins the pool the pieces are dealt from — any format, portrait or landscape; codecs Chromium can't play are converted once."
      >
        {busy ? `${busy} ${progress}` : 'folder…'}
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
      {folder && !busy && (
        <button
          className="btn shrink-0 text-[11px]"
          onClick={() => void scan(folder, true)}
          title="Re-encode every clip in the folder to 720p all-intra H.264 — the shape the wall's constant seeking wants (every window loop, every re-roll, every cut lands on a keyframe instead of decoding forward from one). Much slower than a scan: minutes for a big folder. One-time cost per file, though — the result is cached and found instantly ever after."
        >
          optimise
        </button>
      )}
      {note && <span className="shrink-0 text-[10px] text-muted">{note}</span>}
      <button
        className={`btn shrink-0 text-[11px] ${edls.length ? 'text-accent2' : ''}`}
        onClick={() => setPicking((v) => !v)}
        title="Use saved assemblages as the pieces instead of single files : each one plays its own little edit. Set feed to 'assemblages' to hear them."
      >
        {edls.length ? `${edls.length} edits` : 'edits…'}
      </button>
    </div>
    {picking && (
      <div className="max-h-32 overflow-y-auto border-b border-border bg-panel2/20 px-2 py-1">
        {bank.length === 0 ? (
          <div className="py-1 text-[11px] text-muted">
            No saved assemblages yet — generate and save some in the assemble tab (<kbd>E</kbd>).
          </div>
        ) : (
          bank.map((a) => (
            <label
              key={a.id}
              className="flex cursor-pointer items-center gap-2 py-0.5 text-[11px] hover:text-accent2"
            >
              <input type="checkbox" checked={chosen.has(a.id)} onChange={() => toggle(a.id)} />
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted">{a.clips.length} cuts</span>
            </label>
          ))
        )}
      </div>
    )}
    </>
  )
}
