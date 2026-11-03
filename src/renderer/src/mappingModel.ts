// The learned mappings as data : what a MIDI or OSC binding may hold, read back
// from localStorage or a session file (anything malformed is dropped, never
// fatal), and how an OSC value reads against its learned range. Pure : no
// store, so the store, MIDI and OSC Learn can all import it.
//
// Two scopes (MappingScope) : this computer (localStorage, every session : the
// MIDI map as it always was, plus the OSC map) and this session (the session
// file's `mappings`). The Macro knobs' CCs are neither : they stay on the knob
// itself, in the composition (so the session and its scenes), as before.

import type { MidiBinding, OscBinding, SessionMappings } from '@shared/types'

export function sanitizeMidiBinding(b: unknown): MidiBinding | null {
  const m = b as Partial<MidiBinding> | null
  if (!m || (m.kind !== 'cc' && m.kind !== 'note')) return null
  if (!Number.isInteger(m.channel) || !Number.isInteger(m.number)) return null
  return { kind: m.kind, channel: Math.max(0, Math.min(15, m.channel!)), number: Math.max(0, Math.min(127, m.number!)) }
}

export function sanitizeOscBinding(b: unknown): OscBinding | null {
  const o = b as Partial<OscBinding> | null
  if (!o || o.kind !== 'osc' || typeof o.address !== 'string') return null
  const address = o.address.trim()
  // an address, and never the built-in door (/opsia/… is the router's own)
  if (!address.startsWith('/') || address.length < 2 || /^\/opsia(\/|$)/.test(address)) return null
  const arg = Number.isInteger(o.arg) && (o.arg as number) >= 0 ? Math.min(63, o.arg as number) : 0
  let min = typeof o.min === 'number' && Number.isFinite(o.min) ? o.min : 0
  let max = typeof o.max === 'number' && Number.isFinite(o.max) ? o.max : 1
  if (min === max) max = min + 1
  if (min > max) [min, max] = [max, min]
  return {
    kind: 'osc',
    address,
    arg,
    min,
    max,
    ...(o.int ? { int: true } : {}),
    ...(o.bool ? { bool: true } : {}),
    host: typeof o.host === 'string' ? o.host.slice(0, 64) : ''
  }
}

function sanitizeMap<B>(raw: unknown, one: (b: unknown) => B | null): Record<string, B> {
  const out: Record<string, B> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [id, b] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || id.length > 200) continue
    const v = one(b)
    if (v) out[id] = v
  }
  return out
}

export const sanitizeMidiMap = (raw: unknown): Record<string, MidiBinding> => sanitizeMap(raw, sanitizeMidiBinding)
export const sanitizeOscMap = (raw: unknown): Record<string, OscBinding> => sanitizeMap(raw, sanitizeOscBinding)

/** A session file's mappings, or nothing (both maps empty : the field is left
 *  out, so a session without any is the same file as before). */
export function sessionMappingsOut(midi: Record<string, MidiBinding>, osc: Record<string, OscBinding>): SessionMappings | null {
  const hasMidi = Object.keys(midi).length > 0
  const hasOsc = Object.keys(osc).length > 0
  if (!hasMidi && !hasOsc) return null
  return { ...(hasMidi ? { midi } : {}), ...(hasOsc ? { osc } : {}) }
}

export function sameMidiInput(a: MidiBinding, b: MidiBinding): boolean {
  return a.kind === b.kind && a.channel === b.channel && a.number === b.number
}

/** The input an OSC binding listens to : its address and which value. */
export const oscInputKey = (b: OscBinding): string => `${b.address}|${b.arg}`

/** A computer mapping the session's own mappings stand in for : one of them
 *  is on the same input (the same channel + CC or note; the same address +
 *  value). The session's setup wins for the inputs it uses, only those. */
export function silencedBySession(b: MidiBinding | OscBinding, midi: Record<string, MidiBinding>, osc: Record<string, OscBinding>): boolean {
  if (b.kind === 'osc') {
    for (const id in osc) if (osc[id].address === b.address && osc[id].arg === b.arg) return true
    return false
  }
  for (const id in midi) if (sameMidiInput(midi[id], b)) return true
  return false
}

/** 'CC21 ch1' / 'NOTE 36 ch10' / '/1/fader3' (+ which value when it is not the
 *  first) : one shape everywhere a binding is shown. */
export function describeAnyBinding(b: MidiBinding | OscBinding): string {
  if (b.kind === 'osc') return b.arg > 0 ? `${b.address} #${b.arg + 1}` : b.address
  return `${b.kind === 'cc' ? 'CC' : 'NOTE '}${b.number} ch${b.channel + 1}`
}

// ── Values ────────────────────────────────────────────────────────────

/** One OSC argument as a number : floats, ints, doubles, true / false. Null for
 *  anything else (a string, a blob, nil, an impulse, nothing). */
export function oscArgNumber(a: { type: string; value: unknown } | undefined): number | null {
  if (!a) return null
  if (a.type === 'T' || a.value === true) return 1
  if (a.type === 'F' || a.value === false) return 0
  if (a.type === 's' || a.type === 'S' || a.type === 'c') return null
  return typeof a.value === 'number' && Number.isFinite(a.value) ? a.value : null
}

/** The value read against the binding's range, 0..1. */
export function oscNorm(v: number, b: OscBinding): number {
  const span = b.max - b.min
  if (!(span > 0)) return v >= b.max ? 1 : 0
  const t = (v - b.min) / span
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/** A 0..1 position back in the controller's own range (whole when it sends ints). */
export function oscDenorm(t: number, b: OscBinding): number {
  const v = b.min + Math.max(0, Math.min(1, t)) * (b.max - b.min)
  return b.int || b.bool ? Math.round(v) : v
}

// ── Calibration ───────────────────────────────────────────────────────
// What range a value moves over, from the values seen so far :
//   inside 0..1 (true / false too)        → 0..1
//   inside -1..1, some below 0            → -1..1 (a phone's tilt)
//   whole numbers 0..127                  → 0..127 (MIDI-like faders)
//   anything else                         → the span seen, with 0 in it
// It only ever widens : a learned binding keeps calibrating for a few seconds
// (CALIBRATE_MS), and each new range holds the last one.

export interface Seen {
  min: number
  max: number
  allInt: boolean
}

export function calibrate(seen: Seen, prev?: { min: number; max: number }): { min: number; max: number; int: boolean } {
  let lo: number, hi: number
  let int = false
  if (seen.min >= 0 && seen.max <= 1) {
    lo = 0
    hi = 1
    int = seen.allInt
  } else if (seen.min >= -1 && seen.max <= 1) {
    lo = -1
    hi = 1
  } else if (seen.allInt && seen.min >= 0 && seen.max <= 127) {
    lo = 0
    hi = 127
    int = true
  } else {
    lo = Math.min(0, seen.min)
    hi = Math.max(0, seen.max)
    int = seen.allInt
    if (hi === lo) hi = lo + 1
  }
  if (prev) {
    lo = Math.min(lo, prev.min)
    hi = Math.max(hi, prev.max)
  }
  return { min: lo, max: hi, int }
}

export const CALIBRATE_MS = 5000
