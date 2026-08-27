// Sonify presets : the whole SoniConfig saved by name in localStorage (machine-
// local, like the sink). `on` and `sinkId` are never stored — a preset is a
// sound patch, not a transport / output-routing state.

import type { SoniConfig } from './sonify'

const KEY = 'opsia.soniPresets'
type Store = Record<string, SoniConfig>

function read(): Store {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}')
    return v && typeof v === 'object' ? (v as Store) : {}
  } catch {
    return {}
  }
}
function write(s: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* quota / private mode — presets just won't persist */
  }
}

export function listSoniPresets(): string[] {
  return Object.keys(read()).sort((a, b) => a.localeCompare(b))
}
export function saveSoniPreset(name: string, cfg: SoniConfig): void {
  const n = name.trim()
  if (!n) return
  const s = read()
  s[n] = { ...cfg, on: false, sinkId: '' }
  write(s)
}
export function loadSoniPreset(name: string): SoniConfig | null {
  return read()[name] ?? null
}
export function deleteSoniPreset(name: string): void {
  const s = read()
  delete s[name]
  write(s)
}
