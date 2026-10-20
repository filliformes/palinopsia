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
// Per machine (like OSC) : localStorage, never in a session.

import { useSyncExternalStore } from 'react'
import { useStore } from './store'
import type { LinkState } from '@shared/types'
import { isTempoTyping, onTempoEdited } from './tempoEvents'
import { setTempoShared } from './sessionGuard'
import { runSilently } from './undo'

export interface LinkSettings {
  enabled: boolean
  /** beats per bar the phase is aligned to (Link's quantum) */
  quantum: number
  /** the picture shows this late (a projector, a capture card) : Palinopsia
   *  runs this many ms ahead so it lands on the beat */
  latencyMs: number
}

const KEY = 'opsia.link'
const DEFAULTS: LinkSettings = { enabled: false, quantum: 4, latencyMs: 0 }

function load(): LinkSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<LinkSettings> | null
    if (raw && typeof raw === 'object') {
      return {
        enabled: !!raw.enabled,
        quantum: Math.max(1, Math.min(16, Math.round(Number(raw.quantum) || 4))),
        latencyMs: Math.max(-200, Math.min(400, Number(raw.latencyMs) || 0))
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
const emit = (): void => {
  snap = { settings, state }
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
    take(await a.linkConfigure({ enabled: settings.enabled, quantum: settings.quantum }))
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
  if (before.enabled !== settings.enabled || before.quantum !== settings.quantum) void configure()
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
  if (!a || !active()) return
  const now = performance.now()
  state = { ...state, beat: beatAt(now), tempo: bpm }
  atLocal = now
  holdUntil = now + 250
  a.linkSetTempo(bpm)
}

/** Once a frame from App's loop, before the clocks read the BPM. */
export function tickLink(now: number): void {
  // a BPM being typed is Palinopsia's alone until it is settled
  if (!active() || now < holdUntil || isTempoTyping()) return
  const bpm = useStore.getState().composition.bpm
  const tempo = Math.round(state.tempo * 100) / 100
  if (Math.abs(bpm - tempo) < 0.005) return
  if (state.peers > 0) {
    // the session's tempo wins over a session, a scene, Randomize, a morph. It
    // is nobody's edit here, so never an undo step : Ctrl+Z would stop on it,
    // and the step it undid would only be written back the next frame.
    runSilently(() => useStore.setState((s) => ({ composition: { ...s.composition, bpm: tempo } })))
  } else {
    // alone, Palinopsia leads : whatever set the BPM sets Link's
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
    emit()
  })
  const offTempo = onTempoEdited((bpm) => propose(bpm))
  // With Link on, the tempo is the network's, not the piece's : the Save
  // changes? question leaves it out (./sessionGuard.ts).
  setTempoShared(active)
  g.__opsiaLinkOff = () => {
    offState?.()
    offTempo()
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
