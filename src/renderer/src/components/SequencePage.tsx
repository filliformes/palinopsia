// SequencePage — the macro-form "auto-pilot" over the scene bank (S1 + S2).
// A full page (peer of World / Output). Left: the scene rail as tagged cards +
// a tag editor. Right: the sequencer transport + the macro-form overlays
// (Breathe, Climate arc) with a live arc/countdown meter. See
// docs/opsia-sequencer-spec.md.

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { CouplingMode, SceneClimate } from '@shared/types'
import { SCENE_CLIMATES } from '@shared/types'
import { useStore } from '../store'
import {
  sequencerArcIntensity,
  sequencerArmed,
  sequencerCountdownMs,
  sequencerScoreMarkdown,
  sequencerSkip
} from '../engine/sequencer'

const SYNCHRESIS: CouplingMode[] = ['lean', 'hocket', 'cut', 'gate', 'drift']
const CLIMATE_COLOR: Record<SceneClimate, string> = {
  tension: '#e0564a',
  expectation: '#e0a24a',
  release: '#5aa9e0',
  resolution: '#6bd08a'
}

export function SequencePage({
  canvasRef
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>
}): JSX.Element {
  const setOpen = useStore((s) => s.setSequencePageOpen)
  const scenes = useStore(useShallow((s) => s.scenes))
  const activeSceneId = useStore((s) => s.activeSceneId)
  const worlds = useStore(useShallow((s) => s.worlds))
  const seq = useStore((s) => s.sequence)
  const setSequence = useStore((s) => s.setSequence)
  const toggleRunning = useStore((s) => s.toggleSequenceRunning)
  const ensureSceneTags = useStore((s) => s.ensureSceneTags)
  const setSceneTags = useStore((s) => s.setSceneTags)
  const recallScene = useStore((s) => s.recallScene)

  const [sel, setSel] = useState<string | null>(activeSceneId)

  // Make sure every scene has tags to show/edit.
  useEffect(() => {
    scenes.forEach((s) => ensureSceneTags(s.id))
  }, [scenes, ensureSceneTags])

  const selScene = scenes.find((s) => s.id === sel) ?? null
  const worldName = (id: string): string => worlds.find((w) => w.id === id)?.name ?? id

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      <header className="flex items-center gap-4 border-b border-border bg-panel px-4 py-2">
        <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.2em]">Sequence · Macro-form</span>
        <button
          onClick={toggleRunning}
          className={`rounded border px-3 py-1 font-mono text-[11px] transition-colors ${
            seq.running
              ? 'border-danger bg-danger/20 text-danger hover:bg-danger/30'
              : 'border-accent bg-accent/15 text-accent hover:bg-accent/25'
          }`}
          disabled={scenes.length < 2}
          title={scenes.length < 2 ? 'Need at least 2 scenes' : seq.running ? 'Stop the auto-pilot' : 'Start the auto-pilot'}
        >
          {seq.running ? '■ stop' : '▶ play'}
        </button>
        <button
          onClick={() => sequencerSkip()}
          disabled={scenes.length < 2}
          className="rounded border border-border px-3 py-1 font-mono text-[11px] text-muted hover:text-accent disabled:opacity-40"
          title="Advance to the next scene now"
        >
          skip →
        </button>
        <button
          onClick={() => {
            const md = sequencerScoreMarkdown()
            if (!md) return
            const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }))
            const a = document.createElement('a')
            a.href = url
            a.download = 'opsia-relation-score.md'
            a.click()
            URL.revokeObjectURL(url)
          }}
          className="rounded border border-border px-3 py-1 font-mono text-[11px] text-muted hover:text-accent"
          title="Export the run as a relation-score (ordered AVUs, Markdown)"
        >
          ⤓ score
        </button>
        <NowMeter running={seq.running} />
        <div className="flex-1" />
        <button
          onClick={() => setOpen(false)}
          className="rounded border border-border px-3 py-1 font-mono text-[11px] text-muted hover:text-accent"
        >
          ← back to instrument
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Scene column: scrolling rail + a live preview pinned at the bottom. */}
        <div className="flex min-w-0 flex-1 flex-col">
         <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
          <span className="font-mono text-[9px] uppercase tracking-wide text-muted">
            scenes · {scenes.length} — click to tag
          </span>
          {scenes.length === 0 && (
            <p className="text-[12px] text-muted">
              No scenes yet. Save a few scenes in the instrument, then tag them here to give the
              sequencer a world to wander.
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
            {scenes.map((s) => {
              const t = s.tags
              const isCur = s.id === activeSceneId
              const isSel = s.id === sel
              return (
                <button
                  key={s.id}
                  onClick={() => setSel(s.id)}
                  onDoubleClick={() => recallScene(s.id)}
                  className={`flex flex-col gap-1.5 rounded-md border p-2 text-left transition-colors ${
                    isSel ? 'border-accent bg-accent/10' : 'border-border bg-panel hover:border-accent/50'
                  }`}
                  title="Click to edit tags · double-click to jump to this scene"
                >
                  <div className="flex items-center gap-1.5">
                    {t && (
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: CLIMATE_COLOR[t.climate] }}
                        title={t.climate}
                      />
                    )}
                    <span className={`min-w-0 flex-1 truncate text-[12px] ${isCur ? 'text-accent' : 'text-text'}`}>
                      {s.name}
                    </span>
                    {isCur && <span className="shrink-0 font-mono text-[8px] text-accent">▶ now</span>}
                  </div>
                  {t && (
                    <>
                      <div className="flex items-center gap-1 font-mono text-[8px] text-muted">
                        <span className="rounded bg-panel2 px-1 py-0.5 text-accent2">{worldName(t.world)}</span>
                        <span className="truncate">{t.synchresis.join('·') || '—'}</span>
                      </div>
                      {/* Espace-temps bar: full ◀ ▶ void */}
                      <div className="h-1 w-full overflow-hidden rounded-full bg-panel2">
                        <div className="h-full bg-accent/60" style={{ width: `${t.spaceTime * 100}%` }} />
                      </div>
                    </>
                  )}
                </button>
              )
            })}
          </div>

          {/* Tag editor */}
          {selScene?.tags && (
            <div className="mt-2 flex flex-col gap-3 rounded-md border border-border bg-panel p-3">
              <span className="font-mono text-[9px] uppercase tracking-wide text-muted">
                tags · {selScene.name}
              </span>
              <Field label="Diégèse (world)">
                <select
                  className="input select-compact w-full text-[11px]"
                  value={selScene.tags.world}
                  onChange={(e) => setSceneTags(selScene.id, { world: e.target.value })}
                >
                  {worlds.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Synchrèse (coupling)">
                <div className="flex flex-wrap gap-1">
                  {SYNCHRESIS.map((m) => {
                    const on = selScene.tags!.synchresis.includes(m)
                    return (
                      <button
                        key={m}
                        onClick={() => {
                          const cur = selScene.tags!.synchresis
                          setSceneTags(selScene.id, {
                            synchresis: on ? cur.filter((x) => x !== m) : [...cur, m]
                          })
                        }}
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                          on ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel2 text-muted hover:text-text'
                        }`}
                      >
                        {m}
                      </button>
                    )
                  })}
                </div>
              </Field>
              <Field label={`Espace-temps · ${selScene.tags.spaceTime < 0.4 ? 'full' : selScene.tags.spaceTime > 0.6 ? 'void' : 'neutral'}`}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selScene.tags.spaceTime}
                  onChange={(e) => setSceneTags(selScene.id, { spaceTime: Number(e.target.value) })}
                  className="w-full accent-accent"
                  title="0 = dense / full · 1 = sparse / void"
                />
              </Field>
              <Field label="Climat">
                <div className="flex flex-wrap gap-1">
                  {SCENE_CLIMATES.map((c) => {
                    const on = selScene.tags!.climate === c
                    return (
                      <button
                        key={c}
                        onClick={() => setSceneTags(selScene.id, { climate: c })}
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                          on ? 'text-black' : 'bg-panel2 text-muted hover:text-text'
                        }`}
                        style={on ? { background: CLIMATE_COLOR[c] } : undefined}
                      >
                        {c}
                      </button>
                    )
                  })}
                </div>
              </Field>
            </div>
          )}
         </div>
         {/* Live composition mirror — pinned at the bottom so you SEE the run. */}
         <SeqPreview canvasRef={canvasRef} />
        </div>

        {/* Transport + macro-form */}
        <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-panel p-4">
          <Section title="Transport">
            <Row label={`dwell · ${seq.dwell.toFixed(0)}s`}>
              <input type="range" min={2} max={60} step={1} value={seq.dwell}
                onChange={(e) => setSequence({ dwell: Number(e.target.value) })}
                className="w-full accent-accent" />
            </Row>
            <Row label={`humanise · ${Math.round(seq.dwellJitter * 100)}%`}>
              <input type="range" min={0} max={1} step={0.01} value={seq.dwellJitter}
                onChange={(e) => setSequence({ dwellJitter: Number(e.target.value) })}
                className="w-full accent-accent" />
            </Row>
            <Row label="transition">
              <select className="input select-compact w-full text-[11px]" value={seq.transition}
                onChange={(e) => setSequence({ transition: e.target.value as typeof seq.transition })}>
                <option value="morph">morph (crossfade)</option>
                <option value="cut">cut (hard)</option>
                <option value="auto">auto (per Synchrèse)</option>
              </select>
            </Row>
            {seq.transition !== 'cut' && (
              <Row label={`crossfade · ${(seq.crossfadeMs / 1000).toFixed(1)}s`}>
                <input type="range" min={0} max={8000} step={100} value={seq.crossfadeMs}
                  onChange={(e) => setSequence({ crossfadeMs: Number(e.target.value) })}
                  className="w-full accent-accent" />
              </Row>
            )}
            <Row label="advance on">
              <select className="input select-compact w-full text-[11px]" value={seq.audioAdvance}
                onChange={(e) => setSequence({ audioAdvance: e.target.value as typeof seq.audioAdvance })}
                title="Timer, or hold until an audio/chaos event fires the step (deferred synchresis)">
                <option value="off">timer (dwell)</option>
                <option value="transient">dwell, then audio transient</option>
                <option value="onset">dwell, then audio onset</option>
                <option value="chaos">dwell, then chaos peak</option>
              </select>
            </Row>
          </Section>

          <Section title="Selection">
            <Row label="mode">
              <select className="input select-compact w-full text-[11px]" value={seq.mode}
                onChange={(e) => setSequence({ mode: e.target.value as typeof seq.mode })}>
                <option value="weighted">weighted (tag-guided wander)</option>
                <option value="arc">arc (climate-shaped)</option>
                <option value="shuffle">shuffle (flat random)</option>
              </select>
            </Row>
            <Row label={`no-repeat · last ${seq.noRepeat}`}>
              <input type="range" min={0} max={8} step={1} value={seq.noRepeat}
                onChange={(e) => setSequence({ noRepeat: Number(e.target.value) })}
                className="w-full accent-accent" />
            </Row>
            <Row label={`variation · ${Math.round(seq.variation * 100)}%`}>
              <input type="range" min={0} max={0.6} step={0.01} value={seq.variation}
                onChange={(e) => setSequence({ variation: Number(e.target.value) })}
                className="w-full accent-accent"
                title="Per-recall jitter so a long set never loops verbatim" />
            </Row>
          </Section>

          <Section title="Breathe (Espace-temps)">
            <Row label={`amount · ${Math.round(seq.breathe.amount * 100)}%`}>
              <input type="range" min={0} max={1} step={0.01} value={seq.breathe.amount}
                onChange={(e) => setSequence({ breathe: { ...seq.breathe, amount: Number(e.target.value) } })}
                className="w-full accent-accent2" />
            </Row>
            <Row label={`period · ${seq.breathe.periodSec.toFixed(0)}s`}>
              <input type="range" min={4} max={120} step={1} value={seq.breathe.periodSec}
                onChange={(e) => setSequence({ breathe: { ...seq.breathe, periodSec: Number(e.target.value) } })}
                className="w-full accent-accent2" />
            </Row>
            <p className="text-[10px] leading-tight text-muted">
              Oscillates the composition toward dense↔void around each scene's Espace-temps tag
              (Context haze / depth / blur).
            </p>
          </Section>

          <Section title="Climate arc">
            <label className="flex items-center gap-2 text-[11px] text-muted">
              <input type="checkbox" checked={seq.arc.enabled}
                onChange={(e) => setSequence({ arc: { ...seq.arc, enabled: e.target.checked } })} />
              enable Repose–Disturbance–Repose
            </label>
            {seq.arc.enabled && (
              <Row label={`length · ${seq.arc.lengthSec.toFixed(0)}s`}>
                <input type="range" min={20} max={600} step={5} value={seq.arc.lengthSec}
                  onChange={(e) => setSequence({ arc: { ...seq.arc, lengthSec: Number(e.target.value) } })}
                  className="w-full accent-accent2" />
              </Row>
            )}
            <ArcMeter enabled={seq.arc.enabled && seq.running} />
          </Section>

          <Section title="Punctuation">
            <Row label={`cadence · ${seq.cadenceEvery === 0 ? 'off' : `every ${seq.cadenceEvery}`}`}>
              <input type="range" min={0} max={8} step={1} value={seq.cadenceEvery}
                onChange={(e) => setSequence({ cadenceEvery: Number(e.target.value) })}
                className="w-full accent-accent2"
                title="Resolve to isomorphy (A/B fuse) every N transitions — a felt arrival" />
            </Row>
            <Row label={`rupture · ${Math.round(seq.ruptureChance * 100)}%`}>
              <input type="range" min={0} max={1} step={0.01} value={seq.ruptureChance}
                onChange={(e) => setSequence({ ruptureChance: Number(e.target.value) })}
                className="w-full accent-accent2"
                title="Chance a transition becomes a controlled-chaos burst that resolves into the next scene" />
            </Row>
            <Row label={`monomedia · ${Math.round(seq.monomediaChance * 100)}%`}>
              <input type="range" min={0} max={1} step={0.01} value={seq.monomediaChance}
                onChange={(e) => setSequence({ monomediaChance: Number(e.target.value) })}
                className="w-full accent-accent2"
                title="Chance a transition drops one medium as a tension marker" />
            </Row>
            {seq.monomediaChance > 0 && (
              <Row label="monomedia style">
                <div className="flex gap-1">
                  {(['black', 'freeze'] as const).map((st) => (
                    <button
                      key={st}
                      onClick={() => setSequence({ monomediaStyle: st })}
                      className={`flex-1 rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
                        seq.monomediaStyle === st
                          ? 'bg-accent/20 text-accent ring-1 ring-accent'
                          : 'bg-panel2 text-muted hover:text-text'
                      }`}
                    >
                      {st === 'black' ? 'fade to black' : 'freeze frame'}
                    </button>
                  ))}
                </div>
              </Row>
            )}
            <p className="text-[10px] leading-tight text-muted">
              Cadence resolves to isomorphy; rupture is a bounded chaos burst; monomedia drops
              the picture (black or freeze) while audio continues.
            </p>
          </Section>
        </aside>
      </div>
    </div>
  )
}

// Live mirror of the main composite canvas (via captureStream), compact + fixed
// height so the scene rail above keeps room for ≥16 cards.
function SeqPreview({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null> }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    let stream: MediaStream | null = null
    try {
      stream = canvas.captureStream(30)
      video.srcObject = stream
      void video.play().catch(() => {})
    } catch {
      /* captureStream unsupported — the page still works without the mirror */
    }
    return () => {
      stream?.getTracks().forEach((t) => t.stop())
      if (video) video.srcObject = null
    }
  }, [canvasRef])
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-border bg-black/40 p-2">
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-muted">live</span>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="h-[132px] rounded border border-border bg-black object-contain"
        style={{ aspectRatio: '16 / 9' }}
      />
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[9px] uppercase tracking-wide text-muted">{title}</span>
      {children}
    </div>
  )
}
function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] text-muted">{label}</span>
      {children}
    </div>
  )
}
function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[9px] uppercase tracking-wide text-muted">{label}</span>
      {children}
    </div>
  )
}

// Countdown to the next auto-advance (header). Shows "armed" while waiting for
// an audio/chaos trigger (S4 deferred advance).
function NowMeter({ running }: { running: boolean }): JSX.Element {
  const [ms, setMs] = useState(0)
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const id = window.setInterval(() => {
      setMs(sequencerCountdownMs())
      setArmed(sequencerArmed())
    }, 200)
    return () => window.clearInterval(id)
  }, [])
  if (!running) return <span className="font-mono text-[10px] text-muted">idle</span>
  if (armed) return <span className="font-mono text-[10px] text-accent2">◉ armed — waiting for trigger</span>
  return <span className="font-mono text-[10px] text-muted">next in {(ms / 1000).toFixed(1)}s</span>
}

// Live arc-intensity bar (repose ↔ disturbance).
function ArcMeter({ enabled }: { enabled: boolean }): JSX.Element {
  const [v, setV] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setV(sequencerArcIntensity()), 150)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[9px] text-muted">arc</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel2">
        <div
          className="h-full transition-[width] duration-150"
          style={{ width: `${(enabled ? v : 0) * 100}%`, background: 'rgb(var(--c-accent2))' }}
        />
      </div>
    </div>
  )
}
