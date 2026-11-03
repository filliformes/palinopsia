// The Synth's card on the Sonify page (its rows : the page draws the card
// itself, VoiceShell, with its on / off and its dice). In the order you play
// it : the sound (a factory sound, the engine, its voices and three macros),
// how the picture is read (pitch from where, the range, how much movement
// counts, the timing, steps or slide, the tap), the tone (the filter), the
// envelope, life (glide, drift, chorus, level), then the picture patchbay
// (folded : PICTURE and its ten rows). The play side is audio/synthPlay.ts,
// the sound synth.engine.js.

import { useState, type ReactNode } from 'react'
import type { SonifyModParam } from '@shared/types'
import type { SoniConfig } from '../audio/sonify'
import { SYNTH_PATCHES } from '../audio/synthPatches'
import {
  SYNTH_DEPTH_PARAMS, SYNTH_DESTS, SYNTH_DEST_LABEL, SYNTH_ENGINES, SYNTH_FILTERS, SYNTH_GRIDS, SYNTH_MACROS,
  SYNTH_MODES, SYNTH_SRCS, SYNTH_SRC_HINT, normalizeSynth, type SynthCfg, type SynthDest, type SynthRow
} from '../audio/synthPlay'
import { LiveNum, Row, Seg, chip as chipCls } from './sonifyUi'
import { modTargetKey } from '../store'
import type { SliderProps } from './SonifyPage'
import { MidiLearnOverlay } from './MidiLearnOverlay'

const ENGINE_HINT: Record<string, string> = {
  dco: 'DCO : two digital oscillators, their wave, density then interval, sync up to a metallic edge',
  ms: 'MS : a hard-edged analog pair, the second one\'s interval then ring modulation, dirt',
  swarm: 'Swarm : a cloud of detuned voices, its shape, spread and pulse',
  fm: 'FM : bright bell to bite, by ratio steps',
  modal: 'Modal : struck resonators, a material and its damping',
  voice: 'Voice : formants, a vowel, a throat, breath',
  fold: 'Fold : a wavefolder, its symmetry and a gate',
  pluck: 'Pluck : a plucked string, bright, stiff or damped'
}
const MODE_LABEL: Record<string, string> = { height: 'height', keyboard: 'keys', radial: 'radial', score: 'score' }
const MODE_HINT: Record<string, string> = {
  height: 'Pitch from height : low at the bottom, high at the top',
  keyboard: 'Pitch from left to right, like a keyboard',
  radial: 'Pitch from the center out : low in the middle, high at the edges (on the dome : the zenith low, the rim high)',
  score: 'A playhead sweeps the picture on the beat and the shapes it crosses play (light and edges, not motion), pitch by height : the picture as a piano roll'
}
const GRID_LABEL: Record<string, string> = { free: 'free', '8': '1/8', '16': '1/16', '8t': '1/8T' }
const SRC_LABEL: Record<string, string> = {
  none: 'none', speed: 'speed', size: 'size', brightness: 'brightness', hue: 'hue', saturation: 'saturation',
  texture: 'texture', x: 'x', y: 'y', direction: 'direction', age: 'age',
  motion: 'motion ▣', light: 'light ▣', warmth: 'warmth ▣', busyness: 'busyness ▣', cut: 'cut ▣'
}
const DEST_HINT: Record<SynthDest, string> = {
  vel: 'how hard each thing strikes, and its loudness while it plays (around its strike)',
  timbre: 'the engine\'s first macro', harmonics: 'the engine\'s second macro', morph: 'the engine\'s third macro',
  cutoff: 'the filter\'s cutoff', reso: 'the filter\'s resonance', drive: 'the drive into the filter',
  env: 'the envelope\'s times at each strike : negative = plucky, positive = a slow pad',
  pan: 'where the thing sits left to right (its own place, not an offset)',
  bend: 'a bend of up to two semitones'
}

const sub = (text: string): JSX.Element => (
  <div className="mt-0.5 font-mono text-[8px] uppercase tracking-wide text-muted/70">{text}</div>
)
const fmt2 = (v: number): string => v.toFixed(2)
const pm = (v: number): string => `${v > 0 ? '+' : ''}${v.toFixed(2)}`

export function SynthCard({ cfg, set, chip, assignBox, Slider, tap }: {
  cfg: SoniConfig
  /** Patch the Synth's config (from the store as it is now). */
  set: (p: Partial<SynthCfg>) => void
  chip: (p: SonifyModParam, inactive?: boolean) => JSX.Element
  assignBox: (...ps: SonifyModParam[]) => JSX.Element | null
  Slider: (p: SliderProps) => JSX.Element
  tap: ReactNode
}): JSX.Element {
  const s = normalizeSynth(cfg.synth)
  const [picOpen, setPicOpen] = useState(false)
  const macros = SYNTH_MACROS[s.engine]
  const midi = (p: string): string => `sonify:param:${p}`
  const env = (label: string, k: 'attack' | 'decay' | 'sustain' | 'release', title: string): JSX.Element => (
    <div className="flex min-w-0 items-center gap-1" title={title}>
      <span className="w-3 shrink-0 font-mono text-[9px] uppercase text-muted">{label}</span>
      <input
        type="range" min={0} max={1} step={0.01} value={s[k]}
        onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<SynthCfg>)}
        onDoubleClick={() => set({ [k]: k === 'attack' ? 0.05 : k === 'decay' ? 0.35 : k === 'sustain' ? 0.6 : 0.35 } as Partial<SynthCfg>)}
        className="min-w-0 flex-1 accent-accent"
        title={`${title} : ${s[k].toFixed(2)}`}
      />
      <span className="w-7 shrink-0 text-right font-mono text-[9px] text-muted">{s[k].toFixed(2)}</span>
    </div>
  )
  const patchRow = (d: SynthDest, i: number): JSX.Element => {
    const row: SynthRow = s.patch[i]
    const setRow = (p: Partial<SynthRow>): void => set({ patch: s.patch.map((r, j) => (j === i ? { ...r, ...p } : r)) })
    const param = SYNTH_DEPTH_PARAMS[i] as SonifyModParam
    const title = `${SYNTH_DEST_LABEL[d]} : ${DEST_HINT[d]}. Its depth, -1 to +1 (negative : the source upside down; double-click : 0)`
    return (
      <div key={d} className="flex flex-col">
        <div className="flex min-w-0 items-center gap-1">
          <span className="w-14 shrink-0 truncate font-mono text-[9px] uppercase text-muted" title={title}>{SYNTH_DEST_LABEL[d]}</span>
          <select
            className="input select-compact w-[78px] shrink-0 !px-0.5"
            style={{ fontSize: 10, height: 18, paddingTop: 0, paddingBottom: 0 }}
            value={row.src}
            onChange={(e) => setRow({ src: e.target.value as SynthRow['src'] })}
            title={`What plays ${SYNTH_DEST_LABEL[d]} : ${SYNTH_SRC_HINT[row.src]} (▣ : the whole picture)`}
          >
            {SYNTH_SRCS.map((x) => <option key={x} value={x} title={SYNTH_SRC_HINT[x]}>{SRC_LABEL[x]}</option>)}
          </select>
          {/* (a MIDI knob or an OSC fader learns it : sonify:param:<its depth>) */}
          <span className="relative flex min-w-0 flex-1">
            <MidiLearnOverlay id={midi(param)} />
            <input
              type="range" min={-1} max={1} step={0.01} value={row.depth}
              onChange={(e) => setRow({ depth: Number(e.target.value) })}
              onDoubleClick={() => setRow({ depth: 0 })}
              disabled={row.src === 'none'}
              className="min-w-0 flex-1 accent-accent disabled:opacity-40"
              title={title}
            />
          </span>
          <LiveNum liveKey={modTargetKey({ kind: 'sonify', param })} value={row.depth} fmt={pm} className="w-8 shrink-0 text-right font-mono text-[9px] text-muted" />
          {chip(param)}
        </div>
        {assignBox(param)}
      </div>
    )
  }
  return (<>
    <Row label="sound" hint="A factory sound : the engine and its whole tone (the read, the patchbay and the levels stay yours)">
      <select
        className="input select-compact min-w-0 flex-1 text-[10px]"
        value=""
        disabled={!SYNTH_PATCHES.length}
        onChange={(e) => {
          const p = SYNTH_PATCHES[Number(e.target.value)]
          if (p) set({ ...p.sound })
        }}
        title={SYNTH_PATCHES.length ? 'Load a factory sound (the read, the patchbay and the levels stay)' : 'No factory sounds yet'}
      >
        <option value="">{SYNTH_PATCHES.length ? 'factory sounds…' : 'no factory sounds yet'}</option>
        {SYNTH_PATCHES.map((p, i) => <option key={p.name} value={i} title={p.blurb}>{p.name}</option>)}
      </select>
    </Row>

    {sub('engine')}
    <div className="grid grid-cols-4 gap-1">
      {SYNTH_ENGINES.map((e) => (
        <button key={e} onClick={() => set({ engine: e })} className={`${chipCls(s.engine === e)} min-w-0 truncate text-center`} title={ENGINE_HINT[e]}>
          {e}
        </button>
      ))}
    </div>
    <Row label="voices" hint="poly : the 8 strongest moving things play, each its own voice · unison : the strongest one, every voice on its note · mono : the strongest one, gliding from note to note">
      <Seg options={['poly', 'unison', 'mono'] as const} value={s.voices} onChange={(v) => set({ voices: v })}
        title={(v) => (v === 'poly' ? 'The 8 strongest moving things play' : v === 'unison' ? 'The strongest thing plays, every voice on its note' : 'The strongest thing plays, one voice')} />
    </Row>
    <Slider label="timbre" value={s.timbre} min={0} max={1} neutral={0.5} fmt={fmt2} onChange={(v) => set({ timbre: v })} mod={chip('synthTimbre')} midiId={midi('synthTimbre')} title={`The engine's first macro (${macros[0]})`} />
    <Slider label="harmonics" value={s.harmonics} min={0} max={1} neutral={0.3} fmt={fmt2} onChange={(v) => set({ harmonics: v })} mod={chip('synthHarmonics')} midiId={midi('synthHarmonics')} title={`The engine's second macro (${macros[1]})`} />
    <Slider label="morph" value={s.morph} min={0} max={1} neutral={0} fmt={fmt2} onChange={(v) => set({ morph: v })} mod={chip('synthMorph')} midiId={midi('synthMorph')} title={`The engine's third macro (${macros[2]})`} />
    <div className="pl-[60px] font-mono text-[9px] text-muted" title={ENGINE_HINT[s.engine]}>{macros.join(' · ')}</div>

    {sub('read')}
    <Row label="pitch" hint={MODE_HINT[s.mode]}>
      <Seg options={SYNTH_MODES} value={s.mode} onChange={(v) => set({ mode: v })} label={(v) => MODE_LABEL[v]} title={(v) => MODE_HINT[v]} />
    </Row>
    {s.mode === 'score' && (
      <Row label="bars" hint="How long the playhead takes across the picture, on the beat clock (Ableton Link's bars when it is on)">
        <Seg options={[1, 2, 4] as const} value={s.bars} onChange={(v) => set({ bars: v })} label={(v) => `${v} bar${v > 1 ? 's' : ''}`} />
      </Row>
    )}
    <Row label="range" hint="The octaves the notes span, on the Sonify key and scale">
      <select className="input select-compact text-[10px]" value={s.loOct} onChange={(e) => set({ loOct: Math.min(Number(e.target.value), s.hiOct - 1) })} title="The lowest octave">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((o) => <option key={o} value={o}>oct {o}</option>)}
      </select>
      <span className="text-[9px] text-muted">→</span>
      <select className="input select-compact text-[10px]" value={s.hiOct} onChange={(e) => set({ hiOct: Math.max(Number(e.target.value), s.loOct + 1) })} title="The highest octave">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((o) => <option key={o} value={o}>oct {o}</option>)}
      </select>
      <span className="min-w-0 flex-1" />
      {/* 2 px less padding a side than the other chips : at the voice cards'
          284 px the pair ran 7 px past the card's edge */}
      <div className="flex shrink-0 gap-1">
        <button onClick={() => set({ slide: false })} className={chipCls(!s.slide).replace('px-1.5', 'px-1')} title="Steps : a thing crossing the scale's notes strikes again at each new one (a rising hand plays a run)">steps</button>
        <button onClick={() => set({ slide: true })} className={chipCls(s.slide).replace('px-1.5', 'px-1')} title="Slide : the note glides with the thing, lingering on each scale note">slide</button>
      </div>
    </Row>
    <Slider label="sense" value={s.sens} min={0} max={1} neutral={0.5} fmt={fmt2} onChange={(v) => set({ sens: v })} mod={chip('synthSens')} midiId={midi('synthSens')} title={s.mode === 'score' ? 'How much a shape must stand out at the playhead to play (up : fainter shapes too)' : 'How much movement counts as a thing (up : smaller, slower movements play too)'} />
    <Row label="timing" hint="free : a note the moment the movement is seen · a grid : each strike waits for the next 1/8, 1/16 or 1/8 triplet of the beat clock">
      <Seg options={SYNTH_GRIDS} value={s.grid} onChange={(v) => set({ grid: v })} label={(v) => GRID_LABEL[v]} />
    </Row>
    {tap}

    {sub('tone')}
    <Row label="filter" hint="ladder : round and warm · ms : sharp, screaming when pushed · morph : low-pass to band-pass to high-pass">
      <Seg options={SYNTH_FILTERS} value={s.filter} onChange={(v) => set({ filter: v })} />
    </Row>
    <Slider label="cutoff" value={s.cutoff} min={0} max={1} neutral={0.6} fmt={fmt2} onChange={(v) => set({ cutoff: v })} mod={chip('synthCutoff')} midiId={midi('synthCutoff')} title="The filter's cutoff" />
    <Slider label="reso" value={s.reso} min={0} max={1} neutral={0.25} fmt={fmt2} onChange={(v) => set({ reso: v })} mod={chip('synthReso')} midiId={midi('synthReso')} title="The filter's resonance" />
    <Slider label="drive" value={s.drive} min={0} max={1} neutral={0.15} fmt={fmt2} onChange={(v) => set({ drive: v })} mod={chip('synthDrive')} midiId={midi('synthDrive')} title="How hard the voices drive the filter" />
    <Slider label="hpf" value={s.hpf} min={0} max={1} neutral={0} fmt={(v) => (v < 0.005 ? 'off' : fmt2(v))} onChange={(v) => set({ hpf: v })} title="A high-pass after the filter : thins the low end (0 = off)" />
    <div className={s.filter === 'morph' ? '' : 'pointer-events-none opacity-40'} title={s.filter === 'morph' ? undefined : 'The morph filter only : pick morph to use it'}>
      <Slider label="fmode" value={s.fmode} min={0} max={1} neutral={0} fmt={(v) => (v < 0.25 ? 'LP' : v < 0.45 ? 'LP-BP' : v < 0.55 ? 'BP' : v < 0.75 ? 'BP-HP' : 'HP')} onChange={(v) => set({ fmode: v })} title="The morph filter's shape : low-pass → band-pass → high-pass" />
    </div>
    <Slider label="env amt" value={s.envAmt} min={-1} max={1} neutral={0} fmt={pm} onChange={(v) => set({ envAmt: v })} mod={chip('synthEnvAmt')} midiId={midi('synthEnvAmt')} title="How far the envelope opens the cutoff at each strike (negative : it closes it)" />

    {sub('envelope')}
    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
      {env('a', 'attack', 'Attack : how fast a strike rises')}
      {env('d', 'decay', 'Decay : how fast it falls to the sustain')}
      {env('s', 'sustain', 'Sustain : the level a held thing keeps')}
      {env('r', 'release', 'Release : how long a note rings after its thing stops')}
    </div>

    {sub('life')}
    <Slider label="glide" value={s.glide} min={0} max={1} neutral={0.1} fmt={fmt2} onChange={(v) => set({ glide: v })} mod={chip('synthGlide')} midiId={midi('synthGlide')} title="How long a new note slides from the last one (steps, mono)" />
    <Slider label="drift" value={s.drift} min={0} max={1} neutral={0.2} fmt={fmt2} onChange={(v) => set({ drift: v })} mod={chip('synthDrift')} midiId={midi('synthDrift')} title="Analog drift : the voices wander a little off pitch and tone" />
    <Row label="chorus" hint="A chorus on the whole synth : off, I (gentle), II (wide)">
      <Seg options={[0, 1, 2] as const} value={s.chorus} onChange={(v) => set({ chorus: v })} label={(v) => (v === 0 ? 'off' : v === 1 ? 'I' : 'II')} />
    </Row>
    <Slider label="level" value={s.level} min={0} max={1} neutral={0.7} fmt={fmt2} onChange={(v) => set({ level: v })} mod={chip('synthLevel')} midiId={midi('synthLevel')} title="The synth's own output level (before its gain)" />
    <Slider label="gain" value={s.gain} min={0} max={1} neutral={0.7} fmt={fmt2} onChange={(v) => set({ gain: v })} mod={chip('synthGain')} midiId={midi('synthGain')} title="How loud the Synth voice is (before its mixer channel)" />
    <Slider label="pan" value={s.pan} min={-1} max={1} neutral={0} fmt={pm} onChange={(v) => set({ pan: v })} title="The Synth voice's balance (each thing pans itself inside it through the patchbay)" />

    <div className="flex items-center gap-1">
      <button onClick={() => setPicOpen(!picOpen)} className="-ml-0.5 shrink-0 px-0.5 font-mono text-[9px] text-muted hover:text-accent" title={picOpen ? 'Fold the patchbay' : 'Show the patchbay : what in the picture plays what in the sound'}>
        <span className={`inline-block transition-transform ${picOpen ? 'rotate-90' : ''}`}>▶</span>
      </button>
      <div className="min-w-0 flex-1">
        <Slider label="picture" value={s.picture} min={0} max={1} neutral={0.8} fmt={fmt2} onChange={(v) => set({ picture: v })} mod={chip('synthPicture')} midiId={midi('synthPicture')} title="How much the picture plays the sound : every patchbay depth scaled (0 = the picture only picks the notes; ▶ shows the rows)" />
      </div>
    </div>
    {picOpen && (
      <div className="flex flex-col gap-1 border-l border-border/60 pl-1.5">
        {SYNTH_DESTS.map((d, i) => patchRow(d, i))}
        <button
          onClick={() => set({ patch: normalizeSynth({}).patch })}
          className="self-end rounded px-1 font-mono text-[9px] text-muted hover:text-accent"
          title="The patchbay's default rows (speed → velocity, hue → timbre, size → harmonics, texture → morph, brightness → cutoff, saturation → resonance, motion → drive, speed → envelope inverted, x → pan, direction → bend)"
        >↺ rows</button>
      </div>
    )}
  </>)
}
