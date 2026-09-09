// Sonify (key S) : the image-to-sound page. Full-page takeover like Output —
// the live composite mirrored large with the sound PROBES drawn on it (the
// Spectra scan line, the Orbit ellipse, the Flow motion dots), because the
// probe is the instrument. Three voice strips (Spectra · Orbit · Flow) +
// master with an always-on limiter, a global note quantizer (root + scale,
// per-voice snap), two image taps (master or any layer), and an output-device
// picker. The sound engine lives in audio/sonify.ts (AudioWorklet).

import { isValidElement, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import type { ModTarget, SonifyModParam } from '@shared/types'
import { registerLiveOverlay } from './liveOverlay'
import { randomSonify, randomizeVoice, suggestSonify, type SoniVoiceKey } from '../audio/autoSonify'
import { defaultSoniConfig, SONI_SCALES, sonifyEngine, type SoniConfig } from '../audio/sonify'
import { deleteSoniPreset, listSoniPresets, loadSoniPreset, saveSoniPreset } from '../audio/soniPresets'
import { modTargetKey, useStore } from '../store'
import { MidiLearnOverlay } from './MidiLearnOverlay'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
// Voice order matches the worklet's render/filter order (mixFilter indices).
const VOICE_KEYS = ['spectra', 'orbit', 'flow', 'events', 'raster', 'sstv', 'filter', 'chord'] as const
const VOICE_NAMES = ['Spectra', 'Orbit', 'Flow', 'Events', 'Raster', 'Transmission', 'Filter', 'Chord']
// Each voice's mark on the mirror, as a coloured GLYPH that hints its SHAPE as
// well as its hue (matches the overlay painter below) — so a strip tells you
// which mark is yours even when two share a colour (Spectra's line vs Flow's
// dots are both white). Chord reads horizontal bands, not a spatial probe.
const PROBE_MARK: Record<string, { glyph: string; color: string; hint: string }> = {
  Spectra: { glyph: '─', color: 'rgb(255,255,255)', hint: 'a white scan line' },
  Orbit: { glyph: '○', color: 'rgb(255,180,80)', hint: 'an orange ellipse' },
  Flow: { glyph: '∴', color: 'rgb(255,255,255)', hint: 'white grain dots' },
  Events: { glyph: '◌', color: 'rgb(255,210,120)', hint: 'amber note rings' },
  Raster: { glyph: '▭', color: 'rgb(120,255,160)', hint: 'a green probe rect' },
  Transmission: { glyph: '─', color: 'rgb(255,120,200)', hint: 'a pink scan row' },
  Filter: { glyph: '─', color: 'rgb(120,200,255)', hint: 'a blue scan line' },
  Chord: { glyph: '≡', color: 'rgb(160,160,175)', hint: 'horizontal bands — no spatial probe' }
}
const filterTag = (x: number): string => (x < 0.49 ? 'LP' : x > 0.51 ? 'HP' : '—')

const TAU = 6.283185307179586
/** Breathing rubato warp of a linear sweep phase (mirror of the worklet's warpPace). */
function warpPace(lin: number, pace: number): number {
  return pace < 0.005 ? lin : lin - (pace * Math.sin(lin * TAU)) / TAU
}
/** Paint the reading path of a scanning voice at (paced) sweep phase `pos`. */
function drawScanPath(g: CanvasRenderingContext2D, path: number, pos: number, w: number, h: number): void {
  g.beginPath()
  if (path === 1) { g.moveTo(0, pos * h); g.lineTo(w, pos * h) } // vertical row
  else if (path === 2) { // radial ray from centre
    const a = pos * TAU
    g.moveTo(0.5 * w, 0.5 * h)
    g.lineTo((0.5 + 0.48 * Math.cos(a)) * w, (0.5 + 0.48 * Math.sin(a)) * h)
  } else if (path === 3) { // spiral arm
    for (let k = 0; k <= 48; k++) {
      const pp = k / 48, a = pos * TAU + pp * TAU * 2.5, r = pp * 0.48
      const px = (0.5 + r * Math.cos(a)) * w, py = (0.5 + r * Math.sin(a)) * h
      if (k === 0) g.moveTo(px, py); else g.lineTo(px, py)
    }
  } else { g.moveTo(pos * w, 0); g.lineTo(pos * w, h) } // horizontal column
  g.stroke()
}

function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="w-14 shrink-0 font-mono text-[9px] uppercase text-muted">{label}</span>
      {children}
    </div>
  )
}

function Slider({
  label, value, min, max, step = 0.01, neutral, fmt, onChange, title, mod
}: {
  label: string; value: number; min: number; max: number; step?: number
  neutral?: number; fmt?: (v: number) => string; onChange: (v: number) => void; title?: string
  mod?: ReactNode
}): JSX.Element {
  // The `mod` node (when present) is a <ModChip param=… inactive=…/>, so read its
  // param straight off the element : no call-site needs to repeat it. A slider
  // whose param has a live mod assignment turns accent2 + its thumb tracks the
  // modulator's live value (via the shared liveOverlay rAF), exactly like the
  // Inspector's modulated controls.
  const modProps = isValidElement(mod) ? (mod.props as { param?: SonifyModParam; inactive?: boolean }) : null
  const modParam = modProps?.param
  const modInactive = !!modProps?.inactive
  const modulated = useStore((st) =>
    modParam ? st.composition.modMatrix.some((a) => a.target.kind === 'sonify' && a.target.param === modParam) : false
  )
  const live = modulated && !modInactive
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!live || !modParam || !ref.current) return
    return registerLiveOverlay({ el: ref.current, key: modTargetKey({ kind: 'sonify', param: modParam }), format: (x) => String(x) })
  }, [live, modParam])
  return (
    <Row label={label}>
      <input
        ref={ref}
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => neutral !== undefined && onChange(neutral)}
        className={`min-w-0 flex-1 ${live ? 'accent-accent2' : 'accent-accent'}`}
        title={title ?? `${label} ${fmt ? fmt(value) : value.toFixed(2)}${live ? ' : modulated (drag sets the base)' : ''}`}
      />
      <span className={`w-12 shrink-0 text-right font-mono text-[9px] ${live ? 'text-accent2' : 'text-muted'}`}>
        {fmt ? fmt(value) : value.toFixed(2)}
      </span>
      {mod}
    </Row>
  )
}

function TapSelect({ cfg, voice, onChange }: {
  cfg: SoniConfig; voice: { tap: number }; onChange: (tap: number) => void
}): JSX.Element {
  const name = (t: number): string => {
    const tp = cfg.taps[t]
    return tp.kind === 'master' ? 'master' : `layer ${tp.layer + 1}`
  }
  return (
    <Row label="listen">
      <select
        className="input select-compact min-w-0 flex-1 text-[10px]"
        value={voice.tap}
        onChange={(e) => onChange(Number(e.target.value))}
        title="Which image tap this voice sonifies (taps are configured below the mirror)"
      >
        <option value={0}>tap A · {name(0)}</option>
        <option value={1}>tap B · {name(1)}</option>
      </select>
    </Row>
  )
}

/** M-binding chip for a sonify probe/pitch param : shows the bound modulator
 *  (M1..M8) or a hollow M; click opens the mini assign panel below. */
function ModChip({ param, open, onOpen, inactive = false }: {
  param: SonifyModParam; open: boolean; onOpen: (p: SonifyModParam) => void; inactive?: boolean
}): JSX.Element {
  const matrix = useStore((st) => st.composition.modMatrix)
  const key = modTargetKey({ kind: 'sonify', param })
  const a = matrix.find((x) => modTargetKey(x.target) === key)
  return (
    <button
      onClick={() => { if (!inactive) onOpen(param) }}
      disabled={inactive}
      className={`shrink-0 rounded px-1 py-0.5 font-mono text-[9px] transition-colors ${
        inactive
          ? 'bg-panel3/30 text-muted/40 cursor-default'
          : a ? 'bg-accent/25 text-accent ring-1 ring-accent' : open ? 'bg-panel3 text-text ring-1 ring-border' : 'bg-panel3/60 text-muted hover:text-text'
      }`}
      title={inactive ? 'Inactive while sweeping — the scan column is driven by the sweep, not this bind' : a ? `Modulated by M${a.mod + 1} (depth ${a.depth.toFixed(2)}) : click to edit` : 'Bind a modulator to this parameter'}
    >
      {a ? `M${a.mod + 1}` : 'M'}
    </button>
  )
}

const PARAM_LABELS: Record<SonifyModParam, string> = {
  spectraX: 'Spectra scan column', filterX: 'Filter scan column',
  orbitX: 'Orbit centre x', orbitY: 'Orbit centre y', orbitR: 'Orbit radius', orbitPitch: 'Orbit pitch',
  rasterX: 'Raster rect x', rasterY: 'Raster rect y', rasterW: 'Raster rect width', rasterH: 'Raster rect height',
  rasterPitch: 'Raster pitch',
  spectraGain: 'Spectra gain', spectraGamma: 'Spectra contrast', spectraSweep: 'Spectra sweep rate', spectraBreath: 'Spectra breath',
  orbitDrive: 'Orbit drive', orbitSmooth: 'Orbit smooth',
  flowDur: 'Flow grain', flowColour: 'Flow colour',
  eventsDecay: 'Events decay',
  rasterSmooth: 'Raster smooth', rasterTone: 'Raster tone',
  sstvLine: 'SSTV line rate', sstvDev: 'SSTV transpose',
  filterQ: 'Filter resonance', filterSweep: 'Filter sweep rate',
  chordTone: 'Chord tone', chordSpread: 'Chord spread', chordAttack: 'Chord swell',
  fxSend: 'FX send', fxReverb: 'FX reverb mix', fxDelay: 'FX delay mix'
}

/** Mini assign panel : modulator select + depth + mode + clear, writing the
 *  same mod-matrix the Inspector's M buttons use. */
function AssignMini({ param, onClose }: { param: SonifyModParam; onClose: () => void }): JSX.Element {
  const matrix = useStore((st) => st.composition.modMatrix)
  const assignMod = useStore((st) => st.assignMod)
  const removeAssignment = useStore((st) => st.removeAssignment)
  const setAssignmentDepth = useStore((st) => st.setAssignmentDepth)
  const setAssignmentMode = useStore((st) => st.setAssignmentMode)
  const target: ModTarget = { kind: 'sonify', param }
  const key = modTargetKey(target)
  const a = matrix.find((x) => modTargetKey(x.target) === key)
  return (
    <section className="rounded border border-accent/40 bg-panel2 px-2 py-1.5">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[10px] font-semibold">modulate</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-muted">{PARAM_LABELS[param]}</span>
        <button onClick={onClose} className="text-[11px] text-muted hover:text-text" title="Close">x</button>
      </div>
      <div className="flex items-center gap-1.5">
        <select
          className="input select-compact text-[10px]"
          value={a ? a.mod : -1}
          onChange={(e) => {
            const mi = Number(e.target.value)
            if (a) removeAssignment(a.id)
            if (mi >= 0 && !assignMod(mi, target, a?.depth ?? 0.5, a?.mode ?? 'replace')) {
              // matrix cap reached : nothing to do, the select snaps back
            }
          }}
          title="Which modulator drives this parameter"
        >
          <option value={-1}>off</option>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((m) => <option key={m} value={m}>M{m + 1}</option>)}
        </select>
        <input
          type="range" min={-1} max={1} step={0.01} value={a?.depth ?? 0.5}
          disabled={!a}
          onChange={(e) => a && setAssignmentDepth(a.id, Number(e.target.value))}
          className="min-w-0 flex-1 accent-accent"
          title={`Depth ${(a?.depth ?? 0.5).toFixed(2)} (negative inverts)`}
        />
        <button
          disabled={!a}
          onClick={() => a && setAssignmentMode(a.id, a.mode === 'multiply' ? 'replace' : 'multiply')}
          className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${a?.mode === 'multiply' ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
          title="Replace = swing around the base value; Multiply = VCA-scale it"
        >{a?.mode === 'multiply' ? 'mult' : 'swing'}</button>
      </div>
    </section>
  )
}

function VoiceShell({ title, on, hint, onToggle, onDice, children }: {
  title: string; on: boolean; hint: string; onToggle: () => void; onDice?: () => void; children: ReactNode
}): JSX.Element {
  return (
    <section className={`rounded border px-2 py-1.5 transition-colors ${on ? 'border-accent/40 bg-panel2' : 'border-border bg-panel2/40'}`}>
      <div className="mb-1 flex items-center gap-2">
        <button
          onClick={onToggle}
          className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
            on ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted hover:text-text'
          }`}
          title={on ? 'on' : 'off'}
        >
          {on ? '● on' : '○ off'}
        </button>
        {PROBE_MARK[title] && (
          <span
            className="w-3 shrink-0 text-center font-mono text-[11px] leading-none"
            style={{ color: PROBE_MARK[title].color }}
            title={`On the mirror this voice is ${PROBE_MARK[title].hint}`}
          >
            {PROBE_MARK[title].glyph}
          </span>
        )}
        <span className="text-[11px] font-semibold">{title}</span>
        {/* hover-info : the mode's description as a tooltip (was inline text) */}
        <span className="cursor-help rounded-full text-[10px] text-muted/70 hover:text-accent" title={hint}>ⓘ</span>
        <span className="min-w-0 flex-1" />
        {onDice && (
          <button
            onClick={onDice}
            className="rounded px-1 py-0.5 text-[11px] leading-none text-muted transition-colors hover:text-accent"
            title={`Randomize ${title}`}
          >
            🎲
          </button>
        )}
      </div>
      {on && <div className="flex flex-col gap-1">{children}</div>}
    </section>
  )
}

/** The Sonify step sequencer (Mixer page). Each step either loads a whole saved
 *  preset or, with no preset, just sets which voices are on — one transport
 *  advances them so a fully evolving sonified work can be built. */
function SonifySequencer(): JSX.Element {
  const sq = useStore((s) => s.soniSeq)
  const setOn = useStore((s) => s.setSoniSeqOn)
  const setStepMs = useStore((s) => s.setSoniSeqStepMs)
  const setLen = useStore((s) => s.setSoniSeqLen)
  const toggleVoice = useStore((s) => s.toggleSoniSeqVoice)
  const setStepPreset = useStore((s) => s.setSoniSeqStepPreset)
  const clearStep = useStore((s) => s.clearSoniSeqStep)
  const setMode = useStore((s) => s.setSoniSeqMode)
  const setBounceDecay = useStore((s) => s.setSoniSeqBounceDecay)
  const setBias = useStore((s) => s.setSoniSeqBias)
  const setEdge = useStore((s) => s.setSoniSeqEdge)
  const randomize = useStore((s) => s.randomizeSoniSeq)
  const reset = useStore((s) => s.resetSoniSeq)
  const presets = listSoniPresets()
  const R = 6000 / 80 // rate slider spans 80ms … 6s, log-mapped for feel
  const msToT = (ms: number): number => Math.max(0, Math.min(1, Math.log(ms / 80) / Math.log(R)))
  const fmtMs = (ms: number): string => (ms >= 1000 ? (ms / 1000).toFixed(ms >= 3000 ? 1 : 2) + 's' : Math.round(ms) + 'ms')
  return (
    <div className="mt-1 flex flex-col gap-1 rounded border border-accent2/40 bg-panel2/40 px-1.5 py-1">
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[8px] uppercase tracking-wide text-muted/70">sequencer</span>
        <span className="relative flex shrink-0">
          <MidiLearnOverlay id="fire:soniseq" />
          <button
            onClick={() => setOn(!sq.on)}
            className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${sq.on ? 'bg-accent/25 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted hover:text-text'}`}
            title="Play / stop the Sonify step sequence"
          >{sq.on ? '■ stop' : '▶ play'}</button>
        </span>
        <button
          onClick={randomize}
          className="rounded px-1 py-0.5 text-[11px] leading-none text-muted transition-colors hover:text-accent"
          title="Randomize the step pattern (1–3 voices per step; keeps presets)"
        >🎲</button>
        <button
          onClick={reset}
          className="rounded px-1 py-0.5 text-[12px] leading-none text-muted transition-colors hover:text-accent"
          title="Reset the sequencer to defaults (clears steps, mode + rate)"
        >↺</button>
        <span className="ml-auto font-mono text-[8px] text-muted">steps</span>
        <button onClick={() => setLen(sq.len - 1)} className="rounded bg-panel3/60 px-1 text-[10px] text-muted hover:text-text" title="Fewer steps">−</button>
        <span className="w-4 text-center font-mono text-[9px]">{sq.len}</span>
        <button onClick={() => setLen(sq.len + 1)} className="rounded bg-panel3/60 px-1 text-[10px] text-muted hover:text-text" title="More steps">+</button>
      </div>
      <div className="flex items-center gap-1">
        <span className="font-mono text-[8px] text-muted">rate</span>
        <input
          type="range" min={0} max={1} step={0.005} value={msToT(sq.stepMs)}
          onChange={(e) => setStepMs(Math.round(80 * Math.pow(R, Number(e.target.value))))}
          className="min-w-0 flex-1 accent-accent2" title={`${fmtMs(sq.stepMs)} per step`}
        />
        <span className="w-10 shrink-0 text-right font-mono text-[8px] text-muted">{fmtMs(sq.stepMs)}</span>
      </div>
      {/* Advance mode (dataFLOU's) : forward · bounce (accelerating rhythm) · drift (random walk). */}
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-mono text-[8px] text-muted">mode</span>
        {(['forward', 'bounce', 'drift'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded px-1.5 py-0.5 font-mono text-[8px] ${sq.mode === m ? 'bg-accent/25 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted hover:text-text'}`}
            title={m === 'forward' ? 'Play the steps in order, looping' : m === 'bounce' ? 'Forward order, but each cycle accelerates like a bouncing ball settling' : 'A biased random walk across the steps (bias + wrap/reflect below)'}
          >{m}</button>
        ))}
        {sq.mode === 'bounce' && (
          <>
            <span className="ml-1 font-mono text-[8px] text-muted">decay</span>
            <input
              type="range" min={0} max={100} step={1} value={sq.bounceDecay}
              onChange={(e) => setBounceDecay(Number(e.target.value))}
              className="min-w-0 flex-1 accent-accent2" title={`Bounce decay ${sq.bounceDecay}% : higher = sharper acceleration (the cycle still lasts the same total time)`}
            />
            <span className="w-6 shrink-0 text-right font-mono text-[8px] text-muted">{sq.bounceDecay}</span>
          </>
        )}
        {sq.mode === 'drift' && (
          <>
            <span className="ml-1 font-mono text-[8px] text-muted">bias</span>
            <input
              type="range" min={-100} max={100} step={1} value={sq.bias}
              onChange={(e) => setBias(Number(e.target.value))}
              className="min-w-0 flex-1 accent-accent2" title={`Drift bias ${sq.bias} : − walks backward, + walks forward, 0 = even wander`}
            />
            <span className="w-7 shrink-0 text-right font-mono text-[8px] text-muted">{sq.bias > 0 ? '+' + sq.bias : sq.bias}</span>
            <button
              onClick={() => setEdge(sq.edge === 'wrap' ? 'reflect' : 'wrap')}
              className="shrink-0 rounded bg-panel3/60 px-1 py-0.5 font-mono text-[8px] text-muted hover:text-text"
              title="At the ends : wrap (loop around) or reflect (bounce back inward)"
            >{sq.edge}</button>
          </>
        )}
      </div>
      <div className="flex items-center gap-0.5">
        <span className="w-4 shrink-0" />
        {VOICE_NAMES.map((n, i) => (
          <span key={i} className="w-3.5 shrink-0 text-center font-mono text-[7px] text-muted/70" title={n}>{n[0]}</span>
        ))}
        <span className="ml-1 flex-1 truncate font-mono text-[7px] text-muted/70">preset (loads the whole sound)</span>
      </div>
      <div className="flex flex-col gap-0.5">
        {Array.from({ length: sq.len }).map((_, s) => {
          const step = sq.steps[s]
          const isCur = sq.on && sq.cur === s
          const hasPreset = !!step.preset
          return (
            <div key={s} className={`flex items-center gap-0.5 rounded px-0.5 ${isCur ? 'bg-accent/20 ring-1 ring-accent' : ''}`}>
              <span className="w-4 shrink-0 text-center font-mono text-[8px] text-muted">{s + 1}</span>
              {VOICE_NAMES.map((vn, vi) => (
                <button
                  key={vi} disabled={hasPreset} onClick={() => toggleVoice(s, vi)}
                  className={`h-3.5 w-3.5 shrink-0 rounded-sm transition-colors ${hasPreset ? 'cursor-default bg-panel3/25' : step.voices[vi] ? 'bg-accent' : 'bg-panel3/70 hover:bg-panel3'}`}
                  title={hasPreset ? 'preset step : voices come from the preset' : `${vn} ${step.voices[vi] ? 'on' : 'off'} at step ${s + 1}`}
                />
              ))}
              <select
                className="input select-compact ml-1 min-w-0 flex-1 text-[9px]" value={step.preset}
                onChange={(e) => setStepPreset(s, e.target.value)}
                title="Load a full Sonify preset when this step plays (overrides the voice toggles)"
              >
                <option value="">— voices —</option>
                {presets.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <button onClick={() => clearStep(s)} className="shrink-0 px-0.5 text-[10px] leading-none text-muted/50 hover:text-danger" title="Clear this step">×</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function SonifyPage({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null> }): JSX.Element {
  const setOpen = useStore((s) => s.setSonifyPageOpen)
  const cfg = useStore((s) => s.sonify)
  const setSonify = useStore((s) => s.setSonify)
  const bpm = useStore((s) => s.composition.bpm)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const mirrorRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLCanvasElement | null>(null)
  const meterRef = useRef<HTMLDivElement | null>(null)
  const dragging = useRef<'line' | 'orbit' | 'radius' | 'rect' | 'rectsize' | 'fline' | null>(null)
  const [devices, setDevices] = useState<Array<{ id: string; label: string }>>([])
  const [assign, setAssign] = useState<SonifyModParam | null>(null)
  const chip = (p: SonifyModParam, inactive = false): JSX.Element => (
    <ModChip param={p} open={assign === p} onOpen={(x) => setAssign(assign === x ? null : x)} inactive={inactive} />
  )

  const set = (next: SoniConfig): void => setSonify(next)
  const patch = (p: Partial<SoniConfig>): void => set({ ...cfg, ...p })
  const [view, setView] = useState<'voices' | 'mixer'>('voices')
  // The voice/mixer column is drag-resizable (persisted), like the Sequence page.
  const [voiceW, setVoiceW] = useState(() => {
    const v = Number(localStorage.getItem('opsia.soniVoiceW'))
    return v >= 240 && v <= 640 ? v : 320
  })
  const [presetList, setPresetList] = useState<string[]>(() => listSoniPresets())
  const [presetName, setPresetName] = useState('')
  // While the Sonify page is open, M toggles ITS Voices↔Mixer view. Capture phase
  // + stopPropagation so it beats (and suppresses) App's window M handler, which
  // would otherwise toggle the right-panel mixer underneath.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== 'm') return
      const el = e.target as HTMLElement | null
      if (
        el &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      )
        return
      e.preventDefault()
      e.stopPropagation()
      setView((v) => (v === 'mixer' ? 'voices' : 'mixer'))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  const diceWhole = (): void => setSonify({ ...randomSonify(cfg), on: cfg.on, sinkId: cfg.sinkId })
  const resetDefault = (): void => setSonify({ ...defaultSoniConfig(), on: cfg.on, sinkId: cfg.sinkId })
  const diceVoice = (k: SoniVoiceKey): void => setSonify(randomizeVoice(cfg, k))
  const savePreset = (): void => {
    const n = presetName.trim()
    if (!n) return
    saveSoniPreset(n, cfg)
    setPresetList(listSoniPresets())
  }
  const loadPreset = (n: string): void => {
    const c = n ? loadSoniPreset(n) : null
    if (c) setSonify({ ...c, on: cfg.on, sinkId: cfg.sinkId })
    setPresetName(n)
  }
  const delPreset = (n: string): void => {
    if (!n) return
    deleteSoniPreset(n)
    setPresetList(listSoniPresets())
    if (presetName === n) setPresetName('')
  }
  const setMixFilter = (i: number, v: number): void => {
    const mf = [...(cfg.mixFilter ?? [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5])]
    mf[i] = v
    patch({ mixFilter: mf })
  }
  const pv = <K extends 'spectra' | 'orbit' | 'flow' | 'events' | 'raster' | 'sstv' | 'filter' | 'chord'>(k: K, p: Partial<SoniConfig[K]>): void =>
    set({ ...cfg, [k]: { ...cfg[k], ...p } })
  const pfx = (p: Partial<SoniConfig['fx']>): void => set({ ...cfg, fx: { ...cfg.fx, ...p } })

  // Live mirror of the composite (same pattern as the Output page).
  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    let stream: MediaStream | null = null
    try {
      stream = canvas.captureStream(30)
      video.srcObject = stream
      void video.play().catch(() => {})
    } catch { /* mirror is optional */ }
    return () => {
      stream?.getTracks().forEach((t) => t.stop())
      if (video) video.srcObject = null
    }
  }, [canvasRef])

  // Output devices for the sink picker.
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices?.().then((ds) => {
      setDevices(
        ds.filter((d) => d.kind === 'audiooutput')
          .map((d, i) => ({ id: d.deviceId, label: d.label || `output ${i + 1}` }))
      )
    }).catch(() => {})
  }, [])

  // Overlay painter : flow dots + live sweep line + meter, straight from the
  // engine each rAF (no React re-renders).
  useEffect(() => {
    let raf = 0
    let sweepPhase = cfg.spectra.x
    let fSweep = cfg.filter.x
    let tvRow = 0
    let last = performance.now()
    const paint = (): void => {
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      const c = overlayRef.current
      const st = useStore.getState().sonify
      const lp = sonifyEngine.isRunning() ? sonifyEngine.liveProbes : ({} as Record<string, number>)
      if (c) {
        const w = c.width, h = c.height
        const g = c.getContext('2d')!
        g.clearRect(0, 0, w, h)
        // Flow dots
        if (st.on && st.flow.on) {
          const dots = sonifyEngine.flowDots
          g.fillStyle = 'rgba(255,255,255,0.75)'
          for (let i = 0; i + 2 < dots.length; i += 3) {
            const r = 2 + dots[i + 2] * 6
            g.beginPath()
            g.arc(dots[i] * w, dots[i + 1] * h, r, 0, 6.2832)
            g.fill()
          }
        }
        // Event onsets : a ring at each note the picture just plucked
        if (st.on && st.events.on) {
          const dots = sonifyEngine.eventDots
          g.strokeStyle = 'rgba(255,210,120,0.9)'
          g.lineWidth = 1.5
          for (let i = 0; i + 2 < dots.length; i += 3) {
            const r = 3 + dots[i + 2] * 9
            g.beginPath()
            g.arc(dots[i] * w, dots[i + 1] * h, r, 0, 6.2832)
            g.stroke()
          }
        }
        // Spectra reading path (mirror of the worklet : same rate, pace + path)
        if (st.on && st.spectra.on) {
          if (st.spectra.sweepOn) sweepPhase = (sweepPhase + st.spectra.sweepHz * dt) % 1
          else sweepPhase = lp.spectraX ?? st.spectra.x
          const pos = st.spectra.sweepOn ? warpPace(sweepPhase, st.spectra.pace ?? 0) : sweepPhase
          g.strokeStyle = 'rgba(255,255,255,0.85)'
          g.lineWidth = 1.5
          drawScanPath(g, st.spectra.path ?? 0, pos, w, h)
        }
        // Filter reading path (its own hue, mirrors the filter sweep)
        if (st.on && st.filter.on) {
          if (st.filter.sweepOn) fSweep = (fSweep + st.filter.sweepHz * dt) % 1
          else fSweep = lp.filterX ?? st.filter.x
          const pos = st.filter.sweepOn ? warpPace(fSweep, st.filter.pace ?? 0) : fSweep
          g.strokeStyle = 'rgba(120,200,255,0.8)'
          g.lineWidth = 1.5
          drawScanPath(g, st.filter.path ?? 0, pos, w, h)
        }
        // Raster probe rect
        if (st.on && st.raster.on) {
          g.strokeStyle = 'rgba(120,255,160,0.85)'
          g.lineWidth = 1.5
          const rx = lp.rasterX ?? st.raster.rx, ry = lp.rasterY ?? st.raster.ry
          const rw = lp.rasterW ?? st.raster.rw, rh = lp.rasterH ?? st.raster.rh
          g.strokeRect(rx * w, ry * h, rw * w, rh * h)
          g.fillStyle = 'rgba(120,255,160,0.85)'
          g.fillRect((rx + rw) * w - 4, (ry + rh) * h - 4, 8, 8)
        }
        // Transmission scan row (animates downward at the line rate)
        if (st.on && st.sstv.on) {
          tvRow = (tvRow + st.sstv.lineHz * dt / 96) % 1
          g.strokeStyle = 'rgba(255,120,200,0.8)'
          g.lineWidth = 1.5
          g.beginPath()
          g.moveTo(0, tvRow * h)
          g.lineTo(w, tvRow * h)
          g.stroke()
        }
        // Orbit ellipse
        if (st.on && st.orbit.on) {
          g.strokeStyle = 'rgba(255,180,80,0.9)'
          g.lineWidth = 1.5
          g.beginPath()
          const ocx = lp.orbitX ?? st.orbit.cx, ocy = lp.orbitY ?? st.orbit.cy, orr = lp.orbitR ?? st.orbit.rx
          g.ellipse(ocx * w, ocy * h, Math.max(2, orr * w), Math.max(2, orr * h), 0, 0, 6.2832)
          g.stroke()
          g.fillStyle = 'rgba(255,180,80,0.9)'
          g.beginPath()
          g.arc(ocx * w, ocy * h, 3, 0, 6.2832)
          g.fill()
        }
      }
      // Meter
      if (meterRef.current) {
        const p = Math.min(1, sonifyEngine.meterPeak)
        meterRef.current.style.width = `${Math.round(p * 100)}%`
        meterRef.current.style.background = sonifyEngine.meterLim < 0.95 ? 'rgb(230,120,60)' : 'rgb(120,200,140)'
      }
      raf = requestAnimationFrame(paint)
    }
    raf = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(raf)
  }, [cfg.spectra.sweepOn, cfg.spectra.x])

  // Probe dragging on the mirror : scan line / orbit centre / orbit radius.
  const posFrom = (e: ReactPointerEvent): [number, number] => {
    const r = mirrorRef.current!.getBoundingClientRect()
    return [
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
    ]
  }
  const onPointerDown = (e: ReactPointerEvent): void => {
    const [x, y] = posFrom(e)
    // grab priority : raster corner → raster rect → orbit centre → orbit edge
    // → held scan lines. The probes are the instrument.
    if (cfg.raster.on) {
      const cx2 = cfg.raster.rx + cfg.raster.rw, cy2 = cfg.raster.ry + cfg.raster.rh
      if (Math.abs(x - cx2) < 0.02 && Math.abs(y - cy2) < 0.03) dragging.current = 'rectsize'
      else if (x > cfg.raster.rx && x < cx2 && y > cfg.raster.ry && y < cy2) dragging.current = 'rect'
    }
    if (!dragging.current && cfg.orbit.on) {
      const dc = Math.hypot(x - cfg.orbit.cx, y - cfg.orbit.cy)
      if (dc < 0.03) { dragging.current = 'orbit' }
      else if (Math.abs(dc - Math.max(cfg.orbit.rx, cfg.orbit.ry)) < 0.04) { dragging.current = 'radius' }
    }
    if (!dragging.current && cfg.filter.on && !cfg.filter.sweepOn && Math.abs(x - cfg.filter.x) < 0.02) dragging.current = 'fline'
    if (!dragging.current && cfg.spectra.on && !cfg.spectra.sweepOn) dragging.current = 'line'
    if (!dragging.current && cfg.orbit.on) dragging.current = 'orbit'
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    onPointerMove(e)
  }
  const onPointerMove = (e: ReactPointerEvent): void => {
    if (!dragging.current) return
    const [x, y] = posFrom(e)
    if (dragging.current === 'line') pv('spectra', { x })
    else if (dragging.current === 'fline') pv('filter', { x })
    else if (dragging.current === 'orbit') pv('orbit', { cx: x, cy: y })
    else if (dragging.current === 'radius') {
      const r = Math.max(0.02, Math.hypot(x - cfg.orbit.cx, y - cfg.orbit.cy))
      pv('orbit', { rx: r, ry: r })
    } else if (dragging.current === 'rect') {
      pv('raster', {
        rx: Math.max(0, Math.min(1 - cfg.raster.rw, x - cfg.raster.rw / 2)),
        ry: Math.max(0, Math.min(1 - cfg.raster.rh, y - cfg.raster.rh / 2))
      })
    } else if (dragging.current === 'rectsize') {
      pv('raster', {
        rw: Math.max(0.04, Math.min(1 - cfg.raster.rx, x - cfg.raster.rx)),
        rh: Math.max(0.03, Math.min(1 - cfg.raster.ry, y - cfg.raster.ry))
      })
    }
  }
  const endDrag = (): void => { dragging.current = null }

  const fmtHz = (v: number): string => (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + 'Hz'
  const fmtNote = (n: number): string => `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      {/* Header : wraps gracefully on a narrow window instead of pushing controls off. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-3 py-2">
        <span className="text-[13px] font-semibold">Sonify</span>
        <button
          onClick={() => {
            const comp = useStore.getState().composition
            setSonify(suggestSonify(comp, cfg))
          }}
          className="rounded px-2 py-0.5 font-mono text-[11px] text-muted ring-1 ring-border transition-colors hover:text-accent hover:ring-accent/60"
          title="Auto-voice : read the session's registers and pick the fitting voices — glitch → Raster, motion → Flow, feedback → Orbit, line-work → Spectra, scan → Transmission, atmosphere → Filter. The strongest voice taps the layer that earned it. Your key, gains and probes are kept."
        >
          ✨ auto
        </button>
        <button
          onClick={diceWhole}
          className="rounded px-2 py-0.5 font-mono text-[11px] text-muted ring-1 ring-border transition-colors hover:text-accent hover:ring-accent/60"
          title="Randomize the whole Sonify patch — 2–3 voices, their params, a key/octave, maybe an FX tail (your on/off + output are kept)"
        >
          🎲
        </button>
        <button
          onClick={resetDefault}
          className="rounded px-2 py-0.5 font-mono text-[11px] text-muted ring-1 ring-border transition-colors hover:text-accent hover:ring-accent/60"
          title="Reset every Sonify voice / FX / mixer setting back to the defaults (keeps sound on/off + output device)"
        >
          ↺
        </button>
        {/* Presets */}
        <div className="flex items-center gap-1">
          <input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="preset"
            spellCheck={false}
            className="input h-[22px] w-20 px-1.5 text-[10px]"
            title="Name for saving the current Sonify patch"
          />
          <button onClick={savePreset} className="rounded px-1.5 py-0.5 font-mono text-[10px] text-muted ring-1 ring-border hover:text-accent hover:ring-accent/60" title="Save the current Sonify patch under this name">save</button>
          <select
            className="input select-compact max-w-[110px] text-[10px]"
            value=""
            onChange={(e) => { if (e.target.value) loadPreset(e.target.value) }}
            title="Load a saved Sonify preset"
          >
            <option value="">load…</option>
            {presetList.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {presetName && presetList.includes(presetName) && (
            <button onClick={() => delPreset(presetName)} className="rounded px-1 py-0.5 text-[10px] text-muted hover:text-red-400" title={`Delete preset "${presetName}"`}>🗑</button>
          )}
        </div>
        <button
          onClick={() => patch({ on: !cfg.on })}
          className={`rounded px-2 py-0.5 font-mono text-[11px] transition-colors ${
            cfg.on ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted hover:text-text'
          }`}
          title="Sound engine on/off (the image keeps rendering either way)"
        >
          {cfg.on ? '◉ sound on' : '○ sound off'}
        </button>
        {/* Voices ↔ Mixer view */}
        <div className="flex overflow-hidden rounded ring-1 ring-border font-mono text-[10px]">
          <button onClick={() => setView('voices')} className={`px-2 py-0.5 transition-colors ${view === 'voices' ? 'bg-accent/20 text-accent' : 'text-muted hover:text-text'}`} title="Per-voice parameter strips">voices</button>
          <button onClick={() => setView('mixer')} className={`px-2 py-0.5 transition-colors ${view === 'mixer' ? 'bg-accent/20 text-accent' : 'text-muted hover:text-text'}`} title="Mixer : per-voice volume + HP/LP filter, and the FX-tail mix">▤ mixer</button>
        </div>
        {/* Master + meter */}
        <span className="font-mono text-[9px] uppercase text-muted">master</span>
        <span className="relative flex shrink-0">
          <MidiLearnOverlay id="sonify:master" />
          <input
            type="range" min={0} max={1} step={0.01} value={cfg.master}
            onChange={(e) => patch({ master: Number(e.target.value) })}
            onDoubleClick={() => patch({ master: 0.8 })}
            className="w-28 accent-accent"
            title={`Master gain ${cfg.master.toFixed(2)} : double-click resets to 0.80 (a peak limiter always guards the output)`}
          />
        </span>
        <span className="w-7 shrink-0 text-right font-mono text-[9px] text-muted">{cfg.master.toFixed(2)}</span>
        <div className="h-2 w-24 overflow-hidden rounded bg-panel3" title="Output level (orange = the limiter is working)">
          <div ref={meterRef} className="h-full w-0" />
        </div>
        {/* Quantizer */}
        <span className="ml-2 font-mono text-[9px] uppercase text-muted">key</span>
        <select
          className="input select-compact text-[10px]"
          value={cfg.root}
          onChange={(e) => patch({ root: Number(e.target.value) })}
          title="Quantizer root note"
        >
          {NOTE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
        </select>
        <select
          className="input select-compact text-[10px]"
          value={cfg.rootOct ?? 3}
          onChange={(e) => patch({ rootOct: Number(e.target.value) })}
          title="Root octave : transpose the whole quantizer up/down (3 = default)"
        >
          {[1, 2, 3, 4, 5, 6].map((o) => <option key={o} value={o}>oct {o}</option>)}
        </select>
        <select
          className="input select-compact text-[10px]"
          value={cfg.scale}
          onChange={(e) => patch({ scale: e.target.value as SoniConfig['scale'] })}
          title="Quantizer scale (each voice can snap to it or run free)"
        >
          {SONI_SCALES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {/* Output device */}
        <select
          className="input select-compact max-w-[180px] text-[10px]"
          value={cfg.sinkId}
          onChange={(e) => patch({ sinkId: e.target.value })}
          title="Audio output device"
        >
          <option value="">default output</option>
          {devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        <div className="flex-1" />
        <span className="font-mono text-[9px] text-muted">S / Esc closes</span>
        <button onClick={() => setOpen(false)} className="rounded px-2 py-0.5 text-[12px] text-muted hover:text-text" title="Close (Esc)">✕</button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Mirror + probes */}
        <div className="flex min-w-0 flex-1 flex-col p-3">
          <div
            ref={mirrorRef}
            className="relative min-h-0 flex-1 cursor-crosshair overflow-hidden rounded border border-border bg-black"
            style={{ touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            title="Drag the probes : the scan line (Spectra, when not sweeping), the orbit centre, or its edge (radius)"
          >
            <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-contain" />
            <canvas ref={overlayRef} width={960} height={540} className="pointer-events-none absolute inset-0 h-full w-full" />
          </div>
          {/* Taps */}
          <div className="mt-2 flex items-center gap-3">
            {([0, 1] as const).map((t) => (
              <div key={t} className="flex items-center gap-1.5">
                <span className="font-mono text-[9px] uppercase text-muted">tap {t === 0 ? 'A' : 'B'}</span>
                <select
                  className="input select-compact text-[10px]"
                  value={cfg.taps[t].kind === 'master' ? 'master' : `layer${cfg.taps[t].layer}`}
                  onChange={(e) => {
                    const v = e.target.value
                    const taps = [...cfg.taps] as SoniConfig['taps']
                    taps[t] = v === 'master' ? { kind: 'master', layer: 0 } : { kind: 'layer', layer: Number(v.slice(5)) }
                    patch({ taps })
                  }}
                  title="What this tap reads : the composited master output, or one layer's post-FX image"
                >
                  <option value="master">master output</option>
                  {[0, 1, 2, 3].map((l) => <option key={l} value={`layer${l}`}>layer {l + 1}</option>)}
                </select>
              </div>
            ))}
            <span className="min-w-0 flex-1 truncate text-[9px] text-muted">
              Voices listen to a tap; two taps keep readbacks cheap while letting voices sonify different images.
            </span>
          </div>
        </div>

        {/* Drag handle : resize the voice/mixer column (dragging left widens it). */}
        <div
          className="w-1 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-accent/60"
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => {
            const startX = e.clientX
            const startW = voiceW
            let last = startW
            const el = e.currentTarget
            el.setPointerCapture(e.pointerId)
            const move = (ev: PointerEvent): void => {
              last = Math.max(240, Math.min(640, startW + (startX - ev.clientX)))
              setVoiceW(last)
            }
            const up = (): void => {
              el.removeEventListener('pointermove', move)
              el.removeEventListener('pointerup', up)
              el.removeEventListener('pointercancel', up)
              localStorage.setItem('opsia.soniVoiceW', String(Math.round(last)))
            }
            el.addEventListener('pointermove', move)
            el.addEventListener('pointerup', up)
            el.addEventListener('pointercancel', up)
          }}
          title="Drag to resize the voice column"
        />
        {/* Voice strips : dimmed while the master engine is OFF, so the green
            "● on" pills don't read as live sound (still fully editable). */}
        <aside
          style={{ width: voiceW }}
          className={`flex shrink-0 flex-col gap-2 overflow-y-auto border-l border-border bg-panel px-3 py-2 transition-opacity ${
            cfg.on ? '' : 'opacity-[0.65]'
          }`}
        >
          {assign && <AssignMini param={assign} onClose={() => setAssign(null)} />}
          {view === 'mixer' && (
            <div className="flex flex-col gap-1">
              <div className="mb-0.5 font-mono text-[9px] uppercase tracking-wide text-muted">mixer — volume · filter (LP ◄ off ► HP)</div>
              {VOICE_KEYS.map((k, i) => {
                const vv = cfg[k]
                return (
                  <div key={k} className="flex items-center gap-1.5 rounded border border-border/60 bg-panel2/40 px-1.5 py-1">
                    <span className="relative flex shrink-0">
                      <MidiLearnOverlay id={`sonify:voice:${i}`} />
                      <button
                        onClick={() => pv(k, { on: !vv.on })}
                        className={`h-4 w-4 shrink-0 rounded-full text-[8px] leading-none ${vv.on ? 'bg-accent text-black' : 'bg-panel3 text-muted'}`}
                        title={vv.on ? 'on' : 'off'}
                      >{vv.on ? '●' : '○'}</button>
                    </span>
                    <span className="w-[52px] shrink-0 truncate font-mono text-[9px]">{VOICE_NAMES[i]}</span>
                    <input type="range" min={0} max={1} step={0.01} value={vv.gain} onChange={(e) => pv(k, { gain: Number(e.target.value) })} onDoubleClick={() => pv(k, { gain: 0.5 })} className="min-w-0 flex-1 accent-accent" title={`Volume ${vv.gain.toFixed(2)}`} />
                    <input type="range" min={0} max={1} step={0.01} value={cfg.mixFilter?.[i] ?? 0.5} onChange={(e) => setMixFilter(i, Number(e.target.value))} onDoubleClick={() => setMixFilter(i, 0.5)} className="min-w-0 flex-1 accent-accent2" title={`Filter : ${filterTag(cfg.mixFilter?.[i] ?? 0.5)} (double-click = off)`} />
                    <span className="w-5 shrink-0 text-right font-mono text-[8px] text-muted">{filterTag(cfg.mixFilter?.[i] ?? 0.5)}</span>
                  </div>
                )
              })}
              <div className="mt-1 flex flex-col gap-0.5 rounded border border-accent2/40 bg-panel2/40 px-1.5 py-1">
                <div className="font-mono text-[8px] uppercase tracking-wide text-muted/70">fx tail</div>
                <Slider label="send" value={cfg.fx.send} min={0} max={1} neutral={0.35} onChange={(v) => pfx({ send: v })} />
                <Slider label="delay" value={cfg.fx.dlyMix} min={0} max={1} neutral={0.35} onChange={(v) => pfx({ dlyMix: v })} />
                <Slider label="reverb" value={cfg.fx.rvMix} min={0} max={1} neutral={0.6} onChange={(v) => pfx({ rvMix: v })} />
              </div>
              <SonifySequencer />
            </div>
          )}
          {view === 'voices' && (<>
          <VoiceShell
            title="Spectra" on={cfg.spectra.on}
            hint="The frame as a spectrogram — vertical position → pitch, brightness → loudness; the sweep plays the image like a score, along a reading path (ANS · Metasynth · vOICe)."
            onToggle={() => pv('spectra', { on: !cfg.spectra.on })}
            onDice={() => diceVoice('spectra')}
          >
            <TapSelect cfg={cfg} voice={cfg.spectra} onChange={(tap) => pv('spectra', { tap })} />
            <Row label="sweep">
              <button
                onClick={() => pv('spectra', { sweepOn: !cfg.spectra.sweepOn })}
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.spectra.sweepOn ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title="Sweep the scan column (vOICe) or hold it still (drag the line on the mirror)"
              >{cfg.spectra.sweepOn ? 'sweeping' : 'held'}</button>
              <button
                onClick={() => pv('spectra', { sync: !cfg.spectra.sync })}
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.spectra.sync ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title={`Sync the sweep to the tempo (one sweep per bar @ ${bpm} BPM)`}
              >sync</button>
              <span className="ml-auto" />
              {chip('spectraX', cfg.spectra.sweepOn)}
            </Row>
            {!cfg.spectra.sync && cfg.spectra.sweepOn && (
              <Slider label="rate" value={cfg.spectra.sweepHz} min={0.02} max={4} neutral={0.25} fmt={(v) => v.toFixed(2) + 'Hz'} onChange={(v) => pv('spectra', { sweepHz: v })} mod={chip('spectraSweep')} />
            )}
            <Row label="path">
              <select
                className="input select-compact min-w-0 flex-1 text-[10px]"
                value={cfg.spectra.path ?? 0}
                onChange={(e) => pv('spectra', { path: Number(e.target.value) })}
                title="Reading path : how the scan traverses the frame (Aural Mirror) — a column swept across, a row swept down, a rotating ray, or a spiral"
              >
                <option value={0}>horizontal →</option>
                <option value={1}>vertical ↓</option>
                <option value={2}>radial ⟳</option>
                <option value={3}>spiral</option>
              </select>
            </Row>
            {cfg.spectra.sweepOn && (
              <Slider label="breathe" value={cfg.spectra.pace ?? 0} min={0} max={0.95} neutral={0} onChange={(v) => pv('spectra', { pace: v })} />
            )}
            <Slider label="contrast" value={cfg.spectra.gamma} min={0.5} max={4} neutral={1.8} onChange={(v) => pv('spectra', { gamma: v })} mod={chip('spectraGamma')} />
            <Slider label="breath" value={cfg.spectra.breath ?? 0} min={0} max={1} neutral={0} onChange={(v) => pv('spectra', { breath: v })} mod={chip('spectraBreath')} />
            <Row label="range">
              <select className="input select-compact text-[10px]" value={cfg.spectra.loOct} onChange={(e) => pv('spectra', { loOct: Math.min(Number(e.target.value), cfg.spectra.hiOct - 1) })} title="Lowest octave">
                {[0, 1, 2, 3, 4].map((o) => <option key={o} value={o}>oct {o}</option>)}
              </select>
              <span className="text-[9px] text-muted">→</span>
              <select className="input select-compact text-[10px]" value={cfg.spectra.hiOct} onChange={(e) => pv('spectra', { hiOct: Math.max(Number(e.target.value), cfg.spectra.loOct + 1) })} title="Highest octave">
                {[4, 5, 6, 7, 8].map((o) => <option key={o} value={o}>oct {o}</option>)}
              </select>
              <button
                onClick={() => pv('spectra', { quantize: !cfg.spectra.quantize })}
                className={`ml-auto rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.spectra.quantize ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title="Snap the partial rows onto the key/scale (Metasynth) or spread them freely (ANS)"
              >♪ scale</button>
            </Row>
            <Slider label="gain" value={cfg.spectra.gain} min={0} max={1} neutral={0.5} onChange={(v) => pv('spectra', { gain: v })} mod={chip('spectraGain')} />
            <Slider label="pan" value={cfg.spectra.pan} min={-1} max={1} neutral={0} onChange={(v) => pv('spectra', { pan: v })} />
          </VoiceShell>

          <VoiceShell
            title="Orbit" on={cfg.orbit.on}
            hint="The image itself is the oscillator — an orbit reads pixels at audio rate; drag the orbit to mutate the timbre live (wave terrain · Oramics)."
            onToggle={() => pv('orbit', { on: !cfg.orbit.on })}
            onDice={() => diceVoice('orbit')}
          >
            <TapSelect cfg={cfg} voice={cfg.orbit} onChange={(tap) => pv('orbit', { tap })} />
            <Row label="pitch">
              {cfg.orbit.quantize ? (
                <input
                  type="range" min={24} max={72} step={1} value={cfg.orbit.note}
                  onChange={(e) => pv('orbit', { note: Number(e.target.value) })}
                  className="min-w-0 flex-1 accent-accent"
                  title={`Note ${fmtNote(cfg.orbit.note)} (snapped to the key)`}
                />
              ) : (
                <input
                  type="range" min={0} max={1} step={0.001}
                  value={Math.log(cfg.orbit.freq / 30) / Math.log(2000 / 30)}
                  onChange={(e) => pv('orbit', { freq: 30 * Math.pow(2000 / 30, Number(e.target.value)) })}
                  className="min-w-0 flex-1 accent-accent"
                  title={`Free frequency ${fmtHz(cfg.orbit.freq)}`}
                />
              )}
              <span className="w-10 shrink-0 text-right font-mono text-[9px] text-muted">
                {cfg.orbit.quantize ? fmtNote(cfg.orbit.note) : fmtHz(cfg.orbit.freq)}
              </span>
              <button
                onClick={() => pv('orbit', { quantize: !cfg.orbit.quantize })}
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.orbit.quantize ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title="Snap the orbit pitch to the key/scale, or run free Hz"
              >♪</button>
            </Row>
            <Row label="shape">
              <select
                className="input select-compact min-w-0 flex-1 text-[10px]"
                value={cfg.orbit.ratio}
                onChange={(e) => pv('orbit', { ratio: Number(e.target.value) })}
                title="Orbit shape : the x:y frequency ratio (1 = ellipse, others = Lissajous)"
              >
                <option value={1}>circle 1:1</option>
                <option value={2}>lissajous 1:2</option>
                <option value={1.5}>lissajous 2:3</option>
                <option value={1.3333333}>lissajous 3:4</option>
                <option value={3}>lissajous 1:3</option>
              </select>
            </Row>
            <Slider label="radius" value={cfg.orbit.rx} min={0.02} max={0.5} neutral={0.25} onChange={(v) => pv('orbit', { rx: v, ry: v })} />
            <Slider label="drive" value={cfg.orbit.drive} min={0.2} max={4} neutral={1} onChange={(v) => pv('orbit', { drive: v })} mod={chip('orbitDrive')} />
            <Slider label="smooth" value={cfg.orbit.smooth} min={0} max={1} neutral={0.5} onChange={(v) => pv('orbit', { smooth: v })} mod={chip('orbitSmooth')} />
            <Slider label="gain" value={cfg.orbit.gain} min={0} max={1} neutral={0.5} onChange={(v) => pv('orbit', { gain: v })} />
            <Slider label="pan" value={cfg.orbit.pan} min={-1} max={1} neutral={0} onChange={(v) => pv('orbit', { pan: v })} />
          </VoiceShell>

          <VoiceShell
            title="Flow" on={cfg.flow.on}
            hint="Whatever MOVES sings — each moving region fires a grain, panned where it is; colour tints each grain (Pelletier flow fields)."
            onToggle={() => pv('flow', { on: !cfg.flow.on })}
            onDice={() => diceVoice('flow')}
          >
            <TapSelect cfg={cfg} voice={cfg.flow} onChange={(tap) => pv('flow', { tap })} />
            <Slider label="sense" value={cfg.flow.sense} min={0} max={1} neutral={0.4} onChange={(v) => pv('flow', { sense: v })} />
            <Slider label="density" value={cfg.flow.density} min={0} max={1} neutral={0.5} onChange={(v) => pv('flow', { density: v })} />
            <Slider label="grain" value={cfg.flow.dur} min={0.02} max={0.4} neutral={0.09} fmt={(v) => Math.round(v * 1000) + 'ms'} onChange={(v) => pv('flow', { dur: v })} mod={chip('flowDur')} />
            <Slider label="breath" value={cfg.flow.noise} min={0} max={1} neutral={0.15} onChange={(v) => pv('flow', { noise: v })} />
            <Slider label="colour" value={cfg.flow.colour ?? 0} min={0} max={1} neutral={0.6} onChange={(v) => pv('flow', { colour: v })} mod={chip('flowColour')} title="Colour → grain timbre : saturation brightens each grain, hue tints it (warm = rounder body, cool = shimmer)" />
            <Row label="range">
              <select className="input select-compact text-[10px]" value={cfg.flow.loOct} onChange={(e) => pv('flow', { loOct: Math.min(Number(e.target.value), cfg.flow.hiOct - 1) })} title="Lowest octave">
                {[1, 2, 3, 4].map((o) => <option key={o} value={o}>oct {o}</option>)}
              </select>
              <span className="text-[9px] text-muted">→</span>
              <select className="input select-compact text-[10px]" value={cfg.flow.hiOct} onChange={(e) => pv('flow', { hiOct: Math.max(Number(e.target.value), cfg.flow.loOct + 1) })} title="Highest octave">
                {[4, 5, 6, 7].map((o) => <option key={o} value={o}>oct {o}</option>)}
              </select>
              <button
                onClick={() => pv('flow', { quantize: !cfg.flow.quantize })}
                className={`ml-auto rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.flow.quantize ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title="Grains land on scale notes (a rain of pitches) or free frequencies"
              >♪ scale</button>
            </Row>
            <Slider label="gain" value={cfg.flow.gain} min={0} max={1} neutral={0.6} onChange={(v) => pv('flow', { gain: v })} />
          </VoiceShell>

          <VoiceShell
            title="Events" on={cfg.events.on}
            hint="Edges & motion struck as discrete notes — pitch from height, velocity from strength, highs decaying sooner (after Aural Mirror)."
            onToggle={() => pv('events', { on: !cfg.events.on })}
            onDice={() => diceVoice('events')}
          >
            <TapSelect cfg={cfg} voice={cfg.events} onChange={(tap) => pv('events', { tap })} />
            <Row label="trigger">
              {(['spatial', 'motion', 'blend'] as const).map((mo) => (
                <button
                  key={mo}
                  onClick={() => pv('events', { mode: mo })}
                  className={`flex-1 rounded px-1.5 py-0.5 font-mono text-[9px] transition-colors ${
                    cfg.events.mode === mo ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted hover:text-text'
                  }`}
                  title={
                    mo === 'spatial'
                      ? 'Edges / strokes (Sobel) — fires on contours, works on a still image'
                      : mo === 'motion'
                        ? 'Frame difference — only what MOVES fires a note'
                        : 'Both — a moving edge is the strongest, so it dominates'
                  }
                >{mo}</button>
              ))}
            </Row>
            <Slider label="sense" value={cfg.events.sense} min={0} max={1} neutral={0.5} onChange={(v) => pv('events', { sense: v })} />
            <Slider label="density" value={cfg.events.density} min={0} max={1} neutral={0.4} onChange={(v) => pv('events', { density: v })} />
            <Slider label="decay" value={cfg.events.decay} min={0} max={1} neutral={0.35} fmt={(v) => Math.round((0.05 + v * 2.45) * 1000) + 'ms'} onChange={(v) => pv('events', { decay: v })} mod={chip('eventsDecay')} />
            <Slider label="highs↓" value={cfg.events.highs} min={0} max={1} neutral={0.6} onChange={(v) => pv('events', { highs: v })} />
            <Row label="wave">
              <select
                className="input select-compact min-w-0 flex-1 text-[10px]"
                value={cfg.events.wave}
                onChange={(e) => pv('events', { wave: Number(e.target.value) })}
                title="Oscillator shape for the notes"
              >
                <option value={0}>sine</option>
                <option value={1}>triangle</option>
                <option value={2}>saw</option>
                <option value={3}>square</option>
              </select>
            </Row>
            <Row label="range">
              <select className="input select-compact text-[10px]" value={cfg.events.loOct} onChange={(e) => pv('events', { loOct: Math.min(Number(e.target.value), cfg.events.hiOct - 1) })} title="Lowest octave">
                {[1, 2, 3, 4].map((o) => <option key={o} value={o}>oct {o}</option>)}
              </select>
              <span className="text-[9px] text-muted">→</span>
              <select className="input select-compact text-[10px]" value={cfg.events.hiOct} onChange={(e) => pv('events', { hiOct: Math.max(Number(e.target.value), cfg.events.loOct + 1) })} title="Highest octave">
                {[4, 5, 6, 7].map((o) => <option key={o} value={o}>oct {o}</option>)}
              </select>
              <button
                onClick={() => pv('events', { quantize: !cfg.events.quantize })}
                className={`ml-auto rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.events.quantize ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title="Notes land on scale degrees or free frequencies"
              >♪ scale</button>
            </Row>
            <Slider label="gain" value={cfg.events.gain} min={0} max={1} neutral={0.6} onChange={(v) => pv('events', { gain: v })} />
            <Slider label="pan" value={cfg.events.pan} min={-1} max={1} neutral={0} onChange={(v) => pv('events', { pan: v })} />
          </VoiceShell>

          <VoiceShell
            title="Raster" on={cfg.raster.on}
            hint="Audification — the probe rect read raw, row-major, as the waveform itself: edges buzz, gradients hum, glitch ticks (Ikeda · raster scanning)."
            onToggle={() => pv('raster', { on: !cfg.raster.on })}
            onDice={() => diceVoice('raster')}
          >
            <TapSelect cfg={cfg} voice={cfg.raster} onChange={(tap) => pv('raster', { tap })} />
            <Row label="pitch">
              {cfg.raster.quantize ? (
                <input
                  type="range" min={24} max={72} step={1} value={cfg.raster.note}
                  onChange={(e) => pv('raster', { note: Number(e.target.value) })}
                  className="min-w-0 flex-1 accent-accent"
                  title={`Note ${fmtNote(cfg.raster.note)} : one full scan of the rect = the period`}
                />
              ) : (
                <input
                  type="range" min={0} max={1} step={0.001}
                  value={Math.log(cfg.raster.freq / 20) / Math.log(1000 / 20)}
                  onChange={(e) => pv('raster', { freq: 20 * Math.pow(1000 / 20, Number(e.target.value)) })}
                  className="min-w-0 flex-1 accent-accent"
                  title={`Free frequency ${fmtHz(cfg.raster.freq)}`}
                />
              )}
              <span className="w-10 shrink-0 text-right font-mono text-[9px] text-muted">
                {cfg.raster.quantize ? fmtNote(cfg.raster.note) : fmtHz(cfg.raster.freq)}
              </span>
              <button
                onClick={() => pv('raster', { quantize: !cfg.raster.quantize })}
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.raster.quantize ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title="Snap the scan pitch to the key/scale, or run free Hz"
              >&#9834;</button>
              {chip('rasterPitch')}
            </Row>
            <Row label="rect">
              <span className="font-mono text-[9px] text-muted">x</span>{chip('rasterX')}
              <span className="font-mono text-[9px] text-muted">y</span>{chip('rasterY')}
              <span className="font-mono text-[9px] text-muted">w</span>{chip('rasterW')}
              <span className="font-mono text-[9px] text-muted">h</span>{chip('rasterH')}
            </Row>
            <Slider label="smooth" value={cfg.raster.smooth} min={0} max={1} neutral={0} onChange={(v) => pv('raster', { smooth: v })} mod={chip('rasterSmooth')} />
            <Slider
              label="tone" value={cfg.raster.tone ?? 0.6} min={0} max={1} neutral={0.6}
              fmt={(v) => (v >= 0.99 ? 'open' : Math.round(300 * Math.pow(8000 / 300, v)) + 'Hz')}
              onChange={(v) => pv('raster', { tone: v })} mod={chip('rasterTone')}
            />
            <Slider label="gain" value={cfg.raster.gain} min={0} max={1} neutral={0.4} onChange={(v) => pv('raster', { gain: v })} />
            <Slider label="pan" value={cfg.raster.pan} min={-1} max={1} neutral={0} onChange={(v) => pv('raster', { pan: v })} />
            <p className="text-[9px] leading-tight text-muted">Drag the green rect (corner resizes). The rect IS the waveform : edges buzz, gradients hum, datamosh blocks tick. Smooth 0 = the hard aliased register.</p>
          </VoiceShell>

          <VoiceShell
            title="Transmission" on={cfg.sstv.on}
            hint="The SSTV register — the image scanned line by line as a monophonic FM voice, the 1200Hz sync tick as a metronome."
            onToggle={() => pv('sstv', { on: !cfg.sstv.on })}
            onDice={() => diceVoice('sstv')}
          >
            <TapSelect cfg={cfg} voice={cfg.sstv} onChange={(tap) => pv('sstv', { tap })} />
            <Row label="lines">
              {!cfg.sstv.sync && (
                <input
                  type="range" min={1} max={60} step={0.5} value={cfg.sstv.lineHz}
                  onChange={(e) => pv('sstv', { lineHz: Number(e.target.value) })}
                  className="min-w-0 flex-1 accent-accent"
                  title={`Scan rate ${cfg.sstv.lineHz.toFixed(1)} lines/s : the melody is the image rows`}
                />
              )}
              {!cfg.sstv.sync && (
                <span className="w-10 shrink-0 text-right font-mono text-[9px] text-muted">{cfg.sstv.lineHz.toFixed(1)}/s</span>
              )}
              {!cfg.sstv.sync && chip('sstvLine')}
              <button
                onClick={() => pv('sstv', { sync: !cfg.sstv.sync })}
                className={`${cfg.sstv.sync ? 'flex-1 ' : ''}rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.sstv.sync ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title={`Sync : one scan line per 16th note @ ${bpm} BPM (the sync tick becomes the clock)`}
              >{cfg.sstv.sync ? `sync 1/16 @ ${bpm}` : 'sync'}</button>
            </Row>
            <Slider label="transpose" value={cfg.sstv.dev} min={0.25} max={2} neutral={1} fmt={(v) => v.toFixed(2) + 'x'} onChange={(v) => pv('sstv', { dev: v })} mod={chip('sstvDev')} />
            <Slider label="tick" value={cfg.sstv.syncLev} min={0} max={1} neutral={0.5} onChange={(v) => pv('sstv', { syncLev: v })} />
            <Slider label="gain" value={cfg.sstv.gain} min={0} max={1} neutral={0.4} onChange={(v) => pv('sstv', { gain: v })} />
            <Slider label="pan" value={cfg.sstv.pan} min={-1} max={1} neutral={0} onChange={(v) => pv('sstv', { pan: v })} />
          </VoiceShell>

          <VoiceShell
            title="Filter" on={cfg.filter.on}
            hint="Sonify without synthesizing — 48 band-pass filters gained by the image, playing noise or live line-in THROUGH the frame (Metasynth)."
            onToggle={() => pv('filter', { on: !cfg.filter.on })}
            onDice={() => diceVoice('filter')}
          >
            <TapSelect cfg={cfg} voice={cfg.filter} onChange={(tap) => pv('filter', { tap })} />
            <Row label="source">
              <button
                onClick={() => pv('filter', { lineIn: false })}
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${!cfg.filter.lineIn ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title="Internal noise through the image's bands (wide resonance = wind, narrow = flute)"
              >noise</button>
              <button
                onClick={() => pv('filter', { lineIn: true })}
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.filter.lineIn ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title="Live line/mic input filtered by the frame (the Metasynth filter room)"
              >line-in</button>
            </Row>
            <Row label="sweep">
              <button
                onClick={() => pv('filter', { sweepOn: !cfg.filter.sweepOn })}
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.filter.sweepOn ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title="Sweep the reading column, or hold it (drag the blue line)"
              >{cfg.filter.sweepOn ? 'sweeping' : 'held'}</button>
              {chip('filterX', cfg.filter.sweepOn)}
              {cfg.filter.sweepOn && (
                <input
                  type="range" min={0.02} max={4} step={0.01} value={cfg.filter.sweepHz}
                  onChange={(e) => pv('filter', { sweepHz: Number(e.target.value) })}
                  className="min-w-0 flex-1 accent-accent"
                  title={`Sweep rate ${cfg.filter.sweepHz.toFixed(2)}Hz`}
                />
              )}
              {cfg.filter.sweepOn && chip('filterSweep')}
            </Row>
            <Row label="path">
              <select
                className="input select-compact min-w-0 flex-1 text-[10px]"
                value={cfg.filter.path ?? 0}
                onChange={(e) => pv('filter', { path: Number(e.target.value) })}
                title="Reading path : how the band-scan traverses the frame (Aural Mirror)"
              >
                <option value={0}>horizontal →</option>
                <option value={1}>vertical ↓</option>
                <option value={2}>radial ⟳</option>
                <option value={3}>spiral</option>
              </select>
            </Row>
            {cfg.filter.sweepOn && (
              <Slider label="breathe" value={cfg.filter.pace ?? 0} min={0} max={0.95} neutral={0} onChange={(v) => pv('filter', { pace: v })} />
            )}
            <Slider label="resonance" value={cfg.filter.q} min={0} max={1} neutral={0.5} onChange={(v) => pv('filter', { q: v })} mod={chip('filterQ')} />
            <Slider label="noise" value={cfg.filter.noise} min={0} max={1} neutral={0.5} onChange={(v) => pv('filter', { noise: v })} />
            <Slider label="contrast" value={cfg.filter.gamma} min={0.5} max={4} neutral={1.6} onChange={(v) => pv('filter', { gamma: v })} />
            <Row label="bands">
              <button
                onClick={() => pv('filter', { quantize: !cfg.filter.quantize })}
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.filter.quantize ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`}
                title="Tune the 48 band centres to the key/scale (a resonant harmonic wash) or spread them freely"
              >&#9834; scale</button>
            </Row>
            <Slider label="gain" value={cfg.filter.gain} min={0} max={1} neutral={0.6} onChange={(v) => pv('filter', { gain: v })} />
            <Slider label="pan" value={cfg.filter.pan} min={-1} max={1} neutral={0} onChange={(v) => pv('filter', { pan: v })} />
          </VoiceShell>

          <VoiceShell
            title="Chord" on={cfg.chord.on}
            hint="A scale-tuned bank following the frame brightness BANDS — a sustained chord that swells & fades, so a still image still sings (Aural Mirror additive)."
            onToggle={() => pv('chord', { on: !cfg.chord.on })}
            onDice={() => diceVoice('chord')}
          >
            <TapSelect cfg={cfg} voice={cfg.chord} onChange={(tap) => pv('chord', { tap })} />
            <Row label="voices">
              <input
                type="range" min={2} max={16} step={1} value={cfg.chord.voices}
                onChange={(e) => pv('chord', { voices: Number(e.target.value) })}
                className="min-w-0 flex-1 accent-accent"
                title="How many scale notes in the chord (spread over the range)"
              />
              <span className="w-12 shrink-0 text-right font-mono text-[9px] text-muted">{cfg.chord.voices}</span>
            </Row>
            <Row label="range">
              <select className="input select-compact text-[10px]" value={cfg.chord.loOct} onChange={(e) => pv('chord', { loOct: Math.min(Number(e.target.value), cfg.chord.hiOct - 1) })} title="Lowest octave">
                {[0, 1, 2, 3, 4].map((o) => <option key={o} value={o}>oct {o}</option>)}
              </select>
              <span className="text-[9px] text-muted">→</span>
              <select className="input select-compact text-[10px]" value={cfg.chord.hiOct} onChange={(e) => pv('chord', { hiOct: Math.max(Number(e.target.value), cfg.chord.loOct + 1) })} title="Highest octave">
                {[3, 4, 5, 6, 7, 8].map((o) => <option key={o} value={o}>oct {o}</option>)}
              </select>
            </Row>
            <Slider label="swell" value={cfg.chord.attack} min={0.02} max={3} neutral={0.4} fmt={(v) => v.toFixed(2) + 's'} onChange={(v) => pv('chord', { attack: v })} mod={chip('chordAttack')} title="Attack : how slowly each note fades IN as its band brightens" />
            <Slider label="fade" value={cfg.chord.release} min={0.05} max={6} neutral={0.8} fmt={(v) => v.toFixed(2) + 's'} onChange={(v) => pv('chord', { release: v })} title="Release : how slowly each note fades OUT as its band darkens" />
            <Slider label="contrast" value={cfg.chord.gamma} min={0.5} max={4} neutral={1.6} onChange={(v) => pv('chord', { gamma: v })} />
            <Slider label="tone" value={cfg.chord.tone} min={0} max={1} neutral={0.3} onChange={(v) => pv('chord', { tone: v })} mod={chip('chordTone')} title="Sine → brighter (soft-clip harmonics)" />
            <Slider label="spread" value={cfg.chord.spread} min={0} max={1} neutral={0.6} onChange={(v) => pv('chord', { spread: v })} mod={chip('chordSpread')} title="Stereo fan across the bank (low notes ↔ high notes)" />
            <Slider label="gain" value={cfg.chord.gain} min={0} max={1} neutral={0.6} onChange={(v) => pv('chord', { gain: v })} />
            <Slider label="pan" value={cfg.chord.pan} min={-1} max={1} neutral={0} onChange={(v) => pv('chord', { pan: v })} />
          </VoiceShell>

          <VoiceShell
            title="Reverb / Delay" on={cfg.fx.send > 0.0001}
            hint="a shared FX tail — the whole mix sends into an analog delay → Quartz/Prism reverb"
            onToggle={() => pfx({ send: cfg.fx.send > 0.0001 ? 0 : 0.35 })}
          >
            <Slider label="send" value={cfg.fx.send} min={0} max={1} neutral={0.35} onChange={(v) => pfx({ send: v })} mod={chip('fxSend')} title="How much of the sonify mix feeds the shared reverb / delay tail" />
            <div className="mt-1 font-mono text-[8px] uppercase tracking-wide text-muted/70">delay (BBD / analog)</div>
            <Row label="mode">
              <select className="input select-compact min-w-0 flex-1 text-[10px]" value={cfg.fx.dlyMode} onChange={(e) => pfx({ dlyMode: Number(e.target.value) })} title="Delay routing">
                <option value={0}>mono</option>
                <option value={1}>stereo</option>
                <option value={2}>ping-pong</option>
              </select>
            </Row>
            <Slider label="time" value={cfg.fx.dlyTime} min={0.02} max={2} neutral={0.3} fmt={(v) => Math.round(v * 1000) + 'ms'} onChange={(v) => pfx({ dlyTime: v })} title="Delay time (glides tape-style when moved)" />
            <Slider label="feedback" value={cfg.fx.dlyFb} min={0} max={0.95} neutral={0.35} onChange={(v) => pfx({ dlyFb: v })} title="Echo regeneration (companded, self-limiting)" />
            <Slider label="tone" value={cfg.fx.dlyTone} min={0} max={1} neutral={0.5} onChange={(v) => pfx({ dlyTone: v })} title="BBD darkness : low = dark analog repeats, high = bright" />
            <Slider label="delay mix" value={cfg.fx.dlyMix} min={0} max={1} neutral={0.35} onChange={(v) => pfx({ dlyMix: v })} mod={chip('fxDelay')} title="Echo level in the tail" />
            <div className="mt-1 font-mono text-[8px] uppercase tracking-wide text-muted/70">reverb (Quartz / Prism)</div>
            <Row label="mode">
              <button onClick={() => pfx({ rvMode: 0 })} className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.fx.rvMode === 0 ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`} title="Quartz : dual-band damped pad-verb">Quartz</button>
              <button onClick={() => pfx({ rvMode: 1 })} className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.fx.rvMode === 1 ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'}`} title="Prism : per-band frequency-dependent decay">Prism</button>
              <button onClick={() => pfx({ rvFreeze: !cfg.fx.rvFreeze })} className={`ml-auto rounded px-1.5 py-0.5 font-mono text-[9px] ${cfg.fx.rvFreeze ? 'bg-accent2/20 text-accent2 ring-1 ring-accent2' : 'bg-panel3/60 text-muted'}`} title="Infinite freeze (hold the tail)">❄ freeze</button>
            </Row>
            <Slider label="size" value={cfg.fx.rvSize} min={0} max={1} neutral={0.6} onChange={(v) => pfx({ rvSize: v })} />
            <Slider label="decay" value={cfg.fx.rvDecay} min={0} max={1} neutral={0.6} fmt={(v) => (0.25 + v * v * 11.75).toFixed(1) + 's'} onChange={(v) => pfx({ rvDecay: v })} title="RT60 (0.25–12 s)" />
            <Slider label="damp" value={cfg.fx.rvDamp} min={0} max={1} neutral={0.3} onChange={(v) => pfx({ rvDamp: v })} title="HF absorption (darker tail)" />
            <Slider label="predelay" value={cfg.fx.rvPre} min={0} max={200} neutral={20} fmt={(v) => Math.round(v) + 'ms'} onChange={(v) => pfx({ rvPre: v })} />
            <Slider label="shimmer" value={cfg.fx.rvMod} min={0} max={40} neutral={6} fmt={(v) => v.toFixed(0)} onChange={(v) => pfx({ rvMod: v })} title="Tail modulation depth (chorusing)" />
            <Slider label="mod rate" value={cfg.fx.rvModRate} min={0.01} max={8} neutral={0.5} fmt={(v) => v.toFixed(2) + 'Hz'} onChange={(v) => pfx({ rvModRate: v })} />
            <Slider label="width" value={cfg.fx.rvWidth} min={0} max={1} neutral={1} onChange={(v) => pfx({ rvWidth: v })} title="Stereo width (0 mono … 1 wide)" />
            <Slider label="low-cut" value={cfg.fx.rvLocut} min={20} max={2000} neutral={220} fmt={(v) => Math.round(v) + 'Hz'} onChange={(v) => pfx({ rvLocut: v })} title="Wet low-cut (keeps the tail airy)" />
            {cfg.fx.rvMode === 0 ? (
              <>
                <Slider label="diffusion" value={cfg.fx.rvDiff} min={0} max={1} neutral={0.85} onChange={(v) => pfx({ rvDiff: v })} title="Quartz : input diffusion (smears transients)" />
                <Slider label="low damp" value={cfg.fx.rvLowDamp} min={0} max={1} neutral={0.5} onChange={(v) => pfx({ rvLowDamp: v })} title="Quartz : LF damping" />
              </>
            ) : (
              <>
                <Slider label="crossover" value={cfg.fx.rvCross} min={0} max={1} neutral={0.3} onChange={(v) => pfx({ rvCross: v })} title="Prism : band-split frequency" />
                <Slider label="low ×" value={cfg.fx.rvLowMult} min={0.05} max={4} neutral={1} fmt={(v) => v.toFixed(2)} onChange={(v) => pfx({ rvLowMult: v })} title="Prism : low-band decay multiplier" />
                <Slider label="high ×" value={cfg.fx.rvHighMult} min={0.05} max={4} neutral={1} fmt={(v) => v.toFixed(2)} onChange={(v) => pfx({ rvHighMult: v })} title="Prism : high-band decay multiplier" />
              </>
            )}
            <Slider label="reverb mix" value={cfg.fx.rvMix} min={0} max={1} neutral={0.6} onChange={(v) => pfx({ rvMix: v })} mod={chip('fxReverb')} title="Reverb level in the tail" />
          </VoiceShell>

          <p className="text-[9px] leading-tight text-muted/70">
            Hover the ⓘ on each voice for what it does · 🎲 re-rolls one voice · while the engine runs, recordings capture the sound too.
          </p>
          </>)}
        </aside>
      </div>
    </div>
  )
}
