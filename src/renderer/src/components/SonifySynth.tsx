// The Synth's card on the Sonify page (its rows : the page draws the card
// itself, VoiceShell, with its on / off and its dice). The factory sound on top,
// then SECTIONS in the order you play it, in the Finishing panel's look (a
// header in the section's color with its state on the right, a rail of that
// color down the rows; folding remembered on this computer) : ENGINE (the
// engine, its voices and its three macros, the main controls : drawn bigger),
// READ (pitch from where, the range, steps or slide, how much movement counts,
// the timing, the tap), TONE (the filter), ENVELOPE, LIFE (glide, drift,
// chorus, levels) and PICTURE (its amount and its own dice in the header, its
// ten patchbay rows folded under it). The play side is audio/synthPlay.ts, the
// sound synth.engine.js.

import type { ReactNode } from 'react'
import type { SonifyModParam } from '@shared/types'
import type { SoniConfig } from '../audio/sonify'
import { SYNTH_PATCHES } from '../audio/synthPatches'
import {
  SYNTH_DEPTH_PARAMS, SYNTH_DESTS, SYNTH_DEST_LABEL, SYNTH_ENGINES, SYNTH_FILTERS, SYNTH_GRIDS, SYNTH_MACROS,
  SYNTH_MODES, SYNTH_SRCS, SYNTH_SRC_HINT, normalizeSynth, synthFromPatch, synthPatchState,
  type SynthCfg, type SynthDest, type SynthRow
} from '../audio/synthPlay'
import { randomSynthPatchbay } from '../audio/autoSonify'
import { IconBtn, LiveNum, Row, Seg, chip as chipCls } from './sonifyUi'
import { modTargetKey, useStore } from '../store'
import type { SliderProps } from './SonifyPage'
import { MidiLearnOverlay } from './MidiLearnOverlay'
import { SECTION_COLORS, SectionHead } from './FinishingSections'

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

// The sections' colors : the Finishing panel's set, one per section (the engine
// in the accent, the picture in the second accent, as the mirror draws it).
const SEC: Record<'engine' | 'read' | 'tone' | 'envelope' | 'life' | 'picture', string> = {
  engine: SECTION_COLORS.accent,
  read: SECTION_COLORS.earth,
  tone: SECTION_COLORS.red,
  envelope: SECTION_COLORS.violet,
  life: SECTION_COLORS.neutral,
  picture: SECTION_COLORS.accent2
}
const CHORUS = ['off', 'I', 'II']

/** One section of the card : its header bar across the card (the Finishing
 *  panel's, tinted to show on the card's color) and its rows on a rail of the
 *  section's color. Folding is remembered on this computer. */
function Section({ id, color, summary, lead, right, hint, folds = false, children }: {
  id: keyof typeof SEC
  color: string
  summary?: string
  /** Filling the header bar after the title (PICTURE's amount). */
  lead?: ReactNode
  /** The header's right end instead of the summary (a dice). */
  right?: ReactNode
  hint?: string
  /** Folded until you open it. */
  folds?: boolean
  children: ReactNode
}): JSX.Element {
  const key = `soni-synth-${id}`
  const stored = useStore((st) => st.collapsed[key])
  const setCollapsed = useStore((st) => st.setCollapsed)
  const folded = stored ?? folds
  // a click on a control in the header stays the control's (it never folds the section)
  const own = (e: { stopPropagation: () => void }): void => e.stopPropagation()
  return (
    <div className="-mx-2" data-synth-section={id}>
      <SectionHead
        title={id}
        color={color}
        folded={folded}
        onToggle={() => setCollapsed(key, !folded)}
        bar="bg-panel3/30 hover:bg-panel3/50"
        hint={hint}
        wrap={!!lead}
        lead={lead && <div className="flex min-w-0 cursor-default flex-col" style={{ flex: '1 1 140px' }} onClick={own} onDoubleClick={own}>{lead}</div>}
        right={
          right ? <span className="flex shrink-0 items-center" onClick={own} onDoubleClick={own}>{right}</span>
            : summary ? <span className="min-w-0 truncate font-mono text-[9px] text-muted">{summary}</span> : null
        }
      />
      {!folded && (
        <div className="flex flex-col gap-1 border-l-2 py-1 pl-1.5 pr-2" style={{ borderLeftColor: color }}>
          {children}
        </div>
      )}
    </div>
  )
}

const fmt2 = (v: number): string => v.toFixed(2)
/** A header's number : 0.35 → .35 (four of them fit a narrow header). */
const short = (v: number): string => (v >= 0.995 ? '1' : v.toFixed(2).slice(1))
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
        {/* its depth beside the source while there is room for a usable slider,
            else on a line of its own under it (a narrow card) */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
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
          <span className="flex min-w-0 items-center gap-1" style={{ flex: '1 1 104px' }}>
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
          </span>
        </div>
        {assignBox(param)}
      </div>
    )
  }
  // the factory sound picked last : its name in the menu, "· edited" once any
  // of its sound fields moved (picking it again brings it back)
  const ps = synthPatchState(s)
  const soundValue = ps ? (ps.edited ? 'edited' : String(ps.index)) : ''
  const macro = (k: 'timbre' | 'harmonics' | 'morph', i: 0 | 1 | 2, param: SonifyModParam, neutral: number, which: string): JSX.Element => (
    <Slider
      label={k} value={s[k]} min={0} max={1} neutral={neutral} fmt={fmt2}
      onChange={(v) => set({ [k]: v } as Partial<SynthCfg>)}
      mod={chip(param)} midiId={midi(param)}
      main={{ note: macros[i] }}
      title={`${k.toUpperCase()} : the engine's ${which} macro, on ${s.engine} : ${macros[i]} (${ENGINE_HINT[s.engine]})`}
    />
  )
  return (<>
    <Row label="sound" hint="A factory sound : the engine and its whole tone (the read, the patchbay and the voice's gain and pan stay yours). Its name stays shown, with · edited once you change it; pick it again to get it back.">
      <select
        className="input select-compact min-w-0 flex-1"
        style={{ fontSize: 10 }}
        value={soundValue}
        disabled={!SYNTH_PATCHES.length}
        onChange={(e) => {
          const v = e.target.value
          const p = /^\d+$/.test(v) ? SYNTH_PATCHES[Number(v)] : undefined
          if (p) set(synthFromPatch(p))
        }}
        title={ps
          ? `${ps.patch.name} : ${ps.patch.blurb}${ps.edited ? ' (edited since : pick it again to get it back)' : ''}`
          : SYNTH_PATCHES.length ? 'Load a factory sound (the read, the patchbay and the voice\'s gain and pan stay)' : 'No factory sounds yet'}
      >
        <option value="" hidden>{SYNTH_PATCHES.length ? 'factory sounds…' : 'no factory sounds yet'}</option>
        {ps?.edited && <option value="edited" hidden>{ps.patch.name} · edited</option>}
        {SYNTH_ENGINES.map((e) => {
          const list = SYNTH_PATCHES.map((p, i) => ({ p, i })).filter(({ p }) => p.sound.engine === e)
          return list.length ? (
            <optgroup key={e} label={e}>
              {list.map(({ p, i }) => <option key={p.name} value={i} title={p.blurb}>{p.name}</option>)}
            </optgroup>
          ) : null
        })}
      </select>
    </Row>

    <div className="flex flex-col">
      <Section id="engine" color={SEC.engine} summary={`${s.engine} · ${s.voices}`} hint="The engine, its voices and its three macros (TIMBRE, HARMONICS, MORPH : what each does depends on the engine)">
        <div className="grid grid-cols-4 gap-1">
          {SYNTH_ENGINES.map((e) => (
            <button key={e} onClick={() => set({ engine: e })} className={`${chipCls(s.engine === e)} min-w-0 truncate text-center`} title={ENGINE_HINT[e]}>
              {e}
            </button>
          ))}
        </div>
        <Row label="voices" fit={150} hint="poly : the 8 strongest moving things play, each its own voice · unison : the strongest one, every voice on its note · mono : the strongest one, gliding from note to note">
          <Seg options={['poly', 'unison', 'mono'] as const} value={s.voices} onChange={(v) => set({ voices: v })}
            title={(v) => (v === 'poly' ? 'The 8 strongest moving things play' : v === 'unison' ? 'The strongest thing plays, every voice on its note' : 'The strongest thing plays, one voice')} />
        </Row>
        {macro('timbre', 0, 'synthTimbre', 0.5, 'first')}
        {macro('harmonics', 1, 'synthHarmonics', 0.3, 'second')}
        {macro('morph', 2, 'synthMorph', 0, 'third')}
      </Section>

      <Section id="read" color={SEC.read} summary={`${MODE_LABEL[s.mode]} · oct ${s.loOct}→${s.hiOct} · ${GRID_LABEL[s.grid]}`} hint="How the picture is read : where the pitch comes from, the range, steps or slide, how much movement counts, the timing, the tap">
        <Row label="pitch" fit={196} hint={MODE_HINT[s.mode]}>
          <Seg options={SYNTH_MODES} value={s.mode} onChange={(v) => set({ mode: v })} label={(v) => MODE_LABEL[v]} title={(v) => MODE_HINT[v]} />
        </Row>
        {s.mode === 'score' && (
          <Row label="bars" hint="How long the playhead takes across the picture, on the beat clock (Ableton Link's bars when it is on)">
            <Seg options={[1, 2, 4] as const} value={s.bars} onChange={(v) => set({ bars: v })} label={(v) => `${v} bar${v > 1 ? 's' : ''}`} />
          </Row>
        )}
        <Row label="range" wrap hint="The octaves the notes span, on the Sonify key and scale">
          <select className="input select-compact" style={{ fontSize: 10 }} value={s.loOct} onChange={(e) => set({ loOct: Math.min(Number(e.target.value), s.hiOct - 1) })} title="The lowest octave">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((o) => <option key={o} value={o}>oct {o}</option>)}
          </select>
          <span className="text-[9px] text-muted">→</span>
          <select className="input select-compact" style={{ fontSize: 10 }} value={s.hiOct} onChange={(e) => set({ hiOct: Math.max(Number(e.target.value), s.loOct + 1) })} title="The highest octave">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((o) => <option key={o} value={o}>oct {o}</option>)}
          </select>
          {/* 2 px less padding a side than the other chips : at the voice cards'
              284 px the pair ran 7 px past the card's edge; in a narrower
              column it wraps under the octaves, to the right */}
          <div className="ml-auto flex shrink-0 gap-1">
            <button onClick={() => set({ slide: false })} className={chipCls(!s.slide).replace('px-1.5', 'px-1')} title="Steps : a thing crossing the scale's notes strikes again at each new one (a rising hand plays a run)">steps</button>
            <button onClick={() => set({ slide: true })} className={chipCls(s.slide).replace('px-1.5', 'px-1')} title="Slide : the note glides with the thing, lingering on each scale note">slide</button>
          </div>
        </Row>
        <Slider label="sense" value={s.sens} min={0} max={1} neutral={0.5} fmt={fmt2} onChange={(v) => set({ sens: v })} mod={chip('synthSens')} midiId={midi('synthSens')} title={s.mode === 'score' ? 'How much a shape must stand out at the playhead to play (up : fainter shapes too)' : 'How much movement counts as a thing (up : smaller, slower movements play too)'} />
        <Row label="timing" fit={168} hint="free : a note the moment the movement is seen · a grid : each strike waits for the next 1/8, 1/16 or 1/8 triplet of the beat clock">
          <Seg options={SYNTH_GRIDS} value={s.grid} onChange={(v) => set({ grid: v })} label={(v) => GRID_LABEL[v]} />
        </Row>
        {tap}
      </Section>

      <Section id="tone" color={SEC.tone} summary={s.filter} hint="The filter after the engine : its kind, cutoff, resonance, drive, the high-pass and how far the envelope moves the cutoff">
        <Row label="filter" fit={150} hint="ladder : round and warm · ms : sharp, screaming when pushed · morph : low-pass to band-pass to high-pass">
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
      </Section>

      <Section id="envelope" color={SEC.envelope} summary={`a${short(s.attack)} d${short(s.decay)} s${short(s.sustain)} r${short(s.release)}`} hint="One envelope for every voice : attack, decay, sustain, release (a d s r in the header)">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(124px,1fr))] gap-x-3 gap-y-1">
          {env('a', 'attack', 'Attack : how fast a strike rises')}
          {env('d', 'decay', 'Decay : how fast it falls to the sustain')}
          {env('s', 'sustain', 'Sustain : the level a held thing keeps')}
          {env('r', 'release', 'Release : how long a note rings after its thing stops')}
        </div>
      </Section>

      <Section id="life" color={SEC.life} summary={`glide ${fmt2(s.glide)} · chorus ${CHORUS[s.chorus]}`} hint="What keeps it alive and where it sits : glide, drift, chorus, its level, gain and balance">
        <Slider label="glide" value={s.glide} min={0} max={1} neutral={0.1} fmt={fmt2} onChange={(v) => set({ glide: v })} mod={chip('synthGlide')} midiId={midi('synthGlide')} title="How long a new note slides from the last one (steps, mono)" />
        <Slider label="drift" value={s.drift} min={0} max={1} neutral={0.2} fmt={fmt2} onChange={(v) => set({ drift: v })} mod={chip('synthDrift')} midiId={midi('synthDrift')} title="Analog drift : the voices wander a little off pitch and tone" />
        <Row label="chorus" hint="A chorus on the whole synth : off, I (gentle), II (wide)">
          <Seg options={[0, 1, 2] as const} value={s.chorus} onChange={(v) => set({ chorus: v })} label={(v) => CHORUS[v]} />
        </Row>
        <Slider label="level" value={s.level} min={0} max={1} neutral={0.7} fmt={fmt2} onChange={(v) => set({ level: v })} mod={chip('synthLevel')} midiId={midi('synthLevel')} title="The synth's own output level (before its gain; each factory sound sets its own, so they match in loudness)" />
        <Slider label="gain" value={s.gain} min={0} max={1} neutral={0.7} fmt={fmt2} onChange={(v) => set({ gain: v })} mod={chip('synthGain')} midiId={midi('synthGain')} title="How loud the Synth voice is (before its mixer channel)" />
        <Slider label="pan" value={s.pan} min={-1} max={1} neutral={0} fmt={pm} onChange={(v) => set({ pan: v })} title="The Synth voice's balance (each thing pans itself inside it through the patchbay)" />
      </Section>

      <Section
        id="picture" color={SEC.picture} folds
        hint="The picture patchbay : PICTURE scales every row (0 = the picture only picks the notes); open it for its ten rows, what in the picture plays what in the sound"
        lead={<Slider label="picture" noLabel value={s.picture} min={0} max={1} neutral={0.8} fmt={fmt2} onChange={(v) => set({ picture: v })} mod={chip('synthPicture')} midiId={midi('synthPicture')} title="How much the picture plays the sound : every patchbay depth scaled (0 = the picture only picks the notes; ▸ shows the rows)" />}
        right={<IconBtn onClick={() => set({ patch: randomSynthPatchbay() })} title="Randomize the picture patchbay : a new source and depth on each of the ten rows (velocity always plays). The sound, the read and PICTURE stay">🎲</IconBtn>}
      >
        {SYNTH_DESTS.map((d, i) => patchRow(d, i))}
        <button
          onClick={() => set({ patch: normalizeSynth({}).patch })}
          className="self-end rounded px-1 font-mono text-[9px] text-muted hover:text-accent"
          title="The patchbay's default rows (speed → velocity, hue → timbre, size → harmonics, texture → morph, brightness → cutoff, saturation → resonance, motion → drive, speed → envelope inverted, x → pan, direction → bend)"
        >↺ rows</button>
      </Section>
    </div>
  </>)
}
