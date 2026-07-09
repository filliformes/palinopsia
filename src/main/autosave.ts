// Autosave + crash detection.
//
// - On startup, `startAutosave()` writes a `.running` sentinel file. If that
//   file already existed, the previous run didn't shut down cleanly → we
//   report `crashed: true` so the renderer can offer a Restore prompt.
// - Every ~60s (and on clean shutdown) the current session snapshot is
//   written to a rotating set of autosave files in `<userData>/autosave/`.
// - `stopAutosave()` clears the timer, writes a final snapshot, and removes
//   the sentinel : the marker of a clean exit.

import { app } from 'electron'
import { promises as fs, existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { AutosaveEntry, Session } from '@shared/types'

const AUTOSAVE_INTERVAL_MS = 60_000
const MAX_AUTOSAVES = 10

let timer: ReturnType<typeof setInterval> | null = null
let current: Session | null = null

function autosaveDir(): string {
  const dir = join(app.getPath('userData'), 'autosave')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function sentinelPath(): string {
  return join(autosaveDir(), '.running')
}

export function setCurrentSession(s: Session): void {
  current = s
}

async function writeSnapshot(): Promise<void> {
  if (!current) return
  const dir = autosaveDir()
  // Rotating filename by minute-of-hour keeps a small ring without extra
  // bookkeeping; the newest MAX_AUTOSAVES survive the prune below.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = join(dir, `autosave-${stamp}.opsia.json`)
  try {
    await fs.writeFile(path, JSON.stringify(current, null, 2), 'utf8')
    await prune(dir)
  } catch (e) {
    console.error('[autosave] snapshot failed:', (e as Error).message)
  }
}

async function prune(dir: string): Promise<void> {
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.opsia.json'))
  if (files.length <= MAX_AUTOSAVES) return
  files.sort() // ISO stamps sort chronologically
  for (const f of files.slice(0, files.length - MAX_AUTOSAVES)) {
    await fs.rm(join(dir, f)).catch(() => {})
  }
}

/** Returns `{ crashed }` : true when the previous run left a sentinel behind. */
export function startAutosave(): { crashed: boolean } {
  const sentinel = sentinelPath()
  const crashed = existsSync(sentinel)
  try {
    writeFileSync(sentinel, String(Date.now()), 'utf8')
  } catch {
    /* non-fatal */
  }
  timer = setInterval(() => {
    void writeSnapshot()
  }, AUTOSAVE_INTERVAL_MS)
  return { crashed }
}

export function stopAutosave(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  // Final snapshot + remove sentinel = clean-exit marker.
  void writeSnapshot()
  try {
    const sentinel = sentinelPath()
    if (existsSync(sentinel)) unlinkSync(sentinel)
  } catch {
    /* ignore */
  }
}

export async function listAutosaves(): Promise<AutosaveEntry[]> {
  const dir = autosaveDir()
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.opsia.json'))
  const entries: AutosaveEntry[] = []
  for (const f of files) {
    try {
      const stat = await fs.stat(join(dir, f))
      const text = await fs.readFile(join(dir, f), 'utf8')
      const s = JSON.parse(text) as Session
      entries.push({ path: join(dir, f), name: s.name || f, savedAt: stat.mtimeMs })
    } catch {
      /* skip unreadable */
    }
  }
  return entries.sort((a, b) => b.savedAt - a.savedAt)
}

export async function loadAutosave(path: string): Promise<Session> {
  const text = await fs.readFile(path, 'utf8')
  return JSON.parse(text) as Session
}
