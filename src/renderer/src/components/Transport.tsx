// Transport bar (brief §10.6): clock/BPM (synced to Pandore over OSC later),
// and the prominent RANDOMIZE button — the Rhodopsin idea-generator. In Phase
// 6 Randomize draws from each shader's CURATED aesthetic sub-range (not raw
// declared min/max) so it stays in the glitch register and out of the
// psychedelic zone (brief §7, §1). For now it's wired as a no-op seam so the
// surface is present and playable from Phase 0.

import { useStore } from '../store'
import { BoundedNumberInput } from './BoundedNumberInput'

export function Transport(): JSX.Element {
  const bpm = useStore((s) => s.composition.bpm)
  const setComposition = useStore.setState

  function setBpm(v: number): void {
    setComposition((s) => ({ composition: { ...s.composition, bpm: v } }))
  }

  function randomize(): void {
    // TODO Phase 6 — randomize every exposed ISF input within its curated
    // aesthetic sub-range. Deliberately a no-op until the ISF library +
    // per-shader ranges exist.
  }

  return (
    <div className="flex items-center gap-4 border-t border-border bg-panel px-4 py-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-muted">BPM</span>
        <div className="w-16">
          <BoundedNumberInput value={bpm} min={20} max={300} onChange={setBpm} />
        </div>
      </div>

      <div className="flex-1" />

      <button
        onClick={randomize}
        className="rounded-md bg-accent/15 px-5 py-1.5 font-mono text-[13px] font-semibold uppercase tracking-wide text-accent ring-1 ring-accent transition-colors hover:bg-accent/25"
        title="Randomize — a new idea from each shader's curated aesthetic range (Phase 6)"
      >
        Randomize
      </button>
    </div>
  )
}
