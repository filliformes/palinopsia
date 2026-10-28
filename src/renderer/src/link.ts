// Ableton Link, page side. The main process (src/main/link.ts) reads the Link
// session 30 times a second; here the beat is carried on between two reads by
// the clock, so the picture never steps at 30 Hz.
//
// While Link is enabled :
// - the BPM is shared. With other apps linked, theirs wins over anything that
//   is not your own hands (a session, a scene, Randomize); your own BPM edits
//   (the box, tap, MIDI, OSC, undoing one) go to every app. Alone, Palinopsia
//   leads. A BPM being typed reaches Link only once it is settled (Enter, or
//   leaving the box), never the "20" on the way to "130".
// - the bar is shared : the Sonify sequencers start on the next Link bar, and
//   the modulators synced to the BPM slide onto the shared grid (./engine/
//   modulation.ts), so a 1/1 LFO peaks where everyone's bar starts.
// - with start / stop sync (off by default, as in Live), the play and stop are
//   shared too : see "start / stop" below.
// Per machine (like OSC) : localStorage, never in a session.

import { useSyncExternalStore } from 'react'
import { useStore } from './store'
import type { LinkState } from '@shared/types'
import { onTempoEdited } from './tempoEvents'
import { setTempoShared } from './sessionGuard'
import { runSilently, writeLinkTempo } from './undo'
import { onPlayEdited, type PlayThing } from './playEvents'
import { soniClockPlayAt } from './audio/soniClock'
import { modEngine } from './engine/modulation'

export interface LinkSettings {
  enabled: boolean
  /** beats per bar the phase is aligned to (Link's quantum) */
  quantum: number
  /** the picture shows this late (a projector, a capture card) : Palinopsia
   *  runs this many ms ahead so it lands on the beat */
  latencyMs: number
  /** start / stop sync : the session's play and stop are Palinopsia's, and
   *  Palinopsia's are the session's */
  startStop: boolean
}

const KEY = 'opsia.link'
const DEFAULTS: LinkSettings = { enabled: false, quantum: 4, latencyMs: 0, startStop: false }

function load(): LinkSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<LinkSettings> | null
    if (raw && typeof raw === 'object') {
      return {
        enabled: !!raw.enabled,
        quantum: Math.max(1, Math.min(16, Math.round(Number(raw.quantum) || 4))),
        latencyMs: Math.max(-200, Math.min(400, Number(raw.latencyMs) || 0)),
        startStop: !!raw.startStop
      }
    }
  } catch { /* defaults */ }
  return { ...DEFAULTS }
}

function save(): void {
  try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch { /* private storage */ }
}

let settings = load()
let state: LinkState = { available: true, enabled: false, peers: 0, tempo: 120, beat: 0, phase: 0, at: 0 }
// state.at on this page's own clock (performance.now())
let atLocal = 0
let snap = { settings, state }
const listeners = new Set<() => void>()
// What the Link section and the badge show of a read : a read that changes none
// of it re-renders nobody (the reads come 30 times a second for the whole show;
// the beat is read through linkBeats, never through the snapshot).
const shown = (s: LinkState): string =>
  `${s.available}|${s.enabled}|${s.peers}|${s.quantum}|${Math.round(s.tempo * 100)}|${s.error ?? ''}|${s.startStop}|${s.playing}`
let shownKey = ''
const emit = (): void => {
  snap = { settings, state }
  shownKey = shown(state)
  for (const fn of listeners) fn()
}

// The main process stamps each read with the system's wall clock (see
// src/main/link.ts for why not performance.timeOrigin). Brought onto this page's
// clock with the offset between the two measured NOW, so a clock adjustment or
// the drift since the page loaded never sets the beat off. Date.now() counts
// whole milliseconds : the highest recent reading is the exact offset, a slow
// leak follows the drift, a jump (the clock set, a long pause) is taken at once.
let wallOff = NaN
function wallOffset(): number {
  const s = Date.now() - performance.now()
  if (!(Math.abs(s - wallOff) < 2)) wallOff = s
  else wallOff = Math.max(s, wallOff - 0.005)
  return wallOff
}

function take(s: LinkState): void {
  state = s
  atLocal = s.at - wallOffset()
}

const api = (): typeof window.api | null =>
  typeof window !== 'undefined' && typeof (window.api as Partial<typeof window.api> | undefined)?.linkConfigure === 'function' ? window.api : null

async function configure(): Promise<void> {
  const a = api()
  if (!a) return
  try {
    take(await a.linkConfigure({ enabled: settings.enabled, quantum: settings.quantum, startStop: settings.startStop }))
  } catch (e) {
    state = { ...state, available: false, error: (e as Error).message, enabled: false }
  }
  // Missing from this build : Link stays off, and off is what is remembered (an
  // "enabled" kept would try again at every start, with the button locked)
  if (!state.available && settings.enabled) {
    settings = { ...settings, enabled: false }
    save()
  }
  emit()
}

/** At startup with Link off : is it in this build at all? Asked without
 *  turning it on, so the section says "missing" before anyone tries. */
async function probe(): Promise<void> {
  const a = api()
  if (!a || typeof a.linkState !== 'function') return
  try {
    const s = await a.linkState()
    if (!settings.enabled) { // enabled meanwhile : configure's answer wins
      take(s)
      emit()
    }
  } catch { /* asked again when enabled */ }
}

export const linkSettings = (): LinkSettings => settings

export function setLinkSettings(patch: Partial<LinkSettings>): void {
  const before = settings
  settings = { ...settings, ...patch }
  // nothing to turn on when this build has no Link
  if (settings.enabled && !before.enabled && !state.available) settings = { ...settings, enabled: false }
  save()
  const reconfigure = before.enabled !== settings.enabled || before.quantum !== settings.quantum || before.startStop !== settings.startStop
  if (reconfigure) void configure()
  else emit()
}

const active = (): boolean => settings.enabled && state.enabled && state.at > 0

const beatAt = (now: number): number => state.beat + ((now - atLocal) * state.tempo) / 60000

/** Link's beat at `now` (performance.now()); null while Link is disabled. With
 *  `lead` (the picture's clock) the latency lead is included; without it, the
 *  beat as it sounds (Sonify). Beats count from the session's own origin : a
 *  multiple of linkQuantum() is the top of a Link bar. */
export function linkBeats(now: number, lead = true): number | null {
  if (!active()) return null
  return beatAt(lead ? now + settings.latencyMs : now)
}

/** The bar linkBeats() counts in : the quantum the last read was taken for, so
 *  the two always match (a bar change re-maps Link's beat count, and the new
 *  count arrives with the main process's answer, a moment after the click). */
export const linkQuantum = (): number => (active() && state.quantum ? state.quantum : settings.quantum)

/** Other apps are linked : the tempo is the session's, not the piece's. */
export const linkShared = (): boolean => active() && state.peers > 0

// ── tempo ─────────────────────────────────────────────────────────────────
let holdUntil = 0

/** Send a tempo to the session and take it at once here (the main process
 *  confirms it within a read or two). */
function propose(bpm: number): void {
  const a = api()
  if (!a || !active() || !Number.isFinite(bpm)) return
  bpm = Math.max(20, Math.min(999, bpm)) // Link's own range (main clamps the same)
  const now = performance.now()
  state = { ...state, beat: beatAt(now), tempo: bpm }
  atLocal = now
  holdUntil = now + 250
  a.linkSetTempo(bpm)
}

// when the session's tempo was last written into the store
let wroteAt = 0

// ── start / stop ──────────────────────────────────────────────────────────
// With start / stop sync on (here and in the other apps), the session's play
// and stop are Palinopsia's : one transport for every linked app.
// - A play (from any app) starts, on the bar it starts on : the MIDI clock's
//   Start (./midi.ts reads linkPlay), and the sequencers the last stop stopped
//   (the Sonify step and key sequences, the scene sequencer; before any stop,
//   the scene sequencer when the session uses it). A stop stops them all, and
//   sends the MIDI Stop.
// - Here, starting one of them, or the MIDI clock, while the session is stopped
//   plays it for every app; stopping the last one still going stops it (and the
//   next play starts it again); stopping one while others go stops only it.
//   What the session's own play or stop starts and stops is never proposed back.
// - The play button of the Link section plays or stops the session itself.

type Seq = Exclude<PlayThing, 'clock'>
// Kept across a hot update : a fresh module would take a play under way for
// a new one.
type PlayState = {
  /** the session's transport as last followed (null : start / stop sync off) */
  seen: boolean | null
  /** a play is under way and its bar is still to come */
  pending: boolean
  /** what the last stop stopped (null : no stop yet) */
  resume: Seq[] | null
  /** the sequencer stopped here whose stop stops the session : the next play
   *  starts it again */
  last: Seq | null
}
const ps: PlayState = ((globalThis as { __opsiaLinkPlay?: PlayState }).__opsiaLinkPlay ??= {
  seen: null, pending: false, resume: null, last: null
})
// the session's own play or stop being applied : never proposed back
let applying = false

const syncing = (): boolean => active() && settings.startStop && !!state.startStop

/** The session's transport while start / stop sync is on : playing or not,
 *  and the bar its play starts on (on linkBeats' count : Live and Link put
 *  beat 0 there, the count before it is negative). null when off. */
export function linkPlay(): { playing: boolean; at: number } | null {
  if (!syncing()) return null
  const q = linkQuantum()
  return { playing: !!state.playing, at: Math.ceil(((state.playBeat ?? 0) - 1e-3) / q) * q }
}

/** Propose play or stop to every linked app (start / stop sync on). */
export function setLinkPlaying(on: boolean): void {
  const a = api()
  if (!a || typeof a.linkSetPlaying !== 'function' || !syncing()) return
  a.linkSetPlaying(on)
}

/** What a play starts before any stop : the scene sequencer, when the session
 *  uses it. */
const firstPlay = (): Seq[] => (useStore.getState().sequence.enabled ? ['scenes'] : [])

function runningSeqs(): Seq[] {
  const st = useStore.getState()
  const r: Seq[] = []
  if (st.soniSeq.on) r.push('soniSeq')
  if (st.soniKeySeq.on) r.push('keySeq')
  if (st.sequence.enabled && st.sequence.running) r.push('scenes')
  return r
}

/** Start or stop sequencers for the session's play or stop : silently (no
 *  undo step : nobody's edit here) and never proposed back. */
function setSeqs(on: boolean, which: Seq[]): void {
  if (!which.length) return
  applying = true
  try {
    runSilently(() => {
      const st = useStore.getState()
      if (which.includes('soniSeq') && st.soniSeq.on !== on) st.setSoniSeqOn(on)
      if (which.includes('keySeq') && st.soniKeySeq.on !== on) st.setSoniKeySeqOn(on)
      const sq = useStore.getState().sequence
      // the scene sequencer needs scenes to go between (as its play button)
      if (which.includes('scenes') && sq.running !== on && (!on || (sq.enabled && useStore.getState().scenes.length > 1))) {
        useStore.getState().setSequence({ running: on })
      }
    })
  } finally {
    applying = false
  }
}

/** Follow the session's play and stop (once a frame, from tickLink). */
function tickPlay(now: number): void {
  const p = linkPlay()
  const playing = p ? p.playing : null
  soniClockPlayAt(p?.playing ? p.at : null)
  if (playing !== ps.seen) {
    const before = ps.seen
    ps.seen = playing
    if (playing) {
      // a play, or start / stop sync turned on while the session plays (its
      // bar long gone : what follows joins at once, the sequencers on their
      // next bar)
      ps.pending = true
      ps.last = null
    } else if (playing === false && before) {
      // a stop : what goes stops, and starts again with the next play (a stop
      // before the play's bar came keeps what that play was to start)
      const going = runningSeqs()
      const was = ps.last ? [...going, ps.last] : going
      ps.resume = [...new Set(ps.pending ? [...(ps.resume ?? firstPlay()), ...was] : was)]
      ps.pending = false
      ps.last = null
      setSeqs(false, going)
    } else ps.pending = false
  }
  if (!ps.pending || !p?.playing) return
  // the bar is read anew each time : the count can move by whole bars meanwhile
  const b = linkBeats(now, false)
  if (b != null && b < p.at - 1e-3) return
  ps.pending = false
  setSeqs(true, ps.resume ?? firstPlay())
  // the steps modulators start their run on the same bar (pass 1 : first, A:B)
  modEngine.restartRuns()
}

// Something started or stopped here on purpose (./playEvents.ts).
function playEditedHere(what: PlayThing, on: boolean): void {
  if (applying || !syncing()) return
  if (on) {
    if (!state.playing) setLinkPlaying(true)
    return
  }
  // the last one still going : the session stops (and the next play starts it again)
  const st = useStore.getState()
  const clock = st.midiClockOut && !!st.midiOutputName
  if (!state.playing || clock || runningSeqs().length) return
  ps.last = what === 'clock' ? null : what
  setLinkPlaying(false)
}

/** Once a frame from App's loop, before the clocks read the BPM. */
export function tickLink(now: number): void {
  tickPlay(now)
  if (!active() || now < holdUntil) return
  const bpm = useStore.getState().composition.bpm
  // a session with no BPM (hand-edited) : nothing to share until one is set
  if (!Number.isFinite(bpm)) return
  const tempo = Math.round(state.tempo * 100) / 100
  if (Math.abs(bpm - tempo) < 0.005) return
  if (state.peers > 0) {
    // the session's tempo wins over a session, a scene, Randomize, a morph. It
    // is nobody's edit here, so never an undo step : Ctrl+Z would stop on it,
    // and the step it undid would only be written back the next frame. During
    // a linked app's tempo ramp, written ten times a second, not every frame
    // (the beat comes from linkBeats, and each write re-renders the composition's
    // readers); a single change is written at once.
    if (now - wroteAt < 100) return
    wroteAt = now
    writeLinkTempo(tempo)
  } else if (Math.abs(Math.max(20, Math.min(999, bpm)) - tempo) >= 0.005) {
    // alone, Palinopsia leads : whatever set the BPM sets Link's (a BPM past
    // Link's 20..999 goes at its edge, once, not again at every read)
    propose(bpm)
  }
}

// ── wiring (once per page; a hot update replaces the old listeners) ───────
type G = { __opsiaLinkOff?: () => void }
const g = globalThis as G
g.__opsiaLinkOff?.()
{
  const a = api()
  const offState = a?.onLinkState((s) => {
    // a read taken before our own tempo proposal reached Link would undo it
    if (performance.now() < holdUntil && Math.abs(s.tempo - state.tempo) > 0.005) return
    take(s)
    if (shown(s) !== shownKey) emit()
  })
  const offTempo = onTempoEdited((bpm) => propose(bpm))
  const offPlay = onPlayEdited(playEditedHere)
  // With Link on, the tempo is the network's, not the piece's : the Save
  // changes? question leaves it out (./sessionGuard.ts).
  setTempoShared(active)
  g.__opsiaLinkOff = () => {
    offState?.()
    offTempo()
    offPlay()
  }
  if (settings.enabled) void configure()
  else void probe()
}

export function useLink(): { settings: LinkSettings; state: LinkState } {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    () => snap
  )
}
