// SequencePage : the home of everything the instrument sequences (key Q, the
// Seq button; also in a window of its own, PageWindow.tsx). One transport, the
// live picture under it (always there, over every lane), then LANES, each
// sequencer keeping its own time :
// - Scenes : the macro-form "auto-pilot" over the scene bank (S1-S4). Left :
//   the scene rail as tagged cards + a tag editor. Right : pacing, selection
//   and the macro-form overlays (Breathe, Climate arc...).
//   See docs/opsia-sequencer-spec.md.
// - Sonify keys : the Sonify key sequencer, the same card (one store) as on
//   the Sonify page, in three columns (SonifyKeySequencer lane).
// - Body rules : the rule timeline in bars (RuleLane.tsx, engine/ruleSeq.ts).
// The transport plays every lane marked "with transport" and stops them all,
// on the shared beat clock (audio/soniClock.ts : the tempo, or Ableton Link's).

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { CouplingMode, SceneClimate, SeqLaneId, SonifyModParam } from '@shared/types'
import { SCENE_CLIMATES } from '@shared/types'
import { useStore } from '../store'
import { seqClockPosition, seqTransportPlaying, seqTransportToggle } from '../engine/ruleSeq'
import { NOTE_NAMES, isScale } from '../audio/soniKeyModel'
import { SCALE_LABEL } from '../audio/sonify'
import { MidiLearnOverlay } from './MidiLearnOverlay'
import { LinkBadge } from './LinkSection'
import { chip, pill } from './sonifyUi'
import { ownerWindow } from './ownerWindow'
import { KeySeqDice, SonifyKeySequencer } from './SonifyKeySequencer'
import { ModChip, SonifyAssign } from './SonifyPage'
import { RuleLane, RulePosition } from './RuleLane'
import { LightCueButtons, LightCueList, LightCueNow } from './LightCues'
import {
  sequencerArcIntensity,
  sequencerArmed,
  sequencerBurialLevel,
  sequencerCountdownMs,
  sequencerLongTakeLevel,
  sequencerScoreMarkdown,
  sequencerSkip
} from '../engine/sequencer'
import { frameWeaveActiveCell } from '../engine/frameWeave'
import { climateFromColour } from '../worlds'
import { showToast } from './Toast'
import { effectiveZoom } from './uiZoom'

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
  canvasRef,
  inWindow = false
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  /** Drawn in its own window (PageWindow.tsx), not over the instrument. */
  inWindow?: boolean
}): JSX.Element {
  const setOpen = useStore((s) => s.setSequencePageOpen)
  const setInWindow = useStore((s) => s.setSequencePageWindow)
  const sceneCount = useStore((s) => s.scenes.length)
  const seqRunning = useStore((s) => s.sequence.running)
  const toggleRunning = useStore((s) => s.toggleSequenceRunning)
  const keyOn = useStore((s) => s.soniKeySeq.on)
  const setKeyOn = useStore((s) => s.setSoniKeySeqOn)
  const ruleOn = useStore((s) => s.ruleSeqOn)
  const setRuleOn = useStore((s) => s.setRuleSeqOn)
  const hasBlocks = useStore((s) => s.ruleSeq.blocks.length > 0)
  const cueRun = useStore((s) => s.lightCueRun)
  const cueFollow = useStore((s) => s.lightsSession.scenes.some((c) => (c.follow ?? 0) > 0))
  const ruleTime = useStore((s) => s.ruleSeq.unit === 'time')

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg" data-seq-page>
      <header className="flex items-center gap-4 border-b border-border bg-panel px-4 py-2">
        <span
          className="cursor-help font-mono text-[13px] font-semibold uppercase tracking-[0.2em]"
          title="Everything the instrument sequences, one lane each, under one transport : the scene auto-pilot, the Sonify key sequencer (the same one as on the Sonify page) and the Body rule timeline. Play starts every lane marked 'with transport', stop stops them all; each lane also plays on its own. Q from the instrument opens this page."
        >
          Sequence
        </span>
        <SeqTransport />
        <div className="flex-1" />
        {/* In its own window (from the Seq button's right-click menu) : back in
            over the instrument. */}
        {inWindow && (
          <button
            onClick={() => setInWindow(false)}
            className="rounded border border-border px-3 py-1 font-mono text-[11px] text-muted hover:text-accent"
            title="Put the Sequencer back over the instrument"
          >
            ⇲ back into the app
          </button>
        )}
        <button
          onClick={() => setOpen(false)}
          className="rounded border border-border px-3 py-1 font-mono text-[11px] text-muted hover:text-accent"
        >
          {inWindow ? 'close' : '← back to instrument'}
        </button>
      </header>

      {/* the whole picture, over every lane (never scrolled away) */}
      <SeqPreview canvasRef={canvasRef} />

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        <Lane
          id="scenes"
          title="Scenes"
          hint="The macro-form auto-pilot over your saved scenes : tag the scenes on the left to give it a world to wander, then set its pacing, selection and slow overlays on the right. Its own time : the dwell of each scene, in seconds."
          on={seqRunning}
          onToggle={toggleRunning}
          toggleDisabled={sceneCount < 2}
          toggleTitle={sceneCount < 2 ? 'Need at least 2 scenes' : seqRunning ? 'Stop the auto-pilot' : 'Start the auto-pilot'}
          midiId="fire:seq"
          status={<NowMeter running={seqRunning} />}
          right={<SceneButtons disabled={sceneCount < 2} />}
        >
          <SceneLane canvasRef={canvasRef} />
        </Lane>
        <Lane
          id="keys"
          title="Sonify keys"
          hint="The Sonify key sequencer : the root, scale and octave of every Sonify voice over time. The same one as on the Sonify page (S, seq view) : an edit here shows there at once, and back. Its own time : its rate, on the shared beat clock or free time."
          on={keyOn}
          onToggle={() => setKeyOn(!keyOn)}
          toggleTitle="Play / stop the key sequencer : it changes the root, scale and octave of every Sonify voice over time"
          midiId="fire:keyseq"
          status={<KeyNow />}
          right={<KeySeqDice />}
        >
          <KeyLane />
        </Lane>
        <Lane
          id="rules"
          title="Body rules"
          hint="A timeline of your Body rules : each block switches its rule on from its start to its end. Its clock : bars of the tempo (Ableton Link's bar while Link is on), or time, real minutes and seconds that the tempo never moves (a loop of 5 seconds to 120 minutes; it starts at once on play). Switching the clock converts the blocks at the tempo, so they keep their place. Double-click a block to type its start and length exactly. While it runs, a rule with blocks is on inside them and off outside them; a rule without blocks is left alone, and stopping leaves every rule as it is. A rule you switch by hand (MIDI, OSC, an action, its box) keeps what you set until the next block edge on its row."
          on={ruleOn}
          onToggle={() => setRuleOn(!ruleOn)}
          toggleDisabled={!ruleOn && !hasBlocks}
          toggleTitle={!hasBlocks
            ? 'Put a block on the timeline first'
            : ruleOn
              ? 'Stop the rule timeline : every rule stays as it is'
              : ruleTime ? 'Run the rule timeline : in time, it starts at once' : 'Run the rule timeline : it starts on the next bar when another sequencer plays on the beat'}
          midiId="fire:ruleseq"
          status={<RulePosition />}
        >
          <div className="px-3 py-2">
            <RuleLane />
          </div>
        </Lane>
        <Lane
          id="lights"
          title="Light cues"
          hint="The Lights page's cues : each one a look for the lights with its own fade, a follow time and the Palinopsia scene it goes with. Playing, the cues follow on : a cue with a follow time hands over to the next one by itself (a cue without one waits for GO), and after the last comes the first. Its own time : the fades and follow times, in seconds."
          on={cueRun}
          onToggle={() => useStore.getState().setLightCueRun(!cueRun)}
          toggleDisabled={!cueRun && !cueFollow}
          toggleTitle={!cueFollow ? 'Give a cue a follow time first (⚙ on a cue)' : cueRun ? 'Stop following on (the lights stay as they are)' : 'Follow on from cue to cue'}
          midiId="fire:lightscues"
          status={<LightCueNow />}
          right={<LightCueButtons />}
        >
          <div className="px-3 py-2">
            <LightCueList row />
          </div>
        </Lane>
      </div>
    </div>
  )
}

/** The page's one transport : play every lane marked "with transport" (each on
 *  its own time, the beat lanes together on bar 1, or on Ableton Link's next
 *  bar), stop them all; the shared clock's bar and beat; the tempo. */
function SeqTransport(): JSX.Element {
  const playing = useStore((s) => s.ruleSeqOn || s.soniKeySeq.on || (s.sequence.enabled && s.sequence.running) || s.lightCueRun)
  const canPlay = useStore((s) => {
    const a = s.seqLanes.arm
    return (a.scenes && s.scenes.length > 1) || a.keys || (a.rules && s.ruleSeq.blocks.length > 0) || (a.lights && s.lightsSession.scenes.some((c) => (c.follow ?? 0) > 0))
  })
  const bpm = useStore((s) => s.composition.bpm)
  const posRef = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    const view = ownerWindow(posRef.current)
    let id = 0
    let shown = ''
    const f = (): void => {
      id = view.requestAnimationFrame(f)
      if (view.document.hidden || !posRef.current) return
      let txt = 'stopped'
      if (seqTransportPlaying()) {
        const p = seqClockPosition()
        txt = `bar ${p.bar} · ${p.beat}`
      }
      if (txt !== shown) {
        shown = txt
        posRef.current.textContent = txt
      }
    }
    id = view.requestAnimationFrame(f)
    return () => view.cancelAnimationFrame(id)
  }, [])
  return (
    <div className="flex items-center gap-2.5 rounded border border-border/70 bg-panel2/40 px-2 py-1">
      <span className="relative flex shrink-0">
        <MidiLearnOverlay id="fire:transport" />
        <button
          data-seq-transport
          onClick={seqTransportToggle}
          disabled={!playing && !canPlay}
          className={`rounded border px-3 py-0.5 font-mono text-[11px] transition-colors disabled:opacity-40 ${
            playing
              ? 'border-danger bg-danger/20 text-danger hover:bg-danger/30'
              : 'border-accent bg-accent/15 text-accent hover:bg-accent/25'
          }`}
          title={playing
            ? 'Stop every lane'
            : canPlay ? "Play every lane marked 'with transport' : the beat lanes start together, on bar 1 (or on Ableton Link's next bar)" : "Nothing to play : no lane marked 'with transport' has anything to play yet"}
        >
          {playing ? '■ stop' : '▶ play'}
        </button>
      </span>
      <span
        ref={posRef}
        className="w-[78px] shrink-0 font-mono text-[11px] tabular-nums text-text"
        title="The shared beat clock : bar and beat (the composition tempo, or Ableton Link's bar while Link is on). The Sonify key sequencer and the rule timeline count on it"
      />
      <span className="shrink-0 font-mono text-[10px] text-muted" title="The composition tempo (the Transport's BPM; while other apps are linked, Ableton Link's)">
        {Math.round(bpm * 10) / 10} BPM
      </span>
      <LinkBadge />
    </div>
  )
}

/** One sequencer of the page : its header (fold, play, name, with the
 *  transport or not, where it is) and, unfolded, its own controls. */
function Lane({
  id, title, hint, on, onToggle, toggleTitle, toggleDisabled = false, midiId, status, right, children
}: {
  id: SeqLaneId
  title: string
  hint: string
  on: boolean
  onToggle: () => void
  toggleTitle: string
  toggleDisabled?: boolean
  midiId: string
  status?: ReactNode
  right?: ReactNode
  children: ReactNode
}): JSX.Element {
  const key = `seq-lane-${id}`
  const folded = useStore((s) => !!s.collapsed[key])
  const toggleSection = useStore((s) => s.toggleSection)
  const arm = useStore((s) => s.seqLanes.arm[id])
  const setArm = useStore((s) => s.setSeqLaneArm)
  return (
    <section data-lane={id} className={`flex shrink-0 flex-col rounded-md border bg-panel transition-colors ${on ? 'border-accent/50' : 'border-border'}`}>
      <div className={`flex min-w-0 items-center gap-2.5 px-3 py-1.5 ${folded ? '' : 'border-b border-border/60'}`}>
        <button
          onClick={() => toggleSection(key)}
          className="-mr-1 shrink-0 px-0.5 font-mono text-[9px] text-muted hover:text-accent"
          title={folded ? `Show the ${title} lane` : `Fold the ${title} lane to its header (it keeps playing)`}
        >
          <span className={`inline-block transition-transform ${folded ? '' : 'rotate-90'}`}>▶</span>
        </button>
        <span className="relative flex shrink-0">
          <MidiLearnOverlay id={midiId} />
          <button data-lane-play={id} onClick={onToggle} disabled={toggleDisabled} className={`${pill(on)} disabled:opacity-40`} title={toggleTitle}>
            {on ? '■ stop' : '▶ play'}
          </button>
        </span>
        <span className="shrink-0 cursor-help font-mono text-[11px] font-semibold uppercase tracking-[0.16em]" title={hint}>{title}</span>
        <span className="shrink-0 cursor-help text-[10px] text-muted/70 hover:text-accent" title={hint}>ⓘ</span>
        <button
          data-lane-arm={id}
          onClick={() => setArm(id, !arm)}
          className={`${chip(arm)} shrink-0`}
          title={arm
            ? "Started and stopped by the transport's play and stop (top of the page). Click : only by its own play"
            : "Plays only from its own play (the transport's play leaves it alone; its stop still stops it). Click : with the transport"}
        >
          {arm ? '● with transport' : '○ on its own'}
        </button>
        {status}
        <span className="min-w-0 flex-1" />
        {right}
      </div>
      {!folded && children}
    </section>
  )
}

/** The scene lane's buttons : skip, and the relation score. */
function SceneButtons({ disabled }: { disabled: boolean }): JSX.Element {
  return (
    <>
      <button
        onClick={() => sequencerSkip()}
        disabled={disabled}
        className="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-muted hover:text-accent disabled:opacity-40"
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
        className="rounded border border-border px-2 py-0.5 font-mono text-[10px] text-muted hover:text-accent"
        title="Export the run as a relation-score (ordered AVUs, Markdown)"
      >
        ⤓ score
      </button>
    </>
  )
}

/** The key the Sonify voices play in now (the keys lane's header). */
function KeyNow(): JSX.Element {
  const root = useStore((s) => s.sonify.root)
  const scale = useStore((s) => s.sonify.scale)
  const oct = useStore((s) => s.sonify.rootOct ?? 3)
  return (
    <span className="min-w-0 shrink truncate font-mono text-[10px] text-accent" title="The key every Sonify voice plays in now">
      {NOTE_NAMES[root]} {isScale(scale) ? SCALE_LABEL[scale] : scale} <span className="text-muted">· oct {oct}</span>
    </span>
  )
}

/** The Sonify key sequencer, as a lane : the same card as on the Sonify page
 *  (one store), in three columns, with its M chip on Every. */
function KeyLane(): JSX.Element {
  const [assign, setAssign] = useState<SonifyModParam | null>(null)
  const modChip = (p: SonifyModParam): JSX.Element => (
    <ModChip param={p} open={assign === p} onOpen={(x) => setAssign(assign === x ? null : x)} />
  )
  const assignBox = (...ps: SonifyModParam[]): JSX.Element | null => (assign && ps.includes(assign) ? <SonifyAssign param={assign} /> : null)
  return (
    <div className="px-3 py-2.5">
      <SonifyKeySequencer lane chip={modChip} assignBox={assignBox} />
    </div>
  )
}

/** The scene lane : the scene rail as tagged cards + a tag editor on the left,
 *  the auto-pilot's pacing and macro-form overlays on the right (as the whole
 *  page was before the lanes; the live mirror is the page's own now, over every
 *  lane). Its height : drag its foot. */
function SceneLane({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null> }): JSX.Element {
  const scenes = useStore(useShallow((s) => s.scenes))
  const activeSceneId = useStore((s) => s.activeSceneId)
  const worlds = useStore(useShallow((s) => s.worlds))
  const seq = useStore((s) => s.sequence)
  // Resizable inspector column (drag its left edge; persisted).
  const [seqAsideW, setSeqAsideW] = useState(() => {
    const n = Number(localStorage.getItem('opsia.seqAsideW'))
    return Number.isFinite(n) && n >= 240 ? n : 320
  })
  // The lane's height (drag its foot; persisted).
  const [laneH, setLaneH] = useState(() => {
    const n = Number(localStorage.getItem('opsia.seqLaneH.scenes'))
    return Number.isFinite(n) && n >= 220 ? Math.min(1200, n) : 440
  })
  const hDrag = useRef<{ y: number; h: number; last: number; z: number } | null>(null)
  const setSequence = useStore((s) => s.setSequence)
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

  // Suggest a Climat tag from the live composite's palette. Samples the WebGL
  // canvas directly (it keeps its drawing buffer), so it works regardless of
  // whether a vision modulator happens to be running.
  const suggestClimate = (): void => {
    const cv = canvasRef.current
    if (!cv || !selScene) return
    try {
      const s = document.createElement('canvas'); s.width = 32; s.height = 32
      const g2 = s.getContext('2d'); if (!g2) return
      g2.drawImage(cv, 0, 0, 32, 32)
      const d = g2.getImageData(0, 0, 32, 32).data
      let rS = 0, gS = 0, bS = 0
      const n = 32 * 32
      for (let i = 0; i < d.length; i += 4) { rS += d[i]; gS += d[i + 1]; bS += d[i + 2] }
      rS /= 255 * n; gS /= 255 * n; bS /= 255 * n
      const mx = Math.max(rS, gS, bS), mn = Math.min(rS, gS, bS)
      const brightness = rS * 0.299 + gS * 0.587 + bS * 0.114
      const saturation = mx > 1e-4 ? (mx - mn) / mx : 0
      const warmth = Math.max(0, Math.min(1, 0.5 + (rS - bS)))
      const cl = climateFromColour(warmth, saturation, brightness)
      setSceneTags(selScene.id, { climate: cl })
      showToast(`Climat → ${cl} · from the picture (warmth ${(warmth * 100) | 0}% · sat ${(saturation * 100) | 0}%)`)
    } catch { showToast('Could not read the picture for a Climat suggestion', 'warn') }
  }

  return (
    <div className="flex flex-col">
      <div className="flex min-h-0" style={{ height: laneH }}>
        {/* Scene column : the scrolling rail and the tag editor. */}
        <div className="flex min-w-0 flex-1 flex-col">
         <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span
              className="cursor-help font-mono text-[9px] uppercase tracking-wide text-muted"
              title="Every saved scene, as a tag card. Click a card to edit its tags below · double-click to jump to that scene live. Tags (world, coupling, fullness, climate) are what the sequencer reads when it chooses where to go."
            >
              scenes · {scenes.length} : click to tag · double-click to jump
            </span>
            {/* Climate legend : the dot colour on each card. */}
            <span className="flex items-center gap-2.5">
              {SCENE_CLIMATES.map((c) => (
                <span key={c} className="flex cursor-help items-center gap-1 font-mono text-[9px] text-muted" title={CLIMATE_INFO[c]}>
                  <span className="h-2 w-2 rounded-full" style={{ background: CLIMATE_COLOR[c] }} />
                  {c}
                </span>
              ))}
            </span>
          </div>
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
                    {isCur && <span className="shrink-0 font-mono text-[9px] text-accent">▶ now</span>}
                  </div>
                  {t && (
                    <>
                      <div
                        className="flex items-center gap-1 font-mono text-[9px] text-muted"
                        title={`World : ${worldName(t.world)} · Coupling : ${t.synchresis.join(', ') || 'none'}`}
                      >
                        <span className="rounded bg-panel2 px-1 py-0.5 text-accent2">{worldName(t.world)}</span>
                        <span className="truncate">{t.synchresis.join('·') || 'none'}</span>
                      </div>
                      {/* Espace-temps bar: full ◀ ▶ void */}
                      <div
                        className="h-1 w-full overflow-hidden rounded-full bg-panel2"
                        title={`Espace-temps ${Math.round(t.spaceTime * 100)}% : left = full / dense, right = sparse / void`}
                      >
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
              <span
                className="cursor-help font-mono text-[9px] uppercase tracking-wide text-muted"
                title="Describe this scene so the sequencer can place it : its world, how its two voices couple, how full/empty it feels, and its emotional charge. These four tags drive Selection, Breathe and the Climate arc."
              >
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
                title="How full or empty the scene feels: 0 = dense / full frame · 1 = sparse / void. The Breathe macro oscillates around this, and Selection prefers small steps between neighboring scenes.">

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
                  <button
                    onClick={suggestClimate}
                    className="ml-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-accent2 hover:border-accent hover:text-accent"
                    title="Suggest a Climat from the live picture's palette (warm+saturated → tension/expectation, cool+muted → release/resolution). Reads the composite on screen now."
                  >
                    ◔ from picture
                  </button>
                </div>
              </Field>
            </div>
          )}
         </div>
        </div>

        {/* Transport + macro-form : crammed to fit without scrolling. */}
        {/* Drag the left edge to resize the inspector column (persisted). */}
        <div
          className="w-1 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-accent/60"
          style={{ touchAction: 'none' }}
          onPointerDown={(e) => {
            const startX = e.clientX
            const startW = seqAsideW
            const el = e.target as HTMLElement
            // the pointer moves in screen pixels, the width is in the zoomed
            // page's own (at 125 % the edge ran a quarter ahead of the hand)
            const z = effectiveZoom(el)
            el.setPointerCapture(e.pointerId)
            const move = (ev: PointerEvent): void => {
              const w = Math.max(240, Math.min(640, startW + (startX - ev.clientX) / z))
              setSeqAsideW(w)
              localStorage.setItem('opsia.seqAsideW', String(w))
            }
            const up = (): void => {
              el.removeEventListener('pointermove', move)
              el.removeEventListener('pointerup', up)
              el.removeEventListener('pointercancel', up)
            }
            el.addEventListener('pointermove', move)
            el.addEventListener('pointerup', up)
            el.addEventListener('pointercancel', up)
          }}
          title="Drag to resize the inspector"
        />
        <aside
          className="flex shrink-0 flex-col gap-2 overflow-y-auto border-l border-border bg-panel px-3 py-2"
          style={{ width: seqAsideW }}
        >
          <GroupLabel title="How fast the auto-pilot moves through the bank, and how it picks where to go next.">Pacing &amp; selection</GroupLabel>
          <Section title="Transport"
            info="Pacing : how long each scene is held, and how one scene becomes the next (morph / cut, and whether the step waits for an audio event).">
            <Row label={`dwell · ${seq.dwell.toFixed(0)}s`}
              title="How long each scene is held before the sequencer moves on (seconds).">
              <input type="range" min={2} max={60} step={1} value={seq.dwell}
                onChange={(e) => setSequence({ dwell: Number(e.target.value) })}
                className="w-full accent-accent" />
            </Row>
            <Row label={`humanize · ${Math.round(seq.dwellJitter * 100)}%`}
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

          <Section title="Selection"
            info="Which scene plays next : the picking strategy, how long before a scene may repeat, and a per-recall variation so a long run never loops verbatim.">
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
              title="Won't return to any of the last N scenes it played : keeps the set from cycling on a few favorites.">
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

          <GroupLabel title="Slow shapes layered over the whole run : durational arcs and textures that evolve independently of the scene stepping.">Macro-form overlays</GroupLabel>
          <Section title="Breathe (Espace-temps)"
            info="A slow dense↔void swing of the whole picture (haze / depth / blur), centered on each scene's Espace-temps tag. Set amount to 0 to switch it off.">
            <Row label={`amount · ${Math.round(seq.breathe.amount * 100)}%`}
              title="A slow swing of the whole composition toward dense↔void (Context haze / depth / blur), centered on each scene's Espace-temps tag. 0 = off.">
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

          <Section title="Climate arc"
            info="A slow build-and-release shape (calm → intense → calm) that biases scene choice by their Climat tag and lifts the visuals at its peak. The meter shows where it is in the cycle.">
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

          <Section title="Burial → Exhumation"
            info="A long degrade-then-recover arc : the picture is slowly buried (breakup, crushed shadows, darkening toward illegibility) then exhumed. The meter shows how buried it is right now.">
            <label className="flex items-center gap-2 text-[11px] text-muted"
              title="A durational arc that slowly buries the picture in analog breakup, crushed shadows, softening and a grade darkening toward illegibility, then exhumes it (recovers). A slow cosine over the length below.">
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

          <Section title="Long-Take / Veil"
            info="A slowness discipline : forbids auto-cuts (holds one take) and drives one imperceptibly-slow haze over minutes. An antidote to restless macro-forms. Manual skip still works.">
            <label className="flex items-center gap-2 text-[11px] text-muted"
              title="A slowness discipline : FORBIDS auto-cuts (holds a single take) and drives one imperceptibly-slow veil : Context haze thickening and thinning over minutes. An antidote to restless macro-forms (a Fog Line). Manual skip still works.">
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

          <Section title="Frame-Weave (interlace)"
            info="A frame-by-frame temporal interlace : show ONE layer per frame, stepping through the lattice below, so persistence of vision fuses them into a shimmer. Runs live, independent of scene stepping, and starts from the first cell each time you switch it on.">
            <label className="flex items-center gap-2 text-[11px] text-muted"
              title="A frame-by-frame temporal interlace : instead of blending, show ONE layer per frame, stepping through the lattice below so persistence of vision fuses them into a shimmer. Runs live (independent of scene stepping). Blank cells (·) show black.">
              <input type="checkbox" checked={seq.frameWeave.enabled}
                onChange={(e) => setSequence({ frameWeave: { ...seq.frameWeave, enabled: e.target.checked } })} />
              interleave layers per frame
            </label>
            {seq.frameWeave.enabled && (
              <>
                <Row label={`rate · ${seq.frameWeave.rate}/s`}
                  title="Cells per second (24 ≈ one lattice cell per film frame). Lower = a visible stutter, higher = a smoother fuse.">
                  <input type="range" min={1} max={48} step={1} value={seq.frameWeave.rate}
                    onChange={(e) => setSequence({ frameWeave: { ...seq.frameWeave, rate: Number(e.target.value) } })}
                    className="w-full accent-accent2" />
                </Row>
                <Row label={`length · ${seq.frameWeave.cells.length} cells`}
                  title="How many frames the lattice runs before it repeats. Growing tiles the current pattern.">
                  <input type="range" min={2} max={24} step={1} value={seq.frameWeave.cells.length}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      const cur = seq.frameWeave.cells
                      const cells = Array.from({ length: n }, (_, i) => cur[i % cur.length] ?? 0)
                      setSequence({ frameWeave: { ...seq.frameWeave, cells } })
                    }}
                    className="w-full accent-accent2" />
                </Row>
                <WeaveGrid
                  cells={seq.frameWeave.cells}
                  onPaint={(i) => {
                    const cells = seq.frameWeave.cells.slice()
                    cells[i] = cells[i] >= 3 ? -1 : cells[i] + 1 // cycle blank → L1 → L2 → L3 → L4 → blank
                    setSequence({ frameWeave: { ...seq.frameWeave, cells } })
                  }}
                />
                <p className="text-[9px] leading-tight text-muted">Click a cell to cycle its layer (1–4) or blank (·).</p>
              </>
            )}
          </Section>

          <GroupLabel title="Occasional felt marks between scenes : arrivals, ruptures and medium-drops that break the wander.">Punctuation</GroupLabel>
          <Section title="Punctuation"
            info="Occasional accents at a transition : a resolved arrival (cadence), a controlled-chaos burst (rupture), or dropping one medium as a tension marker (monomedia).">
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
      {/* Drag the foot to resize the lane (down = taller). */}
      <div
        className="h-1.5 shrink-0 cursor-row-resize rounded-b-md bg-border/40 transition-colors hover:bg-accent/60"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          hDrag.current = { y: e.clientY, h: laneH, last: laneH, z: effectiveZoom(e.currentTarget) }
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = hDrag.current
          if (!d) return
          const h = Math.max(220, Math.min(1200, d.h + (e.clientY - d.y) / d.z))
          d.last = h
          setLaneH(h)
        }}
        onPointerUp={(e) => {
          if (!hDrag.current) return
          localStorage.setItem('opsia.seqLaneH.scenes', String(Math.round(hDrag.current.last)))
          hDrag.current = null
          ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
        }}
        onPointerCancel={() => { hDrag.current = null }}
        title="Drag to make the scene lane taller or shorter"
      />
    </div>
  )
}

// The live picture over every lane (Vincent : "the LIVE preview should always be
// there, on top of the 3 lanes, so we can monitor how the sequencers are
// affecting the whole picture") : a mirror of the main composite canvas (via
// captureStream), between the transport and the lanes, never scrolled away. Its
// height : drag its foot (remembered; at most half the page, so the lanes keep
// their room). The picture keeps its own shape (a dome's square too), centered;
// a corner says which lanes are playing.
function SeqPreview({ canvasRef }: { canvasRef: RefObject<HTMLCanvasElement | null> }): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const statusRef = useRef<HTMLSpanElement | null>(null)
  const [height, setHeight] = useState<number>(() => {
    const v = Number(localStorage.getItem('opsia.seqPreviewH'))
    return Number.isFinite(v) && v >= 100 ? v : 150
  })
  const [maxH, setMaxH] = useState(560)
  const drag = useRef<{ startY: number; startH: number; last: number; z: number } | null>(null)

  // never past half the page (in the page's own pixels : the UI zoom applies)
  useEffect(() => {
    const view = ownerWindow(boxRef.current)
    const fit = (): void => setMaxH(Math.max(100, Math.min(560, Math.round((view.innerHeight / effectiveZoom(boxRef.current)) * 0.5))))
    fit()
    view.addEventListener('resize', fit)
    return () => view.removeEventListener('resize', fit)
  }, [])

  // which lanes play (written from the window's own frames, only when it changes)
  useEffect(() => {
    const view = ownerWindow(statusRef.current)
    let id = 0
    let shown = ''
    const f = (): void => {
      id = view.requestAnimationFrame(f)
      if (view.document.hidden || !statusRef.current) return
      const st = useStore.getState()
      const on = [
        st.sequence.enabled && st.sequence.running ? 'scenes' : '',
        st.soniKeySeq.on ? 'keys' : '',
        st.ruleSeqOn ? 'rules' : ''
      ].filter(Boolean)
      const txt = on.length ? `▶ ${on.join(' · ')}` : 'stopped'
      if (txt !== shown) {
        shown = txt
        statusRef.current.textContent = txt
        statusRef.current.style.color = on.length ? 'rgb(var(--c-accent))' : ''
      }
    }
    id = view.requestAnimationFrame(f)
    return () => view.cancelAnimationFrame(id)
  }, [])

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

  const h = Math.min(height, maxH)
  return (
    <div ref={boxRef} data-seq-live className="flex shrink-0 flex-col border-b border-border bg-black/40">
      <div className="relative flex min-h-0 items-center justify-center p-2" style={{ height: h }}>
        <span className="pointer-events-none absolute left-3 top-2 z-10 font-mono text-[9px] uppercase tracking-wide text-muted">
          live
        </span>
        <span
          ref={statusRef}
          data-seq-live-status
          className="pointer-events-none absolute right-3 top-2 z-10 font-mono text-[9px] text-muted"
        />
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="h-full max-w-full rounded border border-border bg-black object-contain"
        />
      </div>
      {/* Drag the foot to resize (down = taller). */}
      <div
        className="h-1.5 shrink-0 cursor-row-resize bg-border/60 transition-colors hover:bg-accent/60"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          // (screen pixels to the zoomed page's own, as the column's edge)
          drag.current = { startY: e.clientY, startH: h, last: h, z: effectiveZoom(e.currentTarget) }
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const nh = Math.max(100, Math.min(maxH, d.startH + (e.clientY - d.startY) / d.z))
          d.last = nh
          setHeight(nh)
        }}
        onPointerUp={(e) => {
          if (drag.current) {
            localStorage.setItem('opsia.seqPreviewH', String(drag.current.last))
            drag.current = null
            ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
          }
        }}
        onPointerCancel={(e) => {
          if (drag.current) {
            localStorage.setItem('opsia.seqPreviewH', String(drag.current.last))
            drag.current = null
            ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
          }
        }}
        title="Drag to make the live picture taller or shorter"
      />
    </div>
  )
}

// A titled, bordered card. `info` is an overview shown on hovering the header
// (and flagged by a faint ⓘ), so each cluster of controls explains itself.
function Section({ title, info, children }: { title: string; info?: string; children: ReactNode }): JSX.Element {
  return (
    <section className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-panel2/20 p-2">
      <div className="flex items-center gap-1 border-b border-border/40 pb-1" title={info}>
        <span className="font-mono text-[9px] uppercase tracking-wide text-accent2/80">{title}</span>
        {info && <span className="ml-auto cursor-help font-mono text-[10px] leading-none text-muted/50" title={info}>ⓘ</span>}
      </div>
      {children}
    </section>
  )
}
// A faint divider that clusters the sections into higher-level groups.
function GroupLabel({ children, title }: { children: ReactNode; title?: string }): JSX.Element {
  return (
    <div className="mt-1 flex items-center gap-2 px-0.5 first:mt-0" title={title}>
      <span className="font-mono text-[8px] uppercase tracking-[0.22em] text-muted/70">{children}</span>
      <div className="h-px flex-1 bg-border/40" />
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
  if (!running) return <span className="font-mono text-[10px] text-muted" title="The auto-pilot is stopped. Press play to hand it the show.">idle</span>
  if (armed) return <span className="font-mono text-[10px] text-accent2" title="Dwell has elapsed : the next step is armed and now waiting for the audio / chaos trigger you set under Transport → advance on.">◉ armed : waiting for trigger</span>
  return <span className="font-mono text-[10px] text-muted" title="Countdown to the next automatic scene change.">next in {(ms / 1000).toFixed(1)}s</span>
}

// Live arc-intensity bar (repose ↔ disturbance).
function ArcMeter({ enabled }: { enabled: boolean }): JSX.Element {
  return <LevelMeter label="arc" enabled={enabled} get={sequencerArcIntensity} />
}

// The paintable Frame-Weave lattice : one square per frame-cell, colour-coded by
// layer (1–4) or blank (·). The cell currently playing is ringed (polled live).
const WEAVE_HUE = [205, 32, 135, 292] // four distinct layer hues
function WeaveGrid({ cells, onPaint }: { cells: number[]; onPaint: (i: number) => void }): JSX.Element {
  const [active, setActive] = useState(-1)
  useEffect(() => {
    const id = window.setInterval(() => setActive(frameWeaveActiveCell()), 80)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div className="flex flex-wrap gap-1">
      {cells.map((v, i) => {
        const isActive = i === active
        const bg = v < 0 ? 'transparent' : `hsl(${WEAVE_HUE[v] ?? 0} 55% 34%)`
        return (
          <button
            key={i}
            onClick={() => onPaint(i)}
            className={`flex h-6 w-6 items-center justify-center rounded border font-mono text-[10px] transition-transform ${
              isActive ? 'scale-110 border-accent ring-1 ring-accent' : 'border-border'
            }`}
            style={{ background: bg, color: v < 0 ? 'rgb(var(--c-muted))' : 'white' }}
            title={`frame ${i + 1} : ${v < 0 ? 'blank' : `layer ${v + 1}`} (click to cycle)`}
          >
            {v < 0 ? '·' : v + 1}
          </button>
        )
      })}
    </div>
  )
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
