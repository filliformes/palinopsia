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
  const proximity = useStore((s) => s.proximity)
  const setProximity = useStore((s) => s.setProximity)
  const proximityAudio = useStore((s) => s.proximityAudio)
  const setProximityAudio = useStore((s) => s.setProximityAudio)
  const density = useStore((s) => s.density)
  const setDensity = useStore((s) => s.setDensity)
  const gestureTexture = useStore((s) => s.gestureTexture)
  const setGestureTexture = useStore((s) => s.setGestureTexture)
  const coalesce = useStore((s) => s.coalesce)
  const setCoalesce = useStore((s) => s.setCoalesce)
  const tonicity = useStore((s) => s.tonicity)
  const setTonicity = useStore((s) => s.setTonicity)
  const shutter = useStore((s) => s.shutter)
  const setShutter = useStore((s) => s.setShutter)
  const drift = useStore((s) => s.drift)
  const setDrift = useStore((s) => s.setDrift)
  const superFlicker = useStore((s) => s.superFlicker)
  const setSuperFlicker = useStore((s) => s.setSuperFlicker)
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

      {/* Global speed : scales every visual clock, 1/64×…64× (log). */}
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
          title={`Global speed ${fmtSpeed(globalSpeed)} : double-click to reset to 1×`}
        />
        <span className="w-9 shrink-0 font-mono text-[10px] text-muted">{fmtSpeed(globalSpeed)}</span>
      </div>

      {/* Morph : scene recalls & Randomize crossfade over this time. */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-muted">MORPH</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.004}
          value={msToT(morphMs)}
          onChange={(e) => setMorphMs(tToMs(Number(e.target.value)))}
          onDoubleClick={() => setMorphMs(1000)}
          className="w-24 accent-accent"
          title={`Scene / Randomize morph ${fmtMorph(morphMs)} : double-click for 1s`}
        />
        <span className="w-11 shrink-0 font-mono text-[10px] text-muted">{fmtMorph(morphMs)}</span>
      </div>

      {/* World / diegesis : the active "proposed world" biases coupling + Context
          mood + audio routing. The ⧉ button opens the World editor (also W). */}
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] text-muted">WORLD</span>
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
      <div className="ml-5 flex items-center gap-3">
        <button
          onClick={() => setSequencePageOpen(true)}
          className={`rounded border px-2 py-1 font-mono text-[11px] transition-colors ${
            seqRunning
              ? 'border-accent bg-accent/15 text-accent'
              : 'border-border text-muted hover:text-accent'
          }`}
          title="Open the Sequence / macro-form auto-pilot (Q)"
        >
          {seqRunning ? '▶ Seq' : 'Seq'}
        </button>
        {/* Proximity (Field macro) : one knob places the image in a depth zone,
            far/vista ↔ close/personal, by pushing the Context mood. */}
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-muted">PROX</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={proximity}
            onChange={(e) => setProximity(Number(e.target.value))}
            onDoubleClick={() => setProximity(0.5)}
            className="w-20 accent-accent"
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
        {/* Field macros : spatial-material globals (0.5 = neutral). */}
        <MacroKnob label="DENS" value={density} onChange={setDensity}
          title="Density : sparse ↔ dense (fades upper layers / fills them in). 0.5 neutral · double-click resets" />
        <MacroKnob label="G↔T" value={gestureTexture} onChange={setGestureTexture}
          title="Gesture ↔ Texture : clean directional (sharpen) ↔ internalised churn (trails). 0.5 neutral" />
        <MacroKnob label="COAL" value={coalesce} onChange={setCoalesce}
          title="Coalesce : grain (dither) ↔ mass (blur/smooth). 0.5 neutral" />
        {/* Temperament controls : 0 = off (double-click resets). */}
        <MacroKnob label="TONE" value={tonicity} onChange={setTonicity} neutral={0}
          title="Tonicity : tonal/harmonic audio pulls colour in, noise pulls toward black-and-white (needs Audio on). 0 = off · double-click resets." />
        <MacroKnob label="SHUT" value={shutter} onChange={setShutter} neutral={0}
          title="Shutter : GLOBAL full-freeze stop-motion: dead-holds the whole present, then jumps (24fps → 2fps). 0 = off. For a filmic hold with gate-weave + materiality (feedback keeps running underneath), use Finishing → film hold (Cameraless) instead." />
        <MacroKnob label="DRIFT" value={drift} onChange={setDrift} neutral={0}
          title="Drift : slow analog-instability wander over the grade + rare 'accidents'. 0 = off." />
        <MacroKnob label="SUPER" value={superFlicker} onChange={setSuperFlicker} neutral={0}
          title="Superimposition flicker : a hypnagogic strobe: cross-cuts which layer shows on the drawn cadence (rate follows Cameraless film hold). 0 = off." />
      </div>

      <div className="flex-1" />

      {/* Variation : a baseline-anchored variant of the whole scene at `varAmt`
          (structure fixed, continuous values nudged). */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => applyVariation(varAmt)}
          className="rounded border border-accent2/60 bg-accent2/10 px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide text-accent2 transition-colors hover:bg-accent2/20"
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
          className="w-16 accent-accent2"
          title={`Variation amount ${pct(varAmt)}`}
        />
        <span className="w-8 shrink-0 font-mono text-[10px] text-muted">{pct(varAmt)}</span>
      </div>

      {/* Randomize: chevron selects the mode, button fires it; the amount slider
          scales it from a gentle walk (low %) to a full re-roll (100%). */}
      <div className="flex items-center gap-1.5">
        <span
          className="font-mono text-[9px] uppercase text-muted"
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
          className="w-16 accent-accent"
          title={`Randomize intensity ${pct(intensity)}`}
        />
        <span className="w-8 shrink-0 font-mono text-[10px] text-muted">{pct(intensity)}</span>
      </div>

      <div ref={menuRef} className="relative flex">
        <button
          onClick={() => fireRandomize(scope, intensity)}
          className="rounded-l border border-accent/60 bg-accent/10 px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wide text-accent transition-colors hover:bg-accent/20"
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

// A compact field-macro slider (label + narrow range, double-click → neutral).
// `neutral` is the parked value (0.5 for the bipolar field macros, 0 for the
// unipolar temperament controls).
function MacroKnob({
  label,
  value,
  onChange,
  title,
  neutral = 0.5
}: {
  label: string
  value: number
  onChange: (v: number) => void
  title: string
  neutral?: number
}): JSX.Element {
  const active = Math.abs(value - neutral) > 0.02
  return (
    <div className="flex items-center gap-1" title={title}>
      <span className={`font-mono text-[9px] ${active ? 'text-accent2' : 'text-muted'}`}>{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(neutral)}
        className="w-14 accent-accent2"
      />
    </div>
  )
}
