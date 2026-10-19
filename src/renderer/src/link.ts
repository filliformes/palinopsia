// Ableton Link, page side. The main process (src/main/link.ts) reads the Link
// session 30 times a second; here the beat is carried on between two reads by
// the clock, so the picture never steps at 30 Hz.
//
// While Link is enabled :
// - the BPM is shared. With other apps linked, theirs wins over anything that
//   is not your own hands (a session, a scene, Randomize); your own BPM edits
//   (the box, tap, MIDI, OSC) go to every app. Alone, Palinopsia leads.
// - the bar is shared : the Sonify sequencers start on the next Link bar, and
//   the modulators synced to the BPM slide onto the shared grid (./engine/
//   modulation.ts), so a 1/1 LFO peaks where everyone's bar starts.
// Per machine (like OSC) : localStorage, never in a session.

import { useSyncExternalStore } from 'react'
import { useStore } from './store'
import type { LinkState } from '@shared/types'
import { onTempoEdited } from './tempoEvents'
import { setTempoShared } from './sessionGuard'

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

let settings = load()
let state: LinkState = { available: true, enabled: false, peers: 0, tempo: 120, beat: 0, phase: 0, at: 0 }
let snap = { settings, state }
const listeners = new Set<() => void>()
const emit = (): void => {
  snap = { settings, state }
  for (const fn of listeners) fn()
}

const api = (): typeof window.api | null =>
  typeof window !== 'undefined' && typeof (window.api as Partial<typeof window.api> | undefined)?.linkConfigure === 'function' ? window.api : null

async function configure(): Promise<void> {
  const a = api()
  if (!a) return
  try {
    state = await a.linkConfigure({ enabled: settings.enabled, quantum: settings.quantum })
  } catch (e) {
    state = { ...state, available: false, error: (e as Error).message, enabled: false }
  }
  emit()
}

export const linkSettings = (): LinkSettings => settings

export function setLinkSettings(patch: Partial<LinkSettings>): void {
  const before = settings
  settings = { ...settings, ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch { /* private storage */ }
  if (before.enabled !== settings.enabled || before.quantum !== settings.quantum) void configure()
  else emit()
}

const active = (): boolean => settings.enabled && state.enabled && state.at > 0

/** Link's beat at `now` (performance.now()), latency lead included; null while
 *  Link is disabled. Beats count from the session's own origin : a multiple of
 *  the quantum is the top of a Link bar. */
export function linkBeats(now: number): number | null {
  if (!active()) return null
  const t = performance.timeOrigin + now + settings.latencyMs
  return state.beat + ((t - state.at) * state.tempo) / 60000
}

export const linkQuantum = (): number => settings.quantum

/** Other apps are linked : the tempo is the session's, not the piece's (the
 *  Save changes? question ignores it, like this computer's warp). */
export const linkShared = (): boolean => active() && state.peers > 0

// ── tempo ─────────────────────────────────────────────────────────────────
let holdUntil = 0

/** Send a tempo to the session and take it at once here (the main process
 *  confirms it within a read or two). */
function propose(bpm: number): void {
  const a = api()
  if (!a || !active()) return
  const now = performance.now()
  const t = performance.timeOrigin + now
  state = { ...state, beat: state.beat + ((t - state.at) * state.tempo) / 60000, at: t, tempo: bpm }
  holdUntil = now + 250
  a.linkSetTempo(bpm)
}

/** Once a frame from App's loop, before the clocks read the BPM. */
export function tickLink(now: number): void {
  if (!active() || now < holdUntil) return
  const bpm = useStore.getState().composition.bpm
  const tempo = Math.round(state.tempo * 100) / 100
  if (Math.abs(bpm - tempo) < 0.005) return
  if (state.peers > 0) {
    // the session's tempo wins over a session, a scene, Randomize, a morph
    useStore.setState((s) => ({ composition: { ...s.composition, bpm: tempo } }))
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
    state = s
    emit()
  })
  const offTempo = onTempoEdited((bpm) => propose(bpm))
  setTempoShared(linkShared)
  g.__opsiaLinkOff = () => {
    offState?.()
    offTempo()
  }
  if (settings.enabled) void configure()
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
