// World page (W) : the diegesis editor. A full-page takeover: pick a World from
// the bank (built-ins + your saved ones), edit its relations (A/B coupling ·
// Context mood · audio routing), and apply it to the live composition. Editing
// the ACTIVE world updates the composite in real time.
//
// Next batch: a JSON live-code editor (both-way synced) and a World Visualizer
// that simulates audio + A/B on noise so you can SEE the coupling behave.

import { useEffect, useRef, useState } from 'react'
import type { AudioFeature, CouplingMode, World, WorldAudioTarget } from '@shared/types'
import { WORLD_AUDIO_TARGETS } from '@shared/types'
import { AUDIO_FEATURES } from '../engine/audioIn'
import { useStore } from '../store'
import { WorldVisualizer, WORLD_SOURCE_PAIRS, simAudio, type SimAudio } from './WorldVisualizer'

const SIM_SHAPES: SimAudio['shape'][] = ['pulse', 'sine', 'ramp', 'noise']

const COUPLING_MODES: CouplingMode[] = ['off', 'lean', 'hocket', 'cut', 'gate', 'drift']
const CONTEXT_KEYS: Array<{ k: string; label: string; hint: string }> = [
  { k: 'trails', label: 'trails', hint: 'Temporal colour bleed : past frames linger and drift into the distance.' },
  { k: 'blur', label: 'blur', hint: 'Soft spatial blur : takes the edge off, pushes things back in space.' },
  { k: 'bloom', label: 'bloom', hint: 'Highlights glow / bleed light : dreamier, more luminous.' },
  { k: 'depth', label: 'depth', hint: 'Vignette + aerial recession that seats the image in a volume.' },
  { k: 'haze', label: 'haze', hint: 'Atmospheric veil toward the atmosphere colour : distance, air.' }
]
const COUPLING_INFO: Record<string, string> = {
  off: 'off : the two voices are independent (no audio binding)',
  lean: 'lean : audio gently pushes the A/B balance toward B (continuous)',
  hocket: 'hocket : audio flips the balance A↔B (percussive, alternating)',
  cut: 'cut : a transient flashes to B, then releases (on-beat, punchy)',
  gate: 'gate : B while loud, A while quiet (a threshold)',
  drift: 'drift : slow momentum follow, sharing direction not shape'
}

export function WorldPage(): JSX.Element {
  const worlds = useStore((s) => s.worlds)
  const activeId = useStore((s) => s.world)
  const setWorld = useStore((s) => s.setWorld)
  const addWorld = useStore((s) => s.addWorld)
  const updateWorld = useStore((s) => s.updateWorld)
  const deleteWorld = useStore((s) => s.deleteWorld)
  const close = useStore((s) => s.setWorldPageOpen)

  // Which world the editor is pointed at (defaults to the active one).
  const [selId, setSelId] = useState(activeId)
  const w = worlds.find((x) => x.id === selId) ?? worlds[0]
  const isActive = w.id === activeId

  // Visualizer test material + simulated-audio driver.
  const [sourceIdx, setSourceIdx] = useState(0)
  const [audio, setAudio] = useState<SimAudio>({ shape: 'pulse', freqHz: 2, rhythmic: true, gain: 0.9 })
  const setAud = (p: Partial<SimAudio>): void => setAudio((a) => ({ ...a, ...p }))

  const setCoupling = (partial: Partial<typeof w.coupling>): void =>
    updateWorld(w.id, { coupling: { ...w.coupling, ...partial } })
  const setContext = (k: string, v: number): void =>
    updateWorld(w.id, { context: { ...w.context, [k]: v } })
  const setAutoMod = (partial: Partial<NonNullable<typeof w.autoMod>>): void => {
    const base = w.autoMod ?? { feature: 'transient' as AudioFeature, target: 'haze' as WorldAudioTarget, depth: 0.4 }
    updateWorld(w.id, { autoMod: { ...base, ...partial } })
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      {/* header */}
      <div className="flex items-center gap-3 border-b border-border bg-panel px-4 py-2">
        <span className="font-mono text-[13px] font-semibold uppercase tracking-wide text-accent">
          ◵ World
        </span>
        <span className="font-mono text-[10px] text-muted">
          diegesis : the proposed world biasing coupling · Context · audio routing
        </span>
        <div className="flex-1" />
        <button className="btn text-[12px]" onClick={() => close(false)} title="Close (W / Esc)">
          ✕ Close
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* ── World bank ────────────────────────────────────────────── */}
        <aside className="flex w-56 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-panel2/40 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-wide text-muted">Worlds</span>
            <button
              className="btn px-1.5 text-[11px]"
              onClick={() => setSelId(addWorld(w.id))}
              title="Duplicate this World into a new editable one"
            >
              + New
            </button>
          </div>
          {worlds.map((x) => (
            <div
              key={x.id}
              className={`group flex items-center gap-1 rounded px-2 py-1 ${
                x.id === selId ? 'bg-accent/15 ring-1 ring-accent/50' : 'hover:bg-panel3/40'
              }`}
            >
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => setSelId(x.id)}
                title={x.blurb}
              >
                <span className={`truncate text-[12px] ${x.id === activeId ? 'text-accent' : 'text-fg'}`}>
                  {x.id === activeId ? '● ' : ''}
                  {x.name}
                </span>
                {x.builtin && <span className="ml-1 font-mono text-[8px] text-muted">built-in</span>}
              </button>
              {!x.builtin && (
                <button
                  className="text-muted opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                  onClick={() => {
                    deleteWorld(x.id)
                    if (selId === x.id) setSelId(activeId)
                  }}
                  title="Delete this user World"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </aside>

        {/* ── Editor ────────────────────────────────────────────────── */}
        <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-4">
          {/* name + apply */}
          <div className="flex items-center gap-3">
            <input
              className="input w-64 text-[13px]"
              value={w.name}
              onChange={(e) => updateWorld(w.id, { name: e.target.value })}
              title="World name"
            />
            <button
              className={`rounded border px-3 py-1 font-mono text-[11px] uppercase tracking-wide transition-colors ${
                isActive
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-accent/60 bg-accent/10 text-accent hover:bg-accent/20'
              }`}
              onClick={() => setWorld(w.id)}
              title="Apply this World to the live composition"
            >
              {isActive ? '● Active (re-apply)' : 'Apply to composition'}
            </button>
            {w.builtin && (
              <span className="font-mono text-[10px] text-muted">
                built-in : edits are session-only; “+ New” to keep your own
              </span>
            )}
          </div>
          <input
            className="input w-full max-w-xl text-[11px]"
            value={w.blurb}
            onChange={(e) => updateWorld(w.id, { blurb: e.target.value })}
            title="One-line description"
          />

          <div className="grid min-h-0 max-w-6xl flex-1 grid-cols-[340px_minmax(0,1fr)] gap-6">
           <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
            {/* Coupling */}
            <Section title="A/B Coupling : how the two voices bond">
              <SelRow label="mode" value={w.coupling.mode} options={COUPLING_MODES}
                title={COUPLING_INFO[w.coupling.mode] ?? 'How audio binds the layer’s A and B voices in time.'}
                onChange={(v) => setCoupling({ mode: v as CouplingMode })} />
              <SelRow label="feature" value={w.coupling.feature} options={AUDIO_FEATURES}
                title="Which audio feature drives the coupling (level, flux, transient, centroid, band, pitch)."
                onChange={(v) => setCoupling({ feature: v as AudioFeature })} />
              <SlideRow label="amount" value={w.coupling.amount}
                title="Coupling depth : how far the audio can swing the A/B balance (0 = none)."
                onChange={(v) => setCoupling({ amount: v })} />
              <SlideRow label="tightness" value={w.coupling.tightness}
                title="Response sharpness : vestigial/loose (0) ↔ obvious/snappy (1). Shapes cut release, gate edge, drift speed."
                onChange={(v) => setCoupling({ tightness: v })} />
            </Section>

            {/* Context mood */}
            <Section title="Context mood : depth finalizer (safe bands)">
              {CONTEXT_KEYS.map(({ k, label, hint }) => (
                <SlideRow key={k} label={label} value={w.context[k] ?? 0} title={hint}
                  onChange={(v) => setContext(k, v)} />
              ))}
            </Section>

            {/* Audio routing */}
            <Section title="Audio routing : a default audio modulator (slot M8)">
              <SelRow
                label="target"
                value={w.autoMod?.target ?? 'none'}
                options={WORLD_AUDIO_TARGETS}
                title="Which Context param this World's audio modulator drives when applied (on modulator slot M8). 'none' clears it."
                onChange={(v) => setAutoMod({ target: v as WorldAudioTarget })}
              />
              <SelRow
                label="feature"
                value={w.autoMod?.feature ?? 'transient'}
                options={AUDIO_FEATURES}
                title="Which audio feature the auto-modulator follows."
                onChange={(v) => setAutoMod({ feature: v as AudioFeature })}
              />
              <SlideRow
                label="depth"
                value={w.autoMod?.depth ?? 0.4}
                min={-1}
                title="How strongly the audio moves the target (negative inverts)."
                onChange={(v) => setAutoMod({ depth: v })}
              />
              <p className="mt-1 font-mono text-[9px] leading-tight text-muted">
                Installs an audio modulator on M8 → Context·{w.autoMod?.target ?? 'none'} when applied
                (target “none” clears it). Needs Audio ingest on to move.
              </p>
            </Section>

           </div>

           {/* right column : compact Visualizer + audio driver + full-size live-code */}
           <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
              <Section title="World Visualizer : real generators · simulated audio · A/B">
                {/* Capped width so the whole page fits without scrolling; the
                    live-code editor below keeps its full height. */}
                <div className="mx-auto w-full max-w-[380px]">
                  <WorldVisualizer
                    coupling={w.coupling}
                    context={w.context}
                    audio={audio}
                    sourceIdx={sourceIdx}
                  />
                </div>
                {/* Test material */}
                <div className="flex items-center gap-2">
                  <span className="w-20 shrink-0 font-mono text-[10px] text-muted">material</span>
                  <select
                    className="input select-compact min-w-0 flex-1 text-[11px]"
                    value={sourceIdx}
                    onChange={(e) => setSourceIdx(Number(e.target.value))}
                    title="Which pair of real generators to read the World on (A ↔ B)"
                  >
                    {WORLD_SOURCE_PAIRS.map((p, i) => (
                      <option key={p.name} value={i}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Simulated audio driver + VU meter */}
                <div className="mt-1 flex flex-col gap-2 rounded border border-border bg-panel3/20 p-2">
                  <div className="flex items-center gap-2">
                    <span className="w-20 shrink-0 font-mono text-[9px] uppercase text-muted">sim audio</span>
                    <VuMeter audio={audio} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-20 shrink-0 font-mono text-[10px] text-muted">shape</span>
                    <div className="flex gap-1">
                      {SIM_SHAPES.map((sh) => (
                        <button
                          key={sh}
                          onClick={() => setAud({ shape: sh })}
                          className={`rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
                            audio.shape === sh
                              ? 'bg-accent/20 text-accent ring-1 ring-accent'
                              : 'bg-panel2 text-muted hover:text-text'
                          }`}
                        >
                          {sh}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setAud({ rhythmic: !audio.rhythmic })}
                      className={`ml-auto rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
                        audio.rhythmic
                          ? 'bg-accent/20 text-accent ring-1 ring-accent'
                          : 'bg-panel2 text-muted hover:text-text'
                      }`}
                      title="Rhythmic (pulsing beats) ↔ constant (steady modulation)"
                    >
                      {audio.rhythmic ? 'rhythmic' : 'constant'}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-20 shrink-0 font-mono text-[10px] text-muted">rate</span>
                    <input
                      type="range"
                      min={0.2}
                      max={8}
                      step={0.1}
                      value={audio.freqHz}
                      onChange={(e) => setAud({ freqHz: Number(e.target.value) })}
                      className="min-w-0 flex-1 accent-accent"
                    />
                    <span className="w-12 shrink-0 text-right font-mono text-[10px] text-muted">
                      {audio.freqHz.toFixed(1)}Hz
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-20 shrink-0 font-mono text-[10px] text-muted">level</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={audio.gain}
                      onChange={(e) => setAud({ gain: Number(e.target.value) })}
                      className="min-w-0 flex-1 accent-accent"
                    />
                    <span className="w-12 shrink-0 text-right font-mono text-[10px] text-muted">
                      {audio.gain.toFixed(2)}
                    </span>
                  </div>
                </div>
              </Section>
              <Section title="Live code (JSON) : edit, then Apply">
                <JsonEditor world={w} onApply={(patch) => updateWorld(w.id, patch)} />
              </Section>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

// ── live-code (JSON) editor ─────────────────────────────────────────────
// The editable fields of a World, serialized. Both-way synced: the text follows
// the form (when not being edited); Apply parses it back onto the World.
function worldToJson(w: World): string {
  return JSON.stringify(
    { name: w.name, blurb: w.blurb, coupling: w.coupling, context: w.context, autoMod: w.autoMod },
    null,
    2
  )
}

function JsonEditor({
  world,
  onApply
}: {
  world: World
  onApply: (patch: Partial<World>) => void
}): JSX.Element {
  const [text, setText] = useState(() => worldToJson(world))
  const [err, setErr] = useState<string | null>(null)
  const dirty = useRef(false)
  // Follow the form while the user isn't editing the text (and on world switch).
  useEffect(() => {
    if (!dirty.current) setText(worldToJson(world))
  }, [world])

  const apply = (): void => {
    try {
      const o = JSON.parse(text)
      if (typeof o !== 'object' || !o) throw new Error('not an object')
      const patch: Partial<World> = {}
      if (typeof o.name === 'string') patch.name = o.name
      if (typeof o.blurb === 'string') patch.blurb = o.blurb
      if (o.coupling && typeof o.coupling === 'object') patch.coupling = o.coupling
      if (o.context && typeof o.context === 'object') patch.context = o.context
      patch.autoMod = o.autoMod ?? null
      onApply(patch)
      setErr(null)
      dirty.current = false
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        className="input h-72 w-full resize-y whitespace-pre font-mono text-[10px] leading-tight"
        spellCheck={false}
        value={text}
        onChange={(e) => {
          dirty.current = true
          setText(e.target.value)
        }}
      />
      <div className="flex items-center gap-2">
        <button className="btn text-[11px]" onClick={apply} title="Parse the JSON onto this World">
          Apply JSON
        </button>
        <button
          className="btn text-[11px]"
          onClick={() => {
            dirty.current = false
            setText(worldToJson(world))
            setErr(null)
          }}
          title="Discard edits and reload from the World"
        >
          Revert
        </button>
        {err && <span className="font-mono text-[10px] text-danger">⚠ {err}</span>}
      </div>
    </div>
  )
}

// ── VU meter : mirrors the simulated-audio level the visualizer sees ─────
function VuMeter({ audio }: { audio: SimAudio }): JSX.Element {
  const barRef = useRef<HTMLDivElement | null>(null)
  const flashRef = useRef<HTMLDivElement | null>(null)
  const audioRef = useRef(audio)
  audioRef.current = audio
  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    const tick = (): void => {
      const f = simAudio(audioRef.current, (performance.now() - t0) / 1000)
      if (barRef.current) barRef.current.style.width = `${Math.round(f.level * 100)}%`
      if (flashRef.current) flashRef.current.style.opacity = String(Math.min(1, f.transient))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div className="relative h-2.5 min-w-0 flex-1 overflow-hidden rounded bg-panel2">
      <div ref={barRef} className="h-full rounded bg-accent" style={{ width: '0%' }} />
      <div ref={flashRef} className="pointer-events-none absolute inset-0 bg-accent2" style={{ opacity: 0 }} />
    </div>
  )
}

// ── small form helpers ──────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-panel2/30 p-3">
      <span className="font-mono text-[9px] uppercase tracking-wide text-muted">{title}</span>
      {children}
    </div>
  )
}

function SelRow({
  label,
  value,
  options,
  onChange,
  title
}: {
  label: string
  value: string
  options: readonly string[]
  onChange: (v: string) => void
  title?: string
}): JSX.Element {
  return (
    <div className="flex items-center gap-2" title={title}>
      <span className="w-16 shrink-0 font-mono text-[10px] text-muted">{label}</span>
      <select
        className="input select-compact min-w-0 flex-1 text-[11px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  )
}

function SlideRow({
  label,
  value,
  min = 0,
  onChange,
  title
}: {
  label: string
  value: number
  min?: number
  onChange: (v: number) => void
  title?: string
}): JSX.Element {
  return (
    <div className="flex items-center gap-2" title={title}>
      <span className="w-16 shrink-0 font-mono text-[10px] text-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-accent"
      />
      <span className="w-9 shrink-0 text-right font-mono text-[10px] text-muted">{value.toFixed(2)}</span>
    </div>
  )
}
