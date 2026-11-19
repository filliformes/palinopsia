// Audio panel (Slab 1) : the ingest surface for the audiovisual-reactivity
// chapter. Enable, choose the source (Pandore-over-OSC / local Web Audio /
// both), pick a local device, and watch the live features. Assign audio to
// parameters via the `audio` modulator type in the Modulation panel.
//
// Meters read the audio bus directly each rAF (never through React) : same
// discipline as the modulator meters.

import { useEffect, useState, type ReactNode } from 'react'
import { audioBus, LAYER_INPUT } from '../engine/audioIn'
import { layerSounds } from '../audio/audioLayer'
import { EqCard, GlueCard } from './SonifyEq'
import { useStore } from '../store'
import { AudioOutputSelect } from './AudioOutputSelect'
import { SpaceOutLine } from './SpaceOutLine'
import { ChannelSelect, useOutputChannels } from '../audio/channelPick'
import { sonifyEngine } from '../audio/sonify'
import { AUDIO_BUFFERS, AUDIO_RATES, bufferLabel, rateLabel, type LatencyInfo } from '../audio/audioFormat'
import { BlockHead, FaderMeter, HearBlock, InputMeters, InputStatus, OutputMeters, usePolled } from './AudioMonitor'

const SOURCES: Array<{ id: 'both' | 'osc' | 'local'; label: string; title: string }> = [
  { id: 'both', label: 'Both', title: 'OSC (Pandore) primary, local input as fallback' },
  { id: 'osc', label: 'OSC', title: 'Audio features from Pandore over /opsia/audio/*' },
  { id: 'local', label: 'Local', title: 'Analyze a local mic / line / loopback input' }
]

export function AudioPanel(): JSX.Element {
  const enabled = useStore((s) => s.audioEnabled)
  const setEnabled = useStore((s) => s.setAudioEnabled)
  const source = useStore((s) => s.audioSource)
  const setSource = useStore((s) => s.setAudioSource)
  const deviceId = useStore((s) => s.audioDeviceId)
  const deviceLabel = useStore((s) => s.audioDeviceLabel)
  const setDeviceId = useStore((s) => s.setAudioDeviceId)
  const couplingOn = useStore((s) => s.couplingOn)
  const setCouplingOn = useStore((s) => s.setCouplingOn)
  // Output levels : the input monitor (passthrough) and the Sonify engine, each
  // independently on/off + level, so both can sound at once from this tab.
  const monitor = useStore((s) => s.audioMonitor)
  const setMonitor = useStore((s) => s.setAudioMonitor)
  const monitorLevel = useStore((s) => s.audioMonitorLevel)
  const setMonitorLevel = useStore((s) => s.setAudioMonitorLevel)
  const monitorSink = useStore((s) => s.audioMonitorSink)
  const setMonitorSink = useStore((s) => s.setAudioMonitorSink)
  const sonify = useStore((s) => s.sonify)
  const audioLayer = useStore((s) => s.audioLayer)
  const patchAudioLayer = useStore((s) => s.patchAudioLayer)
  // Sound going on in the app (Sonify, the Audio Layer) : the dot lights for it
  // too, the input analysis on or off, so it is clear something sounds.
  // (a live input not open yet sounds nothing)
  const layerSound = useStore((s) => layerSounds(s.audioLayer, s.audioLayerArmed) && !s.audioLayer.mute)
  const playing = [sonify.on ? 'Sonify' : '', layerSound ? 'Audio Layer' : ''].filter(Boolean)
  const setSonify = useStore((s) => s.setSonify)
  const denoise = useStore((s) => s.audioDenoise)
  const setDenoise = useStore((s) => s.setAudioDenoise)
  const notches = useStore((s) => s.audioDenoiseNotches)
  const setNotches = useStore((s) => s.setAudioDenoiseNotches)
  const [learning, setLearning] = useState(false)
  // the whole section folds to its header (kept, like the other sections)
  const collapsed = useStore((s) => !!s.collapsed['audio'])
  const toggleSection = useStore((s) => s.toggleSection)
  // The channels picked on each device (per computer)
  const inCh = useStore((s) => s.audioInCh)
  const setInCh = useStore((s) => s.setAudioInCh)
  const outCh = useStore((s) => s.soniOutCh)
  const setOutCh = useStore((s) => s.setSoniOutCh)
  const monCh = useStore((s) => s.audioMonitorCh)
  const setMonCh = useStore((s) => s.setAudioMonitorCh)
  const outN = useOutputChannels(sonify.sinkId ?? '')
  const monN = useOutputChannels(monitorSink)
  // what the engines know (the input's channels once it is open, Space on) :
  // read twice a second while the tab shows
  const inN = usePolled(() => audioBus.inChannels, 500)
  const spaceOn = usePolled(() => sonifyEngine.spaceOn, 500)
  // the engine's sample rate and buffer, and what the devices really give
  const fmt = useStore((s) => s.audioFormat)
  const setFmt = useStore((s) => s.setAudioFormat)
  const outLat = usePolled(() => latKey(sonifyEngine.latencyInfo()), 1000)
  const inLat = usePolled(() => latKey(audioBus.latencyInfo()), 1000)

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const showDevice = source === 'local' || source === 'both'
  // the input monitor needs a local device (the Audio Layer already plays)
  const fromLayer = deviceId === LAYER_INPUT
  const monitorReady = enabled && showDevice && !fromLayer

  // Enumerate input devices (labels populate once the input has been opened).
  useEffect(() => {
    if (!enabled || !showDevice) return
    let alive = true
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((ds) => {
        if (alive) setDevices(ds.filter((d) => d.kind === 'audioinput'))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [enabled, showDevice, deviceId])

  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-t border-border bg-panel px-3 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={() => toggleSection('audio')}
          className="-mr-1 shrink-0"
          title={collapsed ? 'Expand Audio' : 'Collapse Audio (it keeps listening and playing)'}
        >
          <span className={`inline-block font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>
        </button>
        <button
          onClick={() => setEnabled(!enabled)}
          className={`flex shrink-0 items-center gap-1.5`}
          title={`${playing.length ? `Sound is going on (${playing.join(', ')}). ` : ''}The input analysis is ${enabled ? 'on' : 'off'} : click to turn it ${enabled ? 'off' : 'on'} (it listens to an input for the audio modulators and the reactivity).`}
        >
          <span
            className={`h-2.5 w-2.5 rounded-full transition-colors ${enabled || playing.length ? 'bg-accent' : 'bg-panel3'}`}
          />
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted">Audio</span>
        </button>
        {playing.length > 0 && (
          <span
            className="min-w-0 truncate font-mono text-[9px] text-accent"
            title="What is sounding in the app now"
          >
            {playing.join(' · ')}
          </span>
        )}

        {enabled && (
          <>
            {/* source select */}
            <div className="flex shrink-0 overflow-hidden rounded border border-border">
              {SOURCES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSource(s.id)}
                  title={s.title}
                  className={`px-1.5 py-0.5 font-mono text-[9px] ${
                    source === s.id ? 'bg-accent/20 text-accent' : 'bg-panel2 text-muted'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* The coupling master switch rides line 1, pinned right : the
                same switch as the Mixer's (the coupling itself is set there). */}
            <div className="flex-1" />
            <button
              onClick={() => setCouplingOn(!couplingOn)}
              title={`A/B coupling ${couplingOn ? 'on' : 'paused'} : the sound pushing each layer's A/B mix (set per layer in the Mixer, M). Click to ${couplingOn ? 'pause it on every layer at once' : 'let it run again'}.`}
              className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] ${
                couplingOn ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel2 text-muted'
              }`}
            >
              ≈ coupling
            </button>
          </>
        )}
      </div>
      {!collapsed && (<>
      {/* Three blocks, read top to bottom : what comes IN (the device, its
          channels, one meter per channel heard, the status word), what the
          modulators HEAR (level, change, hit, the live spectrum and its six
          bands), and what goes OUT (the device, the faders each with its meter,
          then the output's own channels and the limiter). The meters and the
          spectrum : AudioMonitor.tsx (one rAF, drawn only while this shows). */}
      <div className="flex min-w-0 flex-col gap-1">
        <BlockHead label="Input" title="What comes in : the device the audio tab listens to, the channels it takes, and their levels">
          {enabled && showDevice ? (
            <>
              <select
                className="input select-compact min-w-0 flex-1 text-[10px]"
                value={deviceId ?? ''}
                onChange={(e) => {
                  const id = e.target.value || null
                  setDeviceId(id, id === LAYER_INPUT ? 'Audio Layer' : id ? devices.find((d) => d.deviceId === id)?.label || null : null)
                }}
                title="What the audio tab listens to : an input device, or the Audio Layer (its whole sound, both slots mixed after their volumes : the coupling and every audio modulator listening to the audio input react to it; no microphone is opened)"
              >
                <option value="">Default input</option>
                <option value={LAYER_INPUT}>Audio Layer (what it plays)</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Input ${d.deviceId.slice(0, 6)}`}
                  </option>
                ))}
                {/* The remembered device is not in the list : say so (the menu
                    read "Default input" while it listened to nothing). */}
                {deviceId && !fromLayer && devices.length > 0 && !devices.some((d) => d.deviceId === deviceId) && (
                  <option value={deviceId}>
                    {`${deviceLabel ?? 'The chosen input'} (not here : the default input plays)`}
                  </option>
                )}
              </select>
              {!fromLayer && (
                <ChannelSelect
                  n={inN || 2}
                  value={inCh}
                  onChange={setInCh}
                  title={`Which of the input's channels it listens to : a stereo pair, or one channel (mono, on both sides). The analysis, the monitor, learn noise and the Filter voice's line-in all take these. ${inN ? `The device gives ${inN} channel${inN === 1 ? '' : 's'}${inN <= 2 ? ' : an interface often shows its other inputs as devices of their own (pick the device), or gives them all only through its own driver' : ''}.` : 'Its channels show once it is open.'}`}
                />
              )}
            </>
          ) : (
            <span
              className="min-w-0 flex-1 truncate font-mono text-[9px] text-muted"
              title={!enabled ? 'The input analysis is off : click the dot beside AUDIO to listen.' : 'The features come from OSC (/opsia/audio/*), sent by an audio brain (Pandore) : no device is opened here.'}
            >
              {!enabled ? 'off : the dot by AUDIO listens' : 'OSC /opsia/audio/* : no device'}
            </span>
          )}
          <InputStatus />
        </BlockHead>
        {enabled && showDevice && <InputMeters />}
        {/* USB-noise denoiser : learn the noise, notch out the tonal peaks (on
            the input : the monitor and the analysis both take the cleaned sound). */}
        {enabled && showDevice && !fromLayer && (
          <div className="flex flex-wrap items-center gap-2 pl-[52px]">
            <button
              onClick={() => setDenoise(!denoise)}
              disabled={notches.length === 0}
              className="flex shrink-0 items-center gap-1.5"
              title={notches.length === 0 ? 'Learn the noise first' : 'Notch out the measured USB noise (ground hum + digital whine) from the input, on the sound you hear AND the reactivity'}
            >
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full transition-colors ${denoise && notches.length ? 'bg-accent' : 'bg-panel3'}`} />
              <span className="font-mono text-[10px] text-muted">USB denoise</span>
            </button>
            <button
              onClick={async () => {
                setLearning(true)
                const freqs = await audioBus.learnNoise()
                setNotches(freqs)
                if (freqs.length) setDenoise(true)
                setLearning(false)
              }}
              disabled={learning}
              className="shrink-0 rounded border border-accent/50 bg-accent/10 px-2 py-0.5 font-mono text-[9px] text-accent hover:bg-accent/20 disabled:opacity-40"
              title="Measure the noise for ~2s (the source connected but SILENT), then notch out the peaks it finds"
            >
              {learning ? 'learning…' : 'learn noise'}
            </button>
            {notches.length > 0 && (
              <span
                className="min-w-0 flex-1 truncate font-mono text-[9px] text-muted"
                title={`Notches at ${notches.map((n) => Math.round(n.f) + ' Hz').join(', ')}`}
              >
                {notches.length} notch{notches.length > 1 ? 'es' : ''} ·{' '}
                {Math.round(Math.min(...notches.map((n) => n.f)))}–{Math.round(Math.max(...notches.map((n) => n.f)))} Hz
              </span>
            )}
            {notches.length > 0 && (
              <button
                onClick={() => setNotches([])}
                className="shrink-0 font-mono text-[9px] text-muted hover:text-danger"
                title="Clear the learned notch profile"
              >
                clear
              </button>
            )}
          </div>
        )}
      </div>

      {enabled && (
        <div className="flex min-w-0 flex-col gap-1 border-t border-border/50 pt-1">
          <BlockHead top label="Heard" title="What the modulators hear : the features an audio modulator (Modulation, type audio) and the coupling follow, and the six bands a 'band' modulator reads">
            <div className="min-w-0 flex-1"><HearBlock /></div>
          </BlockHead>
        </div>
      )}

      {/* What goes out : Sonify's output device and channels, the three faders
          (each with its meter), then what leaves on the output's channels. */}
      <div className="flex min-w-0 flex-col gap-1 border-t border-border/50 pt-1">
        <BlockHead label="Output" title="What goes out : the device Sonify and the Audio Layer play to, their levels, and what leaves on its channels">
          <AudioOutputSelect
            className="input select-compact min-w-0 flex-1 text-[10px]"
            defaultLabel="Default output (Sonify)"
            value={sonify.sinkId}
            onChange={(id) => setSonify({ ...useStore.getState().sonify, sinkId: id })}
            title="Which output device Sonify and the Audio Layer play to (the same choice as on the Sonify page)"
          />
          <ChannelSelect
            n={outN}
            value={outCh}
            onChange={setOutCh}
            disabled={spaceOn}
            title={spaceOn
              ? 'Space is on : it places the voices on the channels itself (turn Space off to pick the channels here)'
              : `Which of the output's channels Sonify and the Audio Layer play on : a stereo pair, or one channel (the two sides summed). The device takes ${outN} channel${outN === 1 ? '' : 's'}. The films' and audio players' own sound stays on 1+2.`}
          />
        </BlockHead>
        {/* Space on : the mode, its channels, amber when some are dropped */}
        <div className="pl-[52px]"><SpaceOutLine variant="row" /></div>
        <LevelRow
          label="Sonify"
          on={sonify.on}
          onToggle={() => setSonify({ ...sonify, on: !sonify.on })}
          level={sonify.master}
          onLevel={(v) => setSonify({ ...sonify, master: v })}
          meter={<FaderMeter source="sonify" />}
          title="The Sonify engine's sound (image → sound). Build its voices on the Sonify page (S)."
        />
        <LevelRow
          label="Audio Layer"
          on={!audioLayer.mute}
          onToggle={() => patchAudioLayer({ mute: !audioLayer.mute })}
          level={audioLayer.volume}
          onLevel={(v) => patchAudioLayer({ volume: v })}
          max={2}
          reset={1}
          meter={<FaderMeter source="layer" />}
          title="The Audio Layer's volume and mute : the same as its strip in the layers tab (under L4), to 200 % (double-click : 100 %)."
        />
        <LevelRow
          label="Monitor"
          on={monitor}
          onToggle={() => setMonitor(!monitor)}
          level={monitorLevel}
          onLevel={setMonitorLevel}
          disabled={!monitorReady}
          meter={<FaderMeter source="monitor" />}
          title={
            monitorReady
              ? 'Hear the input through an output (passthrough) while it also drives the reactivity (e.g. monitor a Move on the interface inputs). It plays on its own output, picked under it.'
              : fromLayer && enabled
                ? 'The input is the Audio Layer, which already plays through Sonify\'s output : nothing to monitor.'
                : 'Turn Audio on with a Local (or Both) source first.'
          }
        />
        {monitor && monitorReady && (
          <label className="flex items-center gap-2 pl-[52px] font-mono text-[9px] text-muted">
            <span className="shrink-0">monitor to</span>
            <AudioOutputSelect
              value={monitorSink}
              onChange={setMonitorSink}
              title="Which output device the input monitor plays to (Sonify has its own, above)"
            />
            <ChannelSelect
              n={monN}
              value={monCh}
              onChange={setMonCh}
              title={`Which of the output's channels the monitor plays on : a stereo pair, or one channel (the two sides summed). The device takes ${monN} channel${monN === 1 ? '' : 's'}.`}
            />
          </label>
        )}
        <div className="mt-0.5 border-t border-border/30 pt-1">
          <OutputMeters pick={outCh} n={outN} />
        </div>
        {/* The engine's sample rate and buffer (both audio contexts take them; a
            change starts the sound over), and what the devices really give. */}
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
          <span className="w-[46px] shrink-0 text-right font-mono text-[9px] uppercase text-muted" title="The audio engine's sample rate and buffer, on this computer">latency</span>
          <select
            className="input select-compact min-w-0 flex-1 text-[10px]"
            value={fmt.rate}
            onChange={(e) => setFmt({ ...fmt, rate: Number(e.target.value) })}
            title="The sample rate the audio runs at (Sonify, the Audio Layer, a recording's sound, the input and its monitor). The device's rate is the safest; another one is converted on the way, which adds a little latency. A change starts the sound over (after the take, while one records)."
          >
            {AUDIO_RATES.map((r) => (
              <option key={r} value={r}>{rateLabel(r)}</option>
            ))}
          </select>
          <select
            className="input select-compact min-w-0 flex-1 text-[10px]"
            value={fmt.frames}
            onChange={(e) => setFmt({ ...fmt, frames: Number(e.target.value) })}
            title="The buffer asked of the device, in samples : smaller is quicker, larger rides out a busy computer without clicks. Auto asks for the lowest. The system has the last word (Windows often holds 10 ms at the least) : the line under it says what you really get."
          >
            {AUDIO_BUFFERS.map((b) => (
              <option key={b} value={b}>{bufferLabel(b)}</option>
            ))}
          </select>
        </div>
        <p
          className="pl-[52px] font-mono text-[9px] leading-tight text-muted"
          title="What the devices really give : the sample rate, the engine's buffer, and the output's own latency (the device and the system, when the browser knows it). Sonify's line is shown once its sound has started; the input's once it is open."
        >
          {outLat ? `out ${outLat}` : 'out : not running'}
          {inLat ? ` · in ${inLat}` : ''}
        </p>
      </div>

      {/* The output stage : the EQ and the glue shape everything that leaves
          (Sonify and the Audio Layer), on the way to the speakers. */}
      <div className="mt-0.5 flex flex-col gap-1.5 border-t border-border/50 pt-1">
        <div className="font-mono text-[9px] uppercase tracking-wide text-muted">Output EQ &amp; glue</div>
        <EqCard />
        <GlueCard />
      </div>
      </>)}
    </div>
  )
}

/** A latency for the line under the menus : "48 kHz · 10.0 + 12.0 ms". */
function latKey(l: LatencyInfo | null): string {
  if (!l) return ''
  return `${(l.rate / 1000).toFixed(l.rate % 1000 ? 1 : 0)} kHz · ${l.baseMs.toFixed(1)}${l.outMs ? ` + ${l.outMs.toFixed(1)}` : ''} ms`
}

// One on/off + level fader (Sonify · Audio Layer · input monitor), its meter at
// the end. `max` : the fader's top (the Audio Layer's volume runs to 200 %).
function LevelRow({
  label, on, onToggle, level, onLevel, disabled, title, max = 1, reset, meter
}: {
  label: string
  on: boolean
  onToggle: () => void
  level: number
  onLevel: (v: number) => void
  disabled?: boolean
  title?: string
  max?: number
  reset?: number
  meter?: ReactNode
}): JSX.Element {
  return (
    <div className={`flex items-center gap-2 ${disabled ? 'opacity-50' : ''}`} title={title}>
      <button onClick={onToggle} disabled={disabled} className="flex w-[98px] shrink-0 items-center gap-1.5">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full transition-colors ${on && !disabled ? 'bg-accent' : 'bg-panel3'}`} />
        <span className="font-mono text-[10px] text-muted">{label}</span>
      </button>
      <input
        type="range" min={0} max={max} step={0.01} value={level}
        onChange={(e) => onLevel(Number(e.target.value))}
        onDoubleClick={reset !== undefined ? () => onLevel(reset) : undefined}
        disabled={disabled}
        className="min-w-0 flex-1"
      />
      <span className="w-7 shrink-0 text-right font-mono text-[9px] text-muted">{Math.round(level * 100)}</span>
      {meter}
    </div>
  )
}
