// Space (the Sonify page's fourth view) : the voices placed in the room. The
// output (stereo, speakers, objects), the layout or the renderer it talks to,
// the scene's alignment, a live map seen like the domemaster (the zenith in the
// middle, the front at the bottom), and where each voice sits.
// Engine : audio/space.ts. Conventions and panning : shared/spatial.ts.

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { useStore } from '../store'
import { sonifyEngine } from '../audio/sonify'
import { spaceEngine } from '../audio/space'
import {
  BUILTIN_LAYOUTS,
  SPACE_FIELDS,
  SPACE_FIELD_RANGE,
  SPACE_FX,
  SPACE_MAX_CH,
  SPACE_PIECES,
  SPACE_SOURCES,
  SPACE_VOICES,
  SPACE_VOICE_LABEL,
  activeLayout,
  layoutChannels,
  parseSpatGrisSetup,
  placeField,
  placePatch,
  spaceModParam,
  validSpaceHost,
  wrap180,
  type SpaceMode,
  type SpaceVoice
} from '@shared/spatial'
import type { SonifyModParam } from '@shared/types'
import { BoundedNumberInput } from './BoundedNumberInput'
import { Row, RangeRow, Seg, Shell, Stepper, chip, sonifyCovered, themeVar } from './sonifyUi'
import { ownerWindow } from './ownerWindow'
import { showToast } from './Toast'

const MODE_HINT: Record<SpaceMode, string> = {
  stereo: 'The stereo mix, as always.',
  speakers: 'Palinopsia pans every voice onto a speaker layout itself (VBAP), up to 32 channels on one output : a studio ring, a small dome.',
  objects: 'Every voice leaves on its own channels and its position goes over OSC to a renderer that owns the room : SpatGRIS (the SAT Satosphère\'s 93.5) or anything that speaks ADM-OSC.'
}

// one color per voice, then the FX return (the map and the rows share them).
// A voice past the list (one added later) still gets a color of its own : a
// missing hue made an invalid color, and the map drew it in the last one used.
const HUES = [28, 200, 120, 330, 52, 265, 175, 0, 300, 90, 232]
const voiceColor = (s: number, a = 1): string =>
  s === SPACE_FX ? `rgba(160,160,160,${a})` : `hsla(${HUES[s] ?? Math.round((s * 137.5) % 360)},80%,60%,${a})`

/** `chip` : Sonify's own M button; `assign` / `renderAssign` : the page's assign
 *  box, shown right under the voice whose M was clicked. */
export function SpacePanel({ chip: modChip, assign, renderAssign }: {
  chip?: (p: SonifyModParam) => JSX.Element
  assign?: string | null
  renderAssign?: (p: SonifyModParam) => JSX.Element
}): JSX.Element {
  const space = useStore((s) => s.space)
  const setSpace = useStore((s) => s.setSpace)
  const setVoice = useStore((s) => s.setSpaceVoice)
  const domeOn = useStore((s) => s.dome.enabled)
  const [, setTick] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null) // (which window the panel is in)
  useEffect(() => {
    const id = window.setInterval(() => { if (!sonifyCovered(rootRef.current)) setTick((t) => t + 1) }, 300)
    return () => window.clearInterval(id)
  }, [])
  const on = space.mode !== 'stereo'
  const outCh = sonifyEngine.outputChannels()
  const layout = activeLayout(space)
  const subs = layout.speakers.filter((s) => s.sub).length

  const importSetup = async (f: File): Promise<void> => {
    const { layout: l, error } = parseSpatGrisSetup(await f.text(), f.name.replace(/\.xml$/i, ''))
    if (!l) { showToast(`Speaker setup : ${error}`, 'warn', 6000); return }
    setSpace({ layoutKey: 'file', layout: l })
    const need = layoutChannels(l)
    showToast(need > 32 ? `${l.name} : ${l.speakers.length} speakers on ${need} channels, more than one output carries (32). Use objects with SpatGRIS for it.` : `${l.name} : ${l.speakers.length} speakers`, need > 32 ? 'warn' : 'ok', 6000)
  }

  // the channels each source takes in objects mode, for the patch
  const per = space.pairs ? 2 : 1
  const chanOf = (s: number): string => {
    const a = space.firstChannel + s * per
    return per === 2 ? `${a}-${a + 1}` : `${a}`
  }
  // the piece groups the channels allow (objects); all 30 on speakers
  const pieceMax = space.mode === 'objects' ? Math.max(0, SPACE_MAX_CH - (space.firstChannel - 1) - SPACE_SOURCES * per) : SPACE_PIECES
  // a count asked (or saved) over what the channels hold is kept, for mono or
  // speakers, but said : only `pieceMax` of them play
  const piecesCut = space.mode === 'objects' && space.pieces > pieceMax
  const monoMax = Math.max(0, SPACE_MAX_CH - (space.firstChannel - 1) - SPACE_SOURCES)
  const groups = spaceEngine.groups
  const p0 = space.firstChannel + SPACE_SOURCES * per
  const [open, setOpen] = useState<SpaceVoice | null>(null)

  return (
    <div ref={rootRef} className="flex flex-col gap-2">
      <Shell
        title="Space"
        hint="Sonify's voices placed in the room, the way the picture is placed on the dome. Choose a multichannel output above (a sound card, or a Dante Virtual Soundcard to reach a venue's Dante network). The recordings keep the stereo mix : a stereo take of the piece, and the stereo backup a venue asks for."
        on={on}
        open
        right={
          <button
            onClick={() => {
              setSpace({ mode: 'objects', protocol: 'spatgris', port: 18032, firstSource: 1, firstChannel: 1, pairs: true })
              showToast('Space : objects to SpatGRIS on port 18032. Set the host to the SAT audio server\'s address.', 'ok', 6000)
            }}
            className={chip(false)}
            title="The SAT Satosphère : its 93 speakers and 5 subwoofers are rendered by SpatGRIS on the venue's audio server (speaker setup Dome93(32-32-16-8-4-1)Subs5 Satosphere). Sets objects, SpatGRIS, port 18032, sources from 1, voices as pairs."
          >
            SAT
          </button>
        }
      >
        <Row label="output" hint="Where Sonify's sound goes">
          <Seg<SpaceMode> options={['stereo', 'speakers', 'objects']} value={space.mode} onChange={(m) => setSpace({ mode: m })} title={(m) => MODE_HINT[m]} />
        </Row>
        {on && (
          <Row label="hear on" hint="Headphones : every channel (each speaker of the layout, or each object at its place) is placed around your head (binaural, through the HRTF) and played in stereo on Sonify's output. The output : the channels go out as they are, to a multichannel sound card or a Dante Virtual Soundcard.">
            <Seg
              options={['headphones', 'output'] as const}
              value={space.preview ? 'headphones' : 'output'}
              onChange={(v) => setSpace({ preview: v === 'headphones' })}
              label={(v) => (v === 'headphones' ? '🎧 headphones' : `the output (${outCh} ch)`)}
              title={(v) => (v === 'headphones' ? 'Hear the room in stereo, around your head' : 'Send the channels to the output device as they are')}
            />
          </Row>
        )}
        {on && (
          <div className="pl-[62px] font-mono text-[9px] leading-snug text-muted">
            {space.preview ? (
              <>{spaceEngine.channels} channels heard around your head, in stereo on Sonify's output.</>
            ) : spaceEngine.problem ? (
              <>
                <span className="text-[rgb(var(--c-danger))]">{spaceEngine.problem}</span>
                {outCh <= 2 && spaceEngine.channels > outCh && (
                  <button onClick={() => setSpace({ preview: true })} className={`${chip(false)} ml-1`} title="Hear the room in stereo, around your head (binaural)">🎧 hear it on headphones</button>
                )}
              </>
            ) : (
              <>{spaceEngine.channels} channels on an output of {outCh}</>
            )}
          </div>
        )}
        {space.mode === 'speakers' && (
          <>
            <Row label="layout" hint="The speakers Palinopsia pans onto. The built-in rings are numbered from the lowest ring up, each clockwise from the speaker left of the front. A SpatGRIS speaker setup (.xml) plays speaker n on channel n.">
              <select
                className="input select-compact min-w-0 flex-1 text-[10px]"
                value={space.layoutKey}
                onChange={(e) => (e.target.value === '__import' ? fileRef.current?.click() : setSpace({ layoutKey: e.target.value }))}
              >
                {Object.entries(BUILTIN_LAYOUTS).map(([k, l]) => <option key={k} value={k}>{l.label}</option>)}
                {space.layout && <option value="file">{space.layout.name} ({space.layout.speakers.length})</option>}
                <option value="__import">Import a SpatGRIS setup…</option>
              </select>
              <input
                ref={fileRef} type="file" accept=".xml" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSetup(f); e.target.value = '' }}
              />
            </Row>
            {subs > 0 && (
              <>
                <RangeRow label="subs" value={space.subLevel} min={0} max={1} step={0.01} neutral={0.5} onChange={(v) => setSpace({ subLevel: v })} shown={space.subLevel.toFixed(2)} title={`The low end of every voice sent to the ${subs} subwoofer${subs > 1 ? 's' : ''} (direct-out speakers)`} />
                <RangeRow label="crossover" value={space.subXover} min={40} max={200} step={1} neutral={90} onChange={(v) => setSpace({ subXover: v })} shown={`${Math.round(space.subXover)} Hz`} title="Below this, the subwoofers (24 dB/oct)" />
              </>
            )}
          </>
        )}
        {space.mode === 'objects' && (
          <>
            <Row label="to" hint="The renderer and how it is addressed. SpatGRIS : /spat/serv deg (source, azimuth clockwise, elevation, radius, spans). ADM-OSC : /adm/obj/n/aed and /w (azimuth counter-clockwise, as ADM has it).">
              <Seg options={['spatgris', 'adm'] as const} value={space.protocol} onChange={(p) => setSpace({ protocol: p, port: p === 'spatgris' ? 18032 : space.port === 18032 ? 9000 : space.port })} label={(p) => (p === 'spatgris' ? 'SpatGRIS' : 'ADM-OSC')} />
            </Row>
            <Row label="host" hint="The renderer's computer (IPv4) and its OSC port (SpatGRIS listens on 18032)">
              <input
                className="input min-w-0 flex-1 font-mono text-[10px]"
                defaultValue={space.host}
                key={space.host}
                onBlur={(e) => {
                  const typed = e.target.value.trim()
                  if (typed === space.host) return
                  // refused (not an IPv4 address) : the address before stays, and
                  // the field says so (it kept the text, or fell to the default)
                  if (!validSpaceHost(typed)) {
                    e.target.value = space.host
                    showToast(`Space : "${typed}" is not an IPv4 address (like 10.0.0.20) or localhost. The positions still go to ${space.host}.`, 'warn', 6000)
                    return
                  }
                  setSpace({ host: typed })
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                placeholder="10.0.0.20"
              />
              <BoundedNumberInput className="input w-[56px] text-[10px]" value={space.port} min={1} max={65535} integer onChange={(v) => setSpace({ port: v })} title="OSC port" />
            </Row>
            <Row label="sources" hint="The first source (SpatGRIS) or object (ADM) number : each channel is its own source, in order. SpatGRIS plays source n from its input n, so patch channel n to input n.">
              <Stepper value={space.firstSource} min={1} max={128 - SPACE_SOURCES * per + 1} onChange={(v) => setSpace({ firstSource: v })} title="The first source number" />
            </Row>
            <Row label="per voice" hint="Pairs : a voice's own left and right are two sources (its notes keep moving across it). Mono : one source per voice, half the channels.">
              <button onClick={() => setSpace({ pairs: true })} className={`${chip(space.pairs)} flex-1`}>pairs ({SPACE_SOURCES * 2} ch)</button>
              <button onClick={() => setSpace({ pairs: false })} className={`${chip(!space.pairs)} flex-1`}>mono ({SPACE_SOURCES} ch)</button>
            </Row>
            <div className="pl-[62px] font-mono text-[9px] leading-snug text-muted" title="The channels each voice leaves on (and its source numbers, from the first source on)">
              {[
                ...SPACE_VOICES.map((v, i) => `${SPACE_VOICE_LABEL[v]} ${chanOf(i)}`),
                `FX ${chanOf(SPACE_FX)}`,
                ...(groups > 0 ? [`Collage pieces ${p0}${groups > 1 ? `-${p0 + groups - 1}` : ''}`] : [])
              ].join(' · ')}
            </div>
          </>
        )}
        {on && (
          <>
            <Row label="first ch" hint="Where Palinopsia's channels start on the output (channel 1 = the first)">
              <Stepper value={space.firstChannel} min={1} max={32} onChange={(v) => setSpace({ firstChannel: v })} title="The first output channel" />
              <span className="flex-1" />
              <button onClick={() => setSpace({ mirror: !space.mirror })} className={chip(space.mirror)} title="Swap left and right (a room or a renderer numbered the other way round)">mirror</button>
            </Row>
            <Row label="pieces" hint={`The Collage voice's pieces as sources of their own : each piece (or, past the count, each group of nearby pieces) sounds where it is in the picture, on the dome. 0 : the voice is one pair like the others. As objects, each takes a channel after the voices${space.mode === 'objects' ? ` : at most ${pieceMax} with these channels` : ''}.`}>
              <Stepper value={Math.min(space.pieces, pieceMax)} min={0} max={pieceMax} onChange={(v) => setSpace({ pieces: v })} title={`How many Collage piece sources (0 = off)${space.mode === 'objects' ? `; at most ${pieceMax} with these channels` : ''}`} />
              <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-muted">
                {space.pieces > 0 ? `${groups} source${groups === 1 ? '' : 's'}` : 'off'}
              </span>
            </Row>
            {piecesCut && (
              <div className="pl-[62px] font-mono text-[9px] leading-snug text-[rgb(var(--c-danger))]">
                {space.pieces} asked, {pieceMax} play : the voices take channels {space.firstChannel}-{space.firstChannel + SPACE_SOURCES * per - 1} of {SPACE_MAX_CH}.
                {space.pairs && monoMax > pieceMax ? ` Mono voices make room for ${Math.min(space.pieces, monoMax)}.` : ''}
              </div>
            )}
            <RangeRow label="turn" value={space.rotate} min={-180} max={180} step={1} neutral={0} onChange={(v) => setSpace({ rotate: v })} shown={`${Math.round(space.rotate)}°`} title="Turn the whole sound scene : line the sound's front up with the picture's front in the room" />
            <RangeRow label="glide" value={space.glide} min={0} max={2} step={0.01} neutral={0.25} onChange={(v) => setSpace({ glide: v })} shown={`${space.glide.toFixed(2)} s`} title="How softly a voice that follows the picture moves (its latest notes jump; the sound slides)" />
            {domeOn ? (
              <div className="pl-[62px] font-mono text-[9px] text-muted">Following the fulldome mapping : a voice sounds where its picture is on the dome.</div>
            ) : (
              <>
                <RangeRow label="picture" value={space.flatWidth} min={10} max={360} step={1} neutral={120} onChange={(v) => setSpace({ flatWidth: v })} shown={`${Math.round(space.flatWidth)}°`} title="Fulldome off : the arc the flat picture spans in front of the audience (360 = all the way round)" />
                <RangeRow label="height" value={space.flatHigh} min={-30} max={90} step={1} neutral={45} onChange={(v) => setSpace({ flatHigh: v, flatLow: Math.min(space.flatLow, v) })} shown={`${Math.round(space.flatLow)}..${Math.round(space.flatHigh)}°`} title="Fulldome off : the elevation of the picture's top edge (its bottom edge stays at the horizon)" />
              </>
            )}
          </>
        )}
      </Shell>

      {on && (
        <Shell title="Room" hint="Seen like the domemaster : the zenith in the middle, the front at the bottom, the audience's right on the right; the rim is 15° under the horizon. Each voice is a dot (its left and right joined by a line, its span a halo); the small pink dots are the Collage pieces playing; speakers light with their level. Drag a voice to place it (a voice that followed the picture stays where you put it)." on open>
          <SpaceMap setVoice={setVoice} />
        </Shell>
      )}

      {on && (
        <Shell title="Voices" hint="Where each voice sits. Follow : where it plays in the picture (az then turns it from there). Fixed : at az / el. Width : how far apart its own left and right are. Span : how big a patch of the room it fills. Spin : turns it around the zenith, degrees a second. Drag a number up or down to change it (Shift : finer), click it to type. Click a voice's name (▸) for its sliders, each with an M to bind a modulator or a Meta knob." on open>
          <div className="font-mono text-[9px] text-muted">▸ a voice : its sliders, each with an <b>M</b> for a modulator or a Meta knob</div>
          <div className="flex items-center gap-1 font-mono text-[8px] uppercase text-muted">
            <span className="w-[54px] shrink-0" />
            <span className="w-[18px] shrink-0 text-center" title="Lit : the voice follows where it plays in the picture. Dark : a fixed place.">fol</span>
            {['az', 'el', 'width', 'span', 'spin'].map((h) => <span key={h} className="min-w-0 flex-1 text-center">{h}</span>)}
          </div>
          {SPACE_VOICES.map((v, i) => (
            <VoiceRow
              key={v} voice={v} index={i} setVoice={setVoice} open={open === v} onOpen={() => setOpen(open === v ? null : v)} modChip={modChip}
              assignBox={assign && assign.startsWith(`space.${v}.`) && renderAssign ? renderAssign(assign as SonifyModParam) : null}
            />
          ))}
        </Shell>
      )}
    </div>
  )
}

function VoiceRow({ voice, index, setVoice, open, onOpen, modChip, assignBox }: {
  voice: SpaceVoice
  index: number
  setVoice: (v: SpaceVoice, p: Partial<import('@shared/spatial').VoicePlace>) => void
  open: boolean
  onOpen: () => void
  modChip?: (p: SonifyModParam) => JSX.Element
  assignBox?: JSX.Element | null
}): JSX.Element {
  const p = useStore((s) => s.space.voices[voice])
  const bound = useStore((s) => s.composition.modMatrix.some((a) => a.target.kind === 'sonify' && a.target.param.startsWith(`space.${voice}.`)))
  const live = !!spaceEngine.points[index]?.live
  const lk = (f: string): string => `soni:space.${voice}.${f}` // the live (modulated) value
  return (
    <>
    <div className={`flex items-center gap-1 ${live ? '' : 'opacity-60'}`}>
      <button onClick={onOpen} className={`flex w-[54px] shrink-0 items-center gap-0.5 text-left text-[10px] hover:text-accent ${open ? 'text-accent' : ''}`} title={`${SPACE_VOICE_LABEL[voice]} : ${live ? 'playing' : 'off'}. Click : its sliders, each with an M to bind a modulator or a Meta knob${bound ? ' (one is bound now)' : ''}`}>
        <span className="w-2 shrink-0 text-[8px] text-muted">{open ? '▾' : '▸'}</span>
        <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: voiceColor(index) }} />
        <span className="min-w-0 truncate">{SPACE_VOICE_LABEL[voice]}</span>
        {bound && <span className="shrink-0 rounded bg-accent/25 px-0.5 font-mono text-[7px] text-accent">M</span>}
      </button>
      <button onClick={() => setVoice(voice, { follow: !p.follow })} className={`${chip(p.follow)} w-[18px] shrink-0 px-0 text-center`} title={p.follow ? 'Follows where it plays in the picture (click : a fixed place)' : 'At a fixed place (click : follow the picture)'}>
        {p.follow ? '◉' : '○'}
      </button>
      <ScrubBox value={p.az} min={-180} max={180} perPx={1} wrap liveKey={lk('az')} onChange={(v) => setVoice(voice, { az: v })} title={p.follow ? 'Azimuth added to where the picture puts it, degrees (clockwise)' : 'Azimuth, degrees : 0 front, 90 right, -90 left'} />
      <ScrubBox value={p.el} min={-15} max={90} perPx={0.5} liveKey={lk('el')} dim={p.follow} onChange={(v) => setVoice(voice, { el: v })} title={p.follow ? 'While following, the picture sets the elevation' : 'Elevation, degrees : 0 the horizon, 90 the zenith'} />
      <ScrubBox value={p.width} min={0} max={180} perPx={1} liveKey={lk('width')} onChange={(v) => setVoice(voice, { width: v })} title="Degrees between the voice's left and right" />
      <ScrubBox value={p.hspan * 100} min={0} max={100} perPx={0.5} onChange={(v) => setVoice(voice, { hspan: v / 100, vspan: v / 100 })} title="Span, % : how big a patch of the room the voice fills (0 = a point)" />
      <ScrubBox value={p.spin} min={-360} max={360} perPx={2} liveKey={lk('spin')} onChange={(v) => setVoice(voice, { spin: v })} title="Spin, degrees a second around the zenith (0 = still)" />
    </div>
    {open && (
      // the voice's place as sliders, each with Sonify's M (a modulator or a Meta knob)
      <div className="mb-1 ml-[18px] flex flex-col gap-1 border-l border-border pl-2">
        {SPACE_FIELDS.map((f) => {
          const r = SPACE_FIELD_RANGE[f]
          const v = placeField(p, f)
          const shown = f === 'span' ? `${Math.round(v * 100)}%` : f === 'spin' ? `${Math.round(v)}°/s` : `${Math.round(v)}°`
          const dim = f === 'el' && p.follow
          return (
            <div key={f} className={`flex items-center gap-1 ${dim ? 'opacity-40' : ''}`}>
              <span className="min-w-0 flex-1">
                <RangeRow
                  label={f} value={v} min={r.min} max={r.max} step={f === 'span' ? 0.01 : 1} neutral={r.def}
                  onChange={(x) => setVoice(voice, placePatch(f, x))} shown={shown}
                  title={`${SPACE_VOICE_LABEL[voice]} ${r.label}${f === 'az' && p.follow ? ' (added to where the picture puts it)' : ''}${dim ? ' (the picture sets it while following)' : ''}`}
                />
              </span>
              {modChip?.(spaceModParam(voice, f))}
            </div>
          )
        })}
        {assignBox}
      </div>
    )}
    </>
  )
}

/** A number box you can drag, like the Meta dials : up / down changes it
 *  (Shift : finer); a click without moving types into it. */
function ScrubBox({ value, min, max, perPx, wrap, dim, liveKey, onChange, title }: {
  value: number
  min: number
  max: number
  perPx: number // units per pixel of drag
  wrap?: boolean // an angle : past one end comes back at the other
  dim?: boolean
  liveKey?: string
  onChange: (v: number) => void
  title: string
}): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onPointerDown = (e: RPointerEvent<HTMLSpanElement>): void => {
    if (e.button !== 0 || dim) return
    const input = ref.current?.querySelector('input')
    if (input && input.ownerDocument.activeElement === input) return // typing : the box is a text box (its own window's focus)
    e.preventDefault() // no focus yet : this may be a drag
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    // The change is added up move by move, each at its own speed : Shift pressed
    // mid-drag slows what comes next (applied to the whole distance, the value
    // jumped back toward the start).
    const y0 = e.clientY, v0 = value
    let moved = false, lastY = y0, acc = 0
    const move = (ev: PointerEvent): void => {
      if (!(ev.buttons & 1)) { up(); return } // released elsewhere (a window switch)
      if (!moved && Math.abs(y0 - ev.clientY) < 3) return
      moved = true
      acc += (lastY - ev.clientY) * perPx * (ev.shiftKey ? 0.2 : 1)
      lastY = ev.clientY
      let v = v0 + acc
      v = wrap ? wrap180(v) : Math.max(min, Math.min(max, v))
      if (!wrap) acc = v - v0 // held at the end : coming back moves at once
      onChangeRef.current(Math.round(v))
    }
    let done = false
    const up = (): void => {
      if (done) return
      done = true
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('lostpointercapture', up)
      if (!moved && input) { input.focus(); input.select() }
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('lostpointercapture', up)
  }
  const hint = `${title} : drag up or down (Shift : finer), click to type`
  // (the box carries the whole hint : its own title covered the drag hint; a
  // dimmed box lets the pointer through to the span, whose title then shows)
  return (
    <span ref={ref} onPointerDown={onPointerDown} className={`min-w-0 flex-1 ${dim ? 'opacity-40' : 'cursor-ns-resize'}`} title={hint}>
      <BoundedNumberInput className={`input w-full !px-0 text-center !text-[9px] ${dim ? 'pointer-events-none' : ''}`} value={Math.round(value)} min={min} max={max} integer liveKey={liveKey} onChange={onChange} title={hint} />
    </span>
  )
}

/** The room from inside, as the domemaster draws it. Drag a voice to place it. */
function SpaceMap({ setVoice }: { setVoice: (v: SpaceVoice, p: Partial<import('@shared/spatial').VoicePlace>) => void }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  // canvas pixels ↔ the room (the drawing's own geometry : rim at -15°)
  const geom = (): { S: number; c: number; R: number; k: number; r: DOMRect } | null => {
    const cv = ref.current
    if (!cv) return null
    const r = cv.getBoundingClientRect()
    return { S: cv.width, c: cv.width / 2, R: cv.width * 0.46, k: cv.width / Math.max(1, r.width), r }
  }
  const at = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const g = geom()
    return g ? { x: (e.clientX - g.r.left) * g.k, y: (e.clientY - g.r.top) * g.k } : null
  }
  const voiceAt = (x: number, y: number): number => {
    const g = geom()
    if (!g) return -1
    let best = -1, bd = g.S * 0.05
    spaceEngine.points.forEach((p, s) => {
      if (s >= SPACE_VOICES.length) return // the FX return and the pieces stay put
      const a = (p.az * Math.PI) / 180, rr = (g.R * (90 - p.el)) / 105
      const d = Math.hypot(g.c + rr * Math.sin(a) - x, g.c + rr * Math.cos(a) - y)
      if (d < bd) { bd = d; best = s }
    })
    return best
  }
  const placeAt = (v: number, x: number, y: number): void => {
    const g = geom()
    if (!g) return
    const dx = x - g.c, dy = y - g.c
    const el = Math.max(-15, Math.min(90, 90 - (Math.hypot(dx, dy) / g.R) * 105))
    const az = Math.hypot(dx, dy) < 1e-6 ? 0 : (Math.atan2(dx, dy) * 180) / Math.PI
    // a voice that followed the picture is set down where it is dropped
    setVoice(SPACE_VOICES[v], { follow: false, az: Math.round(spaceEngine.storedAz(v, az)), el: Math.round(el) })
    spaceEngine.snap(v)
  }
  // A voice moves only once dragged past 3 px, held where it was grabbed : a
  // click (to see which voice a dot is) stopped it following and jumped it.
  const onDown = (e: RPointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return
    const p = at(e)
    const g = geom()
    if (!p || !g) return
    const v = voiceAt(p.x, p.y)
    if (v < 0) return
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    el.style.cursor = 'grabbing'
    const pt = spaceEngine.points[v]
    const a = (pt.az * Math.PI) / 180, rr = (g.R * (90 - pt.el)) / 105
    const ox = g.c + rr * Math.sin(a) - p.x, oy = g.c + rr * Math.cos(a) - p.y
    let moved = false, done = false
    const move = (ev: PointerEvent): void => {
      if (!(ev.buttons & 1)) { up(); return }
      const q = at(ev)
      if (!q) return
      if (!moved && Math.hypot(q.x - p.x, q.y - p.y) < 3 * g.k) return
      moved = true
      placeAt(v, q.x + ox, q.y + oy)
    }
    const up = (): void => {
      if (done) return
      done = true
      el.style.cursor = ''
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('lostpointercapture', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('lostpointercapture', up)
  }
  const onHover = (e: RPointerEvent<HTMLCanvasElement>): void => {
    if (e.buttons) return
    const p = at(e)
    e.currentTarget.style.cursor = p && voiceAt(p.x, p.y) >= 0 ? 'grab' : ''
  }
  useEffect(() => {
    let raf = 0
    // the theme's colors, read once per theme (every frame forced a style recalc)
    const rgb = (name: string): string => `rgb(${themeVar(name, '128 128 128').split(/\s+/).join(',')})`
    // Its size from its box on screen (under the UI zoom, clientWidth is not what
    // it shows), read when the box changes, not every frame; at least twice its
    // CSS size, as before.
    // (the window it is in : the Sonify page may have its own, on a screen of
    // another pixel ratio, with its own frames)
    const view = ownerWindow(ref.current)
    let size = 0
    const ro = new view.ResizeObserver(() => {
      const cv = ref.current
      if (cv) size = Math.round(Math.max(2 * cv.clientWidth, cv.getBoundingClientRect().width * (view.devicePixelRatio || 1)))
    })
    if (ref.current) ro.observe(ref.current)
    const draw = (): void => {
      raf = view.requestAnimationFrame(draw)
      const cv = ref.current
      if (!cv || !size || sonifyCovered(cv)) return
      if (cv.width !== size) { cv.width = size; cv.height = size }
      const g = cv.getContext('2d')
      if (!g) return
      const S = cv.width, c = S / 2, R = S * 0.46
      g.clearRect(0, 0, S, S)
      const muted = rgb('--c-muted'), text = rgb('--c-text')
      // the room : rim at -15°, rings at 0 / 30 / 60, the front marked at the bottom
      const rOf = (el: number): number => (R * (90 - el)) / 105
      const xy = (az: number, el: number): [number, number] => {
        const a = (az * Math.PI) / 180, r = rOf(el)
        return [c + r * Math.sin(a), c + r * Math.cos(a)]
      }
      g.lineWidth = 2
      g.strokeStyle = muted
      g.globalAlpha = 0.5
      g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.stroke()
      g.setLineDash([6, 6])
      for (const el of [0, 30, 60]) { g.beginPath(); g.arc(c, c, rOf(el), 0, Math.PI * 2); g.stroke() }
      g.setLineDash([])
      g.globalAlpha = 1
      g.fillStyle = muted
      g.font = `${Math.round(S * 0.035)}px monospace`
      g.textAlign = 'center'
      g.fillText('front', c, S - S * 0.01)
      const st = useStore.getState().space
      // speakers, lit by their level
      if (st.mode === 'speakers') {
        const lay = spaceEngine.currentLayout() ?? activeLayout(st)
        const meter = sonifyEngine.spaceMeter
        for (const sp of lay.speakers) {
          const [x, y] = xy(sp.az, sp.el)
          const ch = st.firstChannel - 1 + sp.id - 1
          const lv = meter && ch < meter.length ? Math.min(1, Math.sqrt(meter[ch])) : 0
          g.fillStyle = muted
          g.globalAlpha = 0.5 + 0.5 * lv
          const r = S * 0.012 + lv * S * 0.02
          if (sp.sub) g.fillRect(x - r, y - r, r * 2, r * 2)
          else { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill() }
        }
        g.globalAlpha = 1
      }
      // the Collage pieces playing : small pink dots, brighter as they show more
      const pd = spaceEngine.pieceDots
      for (let i = 0; i < spaceEngine.pieceN; i++) {
        const [x, y] = xy(pd[i * 3], pd[i * 3 + 1])
        g.fillStyle = voiceColor(SPACE_VOICES.indexOf('collage'), 0.35 + 0.65 * Math.min(1, pd[i * 3 + 2]))
        g.beginPath(); g.arc(x, y, S * 0.006, 0, Math.PI * 2); g.fill()
      }
      // the voices : left — dot — right, with the span as a halo
      spaceEngine.points.forEach((p, s) => {
        if (s >= SPACE_SOURCES) {
          // a Collage piece group (a source of its own) : a pink ring
          if (!p.live) return
          const [x, y] = xy(p.az, p.el)
          g.strokeStyle = voiceColor(SPACE_VOICES.indexOf('collage'), 0.9)
          g.lineWidth = 2
          g.beginPath(); g.arc(x, y, S * 0.014, 0, Math.PI * 2); g.stroke()
          return
        }
        const h = p.width * 0.5 * (st.mirror ? -1 : 1)
        const [x, y] = xy(p.az, p.el)
        g.globalAlpha = p.live ? 1 : 0.3
        if (p.hspan > 0.01 && s !== SPACE_FX) {
          g.fillStyle = voiceColor(s, 0.08)
          g.beginPath(); g.arc(x, y, Math.max(S * 0.02, Math.min(R * 0.35, R * p.hspan)), 0, Math.PI * 2); g.fill()
        }
        // its own left to right : an arc at its elevation, as it lies on the dome
        g.strokeStyle = voiceColor(s, 0.8)
        g.lineWidth = 3
        g.beginPath()
        for (let k = 0; k <= 12; k++) { const [ax, ay] = xy(p.az - h + (2 * h * k) / 12, p.el); if (k) g.lineTo(ax, ay); else g.moveTo(ax, ay) }
        g.stroke()
        g.fillStyle = voiceColor(s)
        g.beginPath(); g.arc(x, y, S * 0.018, 0, Math.PI * 2); g.fill()
        g.fillStyle = text
        g.fillText(s === SPACE_FX ? 'FX' : SPACE_VOICE_LABEL[SPACE_VOICES[s]].slice(0, 3), x, y - S * 0.03)
      })
      g.globalAlpha = 1
    }
    draw()
    return () => { view.cancelAnimationFrame(raf); ro.disconnect() }
  }, [])
  return <canvas ref={ref} onPointerDown={onDown} onPointerMove={onHover} className="mx-auto aspect-square w-full max-w-[320px]" style={{ touchAction: 'none' }} />
}
