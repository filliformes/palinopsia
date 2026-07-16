// Transport bar (brief): clock/BPM (synced to Pandore over OSC later)
// and the Randomize control. The chevron SELECTS a mode (shown in full on
// the button); pressing the button FIRES the selected mode : so you always
// know which randomize you're about to play. Every draw comes from curated
// aesthetic ranges (brief) : the taste layer, not raw min/max.

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
  { scope: 'sourcefxonly', label: 'Randomize Source FX' },
  { scope: 'layer', label: 'Randomize Layers' },
  { scope: 'layerfxonly', label: 'Randomize Layer FX' },
  { scope: 'master', label: 'Randomize Master FX' },
  { scope: 'finishing', label: 'Randomize Finishing' },
  { scope: 'modulators', label: 'Randomize Modulators' },
  { scope: 'meta', label: 'Randomize Meta Knobs' }
]

// Meta is a UI-layer action (drives the knob smoother); everything else is a
// pure composition transform through the store. `intensity` 1 = full re-roll,
// <1 = a walk from the current scene (Meta ignores it : it always re-rolls).
function fireRandomize(scope: RandomizeScope, intensity: number): void {
  if (scope === 'meta') randomizeMetaKnobs()
  else useStore.getState().randomize(scope, intensity)
}

function loadScope(): RandomizeScope {
  const s = localStorage.getItem('opsia.randScope') as RandomizeScope | null
  return s && SCOPES.some((x) => x.scope === s) ? s : 'all'
}

const loadNum = (key: string, dflt: number): number => {
  const v = Number(localStorage.getItem(key))
  return Number.isFinite(v) && v > 0 ? v : dflt
}
const pct = (v: number): string => Math.round(v * 100) + '%'

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
  const worlds = useStore((s) => s.worlds)
  const world = useStore((s) => s.world)
  const setWorld = useStore((s) => s.setWorld)
  const setWorldPageOpen = useStore((s) => s.setWorldPageOpen)
  const setSequencePageOpen = useStore((s) => s.setSequencePageOpen)
  const seqRunning = useStore((s) => s.sequence.running)
  const sonifyOn = useStore((s) => s.sonify.on)
  const sonifyPageOpen = useStore((s) => s.sonifyPageOpen)
  const setSonifyPageOpen = useStore((s) => s.setSonifyPageOpen)
  const proximity = useStore((s) => s.proximity)
  const setProximity = useStore((s) => s.setProximity)
  const proximityAudio = useStore((s) => s.proximityAudio)
  const setProximityAudio = useStore((s) => s.setProximityAudio)
  const activeWorld = worlds.find((w) => w.id === world)
  const setComposition = useStore.setState
  const applyVariation = useStore((s) => s.applyVariation)
  const [menuOpen, setMenuOpen] = useState(false)
  const [scope, setScope] = useState<RandomizeScope>(loadScope)
  // Randomize intensity (walk↔full) and Variation spread, both persisted.
  const [intensity, setIntensity] = useState<number>(() => loadNum('opsia.randIntensity', 1))
  const [varAmt, setVarAmt] = useState<number>(() => loadNum('opsia.varAmount', 0.3))
  const menuRef = useRef<HTMLDivElement | null>(null)

  const changeIntensity = (v: number): void => {
    setIntensity(v)
    localStorage.setItem('opsia.randIntensity', String(v))
  }
  const changeVarAmt = (v: number): void => {
    setVarAmt(v)
    localStorage.setItem('opsia.varAmount', String(v))
  }

  function setBpm(v: number): void {
    setComposition((s) => ({ composition: { ...s.composition, bpm: v } }))
  }

  // Tap tempo : each click on BPM records a beat; the average of the last few
  // intervals sets the tempo (shown in the box beside it). A >2s gap starts fresh.
  const tapTimes = useRef<number[]>([])
  function tapTempo(): void {
    const now = performance.now()
    const t = tapTimes.current
    if (t.length && now - t[t.length - 1] > 2000) t.length = 0
    t.push(now)
    if (t.length > 6) t.shift()
    if (t.length >= 2) {
      let sum = 0
      for (let i = 1; i < t.length; i++) sum += t[i] - t[i - 1]
      const next = Math.round(60000 / (sum / (t.length - 1)))
      setBpm(Math.max(20, Math.min(800, next)))
    }
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
    <div className="flex flex-nowrap items-center gap-x-2 overflow-x-clip overflow-y-visible border-t border-border bg-panel px-2 py-1.5">
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          onClick={tapTempo}
          className="rounded border border-border px-1 py-0.5 font-mono text-[10px] text-muted transition-colors hover:border-accent/50 hover:text-accent active:bg-accent/20"
          title="Tap tempo : click on the beat (2+ taps) to set the BPM. A pause of 2s starts a fresh count."
        >
          BPM
        </button>
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

      {/* Global speed : scales every visual clock, 1/64×…64× (log). */}
      <div className="flex min-w-0 items-center gap-1">
        <span className="font-mono text-[10px] text-muted">SPD</span>
        <input
          type="range"
          min={-6}
          max={6}
          step={0.02}
          value={Math.log2(globalSpeed)}
          onChange={(e) => setGlobalSpeed(Math.pow(2, Number(e.target.value)))}
          onDoubleClick={() => setGlobalSpeed(1)}
          className="w-20 min-w-0 accent-accent"
          title={`Global speed ${fmtSpeed(globalSpeed)} : double-click to reset to 1×`}
        />
        <span className="w-7 shrink-0 font-mono text-[9px] text-muted">{fmtSpeed(globalSpeed)}</span>
      </div>

      {/* Morph : scene recalls & Randomize crossfade over this time. */}
      <div className="flex min-w-0 items-center gap-1">
        <span className="font-mono text-[10px] text-muted">MRPH</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.004}
          value={msToT(morphMs)}
          onChange={(e) => setMorphMs(tToMs(Number(e.target.value)))}
          onDoubleClick={() => setMorphMs(1000)}
          className="w-16 min-w-0 accent-accent"
          title={`Scene / Randomize morph ${fmtMorph(morphMs)} : double-click for 1s`}
        />
        <span className="w-8 shrink-0 font-mono text-[9px] text-muted">{fmtMorph(morphMs)}</span>
      </div>

      {/* World / diegesis : the active "proposed world" biases coupling + Context
          mood + audio routing. The ⧉ button opens the World editor (also W). */}
      <div className="flex shrink-0 items-center gap-1">
        <span className="font-mono text-[10px] text-muted">WRLD</span>
        <select
          className="input select-compact text-[11px]"
          value={world}
          onChange={(e) => setWorld(e.target.value)}
          title={activeWorld?.blurb}
        >
          {worlds.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => setWorldPageOpen(true)}
          className="btn px-1.5 text-[12px]"
          title="Open the World editor (W)"
        >
          ⧉
        </button>
      </div>

      {/* Seq + Proximity : nudged right of the World block so they read as their
          own macro group, detached from the World section. */}
      <div className="ml-1 flex min-w-0 items-center gap-1.5">
        <button
          onClick={() => setSequencePageOpen(true)}
          className={`shrink-0 rounded border px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide transition-colors ${
            seqRunning
              ? 'border-accent bg-accent/20 text-accent'
              : 'border-border bg-panel2 text-muted hover:border-accent/50 hover:text-accent'
          }`}
          title="Open the Sequence / macro-form auto-pilot (Q)"
        >
          {seqRunning ? '▶ Seq' : 'Seq'}
        </button>
        <button
          onClick={() => setSonifyPageOpen(!sonifyPageOpen)}
          className={`shrink-0 rounded border px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide transition-colors ${
            sonifyOn
              ? 'border-accent bg-accent/20 text-accent'
              : 'border-border bg-panel2 text-muted hover:border-accent/50 hover:text-accent'
          }`}
          title="Open Sonify, the image-to-sound engine (S) : lights while the sound is running"
        >
          {sonifyOn ? '◉ Sfy' : 'Sfy'}
        </button>
        {/* Proximity (Field macro) : one knob places the image in a depth zone,
            far/vista ↔ close/personal, by pushing the Context mood. */}
        <div className="flex min-w-0 items-center gap-1">
          <span className="font-mono text-[9px] text-muted">PROX</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={proximity}
            onChange={(e) => setProximity(Number(e.target.value))}
            onDoubleClick={() => setProximity(0.5)}
            className="w-16 min-w-0 accent-accent"
            title={`Proximity ${proximity < 0.48 ? 'far' : proximity > 0.52 ? 'close' : 'neutral'} : vista ↔ personal (double-click: neutral)`}
          />
          <button
            onClick={() => setProximityAudio(!proximityAudio)}
            className={`shrink-0 rounded px-1 py-0.5 font-mono text-[9px] ${
              proximityAudio ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'
            }`}
            title="Audio brightness (centroid) drives proximity"
          >
            ◑
          </button>
        </div>
        {/* The Field + Temperament macros moved to the Feel tab (right column, G). */}
      </div>

      {/* Variation : a baseline-anchored variant of the whole scene at `varAmt`
          (structure fixed, continuous values nudged). `ml-auto` pushes this +
          amt + Randomize to the right edge when there's room, and keeps them
          together (never off-screen) when the bar wraps on a narrow window. */}
      <div className="ml-auto flex min-w-0 items-center gap-1">
        <button
          onClick={() => applyVariation(varAmt)}
          className="rounded border border-accent2/60 bg-accent2/10 px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-accent2 transition-colors hover:bg-accent2/20"
          title={`Variation ${pct(varAmt)} : a fresh variant of the current scene (same structure, values nudged). First press sets the baseline; each press is a new sibling at this spread.`}
        >
          Vary
        </button>
        <input
          type="range"
          min={0.01}
          max={1}
          step={0.01}
          value={varAmt}
          onChange={(e) => changeVarAmt(Number(e.target.value))}
          className="w-14 min-w-0 accent-accent2"
          title={`Variation amount ${pct(varAmt)}`}
        />
        <span className="w-7 shrink-0 font-mono text-[9px] text-muted">{pct(varAmt)}</span>
      </div>

      {/* Randomize: chevron selects the mode, button fires it; the amount slider
          scales it from a gentle walk (low %) to a full re-roll (100%). */}
      <div className="flex min-w-0 items-center gap-1">
        <span
          className="shrink-0 font-mono text-[9px] uppercase text-muted"
          title="Randomize intensity : low = a gentle walk from the current scene, 100% = a full structural re-roll"
        >
          amt
        </span>
        <input
          type="range"
          min={0.02}
          max={1}
          step={0.01}
          value={intensity}
          onChange={(e) => changeIntensity(Number(e.target.value))}
          className="w-14 min-w-0 accent-accent"
          title={`Randomize intensity ${pct(intensity)}`}
        />
        <span className="w-7 shrink-0 font-mono text-[9px] text-muted">{pct(intensity)}</span>
      </div>

      <div ref={menuRef} className="relative flex shrink-0">
        <button
          onClick={() => fireRandomize(scope, intensity)}
          className="rounded-l border border-accent/60 bg-accent/10 px-2 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide text-accent transition-colors hover:bg-accent/20"
          title={`Fire ${current.label} : every draw from curated aesthetic ranges`}
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
          <div className="absolute bottom-full right-0 z-50 mb-1 flex min-w-[210px] flex-col rounded border border-border bg-panel2 py-1 shadow-lg">
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
