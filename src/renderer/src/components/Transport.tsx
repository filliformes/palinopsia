// Transport bar (brief): clock/BPM (synced to Pandore over OSC later)
// and the Randomize control. The chevron SELECTS a mode (shown in full on
// the button); pressing the button FIRES the selected mode : so you always
// know which randomize you're about to play. Every draw comes from curated
// aesthetic ranges (brief) : the taste layer, not raw min/max.
//
// Layout : BPM · SPD · MORPH · PROX · Output ── Seq · Sonify · Vary+amt ·
// Randomize. All command buttons share ONE look (sans, semibold) : no more
// mono-caps zoo. The World section lives in the TOP bar now.

import { useEffect, useRef, useState } from 'react'
import { randomSonify } from '../audio/autoSonify'
import { fireFreeze, isFrozen, subscribeFrozen } from '../commands'
import { useSyncExternalStore } from 'react'
import { randomizeMetaKnobs } from '../metaSmooth'
import type { RandomizeScope } from '../randomize'
import { useStore } from '../store'
import { BoundedNumberInput } from './BoundedNumberInput'
import { MidiLearnOverlay } from './MidiLearnOverlay'

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
  { scope: 'meta', label: 'Randomize Meta Knobs' },
  { scope: 'sonify', label: 'Randomize Sonification' }
]

// Meta + Sonify are UI-layer actions (knob smoother / sound engine); everything
// else is a pure composition transform through the store. `intensity` 1 = full
// re-roll, <1 = a walk from the current scene (Meta/Sonify always re-roll).
function fireRandomize(scope: RandomizeScope, intensity: number): void {
  if (scope === 'meta') randomizeMetaKnobs()
  else if (scope === 'sonify') {
    const st = useStore.getState()
    st.setSonify(randomSonify(st.sonify))
  } else useStore.getState().randomize(scope, intensity)
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

// The ONE command-button look for this bar (sans, semibold : no mono-caps).
const TBTN = 'shrink-0 rounded border px-2.5 py-1 text-[11.5px] font-semibold transition-colors'
const TBTN_IDLE = 'border-border bg-panel2 text-muted hover:border-accent/50 hover:text-accent'
const TBTN_LIT = 'border-accent bg-accent/20 text-accent'

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
  // The freeze latch lives outside the store (commands.ts) : subscribe so the
  // ❄ button lights while the output is held (from the button, H, or a pad).
  const frozen = useSyncExternalStore(subscribeFrozen, isFrozen)
  const bpm = useStore((s) => s.composition.bpm)
  const globalSpeed = useStore((s) => s.globalSpeed)
  const setGlobalSpeed = useStore((s) => s.setGlobalSpeed)
  const morphMs = useStore((s) => s.morphMs)
  const setMorphMs = useStore((s) => s.setMorphMs)
  const setSequencePageOpen = useStore((s) => s.setSequencePageOpen)
  const seqRunning = useStore((s) => s.sequence.running)
  const sonifyOn = useStore((s) => s.sonify.on)
  const sonifyPageOpen = useStore((s) => s.sonifyPageOpen)
  const setSonifyPageOpen = useStore((s) => s.setSonifyPageOpen)
  const setOutputPageOpen = useStore((s) => s.setOutputPageOpen)
  const proximity = useStore((s) => s.proximity)
  const setProximity = useStore((s) => s.setProximity)
  const proximityAudio = useStore((s) => s.proximityAudio)
  const setProximityAudio = useStore((s) => s.setProximityAudio)
  // World : moved down from the top bar. The label toggles the editor (also W);
  // the select swaps the active World.
  const worlds = useStore((s) => s.worlds)
  const world = useStore((s) => s.world)
  const setWorld = useStore((s) => s.setWorld)
  const worldPageOpen = useStore((s) => s.worldPageOpen)
  const setWorldPageOpen = useStore((s) => s.setWorldPageOpen)
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
        {/* Tap tempo is a PAD action (fire:tap); the number box is the CC value
            target (transport:bpm) — each gets its own relative wrapper so the
            two learn films never overlap. */}
        <span className="relative flex shrink-0">
          <MidiLearnOverlay id="fire:tap" />
          <button
            onClick={tapTempo}
            className={`${TBTN} ${TBTN_IDLE} active:bg-accent/20`}
            title="Tap tempo : click on the beat (2+ taps) to set the BPM. A pause of 2s starts a fresh count."
          >
            BPM
          </button>
        </span>
        <div className="relative w-10">
          <MidiLearnOverlay id="transport:bpm" />
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
      <div className="relative flex min-w-0 items-center gap-1">
        <MidiLearnOverlay id="transport:speed" />
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
      <div className="relative flex min-w-0 items-center gap-1">
        <MidiLearnOverlay id="transport:morph" />
        <span
          className="font-mono text-[10px] text-muted"
          title="Morph : how long a scene recall or a Randomize takes to crossfade into the new look (double-click the slider for 1s)."
        >
          MORPH
        </span>
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

      {/* Proximity (Field macro) : one knob places the image in a depth zone,
          far/vista ↔ close/personal, by pushing the Context mood. */}
      <div className="relative flex min-w-0 items-center gap-1">
        <MidiLearnOverlay id="transport:prox" />
        <span
          className="font-mono text-[10px] text-muted"
          title="Proximity : one knob places the image in a depth zone — vista/far ↔ personal/close — by pushing the Context mood (double-click the slider for neutral)."
        >
          PROX
        </span>
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
          title="Auto-proximity : when ON (lit), the image's audio brightness (spectral centroid) drives the Prox depth zone automatically — brighter sound pulls the image closer. Off = Prox stays where you set it."
        >
          ◑
        </button>
      </div>

      {/* World : the active-World editor (label toggles it, also W) + the World
          selector. Moved down from the top bar; ml-3 keeps it off the Prox slider. */}
      <button
        onClick={() => setWorldPageOpen(!worldPageOpen)}
        className={`${TBTN} ml-3 ${worldPageOpen ? TBTN_LIT : TBTN_IDLE}`}
        title="Open the World editor (W) : coupling character + Context mood + audio routing"
      >
        World
      </button>
      <select
        className="input select-compact max-w-[130px] shrink-0 text-[11px]"
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

      {/* Freeze : latch that holds the output (render loop ORs it in). Also a
          learn target so a pad can grab-and-hold the frame live. */}
      <span className="relative flex shrink-0">
        <MidiLearnOverlay id="fire:freeze" />
        <button
          onClick={() => fireFreeze()}
          className={`${TBTN} ${frozen ? TBTN_LIT : TBTN_IDLE}`}
          title={
            frozen
              ? 'Output FROZEN / held — click (or H) to release'
              : 'Freeze / hold the output — shortcut H (also MIDI-learnable)'
          }
        >
          ❄
        </button>
      </span>

      {/* Command group, pushed right : Output · Seq · Sonify · Vary · Randomize. */}
      <div className="ml-auto flex min-w-0 items-center gap-1.5">
        {/* Output : fullscreen / mapping / record / senders (also O). */}
        <button
          onClick={() => setOutputPageOpen(true)}
          className={`${TBTN} ${TBTN_IDLE}`}
          title="Output & projection mapping : fullscreen output, keystone, record, NDI/Spout/HIVE (O)"
        >
          ⛶ Output
        </button>
        <span className="relative flex shrink-0">
          <MidiLearnOverlay id="fire:seq" />
          <button
            onClick={() => setSequencePageOpen(true)}
            className={`${TBTN} ${seqRunning ? TBTN_LIT : TBTN_IDLE}`}
            title="Open the Sequence / macro-form auto-pilot (Q)"
          >
            {seqRunning ? '▶ Seq' : 'Seq'}
          </button>
        </span>
        <span className="relative flex shrink-0">
          <MidiLearnOverlay id="fire:sonify" />
          <button
            onClick={() => setSonifyPageOpen(!sonifyPageOpen)}
            className={`${TBTN} ${sonifyOn ? TBTN_LIT : TBTN_IDLE}`}
            title="Open Sonify, the image-to-sound engine (S) : lights while the sound is running"
          >
            {sonifyOn ? '◉ Sonify' : 'Sonify'}
          </button>
        </span>

        {/* Variation : a baseline-anchored variant of the whole scene at `varAmt`
            (structure fixed, continuous values nudged). */}
        <span className="relative flex shrink-0">
          <MidiLearnOverlay id="fire:vary" />
          <button
            onClick={() => applyVariation(varAmt)}
            className={`${TBTN} border-accent2/60 bg-accent2/10 text-accent2 hover:bg-accent2/20`}
            title={`Variation ${pct(varAmt)} : a fresh variant of the current scene (same structure, values nudged). First press sets the baseline; each press is a new sibling at this spread.`}
          >
            Vary
          </button>
        </span>
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

        {/* Randomize: chevron selects the mode, button fires it; the amount
            slider scales it from a gentle walk (low %) to a full re-roll. */}
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

        <div ref={menuRef} className="relative flex shrink-0">
          <span className="relative flex shrink-0">
            <MidiLearnOverlay id="fire:randomize" />
            <button
              onClick={() => fireRandomize(scope, intensity)}
              className={`${TBTN} rounded-r-none border-accent/60 bg-accent/10 text-accent hover:bg-accent/20`}
              title={`Fire ${current.label} : every draw from curated aesthetic ranges`}
            >
              {current.label}
            </button>
          </span>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded-r border border-l-0 border-accent/60 bg-accent/10 px-1.5 text-[10px] text-accent transition-colors hover:bg-accent/20"
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
    </div>
  )
}
