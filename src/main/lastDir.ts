// The folder each file dialog last used, remembered across launches.
//
// Since Electron 43 a dialog given no defaultPath opens in Downloads every time
// (it used to be the system's own memory of the last folder), so every picker
// passes its last folder back. A folder picker remembers the folder ABOVE the one
// chosen, so it opens beside it, on its siblings.

import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

const file = (): string => join(app.getPath('userData'), 'dialog-folders.json')
let cache: Record<string, string> | null = null

function load(): Record<string, string> {
  if (cache) return cache
  try {
    const j = JSON.parse(readFileSync(file(), 'utf8')) as unknown
    cache = j && typeof j === 'object' ? (j as Record<string, string>) : {}
  } catch {
    cache = {}
  }
  return cache
}

/** Where a picker should open : its last folder while it still exists, else
 *  `fallback` (undefined : the system default). */
export function lastDir(key: string, fallback?: string): string | undefined {
  const d = load()[key]
  return typeof d === 'string' && existsSync(d) ? d : fallback
}

/** Remember where a picker was used : a picked FILE's folder, or the folder
 *  above a picked folder. */
export function rememberDir(key: string, picked: string): void {
  const dir = dirname(picked)
  const m = load()
  if (m[key] === dir) return
  m[key] = dir
  try {
    writeFileSync(file(), JSON.stringify(m, null, 1))
  } catch {
    /* best effort : the next dialog just opens in the default place */
  }
}
