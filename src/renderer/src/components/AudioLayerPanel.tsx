// The Audio Layer strip (the layers tab, under L4) : the layer's volume, meter
// and mute on its header, then slot A, the A/B mix and slot B, each a sound file,
// a live input or an NDI® source. And the Inspector's page for a selected slot :
// a file's transport (the Import Audio one), a live input's device (an NDI
// source) and channels, and the slot's volume and pan.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AudioLayerSlot, ModTarget, SourceSlot } from '@shared/types'
import type { AuModTarget } from '@shared/auMod'
import { TBTN, TBTN_IDLE, TBTN_IDLE_ON, TBTN_LIT } from './buttonStyles'
import { SearchSelect, type SearchOption } from './SearchSelect'
import { VideoTransport } from './VideoTransport'
import { AssignRow, useBound } from './AutoControls'
import { registerLiveOverlay } from './liveOverlay'
import { useModSlide } from './useModSlide'
import { modTargetKey, useStore } from '../store'
import { AUDIO_LAYER, audioLayer, type AudioSlotName, type SlotInfo } from '../audio/audioLayer'
import { droppedPaths, dropKind, isFileDrag, openDroppedSession } from './fileDrop'
import { showToast } from './Toast'
import { NdiPicker } from './NdiPicker'

const AUDIO_ACCEPT = 'audio/*,.wav,.mp3,.flac,.ogg,.oga,.opus,.aac,.m4a,.aif,.aiff,.wma,.caf'
const M_FLOOR = -60

/** The audio inputs (their names show once one has been opened) : `label` the
 *  system's own ('' until then : what is stored, never a made-up one), `name`
 *  what the menus show. */
function useAudioInputs(): Array<{ id: string; label: string; name: string }> {
  const [list, setList] = useState<Array<{ id: string; label: string; name: string }>>([])
  useEffect(() => {
    let alive = true
    const md = navigator.mediaDevices
    const read = (): void => {
      void md?.enumerateDevices().then((ds) => {
        if (!alive) return
        setList(
          ds
            .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
            .map((d, i) => ({ id: d.deviceId, label: d.label, name: d.label || `input ${i + 1}` }))
        )
      }).catch(() => {})
    }
    read()
    md?.addEventListener?.('devicechange', read)
    const off = audioLayer.subscribe(read) // a device opened : the names are readable now
    return () => {
      alive = false
      md?.removeEventListener?.('devicechange', read)
      off()
    }
  }, [])
  return list
}

/** A slot as it is : a live input's device as it opened (its channel count, its
 *  error, lost), a file's error. */
function useSlotInfo(slot: AudioSlotName): SlotInfo {
  const [info, setInfo] = useState(() => audioLayer.slotInfo(slot))
  useEffect(() => {
    setInfo(audioLayer.slotInfo(slot))
    return audioLayer.subscribe(() => setInfo(audioLayer.slotInfo(slot)))
  }, [slot])
  return info
}

/** A slot's meter in its row; in its place, a live input not open yet (its open
 *  button), one lost or that could not open, a file that cannot play (click :
 *  try again). */
function SlotState({ slot, s }: { slot: AudioSlotName; s: AudioLayerSlot }): JSX.Element {
  const armed = useStore((st) => st.audioLayerArmed[slot])
  const arm = useStore((st) => st.armAudioLayer)
  const info = useSlotInfo(slot)
  if (s.kind !== 'file' && !armed) {
    return (
      <button
        type="button"
        onClick={() => arm(slot)}
        className="w-10 shrink-0 rounded bg-panel2 py-0.5 text-center font-mono text-[9px] text-accent ring-1 ring-accent/50 transition-colors hover:bg-accent/15"
        title={`Open this ${s.kind === 'ndi' ? 'NDI® source' : 'live input'} (${slotName(s)}) : a session (or an undo) never opens one by itself`}
      >
        open
      </button>
    )
  }
  if (!info.error) return <Meter which={slot} className="w-10 shrink-0" />
  return (
    <button
      type="button"
      onClick={() => audioLayer.reopen(slot)}
      className="w-10 shrink-0 rounded bg-panel2 py-0.5 text-center font-mono text-[9px] text-danger ring-1 ring-danger/40 transition-colors hover:bg-danger/15"
      title={`${s.kind === 'file' ? 'It cannot play' : info.lost ? (s.kind === 'ndi' ? 'It is not on the network (it plays again as soon as it is back)' : 'It was lost (it opens again when the device comes back)') : 'It could not open'} : ${info.error}. Click : try again`}
    >
      {info.lost ? 'lost' : 'failed'}
    </button>
  )
}

/** A level meter (RMS bar, held peak, -60..0 dBFS) on a slot after its volume,
 *  or on the whole layer (`which` null). Painted from the analyser each frame. */
function Meter({ which, className = '', number = false }: { which: AudioSlotName | null; className?: string; number?: boolean }): JSX.Element {
  const barRef = useRef<HTMLDivElement | null>(null)
  const tickRef = useRef<HTMLDivElement | null>(null)
  const numRef = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    let raf = 0, at = performance.now(), rmsDb = -120, pkDb = -120, held = 0, shown = ''
    const toDb = (x: number): number => (x > 1e-6 ? 20 * Math.log10(x) : -120)
    const x = (db: number): number => Math.max(0, Math.min(1, (db - M_FLOOR) / -M_FLOOR))
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.25, (now - at) / 1000)
      at = now
      const m = audioLayer.meter(which)
      const r = toDb(m.rms), p = toDb(m.peak)
      rmsDb = r >= rmsDb ? r : Math.max(r, rmsDb - 24 * dt) // a meter's fall, 24 dB/s
      if (p >= pkDb) { pkDb = p; held = 1 } else if ((held -= dt) <= 0) pkDb = Math.max(p, pkDb - 24 * dt)
      if (barRef.current) {
        barRef.current.style.width = `${(x(rmsDb) * 100).toFixed(1)}%`
        barRef.current.style.background = rmsDb > -9 ? 'rgb(214,196,90)' : 'rgb(120,200,140)'
      }
      if (tickRef.current) {
        tickRef.current.style.left = `calc(${(x(pkDb) * 100).toFixed(1)}% - 1px)`
        tickRef.current.style.opacity = pkDb > M_FLOOR ? '1' : '0'
        tickRef.current.style.background = pkDb > -1 ? 'rgb(230,120,60)' : 'rgb(230,230,230)'
      }
      if (numRef.current) {
        const txt = (rmsDb > -119 ? Math.pow(10, rmsDb / 20) : 0).toFixed(3)
        if (txt !== shown) {
          shown = txt
          numRef.current.textContent = txt
          numRef.current.title = `RMS ${txt} (${rmsDb > -119 ? rmsDb.toFixed(1) : '-∞'} dBFS)`
        }
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [which])
  return (
    <>
      <div
        className={`relative h-[7px] overflow-hidden rounded-sm bg-panel3 ${className}`}
        title={`${which ? `Slot ${which}` : 'The layer'}'s sound${which ? ' after its volume and pan' : ', what goes into the mix'} : the bar is its RMS, the tick its peak (${M_FLOOR} to 0 dBFS)`}
      >
        <div ref={barRef} className="absolute inset-y-0 left-0 w-0" />
        <div ref={tickRef} className="absolute inset-y-0 w-[2px] opacity-0" />
      </div>
      {number && <span ref={numRef} className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted">0.000</span>}
    </>
  )
}

function Chip({ label, active, onClick, title }: { label: string; active: boolean; onClick: () => void; title: string }): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
        active ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel2 text-muted hover:text-text'
      }`}
    >
      {label}
    </button>
  )
}

function slotName(s: AudioLayerSlot | null): string | null {
  if (!s) return null
  if (s.kind === 'file') return s.mediaName ?? 'sound file'
  if (s.kind === 'ndi') return s.ndiName ?? 'NDI source'
  return s.deviceLabel ?? (s.deviceId ? 'live input' : 'default input')
}

/** The layer strip. */
export function AudioLayerPanel(): JSX.Element {
  const al = useStore((s) => s.audioLayer)
  const patch = useStore((s) => s.patchAudioLayer)
  const collapsed = useStore((s) => !!s.collapsed.audioLayer)
  const toggleSection = useStore((s) => s.toggleSection)
  // a live input not open yet (a session never opens one by itself)
  const closed = useStore((s) => (['A', 'B'] as const).some((sl) => !!s.audioLayer[sl] && s.audioLayer[sl]?.kind !== 'file' && !s.audioLayerArmed[sl]))
  const a = slotName(al.A), b = slotName(al.B)
  // which control's binding row is open (its M chip), under its own row
  const [openMod, setOpenMod] = useState<'volume' | 'mix' | null>(null)
  const modChip = (f: 'volume' | 'mix', what: string): JSX.Element => (
    <AuModChip target={f === 'mix' ? AU_MIX : AU_VOLUME} open={openMod === f} onToggle={() => setOpenMod(openMod === f ? null : f)} what={what} />
  )
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border bg-panel p-2">
      {/* Header : chevron · AU · volume · meter · mute */}
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={() => toggleSection('audioLayer')}
          className="flex shrink-0 items-center gap-1"
          title={collapsed ? 'Expand the Audio Layer' : 'Collapse the Audio Layer'}
        >
          <span className={`font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>
          <span className="font-mono text-[11px] text-muted">AU</span>
        </button>
        <AuSlider
          target={AU_VOLUME} min={0} max={2} value={al.volume}
          set={(v) => patch({ volume: v })}
          onDoubleClick={() => patch({ volume: 1 })}
          className="min-w-0 flex-1"
          title={`The Audio Layer's volume ${Math.round(al.volume * 100)} % (double-click : 100 %). It plays into Sonify's mix (after Sonify's own volume) : the output EQ, the limiter, the recordings and Space have it, Sonify on or off.`}
        />
        {modChip('volume', "the Audio Layer's volume")}
        <Meter which={null} className="w-12 shrink-0" />
        <Chip label="⊘" active={al.mute} onClick={() => patch({ mute: !al.mute })} title="Mute the Audio Layer" />
      </div>
      {openMod === 'volume' && <AuAssign target={AU_VOLUME} />}
      {collapsed ? (
        <div className="flex min-w-0 items-center gap-1 px-1 font-mono text-[9px] text-muted" title="What the collapsed Audio Layer holds (expand to edit)">
          <span className="min-w-0 truncate">{a && b ? `${a} + ${b}` : (a ?? b ?? 'empty')}</span>
          {al.mute && <span className="shrink-0 text-danger/80">· muted</span>}
          {closed && <span className="shrink-0 text-accent/80" title="A live input is not open : expand the Audio Layer to open it">· not open</span>}
        </div>
      ) : (
        <>
          <SlotRow slot="A" />
          <div className="flex min-w-0 items-center gap-1.5">
            <PlayBoth />
            <span className="shrink-0 font-mono text-[9px] uppercase text-muted">mix</span>
            <span className="shrink-0 font-mono text-[9px] text-muted">A</span>
            <AuSlider
              target={AU_MIX} min={0} max={1} value={al.mix}
              set={(v) => patch({ mix: v })}
              onDoubleClick={() => patch({ mix: 0.5 })}
              className="min-w-0 flex-1"
              title={`A and B : the middle plays both whole, toward an end the other one fades out (${al.mix.toFixed(2)}; double-click : the middle)`}
            />
            <span className="shrink-0 font-mono text-[9px] text-muted">B</span>
            {modChip('mix', "the Audio Layer's A/B mix")}
          </div>
          {openMod === 'mix' && <AuAssign target={AU_MIX} />}
          <SlotRow slot="B" />
        </>
      )}
    </div>
  )
}

/** Both files from their in points at the same moment (a synced start), or
 *  both paused. In the column of the A and B buttons, between them. */
function PlayBoth(): JSX.Element {
  const files = useStore((st) => (['A', 'B'] as const).filter((sl) => st.audioLayer[sl]?.kind === 'file').length)
  const playing = useStore((st) => (['A', 'B'] as const).some((sl) => st.audioLayer[sl]?.kind === 'file' && st.audioLayer[sl]?.videoPlaying !== false))
  const play = useStore((st) => st.playAudioLayer)
  return (
    <button
      type="button"
      disabled={!files}
      onClick={() => play(!playing)}
      className={`flex h-[22px] w-[34px] shrink-0 items-center justify-center rounded border font-mono text-[11px] leading-none transition-colors ${
        !files ? 'border-border bg-panel2 text-muted/40' : playing ? 'border-accent bg-accent/20 text-accent' : 'border-border bg-panel2 text-text hover:border-accent/50 hover:text-accent'
      }`}
      title={!files ? 'Play both files together (load a sound file in A or B)' : playing ? 'Pause both files' : `Play ${files > 1 ? 'both files' : 'the file'} from ${files > 1 ? 'their' : 'its'} in point${files > 1 ? 's' : ''}, together : each is cued, then all start at the same moment`}
    >
      {playing ? '⏸' : '▶'}
    </button>
  )
}

function SlotRow({ slot }: { slot: AudioSlotName }): JSX.Element {
  const s = useStore((st) => st.audioLayer[slot])
  const selected = useStore((st) => st.selection?.type === 'audio' && st.selection.slot === slot)
  const setSelection = useStore((st) => st.setSelection)
  const setFile = useStore((st) => st.setAudioLayerFile)
  const setLive = useStore((st) => st.setAudioLayerLive)
  const setNdi = useStore((st) => st.setAudioLayerNdi)
  const clear = useStore((st) => st.clearAudioLayerSlot)
  const patchSlot = useStore((st) => st.patchAudioLayerSlot)
  const inputs = useAudioInputs()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [ndiPick, setNdiPick] = useState(false)
  const pick = (file: File): void => {
    let path = ''
    try { path = window.api.getMediaPath(file) } catch { /* unavailable */ }
    if (path) setFile(slot, `opsia-media://local/${encodeURIComponent(path)}`, file.name, path)
  }
  // A sound file dragged in from the desktop (a film plays its soundtrack).
  const [dropOver, setDropOver] = useState(false)
  const dropIn = (e: React.DragEvent): void => {
    const items = droppedPaths(e)
    if (!items.length || openDroppedSession(items)) return // a session file opens, wherever it lands
    const { path, name } = items[0]
    const kind = dropKind(path)
    if (kind === 'audio' || kind === 'video') setFile(slot, `opsia-media://local/${encodeURIComponent(path)}`, name, path)
    else showToast(`${name} : an Audio Layer slot takes a sound file (or a film, for its soundtrack)`, 'warn', 5000)
  }
  const liveVal = (id: string): string => `__live__:${id}`
  const value = !s ? '' : s.kind === 'file' ? '__file__' : s.kind === 'ndi' ? '__ndi__' : liveVal(s.deviceId ?? '')
  const known = !s || s.kind !== 'live' || !s.deviceId || inputs.some((d) => d.id === s.deviceId)
  const options: SearchOption[] = [
    { value: '', label: 'none' },
    ...(s?.kind === 'file' ? [{ value: '__file__', label: s.mediaName ?? 'sound file', prefix: '🔊 ', group: 'file' }] : []),
    { value: '__file_pick__', label: 'Import audio…', prefix: '🔊 ', group: 'file', title: 'A sound file (WAV, AIFF, MP3, FLAC, Ogg, AAC…) played like a film : its transport and waveform in the Inspector' },
    { value: liveVal(''), label: 'default input', prefix: '🎙 ', group: 'live input', title: "The system's default audio input, live" },
    ...inputs.map((d): SearchOption => ({ value: liveVal(d.id), label: d.name, prefix: '🎙 ', group: 'live input', title: `${d.name}, live : its channels in the Inspector` })),
    ...(!known && s?.kind === 'live' ? [{ value: liveVal(s.deviceId ?? ''), label: `${s.deviceLabel ?? 'input'} (not found)`, prefix: '🎙 ', group: 'live input' }] : []),
    ...(s?.kind === 'ndi' ? [{ value: '__ndi__', label: s.ndiName ?? 'NDI source', prefix: '📶 ', group: 'NDI®' }] : []),
    { value: '__ndi_pick__', label: 'NDI® source…', prefix: '📶 ', group: 'NDI®', title: "Another computer's or app's sound over the network (an NDI audio plug-in in a DAW, NDI Tools, OBS…) : the same sources the NDI video input lists" }
  ]
  return (
    <div
      className={`flex min-w-0 items-center gap-1.5 rounded transition-shadow ${dropOver ? 'ring-2 ring-accent' : ''}`}
      onClick={() => s && setSelection({ type: 'audio', slot })}
      onDragOver={(e) => {
        if (!isFileDrag(e)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        if (!dropOver) setDropOver(true)
      }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOver(false) }}
      onDrop={(e) => {
        if (!isFileDrag(e)) return
        e.preventDefault()
        e.stopPropagation()
        setDropOver(false)
        dropIn(e)
      }}
      title={`Slot ${slot} : drop a sound file here`}
    >
      <button
        type="button"
        className={`${TBTN} w-[34px] !px-0 text-center ${selected ? TBTN_LIT : s ? TBTN_IDLE_ON : TBTN_IDLE}`}
        title={`Slot ${slot} : show its controls in the Inspector`}
      >
        {slot}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept={AUDIO_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) pick(f)
          e.target.value = ''
        }}
      />
      <SearchSelect
        className={`min-w-0 flex-1 text-[11px] ${selected ? 'border-accent' : ''}`}
        value={value}
        menuWidth={248}
        title={`What slot ${slot} plays : a sound file, or a live audio input`}
        options={options}
        onChange={(v) => {
          if (v === '') clear(slot)
          else if (v === '__file_pick__') fileRef.current?.click()
          else if (v === '__ndi_pick__') setNdiPick(true)
          else if (v.startsWith('__live__:')) {
            const id = v.slice('__live__:'.length)
            setLive(slot, id, id ? (inputs.find((d) => d.id === id)?.label ?? '') : '')
          }
        }}
      />
      {s && <SlotState slot={slot} s={s} />}
      {s && (
        <span onClick={(e) => e.stopPropagation()}>
          <Chip label="⊘" active={!!s.mute} onClick={() => patchSlot(slot, { mute: !s.mute })} title={`Mute slot ${slot}`} />
        </span>
      )}
      {/* (on the page's body : not under this row's title; its clicks kept from the row) */}
      {ndiPick && createPortal(
        <span onClick={(e) => e.stopPropagation()}>
          <NdiPicker onPick={(name) => { setNdiPick(false); setNdi(slot, name) }} onCancel={() => setNdiPick(false)} />
        </span>,
        document.body
      )}
    </div>
  )
}

/** The Inspector's page for a selected Audio Layer slot. */
export function AudioLayerInspector({ slot }: { slot: AudioSlotName }): JSX.Element {
  const s = useStore((st) => st.audioLayer[slot])
  const patchSlot = useStore((st) => st.patchAudioLayerSlot)
  const setFile = useStore((st) => st.setAudioLayerFile)
  const info = useSlotInfo(slot)
  if (!s) {
    return (
      <div className="rounded-md border border-border bg-panel p-3 text-[11px] text-muted">
        Audio Layer, slot {slot} : empty. Pick a sound file or a live input in its row (layers tab).
      </div>
    )
  }
  const asSlot = {
    kind: 'audio', shaderId: null, inputs: {},
    mediaId: s.mediaId, mediaName: s.mediaName, mediaPath: s.mediaPath,
    videoPlaying: s.videoPlaying, videoSpeed: s.videoSpeed, videoLoop: s.videoLoop,
    videoIn: s.videoIn, videoOut: s.videoOut, ignoreGlobalSpeed: s.ignoreGlobalSpeed
  } as unknown as SourceSlot
  return (
    <div className="rounded-md border border-border bg-panel">
      <div className="flex items-start gap-2 px-3 py-2">
        <span className="min-w-0 truncate text-[12px] font-semibold">
          {s.kind === 'file' ? '🔊' : s.kind === 'ndi' ? '📶' : '🎙'} {slotName(s)}
        </span>
        <span className="whitespace-nowrap pt-0.5 font-mono text-[9px] uppercase tracking-wide text-muted">audio layer · {slot}</span>
        <p className="ml-auto max-w-[50%] text-right text-[10px] leading-tight text-muted">
          {s.kind === 'file' ? 'A sound file' : s.kind === 'ndi' ? 'An NDI® source' : 'A live input'}, into Sonify&apos;s mix (Sonify on or off) : the output EQ, the limiter, the recordings and Space have it.
        </p>
      </div>
      {s.kind === 'file' ? (
        <>
          {info.error && (
            <div className="flex items-center gap-2 border-t border-border px-3 py-1.5 text-[10px] text-danger">
              <span className="min-w-0 flex-1">It cannot play : {info.error}</span>
              <button
                type="button"
                onClick={() => audioLayer.reopen(slot)}
                className="shrink-0 rounded border border-danger/40 px-1.5 py-0.5 font-mono text-[10px] hover:bg-danger/15"
                title="Load the file again"
              >
                try again
              </button>
            </div>
          )}
          <VideoTransport
            layer={AUDIO_LAYER}
            slot={slot}
            state={asSlot}
            audio
            ops={{
              patch: (p) => patchSlot(slot, p as Partial<AudioLayerSlot>),
              swap: (url, name, path) => setFile(slot, url, name, path, true),
              volume: s.volume,
              setVolume: (v) => patchSlot(slot, { volume: v }),
              mod: {
                position: { kind: 'au', slot, field: 'playhead' },
                speed: { kind: 'au', slot, field: 'speed' },
                loopIn: { kind: 'au', slot, field: 'trimIn' },
                loopOut: { kind: 'au', slot, field: 'trimOut' },
                vol: { kind: 'au', slot, field: 'volume' }
              },
              extra: (
                <button
                  onClick={() => patchSlot(slot, { keepPitch: !s.keepPitch })}
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                    s.keepPitch ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted hover:text-text'
                  }`}
                  title={s.keepPitch ? 'Keep pitch : the speed changes the tempo, the pitch stays. Click : like tape (the pitch moves with the speed)' : 'Like tape : the pitch moves with the speed. Click to keep the pitch'}
                >
                  {s.keepPitch ? '♪ kept' : '♪ tape'}
                </button>
              )
            }}
          />
          <div className="px-2 pb-2">
            <PanRow slot={slot} pan={s.pan} />
          </div>
        </>
      ) : (
        <LiveControls slot={slot} s={s} />
      )}
    </div>
  )
}

function PanRow({ slot, pan }: { slot: AudioSlotName; pan: number }): JSX.Element {
  const patchSlot = useStore((st) => st.patchAudioLayerSlot)
  const txt = Math.abs(pan) < 0.005 ? 'C' : pan < 0 ? `L${Math.round(-pan * 100)}` : `R${Math.round(pan * 100)}`
  const target: AuModTarget = { kind: 'au', slot, field: 'pan' }
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 font-mono text-[9px] uppercase text-muted">pan</span>
        <AuSlider
          target={target} min={-1} max={1} value={pan}
          set={(v) => patchSlot(slot, { pan: v })}
          onDoubleClick={() => patchSlot(slot, { pan: 0 })}
          className="min-w-0 flex-1"
          title={`Pan ${txt} : left to right (double-click : center)`}
        />
        <span className="w-12 shrink-0 text-right font-mono text-[10px] text-muted">{txt}</span>
        <AuModChip target={target} open={open} onToggle={() => setOpen(!open)} what={`slot ${slot}'s pan`} />
      </div>
      {open && <AuAssign target={target} />}
    </>
  )
}

function LiveControls({ slot, s }: { slot: AudioSlotName; s: AudioLayerSlot }): JSX.Element {
  const patchSlot = useStore((st) => st.patchAudioLayerSlot)
  const setLive = useStore((st) => st.setAudioLayerLive)
  const armed = useStore((st) => st.audioLayerArmed[slot])
  const arm = useStore((st) => st.armAudioLayer)
  const inputs = useAudioInputs()
  const info = useSlotInfo(slot)
  const ndi = s.kind === 'ndi'
  // (an NDI source : the first 16 of its channels)
  const n = Math.max(2, ndi ? Math.min(16, info.channels) : info.channels)
  const chL = s.chL ?? 0, chR = s.chR ?? 1
  const chOpts: Array<{ v: string; label: string }> = []
  for (let i = 0; i + 1 < n; i += 2) chOpts.push({ v: `${i}:${i + 1}`, label: `${i + 1}+${i + 2} stereo` })
  for (let i = 0; i < n; i++) chOpts.push({ v: `${i}:-1`, label: `${i + 1} mono` })
  const chVal = `${chL}:${chR}`
  if (!chOpts.some((o) => o.v === chVal)) chOpts.unshift({ v: chVal, label: chR < 0 ? `${chL + 1} mono` : `${chL + 1}+${chR + 1}` })
  const known = !s.deviceId || inputs.some((d) => d.id === s.deviceId)
  const volTarget: AuModTarget = { kind: 'au', slot, field: 'volume' }
  const [volOpen, setVolOpen] = useState(false)
  return (
    <div className="flex flex-col gap-2 border-t border-border px-2 py-2">
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 font-mono text-[9px] uppercase text-muted">{ndi ? 'ndi' : 'input'}</span>
        {ndi ? <NdiSourceButton slot={slot} name={s.ndiName ?? ''} /> : (
        <select
          className="input select-compact min-w-0 flex-1 text-[10px]"
          value={s.deviceId ?? ''}
          onChange={(e) => {
            const id = e.target.value
            setLive(slot, id, id ? (inputs.find((d) => d.id === id)?.label ?? '') : '')
          }}
          title="The audio input it listens to, live (an interface's inputs, a microphone, a loopback device)"
        >
          <option value="">default input</option>
          {inputs.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
          {!known && <option value={s.deviceId}>{`${s.deviceLabel ?? 'input'} (not found)`}</option>}
        </select>
        )}
        <select
          className="input select-compact w-28 shrink-0 text-[10px]"
          value={chVal}
          onChange={(e) => {
            const [l, r] = e.target.value.split(':').map(Number)
            patchSlot(slot, { chL: l, chR: r })
          }}
          title="Which of the device's channels : a stereo pair, or one channel (mono, on both sides; pan places it)"
        >
          {chOpts.map((o) => (
            <option key={o.v} value={o.v}>{o.label}</option>
          ))}
        </select>
        {!armed ? (
          <button
            type="button"
            onClick={() => arm(slot)}
            className="w-12 shrink-0 rounded bg-panel2 py-0.5 text-center font-mono text-[9px] text-accent ring-1 ring-accent/50 transition-colors hover:bg-accent/15"
            title={`Open this ${ndi ? 'NDI® source' : 'live input'} : a session never opens one by itself`}
          >
            open
          </button>
        ) : info.error ? (
          <button
            type="button"
            onClick={() => audioLayer.reopen(slot)}
            className="w-12 shrink-0 text-right font-mono text-[9px] text-danger hover:underline"
            title={`${info.lost ? (ndi ? 'It is not on the network (it plays again as soon as it is back)' : 'It was lost (it opens again when the device comes back)') : 'It could not open'} : ${info.error}. Click : try again`}
          >
            {info.lost ? 'lost' : "can't open"}
          </button>
        ) : (
          <span
            className="w-12 shrink-0 text-right font-mono text-[9px] text-muted"
            title="The channels the device delivers (most drivers give one or two; an interface often shows its inputs as several devices, one per pair)"
          >
            {info.channels ? `${info.channels} ch` : ndi ? 'connecting…' : 'opening…'}
          </span>
        )}
      </div>
      {!armed && (
        <p className="text-[10px] leading-tight text-muted">
          {ndi
            ? 'Not open : a session (or an undo) never opens an NDI source by itself. Open it here or in its row; picking a source opens it too.'
            : 'Not open : a session (or an undo) never opens a live input by itself. Open it here or in its row; picking an input opens it too.'}
        </p>
      )}
      {ndi && armed && <NdiAudioReadout slot={slot} />}
      <div className="flex items-center gap-2">
        <span className="w-10 shrink-0 font-mono text-[9px] uppercase text-muted">level</span>
        <Meter which={slot} className="min-w-[40px] flex-1" number />
        <span className="shrink-0 font-mono text-[9px] uppercase text-muted">vol</span>
        <AuSlider
          target={volTarget} min={0} max={2} value={s.volume}
          set={(v) => patchSlot(slot, { volume: v })}
          onDoubleClick={() => patchSlot(slot, { volume: 1 })}
          className="w-16 shrink-0"
          title={`Volume ${Math.round(s.volume * 100)} % (double-click : 100 %, as it comes in)`}
        />
        <span className="w-8 shrink-0 text-right font-mono text-[9px] tabular-nums text-muted">{Math.round(s.volume * 100)}</span>
        <AuModChip target={volTarget} open={volOpen} onToggle={() => setVolOpen(!volOpen)} what={`slot ${slot}'s volume`} />
      </div>
      {volOpen && <AuAssign target={volTarget} />}
      <PanRow slot={slot} pan={s.pan} />
    </div>
  )
}

// ── Modulation : the layer's volume and A/B mix, a slot's volume and pan (its
// transport's in the transport's own mod row) are mod targets (ModTarget kind
// 'au'), applied each frame on the audio engine, the stored value the base.
const AU_VOLUME: AuModTarget = { kind: 'au', field: 'volume' }
const AU_MIX: AuModTarget = { kind: 'au', field: 'mix' }

/** A slider a modulator can move : bound, it tints accent2, shows the live
 *  value (the shared liveOverlay loop) and a drag moves the base by as much as
 *  the thumb moves (useModSlide), as every modulated slider does. */
function AuSlider({ target, value, min, max, set, onDoubleClick, className, title }: {
  target: ModTarget; value: number; min: number; max: number; set: (v: number) => void
  onDoubleClick: () => void; className: string; title: string
}): JSX.Element {
  const ref = useRef<HTMLInputElement | null>(null)
  const key = modTargetKey(target)
  const bound = useBound(key).length > 0
  const slide = useModSlide(bound, value, min, max, set)
  useEffect(() => (bound && ref.current ? registerLiveOverlay({ el: ref.current, key, format: (x) => String(x) }) : undefined), [bound, key])
  return (
    <input
      ref={ref}
      type="range" min={min} max={max} step={0.01} value={value}
      {...slide}
      onDoubleClick={onDoubleClick}
      className={`${className} ${bound ? 'accent-accent2' : 'accent-accent'}`}
      title={bound ? `${title.replace(/\.$/, '')}. Modulated : a drag moves the base by as much as you move it.` : title}
    />
  )
}

/** The M chip beside a control : the modulators bound to it (M1·3), accent
 *  while bound, accent2 while its binding row is open. Right-click clears every
 *  modulation on it (the modulators and the Meta knobs). */
function AuModChip({ target, open, onToggle, what }: { target: ModTarget; open: boolean; onToggle: () => void; what: string }): JSX.Element {
  const key = modTargetKey(target)
  const bound = useBound(key)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const st = useStore.getState()
        for (const b of bound) st.removeAssignment(b.id)
        st.composition.metaKnobs.forEach((k, i) => {
          if (k.destinations.some((d) => modTargetKey(d) === key)) st.toggleMetaDest(i, target)
        })
      }}
      className={`shrink-0 rounded px-1 font-mono text-[9px] leading-4 transition-colors ${
        bound.length
          ? 'bg-accent/20 text-accent ring-1 ring-accent'
          : open
            ? 'bg-accent2/25 text-accent2 ring-1 ring-accent2'
            : 'bg-panel3/60 text-muted hover:text-text'
      }`}
      title={`Modulate ${what} : a modulator or a Macro knob moves it. Right-click clears its modulation.`}
    >
      M{bound.length ? bound.map((b) => b.mod + 1).join('·') : ''}
    </button>
  )
}

/** The binding row an M chip opens, under its control's row. */
function AuAssign({ target }: { target: ModTarget }): JSX.Element {
  const bound = useBound(modTargetKey(target))
  return (
    <div className="pb-0.5">
      <AssignRow target={target} bound={bound} />
    </div>
  )
}

/** An NDI slot's source : its name; click, another one (the NDI source list). */
function NdiSourceButton({ slot, name }: { slot: AudioSlotName; name: string }): JSX.Element {
  const setNdi = useStore((st) => st.setAudioLayerNdi)
  const [pick, setPick] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setPick(true)}
        className="input select-compact min-w-0 flex-1 truncate text-left text-[10px]"
        title={`${name} : its sound over the network. Click : another NDI® source`}
      >
        📶 {name || 'NDI source'}
      </button>
      {pick && createPortal(
        <NdiPicker onPick={(n) => { setPick(false); setNdi(slot, n) }} onCancel={() => setPick(false)} />,
        document.body
      )}
    </>
  )
}

/** What an NDI slot is receiving, live : connected or not, the jitter buffer
 *  (what it holds, its target) and the times it ran dry. */
function NdiAudioReadout({ slot }: { slot: AudioSlotName }): JSX.Element {
  const [st, setSt] = useState(() => audioLayer.ndiStats(slot))
  useEffect(() => {
    const tick = (): void => setSt(audioLayer.ndiStats(slot))
    tick()
    const t = setInterval(tick, 500)
    return () => clearInterval(t)
  }, [slot])
  const text = !st
    ? 'opening…'
    : !st.connected
      ? 'not connected : NDI looks for it on the network'
      : !st.channels
        ? 'connected : no sound from it yet'
        : `${st.channels} ch · buffer ${st.fillMs} / ${st.targetMs} ms${st.underruns ? ` · ran dry ${st.underruns}×` : ''}`
  return (
    <div
      className="font-mono text-[10px] text-muted"
      title="Received from the network : the source's channels, and the buffer that keeps its sound steady (what it holds now / what it aims at). It ran dry when this window was held up longer than the buffer; it then aims a little higher (up to 120 ms), and comes back down once all is steady."
    >
      📶 {text}
    </div>
  )
}
