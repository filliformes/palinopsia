// SequencePage : the macro-form "auto-pilot" over the scene bank (S1 + S2).
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
  sequencerBurialLevel,
  sequencerCountdownMs,
  sequencerLongTakeLevel,
  sequencerScoreMarkdown,
  sequencerSkip
} from '../engine/sequencer'

const SYNCHRESIS: CouplingMode[] = ['lean', 'hocket', 'cut', 'gate', 'drift']
const SYNCHRESIS_INFO: Record<string, string> = {
  lean: 'lean : audio gently pushes the A/B balance toward B (continuous)',
  hocket: 'hocket : audio flips the balance A↔B (percussive, alternating)',
  cut: 'cut : a transient flashes to B, then releases (on-beat, punchy)',
  gate: 'gate : B while loud, A while quiet (a threshold)',
  drift: 'drift : slow momentum follow, sharing direction not shape'
}
const CLIMATE_INFO: Record<SceneClimate, string> = {
  tension: 'tension : unresolved, building',
  expectation: 'expectation : anticipating a change',
  release: 'release : easing off / neutral',
  resolution: 'resolution : arrival, settled'
}
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
            scenes · {scenes.length} : click to tag
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
              <Field label="Diégèse (world)"
                title="Which 'world' this scene belongs to : its overall coupling character + Context mood. The sequencer prefers to stay within a world and treats world changes as bigger moments.">

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
              <Field label="Synchrèse (coupling)"
                title="How this scene's two voices (A/B) relate in time : tap the coupling characters that describe it. 'auto' transitions cut instead of morphing when the destination is percussive (cut/hocket).">

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
                        title={SYNCHRESIS_INFO[m] ?? m}
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
              <Field label={`Espace-temps · ${selScene.tags.spaceTime < 0.4 ? 'full' : selScene.tags.spaceTime > 0.6 ? 'void' : 'neutral'}`}
                title="How full or empty the scene feels: 0 = dense / full frame · 1 = sparse / void. The Breathe macro oscillates around this, and Selection prefers small steps between neighbouring scenes.">

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
              <Field label="Climat"
                title="The emotional charge of the scene (tension / expectation / release / resolution). The Climate arc uses these to shape which scenes it reaches for as it builds and releases.">

                <div className="flex flex-wrap gap-1">
                  {SCENE_CLIMATES.map((c) => {
                    const on = selScene.tags!.climate === c
                    return (
                      <button
                        key={c}
                        onClick={() => setSceneTags(selScene.id, { climate: c })}
                        title={CLIMATE_INFO[c]}
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
         {/* Live composition mirror : pinned at the bottom so you SEE the run. */}
         <SeqPreview canvasRef={canvasRef} />
        </div>

        {/* Transport + macro-form : crammed to fit without scrolling. */}
        <aside className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto border-l border-border bg-panel px-3 py-2">
          <Section title="Transport">
            <Row label={`dwell · ${seq.dwell.toFixed(0)}s`}
              title="How long each scene is held before the sequencer moves on (seconds).">
              <input type="range" min={2} max={60} step={1} value={seq.dwell}
                onChange={(e) => setSequence({ dwell: Number(e.target.value) })}
                className="w-full accent-accent" />
            </Row>
            <Row label={`humanise · ${Math.round(seq.dwellJitter * 100)}%`}
              title="Randomly varies each dwell time by up to this much, so the pacing never feels metronomic.">
              <input type="range" min={0} max={1} step={0.01} value={seq.dwellJitter}
                onChange={(e) => setSequence({ dwellJitter: Number(e.target.value) })}
                className="w-full accent-accent" />
            </Row>
            <Row label="transition"
              title="How one scene becomes the next: morph = crossfade · cut = instant · auto = cut when the destination's Synchrèse is percussive, else morph.">
              <select className="input select-compact w-full text-[11px]" value={seq.transition}
                onChange={(e) => setSequence({ transition: e.target.value as typeof seq.transition })}>
                <option value="morph">morph (crossfade)</option>
                <option value="cut">cut (hard)</option>
                <option value="auto">auto (per Synchrèse)</option>
              </select>
            </Row>
            {seq.transition !== 'cut' && (
              <Row label={`crossfade · ${(seq.crossfadeMs / 1000).toFixed(1)}s`}
                title="Duration of the morph dissolve between scenes.">
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
            <Row label="mode"
              title="How the next scene is chosen: weighted = wander guided by the scene tags (world continuity + a gentle Espace-temps step) · arc = also shaped by the Climate arc · shuffle = flat random.">
              <select className="input select-compact w-full text-[11px]" value={seq.mode}
                onChange={(e) => setSequence({ mode: e.target.value as typeof seq.mode })}>
                <option value="weighted">weighted (tag-guided wander)</option>
                <option value="arc">arc (climate-shaped)</option>
                <option value="shuffle">shuffle (flat random)</option>
              </select>
            </Row>
            <Row label={`no-repeat · last ${seq.noRepeat}`}
              title="Won't return to any of the last N scenes it played : keeps the set from cycling on a few favourites.">
              <input type="range" min={0} max={8} step={1} value={seq.noRepeat}
                onChange={(e) => setSequence({ noRepeat: Number(e.target.value) })}
                className="w-full accent-accent" />
            </Row>
            <Row label={`variation · ${Math.round(seq.variation * 100)}%`}
              title="A small random tweak applied to each scene as it's recalled, so a long run never loops verbatim (0 = play scenes exactly).">
              <input type="range" min={0} max={0.6} step={0.01} value={seq.variation}
                onChange={(e) => setSequence({ variation: Number(e.target.value) })}
                className="w-full accent-accent" />
            </Row>
          </Section>

          <Section title="Breathe (Espace-temps)">
            <Row label={`amount · ${Math.round(seq.breathe.amount * 100)}%`}
              title="A slow swing of the whole composition toward dense↔void (Context haze / depth / blur), centred on each scene's Espace-temps tag. 0 = off.">
              <input type="range" min={0} max={1} step={0.01} value={seq.breathe.amount}
                onChange={(e) => setSequence({ breathe: { ...seq.breathe, amount: Number(e.target.value) } })}
                className="w-full accent-accent2" />
            </Row>
            <Row label={`period · ${seq.breathe.periodSec.toFixed(0)}s`}
              title="How long one full breathe cycle (full → void → full) takes.">
              <input type="range" min={4} max={120} step={1} value={seq.breathe.periodSec}
                onChange={(e) => setSequence({ breathe: { ...seq.breathe, periodSec: Number(e.target.value) } })}
                className="w-full accent-accent2" />
            </Row>
          </Section>

          <Section title="Climate arc">
            <label className="flex items-center gap-2 text-[11px] text-muted"
              title="A slow build-and-release shape (calm → intense → calm) that biases which scenes are chosen and lifts the visuals at its peak.">
              <input type="checkbox" checked={seq.arc.enabled}
                onChange={(e) => setSequence({ arc: { ...seq.arc, enabled: e.target.checked } })} />
              enable Repose–Disturbance–Repose
            </label>
            {seq.arc.enabled && (
              <Row label={`length · ${seq.arc.lengthSec.toFixed(0)}s`}
                title="Duration of one full climate arc (calm → intense → calm).">
                <input type="range" min={20} max={600} step={5} value={seq.arc.lengthSec}
                  onChange={(e) => setSequence({ arc: { ...seq.arc, lengthSec: Number(e.target.value) } })}
                  className="w-full accent-accent2" />
              </Row>
            )}
            <ArcMeter enabled={seq.arc.enabled && seq.running} />
          </Section>

          <Section title="Burial → Exhumation">
            <label className="flex items-center gap-2 text-[11px] text-muted"
              title="A durational arc that slowly buries the picture — analog breakup, crushed shadows, softening, darkening the grade toward illegibility — then exhumes it (recovers). A slow cosine over the length below.">
              <input type="checkbox" checked={seq.burial.enabled}
                onChange={(e) => setSequence({ burial: { ...seq.burial, enabled: e.target.checked } })} />
              enable degrade → recover
            </label>
            {seq.burial.enabled && (
              <>
                <Row label={`length · ${(seq.burial.lengthSec / 60).toFixed(1)}min`}
                  title="Duration of one full burial cycle (legible → buried → exhumed).">
                  <input type="range" min={30} max={900} step={5} value={seq.burial.lengthSec}
                    onChange={(e) => setSequence({ burial: { ...seq.burial, lengthSec: Number(e.target.value) } })}
                    className="w-full accent-accent2" />
                </Row>
                <Row label={`depth · ${Math.round(seq.burial.depth * 100)}%`}
                  title="How far it degrades at the peak : from a light patina to near-illegible.">
                  <input type="range" min={0} max={1} step={0.01} value={seq.burial.depth}
                    onChange={(e) => setSequence({ burial: { ...seq.burial, depth: Number(e.target.value) } })}
                    className="w-full accent-accent2" />
                </Row>
              </>
            )}
            <LevelMeter label="buried" enabled={seq.burial.enabled && seq.running} get={sequencerBurialLevel} />
          </Section>

          <Section title="Long-Take / Veil">
            <label className="flex items-center gap-2 text-[11px] text-muted"
              title="A slowness discipline : FORBIDS auto-cuts (holds a single take) and drives one imperceptibly-slow veil — Context haze thickening and thinning over minutes. An antidote to restless macro-forms (a Fog Line). Manual skip still works.">
              <input type="checkbox" checked={seq.longTake.enabled}
                onChange={(e) => setSequence({ longTake: { ...seq.longTake, enabled: e.target.checked } })} />
              hold the shot · slow veil
            </label>
            {seq.longTake.enabled && (
              <>
                <Row label={`length · ${(seq.longTake.lengthSec / 60).toFixed(1)}min`}
                  title="How long one full veil cycle (clear → veiled → clear) takes.">
                  <input type="range" min={30} max={900} step={5} value={seq.longTake.lengthSec}
                    onChange={(e) => setSequence({ longTake: { ...seq.longTake, lengthSec: Number(e.target.value) } })}
                    className="w-full accent-accent2" />
                </Row>
                <Row label={`depth · ${Math.round(seq.longTake.depth * 100)}%`}
                  title="How thick the veil gets at its peak.">
                  <input type="range" min={0} max={1} step={0.01} value={seq.longTake.depth}
                    onChange={(e) => setSequence({ longTake: { ...seq.longTake, depth: Number(e.target.value) } })}
                    className="w-full accent-accent2" />
                </Row>
              </>
            )}
            <LevelMeter label="veil" enabled={seq.longTake.enabled && seq.running} get={sequencerLongTakeLevel} />
          </Section>

          <Section title="Punctuation">
            <Row label={`cadence · ${seq.cadenceEvery === 0 ? 'off' : `every ${seq.cadenceEvery}`}`}>
              <input type="range" min={0} max={8} step={1} value={seq.cadenceEvery}
                onChange={(e) => setSequence({ cadenceEvery: Number(e.target.value) })}
                className="w-full accent-accent2"
                title="Resolve to isomorphy (A/B fuse) every N transitions : a felt arrival" />
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
              <Row label="monomedia style"
                title="What the drop looks like: fade to black dims the picture out and back; freeze frame holds the last frame still. Either way the audio keeps playing underneath.">
                <div className="flex gap-1">
                  {(['black', 'freeze'] as const).map((st) => (
                    <button
                      key={st}
                      onClick={() => setSequence({ monomediaStyle: st })}
                      title={st === 'black' ? 'Dim the picture to black at the transition, then back' : 'Hold the last frame frozen at the transition, then resume'}
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
          </Section>
        </aside>
      </div>
    </div>
  )
}

// Live mirror of the main composite canvas (via captureStream). Height is
// resizable (drag the top edge); the scene rail above flexes to what's left.
function SeqPreview({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null> }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [height, setHeight] = useState<number>(() => {
    const v = Number(localStorage.getItem('opsia.seqPreviewH'))
    return Number.isFinite(v) && v >= 100 ? v : 150
  })
  const drag = useRef<{ startY: number; startH: number; last: number } | null>(null)

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
      /* captureStream unsupported : the page still works without the mirror */
    }
    return () => {
      stream?.getTracks().forEach((t) => t.stop())
      if (video) video.srcObject = null
    }
  }, [canvasRef])

  return (
    <div className="flex shrink-0 flex-col border-t border-border bg-black/40">
      {/* Drag the top edge to resize (up = taller). */}
      <div
        className="h-1.5 shrink-0 cursor-row-resize bg-border/60 transition-colors hover:bg-accent/60"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          drag.current = { startY: e.clientY, startH: height, last: height }
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const h = Math.max(100, Math.min(560, d.startH + (d.startY - e.clientY)))
          d.last = h
          setHeight(h)
        }}
        onPointerUp={(e) => {
          if (drag.current) {
            localStorage.setItem('opsia.seqPreviewH', String(drag.current.last))
            drag.current = null
            ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
          }
        }}
        title="Drag to resize the live monitor"
      />
      <div className="relative flex min-h-0 items-center justify-center p-2" style={{ height }}>
        <span className="pointer-events-none absolute left-2 top-2 z-10 font-mono text-[9px] uppercase tracking-wide text-muted">
          live
        </span>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="h-full max-w-full rounded border border-border bg-black object-contain"
          style={{ aspectRatio: '16 / 9' }}
        />
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[9px] uppercase tracking-wide text-accent2/70">{title}</span>
      {children}
    </div>
  )
}
function Row({ label, title, children }: { label: string; title?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col" title={title}>
      <span className="font-mono text-[10px] leading-tight text-muted">{label}</span>
      {children}
    </div>
  )
}
function Field({ label, title, children }: { label: string; title?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-1" title={title}>
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
  if (armed) return <span className="font-mono text-[10px] text-accent2">◉ armed : waiting for trigger</span>
  return <span className="font-mono text-[10px] text-muted">next in {(ms / 1000).toFixed(1)}s</span>
}

// Live arc-intensity bar (repose ↔ disturbance).
function ArcMeter({ enabled }: { enabled: boolean }): JSX.Element {
  return <LevelMeter label="arc" enabled={enabled} get={sequencerArcIntensity} />
}

// A generic live 0..1 progress bar, polled from a getter (arc / burial / veil).
function LevelMeter({
  label,
  enabled,
  get
}: {
  label: string
  enabled: boolean
  get: () => number
}): JSX.Element {
  const [v, setV] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setV(get()), 150)
    return () => window.clearInterval(id)
  }, [get])
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[9px] text-muted">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel2">
        <div
          className="h-full transition-[width] duration-150"
          style={{ width: `${(enabled ? v : 0) * 100}%`, background: 'rgb(var(--c-accent2))' }}
        />
      </div>
    </div>
  )
}
