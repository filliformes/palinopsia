// Space (the Sonify page's fourth view) : the voices placed in the room. The
// output (stereo, speakers, objects), the layout or the renderer it talks to,
// the scene's alignment, a live map seen like the domemaster (the zenith in the
// middle, the front at the bottom), and where each voice sits.
// Engine : audio/space.ts. Conventions and panning : shared/spatial.ts.

import { useEffect, useRef, useState } from 'react'
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
  type SpaceMode,
  type SpaceVoice
} from '@shared/spatial'
import type { SonifyModParam } from '@shared/types'
import { BoundedNumberInput } from './BoundedNumberInput'
import { Row, RangeRow, Seg, Shell, Stepper, chip } from './sonifyUi'
import { showToast } from './Toast'

const MODE_HINT: Record<SpaceMode, string> = {
  stereo: 'The stereo mix, as always.',
  speakers: 'Palinopsia pans every voice onto a speaker layout itself (VBAP), up to 32 channels on one output : a studio ring, a small dome.',
  objects: 'Every voice leaves on its own channels and its position goes over OSC to a renderer that owns the room : SpatGRIS (the SAT Satosphère\'s 93.5) or anything that speaks ADM-OSC.'
}

// one color per voice, then the FX return (the map and the rows share them)
const HUES = [28, 200, 120, 330, 52, 265, 175, 0, 300, 90]
const voiceColor = (s: number, a = 1): string => (s === SPACE_FX ? `rgba(160,160,160,${a})` : `hsla(${HUES[s]},80%,60%,${a})`)

/** `chip` : Sonify's own M button (the page's assign panel opens above). */
export function SpacePanel({ chip: modChip }: { chip?: (p: SonifyModParam) => JSX.Element }): JSX.Element {
  const space = useStore((s) => s.space)
  const setSpace = useStore((s) => s.setSpace)
  const setVoice = useStore((s) => s.setSpaceVoice)
  const domeOn = useStore((s) => s.dome.enabled)
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 300)
    return () => window.clearInterval(id)
  }, [])
  const fileRef = useRef<HTMLInputElement>(null)
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
  const groups = spaceEngine.groups
  const p0 = space.firstChannel + SPACE_SOURCES * per
  const [open, setOpen] = useState<SpaceVoice | null>(null)

  return (
    <div className="flex flex-col gap-2">
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
          <div className="pl-[62px] font-mono text-[9px] leading-snug text-muted">
            {spaceEngine.problem ? (
              <span className="text-[rgb(var(--c-danger))]">{spaceEngine.problem}</span>
            ) : (
              space.preview ? (
                <>{spaceEngine.channels} channels, heard on headphones (two channels out)</>
              ) : (
                <>
                  {spaceEngine.channels} channels on an output of {outCh}
                  {outCh <= 2 && ' : pick a multichannel output in the bar above'}
                </>
              )
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
                onBlur={(e) => setSpace({ host: e.target.value.trim() })}
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
              <button onClick={() => setSpace({ preview: !space.preview })} className={chip(space.preview)} title="Headphones : hear the room in stereo. Every channel (each speaker of the layout, or each object) is placed around your head (binaural, through the HRTF) and played on Sonify's output as two channels. Turn it off to send the channels to the speakers or the renderer.">🎧 headphones</button>
            </Row>
            <Row label="pieces" hint="The Collage voice's pieces as sources of their own : each piece (or, past the count, each group of nearby pieces) sounds where it is in the picture, on the dome. 0 : the voice is one pair like the others. As objects, each takes a channel after the voices.">
              <Stepper value={Math.min(space.pieces, pieceMax)} min={0} max={pieceMax} onChange={(v) => setSpace({ pieces: v })} title="How many Collage piece sources (0 = off)" />
              <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-muted">
                {space.pieces > 0 ? `${groups} source${groups === 1 ? '' : 's'}${space.mode === 'objects' && space.pieces > pieceMax ? ` (the channels allow ${pieceMax})` : ''}` : 'off'}
              </span>
            </Row>
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
        <Shell title="Room" hint="Seen like the domemaster : the zenith in the middle, the front at the bottom, the audience's right on the right; the rim is 15° under the horizon. Each voice is a dot (its left and right joined by a line, its span a halo); speakers light with their level." on open>
          <SpaceMap />
        </Shell>
      )}

      {on && (
        <Shell title="Voices" hint="Where each voice sits. Follow : where it plays in the picture (az then turns it from there). Fixed : at az / el. Width : how far apart its own left and right are. Span : how big a patch of the room it fills. Spin : turns it around the zenith, degrees a second." on open>
          <div className="flex items-center gap-1 font-mono text-[8px] uppercase text-muted">
            <span className="w-[62px] shrink-0" />
            <span className="w-[18px] shrink-0 text-center" title="Lit : the voice follows where it plays in the picture. Dark : a fixed place.">fol</span>
            {['az', 'el', 'width', 'span', 'spin'].map((h) => <span key={h} className="min-w-0 flex-1 text-center">{h}</span>)}
          </div>
          {SPACE_VOICES.map((v, i) => (
            <VoiceRow key={v} voice={v} index={i} setVoice={setVoice} open={open === v} onOpen={() => setOpen(open === v ? null : v)} modChip={modChip} />
          ))}
        </Shell>
      )}
    </div>
  )
}

function VoiceRow({ voice, index, setVoice, open, onOpen, modChip }: {
  voice: SpaceVoice
  index: number
  setVoice: (v: SpaceVoice, p: Partial<import('@shared/spatial').VoicePlace>) => void
  open: boolean
  onOpen: () => void
  modChip?: (p: SonifyModParam) => JSX.Element
}): JSX.Element {
  const p = useStore((s) => s.space.voices[voice])
  const live = !!spaceEngine.points[index]?.live
  const box = 'input w-full !px-0 text-center'
  const cell = 'min-w-0 flex-1'
  const lk = (f: string): string => `soni:space.${voice}.${f}` // the live (modulated) value
  return (
    <>
    <div className={`flex items-center gap-1 ${live ? '' : 'opacity-60'}`}>
      <button onClick={onOpen} className="flex w-[62px] shrink-0 items-center gap-1 text-left text-[10px] hover:text-accent" title={`${SPACE_VOICE_LABEL[voice]} : ${live ? 'playing' : 'off'}. Click : its sliders, each with an M to bind a modulator or a Meta knob`}>
        <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: voiceColor(index) }} />
        <span className="truncate">{SPACE_VOICE_LABEL[voice]}</span>
      </button>
      <button onClick={() => setVoice(voice, { follow: !p.follow })} className={`${chip(p.follow)} w-[18px] shrink-0 px-0 text-center`} title={p.follow ? 'Follows where it plays in the picture (click : a fixed place)' : 'At a fixed place (click : follow the picture)'}>
        {p.follow ? '◉' : '○'}
      </button>
      <span className={cell}><BoundedNumberInput className={box} value={Math.round(p.az)} min={-180} max={180} integer liveKey={lk('az')} onChange={(v) => setVoice(voice, { az: v })} title={p.follow ? 'Azimuth added to where the picture puts it, degrees (clockwise)' : 'Azimuth, degrees : 0 front, 90 right, -90 left'} /></span>
      <span className={`${cell} ${p.follow ? 'pointer-events-none opacity-40' : ''}`}>
        <BoundedNumberInput className={box} value={Math.round(p.el)} min={-15} max={90} integer liveKey={lk('el')} onChange={(v) => setVoice(voice, { el: v })} title={p.follow ? 'While following, the picture sets the elevation' : 'Elevation, degrees : 0 the horizon, 90 the zenith'} />
      </span>
      <span className={cell}><BoundedNumberInput className={box} value={Math.round(p.width)} min={0} max={180} integer liveKey={lk('width')} onChange={(v) => setVoice(voice, { width: v })} title="Degrees between the voice's left and right" /></span>
      <span className={cell}><BoundedNumberInput className={box} value={Math.round(p.hspan * 100)} min={0} max={100} integer onChange={(v) => setVoice(voice, { hspan: v / 100, vspan: v / 100 })} title="Span, % : how big a patch of the room the voice fills (0 = a point)" /></span>
      <span className={cell}><BoundedNumberInput className={box} value={Math.round(p.spin)} min={-360} max={360} integer liveKey={lk('spin')} onChange={(v) => setVoice(voice, { spin: v })} title="Spin, degrees a second around the zenith (0 = still)" /></span>
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
      </div>
    )}
    </>
  )
}

/** The room from inside, as the domemaster draws it. */
function SpaceMap(): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let raf = 0
    const rgb = (name: string): string => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).join(',')
      return `rgb(${v || '128,128,128'})`
    }
    const draw = (): void => {
      raf = requestAnimationFrame(draw)
      const cv = ref.current
      if (!cv) return
      const W = cv.clientWidth
      if (cv.width !== W * 2) { cv.width = W * 2; cv.height = W * 2 }
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
      // the voices : left — dot — right, with the span as a halo
      spaceEngine.points.forEach((p, s) => {
        if (s >= SPACE_SOURCES) {
          // a Collage piece group : a small dot in the Collage's color
          if (!p.live) return
          const [x, y] = xy(p.az, p.el)
          g.globalAlpha = 0.85
          g.fillStyle = voiceColor(SPACE_VOICES.indexOf('collage'))
          g.beginPath(); g.arc(x, y, S * 0.009, 0, Math.PI * 2); g.fill()
          g.globalAlpha = 1
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
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={ref} className="mx-auto aspect-square w-full max-w-[320px]" />
}
