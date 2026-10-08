// The key sequencer's card (Sonify seq view, under the effects sequencer) :
// play / dice / reset and the key now in its header, then the mode, the clock
// (rate, chance, glide), the optional Euclidean rhythm, the pool of keys the
// generative modes choose from and the chosen mode's own rows. Built from the
// Voices view's parts (sonifyUi.tsx). Engine : audio/soniKeySeq.ts.

import { useEffect, useRef, type ReactNode } from 'react'
import type { SoniKeyMode, SoniKeySeq } from '@shared/types'
import { useStore } from '../store'
import { SONI_SCALES } from '../audio/sonify'
import { NOTE_NAMES, KEY_MODES, euclidHit } from '../audio/soniKeyModel'
import { SONI_RATES, RATE_LABEL, soniBeats } from '../audio/soniClock'
import { keySeqNext, keySeqPhase } from '../audio/soniKeySeq'
import { Shell, Row, RangeRow, Stepper, IconBtn, Divider, Seg, Toggle, CardGrip, useCardSpace, chipBig } from './sonifyUi'
import { KeySeqVisual } from './KeySeqVisual'

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

/** The key sequencer : composes the root, scale and octave of the whole Sonify
 *  instrument over time. */
export function SonifyKeySequencer({ onWidth }: { onWidth: (dx: number, done: boolean) => void }): JSX.Element {
  const [space, setSpace, resetSpace] = useCardSpace('key')
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
  const fmtMs = (ms: number): string => {
    if (ms >= 60000) {
      const s = Math.round(ms / 1000)
      return `${Math.floor(s / 60)}m${s % 60 ? String(s % 60).padStart(2, '0') : ''}`
    }
    return ms >= 1000 ? (ms / 1000).toFixed(ms >= 10000 ? 0 : 1) + 's' : Math.round(ms) + 'ms'
  }
  const R = 300000 / 250 // the free period : 250 ms … 5 min, log-mapped
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
    <Shell
      title="Key sequencer"
      hint="Composes the root, scale and octave of every Sonify voice over time, on the composition tempo (in phase with the effects sequencer) or free time."
      on={ks.on}
      onToggle={() => setOn(!ks.on)}
      toggleText={['■ stop', '▶ play']}
      toggleTitle="Play / stop the key sequencer : it changes the root, scale and octave of every Sonify voice over time"
      midiId="fire:keyseq"
      open
      roomy
      space={space}
      foot={<CardGrip space={space} onSpace={setSpace} onReset={resetSpace} onWidth={onWidth} />}
      right={(
        <>
          <IconBtn
            onClick={() => (ks.mode === 'list' ? randomizeSteps() : keySeqNext(true))}
            title={ks.mode === 'list' ? 'New keys for the list, drawn from the pool' : 'A fresh key from the pool now, and the walk forgets where it has been'}
          >🎲</IconBtn>
          <IconBtn onClick={reset} title="Reset the key sequencer to its defaults">↺</IconBtn>
        </>
      )}
    >
      <Row label="key" hint="The key every Sonify voice plays in now (root, scale, octave). The thin bar fills toward the next change.">
        <span className="shrink-0 font-mono text-[10px] text-accent">{NOTE_NAMES[root]} {scale} <span className="text-muted">· oct {oct}</span></span>
        <span className="h-[3px] min-w-0 flex-1 overflow-hidden rounded bg-panel3/60">
          <span ref={barRef} className="block h-full bg-accent2" style={{ width: '0%' }} />
        </span>
      </Row>
      {/* the five modes, the card's full width (a tab strip) */}
      <div className="grid grid-cols-5 gap-1" title="How the next key is chosen">
        {KEY_MODES.map((m) => (
          <button
            key={m} onClick={() => p({ mode: m })} title={MODE_INFO[m].hint}
            className={`${chipBig(ks.mode === m).replace('text-[9px]', 'text-[8px]')} flex min-w-0 flex-col items-center gap-1 px-0 py-1.5`}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">{MODE_INFO[m].icon}</svg>
            <span className="max-w-full truncate">{MODE_INFO[m].name}</span>
          </button>
        ))}
      </div>

      {/* each mode drawn as it thinks */}
      <KeySeqVisual />
      <Divider />
      {/* the clock */}
      <Row label="rate" hint={onCuts ? 'Picture on cuts : the scene cuts set the time, not a clock' : 'How often a change may fall : beats or bars of the composition tempo (in phase with the effects sequencer), or free time'}>
        <select
          className="input select-compact min-w-0 flex-1 text-[10px]" value={ks.rate} disabled={onCuts}
          onChange={(e) => p({ rate: e.target.value as SoniKeySeq['rate'] })}
          title="How often a change may fall"
        >
          {SONI_RATES.map((r) => <option key={r} value={r}>{RATE_LABEL[r]}</option>)}
        </select>
      </Row>
      {ks.rate === 'free' && !onCuts && (
        <Row label="every" hint="How often a change may fall, in free time (250 ms to 5 min)">
          <input
            type="range" min={0} max={1} step={0.002} value={Math.log(ks.freeMs / 250) / Math.log(R)}
            onChange={(e) => p({ freeMs: Math.round(250 * Math.pow(R, Number(e.target.value))) })}
            onDoubleClick={() => p({ freeMs: 5000 })}
            className="min-w-0 flex-1 accent-accent" title={`Every ${fmtMs(ks.freeMs)} (double-click : 5 s)`}
          />
          <span className="w-12 shrink-0 text-right font-mono text-[9px] text-muted">{fmtMs(ks.freeMs)}</span>
        </Row>
      )}
      <RangeRow
        label="chance" value={ks.chance} min={0} max={1} step={0.01} neutral={1} onChange={(v) => p({ chance: v })}
        shown={`${Math.round(ks.chance * 100)}%`}
        title="The odds a change falls when the clock allows one : below 100% the key sometimes stays, and the changes stop sounding like a metronome"
      />
      <RangeRow
        label="glide" value={ks.glide} min={0} max={4} step={0.05} neutral={1} onChange={(v) => p({ glide: v })}
        shown={ks.glide > 0 ? `${ks.glide.toFixed(ks.glide < 1 ? 2 : 1)}s` : 'jump'}
        title="The pitches slide to the new key over this time (every voice : Spectra, Chord, Filter, the Ring bank, Orbit, Raster, the Collage resonators). 0 = they jump at once"
      />
      <Row label="euclid" hint="The changes fall on a Euclidean rhythm of the clock's ticks (pulses spread as evenly as they can over the steps) instead of on every tick">
        <Toggle on={ks.euclid} onClick={() => p({ euclid: !ks.euclid })} disabled={onCuts}>{ks.euclid ? 'on' : 'off'}</Toggle>
        {ks.euclid && (
          <>
            <Stepper value={ks.ePulses} min={1} max={ks.eSteps} onChange={(v) => p({ ePulses: v })} title="Pulses : how many of the steps carry a change" />
            <span className="font-mono text-[9px] text-muted">/</span>
            <Stepper value={ks.eSteps} min={2} max={16} onChange={(v) => p({ eSteps: v, ePulses: Math.min(ks.ePulses, v) })} title="Steps : the length of the rhythm, in clock ticks" />
            <Stepper value={ks.eRot} min={0} max={ks.eSteps - 1} onChange={(v) => p({ eRot: v })} title="Rotation : the same pattern starting later" suffix="↻" />
          </>
        )}
      </Row>
      {ks.euclid && (
        <Row label="" hint="The rhythm : a filled dot is a tick a change may fall on">
          <span className="flex flex-wrap items-center gap-[3px]">
            {Array.from({ length: ks.eSteps }, (_, i) => (
              <span key={i} className={`h-1.5 w-1.5 rounded-full ${euclidHit(i, ks.ePulses, ks.eSteps, ks.eRot) ? 'bg-accent' : 'bg-panel3'}`} />
            ))}
          </span>
        </Row>
      )}

      {/* the pool : the keys the generative modes may choose */}
      {generative && (
        <>
          <Divider />
          <Row label="roots" hint="The roots the sequencer may choose (List plays its own keys)">
            <div className="grid min-w-0 flex-1 grid-cols-6 gap-1">
              {NOTE_NAMES.map((n, i) => (
                <button key={n} onClick={() => toggleRoot(i)} className={`${chipBig(ks.poolRoots[i])} px-0`}>{n}</button>
              ))}
            </div>
          </Row>
          <Row label="scales" hint="The scales the sequencer may choose">
            <div className="grid min-w-0 flex-1 grid-cols-4 gap-1">
              {SONI_SCALES.map((sc) => (
                <button key={sc} onClick={() => toggleScale(sc)} title={sc} className={`${chipBig(ks.poolScales.includes(sc))} px-0`}>{SCALE_ABBR[sc]}</button>
              ))}
            </div>
          </Row>
        </>
      )}

      <Divider />

      {/* the mode's own rows */}
      {ks.mode === 'list' && (
        <>
          <Row label="order" hint="How the list is played">
            <Seg
              options={['forward', 'bounce', 'drift'] as const} value={ks.order} onChange={(o) => p({ order: o })}
              title={(o) => (o === 'forward' ? 'Play the keys in order, looping' : o === 'bounce' ? 'There and back : to the last key, then back to the first' : 'A random walk across the keys (bias leans it forward or back)')}
            />
            <Stepper value={ks.len} min={1} max={8} onChange={(v) => p({ len: v })} title="How many keys the list plays" />
          </Row>
          {ks.order === 'drift' && (
            <RangeRow label="bias" value={ks.bias} min={-100} max={100} step={1} neutral={0} onChange={(v) => p({ bias: v })} shown={ks.bias > 0 ? `+${ks.bias}` : `${ks.bias}`} title="The walk's lean : − toward earlier keys, + toward later ones, 0 = an even wander" />
          )}
          {ks.steps.slice(0, ks.len).map((st, i) => (
            <div key={i} className={`flex min-w-0 items-center gap-1.5 rounded px-0.5 py-0.5 ${ks.on && curStep === i ? 'bg-accent/20 ring-1 ring-accent' : ''}`}>
              <span className="w-[52px] shrink-0 font-mono text-[9px] uppercase text-muted">key {i + 1}</span>
              <select className="input select-compact w-12 text-[10px]" value={st.root} onChange={(e) => setStep(i, { root: Number(e.target.value) })} title="The root">
                {NOTE_NAMES.map((n, r) => <option key={n} value={r}>{n}</option>)}
              </select>
              <select className="input select-compact min-w-0 flex-1 text-[10px]" value={st.scale} onChange={(e) => setStep(i, { scale: e.target.value })} title="The scale">
                {SONI_SCALES.map((sc) => <option key={sc} value={sc}>{sc}</option>)}
              </select>
              <Stepper value={st.oct} min={1} max={6} onChange={(v) => setStep(i, { oct: v })} title="The root octave (3 = no shift) : the whole instrument moves up or down" />
            </div>
          ))}
        </>
      )}
      {ks.mode === 'circle' && (
        <>
          <RangeRow
            label="lean" value={ks.circBias} min={-1} max={1} step={0.01} neutral={0} onChange={(v) => p({ circBias: v })}
            shown={ks.circBias === 0 ? 'even' : ks.circBias > 0 ? `#${Math.round(ks.circBias * 100)}` : `b${Math.round(-ks.circBias * 100)}`}
            title="Which way the walk leans on the circle of fifths : toward the flats (F, Bb, Eb…) or the sharps (G, D, A…). Leaning, it keeps travelling; even, it wanders around home"
          />
          <Row label="leap" hint="The most fifths one change may move (1 = to a neighbor key, the smoothest)">
            <Seg options={[1, 2, 3] as const} value={ks.circLeap as 1 | 2 | 3} onChange={(n) => p({ circLeap: n })} title={(n) => `Up to ${n} fifth${n > 1 ? 's' : ''} per change`} />
          </Row>
          <RangeRow
            label="relative" value={ks.circRel} min={0} max={1} step={0.01} neutral={0.25} onChange={(v) => p({ circRel: v })}
            shown={`${Math.round(ks.circRel * 100)}%`}
            title="The odds of a hop to the relative major or minor instead (C major to A minor : the same notes, another home)"
          />
        </>
      )}
      {ks.mode === 'affinity' && (
        <>
          <RangeRow
            label="feel" value={ks.affSmooth} min={-100} max={100} step={1} neutral={50} onChange={(v) => p({ affSmooth: v })}
            shown={ks.affSmooth > 0 ? `+${ks.affSmooth}` : `${ks.affSmooth}`}
            title="Smooth (+) : the next key shares most of its notes with this one (a gentle move). Jarring (−) : as few as it can (a jolt). 0 = any key of the pool alike"
          />
          <Row label="memory" hint="What the walk remembers">
            <Toggle on={ks.affNoRepeat} onClick={() => p({ affNoRepeat: !ks.affNoRepeat })} title="Never return to one of the last few keys">no repeat</Toggle>
            <Toggle on={ks.affTour} onClick={() => p({ affTour: !ks.affTour })} title="Tour : visit every key of the pool once before any comes back">tour</Toggle>
          </Row>
        </>
      )}
      {ks.mode === 'pivot' && (
        <>
          <Row label="pivot" hint="What stays the same">
            <Seg
              options={['modes', 'tonic'] as const} value={ks.pivKind} onChange={(v) => p({ pivKind: v })}
              label={(v) => (v === 'modes' ? 'same notes' : 'same tonic')}
              title={(v) => (v === 'modes' ? 'The same notes, a new tonic : C major, D dorian, E phrygian, F lydian, A minor (from a major, minor or modal key; others keep their tonic)' : 'The same tonic, a new mode : C lydian, C major, C dorian, C minor, C phrygian…')}
            />
          </Row>
          <Row label="way" hint="Which way it pivots">
            <Seg
              options={['up', 'down', 'random'] as const} value={ks.pivDir} onChange={(d) => p({ pivDir: d })}
              label={(d) => (ks.pivKind === 'tonic' && d !== 'random' ? (d === 'up' ? 'brighter' : 'darker') : d)}
              title={(d) => (d === 'random' ? 'Any other one' : ks.pivKind === 'modes' ? `To the next degree ${d}` : d === 'up' ? 'Brighter each time' : 'Darker each time')}
            />
          </Row>
        </>
      )}
      {ks.mode === 'picture' && (
        <>
          <Row label="reads" hint="When the picture is read">
            <Seg
              options={['color', 'cuts'] as const} value={ks.picSource} onChange={(v) => p({ picSource: v })}
              title={(v) => (v === 'color' ? "On the clock : the picture's color and brightness choose the key (a grey picture keeps its root)" : 'At each scene cut (the whole picture changing at once), a new key read off the new picture')}
            />
          </Row>
          <RangeRow
            label="hold" value={ks.picHold} min={0} max={60} step={0.5} neutral={8} onChange={(v) => p({ picHold: v })}
            shown={`${ks.picHold}s`} title="The shortest a key stays : a busy picture cannot change it more often than this"
          />
        </>
      )}

      <Divider />
      <Row label="home" hint="On stop, go back to the key it started from (or the last key you set by hand while it ran). Off : it stays where it is. A key set by hand while it runs becomes its home.">
        <Toggle on={ks.returnHome} onClick={() => p({ returnHome: !ks.returnHome })}>
          {ks.returnHome ? '↩ back home on stop' : 'stays on stop'}
        </Toggle>
      </Row>
    </Shell>
  )
}
