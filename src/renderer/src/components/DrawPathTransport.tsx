// The draw sequencer's transport : play / direction / loop / clear, then time,
// jump and wiggle. One component for every drawn path (the Metasurface cursor,
// Context's light), so they play alike and look alike.

import type { SurfaceSequencer } from '@shared/types'

export function DrawPathTransport({
  cfg,
  playing,
  onPlay,
  onWay,
  onClosed,
  onClear,
  onTime,
  onJump,
  onWiggle,
  playTitle
}: {
  cfg: Pick<SurfaceSequencer, 'timeMs' | 'way' | 'jump' | 'wiggle' | 'closed'>
  playing: boolean
  onPlay: (on: boolean) => void
  onWay: (way: SurfaceSequencer['way']) => void
  onClosed: (closed: boolean) => void
  onClear: () => void
  onTime: (ms: number) => void
  onJump: (pct: number) => void
  onWiggle: (pct: number) => void
  playTitle: string
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border/70 bg-panel2/40 p-1.5">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onPlay(!playing)}
          className={`rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
            playing ? 'border-accent2 bg-accent2/20 text-accent2' : 'border-border text-muted hover:text-text'
          }`}
          title={playTitle}
        >
          {playing ? '■ stop' : '▶ play'}
        </button>
        {/* way : direction of travel */}
        <div className="flex overflow-hidden rounded border border-border font-mono text-[10px]">
          {([
            ['forward', '→', 'forward'],
            ['backward', '←', 'backward'],
            ['pingpong', '⇄', 'ping-pong']
          ] as const).map(([w, glyph, label]) => (
            <button
              key={w}
              onClick={() => onWay(w)}
              className={`px-1.5 py-0.5 transition-colors ${
                cfg.way === w ? 'bg-accent2/20 text-accent2' : 'text-muted hover:text-text'
              }`}
              title={label}
            >
              {glyph}
            </button>
          ))}
        </div>
        <button
          onClick={() => onClosed(!cfg.closed)}
          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
            cfg.closed ? 'border-accent2 bg-accent2/20 text-accent2' : 'border-border text-muted hover:text-text'
          }`}
          title="Loop the path : connect the end back to the start so forward play flows around instead of teleporting"
        >
          ⟳ loop
        </button>
        <button
          onClick={onClear}
          className="ml-auto rounded border border-border px-2 py-0.5 font-mono text-[10px] text-muted transition-colors hover:text-text"
          title="Erase the drawn path"
        >
          clear
        </button>
      </div>
      <label className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
        <span className="w-8">time</span>
        <input
          type="range"
          min={200}
          max={60000}
          step={100}
          value={cfg.timeMs}
          onChange={(e) => onTime(Number(e.target.value))}
          className="flex-1 accent-accent2"
        />
        <span className="w-16 text-right tabular-nums text-text">{(cfg.timeMs / 1000).toFixed(1)} s</span>
      </label>
      <label className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
        <span className="w-8">jump</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={cfg.jump}
          onChange={(e) => onJump(Number(e.target.value))}
          className="flex-1 accent-accent2"
          title="Chance the playhead randomly teleports to another spot on the path (jitter)"
        />
        <span className="w-16 text-right tabular-nums text-text">{cfg.jump} %</span>
      </label>
      <label className="flex items-center gap-1.5 font-mono text-[10px] text-muted">
        <span className="w-8">wiggle</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={cfg.wiggle}
          onChange={(e) => onWiggle(Number(e.target.value))}
          className="flex-1 accent-accent2"
          title="Smooth sinusoidal wobble around the traced position (a vibrato, unlike jump's teleports)"
        />
        <span className="w-16 text-right tabular-nums text-text">{cfg.wiggle} %</span>
      </label>
    </div>
  )
}
