// Signal's PICTURE PLAY rows on the Sonify page (the card itself is drawn by
// SonifyPage : its sound, clock, range and levels are the same either way).
// PLAY switches who plays the grains : the READ HEADS (the scan of marks on a
// clock) or the picture's moving things (audio/signalPlay.ts, found as the
// Synth finds them). Picture Play's own rows : where the pitch comes from,
// STRIKE or TIE, how much movement counts, and the PICTURE patchbay (its amount
// and dice in the header, its eight rows folded under it), in the Synth card's
// look.

import type { SonifyModParam } from '@shared/types'
import type { SoniConfig } from '../audio/sonify'
import { SYNTH_SRCS, SYNTH_SRC_HINT } from '../audio/synthPlay'
import { SIGNAL_DEPTH_PARAMS, SIGNAL_DESTS, SIGNAL_DEST_HINT, SIGNAL_DEST_LABEL, defaultSignalPatch, normalizeSignalPatch, randomSignalPatchbay, type SignalDest, type SignalRow } from '../audio/signalPlay'
import { IconBtn, LiveNum, Row, Seg } from './sonifyUi'
import { modTargetKey, useStore } from '../store'
import { MidiLearnOverlay } from './MidiLearnOverlay'
import type { SliderProps } from './SonifyPage'
import { SECTION_COLORS, SectionHead } from './FinishingSections'
import { SRC_LABEL } from './SonifySynth'

type Sig = SoniConfig['signal']
const fmt2 = (v: number): string => v.toFixed(2)
const pm = (v: number): string => `${v > 0 ? '+' : ''}${v.toFixed(2)}`
const midi = (p: string): string => `sonify:param:${p}`
const PMODE_LABEL: Record<Sig['pmode'], string> = { height: 'height', keyboard: 'keys', radial: 'radial' }
const PMODE_HINT: Record<Sig['pmode'], string> = {
  height: 'Pitch from height : low at the bottom, high at the top',
  keyboard: 'Pitch from left to right, like a keyboard',
  radial: 'Pitch from the center out : low in the middle, high at the edges (on the dome : the zenith low, the rim high)'
}

/** PLAY : the read heads, or the picture's moving things. */
export function SignalPlaySwitch({ sg, set }: { sg: Sig; set: (p: Partial<Sig>) => void }): JSX.Element {
  return (
    <Row label="play" fit={150} hint="Who plays the grains : the read heads scanning the picture's marks on a clock, or the picture's moving things">
      <Seg
        options={['heads', 'picture'] as const}
        value={sg.play}
        onChange={(v) => set({ play: v })}
        label={(v) => (v === 'heads' ? 'read heads' : 'picture play')}
        title={(v) => v === 'heads'
          ? 'READ HEADS : heads walk the picture on a clock, every mark they cross fires a grain (the picture is the pattern)'
          : 'PICTURE PLAY : the moving things in the picture play the grains, as they play the Synth : where a thing is gives its pitch, its speed, size, brightness and the rest shape every hit (the PICTURE rows)'}
      />
    </Row>
  )
}

/** Picture Play's read : the pitch's place, STRIKE / TIE, the sense. */
export function SignalPictureRead({ sg, set, chip, Slider }: {
  sg: Sig
  set: (p: Partial<Sig>) => void
  chip: (p: SonifyModParam, inactive?: boolean) => JSX.Element
  Slider: (p: SliderProps) => JSX.Element
}): JSX.Element {
  return (
    <>
      <Row label="pitch" fit={150} hint="Where a thing's pitch comes from (on the scale; SNAP lets it off)">
        <Seg options={['height', 'keyboard', 'radial'] as const} value={sg.pmode} onChange={(v) => set({ pmode: v })} label={(v) => PMODE_LABEL[v]} title={(v) => PMODE_HINT[v]} />
      </Row>
      <Row label="notes" fit={150} hint="How a thing plays : STRIKE ticks grains on the clock while it moves; TIE holds one grain while it moves, struck again on each new note">
        <Seg
          options={['strike', 'tie'] as const}
          value={sg.tie ? 'tie' : 'strike'}
          onChange={(v) => set({ tie: v === 'tie' })}
          label={(v) => v}
          title={(v) => v === 'strike'
            ? 'STRIKE : each moving thing ticks grains on the clock (RATE, SYNC), from when it appears; its rate row runs it faster or slower, its chance row thins it'
            : 'TIE : one held grain per moving thing (the pip and the ping hold at their peak, the others at full), struck again at each new scale note it crosses, let go over the decay when it stops; its pitch, level, pan, tone and fm follow it'}
        />
      </Row>
      <Slider label="sense" value={sg.sens} min={0} max={1} neutral={0.5} fmt={fmt2} onChange={(v) => set({ sens: v })} mod={chip('signalSens')} midiId={midi('signalSens')} title="How much movement counts as a thing (up : smaller, slower movements play too)" />
    </>
  )
}

/** The PICTURE section : its amount and dice in the header, its eight rows. */
export function SignalPictureRows({ sg, set, chip, assignBox, Slider }: {
  sg: Sig
  set: (p: Partial<Sig>) => void
  chip: (p: SonifyModParam, inactive?: boolean) => JSX.Element
  assignBox: (...ps: SonifyModParam[]) => JSX.Element | null
  Slider: (p: SliderProps) => JSX.Element
}): JSX.Element {
  const key = 'soni-signal-picture'
  const stored = useStore((st) => st.collapsed[key])
  const setCollapsed = useStore((st) => st.setCollapsed)
  const folded = stored ?? true
  const color = SECTION_COLORS.accent2
  const own = (e: { stopPropagation: () => void }): void => e.stopPropagation()
  const patch = normalizeSignalPatch(sg.patch)
  const row = (d: SignalDest, i: number): JSX.Element => {
    const r: SignalRow = patch[i]
    const setRow = (p: Partial<SignalRow>): void => set({ patch: patch.map((x, j) => (j === i ? { ...x, ...p } : x)) })
    const title = `${SIGNAL_DEST_LABEL[d]} : ${SIGNAL_DEST_HINT[d]}. Its depth, -1 to +1 (negative : the source upside down; double-click : 0)`
    const param = SIGNAL_DEPTH_PARAMS[i] as SonifyModParam
    return (
      <div key={d} className="flex flex-col">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
        <span className="w-14 shrink-0 truncate font-mono text-[9px] uppercase text-muted" title={title}>{SIGNAL_DEST_LABEL[d]}</span>
        <select
          className="input select-compact w-[78px] shrink-0 !px-0.5"
          style={{ fontSize: 10, height: 18, paddingTop: 0, paddingBottom: 0 }}
          value={r.src}
          onChange={(e) => setRow({ src: e.target.value as SignalRow['src'] })}
          title={`What plays ${SIGNAL_DEST_LABEL[d]} : ${SYNTH_SRC_HINT[r.src]} (▣ : the whole picture)`}
        >
          {SYNTH_SRCS.map((x) => <option key={x} value={x} title={SYNTH_SRC_HINT[x]}>{SRC_LABEL[x]}</option>)}
        </select>
        {/* (a MIDI knob or an OSC fader learns it : sonify:param:<its depth>) */}
        <span className="flex min-w-0 items-center gap-1" style={{ flex: '1 1 104px' }}>
          <span className="relative flex min-w-0 flex-1">
            <MidiLearnOverlay id={midi(param)} />
            <input
              type="range" min={-1} max={1} step={0.01} value={r.depth}
              onChange={(e) => setRow({ depth: Number(e.target.value) })}
              onDoubleClick={() => setRow({ depth: 0 })}
              disabled={r.src === 'none'}
              className="min-w-0 flex-1 accent-accent disabled:opacity-40"
              title={title}
            />
          </span>
          <LiveNum liveKey={modTargetKey({ kind: 'sonify', param })} value={r.depth} fmt={pm} className="w-8 shrink-0 text-right font-mono text-[9px] text-muted" />
          {chip(param)}
        </span>
      </div>
      {assignBox(param)}
      </div>
    )
  }
  return (
    <div className="-mx-2" data-signal-section="picture">
      <SectionHead
        title="picture"
        color={color}
        folded={folded}
        onToggle={() => setCollapsed(key, !folded)}
        bar="bg-panel3/30 hover:bg-panel3/50"
        hint="The picture patchbay : PICTURE scales every row (0 = the picture only picks the pitches and when they play); open it for its eight rows, what in a thing shapes each hit"
        wrap
        lead={
          <div className="flex min-w-0 cursor-default flex-col" style={{ flex: '1 1 140px' }} onClick={own} onDoubleClick={own}>
            <Slider label="picture" noLabel value={sg.picture} min={0} max={1} neutral={0.8} fmt={fmt2} onChange={(v) => set({ picture: v })} mod={chip('signalPicture')} midiId={midi('signalPicture')} title="How much the picture shapes the hits : every patchbay depth scaled (0 = the picture only picks the pitches and when they play; ▸ shows the rows)" />
          </div>
        }
        right={
          <span className="flex shrink-0 items-center" onClick={own} onDoubleClick={own}>
            <IconBtn onClick={() => set({ patch: randomSignalPatchbay() })} title="Randomize the picture patchbay : a new source and depth on each of the eight rows (velocity always plays). The sound, the read and PICTURE stay">🎲</IconBtn>
          </span>
        }
      />
      {!folded && (
        <div className="flex flex-col gap-1 border-l-2 py-1 pl-1.5 pr-2" style={{ borderLeftColor: color }}>
          {SIGNAL_DESTS.map((d, i) => row(d, i))}
          <button
            onClick={() => set({ patch: defaultSignalPatch() })}
            className="self-end rounded px-1 font-mono text-[9px] text-muted hover:text-accent"
            title="The patchbay's default rows (speed → velocity, size → decay, brightness → tone, texture → fm, speed → rate, x → pan; the wave and every hit's chance left alone)"
          >↺ rows</button>
        </div>
      )}
    </div>
  )
}
