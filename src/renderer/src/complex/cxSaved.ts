// Complex Output : what this computer keeps (localStorage). The setup belongs to the
// room, so to the computer, like the keystone; whether it is live comes back only in
// an installation; presets by name.

import { CX_EMPTY, sanitizeSetup, type CxSetup } from '@shared/complexOut'

const KEY = 'opsia.complexOut', LIVE = 'opsia.complexLive', SESSION = 'opsia.complexInSession', PRESETS = 'opsia.complexPresets'

const read = (k: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? 'null')
  } catch {
    return null
  }
}
const write = (k: string, v: string): boolean => {
  try {
    localStorage.setItem(k, v)
    return true
  } catch {
    return false // full : what plays goes on
  }
}

export const loadSetup = (): CxSetup => {
  const v = read(KEY)
  return v ? sanitizeSetup(v) : CX_EMPTY
}
let timer: ReturnType<typeof setTimeout> | null = null
let waiting: CxSetup | null = null
/** Written once the hand rests (a fader over MIDI moves it at 100 messages a second). */
export function saveSetup(s: CxSetup): void {
  waiting = s
  if (timer) return
  timer = setTimeout(flushSetup, 400)
}
export function flushSetup(): void {
  if (timer) clearTimeout(timer)
  timer = null
  if (waiting) write(KEY, JSON.stringify(waiting))
  waiting = null
}
if (typeof window !== 'undefined') window.addEventListener('beforeunload', flushSetup)

export const loadLive = (): boolean => read(LIVE) === 1
export const saveLive = (on: boolean): void => void write(LIVE, on ? '1' : '0')
export const loadInSession = (): boolean => read(SESSION) === 1
export const saveInSession = (on: boolean): void => void write(SESSION, on ? '1' : '0')

export interface CxPreset {
  name: string
  setup: CxSetup
}
export function loadPresets(): CxPreset[] {
  const v = read(PRESETS)
  return Array.isArray(v) ? v.filter((p) => p && typeof p.name === 'string' && p.setup).slice(0, 100).map((p) => ({ name: String(p.name).slice(0, 60), setup: sanitizeSetup(p.setup) })) : []
}
/** Saved under its name (over one of that name). False : this computer's storage is full. */
export function savePreset(name: string, setup: CxSetup): boolean {
  const n = name.trim().slice(0, 60)
  if (!n) return false
  return write(PRESETS, JSON.stringify([...loadPresets().filter((p) => p.name.toLowerCase() !== n.toLowerCase()), { name: n, setup }].sort((a, b) => a.name.localeCompare(b.name))))
}
export const deletePreset = (name: string): void => void write(PRESETS, JSON.stringify(loadPresets().filter((p) => p.name !== name)))
