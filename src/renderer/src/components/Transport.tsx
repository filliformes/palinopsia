// Transport bar (brief §10.6): clock/BPM (synced to Pandore over OSC later)
// and the Randomize control. The chevron SELECTS a mode (shown in full on
// the button); pressing the button FIRES the selected mode — so you always
// know which randomize you're about to play. Every draw comes from curated
// aesthetic ranges (brief §7) — the taste layer, not raw min/max.

import { useEffect, useRef, useState } from 'react'
import { randomizeMetaKnobs } from '../metaSmooth'
import type { RandomizeScope } from '../randomize'
import { useStore } from '../store'
import { BoundedNumberInput } from './BoundedNumberInput'

const SCOPES: Array<{ scope: RandomizeScope; label: string }> = [
  { scope: 'all', label: 'Randomize All' },
  { scope: 'sources', label: 'Randomize Sources' },
  { scope: 'sourceparams', label: 'Randomize Source Parameters' },
  { scope: 'sourcefx', label: 'Randomize Source + FX' },
  { scope: 'layer', label: 'Randomize Layers' },
  { scope: 'master', label: 'Randomize Master FX' },
  { scope: 'modulators', label: 'Randomize Modulators' },
  { scope: 'meta', label: 'Randomize Meta Knobs' }
]

// Meta is a UI-layer action (drives the knob smoother); everything else is a
// pure composition transform through the store.
function fireRandomize(scope: RandomizeScope): void {
  if (scope === 'meta') randomizeMetaKnobs()
  else useStore.getState().randomize(scope)
}

function loadScope(): RandomizeScope {
  const s = localStorage.getItem('opsia.randScope') as RandomizeScope | null
  return s && SCOPES.some((x) => x.scope === s) ? s : 'all'
}

// 1/64×…64× shown as a compact fraction/multiple.
function fmtSpeed(s: number): string {
  if (Math.abs(s - 1) < 0.02) return '1×'
  if (s > 1) return (s < 10 ? s.toFixed(1).replace(/\.0$/, '') : String(Math.round(s))) + '×'
  return '1/' + Math.round(1 / s) + '×'
}
// Morph slider ↔ ms, power-curved so the low end (fast morphs) is easy to hit.
const MORPH_POW = 2.5
const msToT = (ms: number): number => Math.pow(ms / 30000, 1 / MORPH_POW)
const tToMs = (t: number): number => Math.round(Math.pow(t, MORPH_POW) * 30000)
function fmtMorph(ms: number): string {
  return ms >= 1000 ? (ms / 1000).toFixed(1).replace(/\.0$/, '') + 's' : Math.round(ms) + 'ms'
}

export function Transport(): JSX.Element {
  const bpm = useStore((s) => s.composition.bpm)
  const globalSpeed = useStore((s) => s.globalSpeed)
  const setGlobalSpeed = useStore((s) => s.setGlobalSpeed)
  const morphMs = useStore((s) => s.morphMs)
  const setMorphMs = useStore((s) => s.setMorphMs)
  const setComposition = useStore.setState
  const [menuOpen, setMenuOpen] = useState(false)
  const [scope, setScope] = useState<RandomizeScope>(loadScope)
  const menuRef = useRef<HTMLDivElement | null>(null)

  function setBpm(v: number): void {
    setComposition((s) => ({ composition: { ...s.composition, bpm: v } }))
  }

  function selectScope(s: RandomizeScope): void {
    setScope(s)
    localStorage.setItem('opsia.randScope', s)
    setMenuOpen(false)
  }

  // Close the scope menu on any outside click.
  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menuOpen])

  const current = SCOPES.find((s) => s.scope === scope) ?? SCOPES[0]

  return (
    <div className="flex items-center gap-4 border-t border-border bg-panel px-4 py-1.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-muted">BPM</span>
        <div className="w-10">
          <BoundedNumberInput
            value={bpm}
            min={20}
            max={800}
            integer
            onChange={setBpm}
            className="input w-full px-1 py-0.5 text-right text-[11px]"
          />
        </div>
      </div>

      {/* Global speed — scales every visual clock, 1/64×…64× (log). */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-muted">SPEED</span>
        <input
          type="range"
          min={-6}
          max={6}
          step={0.02}
          value={Math.log2(globalSpeed)}
          onChange={(e) => setGlobalSpeed(Math.pow(2, Number(e.target.value)))}
          onDoubleClick={() => setGlobalSpeed(1)}
          className="w-28 accent-accent"
          title={`Global speed ${fmtSpeed(globalSpeed)} — double-click to reset to 1×`}
        />
        <span className="w-9 shrink-0 font-mono text-[10px] text-muted">{fmtSpeed(globalSpeed)}</span>
      </div>

      {/* Morph — scene recalls & Randomize crossfade over this time. */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-muted">MORPH</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.004}
          value={msToT(morphMs)}
          onChange={(e) => setMorphMs(tToMs(Number(e.target.value)))}
          onDoubleClick={() => setMorphMs(100)}
          className="w-24 accent-accent"
          title={`Scene / Randomize morph ${fmtMorph(morphMs)} — double-click for 100ms`}
        />
        <span className="w-11 shrink-0 font-mono text-[10px] text-muted">{fmtMorph(morphMs)}</span>
      </div>

      <div className="flex-1" />

      {/* Randomize: chevron selects the mode, button fires it. */}
      <div ref={menuRef} className="relative flex">
        <button
          onClick={() => fireRandomize(scope)}
          className="rounded-l border border-accent/60 bg-accent/10 px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide text-accent transition-colors hover:bg-accent/20"
          title={`Fire ${current.label} — every draw from curated aesthetic ranges`}
        >
          {current.label}
        </button>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="rounded-r border border-l-0 border-accent/60 bg-accent/10 px-1.5 font-mono text-[10px] text-accent transition-colors hover:bg-accent/20"
          title="Choose which randomize the button fires"
        >
          ▾
        </button>
        {menuOpen && (
          <div className="absolute bottom-full right-0 z-20 mb-1 flex min-w-[210px] flex-col rounded border border-border bg-panel2 py-1 shadow-lg">
            {SCOPES.map((s) => (
              <button
                key={s.scope}
                onClick={() => selectScope(s.scope)}
                className={`flex items-center gap-2 px-3 py-1 text-left text-[11px] transition-colors hover:bg-accent/15 hover:text-accent ${
                  s.scope === scope ? 'text-accent' : ''
                }`}
              >
                <span className="w-3 font-mono text-[10px]">{s.scope === scope ? '✓' : ''}</span>
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
