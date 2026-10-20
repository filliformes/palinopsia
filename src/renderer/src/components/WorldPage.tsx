// World page (W) : the diegesis editor. A full-page takeover : pick a World from
// the bank (built-ins + your saved ones, filtered, stepped with the arrow keys,
// Enter applies), edit everything it sets (A/B coupling and the layers it goes
// to · the Context mood · the film character · the audio routing), see what
// Apply will change, and apply it (over the MORPH time). "Take from the
// composition" reads a World back from what is on screen. The World amount (in
// the header, modulatable) blends the active World's mood from what it found.
// Editing the ACTIVE world updates the composite in real time. Three columns
// when they fit, two (then one) and a scrolling page when they don't
// (styles.css, .world-main). A render error stays inside the page.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AudioFeature, CouplingMode, ModTarget, World, WorldAudioTarget } from '@shared/types'
import { WORLD_AUDIO_TARGETS } from '@shared/types'
import { AUDIO_FEATURES } from '../engine/audioIn'
import { modTargetKey, useStore } from '../store'
import { SHADER_BY_ID } from '../shaders/isf'
import {
  builtinChanged, sanitizeWorld, WORLD_CONTEXT_KEYS, WORLD_COUPLING_MODES, WORLD_FILM_KEYS, worldEffects, worldLayers
} from '../worlds'
import { WorldVisualizer, WORLD_SOURCE_PAIRS, liveAudio, simAudio, type SimAudio } from './WorldVisualizer'
import { AssignContext, AssignRow, ModButton, useBound } from './AutoControls'
import { ErrorBoundary } from './ErrorBoundary'

const SIM_SHAPES: SimAudio['shape'][] = ['pulse', 'sine', 'ramp', 'noise']

const COUPLING_MODES = WORLD_COUPLING_MODES
const COUPLING_INFO: Record<string, string> = {
  off: 'off : the two voices are independent (no audio binding)',
  lean: 'lean : audio gently pushes the A/B balance toward B (continuous)',
  hocket: 'hocket : audio flips the balance A↔B (percussive, alternating)',
  cut: 'cut : a transient flashes to B, then releases (on-beat, punchy)',
  gate: 'gate : B while loud, A while quiet (a threshold)',
  drift: 'drift : slow momentum follow, sharing direction not shape'
}
// A World switched to film starts from a gentle hand-made character.
const FILM_START: Record<string, number> = {
  filmHold: 1, filmRate: 8, filmJitter: 0.3, filmBoil: 0.35, filmFlutter: 0.2, filmBlank: 0,
  filmDust: 0.2, filmScratch: 0.2, filmHair: 0, filmGranule: 0, filmSplice: 0
}
const AMOUNT_TARGET: ModTarget = { kind: 'world', field: 'amount' }

function lsBool(key: string, d: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? d : v === '1'
  } catch {
    return d
  }
}

export function WorldPage(): JSX.Element {
  const close = useStore((s) => s.setWorldPageOpen)
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      {/* header */}
      <div className="flex items-center gap-3 border-b border-border bg-panel px-4 py-2">
        <span className="font-mono text-[13px] font-semibold uppercase tracking-wide text-accent">
          ◵ World
        </span>
        <span className="font-mono text-[10px] text-muted">
          diegesis : the proposed world biasing coupling · Context · film · audio routing
        </span>
        <div className="flex-1" />
        <WorldAmount />
        <button className="btn text-[12px]" onClick={() => close(false)} title="Close (W / Esc)">
          ✕ Close
        </button>
      </div>
      {/* a render error shows here, with Close above it, instead of taking the app down */}
      <div className="flex min-h-0 flex-1 flex-col">
        <ErrorBoundary>
          <WorldEditor />
        </ErrorBoundary>
      </div>
    </div>
  )
}

function WorldEditor(): JSX.Element {
  const worlds = useStore((s) => s.worlds)
  const activeId = useStore((s) => s.world)
  const composition = useStore((s) => s.composition)
  const setWorld = useStore((s) => s.setWorld)
  const addWorld = useStore((s) => s.addWorld)
  const updateWorld = useStore((s) => s.updateWorld)
  const deleteWorld = useStore((s) => s.deleteWorld)
  const resetWorld = useStore((s) => s.resetWorld)
  const saveAsMine = useStore((s) => s.saveWorldAsMine)
  const takeWorld = useStore((s) => s.takeWorldFromComposition)

  // Which world the editor is pointed at (defaults to the active one).
  const [selId, setSelId] = useState(activeId)
  const [filter, setFilter] = useState('')
  const w = worlds.find((x) => x.id === selId) ?? worlds[0]
  const isActive = w.id === activeId
  const changed = w.builtin && builtinChanged(w)

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return f ? worlds.filter((x) => (x.name + ' ' + x.blurb).toLowerCase().includes(f)) : worlds
  }, [worlds, filter])

  // ← → ↑ ↓ step through the (filtered) bank, Enter applies : not while typing in
  // a field (the filter takes ↑ ↓ and Enter itself, ← → stay its caret's), and
  // Enter on a focused button presses that button (a World in the bank applies).
  // A held Enter applies once.
  const shownRef = useRef(shown)
  shownRef.current = shown
  const selRef = useRef(selId)
  selRef.current = selId
  const step = (dir: 1 | -1): void => {
    const list = shownRef.current
    if (!list.length) return
    const i = list.findIndex((x) => x.id === selRef.current)
    // the selected one filtered out : ↓ lands on the first match, ↑ on the last
    const j = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length
    setSelId(list[j].id)
  }
  const applySelected = (): void => {
    const list = shownRef.current
    // the selected one filtered out : the first match
    const id = list.some((x) => x.id === selRef.current) ? selRef.current : list[0]?.id
    if (!id) return
    setSelId(id)
    setWorld(id)
  }
  const keysRef = useRef({ step, applySelected })
  keysRef.current = { step, applySelected }
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault(); e.stopPropagation()
        keysRef.current.step(1)
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault(); e.stopPropagation()
        keysRef.current.step(-1)
      } else if (e.key === 'Enter') {
        if (t?.closest('button, a, summary, [role="button"]') && !t.closest('[data-world-item]')) return
        e.preventDefault(); e.stopPropagation()
        if (!e.repeat) keysRef.current.applySelected()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // Visualizer test material + simulated (or live) audio driver.
  const [sourceIdx, setSourceIdx] = useState(0)
  const [audio, setAudio] = useState<SimAudio>({ shape: 'pulse', freqHz: 2, rhythmic: true, gain: 0.9 })
  const setAud = (p: Partial<SimAudio>): void => setAudio((a) => ({ ...a, ...p }))
  // Your own layers' generators as material (the first two that are generators).
  const mine = useMemo(() => {
    const ids: string[] = []
    for (const l of composition.layers)
      for (const s of [l.sourceA, l.sourceB]) {
        const d = s?.shaderId ? SHADER_BY_ID[s.shaderId] : undefined
        if (s?.kind === 'generator' && d && !d.native && !ids.includes(d.id)) ids.push(d.id)
      }
    return ids.length >= 2 ? { a: ids[0], b: ids[1] } : ids.length === 1 ? { a: ids[0], b: ids[0] } : null
  }, [composition.layers])
  // Your layers gone as material : back to the first built-in pair (the menu
  // would else show a choice it no longer has).
  useEffect(() => {
    if (!mine && sourceIdx < 0) setSourceIdx(0)
  }, [mine, sourceIdx])
  const [jsonOpen, setJsonOpen] = useState(() => lsBool('opsia.worldJsonOpen', false))

  const setCoupling = (partial: Partial<typeof w.coupling>): void =>
    updateWorld(w.id, { coupling: { ...w.coupling, ...partial } })
  const setContext = (k: string, v: number): void =>
    updateWorld(w.id, { context: { ...w.context, [k]: v } })
  const setFilm = (k: string, v: number): void =>
    updateWorld(w.id, { finalizer: { ...(w.finalizer ?? FILM_START), [k]: v } })
  const setAutoMod = (partial: Partial<NonNullable<typeof w.autoMod>>): void => {
    const base = w.autoMod ?? { feature: 'transient' as AudioFeature, target: 'haze' as WorldAudioTarget, depth: 0.4 }
    updateWorld(w.id, { autoMod: { ...base, ...partial } })
  }
  const layersOn = worldLayers(w)
  const effects = worldEffects(w, composition)

  return (
      <div className="flex min-h-0 flex-1">
        {/* ── World bank ────────────────────────────────────────────── */}
        <aside className="flex w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-panel2/40 p-2">
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
          <input
            className="input mb-1 w-full px-1.5 py-0.5 text-[11px]"
            placeholder="filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); step(1) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1) }
              else if (e.key === 'Enter') { e.preventDefault(); if (!e.repeat) applySelected() }
            }}
            title="Show only the Worlds whose name or description has this. ↑ ↓ step through them (here too), Enter applies; ← → step too, outside the filter."
          />
          {shown.map((x) => (
            <div
              key={x.id}
              className={`group flex items-start gap-1 rounded px-2 py-1 ${
                x.id === selId ? 'bg-accent/15 ring-1 ring-accent/50' : 'hover:bg-panel3/40'
              }`}
            >
              <button data-world-item className="min-w-0 flex-1 text-left" onClick={() => setSelId(x.id)} onDoubleClick={() => setWorld(x.id)} title="Click : edit · double-click or Enter : apply">
                <span className={`block truncate text-[12px] ${x.id === activeId ? 'text-accent' : 'text-fg'}`}>
                  {x.id === activeId ? '● ' : ''}
                  {x.name}
                  {x.builtin && <span className="ml-1 font-mono text-[9px] text-muted">built-in</span>}
                  {x.builtin && builtinChanged(x) && <span className="ml-1 text-[9px] text-[rgb(217_164_65)]" title="Changed this session">●</span>}
                </span>
                <span className="line-clamp-2 block text-[9px] leading-tight text-muted">{x.blurb}</span>
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
          {!shown.length && <span className="px-2 text-[10px] text-muted">No World matches.</span>}
        </aside>

        {/* ── Editor ────────────────────────────────────────────────── */}
        <main className="world-main flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {/* name + apply + take + built-in state */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input w-56 text-[13px]"
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
              title="Apply this World to the live composition, over the MORPH time (Enter)"
            >
              {isActive ? '● Active (re-apply)' : 'Apply to composition'}
            </button>
            <button
              className="btn text-[11px]"
              onClick={() => setSelId(takeWorld(w.id))}
              title={w.builtin
                ? 'Make a new World from what is on screen : the coupling, the Context mood, the film character, the audio routing (a built-in stays as it is)'
                : 'Set this World from what is on screen : the coupling, the Context mood, the film character, the audio routing'}
            >
              take from composition
            </button>
            {changed && (
              <>
                <span className="font-mono text-[10px] text-[rgb(217_164_65)]" title="This built-in differs from how it ships (this session only)">● changed</span>
                <button
                  className="btn text-[11px]"
                  onClick={() => setSelId(saveAsMine(w.id))}
                  title="Keep these settings as your own World (it takes over as the active one, the picture unchanged), and put the built-in back as it ships"
                >
                  save as mine
                </button>
                <button className="btn text-[11px]" onClick={() => resetWorld(w.id)} title="Put this built-in back as it ships">
                  reset
                </button>
              </>
            )}
            {w.builtin && !changed && (
              <span className="font-mono text-[10px] text-muted">built-in : edits last this session; save as mine keeps them</span>
            )}
          </div>
          <input
            className="input w-full max-w-xl text-[11px]"
            value={w.blurb}
            onChange={(e) => updateWorld(w.id, { blurb: e.target.value })}
            title="One-line description"
          />
          {/* What Apply will change */}
          <div className="flex max-w-6xl flex-wrap gap-x-4 gap-y-0.5 rounded border border-border bg-panel2/30 px-3 py-1.5 font-mono text-[10px] text-muted" title="What applying this World changes in the composition">
            <span className="uppercase tracking-wide text-[9px]">apply sets</span>
            {effects.map((e) => (
              <span key={e} className={/skipped/.test(e) ? 'text-[rgb(217_164_65)]' : 'text-text'}>{e}</span>
            ))}
          </div>

          <div className="world-grid grid min-h-0 max-w-6xl flex-1 grid-cols-[minmax(260px,320px)_minmax(260px,320px)_minmax(280px,1fr)] gap-4">
           <div className="world-col no-scrollbar flex min-h-0 flex-col gap-3 overflow-y-auto">
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
              <div className="flex items-center gap-2" title="Which layers get this coupling : a layer left out keeps its own">
                <span className="w-16 shrink-0 font-mono text-[10px] text-muted">layers</span>
                {layersOn.map((on, i) => (
                  <button
                    key={i}
                    onClick={() => updateWorld(w.id, { layers: layersOn.map((x, j) => (j === i ? !x : x)) })}
                    className={`rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
                      on ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel2 text-muted hover:text-text'
                    }`}
                  >
                    L{i + 1}
                  </button>
                ))}
              </div>
            </Section>

            {/* Film character */}
            <Section title="Film character : the Finalizer's film">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateWorld(w.id, { finalizer: w.finalizer ? undefined : { ...FILM_START } })}
                  className={`rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
                    w.finalizer ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel2 text-muted hover:text-text'
                  }`}
                  title="A film World holds frames and wears dust, scratches and hair; without film, applying it switches the film off"
                >
                  {w.finalizer ? 'film on' : 'film off'}
                </button>
                <span className="font-mono text-[9px] text-muted">{w.finalizer ? 'hand-made film : held frames, boil, damage' : 'applying it turns the film off'}</span>
              </div>
              {w.finalizer &&
                WORLD_FILM_KEYS.map((f) =>
                  f.labels ? (
                    <SelRow key={f.k} label={f.label} value={f.labels[Math.round(w.finalizer?.[f.k] ?? 0)] ?? f.labels[0]} options={f.labels}
                      onChange={(v) => setFilm(f.k, Math.max(0, f.labels!.indexOf(v)))} />
                  ) : (
                    <SlideRow key={f.k} label={f.label} value={w.finalizer?.[f.k] ?? FILM_START[f.k] ?? 0} min={f.min} max={f.max} step={f.step}
                      onChange={(v) => setFilm(f.k, v)} />
                  )
                )}
            </Section>

           </div>
           <div className="world-col no-scrollbar flex min-h-0 flex-col gap-3 overflow-y-auto">
            {/* Context mood */}
            <Section title="Context mood : depth finalizer">
              {WORLD_CONTEXT_KEYS.map(({ k, label, hint }) => (
                <SlideRow key={k} label={label} value={typeof w.context[k] === 'number' ? w.context[k] : 0} title={hint}
                  dim={!(k in w.context)}
                  onChange={(v) => setContext(k, v)} />
              ))}
              <p className="font-mono text-[9px] leading-tight text-muted">A dim key is not part of this World yet : move it to make it one. Blur stays yours.</p>
            </Section>

            {/* Audio routing */}
            <Section title="Audio routing : a default audio modulator">
              <SelRow
                label="target"
                value={w.autoMod?.target ?? 'none'}
                options={WORLD_AUDIO_TARGETS}
                title="Which Context param this World's audio modulator drives when applied. 'none' installs none."
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
                Installs an audio modulator in the first free slot from M8 down (or the one a World installed
                before), never one of yours. Change it or its binding and it becomes yours. Needs the audio
                input on to move.
              </p>
            </Section>
           </div>

           {/* right column : the visualizer + its audio driver, then the JSON
               (folded by default; open, it takes the remaining height). Narrow,
               it goes under the other two, across both. */}
           <div className="world-col world-col-wide no-scrollbar flex min-h-0 flex-col gap-3 overflow-y-auto">
              <Section title="World Visualizer : real generators · simulated or live audio · A/B">
                <div className="mx-auto w-full max-w-[380px]">
                  <WorldVisualizer
                    coupling={w.coupling}
                    context={w.context}
                    audio={audio}
                    sourceIdx={sourceIdx}
                    mine={mine}
                  />
                </div>
                {/* Test material */}
                <div className="flex items-center gap-2">
                  <span className="w-20 shrink-0 font-mono text-[10px] text-muted">material</span>
                  <select
                    className="input select-compact min-w-0 flex-1 text-[11px]"
                    value={sourceIdx}
                    onChange={(e) => setSourceIdx(Number(e.target.value))}
                    title="Which pair of real generators to read the World on (A ↔ B), yours included"
                  >
                    {mine && (
                      <option value={-1}>
                        your layers ({SHADER_BY_ID[mine.a]?.name ?? mine.a} × {SHADER_BY_ID[mine.b]?.name ?? mine.b})
                      </option>
                    )}
                    {WORLD_SOURCE_PAIRS.map((p, i) => (
                      <option key={p.name} value={i}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Audio driver + VU meter */}
                <div className="mt-1 flex flex-col gap-2 rounded border border-border bg-panel3/20 p-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setAud({ live: !audio.live })}
                      className={`w-20 shrink-0 rounded px-1 py-0.5 font-mono text-[9px] uppercase transition-colors ${
                        audio.live ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel2 text-muted hover:text-text'
                      }`}
                      title="Drive the preview with the real sound (the audio tab's input : a device, OSC or the Audio Layer) instead of the simulation"
                    >
                      {audio.live ? 'live sound' : 'sim audio'}
                    </button>
                    <VuMeter audio={audio} />
                  </div>
                  {!audio.live && (
                    <>
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
                    </>
                  )}
                </div>
              </Section>
              <div className={`flex flex-col gap-2 rounded border border-border bg-panel2/30 p-3 ${jsonOpen ? 'min-h-[180px] flex-1' : ''}`}>
                <button
                  className="flex items-center gap-1.5 text-left"
                  onClick={() => {
                    const v = !jsonOpen
                    setJsonOpen(v)
                    try { localStorage.setItem('opsia.worldJsonOpen', v ? '1' : '0') } catch { /* private storage */ }
                  }}
                  title={jsonOpen ? 'Fold the live code' : 'Open the live code : the whole World as JSON, editable'}
                >
                  <span className={`font-mono text-[9px] text-muted transition-transform ${jsonOpen ? 'rotate-90' : ''}`}>▶</span>
                  <span className="font-mono text-[9px] uppercase tracking-wide text-muted">Live code (JSON) : edit, then Apply</span>
                </button>
                {jsonOpen && <JsonEditor world={w} onApply={(patch) => updateWorld(w.id, patch)} />}
              </div>
            </div>
          </div>
        </main>
      </div>
  )
}

/** The World amount : how much of the active World's mood is on, live (0 = the
 *  mood it found). A slider, its M (any modulator), OSC /opsia/world/amount. */
function WorldAmount(): JSX.Element {
  const amount = useStore((s) => s.worldAmount)
  const setAmount = useStore((s) => s.setWorldAmount)
  const key = modTargetKey(AMOUNT_TARGET)
  const bound = useBound(key)
  const [open, setOpen] = useState(false)
  return (
    <AssignContext.Provider value={{ onAssign: () => setOpen((o) => !o), activeKey: open ? key : null }}>
      <div className="relative flex items-center gap-2" title="How much of the active World's mood is on : 0 = the mood it found, 1 = all of it. Fades the Context mood and the film the World set; modulatable, OSC /opsia/world/amount">
        <span className="font-mono text-[9px] uppercase tracking-wide text-muted">amount</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          onDoubleClick={() => setAmount(1)}
          className="w-32 accent-accent"
        />
        <span className="w-8 font-mono text-[10px] text-text">{amount.toFixed(2)}</span>
        <ModButton target={AMOUNT_TARGET} bound={bound} label="World amount" />
        {open && (
          <div className="absolute right-0 top-full z-50 mt-1 w-[360px] rounded border border-border bg-panel p-2 shadow-lg">
            <AssignRow target={AMOUNT_TARGET} bound={bound} />
          </div>
        )}
      </div>
    </AssignContext.Provider>
  )
}

// ── live-code (JSON) editor ─────────────────────────────────────────────
// The editable fields of a World, serialized. Both-way synced: the text follows
// the form (when not being edited); Apply parses it back onto the World.
function worldToJson(w: World): string {
  return JSON.stringify(
    { name: w.name, blurb: w.blurb, coupling: w.coupling, layers: worldLayers(w), context: w.context, finalizer: w.finalizer ?? null, autoMod: w.autoMod },
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
  const [note, setNote] = useState<string | null>(null) // applied, with values fixed
  const dirty = useRef(false)
  // Follow the form while the user isn't editing the text (and on world switch).
  useEffect(() => {
    if (!dirty.current) setText(worldToJson(world))
  }, [world])
  // Another World : its own text, and nothing said about the last one.
  useEffect(() => {
    dirty.current = false
    setText(worldToJson(world))
    setErr(null)
    setNote(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world.id])

  const apply = (): void => {
    try {
      const o = JSON.parse(text)
      if (typeof o !== 'object' || !o || Array.isArray(o)) throw new Error('not an object')
      // What the text leaves out stays as it is (the coupling field by field),
      // except the film and the audio routing : absent = none. Then the World
      // goes through the same check as one read from a file, so nothing typed
      // here can break the page or the picture : what had to change is named.
      const isObj = (v: unknown): boolean => !!v && typeof v === 'object' && !Array.isArray(v)
      const fixed: string[] = []
      const clean = sanitizeWorld(
        {
          ...world,
          name: typeof o.name === 'string' ? o.name : world.name,
          blurb: typeof o.blurb === 'string' ? o.blurb : world.blurb,
          coupling: isObj(o.coupling) ? { ...world.coupling, ...o.coupling } : o.coupling === undefined ? world.coupling : o.coupling,
          layers: o.layers === undefined ? world.layers : o.layers,
          context: o.context === undefined ? world.context : o.context,
          finalizer: o.finalizer ?? undefined,
          autoMod: o.autoMod ?? null
        },
        fixed
      )
      if (!clean) throw new Error('not a World')
      const { name, blurb, coupling, layers, context, finalizer, autoMod } = clean
      onApply({ name, blurb, coupling, layers, context, finalizer, autoMod })
      setErr(null)
      setNote(fixed.length ? `applied; fixed : ${fixed.join(', ')}` : null)
      dirty.current = false
      // the text shows the World as it now is (fixed values included)
      setText(worldToJson({ ...world, ...clean }))
    } catch (e) {
      setErr((e as Error).message)
      setNote(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <textarea
        className="input min-h-[120px] w-full flex-1 resize-none whitespace-pre font-mono text-[10px] leading-tight"
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
            setNote(null)
          }}
          title="Discard edits and reload from the World"
        >
          Revert
        </button>
        {err && <span className="font-mono text-[10px] text-danger">⚠ {err}</span>}
        {!err && note && <span className="font-mono text-[10px] text-[rgb(217_164_65)]" title="Out-of-range or unknown values were brought back to what the World takes">{note}</span>}
      </div>
    </div>
  )
}

// ── VU meter : what the visualizer hears (simulated, or the live sound) ──
function VuMeter({ audio }: { audio: SimAudio }): JSX.Element {
  const barRef = useRef<HTMLDivElement | null>(null)
  const flashRef = useRef<HTMLDivElement | null>(null)
  const audioRef = useRef(audio)
  audioRef.current = audio
  useEffect(() => {
    let raf = 0
    const t0 = performance.now()
    const tick = (): void => {
      const a = audioRef.current
      const f = a.live ? liveAudio() : simAudio(a, (performance.now() - t0) / 1000)
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
function Section({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }): JSX.Element {
  return (
    <div className={`flex flex-col gap-1.5 rounded border border-border bg-panel2/30 p-2.5 ${className}`}>
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
  max = 1,
  step = 0.01,
  dim = false,
  onChange,
  title
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  dim?: boolean
  onChange: (v: number) => void
  title?: string
}): JSX.Element {
  const v = Number.isFinite(value) ? value : min // never a readout that throws
  return (
    <div className={`flex items-center gap-2 ${dim ? 'opacity-50' : ''}`} title={title}>
      <span className="w-16 shrink-0 font-mono text-[10px] text-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-accent"
      />
      <span className="w-9 shrink-0 text-right font-mono text-[10px] text-muted">{step >= 1 ? Math.round(v) : v.toFixed(2)}</span>
    </div>
  )
}
