// Inspector view for an Assemble source : the video transport's sibling.
//
// Same shape as VideoTransport (play/pause · loop · a scrubbable timeline · a
// speed slider · mod targets), but the timeline shows the CUTS: each block is
// one clip, so the edit's rhythm is legible and you can see where you are in it.
// The playhead is painted straight from the engine's map in a rAF loop, never
// through React : same discipline as the video transport.

import { useEffect, useRef, useState } from 'react'
import type { SourceSlot } from '@shared/types'
import { edlDuration } from '../assemble/match'
import { videoKey, videoPlayheads } from '../engine/videoState'
import { modTargetKey, placedAssemblage, useStore } from '../store'
import { AssignRow } from './AutoControls'
import { assemblageOfSlot, freshAssemblage, NEW_EDIT_NAME, sameFolder } from '../assemble/place'
import { showToast } from './Toast'

const folderName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() || p

const SMIN = 1 / 16
const SMAX = 16
const tFromSpeed = (s: number): number => Math.log(s / SMIN) / Math.log(SMAX / SMIN)
const speedFromT = (t: number): number => SMIN * Math.pow(SMAX / SMIN, t)
const fmtT = (s: number): string => {
  if (!Number.isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

export function AssembleTransport({
  layer,
  slot,
  state
}: {
  layer: number
  slot: 'A' | 'B'
  state: SourceSlot
}): JSX.Element {
  const setSourceVideoPlayback = useStore((s) => s.setVideoPlayback)
  const clips = state.edl ?? []
  const total = edlDuration(clips)
  const playing = state.videoPlaying ?? true
  const loop = state.videoLoop ?? true
  const speed = state.videoSpeed ?? 1

  const playRef = useRef<HTMLDivElement | null>(null)
  const timeRef = useRef<HTMLSpanElement | null>(null)
  const clipRef = useRef<HTMLSpanElement | null>(null)

  // Live playhead : read the engine's map every frame and poke the DOM.
  // `clips` is derived (`state.edl ?? []`), so it must NOT be a dependency :
  // a fresh [] each render would tear down and rebuild this loop every render.
  // VideoTransport's pattern: key on the slot, read everything else live.
  const clipsRef = useRef(clips)
  clipsRef.current = clips
  useEffect(() => {
    let raf = 0
    const key = videoKey(layer, slot)
    const tick = (): void => {
      const ph = videoPlayheads.get(key)
      if (ph && ph.duration > 0) {
        const f = Math.max(0, Math.min(1, ph.time / ph.duration))
        if (playRef.current) playRef.current.style.left = `${f * 100}%`
        if (timeRef.current) timeRef.current.textContent = fmtT(ph.time)
        if (clipRef.current) {
          // Which block are we inside? Cheap linear walk : a few dozen clips.
          const cs = clipsRef.current
          let acc = 0
          let idx = 0
          for (let i = 0; i < cs.length; i++) {
            if (acc + cs[i].durSec > ph.time) {
              idx = i
              break
            }
            acc += cs[i].durSec
            idx = i
          }
          clipRef.current.textContent = cs.length ? `${idx + 1}/${cs.length}` : '-'
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [layer, slot])

  const set = (patch: Partial<SourceSlot>): void => setSourceVideoPlayback(layer, slot, patch)

  // Which edit plays, and new / vary, without leaving the Inspector.
  const bank = useStore((s) => s.assemblages)
  const corpus = useStore((s) => s.assembleCorpus)
  const setSourceAssemble = useStore((s) => s.setSourceAssemble)
  const own = bank.find((a) => a.id === state.mediaId)
  // Its recipe is known when it is saved or was cut this run.
  const recipeKnown = !!(own ?? placedAssemblage(state.mediaId))
  const fmtD = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  const noCorpus = 'The corpus is not loaded in this run : open the assemble tab once (it analyzes its folder again)'
  const noVideo = 'No usable video in the loaded folder : pick another one in the assemble tab'
  const usable = !!corpus && corpus.units.length > 0
  const cut = (vary: boolean): void => {
    if (!corpus) return void showToast(noCorpus + '.', 'warn', 5000)
    if (!corpus.units.length) return void showToast(noVideo + '.', 'warn', 5000)
    // Vary : this edit's own recipe, new dice. A sibling only comes from the
    // edit's own folder : with another one loaded it is a new edit, said so.
    const edit = vary ? assemblageOfSlot(state) : null
    const elsewhere = !!edit && !sameFolder(edit.folder, corpus.folder)
    const a = edit
      ? freshAssemblage((edit.seed + 1 + ((Math.random() * 1000) | 0)) >>> 0, elsewhere ? NEW_EDIT_NAME : edit.name, edit.params)
      : freshAssemblage()
    if (!a) return void showToast('The recipe found no clips : loosen the matching in the assemble tab.', 'warn', 5000)
    if (elsewhere) showToast(`This edit comes from another folder : a new edit cut from ${folderName(corpus.folder)} instead.`, 'ok', 5000)
    setSourceAssemble(layer, slot, a)
  }

  return (
    // the film transport's frame (a rule above, its inner margin) : it ran from
    // edge to edge of the Inspector, the labels and the timeline on its border
    <div className="flex min-w-0 flex-col gap-1.5 border-t border-border px-2 py-2">
      {/* The edit : the bank's, or this slot's own (a new or a varied cut). */}
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="w-10 shrink-0 font-mono text-[9px] uppercase text-muted">edit</span>
        <select
          className="input select-compact min-w-0 flex-1 text-[11px]"
          value={own ? own.id : '__slot__'}
          onChange={(e) => {
            const a = bank.find((x) => x.id === e.target.value)
            if (a) setSourceAssemble(layer, slot, a)
          }}
          title="Which saved edit this slot plays (the assemble tab's bank)"
        >
          {!own && <option value="__slot__">{state.mediaName || 'this slot\u2019s edit'} (not saved)</option>}
          {bank.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name || 'untitled'} · {fmtD(edlDuration(a.clips))}
            </option>
          ))}
        </select>
        <button
          onClick={() => cut(false)}
          disabled={!usable}
          className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted transition-colors hover:text-accent disabled:opacity-40"
          title={!corpus ? noCorpus : !usable ? noVideo : 'Cut a new edit from the corpus with the assemble tab\u2019s recipe'}
        >
          new
        </button>
        <button
          onClick={() => cut(true)}
          disabled={!usable}
          className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted transition-colors hover:text-accent disabled:opacity-40"
          title={
            !corpus
              ? noCorpus
              : !usable
                ? noVideo
                : recipeKnown
                  ? 'This edit\u2019s own recipe, new dice : a sibling of this edit'
                  : 'New dice on the assemble tab\u2019s recipe (this edit\u2019s own recipe is not known after a restart)'
          }
        >
          vary
        </button>
      </div>
      {/* Transport row. */}
      <div className="flex min-w-0 items-center gap-1.5">
        <button
          onClick={() => set({ videoPlaying: !playing })}
          className={`shrink-0 rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
            playing ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted hover:text-text'
          }`}
          title={playing ? 'Pause the assemblage' : 'Play the assemblage'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          onClick={() => set({ videoLoop: !loop })}
          className={`shrink-0 rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
            loop ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted hover:text-text'
          }`}
          title="Loop back to the first clip at the end"
        >
          ↻
        </button>
        <span ref={timeRef} className="shrink-0 font-mono text-[9px] text-muted">
          0:00
        </span>
        <span className="shrink-0 font-mono text-[9px] text-muted">/ {fmtT(total)}</span>
        <div className="flex-1" />
        <span className="shrink-0 font-mono text-[9px] text-muted" title="Clip position in the edit">
          clip <span ref={clipRef} className="text-accent">-</span>
        </span>
      </div>

      {/* The edit, block by block, with the playhead riding over it. */}
      <div className="relative h-6 w-full overflow-hidden rounded border border-border bg-panel">
        <div className="flex h-full w-full">
          {clips.slice(0, 240).map((c, i) => {
            const h = c.speed <= 1 ? 200 - (1 - c.speed) * 40 : 40 - Math.min(1, (c.speed - 1) / 7) * 40
            return (
              <div
                key={i}
                style={{
                  width: `${(c.durSec / (total || 1)) * 100}%`,
                  background: `hsl(${h} 55% ${34 + (i % 2) * 9}%)`
                }}
                title={`${i + 1}. ${c.fileName} @${c.inSec.toFixed(1)}s · ${c.durSec.toFixed(2)}s on screen · ${c.speed.toFixed(2)}×`}
              />
            )
          })}
        </div>
        <div
          ref={playRef}
          className="pointer-events-none absolute top-0 h-full w-px bg-white"
          style={{ left: '0%' }}
        />
      </div>

      {/* Speed over the WHOLE edit (on top of each clip's own rate). */}
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="w-10 shrink-0 font-mono text-[9px] uppercase text-muted">speed</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.005}
          value={tFromSpeed(Math.max(SMIN, Math.min(SMAX, speed)))}
          onChange={(e) => set({ videoSpeed: speedFromT(Number(e.target.value)) })}
          onDoubleClick={() => set({ videoSpeed: 1 })}
          className="min-w-0 flex-1 accent-accent"
          title={`${speed.toFixed(2)}× over the whole assemblage : multiplies each clip's own rate. Double-click to reset.`}
        />
        <span className="w-10 shrink-0 text-right font-mono text-[9px] text-muted">{speed.toFixed(2)}×</span>
      </div>

      <div className="font-mono text-[9px] text-muted">
        {clips.length} clips ·{' '}
        {new Set(clips.map((c) => c.fileName)).size} source file
        {new Set(clips.map((c) => c.fileName)).size === 1 ? '' : 's'} · the recipe, the corpus and
        saving are in the <span className="text-accent">assemble</span> tab
      </div>

      <AssembleModRow layer={layer} slot={slot} />
    </div>
  )
}

/** `position` scrubs the whole edit, `speed` scales it : the same two names the
 *  video slot exposes, so the modulation surface is consistent. */
function AssembleModRow({ layer, slot }: { layer: number; slot: 'A' | 'B' }): JSX.Element {
  const matrix = useStore((s) => s.composition.modMatrix)
  const [open, setOpen] = useState<string | null>(null)
  const inputs = ['position', 'speed'] as const
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <span className="font-mono text-[9px] uppercase text-muted">mod</span>
        {inputs.map((name) => {
          const target = { kind: 'source' as const, layer, slot, input: name }
          const bound = matrix.filter((a) => modTargetKey(a.target) === modTargetKey(target))
          return (
            <button
              key={name}
              onClick={() => setOpen(open === name ? null : name)}
              className={`rounded px-1.5 py-0.5 font-mono text-[9px] transition-colors ${
                bound.length
                  ? 'bg-accent2/20 text-accent2 ring-1 ring-accent2'
                  : 'bg-panel3/60 text-muted hover:text-text'
              }`}
              title={
                name === 'position'
                  ? 'Modulate the playhead over the whole assemblage (scrub the edit)'
                  : 'Modulate the overall playback rate'
              }
            >
              {name}
            </button>
          )
        })}
      </div>
      {open && (
        <AssignRow
          target={{ kind: 'source', layer, slot, input: open }}
          bound={matrix.filter(
            (a) => modTargetKey(a.target) === modTargetKey({ kind: 'source', layer, slot, input: open })
          )}
        />
      )}
    </div>
  )
}
