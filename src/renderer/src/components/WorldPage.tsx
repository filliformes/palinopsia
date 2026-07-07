// World page (W) — the diegesis editor. A full-page takeover: pick a World from
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
import { WorldVisualizer } from './WorldVisualizer'

const COUPLING_MODES: CouplingMode[] = ['off', 'lean', 'hocket', 'cut', 'gate', 'drift']
const CONTEXT_KEYS: Array<{ k: string; label: string }> = [
  { k: 'trails', label: 'trails' },
  { k: 'blur', label: 'blur' },
  { k: 'bloom', label: 'bloom' },
  { k: 'depth', label: 'depth' },
  { k: 'haze', label: 'haze' }
]

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
          diegesis — the proposed world biasing coupling · Context · audio routing
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
        <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
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
                built-in — edits are session-only; “+ New” to keep your own
              </span>
            )}
          </div>
          <input
            className="input w-full max-w-xl text-[11px]"
            value={w.blurb}
            onChange={(e) => updateWorld(w.id, { blurb: e.target.value })}
            title="One-line description"
          />

          <div className="grid max-w-5xl grid-cols-2 gap-6">
           <div className="flex flex-col gap-4">
            {/* Coupling */}
            <Section title="A/B Coupling — how the two voices bond">
              <SelRow label="mode" value={w.coupling.mode} options={COUPLING_MODES}
                onChange={(v) => setCoupling({ mode: v as CouplingMode })} />
              <SelRow label="feature" value={w.coupling.feature} options={AUDIO_FEATURES}
                onChange={(v) => setCoupling({ feature: v as AudioFeature })} />
              <SlideRow label="amount" value={w.coupling.amount}
                onChange={(v) => setCoupling({ amount: v })} />
              <SlideRow label="tightness" value={w.coupling.tightness}
                onChange={(v) => setCoupling({ tightness: v })} />
            </Section>

            {/* Context mood */}
            <Section title="Context mood — depth finalizer (safe bands)">
              {CONTEXT_KEYS.map(({ k, label }) => (
                <SlideRow key={k} label={label} value={w.context[k] ?? 0}
                  onChange={(v) => setContext(k, v)} />
              ))}
            </Section>

            {/* Audio routing */}
            <Section title="Audio routing — a default audio modulator (slot M8)">
              <SelRow
                label="target"
                value={w.autoMod?.target ?? 'none'}
                options={WORLD_AUDIO_TARGETS}
                onChange={(v) => setAutoMod({ target: v as WorldAudioTarget })}
              />
              <SelRow
                label="feature"
                value={w.autoMod?.feature ?? 'transient'}
                options={AUDIO_FEATURES}
                onChange={(v) => setAutoMod({ feature: v as AudioFeature })}
              />
              <SlideRow
                label="depth"
                value={w.autoMod?.depth ?? 0.4}
                min={-1}
                onChange={(v) => setAutoMod({ depth: v })}
              />
              <p className="mt-1 font-mono text-[9px] leading-tight text-muted">
                Installs an audio modulator on M8 → Context·{w.autoMod?.target ?? 'none'} when applied
                (target “none” clears it). Needs Audio ingest on to move.
              </p>
            </Section>

           </div>

           {/* right column — Visualizer + live-code */}
           <div className="flex flex-col gap-4">
              <Section title="World Visualizer — simulated audio + A/B">
                <WorldVisualizer coupling={w.coupling} context={w.context} />
              </Section>
              <Section title="Live code (JSON) — edit, then Apply">
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
        className="input h-40 w-full resize-none whitespace-pre font-mono text-[10px] leading-tight"
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
  onChange
}: {
  label: string
  value: string
  options: readonly string[]
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
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
  onChange
}: {
  label: string
  value: number
  min?: number
  onChange: (v: number) => void
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
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
