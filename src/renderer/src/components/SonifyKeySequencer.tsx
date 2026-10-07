// The key sequencer's panel (Sonify seq view, under the effects sequencer) :
// play / mode / dice / reset and the clock (rate, chance, glide) always in view,
// then the pool of keys the generative modes choose from, an optional Euclidean
// rhythm, and the one row of the chosen mode. Engine : audio/soniKeySeq.ts.

import { useEffect, useRef, type ReactNode } from 'react'
import type { SoniKeyMode, SoniKeySeq } from '@shared/types'
import { useStore } from '../store'
import { SONI_SCALES } from '../audio/sonify'
import { NOTE_NAMES, KEY_MODES, euclidHit } from '../audio/soniKeyModel'
import { SONI_RATES, RATE_LABEL, soniBeats } from '../audio/soniClock'
import { keySeqNext, keySeqPhase } from '../audio/soniKeySeq'
import { MidiLearnOverlay } from './MidiLearnOverlay'

const chip = (on: boolean): string =>
  `rounded px-1.5 py-0.5 font-mono text-[8px] ${on ? 'bg-accent/25 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted hover:text-text'}`
const label = 'font-mono text-[8px] text-muted'

const SCALE_ABBR: Record<string, string> = {
  chromatic: 'chr', major: 'maj', minor: 'min', pentatonic: 'pent', wholetone: 'whole', dorian: 'dor', phrygian: 'phr', lydian: 'lyd'
}

const MODE_INFO: Record<SoniKeyMode, { name: string; hint: string; icon: ReactNode }> = {
  list: {
    name: 'list',
    hint: 'List : the keys you write below, played forward, back and forth, or drifting at random',
    icon: <path d="M2 3h8M2 6h8M2 9h8" />
  },
  circle: {
    name: 'circle',
    hint: 'Circle : a walk on the circle of fifths, toward the sharps or the flats, sometimes a hop to the relative major or minor',
    icon: (<><circle cx="6" cy="6" r="4.2" /><circle cx="6" cy="1.8" r="0.9" fill="currentColor" /><circle cx="9.6" cy="3.9" r="0.6" fill="currentColor" /></>)
  },
  affinity: {
    name: 'affinity',
    hint: 'Affinity : the next key chosen by the notes it shares with this one, from smooth (many shared notes) to jarring (few)',
    icon: (<><circle cx="4.4" cy="6" r="3.2" /><circle cx="7.6" cy="6" r="3.2" /></>)
  },
  pivot: {
    name: 'pivot',
    hint: 'Pivot : the same notes on a new tonic (C major to D dorian), or the same tonic in a brighter or darker mode',
    icon: (<><path d="M9.6 6a3.6 3.6 0 1 1-1.05-2.55" /><path d="M8.9 1.7v2.1h-2.1" /><circle cx="6" cy="6" r="0.8" fill="currentColor" /></>)
  },
  picture: {
    name: 'picture',
    hint: 'Picture : the picture picks the key. Its color the root around the circle of fifths, its brightness the mood (bright lydian to dark phrygian)',
    icon: (<><rect x="1.5" y="2.5" width="9" height="7" rx="1" /><path d="M2.5 8.5l2.5-2.5 2 2 1.4-1.4 1.6 1.6" /></>)
  }
}

function Range({ name, value, min, max, step, onChange, shown, title }: {
  name: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; shown: string; title: string
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1" title={title}>
      <span className={`${label} shrink-0`}>{name}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-accent2"
      />
      <span className="w-9 shrink-0 text-right font-mono text-[8px] text-muted">{shown}</span>
    </div>
  )
}

function Stepper({ name, value, min, max, onChange, title }: {
  name: string; value: number; min: number; max: number; onChange: (v: number) => void; title: string
}): JSX.Element {
  return (
    <span className="flex shrink-0 items-center gap-0.5" title={title}>
      <span className={label}>{name}</span>
      <button onClick={() => onChange(Math.max(min, value - 1))} className="rounded bg-panel3/60 px-1 text-[10px] text-muted hover:text-text">−</button>
      <span className="w-4 text-center font-mono text-[9px]">{value}</span>
      <button onClick={() => onChange(Math.min(max, value + 1))} className="rounded bg-panel3/60 px-1 text-[10px] text-muted hover:text-text">+</button>
    </span>
  )
}

/** The key sequencer : composes the root, scale and octave of the whole Sonify
 *  instrument over time. */
export function SonifyKeySequencer(): JSX.Element {
  const ks = useStore((s) => s.soniKeySeq)
  const set = useStore((s) => s.setSoniKeySeq)
  const setOn = useStore((s) => s.setSoniKeySeqOn)
  const setStep = useStore((s) => s.setSoniKeyStep)
  const randomizeSteps = useStore((s) => s.randomizeSoniKeySteps)
  const reset = useStore((s) => s.resetSoniKeySeq)
  const curStep = useStore((s) => s.soniKeyCur)
  const root = useStore((s) => s.sonify.root)
  const scale = useStore((s) => s.sonify.scale)
  const oct = useStore((s) => s.sonify.rootOct ?? 3)

  // The clock's progress toward the next change (a thin bar under the key).
  const barRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    let id = 0
    const f = (): void => {
      const p = keySeqPhase(performance.now(), soniBeats())
      if (barRef.current) barRef.current.style.width = p < 0 ? '0%' : `${(p * 100).toFixed(1)}%`
      id = requestAnimationFrame(f)
    }
    id = requestAnimationFrame(f)
    return () => cancelAnimationFrame(id)
  }, [])

  const p = (patch: Partial<SoniKeySeq>): void => set(patch)
  const generative = ks.mode !== 'list'
  const onCuts = ks.mode === 'picture' && ks.picSource === 'cuts'
  const fmtMs = (ms: number): string => (ms >= 1000 ? (ms / 1000).toFixed(ms >= 10000 ? 0 : 1) + 's' : Math.round(ms) + 'ms')
  const R = 120000 / 250 // the free period : 250 ms … 2 min, log-mapped
  const toggleScale = (sc: string): void => {
    const has = ks.poolScales.includes(sc)
    if (has && ks.poolScales.length === 1) return // a pool always keeps one scale
    p({ poolScales: has ? ks.poolScales.filter((x) => x !== sc) : [...ks.poolScales, sc] })
  }
  const toggleRoot = (i: number): void => {
    const roots = ks.poolRoots.map((on, j) => (j === i ? !on : on))
    if (!roots.some(Boolean)) return // and one root
    p({ poolRoots: roots })
  }

  return (
    <div className="mt-1 flex flex-col gap-1 rounded border border-accent2/40 bg-panel2/40 px-1.5 py-1">
      {/* play · dice · reset · the key now */}
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[8px] uppercase tracking-wide text-muted/70">key sequencer</span>
        <span className="relative flex shrink-0">
          <MidiLearnOverlay id="fire:keyseq" />
          <button
            onClick={() => setOn(!ks.on)}
            className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${ks.on ? 'bg-accent/25 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted hover:text-text'}`}
            title="Play / stop the key sequencer : it changes the root, scale and octave of every Sonify voice over time"
          >{ks.on ? '■ stop' : '▶ play'}</button>
        </span>
        <button
          onClick={() => (ks.mode === 'list' ? randomizeSteps() : keySeqNext(true))}
          className="rounded px-1 py-0.5 text-[11px] leading-none text-muted transition-colors hover:text-accent"
          title={ks.mode === 'list' ? 'New keys for the list, drawn from the pool' : 'A fresh key from the pool now, and the walk forgets where it has been'}
        >🎲</button>
        <button
          onClick={reset}
          className="rounded px-1 py-0.5 text-[12px] leading-none text-muted transition-colors hover:text-accent"
          title="Reset the key sequencer to its defaults"
        >↺</button>
        <div className="ml-auto flex min-w-0 flex-col items-end" title="The key every Sonify voice plays in now (root, scale, octave). The thin bar fills toward the next change.">
          <span className="truncate font-mono text-[10px] text-accent">{NOTE_NAMES[root]} {scale} <span className="text-muted">· {oct}</span></span>
          <div className="h-[2px] w-16 overflow-hidden rounded bg-panel3/60">
            <div ref={barRef} className="h-full bg-accent2" style={{ width: '0%' }} />
          </div>
        </div>
      </div>

      {/* the five modes */}
      <div className="grid grid-cols-5 gap-0.5">
        {KEY_MODES.map((m) => (
          <button
            key={m} onClick={() => p({ mode: m })} title={MODE_INFO[m].hint}
            className={`flex min-w-0 flex-col items-center gap-0.5 rounded py-0.5 font-mono text-[7px] ${ks.mode === m ? 'bg-accent/25 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted hover:text-text'}`}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">{MODE_INFO[m].icon}</svg>
            <span className="max-w-full truncate">{MODE_INFO[m].name}</span>
          </button>
        ))}
      </div>

      {/* the clock */}
      <div className={`flex items-center gap-1.5 ${onCuts ? 'opacity-40' : ''}`}>
        <span className={label}>rate</span>
        <select
          className="input select-compact w-20 text-[9px]" value={ks.rate} disabled={onCuts}
          onChange={(e) => p({ rate: e.target.value as SoniKeySeq['rate'] })}
          title={onCuts ? 'Picture on cuts : the scene cuts set the time, not a clock' : 'How often a change may fall : beats or bars of the composition tempo (in phase with the effects sequencer), or free time'}
        >
          {SONI_RATES.map((r) => <option key={r} value={r}>{RATE_LABEL[r]}</option>)}
        </select>
        {ks.rate === 'free' && !onCuts && (
          <Range
            name="every" value={Math.log(ks.freeMs / 250) / Math.log(R)} min={0} max={1} step={0.002}
            onChange={(v) => p({ freeMs: Math.round(250 * Math.pow(R, v)) })}
            shown={fmtMs(ks.freeMs)} title="The free period between two changes"
          />
        )}
      </div>
      <div className="flex items-center gap-2">
        <Range
          name="chance" value={ks.chance} min={0} max={1} step={0.01} onChange={(v) => p({ chance: v })}
          shown={`${Math.round(ks.chance * 100)}%`}
          title="The odds a change falls when the clock allows one : below 100% the key sometimes stays, and the changes stop sounding like a metronome"
        />
        <Range
          name="glide" value={ks.glide} min={0} max={4} step={0.05} onChange={(v) => p({ glide: v })}
          shown={ks.glide > 0 ? `${ks.glide.toFixed(ks.glide < 1 ? 2 : 1)}s` : 'jump'}
          title="The pitches slide to the new key over this time (every voice : Spectra, Chord, Filter, the Ring bank, Orbit, Raster, the Collage resonators). 0 = they jump at once"
        />
      </div>

      {/* an optional Euclidean rhythm of the clock's ticks */}
      <div className={`flex flex-wrap items-center gap-1.5 ${onCuts ? 'opacity-40' : ''}`}>
        <button
          onClick={() => p({ euclid: !ks.euclid })} disabled={onCuts} className={chip(ks.euclid)}
          title="Euclid : the changes fall on a Euclidean rhythm of the clock's ticks (pulses spread as evenly as they can over the steps) instead of on every tick"
        >euclid</button>
        {ks.euclid && (
          <>
            <Stepper name="pulses" value={ks.ePulses} min={1} max={ks.eSteps} onChange={(v) => p({ ePulses: v })} title="How many of the steps carry a change" />
            <Stepper name="steps" value={ks.eSteps} min={2} max={16} onChange={(v) => p({ eSteps: v, ePulses: Math.min(ks.ePulses, v) })} title="The length of the rhythm, in clock ticks" />
            <Stepper name="rot" value={ks.eRot} min={0} max={ks.eSteps - 1} onChange={(v) => p({ eRot: v })} title="Turns the rhythm : the same pattern starting later" />
            <span className="flex items-center gap-[2px]" title="The rhythm : a filled dot is a tick a change may fall on">
              {Array.from({ length: ks.eSteps }, (_, i) => (
                <span key={i} className={`h-1.5 w-1.5 rounded-full ${euclidHit(i, ks.ePulses, ks.eSteps, ks.eRot) ? 'bg-accent' : 'bg-panel3'}`} />
              ))}
            </span>
          </>
        )}
      </div>

      {/* the pool : the keys the generative modes may choose */}
      {generative && (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-[2px]" title="The roots the sequencer may choose (List plays its own keys)">
            <span className={`${label} w-7 shrink-0`}>roots</span>
            {NOTE_NAMES.map((n, i) => (
              <button
                key={n} onClick={() => toggleRoot(i)}
                className={`h-4 min-w-0 flex-1 rounded-sm font-mono text-[7px] ${ks.poolRoots[i] ? 'bg-accent/30 text-accent' : 'bg-panel3/50 text-muted/60 hover:text-text'}`}
              >{n}</button>
            ))}
          </div>
          <div className="flex items-center gap-[2px]" title="The scales the sequencer may choose">
            <span className={`${label} w-7 shrink-0`}>scales</span>
            {SONI_SCALES.map((sc) => (
              <button
                key={sc} onClick={() => toggleScale(sc)} title={sc}
                className={`h-4 min-w-0 flex-1 rounded-sm font-mono text-[7px] ${ks.poolScales.includes(sc) ? 'bg-accent/30 text-accent' : 'bg-panel3/50 text-muted/60 hover:text-text'}`}
              >{SCALE_ABBR[sc]}</button>
            ))}
          </div>
        </div>
      )}

      {/* the mode's own controls */}
      {ks.mode === 'list' && (
        <div className="flex flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-1">
            <span className={label}>order</span>
            {(['forward', 'bounce', 'drift'] as const).map((o) => (
              <button
                key={o} onClick={() => p({ order: o })} className={chip(ks.order === o)}
                title={o === 'forward' ? 'Play the keys in order, looping' : o === 'bounce' ? 'There and back : to the last key, then back to the first' : 'A random walk across the keys (bias leans it forward or back)'}
              >{o}</button>
            ))}
            {ks.order === 'drift' && (
              <Range name="bias" value={ks.bias} min={-100} max={100} step={1} onChange={(v) => p({ bias: v })} shown={ks.bias > 0 ? `+${ks.bias}` : `${ks.bias}`} title="The walk's lean : − toward earlier keys, + toward later ones, 0 = an even wander" />
            )}
            <span className="ml-auto" />
            <Stepper name="keys" value={ks.len} min={1} max={8} onChange={(v) => p({ len: v })} title="How many keys the list plays" />
          </div>
          {ks.steps.slice(0, ks.len).map((st, i) => (
            <div key={i} className={`flex items-center gap-1 rounded px-0.5 ${ks.on && curStep === i ? 'bg-accent/20 ring-1 ring-accent' : ''}`}>
              <span className="w-3 shrink-0 text-center font-mono text-[8px] text-muted">{i + 1}</span>
              <select className="input select-compact w-12 text-[9px]" value={st.root} onChange={(e) => setStep(i, { root: Number(e.target.value) })} title="The root">
                {NOTE_NAMES.map((n, r) => <option key={n} value={r}>{n}</option>)}
              </select>
              <select className="input select-compact min-w-0 flex-1 text-[9px]" value={st.scale} onChange={(e) => setStep(i, { scale: e.target.value })} title="The scale">
                {SONI_SCALES.map((sc) => <option key={sc} value={sc}>{sc}</option>)}
              </select>
              <Stepper name="oct" value={st.oct} min={1} max={6} onChange={(v) => setStep(i, { oct: v })} title="The root octave (3 = no shift) : the whole instrument moves up or down" />
            </div>
          ))}
        </div>
      )}
      {ks.mode === 'circle' && (
        <div className="flex flex-col gap-0.5">
          <Range
            name="flats ↔ sharps" value={ks.circBias} min={-1} max={1} step={0.01} onChange={(v) => p({ circBias: v })}
            shown={ks.circBias === 0 ? 'even' : ks.circBias > 0 ? `#${Math.round(ks.circBias * 100)}` : `b${Math.round(-ks.circBias * 100)}`}
            title="Which way the walk leans on the circle of fifths : toward the flats (F, Bb, Eb…) or the sharps (G, D, A…). Leaning, it keeps travelling; even, it wanders around home"
          />
          <div className="flex items-center gap-1.5">
            <span className={label} title="The most fifths one change may move (1 = to a neighbor key, the smoothest)">leap</span>
            {[1, 2, 3].map((n) => (
              <button key={n} onClick={() => p({ circLeap: n })} className={chip(ks.circLeap === n)} title={`Up to ${n} fifth${n > 1 ? 's' : ''} per change`}>{n}</button>
            ))}
            <Range
              name="relative" value={ks.circRel} min={0} max={1} step={0.01} onChange={(v) => p({ circRel: v })}
              shown={`${Math.round(ks.circRel * 100)}%`}
              title="The odds of a hop to the relative major or minor instead (C major to A minor : the same notes, another home)"
            />
          </div>
        </div>
      )}
      {ks.mode === 'affinity' && (
        <div className="flex items-center gap-1.5">
          <Range
            name="jarring ↔ smooth" value={ks.affSmooth} min={-100} max={100} step={1} onChange={(v) => p({ affSmooth: v })}
            shown={ks.affSmooth > 0 ? `+${ks.affSmooth}` : `${ks.affSmooth}`}
            title="Smooth : the next key shares most of its notes with this one (a gentle move). Jarring : as few as it can (a jolt). 0 = any key of the pool alike"
          />
          <button onClick={() => p({ affNoRepeat: !ks.affNoRepeat })} className={chip(ks.affNoRepeat)} title="Never return to one of the last few keys">no repeat</button>
          <button onClick={() => p({ affTour: !ks.affTour })} className={chip(ks.affTour)} title="Tour : visit every key of the pool once before any comes back">tour</button>
        </div>
      )}
      {ks.mode === 'pivot' && (
        <div className="flex flex-wrap items-center gap-1">
          <button onClick={() => p({ pivKind: 'modes' })} className={chip(ks.pivKind === 'modes')} title="The same notes, a new tonic : C major, D dorian, E phrygian, F lydian, A minor (from a major, minor or modal key; others keep their tonic)">same notes</button>
          <button onClick={() => p({ pivKind: 'tonic' })} className={chip(ks.pivKind === 'tonic')} title="The same tonic, a new mode : C lydian, C major, C dorian, C minor, C phrygian…">same tonic</button>
          <span className="ml-1" />
          {(['up', 'down', 'random'] as const).map((d) => (
            <button
              key={d} onClick={() => p({ pivDir: d })} className={chip(ks.pivDir === d)}
              title={d === 'random' ? 'Any other one' : ks.pivKind === 'modes' ? `To the next degree ${d}` : d === 'up' ? 'Brighter each time' : 'Darker each time'}
            >{ks.pivKind === 'tonic' && d !== 'random' ? (d === 'up' ? 'brighter' : 'darker') : d}</button>
          ))}
        </div>
      )}
      {ks.mode === 'picture' && (
        <div className="flex items-center gap-1.5">
          <button onClick={() => p({ picSource: 'color' })} className={chip(ks.picSource === 'color')} title="On the clock : the picture's color and brightness choose the key (a grey picture keeps its root)">color</button>
          <button onClick={() => p({ picSource: 'cuts' })} className={chip(ks.picSource === 'cuts')} title="At each scene cut (the whole picture changing at once), a new key read off the new picture">cuts</button>
          <Range
            name="hold" value={ks.picHold} min={0} max={60} step={0.5} onChange={(v) => p({ picHold: v })}
            shown={`${ks.picHold}s`} title="The shortest a key stays : a busy picture cannot change it more often than this"
          />
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <button
          onClick={() => p({ returnHome: !ks.returnHome })} className={`${chip(ks.returnHome)} shrink-0 whitespace-nowrap`}
          title="On stop, go back to the key it started from (or the last key you set by hand while it ran). Off : it stays where it is"
        >↩ home on stop</button>
        <span className="min-w-0 font-mono text-[7px] leading-tight text-muted/60">a key set by hand while it runs becomes its home</span>
      </div>
    </div>
  )
}
